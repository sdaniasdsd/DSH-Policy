---
kind: upgrade-guide
description: "Direct task strategy carrier compositions now require the separate task runtime service."
---

# Separate task runtime service

English | [中文](guide.zh.md)

## Change

Profiles that directly mount `@deepseek-ai/dsh-experimental-task-strategy/cordis` now also require `@deepseek-ai/dsh-experimental-task-strategy/runtime`. The strategy carrier owns policy registration and intake; the task service owns plan admission, execution and original Jobs. Existing native plans and strategy controls retain their behavior. The policy workflow bundle already mounts both services.

## Migration

1. For a direct composition, add a Loader row named `@deepseek-ai/dsh-experimental-task-strategy/runtime` alongside the carrier in the profile patch. Bundle users update the workflow bundle instead.
2. Existing `preset` tasks need no plan change. For optional external adapters, set `allowedExecutors` explicitly and enable only configured [orchestration plugins](../../../../packages/experimental/task-strategy/README.md#runtime-plugins).
3. Confirm both `taskRuns` and `taskStrategies` are mounted. Submit an existing named strategy and confirm one original Job is accepted and its progress remains visible. Existing host controls continue to work through `taskStrategies`; independent plugins may use `taskRuns` directly.
