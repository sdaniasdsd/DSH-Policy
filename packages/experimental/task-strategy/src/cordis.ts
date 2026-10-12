/** Cordis carrier for the independent strategy component. */
import { Context, symbols } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { EntryCoordinator } from './entry-coordinator.ts'
import { mountEntryBoundary } from './entry-boundary.ts'
import { entryTools } from './entry-tools.ts'
import type { EntryView } from './entry-types.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { StrategyRegistry } from './index.ts'
import type {} from './task-runtime-service.ts'
import { captureStrategy } from './static-plan.ts'
import { validateTask } from './task-input.ts'
import { ownerRuns, reserveSubmission } from './task-submissions.ts'
import { adapterSchema } from './schema.ts'
import type { ResolvedAdapterConfig } from './schema.ts'
import { strategyTools } from './tools.ts'
import type { AdapterConfig, AuthorStrategy, ExecutionPlan, StrategyInput, StrategyCatalogEntry } from './types.ts'
import type { CapturedStrategy, TaskMessageRequest, TaskMessageReceipt,
  TaskReceipt, TaskRunView, TaskSubmission, TaskSwitch } from './runtime-types.ts'
import type { TaskIntakeRequest, WorkflowDecision } from './selection-types.ts'
import { resolveSelection } from './selection.ts'
import { selectStrategy, selectWorkflow } from './selector.ts'
import { errorText } from './errors.ts'
import { OrchestrationModes } from './orchestration.ts'
import type { OrchestrationMode, OrchestrationState } from './entry-types.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { strategy: 'strategy' }
}

/** DSH integration; author strategy identities remain outside the plugin registry. */
export default class TaskStrategies extends TypertRemoteService {
  static inject = ['agents', 'tools', 'subagents', 'agentPresets', 'jobs', 'tokenMeter', 'systemPrompt', 'taskRuns']
  static Config = adapterSchema
  private readonly registry: StrategyRegistry
  private closing = false
  private readonly admissionController = new AbortController()
  private readonly config: AdapterConfig
  private readonly selectionConfig: ResolvedAdapterConfig['selection']
  private readonly entryConfig: ResolvedAdapterConfig['entry']
  private readonly entry: EntryCoordinator
  private readonly intakes = new Map<AbortController, Promise<TaskReceipt>>()
  private readonly orchestrationModes = new OrchestrationModes()

  constructor(ctx: Context, config: ResolvedAdapterConfig) {
    super(ctx, 'taskStrategies')
    const meter = ctx.tokenMeter
    this.registry = new StrategyRegistry(text => meter.estimateMessage({
      role: 'user', id: brandString<MessageId>('task-strategy-cost'), source: { kind: 'user' }, content: [{ type: 'text', text }],
    }))
    this.selectionConfig = config.selection
    this.entryConfig = config.entry
    this.config = structuredClone({ ...config, entry: { enabled: config.entry.enabled.get() }, selection: this.readSelection() })
    for (const [key, value] of Object.entries(config)) {
      if (key.startsWith('max') && (!Number.isSafeInteger(value) || Number(value) <= 0)) {
        throw new Error(`${key} must be a positive safe integer`)
      }
    }
    if (!config.toolPrefix.trim() || !config.provider.trim()) throw new Error('Strategy carrier names must not be empty')
    // The carrier owns admission and registrations; Jobs owns accepted run lifetime.
    ctx.effect(() => async () => {
      this.closing = true
      this.admissionController.abort(new Error('Strategy component is closing'))
      for (const controller of this.intakes.keys()) controller.abort(new Error('Strategy component is closing'))
      await Promise.allSettled(this.intakes.values())
    }, 'task strategy admission')
    for (const definition of config.strategies) {
      const captured = structuredClone(definition)
      this.register({
        id: captured.id, description: captured.description,
        cost: { plan: captured.plan, variants: captured.variants,
          ...captured.tokenCost === undefined ? {} : { assumptions: captured.tokenCost } },
        decide: input => captured.variants
          ?.find(variant => input.preferences?.[variant.preference] === variant.equals)?.plan ?? captured.plan,
      })
    }
    this.entry = new EntryCoordinator(ctx, this, () => this.readSelection(), config.provider)
    const installed = new WeakSet<Agent>()
    const mount = (agent: Agent): void => {
      if (agent.session.header.origin === 'subagent' || installed.has(agent)) return
      installed.add(agent)
      const tools = [...strategyTools(this, config.toolPrefix, config.maxOutputBytes),
        ...entryTools(this, config.toolPrefix, config.maxOutputBytes)]
      for (const tool of tools) {
        ctx.effect(() => agent.ctx.tools.register(tool))
      }
      mountEntryBoundary(ctx, agent, config.toolPrefix, () => this.entryConfig.enabled.get())
      ctx.effect(() => agent.ctx.on('agent/pre-step', async ({ messages, signal }, next) => {
        const decision = await next()
        if (!this.entryConfig.enabled.get() || decision.kind === 'reject') return decision
        const contexts = []
        const admitted = new Set(decision.messages.map(message => message.id))
        for (const message of messages) {
          if (admitted.has(message.id) && message.source.kind === 'user') contexts.push(this.entry.context(await this.entry.accept(agent, message, signal)))
        }
        return { ...decision, messages: [...decision.messages, ...contexts] }
      }))
    }
    ctx.on('agent/created', ({ agent }) => { mount(agent) })
    for (const agent of ctx.agents.list()) mount(agent)
  }

