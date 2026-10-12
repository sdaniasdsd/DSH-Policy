# DSH 协调基础能力第 2 份实施计划

[English](2026-10-13-dsh-coordination-part-2.md) | 中文

> **给执行 agent：** 使用 superpowers:executing-plans 逐项实施。本会话继续在现有源码工作，保留已有改动，不委派实施。

**目标：** 让主动使用新接口的异步执行器保留本地成员会话身份、观察真实轮次结果，并在原任务 Job 尚未结束时明确继续这些会话。

**架构：** 先为原版 Subagents 的继续准入返回精确 activation 句柄，再将这些基础操作封装成任务拥有的成员会话上下文，交给执行适配器。执行器拥有异步决策循环，只在明确决定结束后返回最终 ChildResult。现有静态 TaskRun 阶段、原生执行器和仅向活跃成员投递的工具保留原有行为。

**技术：** TypeScript、Cordis、原版 Jobs/Subagents、JSONL 会话持久化、Session Query 和 Vitest Loader 夹具。

**设计：** [协调基础能力](../specs/2026-10-13-dsh-coordination-foundation-design.zh.md)。依赖第 1 份，截至 e137ebd4c2。

## 全局要求

- 明确继续会话时保留其身份。原生后端不支持或缺少继续服务时返回实际错误，不更换后端、不悄悄创建新会话。
- 轮次结束、任务完成、处理回执和业务验收分别表达。成员失败或结果未观察到，不会直接结束包围它的异步执行器。
- 精确活跃的 Job owner 仍是真实发送者。宿主执行器转交模型决策时，不能冒充作出决策的子 agent。
- 已接收工作由原版 Jobs 拥有。取消关闭任务准入并等待活跃成员清理；持久历史不会自动重启执行。
- 本份不定义风险门槛、会议周期、黑板字段或自动恢复规则；这些选择仍归作者策略。
- 原生适配器保留现有四参数 execute 回调。额外任务上下文由作者主动使用，只有明确请求才创建本地 DSH 会话。

## 审查重点

1. 准备继续时旧轮次结束：返回句柄必须绑定已接收的 activation 及真实输出，不能清理后续 activation。
2. 两个继续操作同时指向同一已结束成员：最多一个被接收为下一 activation；目标正在执行时拒绝另一个命令。
3. 取消与 activation 发布竞争：已接收子任务必须进入任务清理路径，取消后不能再次唤醒。
4. 执行后结果捕获失败：报告未观察到结果，不能伪造执行失败或重放工作。
5. 嵌套对话耗尽任务额度：累计准入包含控制步骤和成员轮次，未使用新接口的执行器保留原有计数。

## 任务 0：为明确继续返回精确句柄

**文件：** 修改 packages/subagent/subagent/src/index.ts、types.ts、manager.ts；扩展 tests/continuation.spec.ts 和所属 README、子系统双语文档。

**接口：** 新增 continueActivation(parent: Agent, childId: SessionId, content: ContentBlock[], options: { readonly signal: AbortSignal }): Promise<SubagentActivation & { readonly messageId: MessageId }>。仅接收空闲或不驻留的直接本地可继续子会话。正在执行的目标以 TARGET_RUNNING 拒绝；缺少服务及后端不支持时保留既有能力错误。父身份与发送者归属使用原来的精确 Agent；返回的结果与清理句柄只属于已接收 activation，不能指向后续 activation。

- [ ] 先写失败测试：原会话历史延续、空闲与冷目标、并发继续、其他父会话、执行中或原生目标、缺少持久化/查询服务、准备期间取消，以及后续继续后清理旧句柄。
- [ ] 执行 node node_modules/vitest/vitest.mjs run packages/subagent/subagent/tests/continuation.spec.ts；预期新增接口断言在实施前失败。
- [ ] 在已有按子会话加锁的继续准入中，按需同时返回已接收消息身份和其精确 activation。sendMessage 与浏览器 prompt 回执保持原样；不能在准入之后再查表猜测 activation。
- [ ] 执行 continuation.spec.ts 与 control.spec.ts；预期新增及原有消息/控制用例通过。提交基础操作和双语说明。

## 任务 1：提供有界成员会话结果

**文件：** 新建 packages/experimental/task-strategy/src/member-session-types.ts、member-sessions.ts；仅在必要时从 dsh-child.ts 提取共享 activation 观察逻辑。新建 tests/member-sessions.spec.ts。

**接口：** TaskMemberSessionView 包含 readonly sessionId: SessionId、label: string、phase: 'running' | 'settled' | 'unobserved' | 'closed'。TaskMemberTurnOutcome 为 { readonly kind: 'settled'; readonly sessionId: SessionId; readonly messageId: MessageId; readonly result: ChildResult } 或 { readonly kind: 'unobserved'; readonly sessionId: SessionId; readonly messageId: MessageId; readonly error: string }。已捕获结果保留原始 stopReason、diagnostic 和实际观察用量；settled 不等于 completed。

