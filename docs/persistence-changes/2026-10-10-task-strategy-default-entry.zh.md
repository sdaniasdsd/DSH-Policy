---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-10-task-strategy-default-entry

[English](2026-10-10-task-strategy-default-entry.md) | 中文

## 概述

可选任务策略载体通过 task-strategy/entry 记录原始根输入与协调状态，并用 task-strategy-entry 标记模型可见的宿主结论来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-10-task-strategy-default-entry
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "acf107348703bf0d91c6d6cc196efd52f5ed73a80d3a556ad0c46b01c5d68758"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "28b54fae13c820e89cba23b3f46345b25a277dcac074a6d66f2c83f49ba51fc8"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "3c78e906224f1924eb9ef624d5e94aba81dad9ebc526ce86f8519b8b45502d6d"
    decision: same-version
  - root: "event:task-strategy/entry"
    previous: null
    after: "bfca45855aa0a65e57c7f0adae934706bb235122c222fa0006c2d36947f3a810"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "40f5095d56c5155bcf8dd67ed76814429b1aa3fa0c14c0473e17c12a60a57d23"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增入口事件为必需事件，旧读取器可能拒绝包含它的会话，不得删除该事件来使会话可读。原有事件形状保留。新增仅归属来源允许缺少生产者的读取器保留内容。持久事实只恢复展示，进程重启不会继续执行。

<a id="verification"></a>
## 验证

Loader 测试覆盖普通输入自动接入、重复防止、inbox 领取后取消及原始输入保留。前端测试覆盖没有活跃状态及过期重连响应。必需事件与归属来源 schema 从源码机械提取。

<a id="dev-note"></a>
## 开发备注

无。
