# DSH Coordination Delivery 4

English | [中文](2026-10-13-dsh-coordination-part-4.zh.md)

## Summary

The Superpowers style plugin now owns a blackboard executor built on the task-scoped DSH records, waits, and member-session continuation interfaces. The Codex, Claude, and ZCode style plugins keep their existing registrations and workflows.

## Delivered behavior

The Superpowers executor opens a retained lead session to propose bounded work, then opens member sessions to carry out those work items. Each work member reports evidence, risk, and actions in a constrained JSON shape. Low-risk work is reported after the member handles it. Medium/high reports remain open even if a member claims to have acted, so they can trigger configured aggregation and discussion.

The meeting path asks the affected member to add a view, continues the retained lead session with the discussion and blackboard state, and stores a decision linked to the issue. It then continues each worker session with the decision and latest blackboard contents, storing a per-member adoption report linked to that decision revision. Adoption remains separate from completion. A periodic adjudication is checked at each drained member-turn boundary; configured thresholds can trigger it earlier. The high-risk threshold must be lower than the medium-risk threshold. All three values are explicit required settings with no invented defaults.

The strategy plan is cost-opaque because it creates a dynamic number of model turns. It uses only the configured DSH local preset through `TaskMemberSessions`; it does not replace the model/backend. The executor id must be included in the task-strategy carrier's existing `allowedExecutors` configuration before the mode can be selected.

## Verification boundary

No tests or compiler checks were run in this delivery. Repository pre-commit checks are reported only if they actually ran during commit. The complete multi-turn Superpowers path should receive focused runtime verification before release.
