# DSH Policy 0.2.1 Implementation Plan

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
- [ ] Commit source and integrate latest remote main.

## Task 2: Version and Windows installer

- [ ] Change policy packaging assertions to 0.2.1; expect version assertion failure.
- [ ] Update policy metadata and artifact prefix; expect focused tests to pass.
- [ ] Run official Windows unsigned packaging with build version 0.2.1-alpha.2.20261012.1; expect installer and packaged-runtime smoke success.
- [ ] Verify archived compiled fix and metadata; copy installer to delivery directory with SHA-256.
- [ ] Review complete source diff, commit, and update local main.
