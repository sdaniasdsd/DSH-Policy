---
description: "Standalone Policy Bundle for one pinned official DSH release."
kind: "package-bundle"
---

# @deepseek-ai/dsh-policy-extension

## Summary

This package installs Policy through the official DSH profile Bundle path. Its `dsh.bundle.patch` adds one plugin row; the same row supplies the Host entry and the Web Client entry declared by `dsh.client`. The package pins DSH `0.2.1-rc.2` in `engines.dsh` and in every DSH peer dependency. [`compatibility.json`](compatibility.json) records the tested source tag and commit.

## Use this package

The ordinary repository build emits both plugin entries. For a focused build, run `npm run build:policy-extension` from the repository root, then install the packed package into an official DSH profile. The published archive contains the Bundle patch, Host entry, Client entry, types, and compatibility metadata. The official profile loader checks the exact DSH version before importing the plugin.

## Model Experience

The scaffold contributes no model-visible text or tools. Its Host and Client entries register Policy behavior in later extraction steps.

#### KV Cache effect

This scaffold does not change model requests or cache reuse.

## Known Limitations and Deferred Work

- Strategy control and Web controls are added by the subsequent extraction tasks; this package currently activates empty Host and Client plugin entries.
