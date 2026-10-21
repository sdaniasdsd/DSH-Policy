# DSH Policy External Extension Framework Implementation Plan

English | [中文](2026-10-22-dsh-policy-extension.zh.md)


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract DSH Policy into an installable official DSH extension while preserving current live-task strategy feedback and binding each extension release to one exact official DSH release and source commit.

**Architecture:** Keep the Policy task controller as the owner of task identity, strategy state, stage boundaries, and feedback. Package it as an official profile Bundle with its own host and client plugins; call official Workflow for script stages and retain the DSH-native member executor where Workflow does not expose the existing live-member controls. Keep the current desktop distribution available until clean-profile installation and parity checks pass.

**Tech Stack:** TypeScript, pnpm workspaces, Cordis plugins, official DSH Bundle/profile plugin system, official Workflow API, Vitest, package tarball and clean-consumer smoke tests.

**Spec:** [docs/superpowers/specs/2026-10-22-dsh-policy-extension-design.md](../specs/2026-10-22-dsh-policy-extension-design.md)

## Global Constraints

- Every published Policy extension version maps to exactly one official DSH runtime version and one upstream source commit.
- The extension package records both values in release metadata and declares exact-version DSH package peers for the services it consumes.
- Published manifests contain no `workspace:*` peer requirement.
- The release check verifies that metadata, package peer versions, lockfile and tested DSH source identify the same pair.
- A mismatched DSH version is rejected during package compatibility checks; no automatic fallback, broad compatibility range or version exemption is part of the normal install path.
- A running stage keeps its captured instructions and executor; feedback changes later work at an explicit boundary.
- If Workflow does not expose required child ownership and control handles, keep that strategy on the DSH-native member executor and do not advertise unsupported member messaging.
- Do not add process-restart recovery unless the existing runtime already provides it.

## Review Focus

- A DSH runtime with a different exact version is rejected before extension activation; test in Task 1 and Task 6.
- A release metadata, peer dependency, lockfile, tag or source-commit disagreement fails the release check; test in Task 1 and Task 6.
- Feedback arriving during a running stage cannot mutate that stage and is applied at the next boundary; test in Task 3.
- A stale binding epoch or rejected strategy switch cannot replace current state, and resume restores the retained strategy; test in Task 3.
- Workflow error or cancellation settles the enclosing task and cleans up children without claiming unsupported live-member messaging; test in Tasks 4 and 6.

---

## File Map

- `packages/policy-extension/package.json`, `src/index.ts`, and `src/client/index.ts`: independent host/client package entry points and published package boundary.
- `packages/policy-extension/dsh.bundle.patch.yml`: official profile Bundle metadata and activation of the extension's host/client plugins.
- `packages/policy-extension/src/compatibility.ts` and `compatibility.json`: runtime compatibility API and the release's exact DSH version/tag/commit tuple.
- `scripts/verify-policy-compatibility.ts` and `scripts/verify-policy-compatibility.spec.ts`: release-pair validation against package metadata, lockfile, and checked-out official source.
- `packages/policy-extension/src/task-runtime/**`: extracted task controller, policy binding, stage orchestration, and feedback interfaces adapted from `packages/experimental/task-strategy/src/**`.
- `packages/policy-extension/src/workflow-executor.ts`: official Workflow script-stage adapter; the existing DSH-native executor remains available for member-level controls.
- `packages/policy-extension/src/client/**`: strategy selection, task progress, feedback and control UI moved from the current task-strategy client.
- `packages/policy-extension/tests/**`: focused compatibility, controller, Workflow adapter, UI, and package-consumer tests.
- `apps/desktop/src/project-manager.ts`, `apps/desktop/scripts/prepare-dsh.ts`, and `apps/desktop/scripts/smoke-runtime.ts`: remove desktop-only auto-injection and retain desktop smoke coverage for the legacy distribution during migration.
- `.github/workflows/**` and `docs/superpowers/**`: release compatibility gate and paired setup/install documentation; update the repository documentation allowlist only if a new public page is added.

## Task 1: Pin and Enforce the Official DSH Release Pair

**Files:**
- Create: `packages/policy-extension/compatibility.json`
- Create: `packages/policy-extension/src/compatibility.ts`
- Create: `scripts/verify-policy-compatibility.ts`
- Create: `scripts/verify-policy-compatibility.spec.ts`
- Modify: root `package.json` scripts and the root lockfile only as required by the test command

