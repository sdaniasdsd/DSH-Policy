# DSH Policy extreme-high tier and Superpowers-style plugin

English | [中文](2026-10-12-dsh-policy-extreme-tier-superpowers-design.zh.md)

## Goal

Extend the opt-in task-strategy workflow library with an `extreme-high` tier for the existing Codex-style, Claude-style, and ZCode-style policies, and add a removable Superpowers-style policy plugin. The change is for high-intensity workflow validation in DSH Policy Edition; it does not claim to increase measured or billed provider usage.

## Existing boundaries

The task-strategy package already separates DSH-executed style policies (`codex-style`, `claude-style`, and `zcode-style`) from native Codex and Claude orchestration adapters (`codex` and `claude`). Style policies execute planning, work, review, repair, and artifact checks through the configured DSH preset. Native adapters invoke one original subagent provider run and report its final result. This design extends the DSH-executed style policy family; it does not change native provider lifecycle or authentication.

## Recommended design

Add `extreme-high` as a tier available to Codex-style, Claude-style, ZCode-style, and the new Superpowers-style plugin. It uses a separate, finite configuration profile with larger node, repair, per-step token, and timeout ceilings than the existing `high` tier. Defaults remain bounded by the existing schema maxima; all captured values are validated and reflected in baseline and maximum scenario estimates. Existing low, medium, and high behavior remains unchanged.

The Codex-style policy keeps sequential work and per-node read-only review, then applies the larger extreme-high planning and repair bounds. The Claude-style policy keeps read-only exploration and final review and uses the same larger bounds. ZCode-style keeps its existing milestone execution pattern and uses the larger bounds. All three retain current artifact-check semantics and repair only tool-confirmed failures or review findings with file evidence.

Add an independently mountable `plugins/superpowers-style` entry, implemented through the existing style-policy machinery and original DSH preset/executor. Its workflow uses distinct stages for task understanding, bounded planning, implementation, verification, review, and evidence-based repair. It follows the recognizable Superpowers workflow cadence without importing or executing external skill files, calling native Codex/Claude, or claiming to be an official Superpowers integration. It supports the same four tiers and token-estimate caveats as the three existing style plugins.

Update the orchestration selector and strategy catalog so users can choose the new policy and its tier. Keep all four new/extended style plugins opt-in; do not change profile defaults. Preserve existing plugin IDs, package entry points, policy IDs, and captured-run behavior.

## Configuration and usage accounting

The extreme-high profile exposes validated finite values for maximum plan nodes, repairs, per-step output tokens, and timeout. Its defaults must exceed the corresponding default high-tier limits while staying within package-wide maxima. Existing token-cost assumptions remain editable scenario inputs and are never described as hard limits or billed amounts. Reports continue to distinguish the estimate from any observed child usage; unavailable provider usage remains unknown.

The composer exposes the extreme-high choice for the Codex-style, Claude-style, ZCode-style, and Superpowers-style modes. A run captures the selected tier and limits at intake. Later configuration changes affect new runs only.

## Failure and safety behavior

Malformed or unsupported tier preferences fail at strategy selection. Plans that exceed the captured node limit fail before excess work is admitted. Each child step retains existing cancellation, timeout, task-result, DSH permission, and cleanup behavior. Repair remains bounded and cannot repeat an execution whose result is unknown. The new plugin does not widen tool access, change filesystem isolation, auto-approve actions, or create provider credentials.

## Validation scope

Focused package tests cover tier parsing, captured limits, increased stage and repair ceilings, scenario estimates, selector visibility, plugin disposal, evidence-based repair, cancellation, and unchanged low/medium/high behavior. A real Loader composition test confirms each opt-in plugin registers and unloads cleanly with the actual task-strategy carrier. A controlled high-intensity run uses deterministic child results to exercise the maximum configured plan and repair path without provider credentials. Real Codex/Claude API or subscription consumption is a separate, manually selected check and is not required for this change.

## Out of scope

- Changing native `plugins/codex` or `plugins/claude` orchestration, their authentication, or provider-specific run lifecycles.
- Adding an extreme-high tier to the general workflow catalogue.
- Automatically spending real Codex/Claude quota, estimating actual billing, or promising a measured usage target.
- Loading third-party Superpowers skill files or presenting this plugin as an official integration.
- Changing shipped profile defaults or the base product composition.

## Completion criteria

- Codex-style, Claude-style, ZCode-style, and Superpowers-style expose a bounded `extreme-high` choice with cost scenarios that reflect captured limits.
- Superpowers-style is removable and executes only through DSH's existing task runtime and preset.
- Existing low/medium/high tiers, native Codex/Claude adapters, and default compositions retain their behavior.
- Focused deterministic and real-composition evidence covers registration, execution limits, cleanup, estimates, and selector behavior.
