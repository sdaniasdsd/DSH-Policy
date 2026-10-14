---
description: "Model-facing subagent delegation tool for users and maintainers configuring, composing, or debugging delegation over a subagent provider."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-subagent

English | [中文](README.zh.md)

## Summary

Use this package to give an agent a named tool that delegates work to a configured backend. Each call starts a managed activation; independent work returns a child id and uses runtime completion notices, while `wait_for_result: true` waits for the final answer in the tool result. Local children support messages and restoration, while external backends execute one task. Supported backends can expose approved child LLM routes. Each instance can set child persona, tool access, and depth limits.

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

The optional `cwd` argument selects the child's initial working directory. Relative paths resolve against the caller's current directory; omission inherits it. Existing children retain their own directories when the caller changes directory.

Mount one instance per delegation target, each with a distinct `toolName`. The tool exists exactly while its provider does, so sibling load order and provider reloads never strand it.

### Minimal configuration

Load the subagent service, an in-process or remote backend, and this tool; then name the provider. This composition exposes a `subagent` tool that delegates to the `spawn` backend:

```yaml
- name: '@deepseek-ai/dsh-subagent'
- name: '@deepseek-ai/dsh-subagent-spawn-in-process'
- name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | required | Provider name on `ctx.subagents` (e.g. `spawn`, `fork`, `acp`) |
| `toolName` | `subagent` | Model-facing tool name; distinct for every loaded instance |
| `modelSelectionSettings` | `false` | Sample the Host's exact-route authorization preference for each top-level Session; a standing preset observes matching Sessions, while direct Agent setup passes its Session explicitly; requires provider `agentOptions` support |
| `agentOptions` | — | Configured child `provider`, `model`, adapter-owned `reasoningEffort`, and positive `maxTokens` defaults; requires provider `agentOptions` support and overlays any provider-owned route defaults |
| `persona` | — | Per-child persona; requires the provider's `persona` capability |
| `toolFilter` | — | Per-child global-tool restriction; requires the `toolFilter` capability |
| `maxDepth` | Host setting (`1`) | Absolute delegation-depth cap (`0` forbids delegation); `'provider-managed'` sends no cap to an out-of-process provider |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-subagent) is the exhaustive source for every accepted field and its JSDoc.

### Managed delegation

By default, a call returns `started subagent <childId>` after the runtime accepts the child, followed by a reminder that this is a child-session id rather than a background job id. The activation owns the work independently of the completed tool call; the runtime sends a completion notice and releases execution resources. Set `wait_for_result: true` when the parent needs the child's answer before continuing; the tool waits for cleanup and returns the final text and stop reason.

Treat the returned id as a subagent id, not a background job id. A successful `send_message` only confirms delivery; in the default mode, use the runtime completion notice to collect the child's result before reporting it. Keep each child id assigned to its task and do not start duplicate work while waiting for its completion notice.

Every backend’s completion notice carries its final answer. Local Spawn and Fork children can also send messages, accept more work through `send_message` while active, or resume after settling. Codex, Claude Code, ACP, and DSH SDK backends do not accept follow-up messages.

`maxDepth` caps recursion (`0` forbids delegation); omission reads the current Host `subagent.maxDepth` setting, initially `1`, at each delegation. A numeric depth requires a provider with the `depthLimit` capability; `'provider-managed'` leaves the budget to an out-of-process provider. `persona` and `toolFilter` configure every child when the provider supports them, and the tool stays visible at the cap — each attempted start checks the calling agent's current depth and rejects with an errored result.

### Selecting a child LLM

Set `modelSelectionSettings: true` to sample the Host's `subagent-model-selection` preference when each fresh top-level Session is composed. A restored Session without a recorded policy remains disabled, including an explicitly empty restore. When enabled, the non-empty exact provider/model route list is recorded in the Session, inherited by child Sessions, and unchanged by later settings edits. The tool then exposes optional `provider`, `model`, and `reasoning_effort` fields and registers the shared `list_subagent_models` tool. This mode requires a backend that advertises `agentOptions`; both in-process backends and DSH SDK support it, while ACP, Codex, and Claude Code reject it rather than ignore it.

A call supplies `provider` and `model` together, or supplies only an effort when configured, parent, or provider-owned defaults provide the route. Static `provider.agentRouteDefaults`, when present, form the provider/model baseline; tool configuration and model fields overlay it before route-aware effort merging and exact-route preflight. Providers without these defaults use compatible values from the parent's latest logged request, then the parent's creation options before its first request, while retaining the configured `maxTokens`. Changing the route without an explicit effort clears the inherited route-owned effort, so the selected model resolves its default. The live LLM adapter validates the effective route before child creation. Catalog membership remains advisory, so a model can use an unlisted id when its adapter accepts it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the tool mirrors provider lifecycle and settles runs; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

One instance is one provider plus one tool name. The plugin mirrors provider lifecycle: it registers the tool when the named provider appears and disposes it when the provider leaves, so sibling load order and HMR replacement cannot strand a dangling tool. Direct Agent setup passes its unpublished Session explicitly and awaits installation before publication. A settings-backed standing preset receives each matching Agent through `agent/created`, selects policy from its Session, and awaits installation through its Context; installation failure rejects creation. A numeric `maxDepth` or configured LLM selection the provider cannot enforce fails the mount instead of the first delegation. At most one instance in a tool scope may own model selection because `list_subagent_models` has a global name.

### Activation ownership

The tool calls `ctx.subagents.startActivation()` with parent delivery for independent work or caller delivery when `wait_for_result` is true. The runtime owns startup cancellation, execution, outcome reporting, and cleanup. A startup failure is an errored tool result; failures after publication arrive through the completion notice or the awaited result, with diagnostics and partial output preserved by the runtime.

### Result acknowledgement

The tool result is `{ kind: 'activation', subagentId }` by default and `{ kind: 'result', subagentId, stopReason, text, diagnostic? }` when `wait_for_result` is true. The runtime retains ownership of the execution Promise and cleanup.

### Context-sensitive wording

The tool's description derives from `provider.inheritsParentContext`: a fresh child gets "it does not see this conversation" wording, a forked child gets "it does not see the current in-flight turn" wording, so the model never restates or omits context that does not exist.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Tool registration, provider lifecycle mirroring, activation requests |
| [`src/model-selection.ts`](src/model-selection.ts) | Request/config merge and live LLM route preflight |
| [`src/model-selection-settings.ts`](src/model-selection-settings.ts) | Host-owned opt-in setting sampled for new Sessions |
| [`src/model-selection-state.ts`](src/model-selection-state.ts) | Session event that records and inherits the sampled decision |
| [`src/list-models.ts`](src/list-models.ts) | `list_subagent_models` runtime discovery tool |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the tool's runtime behavior to the seam it delegates over and the adjacent child tools.

- [Subagent subsystem](../../../docs/subsystems/subagent.md) — providers, activations, results, and continuation.
- [dsh-tool-subagent-control](../tool-subagent-control/README.md) — messaging, interrupt, and listing tools for continuable children.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent) — the default schema and backend-specific wording.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-subagent) — every accepted config field.
- Historical model-selected subagent routes — selection policy, inheritance, discovery, and the fork restriction.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated default [`subagent` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-subagent) appears under the configured tool name while its provider exists. `wait_for_result` selects whether the call returns an activation id or waits for the final answer; an enabled Session policy adds `provider`, `model`, and `reasoning_effort` plus route guidance, and the backend must support `agentOptions`. Context inheritance and continuation support determine the task and follow-up descriptions. A tool restriction removes both the schema and its `tool:<toolName>` guidance section.

#### Token effect

Fixed schema cost per parent request; model selection adds three parameters and result waiting adds one optional boolean. Each tool instance adds one schema and one short system-prompt section.

#### KV Cache effect

Prefix-stable while provider instances and their configuration are unchanged. Adapter catalog changes do not alter the definition; a child route override may prevent a fork child from reusing the inherited parent prefix.

### Model selection and discovery

#### What the model sees

A settings-controlled instance whose Session carries a policy exposes the child LLM selection fields and `list_subagent_models`. Calls reject while the optional `ctx.llm` service is unavailable. Discovery returns only registered providers and advertised models in the exact route policy; an unauthorized provider is rejected before its adapter catalog is called, and an exact lookup must be allowed before it resolves the model's reasoning efforts and default. Execution independently enforces the same policy.

#### Token effect

One fixed discovery schema is present in enabled compositions. Directory contents enter the transcript only when the model calls the tool.

#### KV Cache effect

The schema is prefix-stable across adapter registration and catalog changes. Each discovery result is appended after the reusable prefix.

### System prompt

#### What the model sees

Visible delegation tools share one guidance paragraph, listing tools in name order and instructing the model to start independent delegations together and keep working while they run. Hidden or unavailable tools are omitted; no guidance appears when none are visible. With both `subagent` and `subagent_fork` visible, the text is:

##### Tool-guidance section

```markdown
Start independent delegations with `subagent` or `subagent_fork` together in one assistant message and continue useful work while they run. Set `wait_for_result: true` when your next response depends on a child answer; otherwise use runtime completion notices. Child ids are not background job ids, and do not start duplicate work while waiting for a completion notice.
```

#### Token effect

At most one short delegation paragraph per parent request, listing the tool names visible to that request.

#### KV Cache effect

Prefix-stable while the visible tool names are unchanged; adding or removing a visible tool changes the paragraph.

### Start result

#### What the model sees

The call retains the task description and prompt. By default, success returns `started subagent <childId>` plus the child-id/completion-notice reminder; with `wait_for_result: true`, success returns the child's final text and stop reason. Startup rejection returns an error.

#### Token effect

The prompt and acknowledgement remain in parent history until compaction; child working context remains in the child.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Completion delivery

#### What the model sees

In default mode, answer delivery follows the managed delegation rules above. In result-waiting mode, the answer arrives in the correlated tool result. The returned child id identifies subsequent control and catalog operations; only backends with continuation support accept follow-up messages.

#### Token effect

Messages and completion notices append to parent history independently of the start acknowledgement in default mode. Result-waiting calls include final text and stop reason in the tool result.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what this tool does not return or enforce; they are current package constraints.

- **Waiting occupies the parent tool call** — use the default notification mode for independent work; reserve `wait_for_result: true` for child results that the parent needs before responding.
- **Shipped fork tools cannot select a child LLM route** — they inherit the parent's provider and model to keep the copied conversation prefix eligible for KV Cache reuse. Re-enable selection only when route changes preserve reuse or expose a bounded recomputation cost.
- **Non-routing child policy is fixed per instance** — another persona, tool filter, or depth cap requires another distinctly named tool. LLM selection requires an enabled per-Session preference and a provider that advertises `agentOptions`; both in-process providers and DSH SDK advertise it, while ACP, Codex, and Claude Code reject it rather than ignore it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
