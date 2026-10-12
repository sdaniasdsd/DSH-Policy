# DSH coordination delivery 2

English | [中文](2026-10-13-dsh-coordination-part-2.zh.md)

## Summary

An executor can retain a local member session, observe an actual turn result, and explicitly continue that session while its original Job stays open. This delivery implements the [approved part 2 plan](../plans/2026-10-13-dsh-coordination-part-2.md) in the user-selected checkout and preserves earlier local changes.

## Contents

- [Delivered behavior](#delivered-behavior)
- [Verification and review](#verification-and-review)
- [Execution rulings](#execution-rulings)
- [Remaining scope](#remaining-scope)

<a id="delivered-behavior"></a>

## Delivered behavior

Executors can use the optional fifth `TaskExecutorContext` argument to open, inspect and explicitly continue their own local members. Each continuation retains the session and history, attributes input to the exact original task owner, and returns an accepted message identity with the result and disposer for that exact activation. An old disposer cannot close a later activation.

Results preserve the original stop reason, including failure, max-token termination and abortion. `settled` means that a result was captured; it does not mean success. A capture failure returns `unobserved` with accepted identities, without automatic replay. Unsupported continuation reports its capability error and does not create a substitute session or backend.

Member turns retain captured token ceilings and structured submission schemas. All ordinary children and executor members share synchronous task-wide concurrency reservations, released after cleanup. Controller steps and attempted member admissions consume the original cumulative task budget. Requests and complete outcomes remain bounded. Executor settlement and task cancellation close member admission and drain owned work, including unpublished startup.

Existing four-argument adapters continue to run. An adapter creates local members only when its author explicitly uses the optional context. Host continuation can restore non-durable token and schema controls through `resume`; a resident target rejects reconstruction overrides.

| Commit | Change |
| --- | --- |
| `81a02c7388` | Exact continuation receipt and original-session admission |
| `30c65bb148` | Retained task-owned member sessions and actual outcomes |
| `a766e9726e` | Optional executor context and cumulative turn admission |
| `2c9ae6e7e9` | Real Loader, persistence and lifecycle verification |
| `26098420ca` | Test backend dependency placement |
| `5476265979` | Continued controls, shared concurrency and strict fixture verification |

The repair commit preserves continuation controls and enforces shared task concurrency.

<a id="verification-and-review"></a>

## Verification and review

The final focused suite passed **363 tests across nine files**. Loader tests verified the original Job and session IDs, both accepted messages, JSONL sender attribution, retained model history, explicit recovery, cancellation and cleanup, missing capability, and capture uncertainty. Four additional regressions reproduced the review findings before their fixes: continued token ceilings, structured submission, parallel executor reservations, and mixed ordinary/member concurrency.

Host TypeScript compilation, scoped lint, three staged documentation pairs, and **479 source plus 479 paired derivative** type-equivalence checks passed. Staged-source API generation and the persistence-history check passed without a durable schema extension. The final preservation audit confirmed 21 original files byte-for-byte, preserved earlier content in five shared files, and kept unrelated existing translation metadata sections.

One fresh final reviewer found two Important issues and no Critical or Minor issues. Both Important issues were fixed in one repair pass with regression verification. There are no deferred Minor findings. A second review was not requested.

The reviewer declined to judge later blackboard/meeting/adoption protocols, native backend continuation, earlier uncommitted changes, and the separately corrected dependency placement. The runtime tests exercise deterministic model streams through real Loader services; they do not establish external model performance or complete native strategy workflows.

<a id="execution-rulings"></a>

## Execution rulings

The complete ledger rulings, in recorded order, are:

1. Keep the explicitly selected checkout and scope staging to this delivery. **Cost:** mixed pending changes require a separate preservation audit.
2. After Task 2 hook checks passed, hook restoration conflicted with formatting. Restore all original files from this delivery's starting copies and own files from the scoped index; bypass hook execution once after those checks. **Cost:** restoration risk required the final preservation audit, which passed. Task 1 and Task 3 normal hooks passed.
3. Assert the real Loader's `aborted` stop reason rather than normalize it to `cancelled`. **Cost:** adapters must interpret original termination values.
4. Generate API artifacts from staged source, excluding previous local feature edits. **Cost:** whole-working-copy freshness can differ until those earlier changes are committed.
5. Pass explicit cold reconstruction controls for captured `maxTokens` and `outputSchema` instead of extending durable descriptors. **Cost:** bare host callers must supply non-durable controls; resident targets reject reconstruction overrides.
6. Reserve child concurrency synchronously across executor facades and ordinary children. **Cost:** excess nested startup rejects explicitly rather than waiting in an implicit queue.

7. Make the existing cancellation fixture select hanging workers by destination instead of global request order. Tracing showed that cancellation before child startup otherwise makes the root consume a hanging response. **Cost:** fixture routing depends on its explicit root session ID; the original cancellation assertions remain.

<a id="remaining-scope"></a>

## Remaining scope

This delivery provides local member session lifecycles. Shared records, revisioned decisions, blackboard interfaces, meetings and Superpowers decision adoption remain later deliveries under the [approved foundation design](../specs/2026-10-13-dsh-coordination-foundation-design.md). Other strategies retain their native execution behavior. These changes remain committed locally in the existing checkout.