**接口：** 任务拥有的 TaskMemberSessions 暴露 open(step: TaskStep, prompt: string, signal: AbortSignal): Promise<TaskMemberTurnOutcome>、continue(sessionId: SessionId, text: string, signal: AbortSignal): Promise<TaskMemberTurnOutcome>、inspect(): readonly TaskMemberSessionView[]、close(): Promise<void>。私有工厂捕获精确 owner、部署规则、任务生命周期、轮次准入回调与活跃成员登记；调用方不能登记任意会话身份。open 只接收已允许的本地预设，拒绝 executor 步骤且不选择其他后端；continue 要求成员由该实例创建。每个成员同时只执行一个轮次；已结束的逻辑身份保留到 close。

- [ ] 先写失败测试：完成或失败后保留身份、明确补充后仍包含历史、取消与失败的 stopReason 分别保留、捕获失败报告 unobserved、独立查询值、其他会话拒绝，以及关闭与发布竞争。
- [ ] 执行 node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/member-sessions.spec.ts；预期缺失封装接口的断言失败。
- [ ] 使用原版启动与继续句柄；只有轮次执行时才登记活跃成员，清理后移除登记并保留逻辑会话引用。接收前错误直接拒绝；接收后未能捕获结果则返回 unobserved。不能从普通输出文字猜测业务阻塞。
- [ ] 每次操作应用捕获的预设/provider 准入规则，完整成员请求受 maxPlanBytes 限制，捕获轮次输出受 maxResultBytes 限制，准入前合并任务/调用方取消。close 中止并排空全部所属精确 activation，包括发布竞态，随后关闭实例。未知结果不触发自动继续。
- [ ] 执行 member-sessions.spec.ts 与 dsh-child.spec.ts；预期全部通过，普通子步骤清理规则不变。提交封装与类型。

## 任务 2：向异步执行器提供任务上下文

**文件：** 修改 src/executor-types.ts、task-run.ts、task-runtime-service.ts、task-submissions.ts、index.ts；新建 tests/conversation-executor.spec.ts。

**接口：** TaskExecutorProvider.execute 最后增加可选 context?: TaskExecutorContext；TaskExecutorContext 包含 readonly members: TaskMemberSessions。TaskRuns 按原 owner 与 Job 生命周期提供它，在执行器调用结算前关闭封装。TaskRun 新增 admitMemberTurn(): void：要求任务正在执行且未取消，预留一个累计 startedTasks 单位，maxTasks 耗尽时拒绝。失败的已尝试准入仍计数，避免无限重试；外层控制步骤仍消耗原有准入单位。

- [ ] 先写失败测试：执行器观察失败成员、明确继续同一成员、之后才返回完成；选择直接报告失败；累计轮次额度耗尽；等待决策期间取消；原生回调行为不变，以及未明确打开成员时没有 DSH 子会话。
- [ ] 执行 node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/conversation-executor.spec.ts；预期依赖上下文的断言在接入前失败。
- [ ] 每次执行器调用创建一个封装，共享任务活跃成员表与不可变规则；以可选上下文调用执行器，在 finally 排空封装。新轮次在异步准备前通过 admitMemberTurn 预留额度；同步作者 next 回调与默认静态失败终止规则不变。
- [ ] 执行 conversation-executor.spec.ts、task-members.spec.ts、task-messages.spec.ts；预期可恢复成员反馈留在尚未结束的原 Job 内，最终没有活跃成员，原生适配器后端保持原样。提交接入。

## 任务 3：验证完整主动接入路径并说明边界

**文件：** 扩展 tests/task-runtime-fixture.ts，组合真实 Session Query 与 JSONL 持久化；新增 tests/conversation-loader.spec.ts。更新包 README、task-strategy/subagent 子系统双语文档及必需的生成 API/持久化记录。

- [ ] 用真实 Loader 执行器打开成员，接收未完成轮次，明确作出决定，继续原会话，随后结束原 Job；断言原 Job/子会话身份、两次消息身份、持久发送者、前文历史、真实模型请求及清理。模型流使用确定性外部夹具。
- [ ] 加入继续期间取消、缺少继续能力、捕获结果未观察到、原生执行器用例；断言不悄悄重放或替换会话/后端。验证第 1 份活跃消息工具仍拒绝已结束成员，明确继续属于不同的执行器能力。
- [ ] 执行新 Loader 测试，以及 conversation-executor、member-sessions、任务查询/消息/成员和原版 continuation/control 测试；预期全部通过。运行 host tsc、所属双语检查、改动 TypeScript lint 及空白检查。
- [ ] 文档说明本份给作者执行器提供持续成员身份和真实轮次反馈；Superpowers 主成员协议、反馈解释、共享记录、开会和决策吸收回报属于后续交付。其他策略只有作者明确使用新上下文时才改变执行路径。
- [ ] 提交并说明第 2 份，再开始共享记录。

## 自审与交接

自审：继续句柄、封装和执行上下文的签名相互一致，每个重点竞态都有对应测试。本计划实现本地会话延续与可恢复执行反馈，不宣称完成 Superpowers 的恢复流程。具体部署限额来自已接收任务规则，不选择新的会议默认值。实施前审阅本计划，保留已经选定的本会话逐项实施方式。
