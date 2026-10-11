/** Claude-inspired exploration and review, executed through DSH. */
import type { Context } from '@deepseek-ai/cordis'
import { mountStylePolicy, styleSchema } from './style-policy.ts'
import type { StyleConfig } from './style-policy.ts'
export const name = 'strategy-claude-style'
export const inject = ['taskStrategies']
export const Config = styleSchema('claude')
/** @param ctx - plugin owner. @param config - explicit strategy settings. */
export function apply(ctx: Context, config: StyleConfig): void { mountStylePolicy(ctx, 'claude', config) }
