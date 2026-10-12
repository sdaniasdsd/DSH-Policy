# DSH 协作基础能力第 3 份实施计划

[English](2026-10-13-dsh-coordination-part-3.md) | 中文

> **给实施 agent：** 在已选定的现有源码目录继续，保留已有改动，并将本份独立提交。

**目标：** 向异步执行适配器提供任务范围的共享记录、变更等待和保留发送者身份的消息能力。

**架构：** 将带版本的 JSON 记录作为实验性 task-strategy 插件记录写入精确 owner 会话，并按已接收的 JobId 隔离。使用比较并设置版本、按键串行写入、flush 持久化屏障及任务拥有的等待者。基础能力不带入策略业务词汇。

**范围：** 在 `TaskExecutorContext` 增加可选协调接口，每个已接收 Job 创建一个实例，保留现有本地成员会话接口。本份不增加风险门槛、黑板结构、会议策略或采纳语义。

## 约束

- 只有精确 owner 会话完成 flush，且可从持久化服务观察到追加记录后，写入才成功。
- 写入按任务隔离，带版本，受大小限制，并要求调用方提供期望版本进行比较并设置。
- 消息回执只代表收件箱接受；消息只发给当前活跃成员，并保留原任务 owner 为发送者。
- 等待者由已接收 Job 拥有，在变化、超时、调用方取消或任务结束时结算。
- 不新增核心 Session 事件，也不改变其他策略的执行路径。

## 文件与接口

- 新建 `coordination-types.ts`，定义 `TaskSharedRecords`、`TaskMemberMessageChannel` 和 `TaskCoordination`。
- 新建 `task-coordination.ts`，实现插件记录回放校验、按键串行 CAS 写入、持久化 flush、有界等待及对活跃成员的消息投递。
- 在 `TaskExecutorContext` 增加 `coordination`，保留 `members` 不变。
- 在 `task-runtime-service.ts` 中为每个已接收 Job 创建一个协调实例，并传给主动使用可选上下文的适配器。
- 补充双语子系统和交付说明，解释持久化及消息回执边界。

## 完成交接检查

检查精确 Session 与 Job 所有权、记录版本检查、取消清理，以及原生适配器回调形状未变。只有在明确要求并实际运行后，才报告测试或编译结果。
