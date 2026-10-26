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
/** A model assessment supported by a quoted read observation, not a proof of correctness. */
export interface ReviewFinding { readonly description: string; readonly path: string; readonly excerpt: string }
/** Supported model assessments remain separate from artifact proof. */
export interface ReviewReport { readonly status: 'passed' | 'issues' | 'unverified'; readonly issues: readonly ReviewFinding[] }
