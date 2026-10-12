/** Task execution service using original DSH Jobs and Subagents ownership. */
import { Context, Service, symbols } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import { createAdmission } from './admission.ts'
import { captureStrategy, copyBinding } from './static-plan.ts'
import { TaskRun } from './task-run.ts'
import { validateTask } from './task-input.ts'
import { ownerRuns } from './task-submissions.ts'
import { boundText } from './schema.ts'
import { ExecutorRegistry } from './executor-registry.ts'
import { executeDshChild } from './dsh-child.ts'
import { createHash } from 'node:crypto'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type { ExecutionPlan, TaskExecutor } from './types.ts'
import type { TaskExecutorProvider } from './executor-types.ts'
import type { CapturedStrategy, TaskRunView, TaskRuntimeRules, TaskSwitch } from './runtime-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { taskRuns: TaskRuns }
}
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { strategy: 'strategy' }
}

/** Task state and original Job ownership, independent of author policies. */
export default class TaskRuns extends Service {
  static inject = ['agents', 'subagents', 'agentPresets', 'jobs', 'tools']
  private closing = false
  private readonly executors = new ExecutorRegistry()
  constructor(ctx: Context) {
    super(ctx, 'taskRuns')
    ctx.effect(() => () => { this.closing = true }, 'task run admission')
  }

  /**
   * Mount an executor for the calling plugin's lifetime.
   * @param provider - cancellable execution adapter; it does not own task state.
   * @returns effect-scoped registration disposer.
   */
  registerExecutor(provider: TaskExecutorProvider): () => void {
    this.assertOpen()
    // oxlint-disable-next-line typescript/no-misused-promises -- Cordis effects own registration removal
    return this.ctx.effect(() => this.executors.register(provider))
  }

  /**
   * Describe mounted execution adapters without initializing products.
   * @returns detached adapter identities and descriptions.
   */
  listExecutors(): { id: string; description: string }[] { return this.executors.list() }

  /**
   * Validate execution choices without accepting a Job.
   * @param plan - detached execution plan.
   * @param rules - explicit deployment limits and permitted capabilities.
   * @param signal - admission cancellation.
   * @returns settlement after temporary admission resources are released.
   */
  prepare(plan: ExecutionPlan, rules: TaskRuntimeRules, signal: AbortSignal): Promise<void> {
    this.assertOpen()
    return createAdmission(rules, this.ctx.subagents, this.ctx.agentPresets, this.ctx.tools, this.executors).prepare(plan, signal)
  }

  /**
   * Start an explicit plan under its exact live owner.
   * @param parent - original live Agent owning the Job.
   * @param task - unchanged user task.
   * @param plan - explicit execution choices.
   * @param rules - explicit deployment limits and permitted capabilities.
   * @param signal - admission cancellation; accepted Jobs own cancellation.
   * @returns original Job identity after admission.
   */
  start(parent: Agent, task: string, plan: ExecutionPlan, rules: TaskRuntimeRules, signal: AbortSignal): Promise<JobId> {
    return this.startCaptured(parent, task, captureStrategy('explicit', plan), rules, signal)
  }

