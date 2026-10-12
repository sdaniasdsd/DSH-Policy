---
description: "Author-owned workflow decisions, independent of DSH plugins, with an opt-in Cordis carrier."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-task-strategy

English | [中文](README.zh.md)

## Summary

Write named author strategies that choose task stages, child plugin presets, tool restrictions, and model routes. The main module is a plain library: strategy identities never enter the DSH plugin registry. Its optional `./cordis` carrier mounts through the same Cordis mechanism as other services and executes through original DSH subagents and owned Jobs. Nothing changes in the default product composition.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

DSH child disposal failures reject with `CHILD_DISPOSAL_FAILED`. The error retains the child identity, any observed execution result, the execution or interpretation failure, and the disposal failure. The parent report states the observed execution outcome; cleanup failure cannot establish that no work occurred, and does not trigger an automatic replay.

<a id="token-estimates"></a>
### Explainable token estimates

`list()` returns each strategy's `cost`; `list({ task, preferences })` refines it for the task and selected preference variant without calling `decide`. The carrier reuses DSH's TokenMeter and requires that service. Independent registries accept a text estimator in their constructor; absent estimators and undeclared dynamic plans report unknown cost.

Declarative strategies may set `tokenCost: { callsPerTask, contextTokensPerCall, outputTokensPerCall }`. All values are safe integers; calls are positive and context/output may be zero. These explicit scenario assumptions estimate repeated input, generated output and transfer to later stages. They do not limit execution. Without assumptions, the catalogue reports known task/instruction/result-framing input and task/stage counts, with no total. Session ids, JSON escaping, actual history, reasoning, tokenizer and cache effects remain uncertain. Parent and selector usage are excluded.

Use `task_strategy_list({ task, preferences? })` for model-visible estimates. Automatic selection receives the same task-specific data and prefers suitable workflows before comparing cost. The original Plugins page displays registration costs, assumptions and uncertainty. Registration estimates exclude the task body and are approximate, not billed usage or a guaranteed bound.

