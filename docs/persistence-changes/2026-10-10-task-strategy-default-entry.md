---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-10-task-strategy-default-entry

English | [中文](2026-10-10-task-strategy-default-entry.zh.md)

## Summary

The optional task strategy carrier records original root input and orchestration state in task-strategy/entry, and attributes model-facing Host outcomes with task-strategy-entry.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The added entry event is required. Older readers can reject sessions containing it; readers must not discard it to make a session readable. Existing event shapes are retained. The new attribution-only source kind preserves content for readers without the producer. Persisted facts restore presentation only; process restart never resumes execution.

<a id="verification"></a>
## Verification

Loader tests cover automatic ordinary input, duplicate prevention, cancellation after inbox claim and original input retention. Frontend tests cover absent live state and stale reconnection responses. Required event and attribution schemas are mechanically extracted from source.

<a id="dev-note"></a>
## Dev Note

None.
