/** Superpowers-inspired discipline, executed entirely through the DSH task runtime. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from './cordis.ts'
import type {} from './task-runtime-service.ts'
import { createSuperpowersBlackboard, superpowersPolicyRevision } from './superpowers-blackboard.ts'
import type { SuperpowersBlackboardConfig } from './superpowers-blackboard.ts'

export const name = 'strategy-superpowers-style'
export const inject = ['taskStrategies', 'taskRuns']

type ConfigValue = SuperpowersBlackboardConfig
export const Config = z.object({
  strategyId: z.string().default('superpowers-style'),
  description: z.string().default('Superpowers DSH：通过黑板记录计划外问题、组织讨论与裁决，并确认成员采纳。'),
  preset: z.string().default('standard'),
  maxNodes: z.natural().min(1).max(16).default(6),
  maxTokens: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(4096),
  timeoutMs: z.natural().min(1).max(2147483647).default(300000),
  readTools: z.array(z.string()).default(['read', 'glob', 'grep']),
  executorId: z.string().default('superpowers-blackboard'),
  mediumMeetingThreshold: z.natural().min(1).max(100).required(),
  highMeetingThreshold: z.natural().min(1).max(100).required(),
  adjudicationPeriodMs: z.natural().min(1).max(2147483647).required(),
}) as z<Partial<ConfigValue>, ConfigValue>

/** @param ctx - plugin owner. @param config - explicit style and blackboard cadence settings. */
export function apply(ctx: Context, config: ConfigValue): void {
  const captured = structuredClone(config)
  const { plan, executor } = createSuperpowersBlackboard(captured)
  const check = (): void => {
    if (!ctx.taskRuns.listExecutors().some(item => item.id === captured.executorId)) {
      throw new Error('Superpowers blackboard executor is unavailable')
    }
  }
  ctx.taskRuns.registerExecutor(executor)
  ctx.taskStrategies.register({ id: captured.strategyId, description: captured.description,
    policyRevision: superpowersPolicyRevision(captured), decide: () => plan })
  ctx.taskStrategies.registerOrchestration({ id: 'superpowers-style', label: 'Superpowers', strategy: captured.strategyId },
    captured.executorId, check)
}
