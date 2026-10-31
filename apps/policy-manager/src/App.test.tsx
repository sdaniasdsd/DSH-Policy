// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, type ManagerApi } from './App'

const state = {
  installed: {
    installLocation: 'C:/Programs/DeepSeek Harness',
    desktopVersion: '1.0.2',
    runtimeVersion: '0.2.1-rc.2',
    runtimeCommit: '0123456789abcdef0123456789abcdef01234567',
  },
  installations: [{ edition: 'official' as const, displayName: 'DeepSeek Harness 1.0.2', installed: { installLocation: 'C:/Programs/DeepSeek Harness', desktopVersion: '1.0.2', runtimeVersion: '0.2.1-rc.2', runtimeCommit: '0123456789abcdef0123456789abcdef01234567' } }],
  installationEdition: 'official' as const,
  home: 'C:/Users/test/.dsh',
  homeChoice: null,
  mode: 'official' as const,
  policyVersion: null,
  policyCompatible: true,
  compatiblePolicy: { package: '@deepseek-ai/dsh-policy-extension', version: '1.0.2', runtimeVersion: '0.2.1-rc.2', runtimeCommit: '0123456789abcdef0123456789abcdef01234567', tarballUrl: 'https://github.com/sdaniasdsd/DSH-Policy/releases/download/extension-v1.0.2/dsh-policy-extension-1.0.2.tgz', sha256: 'c'.repeat(64), size: 2048 },
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
    selectInstallation: vi.fn().mockResolvedValue(state),
    refreshGithubReleases: vi.fn().mockResolvedValue(githubIndex),
    openGithubUrl: vi.fn().mockResolvedValue(undefined),
    resetInstallationSelection: vi.fn().mockResolvedValue(state),
    ...overrides,
  }
}

