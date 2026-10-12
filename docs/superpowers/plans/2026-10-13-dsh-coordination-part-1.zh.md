# DSH 协作第 1 份：执行中消息接入

[English](2026-10-13-dsh-coordination-part-1.md) | 中文

> **给执行 agent（智能体）：** 必须使用 superpowers:executing-plans 在本会话逐项实施本计划。步骤用复选框跟踪。未经用户授权，不委派实现工作。

**目标：** 让任务所有者能够识别当前执行中的 DSH 成员，并通过现有 subagent 收件箱发送补充指令。

**架构：** TaskRuns 在 activation 发布时登记活跃子会话，在步骤清理后移除登记。经过所有者授权的方法使用 Subagents 可选的仅活跃目标接收模式，不能唤醒或从持久化恢复已结束目标。既有 Subagents 消息模式和原生执行路径保留默认行为。

**技术栈：** TypeScript、Cordis 服务、原有 DSH Jobs 和 Subagents、Vitest、现有 Loader fixture（测试前置数据）。

**设计：** [协作基础能力与策略职责](../specs/2026-10-13-dsh-coordination-foundation-design.zh.md)。

## 全局要求

- 保留当前源码已有改动，包括尚未提交的 Superpowers 插件。新提交只包含本份交付的改动。
- 保留既有执行器、权限、阶段选择、取消所有权和最终结果行为。
- 消息被接收不等于成员理解或采用决策。
- 本份只支持活跃的 DSH 子会话。会话延续、共享记录、成员互发消息和 Superpowers 会议属于后续交付。
- 原生执行器子会话不能被悄悄登记为 DSH 成员。不支持的目标或后端返回明确错误。
- 任务捕获的 maxPlanBytes 限制完整序列化消息请求；maxOutputBytes 保持既有工具输出用途。说明这项复用，不增加新的数字默认值。

## 审阅重点

- 子会话在查询和发送之间结束时，消息不能被转发给另一个子会话；任务 2 验证。
- 来自其他任务或所有者的子会话，不能通过本任务消息方法访问；任务 2 验证。
- 消息接收过程中取消任务时，取消尚未被接受的投递，不能在任务结束后唤醒成员；任务 2 验证。
- 消息被接收后，成员正常执行，实际发送者和消息内容保留在持久历史中；任务 3 验证。
- 外部执行器或已卸载的延续服务明确失败，不改用 DSH 再执行任务；任务 2 和任务 3 验证。

## 交付顺序

1. 本计划：活跃成员查询，以及所有者向成员发送消息。
2. 单独计划：成员会话延续、任务拥有的等待和清理，以及明确的可恢复反馈。
3. 单独计划：按任务保存共享记录与变更通知，包含持久化和版本检查。
4. 单独计划：Superpowers 议题、讨论触发、周期裁决、决策发布和成员回报。
5. 单独计划：集成验证，以及各后端实际支持能力的说明。

上述交付遵循已确认的设计。只有第 1 份在本文中规定实施接口；后续计划使用前面已交付的接口。每份完成后先说明，再开始下一份。说明包括改动、提交、检查、限制和下一份内容，不表示整个黑板流程已完成。

## 任务 0：接收消息时避免唤醒已结束目标

**文件：** 修改 packages/subagent/subagent/src/types.ts、index.ts、manager.ts 和 packages/subagent/subagent/tests/continuation.spec.ts。更新包 README 双语文件和 docs/subsystems/subagent.md 双语文件，说明公开选项。

**接口：** SubagentSendMessageOptions 新增可选的 readonly activeOnly: boolean。省略时保留既有唤醒和从持久化恢复行为。Manager 将选项传给子会话投递，对不存在、正在关闭或不在执行的目标返回错误码为 TARGET_NOT_RUNNING 的 SubagentError。子会话向父会话发送仅活跃消息时，也要求父会话正在执行。

- [ ] 新增 “active-only messages reach a running child”、“active-only messages never cold-resume an absent child”、“active-only rejects an idle or closing target”、“active-only rejects an idle parent” 和 “default messaging still resumes an inactive child” 测试。断言拒绝路径没有新 activation、没有收件箱接收，也没有丢失发送者身份。
- [ ] 运行 node node_modules/vitest/vitest.mjs run packages/subagent/subagent/tests/continuation.spec.ts，确认仅活跃模式的断言在实现前失败。
- [ ] 在既有每子会话接收锁内部和最终同步接收点执行该选项，包含异步准备之后的检查。保留会话关系授权和实际发送者身份。仅活跃模式在失去释放竞态后，不能通过持久化恢复进行重试。
- [ ] 运行 continuation 和 control 测试，更新该选项所属文档和双语记录，确认默认调用方保持原有行为。
- [ ] 提交可选接收模式及其测试。

## 任务 1：登记任务活跃成员

**文件：** 修改 packages/experimental/task-strategy/src 下的 runtime-types.ts、dsh-child.ts、task-runtime-service.ts 和 task-submissions.ts。创建 packages/experimental/task-strategy/tests/task-members.spec.ts。

**接口：** 新增 TaskMemberView，包含 readonly sessionId: SessionId 和 readonly label: string。TaskRunView 新增可选的 readonly activeMembers: readonly TaskMemberView[]；TaskRuns.inspect 始终提供列表，纯 TaskRun 查询仍有效。executeDshChild 新增可选的最后一个 onActive 回调，接收 SessionId 并返回同步释放函数，保持已有调用有效。运行所属记录保存活跃成员表和已捕获的消息字节限制。