  /**
   * Accept a captured policy binding without depending on the policy registry.
   * @param parent - exact live owner Agent.
   * @param task - original task text.
   * @param strategy - captured binding and plan.
   * @param rules - explicit immutable deployment rules.
   * @param signal - cancellation until acceptance.
   * @param additionalContext - optional synchronous stage supplement snapshot.
   * @returns original Job identity.
   */
  async startCaptured(parent: Agent, task: string, strategy: CapturedStrategy, rules: TaskRuntimeRules,
    signal: AbortSignal, additionalContext?: () => string): Promise<JobId> {
    const config = structuredClone(rules)
    validateTask(task)
    if (this.closing) throw new Error('Strategy component is closing')
    this.assertLiveOwner(parent)
    const captured = copyBinding(strategy)
    const modelRoute = parentAgentOptionsForDelegation(parent)
    const summary = { provider: config.provider, ...modelRoute.model === undefined ? {} : { model: modelRoute.model },
      ...modelRoute.provider === undefined ? {} : { modelProvider: modelRoute.provider },
      permissionAuthority: (config.allowedExecutors?.length ?? 0) === 0 ? 'dsh' as const : 'external-or-mixed' as const,
      maxTasks: config.maxTasks, maxResultBytes: config.maxResultBytes,
      allowedPresets: [...config.allowedPresets], allowedExecutors: [...config.allowedExecutors ?? []] }
    const execution = { ...summary, revision: createHash('sha256').update(JSON.stringify({ summary, rules: config, strategy: captured.id,
      plan: captured.revision, policy: captured.policyRevision })).digest('hex') }
    const subagents = this.ctx.subagents
    const jobs = this.ctx.jobs
    const executors = this.executors
    const { prepare, checkChild } = createAdmission(config, subagents, this.ctx.agentPresets, this.ctx.tools, executors)
    const store = ownerRuns(jobs, parent)
    const runConfig = Object.freeze({
      provider: config.provider,
      maxConcurrent: config.maxConcurrent,
      maxTasks: config.maxTasks,
      maxResultBytes: config.maxResultBytes,
      maxOutputBytes: config.maxOutputBytes,
    })
    await prepare(captured.plan, signal)
    signal.throwIfAborted()
    this.assertOpen()
    this.assertLiveOwner(parent)
    const execute: TaskExecutor = async (step, prompt, childSignal) => {
      // Recheck provider/preset availability at each child admission under the captured rules.
      await checkChild(step, childSignal)
      childSignal.throwIfAborted()
      if (step.executor !== undefined) {
        return executors.resolve(step, config.allowedExecutors ?? []).execute(parent, step, prompt, childSignal)
      }
      return executeDshChild(this.ctx, parent, runConfig.provider, { ...step,
        ...step.model !== undefined || modelRoute.model === undefined ? {} : { model: modelRoute.model },
        ...step.provider !== undefined || modelRoute.provider === undefined ? {} : { provider: modelRoute.provider },
      }, prompt, childSignal, config.maxResultBytes)
    }
    let runtime!: TaskRun
    const jobId = jobs.start({
      kind: 'strategy', label: captured.plan.name, owner: parent.id, outputLimitBytes: runConfig.maxOutputBytes,
      run: (job) => {
        job.append(`Execution plan: ${JSON.stringify(captured.plan)}\n`, { channel: 'log' })
        runtime = new TaskRun(task, captured, execute, {
          ...additionalContext === undefined ? {} : { additionalContext },
          maxConcurrent: runConfig.maxConcurrent, maxTasks: runConfig.maxTasks, maxResultBytes: runConfig.maxResultBytes,
          prepare,
          onEvent: (event) => {
            if (event.type === 'stage') job.updateProgress(event.stage)
            job.append(JSON.stringify(event) + '\n', { channel: 'log' })
          },
        })
        const done = runtime.start().then((result): JobOutcome => ({
          status: result.status === 'cancelled' ? 'killed' : result.status,
          ...result.error === undefined ? {} : { detail: boundText(result.error, runConfig.maxOutputBytes) },
          result: boundText(JSON.stringify(result), runConfig.maxOutputBytes),
        }))
        return { cancel: (reason) => { runtime.cancel(new Error(reason ?? 'strategy job cancelled')) }, done }
      },
    })
    store.runs.set(jobId, { task, run: runtime, execution })
    return jobId
  }

  /**
   * Inspect task state using the exact owning Agent.
   * @param parent - exact live owner.
   * @param jobId - original Job identity.
   * @returns detached binding and cumulative task state.
   */
  inspect(parent: Agent, jobId: JobId): TaskRunView {
    const owned = this.ownedRun(parent, jobId)
    return { ...owned.run.inspect(), ...owned.execution === undefined ? {} : { execution: structuredClone(owned.execution) } }
  }

  /**
   * Request cancellation through the original Jobs service after checking task ownership.
   * @param parent - exact live owner.
   * @param jobId - original Job identity.
   * @param reason - optional cancellation detail.
   * @returns original Jobs cancellation disposition; completion still awaits child cleanup.
   */
  cancel(parent: Agent, jobId: JobId, reason?: string): 'requested' | 'already-finished' {
    this.ownedRun(parent, jobId)
    return this.ctx.jobs.kill(jobId, parent.id, reason)
  }

  /**
   * Reserve a synchronous binding replacement at the next drained stage boundary.
   * @param parent - exact live owner.
   * @param jobId - original Job identity.
   * @param resolve - synchronous policy capture from the unchanged task text.
   * @param request - observed binding epoch and optional target cursor.
   * @returns reservation command number.
   */
  requestSwitch(parent: Agent, jobId: JobId, resolve: (task: string) => CapturedStrategy,
    request: Pick<TaskSwitch, 'expectedBindingEpoch' | 'startStage'>): number {
    this.assertOpen()
    const owned = this.ownedRun(parent, jobId)
    return owned.run.requestSwitch(() => resolve(owned.task), request)
  }

  /**
   * Resume a retained waiting binding.
   * @param parent - exact live owner.
   * @param jobId - original Job identity.
   * @param epoch - observed binding epoch.
   */
  resume(parent: Agent, jobId: JobId, epoch: number): void { this.ownedRun(parent, jobId).run.resume(epoch) }

  private ownedRun(parent: Agent, jobId: JobId) {
    this.assertLiveOwner(parent)
    this.ctx.jobs.get(jobId, parent.id)
    const owned = ownerRuns(this.ctx.jobs, parent).runs.get(jobId)
    if (owned === undefined) throw new Error(`Unknown task run: ${jobId}`)
    return owned
  }

  private isLiveOwner(parent: Agent): boolean {
    const live = this.ctx.agents.get(parent.id)
    if (live === undefined) return false
    const target = (parent as Agent & { [symbols.original]?: Agent })[symbols.original] ?? parent
    const current = (live as Agent & { [symbols.original]?: Agent })[symbols.original] ?? live
    return target === current
  }

  private assertLiveOwner(parent: Agent): void {
    if (!this.isLiveOwner(parent)) throw new Error('Task requires its exact live owner Agent')
  }


  private assertOpen(): void {
    if (this.closing) throw new Error('Task runtime is closing')
  }
}
