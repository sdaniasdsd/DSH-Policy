/** One reservation per human message, held by the original Jobs/Agent lifetime. */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type { TaskCommandOutcome, TaskSwitch } from './runtime-types.ts'
import type { EntryRoute, EntryView } from './entry-types.ts'
import type { SelectorOptions } from './selection-types.ts'
import type TaskStrategies from './cordis.ts'
import { ownerRuns } from './task-submissions.ts'
import { routeEntry } from './entry-router.ts'
import { errorText } from './errors.ts'

/** Process-local reservation; persisted snapshots never automatically resume work. */
export interface EntryRecord {
  readonly input: UserMessage
  readonly digest: string
  readonly controller: AbortController
  readonly supplements: string[]
  readonly context: string
  readonly orchestration: () => string | undefined
  readonly preferences: Readonly<Record<string, string>>
  proposalAccepted?: boolean
  cancelRequested: boolean
  view: EntryView
  operation: Promise<EntryView>
}

/** Coordinator captures deployment callbacks; accepted jobs retain original ownership. */
export class EntryCoordinator {
  constructor(private readonly ctx: Context, private readonly service: TaskStrategies,
    private readonly options: () => SelectorOptions, private readonly provider: string) {
    ctx.effect(() => ctx.jobs.events.subscribe({ owners: 'all' }, (event) => {
      const owner = event.type === 'output' ? event.owner : event.job.owner
      const id = event.type === 'output' ? event.id : event.job.id
      if (owner === undefined) return
      const parent = ctx.agents.get(owner)
      if (parent === undefined) return
      for (const record of ownerRuns(ctx.jobs, parent).entries.values()) {
        if (record.view.receipt?.jobId === id) this.refresh(parent, record)
      }
    }))
    ctx.effect(() => async () => {
      const operations: Promise<EntryView>[] = []
      for (const parent of ctx.agents.list()) for (const record of ownerRuns(ctx.jobs, parent).entries.values()) {
        if (record.view.state === 'routing' || record.view.state === 'selecting') {
          record.controller.abort(new Error('Task entry is closing')); operations.push(record.operation)
        }
      }
      await Promise.allSettled(operations)
    }, 'task entry admission')
  }

  private publish(parent: Agent, record: EntryRecord): void {
    if (this.ctx.agents.get(parent.id) === undefined) return
    parent.session.append('task-strategy/entry', { view: structuredClone(record.view), input: record.input })
  }

  private refresh(parent: Agent, record: EntryRecord): void {
    const receipt = record.view.receipt
    if (receipt === undefined) return
    const job = this.ctx.jobs.get(receipt.jobId, parent.id)
    const { results, ...snapshot } = this.service.inspect(parent, receipt.jobId)
    const run = { ...snapshot, completedTasks: results.length }
    const state = job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed'
      : job.status === 'killed' ? 'cancelled' : run.phase === 'waiting' ? 'waiting' : 'running'
    const { error: previousError, ...previous } = record.view
    void previousError
    const view: EntryView = { ...previous, state, run, ...job.progress === undefined ? {} : { progress: job.progress },
      ...run.error === undefined ? {} : { error: run.error } }
    if (JSON.stringify(view) !== JSON.stringify(record.view)) { record.view = view; this.publish(parent, record) }
  }

  /**
   * Read owned current intake and execution snapshots.
   * @param parent - exact live task owner.
   * @returns detached entry state for this owner.
   */
  views(parent: Agent): EntryView[] {
    const records = [...ownerRuns(this.ctx.jobs, parent).entries.values()]
    for (const record of records) this.refresh(parent, record)
    return records.map(record => structuredClone(record.view))
  }

