/** Superpowers-inspired discipline, executed entirely through the DSH task runtime. */
import type { Context } from '@deepseek-ai/cordis'
import { mountStylePolicy, styleSchema } from './style-policy.ts'
import type { StyleConfig } from './style-policy.ts'

export const name = 'strategy-superpowers-style'
export const inject = ['taskStrategies']
export const Config = styleSchema('superpowers')

/** @param ctx - plugin owner. @param config - explicit strategy settings. */
export function apply(ctx: Context, config: StyleConfig): void { mountStylePolicy(ctx, 'superpowers', config) }