  private readSelection() {
    const config = this.selectionConfig
    const model = config.model.get(), provider = config.provider.get()
    const fallbackStrategy = config.fallbackStrategy.get()
    return {
      default: structuredClone(config.default.get()), timeoutMs: config.timeoutMs.get(),
      maxPromptBytes: config.maxPromptBytes.get(), maxOutputBytes: config.maxOutputBytes.get(),
      maxTokens: config.maxTokens.get(),
      ...model === undefined ? {} : { model }, ...provider === undefined ? {} : { provider },
      ...fallbackStrategy === undefined ? {} : { fallbackStrategy },
    }
  }

  /**
   * Register an author strategy under the caller's Cordis lifetime.
   * @param strategy - independent decision function, not a plugin declaration.
   * @returns effect-scoped registration disposer.
   */
  register(strategy: AuthorStrategy): () => void {
    if (this.closing) throw new Error('Strategy component is closing')
    // oxlint-disable-next-line typescript/no-misused-promises -- preserve the Cordis effect disposer for registration ownership
    return this.ctx.effect(() => this.registry.register(strategy))
  }

  /**
   * List registered author policies without evaluating them.
   * @param input - optional original task and preferences for task-specific estimates.
   * @returns detached descriptions and child-cost estimates.
   */
  list(input?: StrategyInput): StrategyCatalogEntry[] {
    if (input !== undefined) validateTask(input.task)
    return this.registry.list(input)
  }

  /**
   * Describe the author policies and permitted child compositions.
   * @returns detached strategies and the permitted original DSH preset names.
   */
  @Remote
  catalog(): { strategies: StrategyCatalogEntry[]; presets: string[]; entryEnabled: boolean } {
    return { strategies: this.list(), presets: [...this.config.allowedPresets], entryEnabled: this.entryConfig.enabled.get() }
  }

  /**
   * Publish a plugin-owned composer mode under the current registration lifetime.
   * @param mode - plugin-owned composer mode.
   * @param executor - optional permitted external executor; omission uses original DSH strategies.
   * @param check - live backend check.
   * @returns scoped disposer.
   */
  registerOrchestration(mode: OrchestrationMode, executor?: string, check: () => void = () => {}): () => void {
    if (this.closing) throw new Error('Strategy component is closing')
    const captured = structuredClone(mode)
    // oxlint-disable-next-line typescript/no-misused-promises -- retain Cordis registration disposal ownership
    return this.ctx.effect(() => this.orchestrationModes.register(captured, () => {
      if (!this.entryConfig.enabled.get()) throw new Error('Enable task strategy entry first')
      if (executor !== undefined) {
        if (!this.config.allowedExecutors?.includes(executor)) throw new Error(`Executor is not allowed: ${executor}`)
        if (!this.ctx.taskRuns.listExecutors().some(item => item.id === executor)) throw new Error('Orchestration plugin is unavailable')
      } else if (this.ctx.subagents.getProvider(this.config.provider) === undefined) throw new Error('DSH task provider is unavailable')
      if (!this.list().some(item => item.id === captured.strategy)) throw new Error('Orchestration plugin is unavailable')
      check()
    }))
  }

