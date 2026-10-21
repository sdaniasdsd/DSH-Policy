/** One task execution pump; strategy replacement changes its cursor, never its accumulated state. */
import { executeStage, validatePlan } from './executor.ts'
import { errorText } from './errors.ts'
import { validateTask } from './task-input.ts'
import { copyBinding, selectStage } from './static-plan.ts'
import { createPolicySnapshot, projectRunResults } from './run-projection.ts'
import type { CapacityObservation, CapacityResource } from './capacity-types.ts'
import type { PolicySignal } from './policy-types.ts'
import type { CapturedStrategy, TaskCommandOutcome, TaskCommandWaitResult, TaskRunEvent, TaskRunOptions,
  TaskRunView, TaskSwitch } from './runtime-types.ts'
import type { ExecutionResult, TaskExecutor, TaskResult } from './types.ts'

type StagePlan = NonNullable<ReturnType<typeof selectStage>>

type Resolution = { readonly strategy: CapturedStrategy } | { readonly error: string }
interface PendingSwitch {
  readonly record: CommandRecord
  readonly stage: number
  readonly resolution: Promise<Resolution>
}

/** One command's recorded fate; a queued record is the switch the pump will commit. */
interface CommandRecord {
  readonly commandId: string
  readonly command: number
  status: TaskCommandOutcome['status']
  epoch: number | undefined
  effectiveAt: string | undefined
  error: string | undefined
  readonly waiters: Set<CommandWaiter>
}

interface CommandWaiter {
  readonly resolve: (result: TaskCommandWaitResult) => void
  readonly reject: (error: unknown) => void
  readonly signal: AbortSignal
  readonly abort: () => void
  readonly timer: ReturnType<typeof setTimeout>
}

/** Capacity facts accumulated for one resource across the run. */
interface CapacityTally {
  readonly resource: CapacityResource
  readonly code: string
  waits: number
  waitedMs: number
  exhausted: boolean
}

/** Largest wait a caller may request, matching the schedulable timer range. */
const MAX_WAIT_MS = 2_147_483_647

/** A run requires nonblank task text and owns cancellation and results; its executor drains resources before settling. */
export class TaskRun {
  private readonly controller = new AbortController()
  private readonly options: TaskRunOptions
  private strategy: CapturedStrategy
  private phase: TaskRunView['phase'] = 'queued'
  private stage = 0
  private epoch = 0
  private completedStages = 0
  private startedTasks = 0
  private bindingStartResult = 0
  private results: TaskResult[] = []
  private error: string | undefined
  private pending: PendingSwitch | undefined
  private activeConcurrency: number
  private command = 0
  private readonly commands = new Map<string, CommandRecord>()
  private readonly capacities = new Map<CapacityResource, CapacityTally>()
  private wake: (() => void) | undefined
  private done: Promise<ExecutionResult> | undefined

  constructor(
    private readonly task: string,
    strategy: CapturedStrategy,
    private readonly execute: TaskExecutor,
    options: TaskRunOptions,
  ) {
    validateTask(task)
    this.strategy = copyBinding(strategy)
    this.options = { ...options }
    this.activeConcurrency = options.maxConcurrent
    validatePlan(this.strategy.plan, this.limits())
  }

  /**
   * Start once; subsequent calls share the same completion promise.
   * @returns terminal report after all owned execution and preparation have settled.
   */
  start(): Promise<ExecutionResult> {
    // Defer execution so Jobs can finish synchronous registration before any work starts.
    this.done ??= Promise.resolve().then(() => this.pump())
    return this.done
  }

