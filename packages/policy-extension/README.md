---
description: "Standalone Policy Bundle for one pinned official DSH release."
kind: "package-bundle"
---

# @deepseek-ai/dsh-policy-extension

## Summary

This package installs Policy through the official DSH profile Bundle path. Its `dsh.bundle.patch` adds one plugin row for the Host and Web Client entries. Version 1.0.7-experimental.1 pins DSH `0.2.2-rc.1` in `engines.dsh` and in every DSH peer dependency. [`compatibility.json`](compatibility.json) records the DSH source tag, source commit, and exact Desktop runtime build commit. The Manager uses its [signed catalog](https://github.com/sdaniasdsd/DSH-Policy/releases/tag/dsh-policy-manager-catalog) to install the verified 1.0.6 bundle on the matching official Desktop build.

## Use this package

The ordinary repository build emits both plugin entries. For a focused release build, run `npm run build:policy-extension` from the repository root. The release compiler resolves the published target dependencies instead of the fork's TypeScript source aliases. Install the packed package into an official DSH profile. The published archive contains the Bundle patch, Host entry, Client entry, types, and compatibility metadata. The official profile loader checks the exact DSH version before importing the plugin.

GitHub releases publish a fixed `dsh-policy-extension-<version>.tgz` asset for the exact `policy-extension-v<version>` tag. The release workflow builds and tests the package, checks the packed metadata and exact DSH peer pins, rejects install lifecycle scripts, and publishes a matching `SHA256SUMS.txt` file.

To try the preview, download the tarball and checksum from GitHub, verify the SHA-256, and run the following in PowerShell from the download directory with DSH `0.2.2-rc.1` on `PATH`. This uses a separate Harness home for the Web profile.

```powershell
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA 'DSH-Policy-Preview'
dsh plugin --profile web add ./dsh-policy-extension-1.0.7-experimental.1.tgz
dsh --profile web
```

Close the Web process, then run `dsh plugin --profile web remove @deepseek-ai/dsh-policy-extension` with the same `DSH_HOME` to remove the preview.

The Host export provides `StrategyRegistry`, `captureStrategy`, and `TaskRun`. A captured strategy retains its author callback after unregistration. `TaskRun` owns the binding epoch, stage cursor, cumulative results and task limits. It snapshots supplemental context before a stage starts, applies a reserved replacement after that stage drains, and retains the existing strategy when replacement admission fails. A resume command continues that retained cursor. Executors must honor cancellation and settle only after releasing children; cancellation waits for their settlement.

## Model Experience

The Client entry places a Policy style selector beside the composer model control. It saves one profile-wide default for new Policy jobs: Codex, Claude, ZCode, or Superpowers style. The Host entry reads that setting when `policy_run` accepts a task and runs the selected staged plan through the Workflow service in the calling Agent's preset. The tool is available only for presets with that service. The tool returns a Job id immediately. The Job progress line follows workflow phases; its observer log streams the phase, `workflow/log`, and child start/end events, so the official DSH job surface can show ongoing work. Final output is retained in the Job result. This requires the official Settings, Jobs, and `dsh-tool-jobs` providers to be present in the composition.

Codex and Claude are experimental task workflows maintained by DSH Policy. Their names describe how the work is staged. The calling Agent's preset supplies the model and provider. The exported controller remains available to packages that register their own strategies.

#### KV Cache effect

Bundle activation does not change model requests or cache reuse. Controller consumers determine model routes and execution; later-stage prompts include selected settled results and captured supplemental context.

## Known Limitations and Deferred Work

- The pinned official DSH public API lacks result-bearing continuation of the same child activation, active-only child message admission, and per-child tool sandbox configuration. This Host path starts one fresh workflow child per task stage and does not expose those controls or claim that the child is restricted to a task-specific tool set.
- No process-restart recovery is provided by the extracted controller.
