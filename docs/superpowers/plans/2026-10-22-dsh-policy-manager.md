# DSH Policy Manager Implementation Plan

English | [中文](2026-10-22-dsh-policy-manager.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Windows Tauri application that manages verified official DSH Desktop releases, exact Policy compatibility, shared Harness data, mode switching, backups, rollback, launch and diagnostics.

**Architecture:** Add `apps/policy-manager` as a separate workspace application with a React/TypeScript interface and a Windows-only Rust backend. The backend verifies a signed release catalog, uses the bundled Desktop `dsh` command for profile operations, and owns installer, backup and recovery transactions; it never edits `app.asar` or runs a replacement agent runtime.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Vite, Vitest, Cargo tests, Windows DPAPI.

**Spec:** [DSH Policy Manager and Version Control](../specs/2026-10-22-dsh-policy-manager-design.md)

## Global Constraints

- Target Windows x64 and one active official DSH Desktop installation in the first release.
- Treat Desktop package version and bundled DSH runtime version plus upstream commit as separate identities.
- Enable Policy mode only for an exact runtime-version and commit compatibility record; otherwise allow official mode only.
- Keep the selected `DSH_HOME` constant across modes and supported releases; create and verify a local encrypted backup before mutation.
- Use the official Desktop `dsh` command and profile Bundle path; never edit `app.asar`, inject renderer code, or replace the official runtime.
- Verify the signed catalog and installer SHA-256 before installation; only catalogued first-party artifacts with known installer behavior are installable.
- Preserve the last verified installer and Harness-home restore point; never launch an unverified installation after a failed or interrupted transition.
- Redact credentials, authorization headers and secret-bearing command arguments from diagnostics.
- The Windows development host now has the stable MSVC Rust toolchain and Visual Studio C++ Build Tools; WebView2 is required to run the packaged manager.

## Review Focus

- Missing, malformed, expired or incorrectly signed catalog data must disable install and Policy mode without preventing safe launch in official mode; Task 1 pins parser and UI states.
- A Desktop version with a mismatched DSH version or commit must never enable a nearby Policy release; Task 1 and Task 5 pin exact-pair rejection.
- Both standard and former Policy homes containing data must preserve both snapshots and require an explicit home choice; Task 3 pins setup and backup behavior.
- DSH, its profile package operation or another manager transition may still be running; Tasks 3–5 pin lock handling and no-mutation behavior.
- Download, installer, profile operation or process interruption may leave a partial transition; Task 4 pins recovery to the prior verified version and snapshot.

---

### Task 1: Manager scaffold and trusted release catalog

**Files:**
- Create: `apps/policy-manager/package.json`
- Create: `apps/policy-manager/index.html`
- Create: `apps/policy-manager/vite.config.ts`
- Create: `apps/policy-manager/tsconfig.json`
- Create: `apps/policy-manager/src/main.tsx`
- Create: `apps/policy-manager/src/App.test.tsx`
- Create: `apps/policy-manager/src/App.tsx`
- Create: `apps/policy-manager/src-tauri/Cargo.toml`
- Create: `apps/policy-manager/src-tauri/build.rs`
- Create: `apps/policy-manager/src-tauri/tauri.conf.json`
- Create: `apps/policy-manager/src-tauri/src/main.rs`
- Create: `apps/policy-manager/src-tauri/src/lib.rs`
- Create: `apps/policy-manager/src-tauri/src/catalog.rs`
- Create: `apps/policy-manager/src-tauri/src/catalog_update.rs`
- Create: `apps/policy-manager/src-tauri/tests/catalog.rs`
- Create: `apps/policy-manager/src-tauri/tests/catalog_update.rs`
- Create: `apps/policy-manager/catalog/releases.json`
- Create: `apps/policy-manager/catalog/README.md`
- Create: `apps/policy-manager/catalog/README.zh.md`
- Create: `apps/policy-manager/README.md`
- Create: `apps/policy-manager/README.zh.md`
- Modify: `pnpm-workspace.yaml` only if the existing `apps/*` workspace glob does not include the new package.

**Interfaces:**
- Produces: Rust `ReleaseCatalog::verify(bytes: &[u8], signature: &[u8], public_key: &[u8; 32]) -> Result<ReleaseCatalog, CatalogError>` and `ReleaseCatalog::policy_for(runtime_version: &str, runtime_commit: &str) -> Option<&PolicyRelease>`.
- Produces: public `DesktopRelease` and `PolicyRelease` structs whose fields match the signed catalog record fields listed below.
- Produces: async `CatalogClient::refresh(current: Option<&ReleaseCatalog>) -> Result<ReleaseCatalog, CatalogUpdateError>`; it fetches `manager-catalog.json` and its detached signature only from `https://github.com/sdaniasdsd/DSH-Policy/releases/download/dsh-policy-manager-catalog/`, verifies the signature, and rejects a catalog revision lower than the loaded one.
- Catalog release records include OS, architecture, Desktop version, DSH version, DSH commit, first-party installer URL, SHA-256, installer argument profile and exact Policy package mapping. The checked-in development inventory may remain empty and unsigned; published catalogs require an embedded public key and detached Ed25519 signature.
- The initial catalog contains only artifacts whose first-party source, immutable bytes, hash, runtime identity and installer behavior have been verified; other core tags remain visible as unavailable metadata or are omitted.

- [ ] **Step 1: Write failing Rust catalog tests** for valid signed data, invalid signature, malformed fields, expiration, unsupported architecture, missing hash, duplicate Desktop identity, exact Policy match and runtime-commit mismatch; write catalog-update tests for redirects outside approved GitHub hosts, invalid replacement signatures and lower revision rejection; add a failing `App.test.tsx` smoke test for the initial shell.
- [ ] **Step 2: Add the minimal Tauri/Vite test harness and compile-only Rust API stubs** so the tests execute; run the two Cargo integration-test targets and Vitest, and confirm behavior assertions fail because valid catalog verification, exact matching, catalog refresh and the initial app heading are not implemented.
- [ ] **Step 3: Implement catalog parsing, Ed25519 signature verification and catalog refresh**; embed only the catalog verification public key in the application and keep the signing key out of the repository.
- [ ] **Step 4: Verify the first-party installer source, update feed fields, stable download bytes, SHA-256, embedded DSH identity and supported installer arguments** before adding any installable entry; record unresolved archive behavior in the catalog README. Do not create a production signature key as part of implementation; document the release-key configuration requirement.
- [ ] **Step 5: Run `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test catalog`, `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test catalog_update` and `npm --prefix apps/policy-manager test`**; expect catalog tests and the initial React shell test to pass.
- [ ] **Step 6: Commit** as `feat: scaffold DSH policy manager and release catalog`.

### Task 2: Installed Desktop detection and manager state

**Files:**
- Create: `apps/policy-manager/src-tauri/src/installed_dsh.rs`
- Create: `apps/policy-manager/src-tauri/src/manager_state.rs`
- Create: `apps/policy-manager/src-tauri/tests/installed_dsh.rs`
- Create: `apps/policy-manager/src-tauri/tests/manager_state.rs`
- Modify: `apps/policy-manager/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Task 1 `ReleaseCatalog` and the trusted catalog parser.
- Produces: `InstalledDsh::detect(registry: &dyn InstallRegistry) -> Result<Option<InstalledDsh>, DetectError>` and `ManagerState::inspect(installed: Option<InstalledDsh>, home: PathBuf, profile: ProfileSnapshot, catalog: &ReleaseCatalog) -> ManagerState`.
- `InstalledDsh` stores installation path, Desktop version, bundled DSH version and commit when available; `ManagerState` reports official/policy mode and exact compatibility status independently.

- [ ] **Step 1: Write failing tests** for no installation, valid registry install, missing executable, unreadable runtime identity, externally updated runtime and exact versus mismatched Policy compatibility.
- [ ] **Step 2: Run `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test installed_dsh` and `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test manager_state`** and confirm the new tests fail before implementation.
- [ ] **Step 3: Implement registry-backed Windows installation discovery and read-only bundled runtime identity detection** without writing to the installation or `app.asar`.
- [ ] **Step 4: Implement manager state derivation** so unsupported or unknown installations remain launchable only in verified official mode and disable Policy mode.
- [ ] **Step 5: Run the focused Cargo tests** and expect all detection and compatibility cases to pass.
- [ ] **Step 6: Commit** as `feat: detect DSH desktop and policy compatibility`.

### Task 3: Shared Harness home, encrypted backups and transition journal

**Files:**
- Create: `apps/policy-manager/src-tauri/src/harness_home.rs`
- Create: `apps/policy-manager/src-tauri/src/backup.rs`
- Create: `apps/policy-manager/src-tauri/src/transaction.rs`
- Create: `apps/policy-manager/src-tauri/tests/harness_home.rs`
- Create: `apps/policy-manager/src-tauri/tests/backup.rs`
- Create: `apps/policy-manager/src-tauri/tests/transaction.rs`
- Modify: `apps/policy-manager/src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `HarnessHome::resolve(explicit: Option<PathBuf>, user_profile: &Path) -> HomeResolution`, `BackupStore::create(home: &Path) -> Result<BackupRecord, BackupError>`, `BackupStore::restore(record: &BackupRecord, destination: &Path) -> Result<(), BackupError>` and `TransitionJournal::advance(operation_id: Uuid, stage: TransitionStage) -> Result<(), JournalError>`.
- Backup files use a versioned archive encrypted with Windows DPAPI and contain a manifest with source path, creation time and archive digest.
- Transition stages are durable before each install/profile mutation and distinguish prepared, backed-up, installing, profile-updating, verifying, committed, recovering and recovery-required states.

- [ ] **Step 1: Write failing tests** for explicit `DSH_HOME`, standard-home fallback, both legacy homes containing data, archive tampering, DPAPI round-trip, interrupted journal writes and illegal stage transitions.
- [ ] **Step 2: Run `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test harness_home`, `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test backup` and `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test transaction`** and confirm the tests fail before implementation.
- [ ] **Step 3: Implement home selection and backup encryption** with a platform abstraction that permits deterministic test encryption while production uses Windows DPAPI.
- [ ] **Step 4: Implement atomic journal persistence and recovery-state parsing**; never delete or overwrite the only verified backup when recovery data is incomplete.
- [ ] **Step 5: Run focused Cargo tests on Windows** and expect home selection, encrypted restore and interrupted-journal recovery tests to pass.
- [ ] **Step 6: Commit** as `feat: add encrypted DSH home backups and transition journal`.

### Task 4: Verified installer download, replacement and rollback

**Files:**
- Create: `apps/policy-manager/src-tauri/src/installer.rs`
- Create: `apps/policy-manager/src-tauri/src/recovery.rs`
- Create: `apps/policy-manager/src-tauri/tests/installer.rs`
- Create: `apps/policy-manager/src-tauri/tests/recovery.rs`
- Modify: `apps/policy-manager/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Tasks 1–3 catalog, installed state, backup and journal interfaces.
- Produces: `InstallerManager::stage(release: &DesktopRelease) -> Result<VerifiedInstaller, InstallError>`, `InstallerManager::install(installer: &VerifiedInstaller) -> Result<(), InstallError>` and `RecoveryManager::recover(snapshot: &RecoverySnapshot) -> Result<ManagerState, RecoveryError>`.
- Installer arguments are selected from an application allow-list keyed by verified installer family; a catalog record cannot supply arbitrary executable arguments.

- [ ] **Step 1: Write failing tests** for HTTPS host restrictions, hash mismatch, partial download, cache corruption, running Desktop detection, allowed installer arguments, failed install compensation and rollback with a missing cached installer.
- [ ] **Step 2: Run `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test installer` and `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test recovery`** and confirm failures before implementation.
- [ ] **Step 3: Implement staged downloads and SHA-256 verification**; no install or Harness-home mutation may begin before the staged artifact is verified.
- [ ] **Step 4: Implement Windows installer invocation and recovery** using the verified previous installer plus pre-change backup; enter recovery-required state if compensation fails and never launch an unverified install.
- [ ] **Step 5: Run focused Cargo tests with mock installers** and expect failed and interrupted transitions to restore the previous verified state or expose a recoverable state.
- [ ] **Step 6: Commit** as `feat: install verified DSH releases with rollback`.

### Task 5: Official and Policy mode through the bundled DSH CLI

**Files:**
- Create: `apps/policy-manager/src-tauri/src/profile_mode.rs`
- Create: `apps/policy-manager/src-tauri/tests/profile_mode.rs`
- Modify: `apps/policy-manager/src-tauri/src/lib.rs`
- Modify: `apps/policy-manager/src-tauri/src/transaction.rs`

**Interfaces:**
- Consumes: `InstalledDsh`, `ReleaseCatalog`, `HarnessHome`, `BackupStore` and `TransitionJournal` from Tasks 1–4.
- Produces: `ProfileModeManager::apply(target: Mode, installation: &InstalledDsh, home: &Path) -> Result<ModeChangeResult, ModeChangeError>`.
- The manager invokes the installed Desktop CLI with argument arrays equivalent to `dsh plugin --profile desktop add @deepseek-ai/dsh-policy-extension@<exact-version>`, `list` and `remove`; it passes the chosen `DSH_HOME`, uses no shell, and redacts secret-bearing output.

- [x] **Step 1: Write failing tests** for exact-version Policy add, official-mode remove, already-correct state, runtime mismatch, uninitialized profile, running profile lock, CLI timeout and nonzero exit.
- [x] **Step 2: Run `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --test profile_mode`** and confirm failures before implementation.
- [x] **Step 3: Implement a typed process runner** that invokes the bundled Electron CLI with argument arrays and refuses shell interpolation or unverified package versions.
- [x] **Step 4: Implement mode changes as journaled transactions** that back up first, inspect actual plugin state, apply the minimum CLI mutation, then re-read profile state before success.
- [x] **Step 5: Focused profile tests passed (11 tests); a real installed-Desktop smoke test was unavailable because this machine has no registered DSH Desktop installation.**
- [x] **Step 6: Commit** as `feat: switch official and policy DSH modes`.

### Task 6: Manager interface and safe launch

**Files:**
- Create: `apps/policy-manager/src/views/HomePage.tsx`
- Create: `apps/policy-manager/src/views/VersionsPage.tsx`
- Create: `apps/policy-manager/src/views/PolicyPage.tsx`
- Create: `apps/policy-manager/src/views/ActivityPage.tsx`
- Create: `apps/policy-manager/src/App.test.tsx`
- Create: `apps/policy-manager/src/components/CompatibilityStatus.tsx`
- Create: `apps/policy-manager/src/components/OperationProgress.tsx`
- Create: `apps/policy-manager/src-tauri/src/commands.rs`
- Create: `apps/policy-manager/src-tauri/src/launcher.rs`
- Create: `apps/policy-manager/src-tauri/tests/launcher.rs`
- Modify: `apps/policy-manager/src/App.tsx`
- Modify: `apps/policy-manager/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: the typed manager state and operations from Tasks 1–5.
- Produces: Tauri commands for `get_manager_state`, `list_releases`, `set_mode`, `install_release`, `list_backups`, `restore_backup`, `launch_dsh`, `get_activity` and restart-safe `recover_transition`.
- Produces: a `refresh_catalog` command that reports verified version-catalog updates separately from DSH installer updates.
- The UI exposes Home, Versions, Policy and Activity views; unknown compatibility disables Policy mode while keeping the official launch action available.

- [x] **Step 1: Write failing React tests** for detected runtime and compatibility, unavailable Policy mode, mode switching, release rows and activity.
- [x] **Step 2: Run `npm --prefix apps/policy-manager test`** and confirm the tests fail before implementation.
- [x] **Step 3: Implement typed Tauri command adapters and a launcher** that starts the official Desktop executable with the chosen `DSH_HOME` and selected mode after verified profile state.
- [x] **Step 4: Implement the four views** using the existing repository React/Vite conventions and keep every filesystem, process and installer operation in the Rust backend.
- [x] **Step 5: Run React tests (4 passed), full Rust/Tauri tests (63 passed), Tauri app check, frontend production build and a hidden app-start smoke test.**
- [x] **Step 6: Commit** as `feat: add DSH policy manager interface and launcher`.

### Task 7: Release packaging, trusted catalog publication and end-to-end recovery checks

**Files:**
- Create: `apps/policy-manager/src-tauri/capabilities/default.json`
- Create: `.github/workflows/policy-manager-windows.yml`
- Create: `apps/policy-manager/tests/windows-manager-smoke.ps1`
- Create: `apps/policy-manager/tests/fixtures/catalog/`
- Create: `apps/policy-manager/src-tauri/tests/recovery_descriptor.rs`
- Modify: `apps/policy-manager/package.json`
- Modify: `apps/policy-manager/src-tauri/src/commands.rs`
- Modify: `apps/policy-manager/src/views/ActivityPage.tsx`
- Modify: `apps/policy-manager/src/App.test.tsx`
- Modify: `apps/policy-manager/src-tauri/tauri.conf.json`
- Modify: `apps/policy-manager/README.md`
- Modify: `apps/policy-manager/README.zh.md`

**Interfaces:**
- Consumes: the packaged manager and release catalog from Tasks 1–6.
- Produces: a Windows x64 manager installer and a catalog publication workflow that signs catalog bytes with a protected release secret; the private signing key is never stored in the repository or shipped in the app.
- The packaged smoke test launches the built manager with disposable `DSH_HOME` and `LOCALAPPDATA` values, then runs integration scenarios against mock installers; it never replaces the user's installed DSH or reads real credentials.

- [x] **Step 1: Write failing packaging and recovery checks** for unsigned catalog rejection, signing-key mismatch, empty/unsupported catalogs, packaged launch isolation, interrupted transaction persistence and the Activity recovery action.
- [x] **Step 2: Run the new checks first**; the recovery button test failed before the Activity action existed, and signer/release checks failed before the release tooling was added.
- [x] **Step 3: Add least-privilege Tauri capabilities and Windows CI** for frontend tests, Cargo tests, manager packaging, protected catalog signing and artifact hashes; release publishing waits for verification and rejects an empty catalog.
- [x] **Step 4: Add isolated packaged startup smoke and mock transition scenarios** for backups, mode switching, external-install detection, rollback and manager restart. A live installed-DSH upgrade was unavailable because this machine has no registered official DSH Desktop installation.
- [x] **Step 5: Run manager tests and production builds** — UI 5/5, release qualification 8/8, Rust/Tauri 77/77, `cargo check`, production Vite build, NSIS packaging and isolated Windows startup smoke all passed. `corepack pnpm --filter ... test` is blocked by the pre-existing root `node_modules` junction and pnpm's unsafe task-state-path check; `doc-sync` reports unrelated baseline failures (29 passed, 13 failed), with no unrelated files changed.
- [x] **Step 6: Commit** as `test: qualify DSH policy manager Windows release`.

## Source verification recorded while planning

The official [DeepSeek download page](https://www.deepseek.com/en/download/) exposes current macOS and Windows downloads; the Windows link resolves to a moving `dsh-latest-windows-x64.exe` URL. The official [DSH GitHub releases](https://github.com/deepseek-ai/deepseek-harness/releases) publish core tags and commits, which do not by themselves identify Desktop installers. Existing `apps/desktop/scripts/desktop-auto-update-environment.mjs` points the updater feed at `https://download.deepseek.com/dsh-desk/feeds/win-x64/`. Task 1 must verify the production feed's artifact retention and installer behavior before populating historical installable entries; if the feed does not provide a verified immutable installer, the catalog offers only artifacts cached locally or otherwise verified from an official first-party source.