  /**
   * Reserve one switch before evaluating the target; current children continue to their barrier.
   * @param load - synchronously returns plain target-plan data; no asynchronous work or execution resources.
   * @param request - command identity, observed binding epoch and optional zero-based target cursor.
   * @returns the queued outcome, or the first outcome recorded for a repeated command identity.
   */
  requestSwitch(load: () => CapturedStrategy,
    request: Pick<TaskSwitch, 'commandId' | 'expectedBindingEpoch' | 'startStage'>): TaskCommandOutcome {
    const { commandId, expectedBindingEpoch, startStage = 0 } = request
    this.assertCommandId(commandId)
    const recorded = this.commands.get(commandId)
    if (recorded !== undefined) return this.outcomeOf(recorded)
    this.assertBinding(expectedBindingEpoch)
    if (this.pending !== undefined) throw new Error('A strategy switch is already pending')
    if (!Number.isSafeInteger(startStage) || startStage < 0) throw new Error('Switch stage must be a nonnegative safe integer')
    const command = ++this.command
    const record: CommandRecord = { commandId, command, status: 'queued', epoch: undefined,
      effectiveAt: undefined, error: undefined, waiters: new Set() }
    this.commands.set(commandId, record)
    const resolution = Promise.withResolvers<Resolution>()
    this.pending = { record, stage: startStage, resolution: resolution.promise }
    if (this.phase === 'waiting') this.phase = 'boundary'
    // Reserve first, then capture the registry entry in this call before a synchronous unload.
    try {
      const strategy = load()
      resolution.resolve({ strategy: copyBinding(strategy) })
    } catch (error) { resolution.resolve({ error: errorText(error) }) }
    this.emit({ type: 'switch-pending', command, commandId })
    this.wake?.()
    return this.outcomeOf(record)
  }

  /**
   * Resume the retained strategy after a rejected switch; previously completed stages stay completed.
   * @param request - command identity and nonnegative binding epoch from the caller's view.
   * @returns the applied outcome, or the first outcome recorded for a repeated command identity.
   */
  resume(request: Pick<TaskSwitch, 'commandId' | 'expectedBindingEpoch'>): TaskCommandOutcome {
    const { commandId, expectedBindingEpoch } = request
    this.assertCommandId(commandId)
    const recorded = this.commands.get(commandId)
    if (recorded !== undefined) return this.outcomeOf(recorded)
    this.assertBinding(expectedBindingEpoch)
    if (this.phase !== 'waiting' || this.pending !== undefined) throw new Error('Task is not waiting for a resume command')
    const record: CommandRecord = { commandId, command: ++this.command, status: 'applied', epoch: this.epoch,
      effectiveAt: new Date().toISOString(), error: undefined, waiters: new Set() }
    this.commands.set(commandId, record)
    this.error = undefined
    this.phase = 'boundary'
    this.wake?.()
    return this.outcomeOf(record)
  }

