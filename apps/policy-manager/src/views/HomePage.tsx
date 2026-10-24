import type { ManagerSnapshot } from '../manager-types'
import { CompatibilityStatus } from '../components/CompatibilityStatus'

interface HomePageProps {
  state: ManagerSnapshot
  onLaunch: () => void
  onChooseHome: (path: string) => void
  onSelectInstallation: (path: string) => void
  onRefresh: () => void
  onResetSelection: () => void
  busy: boolean
}

export function HomePage({ state, onLaunch, onChooseHome, onSelectInstallation, onRefresh, onResetSelection, busy }: HomePageProps) {
  const homeChoice = state.homeChoice
  const exactPolicyActive = state.mode === 'policy'
    && state.policyCompatible
    && state.policyVersion !== null
    && state.policyVersion === state.compatiblePolicy?.version
  const modeLabel = state.installationEdition === 'policy' ? '策略整合版' : !state.installed ? '未选择安装' : exactPolicyActive
    ? '策略模式'
    : state.policyVersion
      ? '策略包需要处理'
      : '官方模式'
  return (
    <section className="page-stack" aria-labelledby="home-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">DSH 控制中心</p>
          <h2 id="home-heading">DSH 环境</h2>
          <p className="muted">管理官方桌面应用及其兼容的策略配置。</p>
        </div>
        <div className="mode-actions"><button className="button" onClick={onRefresh} disabled={busy}>重新检测</button>
          <button className="button button--primary" onClick={onLaunch} disabled={busy || !state.installed || Boolean(state.homeChoice)}>
            启动 DSH
          </button></div>
      </div>

      <article className="card detail-card">
        <h3>本机安装与管理目标</h3>
        <p className="muted">自动检测官方版与策略整合版；可选择要管理和启动的安装。</p>
        {state.selectedInstallationPath && <div className="saved-selection"><div><p className="muted">已保存的管理目标{!state.installed ? '（当前不可用）' : ''}</p><code>{state.selectedInstallationPath}</code></div><button className="button" disabled={busy} onClick={onResetSelection}>恢复自动选择</button></div>}
        {state.installations.length ? <ul className="installation-list">{state.installations.map((item) => {
          const selected = item.installed.installLocation === state.installed?.installLocation
          return <li key={item.installed.installLocation}>
            <div className="installation-copy"><strong>{item.displayName}</strong><span className="muted">{item.edition === 'official' ? '官方版' : '策略整合应用'} · {item.installed.desktopVersion}</span><code>{item.installed.installLocation}</code><span className="muted">运行时 {item.installed.runtimeVersion ?? '未知'} · 提交 {item.installed.runtimeCommit ?? '无法读取'}{item.installed.buildDirty ? ' · 含未提交改动' : ''}</span></div>
            <button className={`button${selected ? ' button--selected' : ''}`} aria-label={`管理 ${item.displayName}`} disabled={busy || selected} onClick={() => onSelectInstallation(item.installed.installLocation)}>{selected ? '当前管理目标' : '选择管理'}</button>
          </li>
        })}</ul> : <p className="muted">未检测到 DSH 安装，请安装后重新检测。</p>}
      </article>

      {homeChoice && (
        <section className="card home-choice" aria-labelledby="home-choice-heading">
          <div>
            <p className="eyebrow">发现两个数据目录</p>
            <h3 id="home-choice-heading">选择要使用的 Harness 数据目录</h3>
            <p className="muted">官方模式和策略模式会共用选中的目录。</p>
          </div>
          <button className="button" onClick={() => onChooseHome(homeChoice.standard)}>使用标准目录<span>{homeChoice.standard}</span></button>
          <button className="button" onClick={() => onChooseHome(homeChoice.policy)}>使用策略版目录<span>{homeChoice.policy}</span></button>
        </section>
      )}

      <div className="summary-grid">
        <article className="card summary-card">
          <span className="card-label">桌面版版本</span>
          <strong>{state.installed?.desktopVersion ?? '未安装'}</strong>
          <span className="muted">{state.installationEdition === 'policy' ? 'DSH Policy Edition' : state.installed ? 'DeepSeek 官方 Harness' : '未检测到安装'}</span>
        </article>
        <article className="card summary-card">
          <span className="card-label">内置 DSH 运行时</span>
          <strong>{state.installed?.runtimeVersion ?? '未知'}</strong>
          <span className="muted">{state.installed?.runtimeCommit ? `提交 ${state.installed.runtimeCommit.slice(0, 10)}` : '无法读取运行时身份'}</span>
        </article>
        <article className="card summary-card">
          <span className="card-label">当前模式</span>
          <strong>{modeLabel}</strong>
          <span className="muted">{state.installationEdition === 'policy' ? '策略功能随应用整合分发' : state.policyVersion ? `策略包 ${state.policyVersion}` : '官方 DSH 配置'}</span>
        </article>
      </div>

      <article className="card status-card">
        <div>
          <p className="eyebrow">兼容性</p>
          <h3>策略版本状态</h3>
        </div>
        <CompatibilityStatus state={state} />
      </article>

      <article className="card path-card">
        <div>
          <p className="eyebrow">共享数据目录</p>
          <h3>{state.home ?? '请选择数据目录以继续'}</h3>
          <p className="muted">会话、设置、凭据和桌面配置都保存在此目录。</p>
        </div>
        <span className="path-mark" aria-hidden="true">⌂</span>
      </article>
    </section>
  )
}
