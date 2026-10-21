---
description: "Standalone Policy Bundle for one pinned official DSH release."
kind: "package-bundle"
---

# @deepseek-ai/dsh-policy-extension

## Summary

This package installs Policy through the official DSH profile Bundle path. Its `dsh.bundle.patch` adds one plugin row; the same row supplies the Host entry and the Web Client entry declared by `dsh.client`. The package pins DSH `0.2.1-rc.2` in `engines.dsh` and in every DSH peer dependency. [`compatibility.json`](compatibility.json) records the tested source tag and commit.

## Use this package

The ordinary repository build emits both plugin entries. For a focused build, run `npm run build:policy-extension` from the repository root, then install the packed package into an official DSH profile. The published archive contains the Bundle patch, Host entry, Client entry, types, and compatibility metadata. The official profile loader checks the exact DSH version before importing the plugin.

The Host export provides `StrategyRegistry`, `captureStrategy`, and `TaskRun`. A captured strategy retains its author callback after unregistration. `TaskRun` owns the binding epoch, stage cursor, cumulative results and task limits. It snapshots supplemental context before a stage starts, applies a reserved replacement after that stage drains, and retains the existing strategy when replacement admission fails. A resume command continues that retained cursor. Executors must honor cancellation and settle only after releasing children; cancellation waits for their settlement.

## Model Experience

The Bundle activation currently contributes no model-visible text or tools. Consumers of the exported controller supply the executor and stage preparation. Execution prompts retain the original task, captured stage instructions, and selected prior-stage results. Supplemental context affects future stages without changing a running prompt.

#### KV Cache effect

Bundle activation does not change model requests or cache reuse. Controller consumers determine model routes and execution; later-stage prompts include selected settled results and captured supplemental context.

## Known Limitations and Deferred Work

- Host and Client activation remain empty. The extracted controller is independently importable; native task Jobs, task-scoped durable records, bounded feedback intake, member controls, and Web controls remain in the legacy distribution.
- The pinned official DSH public API lacks result-bearing child continuation with exact activation disposal, active-only message admission, and capability-declared child tool restrictions. The native service awaits those public capabilities; the package neither substitutes message delivery for continuation nor uses fork-only implementation code. Member messaging remains a native executor capability and is not exposed by the pure controller.
- No process-restart recovery is provided by the extracted controller.
