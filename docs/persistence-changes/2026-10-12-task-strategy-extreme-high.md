---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-task-strategy-extreme-high

English | [中文](2026-10-12-task-strategy-extreme-high.zh.md)

## Summary

Adds extreme-high to the optional selection tier in task-strategy entry receipts.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing receipts with low, medium, high or no tier retain their meaning. The tier is presentation metadata: entry replay folds the stored view and does not execute a plan or select a new policy. Older readers preserve the event data; their existing card fold also treats receipts as presentation data. The strategy ID and Job identity remain unchanged, so no execution or recovery decision depends on recognizing the new tier.

<a id="verification"></a>
## Verification

The task-strategy test directory passes 342 tests, including automatic extreme-high selection, receipt display in both languages, historical receipts and entry replay. The previous card fold was inspected and does not dispatch work from receipt tier.

<a id="dev-note"></a>
## Dev Note

None.
