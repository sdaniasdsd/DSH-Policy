# Release catalog

English | [中文](README.zh.md)

The checked-in JSON is an unsigned development inventory and is not an install source. Its `catalogRevision` increases on every published catalog, and `expiresAt` is Unix time in seconds. It is empty until a first-party Desktop installer has an immutable URL, verified SHA-256, known installer behavior, and independently read bundled DSH version and commit.

Published managers accept the `manager-catalog.json` release asset only after Ed25519 verification with the release public key embedded in that manager build and reject it after `expiresAt`. The detached `.sig` asset contains the raw 64-byte signature over the exact catalog bytes. Keep its private key outside this repository and outside user-facing diagnostics.

Do not add a release because its Desktop or DSH version is known. An entry becomes installable only after the source artifact, bytes, hash, runtime identity, installer profile and exact Policy compatibility mapping are verified.
