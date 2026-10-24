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
  const integrated = state.installationEdition === 'policy'
  const knownPolicy = state.knownPolicy
  const mappingMessage = knownPolicy && state.installed
    ? state.installed.runtimeVersion !== knownPolicy.dshVersion ? '运行时版本不匹配'
      : state.installed.buildDirty ? '构建含未提交改动，不能启用扩展'
        : '运行时版本相同；官方源码标签提交与桌面构建提交是不同字段，不能直接比较。自动安装仍需已验证目录收录。'
    : '尚无可核对的本机运行时'
  const modeLabel = integrated ? '策略整合版' : exactPolicyActive
    ? '策略模式'
    : state.policyVersion
      ? '策略包需要处理'
      : '官方模式'
  const verifiedPolicy = state.policyCompatible ? state.compatiblePolicy : null
  const needsInstall = Boolean(verifiedPolicy && state.policyVersion !== verifiedPolicy.version)
  const modeDescription = integrated
    ? '策略功能已整合在此应用中，不能通过移除扩展包切回官方版。请在概览中选择官方安装。'
    : exactPolicyActive
      ? `已验证的策略扩展 ${state.policyVersion} 已在桌面配置中启用。`
      : state.policyVersion
        ? `当前配置中的策略包为 ${state.policyVersion}，与本机签名目录匹配的版本不一致；启用时会按已验证记录安装匹配版本。`
        : verifiedPolicy
          ? `签名目录已验证策略扩展 ${verifiedPolicy.version} 与当前运行时匹配。启用操作会先备份共享数据，再校验并安装扩展，然后切换模式。`
          : '当前使用不含策略扩展包的官方 DSH 配置。签名目录没有提供与本机完全匹配的扩展版本。'
  return (
    <section className="page-stack" aria-labelledby="policy-heading">
      <div className="page-heading"><div><p className="eyebrow">配置管理</p><h2 id="policy-heading">模式与策略</h2><p className="muted">扩展安装与模式切换使用已验证签名目录；GitHub 发布列表只供查看。</p></div></div>
      <article className="card mode-card">
        <div className="mode-copy"><p className="eyebrow">当前模式</p><h3>{modeLabel}</h3><p className="muted">{modeDescription}</p></div>
        <div className="mode-actions">
          <button className={`button ${state.mode === 'official' && !integrated ? 'button--selected' : ''}`} onClick={() => onSetMode('official')} disabled={integrated || busy || !state.installed || Boolean(state.homeChoice)}>使用官方模式</button>
          <button className="button button--primary" onClick={() => onSetMode('policy')} disabled={integrated || busy || !state.installed || !verifiedPolicy || exactPolicyActive || Boolean(state.homeChoice)}>{needsInstall ? '安装并启用策略模式' : '启用策略模式'}</button>
        </div>
      </article>
      <article className="card status-card"><div><p className="eyebrow">运行时精确匹配</p><h3>兼容性检查</h3></div><CompatibilityStatus state={state} /></article>
      {knownPolicy && <article className="card detail-card"><h3>已知增强包运行时映射</h3><p className="muted">此映射用于核对版本，不代表签名安装资格。</p><div className="compatibility compatibility--warn">{mappingMessage}</div><dl>
        <div><dt>增强包版本</dt><dd>{knownPolicy.policyVersion}</dd></div>
        <div><dt>目标官方 DSH</dt><dd>{knownPolicy.dshVersion} · {knownPolicy.dshTag}</dd></div>
        <div><dt>官方源码标签提交</dt><dd>{knownPolicy.dshCommit}</dd></div>
        <div><dt>当前桌面构建提交</dt><dd>{state.installed?.runtimeCommit ?? '未知'}（不能直接与上游标签提交比较）</dd></div>
      </dl></article>}
      <article className="card detail-card"><h3>已验证策略扩展包</h3><p className="muted">只有签名目录中的精确映射授权安装与启用；GitHub 的公开附件信息不会作为安装依据。</p><dl><div><dt>包名</dt><dd>{verifiedPolicy?.package ?? state.compatiblePolicy?.package ?? '@deepseek-ai/dsh-policy-extension'}</dd></div><div><dt>匹配版本</dt><dd>{verifiedPolicy?.version ?? '没有精确匹配'}</dd></div><div><dt>匹配的 DSH 运行时</dt><dd>{verifiedPolicy?.runtimeVersion ?? state.installed?.runtimeVersion ?? '未知'}</dd></div><div><dt>已安装版本</dt><dd>{state.policyVersion ?? '未安装'}</dd></div>{verifiedPolicy?.tarballUrl && <div><dt>签名目录包摘要</dt><dd><code>{verifiedPolicy.sha256 ?? '目录未提供摘要'}</code></dd></div>}{verifiedPolicy?.size !== undefined && <div><dt>扩展包大小</dt><dd>{(verifiedPolicy.size / 1024 / 1024).toFixed(2)} MB</dd></div>}</dl></article>
    </section>
  )
}
