# DSH Coordination Delivery 3

English | [中文](2026-10-13-dsh-coordination-part-3.zh.md)

## Summary

Asynchronous task executors that opt into `TaskExecutorContext` now receive a task-owned coordination facade for versioned shared records, record-change waits, and messages to active members. Existing adapters can continue using their original four-argument execution callbacks.

## Delivered behavior

The shared-record log is stored as an experimental `plugin:task-strategy/shared-record` record on the exact task owner's Session and is partitioned by JobId. Values must be JSON serializable and fit within the captured plan-byte limit. A caller supplies the expected revision; same-key writes are serialized and conflicting revisions fail. A successful write requires a configured Session persistence service, flushes the owner Session, and reads the committed event back through the persistence handle.

Executors can list or read the latest task records and wait for a selected key to advance. Waits are bounded and release their timer/listener when they settle or when the Job ends. The message channel accepts only a currently active task member and sends under the original owner identity. Its receipt means inbox acceptance only.

This delivery provides transport and storage semantics. It does not define record names, risk classifications, meeting thresholds, or adoption policy; those belong to a strategy such as Superpowers. The experimental record format is best-effort across Session format migrations, as documented in the plugin-record catalog.

## Verification boundary

No tests or compiler checks were run in this delivery. The source changes are recorded in the commit; the optional coordination API and persistence contract should receive focused runtime verification before release.