const policyInstallation = { edition: 'policy' as const, displayName: 'DSH Policy Edition 1.0.2', installed: { ...state.installed, installLocation: 'C:/Programs/DSHPolicyEdition' } }
const githubIndex = {
  repository: 'sdaniasdsd/DSH-Policy', checkedAt: 1_800_000_000,
  policyExtensions: [{ tag: 'extension-v1.0.2', version: '1.0.2', package: '@deepseek-ai/dsh-policy-extension', name: 'DSH Policy Extension 1.0.2', publishedAt: '2026-10-23T12:00:00Z', prerelease: false, htmlUrl: 'https://github.com/sdaniasdsd/DSH-Policy/releases/tag/extension-v1.0.2', sourceCommit: 'd'.repeat(40), runtimeVersion: null, runtimeCommit: null, tarball: { name: 'dsh-policy-extension-1.0.2.tgz', url: 'https://github.com/sdaniasdsd/DSH-Policy/releases/download/extension-v1.0.2/dsh-policy-extension-1.0.2.tgz', sha256: 'c'.repeat(64), size: 2048 } }],
  releases: [{ tag: 'v1.0.2', version: '1.0.2', name: 'DSH Policy Edition 1.0.2', publishedAt: '2026-10-22T12:00:00Z', prerelease: false, htmlUrl: 'https://github.com/sdaniasdsd/DSH-Policy/releases/tag/v1.0.2', sourceCommit: state.installed.runtimeCommit, installer: { name: 'dsh-policy-1.0.2-win-x64-unsigned.exe', url: 'https://github.com/sdaniasdsd/DSH-Policy/releases/download/v1.0.2/dsh-policy-1.0.2-win-x64-unsigned.exe', sha256: 'b'.repeat(64), size: 100 } }],
}
const auditedRelease = { ...githubIndex.releases[0], officialBase: { version: '0.2.0', tag: 'v0.2.0', commit: 'c'.repeat(40), sourceUrl: 'https://github.com/sdaniasdsd/DSH-Policy/tree/' + 'd'.repeat(40), verification: 'verified' as const } }

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
      getManagerState: vi.fn().mockResolvedValue({
        ...state,
        policyCompatible: false,
        compatiblePolicy: null,
        unavailableReason: 'No exact Policy release matches DSH 0.2.1-rc.2 at commit 332895e0f7.',
      }),
    })
    render(<App api={unavailable} />)
    await screen.findByRole('heading', { name: 'DSH 策略管理器' })
    fireEvent.click(screen.getByRole('button', { name: '策略' }))

    expect((await screen.findByRole('button', { name: '启用策略模式' })).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('已检测到本机 DSH 0.2.1-rc.2；当前没有与此运行时关联的已验证策略安装记录，官方模式仍可使用。')).toBeTruthy()
  })

  it('routes mode changes through the API and refreshes detected state', async () => {
    const setMode = vi.fn().mockResolvedValue({ mode: 'policy', changed: true })
    const getManagerState = vi.fn()
      .mockResolvedValueOnce(state)
      .mockResolvedValue({ ...state, mode: 'policy', policyVersion: '1.0.2' })
    render(<App api={api({ setMode, getManagerState })} />)
    await screen.findByText('策略版本 1.0.2 兼容')
    fireEvent.click(screen.getByRole('button', { name: '策略' }))
    fireEvent.click(await screen.findByRole('button', { name: '安装并启用策略模式' }))

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

  it('automatically loads GitHub releases and associates a selected Policy Edition by version and commit', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, installed: policyInstallation.installed, installations: [state.installations[0], policyInstallation], installationEdition: 'policy' }) })} />)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByText('sdaniasdsd/DSH-Policy')).toBeTruthy()
    expect(await screen.findByText('已安装策略独立版 · 版本标签对应')).toBeTruthy()
    expect(screen.getByText('构建来源提交匹配')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看 GitHub 发布' }).getAttribute('href')).toBe(githubIndex.releases[0].htmlUrl)
    expect(screen.getByText('b'.repeat(64))).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'GitHub 策略增强包' })).toBeTruthy()
    expect(screen.getByText('DSH Policy Extension 1.0.2')).toBeTruthy()
    expect(screen.getByText(/没有可信的 DSH 运行时映射/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看 GitHub 扩展发布' }).getAttribute('href')).toBe(githubIndex.policyExtensions[0].htmlUrl)
    expect(screen.queryByRole('button', { name: /安装.*扩展/ })).toBeNull()
    expect(screen.getByRole('heading', { name: '已验证签名目录' })).toBeTruthy()
  })

  it('keeps local detection available when GitHub fails and retries without losing existing releases', async () => {
    const refreshGithubReleases = vi.fn().mockResolvedValueOnce(githubIndex).mockRejectedValueOnce(new Error('网络不可达')).mockResolvedValue(githubIndex)
    render(<App api={api({ refreshGithubReleases })} />)
    expect(await screen.findByText('0.2.1-rc.2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByRole('link', { name: '查看 GitHub 发布' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新 GitHub 发布' }))
    expect(await screen.findByText(/GitHub 发布读取失败：网络不可达/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看 GitHub 发布' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试 GitHub 发布' }))
    await waitFor(() => expect(screen.queryByText(/GitHub 发布读取失败/)).toBeNull())
  })

  it('shows independent local read failures with retry actions', async () => {
    render(<App api={api({ listReleases: vi.fn().mockRejectedValue(new Error('目录读取失败')), listBackups: vi.fn().mockRejectedValue(new Error('备份读取失败')), getActivity: vi.fn().mockRejectedValue(new Error('日志读取失败')) })} />)
    expect(await screen.findByText(/官方签名目录读取失败：目录读取失败/)).toBeTruthy()
    expect(screen.getByText(/备份读取失败：备份读取失败/)).toBeTruthy()
    expect(screen.getByText(/活动读取失败：日志读取失败/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新检测' })).toBeTruthy()
  })

  it('selects between detected installations and explains why integrated Policy Edition cannot switch by extension removal', async () => {
    const selected = { ...state, installed: policyInstallation.installed, installations: [state.installations[0], policyInstallation], installationEdition: 'policy' }
    const client = api({
      getManagerState: vi.fn().mockResolvedValueOnce({ ...state, installations: selected.installations })
        .mockResolvedValue(selected),
      selectInstallation: vi.fn().mockResolvedValue(selected),
    })
    render(<App api={client} />)
    expect(await screen.findByText('C:/Programs/DSHPolicyEdition')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '管理 DSH Policy Edition 1.0.2' }))
    expect(await screen.findByText('策略独立版')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '策略' }))
    expect(await screen.findByText('策略功能已整合在此应用中，不能通过移除扩展包切回官方版。请在概览中选择官方安装。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '使用官方模式' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '安装并启用策略模式' }).hasAttribute('disabled')).toBe(true)
  })

  it('marks a matching version with a different source commit as awaiting verification', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, installed: { ...policyInstallation.installed, runtimeCommit: 'a'.repeat(40) }, installations: [policyInstallation], installationEdition: 'policy' }) })} />)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByText('构建来源待核验')).toBeTruthy()
    expect(screen.queryByText('构建来源提交匹配')).toBeNull()
  })

  it('explains a missing native bridge instead of showing an endless detection spinner', async () => {
    render(<App />)
    expect(await screen.findByText(/请在已安装的 DSH 策略管理器桌面应用中运行/)).toBeTruthy()
    expect(screen.queryByText('正在检测 DSH 安装…')).toBeNull()
  })

  it('shows the known extension mapping without comparing upstream tag and desktop build commits', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, policyCompatible: false, compatiblePolicy: null, knownPolicy: { policyVersion: '1.0.2', dshVersion: '0.2.1-rc.2', dshCommit: '687f282'.padEnd(40, 'a'), dshTag: 'v0.2.1-rc.2' } }) })} />)
    fireEvent.click(screen.getByRole('button', { name: '策略' }))
    expect(await screen.findByText('运行时版本相同；官方源码标签提交与桌面构建提交是不同字段，不能直接比较。自动安装仍需已验证目录收录。')).toBeTruthy()
    expect(screen.getByText('687f282'.padEnd(40, 'a'))).toBeTruthy()
    expect(screen.getByText('当前桌面构建提交').parentElement?.textContent).toContain('不能直接与上游标签提交比较')
    expect(screen.getByRole('button', { name: '启用策略模式' }).hasAttribute('disabled')).toBe(true)
  })

  it('reports a failure to open the GitHub release in the system browser', async () => {
    render(<App api={api({ openGithubUrl: vi.fn().mockRejectedValue(new Error('浏览器启动失败')) })} />)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    fireEvent.click(await screen.findByRole('link', { name: '查看 GitHub 发布' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '浏览器启动失败')
  })

  it('keeps other read failures visible when installation detection also fails', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockRejectedValue(new Error('注册表不可读')), listBackups: vi.fn().mockRejectedValue(new Error('备份目录不可读')), refreshGithubReleases: vi.fn().mockRejectedValue(new Error('GitHub 网络不可达')) })} />)
    expect(await screen.findByText(/本机安装检测失败：注册表不可读/)).toBeTruthy()
    expect(screen.getByText(/备份读取失败：备份目录不可读/)).toBeTruthy()
    expect(screen.getByText(/GitHub 发布读取失败：GitHub 网络不可达/)).toBeTruthy()
  })

  it('offers to reset a saved installation selection that no longer exists', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValueOnce({ ...state, installed: null, installationEdition: null, selectedInstallationPath: 'C:/Removed/DSHPolicyEdition' }).mockResolvedValue(state) })} />)
    expect(await screen.findByText('C:/Removed/DSHPolicyEdition')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复自动选择' }))
    expect(await screen.findByText('已恢复自动选择管理目标。')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: '恢复自动选择' })).toBeNull())
    expect(screen.getByText('DeepSeek 官方 Harness')).toBeTruthy()
  })

  it('offers an exact matching extension from the home guide through the existing mode action', async () => {
    const setMode = vi.fn().mockResolvedValue({ mode: 'policy', changed: true })
    render(<App api={api({ setMode })} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    fireEvent.click(within(guide).getByRole('button', { name: '安装并启用匹配的增强包' }))
    expect(await screen.findByText('策略模式已启用。')).toBeTruthy()
    expect(setMode).toHaveBeenCalledWith('policy')
  })

  it('distinguishes installing the catalog-verified extension from enabling one already installed', async () => {
    const setMode = vi.fn().mockResolvedValue({ mode: 'policy', changed: true })
    render(<App api={api({ setMode })} />)
    fireEvent.click(screen.getByRole('button', { name: '策略' }))
    expect(await screen.findByRole('button', { name: '安装并启用策略模式' })).toBeTruthy()
    expect(screen.getByText(/先备份共享数据，再校验并安装增强包/)).toBeTruthy()
    expect(screen.getByText('c'.repeat(64))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '安装并启用策略模式' }))
    await waitFor(() => expect(setMode).toHaveBeenCalledWith('policy'))

    cleanup()
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, policyVersion: '1.0.2' }), setMode })} />)
    fireEvent.click(screen.getByRole('button', { name: '策略' }))
    expect(await screen.findByRole('button', { name: '启用策略模式' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '安装并启用策略模式' })).toBeNull()
  })

  it('does not treat a public extension GitHub release as authorization to enable Policy mode', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, policyCompatible: false, compatiblePolicy: null }), refreshGithubReleases: vi.fn().mockResolvedValue({ ...githubIndex, policyExtensions: [{ ...githubIndex.policyExtensions[0], runtimeVersion: '0.2.1-rc.2', runtimeCommit: '0123456789abcdef0123456789abcdef01234567' }] }) })} />)
    fireEvent.click(screen.getByRole('button', { name: '策略' }))
    expect((await screen.findByRole('button', { name: '启用策略模式' })).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByText(/未经签名目录验证，不用于兼容判断/)).toBeTruthy()
  })

  it('recommends a complete stable application for a fresh installation and opens its download', async () => {
    const openGithubUrl = vi.fn().mockResolvedValue(undefined)
    const client = api({
      getManagerState: vi.fn().mockResolvedValue({
        ...state,
        installed: null,
        installations: [],
        installationEdition: null,
      }),
      refreshGithubReleases: vi.fn().mockResolvedValue({ ...githubIndex, releases: [auditedRelease] }),
      openGithubUrl,
    })
    render(<App api={client} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    expect(await within(guide).findByText('还没有检测到 DSH。')).toBeTruthy()
    expect(within(guide).getByText('这是完整的独立应用，无需先安装官方版或另装增强包。')).toBeTruthy()
    fireEvent.click(within(guide).getByRole('button', { name: '下载推荐独立包 1.0.2' }))
    await waitFor(() => expect(openGithubUrl).toHaveBeenCalledWith(auditedRelease.installer.url))
    fireEvent.click(within(guide).getByRole('button', { name: '查看全部版本与依据' }))
    expect(await screen.findByRole('heading', { name: 'GitHub 策略独立包发布' })).toBeTruthy()
  })

  it('shows verified, declared and unknown official baselines without inferring extension compatibility', async () => {
    const declared = { ...auditedRelease, tag: 'v1.0.1', name: '整合版 1.0.1', version: '1.0.1', officialBase: { ...auditedRelease.officialBase, version: '0.1.0', commit: null, verification: 'declared' as const, note: '仅有包版本声明，完整上游源码升级尚未核验。' } }
    const openGithubUrl = vi.fn().mockResolvedValue(undefined)
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, policyCompatible: false, compatiblePolicy: null }), refreshGithubReleases: vi.fn().mockResolvedValue({ ...githubIndex, releases: [auditedRelease, declared, { ...githubIndex.releases[0], tag: 'v0.9.0', version: '0.9.0', name: '未知整合版' }] }), openGithubUrl })} />)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByText('基于官方 DSH 0.2.0')).toBeTruthy()
    expect(screen.getByText('声明基于官方 DSH 0.1.0')).toBeTruthy()
    expect(screen.getByText('官方构建提交待核验')).toBeTruthy()
    expect(screen.getByText('仅有包版本声明，完整上游源码升级尚未核验。')).toBeTruthy()
    expect(screen.getByText('官方基线待核验')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '启用匹配的增强包' })).toBeNull()
    fireEvent.click(screen.getAllByRole('link', { name: '查看基线依据' })[0])
    await waitFor(() => expect(openGithubUrl).toHaveBeenCalledWith(auditedRelease.officialBase.sourceUrl))
  })

  it('keeps a current preview installation instead of guiding a downgrade to a stable release', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, installed: { ...policyInstallation.installed, desktopVersion: '2.0.0-preview.1' }, installationEdition: 'policy' }), refreshGithubReleases: vi.fn().mockResolvedValue({ ...githubIndex, releases: [auditedRelease] }) })} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    expect(await within(guide).findByText('当前使用预发布版，建议保留当前安装，先查看发布说明。')).toBeTruthy()
    expect(within(guide).queryByRole('button', { name: /下载推荐独立包/ })).toBeNull()
  })

  it('does not confuse the desktop build commit with the upstream runtime tag commit', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, policyCompatible: false, compatiblePolicy: null, knownPolicy: { policyVersion: '1.0.2', dshVersion: state.installed.runtimeVersion, dshCommit: 'b'.repeat(40), dshTag: 'v0.2.1-rc.2' } }) })} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    expect(await within(guide).findByText('要求的官方 DSH 运行时版本与本机相同；桌面构建提交不与上游标签提交直接比较。自动安装仍需已验证目录收录。')).toBeTruthy()
    expect(within(guide).getByText('暂无可推荐的正式独立包，请查看版本列表或保留当前安装。')).toBeTruthy()
    expect(within(guide).queryByRole('button', { name: /下载推荐独立包/ })).toBeNull()
  })

  it('asks for a detected installation target before recommending a download', async () => {
    const client = api({
      getManagerState: vi.fn().mockResolvedValue({
        ...state,
        installed: null,
        installationEdition: null,
        installations: [state.installations[0], policyInstallation],
      }),
      refreshGithubReleases: vi.fn().mockResolvedValue({ ...githubIndex, releases: [auditedRelease] }),
    })
    render(<App api={client} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    expect(within(guide).getByText('检测到本机安装，但尚未选定有效的管理目标。请先在概览中选择。')).toBeTruthy()
    expect(within(guide).queryByRole('button', { name: /下载推荐独立包/ })).toBeNull()
    expect(within(guide).queryByRole('button', { name: '启用匹配的增强包' })).toBeNull()
  })

  it('qualifies a retained recommendation after the release refresh fails', async () => {
    const refreshGithubReleases = vi.fn().mockResolvedValueOnce({ ...githubIndex, releases: [auditedRelease] }).mockRejectedValue(new Error('网络中断'))
    render(<App api={api({ refreshGithubReleases })} />)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    await screen.findByRole('button', { name: '下载推荐独立包 1.0.2' })
    fireEvent.click(screen.getByRole('button', { name: '刷新 GitHub 发布' }))
    const guide = screen.getByRole('region', { name: '我该装哪个' })
    expect(await within(guide).findByText('发布检查失败，以下仅为上次成功读取的正式版本；不能确认是否最新。')).toBeTruthy()
    expect(within(guide).getByText('可选已读取的正式版本：策略独立包 1.0.2')).toBeTruthy()
  })

  it('switches to the already installed Policy application from the guide without starting or enabling anything', async () => {
    const official = {
      ...state,
      policyCompatible: false,
      compatiblePolicy: null,
      installations: [state.installations[0], policyInstallation],
    }
    const selected = { ...official, installed: policyInstallation.installed, installationEdition: 'policy' }
    const client = api({
      getManagerState: vi.fn().mockResolvedValueOnce(official).mockResolvedValue(selected),
      selectInstallation: vi.fn().mockResolvedValue(selected),
      refreshGithubReleases: vi.fn().mockResolvedValue({ ...githubIndex, releases: [auditedRelease] }),
    })
    render(<App api={client} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    const useExisting = await within(guide).findByRole('button', { name: '使用已安装的策略独立版 1.0.2' })
    expect(within(guide).queryByRole('button', { name: /下载推荐独立包/ })).toBeNull()
    expect(within(guide).queryByRole('button', { name: '启用匹配的增强包' })).toBeNull()
    fireEvent.click(useExisting)
    expect(await screen.findByText('已选择管理目标。')).toBeTruthy()
    expect(client.selectInstallation).toHaveBeenCalledWith(policyInstallation.installed.installLocation)
    expect(client.setMode).not.toHaveBeenCalled()
    expect(client.launchDsh).not.toHaveBeenCalled()
    expect(await within(guide).findByText('当前管理：策略独立版 1.0.2')).toBeTruthy()
  })

  it('keeps the existing Policy shortcut available without claiming latest when GitHub is unavailable', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, installations: [state.installations[0], policyInstallation] }), refreshGithubReleases: vi.fn().mockRejectedValue(new Error('离线')) })} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    expect(await within(guide).findByRole('button', { name: '使用已安装的策略独立版 1.0.2' })).toBeTruthy()
    expect(within(guide).getByText('本机已有策略独立版 1.0.2，无需重复下载。')).toBeTruthy()
  })

  it('disables the existing Policy shortcut until the shared home is selected', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValue({ ...state, installations: [state.installations[0], policyInstallation], homeChoice: { standard: 'a', policy: 'b' } }) })} />)
    expect((await screen.findByRole('button', { name: '使用已安装的策略独立版 1.0.2' })).hasAttribute('disabled')).toBe(true)
  })

  it('disables the existing Policy shortcut after a failed installation recheck', async () => {
    render(<App api={api({ getManagerState: vi.fn().mockResolvedValueOnce({ ...state, installations: [state.installations[0], policyInstallation] }).mockRejectedValue(new Error('检测失败')) })} />)
    const shortcut = await screen.findByRole('button', { name: '使用已安装的策略独立版 1.0.2' })
    fireEvent.click(screen.getByRole('button', { name: '重新检测' }))
    await screen.findByText(/本机安装检测失败：检测失败/)
    expect(shortcut.hasAttribute('disabled')).toBe(true)
  })

  it('labels a semantic prerelease as preview even when GitHub prerelease is false', async () => {
    render(<App api={api({ refreshGithubReleases: vi.fn().mockResolvedValue({ ...githubIndex, releases: [{ ...auditedRelease, version: '1.0.2-alpha.1', tag: 'v1.0.2-alpha.1', prerelease: false }] }) })} />)
    fireEvent.click(screen.getByRole('button', { name: '版本' }))
    expect(await screen.findByText(/标签 v1\.0\.2-alpha\.1 · 预发布/)).toBeTruthy()
    expect(screen.queryByText(/标签 v1\.0\.2-alpha\.1 · 正式发布/)).toBeNull()
  })

  it('disables the existing Policy shortcut while a management selection is pending', async () => {
    const client = api({
      getManagerState: vi.fn().mockResolvedValue({
        ...state,
        installations: [state.installations[0], policyInstallation],
      }),
      selectInstallation: vi.fn().mockImplementation(() => new Promise(() => {})),
    })
    render(<App api={client} />)
    const shortcut = await screen.findByRole('button', { name: '使用已安装的策略独立版 1.0.2' })
    fireEvent.click(shortcut)
    expect(shortcut.hasAttribute('disabled')).toBe(true)
  })

  it('names the exact official runtime and extension package in the simple guide', async () => {
    render(<App api={api()} />)
    const guide = await screen.findByRole('region', { name: '我该装哪个' })
    expect(within(guide).getByText('匹配方案：官方 DSH 0.2.1-rc.2 + 增强包 1.0.2')).toBeTruthy()
  })
})
