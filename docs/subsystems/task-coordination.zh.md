# 任务协作基础能力

[English](task-coordination.md) | 中文

异步任务执行器可选择使用 `TaskExecutorContext.coordination`。该接口由原始任务 Job 和 owner 会话拥有，提供按任务隔离的共享 JSON 记录、比较并设置版本、变更等待，以及向当前活跃任务成员发送消息的通道。

共享记录以 `plugin:task-strategy/shared-record` 实验性 Session 记录写入。每条记录带有 JobId、键、下一版本、写入者 SessionId 和独立 JSON 值。写入成功前会等待 Session 持久化 flush；这些记录不进入模型可见的对话历史。实验性插件记录目录说明，这类记录跨 Session 格式迁移时按尽力而为方式保留。

消息通道以精确任务 owner 为发送者，并且只接受当前活跃成员。回执标识收件箱已接受消息，不代表成员已经读取、理解或采纳。执行器可以通过 `members.continue()` 对自己创建且当前空闲的会话显式发起下一轮。

任务结束会取消记录等待并释放计时器和监听器。除非策略执行器明确使用可选上下文，否则其他策略保留既有路径。Superpowers 负责在此基础上定义黑板结构、风险解释、开会周期及采纳回报。
