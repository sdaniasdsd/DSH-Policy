/** Independent author strategy registry. Cordis integration lives in ./cordis.ts. */
// The type import keeps the carrier separately loadable while exposing its optional service in API projections.
import type TaskStrategies from './cordis.ts'
import type { AuthorStrategy, ExecutionPlan, StrategyInput, StrategyCatalogEntry, StrategyTokenCost, TokenCostAssumptions } from './types.ts'
import { estimatePlanCost } from './cost.ts'
import { validateTask } from './task-input.ts'
import { captureStrategy } from './static-plan.ts'
import type { CapturedStrategy } from './runtime-types.ts'

function attachMaximum(cost: StrategyTokenCost, plan: ExecutionPlan | undefined, task: string,
  measure: (text: string) => number, assumptions: TokenCostAssumptions | undefined): StrategyTokenCost {
  if (cost.kind !== 'estimated' || plan === undefined) return cost
  const maximum = estimatePlanCost(plan, task, cost.basis, measure, assumptions)
  return maximum.kind !== 'estimated' ? cost : { ...cost, maximumScenarioTasks: maximum.tasks,
    ...maximum.estimatedTotalTokens === undefined ? {} : { maximumScenarioTokens: maximum.estimatedTotalTokens } }
}

declare module '@deepseek-ai/cordis' {
  interface Context { taskStrategies: TaskStrategies }
}
export type * from './types.ts'
export type * from './runtime-types.ts'
export type * from './selection-types.ts'
export type * from './entry-types.ts'
export type * from './policy-types.ts'
export type * from './verification-types.ts'
export type * from './workflow-types.ts'
export { captureStrategy } from './static-plan.ts'
export { TaskRun } from './task-run.ts'
export { executePlan, validatePlan } from './executor.ts'
export { estimatePlanCost } from './cost.ts'

/** Names author decisions without modifying DSH's plugin registry. */
export class StrategyRegistry {
  private readonly strategies = new Map<string, AuthorStrategy & { baseline: StrategyTokenCost }>()

  /** @param measure - optional owner-supplied estimator; absent costing is reported as unknown. */
  constructor(private readonly measure?: (text: string) => number) {}

  /**
   * Register an author decision, rejecting empty or duplicate names.
   * @param strategy - author-owned decision function.
   * @returns idempotent disposer for this registration only.
   */
  register(strategy: AuthorStrategy): () => void {
    if (!strategy.id.trim()) throw new Error('Strategy id must not be empty')
    if (this.strategies.has(strategy.id)) throw new Error(`Duplicate strategy: ${strategy.id}`)
    const cost = strategy.cost === undefined ? undefined : structuredClone(strategy.cost)
    const baseline: StrategyTokenCost = cost === undefined ? { kind: 'unknown', reason: 'dynamic-plan' }
      : this.measure === undefined ? { kind: 'unknown', reason: 'estimator-unavailable' }
        : attachMaximum(estimatePlanCost(cost.plan, '', 'registration', this.measure, cost.assumptions), cost.maximumPlan, '', this.measure, cost.assumptions)
    // Validate every declared alternative during registration, without calling author code.
    if (cost !== undefined && this.measure !== undefined) {
      for (const variant of cost.variants ?? []) attachMaximum(estimatePlanCost(variant.plan, '', 'registration', this.measure, variant.assumptions ?? cost.assumptions),
        variant.maximumPlan, '', this.measure, variant.assumptions ?? cost.assumptions)
    }
    const registered = { id: strategy.id, description: strategy.description, decide: strategy.decide.bind(strategy),
      ...strategy.policyRevision === undefined ? {} : { policyRevision: strategy.policyRevision },
      ...strategy.next === undefined ? {} : { next: strategy.next.bind(strategy) },
      ...cost === undefined ? {} : { cost }, baseline }
    this.strategies.set(strategy.id, registered)
    return () => {
      if (this.strategies.get(registered.id) === registered) this.strategies.delete(registered.id)
    }
  }

  /**
   * List author policies without invoking their decision functions.
   * @param input - optional task and preferences for refining registered estimates.
   * @returns detached descriptions and estimates; never invokes author decisions.
   */
  list(input?: StrategyInput): StrategyCatalogEntry[] {
    return [...this.strategies.values()].map((strategy) => {
      const { id, description } = strategy
      const declaration = strategy.cost
      if (input === undefined || declaration === undefined || this.measure === undefined) {
        return { id, description, cost: structuredClone(strategy.baseline) }
      }
      const variant = declaration.variants?.find(variant => input.preferences?.[variant.preference] === variant.equals)
      const plan = variant?.plan ?? declaration.plan
      const assumptions = variant?.assumptions ?? declaration.assumptions
      return { id, description, cost: attachMaximum(estimatePlanCost(plan, input.task, 'task', this.measure, assumptions),
        variant?.maximumPlan ?? declaration.maximumPlan, input.task, this.measure, assumptions) }
    })
  }

  /**
   * Decide synchronously with detached input and output; reject blank task text before invoking the author.
   * @param id - registered strategy name.
   * @param input - task and author preferences.
   * @returns a detached execution plan; rejects unknown strategies and author errors.
   */
  decide(id: string, input: StrategyInput): ExecutionPlan {
    validateTask(input.task)
    const strategy = this.strategies.get(id)
    if (strategy === undefined) throw new Error(`Unknown strategy: ${id}`)
    return structuredClone(strategy.decide(structuredClone(input)))
  }

  /**
   * Capture a registration and input before asynchronous admission or plugin unload.
   * @param id - currently registered policy identity.
   * @param input - original task and selected preferences.
   * @returns detached preview and a finite synchronous stage callback when supplied.
   */
  capture(id: string, input: StrategyInput): CapturedStrategy {
    validateTask(input.task)
    const strategy = this.strategies.get(id)
    if (strategy === undefined) throw new Error(`Unknown strategy: ${id}`)
    const capturedInput = structuredClone(input)
    const captured = captureStrategy(id, strategy.decide(structuredClone(capturedInput)))
    const next = strategy.next?.bind(strategy)
    return {
      ...captured,
      ...strategy.policyRevision === undefined ? {} : { policyRevision: strategy.policyRevision },
      ...next === undefined
        ? {}
        : { next: snapshot => structuredClone(next(structuredClone(capturedInput), structuredClone(snapshot))) },
    }
  }
}

export type * from './executor-types.ts'
