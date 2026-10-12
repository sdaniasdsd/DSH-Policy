/** Task-owned local sessions and actual accepted-turn feedback. */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { ChildResult, TaskStep } from './types.ts'

/** Session identity survives a turn; phase describes observation, not business acceptance. */
export interface TaskMemberSessionView {
  readonly sessionId: SessionId
  readonly label: string
  readonly phase: 'running' | 'settled' | 'unobserved' | 'closed'
}

/** A captured failure/cancellation is settled; missing capture is unobserved. */
export type TaskMemberTurnOutcome = {
  readonly kind: 'settled'
  readonly sessionId: SessionId
  readonly messageId: MessageId
  readonly result: ChildResult
} | {
  readonly kind: 'unobserved'
  readonly sessionId: SessionId
  readonly messageId: MessageId
  readonly error: string
}

/** Local DSH session capability supplied only to the owning execution adapter. */
export interface TaskMemberSessions {
  /** Open an admitted local preset member; returns after exact activation cleanup. */
  open(step: TaskStep, prompt: string, signal: AbortSignal): Promise<TaskMemberTurnOutcome>
  /** Continue one owned non-executing member explicitly; never replaces its session. */
  continue(sessionId: SessionId, text: string, signal: AbortSignal): Promise<TaskMemberTurnOutcome>
  /** Return detached identities and observed phases. */
  inspect(): readonly TaskMemberSessionView[]
  /** Close admission and drain all operations, including unpublished activations. */
  close(): Promise<void>
}
