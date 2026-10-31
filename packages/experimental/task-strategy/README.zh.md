---
description: "独立于 DSH 插件的作者工作流策略，以及可显式接入的 Cordis 载体。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-task-strategy

[English](README.md) | 中文

## 概述

作者可以编写命名策略，决定任务阶段、子任务插件预设、工具限制及模型路由。主入口是普通代码库：策略身份不进入 DSH 插件注册表。可选的 `./cordis` 载体沿用其他服务的 Cordis 接入方式，通过原版 DSH 子任务和自有 Jobs 执行。默认产品组合保持不变。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

<a id="token-estimates"></a>
### 可解释的 Token 估算

`list()` 返回每条策略的 `cost`；`list({ task, preferences })` 按任务和匹配的偏好变体细化估算，不调用 `decide`。载体复用 DSH 的 TokenMeter，并依赖该服务。独立注册表通过构造函数接收文本估算器；缺少估算器或动态策略未声明估算计划时，成本显示未知。

声明式策略可设置 `tokenCost: { callsPerTask, contextTokensPerCall, outputTokensPerCall }`。所有值必须为安全整数，调用数为正，上下文与输出可为零。这些显式场景假设估算重复输入、生成输出及向后续阶段的传递，不限制执行。未配置假设时，目录只报告已知任务/指令/结果结构输入及任务/阶段数，不提供总量。会话标识、JSON 转义、实际历史、推理、分词与缓存影响仍不确定。不计入父任务和选择器用量。

使用 `task_strategy_list({ task, preferences? })` 向模型提供估算。自动选择获得同一份任务估算数据，先满足任务要求，再比较成本。原版插件页展示注册成本、假设和未知项。注册估算不含任务正文；这是近似值，不是账单用量或保证的边界。

