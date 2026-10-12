/** One task execution pump; strategy replacement changes its cursor, never its accumulated state. */
import { executeStage, validatePlan } from './executor.ts'
import { errorText } from './errors.ts'
import { validateTask } from './task-input.ts'
import { copyBinding, selectStage } from './static-plan.ts'
import { createPolicySnapshot, projectRunResults } from './run-projection.ts'
import type { CapturedStrategy, TaskRunEvent, TaskRunOptions, TaskRunView, TaskSwitch } from './runtime-types.ts'
import type { ExecutionResult, TaskExecutor, TaskResult } from './types.ts'

type StagePlan = NonNullable<ReturnType<typeof selectStage>>

type Resolution = { readonly strategy: CapturedStrategy } | { readonly error: string }
interface PendingSwitch {
  readonly command: number
  readonly stage: number
  readonly resolution: Promise<Resolution>
}

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
   * @param request - observed binding epoch and optional zero-based target cursor; stale expectations reject without mutation.
   * @returns command number indicating reservation, not successful binding replacement.
   */
  requestSwitch(load: () => CapturedStrategy, request: Pick<TaskSwitch, 'expectedBindingEpoch' | 'startStage'>): number {
    const { expectedBindingEpoch, startStage = 0 } = request
    this.assertBinding(expectedBindingEpoch)
    if (this.pending !== undefined) throw new Error('A strategy switch is already pending')
    if (!Number.isSafeInteger(startStage) || startStage < 0) throw new Error('Switch stage must be a nonnegative safe integer')
    const command = ++this.command
    const resolution = Promise.withResolvers<Resolution>()
    this.pending = { command, stage: startStage, resolution: resolution.promise }
    if (this.phase === 'waiting') this.phase = 'boundary'
    // Reserve first, then capture the registry entry in this call before a synchronous unload.
    try {
      const strategy = load()
      resolution.resolve({ strategy: copyBinding(strategy) })
    } catch (error) { resolution.resolve({ error: errorText(error) }) }
    this.emit({ type: 'switch-pending', command })
    this.wake?.()
    return command
  }

  /**
   * Resume the retained strategy after a rejected switch; previously completed stages stay completed.
   * @param expectedBindingEpoch - nonnegative safe integer from the caller's view; stale expectations preserve waiting and its error.
   */
  resume(expectedBindingEpoch: number): void {
    this.assertBinding(expectedBindingEpoch)
    if (this.phase !== 'waiting' || this.pending !== undefined) throw new Error('Task is not waiting for a resume command')
    this.error = undefined
    this.phase = 'boundary'
    this.wake?.()
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
    return structuredClone({
      phase: this.phase,
      binding: { id: this.strategy.id, revision: this.strategy.revision, epoch: this.epoch },
      nextStage: this.stage, completedStages: this.completedStages, startedTasks: this.startedTasks,
      results: this.results,
      ...projectRunResults(this.results, this.bindingStartResult),
      ...this.pending === undefined ? {} : { pendingSwitch: this.pending.command },
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
      remainingTasks: this.options.maxTasks - this.startedTasks, bindingEpoch: this.epoch }, this.results, currentResults))
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
            plan = this.decideStage(target, pending.stage, false, [])
            if (plan === undefined) throw new Error('Switch target must contain an unstarted stage')
            await this.prepare(plan)
            this.strategy = target
            this.bindingStartResult = this.results.length
            this.stage = pending.stage
            this.epoch++
            this.pending = undefined
            this.error = undefined
            this.phase = 'boundary'
            this.emit({ type: 'switch-committed', command: pending.command, strategy: target.id, revision: target.revision, epoch: this.epoch })
          } catch (error) {
            if (this.cancelled()) break
            this.pending = undefined
            this.error = errorText(error)
            this.phase = 'waiting'
            this.emit({ type: 'switch-rejected', command: pending.command, error: this.error })
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
          })
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
    this.emit({ type: 'terminal', status })
    return structuredClone({ status, results: this.results, ...error === undefined ? {} : { error } })
  }
}
