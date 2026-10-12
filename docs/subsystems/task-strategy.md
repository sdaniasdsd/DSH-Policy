# Task strategies

English | [中文](task-strategy.zh.md)

The experimental task-strategy library keeps author workflow decisions separate from DSH plugin identities. Its optional Cordis carrier is loaded only through an explicit profile patch. Once enabled, `ctx.taskStrategies` validates an ordered plan and dispatches each lower task through DSH's existing preset, subagent, and Jobs services. Lower agents do not receive the strategy control tools.

Stages run in order; authors choose concurrency within a stage through `maxConcurrent`, or request serial execution through `serial`. The carrier default applies only when the stage omits a count. Presets and tool filters are checked before dispatch, and progress is recorded in an owned DSH job. Unloading the carrier removes its registrations but leaves accepted Jobs under the Jobs service lifetime; use `job_kill` for explicit cancellation. Concurrent tasks can still share files, so authors must coordinate writes. Completion means the child turns ended, not that their output was independently verified.

See the [package documentation](../../packages/experimental/task-strategy/README.md) for plan and profile-patch examples.

`ctx.taskStrategies` handles policy registration, costing and selection; the separately mounted `ctx.taskRuns` service handles explicit plans, owned Jobs, execution adapter registration and stage controls. `TaskRuntimeRules` captures deployment limits and permitted presets/executors. `TaskExecutorProvider` supplies a synchronous availability check and cancellation-aware child execution; it owns cleanup, while `TaskRunView` remains task-owned. `CapturedStrategy` binds an immutable plan revision. `EntryView` exposes recorded root-intake state. Native product adapters are independently removable plugins; see the package's [runtime and plugin contract](../../packages/experimental/task-strategy/README.md#runtime-plugins).

`AuthorStrategy.decide` and `StrategyRegistry.decide` synchronously produce detached plan data; asynchronous work belongs to the executor. The carrier's `ctx.taskStrategies.decide` remains asynchronous because it also performs admission. The package documentation defines author requirements.

Host callers can submit a named strategy with a per-owner `requestId`, inspect its retained task state and request a replacement at a drained stage boundary. The JobId remains stable across replacements. Replacement preserves results and cumulative child limits; failed replacement waits for an explicit resume or another switch. Host controls and process-local state are defined in [runtime-types.ts](../../packages/experimental/task-strategy/src/runtime-types.ts); root model tools expose submit, list, plan, run, inspect and message.

| Type | Host responsibility |
|---|---|
| `TaskSubmission` | Request id, task input, strategy and preferences for one acceptance |
| `TaskIntakeRequest` | Original request id, task and optional automatic/named selection; omission captures the plugin default |
| `TaskReceipt` | Accepted JobId, initial plan name and chosen strategy; not a completion report |
| `TaskSwitch` | Target strategy, observed binding epoch, preferences and explicit zero-based start cursor |
| `TaskRunView` | Committed binding, phase, retained results, cumulative usage and pending switch |
| `TaskMemberView` | Session identity and label of one active local child |
| `TaskMessageRequest` | Active child identity and nonempty adjustment text |
| `TaskMessageReceipt` | Accepted message identity; not processing or adoption |

Task coordination uses the original Job owner and Subagents message channel. `inspect(parent, jobId)` includes detached `activeMembers` entries with `{ sessionId, label }`; `sendMessage(parent, jobId, { childId, text }, signal)` on either `ctx.taskRuns` or `ctx.taskStrategies` returns only `{ messageId }` after inbox acceptance. The member must belong to that task and still be executing. Foreign owners, stopped tasks, idle or ended children and native executor targets reject without waking a session or changing backends. Nonempty text and the UTF-8 size of the complete serialized request are checked against the accepted task's captured `maxPlanBytes`; caller or task cancellation stops unaccepted delivery. Acceptance does not prove processing or decision adoption, and accepted messages are not retried automatically.

Root model tools `task_strategy_inspect(jobId)` and `task_strategy_message(jobId, childId, text)` expose the same ownership checks, with names following `toolPrefix`. They remain available when automatic root entry is enabled and disappear when the carrier unloads; execution children retain their original tools. Inspect is a current snapshot and may become stale before a send. Complete identities are never sliced to meet `maxOutputBytes`; an oversized inspection explicitly refuses presentation and directs the caller to `job_output` or a larger output limit. If a message receipt exceeds that limit, the error retains its full accepted identity and says not to resend. These interfaces supply coordination primitives; risk grading, meetings and blackboard decision adoption belong to author strategies.