  /**
   * Register a suggestion without dispatching work; equal IDs are idempotent.
   * @param parent - exact live root owner.
   * @param proposalId - stable suggestion ID, scoped to this owner.
   * @param task - proposed task shown to the user.
   * @param strategy - optional visible named choice.
   * @returns detached logged proposal view.
   */
  propose(parent: Agent, proposalId: string, task: string, strategy?: string): EntryView {
    if (!proposalId.trim() || !task.trim()) throw new Error('Proposal ID and task must not be empty')
    if (Buffer.byteLength(JSON.stringify({ proposalId, task, strategy }), 'utf8') > this.options().maxPromptBytes) throw new Error('Proposal exceeds input byte limit')
    if (strategy !== undefined && !this.service.list().some(row => row.id === strategy)) throw new Error('Proposal strategy is unavailable')
    const requestId = `proposal:${proposalId}`
    const store = ownerRuns(this.ctx.jobs, parent)
    const previous = [...store.entries.values()].find(row => row.view.requestId === requestId)
    const proposal = { id: proposalId, task, ...strategy === undefined ? {} : { strategy } }
    if (previous !== undefined) {
      if (JSON.stringify(previous.view.proposal) !== JSON.stringify(proposal)) throw new Error('Proposal ID conflicts with its original payload')
      return structuredClone(previous.view)
    }
    const input = createUserMessage({ source: { kind: 'task-strategy-entry' }, content: [{ type: 'text', text: task }] })
    const view: EntryView = { sessionId: parent.id, messageId: input.id, requestId, state: 'waiting', proposal }
    const record: EntryRecord = { input, view, digest: '', controller: new AbortController(), supplements: [], cancelRequested: false,
      context: this.conversation(parent, input),
      orchestration: strategy === undefined ? this.service.captureOrchestration(parent) : () => strategy,
      preferences: this.service.captureOrchestrationPreferences(parent), operation: Promise.resolve(view) }
    store.entries.set(input.id, record); this.publish(parent, record)
    return structuredClone(view)
  }

  /**
   * Accept a human-selected proposal once; no model-visible tool calls this operation.
   * @param parent - exact live root owner.
   * @param proposalId - pending owned suggestion ID.
   * @returns retained operation with acceptance or explicit failure.
   */
  approve(parent: Agent, proposalId: string): Promise<EntryView> {
    const record = [...ownerRuns(this.ctx.jobs, parent).entries.values()].find(row => row.view.proposal?.id === proposalId)
    if (record === undefined) return Promise.reject(new Error('Proposal is not owned by this session'))
    if (record.proposalAccepted) return record.operation
    if (record.view.state !== 'waiting' || record.controller.signal.aborted) return Promise.reject(new Error('Proposal is no longer pending'))
    record.proposalAccepted = true
    record.view = { ...record.view, state: 'selecting' }; this.publish(parent, record)
    record.operation = Promise.resolve().then(async () => {
      const release = parent.ctx.effect(() => () => { record.controller.abort(new Error('Proposal owner was disposed')) })
      try { await this.apply(parent, record, { kind: 'new-task', ...record.view.proposal?.strategy === undefined ? {} : { strategy: record.view.proposal.strategy } }, record.controller.signal) }
      catch (error) { record.view = { ...record.view, state: record.controller.signal.aborted ? 'cancelled' : 'failed', error: errorText(error) } }
      finally { await release() }
      this.publish(parent, record); return structuredClone(record.view)
    })
    return record.operation
  }

  /**
   * Reserve before model routing; equal duplicates share the same operation.
   * @param parent - exact live task owner.
   * @param message - original human input with stable identity.
   * @param signal - admission cancellation.
   * @returns retained entry view after routing and admission settle.
   */
  accept(parent: Agent, message: UserMessage, signal: AbortSignal): Promise<EntryView> {
    const store = ownerRuns(this.ctx.jobs, parent)
    const digest = createHash('sha256').update(JSON.stringify(message)).digest('hex')
    const previous = store.entries.get(message.id)
    if (previous !== undefined) {
      if (previous.digest !== digest) return Promise.reject(new Error('Task entry message identity conflicts with its original input'))
      return previous.operation
    }
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    const record: EntryRecord = {
      input: structuredClone(message), digest, controller, supplements: [], cancelRequested: false,
      context: this.conversation(parent, message),
      orchestration: this.service.captureOrchestration(parent),
      preferences: this.service.captureOrchestrationPreferences(parent),
      view: { sessionId: parent.id, requestId: `message:${message.id}`, messageId: message.id, state: 'routing' },
      operation: Promise.resolve().then(async () => {
        this.publish(parent, record)
        const releaseOwner = parent.ctx.effect(() => () => { controller.abort(new Error('Task entry owner was disposed')) })
        try {
          const views = this.views(parent).filter(view => view.messageId !== message.id && view.receipt !== undefined)
          const active = views.filter(view => ['running', 'waiting', 'selecting'].includes(view.state))
          const latest = views.findLast(view => ['completed', 'failed', 'cancelled'].includes(view.state))
          const tasks = [...active, ...latest === undefined ? [] : [latest]].map(view => ({ ...view,
            task: store.entries.get(view.messageId)?.input.content.filter(block => block.type === 'text').map(block => block.text).join('\n') }))
          const pending = [...store.entries.values()].filter(row => row.view.proposal !== undefined && row.view.state === 'waiting' && !row.proposalAccepted)
          const text = message.content.length === 1 && message.content[0]?.type === 'text' ? message.content[0].text.trim() : ''
          const shortAccept = /^(跑吧|开始吧|执行吧|继续|go ahead|proceed)[。.!！]?$/i.test(text)
          const exact = pending.find(row => text === `接受 ${row.view.proposal?.id}`)
          const singlePending = pending.length === 1 ? pending[0] : undefined
          const route: EntryRoute = exact !== undefined ? { kind: 'accept-proposal', requestId: exact.view.requestId }
            : shortAccept && pending.length > 0 ? singlePending !== undefined && active.length === 0
              ? { kind: 'accept-proposal', requestId: singlePending.view.requestId } : { kind: 'clarify' }
              : await routeEntry(parent, message, tasks, this.options(), this.ctx.subagents, this.provider, combined, record.context)
          combined.throwIfAborted()
          await this.apply(parent, record, route, combined)
        } catch (error) {
          record.view = { ...record.view, state: combined.aborted ? 'cancelled' : 'failed', error: errorText(error) }
        } finally { await releaseOwner() }
        this.publish(parent, record)
        return structuredClone(record.view)
      }),
    }
    store.entries.set(message.id, record)
    return record.operation
  }

