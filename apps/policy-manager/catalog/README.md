# Release catalog

English | [中文](README.zh.md)

The checked-in JSON is an unsigned development inventory and is not an install source. Its `catalogRevision` increases on every published catalog, and `expiresAt` is Unix time in seconds. `desktopReleases` describe verified official installers. `policyExtensions` separately describe the extension tarball, SHA-256, size, and exact embedded DSH runtime version/build commit, so the manager can add an extension to an installed official DSH without a historic installer record.

Managers fetch `manager-catalog.json` from the dedicated `dsh-policy-manager-catalog` GitHub release, not the repository's moving latest release, which may belong to the Policy Bundle. Every build pins the same Ed25519 verification key from `catalog/public-key.hex` and rejects catalogs after `expiresAt`. The detached `.sig` asset contains the raw 64-byte signature over the exact catalog bytes. Keep its private key in the GitHub Actions Secret `DSH_POLICY_CATALOG_SIGNING_KEY`, outside this repository and user-facing diagnostics.

Do not add a release because a GitHub tag or package `engines.dsh` field is known. An extension record must point to a version-pinned asset in `sdaniasdsd/DSH-Policy`; the release pipeline downloads the asset and verifies SHA-256, size, package identity, exact runtime build mapping, and absence of install lifecycle scripts. Only a signed catalog mapping authorizes the manager to install it. `dshCommit` is the upstream source-tag commit; `runtimeCommit` is the DSH build embedded by Desktop. Never conflate them.
