---
kind: upgrade-guide
description: "Subagent tool calls now wait for a final result and return it to the caller instead of returning an activation ID."
---

# Subagent calls return final results

English | [中文](guide.zh.md)

## Change

In DSH-Policy 1.0.0, `tool-subagent` waits for its child to stop and returns a `supervisor-result` containing the status, stop reason, text output, and any diagnostic. Earlier builds returned an activation ID immediately and delivered completion separately. Local DSH children cannot dispatch another DSH subagent; the parent handles follow-up work as sibling calls. A local shared-context provider must support `toolFilter` so the child cannot inherit the delegation tools. The task-strategy Job API and Session format are unchanged.

## Migration

1. No profile or Session migration is required, and `maxDepth` is unchanged.
2. Update custom prompts or consumers that expect an activation ID or later completion notice. Read the returned `status`, `stopReason`, `output`, and optional `diagnostic` from `supervisor-result`.
3. Ask workers to list follow-up tasks in their final output; have the parent dispatch those tasks as siblings. For a local shared-context provider, implement `toolFilter`; a provider that cannot enforce the delegation boundary now fails during plugin setup.
4. Verify the new flow with a request that needs two parallel investigations and one follow-up: the parent should receive both final results, dispatch the follow-up itself, and then synthesize the answer.
