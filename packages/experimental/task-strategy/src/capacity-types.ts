/** Pure capacity vocabulary shared by host admission and client-visible state. */

/** The scarce resource one admission needs; a subagent slot is the only observable one. */
export type CapacityResource = 'subagent'

/** One child admission's capacity facts, reported while waiting and when its wait ends. */
export type CapacityObservation =
  | {
    readonly kind: 'waiting'
    readonly resource: CapacityResource
    readonly code: string
    /** Milliseconds already spent waiting for this admission. */
    readonly waitedMs: number
    /** Delay before the next admission attempt. */
    readonly retryMs: number
  }
  | { readonly kind: 'admitted'; readonly resource: CapacityResource; readonly code: string; readonly waitedMs: number }
  | { readonly kind: 'exhausted'; readonly resource: CapacityResource; readonly code: string; readonly waitedMs: number }

/** Deployment bounds for waiting on an exhausted admission resource. */
export interface CapacityLimits {
  /** Longest total wait for one admission; zero reports the rejection without waiting. */
  readonly waitMs: number
  /** Delay between admission attempts while waiting. */
  readonly retryMs: number
}
