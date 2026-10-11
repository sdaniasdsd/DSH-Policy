# Pluggable orchestration and task runtime

English | [中文](2026-10-10-orchestration-plugins.zh.md)

## Approved scope

The user authorizes implementation in the existing strategy edition. Preserve the original Agent loop, Subagents providers, Jobs ownership, permissions and logged model inputs. Codex, Claude Code and ZCode are removable orchestration plugins; the common runtime contains no product-specific branches. Use upstream source to establish ZCode's actual integration protocol.

## Responsibilities

`taskStrategies` owns synchronous author-policy registration, costing, LLM selection and intake deduplication. `taskRuns` owns plan admission, task state, stage barriers and original Jobs creation. External plugins register both a policy and an executor adapter. Native DSH steps retain preset selection and tool restrictions. An external step explicitly names an allowed executor and cannot simultaneously claim a DSH preset or unsupported tool/model controls.

Accepted Jobs retain their captured task rules and exact live owner. Cancellation drains original child handles before settlement. Plugin disposal removes future policy/executor admissions; in-flight children remain owned by their original provider and Job. Switching occurs only after the current stage drains, preserves task-wide budgets, and rejects stale binding epochs. No implicit executor fallback or security expansion is allowed.

## Plugin contract

Public registration is effect scoped. Executors expose an identifier, description, admission check and cancellable execution through the original Subagents service. Plugins contribute independent strategies through `taskStrategies.register`; they may delegate one autonomous task to their native harness, whose internal planning remains native. Core runtime does not imitate or embed closed product internals. Native backend permission/authentication configuration remains explicitly owned by the existing backend plugin.

Token costing uses known input plus explicit optional assumptions; external internal turns/tool traffic remain unknown. The selector must see uncertainty rather than a zero-cost claim. Plugins can be enabled and disabled independently using Cordis configuration.

## Acceptance

Loader tests exercise separate task runtime and strategy services, mixed native/external plans, cancellation/cleanup, exact owner checks, unload and unavailable backends. Native control restrictions reject before a Job starts. Existing strategy entry, selector and stage-switch tests remain green. Published exports and configuration examples resolve from built artifacts. Local application replacement uses a fresh build and preserves user profiles/plugins with a rollback copy.
