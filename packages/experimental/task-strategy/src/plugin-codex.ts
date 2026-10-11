/** Removable Codex orchestration policy and task adapter, using the original native provider. */
import type { Context } from '@deepseek-ai/cordis'
import { mountNativeOrchestrator, nativeOrchestratorSchema } from './native-orchestrator.ts'
import type { NativeOrchestratorConfig } from './native-orchestrator.ts'

export const name = 'orchestration-codex'
export const inject = ['taskStrategies', 'taskRuns', 'subagents']
export const Config = nativeOrchestratorSchema({ providerName: 'codex', executorId: 'codex', strategyId: 'codex-native',
  description: 'Codex 原生编排：由 Codex 规划、执行与自检；内部轮数和工具成本未知。',
  instruction: 'Use your native Codex planning and execution loop to complete the task. Follow workspace instructions and native permissions; report changes, verification evidence and unresolved issues.',
})

/**
 * Mount the Codex policy and execution adapter for this plugin's lifetime.
 * @param ctx - Cordis plugin scope.
 * @param config - independently configurable policy and backend identities.
 */
export function apply(ctx: Context, config: NativeOrchestratorConfig): void { mountNativeOrchestrator(ctx, config, { id: 'codex', label: 'Codex' }) }
