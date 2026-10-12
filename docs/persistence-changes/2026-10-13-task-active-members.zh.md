---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-13-task-active-members

[English](2026-10-13-task-active-members.md) | 中文

## 概述

任务入口展示可以保留 TaskRunView 新增的可选 activeMembers 快照。每个成员包含本地会话身份和任务标签；本次仅扩展实验性的 task-strategy/entry 负载。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-task-active-members
baseline: false
changes:
  - root: "event:task-strategy/entry"
    previous: "2026-10-10-task-strategy-default-entry"
    after: "fe45f314a5cb0dfb56de9b4b3ee28a4931591f91aa56840b85745e2d82fe24c5"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新字段为可选，先前没有该字段的入口事件仍然有效。原有字段名、来源类型及事件信封保持不变。快照仅用于展示：每次发送消息都从进程内任务状态重新检查活跃成员和精确 owner，重启不会根据快照重建成员或恢复执行。实验性入口的读取方可以忽略新增字段；采用严格对象结构检查的消费方需要更新声明。这个可选的展示扩展无需提高会话格式版本。

<a id="verification"></a>
## 验证

五个聚焦的 Loader、任务成员、任务消息及原版 Subagents 测试文件共 330 项测试通过。真实 JSONL 会话读取确认了消息身份、原始发送者和调整文本，下一次模型请求也包含调整。adapter 测试文件中的现有自动入口与重启展示测试通过。Schema 与确认记录仅按已暂存的协调改动生成，保留无关的本地工作。

<a id="dev-note"></a>
## 开发备注

无。