  private conversation(parent: Agent, message: UserMessage): string {
    const history = parent.session.deriveMessages().filter(item => item.id !== message.id
      && (item.role === 'assistant' || item.role === 'user' && item.source.kind === 'user'))
    const limit = Math.floor(this.options().maxPromptBytes / 4)
    const recent: { role: string; text: string }[] = []
    for (const item of history.slice(-24).reverse()) {
      const text = item.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
      if (!text) continue
      const candidate = { role: item.role, text }
      if (Buffer.byteLength(JSON.stringify([candidate, ...recent]), 'utf8') > limit) break
      recent.unshift(candidate)
    }
    return JSON.stringify({ messages: recent, omitted: recent.length < history.filter(item => item.content.some(block => block.type === 'text')).length })
  }

  private target(parent: Agent, requestId?: string, readTerminal = false): EntryRecord {
    const records = [...ownerRuns(this.ctx.jobs, parent).entries.values()].filter(record => record.view.receipt !== undefined)
    const matches = requestId === undefined ? records.filter(record => ['running', 'waiting'].includes(record.view.state))
      : records.filter(record => record.view.requestId === requestId)
    if (requestId === undefined && readTerminal && matches.length === 0) {
      const latest = records.findLast(record => ['completed', 'failed', 'cancelled'].includes(record.view.state))
      if (latest !== undefined) return latest
    }
    const match = matches[0]
    if (matches.length !== 1 || match === undefined) throw new Error('Specify exactly one current owned task')
    return match
  }

  private async apply(parent: Agent, record: EntryRecord, route: EntryRoute, signal: AbortSignal): Promise<void> {
    if (route.kind === 'accept-proposal') {
      const proposal = [...ownerRuns(this.ctx.jobs, parent).entries.values()]
        .find(row => row.view.requestId === route.requestId)?.view.proposal
      if (proposal === undefined) throw new Error('Proposal reference is unavailable')
      const accepted = await this.approve(parent, proposal.id)
      record.view = { ...record.view, state: accepted.state === 'failed' || accepted.state === 'cancelled' ? accepted.state : 'completed',
        progress: `Associated with ${accepted.requestId}`, ...accepted.error === undefined ? {} : { error: accepted.error } }
      return
    }
    if (route.kind === 'new-task') {
      if (record.input.content.some(block => block.type !== 'text')) throw new Error('Task strategy execution currently requires text input; attachments were retained but were not dispatched')
      const task = record.input.content.map(block => block.type === 'text' ? block.text : '').join('\n')
        + '\n\nPrior conversation (context data, original input above; if necessary information was omitted, ask for clarification):\n' + record.context
      record.view = { ...record.view, state: 'selecting' }; this.publish(parent, record)
      const strategy = record.orchestration() ?? route.strategy
      const receipt = await this.service.submitTask(parent, { requestId: record.view.requestId, task,
        preferences: record.preferences,
        ...strategy !== undefined ? { selection: { kind: 'named', strategy } }
          : record.preferences.automation === 'auto' ? { selection: { kind: 'auto', workflow: true } } : {} }, signal)
      const cost = this.service.list({ task, preferences: { ...record.preferences,
        ...receipt.selection?.tier === undefined ? {} : { tier: receipt.selection.tier } } })
        .find(entry => entry.id === receipt.strategy)?.cost
      record.view = { ...record.view, state: 'running', receipt, ...cost === undefined ? {} : { cost } }
      if (record.cancelRequested || signal.aborted) this.ctx.jobs.kill(receipt.jobId, parent.id, 'task entry cancelled during acceptance')
      this.refresh(parent, record)
      return
    }
    if (route.kind === 'chat' || route.kind === 'clarify') {
      record.view = { ...record.view, state: 'completed', progress: route.kind === 'chat' ? 'conversation' : 'clarification required' }
      return
    }
    const target = this.target(parent, route.requestId, route.kind === 'status')
    switch (route.kind) {
      case 'status': this.refresh(parent, target); break
      case 'cancel': this.cancel(parent, target.view.requestId); break
      case 'supplement': this.supplement(parent, target.view.requestId, record.input); break
      case 'switch': this.switch(parent, target.view.requestId, { commandId: randomUUID(),
        strategy: route.strategy, expectedBindingEpoch: route.expectedBindingEpoch }); break
    }
    record.view = { ...record.view, state: 'completed', progress: `Associated with ${target.view.requestId}` }
  }

