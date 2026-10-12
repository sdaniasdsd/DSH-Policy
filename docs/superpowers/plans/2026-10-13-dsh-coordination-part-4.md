# DSH Coordination Part 4 Implementation Plan

English | [中文](2026-10-13-dsh-coordination-part-4.zh.md)

> **For the implementation agent:** Continue in the selected checkout and commit this strategy-owned delivery separately.

**Goal:** Make the Superpowers style policy run its blackboard workflow on the task-owned coordination foundation while leaving the other style policies on their existing paths.

**Architecture:** Register a Superpowers-only asynchronous executor. A retained task lead session proposes bounded work, worker sessions report issues and actions, low-risk work is handled by its member, and unresolved medium/high issues gather member discussion before the lead records a versioned decision. The decision and current blackboard are delivered by continuing each worker session; each adoption report is linked to the decision and recorded independently from message acceptance and task completion.

## Policy configuration

- Require `mediumMeetingThreshold`, `highMeetingThreshold`, and `adjudicationPeriodMs` explicitly; do not invent deployment values.
- Validate the high-risk threshold is strictly lower than the medium-risk threshold.
- Evaluate periodic adjudication at the next drained member-turn boundary; thresholds can trigger it earlier.
- Keep all blackboard keys under the Superpowers namespace. Record names and risk meaning do not enter the generic DSH interface.
- Mark the plan cost opaque because the asynchronous conversation and meetings are dynamic.

## Files and interfaces

- Add `superpowers-blackboard.ts` for lead, worker, discussion, decision, and adoption turns over `TaskExecutorContext`.
- Replace the Superpowers plugin's static style mount with the dedicated executor, policy, and orchestration registration.
- Extend the coordination subsystem reference and add a bilingual part 4 plan/report.
- Keep Codex, Claude, and ZCode plugin implementations unchanged.

## Completion review

Inspect the decision and adoption records for explicit issue and revision links, ensure low-risk actions are reported after execution, and ensure member continuations retain their session identities. No test or compiler result is claimed unless those checks were explicitly requested and run.