The opt-in [workflow configuration](../../../strategies/workflows.patch.yml) supplies coding, paper research, problem research and solution planning at three tiers; its numbers are editable scenario assumptions. See [configuration and tier selection](../../../strategies/README.md#workflow-library).

### Independent author decisions

Task text must contain a non-whitespace character. Decisions, previews and dispatch reject blank tasks before author evaluation or child admission; accepted text keeps its original whitespace.

`AuthorStrategy.decide` and `StrategyRegistry.decide` return `ExecutionPlan` synchronously; author errors throw synchronously. Authors must use trusted, finite plan computation without I/O. Put asynchronous research, model calls and tools in the cancellable executor. The carrier's `ctx.taskStrategies.decide` remains asynchronous because it also performs admission. See the [synchronous-decision upgrade guide](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-synchronous-decisions/guide.md) for migration from the previous author interface.

Import `StrategyRegistry` and `executePlan` from the main entry. Register `{ id, description, decide(input) }`; the decision receives `{ task, preferences }` and returns an `ExecutionPlan`. `register` returns a disposer; duplicate names reject. Decisions and input are detached snapshots. Plans contain ordered stages; tasks within one stage run concurrently up to `maxConcurrent`. Each task names `label`, `instruction` and exactly one `preset` or `executor`. Native preset tasks may also carry `tools: { allow, deny }`, `model`, and `provider`. The pure executor accepts your cancellation-aware `TaskExecutor`; that callback must settle after releasing resources.

<a id="runtime-plugins"></a>

### Task runtime and orchestration plugins

The composer shows an orchestration selector immediately before the model selector. DSH uses automatic or named task policies; `*-style` modes use DSH execution and `*-native` modes use separately configured native backends. Plugins publish their mode with `taskStrategies.registerOrchestration(mode, executor?, check?)`. `orchestration({ sessionId })` reports availability and `selectOrchestration({ sessionId, mode })` acknowledges a session-local choice. It affects newly dispatched tasks, takes precedence over automatic strategy selection, and resets when the Host owner restarts. Intake captures the exact plugin registration; unloading it rejects pending new admissions instead of silently substituting another backend. Running Jobs keep their captured adapter. Unconfigured modes are shown disabled.

Load `@deepseek-ai/dsh-experimental-task-strategy/runtime` alongside `./cordis`; the workflow bundle includes both. `ctx.taskStrategies` owns policy registration, cost estimates and selection. `ctx.taskRuns` owns plan admission, stage state and original Jobs; existing strategy controls delegate to it. External callers can use `taskRuns.start(parent, task, plan, rules, signal)` without registering a policy, inspect the exact owner's run, reserve a captured replacement at a drained stage boundary and resume an observed binding epoch.

Each task selects exactly one native `preset` or external `executor`. `allowedExecutors` explicitly permits adapter identities; omission permits none. `taskRuns.registerExecutor` contributes `{ id, description, check, execute }` under the calling plugin's Cordis lifetime. `check` synchronously checks backend availability; `execute(parent, step, prompt, signal)` must honor cancellation and settle after releasing children. External steps cannot carry DSH presets, tool filters or model/provider overrides: the native providers cannot enforce these controls. Active children retain their original owner after unload, while new admissions fail once their adapter is removed.

The independently mountable `./plugins/codex`, `./plugins/claude` and `./plugins/zcode` each register a policy and executor. Codex and Claude delegate autonomous work to the existing official `@deepseek-ai/dsh-subagent-codex` and `@deepseek-ai/dsh-subagent-claude-code` providers. Native planning, context, tools, authentication and permissions remain in those products; configure the backend bundle before enabling its orchestration plugin. Policy/backend identities, descriptions and instructions are editable. Optional `tokenCost` supplies scenario assumptions; absent assumptions leave internal turns/tool traffic unknown. Each step starts one native run; native steering and session resume are not exposed.

ZCode uses the official [open-source CLI](https://github.com/zai-org/ZCode) with `--prompt`, `--output-format json`, explicit `--mode` and optional `--enable-workflow`. Configure an installed executable using `command` and optional prefix `args`; resolution and whole-range cleanup use original DSH subprocess services. Default `mode: plan` retains planning permissions; `build`, `edit` and `yolo` require explicit configuration. Timeout, cleanup grace and prompt/result byte ceilings are configurable. Truncated/invalid JSON and nonterminal projection status reject; cancellation is checked even after exit zero. The plugin does not implicitly inherit DSH credentials or elevate permissions.

The optional [orchestration patch](../../../strategies/orchestration.patch.yml) supplies three disabled plugin rows and an executor allowlist. Enable configured backends individually through the original Plugins page; the Task strategies card lists their contributed policies and cost uncertainty. Missing backends or executables reject without fallback.

### Task-owned strategy replacement

`TaskRun` and `captureStrategy` provide a plain-library runtime for captured static plans. A run retains its task input, results, cumulative child admissions and result-byte limit across replacement. `requestSwitch(load, { expectedBindingEpoch, startStage })` immediately reserves a command and synchronously captures its target plan; the current stage drains before admission and binding commitment. The target cursor is an explicit zero-based index, defaulting to zero. A rejected switch enters `waiting` with the previous binding intact; `resume(expectedBindingEpoch)` continues that binding, or another switch can select a different target. Both commands require the nonnegative safe-integer `binding.epoch` observed through `inspect()`; stale expectations reject before author evaluation or state change. `cancel(reason)` aborts active execution and settles after cleanup. `load` must synchronously return captured plan data; asynchronous work belongs to the executor.

The carrier exposes host methods `submit(parent, request, signal)`, `inspect(parent, jobId)`, `requestSwitch(parent, jobId, request)` and `resume(parent, jobId, expectedBindingEpoch)`. `submit` requires `{ requestId, strategy, task, preferences? }`: equal requests under the same live Agent share one admission and receipt; reusing the id with different input rejects. Rejected admissions release their reservation. The first submitter's signal owns admission cancellation; later duplicate calls do not cancel accepted work. Use original Jobs operations to wait or cancel. Switch requests require `{ strategy, expectedBindingEpoch, preferences?, startStage? }`; pass the epoch from the view used to make the choice. `requestSwitch` returns a reservation number, and `inspect` or Job logs report the committed binding. After an epoch mismatch, inspect again and explicitly reconsider the command. These host controls add no model tools or input routing.

Accepted runs retain their captured deployment rules when the carrier reloads. A newly mounted carrier can control them through the same live Agent and Jobs service. A switch captures the newly selected plan under the current registry, then admits it under the run's retained rules. Thus a newly allowed preset requires a new run if the original run did not authorize it. This slice uses the original JobId as the task identity.

### Automatic intake and optional choice

Use `submitTask(parent, { requestId, task, selection?, preferences? }, signal)`. Omitted selection captures the current plugin default; `{ kind: 'auto' }` selects from registered candidates, while `{ kind: 'named', strategy }` bypasses the selector. The receipt contains `{ jobId, name, strategy }`. Equal repeated requests share the reserved promise; conflicting input rejects; failed intake releases the id.

Tool receipts preserve complete Job and strategy identities, shortening only oversized display names. Before accepting a Job, intake limits the JSON-encoded strategy id to the carrier's `maxOutputBytes` minus 256 bytes reserved for original Jobs metadata. This prevents a long id from destroying the acknowledgement at the minimum 512-byte output limit.

If remounting lowers that limit below an already accepted receipt's identity size, a repeated tool call reports that the Job is already accepted and gives its id. Use `job_output`, or restore the previous limit and repeat the same request. The retained host receipt and request reservation remain unchanged; the task does not run again.

Automatic selection uses an original child with only its local `structured_output` tool, unchanged task data, preferences and captured candidate descriptions. Defaults are a 30,000 ms deadline, 32,768 prompt bytes, 2,048 result bytes and 512 output tokens. Invalid capture, timeout, cancellation or removal of the chosen strategy rejects before an execution Job is created. Selector cleanup precedes acceptance. Author decisions remain synchronous. Named intake avoids the selector cost.

The composer’s “Fully automatic / Choose manually” switch folds manual mode and high/medium/low controls. With `selection.default: { kind: auto, workflow: true }`, one restricted Agent chooses among all registered strategies, selects a supported style tier and returns a short explanation without requesting a preference reply. Fixed workflows keep their declared plans. An explicit composer switch to automatic applies this behavior to future intake regardless of the deployment’s named default. The receipt retains the initial choice and model explanation; task estimates use that captured tier, while later stage switches keep their separate binding history. This changes neither the original chat/control router nor permission approval.

The switch keeps its existing layout and adds elastic lens movement, a brief highlight sweep and local SVG backdrop refraction using an embedded edge map. Refraction affects only the decorative thumb; labels remain unfiltered. Each mounted switch owns a distinct filter ID. No external assets, frame loops or timers are added. Reduced-motion settings disable movement and highlight animation; forced-color settings use a plain high-contrast surface. Browsers without SVG backdrop filtering retain the glass surface.

`selection.fallbackStrategy` optionally names a registered fallback for autonomous selection failures before Job acceptance; style fallbacks use medium. The workflow bundle configures `codex-style`. The card reports the fallback and the selection error. Caller cancellation, owner disposal, removed strategies and execution failures never trigger this fallback. Without a configured fallback, selection failure rejects as before. Legacy `{ kind: auto }` intake retains strategy-only selection.

Optional questions use the original timed `ask_user_question` before `task_strategy_submit`. No answer means the configured default still runs. A late reply never creates a new id or repeats the original task; accepted tasks use existing host controls for stage-boundary switching. With `entry.enabled: false`, ordinary chat uses the explicit strategy tools through the original model loop.

### Automatic root entry

Routing validates the complete declared tool envelope, then keeps only fields used by the chosen intent. Declared task fields on `chat` or `clarify` are ignored; unknown fields, invalid values of relevant fields, and incomplete switch commands still reject without executing work.

Routing and automatic selection use the exact model's advertised `off` reasoning effort when available, within their own output cap; execution keeps its original effort. Routing sees original content without transport message identities and accepts control targets only from the offered owned tasks. Status with no target reads the sole active task, or the latest terminal task when none is active. Mutating controls never use this terminal fallback, and status never dispatches another Job.

`entry.enabled: true` routes each original root user message before its model step. The independent carrier defaults to false; the policy workflow bundle enables it. The Plugins page saves this switch for future inputs using the existing versioned configuration form. Conversation stays in the root; executable work enters one original owned Job after bounded routing and strategy selection. No answer is required for automatic selection. Failed routing or selection never starts direct execution. Root native tools and PTC business calls are restricted to task controls; execution children retain their selected presets and original permissions.

The chat card shows routing before a Job exists, then the selected strategy, child-token scenario estimate and actual stage counts. Ordinary chat and inputs associated with an existing request hide the card while preserving its node identity, so later conversation updates continue to publish. Its cancel, switch and resume actions use Host-owned request identity and observed binding epochs. Supplementary text is captured once per next unstarted stage; a running final stage explicitly rejects supplements. Routing and execution receive bounded prior conversation as context data while retaining the original input. Nontext execution inputs are explicitly rejected while their original attachments remain recorded. Entry facts survive carrier remount; process restart restores presentation only, showing interrupted work without dispatching it again. See the [upgrade guide](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-default-entry/guide.md).

The web half registers **Task strategies** in the original Plugins page. It edits default mode/name, model/provider route and deadline through staged forms and revision-fenced writes. Byte and token limits remain in Loader configuration. Live `Volatile` references affect future intake; accepted Jobs keep captured rules. Catalogue reads discard obsolete responses after reconnect/unload and retain displayed entries on refresh failure. The generated Remote exposes the catalogue and owned entry state/cancel/switch/resume controls. See the [selection upgrade guide](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.md).

### DSH source trial

From the repository root, use the supported named-profile launcher:

```powershell
node --import tsx/esm apps/cli/lib/bin.js --profile web --patch packages/experimental/task-strategy/cordis.source.patch.yml --no-open --port 3090
```

The original ConfigEditor refuses saves that a command-line overlay would override; the page keeps the draft and reports failure. For editable plugin defaults, copy the overlay's insert rows into the active `<DSH_HOME>/profiles/web/cordis.patch.yml`, replace the relative carrier name with its absolute source file URL (obtain it with Node's `pathToFileURL`, or use an installed `@deepseek-ai/dsh-experimental-task-strategy/cordis` export), and launch that profile without the strategy `--patch`. The profile patch then owns configuration persistence. Use the file URL because the original editor's preview does not normalize local path names consistently with profile loading and can incorrectly reject a save as an override conflict.

Edit [cordis.source.patch.yml](cordis.source.patch.yml) to author strategy preferences and flows. `direct` uses one original DSH child. `cautious` runs two read/search-only children concurrently, then one implementation child; `preferences: { speed: "fast" }` selects a shorter flow. `allowedPresets` explicitly authorizes original DSH preset compositions. Selecting a preset does not grant filesystem or approval permissions. Omitting a tool filter preserves that preset's tools; an explicit empty allowlist exposes no tools.

The separate carrier provides `ctx.taskStrategies`: `register`, `list`, `catalog`, `decide`, and `start`. It injects original `agents`, `tools`, `subagents`, `agentPresets`, `jobs`, and `tokenMeter`. Authors may register JavaScript decision functions under their caller's Cordis lifetime, or declare preference-selected plans in carrier configuration. Root agents receive `task_strategy_submit`, `task_strategy_list`, `task_strategy_plan`, and `task_strategy_run`; lower subagents do not inherit these control tools. Upper agents may select a named policy or submit an explicit plan, but may only select allowed presets. Observe and cancel using original `job_list`, `job_output`, and `job_kill`; progress includes stage names and completed child session identities.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The registry decides without loading plugins. The executor imposes stage barriers, concurrency, task-count and result-byte bounds, and passes labelled prior-stage outputs as data. The task service preflights provider capabilities, presets and external executors before starting a Job. Original in-process DSH drivers mount the chosen preset during unpublished child setup; child permission delegation, model loop, settlement, and cleanup remain original. A failed child stops admissions and cancels siblings; the stage drains before terminal settlement. Carrier unload removes strategy registrations and tools but does not cancel or wait for Jobs already accepted. Each accepted job keeps its captured plan and limits and remains cancellable through `job_kill`, owner disposal, or Jobs-backend shutdown. Existing subsystem invariants cover original Agent, subagent, preset, tool, and Job ownership; this library has no independently registered invariant.

`TaskRun` owns the task state and delegates stage execution to `executor`. Two shared data modules support all strategies: `execution-data` prepares prior-result prompts and accounts for ordered results in complete UTF-8 JSON; `run-projection` derives usage, current-binding evidence and detached policy snapshots. These synchronous helpers own no agents, permissions or cancellation controllers. They are internal modules in this package, with no separate plugin registration. Context serialization, result accounting and state projection can be maintained here without adding branches for orchestration styles; prompts retain complete prior results and byte limits include result metadata.

See the [accepted Job lifetime decision](../../../.agents/notes/implemented/architecture/2026-10-05-task-strategy-job-lifetime.md) for the lifecycle rationale and boundaries.

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Independent author registry |
| [src/types.ts](src/types.ts) | Plans and executor contracts |
| [src/executor.ts](src/executor.ts) | Ordered stages and bounded concurrency |
| [src/execution-data.ts](src/execution-data.ts) | Shared stage prompts and ordered result byte accounting |
| [src/errors.ts](src/errors.ts) | Failure rendering that preserves reservation settlement and cleanup |
| [src/task-input.ts](src/task-input.ts) | Shared nonblank task validation, preserving accepted text |
| [src/runtime-types.ts](src/runtime-types.ts) | Task views, captured bindings and host requests |
| [src/static-plan.ts](src/static-plan.ts) | Detached plan revisions and explicit stage selection |
| [src/task-run.ts](src/task-run.ts) | Task state, stage barriers, replacement and cancellation |
| [src/run-projection.ts](src/run-projection.ts) | Shared usage, current-binding evidence and detached policy snapshots |
| [src/admission.ts](src/admission.ts) | Captured provider, preset and tool admission rules |
| [src/task-submissions.ts](src/task-submissions.ts) | Owner-scoped duplicate reservation and live run references |
| [src/cordis.ts](src/cordis.ts) | Optional original-DSH integration carrier |
| [src/task-runtime-service.ts](src/task-runtime-service.ts) | Independent owned task execution and controls |
| [src/executor-registry.ts](src/executor-registry.ts) | Effect-scoped external execution adapters |
| [src/native-orchestrator.ts](src/native-orchestrator.ts) | Shared Codex/Claude native plugin registration |
| [src/plugin-zcode.ts](src/plugin-zcode.ts) | Native ZCode policy and managed CLI adapter |
| [src/tools.ts](src/tools.ts) | Upper decision and dispatch tools |
| [src/schema.ts](src/schema.ts) | Configuration and untrusted JSON validation |
| [src/selection-types.ts](src/selection-types.ts) | Automatic/named intake and selection limits |
| [src/selector.ts](src/selector.ts) | Bounded structured choice and child cleanup |
| [src/client/index.ts](src/client/index.ts) | Generated Remote and original plugin UI registration |
| [tests/adapter.spec.ts](tests/adapter.spec.ts) | Real Loader composition and keyless model-loop recording |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent contracts](../../subagent/subagent/README.md)
- [Preset registry](../../preset/agent-preset-registry/README.md)
- [Local jobs](../../jobs/jobs-local/README.md)

