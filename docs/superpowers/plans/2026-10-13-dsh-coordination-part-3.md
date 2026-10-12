# DSH Coordination Part 3 Implementation Plan

English | [中文](2026-10-13-dsh-coordination-part-3.zh.md)

> **For the implementation agent:** Continue in the selected existing checkout, preserve existing edits, and commit this delivery separately.

**Goal:** Expose task-scoped shared records, change waits, and sender-preserving messages to asynchronous execution adapters.

**Architecture:** Store versioned JSON records as experimental task-strategy plugin records in the exact owner Session, partitioned by the accepted JobId. Use compare-and-set revisions, a per-key serialized writer, a flush barrier, and task-owned waiters. Keep strategy vocabulary and policy outside this foundation.

**Scope:** Add the optional coordination surface to `TaskExecutorContext`, create it once per accepted Job, and retain the existing local-member API. No risk thresholds, blackboard schema, meeting policy, or adoption semantics are added.

## Constraints

- A write succeeds only after the exact owner Session has flushed and the appended record is observable through persistence.
- Writes are task-scoped, revisioned, size bounded, and compare-and-set; callers provide expected revisions.
- A message receipt proves inbox acceptance only. Messages target currently active members and preserve the original task owner as sender.
- Waiters are tied to the accepted Job lifetime and settle on change, timeout, caller cancellation, or task end.
- Do not introduce a core Session event or change other strategies' execution path.

## Files and interfaces

- Add `coordination-types.ts` for `TaskSharedRecords`, `TaskMemberMessageChannel`, and `TaskCoordination`.
- Add `task-coordination.ts` for validated plugin-record replay, per-key CAS writes, persistence flush, bounded waits, and active-member delivery.
- Extend `TaskExecutorContext` with `coordination`; retain `members` unchanged.
- Construct one coordination facade per accepted Job in `task-runtime-service.ts` and pass it to adapters that already opt into the optional context.
- Add bilingual subsystem and delivery documentation describing persistence and receipt boundaries.

## Completion review

Review exact Session and Job ownership, record revision checks, cancellation cleanup, and the unchanged native adapter call shape. Do not claim test or compiler results unless those checks were explicitly requested and run.
