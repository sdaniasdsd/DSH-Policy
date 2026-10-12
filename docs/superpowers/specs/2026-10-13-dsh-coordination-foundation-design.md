# DSH coordination foundation and strategy responsibilities

English | [中文](2026-10-13-dsh-coordination-foundation-design.zh.md)

## Summary

This document describes the coordination capabilities DSH provides to strategies and how Superpowers uses them for a blackboard workflow. The goal is to let a strategy receive feedback, adjust work, and continue existing sessions when execution encounters an unexpected problem. This is a design for review, not a claim that all described capabilities are connected to strategy execution.

The user specified that Superpowers uses the blackboard approach, Codex, Claude, and ZCode retain their own collaboration methods, and DSH supplies messaging and other basic capabilities. This document does not set risk counts, meeting periods, or new permission rules.

## Table of Contents

- [Responsibilities](#responsibilities)
- [Approach](#approach)
- [Foundation capabilities](#foundation-capabilities)
- [Current source and integration gaps](#current-source-and-integration-gaps)
- [Preserving existing workflows](#preserving-existing-workflows)
- [Superpowers blackboard workflow](#superpowers-blackboard-workflow)
- [Unexpected problems and recovery](#unexpected-problems-and-recovery)
- [Validation goals and scope](#validation-goals-and-scope)
- [Dev Note](#dev-note)

<a id="responsibilities"></a>

## Responsibilities

DSH hosts sessions, controls execution, delivers messages, and saves shared records. Each strategy plans, delegates, interprets problems, adjusts its plan, checks results, and decides when work is complete. Runtime infrastructure cannot infer a business decision from a message or a single tool failure.

The strategy lead agent in this document is the decision session that plans and adjusts the task. It differs from the synchronous DSH stage-selection function. The user-facing entry session can report progress, but being the outermost session does not establish decision ownership. Strategy integration must identify the decision session and its message routes.

| Layer | Responsibility | Example |
|---|---|---|
| DSH foundation services | Provide sessions, members, messaging, records, waiting, and execution feedback | Deliver a message to a member and return its acceptance result |
| Strategy adapter | Bind foundation capabilities to the selected strategy and backend | Route a continuation request to a continuable DSH session or native backend |
| Strategy workflow | Decide when and why to use the capabilities | Superpowers initiates discussion based on blackboard issues |

<a id="approach"></a>

## Approach

Reuse existing session and team services, connect strategies through adapters, and implement the blackboard workflow within Superpowers. This approach retains existing member identity, message acceptance, and resource cleanup rules while addressing gaps in the current strategy execution path.

Making DSH schedule all strategies would produce one consistent workflow but change the other strategies' collaboration methods. Giving each strategy its own messaging and storage implementation would duplicate existing infrastructure and scatter recovery and notification semantics. The recommended approach shares foundation implementations while retaining independent strategy workflows.

<a id="foundation-capabilities"></a>

## Foundation capabilities

Foundation capabilities expose observable execution and state. The following descriptions define proposed capabilities for strategies, not published method names or type declarations.

| Capability | Operations and results supplied by DSH | Choices owned by the strategy |
|---|---|---|
| Session continuation | Reference independent sessions, save history, continue existing sessions, report unavailable recovery | Which member continues and what context to add |
| Member lifecycle | Create members, query status, wait for results, interrupt current execution, end and clean up | Delegation, parallel work, reruns, or member replacement |
| Messaging | Send to identified members, receive notifications, observe delivery failures | Recipients, content, priority, and response actions |
| Shared records | Read and write task-scoped records, observe revisions and changes | Business meaning and use of records |
| Execution feedback | Return tool results, errors, artifacts, verification evidence, and cancellation state | Recovery and acceptance decisions |
| Waiting and waking | Wait for member or record changes, return on timeout, wake on strategy request | Inspection times, discussion triggers, and periods |

Messaging preserves the actual sender identity. Acceptance means the target's receiving mechanism accepted the message; it does not mean the model understood or acted on it. When a strategy requires a member response, the strategy defines its content and the infrastructure delivers and saves it.

Shared records have task ownership and revisions. Record reads, message delivery, and execution status have distinct results. Background state changes do not automatically become context for every member. Strategies supply relevant information through record reads, summaries, or continued sessions.

Active tasks own waits and periodic wakes and release their runtime resources when cancelled or finished. Persistent records may remain, but saving records and resuming execution are distinct capabilities. Reconstructing history alone does not demonstrate that the original backend session can continue.

<a id="current-source-and-integration-gaps"></a>

## Current source and integration gaps

This section records static observations of the current checkout. Runtime integration and native backend capabilities require separate verification.

| Source | Static observation | Design implication |
|---|---|---|
| [agent-team](../../../packages/experimental/agent-team/src/index.ts) | Provides member creation, messaging, shared tasks, revision updates, and change waiting | Reuse its foundation mechanisms; its task board is not already an issue and decision blackboard |
| [subagent](../../../packages/subagent/subagent/src/index.ts) | Provides adjacent-session messaging and continuable children, subject to available services and authority | Preserve continuable session identity and satisfy routing conditions |
| [dsh-child](../../../packages/experimental/task-strategy/src/dsh-child.ts) | Disposes the activation after awaiting each step result | This step execution path cannot directly be treated as a persistent collaboration session |
| [TaskRun](../../../packages/experimental/task-strategy/src/task-run.ts) | Enters a terminal state when step execution returns a status other than completed | The next stage-selection call alone cannot handle these failures in the current path |
| [policy-types](../../../packages/experimental/task-strategy/src/policy-types.ts) | Stage policies synchronously read settled state; model requests belong to ordinary task steps | Discussion and adjudication need an asynchronous execution path, not synchronous next |
| [Superpowers plugin](../../../packages/experimental/task-strategy/src/plugin-superpowers-style.ts) | Mounts a Superpowers-style strategy inside DSH | Blackboard behavior extends this strategy; it does not imply loading external Superpowers skills |

Ordinary strategy children do not automatically become team members because agent-team exists. Integration must establish task, member, session, and backend references and expose capabilities to the decision session and executing members that use them.

<a id="preserving-existing-workflows"></a>

## Preserving existing workflows

Strategies own their planning, execution, inspection, and recovery sequences. Adapters retain the existing execution backend and connect foundation services to supported control operations. Adding communication capabilities alone is not a reason to replace the backend.

The DSH codex-style, claude-style, and zcode-style policies are style strategies. Actual Codex, Claude, or ZCode runners own their sessions and execution workflows. These integration modes require separate descriptions; similar names do not establish equivalent capabilities.

For DSH style strategies, foundation capabilities support sustained collaboration inside DSH without guaranteeing reproduction of an external product's full behavior. For actual native runners, adapters identify support for session continuation, messages during execution, member control, and status queries. An adapter that only returns final results cannot claim full collaboration support on that basis.

If a backend capability is unavailable, the adapter reports the limitation. It cannot silently substitute a new session for the old one and claim context continuity. This design does not require the other three strategies to adopt Superpowers issues, meetings, or risk models.

<a id="superpowers-blackboard-workflow"></a>

## Superpowers blackboard workflow

The blackboard organizes shared records around problems, actions taken, discussions, and decisions. A problem may link its original task, author, affected scope, risk assessment, evidence, and progress. A decision may link related problems, the decision session, the selected approach, and affected members. The implementation plan will define field types and tool names; this section defines their business relationships.

1. An executing member discovers an unexpected problem and reports facts and impact.
2. For a low-risk problem, the member decides and acts independently, then records the problem, action, and result on the blackboard.
3. Superpowers collects medium- and high-risk issues awaiting adjudication. A configured medium-risk count triggers discussion; the high-risk threshold is smaller.
4. Superpowers asks the strategy lead to inspect the blackboard and adjudicate on a configured period, and can also trigger discussion from issues.
5. Discussion results become blackboard decisions linked to relevant issues and are sent to affected members.
6. Members read relevant blackboard content and decisions, report changes to their subsequent work, and communicate further questions.

Members' adoption of decisions is observed through responses and subsequent execution, not inferred from message acceptance. Decisions and blackboard content carry revision references so the adopted adjustment is identifiable. Superpowers defines the response tools.

Risk classification, count thresholds, aggregation scope, and adjudication periods belong to Superpowers configuration. This document preserves the user's relative thresholds without selecting numeric values or adding global work stoppage or approval rules. Subsequent Superpowers workflow design will specify which work continues or waits during discussion.

<a id="unexpected-problems-and-recovery"></a>

## Unexpected problems and recovery

A member encountering a missing dependency can report the problem, evidence, and execution state. Superpowers adds it to the blackboard and organizes adjudication; other strategies use their own recovery workflows. DSH delivers adjustments to the correct member and reports the actual outcome of continuation, restart, or unavailable continuation.

Infrastructure needs to distinguish a finished member turn, a pending business issue, execution failure, task cancellation, and unknown backend state. Strategies choose actions from these observations. A finished member is not equivalent to an accepted task; task completion and artifact verification also need separate representation.

Strategy integration must account for current TaskRun terminal rules. Recoverable problems return to decision-making through strategy-owned execution paths. Sending another message to an already terminated run cannot alone establish recovery. The implementation plan must choose integration mechanics against execution ownership and cancellation rules.

On task cancellation, DSH cleans up task-owned active execution, waits, and periodic wakes. When backend execution outcomes are unknown, report the state or query the existing execution first. Recovery must not automatically interpret an unknown outcome as a reason to execute again.

<a id="validation-goals-and-scope"></a>

## Validation goals and scope

Future verification should demonstrate that existing members receive adjustments and continue relevant sessions; delivery and member responses remain distinguishable; shared records reconstruct correctly and stale updates cannot overwrite new decisions; cancelled tasks no longer wake members; and Superpowers completes discovery, recording, discussion, adjudication, feedback, and continued execution.

Verification of the other three strategies focuses on retaining their own workflows and backend selections without injecting Superpowers risk thresholds or meeting rules. Native backend continuation and messaging must be verified through their adapters; DSH-local tests cannot substitute for that evidence.

This round covers capabilities and responsibilities. Implementation separates foundation integration from Superpowers blackboard use. A blackboard UI, comprehensive native-backend changes, and one scheduler for all four strategies are outside this document's implementation commitment. Detailed protocols, default configuration, and test cases will follow written-design review in an implementation plan.

<a id="dev-note"></a>

## Dev Note

This document does not change product runtime behavior. Source observations locate integration work and are not evidence of completed end-to-end verification.