-----

<a id="dsh-style-policies"></a>
## DSH style policies and feedback

The additive plugin entries `plugins/codex-style`, `plugins/claude-style` and `plugins/zcode-style` register independent `*-style` IDs. They borrow orchestration patterns and execute with original DSH presets, models, scoped tools, permissions, Jobs and cancellation. They do not start external product CLIs or reuse their authentication. Existing `plugins/codex`, `plugins/claude`, `plugins/zcode` and `*-native` identities keep their previous meaning and remain optional.

An author may provide synchronous `next(input, snapshot): StageDecision`. `decide` supplies an admission preview. A decision returns one `stage`, `finish` or `blocked`; asynchronous planning is an ordinary cancellable child, never an awaited policy callback. `results` contains cumulative handoff data; `currentResults` contains only the committed binding's results. Replacement starts an adaptive binding at stage zero. Captured callbacks survive unregister; fresh intake must pass the current registration fence. Callbacks are trusted finite host code: cancellation cannot interrupt a non-returning synchronous callback. Existing static authors need no change.

Codex style alternates work and read-only checks; Claude style explores, executes and independently reviews; ZCode style traverses a validated finite dependency graph in milestones. Writable milestone children are serialized using `stage.serial`; independent Jobs still share the workspace. Missing dependencies, cycles and duplicate IDs are rejected. The shared recipes cover coding, paper research, problem research and solution planning.

