# DSH coordination part 1 delivery

English | [中文](2026-10-13-dsh-coordination-part-1.zh.md)

## Summary

The task owner can discover currently running DSH members and submit adjustments through their existing inbox. This delivery preserves the selected strategy and execution backend. It implements the [approved part 1 plan](../plans/2026-10-13-dsh-coordination-part-1.md) in the user-selected checkout, retaining earlier local edits.

## Table of Contents

- [Delivered behavior](#delivered-behavior)
- [Verification and review](#verification-and-review)
- [Execution rulings](#execution-rulings)
- [Next delivery](#next-delivery)

<a id="delivered-behavior"></a>

## Delivered behavior

Members enter the task registry when their activation is published and leave during cleanup. The original live task owner can inspect these members and send a nonempty, bounded message. Active-only admission rejects idle, absent or closing targets and does not resume them. Ordinary Subagents messaging retains its default behavior.

The model receives inspection and message tools, including custom-prefix support. Inspection omits detailed results when necessary to preserve complete member identities within the output limit. A receipt identifies the accepted message; it does not claim that the member processed or adopted it. Native executor members are not registered as DSH members, and unsupported delivery does not switch backends.

| Commit | Change |
| --- | --- |
| `active inbox API` | Core active-only message admission |
| `owner-scoped member registry` | Task-owned active member registry |
| `owner-scoped message service` | Exact-owner message service and lifetime cancellation |
| `LLM tools and documentation` | Model tools, documentation and API/persistence projections |
| `Part 1 delivery` | Preserve member discovery when retained results exceed tool output |

The optional active-member presentation field extends the experimental persisted entry view. The paired persistence acknowledgement records its schema change; this field grants no authority to resume a session.

<a id="verification-and-review"></a>

## Verification and review

The final focused suite passed 331 tests across six files: task-strategy adapter, membership, messaging and inspection tests, plus Subagents continuation and control tests. These tests use the real Loader, AgentLoop, Jobs and Subagents. Message delivery was checked against JSONL records and subsequent model requests. The model stream is deterministic test input, not an external model service.

Host TypeScript compilation passed. Type-equivalence checks passed for 479 primary blocks and 479 paired derivatives. Staged bilingual, lint and whitespace checks passed; the committed-source persistence check covered 64 roots and 15 history records. The full monorepo suite was not run. Whole-working-copy generator freshness can differ because earlier uncommitted changes remain present.

The independent committed-range review found one important issue: a large earlier result could make inspection fail and hide the next running member. A real Loader regression reproduced the failure, and the bounded coordination projection fixed it. The final suite passed after the fix. No critical findings or deferred minor findings remain.

Preservation checks confirmed 21 earlier modified files byte-for-byte against their starting copies. Five jointly edited source/Markdown files matched those copies after excluding this delivery's additions. The commit hook once failed to restore hidden unstaged changes; the starting copies restored them before the scoped commit. The final fix used the normal hook successfully. The plan's temporary workspace is removed after this report is committed; the checkout and earlier work remain.

<a id="execution-rulings"></a>

## Execution rulings

These rulings are recorded in execution order, including their practical costs.

1. Work in the current checkout on main, as the user selected; do not create another checkout or stage unrelated work. Cost: the working tree continues to contain mixed pending changes and requires scoped staging.
2. Reuse observed final test evidence for task-completion bookkeeping when only formatting follows. Cost: there is no duplicate run solely for that ledger entry; the final behavioral fix has its own fresh suite.
3. Generate API and persistence artifacts from the staged source, excluding earlier local changes. Cost: full working-copy generator freshness can differ until that work is committed.
4. Recover the failed hook restoration from starting copies and bypass that hook runtime once after its required checks passed. Cost: restoration could lose earlier work; the preservation audit checks the originals, and the final fix passes the normal hook.
5. Defer continuation/restart, peer messages, shared records, recovery workflows and meetings to later deliveries. Cost: part 1 only supports active owner-to-member delivery.
6. Defer native coordination capabilities beyond explicit rejection until their adapters verify support. Cost: this delivery does not provide native coordination or a substitute backend.
7. Treat message acceptance separately from processing and adoption. Cost: callers need subsequent member evidence before considering an adjustment applied.
8. Exclude earlier uncommitted user work from the committed-range review and audit preservation separately. Cost: the review cannot validate that earlier feature work; preservation checks and scoped staging cover its retention.

<a id="next-delivery"></a>

## Next delivery

The [part 2 plan](../plans/2026-10-13-dsh-coordination-part-2.md) covers retained member sessions, actual turn outcomes and explicit continuation inside the original task Job. Its implementation awaits plan review. Shared records and Superpowers risk/meeting policy remain later deliveries; other strategies retain their native workflow policy.
