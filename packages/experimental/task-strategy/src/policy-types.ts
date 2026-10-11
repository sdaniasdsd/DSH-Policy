/** Synchronous policy decisions over detached, settled task state. */
import type { ExecutionPlan, TaskResult } from './types.ts'

/** A policy sees cumulative results, never mutable runtime or Agent services. */
export interface PolicySnapshot {
  readonly nextStage: number
  readonly completedStages: number
  readonly remainingTasks: number
  readonly bindingEpoch: number
  readonly results: readonly TaskResult[]
  /** Results from the current binding only; prior binding evidence remains in results for handoff. */
  readonly currentResults: readonly TaskResult[]
}

/** Only the task runtime admits work, terminates execution or owns waiting. */
export type StageDecision =
  | { readonly kind: 'stage'; readonly stage: ExecutionPlan['stages'][number] }
  | { readonly kind: 'finish'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly reason: string }

/** Trusted finite synchronous decision; model requests belong to ordinary task steps. */
export type StagePolicy = (snapshot: PolicySnapshot) => StageDecision
