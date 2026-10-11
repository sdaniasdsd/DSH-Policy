# Orchestration plugins implementation plan

English | [中文](2026-10-10-orchestration-plugins.zh.md)

Spec: `.agents/task-strategy-history/specs/2026-10-10-orchestration-plugins.md`.

Global constraints: preserve original DSH lifecycle and the preceding default-entry work; no silent capability loss; no extra model loop or raw process manager; no credentials in logs or commits. Inline execution is already authorized. Stage changes use the existing binding epoch.

## Task 1: Independent task service

Extract captured plan admission, execution and original Jobs ownership from the strategy carrier into `task-runtime-service.ts`. Publish `./runtime`; update all in-repo compositions. Keep existing strategy APIs delegating for compatibility. Add a Loader regression for execution directly through `taskRuns`, independent of author policy registration. Check existing adapter/runtime tests.

## Task 2: Executor registration

Add explicit external `executor` targets alongside native `preset` targets, require exactly one, and expose effect-scoped task executor registration. Capture allowed executor rules per task. Test unavailable, forbidden and unsupported execution choices before admission; test unload and cancellation during execution. Share output conversion and disposal with native DSH children.

## Task 3: Product plugins

Implement independently configurable Codex and Claude orchestration plugins using the existing original native Subagent providers. Inspect official ZCode source and implement its verified protocol using original DSH subprocess/provider infrastructure. Register strategies and execution adapters through public interfaces. Test policy registration, actual provider dispatch boundaries and disposal. Document backend setup and native limitations precisely.

## Task 4: Delivery

Run relevant focused tests, build Host/Client, regenerate API/config/docs and persistence acknowledgements where needed, then a fresh whole-branch review. Fix important findings in one pass with reproducing tests. Build the policy desktop edition, perform built smoke checks, replace the local application with rollback protection, and report actual verification and remaining limitations.

Review focus: races during plugin reload and Job admission, exact owner capability checks, stale switch epochs, leaked child handles, external permissions being confused with DSH presets, and unavailable native authentication being mistaken for plugin success.