  /**
   * Read the root session's acknowledged mode and current backend availability.
   * @param args - live root session identity.
   * @returns current choice and available plugins.
   */
  @Remote
  orchestration(args: { sessionId: SessionId }): OrchestrationState {
    return this.orchestrationModes.read(this.entryOwner(args.sessionId))
  }

  /**
   * Select a plugin for future new tasks without changing an accepted run.
   * @param args - live root session and requested mode.
   * @returns choice after Host validation.
   */
  @Remote
  selectOrchestration(args: { sessionId: SessionId; mode: string }): OrchestrationState {
    const owner = this.entryOwner(args.sessionId)
    this.orchestrationModes.select(owner, args.mode)
    return this.orchestrationModes.read(owner)
  }

  /**
   * Capture the original mode registration before asynchronous intake routing.
   * @param owner - exact root task owner.
   * @returns captured mode resolver for this intake.
   */
  captureOrchestration(owner: Agent): () => string | undefined { return this.orchestrationModes.capture(owner) }

  /**
   * Capture configuration values for one intake; later composer changes affect only later tasks.
   * @param owner - exact live root owner.
   * @returns detached string-valued preferences.
   */
  captureOrchestrationPreferences(owner: Agent): Readonly<Record<string, string>> {
    return this.orchestrationModes.capturePreferences(owner)
  }

  /**
   * Create an identified, unaccepted task suggestion without granting permissions or starting a Job.
   * @param args - root identity and immutable suggestion payload.
   * @returns detached, logged proposal view.
   */
  @Remote
  proposeEntry(args: { sessionId: SessionId; proposalId: string; task: string; strategy?: string }): EntryView {
    return this.entry.propose(this.entryOwner(args.sessionId), args.proposalId, args.task, args.strategy)
  }

  /**
   * Human UI acceptance of an owned proposal; repeated acceptance returns its retained operation.
   * @param args - exact live root and owned proposal identity.
   * @returns the retained acceptance operation, including a receipt or explicit failure.
   */
  @Remote
  acceptProposal(args: { sessionId: SessionId; proposalId: string }): Promise<EntryView> {
    return this.entry.approve(this.entryOwner(args.sessionId), args.proposalId)
  }

  /**
   * Select a budget tier for subsequent style tasks after validating the live plugin.
   * @param args - live root identity and requested tier.
   * @returns Host-acknowledged selection after validation.
   */
  @Remote
  selectWorkflowTier(args: { sessionId: SessionId; tier: string }): OrchestrationState {
    const owner = this.entryOwner(args.sessionId)
    this.orchestrationModes.selectTier(owner, args.tier)
    return this.orchestrationModes.read(owner)
  }

  /**
   * Read current intake snapshots for an exact live root session.
   * @param args - root session identity; an absent live owner returns an empty list.
   * @returns detached intake and execution snapshots, without result bodies.
   */
  @Remote
  entryState(args: { sessionId: SessionId }): EntryView[] {
    if (this.ctx.agents.get(args.sessionId) === undefined) return []
    return this.entry.views(this.entryOwner(args.sessionId))
  }

  private entryOwner(sessionId: SessionId): Agent {
    const owner = this.ctx.agents.get(sessionId)
    if (owner === undefined || owner.session.header.origin === 'subagent') throw new Error('Task entry requires a live root owner')
    return owner
  }

  /**
   * Cancel an owned intake or its accepted Job.
   * @param args - live root session and its request identity.
   */
  @Remote
  cancelEntry(args: { sessionId: SessionId; requestId: string }): void {
    this.entry.cancel(this.entryOwner(args.sessionId), args.requestId)
  }

  /**
   * Reserve an owned task replacement at the next stage boundary.
   * @param args - live root, owned request and replacement with observed binding epoch.
   */
  @Remote
  switchEntry(args: { sessionId: SessionId; requestId: string; request: TaskSwitch }): void {
    this.entry.switch(this.entryOwner(args.sessionId), args.requestId, args.request)
  }

  /**
   * Resume an owned waiting binding using the observed epoch.
   * @param args - live root, owned request and observed retained binding epoch.
   */
  @Remote
  resumeEntry(args: { sessionId: SessionId; requestId: string; epoch: number }): void {
    this.entry.resume(this.entryOwner(args.sessionId), args.requestId, args.epoch)
  }

