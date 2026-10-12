# 任务协作基础能力

[English](task-coordination.md) | 中文

异步任务执行器可选择使用 `TaskExecutorContext.coordination`。该接口由原始任务 Job 和 owner 会话拥有，提供按任务隔离的共享 JSON 记录、比较并设置版本、变更等待，以及向当前活跃任务成员发送消息的通道。

共享记录以 `plugin:task-strategy/shared-record` 实验性 Session 记录写入。每条记录带有 JobId、键、下一版本、写入者 SessionId 和独立 JSON 值。写入成功前会等待 Session 持久化 flush；这些记录不进入模型可见的对话历史。实验性插件记录目录说明，这类记录跨 Session 格式迁移时按尽力而为方式保留。

消息通道以精确任务 owner 为发送者，并且只接受当前活跃成员。回执标识收件箱已接受消息，不代表成员已经读取、理解或采纳。执行器可以通过 `members.continue()` 对自己创建且当前空闲的会话显式发起下一轮。

任务结束会取消记录等待并释放计时器和监听器。根 LLM 工具在调用者拥有的 Job 下暴露通用记录读/列出/写入/等待操作及消息投递。记录 key 和 value 没有 DSH 规定的业务含义。策略维护者决定是否使用这些 API、如何组织命令和消息格式以及采用什么流程。DSH 不新增插件专属适配器、黑板 schema、风险解释、会议周期或采纳回报。现有原生与风格入口保持当前工作流。
