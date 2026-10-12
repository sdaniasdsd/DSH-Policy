# DSH Policy extreme-high tiers and Superpowers-style plugin Implementation Plan

English | [中文](2026-10-12-dsh-policy-extreme-tier-superpowers.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded `extreme-high` tier to Codex-style, Claude-style, and ZCode-style policies, and ship an opt-in Superpowers-style DSH policy plugin.

**Architecture:** Extend the shared style-policy tier contract and scenario accounting, then implement Superpowers as a fourth removable DSH-executed style policy. Project the tier and mode through Host selection and the composer, expose the plugin through the existing opt-in workflow patch, and validate it with deterministic tests plus a real Loader composition.

**Tech Stack:** TypeScript, Cordis, Schemastery, React, Vitest, YAML, pnpm workspace build and documentation pairing scripts.

**Spec:** `docs/superpowers/specs/2026-10-12-dsh-policy-extreme-tier-superpowers-design.md` and `docs/superpowers/specs/2026-10-12-dsh-policy-extreme-tier-superpowers-design.zh.md`

## Global Constraints

- Add `extreme-high` only to Codex-style, Claude-style, ZCode-style, and Superpowers-style policies; preserve existing low, medium, and high behavior.
- Extreme-high defaults: `maxNodes: 12`, `maxRepairs: 4`, `maxTokens: 8192`, `timeoutMs: 600000`, and scenario assumptions `callsPerTask: 8`, `contextTokensPerCall: 8192`, `outputTokensPerCall: 4096`; enforce existing schema maxima (`maxNodes: 16`, `maxRepairs: 4`).
- Keep scenario estimates distinct from actual observed child usage, billed amounts, and execution hard limits.
- Keep the four style plugins opt-in and leave shipped profile defaults unchanged.
- Do not change native Codex/Claude provider lifecycle, authentication, permission behavior, or run count.
- Superpowers-style uses only the existing DSH task runtime and preset; it does not load third-party skill files or claim official integration.

## Review Focus

- Invalid `extreme-high` preferences fail before selection state or task admission changes; pin in orchestration and selector tests.
- Extreme-high configuration rejects node counts above 16 and repair counts above 4; pin in schema tests.
- A captured extreme-high intake retains its tier and limits after later mode/config changes; pin in Host adapter tests.
- A plan exceeding its captured node limit fails before excess child work starts; pin in style-policy execution tests.
- Cancellation, child errors, and unknown execution outcomes never trigger unbounded repair or replay; pin in the maximum-path lifecycle test.

---

### Task 1: Add the extreme-high tier contract and bounded configuration

**Files:**
- Modify: `packages/experimental/task-strategy/src/types.ts`
- Modify: `packages/experimental/task-strategy/src/entry-types.ts`
- Modify: `packages/experimental/task-strategy/src/runtime-types.ts`
- Modify: `packages/experimental/task-strategy/src/selection-types.ts`
- Modify: `packages/experimental/task-strategy/src/orchestration.ts`
- Modify: `packages/experimental/task-strategy/src/selector.ts`
- Modify: `packages/experimental/task-strategy/src/cordis.ts`
- Modify: `packages/experimental/task-strategy/src/style-policy.ts`
- Test: `packages/experimental/task-strategy/tests/style-policy.spec.ts`
- Test: `packages/experimental/task-strategy/tests/orchestration.spec.ts`
- Test: `packages/experimental/task-strategy/tests/selector.spec.ts`

**Interfaces:**
- Produces: shared `StyleTier = 'low' | 'medium' | 'high' | 'extreme-high'`; Host orchestration state and workflow candidates accept the four tiers; `StyleConfig.extremeHigh` has validated limits and cost assumptions.
- `StyleConfig.extremeHigh` defaults to 12 nodes, 4 repairs, 8192 per-step tokens, 600000 ms timeout, and assumptions 8 calls × 8192 context tokens × 4096 output tokens. Keep schema ceilings at 16 nodes and 4 repairs.
- Existing top-level style configuration and existing low/medium/high costs retain current defaults and semantics.

- [ ] **Step 1: Add failing tests for the tier contract and config bounds.** Assert every schema accepts the default extreme profile, rejects 17 nodes and 5 repairs, accepts `extreme-high`, and rejects unknown tier strings.
- [ ] **Step 2: Run the focused failing tests.**

Run: `pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/style-policy.spec.ts tests/orchestration.spec.ts tests/selector.spec.ts`

Expected: failures for missing extreme tier/config behavior.

- [ ] **Step 3: Extend shared Host/selection tier types and validation.** Update mode state, tier capture, workflow candidate generation, and automatic selector schema/parser to accept `extreme-high` while preserving invalid-choice behavior.
- [ ] **Step 4: Implement captured extreme-high limits and estimates in `style-policy.ts`.** Resolve the selected tier to its own bounded node, repair, token, timeout, and scenario assumptions; keep high-tier execution unchanged. Include extreme-high baseline and maximum repair scenarios.
- [ ] **Step 5: Add the Review Focus tests for invalid preferences and captured limits.** Assert failed selection leaves the prior tier intact, and an accepted run uses the captured tier after later mode changes.
- [ ] **Step 6: Run the focused tests.** Expected: all targeted policy, orchestration, and selector tests pass.
- [ ] **Step 7: Commit the tier contract and its tests.**

### Task 2: Add the removable Superpowers-style policy

**Files:**
- Modify: `packages/experimental/task-strategy/src/style-policy.ts`
- Create: `packages/experimental/task-strategy/src/plugin-superpowers-style.ts`
- Test: `packages/experimental/task-strategy/tests/style-policy.spec.ts`

**Interfaces:**
- Consumes: `StyleTier` and validated `StyleConfig.extremeHigh` from Task 1.
- Produces: function plugin exports `name`, `inject`, `Config`, and `apply`; `apply` registers `superpowers-style` through `mountStylePolicy` and the existing task-strategy registry.
- Workflow stages: understand the task, create a bounded plan, implement sequentially, verify registered artifacts, conduct read-only review, and repair only evidence-backed findings within the captured repair limit.

- [ ] **Step 1: Add failing deterministic policy tests.** Assert Superpowers-style is DSH-preset-only, orders task understanding/planning/work/verification/review, uses extreme-high limits, estimates its maximum repair path, and refuses plans beyond its captured node limit.
- [ ] **Step 2: Run the new focused tests.**

Run: `pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/style-policy.spec.ts`

Expected: failures because the pattern and plugin entry do not exist.

- [ ] **Step 3: Add the Superpowers pattern to `style-policy.ts`.** Reuse the validated planner, artifact checks, review result contract, repair bounds, cancellation, and DSH task execution. Keep the method identifiable in stage labels and instructions without loading external skills.
- [ ] **Step 4: Create `plugin-superpowers-style.ts`.** Export the standard named function-plugin contract and mount the `superpowers` style with the shared schema.
- [ ] **Step 5: Add maximum-path tests.** Drive a deterministic task through an artifact failure and evidence-backed repair; assert fresh verification, a finite child count, and no replay after an unknown child result.
- [ ] **Step 6: Run the focused tests.** Expected: Superpowers-style completes the passing fixture and fails closed for invalid or over-limit plans.
- [ ] **Step 7: Commit the policy plugin and its tests.**

### Task 3: Expose the new mode and tier in the composer

**Files:**
- Modify: `packages/experimental/task-strategy/src/client/OrchestrationSelect.tsx`
- Modify: `packages/experimental/task-strategy/src/client/TaskEntryCard.tsx`
- Modify: `packages/experimental/task-strategy/src/client/locales.ts`
- Test: `packages/experimental/task-strategy/tests/orchestration-select.client.spec.tsx`
- Test: `packages/experimental/task-strategy/tests/task-entry.client.spec.tsx`

**Interfaces:**
- Consumes: the four-tier Host state and the `superpowers-style` orchestration registration from Tasks 1–2.
- Produces: localized labels for Superpowers-style and extreme-high; mode choice and captured task receipt display all four tiers.

- [ ] **Step 1: Add failing client tests.** Assert the new mode label appears, all four tier values are selectable, and a completed/running task receipt displays `extreme-high` in English and Chinese.
- [ ] **Step 2: Run the focused client tests.**

Run: `pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/orchestration-select.client.spec.tsx tests/task-entry.client.spec.tsx`

Expected: failures for the missing mode label and tier copy.

- [ ] **Step 3: Add English and Chinese locale entries and the Superpowers-style option.** Preserve the existing mode ordering and labels.
- [ ] **Step 4: Add the extreme-high option and receipt rendering.** Keep the tier selector available only when the selected mode declares tier support.
- [ ] **Step 5: Run the focused client tests.** Expected: localized mode/tier choices and task receipts render correctly.
- [ ] **Step 6: Commit the composer changes and tests.**

### Task 4: Publish the entry, compose it opt-in, and verify the real Loader path

**Files:**
- Modify: `packages/experimental/task-strategy/package.json`
- Modify: `packages/experimental/task-strategy/tsdown.config.ts`
- Modify: `strategies/workflows.patch.yml`
- Modify: `packages/experimental/task-strategy/tests/adapter.spec.ts`
- Modify: `packages/experimental/task-strategy/README.md`
- Modify: `packages/experimental/task-strategy/README.zh.md`
- Modify: `strategies/README.md`
- Modify: `strategies/README.zh.md`

**Interfaces:**
- Consumes: the Superpowers-style plugin entry and UI/Host mode from Tasks 1–3.
- Produces: package export `@deepseek-ai/dsh-experimental-task-strategy/plugins/superpowers-style`; an optional `strategy-superpowers-style` row in the workflow patch; bilingual package and workflow docs.

- [ ] **Step 1: Add a failing real Loader-composition test.** Load the Superpowers-style function plugin beside the real task-strategy carrier; assert strategy and mode registration, task execution through the DSH preset, and registry removal after plugin disposal.
- [ ] **Step 2: Run the focused Loader test.**

Run: `pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/adapter.spec.ts -t 'Superpowers-style'`

Expected: failure because the package entry is not exported or composed.

- [ ] **Step 3: Add the package export and tsdown companion entry.** Verify the built public entry resolves to the new function plugin.
- [ ] **Step 4: Add the Superpowers-style row to `strategies/workflows.patch.yml`.** Keep the patch opt-in and do not edit shipped profile defaults.
- [ ] **Step 5: Update both README pairs.** Document four tiers, extreme-high bounds and estimate caveats, Superpowers-style behavior, and its non-official/no-external-skill boundary. Keep the general 12 workflow recipes at three tiers.
- [ ] **Step 6: Run package build and focused Loader verification.**

Run: `pnpm --filter @deepseek-ai/dsh-experimental-task-strategy build`

Run: `pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/adapter.spec.ts -t 'Superpowers-style'`

Expected: the public entry builds; real Loader registration, preset execution, and disposal pass with deterministic model responses.

- [ ] **Step 7: Run focused lint and documentation checks.** Check both README pairs, the workflow patch, package entry metadata, and `git diff --check`.
- [ ] **Step 8: Commit package composition and documentation.**

### Task 5: Run the maximum-path regression and final verification

**Files:**
- Test: `packages/experimental/task-strategy/tests/style-policy.spec.ts`
- Test: `packages/experimental/task-strategy/tests/adapter.spec.ts`

**Interfaces:**
- Consumes: all four style policies and the four-tier UI/Host contract.
- Produces: deterministic proof of configured extreme-high work, cancellation cleanup, and regression safety for existing tiers.

- [ ] **Step 1: Add one controlled maximum-scenario regression.** Exercise the configured 12-node/4-repair extreme-high ceiling using deterministic child results and assert the exact finite task count, sequential write behavior, and cleanup after cancellation.
- [ ] **Step 2: Run the regression and targeted package tests.**

Run: `pnpm --filter @deepseek-ai/dsh-experimental-task-strategy exec vitest run tests/style-policy.spec.ts tests/adapter.spec.ts tests/orchestration.spec.ts tests/selector.spec.ts tests/orchestration-select.client.spec.tsx tests/task-entry.client.spec.tsx`

Expected: all focused cases pass without provider credentials; legacy low/medium/high tests remain green.

- [ ] **Step 3: Build the package and run typecheck.** Expected: all Host, Client, public export, and generated type faces compile.
- [ ] **Step 4: Review the package and strategy README changes against source behavior and the spec.** Re-record both bilingual pairs and run `pnpm run test:docs`, `pnpm run doc-sync`, and `git diff --check` as required by repository documentation policy.
- [ ] **Step 5: Commit the final regression evidence and documentation.**