**Interfaces:**
- Produces `PolicyCompatibility` with `policyVersion`, `dshVersion`, `dshTag`, and `dshCommit` string fields.
- Initial official pair: DSH version `0.2.1-rc.2`, tag `dsh-v0.2.1-rc.2`, commit `687f282e8625c6b8d11ff58211a90524be2e4317`.
- Produces `assertCompatibleDsh(actualVersion: string, expected: PolicyCompatibility): void`, which throws a typed compatibility error on any version mismatch.

- [ ] Add tests named `acceptsThePinnedRuntimeVersion`, `rejectsDifferentRuntimeVersions`, `rejectsMetadataPeerVersionMismatch`, and `rejectsTestedSourceCommitMismatch`.
- [ ] Run `corepack pnpm exec vitest run scripts/verify-policy-compatibility.spec.ts` and confirm each new assertion fails for the intended missing behavior.
- [ ] Implement the metadata parser, exact equality check, and release verifier. The verifier must read the official source version and commit supplied to CI, then compare them with the compatibility tuple and all exact DSH peer versions.
- [ ] Run `corepack pnpm exec vitest run scripts/verify-policy-compatibility.spec.ts`; expect all four tests to pass.
- [ ] Commit as `feat: pin policy extension to an official dsh release`.

## Task 2: Create the Independently Packable Extension Bundle

