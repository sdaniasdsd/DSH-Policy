/** Author decisions and executor inputs, independent of Cordis and DSH plugins. */
import type { SelectionConfig } from './selection-types.ts'
import type { PolicySnapshot, StageDecision } from './policy-types.ts'
import type { ArtifactCheck, VerificationReport } from './verification-types.ts'
import type { WorkflowProposal, ReviewReport } from './workflow-types.ts'

/** Supported style orchestration intensity. */
export type StyleTier = 'low' | 'medium' | 'high' | 'extreme-high'
export type { EntryView } from './entry-types.ts'
export type { TaskSwitch } from './runtime-types.ts'

/** Input shared with an author-written decision function. */
export interface StrategyInput {
  /** Nonblank task body; accepted text preserves the caller's whitespace. */
  readonly task: string
  readonly preferences?: Readonly<Record<string, string>>
}

/** One child task's instructions and selected capabilities. */
export interface TaskStep {
  readonly label: string
  readonly preset?: string | undefined
  /** Explicit external adapter; mutually exclusive with native DSH preset selection. */
  readonly executor?: string | undefined
  readonly instruction: string
  readonly tools?: { readonly allow?: string[] | undefined; readonly deny?: string[] | undefined } | undefined
  readonly model?: string | undefined
  readonly provider?: string | undefined
  /** A planner child produces validated workflow data using the original structured output capability. */
  readonly workflowOutput?: boolean
  /** Structured read-only assessment, separate from objective artifact verification. */
  readonly reviewOutput?: boolean
  /** Checks are run in a read-only DSH child; they do not elevate permissions. */
  readonly artifactChecks?: readonly ArtifactCheck[]
  /** Optional bounded model output and child deadline, supplied by validated plugin configuration. */
  readonly maxTokens?: number
  readonly timeoutMs?: number
}

/** Sequential stages, with concurrent children inside each stage. */
export interface ExecutionPlan {
  readonly name: string
  readonly stages: {
    readonly name: string
    /** Explicit serial execution; incompatible with maxConcurrent greater than one. */
    readonly serial?: boolean
    /** Author-selected worker count; omission uses the carrier's default. */
    readonly maxConcurrent?: number
    readonly tasks: TaskStep[]
  }[]
}

/** A trusted, finite synchronous plan decision; asynchronous work belongs to the executor. */
export interface AuthorStrategy {
  readonly id: string
  readonly description: string
  /** Optional author configuration identity; plan revisions remain plan-only. */
  readonly policyRevision?: string
  /** Declarative costing data; absent for an opaque dynamic plan. Never invokes decide. */
  readonly cost?: StrategyCostDeclaration
  decide(input: StrategyInput): ExecutionPlan
  /** Optional stage-boundary decision; decide supplies an admission preview, not an execution cursor. */
  next?(input: StrategyInput, snapshot: PolicySnapshot): StageDecision
}

/** Explicit scenario assumptions, not execution limits or measured usage. */
export interface TokenCostAssumptions {
  /** Expected model calls per child, including its final response. */
  readonly callsPerTask: number
  /** Additional system, tool and within-child history tokens per model call. */
  readonly contextTokensPerCall: number
  /** Expected output per model call; the final response is forwarded between stages. */
  readonly outputTokensPerCall: number
}

/** Static plans used solely for costing without evaluating author code. */
export interface StrategyCostDeclaration {
  readonly plan: ExecutionPlan
  readonly variants?: StrategyDefinition['variants']
  readonly assumptions?: TokenCostAssumptions
  /** Declared scenario including bounded repairs; not a token hard limit. */
  readonly maximumPlan?: ExecutionPlan
}

/** Uncertainty visible to the selector and user; never a billing claim. */
export type TokenCostUnknown = 'task-body' | 'system-and-tools' | 'model-turns' | 'outputs-and-transfer'
  | 'tool-output-variance' | 'reasoning' | 'tokenizer-and-cache' | 'selector-and-parent' | 'result-metadata-variance'