  /**
   * Evaluate an author policy and validate its execution choices.
   * @param id - author strategy name.
   * @param input - task and preferences.
   * @returns detached plan; rejects unavailable or disallowed compositions.
   */
  async decide(id: string, input: StrategyInput): Promise<ExecutionPlan> {
    const plan = this.registry.decide(id, input)
    await this.ctx.taskRuns.prepare(plan, this.config, new AbortController().signal)
    return plan
  }

  /**
   * Submit a named task once per request id under the exact live owner.
   * @param parent - live root Agent owning the original Job.
   * @param request - stable request id, task, strategy and preferences.
   * @param signal - first submitter's admission signal; accepted work uses Jobs cancellation.
   * @returns shared acceptance promise for equal concurrent or repeated requests.
   */
  submit(parent: Agent, request: TaskSubmission, signal: AbortSignal): Promise<TaskReceipt> {
    return this.submitTask(parent, { requestId: request.requestId, task: request.task,
      selection: { kind: 'named', strategy: request.strategy },
      ...request.preferences === undefined ? {} : { preferences: request.preferences },
    }, signal)
  }

  /**
   * Select automatically or honor a named choice before accepting one original Job.
   * @param parent - exact live root Agent owning the request.
   * @param request - stable original id, unchanged task and optional choice.
   * @param signal - first submitter's cancellation until acceptance.
   * @returns shared receipt including the chosen strategy, after selector cleanup.
   */
  submitTask(parent: Agent, request: TaskIntakeRequest, signal: AbortSignal): Promise<TaskReceipt> {
    if (this.closing) return Promise.reject(new Error('Strategy component is closing'))
    if (!this.isLiveOwner(parent)) return Promise.reject(new Error('Task requires its exact live owner Agent'))
    const captured = structuredClone(request)
    const store = ownerRuns(this.ctx.jobs, parent)
    const options = this.readSelection()
    const choice = resolveSelection(captured, options.default)
    return reserveSubmission(store, captured, () => {
      const controller = new AbortController()
      const combined = AbortSignal.any([signal, controller.signal])
      const operation = (async (): Promise<TaskReceipt> => {
        this.assertOpen()
        combined.throwIfAborted()
        this.assertLiveOwner(parent)
        const releaseOwner = parent.ctx.effect(() => () => { controller.abort(new Error('Task requires its exact live owner Agent (owner was disposed)')) }, 'task strategy intake')
        try {
          let selection: TaskReceipt['selection']
          let input: StrategyInput = captured
          let id: string
          if (choice.kind === 'auto' && choice.workflow === true) {
            const tierStrategies = this.orchestrationModes.tierStrategies()
            const candidates = this.list(captured).map(candidate => ({ ...candidate,
              ...!tierStrategies.has(candidate.id) ? {} : { tiers: (['low', 'medium', 'high', 'extreme-high'] as const)
                .filter(tier => captured.preferences?.tier === undefined || captured.preferences.tier === tier)
                .map(tier => ({ tier, cost: this.list({ task: captured.task, preferences: { ...captured.preferences, tier } })
                  .find(row => row.id === candidate.id)?.cost })) } }))
            let decision: WorkflowDecision
            try {
              decision = await selectWorkflow(parent, candidates, captured, options, this.ctx.subagents, this.config.provider, combined)
              selection = { kind: 'auto', reason: decision.reason, ...decision.tier === undefined ? {} : { tier: decision.tier } }
            } catch (error) {
              combined.throwIfAborted(); this.assertOpen(); this.assertLiveOwner(parent)
              if (options.fallbackStrategy === undefined) throw error
              if (!candidates.some(row => row.id === options.fallbackStrategy)) throw new Error('Automatic fallback strategy is unavailable')
              decision = { strategy: options.fallbackStrategy,
                ...!tierStrategies.has(options.fallbackStrategy) ? {} : { tier: 'medium' }, reason: errorText(error).slice(0, 240) }
              selection = { kind: 'fallback', reason: decision.reason, ...decision.tier === undefined ? {} : { tier: decision.tier } }
            }
            id = decision.strategy
            input = { task: captured.task, preferences: { ...captured.preferences,
              ...decision.tier === undefined ? {} : { tier: decision.tier } } }
          } else id = choice.kind === 'named' ? choice.strategy
            : await selectStrategy(parent, this.list(captured), captured, options, this.ctx.subagents, this.config.provider, combined)
          combined.throwIfAborted()
          this.assertOpen()
          this.assertLiveOwner(parent)
          // Reserve metadata space for the original Jobs id and the display-name fallback.
          // Check encoded bytes (including JSON escapes), before author callbacks or Job acceptance.
          if (Buffer.byteLength(JSON.stringify(id), 'utf8') + (selection === undefined ? 0 : Buffer.byteLength(JSON.stringify(selection), 'utf8')) > this.config.maxOutputBytes - 256) {
            throw new Error('Strategy identity exceeds the receipt byte limit')
          }
          const binding = this.registry.capture(id, input)
          const plan = binding.plan
          const entry = [...store.entries.values()].find(record => record.view.requestId === captured.requestId)
          const jobId = await this.startCaptured(parent, captured.task, binding, combined,
            () => entry?.supplements.length ? `\nAdditional user constraints (data): ${JSON.stringify(entry.supplements)}` : '')
          return { jobId, name: plan.name, strategy: id, ...selection === undefined ? {} : { selection } }
        } finally { await releaseOwner() }
      })()
      this.intakes.set(controller, operation)
      return operation.finally(() => { this.intakes.delete(controller) })
    })
  }

