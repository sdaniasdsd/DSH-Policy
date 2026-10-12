# DSH 通用任务协作能力设计

[English](2026-10-13-dsh-coordination-foundation-design.md) | 中文

## 目标

DSH 为正在执行的任务提供通用协作能力，并通过统一的 LLM 工具入口暴露这些能力。DSH 不为 Codex、Claude、ZCode、Superpowers 或其他插件制定流程、命令协议或专属适配层。策略维护者可以根据自己的原生要求，选择并使用这些基础接口。

## 职责边界

| DSH 提供 | 策略维护者决定 |
|---|---|
| 原始任务 Job 下的成员身份与活跃状态 | 是否创建成员以及如何分工 |
| 原任务成员会话的打开、继续和结束接口 | 何时继续、给成员什么指令 |
| 保留发送者身份的消息投递和接收回执 | 消息格式、收件人、何时发送及如何确认处理 |
| 按任务隔离、带版本的共享记录和等待接口 | key、JSON 数据结构、风险语义及冲突处理 |
| 有界的根模型工具入口和任务归属检查 | 策略内部的命令名、协商、裁决和工作流 |

DSH 的消息接收回执只表示消息机制接受投递，不表示成员已处理或采纳。记录写入回执表示该版本已持久化；DSH 不解释记录内容，也不据此触发策略动作。

## 通用 LLM 工具协议

工具名称遵循载体 `toolPrefix`，默认前缀为 `task_strategy`。以下命令只操作通用任务状态：

| 工具 | 参数 | 行为 |
|---|---|---|
| `{prefix}_inspect` | `jobId` | 查询当前任务快照与活跃的 DSH 成员 |
| `{prefix}_message` | `jobId`, `childId`, `text` | 向同一任务内活跃的 DSH 成员投递消息，返回 `messageId` |
| `{prefix}_record_read` | `jobId`, `key` | 返回最新记录或 `null` |
| `{prefix}_record_list` | `jobId` | 列出最新记录 |
| `{prefix}_record_write` | `jobId`, `key`, `value`, `expectedRevision` | 比较并交换 JSON 值，返回新 revision；冲突时拒绝 |
| `{prefix}_record_wait` | `jobId`, `key`, `afterRevision`, `timeoutMs` | 等待更高 revision、超时或任务取消 |

所有操作都要求调用者拥有该 Job。记录 key 非空，值必须可 JSON 序列化并受任务大小限制。缺席记录的 revision 为 0。消息只面向当前活跃的本地 DSH 成员；这些工具不接管原生 CLI 或外部 provider 的控制通道。工具输出服从配置字节上限，过大记录可省略 value 但保留 key 和版本。

策略可以将这些工具映射到自己的命令或 prompt，也可以完全不使用它们。DSH 不要求任何插件安装 DSH 专属适配器。

## 保持现有链路

现有 Codex、Claude、ZCode 和 Superpowers 入口、策略和 provider 行为不因通用基础能力而改变。DSH 不新增或调整它们的原生适配器，不注入黑板、会议、风险等级、数量门槛、周期裁决或采纳检查。DSH 内已有的策略实现也继续按各自当前流程运行。

这些 API 描述 DSH 能力边界，不等于外部产品一定具备对应接口。原生 provider 是否能续接已有会话、接收执行中消息或报告状态，仍由 provider 自己的原生能力决定。只有策略维护者明确接入通用 API 后，该策略才会使用它们。

## 验证目标

- 同一 Job owner 可以读写、列出并等待该任务自己的记录；其他 owner 不能读取或修改。
- 比较并交换拒绝旧 revision，等待者能观察持久化的新 revision。
- 消息只发给同一任务当前活跃的本地成员，发送身份仍为任务 owner。
- 根 LLM 工具执行相同归属、取消、大小限制与错误语义。
- 并发执行遵守当前阶段的作者并发设置和载体任务预算。
- 原生入口未发生代码路径变化；mock/Loader 测试只验证 DSH 接口，不宣称完成真实 Codex 或 Claude CLI 联调。

## 本次范围

实现通用成员会话、任务记录、消息与统一 LLM 工具接口，并为每个能力提供源码测试和 Loader 级流程验证。不得新增插件专属 adapter、策略协议或业务流程。策略作者使用能力的具体方式留待各策略维护者自行决定。
