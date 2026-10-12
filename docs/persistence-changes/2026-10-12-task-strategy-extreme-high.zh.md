---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-task-strategy-extreme-high

[English](2026-10-12-task-strategy-extreme-high.md) | 中文

## 概述

为任务策略入口回执中的可选档位增加 extreme-high。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-task-strategy-extreme-high
baseline: false
changes:
  - root: "event:task-strategy/entry"
    previous: "2026-10-10-task-strategy-default-entry"
    after: "dbd54651611635dc6abb01938296dec712a1e01212c768c33f89ae327ae6c02b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有回执中的低、中、高档或缺省档位保留原有含义。档位是展示元数据：入口回放只折叠保存的视图，不执行计划或重新选择策略。旧读取器保留事件数据，其卡片折叠也将回执作为展示数据。策略 ID 与 Job 标识不变，执行和恢复决策不依赖识别新增档位。

<a id="verification"></a>
## 验证

任务策略测试目录的 342 项测试通过，覆盖极端高档自动选择、双语回执展示、历史回执及入口回放。已检查旧版卡片折叠，确认它不会根据回执档位派发工作。

<a id="dev-note"></a>
## 开发备注

无。