Each style plugin accepts `tier` (default `medium`), `maxNodes` (6), `maxRepairs` (2), `maxTokens` (4096 per model call), `timeoutMs` (300000 per child), `preset`, `readTools` and `tokenCost`. Low permits one node/no repair, medium at most three nodes/one repair, high up to configured limits. The composer captures a selected tier for new tasks; it does not mutate accepted work or increase permissions. Cumulative task and result ceilings still apply. Repair is limited to failed registered checks or model findings supported by child-owned reads; it is followed by fresh review and verification. Execution errors, denials and unknown side effects are not automatically replayed.

`workflowOutput` obtains validated `WorkflowProposal` through original structured output. `artifactChecks` freezes file requirements before execution; `contains` is literal file text, not a prose description or byte/encoding assertion. Host verification correlates original native/PTC `read` observations to the exact child, resolves relative paths against its inherited workspace, and enforces evidence memory per session. Assistant claims, echoed path headers, denied/missing reads and synthetic truncation text cannot prove content. A partial read may establish an observed literal substring, but cannot establish its absence; trailing newline/encoding are not proven by a line-based read. Zero checks means unverified. Passing checks establishes only those registered conditions.

`reviewOutput` produces a separate model assessment. Actionable findings require literal quoted file content and matching read paths. Contradictory status/findings or unsupported evidence yield `unverified`; malformed data fails the child. A model review never substitutes for artifact verification or an executed test. The task card separates execution end, registered checks, model review, and measured usage coverage.