Carrier remount with the same module and Jobs service retains live runs; process restart does not. Captured deployment rules remain fixed for each accepted run, while provider and preset availability are checked at admission. See the package's [limitations](../../packages/experimental/task-strategy/README.md#known-limitations-and-deferred-work) for execution recovery restrictions.

`entry.enabled` optionally routes original root user messages through bounded intent classification and the existing strategy intake. The policy bundle enables it by default; the standard product does not. Root business tools are filtered and guarded; children retain original preset and permission rules. The chat card folds recorded entry facts into strategy, cost and stage progress, with owned cancel and versioned switch/resume controls. Supplementary text enters the next unstarted stage and rejects when none remains; bounded prior conversation informs routing and execution; process restart restores interrupted presentation without starting work. See the [entry upgrade guide](../upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.md).

Switch and resume commands require the `binding.epoch` observed by the caller. The runtime rejects stale expectations before evaluating an author or mutating task state; the carrier never substitutes a fresh epoch. See the [binding-command upgrade guide](../upgrade-guide/v0.2.0-rc.2/task-strategy-binding-commands/guide.md).

`submitTask` reserves the original request id, then selects automatically or plans directly with a named strategy. Automatic selection uses the original child structured capture and creates an owned Job only after cleanup; failures never silently change strategies. Users may choose through the original timed question, unanswered questions still allow execution, and late answers never repeat a task. The original Plugins page exposes Task strategies defaults, routes and deadlines. See the [selection upgrade guide](../upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.md).

