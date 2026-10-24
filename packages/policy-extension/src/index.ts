/** Host plugin entry for the Policy extension Bundle. */
import type { Context } from '@deepseek-ai/cordis'
import { registerPolicyHost } from './host-entry.ts'

export { POLICY_COMPATIBILITY, type PolicyCompatibility } from './compatibility.ts'
export { TaskRun } from './task-runtime/task-run.ts'
export { createWorkflowExecutor } from './workflow-executor.ts'
export { StrategyRegistry } from './task-runtime/strategy-registry.ts'
export { captureStrategy } from './task-runtime/static-plan.ts'
export { executePlan, validatePlan } from './task-runtime/executor.ts'
export { estimatePlanCost } from './task-runtime/cost.ts'
export type * from './task-runtime/types.ts'
export type * from './task-runtime/runtime-types.ts'
export type * from './task-runtime/policy-types.ts'
export type * from './task-runtime/capacity-types.ts'
export type * from './task-runtime/verification-types.ts'
export type * from './task-runtime/workflow-types.ts'

/**
 * Register the model-facing task entry once the official services are available.
 * @param _ctx - official profile plugin context.
 */
export function apply(ctx: Context): void { registerPolicyHost(ctx) }
