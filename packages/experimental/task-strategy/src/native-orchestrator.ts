import { startCancellableActivation } from './subagent-activation.ts'
/** Shared registration for native harness orchestration plugins. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from './cordis.ts'
import type {} from './task-runtime-service.ts'
import type { ExecutionPlan, TokenCostAssumptions } from './types.ts'

/** Plugin-owned policy and backend identities; native backend configuration remains separate. */
export interface NativeOrchestratorConfig {
  providerName: string
  executorId: string
  strategyId: string
  description: string
  instruction: string
  tokenCost?: TokenCostAssumptions | undefined
}

/**
 * Create independently editable orchestration configuration.
 * @param defaults - product plugin defaults, outside the common runtime.
 * @returns validated Cordis configuration schema.
 */
export function nativeOrchestratorSchema(defaults: Omit<NativeOrchestratorConfig, 'tokenCost'>): z<NativeOrchestratorConfig> {
  return z.object({
    providerName: z.string().default(defaults.providerName), executorId: z.string().default(defaults.executorId),
    strategyId: z.string().default(defaults.strategyId), description: z.string().default(defaults.description),
    instruction: z.string().default(defaults.instruction),
    tokenCost: z.union([z.const(undefined), z.object({
      callsPerTask: z.natural().min(1).required(), contextTokensPerCall: z.natural().required(),
      outputTokensPerCall: z.natural().required(),
    })]),
  })
}

/**
 * Register native orchestration using an existing original Subagents provider.
 * @param ctx - plugin-scoped registration owner.
 * @param config - explicit policy and backend identities.
 * @param mode - plugin-owned composer identity.
 */
export function mountNativeOrchestrator(ctx: Context, config: NativeOrchestratorConfig, mode: { id: string; label: string }): void {
  const captured = structuredClone(config)
  for (const value of [captured.providerName, captured.executorId, captured.strategyId, captured.description, captured.instruction]) {
    if (!value.trim()) throw new Error('Orchestration plugin fields must not be empty')
  }
  const subagents = ctx.subagents
  const check = (): void => {
    if (subagents.getProvider(captured.providerName) === undefined) throw new Error(`Native orchestration backend is unavailable: ${captured.providerName}`)
  }
  // Resolve the configured backend before advertising a selectable policy.
  check()
  ctx.taskRuns.registerExecutor({ id: captured.executorId, description: captured.description, check,
    execute: async (parent, step, prompt, signal) => {
      const run = await startCancellableActivation(subagents, { provider: captured.providerName, label: step.label, signal, delivery: 'caller', request: {
        parent, prompt: [{ type: 'text', text: prompt }],
      } })
      try {
        const result = await run.result
        return { sessionId: run.childId, stopReason: result.stopReason,
          ...result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic },
          output: result.output.filter(block => block.type === 'text').map(block => block.text).join('\n') }
      } finally { await run.dispose() }
    },
  })
  const plan: ExecutionPlan = { name: captured.strategyId, stages: [{ name: 'native orchestration', tasks: [
    { label: captured.strategyId, executor: captured.executorId, instruction: captured.instruction },
  ] }] }
  ctx.taskStrategies.register({ id: captured.strategyId, description: captured.description,
    cost: { plan, ...captured.tokenCost === undefined ? {} : { assumptions: captured.tokenCost } },
    decide: () => plan,
  })
  ctx.taskStrategies.registerOrchestration({ ...mode, strategy: captured.strategyId }, captured.executorId, check)
}
