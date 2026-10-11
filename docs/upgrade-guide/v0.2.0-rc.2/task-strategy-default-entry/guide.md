---
kind: upgrade-guide
description: "Policy edition routes original root input through bounded task strategy selection and displays recorded progress."
---

# Task strategy default entry

English | [中文](guide.zh.md)

## Change

The optional carrier adds `entry.enabled`, defaulting to false. The policy workflow bundle sets true; existing explicit profile overrides remain authoritative. The Plugins page saves the switch through the existing versioned configuration form. Ordinary root user input is classified before the root model step. Tool work uses the existing strategy submission and owned Jobs; root execution tools are filtered and guarded. Failed routing or selection does not fall back to direct execution.

`task-strategy/entry` records original input, request identity and presentation state. The `task-strategy-entry` message source attributes model-facing Host facts. Snapshots contain counters rather than child result bodies; original Jobs retain results. Routing and selection reuse the configured selection route and bounds. Text supplements are captured at the next unstarted stage. Nontext execution inputs fail explicitly while their original attachments remain recorded.

## Migration

1. Set `entry.enabled: true` to enable automatic routing, or false to retain explicit dispatch. The switch applies to future input, not accepted Jobs.
2. Read `entryEnabled` from the catalogue and `entryState({ sessionId })` for live state. Cancel, switch and resume require owned request identities; replacement and resume require the observed binding epoch. No live owner returns no entry state. Restored cards show interrupted work rather than restarting execution.
3. Build matching Host, generated Remote and Client artifacts. Keep newer session logs with this version: older readers can reject the new required event type. Do not remove events to make a log readable by an older binary.
4. Treat displayed costs as child scenario estimates. Routing, selection, root model use, actual tool history and reasoning remain outside that estimate.

See the [package documentation](../../../../packages/experimental/task-strategy/README.md).
