# DSH Policy Manager and Version Control

English | [中文](2026-10-22-dsh-policy-manager-design.zh.md)

## Goal

Provide a standalone Windows application for selecting, installing, launching and managing official DeepSeek Harness Desktop releases and the compatible DSH Policy extension.

The manager preserves one shared Harness home across official and policy modes, creates a local encrypted backup before every version or mode change, and enables policy mode only when an exact compatibility record exists.

## Product and responsibility split

The manager is a separate installed application with its own release version and launch entry. It does not replace the official DSH runtime or embed a second copy of the runtime.

| Official DSH owns | DSH Policy Manager owns |
|---|---|
| Desktop application, bundled DSH runtime, profile lifecycle and plugin package operations | Official Desktop release selection, install orchestration and current-version detection |
| Agent loop, models, tools, sessions, jobs, workflows and profile compatibility checks | Official or policy mode selection, compatible Policy package selection, backup and rollback orchestration |
| Desktop updater and runtime behavior | A verified release catalog, manager UI, launcher entry and operation history |

Policy behavior remains in the separately versioned `@deepseek-ai/dsh-policy-extension` Bundle. The manager invokes the installed Desktop `dsh` command to add or remove that Bundle while Desktop is closed; it does not edit `app.asar` or inject UI code through CDP.

The manager UI uses Tauri with a TypeScript frontend and a Rust backend limited to release discovery, installer execution, file backup, process lifecycle and explicit DSH command operations. The manager package is built and installed separately from the official Desktop application and the Policy Bundle.

## Version catalog and compatibility

The catalog treats the Desktop installer release and its bundled DSH runtime as separate identifiers. Each installable entry records the operating system and architecture, official Desktop version, bundled DSH version and upstream commit, first-party installer URL, expected SHA-256, and supported Policy package versions.

Each Policy package release records one exact DSH runtime version and upstream commit. Policy `1.0.2` currently records DSH `0.2.1-rc.2`; the manager reads the published compatibility metadata rather than deriving support from a version range.

The manager offers an official installer only when its source and integrity metadata are present and verified. A core source tag without a matching official Desktop installer is informational and cannot be installed from the version picker.

If an installed DSH runtime has no exact Policy match, the manager permits official mode and disables policy mode with the missing compatibility pair shown. It never selects the closest Policy version or bypasses DSH peer compatibility checks.

The release catalog is a maintained, versioned artifact. Its integrity metadata is authenticated by the manager's trusted release channel; a package URL from an untrusted catalog cannot trigger installation.

## Version and mode changes

Version and mode are global selections for the one active Desktop installation. Applying either selection requires Desktop to exit before the manager writes to its profile or replaces its installation.

1. Detect the installed Desktop version, bundled DSH runtime, active `DSH_HOME`, current mode and installed Policy package.
2. Confirm the requested official release and, for policy mode, an exact Policy compatibility entry.
3. Download the target installer to staging and verify its catalog hash before changing the installation or Harness home.
4. Close Desktop and wait for its process and profile package operation to finish.
5. Create and verify an encrypted local backup of the selected Harness home.
6. Install the selected official Desktop release, then use its bundled `dsh` command to add the pinned Policy package or remove it for official mode.
7. Verify the installed Desktop/runtime pair and profile selection, record the result, and launch the selected Desktop release.

The manager keeps the chosen `DSH_HOME` constant across modes and supported versions. On first run it honors an explicit `DSH_HOME`; otherwise it uses the standard Harness home. If both the standard home and the former Policy Edition home contain data, setup asks which home to retain and backs up both; it does not merge session stores automatically.

An official Desktop update performed outside the manager is detected on the next manager launch. The manager re-reads the bundled DSH version and Policy compatibility before enabling policy mode. Users should launch through the manager entry when they need it to apply the selected home and mode.

## Backup, failure and rollback

Backups contain the selected Harness home, including sessions, settings, credentials, profile manifests, installed plugin declarations and lockfiles. They remain on the device and are encrypted with Windows DPAPI; neither backup contents nor credentials are uploaded.

The manager creates a new restore point before changing mode, installing a release, or restoring an older backup. A download or integrity failure happens before mutation. If installation or a Policy package operation fails after mutation begins, the manager attempts to reinstate the last verified Desktop release and restore the pre-change Harness-home snapshot. If recovery also fails, it enters recovery mode, preserves all files and backups, and does not launch an unverified installation.

The manager retains verified installer artifacts for the active release and the last verified release in its local cache. Rollback uses the cached installer; when it is absent, the manager must download and verify that artifact before replacing the active installation.

Rollback reinstalls a previously catalogued official Desktop release, restores the selected matching Harness-home snapshot, and revalidates its Policy compatibility. Restoring a snapshot replaces data written after that snapshot; the UI shows the snapshot time and creates a fresh pre-restore backup first.

An interrupted transition is recorded before each destructive stage. At the next manager start, the manager detects the incomplete stage, preserves the current files, and offers recovery to the last verified release and backup; it does not silently delete an incomplete install or overwrite the only backup.

## Manager interface

The home page shows the active Desktop version, bundled DSH runtime version, current mode, Policy version and compatibility result, with one action to launch DSH.

The Versions page lists installable official releases, their verified installer source, embedded runtime version and matching Policy releases. The Policy page switches between official and policy mode and shows why policy mode is unavailable when no exact match exists.

The Activity page records detection, download, hash verification, backup, install, profile operation, launch and rollback outcomes. Diagnostics redact credentials, authorization headers and secret-bearing command arguments.

The manager creates a separate DSH launch shortcut that uses the selected mode and Harness home. It does not remove or rewrite the official Desktop shortcut.

## Alternatives considered

**Put the manager page inside DSH.** This cannot manage a DSH installation that has not started and does not provide the requested independent control application.

**Use an Electron manager.** This reuses the current Desktop technology but ships another Electron runtime for a small installer and launcher surface. Tauri keeps the manager independent and avoids coupling its lifecycle to the version it manages.

**Patch the official Desktop renderer.** CDP injection would couple enhancements to private UI structure. DSH's profile Bundle path already provides the Policy integration point, so the manager should control that supported path.

## Validation goals

- The manager detects the installed Desktop release and bundled DSH runtime independently and rejects a catalog entry whose installer hash or runtime mapping does not match.
- The version picker offers only releases with verified official installer artifacts and catalog records.
- Official mode removes the Policy Bundle from the active Desktop profile; policy mode installs only the package version mapped to the bundled DSH runtime.
- A DSH runtime with no Policy match remains launchable in official mode, while policy mode stays unavailable.
- Mode and version changes use the same selected Harness home and create a decryptable local restore point before changing files.
- Simulated download, installer, package-operation, backup and interrupted-transition failures preserve the last verified state and provide a recoverable outcome.
- A direct official update is detected before the manager enables policy mode on its next launch.

## Scope

The first release targets Windows and one active official Desktop installation. It manages verified official installers, exact Policy compatibility, mode switching, local backup, rollback, launch and diagnostics.

The version picker does not promise every historical DSH core tag. A version becomes selectable only after its official Desktop installer, embedded runtime identity, integrity data and Policy compatibility record are verified. Other operating systems, simultaneous DSH installations, automatic data-store merging and arbitrary third-party policy packages are outside the first release.

## Dev Note

The official download page exposes the current Desktop installer while the DSH repository publishes core release tags. Confirm whether the official service exposes immutable historical installers, checksums and supported installer arguments before implementing version replacement; otherwise publish only catalogued packages that can be independently verified.