Catalogue entries include explainable child-token costs. The registry estimates declared plans at registration; an original task and preferences refine the estimate without evaluating the author. Optional scenario assumptions price expected calls, extra context and output transfer. The selector receives the task-specific catalogue and the Plugins page shows baseline costs and uncertainty. Unknown cost is not zero; parent and selector usage are excluded. See the [estimation contract](../../packages/experimental/task-strategy/README.md#token-estimates) and [migration](../upgrade-guide/v0.2.0-rc.2/task-strategy-cost-catalog/guide.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskruns--taskruns"></a>

### `ctx.taskRuns` — `TaskRuns`

Task state and original Job ownership, independent of author policies.

```ts cordis-catalog
/**
 * Mount an executor for the calling plugin's lifetime.
 * @param provider - cancellable execution adapter; it does not own task state.
 * @returns effect-scoped registration disposer.
 */
registerExecutor(provider: TaskExecutorProvider): () => void

/**
 * Describe mounted execution adapters without initializing products.
 * @returns detached adapter identities and descriptions.
 */
listExecutors(): { id: string; description: string }[]

/**
 * Validate execution choices without accepting a Job.
 * @param plan - detached execution plan.
 * @param rules - explicit deployment limits and permitted capabilities.
 * @param signal - admission cancellation.
 * @returns settlement after temporary admission resources are released.
 */
prepare(plan: ExecutionPlan, rules: TaskRuntimeRules, signal: AbortSignal): Promise<void>

/**
 * Start an explicit plan under its exact live owner.
 * @param parent - original live Agent owning the Job.
 * @param task - unchanged user task.
 * @param plan - explicit execution choices.
 * @param rules - explicit deployment limits and permitted capabilities.
 * @param signal - admission cancellation; accepted Jobs own cancellation.
 * @returns original Job identity after admission.
 */
start(parent: Agent, task: string, plan: ExecutionPlan, rules: TaskRuntimeRules, signal: AbortSignal): Promise<JobId>

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
async startCaptured(parent: Agent, task: string, strategy: CapturedStrategy, rules: TaskRuntimeRules, signal: AbortSignal, additionalContext?: () => string): Promise<JobId>

/**
 * Inspect task state using the exact owning Agent.
 * @param parent - exact live owner.
 * @param jobId - original Job identity.
 * @returns detached binding and cumulative task state.
 */
inspect(parent: Agent, jobId: JobId): TaskRunView

/**
 * Send an adjustment to one currently executing local member under the original owner.
 * @param parent - exact live Agent owning this task.
 * @param jobId - original Job identity.
 * @param request - active child identity and nonempty text within captured maxPlanBytes.
 * @param signal - caller cancellation, combined with the accepted task lifetime.
 * @returns inbox acceptance identity, without claiming processing or adoption.
 */
async sendMessage(parent: Agent, jobId: JobId, request: TaskMessageRequest, signal: AbortSignal): Promise<TaskMessageReceipt>

/**
 * Request cancellation through the original Jobs service after checking task ownership.
 * @param parent - exact live owner.
 * @param jobId - original Job identity.
 * @param reason - optional cancellation detail.
 * @returns original Jobs cancellation disposition; completion still awaits child cleanup.
 */
cancel(parent: Agent, jobId: JobId, reason?: string): 'requested' | 'already-finished'

/**
 * Reserve a synchronous binding replacement at the next drained stage boundary.
 * @param parent - exact live owner.
 * @param jobId - original Job identity.
 * @param resolve - synchronous policy capture from the unchanged task text.
 * @param request - observed binding epoch and optional target cursor.
 * @returns reservation command number.
 */
requestSwitch(parent: Agent, jobId: JobId, resolve: (task: string) => CapturedStrategy, request: Pick<TaskSwitch, 'expectedBindingEpoch' | 'startStage'>): number

/**
 * Resume a retained waiting binding.
 * @param parent - exact live owner.
 * @param jobId - original Job identity.
 * @param epoch - observed binding epoch.
 */
resume(parent: Agent, jobId: JobId, epoch: number): void
```

Types: [Agent](core.md) · [JobId](jobs.md)

Source: [`packages/experimental/task-strategy/src/task-runtime-service.ts`](../../packages/experimental/task-strategy/src/task-runtime-service.ts)

<a id="ctxtaskstrategies--taskstrategies"></a>

### `ctx.taskStrategies` — `TaskStrategies`

DSH integration; author strategy identities remain outside the plugin registry.

```ts cordis-catalog
/**
 * Register an author strategy under the caller's Cordis lifetime.
 * @param strategy - independent decision function, not a plugin declaration.
 * @returns effect-scoped registration disposer.
 */
register(strategy: AuthorStrategy): () => void

/**
 * List registered author policies without evaluating them.
 * @param input - optional original task and preferences for task-specific estimates.
 * @returns detached descriptions and child-cost estimates.
 */
list(input?: StrategyInput): StrategyCatalogEntry[]

/**
 * Describe the author policies and permitted child compositions.
 * @returns detached strategies and the permitted original DSH preset names.
 */
@Remote catalog(): { strategies: StrategyCatalogEntry[]; presets: string[]; entryEnabled: boolean }

/**
 * Publish a plugin-owned composer mode under the current registration lifetime.
 * @param mode - plugin-owned composer mode.
 * @param executor - optional permitted external executor; omission uses original DSH strategies.
 * @param check - live backend check.
 * @returns scoped disposer.
 */
registerOrchestration(mode: OrchestrationMode, executor?: string, check: () => void = () => {}): () => void

/**
 * Read the root session's acknowledged mode and current backend availability.
 * @param args - live root session identity.
 * @returns current choice and available plugins.
 */
@Remote orchestration(args: { sessionId: SessionId }): OrchestrationState

/**
 * Select a plugin for future new tasks without changing an accepted run.
 * @param args - live root session and requested mode.
 * @returns choice after Host validation.
 */
@Remote selectOrchestration(args: { sessionId: SessionId; mode: string }): OrchestrationState

/**
 * Capture the original mode registration before asynchronous intake routing.
 * @param owner - exact root task owner.
 * @returns captured mode resolver for this intake.
 */
captureOrchestration(owner: Agent): () => string | undefined

/**
 * Capture configuration values for one intake; later composer changes affect only later tasks.
 * @param owner - exact live root owner.
 * @returns detached string-valued preferences.
 */
captureOrchestrationPreferences(owner: Agent): Readonly<Record<string, string>>

/**
 * Create an identified, unaccepted task suggestion without granting permissions or starting a Job.
 * @param args - root identity and immutable suggestion payload.
 * @returns detached, logged proposal view.
 */
@Remote proposeEntry(args: { sessionId: SessionId; proposalId: string; task: string; strategy?: string }): EntryView

/**
 * Human UI acceptance of an owned proposal; repeated acceptance returns its retained operation.
 * @param args - exact live root and owned proposal identity.
 * @returns the retained acceptance operation, including a receipt or explicit failure.
 */
@Remote acceptProposal(args: { sessionId: SessionId; proposalId: string }): Promise<EntryView>

/**
 * Select a budget tier for subsequent style tasks after validating the live plugin.
 * @param args - live root identity and requested tier.
 * @returns Host-acknowledged selection after validation.
 */
@Remote selectWorkflowTier(args: { sessionId: SessionId; tier: string }): OrchestrationState

/**
 * Read current intake snapshots for an exact live root session.
 * @param args - root session identity; an absent live owner returns an empty list.
 * @returns detached intake and execution snapshots, without result bodies.
 */
@Remote entryState(args: { sessionId: SessionId }): EntryView[]

/**
 * Cancel an owned intake or its accepted Job.
 * @param args - live root session and its request identity.
 */
@Remote cancelEntry(args: { sessionId: SessionId; requestId: string }): void

/**
 * Reserve an owned task replacement at the next stage boundary.
 * @param args - live root, owned request and replacement with observed binding epoch.
 */
@Remote switchEntry(args: { sessionId: SessionId; requestId: string; request: TaskSwitch }): void

/**
 * Resume an owned waiting binding using the observed epoch.
 * @param args - live root, owned request and observed retained binding epoch.
 */
@Remote resumeEntry(args: { sessionId: SessionId; requestId: string; epoch: number }): void

/**
 * Evaluate an author policy and validate its execution choices.
 * @param id - author strategy name.
 * @param input - task and preferences.
 * @returns detached plan; rejects unavailable or disallowed compositions.
 */
async decide(id: string, input: StrategyInput): Promise<ExecutionPlan>

/**
 * Submit a named task once per request id under the exact live owner.
 * @param parent - live root Agent owning the original Job.
 * @param request - stable request id, task, strategy and preferences.
 * @param signal - first submitter's admission signal; accepted work uses Jobs cancellation.
 * @returns shared acceptance promise for equal concurrent or repeated requests.
 */
submit(parent: Agent, request: TaskSubmission, signal: AbortSignal): Promise<TaskReceipt>

/**
 * Select automatically or honor a named choice before accepting one original Job.
 * @param parent - exact live root Agent owning the request.
 * @param request - stable original id, unchanged task and optional choice.
 * @param signal - first submitter's cancellation until acceptance.
 * @returns shared receipt including the chosen strategy, after selector cleanup.
 */
submitTask(parent: Agent, request: TaskIntakeRequest, signal: AbortSignal): Promise<TaskReceipt>

/**
 * Read the committed binding and cumulative state of an owned run.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity, unchanged across switches.
 * @returns detached task view; rejects foreign or unavailable Jobs.
 */
inspect(parent: Agent, jobId: JobId): TaskRunView

/**
 * Deliver an adjustment through the original task owner's Subagents channel.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity.
 * @param request - currently active DSH member and bounded nonempty text.
 * @param signal - cancellation of unaccepted delivery.
 * @returns inbox acceptance identity, not processing or adoption.
 */
sendMessage(parent: Agent, jobId: JobId, request: TaskMessageRequest, signal: AbortSignal): Promise<TaskMessageReceipt>

/**
 * Reserve replacement by a current named strategy at the next stage barrier.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity.
 * @param request - target strategy, observed binding epoch, preferences and optional explicit stage cursor.
 * @returns reservation command number; inspect state or Job output for commitment or failure.
 */
requestSwitch(parent: Agent, jobId: JobId, request: TaskSwitch): number

/**
 * Continue the retained strategy after a rejected replacement.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - waiting task identity.
 * @param expectedBindingEpoch - binding epoch observed by the caller; stale expectations cannot resume a different binding.
 */
resume(parent: Agent, jobId: JobId, expectedBindingEpoch: number): void

/**
 * Start an original DSH owned job from an upper-authored or policy-authored plan.
 * @param parent - exact live upper Agent owning the run.
 * @param task - nonblank user task shared with all stages, preserving its whitespace.
 * @param plan - captured execution choices.
 * @param signal - admission cancellation; after acceptance use original job cancellation.
 * @returns original DSH job identity; rejects invalid plans before starting work.
 */
async start(parent: Agent, task: string, plan: ExecutionPlan, signal: AbortSignal): Promise<JobId>
```

Types: [Agent](core.md) · [JobId](jobs.md) · [SessionId](core.md)

Source: [`packages/experimental/task-strategy/src/cordis.ts`](../../packages/experimental/task-strategy/src/cordis.ts)
<!-- END GENERATED cordis-surface -->
