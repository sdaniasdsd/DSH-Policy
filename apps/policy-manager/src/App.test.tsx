// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, type ManagerApi } from './App'

const state = {
  installed: {
    desktopVersion: '1.0.2',
    runtimeVersion: '0.2.1-rc.2',
    runtimeCommit: '0123456789abcdef0123456789abcdef01234567',
  },
  home: 'C:/Users/test/.dsh',
  homeChoice: null,
  mode: 'official' as const,
  policyVersion: null,
  policyCompatible: true,
  compatiblePolicy: { package: '@deepseek-ai/dsh-policy-extension', version: '1.0.2' },
  catalogRevision: 1,
  catalogStatus: 'Verified catalog revision 1.',
}

function api(overrides: Partial<ManagerApi> = {}): ManagerApi {
  return {
    getManagerState: vi.fn().mockResolvedValue(state),
    listReleases: vi.fn().mockResolvedValue([]),
    listBackups: vi.fn().mockResolvedValue([]),
    getActivity: vi.fn().mockResolvedValue([]),
    refreshCatalog: vi.fn().mockResolvedValue({ revision: 1, expiresAt: 1_800_000_000 }),
    setMode: vi.fn().mockResolvedValue({ mode: 'policy', changed: true }),
    installRelease: vi.fn().mockResolvedValue({ installed: true }),
    restoreBackup: vi.fn().mockResolvedValue({ restored: true }),
    recoverTransition: vi.fn().mockResolvedValue({ recovered: true }),
    launchDsh: vi.fn().mockResolvedValue({ launched: true }),
    chooseHome: vi.fn().mockResolvedValue(state),
    ...overrides,
  }
}

describe('DSH Policy Manager', () => {
  afterEach(cleanup)
  it('shows the manager in Simplified Chinese by default', async () => {
    render(<App api={api()} />)

    expect(await screen.findByRole('heading', { name: 'DSH 策略管理器' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '概览' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '版本' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '策略' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '活动与备份' })).toBeTruthy()
    expect(await screen.findByText('DeepSeek 官方 Harness')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByText('暂无已验证的安装包')).toBeTruthy()
    expect(screen.getByText('已验证版本目录（版本 1）。')).toBeTruthy()
  })

  it('shows the detected runtime and compatibility on the home page', async () => {
    render(<App api={api()} />)

    expect(await screen.findByRole('heading', { name: 'DSH 策略管理器' })).toBeTruthy()
    expect(await screen.findByText('0.2.1-rc.2')).toBeTruthy()
    expect(screen.getByText('策略版本 1.0.2 兼容')).toBeTruthy()
  })

  it('disables Policy mode when the installed runtime has no exact match', async () => {
    const unavailable = api({
      getManagerState: vi.fn().mockResolvedValue({ ...state, policyCompatible: false, compatiblePolicy: null }),
    })
    render(<App api={unavailable} />)
    await screen.findByRole('heading', { name: 'DSH 策略管理器' })
    fireEvent.click(screen.getByRole('button', { name: '策略' }))

    expect((await screen.findByRole('button', { name: '启用策略模式' })).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('当前 DSH 运行时没有精确匹配的策略兼容记录。')).toBeTruthy()
  })

  it('routes mode changes through the API and refreshes detected state', async () => {
    const setMode = vi.fn().mockResolvedValue({ mode: 'policy', changed: true })
    const getManagerState = vi.fn()
      .mockResolvedValueOnce(state)
      .mockResolvedValue({ ...state, mode: 'policy', policyVersion: '1.0.2' })
    render(<App api={api({ setMode, getManagerState })} />)
    await screen.findByText('策略版本 1.0.2 兼容')
    fireEvent.click(screen.getByRole('button', { name: '策略' }))
    fireEvent.click(await screen.findByRole('button', { name: '启用策略模式' }))

    await waitFor(() => expect(setMode).toHaveBeenCalledWith('policy'))
    expect(await screen.findByText('策略模式')).toBeTruthy()
  })

  it('shows releases and activity in their dedicated views', async () => {
    const client = api({
      listReleases: vi.fn().mockResolvedValue([{ desktopVersion: '1.0.2', runtimeVersion: '0.2.1-rc.2', runtimeCommit: '0123456789abcdef0123456789abcdef01234567', installable: true, policies: [], installerUrl: 'https://download.deepseek.com/dsh.exe', sha256: 'a'.repeat(64), installerProfile: 'nsis' }]),
      getActivity: vi.fn().mockResolvedValue([{ id: 'op-1', action: 'Mode change', stage: 'Committed', updatedAt: 100 }]),
    })
    render(<App api={client} />)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByText('DSH 桌面版 1.0.2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '活动与备份' }))
    expect(await screen.findByText('模式切换')).toBeTruthy()
    expect(screen.getAllByText('已完成')).toHaveLength(2)
  })

  it('offers a recovery action for an interrupted version transition', async () => {
    const recoverTransition = vi.fn().mockResolvedValue({ recovered: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const client = api({
      getActivity: vi.fn().mockResolvedValue([{ id: 'op-2', action: 'DSH manager transition', stage: 'RecoveryRequired', updatedAt: 100, recoverable: true }]),
      recoverTransition,
    })
    render(<App api={client} />)
    fireEvent.click(screen.getByRole('button', { name: '活动与备份' }))

    fireEvent.click(await screen.findByRole('button', { name: '恢复到上一个 DSH 版本' }))

    await waitFor(() => expect(recoverTransition).toHaveBeenCalledWith('op-2'))
    expect(await screen.findByText('已恢复到上一个已验证的 DSH 版本。')).toBeTruthy()
  })
})
