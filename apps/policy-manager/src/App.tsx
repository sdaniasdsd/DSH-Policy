import { useCallback, useEffect, useState } from 'react'
import { ActivityPage } from './views/ActivityPage'
import { HomePage } from './views/HomePage'
import { PolicyPage } from './views/PolicyPage'
import { VersionsPage } from './views/VersionsPage'
import { OperationProgress } from './components/OperationProgress'
import { InstallationGuide } from './components/InstallationGuide'
import { tauriManagerApi } from './manager-api'
import type { ActivityItem, BackupItem, DesktopRelease, GithubReleaseIndex, ManagerApi, ManagerMode, ManagerSnapshot, ViewId } from './manager-types'
import './manager.css'

export type { ManagerApi } from './manager-types'

const navigation: { id: ViewId; label: string; icon: string }[] = [
  { id: 'home', label: '概览', icon: '⌂' },
  { id: 'versions', label: '版本', icon: '◷' },
  { id: 'policy', label: '策略', icon: '◈' },
  { id: 'activity', label: '活动与备份', icon: '≡' },
]

const viewTitles: Record<ViewId, string> = {
  home: '概览',
  versions: '版本',
  policy: '策略',
  activity: '活动与备份',
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return '操作未能完成。'
}

type ReadTarget = 'state' | 'releases' | 'backups' | 'activity'
const readLabels: Record<ReadTarget, string> = { state: '本机安装检测失败', releases: '官方签名目录读取失败', backups: '备份读取失败', activity: '活动读取失败' }