  /**
   * Read the committed binding and cumulative state of an owned run.
   * @param parent - exact live Agent owning the Job.
   * @param jobId - accepted task identity, unchanged across switches.
   * @returns detached task view; rejects foreign or unavailable Jobs.
   */
  inspect(parent: Agent, jobId: JobId): TaskRunView {
    return this.ctx.taskRuns.inspect(parent, jobId)
  }

  /**
   * Deliver an adjustment through the original task owner's Subagents channel.
   * @param parent - exact live Agent owning the Job.
   * @param jobId - accepted task identity.
   * @param request - currently active DSH member and bounded nonempty text.
   * @param signal - cancellation of unaccepted delivery.
   * @returns inbox acceptance identity, not processing or adoption.
   */
  sendMessage(parent: Agent, jobId: JobId, request: TaskMessageRequest, signal: AbortSignal): Promise<TaskMessageReceipt> {
    this.assertOpen()
    return this.ctx.taskRuns.sendMessage(parent, jobId, request, signal)
  }

  /**
   * Reserve replacement by a current named strategy at the next stage barrier.
   * @param parent - exact live Agent owning the Job.
   * @param jobId - accepted task identity.
   * @param request - target strategy, observed binding epoch, preferences and optional explicit stage cursor.
   * @returns reservation command number; inspect state or Job output for commitment or failure.
   */
  requestSwitch(parent: Agent, jobId: JobId, request: TaskSwitch): number {
    if (this.closing) throw new Error('Strategy component is closing')
    const captured = structuredClone(request)
    // Registry.decide captures the registration synchronously, before reload can remove it.
    const registry = this.registry
    return this.ctx.taskRuns.requestSwitch(parent, jobId,
      task => registry.capture(captured.strategy, {
        task, ...captured.preferences === undefined ? {} : { preferences: captured.preferences },
      }),
      captured,
    )
  }

  /**
   * Continue the retained strategy after a rejected replacement.
   * @param parent - exact live Agent owning the Job.
   * @param jobId - waiting task identity.
   * @param expectedBindingEpoch - binding epoch observed by the caller; stale expectations cannot resume a different binding.
   */
  resume(parent: Agent, jobId: JobId, expectedBindingEpoch: number): void {
    this.ctx.taskRuns.resume(parent, jobId, expectedBindingEpoch)
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
    if (this.closing) throw new Error('Strategy component is closing')
  }

  /**
   * Start an original DSH owned job from an upper-authored or policy-authored plan.
   * @param parent - exact live upper Agent owning the run.
   * @param task - nonblank user task shared with all stages, preserving its whitespace.
   * @param plan - captured execution choices.
   * @param signal - admission cancellation; after acceptance use original job cancellation.
   * @returns original DSH job identity; rejects invalid plans before starting work.
   */
  async start(parent: Agent, task: string, plan: ExecutionPlan, signal: AbortSignal): Promise<JobId> {
    return this.startCaptured(parent, task, captureStrategy('explicit', plan), signal)
  }

  private async startCaptured(parent: Agent, task: string, strategy: CapturedStrategy, signal: AbortSignal,
    additionalContext?: () => string): Promise<JobId> {
    this.assertOpen()
    return this.ctx.taskRuns.startCaptured(parent, task, strategy, this.config,
      AbortSignal.any([signal, this.admissionController.signal]), additionalContext)
  }
}
