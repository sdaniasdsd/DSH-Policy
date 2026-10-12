# DSH coordination, part 1: messages during execution

English | [中文](2026-10-13-dsh-coordination-part-1.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in this session. Steps use checkbox syntax for tracking. Do not delegate implementation without user authorization.

**Goal:** Let a task owner identify currently executing DSH members and send them additional instructions through the existing subagent inbox.

**Architecture:** TaskRuns records active children at activation publication and removes them after step cleanup. Owner-authorized methods route messages through an opt-in active-only Subagents admission mode, which cannot wake or cold-resume an ended target. Existing Subagents messaging and native execution routes retain their defaults.

**Tech Stack:** TypeScript, Cordis services, original DSH Jobs and Subagents, Vitest, existing Loader fixtures.

**Spec:** [Coordination foundation and strategy responsibilities](../specs/2026-10-13-dsh-coordination-foundation-design.md).

## Global constraints

- Preserve the current checkout's existing changes, including its uncommitted Superpowers plugin. New commits include only this delivery's changes.
- Keep the existing executor, permissions, stage selection, cancellation ownership, and final-result behavior.
- Message acceptance is not member understanding or decision adoption.
- This delivery supports active DSH children only. Continued sessions, shared records, peer messaging, and Superpowers meetings belong to later deliveries.
- Native executor children are not silently registered as DSH members. An unsupported target or backend produces an explicit error.
- The task's captured maxPlanBytes bounds the complete serialized message request; maxOutputBytes retains its existing tool-output role. Document this reuse without adding a new numeric default.

## Review focus

- A child finishing between inspection and send must not redirect the message to another child; test in task 2.
- A child from another task or owner must remain unreachable through this task's message method; test in task 2.
- Task cancellation during message admission must cancel unaccepted delivery and must not wake the child after termination; test in task 2.
- Acceptance followed by normal member execution must preserve the actual sender and message in durable history; test in task 3.
- An external executor or unloaded continuation service must fail explicitly without rerunning the task through DSH; test in tasks 2 and 3.

## Delivery sequence

1. This plan: active member discovery and owner-to-member messaging.
2. A separate plan: continuable member sessions, task-owned waiting and cleanup, and explicit recoverable feedback.
3. A separate plan: task-scoped shared records and change notifications, with persistence and revision checks.
4. A separate plan: Superpowers issues, discussion triggers, periodic adjudication, decision publication, and member responses.
5. A separate plan: integration verification and documentation of capabilities actually supported by each backend.

The numbered deliveries follow the approved design. Only delivery 1 has an implementation contract here; each later plan uses the interfaces delivered by its predecessors. Report each delivery before starting the next. A report names changes, commit, checks, limitations, and the next delivery; it does not imply that the complete blackboard workflow is ready.

## Task 0: Admit messages without waking ended targets

**Files:** Modify packages/subagent/subagent/src/types.ts, index.ts, and manager.ts, and packages/subagent/subagent/tests/continuation.spec.ts. Update the package README pair and docs/subsystems/subagent.md pair for the public option.

**Interfaces:** Add optional readonly activeOnly: boolean to SubagentSendMessageOptions. Omission retains existing wake and cold-resume behavior. The manager propagates the option to child delivery and rejects absent, closing, or non-executing targets with SubagentError code TARGET_NOT_RUNNING. A child-to-parent active-only message also requires an executing parent.

- [ ] Add tests named “active-only messages reach a running child”, “active-only messages never cold-resume an absent child”, “active-only rejects an idle or closing target”, “active-only rejects an idle parent”, and “default messaging still resumes an inactive child”. Assert no new activation, no inbox acceptance, and no lost sender identity on the rejected paths.
- [ ] Run node node_modules/vitest/vitest.mjs run packages/subagent/subagent/tests/continuation.spec.ts. Confirm the active-only assertions fail before implementation.
- [ ] Enforce the optional mode inside the existing per-child admission lock and at the final synchronous acceptance point, including after any asynchronous preparation. Keep lineage authorization and actual sender attribution. Active-only delivery never retries through cold resume after losing a disposal race.
- [ ] Run the continuation and control specs and update the option's owning documentation and bilingual records. Confirm default callers retain their behavior.
- [ ] Commit the optional admission mode and its tests.

## Task 1: Track active task members

**Files:** Modify runtime-types.ts, dsh-child.ts, task-runtime-service.ts, and task-submissions.ts under packages/experimental/task-strategy/src. Create packages/experimental/task-strategy/tests/task-members.spec.ts.

**Interfaces:** Add TaskMemberView with readonly sessionId: SessionId and readonly label: string. Add optional readonly activeMembers: readonly TaskMemberView[] to TaskRunView; TaskRuns.inspect always supplies the list, while pure TaskRun views remain valid. Extend executeDshChild with an optional final onActive callback taking SessionId and returning a synchronous release function. Keep existing callers valid. Owned runtime records retain the active-member map and the captured message byte limit.

- [ ] Write tests named “publishes an active child before its result”, “removes a child after successful and failed cleanup”, and “does not register an external executor as a DSH member”. Assert exact child identity, detached inspection values, and an empty activeMembers list after termination.
- [ ] Run node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/task-members.spec.ts. Confirm the new assertions fail before implementation.
- [ ] Register membership after activation publication and before awaiting its result. Keep registration release in the cleanup path even if activation disposal fails. TaskRuns.inspect returns a detached active-member list under its existing exact-owner check.
- [ ] Run the new spec and existing adapter.spec.ts. Confirm membership does not change execution results or cancellation cleanup.
- [ ] Commit the task-owned membership implementation and tests.

## Task 2: Route owner messages through Subagents

**Files:** Modify runtime-types.ts and task-runtime-service.ts. Create packages/experimental/task-strategy/tests/task-messages.spec.ts.

**Interfaces:** Add TaskMessageRequest with readonly childId: SessionId and readonly text: string, and TaskMessageReceipt with readonly messageId: MessageId. Add TaskRuns.sendMessage(parent: Agent, jobId: JobId, request: TaskMessageRequest, signal: AbortSignal): Promise<TaskMessageReceipt>. Consume TaskMemberView and the active-member map from task 1, and task 0's admission mode. Use subagents.sendMessage(parent, childId, [{ type: 'text', text }], { signal, activeOnly: true }) for actual delivery. Owned run records retain a task-lifetime AbortSignal.

- [ ] Write tests named “returns inbox acceptance without claiming processing”, “rejects a different owner or task”, “rejects a settled member”, “rejects empty or oversized messages”, “cancels unaccepted delivery when the task stops”, and “preserves backend capability errors”. Assert no send for rejected requests and no executor restart after rejection.
- [ ] Run node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/task-messages.spec.ts. Confirm failures identify the missing message operation.
- [ ] Reuse ownedRun authorization. Admit only a currently registered DSH child, capture its identity, validate nonempty text and the UTF-8 size of JSON.stringify(request) against captured maxPlanBytes, and combine caller cancellation with task lifetime cancellation. The Job creates the lifetime controller, aborts it before forwarding cancellation to TaskRun, and aborts it in execution finalization. Prevent new admission once the task is stopping or terminal; do not retry a message after inbox acceptance.
- [ ] Run the message and membership specs. Exercise the finish-between-inspect-and-send race, exact and multibyte byte bounds, and abort before and during delivery.
- [ ] Commit the authorized message operation and tests.

## Task 3: Expose the operation and prove real delivery

**Files:** Modify src/cordis.ts, src/tools.ts, src/entry-boundary.ts, tests/adapter.spec.ts, and tests/fixtures/cordis.yml under packages/experimental/task-strategy. Add a message-specific Loader fixture only if the existing fixture cannot supply continuation services. Update the package README pair and its pairing record, docs/subsystems/task-strategy.md and its counterpart where it owns the affected types, and required generated API or persistence acknowledgements if the gates identify them.

**Interfaces:** Add task_strategy_inspect(jobId) and task_strategy_message(jobId, childId, text) using the carrier's configured toolPrefix. Add TaskStrategies.sendMessage(parent: Agent, jobId: JobId, request: TaskMessageRequest, signal: AbortSignal): Promise<TaskMessageReceipt>, forwarding to TaskRuns.sendMessage. Tool execution supplies exec.agent and exec.signal as existing tools do. Inspect calls the existing carrier inspect method and supplies activeMembers. Both tools are admitted by the root entry boundary; the message receipt obeys existing output bounds without slicing its identity.

- [ ] Add a real Loader test named “delivers a task-owner adjustment to the active child”. Hold a deterministic child turn open, send the adjustment, let it continue, and assert the target's durable message sender, text, and next model request. Do not substitute a hand-built service-only test for this case.
- [ ] Add a native-executor case proving an unsupported target produces no replacement DSH execution, and a tool-registration disposal case proving both tools disappear with the carrier. Verify enabled root entry admits these controls while still denying direct business execution and foreign-task messaging. Pin the new tool descriptions and receipt behavior in the owning snapshot or runnable model-output assertion.
- [ ] Run node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/adapter.spec.ts packages/experimental/task-strategy/tests/task-members.spec.ts packages/experimental/task-strategy/tests/task-messages.spec.ts. Confirm the new Loader assertions fail before exposing the tool.
- [ ] Add the carrier method and tool. Explain active-only messaging and acceptance semantics in the owning documentation. Do not add blackboard rules to the other strategies' prompts.
- [ ] Run the three focused strategy specs and task 0's subagent specs, node node_modules/typescript/bin/tsc -b packages/experimental/task-strategy/tsconfig.host.json, affected bilingual checks, lint for changed TypeScript, and git diff --check. Recheck any failed or changed behavior before claiming completion.
- [ ] Commit the usable tool and documentation. Deliver part 1 with its commit, test results, and active-only limitation, then prepare part 2's implementation plan.

## Working copy and handoff

The source checkout contains user work that is needed by later deliveries. Continue in that checkout if the user chooses it; an isolated checkout must include those existing changes deliberately, because native worktree creation does not copy them. Do not stage the pre-existing changes wholesale.

This plan is for sequential execution in the current conversation. The user has approved the design and requested a report for every delivery. Written-plan review remains the next prerequisite before product implementation; the execution method remains this session without delegated implementers.
