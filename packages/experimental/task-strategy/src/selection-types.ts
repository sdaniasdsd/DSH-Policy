/** Intake choices and bounds, shared by the host contract and configuration. */
import type { StrategyInput, StrategyTokenCost, StyleTier } from './types.ts'

/** Automatic choice uses one bounded model call; named choice bypasses it. */
export type TaskSelection = { readonly kind: 'auto'; readonly workflow?: boolean } | { readonly kind: 'named'; readonly strategy: string }

/** Captured catalogue with task-specific costs for supported budget tiers. */
export interface WorkflowCandidate {
  readonly id: string
  readonly description: string
  readonly cost?: StrategyTokenCost
  readonly tiers?: readonly { readonly tier: StyleTier; readonly cost?: StrategyTokenCost | undefined }[]
}

/** One bounded Agent decision, retained in the task receipt. */
export interface WorkflowDecision {
  readonly strategy: string
  readonly tier?: StyleTier
  readonly reason: string
}

/** Original request identity is retained even when the default choice changes. */
export interface TaskIntakeRequest extends StrategyInput {
  readonly requestId: string
  readonly selection?: TaskSelection
}

/** Limits belong only to selection; execution retains its separate limits. */
export interface SelectorOptions {
  readonly timeoutMs: number
  readonly maxPromptBytes: number
  readonly maxOutputBytes: number
  readonly maxTokens: number
  readonly model?: string
  readonly provider?: string
}

/** User-editable defaults for later task intake. */
export interface SelectionConfig extends SelectorOptions {
  readonly default: TaskSelection
  /** Optional registered fallback for autonomous intake only; style fallback uses medium. */
  readonly fallbackStrategy?: string
}
