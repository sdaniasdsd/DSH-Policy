/** Removable Claude Code orchestration policy and task adapter, using the original native provider. */
import type { Context } from '@deepseek-ai/cordis'
import { mountNativeOrchestrator, nativeOrchestratorSchema } from './native-orchestrator.ts'
import type { NativeOrchestratorConfig } from './native-orchestrator.ts'

export const name = 'orchestration-claude'
export const inject = ['taskStrategies', 'taskRuns', 'subagents']
export const Config = nativeOrchestratorSchema({ providerName: 'claude-code', executorId: 'claude-code', strategyId: 'claude-native',
  description: 'Claude Code 原生编排：保留原生工具、上下文和权限流程；内部轮数和工具成本未知。',
  instruction: 'Use your native Claude Code planning and execution loop to complete the task. Follow workspace instructions and native permissions; report changes, verification evidence and unresolved issues.',
})

/**
 * Mount the Claude policy and execution adapter for this plugin's lifetime.
 * @param ctx - Cordis plugin scope.
 * @param config - independently configurable policy and backend identities.
 */
export function apply(ctx: Context, config: NativeOrchestratorConfig): void { mountNativeOrchestrator(ctx, config, { id: 'claude', label: 'Claude' }) }
