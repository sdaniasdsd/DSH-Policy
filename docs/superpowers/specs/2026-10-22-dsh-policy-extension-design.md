# DSH Policy External Extension Framework

English | [中文](2026-10-22-dsh-policy-extension-design.zh.md)

## Goal

Extract DSH Policy from the current full-source Policy Edition into an independently installable extension for official DSH. Preserve the current task feedback and strategy-switching behavior while binding each extension release to one exact official DSH release and source commit.

## Responsibility boundary

| Official DSH owns | The Policy extension owns |
|---|---|
| Application startup, profiles, plugin installation and activation | Strategy catalog, selection policy and preflight validation |
| Models, tools, Agents, Subagents, Sessions and Jobs | Task-level policy binding, stage orchestration and feedback routing |
| Workflow script execution and Web plugin extension points | Policy configuration, progress and strategy controls |
| Runtime compatibility checks and profile package management | A compatibility adapter tested against the pinned DSH release |

The extension does not ship a replacement DSH application, model gateway, Agent loop, Session store, Job system or plugin manager. It is a profile Bundle and its owned plugins, installed through the official profile plugin path.

## Execution and feedback model

The Policy controller remains the owner of one accepted task's strategy binding, completed results, stage cursor, limits and control commands. It can invoke an official Workflow script as an execution adapter, but a script run is not the durable task identity or the policy controller.

The extraction preserves these live-task behaviors: inspect progress and cancel; append bounded human input for the next unstarted stage; reserve a strategy replacement that commits only after the active stage drains; reject stale binding epochs; resume the retained strategy after a rejected replacement; and, where a DSH-native member executor is used, message an active member and access task-scoped versioned records. A running stage keeps its captured instructions and executor. Feedback changes later work at an explicit boundary; it does not rewrite an in-flight script.

Workflow scripts may branch on results within their own run. The extension evaluates the completed run before starting a later stage or script. If the official Workflow contract does not expose the child ownership and control handles required by an existing feedback feature, the extraction keeps that strategy on the DSH-native member executor. It must not silently advertise live-member messaging while running through an executor that cannot deliver it. Process-restart recovery is not added unless the existing runtime already provides it.

## Release-to-runtime compatibility

Every published Policy extension version maps to exactly one official DSH runtime version and one upstream source commit. The extension package records both values in release metadata and declares exact-version DSH package peers for the services it consumes. Published manifests contain no `workspace:*` peer requirement.

The release check verifies that the metadata, package peer versions, lockfile and tested DSH source all identify the same pair. A mismatched DSH version is rejected during package compatibility checks; no automatic fallback, broad compatibility range or version exemption is part of the normal install path. Supporting another DSH release requires a separately tested extension release with its own mapping and compatibility result.

The DSH version identifies the runtime contract; the upstream commit makes that contract reproducible when a release tag or package registry alone is insufficient. Policy versioning remains independent, so multiple Policy fixes may target the same DSH release, but one Policy version never claims compatibility with multiple official DSH versions.

## Alternatives considered

**Keep the full Policy Edition fork.** This preserves direct access to every runtime implementation, but makes each upstream change and installer update part of our maintenance burden. It does not meet the independent-extension goal.

**Publish only static workflow scripts and configuration.** This is easy to install, but cannot own the current task identity, boundary-safe strategy replacement, resume, or feedback routing. It would lose behavior the user asked to retain.

**Make official Workflow the entire task runtime.** This would simplify the executor, but the public Workflow contract is a foreground script run and does not by itself provide all of the current strategy controller's task-level feedback and switching semantics. Workflow remains an execution adapter, not the owner of policy state.

## Validation goals

- A clean official DSH profile installs and activates the extension Bundle without the Policy Edition desktop application or source checkout.
- The extension's live-task feedback tests retain their current semantics, including stage-boundary switching, stale-epoch rejection, resume, and supported member messaging and records.
- A strategy using Workflow scripts can inspect prior stage results and select a later stage without losing the enclosing task's identity or limits.
- Installation and startup reject a runtime version outside the extension's exact declared DSH version.
- Release metadata, exact peer dependencies and the tested upstream commit agree for every published extension version.
- The extension package can be built and tested from a clean consumer install without workspace aliases or undeclared DSH source imports.

## Scope

The first extraction moves the strategy controller, policy definitions, feedback interfaces and required Web UI into an out-of-tree DSH package set; it replaces desktop-specific automatic profile mutation with official profile installation and plugin management. It adds the exact DSH-to-Policy release mapping and compatibility verification before changing the supported runtime pair.

It does not promise compatibility with several DSH versions from one Policy release, restart recovery beyond current behavior, control of native external CLI sessions that do not expose such controls, or a replacement desktop shell. The initial target is one pinned official DSH release and its supported Web profile.