/** Child-cost data excluding parent/selector costs; known input uses the injected text heuristic. */
export type StrategyTokenCost = { readonly kind: 'unknown'; readonly reason: 'dynamic-plan' | 'estimator-unavailable' } | {
  readonly kind: 'estimated'
  readonly basis: 'registration' | 'task'
  readonly planName: string
  readonly tasks: number
  readonly stages: number
  /** Known task/instruction/framing tokens, once per child; excludes unknown prior outputs. */
  readonly knownInputTokens: number
  readonly unknowns: readonly TokenCostUnknown[]
  readonly assumptions?: TokenCostAssumptions
  readonly estimatedInputTokens?: number
  readonly estimatedOutputTokens?: number
  readonly estimatedTotalTokens?: number
  readonly maximumScenarioTokens?: number
  readonly maximumScenarioTasks?: number
}

/** Detached registered-policy description and costing data. */
export interface StrategyCatalogEntry {
  readonly id: string
  readonly description: string
  readonly cost: StrategyTokenCost
}

/** A settled child, after its executor has released all resources. */
export interface ObservedUsage { readonly modelCalls: number; readonly reportedCalls: number; readonly observedTokens: number }

/** Settled child output and bounded typed reports, after its resources have been released. */
export interface ChildResult {
  readonly sessionId?: string
  readonly stopReason: string
  readonly output: string
  /** Provider-owned safe diagnostic; never raw stderr or tool contents. */
  readonly diagnostic?: string
  readonly workflow?: WorkflowProposal
  readonly review?: ReviewReport
  /** Reported usage of logged child assistant messages; excludes router/root and provider-internal retries. */
  readonly usage?: ObservedUsage
  readonly verification?: VerificationReport
}

/** Executor must honor cancellation and resolve only after child cleanup. */
export type TaskExecutor = (task: TaskStep, prompt: string, signal: AbortSignal) => Promise<ChildResult>

/** Child output labelled for later stages and the caller. */
export interface TaskResult extends ChildResult {
  readonly stage: string
  readonly label: string
}

/** Best-effort live progress; observers do not own execution. */
export type ExecutionEvent =
  | { readonly type: 'stage'; readonly stage: string }
  | { readonly type: 'task-start'; readonly stage: string; readonly label: string; readonly preset?: string | undefined; readonly executor?: string | undefined }
  | { readonly type: 'task-end'; readonly stage: string; readonly label: string; readonly stopReason: string; readonly sessionId?: string }

/** Validated per-run limits and caller cancellation. */
export interface ExecutionOptions {
  /** Default worker count for stages without an explicit author choice. */
  readonly maxConcurrent: number
  readonly maxTasks: number
  readonly maxResultBytes: number
  readonly signal: AbortSignal
  readonly onEvent?: (event: ExecutionEvent) => void
}

/** Terminal execution outcome; completed does not mean independently verified. */
export interface ExecutionResult {
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly results: TaskResult[]
  readonly error?: string
}

/** One preference-selected alternative and its optional scenario assumptions. */
export interface StrategyVariant {
  readonly preference: string
  readonly equals: string
  readonly plan: ExecutionPlan
  readonly maximumPlan?: ExecutionPlan
  readonly assumptions?: TokenCostAssumptions
}

/** Declarative author policy with optional preference-selected alternatives. */
export interface StrategyDefinition {
  readonly id: string
  readonly description: string
  readonly plan: ExecutionPlan
  readonly variants?: readonly StrategyVariant[]
  /** Optional scenario assumptions; no hidden output or turn defaults. */
  readonly tokenCost?: TokenCostAssumptions
}

/** DSH carrier configuration; these settings do not alter the plugin registry. */
export interface AdapterConfig {
  readonly entry?: { readonly enabled: boolean }
  readonly selection: SelectionConfig
  readonly provider: string
  readonly toolPrefix: string
  readonly allowedPresets: string[]
  /** Explicit opt-in for external execution adapters; omission permits none. */
  readonly allowedExecutors?: string[] | undefined
  readonly strategies: StrategyDefinition[]
  /** Default worker count; each author stage may supply its own maxConcurrent. */
  readonly maxConcurrent: number
  readonly maxTasks: number
  readonly maxPlanBytes: number
  readonly maxResultBytes: number
  readonly maxOutputBytes: number
}
export type { OrchestrationMode, OrchestrationState } from './entry-types.ts'
