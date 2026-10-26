---
kind: upgrade-guide
description: "Bounds task-strategy output-limit recovery and grants style continuations explicit time windows."
---

# Task strategy output recovery

English | [中文](guide.zh.md)

## Change

Local preset tasks previously continued output truncation until another execution limit stopped them. They now permit four continuations by default and stop after two continuations without new merged text or successful tools. Interrupted results retain the child session and partial output. Routing and selection retry truncation once before failing or using a configured fallback. They use the model's least advertised reasoning effort when no advertised off/none value exists.

Style plugins grant each continuation its own 300,000 ms window (600,000 ms for extreme-high). User cancellation remains effective throughout. Custom plans retain their original overall deadline unless they opt into a continuation deadline.

## Migration

1. In custom native preset plans, set `TaskStep.continuation.maxAttempts` to an integer from 0 to 16; zero disables automatic continuation. Set `continuation.timeoutMs` only when each continuation should receive a new bounded deadline. External executor tasks do not accept these controls.
2. In style plugin configuration, edit `continuation` or `extremeHigh.continuation` to bound the additional attempts and time. The maximum activation time is the initial timeout plus `maxAttempts` times the continuation timeout, excluding cleanup. No-progress recovery can stop earlier.
3. Confirm that an interrupted task retains its session and diagnostic and that no dependent stage starts before the current one completes. Inspect partial artifacts before a manual retry. These controls do not add process-restart recovery or the missing public continuation API to the independent Policy Bundle.
