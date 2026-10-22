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
    ? 'Policy mode'
    : state.policyVersion
      ? 'Policy package needs attention'
      : 'Official mode'
  return (
    <section className="page-stack" aria-labelledby="home-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">DSH CONTROL CENTER</p>
          <h2 id="home-heading">Your DSH setup</h2>
          <p className="muted">Manage the official desktop app and its compatible Policy profile.</p>
        </div>
        <button className="button button--primary" onClick={onLaunch} disabled={!state.installed || Boolean(state.homeChoice)}>
          Launch DSH
        </button>
      </div>

      {homeChoice && (
        <section className="card home-choice" aria-labelledby="home-choice-heading">
          <div>
            <p className="eyebrow">TWO DATA HOMES FOUND</p>
            <h3 id="home-choice-heading">Choose the Harness home to use</h3>
            <p className="muted">The manager keeps the selected home shared across official and Policy modes.</p>
          </div>
          <button className="button" onClick={() => onChooseHome(homeChoice.standard)}>Use standard home<span>{homeChoice.standard}</span></button>
          <button className="button" onClick={() => onChooseHome(homeChoice.policy)}>Use Policy home<span>{homeChoice.policy}</span></button>
        </section>
      )}

      <div className="summary-grid">
        <article className="card summary-card">
          <span className="card-label">Desktop version</span>
          <strong>{state.installed?.desktopVersion ?? 'Not installed'}</strong>
          <span className="muted">Official DeepSeek Harness</span>
        </article>
        <article className="card summary-card">
          <span className="card-label">Bundled DSH runtime</span>
          <strong>{state.installed?.runtimeVersion ?? 'Unknown'}</strong>
          <span className="muted">{state.installed?.runtimeCommit ? `Commit ${state.installed.runtimeCommit.slice(0, 10)}` : 'Runtime identity unavailable'}</span>
        </article>
        <article className="card summary-card">
          <span className="card-label">Current mode</span>
          <strong>{modeLabel}</strong>
          <span className="muted">{state.policyVersion ? `Policy ${state.policyVersion}` : 'Official DSH profile'}</span>
        </article>
      </div>

      <article className="card status-card">
        <div>
          <p className="eyebrow">COMPATIBILITY</p>
          <h3>Policy release status</h3>
        </div>
        <CompatibilityStatus state={state} />
      </article>

      <article className="card path-card">
        <div>
          <p className="eyebrow">SHARED DATA HOME</p>
          <h3>{state.home ?? 'Choose a home to continue'}</h3>
          <p className="muted">Sessions, settings, credentials and desktop profile stay in this location.</p>
        </div>
        <span className="path-mark" aria-hidden="true">⌂</span>
      </article>
    </section>
  )
}
