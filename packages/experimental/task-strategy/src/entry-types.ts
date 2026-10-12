/** Root intake facts shared with the optional conversation contribution. */
import type { UserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TaskReceipt, TaskRunView } from './runtime-types.ts'
import type { StrategyTokenCost, StyleTier } from './types.ts'

/** Plugin-owned orchestration mode and its registered execution policy. */
export interface OrchestrationMode {
  readonly id: string
  readonly label: string
  readonly strategy: string
  readonly defaultTier?: StyleTier
}
/** Session-local composer selection and current plugin availability; resets with the Host owner. */
export interface OrchestrationState {
  readonly selected: string
  readonly tier?: StyleTier
  readonly options: readonly { readonly id: string; readonly label: string; readonly available: boolean; readonly reason?: string }[]
}

/** Bounded routing result; no branch contains executable code. */
export type EntryRoute =
  | { readonly kind: 'chat' }
  | { readonly kind: 'clarify' }
  | { readonly kind: 'accept-proposal'; readonly requestId: string }
  | { readonly kind: 'new-task'; readonly strategy?: string | undefined }
  | { readonly kind: 'supplement' | 'status' | 'cancel'; readonly requestId?: string | undefined }
  | { readonly kind: 'switch'; readonly requestId?: string | undefined; readonly strategy: string; readonly expectedBindingEpoch: number }

/** Host-owned state, before and after an original Job accepts the request. */
export interface EntryView {
  readonly sessionId: SessionId
  readonly requestId: string
  readonly messageId: MessageId
  readonly state: 'routing' | 'selecting' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  readonly receipt?: TaskReceipt
  readonly cost?: StrategyTokenCost
  readonly progress?: string
  readonly run?: Omit<TaskRunView, 'results'> & { readonly completedTasks: number }
  /** An explicit, unaccepted suggestion; only human input or the UI can accept it. */
  readonly proposal?: { readonly id: string; readonly task: string; readonly strategy?: string }
  readonly error?: string
}

/** One persisted input and its correlated presentation snapshot. */
export interface EntryEvent {
  readonly view: EntryView
  readonly input: UserMessage
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Original root intake input and committed routing/execution state. */
    'task-strategy/entry': EntryEvent
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Host routing attribution; readers preserve the content without this producer.
     * The producer uses the kind to avoid treating its outcome as human input.
     * @persistenceAttribution
     */
    'task-strategy-entry': { readonly kind: 'task-strategy-entry' }
  }
}