  /**
   * Cancel pending admission or the accepted original Job.
   * @param parent - exact live task owner.
   * @param requestId - owned intake identity.
   */
  cancel(parent: Agent, requestId: string): void {
    const record = [...ownerRuns(this.ctx.jobs, parent).entries.values()].find(entry => entry.view.requestId === requestId)
    if (record === undefined) throw new Error('Unknown owned task entry')
    record.cancelRequested = true
    if (record.view.receipt === undefined) {
      record.controller.abort(new Error('Task entry cancelled by user'))
      if (record.view.proposal !== undefined && !record.proposalAccepted) { record.view = { ...record.view, state: 'cancelled' }; this.publish(parent, record) }
    }
    else this.ctx.jobs.kill(record.view.receipt.jobId, parent.id, 'task entry cancelled by user')
  }

  /**
   * Reserve replacement under the original TaskRun binding version.
   * @param parent - exact live task owner.
   * @param requestId - owned accepted intake identity.
   * @param request - replacement policy, command identity and observed binding epoch.
   * @returns recorded outcome for that command identity.
   */
  switch(parent: Agent, requestId: string, request: TaskSwitch): TaskCommandOutcome {
    return this.service.requestSwitch(parent, this.acceptedJob(parent, requestId), request)
  }

  /**
   * Resume the retained binding after a failed replacement.
   * @param parent - exact live task owner.
   * @param requestId - owned accepted intake identity.
   * @param request - command identity and binding epoch observed by the caller.
   * @returns recorded outcome for that command identity.
   */
  resume(parent: Agent, requestId: string,
    request: Pick<TaskSwitch, 'commandId' | 'expectedBindingEpoch'>): TaskCommandOutcome {
    return this.service.resume(parent, this.acceptedJob(parent, requestId), request)
  }

  /** Resolve one owned intake to its accepted original Job. */
  private acceptedJob(parent: Agent, requestId: string): JobId {
    const receipt = this.target(parent, requestId).view.receipt
    if (receipt === undefined) throw new Error('Task has not been accepted')
    return receipt.jobId
  }

  /**
   * Record bounded text for the next unstarted stage without repeating work.
   * @param parent - exact live task owner.
   * @param requestId - owned accepted intake identity.
   * @param message - original supplementary human input.
   */
  supplement(parent: Agent, requestId: string, message: UserMessage): void {
    if (message.content.some(block => block.type !== 'text')) throw new Error('Task supplements currently require text input')
    const record = this.target(parent, requestId)
    if (!['running', 'waiting'].includes(record.view.state)) throw new Error('Task is already terminal')
    const receipt = record.view.receipt
    if (receipt === undefined) throw new Error('Task has not been accepted')
    const run = ownerRuns(this.ctx.jobs, parent).runs.get(receipt.jobId)?.run
    if (!run?.acceptsSupplement()) throw new Error('No unstarted stage can apply this supplement; clarify a new task or explicitly switch strategy')
    const text = message.content.map(block => block.type === 'text' ? block.text : '').join('\n')
    if (Buffer.byteLength(JSON.stringify([...record.supplements, text]), 'utf8') > this.options().maxPromptBytes) throw new Error('Task supplements exceed input byte limit')
    record.supplements.push(text)
  }

  /**
   * Logged model-facing status; original human inputs remain untouched.
   * @param view - observed entry snapshot.
   * @returns coordinator context message attributed to this entry.
   */
  context(view: EntryView): UserMessage {
    return createUserMessage({ source: { kind: 'task-strategy-entry' }, content: [{ type: 'text', text:
      'Task entry outcome (Host facts; do not re-dispatch or execute directly): ' + JSON.stringify(view)
      + '\nRespond to conversation normally. For accepted work, report selection and observe job_output; do not claim completion before the Job completes. For failed/cancelled entry, explain the outcome; for clarification required, ask the user to clarify.' }] })
  }
}