- [ ] 编写 “publishes an active child before its result”、“removes a child after successful and failed cleanup” 和 “does not register an external executor as a DSH member” 测试。断言准确的子会话身份、查询值与内部状态分离，以及任务终止后 activeMembers 为空。
- [ ] 运行 node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/task-members.spec.ts，确认新增断言在实现前失败。
- [ ] 在 activation 发布后、等待结果前登记成员。即使 activation 的 dispose（资源释放）失败，也在清理路径中释放登记。TaskRuns.inspect 沿用准确所有者检查，返回与内部状态分离的活跃成员列表。
- [ ] 运行新测试和已有 adapter.spec.ts，确认成员登记不改变执行结果和取消清理。
- [ ] 提交任务成员登记实现和测试。

## 任务 2：通过 Subagents 发送所有者消息

**文件：** 修改 runtime-types.ts 和 task-runtime-service.ts。创建 packages/experimental/task-strategy/tests/task-messages.spec.ts。

**接口：** 新增 TaskMessageRequest，包含 readonly childId: SessionId 和 readonly text: string；新增 TaskMessageReceipt，包含 readonly messageId: MessageId。新增 TaskRuns.sendMessage(parent: Agent, jobId: JobId, request: TaskMessageRequest, signal: AbortSignal): Promise<TaskMessageReceipt>。使用任务 1 的 TaskMemberView、活跃成员表和任务 0 的接收模式。实际投递使用 subagents.sendMessage(parent, childId, [{ type: 'text', text }], { signal, activeOnly: true })。运行所属记录保存任务生命周期 AbortSignal。

- [ ] 编写 “returns inbox acceptance without claiming processing”、“rejects a different owner or task”、“rejects a settled member”、“rejects empty or oversized messages”、“cancels unaccepted delivery when the task stops” 和 “preserves backend capability errors” 测试。断言被拒绝的请求不发送消息，拒绝后不重启执行器。
- [ ] 运行 node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/task-messages.spec.ts，确认失败指向缺失的消息操作。
- [ ] 复用 ownedRun 授权。只接收当前已登记的 DSH 子会话，捕获其身份，验证文本非空及 JSON.stringify(request) 的 UTF-8 大小不超过已捕获的 maxPlanBytes，合并调用方取消和任务生命周期取消。Job 创建生命周期控制器，在向 TaskRun 转发取消之前中止它，并在执行结束的清理路径中中止它。任务进入 stopping 或终态后不再接收新操作；收件箱接受后不重试消息。
- [ ] 运行消息和成员测试，覆盖查询与发送之间结束的竞态、恰好达到限制与多字节大小，以及投递前和投递期间取消。
- [ ] 提交经过授权的消息操作和测试。

## 任务 3：提供工具并验证真实投递

**文件：** 修改 packages/experimental/task-strategy 下的 src/cordis.ts、src/tools.ts、src/entry-boundary.ts、tests/adapter.spec.ts 和 tests/fixtures/cordis.yml。仅在已有 fixture 不能提供延续服务时新增消息专用 Loader fixture。更新包 README 双语文件及配对记录、承载有关类型的 docs/subsystems/task-strategy.md 及其对侧文件，以及检查要求的生成 API 或持久化类型确认记录。

**接口：** 新增 task_strategy_inspect(jobId) 和 task_strategy_message(jobId, childId, text)，名称使用载体已配置的 toolPrefix。新增 TaskStrategies.sendMessage(parent: Agent, jobId: JobId, request: TaskMessageRequest, signal: AbortSignal): Promise<TaskMessageReceipt>，转发给 TaskRuns.sendMessage。工具执行沿用现有工具模式提供 exec.agent 和 exec.signal。Inspect 调用载体现有 inspect 方法，提供 activeMembers。两个工具都被根入口规则允许；消息凭据遵守既有输出限制，不能切断身份字段。

- [ ] 新增真实 Loader 测试 “delivers a task-owner adjustment to the active child”。让可控子会话保持执行，发送调整后继续，断言目标持久消息中的发送者、文本和下一次模型请求。不能用手工组装服务的单元测试替代该案例。
- [ ] 新增原生执行器案例，证明不支持的目标不会触发替代的 DSH 执行；新增工具注册释放案例，证明载体卸载后两个工具消失。验证启用根入口时允许这些控制，但仍拒绝直接业务执行和跨任务消息。在所属快照或可运行模型输出断言中固定新增工具说明和凭据行为。
- [ ] 运行 node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/adapter.spec.ts packages/experimental/task-strategy/tests/task-members.spec.ts packages/experimental/task-strategy/tests/task-messages.spec.ts，确认提供工具前新增 Loader 断言失败。
- [ ] 添加载体方法和工具。在所属文档解释仅支持活跃成员以及接收成功的含义。不向其他策略的提示词加入黑板规则。
- [ ] 运行三个策略针对性测试和任务 0 的 subagent 测试、node node_modules/typescript/bin/tsc -b packages/experimental/task-strategy/tsconfig.host.json、有关双语检查、改动 TypeScript 的 lint 和 git diff --check。失败或行为变化后重新检查，再声明完成。
- [ ] 提交可用工具和文档。说明第 1 份的提交、测试结果和仅支持活跃成员的限制，然后准备第 2 份实施计划。

## 工作区与执行衔接

源码工作区包含后续交付需要的用户改动。用户选择继续使用时在该工作区执行；若隔离执行，需要明确带入已有改动，因为原生 worktree 创建不会复制它们。不能整体暂存先前已有的改动。

本计划按当前会话逐份实施。用户已确认设计，并要求每份交付都说明。产品实现前的下一项前置条件是审阅本书面计划；执行方式保持当前会话，不委派实现者。
