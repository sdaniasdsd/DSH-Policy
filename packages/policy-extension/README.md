---
description: "Standalone Policy Bundle for one pinned official DSH release."
kind: "package-bundle"
---

# @deepseek-ai/dsh-policy-extension

## Summary

This package installs Policy through the official DSH profile Bundle path. Its `dsh.bundle.patch` adds one plugin row; the same row supplies the Host entry and the Web Client entry declared by `dsh.client`. The package pins DSH `0.2.1-rc.3` in `engines.dsh` and in every DSH peer dependency. [`compatibility.json`](compatibility.json) records the DSH source tag, source commit, and exact Desktop runtime build commit.

## Use this package

The ordinary repository build emits both plugin entries. For a focused build, run `npm run build:policy-extension` from the repository root, then install the packed package into an official DSH profile. The published archive contains the Bundle patch, Host entry, Client entry, types, and compatibility metadata. The official profile loader checks the exact DSH version before importing the plugin.

GitHub releases publish a fixed `dsh-policy-extension-<version>.tgz` asset for the exact `policy-extension-v<version>` tag. The release workflow builds and tests the package, checks the packed metadata and exact DSH peer pins, rejects install lifecycle scripts, and publishes a matching `SHA256SUMS.txt` file.

The Host export provides `StrategyRegistry`, `captureStrategy`, and `TaskRun`. A captured strategy retains its author callback after unregistration. `TaskRun` owns the binding epoch, stage cursor, cumulative results and task limits. It snapshots supplemental context before a stage starts, applies a reserved replacement after that stage drains, and retains the existing strategy when replacement admission fails. A resume command continues that retained cursor. Executors must honor cancellation and settle only after releasing children; cancellation waits for their settlement.

## Model Experience

The Client entry places a Policy style selector beside the composer model control. It saves one profile-wide default for new Policy jobs: Codex, Claude, ZCode, or Superpowers style. The Host entry reads that setting when `policy_run` accepts a task and runs the selected staged plan through the official `ctx.workflowEngine`. The tool returns a Job id immediately. The Job progress line follows workflow phases; its observer log streams the phase, `workflow/log`, and child start/end events, so the official DSH job surface can show ongoing work. Final output is retained in the Job result. This requires the official Settings, Jobs, and `dsh-tool-jobs` providers to be present in the composition.

The exported controller remains available to packages that want to register their own strategies. The extension does not load arbitrary strategy files or a manager configuration.

#### KV Cache effect

Bundle activation does not change model requests or cache reuse. Controller consumers determine model routes and execution; later-stage prompts include selected settled results and captured supplemental context.

## Known Limitations and Deferred Work

- The pinned official DSH public API lacks result-bearing continuation of the same child activation, active-only child message admission, and per-child tool sandbox configuration. This Host path starts one fresh workflow child per task stage and does not expose those controls or claim that the child is restricted to a task-specific tool set.
- No process-restart recovery is provided by the extracted controller.