`task_strategy_propose` / Host `proposeEntry` registers an identified suggestion without starting a Job. Only human acceptance via `acceptProposal` or an unambiguous original user reply dispatches it. Equal proposal IDs with equal payloads and repeated acceptance are idempotent; conflicting payloads fail. Multiple pending candidates on a short “go ahead” require clarification. Cancelled proposals cannot be accepted. Proposal and entry snapshots are logged under the existing `task-strategy/entry` event; process restart interrupts pending/active records and does not resume them.

Declared costs include a baseline and `maximumPlan` scenario including bounded repair/review/verification. Both are estimates, not token limits or bills. Logged child model usage is shown separately (provider aggregate totals or disjoint input/cache/output counters); missing reports remain unknown. Routing, root usage and provider-internal retries are excluded. Plugin registration performs no model calls to estimate cost.

The workflow bundle now enables the three style plugins alongside the original 12 recipes and leaves native adapters disabled. For an existing profile, preview and explicitly enable the new plugin entries; keep old native IDs for historical tasks. Do not append a second carrier or silently rewrite native settings. The original Agent loop is unchanged.

The task card exposes the initial captured model, provider, permission authority and execution limits. Its configuration revision includes the initial plan and declared `policyRevision`; a plan revision alone does not cover adaptive policy settings. These are diagnostic records, not permission grants or a complete hash of evolving tool/preset permissions. Stage replacements have their own binding epochs and revisions.

