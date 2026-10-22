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
    ? 'Policy mode'
    : state.policyVersion
      ? 'Policy package needs attention'
      : 'Official mode'
  return (
    <section className="page-stack" aria-labelledby="policy-heading">
      <div className="page-heading"><div><p className="eyebrow">PROFILE CONTROL</p><h2 id="policy-heading">Mode and Policy</h2><p className="muted">The manager uses DSH's desktop profile CLI to switch the Policy Bundle.</p></div></div>
      <article className="card mode-card">
        <div className="mode-copy"><p className="eyebrow">CURRENT MODE</p><h3>{modeLabel}</h3><p className="muted">{exactPolicyActive ? `Policy ${state.policyVersion} is active in the desktop profile.` : state.policyVersion ? `Policy ${state.policyVersion} is installed, but it does not match the exact runtime mapping.` : 'The official DSH profile is active without the Policy Bundle.'}</p></div>
        <div className="mode-actions">
          <button className={`button ${state.mode === 'official' ? 'button--selected' : ''}`} onClick={() => onSetMode('official')} disabled={busy || !state.installed}>Use official mode</button>
          <button className="button button--primary" onClick={() => onSetMode('policy')} disabled={busy || !state.installed || !state.policyCompatible || exactPolicyActive}>Enable Policy mode</button>
        </div>
      </article>
      <article className="card status-card"><div><p className="eyebrow">EXACT RUNTIME MATCH</p><h3>Compatibility check</h3></div><CompatibilityStatus state={state} /></article>
      <article className="card detail-card"><h3>Policy package</h3><dl><div><dt>Package</dt><dd>@deepseek-ai/dsh-policy-extension</dd></div><div><dt>Compatible version</dt><dd>{state.compatiblePolicy?.version ?? 'Unavailable'}</dd></div><div><dt>Matched DSH runtime</dt><dd>{state.compatiblePolicy?.runtimeVersion ?? state.installed?.runtimeVersion ?? 'Unknown'}</dd></div><div><dt>Installed version</dt><dd>{state.policyVersion ?? 'Not installed'}</dd></div></dl></article>
    </section>
  )
}