[可选工作流配置](../../../strategies/workflows.patch.yml) 为编程、论文调研、问题研究和方案规划提供三档策略，数值都是可编辑的场景假设。参见[配置与档位选择](../../../strategies/README.zh.md#workflow-library)。

### 独立的作者决策

任务正文必须包含非空白字符。决策、预览与分发在调用作者函数或准入子任务之前拒绝空白任务，已接收文本保留原有空白。

`AuthorStrategy.decide` 和 `StrategyRegistry.decide` 同步返回 `ExecutionPlan`；作者错误同步抛出。策略函数必须是可信、有限且不执行 I/O 的计划计算。异步调研、模型调用与工具执行交给支持取消的执行层。载体的 `ctx.taskStrategies.decide` 仍返回 Promise，因为它还执行异步准入检查。旧作者接口的迁移步骤见[同步决策升级说明](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-synchronous-decisions/guide.zh.md)。

从主入口导入 `StrategyRegistry` 和 `executePlan`。注册 `{ id, description, decide(input) }`；决策接收 `{ task, preferences }` 并返回 `ExecutionPlan`。`register` 返回注销函数，重名会拒绝。决策及输入均是独立快照。计划包含顺序阶段，同一阶段内的任务按 `maxConcurrent` 并发。每个任务指定 `label`、`instruction`，并且恰好选择一个 `preset` 或 `executor`。原生预设任务还可附加 `tools: { allow, deny }`、`model`、`provider`。纯执行器接收你提供的支持取消的 `TaskExecutor`；该回调必须在资源释放之后结算。

<a id="runtime-plugins"></a>

### 任务运行与编排插件

输入栏在模型选择左侧展示编排模式。DSH 使用自动或指定任务策略；`*-style` 模式使用 DSH 执行，`*-native` 模式使用单独配置的原生后端。插件通过 `taskStrategies.registerOrchestration(mode, executor?, check?)` 注册模式；`orchestration({ sessionId })` 返回可用性，`selectOrchestration({ sessionId, mode })` 确认当前会话的选择。它作用于新派发任务，优先于自动策略选择，宿主 owner 重启后重置。入口捕获精确插件注册；卸载后拒绝尚未准入的新任务，不会静默替换后端。运行中的 Job 保留已捕获适配器。未配置模式会显示为不可选。

在 `./cordis` 旁加载 `@deepseek-ai/dsh-experimental-task-strategy/runtime`；工作流 bundle 已包含两者。`ctx.taskStrategies` 负责策略注册、成本估算和选择，`ctx.taskRuns` 负责计划准入、阶段状态和原版 Jobs，现有策略控制方法委托给它。外部调用者无需注册策略即可使用 `taskRuns.start(parent, task, plan, rules, signal)`，读取精确 owner 的状态，在阶段排水边界预约捕获后的替换计划，并按观察到的绑定 epoch 恢复。

每条任务必须且只能选择原生 `preset` 或外部 `executor`。`allowedExecutors` 显式授权适配器身份，省略时不允许任何外部执行器。`taskRuns.registerExecutor` 在调用插件的 Cordis 生命周期内注册 `{ id, description, check, execute }`。`check` 同步检查后端可用性；`execute(parent, step, prompt, signal)` 必须响应取消并在子任务释放后结束。外部步骤不能携带 DSH 预设、工具过滤或模型/provider 覆盖，因为原生 provider 无法执行这些限制。卸载后，运行中的子任务保留原有 owner，适配器移除后的新准入会失败。

执行器可选择使用第五个 `context?: TaskExecutorContext` 参数。其 `members` 接口打开允许的本地 DSH 预设，观察真实轮次结果，并在原 Job 内显式继续所属会话。继续输入由原任务的精确 owner 发送。活跃成员查询只列出正在执行的轮次。控制步骤及已尝试的成员准入消耗捕获的累计任务额度；成员并发、完整请求及结果受部署上限约束。执行器结算时关闭准入并排空成员。未捕获到结果时返回携带已接收身份的 `unobserved`，不自动重放。失败、取消及未完成保留原始 stopReason。原生适配器只有作者明确使用该上下文时才创建本地成员；本份未增加原生会话继续、黑板、会议或 Superpowers 恢复策略。

`./plugins/codex`、`./plugins/claude`、`./plugins/zcode` 可独立挂载，各自注册策略与执行器。Codex、Claude 将自主工作派给现有官方 `@deepseek-ai/dsh-subagent-codex`、`@deepseek-ai/dsh-subagent-claude-code` provider。规划、上下文、工具、认证和权限保留在原产品中，启用编排插件前须配置后端 bundle。策略/后端身份、描述和指令可编辑；`tokenCost` 可选提供场景假设，未配置时内部轮数与工具流量保持未知。每条步骤启动一次原生运行，不暴露原生 steering 和会话恢复。

ZCode 使用官方[开源 CLI](https://github.com/zai-org/ZCode)，传入 `--prompt`、`--output-format json`、显式 `--mode` 和可选 `--enable-workflow`。通过 `command` 与可选前置 `args` 指定已安装的可执行文件，路径解析和完整进程范围清理使用原版 DSH subprocess 服务。默认 `mode: plan` 保留规划权限，`build`、`edit`、`yolo` 需要显式配置。超时、清理宽限和提示/结果字节上限可配置。截断、无效 JSON 或非终态投影会被拒绝，退出码为零后仍检查取消。插件不会隐式继承 DSH 凭证或提升权限。

可选[编排补丁](../../../strategies/orchestration.patch.yml) 提供三个禁用插件条目和执行器白名单。通过原版 Plugins 页面分别启用已配置后端，Task strategies 卡片列出它们贡献的策略及成本未知项。缺失后端或可执行文件时明确拒绝，不进行替换。

### 由任务持有的策略替换

`TaskRun` 和 `captureStrategy` 提供执行已捕获静态计划的普通代码库运行时。替换策略后，任务输入、结果、累计子任务准入数和结果字节上限继续保留。`requestSwitch(load, { expectedBindingEpoch, startStage })` 立即预留命令并同步捕获目标计划，当前阶段排空之后才准入并提交新绑定。目标游标是显式的零基下标，默认从零开始。切换被拒绝时进入 `waiting` 并保留旧绑定；`resume(expectedBindingEpoch)` 继续旧绑定，也可以再次切换到其他目标。两种命令都必须携带通过 `inspect()` 观察到的非负安全整数 `binding.epoch`；版本过期会在作者函数执行或状态改变前拒绝。`cancel(reason)` 立即取消活跃执行，在资源回收后结算。`load` 必须同步返回捕获的计划；异步工作归执行层管理。

载体提供宿主方法 `submit(parent, request, signal)`、`inspect(parent, jobId)`、`requestSwitch(parent, jobId, request)` 和 `resume(parent, jobId, expectedBindingEpoch)`。`submit` 要求 `{ requestId, strategy, task, preferences? }`：同一活跃 Agent 的相同请求共享一次准入和回执，同一 id 携带不同内容会拒绝。准入失败会释放预留。第一个提交者的信号控制准入取消，后续重复调用不会取消已接收任务。等待和取消继续使用原版 Jobs 操作。切换请求要求 `{ strategy, expectedBindingEpoch, preferences?, startStage? }`，其中版本来自做出选择时读取的视图。`requestSwitch` 返回预留命令编号，通过 `inspect` 或 Job 日志读取已提交绑定。版本不匹配后，应重新检查任务并明确重新决定命令。这些阶段边界宿主控制接口不添加输入路由。

载体重载后，已接收任务继续使用捕获的部署规则，新载体可以通过同一个活跃 Agent 和 Jobs 服务控制这些任务。切换从当前注册表捕获新选定的计划，再按任务保留的规则准入。因此，如果原任务没有授权某个预设，新配置即使允许了它，也需要创建新任务才能使用。本切片使用原版 JobId 作为任务身份。

任务协调沿用原版 Job owner 和 Subagents 消息通道。`inspect(parent, jobId)` 返回独立复制的 `activeMembers`，成员格式为 `{ sessionId, label }`；`ctx.taskRuns` 与 `ctx.taskStrategies` 上的 `sendMessage(parent, jobId, { childId, text }, signal)` 在收件箱接收后只返回 `{ messageId }`。目标必须属于该任务且仍在执行。其他 owner、已停止任务、空闲或结束的子会话及原生执行器目标会被拒绝，不会唤醒会话或切换后端。消息文本必须非空，完整序列化请求的 UTF-8 字节数不能超过任务接收时捕获的 `maxPlanBytes`；调用方或任务取消会中止尚未接收的投递。收件箱接受后，取消不会撤回消息，发送方仍会收到收据。接收不代表已处理或已采纳决策，已接收消息不会自动重试。

根模型工具 `task_strategy_inspect(jobId)`、`task_strategy_message(jobId, childId, text)` 和 `task_strategy_record_{read,list,write,wait}` 提供通用任务协作能力，名称跟随 `toolPrefix`。记录按原始 Job 隔离；`write` 通过 `expectedRevision` 做比较并交换。Session 事件追加后才到达的取消，不会隐藏通过持久化校验的版本收据；`wait` 等待记录版本变化或超时。记录 key 和 JSON value 的含义由调用者决定。自动根入口开启时这些工具仍可用，载体卸载时移除；执行子任务保留原有工具。查询是当前快照，发送前可能已过期。DSH 只提供能力与统一的 LLM 工具入口，不决定议题格式、风险分类、会议、裁决或策略流程；策略作者自行决定是否及如何使用这些接口。

### 自动入口与可选选择

使用 `submitTask(parent, { requestId, task, selection?, preferences? }, signal)`。省略 selection 捕获插件当前默认值；`{ kind: 'auto' }` 从注册候选中选择；`{ kind: 'named', strategy }` 跳过选择器。回执包含 `{ jobId, name, strategy }`。相同重复请求共享预留的 Promise，冲突输入拒绝，失败入口释放标识。

工具回执保留完整 Job 与策略标识，只缩短过长的显示名称。入口在接受 Job 前，将 JSON 编码的策略标识限制为载体 `maxOutputBytes` 减去 256 字节的原版 Jobs 元数据预算，避免长标识在最低 512 字节上限下破坏回执。

如果重新挂载后调小上限，导致旧回执标识无法完整容纳，重复工具调用会明确报告 Job 已接收并给出其 id。使用 `job_output`，或恢复此前的上限再重复原请求。宿主完整回执和请求预留继续保留，任务不会再次执行。

自动选择使用原版子 Agent，仅提供其本地 `structured_output` 工具，输入包括未改写的任务数据、偏好和捕获的候选描述。默认截止时间为 30,000 毫秒，提示词上限 32,768 字节、结果上限 2,048 字节、输出上限 512 token。路由和选择遇到 `max-tokens` 时，用简短的结构化提交指令重试一次，保留原 token 上限和总截止时间；完整重试提示词必须满足字节上限。其他失败不重试。先清理选择器，再接受任务或使用已配置的兜底。作者决策保持同步。指定入口跳过选择器成本。

输入框的“全自动／自己选”滑动开关折叠手动模式和风格档位控件。配置 `selection.default: { kind: auto, workflow: true }` 后，一个受限 Agent 从全部已注册策略中自主选择、确定风格策略支持的档位并返回简短理由，无需等待偏好回复；固定工作流保留其声明的计划。通过输入框明确切到自动时，后续接单采用这一行为，覆盖部署的指定策略默认值。回执保留初始选择与模型理由，任务估算使用捕获的档位；后续阶段切换继续记录独立的绑定历史。这不改变原版对话／控制路由及权限审批。

滑动开关保留原有布局，增加弹性镜片位移、短暂的高光扫过和使用内嵌边缘图的局部 SVG 背景折射。折射仅作用于装饰滑块，标签文字不加滤镜。每个挂载的开关独立持有滤镜 ID；不添加外部资源、逐帧循环或定时器。减少动画设置关闭位移和高光动画；强制颜色设置使用普通高对比度表面。不支持 SVG 背景滤镜的浏览器保留玻璃表面。

`selection.fallbackStrategy` 可配置自主选择在 Job 接受前失败时使用的已注册兜底策略；风格兜底使用中档。工作流 bundle 配置 `codex-style`。任务卡显示兜底及选择错误。调用者取消、所属 Agent 销毁、所选策略被移除和执行失败都不会触发这一兜底。未配置兜底时，选择失败仍拒绝。旧 `{ kind: auto }` 接单保留只选择策略的行为。

可选提问在 `task_strategy_submit` 之前使用原版限时 `ask_user_question`。没有答复时，仍按配置默认值执行。迟到答复不创建新标识或重复原始任务；已接受任务通过现有宿主控制在阶段边界切换。`entry.enabled: false` 时，普通聊天通过原有模型循环显式使用策略工具。

### 自动根入口

路由先校验工具声明的完整输出，再只保留所选意图使用的字段。`chat` 或 `clarify` 中多余的已声明任务字段会被忽略；未知字段、相关字段的无效值和缺少必填项的切换命令仍被拒绝，不执行工作。

路由和自动选择使用模型明确声明的 `off` 或 `none` 推理档位，否则使用其声明的最低档位；能力未知时保留继承值。它们保持各自的输出上限；执行层保留原来的推理档位。路由接收原始内容，不接收传输消息标识，控制目标只能来自提供的所属任务。状态查询未指定目标时读取唯一活动任务；没有活动任务时读取最近的终态任务。修改类控制不使用这个终态兜底，状态查询不会派发新 Job。

`entry.enabled: true` 在模型步骤前路由每条原始根用户消息。独立载体默认关闭， 策略版工作流 bundle 默认开启。插件页通过原有版本化配置表单保存此开关， 作用于未来输入。普通对话留在根 Agent；需要执行的工作在有界路由和策略选择后， 进入一个原版所属 Job。自动选择不需要用户答复；路由或选择失败不会直接执行。 根 Agent 的原生工具与 PTC 业务调用限制为任务控制，执行子任务保留选定预设和原有权限。

聊天卡片在尚无 Job 时显示路由，接收后显示策略、子任务 Token 场景估算及真实阶段计数。 取消、切换和继续使用宿主所属请求身份及已观察到的绑定版本。 补充文本在下一尚未开始阶段读取一次；正在执行的最后阶段明确拒绝补充。路由和执行接收有界的前文作为上下文数据，原始输入保留。非文本执行输入明确拒绝，原始附件仍保留记录。 入口事实支持载体重载；进程重启只恢复展示，旧工作显示已中断，不重复派发。 见[升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.zh.md)。

Web 部分在原版插件页注册**任务策略**，通过草稿表单和带版本检查的写入，编辑默认模式/名称、模型/provider 路由及截止时间。字节和 token 限制保留在 Loader 配置中。实时 `Volatile` 引用影响未来入口；已接受 Job 保留捕获的规则。目录读取丢弃重连/卸载后的旧响应，刷新失败保留已显示的条目。生成的 Remote 暴露目录及带 owner 校验的入口状态、取消、切换和恢复控制。参见[选择升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.zh.md)。

### DSH 源码试用

在仓库根目录使用受支持的命名 profile 启动入口：

```powershell
node --import tsx/esm apps/cli/lib/bin.js --profile web --patch packages/experimental/task-strategy/cordis.source.patch.yml --no-open --port 3090
```

原版 ConfigEditor 会拒绝被命令行覆盖层覆盖的保存，页面保留草稿并报告失败。需要可编辑的插件默认值时，将覆盖文件的 insert 行复制到活跃的 `<DSH_HOME>/profiles/web/cordis.patch.yml`，将载体的相对名称改为源码的绝对 file URL（通过 Node 的 `pathToFileURL` 获得），或已安装的 `@deepseek-ai/dsh-experimental-task-strategy/cordis` 导出入口；启动该 profile 时省略策略 `--patch`。配置持久化随后由 profile 补丁负责。使用 file URL 是因为原编辑器预览与 profile 加载对本地路径名称的归一化不一致，可能将合法保存误判为覆盖冲突。

修改 [cordis.source.patch.yml](cordis.source.patch.yml) 编写自己的策略偏好和流程。`direct` 使用一个原版 DSH 子任务。`cautious` 并发运行两个只能读取、搜索的子任务，然后运行一个实现子任务；`preferences: { speed: "fast" }` 切换为短流程。`allowedPresets` 明确允许可选择的原版 DSH 插件预设。选择预设不会授予文件系统或审批权限。省略工具过滤器会保留预设工具，显式空白名单则不暴露任何工具。

独立载体提供 `ctx.taskStrategies`：`register`、`list`、`catalog`、`decide`、`start`。它注入原版 `agents`、`tools`、`subagents`、`agentPresets`、`jobs` 和 `tokenMeter`。作者可以在调用方 Cordis 生命周期内注册 JavaScript 决策函数，也可以通过载体配置声明按偏好选择的计划。根 Agent 获得 `task_strategy_submit`、`task_strategy_list`、`task_strategy_plan`、`task_strategy_run`，下层子任务不会继承这些控制工具。上层可以选择命名策略或提交显式计划，但只能选择允许的预设。使用原版 `job_list`、`job_output`、`job_kill` 查看或取消；进度包含阶段名与已完成子任务的会话身份。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

注册表只做决策，不加载插件。执行器实施阶段屏障、并发限制、任务数及结果字节上限，将标注的前阶段输出作为数据传递。任务服务在创建 Job 前检查提供方能力、预设和外部执行器。原版 DSH 进程内驱动在子任务发布前挂载选定预设；权限委托、模型循环、结算及回收仍走原版。一项子任务失败会停止准入并取消兄弟任务，当前阶段排空之后才终止。载体卸载会移除策略注册和工具，但不会取消或等待已经被 Jobs 接收的任务。每个已接收任务保留启动时捕获的计划和限制，并且仍可通过 `job_kill`、所属 Agent 销毁或 Jobs 后端关闭来取消。原有子系统不变量负责 Agent、子任务、预设、工具、Job 所有权，本代码库没有独立注册的不变量。

本地预设步骤遇到 `max-tokens` 时，携带原阶段目标继续同一个子 Agent 会话。续跑保留对话历史、读取证据和累计用量，拼合已输出的答案文字，前后精确重叠的部分只保留一次，并恢复结构化结果捕获。它属于原逻辑任务，继续占用原并发位置，不额外消耗任务准入额度。提示词要求先检查已有文件，以小工具调用完成剩余工作并验证；被截断的调用不能证明已执行。Token 成本估算不终止执行。执行器自行管理的成员仍通过成员接口显式续跑。

`TaskStep.continuation.maxAttempts` 允许额外续跑 0–16 次，默认四次。连续两次续跑既无新增拼合文字、也无成功工具结果时停止恢复；这些信号只能判断活动，不能证明任务正确。`continuation.timeoutMs` 可在已截断轮次结算并清理后，为下一次续跑提供新的有限时限；不配置则保留原 `timeoutMs` 截止时间。风格插件默认四次续跑，每次 300,000 毫秒，极端高档为 600,000 毫秒，另计首轮时限。父任务取消和真实执行错误不触发自动重放。恢复额度耗尽、超时或续跑启动失败时，保留部分输出、会话标识和诊断，后续阶段不运行。这是在进程内继续同一会话，不提供进程重启恢复或文件回滚。

`TaskRun` 持有任务状态，并将阶段执行委托给 `executor`。两个共性数据模块服务于全部策略：`execution-data` 拼装历史结果提示词，并按完整 UTF-8 JSON 核算有序结果；`run-projection` 汇总用量、当前绑定的证据，并生成独立策略快照。这些同步辅助模块不持有 Agent、权限或取消控制器。它们是本包的内部模块，无需单独注册插件。上下文序列化、结果核算和状态投影可在此维护，无需按编排风格增加分支；提示词保留完整历史结果，字节上限包含结果元数据。

生命周期决策及边界说明见[已接收 Job 的生命周期决策记录](../../../.agents/notes/implemented/architecture/2026-10-05-task-strategy-job-lifetime.zh.md)。

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 独立作者策略注册表 |
| [src/types.ts](src/types.ts) | 计划与执行器契约 |
| [src/executor.ts](src/executor.ts) | 顺序阶段与有界并发 |
| [src/execution-data.ts](src/execution-data.ts) | 共用阶段提示词与有序结果字节核算 |
| [src/errors.ts](src/errors.ts) | 保证预留结算与清理继续进行的异常转换 |
| [src/task-input.ts](src/task-input.ts) | 统一校验非空任务并保留已接收文本 |
| [src/runtime-types.ts](src/runtime-types.ts) | 任务视图、捕获的绑定和宿主请求 |
| [src/static-plan.ts](src/static-plan.ts) | 独立计划版本和显式阶段选择 |
| [src/task-run.ts](src/task-run.ts) | 任务状态、阶段屏障、替换和取消 |
| [src/run-projection.ts](src/run-projection.ts) | 共用用量汇总、当前绑定证据与独立策略快照 |
| [src/admission.ts](src/admission.ts) | 捕获的提供方、预设和工具准入规则 |
| [src/task-submissions.ts](src/task-submissions.ts) | 按所属 Agent 预留重复请求和引用活跃任务 |
| [src/cordis.ts](src/cordis.ts) | 可选的原版 DSH 接入载体 |
| [src/task-runtime-service.ts](src/task-runtime-service.ts) | 独立的自有任务执行与控制 |
| [src/executor-registry.ts](src/executor-registry.ts) | 随 effect 生命周期注册的外部执行适配器 |
| [src/native-orchestrator.ts](src/native-orchestrator.ts) | Codex/Claude 共用的原生插件注册 |
| [src/plugin-zcode.ts](src/plugin-zcode.ts) | ZCode 原生策略与受管理 CLI 适配器 |
| [src/tools.ts](src/tools.ts) | 上层决策和分发工具 |
| [src/schema.ts](src/schema.ts) | 配置与不可信 JSON 校验 |
| [src/selection-types.ts](src/selection-types.ts) | 自动/指定入口及选择限额 |
| [src/selector.ts](src/selector.ts) | 有界结构化选择及子任务清理 |
| [src/client/index.ts](src/client/index.ts) | 生成 Remote 和原版插件 UI 注册 |
| [tests/adapter.spec.ts](tests/adapter.spec.ts) | 真实 Loader 组合及免密钥模型循环记录 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [子任务契约](../../subagent/subagent/README.zh.md)
- [预设注册表](../../preset/agent-preset-registry/README.zh.md)
- [本地 Jobs](../../jobs/jobs-local/README.zh.md)

-----

<a id="dsh-style-policies"></a>
## DSH 风格策略与阶段反馈

DSH 中的 `*-style` 策略和 `*-native` provider 入口保持各自现有行为。本次不新增任何插件专属适配器，也不把原生运行路由到 DSH 策略。新增的成员、消息和共享记录能力是通用基础设施；DSH 的根 LLM 入口以通用工具暴露任务查询、消息投递及记录读写等待。各策略可按自己的原生机制选择是否调用这些能力，其命令格式和流程由策略维护者决定。DSH 不定义 Superpowers 黑板或 Codex、Claude 的策略行为。

作者可实现同步 `next(input, snapshot): StageDecision`，`decide` 提供准入预览。每次返回一个 `stage`、`finish` 或 `blocked`；异步规划是普通可取消子任务，不等待策略回调。`results` 是累计交接数据；`currentResults` 仅含当前已提交绑定的结果。替换为动态策略从阶段零开始。捕获的回调在卸载注册后仍可收尾，新接单必须通过当前注册检查。回调属于可信且有限的宿主代码，取消无法中断不返回的同步回调。旧静态作者无需改动。

Codex、Claude、ZCode 和 Superpowers 风格策略沿用各自已有的流程。通用协作能力不会注入会议阈值、黑板字段、风险等级或采纳检查。策略作者负责可写模块协调及工作区隔离，DSH 不分配 Git worktree。共用配方覆盖编程、论文调研、问题研究与方案规划。

策略阶段可以将 `maxConcurrent` 设为正安全整数，覆盖载体的默认并发数，实际并发最多为该阶段任务数。省略时保留载体默认；`serial: true` 指定一个工作者，并拒绝与大于一的并发数同时使用。执行器成员轮次共用当前阶段并发额度，因此显式阶段覆盖也作用于执行器打开的成员。阶段顺序、累计任务与结果限制、工具权限、取消及子任务清理继续生效。

四种 `*-style` 插件配置都有独立的 `extremeHigh.maxConcurrent`，默认值为 4。它只作用于极端高档，并可提高到 4 以上；活跃成员数仍受当前可执行工作和任务捕获上限约束。其他档位继续使用风格配置顶层的 `maxConcurrent`。DSH 没有三成员的模型或 API 硬限制。

档位描述任务范围和复核密度，与并发数独立。低档适合局部修改，中档适合需要上下文与验收的功能，高档适合跨文件或多里程碑改动，极端高档适合需要多个复核角度的跨模块或长开发任务。输入框为已经确认的档位显示对应风格的场景说明。这些说明描述适用方向，不代表实测能力。

可选工作流补丁中的任务数和成本数值是场景假设，不代表供应方实际用量、账单或 Token 硬限制。输入框选择的档位在新接单时捕获，不修改已接任务，也不增加权限。累计子任务和结果字节上限继续生效。各风格的复核与修订规则仍由已有策略代码定义。

`workflowOutput` 通过原版结构化输出取得校验后的 `WorkflowProposal`。`artifactChecks` 在执行前固定文件要求，`contains` 是原样文件正文，不能填要求说明或字节/编码断言。宿主将原生/PTC `read` 观测关联到准确的子任务，以继承工作区解析相对路径，逐会话限制证据内存。助手声明、路径标题回显、拒绝/缺失读取、合成截断提示不能证明内容。局部读取可以证明实际看见的文字，不能证明未见文字不存在；按行读取无法证明尾随换行/编码。零检查意味着未验收，通过仅覆盖这些登记条件。

`reviewOutput` 产生独立的模型复核。有行动价值的问题必须引用实际文件正文并匹配读取路径。状态与问题矛盾或缺少证据归为 `unverified`；格式不合法使子任务失败。模型复核不代替产物验收或真实执行的测试。任务卡区分执行结束、登记检查、模型复核与用量覆盖程度。

`task_strategy_propose` / 宿主 `proposeEntry` 登记带 ID 的提议，不启动 Job。仅人类通过 `acceptProposal` 或无歧义的原始回复接受时才派发。同 ID 同内容和重复接受具备幂等性，不同内容冲突拒绝；短回复“跑吧”遇到多个待选候选要求澄清，已取消提议不能接受。提议与入口快照记录于既有 `task-strategy/entry` 事件；进程重启会中断待选/活动记录，不自动恢复。

声明成本包含基线与 `maximumPlan` 场景，后者包含有限修订/复核/验收。两者都是估算，不是 Token 上限或账单。已记录子任务模型用量单独展示（供应方总计，或互不重叠的输入/缓存/输出计数），缺失报告显示未知。不含入口、根 Agent 及供应方内部重试。插件注册估算不调用模型。

工作流 bundle 现在同时启用三种风格插件与原有 12 条配方，原生适配器保持禁用。已有 profile 应先预览并显式启用新插件入口，历史任务保留旧 native ID；不能追加第二个载体或静默改写原生设置。原版 Agent 循环保持原设计。

任务卡展示初始接单时捕获的模型、提供方、权限来源与执行上限。配置修订包含初始计划与声明的 `policyRevision`；单独的计划修订不覆盖动态策略配置。这些是诊断记录，不是权限授予，也不是变化中的工具/预设权限的完整哈希。阶段替换有各自的绑定 epoch 与修订。

任务卡使用会话级位置并保留原事件锚点。Job 与提议可能跨越模型轮次，因此卡片不进入原版思考/过程折叠；不改变该折叠机制或 Agent 循环。

<a id="model-experience"></a>
## 模型体验

### 上层决策工具与下层任务输入

#### 模型看到什么

可选载体通过 `task_strategy_submit` 接收未改写的原始请求，通过 `task_strategy_list` 列出策略描述与允许的预设名，通过 `task_strategy_plan` 预览 JSON 执行计划，通过 `task_strategy_run` 分发显式计划或指定策略。提交回执包含原版 Job id 与所选策略。自动选择的独立子会话记录任务数据、候选描述及结构化结果。下层接收用户任务、选定指令及标注的前阶段文本结果。Job 输出暴露进度与终态报告。主注册表本身不添加提示词段落或工具。

#### Token 影响

根 Agent 支付决策和控制工具的 schema 成本。自动根入口增加路由子 Agent；自动选择还增加有界输出 Token 的选择子 Agent，指定策略跳过选择器。执行子任务支付选定预设及累积前阶段数据的成本。成本估算不含路由、选择器和根用量。结果和输出字节上限约束保留文本；报告截断带有明确提示，不保证仍是合法 JSON。接收回执保持合法 JSON。

#### KV Cache 影响

上层工具结果追加到历史。选择子 Agent 与执行子任务具有各自的请求前缀；预设、过滤器、路由选择可能改变前缀。不承诺复用父级缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 并发限制针对单次运行，不是多个 Job 的全局配额。工作流是顺序阶段，不是任意 DAG 或持久队列。
- 子任务共享工作文件。工具过滤不是文件系统隔离；并发写入需要作者安排安全流程。
- 没有自动重试、阶段执行中任意暂停或崩溃恢复。`completed` 表示原版模型轮次完成，不代表独立验证正确性。
- 任务状态和请求预留保存在进程内，支持载体重新挂载，不支持进程重启或更换 Jobs 服务。重新挂载需要保留原模块实例。预设实现版本在准入时解析，不会在整个任务期间固定。
- 替换支持捕获的静态计划及同步动态策略。持久化执行恢复仍待实现；标准产品默认不开启自动入口。
- 报告保留有界文本与可序列化的工作流/复核/检查/用量数据。超过结果字节上限会停止流程；过大的展示文本会明确截断。
- 本功能为实验性显式接入。真实模型执行需要可用的已配置提供方；测试使用免密钥的脚本模型适配器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建本包及其依赖后，在仓库根目录运行 `node --test packages/experimental/task-strategy/tests/blackbox.mjs`，检查发布入口、Loader 组合、宿主控制与工具 JSON。对应的局部 E2E 包装测试是 [built-blackbox.e2e.ts](tests/built-blackbox.e2e.ts)。[Headless 会话快照](../../../snapshots/session/task-strategy-empty-input/snapshot.yml) 通过受支持的 `dsh` 启动器重放空白任务预览与分发的拒绝结果。

[选择快照](../../../snapshots/session/task-strategy-selection/snapshot.yml)记录未答复的原版提问、选择器结构化捕获和一个原版执行 Job。客户端装配测试使用原版 Gateway、生成的编解码、设置表单及 slots。

</details>
