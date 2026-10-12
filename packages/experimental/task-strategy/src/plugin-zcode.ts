/** Removable native ZCode orchestration plugin using its upstream headless CLI. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from './cordis.ts'
import type {} from './task-runtime-service.ts'
import { runZcode } from './zcode-run.ts'
import type { ZcodeRunSpec } from './zcode-run.ts'
import type { ExecutionPlan } from './types.ts'

export const name = 'orchestration-zcode'
export const inject = ['taskStrategies', 'taskRuns', 'subprocess']

/** Native ZCode executable and policy choices; authentication uses explicit env/native config. */
export interface Config extends Omit<ZcodeRunSpec, 'executable'> {
  command: string
  executorId: string
  strategyId: string
  description: string
  instruction: string
}

export const Config: z<Config> = z.object({
  command: z.string().required(), args: z.array(z.string()).default([]), env: z.dict(z.string()).default({}),
  executorId: z.string().default('zcode'), strategyId: z.string().default('zcode-native'),
  description: z.string().default('ZCode 原生编排：保留原生 Agent 与动态工作流；默认 plan 模式，内部轮数和工具成本未知。'),
  instruction: z.string().default('Use native ZCode planning and the configured workflow capability to address the task. Follow native permissions and workspace instructions; distinguish proposed work from executed work and report evidence.'),
  mode: z.union(['plan', 'build', 'edit', 'yolo'].map(value => z.const(value))).default('plan'),
  enableWorkflow: z.boolean().default(true),
  timeoutMs: z.natural().min(1).max(2147483647).default(1800000),
  graceMs: z.natural().min(1).max(2147483647).default(3000),
  maxPromptBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(8192),
  maxOutputBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(1048576),
}) as z<Config>

/**
 * Resolve the configured executable and register a native policy plus task adapter.
 * @param ctx - plugin lifetime and original service handles.
 * @param config - explicit native executable, permissions and resource bounds.
 * @returns settlement after registration; missing executables fail without fallback.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const captured = structuredClone(config)
  for (const value of [captured.command, captured.executorId, captured.strategyId, captured.description, captured.instruction]) {
    if (!value.trim()) throw new Error('ZCode plugin fields must not be empty')
  }
  const subprocess = ctx.subprocess
  const executable = await subprocess.resolveExecutable(captured.command, captured.env)
  const spec: ZcodeRunSpec = { executable, args: captured.args, env: captured.env,
    mode: captured.mode, enableWorkflow: captured.enableWorkflow, timeoutMs: captured.timeoutMs,
    graceMs: captured.graceMs, maxPromptBytes: captured.maxPromptBytes, maxOutputBytes: captured.maxOutputBytes }
  ctx.taskRuns.registerExecutor({ id: captured.executorId, description: captured.description, check: () => {},
    execute: (parent, _step, prompt, signal) => {
      const cwd = parent.session.header.cwd
      if (cwd === undefined) throw new Error('ZCode requires the original task owner workspace')
      return runZcode(subprocess, spec, cwd, prompt, signal)
    },
  })
  const plan: ExecutionPlan = { name: captured.strategyId, stages: [{ name: 'native orchestration', tasks: [
    { label: captured.strategyId, executor: captured.executorId, instruction: captured.instruction },
  ] }] }
  ctx.taskStrategies.register({ id: captured.strategyId, description: captured.description, cost: { plan }, decide: () => plan })
  ctx.taskStrategies.registerOrchestration({ id: 'zcode', label: 'ZCode', strategy: captured.strategyId }, captured.executorId)
}
