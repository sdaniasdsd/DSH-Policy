/** Static strategy bindings, task state and host admission interfaces. */
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type { StagePolicy } from './policy-types.ts'
import type { VerificationReport } from './verification-types.ts'
import type { ReviewReport } from './workflow-types.ts'
import type { ObservedUsage } from './types.ts'
import type { AdapterConfig, ExecutionEvent, ExecutionOptions, ExecutionPlan, StrategyInput, TaskResult } from './types.ts'

/** Detached plan data; revision identifies the captured plan contents. */
export interface CapturedStrategy {
  readonly id: string
  readonly revision: string
  readonly policyRevision?: string
  readonly plan: ExecutionPlan
  /** Process-local captured policy; never serialize this callback in session or Job data. */
  readonly next?: StagePolicy
}

/** Task state belongs to the run and survives replacement of its strategy cursor. */
export interface TaskRunView {
  readonly phase: 'queued' | 'boundary' | 'preparing' | 'running' | 'waiting' | 'stopping' | 'completed' | 'failed' | 'cancelled'
  readonly binding: { readonly id: string; readonly revision: string; readonly epoch: number }
  readonly nextStage: number
  readonly completedStages: number
  readonly startedTasks: number
  readonly results: TaskResult[]
  readonly pendingSwitch?: number
  readonly error?: string
  /** Latest artifact check findings, independent of execution completion. */
  readonly verification?: VerificationReport
  readonly review?: ReviewReport
  readonly usage?: ObservedUsage & { readonly unknownChildren: number }
  /** Safe request-time deployment identity; does not claim the original permission rules grant a write. */
  readonly execution?: {
    readonly revision: string
    readonly provider: string
    readonly model?: string
    readonly modelProvider?: string
    readonly permissionAuthority: 'dsh' | 'external-or-mixed'
    readonly maxTasks: number
    readonly maxResultBytes: number
    readonly allowedPresets: readonly string[]
    readonly allowedExecutors: readonly string[]
  }
}

/** Best-effort observations emitted after the corresponding state change. */
export type TaskRunEvent = ExecutionEvent
  | { readonly type: 'switch-pending'; readonly command: number }
  | { readonly type: 'switch-committed'; readonly command: number; readonly strategy: string; readonly revision: string; readonly epoch: number }
  | { readonly type: 'switch-rejected'; readonly command: number; readonly error: string }
  | { readonly type: 'waiting'; readonly error: string }
  | { readonly type: 'terminal'; readonly status: 'completed' | 'failed' | 'cancelled' }

/** Limits are task-wide; preparation must settle after releasing its temporary resources. */
export interface TaskRunOptions extends Pick<ExecutionOptions, 'maxConcurrent' | 'maxTasks' | 'maxResultBytes'> {
  /** Finite synchronous text snapshot for the next stage; original task remains unchanged. */
  readonly additionalContext?: () => string
  /** Check a complete switch target or proposed stage under the captured deployment configuration. */
  readonly prepare: (plan: ExecutionPlan, signal: AbortSignal) => Promise<void>
  readonly onEvent?: (event: TaskRunEvent) => void
}

/** Host submission identity is scoped to the exact live owner Agent. */
export interface TaskSubmission extends StrategyInput {
  readonly requestId: string
  readonly strategy: string
}

/** Acceptance receipt; use original Jobs operations to await or cancel the run. */
export interface TaskReceipt {
  readonly jobId: JobId
  readonly name: string
  readonly strategy: string
  /** Initial autonomous choice; remains unchanged when later stages switch strategies. */
  readonly selection?: { readonly kind: 'auto' | 'fallback'; readonly tier?: 'low' | 'medium' | 'high'; readonly reason: string }
}

/** Switch to a newly captured named plan at the next drained stage boundary. */
export interface TaskSwitch {
  readonly strategy: string
  /** Binding epoch observed by the caller; a mismatch rejects before author evaluation. */
  readonly expectedBindingEpoch: number
  readonly preferences?: Readonly<Record<string, string>>
  /** Zero-based target cursor; omission explicitly means start from stage zero. */
  readonly startStage?: number
}

/** Explicit rules captured by each accepted task; policy selection remains outside the runtime. */
export type TaskRuntimeRules = Pick<AdapterConfig, 'provider' | 'allowedPresets' | 'allowedExecutors' | 'maxConcurrent' | 'maxTasks' | 'maxPlanBytes' | 'maxResultBytes' | 'maxOutputBytes'>