**Files:**
- Create: `packages/policy-extension/package.json`, `tsconfig.json`, `src/index.ts`, `src/client/index.ts`, and `dsh.bundle.patch.yml`
- Create: `packages/policy-extension/tests/package-metadata.spec.ts`
- Modify: root `package.json` workspace list and scripts, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`

**Interfaces:**
- Consumes `PolicyCompatibility` from Task 1.
- Produces a package named `@deepseek-ai/dsh-policy-extension` with host and client exports, a `dsh.bundle.patch` declaration, and exact-version peers for every consumed official DSH package.
- Bundle metadata activates the host and client plugins through the official DSH profile plugin manager; it does not add a desktop-app dependency. The package declares exact `engines.dsh: "0.2.1-rc.2"`; the pinned official DSH pre-import compatibility check rejects a mismatch before the Bundle loads, so the extension does not duplicate runtime admission.

- [ ] Add `packageMetadataDeclaresAnOfficialBundle`, `publishedPeersAreExact`, and `packedTarballHasNoWorkspacePeerRanges` tests.
- [ ] Run `corepack pnpm exec vitest run packages/policy-extension/tests/package-metadata.spec.ts` and confirm the tests fail before adding the package implementation.
- [ ] Define the package exports, official Bundle patch, build configuration, and exact DSH peer/dev dependency set from the consumed imports. Do not copy unrelated DSH runtime packages into the extension.
- [ ] Pack the package into a temporary directory and inspect its manifest; expect the Bundle declaration, host/client entry points, and no `workspace:*` dependency or peer range.
- [ ] Run the package build and the package metadata tests; expect both to pass.
- [ ] Commit as `feat: scaffold standalone policy extension bundle`.

## Task 3: Extract the Policy Controller and Preserve Feedback Semantics

**Files:**
- Create: `packages/policy-extension/src/task-runtime/**` from the owned behavior in `packages/experimental/task-strategy/src/**`
- Create: `packages/policy-extension/tests/task-runtime/**`
- Modify: `packages/policy-extension/src/index.ts`

**Interfaces:**
- Consumes exact official services declared by Task 2 and the package compatibility check from Task 1.
- Produces a task controller that owns the accepted task's strategy binding, result history, stage cursor, limits, and control commands.
- Public controller operations retain the current semantics for inspect, cancel, bounded next-stage input, strategy-switch reservation, epoch validation, resume, member messaging where supported, and task-scoped versioned records.

- [ ] Add `feedbackDuringActiveStageAppliesAtNextBoundary`, `staleBindingEpochIsRejected`, `failedStrategySwitchResumesRetainedStrategy`, `cancelSettlesTaskAndChildren`, and `memberMessageRequiresNativeExecutor` tests using the existing task-strategy fixtures as behavioral references.
- [ ] Run `corepack pnpm exec vitest run packages/policy-extension/tests/task-runtime` and confirm the tests expose the missing extracted controller behavior.
- [ ] Move only policy-owned controller and strategy code into `src/task-runtime/**`; replace workspace-only imports with the exact official public package imports selected in Task 2. Keep private official DSH implementation imports out of the extension.
- [ ] Run all task-runtime tests and the extension typecheck; expect feedback to change only future stages and all controller behavior tests to pass.
- [ ] Commit as `feat: extract policy task controller and feedback`.

## Task 4: Add the Official Workflow Script Executor Adapter

**Files:**
- Create: `packages/policy-extension/src/workflow-executor.ts`
- Create: `packages/policy-extension/tests/workflow-executor.spec.ts`
- Modify: `packages/policy-extension/src/task-runtime/**` only to register the adapter behind the existing executor interface

**Interfaces:**
- Consumes official `WorkflowEngine`, `WorkflowStartRequest`, `WorkflowRun`, and `WorkflowResult` from the pinned DSH release.
- Produces a policy-stage executor that starts a script with the active task's parent Agent and abort signal, awaits `WorkflowRun.result`, maps `completed` to a stage result, maps `cancelled` and `error` to task settlement, and calls idempotent `dispose()` in cleanup.
- DSH-native member execution remains the selected executor for strategies that require live member messaging or child control handles unavailable from Workflow.

- [ ] Add `passesTaskParentAndCancellationSignal`, `returnsWorkflowValueToLaterStage`, `completedResultChangesTheNextStrategyDecision`, `mapsWorkflowErrorAndCancellation`, `disposesRunOnEverySettlement`, and `doesNotExposeMemberMessagingForWorkflowStages` tests.
- [ ] Run `corepack pnpm exec vitest run packages/policy-extension/tests/workflow-executor.spec.ts` and confirm they fail before implementing the adapter.
- [ ] Implement the adapter against the pinned official Workflow types; preserve task identity and policy limits in the enclosing controller rather than inferring them from `WorkflowRun`.
- [ ] Run the adapter tests and extension typecheck against the official `0.2.1-rc.2` worktree; expect all tests to pass and no private Workflow imports.
- [ ] Commit as `feat: execute policy stages through official workflow`.

## Task 5: Move the Policy Client and Remove Desktop-Only Auto-Injection

**Files:**
- Create: `packages/policy-extension/src/client/**`
- Create: `packages/policy-extension/tests/client/**`
- Modify: `apps/desktop/src/project-manager.ts`
- Modify: `apps/desktop/scripts/prepare-dsh.ts`
- Modify: `apps/desktop/scripts/smoke-runtime.ts`
- Modify: the strategy and profile docs that currently describe automatic desktop injection

**Interfaces:**
- Consumes the extension host/client entries and Bundle patch from Task 2 and the controller events from Task 3.
- Produces official DSH Web UI controls for strategy selection, task progress, supported feedback, cancellation, and strategy switching.
- Official profile plugin installation is the activation path; desktop source preparation must not append a private Policy package or copy `policy-workflows.patch.yml` into a built-in runtime.

- [ ] Add `rendersPolicyControlsWhenBundleIsInstalled` and `hidesUnsupportedWorkflowMemberControls` client tests, and update desktop smoke assertions to require no implicit Policy package injection.
- [ ] Run the focused client tests and `corepack pnpm exec vitest run apps/desktop/scripts` to confirm the old injection assumptions are identified.
- [ ] Move the existing task-strategy client UI behind the extension entry points and remove `policy-workflows.patch.yml` detection/automatic profile mutation from desktop startup and packaging.
- [ ] Run the client tests, affected desktop smoke tests, and build the extension plus desktop host/client contracts; expect official Bundle installation to be the only activation route for the extension.
- [ ] Commit as `refactor: activate policy through official profiles`.

## Task 6: Verify Clean Official Installation and Release Compatibility

**Files:**
- Create: `packages/policy-extension/tests/consumer-install/**`
- Modify: `.github/workflows/**` to add a pinned-upstream compatibility job
- Modify: `scripts/verify-policy-compatibility.ts` only if the clean install reveals a missing release check
- Modify: paired policy install and release documentation under `docs/`

**Interfaces:**
- Consumes the packed extension from Tasks 1–5 and the official DSH `0.2.1-rc.2` tag/commit.
- Produces a clean-profile smoke result proving installation, activation, policy task creation, workflow stage completion, stage-boundary feedback, cancellation, and incompatible-runtime rejection without the Policy Edition checkout.

- [ ] Add consumer tests named `installsIntoCleanOfficialProfile`, `activatesPolicyHostAndClient`, `runsWorkflowStageAndAppliesNextStageFeedback`, and `rejectsUnmatchedDshVersion`.
- [ ] Run the consumer tests against an empty temporary profile and confirm that the extension currently fails before package and activation wiring is complete.
- [ ] Install the packed package through the official profile plugin path, run the policy smoke scenarios, and make the CI job verify tag, commit, package peers, lockfile and metadata as one tuple.
- [ ] Run `corepack pnpm run verify-policy-compatibility`, the package build/test commands, all task-runtime/workflow/client suites, and the clean-profile consumer smoke; expect all to pass for the pinned pair and fail for a deliberately mismatched DSH version.
- [ ] Commit as `test: verify policy extension on a clean official dsh profile`.
