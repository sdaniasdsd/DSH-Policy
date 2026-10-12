/** Plan admission using captured service handles, independent of the strategy carrier lifetime. */
import type Presets from '@deepseek-ai/dsh-agent-preset-registry'
import type Subagents from '@deepseek-ai/dsh-subagent'
import type Tools from '@deepseek-ai/dsh-tools'
import { validatePlan } from './executor.ts'
import type { ExecutionPlan, TaskStep } from './types.ts'
import type { TaskRuntimeRules } from './runtime-types.ts'
import type { ExecutorRegistry } from './executor-registry.ts'

/** Captured plan limits and child capability checks share the same deployment rules. */
export interface PlanAdmission {
  /**
   * Admit a complete plan or stage and release temporary leases.
   * @param plan - detached execution choices.
   * @param signal - cancellation for preparation.
   * @returns settlement after capability checks and lease release.
   */
  readonly prepare: (plan: ExecutionPlan, signal: AbortSignal) => Promise<void>
  /**
   * Recheck a child's selected capabilities without constructing another plan.
   * @param step - task from an admitted stage.
   * @param signal - cancellation for child admission.
   * @returns settlement after capability checks and lease release.
   */
  readonly checkChild: (step: TaskStep, signal: AbortSignal) => Promise<void>
}

/**
 * Capture deployment rules and exact service handles for plan admission.
 * @param config - deployment limits and authorized preset names.
 * @param subagents - provider registry retained by accepted Jobs.
 * @param presets - original preset service.
 * @param tools - original scoped tool registry.
 * @param executors - optional registry of external adapters authorized by captured rules.
 * @returns asynchronous admission that releases temporary preset leases before settling.
 */
export function createAdmission(
  config: TaskRuntimeRules, subagents: Subagents, presets: Presets, tools: Tools, executors?: ExecutorRegistry,
): PlanAdmission {
  const captured = structuredClone(config)
  const checkSteps = async (steps: readonly TaskStep[], signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    const nativeSteps: TaskStep[] = []
    for (const step of steps) {
      if (step.executor === undefined) nativeSteps.push(step)
      else {
        if (executors === undefined) throw new Error(`Unknown task executor: ${step.executor}`)
        executors.resolve(step, captured.allowedExecutors ?? [])
      }
    }
    if (nativeSteps.length === 0) return
    const { allowedPresets } = captured
    const provider = subagents.getProvider(captured.provider)
    if (provider?.capabilities.agentPreset !== true) throw new Error('Strategy executor requires a preset-selecting subagent provider')
    const names = new Set<string>()
    for (const step of nativeSteps) {
      if (step.preset === undefined || !allowedPresets.includes(step.preset)) throw new Error(`Strategy preset is not allowed: ${step.preset}`)
      if (step.tools !== undefined && !provider.capabilities.toolFilter) throw new Error('Strategy provider does not support tool restrictions')
      if ((step.workflowOutput === true || step.reviewOutput === true) && !provider.capabilities.outputSchema) throw new Error('Strategy provider does not support structured workflow output')
      if (step.workflowOutput === true && step.reviewOutput === true) throw new Error('A child cannot produce both a plan and a review')
      if (step.reviewOutput === true && (step.tools?.allow === undefined || step.tools.allow.some(name => !['read', 'glob', 'grep'].includes(name)))) {
        throw new Error('Workflow review requires original read-only tools')
      }
      if (step.artifactChecks !== undefined && (step.tools?.allow?.length !== 1 || step.tools.allow[0] !== 'read' || step.tools.deny?.includes('read'))) {
        throw new Error('Artifact verification requires a read-only tool filter')
      }
      if ((step.model !== undefined || step.provider !== undefined || step.maxTokens !== undefined
        || step.workflowOutput === true || step.reviewOutput === true) && !provider.capabilities.agentOptions) {
        throw new Error('Strategy provider does not support model selection')
      }
      for (const [key, value] of Object.entries({ maxTokens: step.maxTokens, timeoutMs: step.timeoutMs })) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0 || key === 'timeoutMs' && value > 2147483647)) {
          throw new Error(`Strategy ${key} must be a bounded positive safe integer`)
        }
      }
      names.add(step.preset)
    }
    for (const name of names) {
      signal.throwIfAborted()
      const preset = await presets.resolve(name)
      signal.throwIfAborted()
      if (preset.broken !== undefined) throw new Error(`Invalid strategy preset ${name}: ${preset.broken}`)
      const filters = nativeSteps.flatMap(step => (
        step.preset === name && step.tools !== undefined ? [{ label: step.label, filter: step.tools }] : []
      ))
      if (filters.length === 0) continue
      await using lease = await presets.acquireScope(name)
      signal.throwIfAborted()
      const known = new Set(tools.schemas(lease.key).map(tool => tool.name))
      for (const { label, filter } of filters) {
        const { allow, deny } = filter
        if (allow === undefined && deny === undefined) throw new Error(`Empty tool filter for task ${label}`)
        for (const tool of [...allow ?? [], ...deny ?? []]) {
          if (tool === 'run_code' || !known.has(tool)) throw new Error(`Invalid strategy tool ${tool} for preset ${name}`)
        }
      }
    }
  }
  return {
    prepare: async (plan, signal) => {
      signal.throwIfAborted()
      const { maxConcurrent, maxTasks, maxResultBytes, maxPlanBytes } = captured
      validatePlan(plan, { maxConcurrent, maxTasks, maxResultBytes })
      if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > maxPlanBytes) throw new Error(`Execution plan exceeds byte limit ${maxPlanBytes}`)
      await checkSteps(plan.stages.flatMap(stage => stage.tasks), signal)
    },
    checkChild: (step, signal) => checkSteps([step], signal),
  }
}
