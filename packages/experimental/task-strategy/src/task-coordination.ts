/** Task-owned durable shared records and sender-preserving messages. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { appendPluginRecord, pluginRecordOf, type SessionId } from '@deepseek-ai/dsh-session'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { TaskMemberView } from './runtime-types.ts'
import type { TaskCoordination, TaskRecordWaitResult, TaskSharedRecord } from './coordination-types.ts'

const RECORD_TYPE = 'plugin:task-strategy/shared-record' as const

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Versioned task-scoped coordination value, appended to the exact task owner's Session. */
    'plugin:task-strategy/shared-record': {
      readonly version: 1
      readonly jobId: string
      readonly key: string
      readonly revision: number
      readonly writer: SessionId
      readonly value: unknown
    }
  }
}

interface StoredRecord {
  readonly version: 1
  readonly jobId: string
  readonly key: string
  readonly revision: number
  readonly writer: SessionId
  readonly value: unknown
}

interface Waiter {
  readonly key: string
  readonly afterRevision: number
  readonly resolve: (result: TaskRecordWaitResult) => void
  readonly reject: (error: unknown) => void
  readonly signal: AbortSignal
  readonly abort: () => void
  readonly timer: ReturnType<typeof setTimeout>
}

function validRecord(value: unknown, jobId: JobId, ownerSessionId: SessionId): value is StoredRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Partial<StoredRecord>
  return row.version === 1 && row.jobId === jobId && typeof row.key === 'string' && row.key.trim().length > 0
    && Number.isSafeInteger(row.revision) && Number(row.revision) > 0
    && row.writer === ownerSessionId && typeof row.value !== 'undefined'
}

function copyValue(value: unknown, maxBytes: number): unknown {
  let encoded: string | undefined
  let snapshot: unknown
  try {
    snapshot = structuredClone(value)
    encoded = JSON.stringify(snapshot)
  }
  catch { throw new Error('Shared record value must be JSON serializable') }
  if (encoded === undefined) throw new Error('Shared record value must be JSON serializable')
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new Error(`Shared record exceeds maxPlanBytes limit ${maxBytes}`)
  return snapshot
}

