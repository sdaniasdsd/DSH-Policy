/** Synchronous policy decisions over detached, settled task state. */
import type { CapacityResource } from './capacity-types.ts'
import type { ExecutionPlan, TaskResult } from './types.ts'

/** Capacity facts the runtime accumulated for this run; a policy cannot manufacture one. */
export type PolicySignal = {
  readonly kind: 'capacity'
  readonly resource: CapacityResource
  readonly code: string
  /** Child admissions that had to wait for this resource. */
  readonly waits: number
  /** Total milliseconds spent waiting for this resource. */
  readonly waitedMs: number
  /** True once a capacity wait ended without admitting a child. */
  readonly exhausted: boolean
}

/** A policy sees cumulative results and host-observed signals, never mutable runtime or Agent services. */
export interface PolicySnapshot {
  readonly nextStage: number
  readonly completedStages: number
  readonly remainingTasks: number
  readonly bindingEpoch: number
  readonly results: readonly TaskResult[]
  /** Results from the current binding only; prior binding evidence remains in results for handoff. */
  readonly currentResults: readonly TaskResult[]
  /** Signals observed so far in this run, in observation order. */
  readonly signals: readonly PolicySignal[]
}

/** Only the task runtime admits work, terminates execution or owns waiting. */
export type StageDecision =
  | { readonly kind: 'stage'; readonly stage: ExecutionPlan['stages'][number] }
  | { readonly kind: 'finish'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly reason: string }

/** Trusted finite synchronous decision; model requests belong to ordinary task steps. */
export type StagePolicy = (snapshot: PolicySnapshot) => StageDecision
