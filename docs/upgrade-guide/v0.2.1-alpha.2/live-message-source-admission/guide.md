---
kind: upgrade-guide
description: "Reject incompatible live message sources before persistence and optionally adapt named legacy context producers."
---

# Admit live message sources before persistence

English | [中文](guide.zh.md)

## Change

Session rejects missing, empty, and retired `kind: 'plugin'` sources before committing a message or pending inbox insertion. Rejection uses `INVALID_MESSAGE_SOURCE`; an agent turn retains this code and local subagent results carry its committed diagnostic. An incompatible context no longer reaches the asynchronous writer before failing. Stored-format admission and historical migrations retain their rules.

The strategy child adapter retains observed execution facts when disposal fails, under `CHILD_DISPOSAL_FAILED`. A cleanup failure cannot establish that no tools ran. Execution errors and unknown effects must be investigated before rerunning side-effecting work.

## Migration

1. Update context producers to declare and emit a producer-owned source kind. Remove the retired wrapper.
2. If a known external producer cannot yet be upgraded, set the loop entry's `legacyPluginSources` to its exact self-declared `source.plugin` identity. The default is empty. This adapter covers live inbox and pre-step user contexts; it does not rewrite direct Session appends or persisted rows.
3. Exercise the producer's context-emitting path, dispose the child, and reopen its session. Confirm the canonical source and complete terminal events, rather than relying only on the in-memory result.

For the legacy deja notice path, the existing loop composition entry can include:

```yaml
name: cordis:agent-loop
config:
  legacyPluginSources: [deja]
```

Keep other entry settings. This list matches declared identities, not authenticated plugin ownership. Remove an entry after its producer emits native sources. See the [loop contract](../../../../packages/core/agent-loop/README.md) for metadata preservation and the strict fallback.