/** Create one coordination facade shared by every executor call of an accepted task. */
export function createTaskCoordination(options: {
  readonly ctx: Context
  readonly parent: Agent
  readonly jobId: JobId
  readonly activeMembers: Map<SessionId, TaskMemberView>
  readonly maxRecordBytes: number
  readonly signal: AbortSignal
  readonly assertOwner: () => void
}): TaskCoordination {
  const { ctx, parent, jobId, activeMembers, maxRecordBytes, signal, assertOwner } = options
  const session = parent.session
  const waiters = new Set<Waiter>()
  const tails = new Map<string, Promise<void>>()
  let closed = false

  const current = (): void => {
    signal.throwIfAborted()
    if (closed) throw new Error('Task coordination is closed')
    assertOwner()
    if (ctx.sessions.get(session.id) !== session) throw new Error('Task owner Session is no longer live')
  }

  const scan = (): Map<string, TaskSharedRecord> => {
    current()
    const latest = new Map<string, TaskSharedRecord>()
    for (const event of session.ownEvents()) {
      const pluginRecord = pluginRecordOf(event)
      if (pluginRecord?.type !== RECORD_TYPE) continue
      const data = pluginRecord.data
      if (typeof data !== 'object' || data === null || (data as { jobId?: unknown }).jobId !== jobId) continue
      if (!validRecord(data, jobId, session.id)) throw new Error('Task shared record is malformed or belongs to another writer')
      const row = data
      const prior = latest.get(row.key)
      if (prior !== undefined && row.revision <= prior.revision) {
        throw new Error(`Shared record revision is invalid for ${row.key}`)
      }
      if (prior !== undefined && row.revision !== prior.revision + 1) {
        throw new Error(`Shared record revision has a gap for ${row.key}`)
      }
      latest.set(row.key, { key: row.key, revision: row.revision, writer: row.writer,
        value: structuredClone(row.value) })
    }
    return latest
  }

  const wake = (record: TaskSharedRecord): void => {
    for (const waiter of [...waiters]) {
      if (waiter.key === record.key && record.revision > waiter.afterRevision) {
        waiters.delete(waiter)
        clearTimeout(waiter.timer)
        waiter.signal.removeEventListener('abort', waiter.abort)
        waiter.resolve({ timedOut: false, record: structuredClone(record) })
      }
    }
  }

  signal.addEventListener('abort', () => {
    closed = true
    for (const waiter of [...waiters]) waiter.abort()
    waiters.clear()
  }, { once: true })

  return {
    records: {
      read(key) {
        if (!key.trim()) throw new Error('Shared record key must not be empty')
        const record = scan().get(key)
        return record === undefined ? undefined : structuredClone(record)
      },
      list() { return [...scan().values()].map(record => structuredClone(record)) },
      async write(key, value, expectedRevision, writeSignal) {
        if (!key.trim()) throw new Error('Shared record key must not be empty')
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new Error('Expected revision must be a nonnegative safe integer')
        }
        const priorTail = tails.get(key) ?? Promise.resolve()
        let settle!: () => void
        const gate = new Promise<void>((resolve) => { settle = resolve })
        const tail = priorTail.then(() => gate, () => gate)
        tails.set(key, tail)
        await priorTail
        try {
          const operationSignal = AbortSignal.any([signal, writeSignal])
          operationSignal.throwIfAborted()
          current()
          const prior = scan().get(key)
          const revision = prior?.revision ?? 0
          if (revision !== expectedRevision) throw new Error(`Shared record revision conflict for ${key}: expected ${expectedRevision}, current ${revision}`)
          const snapshot = copyValue(value, maxRecordBytes)
          const persistence = ctx.get('sessionPersistence')
          if (persistence === undefined) throw new Error('Task shared records require Session persistence')
          const persistenceIdentity = persistence.identity
          const liveSession = ctx.sessions.get(session.id)
          if (liveSession !== session) throw new Error('Task owner Session is no longer live')
          const row: StoredRecord = { version: 1, jobId, key, revision: revision + 1, writer: session.id, value: snapshot }
          const seq = appendPluginRecord(session, RECORD_TYPE, row)
          await ctx.sessions.flush(session)
          operationSignal.throwIfAborted()
          current()
          if (ctx.get('sessionPersistence')?.identity !== persistenceIdentity) throw new Error('Session persistence changed during shared-record write')
          await using handle = await persistence.open(session.id, 'read', { signal: operationSignal })
          const storedEvents = await handle.read(seq, 1, { signal: operationSignal })
          const stored = storedEvents.events[0] === undefined ? undefined : pluginRecordOf(storedEvents.events[0])
          if (stored?.type !== RECORD_TYPE || JSON.stringify(stored.data) !== JSON.stringify(row)) {
            throw new Error('Task shared record could not be observed after persistence flush')
          }
          const result: TaskSharedRecord = { key, revision: row.revision, writer: row.writer, value: structuredClone(snapshot) }
          wake(result)
          return structuredClone(result)
        } finally {
          settle()
          if (tails.get(key) === tail) tails.delete(key)
        }
      },
      wait(key, afterRevision, timeoutMs, waitSignal) {
        if (!key.trim()) return Promise.reject(new Error('Shared record key must not be empty'))
        if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) return Promise.reject(new Error('Observed revision must be nonnegative'))
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) return Promise.reject(new Error('Wait timeout must be bounded'))
        const waitController = AbortSignal.any([signal, waitSignal])
        waitController.throwIfAborted()
        const record = scan().get(key)
        if (record !== undefined && record.revision > afterRevision) {
          return Promise.resolve({ timedOut: false, record: structuredClone(record) })
        }
        return new Promise<TaskRecordWaitResult>((resolve, reject) => {
          const abort = () => {
            waiters.delete(waiter)
            clearTimeout(waiter.timer)
            reject(waitController.reason ?? new Error('Task record wait cancelled'))
          }
          const timer = setTimeout(() => {
            waiters.delete(waiter)
            waitController.removeEventListener('abort', abort)
            resolve({ timedOut: true })
          }, timeoutMs)
          const waiter: Waiter = { key, afterRevision, resolve, reject, signal: waitController, abort, timer }
          waiters.add(waiter)
          waitController.addEventListener('abort', abort, { once: true })
        })
      },
    },
    messages: {
      async send(sessionId, text, messageSignal) {
        if (!text.trim()) throw new Error('Task message text must not be empty')
        const deliverySignal = AbortSignal.any([signal, messageSignal])
        deliverySignal.throwIfAborted()
        current()
        if (!activeMembers.has(sessionId)) throw new Error('Target is not an active member of this task')
        if (Buffer.byteLength(JSON.stringify({ sessionId, text }), 'utf8') > maxRecordBytes) {
          throw new Error(`Task message exceeds maxPlanBytes limit ${maxRecordBytes}`)
        }
        const messageId = await ctx.subagents.sendMessage(parent, sessionId, [{ type: 'text', text }], {
          signal: deliverySignal, activeOnly: true,
        })
        current()
        return { messageId }
      },
    },
  }
}
