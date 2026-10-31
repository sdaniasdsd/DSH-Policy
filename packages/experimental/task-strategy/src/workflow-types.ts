/** Serializable planning and review data; no host parser dependencies. */
import type { ArtifactCheck } from './verification-types.ts'
/** One bounded work node, with dependencies by ID. */
export interface WorkflowNode { readonly id: string; readonly instruction: string; readonly dependencies: readonly string[] }
/** Captured planner requirements remain unchanged throughout a repair cycle. */
export interface WorkflowProposal {
  readonly summary: string
  readonly domain: 'coding' | 'paper-research' | 'problem-research' | 'solution-planning'
  readonly nodes: readonly WorkflowNode[]
  readonly artifacts: readonly ArtifactCheck[]
}
/** Bounded intake decision; blocked requests must stop before planning or execution. */
export interface TaskIntakeAssessment {
  readonly decision: 'proceed' | 'blocked'
  readonly goal: string
  /** Empty when the request is internally consistent. */
  readonly blocker: string
}
/** One user-facing conclusion synthesized only from completed task records. */
export interface TaskConclusion {
  readonly status: 'resolved' | 'partial' | 'unverified' | 'blocked'
  readonly conclusion: string
  readonly evidence: readonly string[]
  /** Empty when there is no blocking issue. */
  readonly blocker: string
  readonly nextStep: string
}
/** A model assessment supported by a quoted read observation, not a proof of correctness. */
export interface ReviewFinding { readonly description: string; readonly path: string; readonly excerpt: string }
/** Supported model assessments remain separate from artifact proof. */
export interface ReviewReport { readonly status: 'passed' | 'issues' | 'unverified'; readonly issues: readonly ReviewFinding[] }
