# DSH coordination part 2 implementation plan

English | [中文](2026-10-13-dsh-coordination-part-2.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Preserve the current checkout and its existing edits; do not delegate implementation.

**Goal:** Let an opt-in asynchronous executor retain local member session identities, observe actual turn outcomes, and explicitly continue those sessions while the original task Job remains open.

**Architecture:** Extend original Subagents admission with an exact-activation continuation receipt, then wrap those primitives in a task-scoped member-session context supplied to execution adapters. An executor owns its asynchronous decision loop and returns its final ChildResult only when it chooses to finish. Existing static TaskRun stages, native executors and active-only message tools retain their behavior.

**Tech Stack:** TypeScript, Cordis, original Jobs/Subagents, JSONL session persistence, Session Query and Vitest Loader fixtures.

**Spec:** [coordination foundation](../specs/2026-10-13-dsh-coordination-foundation-design.md). Depends on part 1 through e137ebd4c2.

## Global constraints

- Session identity is preserved across explicit continuation. Unsupported native or missing continuation services return their actual errors; no replacement backend or silent new session.
- A settled turn, task completion, a processing acknowledgement and business acceptance remain distinct. A failed or unobserved member turn does not itself settle the enclosing asynchronous executor.
- The exact live Job owner remains the actual sender. Model decisions relayed by a Host executor must not impersonate the decision-producing child.
- Accepted work belongs to original Jobs. Cancellation closes task-owned admission and waits for active member cleanup. Persistent history does not automatically restart execution.
- This delivery defines no risk threshold, meeting schedule, blackboard schema or automatic recovery policy. Those choices remain with author strategies.
- Native adapters keep their existing four-argument execute callbacks. The additional task context is opt-in use, and supplies local DSH sessions only when explicitly requested.

## Review focus

1. A turn ends while a continuation is being prepared: the returned handle must identify the accepted activation and its actual output, without disposing a later activation.
2. Two continuations target the same settled member: at most one is admitted as the next activation; an executing target rejects the other command.
3. Cancellation races activation publication: accepted children must be adopted by the task cleanup path, and no post-cancel wake may occur.
4. Output capture fails after execution: expose an unobserved outcome, rather than fabricating execution failure or replaying work.
5. Nested conversation turns exhaust task limits: cumulative admission counts include controller steps and member turns, and unchanged executors preserve their prior counts.

## Task 0: Return an exact handle for explicit continuation

**Files:** Modify packages/subagent/subagent/src/index.ts, types.ts and manager.ts. Extend tests/continuation.spec.ts and the owning README/subsystem pairs.

**Interfaces:** Add continueActivation(parent: Agent, childId: SessionId, content: ContentBlock[], options: { readonly signal: AbortSignal }): Promise<SubagentActivation & { readonly messageId: MessageId }>. It accepts only a direct local continuable child that is idle or absent. A running target rejects with TARGET_RUNNING; missing services and unsupported backends retain their existing capability errors. Parent identity and sender attribution use the original exact Agent. The returned result and disposer belong to the accepted activation, never a later one.

- [ ] Add RED cases for same-session history continuation, idle and cold targets, simultaneous continuations, foreign parent, running/native targets, missing persistence/query services, cancellation during preparation and disposal of an old handle after a later continuation.
- [ ] Run node node_modules/vitest/vitest.mjs run packages/subagent/subagent/tests/continuation.spec.ts. Expected: new operation assertions fail before source implementation.
- [ ] Refactor the existing locked continuation admission to return both accepted message identity and its exact activation when requested. Keep sendMessage and browser prompt receipts unchanged. Do not infer the activation by a lookup after admission.
- [ ] Run continuation.spec.ts and control.spec.ts. Expected: new cases and all existing message/control cases pass. Commit the primitive and paired documentation.

## Task 1: Provide bounded member-session outcomes

**Files:** Create packages/experimental/task-strategy/src/member-session-types.ts and member-sessions.ts; factor shared activation observation from dsh-child.ts only where needed. Create tests/member-sessions.spec.ts.

**Interfaces:** TaskMemberSessionView has readonly sessionId: SessionId, label: string and phase: 'running' | 'settled' | 'unobserved' | 'closed'. TaskMemberTurnOutcome is either { readonly kind: 'settled'; readonly sessionId: SessionId; readonly messageId: MessageId; readonly result: ChildResult } or { readonly kind: 'unobserved'; readonly sessionId: SessionId; readonly messageId: MessageId; readonly error: string }. A captured result preserves its original stopReason, diagnostic and observed usage; settled is not synonymous with completed.

**Interfaces:** A task-owned TaskMemberSessions facade exposes open(step: TaskStep, prompt: string, signal: AbortSignal): Promise<TaskMemberTurnOutcome>, continue(sessionId: SessionId, text: string, signal: AbortSignal): Promise<TaskMemberTurnOutcome>, inspect(): readonly TaskMemberSessionView[] and close(): Promise<void>. Its private factory captures the exact owner, deployment rules, task lifetime, turn-admission callback and active-map registration. Callers cannot register an arbitrary session identity. open accepts an allowed local preset, rejects executor-backed steps, and never selects an alternative backend. continue requires a member created by this facade. Each member permits one executing turn; settled identities remain retained until close.

- [ ] Add RED cases for retained identity after a completed or failed turn, explicit follow-up history, distinct cancelled/failed stopReasons, unobserved capture failure, immutable inspection, foreign session rejection and close racing publication.
- [ ] Run node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/member-sessions.spec.ts. Expected: missing facade assertions fail.
- [ ] Use original activation and continuation handles. Register active membership only while a turn executes; release it after cleanup, retaining the logical session reference. Pre-acceptance errors reject; errors after acceptance without a captured result return unobserved. Do not parse business blockage from ordinary output text.
- [ ] Apply captured preset/provider admission and maxPlanBytes to complete member requests, maxResultBytes to captured turn output, and task/caller cancellation before admission. close aborts and drains every owned exact activation, including publication races, then closes the facade. Unknown execution outcomes never trigger an automatic continuation.
- [ ] Run member-sessions.spec.ts and dsh-child.spec.ts. Expected: all cases pass and ordinary child cleanup remains unchanged. Commit the facade and types.

## Task 2: Give asynchronous executors the task-owned context

**Files:** Modify src/executor-types.ts, task-run.ts, task-runtime-service.ts, task-submissions.ts and index.ts. Create tests/conversation-executor.spec.ts.

**Interfaces:** Add optional final context?: TaskExecutorContext to TaskExecutorProvider.execute. TaskExecutorContext contains readonly members: TaskMemberSessions. TaskRuns supplies it under the original owner and Job lifetime, and closes the facade before that executor call settles. Add TaskRun.admitMemberTurn(): void: require executing non-cancelled state, reserve one cumulative startedTasks unit and reject when maxTasks is exhausted. A rejected attempted admission remains counted, preventing an unbounded retry loop. Each outer controller step still consumes its existing admission unit.

- [ ] Add RED cases for an executor that observes a failed member turn, explicitly continues the same member and returns completion only afterward; an executor that reports the failure instead; aggregate turn-limit exhaustion; cancellation while awaiting a decision; unchanged native callback behavior and no DSH member unless the adapter explicitly opens one.
- [ ] Run node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/conversation-executor.spec.ts. Expected: context-dependent assertions fail before integration.
- [ ] Construct one facade per executor call, sharing the task active-member registry and immutable captured rules. Invoke the executor with the optional context and drain the facade in finally. New turns reserve through admitMemberTurn before asynchronous preparation. Keep synchronous author next callbacks and the default static failure rule unchanged.
- [ ] Run conversation-executor.spec.ts, task-members.spec.ts and task-messages.spec.ts. Expected: recovered member feedback stays inside the still-running Job, final cleanup leaves no active member, and native adapters retain their selected backend. Commit integration.

## Task 3: Prove the complete opt-in path and document its boundary

**Files:** Extend tests/task-runtime-fixture.ts with real Session Query composition and JSONL persistence; add tests/conversation-loader.spec.ts. Update package README, task-strategy/subagent subsystem pairs and required generated API/persistence artifacts.

- [ ] Add a real Loader executor that opens a member, receives a non-completed turn, makes an explicit decision, continues the same session and then completes its original Job. Assert original Job and child identities, both message identities, durable sender, retained prior history, actual model requests and cleanup. Use a deterministic external model stream.
- [ ] Add cancellation during follow-up, unavailable continuation, unobserved output capture and native executor cases. Assert no silent replay, substitute session or DSH backend. Also prove that part 1's active-only tool still refuses a settled member; explicit continuation is a distinct executor capability.
- [ ] Run the new Loader spec plus conversation-executor, member-sessions, task inspection/message/member specs and original Subagents continuation/control specs. Expected: all pass. Run host tsc, affected bilingual checks, changed TypeScript lint and whitespace checks.
- [ ] Document that this supplies author executors with persistent member identity and actual turn feedback. Superpowers lead/member protocol, feedback interpretation, shared records, meetings and decision-adoption reports are later deliveries. Other strategy paths change only when their author explicitly uses the new context.
- [ ] Commit and report part 2 before beginning shared records.

## Review and handoff

Self-review: the continuation handle, facade and executor context signatures agree; each review-focus race has a named test. This plan supplies local continuation and recoverable execution feedback, rather than a completed Superpowers recovery workflow. Numeric deployment limits come from accepted task rules; no new meeting defaults are chosen. Review this plan before implementation and preserve the already chosen inline execution method.
