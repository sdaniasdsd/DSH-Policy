import type { ActivityItem, BackupItem } from '../manager-types'

const stageLabels: Record<string, string> = {
  Prepared: '准备中', BackedUp: '已备份', Installing: '安装中', ProfileUpdating: '配置更新中',
  Verifying: '验证中', Committed: '已完成', Recovering: '恢复中', RecoveryRequired: '需要恢复',
}

function stageLabel(stage: string) { return stageLabels[stage] ?? stage }
function actionLabel(action: string) {
  if (action === 'DSH manager transition') return 'DSH 管理器操作'
  if (action === 'Mode change') return '模式切换'
  return action
}
function detailLabel(details: string | undefined, stage: string) {
  if (!details) return stageLabel(stage)
  return details.startsWith('Operation ') ? `操作编号 ${details.slice('Operation '.length)}` : details
}

export function ActivityPage({ activity, backups, onRestore, onRecover, busy }: {
  activity: ActivityItem[]
  backups: BackupItem[]
  onRestore: (id: string) => void
  onRecover: (id: string) => void
  busy: boolean
}) {
  return (
    <section className="page-stack" aria-labelledby="activity-heading">
      <div className="page-heading"><div><p className="eyebrow">本机记录</p><h2 id="activity-heading">活动与备份</h2><p className="muted">操作记录和加密恢复点保存在本机。</p></div></div>
      <article className="card"><div className="section-title"><div><p className="eyebrow">操作</p><h3>最近活动</h3></div></div>
        {activity.length ? <ul className="activity-list">{activity.map(item => <li key={item.id}><span className={`stage-dot stage-dot--${item.stage.toLowerCase()}`} /><div className="activity-copy"><strong>{actionLabel(item.action)}</strong><span className="muted">{detailLabel(item.details, item.stage)}</span></div><span className="tag">{stageLabel(item.stage)}</span>{item.recoverable && <button className="button button--danger" disabled={busy} aria-label="恢复到上一个 DSH 版本" onClick={() => onRecover(item.id)}>恢复旧版本</button>}</li>)}</ul> : <p className="muted empty-line">尚无管理操作记录。</p>}
      </article>
      <article className="card"><div className="section-title"><div><p className="eyebrow">恢复点</p><h3>加密备份</h3></div></div>
        {backups.length ? <ul className="backup-list">{backups.map(backup => <li key={backup.id}><div><strong>{new Date(backup.createdAt * 1000).toLocaleString('zh-CN')}</strong><span className="muted">{backup.id}</span></div><button className="button button--danger" disabled={busy} onClick={() => onRestore(backup.id)}>恢复</button></li>)}</ul> : <p className="muted empty-line">每次切换版本或模式前创建的备份会显示在这里。</p>}
      </article>
    </section>
  )
}
