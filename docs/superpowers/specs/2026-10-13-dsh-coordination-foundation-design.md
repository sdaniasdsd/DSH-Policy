# DSH Generic Task Coordination Capabilities

English | [中文](2026-10-13-dsh-coordination-foundation-design.zh.md)

## Goal

DSH provides generic coordination capabilities for running tasks and exposes them through one common LLM tool entry. DSH does not define workflows, command protocols or plugin-specific adapters for Codex, Claude, ZCode, Superpowers or other plugins. Strategy maintainers can select and use these foundation APIs according to their own native requirements.

## Responsibility boundary

| DSH provides | Strategy maintainers decide |
|---|---|
| Member identity and active state under the original task Job | Whether to create members and how to assign work |
| APIs to open, continue and end a member session | When to continue and what instructions to send |
| Sender-preserving message delivery and acceptance receipts | Message format, recipients, timing and how to confirm processing |
| Task-scoped, versioned shared records and waits | Keys, JSON shapes, risk semantics and conflict handling |
| A bounded root-model tool entry and task ownership checks | Internal commands, discussion, adjudication and workflow |

A message receipt means only that the delivery mechanism accepted the message; it does not mean a member processed or adopted it. A record-write receipt means that revision was persisted. DSH does not interpret record contents or trigger strategy actions from them.

## Generic LLM tool protocol

Tool names follow the carrier's `toolPrefix`, which defaults to `task_strategy`. These commands operate only on generic task state:

| Tool | Parameters | Behavior |
|---|---|---|
| `{prefix}_inspect` | `jobId` | Read the current task snapshot and active DSH members |
| `{prefix}_message` | `jobId`, `childId`, `text` | Deliver a message to an active DSH member of the same task; return `messageId` |
| `{prefix}_record_read` | `jobId`, `key` | Return the latest record or `null` |
| `{prefix}_record_list` | `jobId` | List latest records |
| `{prefix}_record_write` | `jobId`, `key`, `value`, `expectedRevision` | Compare-and-set a JSON value and return its new revision; reject conflicts |
| `{prefix}_record_wait` | `jobId`, `key`, `afterRevision`, `timeoutMs` | Wait for a higher revision, timeout or task cancellation |

Every operation requires the caller to own the Job. Keys must be nonempty; values must be JSON-serializable and fit the task size limit. An absent record has revision 0. Messages target only currently active local DSH members; these tools do not take over control channels for native CLIs or external providers. Tool output follows the configured byte limit; an oversized record may omit its value while preserving its key and revision.

A strategy may map these tools to its own commands or prompts, or not use them at all. DSH does not require any plugin to install a DSH-specific adapter.

## Preserve existing paths

Existing Codex, Claude, ZCode and Superpowers entry points, strategies and provider behavior remain unchanged by these generic capabilities. DSH adds or changes no native adapter for them, and injects no blackboard, meeting, risk, threshold, periodic-adjudication or adoption-check policy. Existing strategy implementations inside DSH also continue their current workflows.

These APIs describe DSH capabilities; they do not imply that an external product exposes equivalent operations. Whether a native provider can resume a session, receive an in-flight message or report state remains a property of that provider. A strategy uses these capabilities only after its maintainer explicitly connects them.

## Validation goals

- The same Job owner can read, write, list and wait on that task's records; another owner cannot read or change them.
- Compare-and-set rejects stale revisions, and waiters observe persisted revisions.
- Messages reach only currently active local members of the same task and preserve the task owner as sender.
- Root LLM tools enforce the same ownership, cancellation, size and error semantics.
- Concurrent execution respects the current stage's author-defined concurrency and the carrier's task budget.
- Native entry points have no changed code path; mock/Loader tests verify DSH interfaces only and do not claim live Codex or Claude CLI integration.

## Scope

Implement generic member sessions, task records, messaging and common LLM tools, with source tests and Loader-level flow verification for each capability. Do not add plugin-specific adapters, strategy protocols or business workflows. Strategy maintainers decide how to use the capabilities in their own strategies.