The card is placed at session scope with the original event anchor. Jobs and proposals may span model turns, so the card remains outside the original thought/process disclosure; it does not change that disclosure or the Agent loop.

<a id="model-experience"></a>
## Model Experience

### Upper decision tools and lower task input

#### What the model sees

The optional carrier accepts an unchanged original request through `task_strategy_submit`, lists strategy descriptions and allowed preset names through `task_strategy_list`, previews a JSON execution plan through `task_strategy_plan`, and dispatches an explicit plan or named strategy through `task_strategy_run`. Submission returns the original Job id and selected strategy. Automatic selection records a separate child session containing the task data, candidate descriptions and structured capture. Lower tasks receive the user's task, their selected instructions, and labelled prior-stage text results. Job output exposes progress and the terminal report. The main registry itself adds no prompt sections or tools.

#### Token effect

Root agents pay for decision and control schemas. Automatic root entry adds a routing child; automatic selection also adds a selector child with bounded output tokens. Named selection bypasses the selector. Each execution child pays for its chosen preset and accumulated prior-stage data. Cost estimates exclude routing, selection and root usage. Result and output byte ceilings bound retained text; report truncation includes an explicit notice and need not remain valid JSON. Acceptance receipts remain valid JSON.

#### KV Cache effect

Upper tool results append to history. Selector and execution children have separate request prefixes; preset, filter, or route selection can change those prefixes. No parent cache reuse is promised.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Concurrency is per run, not a global quota across multiple jobs. The workflow is ordered stages, not an arbitrary DAG or durable queue.
- Children share working files. Tool filtering is not filesystem isolation; concurrent writes require an author-chosen safe flow.
- Automatic retries, arbitrary mid-stage pause and crash recovery are absent. `completed` means the original model turn completed, not independent correctness verification.
- Task state and request reservations are process-local; they survive carrier remount, not process restart or replacement of the Jobs service. The old module instance must remain loaded for that remount. Preset implementation revisions are resolved at admission rather than pinned across the entire task.
- Replacement supports captured static plans and synchronous adaptive policies. Durable execution recovery remains deferred. The standard product does not enable automatic entry by default.
- Reports retain bounded text and serializable workflow/review/check/usage data. Byte-limit failures stop the flow; oversized presentation text is explicitly truncated.
- This is experimental and opt-in. Real model execution requires an available configured model provider; tests use a scripted, keyless model adapter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

After building the package and its dependencies, run `node --test packages/experimental/task-strategy/tests/blackbox.mjs` from the repository root to exercise published exports, Loader composition, host controls and tool JSON. The focused E2E wrapper is [built-blackbox.e2e.ts](tests/built-blackbox.e2e.ts). The [headless session snapshot](../../../snapshots/session/task-strategy-empty-input/snapshot.yml) replays blank preview and dispatch rejection through the supported `dsh` launcher.

The [selection snapshot](../../../snapshots/session/task-strategy-selection/snapshot.yml) records an unanswered native question, structured selector capture and one original execution Job. Client assembly tests use original Gateway, generated codecs, settings forms and slots.

</details>
