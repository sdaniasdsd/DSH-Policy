# 任务策略

[English](task-strategy.md) | 中文

实验性的 task-strategy 库将作者的工作流决策与 DSH 插件身份分开。它的可选 Cordis 载体仅通过显式 profile patch 加载。启用后，`ctx.taskStrategies` 会校验有序计划，并通过 DSH 现有的 preset、subagent 和 Jobs 服务分发各个下层任务；下层 agent 不会获得策略控制工具。

阶段按顺序执行，作者通过 `maxConcurrent` 决定同阶段并发数，或通过 `serial` 指定串行。只有阶段省略并发数时才使用载体默认值。分发前会检查预设与工具过滤器，进度记入 DSH 自有 job。卸载载体会移除其注册，但已接收的 Job 继续遵循 Jobs 服务的生命周期；需要显式取消时使用 `job_kill`。并发任务仍可能共享文件，因此作者需要协调写入。任务轮次结束仅表示子任务已结束，不代表其输出经过独立验证。

计划格式和 profile patch 示例见[包文档](../../packages/experimental/task-strategy/README.zh.md)。

`ctx.taskStrategies` 负责策略注册、成本与选择，独立挂载的 `ctx.taskRuns` 服务负责显式计划、自有 Jobs、执行适配器注册和阶段控制。`TaskRuntimeRules` 捕获部署限额以及允许的预设/执行器，`TaskExecutorProvider` 提供同步可用性检查与可取消的子任务执行，并负责清理；`TaskRunView` 仍由任务持有。`CapturedStrategy` 绑定不可变的计划修订，`EntryView` 暴露记录下来的根入口状态。原生产品适配器是可独立移除的插件，见包的[运行与插件契约](../../packages/experimental/task-strategy/README.zh.md#runtime-plugins)。

`AuthorStrategy.decide` 和 `StrategyRegistry.decide` 同步生成独立的计划数据，异步工作归执行层管理。载体的 `ctx.taskStrategies.decide` 还执行准入，因此仍为异步。作者要求见包文档。

宿主调用方可以用所属 Agent 范围内的 `requestId` 提交命名策略，读取任务保留的状态，并在阶段排空后的边界请求替换。替换期间 JobId 保持固定，已有结果和累计子任务额度继续保留；替换失败时等待明确恢复或再次切换。宿主控制及进程内状态定义见 [runtime-types.ts](../../packages/experimental/task-strategy/src/runtime-types.ts)，根模型工具提供提交、列出、计划、执行、查询、发送消息及通用记录操作。

| 类型 | 宿主职责 |
|---|---|
| `TaskSubmission` | 一次接收的请求 id、任务输入、策略及偏好 |
| `TaskIntakeRequest` | 原始请求 id、任务及可选的自动或指定策略；省略选择时捕获插件默认值 |
| `TaskReceipt` | 已接收的 JobId、初始计划名及所选策略，不是完成报告 |
| `TaskSwitch` | 目标策略、已观察到的绑定版本、偏好和显式的零基起始游标 |
| `TaskRunView` | 已提交绑定、阶段、保留结果、累计用量及待处理切换 |
| `TaskMemberView` | 一个活跃本地子任务的会话身份与标签 |
| `TaskMessageRequest` | 活跃子任务身份与非空调整文本 |
| `TaskMessageReceipt` | 已接收消息身份；不表示已处理或已采纳 |
| `TaskSharedRecord` | 调用方定义的 JSON 值及任务范围 key、版本和写入者 |
| `TaskRecordWaitResult` | 新记录或有界超时结果 |
| `TaskCoordination` | 向执行器提供的通用记录与保留发送者身份的成员消息 |

本地 `TaskStep.continuation` 设置通过额外激活次数及可选的单次续跑时限，限制输出截断后的同会话恢复。阶段保留目标、前序结果和子会话身份；恢复额度耗尽不会推进依赖阶段。参见[执行契约](../../packages/experimental/task-strategy/README.zh.md)和[迁移说明](../upgrade-guide/v1.0.2/task-strategy-output-recovery/guide.zh.md)。

任务协调沿用原版 Job owner 和 Subagents 消息通道。`inspect(parent, jobId)` 返回独立复制的 `activeMembers`，成员格式为 `{ sessionId, label }`；`ctx.taskRuns` 与 `ctx.taskStrategies` 上的 `sendMessage(parent, jobId, { childId, text }, signal)` 在收件箱接收后只返回 `{ messageId }`。目标必须属于该任务且仍在执行。其他 owner、已停止任务、空闲或结束的子会话及原生执行器目标会被拒绝，不会唤醒会话或切换后端。消息文本必须非空，完整序列化请求的 UTF-8 字节数不能超过任务接收时捕获的 `maxPlanBytes`；调用方或任务取消会中止尚未接收的投递。收件箱接受后，取消不会撤回消息，发送方仍会收到收据。接收不代表已处理或已采纳决策，已接收消息不会自动重试。

根模型工具 `task_strategy_inspect(jobId)`、`task_strategy_message(jobId, childId, text)` 和 `task_strategy_record_{read,list,write,wait}` 使用同一套归属检查，名称跟随 `toolPrefix`。记录由原始 Job 隔离；`write` 按 `expectedRevision` 比较并交换，`wait` 等待版本变化或超时。记录 key 和 JSON value 的语义由调用方定义。自动根入口开启时工具可用，载体卸载时移除；执行子任务保留原有工具。DSH 只提供通用基础能力与统一 LLM 工具入口，不新增插件专属适配，不决定策略命令格式或业务流程。

宿主调用方可通过 `ctx.taskRuns` 与 `ctx.taskStrategies` 的 `recordRead`、`recordList`、`recordWrite` 和 `recordWait` 操作记录；执行器回调可通过 `TaskExecutorContext.coordination` 使用同一组能力。记录写入在返回前持久化新版本；事件追加后到达的取消不会隐藏通过持久化校验的版本收据。旧 `expectedRevision` 会因版本冲突失败。记录作为 owner Session 插件记录跨载体重挂保留，但运行时 API 要求原 Job 仍处于活动期。

在保留同一模块和 Jobs 服务时重新挂载载体会保留活跃任务，进程重启不会。已接收任务的部署规则保持固定，提供方和预设的可用性则在准入时检查。执行恢复限制见包文档的[限制说明](../../packages/experimental/task-strategy/README.zh.md#known-limitations-and-deferred-work)。

`entry.enabled` 可将原始根用户消息通过有界意图分类接入原有策略受理。 策略版 bundle 默认开启，标准产品默认关闭。根业务工具受到展示过滤和执行检查； 子任务保留原有预设与权限规则。聊天卡片将已记录入口事实合并为策略、成本和阶段进度， 提供所属取消及带版本的切换/继续控制。补充文本进入下一尚未开始阶段，无后续阶段时明确拒绝；有界前文参与路由和执行； 进程重启只恢复已中断的展示，不启动工作。 见[入口升级指南](../upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.zh.md)。

切换与恢复命令要求调用方观察到的 `binding.epoch`。运行时在执行作者函数或改变任务状态之前拒绝过期的预期值，载体不会替换成最新版本。参见[绑定命令升级指南](../upgrade-guide/v0.2.0-rc.2/task-strategy-binding-commands/guide.zh.md)。

`submitTask` 在预留原始请求标识后进行自动选择，或按指定策略直接规划。自动选择使用原版子 Agent 的结构化捕获，清理完成后才创建所属 Job；选择失败不静默改用其他策略。用户可先通过原版限时提问选择，未答复仍可继续，迟到答复不重复任务。原版插件页的“任务策略”提供默认模式、路由和截止时间设置。见[选择升级指南](../upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.zh.md)。

目录条目包含可解释的子任务 Token 成本。注册表在注册时估算声明式计划，原任务与偏好可细化估算而不执行作者函数。可选场景假设估算预期调用、额外上下文和输出传递。选择器接收任务目录，插件页展示基线成本与未知项。未知成本不是零，不计入父任务与选择器用量。参见[估算契约](../../packages/experimental/task-strategy/README.zh.md#token-estimates)与[迁移说明](../upgrade-guide/v0.2.0-rc.2/task-strategy-cost-catalog/guide.zh.md)。

执行器可选择使用第五个 `context?: TaskExecutorContext` 参数。其 `members` 接口打开允许的本地 DSH 预设，观察真实轮次结果，并在原 Job 内显式继续所属会话。`coordination` 提供通用共享记录与成员消息接口。继续输入由原任务的精确 owner 发送。活跃成员查询只列出正在执行的轮次。控制步骤及已尝试的成员准入消耗捕获的累计任务额度；本地轮次共用当前阶段的并发额度，阶段显式设置可将额度提高到载体默认值以上。完整请求及结果仍受部署上限约束。执行器结算时关闭准入并排空成员。未捕获到结果时返回携带已接收身份的 `unobserved`，不自动重放。失败、取消及未完成保留原始 stopReason。继续成员会话时保留已捕获的 token 上限与结构化提交 schema。具体策略如何使用这些接口由其维护者决定。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Read one task-scoped shared record under the exact owner and Job.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @param key - caller-defined nonempty record key.
 * @returns detached latest record, or undefined when absent.
 */
recordRead(parent: Agent, jobId: JobId, key: string): TaskSharedRecord | undefined

/**
 * List task-scoped shared records under the exact owner and Job.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @returns detached latest records.
 */
recordList(parent: Agent, jobId: JobId): readonly TaskSharedRecord[]

/**
 * Compare-and-set one task-scoped shared record.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @param key - caller-defined nonempty record key.
 * @param value - JSON-serializable record value.
 * @param expectedRevision - observed version, or zero when absent.
 * @param signal - caller cancellation signal.
 * @returns persisted record with the new revision.
 */
recordWrite(parent: Agent, jobId: JobId, key: string, value: unknown, expectedRevision: number, signal: AbortSignal): Promise<TaskSharedRecord>

/**
 * Wait for a task-scoped shared record to advance.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @param key - caller-defined nonempty record key.
 * @param afterRevision - revision already observed by the caller.
 * @param timeoutMs - bounded wait duration.
 * @param signal - caller cancellation signal.
 * @returns the newer record or a timeout result.
 */
recordWait(parent: Agent, jobId: JobId, key: string, afterRevision: number, timeoutMs: number, signal: AbortSignal): Promise<TaskRecordWaitResult>

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
 * @param request - command identity, observed binding epoch and optional target cursor.
 * @returns first recorded outcome for that command identity.
 */
requestSwitch(parent: Agent, jobId: JobId, resolve: (task: string) => CapturedStrategy, request: Pick<TaskSwitch, 'commandId' | 'expectedBindingEpoch' | 'startStage'>): TaskCommandOutcome

/**
 * Resume a retained waiting binding.
 * @param parent - exact live owner.
 * @param jobId - original Job identity.
 * @param request - command identity and observed binding epoch.
 * @returns first recorded outcome for that command identity.
 */
resume(parent: Agent, jobId: JobId, request: Pick<TaskSwitch, 'commandId' | 'expectedBindingEpoch'>): TaskCommandOutcome

/**
 * Await one submitted control command's settled outcome.
 * @param parent - exact live owner.
 * @param jobId - original Job identity.
 * @param commandId - identity already submitted to this run.
 * @param timeoutMs - bounded wait in milliseconds.
 * @param signal - caller cancellation.
 * @returns the settled outcome, or a timeout marker when the command stays queued.
 */
waitCommand(parent: Agent, jobId: JobId, commandId: string, timeoutMs: number, signal: AbortSignal): Promise<TaskCommandWaitResult>
```

Types: [Agent](core.zh.md) · [JobId](jobs.zh.md)

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
 * @param args - live root, owned request and replacement with command identity and observed binding epoch.
 * @returns recorded outcome for that command identity.
 */
@Remote switchEntry(args: { sessionId: SessionId; requestId: string; request: TaskSwitch }): TaskCommandOutcome

/**
 * Resume an owned waiting binding using the observed epoch.
 * @param args - live root, owned request, command identity and observed retained binding epoch.
 * @returns recorded outcome for that command identity.
 */
@Remote resumeEntry(args: { sessionId: SessionId; requestId: string; commandId: string; epoch: number }): TaskCommandOutcome

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
 * Read one generic record owned by the exact task Job.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @param key - caller-defined nonempty record key.
 * @returns detached latest record, or undefined when absent.
 */
recordRead(parent: Agent, jobId: JobId, key: string): TaskSharedRecord | undefined

/**
 * List generic records owned by the exact task Job.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @returns detached latest records.
 */
recordList(parent: Agent, jobId: JobId): readonly TaskSharedRecord[]

/**
 * Compare-and-set a generic record owned by the exact task Job.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @param key - caller-defined nonempty record key.
 * @param value - JSON-serializable record value.
 * @param expectedRevision - observed version, or zero when absent.
 * @param signal - caller cancellation signal.
 * @returns persisted record with the new revision.
 */
recordWrite(parent: Agent, jobId: JobId, key: string, value: unknown, expectedRevision: number, signal: AbortSignal): Promise<TaskSharedRecord>

/**
 * Wait for a generic record owned by the exact task Job to advance.
 * @param parent - exact live owner Agent.
 * @param jobId - original task Job identity.
 * @param key - caller-defined nonempty record key.
 * @param afterRevision - revision already observed by the caller.
 * @param timeoutMs - bounded wait duration.
 * @param signal - caller cancellation signal.
 * @returns the newer record or a timeout result.
 */
recordWait(parent: Agent, jobId: JobId, key: string, afterRevision: number, timeoutMs: number, signal: AbortSignal): Promise<TaskRecordWaitResult>

/**
 * Reserve replacement by a current named strategy at the next stage barrier.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity.
 * @param request - target strategy, command identity, observed binding epoch, preferences and optional explicit stage cursor.
 * @returns recorded outcome for that command identity; inspect state or Job output for commitment or failure.
 */
requestSwitch(parent: Agent, jobId: JobId, request: TaskSwitch): TaskCommandOutcome

/**
 * Continue the retained strategy after a rejected replacement.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - waiting task identity.
 * @param request - command identity and binding epoch observed by the caller; stale expectations cannot resume a different binding.
 * @returns recorded outcome for that command identity.
 */
resume(parent: Agent, jobId: JobId, request: Pick<TaskSwitch, 'commandId' | 'expectedBindingEpoch'>): TaskCommandOutcome

/**
 * Await one submitted replacement command's settled outcome.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity.
 * @param commandId - identity already submitted for this task.
 * @param timeoutMs - bounded wait in milliseconds.
 * @param signal - caller cancellation.
 * @returns the settled outcome, or a timeout marker when the command stays queued.
 */
waitCommand(parent: Agent, jobId: JobId, commandId: string, timeoutMs: number, signal: AbortSignal): Promise<TaskCommandWaitResult>

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

Types: [Agent](core.zh.md) · [JobId](jobs.zh.md) · [SessionId](core.zh.md)

Source: [`packages/experimental/task-strategy/src/cordis.ts`](../../packages/experimental/task-strategy/src/cordis.ts)
<!-- END GENERATED cordis-surface -->
