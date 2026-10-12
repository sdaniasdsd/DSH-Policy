---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-13-task-active-members

English | [中文](2026-10-13-task-active-members.zh.md)

## Summary

Task entry presentation may retain the optional activeMembers snapshot exposed by TaskRunView. Each member contains its local session identity and task label; this extends only the experimental task-strategy/entry payload.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The new field is optional, so previously recorded entry events without it remain valid. Existing field names, source kinds and event envelopes are retained. The snapshot is presentation data: live membership and exact-owner authorization are checked from process-local task state for every message, and restart never recreates a member or resumes execution from this snapshot. Experimental entry readers may ignore the additive field; consumers which enforce exact object shapes need the updated declaration. No session format version bump is required for this optional presentation extension.

<a id="verification"></a>
## Verification

The five focused Loader, task membership, task messaging and original Subagents suites passed 330 tests. Real JSONL session reads confirmed the message identity, original sender and adjustment text; the next model request contained the adjustment. Existing automatic entry and restart presentation tests passed in the adapter suite. The schema and acknowledgement are generated against only the staged coordination changes, preserving unrelated local work.

<a id="dev-note"></a>
## Dev Note

None.
