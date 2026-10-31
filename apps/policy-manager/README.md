# DSH Policy Manager

English | [中文](README.zh.md)

DSH Policy Manager is a standalone Windows app for managing the official DSH Desktop installation, choosing official or Policy mode, and keeping the selected Harness home across supported changes.

The app uses the official Desktop runtime and profile CLI. It does not patch `app.asar` or run a second agent runtime.

On Windows, installation discovery recognizes versioned official and Policy Edition uninstall entries, verifies the executable, and reads Desktop and DSH identity from the standard Electron ASAR format. The Home page lists both editions with their paths, versions and commits. The unique official installation is selected by default; an explicit selection is retained. Missing or unreadable official runtime identity disables extension activation; a dirty build is never extension-compatible. An integrated Policy Edition is identified separately and cannot become an official installation by removing the standalone extension.

Harness home selection honors an explicit `DSH_HOME`, otherwise reuses the only populated home among `%USERPROFILE%\.dsh` and the former Policy Edition home `%USERPROFILE%\.dsh-policy`. If both contain data, the manager asks the user to choose and does not merge sessions. Every transition backup is encrypted with Windows DPAPI, checked before restore, and staged in a new directory so the original backup and current home remain intact if validation fails. The transition journal publishes each stage as a synced immutable record before the next mutation.

Backups omit `node_modules` directories and directory links because DSH can recreate those dependencies. Other symbolic links and unsupported filesystem entries stop backup rather than being followed.

Mode changes use the installed Desktop's bundled DSH CLI with a typed argument list and the selected `DSH_HOME`. Policy mode downloads the exact extension tarball from the fixed repository, checks its signed-catalog SHA-256 and size, backs up the shared home, and asks the official CLI to install the verified local archive. It then verifies the package name, version and runtime metadata. Official mode removes only that package. The manager refuses to edit an uninitialized or locked desktop profile, refuses changes while DSH Desktop is running, and restores the pre-change encrypted home snapshot if an operation fails.

The Versions page automatically reads public Policy distribution releases from `sdaniasdsd/DSH-Policy` on startup. It shows integrated Desktop installers separately from standalone extension tarballs. Public release metadata is informational only; only the signed manager catalog can establish extension compatibility or authorize installation. Discovery errors remain visible and can be retried without discarding successful local detection.

The package guide on Home and Versions explains the selected installation and offers a stable integrated installer or an exactly compatible extension. An integrated installer includes the application and does not require a separate official installation. Recommendations compare semantic versions, exclude previews and mismatched installer filenames, and retain the selected management target. The historical upstream map in `catalog/policy-bases.json` identifies each audited Policy release's declared official base and pinned source evidence; an unverified upstream commit remains unknown. This map is informational, cannot grant extension compatibility, and is omitted for unknown releases or conflicting release source commits.

Catalog refresh verifies the detached signature before caching the catalog; cached data is verified again on startup. The launch action applies the selected official profile mode, or launches the selected integrated Policy Edition without editing its profile, using the selected `DSH_HOME`. Restoring a backup first creates a fresh encrypted snapshot of the current home. Before a verified official version upgrade starts, the manager stores a restart-safe recovery descriptor. Activity offers recovery of the previous verified Desktop and pre-upgrade home after an interrupted transition.

Installer downloads are limited to the official HTTPS host, staged as partial files, checked against the catalog SHA-256, and checked again immediately before launch. Only the built-in NSIS silent argument is permitted, and installation waits until the Desktop process exits. Recovery requires the prior release to match the signed catalog, reinstalls its verified artifact (downloading it again when the local cache is missing), confirms the bundled DSH version and commit, and restores the encrypted home snapshot. A failed or mismatched recovery leaves the backup and current data in place and marks the journal recovery-required.

The signed catalog can independently list verified official Windows installers and standalone extension packages. Extension records bind a GitHub release tarball, SHA-256, byte size and exact bundled DSH runtime version/build commit. `dshCommit` in package metadata is the upstream source-tag commit; it is separate from the Desktop build commit used for install compatibility. The Policy tool exposes one built-in workflow and streams phases and agent activity through DSH Jobs. Same-child continuation, active-only feedback delivery and per-child tool sandbox controls remain unavailable in the pinned public DSH API.

## Development

Install the stable MSVC Rust toolchain, Visual Studio C++ Build Tools, and WebView2 Runtime. Refresh JavaScript dependencies with `corepack pnpm install` from the repository root; the workspace root already declares the `apps/*` package pattern.

Run the UI tests with `npm --prefix apps/policy-manager test`, build the UI with `npm --prefix apps/policy-manager run build`, and run the Rust and IPC command tests with `cargo test --manifest-path apps/policy-manager/src-tauri/Cargo.toml --features app`.

Keep catalog signing private keys outside the repository. Publish `manager-catalog.json` and its raw Ed25519 signature as release assets only after verifying the immutable official installer bytes and runtime identity.
