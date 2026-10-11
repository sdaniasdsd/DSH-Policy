# DSH Policy 0.2.1 Implementation Plan

English | [中文](2026-10-12-dsh-policy-refresh-release.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver updated source and a Windows patch installer that preserves live chat progress and completion updates.

**Architecture:** Keep task-entry node identity stable when its card becomes hidden. Build the existing independent Policy Edition packaging pipeline with version 0.2.1 and the latest concurrent source changes.

**Tech Stack:** TypeScript, Vitest, pnpm, Electron, electron-builder/NSIS.

**Spec:** User request in this chat: update source and produce a patch-version installer for the desktop refresh defect.

## Global Constraints

- Policy Edition version 0.2.1; preserve application ID io.github.sdaniasdsd.dshchange.
- Windows x64 unsigned packaging; retain user profiles.
- Integrate concurrent changes without modifying another worktree's dependencies or artifacts.

## Review Focus

- Hidden ordinary requests retain identity and later progress continues.
- Associated requests retain identity.
- Actual assistant live chunks and final messages remain published.
- Installer metadata and artifact filename both identify 0.2.1.
- Packaged runtime contains the compiled fix and passes existing smoke checks.

## Task 1: Refresh regression and source integration

- [x] Reproduce node withdrawal with real assembler and assistant definitions; expect failure before fix.
- [x] Preserve hidden nodes; expect regression tests to pass.
- [x] Commit source and integrate latest remote main.

## Task 2: Version and Windows installer

- [x] Change policy packaging assertions to 0.2.1; expect version assertion failure.
- [x] Update policy metadata and artifact prefix; expect focused tests to pass.
- [x] Run official Windows unsigned packaging with build version 0.2.1-alpha.2.20261012.1; expect installer and packaged-runtime smoke success.
- [x] Verify archived compiled fix and metadata; copy installer to delivery directory with SHA-256.
- [x] Review complete source diff, commit, and update local main.

## Release evidence

The installer contains source commit 29cc1130d451c9eb0101792889c9a041571929c4 and build version 0.2.1-alpha.2.20261012.1. Focused release tests passed (15 cases); the corrected typed refresh probe passed (2 cases). All 941 bilingual pairs and 22 documentation standard tests passed. The fresh source review found no actionable defects.

The official build and installer creation succeeded. The final packaged smoke hit Windows Python DLL path-length limits in the nested build directory; the identical packaged application passed the same archive, native, plugin, strategy, ordinary-input and Office conversion checks after copying to a normal-length private test directory. CLI-help timeout and the documentation site's Windows file-symlink permission failure remain outside this refresh fix.

Installer: dsh-policy-0.2.1-win-x64-unsigned.exe, 286589910 bytes; SHA-256 710fa0aa6c7f86f9c18ce0b79a78750a13e287519765ebd806c65ccc1e94f821.
