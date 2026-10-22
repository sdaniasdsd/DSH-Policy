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
    launchDsh: vi.fn().mockResolvedValue({ launched: true }),
    chooseHome: vi.fn().mockResolvedValue(state),
    ...overrides,
  }
}

describe('DSH Policy Manager', () => {
  afterEach(cleanup)
  it('shows the detected runtime and compatibility on the home page', async () => {
    render(<App api={api()} />)

    expect(await screen.findByRole('heading', { name: 'DSH Policy Manager' })).toBeTruthy()
    expect(await screen.findByText('0.2.1-rc.2')).toBeTruthy()
    expect(screen.getByText('Policy 1.0.2 is compatible')).toBeTruthy()
  })

  it('disables Policy mode when the installed runtime has no exact match', async () => {
    const unavailable = api({
      getManagerState: vi.fn().mockResolvedValue({ ...state, policyCompatible: false, compatiblePolicy: null }),
    })
    render(<App api={unavailable} />)
    await screen.findByRole('heading', { name: 'DSH Policy Manager' })
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))

    expect((await screen.findByRole('button', { name: 'Enable Policy mode' })).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('This DSH runtime has no exact Policy compatibility entry.')).toBeTruthy()
  })

  it('routes mode changes through the API and refreshes detected state', async () => {
    const setMode = vi.fn().mockResolvedValue({ mode: 'policy', changed: true })
    const getManagerState = vi.fn()
      .mockResolvedValueOnce(state)
      .mockResolvedValue({ ...state, mode: 'policy', policyVersion: '1.0.2' })
    render(<App api={api({ setMode, getManagerState })} />)
    await screen.findByText('Policy 1.0.2 is compatible')
    fireEvent.click(screen.getByRole('button', { name: 'Policy' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Enable Policy mode' }))

    await waitFor(() => expect(setMode).toHaveBeenCalledWith('policy'))
    expect(await screen.findByText('Policy mode')).toBeTruthy()
  })

  it('shows releases and activity in their dedicated views', async () => {
    const client = api({
      listReleases: vi.fn().mockResolvedValue([{ desktopVersion: '1.0.2', runtimeVersion: '0.2.1-rc.2', runtimeCommit: '0123456789abcdef0123456789abcdef01234567', installable: true, policies: [], installerUrl: 'https://download.deepseek.com/dsh.exe', sha256: 'a'.repeat(64), installerProfile: 'nsis' }]),
      getActivity: vi.fn().mockResolvedValue([{ id: 'op-1', action: 'Mode change', stage: 'Committed', updatedAt: 100 }]),
    })
    render(<App api={client} />)
    fireEvent.click(screen.getByRole('button', { name: 'Versions' }))
    expect(await screen.findByText('DSH Desktop 1.0.2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(await screen.findByText('Mode change')).toBeTruthy()
    expect(screen.getAllByText('Committed')).toHaveLength(2)
  })
})
