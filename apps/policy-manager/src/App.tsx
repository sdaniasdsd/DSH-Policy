import { useCallback, useEffect, useState } from 'react'
import { ActivityPage } from './views/ActivityPage'
import { HomePage } from './views/HomePage'
import { PolicyPage } from './views/PolicyPage'
import { VersionsPage } from './views/VersionsPage'
import { OperationProgress } from './components/OperationProgress'
import { tauriManagerApi } from './manager-api'
import type { ActivityItem, BackupItem, DesktopRelease, ManagerApi, ManagerMode, ManagerSnapshot, ViewId } from './manager-types'
import './manager.css'

export type { ManagerApi } from './manager-types'

const navigation: { id: ViewId; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'versions', label: 'Versions', icon: '◷' },
  { id: 'policy', label: 'Policy', icon: '◈' },
  { id: 'activity', label: 'Activity', icon: '≡' },
]

const viewTitles: Record<ViewId, string> = {
  home: 'Home',
  versions: 'Versions',
  policy: 'Policy',
  activity: 'Activity',
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return 'The operation could not be completed.'
}

export function App({ api = tauriManagerApi }: { api?: ManagerApi }) {
  const [view, setView] = useState<ViewId>('home')
  const [managerState, setManagerState] = useState<ManagerSnapshot | null>(null)
  const [releases, setReleases] = useState<DesktopRelease[]>([])
  const [backups, setBackups] = useState<BackupItem[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [busy, setBusy] = useState(false)
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [stateResult, releaseResult, backupResult, activityResult] = await Promise.allSettled([
      api.getManagerState(), api.listReleases(), api.listBackups(), api.getActivity(),
    ])
    if (stateResult.status === 'fulfilled') setManagerState(stateResult.value)
    else setError(messageOf(stateResult.reason))
    if (releaseResult.status === 'fulfilled') setReleases(releaseResult.value)
    if (backupResult.status === 'fulfilled') setBackups(backupResult.value)
    if (activityResult.status === 'fulfilled') setActivity(activityResult.value)
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

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
    mode === 'policy' ? 'Backing up data and enabling Policy mode…' : 'Backing up data and restoring official mode…',
    () => api.setMode(mode),
    result => result.changed ? `${mode === 'policy' ? 'Policy' : 'Official'} mode is ready.` : `Already using ${mode} mode.`,
  )

  const currentView = !managerState ? (
    <div className="card loading-card" role="status"><span className="spinner" />Detecting DSH installation…</div>
  ) : view === 'home' ? (
    <HomePage
      state={managerState}
      onLaunch={() => { void run('Starting official DSH Desktop…', () => api.launchDsh(), () => 'DSH Desktop launched.') }}
      onChooseHome={(path) => { void run('Saving the shared data home…', async () => {
        const updated = await api.chooseHome(path)
        setManagerState(updated)
        return updated
      }, () => 'Shared Harness home selected.') }}
    />
  ) : view === 'versions' ? (
    <VersionsPage
      releases={releases}
      installedVersion={managerState.installed?.desktopVersion ?? null}
      onRefresh={() => { void run('Checking the signed release catalog…', () => api.refreshCatalog(), result => `Catalog revision ${result.revision} verified.`) }}
      onInstall={(version) => { void run(`Backing up data and installing DSH ${version}…`, () => api.installRelease(version), () => `DSH Desktop ${version} installed.`) }}
      busy={busy}
      catalogStatus={managerState.catalogStatus}
    />
  ) : view === 'policy' ? (
    <PolicyPage state={managerState} onSetMode={changeMode} busy={busy} />
  ) : (
    <ActivityPage activity={activity} backups={backups} onRecover={(id) => {
      if (window.confirm('Restore the previous verified DSH version and pre-upgrade data? The current home will be kept as a recovery copy.')) {
        void run('Restoring the previous verified DSH version and shared data…', () => api.recoverTransition(id), () => 'The previous verified DSH version was restored.')
      }
    }} onRestore={(id) => {
      if (window.confirm('Restore this backup? Current home data will be saved to a new backup first.')) {
        void run('Backing up current data and restoring the selected snapshot…', () => api.restoreBackup(id), () => 'Backup restored.')
      }
    }} busy={busy} />
  )

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">D</span><div><strong>DSH Policy</strong><span>Manager</span></div></div>
        <div className="sidebar-label">MANAGE</div>
        <nav aria-label="Main navigation">
          {navigation.map(item => <button key={item.id} className={`nav-item${view === item.id ? ' nav-item--active' : ''}`} onClick={() => { setView(item.id); setError(null); setNotice(null) }} aria-current={view === item.id ? 'page' : undefined}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
            {view === item.id && <span className="nav-indicator" />}
          </button>)}
        </nav>
        <div className="sidebar-footer"><span className="connection-dot" />Local manager<span>v0.1.0</span></div>
      </aside>
      <div className="main-column">
        <h1 className="sr-only">DSH Policy Manager</h1>
        <header className="topbar"><div className="breadcrumb"><span>DSH Policy Manager</span><span className="breadcrumb-separator">/</span><strong>{viewTitles[view]}</strong></div><div className="topbar-state"><span className="connection-dot" />On this device</div></header>
        <div className="page-wrap">
          {notice && <div className="global-message" role="status">{notice}</div>}
          <OperationProgress busy={busy} message={busyMessage} error={error} />
          {currentView}
        </div>
      </div>
    </main>
  )
}
