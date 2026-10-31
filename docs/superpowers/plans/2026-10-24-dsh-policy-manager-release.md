# DSH Policy Manager + Extension release plan

## Acceptance
- The official DSH 0.2.1-rc.2 CLI can install the standalone Policy extension from a pinned GitHub release asset in an isolated profile.
- The extension has observable Host activation and task output, using only public APIs shipped by the target runtime.
- The manager detects local DSH, verifies a signed catalog, selects the exact compatible extension, backs up before mode changes, and can switch Policy/Official in isolated data.
- The target repository is only https://github.com/sdaniasdsd/DSH-Policy; publish source, extension asset, signed catalog and manager installer only after all checks pass.

## Work lanes
1. Audit and implement a minimal observable Host plugin using DSH 0.2.1-rc.2 public tool/workflow/jobs APIs; accurately document unsupported continuation semantics.
2. Extend signed catalog and manager package acquisition to support a standalone extension tarball with exact runtime mapping and hash checks.
3. Expose GitHub extension releases and install guidance in manager UI; keep integrated desktop releases distinct.
4. Add a deterministic extension asset release workflow and signed manager catalog release flow.
5. Run package, UI, Rust, Windows packaged-manager and isolated official-CLI smoke tests; publish and verify GitHub assets/catalog after passing.

## Release safety
- Preserve current user data and the running official DSH; all local state-changing tests use a fresh temporary DSH_HOME and manager data directory.
- Do not claim the extension is complete until Host activation visibly runs and CLI profile transitions pass.
