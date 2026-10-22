# DSH Policy Manager

English | [中文](README.zh.md)

DSH Policy Manager is a standalone Windows app for managing the official DSH Desktop installation, choosing official or Policy mode, and keeping the selected Harness home across supported changes.

The app uses the official Desktop runtime and profile CLI. It does not patch `app.asar` or run a second agent runtime.

The release catalog accepts only unexpired signed records that identify an official Windows x64 installer, its SHA-256, its bundled DSH version and commit, and exact Policy compatibility. The checked-in development catalog is empty because no immutable official Desktop installer artifact has yet been verified for distribution. Policy mode stays unavailable until the exact runtime compatibility and release-catalog signing key are configured.

## Development

Install the stable MSVC Rust toolchain, Visual Studio C++ Build Tools, and WebView2 Runtime. Refresh JavaScript dependencies with `corepack pnpm install` from the repository root; the workspace root already declares the `apps/*` package pattern.

Run the UI tests with `npm --prefix apps/policy-manager test`, build the UI with `npm --prefix apps/policy-manager run build`, and run the Rust catalog tests with `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml`.

Keep catalog signing private keys outside the repository. Publish `manager-catalog.json` and its raw Ed25519 signature as release assets only after verifying the immutable official installer bytes and runtime identity.
