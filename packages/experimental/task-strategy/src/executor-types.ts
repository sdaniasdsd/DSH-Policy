/** Host execution adapters contribute child work while original Jobs own task state. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ChildResult, TaskStep } from './types.ts'
import type { TaskMemberSessions } from './member-session-types.ts'

/** Optional execution capabilities owned by this adapter call and the original task. */
export interface TaskExecutorContext {
  readonly members: TaskMemberSessions
}

/** External adapter contributes execution and synchronous backend availability checks. */
export interface TaskExecutorProvider {
  readonly id: string
  readonly description: string
  /** Throws before admission when the configured backend is unavailable. */
  readonly check: () => void
  /** Resolves only after releasing children; signal is the original task cancellation. */
  readonly execute: (parent: Agent, step: TaskStep, prompt: string, signal: AbortSignal,
    context?: TaskExecutorContext) => Promise<ChildResult>
}
