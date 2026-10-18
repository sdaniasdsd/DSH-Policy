---
kind: upgrade-guide
description: "子 Agent 工具调用现在会等待最终结果并返回给调用方，而不再立即返回 activation ID。"
---

# 子 Agent 调用返回最终结果

[English](guide.md) | 中文

## 变更

在 DSH-Policy 1.0.0 中，`tool-subagent` 会等待子 Agent 停止，并返回包含状态、停止原因、文本输出及诊断信息（如有）的 `supervisor-result`。此前版本会立即返回 activation ID，之后再单独发送完成通知。DSH 本地子 Agent 不能再派发另一个 DSH 子 Agent；后续工作由父 Agent 以同级调用派发。本地共享上下文的 provider 必须支持 `toolFilter`，确保子 Agent 不会继承委派工具。任务策略 Job API 和 Session 格式没有变化。

## 迁移

1. 无需迁移 profile 或 Session，`maxDepth` 保持不变。
2. 更新仍然期待 activation ID 或后续完成通知的自定义提示词和调用方，从 `supervisor-result` 中读取 `status`、`stopReason`、`output` 和可选的 `diagnostic`。
3. 要求成员在最终结果中列出后续任务，再由父 Agent 以同级调用派发。本地共享上下文 provider 必须实现 `toolFilter`；无法执行委派隔离的 provider 会在插件启动时失败。
4. 使用一个需要并行调查两项内容并继续追查一项问题的请求验证：父 Agent 应收到两份最终结果、自己派发后续同级任务，再汇总回答。
