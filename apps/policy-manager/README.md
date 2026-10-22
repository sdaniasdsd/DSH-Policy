# DSH Policy Manager

English | [中文](README.zh.md)

DSH Policy Manager is a standalone Windows app for managing the official DSH Desktop installation, choosing official or Policy mode, and keeping the selected Harness home across supported changes.

The app uses the official Desktop runtime and profile CLI. It does not patch `app.asar` or run a second agent runtime.

On Windows, installation discovery reads the official uninstall registry entry and verifies that the installed executable exists. It reads Desktop and DSH package identity from the application's ASAR without modifying it. Missing or unreadable runtime identity leaves official mode available and disables Policy mode; Policy is enabled only for an exact runtime version and commit in the verified catalog. A dirty build is never Policy-compatible.

Harness home selection honors an explicit `DSH_HOME`, otherwise reuses the only populated home among `%USERPROFILE%\.dsh` and the former Policy Edition home `%USERPROFILE%\.dsh-policy`. If both contain data, the manager asks the user to choose and does not merge sessions. Every transition backup is encrypted with Windows DPAPI, checked before restore, and staged in a new directory so the original backup and current home remain intact if validation fails. The transition journal publishes each stage as a synced immutable record before the next mutation.

Installer downloads are limited to the official HTTPS host, staged as partial files, checked against the catalog SHA-256, and checked again immediately before launch. Only the built-in NSIS silent argument is permitted, and installation waits until the Desktop process exits. Recovery requires the prior release to match the signed catalog, reinstalls its verified artifact (downloading it again when the local cache is missing), confirms the bundled DSH version and commit, and restores the encrypted home snapshot. A failed or mismatched recovery leaves the backup and current data in place and marks the journal recovery-required.

The release catalog accepts only unexpired signed records that identify an official Windows x64 installer, its SHA-256, its bundled DSH version and commit, and exact Policy compatibility. The checked-in development catalog is empty because no immutable official Desktop installer artifact has yet been verified for distribution. Policy mode stays unavailable until the exact runtime compatibility and release-catalog signing key are configured.

## Development

Install the stable MSVC Rust toolchain, Visual Studio C++ Build Tools, and WebView2 Runtime. Refresh JavaScript dependencies with `corepack pnpm install` from the repository root; the workspace root already declares the `apps/*` package pattern.

Run the UI tests with `npm --prefix apps/policy-manager test`, build the UI with `npm --prefix apps/policy-manager run build`, and run the Rust tests with `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml`.

Keep catalog signing private keys outside the repository. Publish `manager-catalog.json` and its raw Ed25519 signature as release assets only after verifying the immutable official installer bytes and runtime identity.
