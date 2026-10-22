import type { ManagerSnapshot } from '../manager-types'

export function CompatibilityStatus({ state }: { state: ManagerSnapshot }) {
  if (!state.installed) {
    return <div className="compatibility compatibility--muted">Official DSH Desktop is not detected.</div>
  }
  if (state.policyCompatible && state.compatiblePolicy) {
    return <div className="compatibility compatibility--good">Policy {state.compatiblePolicy.version} is compatible</div>
  }
  return <div className="compatibility compatibility--warn">{state.unavailableReason ?? 'This DSH runtime has no exact Policy compatibility entry.'}</div>
}
