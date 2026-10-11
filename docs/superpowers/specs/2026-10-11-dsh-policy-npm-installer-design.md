# DSH Policy npm Installer

English | [中文](2026-10-11-dsh-policy-npm-installer-design.zh.md)

## Goal

Let a Windows x64 user start installation of the published DSH Policy desktop edition with one npm command, without installing a strategy plugin or copying the desktop executable into an npm tarball.

## User command

```text
npx --yes @deepseek-ai/dsh-policy install
```

The npm package exposes a small `dsh-policy` command. It has no `postinstall` hook. The explicit `install` command downloads the Windows x64 installer for GitHub Release `policy-v0.2.0`, verifies its exact byte length and SHA-256, and launches the existing interactive installer. It does not install Node dependencies, configure a model, change PATH, or alter the existing DSH profile.

## Package and artifact

- Package: `@deepseek-ai/dsh-policy`, version `0.2.0`.
- The npm tarball contains only the command, package metadata, and brief usage documentation. It does not contain the 286,555,946-byte installer.
- The command uses the immutable asset URL under `https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v0.2.0/` and pins SHA-256 `6f9b8a3fee5049cc947628a070cca764c093225ac967d39e2f39e13b2764dcaf`.
- The package is Windows x64 only. Other operating systems and architectures receive a clear unsupported-platform message and the Release page URL.
- The package source lives outside the DSH npm release-family workspaces so it can be versioned and released with the desktop edition instead of forcing a version bump across all DSH packages.

## Download and launch behavior

The command accepts only the `install` action and help/version options. It follows HTTPS redirects for the pinned GitHub asset, rejects unexpected hosts, HTTP errors, truncated or oversized content, and digest mismatches, and writes to a unique temporary directory. It launches the verified installer with inherited console handles so its existing interactive UI remains usable. It removes temporary data after the installer exits and returns the installer exit status. Network or verification errors stop before process launch and show the Release page for manual download.

## Release and verification

The npm package version tracks the public desktop edition version, not the DSH core version. A future desktop release updates the pinned tag, asset name, byte length, SHA-256, and npm package version together. Before publication, the package tarball is inspected with `npm pack --dry-run`; its metadata must declare the package name, version, and executable, and include no desktop binary or secrets. The published package is checked by reading its registry metadata and confirming the release URL and checksum constants match the desktop Release.

## Constraints and current release access

The user explicitly requested an npm command that starts installation of the current desktop edition. That request authorizes the small npm executable entry point needed for the command. The implementation remains a downloader for the existing hash-verified desktop artifact; it does not convert task strategies into a separate npm plugin or modify the DSH CLI package.

The current local npm identity is `zhangzheng22668`. Registry access to the `@deepseek-ai` organization returned HTTP 403, and the `DSH-Policy` GitHub repository currently has no npm publishing secret or npm publishing environment. Source and tarball preparation can be completed here; publishing under `@deepseek-ai` requires a publisher identity or repository release channel with write access to that scope.
