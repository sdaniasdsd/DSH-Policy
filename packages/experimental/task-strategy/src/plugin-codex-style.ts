/** Codex-inspired incremental orchestration, executed through DSH. */
import type { Context } from '@deepseek-ai/cordis'
import { mountStylePolicy, styleSchema } from './style-policy.ts'
import type { StyleConfig } from './style-policy.ts'
export const name = 'strategy-codex-style'
export const inject = ['taskStrategies']
export const Config = styleSchema('codex')
/** @param ctx - plugin owner. @param config - explicit strategy settings. */
export function apply(ctx: Context, config: StyleConfig): void { mountStylePolicy(ctx, 'codex', config) }
