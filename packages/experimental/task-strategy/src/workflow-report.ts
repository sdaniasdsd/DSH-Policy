/** Model-produced workflow data is parsed once before the policy consumes it. */
import { z } from 'zod'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { WorkflowProposal, ReviewReport, TaskIntakeAssessment, TaskConclusion } from './workflow-types.ts'
import type { ReadEvidence } from './verification-types.ts'
import { normalizeReadPath, observedFileText } from './verification.ts'
export type { WorkflowProposal, WorkflowNode, ReviewReport } from './workflow-types.ts'
export type { TaskIntakeAssessment, TaskConclusion } from './workflow-types.ts'

/** A bounded work node; dependencies identify nodes, never executable host code. */

/** Frozen planning output; artifact checks remain unchanged across repairs. */

const proposalSchema = z.object({
  summary: z.string().trim().min(1).max(4096),
  domain: z.enum(['coding', 'paper-research', 'problem-research', 'solution-planning']),
  nodes: z.array(z.object({ id: z.string().trim().min(1).max(128), instruction: z.string().trim().min(1).max(8192),
    dependencies: z.array(z.string().trim().min(1).max(128)).max(16) })).min(1).max(16),
  artifacts: z.array(z.object({ id: z.string().trim().min(1).max(128), path: z.string().trim().min(1).max(4096),
    contains: z.string().min(1).max(4096).optional() })).max(16),
})

/** JSON schema advertised only to the ordinary DSH planner child. */
export const workflowOutputSchema: ObjectJsonSchema = {
  type: 'object', properties: {
    summary: { type: 'string' }, domain: { type: 'string', enum: ['coding', 'paper-research', 'problem-research', 'solution-planning'] },
    nodes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, instruction: { type: 'string' },
      dependencies: { type: 'array', items: { type: 'string' } } }, required: ['id', 'instruction', 'dependencies'], additionalProperties: false } },
    artifacts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' },
      contains: { type: 'string', description: 'A literal substring of the requested file content, never prose describing a requirement. Omit for existence-only checks. Line-based read cannot prove bytes, encoding or trailing newline.' } }, required: ['id', 'path'], additionalProperties: false } },
  }, required: ['summary', 'domain', 'nodes', 'artifacts'], additionalProperties: false,
}

/**
 * Parse untrusted planning data and reject invalid references and dependency cycles.
 * @param value - provider-returned structured output.
 * @returns validated workflow proposal; no implicit omission or repair of malformed nodes.
 */
export function parseWorkflowProposal(value: unknown): WorkflowProposal {
  const proposal = proposalSchema.parse(value)
  const ids = new Set(proposal.nodes.map(node => node.id))
  if (ids.size !== proposal.nodes.length) throw new Error('Planner returned duplicate node IDs')
  if (new Set(proposal.artifacts.map(check => check.id)).size !== proposal.artifacts.length) throw new Error('Planner returned duplicate check IDs')
  const settled = new Set<string>()
  while (settled.size < ids.size) {
    const ready = proposal.nodes.filter(node => !settled.has(node.id) && node.dependencies.every(id => settled.has(id)))
    if (ready.length === 0) throw new Error('Planner returned missing or cyclic dependencies')
    for (const node of ready) settled.add(node.id)
  }
  return proposal
}

/** Read-only model assessment schema; findings must cite actual observed file content. */
export const reviewOutputSchema: ObjectJsonSchema = {
  type: 'object', properties: { status: { type: 'string', enum: ['passed', 'issues', 'unverified'] },
    issues: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' },
      path: { type: 'string' }, excerpt: { type: 'string' } }, required: ['description', 'path', 'excerpt'], additionalProperties: false } } },
  required: ['status', 'issues'], additionalProperties: false,
}

/** Bounded preflight schema; blocked assessment carries one actionable conflict. */
export const intakeOutputSchema: ObjectJsonSchema = {
  type: 'object', properties: {
    decision: { type: 'string', enum: ['proceed', 'blocked'] },
    goal: { type: 'string', description: 'One sentence stating the requested outcome, limited to 300 characters.' },
    blocker: { type: 'string', description: 'Empty when proceeding; one decisive conflict when blocked, limited to 500 characters.' },
  }, required: ['decision', 'goal', 'blocker'], additionalProperties: false,
}

/** Bounded user-facing conclusion; evidence is capped at three items. */
export const finalSummaryOutputSchema: ObjectJsonSchema = {
  type: 'object', properties: {
    status: { type: 'string', enum: ['resolved', 'partial', 'unverified', 'blocked'] },
    conclusion: { type: 'string', description: 'One concise answer to the user’s main request, limited to 500 characters.' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'At most three decisive facts from retained task results; each limited to 240 characters.' },
    blocker: { type: 'string', description: 'Empty when there is no blocker; otherwise state the most important one, limited to 500 characters.' },
    nextStep: { type: 'string', description: 'One concrete next action, or empty when none is needed, limited to 300 characters.' },
  }, required: ['status', 'conclusion', 'evidence', 'blocker', 'nextStep'], additionalProperties: false,
}

/** Validate the preflight result before the strategy decides whether planning may start. */
export function parseTaskIntakeAssessment(value: unknown): TaskIntakeAssessment {
  const assessment = z.object({ decision: z.enum(['proceed', 'blocked']), goal: z.string().trim().min(1).max(300),
    blocker: z.string().trim().max(500) }).strict().parse(value)
  if (assessment.decision === 'blocked' && assessment.blocker.length === 0) throw new Error('Blocked intake must name its conflict')
  if (assessment.decision === 'proceed' && assessment.blocker.length > 0) throw new Error('Proceeding intake cannot retain a blocker')
  return assessment
}

/** Validate one concise conclusion and its evidence ceiling. */
export function parseTaskConclusion(value: unknown): TaskConclusion {
  const conclusion = z.object({ status: z.enum(['resolved', 'partial', 'unverified', 'blocked']),
    conclusion: z.string().trim().min(1).max(500), evidence: z.array(z.string().trim().min(1).max(240)).max(3),
    blocker: z.string().trim().max(500), nextStep: z.string().trim().max(300) }).strict().parse(value)
  if (conclusion.status === 'blocked' && conclusion.blocker.length === 0) throw new Error('Blocked conclusion must name its blocker')
  return conclusion
}

/**
 * Validate review data and discard assessments without successful child-owned read evidence.
 * @param value - untrusted provider structured output.
 * @param evidence - exact child-owned original read observations.
 * @param cwd - trusted workspace for lexical path correlation.
 * @returns supported assessment or explicit uncertainty; malformed data throws.
 */
export function parseReviewReport(value: unknown, evidence: readonly ReadEvidence[], cwd?: string): ReviewReport {
  const report = z.object({ status: z.enum(['passed', 'issues', 'unverified']), issues: z.array(z.object({
    description: z.string().trim().min(1).max(4096), path: z.string().min(1).max(4096), excerpt: z.string().min(1).max(4096),
  })).max(16) }).parse(value)
  if ((report.status === 'issues') !== (report.issues.length > 0)) return { status: 'unverified', issues: [] }
  const supported = evidence.some(row => !row.isError && observedFileText(row.text).length > 0)
    && report.issues.every((issue) => {
      const read = evidence.findLast(row => normalizeReadPath(row.path, cwd) === normalizeReadPath(issue.path, cwd))
      return read !== undefined && !read.isError && observedFileText(read.text).includes(issue.excerpt)
    })
  return supported ? report : { status: 'unverified', issues: [] }
}