export function App({ api = tauriManagerApi }: { api?: ManagerApi }) {
  const [view, setView] = useState<ViewId>('home')
  const [managerState, setManagerState] = useState<ManagerSnapshot | null>(null)
  const [releases, setReleases] = useState<DesktopRelease[]>([])
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [readErrors, setReadErrors] = useState<Partial<Record<ReadTarget, string>>>({})
  const [detecting, setDetecting] = useState(true)
  const [github, setGithub] = useState<GithubReleaseIndex | null>(null)
  const [githubError, setGithubError] = useState<string | null>(null)
  const [githubBusy, setGithubBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const read = useCallback(async (target: ReadTarget) => {
    if (target === 'state') setDetecting(true)
    try {
      switch (target) {
        case 'state': setManagerState(await api.getManagerState()); break
        case 'releases': setReleases(await api.listReleases()); break
        case 'backups': setBackups(await api.listBackups()); break
        case 'activity': setActivity(await api.getActivity()); break
      }
      setReadErrors(previous => ({ ...previous, [target]: undefined }))
    } catch (readError) {
      setReadErrors(previous => ({ ...previous, [target]: messageOf(readError) }))
    } finally {
      if (target === 'state') setDetecting(false)
    }
  }, [api])

  const refresh = useCallback(async () => {
    await Promise.all((['state', 'releases', 'backups', 'activity'] as const).map(read))
  }, [read])

  const refreshGithub = useCallback(async () => {
    setGithubBusy(true)
    setGithubError(null)
    try { setGithub(await api.refreshGithubReleases()) }
    catch (releaseError) { setGithubError(messageOf(releaseError)) }
    finally { setGithubBusy(false) }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void refreshGithub() }, [refreshGithub])

  const run = async <T,>(label: string, operation: () => Promise<T>, success: (result: T) => string) => {
    setBusy(true)
    setBusyMessage(label)
    setNotice(null)
    setError(null)
    try {
      const result = await operation()
      setNotice(success(result))
      await refresh()
    } catch (operationError) {
      setError(messageOf(operationError))
    } finally {
      setBusy(false)
      setBusyMessage(null)
    }
  }

  const changeMode = (mode: ManagerMode) => run(
    mode === 'policy' ? '正在备份数据并启用策略模式…' : '正在备份数据并切换到官方模式…',
    () => api.setMode(mode),
    result => result.changed ? `${mode === 'policy' ? '策略' : '官方'}模式已启用。` : `当前已是${mode === 'policy' ? '策略' : '官方'}模式。`,
  )

  const openGithub = (url: string) => {
    setError(null)
    void api.openGithubUrl(url).catch(openError => setError(messageOf(openError)))
  }

  const selectInstallation = (path: string) => { void run('正在选择管理目标…', async () => {
    const updated = await api.selectInstallation(path)
    setManagerState(updated)
    return updated
  }, () => '已选择管理目标。') }

  const currentView = !managerState ? (
    detecting ? <div className="card loading-card" role="status"><span className="spinner" />正在检测 DSH 安装…</div>
      : <div className="card empty-state"><h2>无法读取本机环境</h2><p className="muted">请检查下方错误原因并重新检测。</p><button className="button" onClick={() => { void read('state') }}>重新检测</button></div>
  ) : view === 'home' ? (
    <HomePage
      state={managerState}
      busy={busy || detecting}
      onRefresh={() => { void refresh() }}
      onResetSelection={() => { void run('正在恢复自动选择…', async () => {
        const updated = await api.resetInstallationSelection()
        setManagerState(updated)
        return updated
      }, () => '已恢复自动选择管理目标。') }}
      onSelectInstallation={selectInstallation}
      onLaunch={() => { void run('正在启动 DSH 桌面版…', () => api.launchDsh(), () => '已启动 DSH 桌面版。') }}
      onChooseHome={(path) => { void run('正在保存共享数据目录…', async () => {
        const updated = await api.chooseHome(path)
        setManagerState(updated)
        return updated
      }, () => '已选择共享数据目录。') }}
    />
  ) : view === 'versions' ? (
    <VersionsPage
      releases={releases}
      state={managerState}
      github={github}
      githubBusy={githubBusy}
      githubError={githubError}
      onRefreshGithub={() => { void refreshGithub() }}
      onOpenGithub={openGithub}
      onRefresh={() => { void run('正在检查已签名的版本目录…', () => api.refreshCatalog(), result => `版本目录 ${result.revision} 已验证。`) }}
      onInstall={(version) => { void run(`正在备份数据并安装 DSH ${version}…`, () => api.installRelease(version), () => `DSH 桌面版 ${version} 已安装。`) }}
      busy={busy}
      catalogStatus={managerState.catalogStatus}
    />
  ) : view === 'policy' ? (
    <PolicyPage state={managerState} onSetMode={changeMode} busy={busy} />
  ) : (
    <ActivityPage activity={activity} backups={backups} onRecover={(id) => {
      if (window.confirm('恢复到上一个已验证的 DSH 版本及升级前的数据吗？当前数据目录会保留为恢复副本。')) {
        void run('正在恢复上一个已验证的 DSH 版本和共享数据…', () => api.recoverTransition(id), () => '已恢复到上一个已验证的 DSH 版本。')
      }
    }} onRestore={(id) => {
      if (window.confirm('恢复这份备份吗？当前目录的数据会先另存为一份新备份。')) {
        void run('正在备份当前数据并恢复所选快照…', () => api.restoreBackup(id), () => '备份已恢复。')
      }
    }} busy={busy} />
  )

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">D</span><div><strong>DSH 策略</strong><span>管理器</span></div></div>
        <div className="sidebar-label">管理</div>
        <nav aria-label="主导航">
          {navigation.map(item => <button key={item.id} className={`nav-item${view === item.id ? ' nav-item--active' : ''}`} onClick={() => { setView(item.id); setError(null); setNotice(null) }} aria-current={view === item.id ? 'page' : undefined}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
            {view === item.id && <span className="nav-indicator" />}
          </button>)}
        </nav>
        <div className="sidebar-footer"><span className="connection-dot" />本机管理器<span>v1.0.6</span></div>
      </aside>
      <div className="main-column">
        <h1 className="sr-only">DSH 策略管理器</h1>
        <header className="topbar"><div className="breadcrumb"><span>DSH 策略管理器</span><span className="breadcrumb-separator">/</span><strong>{viewTitles[view]}</strong></div><div className="topbar-state"><span className="connection-dot" />本机</div></header>
        <div className="page-wrap">
          {notice && <div className="global-message" role="status">{notice}</div>}
          <OperationProgress busy={busy} message={busyMessage} error={error} />
          {(Object.keys(readLabels) as ReadTarget[]).filter(target => readErrors[target]).map(target => <div className="operation-note operation-note--error read-error" role="alert" key={target}>
            <span>{readLabels[target]}：{target !== 'state' && readErrors[target] === readErrors.state ? '与本机检测发生相同错误，请先恢复桌面连接。' : readErrors[target]}{managerState ? '；保留上次读取的数据。' : ''}</span>
            <button className="button" onClick={() => { void read(target) }}>重试{target === 'state' ? '本机检测' : target === 'releases' ? '官方目录' : target === 'backups' ? '备份' : '活动'}</button>
          </div>)}
          {githubError && (view !== 'versions' || !managerState) && <div className="operation-note operation-note--error read-error" role="alert"><span>GitHub 发布读取失败：{githubError === readErrors.state ? '桌面连接不可用，请先恢复桌面连接。' : githubError}{managerState ? '；本机检测仍可使用。' : ''}</span><button className="button" disabled={githubBusy} onClick={() => { void refreshGithub() }}>重试 GitHub 发布</button></div>}
          {managerState && (view === 'home' || view === 'versions') && <InstallationGuide state={managerState} github={github} githubBusy={githubBusy} githubError={githubError} busy={busy || detecting} detectionFailed={Boolean(readErrors.state)} onOpenGithub={openGithub} onEnablePolicy={() => { void changeMode('policy') }} onSelectInstallation={selectInstallation} onViewVersions={view === 'home' ? () => setView('versions') : undefined} onViewInstallations={view === 'versions' ? () => setView('home') : undefined} />}
          {currentView}
        </div>
      </div>
    </main>
  )
}
