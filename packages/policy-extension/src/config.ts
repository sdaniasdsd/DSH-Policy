import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import type { PolicyStyleId } from './policy-config-types.ts'
export type { PolicyExtensionConfig } from './policy-config-types.ts'

/** Host-side live configuration; the selected style can change without restarting DSH. */
export interface HostPolicyExtensionConfig {
  readonly style: Volatile<PolicyStyleId>
}

/** Validate the persisted Policy style setting. */
export const Config = z.object({
  style: z.union([
    z.const('codex-style'), z.const('claude-style'), z.const('zcode-style'), z.const('superpowers-style'),
  ]).default('codex-style').volatile(),
})
