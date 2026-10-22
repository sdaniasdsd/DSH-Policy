import type { ActivityItem, BackupItem } from '../manager-types'

export function ActivityPage({ activity, backups, onRestore, onRecover, busy }: {
  activity: ActivityItem[]
  backups: BackupItem[]
  onRestore: (id: string) => void
  onRecover: (id: string) => void
  busy: boolean
}) {
  return (
    <section className="page-stack" aria-labelledby="activity-heading">
      <div className="page-heading"><div><p className="eyebrow">LOCAL HISTORY</p><h2 id="activity-heading">Activity and backups</h2><p className="muted">Operation records and encrypted restore points stay on this device.</p></div></div>
      <article className="card"><div className="section-title"><div><p className="eyebrow">OPERATIONS</p><h3>Recent activity</h3></div></div>
        {activity.length ? <ul className="activity-list">{activity.map(item => <li key={item.id}><span className={`stage-dot stage-dot--${item.stage.toLowerCase()}`} /><div className="activity-copy"><strong>{item.action}</strong><span className="muted">{item.details ?? item.stage}</span></div><span className="tag">{item.stage}</span>{item.recoverable && <button className="button button--danger" disabled={busy} aria-label="Recover previous DSH version" onClick={() => onRecover(item.id)}>Recover old version</button>}</li>)}</ul> : <p className="muted empty-line">No manager operations recorded yet.</p>}
      </article>
      <article className="card"><div className="section-title"><div><p className="eyebrow">RESTORE POINTS</p><h3>Encrypted backups</h3></div></div>
        {backups.length ? <ul className="backup-list">{backups.map(backup => <li key={backup.id}><div><strong>{new Date(backup.createdAt * 1000).toLocaleString()}</strong><span className="muted">{backup.id}</span></div><button className="button button--danger" disabled={busy} onClick={() => onRestore(backup.id)}>Restore</button></li>)}</ul> : <p className="muted empty-line">Backups will appear here before each version or mode change.</p>}
      </article>
    </section>
  )
}