  /**
   * Await one submitted command's settled outcome.
   * @param commandId - identity already submitted to this run.
   * @param timeoutMs - bounded wait in milliseconds; a positive safe integer within the timer range.
   * @param signal - caller cancellation.
   * @returns the settled outcome, or a timeout marker when the command stays queued.
   */
  waitCommand(commandId: string, timeoutMs: number, signal: AbortSignal): Promise<TaskCommandWaitResult> {
    const record = this.commands.get(commandId)
    if (record === undefined) return Promise.reject(new Error(`Unknown task command: ${commandId}`))
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_MS) {
      return Promise.reject(new Error('Command wait timeout must be a bounded positive safe integer'))
    }
    if (record.status !== 'queued') return Promise.resolve({ timedOut: false, outcome: this.outcomeOf(record) })
    signal.throwIfAborted()
    return new Promise<TaskCommandWaitResult>((resolve, reject) => {
      const abort = (): void => {
        record.waiters.delete(waiter)
        clearTimeout(waiter.timer)
        const reason: unknown = signal.reason
        reject(reason instanceof Error ? reason : new Error('Task command wait cancelled'))
      }
      const timer = setTimeout(() => {
        record.waiters.delete(waiter)
        signal.removeEventListener('abort', abort)
        resolve({ timedOut: true })
      }, timeoutMs)
      const waiter: CommandWaiter = { resolve, reject, signal, abort, timer }
      record.waiters.add(waiter)
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  /**
   * Record one capacity observation from this run's child admission.
   * The task runtime owns the wait, so only its own admission path reports here.
   * @param observation - facts from the admission that lacked a free resource.
   */
  reportCapacity(observation: CapacityObservation): void {
    this.emit({ type: 'capacity', ...observation })
    if (observation.kind === 'waiting') return
    const tally = this.capacities.get(observation.resource)
    if (tally === undefined) {
      this.capacities.set(observation.resource, { resource: observation.resource, code: observation.code, waits: 1,
        waitedMs: observation.waitedMs, exhausted: observation.kind === 'exhausted' })
      return
    }
    tally.waits++
    tally.waitedMs += observation.waitedMs
    tally.exhausted ||= observation.kind === 'exhausted'
  }

  /**
   * Abort immediately; completion still waits for active children and preparation to settle.
   * @param reason - cancellation cause supplied by the owner.
   */
  cancel(reason: unknown): void {
    if (this.isTerminal()) return
    this.phase = 'stopping'
    this.controller.abort(reason)
    this.wake?.()
  }

  /**
   * Read detached state; mutating a view cannot change execution.
   * @returns task state including cumulative usage and the currently committed binding.
   */
  inspect(): TaskRunView {
    const signals = this.signals()
    return structuredClone({
      phase: this.phase,
      binding: { id: this.strategy.id, revision: this.strategy.revision, epoch: this.epoch },
      nextStage: this.stage, completedStages: this.completedStages, startedTasks: this.startedTasks,
      results: this.results,
      ...projectRunResults(this.results, this.bindingStartResult),
      ...this.pending === undefined ? {} : { pendingSwitch: this.pending.record.command },
      ...signals.length === 0 ? {} : { signals },
      ...this.error === undefined ? {} : { error: this.error },
    })
  }

  /** Reserve an executing member turn against the original cumulative task budget. */
  admitMemberTurn(): void {
    this.controller.signal.throwIfAborted()
    if (this.phase !== 'running') throw new Error('Task is not executing; member admission is closed')
    if (this.startedTasks >= this.options.maxTasks) throw new Error(`Task exceeds cumulative task limit ${this.options.maxTasks}`)
    this.startedTasks++
  }

  /** Current author's stage capacity, including an explicit stage override. */
  get concurrencyLimit(): number { return this.activeConcurrency }

  private limits(): Pick<TaskRunOptions, 'maxConcurrent' | 'maxTasks' | 'maxResultBytes'> {
    const { maxConcurrent, maxTasks, maxResultBytes } = this.options
    return { maxConcurrent, maxTasks, maxResultBytes }
  }

  /**
   * Whether a retained, unstarted stage can still consume supplemental context.
   * @returns true while a later stage remains available for this binding.
   */
  acceptsSupplement(): boolean {
    if (this.isTerminal() || this.phase === 'stopping' || this.cancelled()) return false
    return this.strategy.next !== undefined || selectStage(this.strategy, this.stage + (this.phase === 'running' ? 1 : 0)) !== undefined
  }

  private decideStage(strategy: CapturedStrategy, index: number, commitWaiting = true,
    currentResults = this.results.slice(this.bindingStartResult)): StagePlan | undefined {
    if (strategy.next === undefined) return selectStage(strategy, index)
    const decision = strategy.next(createPolicySnapshot({ nextStage: index, completedStages: this.completedStages,
      remainingTasks: this.options.maxTasks - this.startedTasks, bindingEpoch: this.epoch, signals: this.signals() },
    this.results, currentResults))
    switch (decision.kind) {
      case 'stage': return { name: strategy.plan.name, stages: [structuredClone(decision.stage)] }
      case 'finish': return undefined
      case 'blocked': {
        if (!commitWaiting) throw new Error(decision.reason)
        this.error = decision.reason
        this.phase = 'waiting'
        this.emit({ type: 'waiting', error: decision.reason })
        return undefined
      }
      default: throw new Error('Policy must return a synchronous stage decision')
    }
  }

  private isTerminal(): boolean {
    return this.phase === 'completed' || this.phase === 'failed' || this.phase === 'cancelled'
  }

  private cancelled(): boolean { return this.controller.signal.aborted }

  private waiting(): boolean { return this.phase === 'waiting' }

  private assertControllable(): void {
    if (this.isTerminal() || this.phase === 'stopping' || this.cancelled()) throw new Error('Task is already stopping or settled')
  }

  private assertBinding(expectedBindingEpoch: number): void {
    this.assertControllable()
    if (!Number.isSafeInteger(expectedBindingEpoch) || expectedBindingEpoch < 0) {
      throw new Error('Binding epoch must be a nonnegative safe integer')
    }
    if (expectedBindingEpoch !== this.epoch) {
      throw new Error(`Task binding epoch changed: expected ${expectedBindingEpoch}, current ${this.epoch}`)
    }
  }

  private assertCommandId(commandId: string): void {
    if (!commandId.trim()) throw new Error('Task command id must not be empty')
  }

  private outcomeOf(record: CommandRecord): TaskCommandOutcome {
    return { commandId: record.commandId, command: record.command, status: record.status,
      ...record.epoch === undefined ? {} : { epoch: record.epoch },
      ...record.effectiveAt === undefined ? {} : { effectiveAt: record.effectiveAt },
      ...record.error === undefined ? {} : { error: record.error } }
  }

  /** Settle one reserved command and release its waiters; the pump settles each reservation at most once. */
  private settleCommand(record: CommandRecord, patch: Pick<TaskCommandOutcome, 'status'>
    & Partial<Pick<TaskCommandOutcome, 'epoch' | 'effectiveAt' | 'error'>>): void {
    record.status = patch.status
    record.epoch = patch.epoch
    record.effectiveAt = patch.effectiveAt
    record.error = patch.error
    const outcome = this.outcomeOf(record)
    for (const waiter of [...record.waiters]) {
      record.waiters.delete(waiter)
      clearTimeout(waiter.timer)
      waiter.signal.removeEventListener('abort', waiter.abort)
      waiter.resolve({ timedOut: false, outcome })
    }
  }

  /** Capacity facts accumulated for this run, one signal per exhausted resource. */
  private signals(): PolicySignal[] {
    return [...this.capacities.values()].map(tally => ({ kind: 'capacity' as const, resource: tally.resource,
      code: tally.code, waits: tally.waits, waitedMs: tally.waitedMs, exhausted: tally.exhausted }))
  }

  private emit(event: TaskRunEvent): void {
    try { this.options.onEvent?.(event) }
    catch (error) {
      // Observers cannot change the completion of the operation they observe.
      void error
    }
  }

  private async prepare(plan: StagePlan): Promise<void> {
    const remaining = this.options.maxTasks - this.startedTasks
    if (plan.stages[0].tasks.length > remaining) throw new Error(`Task exceeds cumulative task limit ${this.options.maxTasks}`)
    validatePlan(plan, this.limits())
    this.controller.signal.throwIfAborted()
    await this.options.prepare(structuredClone(plan), this.controller.signal)
    this.controller.signal.throwIfAborted()
  }

  private async pump(): Promise<ExecutionResult> {
    try {
      while (!this.cancelled()) {
        if (this.phase === 'waiting') {
          await new Promise<void>((resolve) => { this.wake = resolve })
          this.wake = undefined
          continue
        }
        this.phase = 'preparing'
        let plan: StagePlan | undefined
        const pending = this.pending
        if (pending !== undefined) {
          try {
            const resolution = await pending.resolution
            this.controller.signal.throwIfAborted()
            if ('error' in resolution) throw new Error(resolution.error)
            const target = resolution.strategy
            if (target.next !== undefined && pending.stage !== 0) throw new Error('Adaptive switch targets must begin with a new policy decision')
            validatePlan(target.plan, this.limits())
            await this.options.prepare(structuredClone(target.plan), this.controller.signal)
            this.controller.signal.throwIfAborted()
            // A blocked target cannot mutate the retained binding or its wait reason.
            const decided = this.decideStage(target, pending.stage, false, [])
            if (decided === undefined) throw new Error('Switch target must contain an unstarted stage')
            await this.prepare(decided)
            plan = decided
            this.strategy = target
            this.bindingStartResult = this.results.length
            this.stage = pending.stage
            this.epoch++
            this.pending = undefined
            this.error = undefined
            this.phase = 'boundary'
            this.settleCommand(pending.record, { status: 'applied', epoch: this.epoch, effectiveAt: new Date().toISOString() })
            this.emit({ type: 'switch-committed', command: pending.record.command, commandId: pending.record.commandId,
              strategy: target.id, revision: target.revision, epoch: this.epoch })
          } catch (error) {
            if (this.cancelled()) break
            this.pending = undefined
            this.error = errorText(error)
            this.phase = 'waiting'
            this.settleCommand(pending.record, { status: 'rejected', error: this.error })
            this.emit({ type: 'switch-rejected', command: pending.record.command, commandId: pending.record.commandId, error: this.error })
            if (this.waiting()) this.emit({ type: 'waiting', error: this.error })
            continue
          }
        } else {
          plan = this.decideStage(this.strategy, this.stage)
          if (this.cancelled()) break
          if (this.waiting()) continue
          if (plan === undefined) return await this.settle('completed')
          try { await this.prepare(plan) }
          catch (error) {
            if (this.pending !== undefined && !this.cancelled()) continue
            throw error
          }
        }
        if (this.cancelled()) break
        // A switch arriving during asynchronous preflight supersedes that unstarted stage.
        if (this.pending !== undefined) continue
        this.phase = 'running'
        const activeStage = plan.stages[0]
        this.activeConcurrency = Math.max(this.options.maxConcurrent,
          activeStage.serial === true ? 1 : activeStage.maxConcurrent ?? this.options.maxConcurrent)
        const additionalContext = this.options.additionalContext?.() ?? ''
        let result: Awaited<ReturnType<typeof executeStage>>
        try {
          result = await executeStage(activeStage, this.task, this.results, (step, prompt, signal) => {
            signal.throwIfAborted()
            this.admitMemberTurn()
            return this.execute(step, prompt + additionalContext, signal)
          }, {
            ...this.limits(), signal: this.controller.signal,
            onEvent: (event) => { this.emit(event) },
          }, this.bindingStartResult)
        } finally { this.activeConcurrency = this.options.maxConcurrent }
        this.results = result.results
        if (this.cancelled()) break
        if (result.status !== 'completed') return await this.settle(result.status, result.error)
        this.stage++
        this.completedStages++
        this.phase = 'boundary'
      }
      return await this.settle('cancelled')
    } catch (error) {
      return this.cancelled() ? this.settle('cancelled') : this.settle('failed', errorText(error))
    }
  }

  private async settle(status: ExecutionResult['status'], error?: string): Promise<ExecutionResult> {
    this.phase = 'stopping'
    if (this.pending !== undefined) await this.pending.resolution
    if (this.cancelled()) { status = 'cancelled'; error = undefined }
    this.phase = status
    this.pending = undefined
    this.error = error
    // A reservation the pump never committed cannot apply to a settled run; settle it so no waiter hangs.
    for (const record of [...this.commands.values()]) {
      if (record.status === 'queued') {
        this.settleCommand(record, { status: 'rejected', error: 'Task ended before the replacement was committed' })
      }
    }
    this.emit({ type: 'terminal', status })
    return structuredClone({ status, results: this.results, ...error === undefined ? {} : { error } })
  }
}
