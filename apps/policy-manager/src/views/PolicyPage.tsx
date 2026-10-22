import type { ManagerSnapshot, ManagerMode } from '../manager-types'
import { CompatibilityStatus } from '../components/CompatibilityStatus'

export function PolicyPage({ state, onSetMode, busy }: {
  state: ManagerSnapshot
  onSetMode: (mode: ManagerMode) => void
  busy: boolean
}) {
  const exactPolicyActive = state.mode === 'policy'
    && state.policyCompatible
    && state.policyVersion !== null
    && state.policyVersion === state.compatiblePolicy?.version
  const modeLabel = exactPolicyActive
    ? '策略模式'
    : state.policyVersion
      ? '策略包需要处理'
      : '官方模式'
  return (
    <section className="page-stack" aria-labelledby="policy-heading">
      <div className="page-heading"><div><p className="eyebrow">配置管理</p><h2 id="policy-heading">模式与策略</h2><p className="muted">管理器通过 DSH 桌面配置命令切换策略扩展包。</p></div></div>
      <article className="card mode-card">
        <div className="mode-copy"><p className="eyebrow">当前模式</p><h3>{modeLabel}</h3><p className="muted">{exactPolicyActive ? `策略包 ${state.policyVersion} 已在桌面配置中启用。` : state.policyVersion ? `已安装策略包 ${state.policyVersion}，但与当前运行时的精确映射不匹配。` : '当前使用不含策略扩展包的官方 DSH 配置。'}</p></div>
        <div className="mode-actions">
          <button className={`button ${state.mode === 'official' ? 'button--selected' : ''}`} onClick={() => onSetMode('official')} disabled={busy || !state.installed}>使用官方模式</button>
          <button className="button button--primary" onClick={() => onSetMode('policy')} disabled={busy || !state.installed || !state.policyCompatible || exactPolicyActive}>启用策略模式</button>
        </div>
      </article>
      <article className="card status-card"><div><p className="eyebrow">运行时精确匹配</p><h3>兼容性检查</h3></div><CompatibilityStatus state={state} /></article>
      <article className="card detail-card"><h3>策略扩展包</h3><dl><div><dt>包名</dt><dd>@deepseek-ai/dsh-policy-extension</dd></div><div><dt>兼容版本</dt><dd>{state.compatiblePolicy?.version ?? '不可用'}</dd></div><div><dt>匹配的 DSH 运行时</dt><dd>{state.compatiblePolicy?.runtimeVersion ?? state.installed?.runtimeVersion ?? '未知'}</dd></div><div><dt>已安装版本</dt><dd>{state.policyVersion ?? '未安装'}</dd></div></dl></article>
    </section>
  )
}
