import type { ManagerSnapshot } from '../manager-types'
import { CompatibilityStatus } from '../components/CompatibilityStatus'

interface HomePageProps {
  state: ManagerSnapshot
  onLaunch: () => void
  onChooseHome: (path: string) => void
}

export function HomePage({ state, onLaunch, onChooseHome }: HomePageProps) {
  const homeChoice = state.homeChoice
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
    <section className="page-stack" aria-labelledby="home-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">DSH 控制中心</p>
          <h2 id="home-heading">DSH 环境</h2>
          <p className="muted">管理官方桌面应用及其兼容的策略配置。</p>
        </div>
        <button className="button button--primary" onClick={onLaunch} disabled={!state.installed || Boolean(state.homeChoice)}>
          启动 DSH
        </button>
      </div>

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
          <span className="muted">DeepSeek 官方 Harness</span>
        </article>
        <article className="card summary-card">
          <span className="card-label">内置 DSH 运行时</span>
          <strong>{state.installed?.runtimeVersion ?? '未知'}</strong>
          <span className="muted">{state.installed?.runtimeCommit ? `提交 ${state.installed.runtimeCommit.slice(0, 10)}` : '无法读取运行时身份'}</span>
        </article>
        <article className="card summary-card">
          <span className="card-label">当前模式</span>
          <strong>{modeLabel}</strong>
          <span className="muted">{state.policyVersion ? `策略包 ${state.policyVersion}` : '官方 DSH 配置'}</span>
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
