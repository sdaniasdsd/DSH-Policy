import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** One task-scoped immutable latest-value record. Revision zero means absent. */
export interface TaskSharedRecord {
  readonly key: string
  readonly revision: number
  readonly writer: SessionId
  readonly value: unknown
}

/** Result of waiting for one record to advance beyond an observed revision. */
export interface TaskRecordWaitResult {
  readonly timedOut: boolean
  readonly record?: TaskSharedRecord
}

/** Generic task-scoped shared records, independent of any strategy's business vocabulary. */
export interface TaskSharedRecords {
  /** Read one latest value; absence is represented by undefined. */
  read(key: string): TaskSharedRecord | undefined
  /** Read detached latest values for this task. */
  list(): readonly TaskSharedRecord[]
  /** Compare-and-set a JSON value and persist the new revision before returning; cancellation after append does not hide its receipt. */
  write(key: string, value: unknown, expectedRevision: number, signal: AbortSignal): Promise<TaskSharedRecord>
  /** Wait until a record advances, the timeout elapses, or the owning task ends. */
  wait(key: string, afterRevision: number, timeoutMs: number, signal: AbortSignal): Promise<TaskRecordWaitResult>
}

/** Sender-preserving message channel to an active member of the same task. */
export interface TaskMemberMessageChannel {
  /** Deliver text to a currently active member; cancellation stops unaccepted delivery, and acceptance returns its receipt. */
  send(sessionId: SessionId, text: string, signal: AbortSignal): Promise<{ readonly messageId: MessageId }>
}

/** DSH-owned coordination capabilities scoped to the original task Job. */
export interface TaskCoordination {
  readonly records: TaskSharedRecords
  readonly messages: TaskMemberMessageChannel
}
