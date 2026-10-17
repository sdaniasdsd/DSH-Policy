/** Model-produced workflow data is parsed once before the policy consumes it. */
import { z } from 'zod'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { WorkflowProposal, ReviewReport } from './workflow-types.ts'
import type { ReadEvidence } from './verification-types.ts'
import { normalizeReadPath, observedFileText } from './verification.ts'
export type { WorkflowProposal, WorkflowNode, ReviewReport } from './workflow-types.ts'

/** A bounded work node; dependencies identify nodes, never executable host code. */

/** Frozen planning output; artifact checks remain unchanged across repairs. */

const proposalSchema = z.object({
  summary: z.string().trim().min(1).max(4096),
  domain: z.enum(['coding', 'paper-research', 'problem-research', 'solution-planning']),
  nodes: z.array(z.object({ id: z.string().trim().min(1).max(128), instruction: z.string().trim().min(1).max(8192),
    dependencies: z.array(z.string().trim().min(1).max(128)).max(16) })).max(16),
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

/**
 * Validate review data and discard assessments without successful child-owned read evidence.
 * @param value - untrusted provider structured output.
 * @param evidence - exact child-owned original read observations.
 * @param cwd - trusted workspace for lexical path correlation.
 * @returns supported assessment or explicit uncertainty; malformed data throws.
 */
export function parseReviewReport(value: unknown, evidence: readonly ReadEvidence[], cwd?: string,
  requiredPaths: readonly string[] = []): ReviewReport {
  const report = z.object({ status: z.enum(['passed', 'issues', 'unverified']), issues: z.array(z.object({
    description: z.string().trim().min(1).max(4096), path: z.string().min(1).max(4096), excerpt: z.string().min(1).max(4096),
  })).max(16) }).parse(value)
  if ((report.status === 'issues') !== (report.issues.length > 0)) return { status: 'unverified', issues: [] }
  const supported = report.status === 'passed'
    ? requiredPaths.length > 0 && requiredPaths.every((path) => {
      const read = evidence.findLast(row => normalizeReadPath(row.path, cwd) === normalizeReadPath(path, cwd))
      return read !== undefined && !read.isError && observedFileText(read.text).length > 0
    })
    : report.issues.every((issue) => {
      const read = evidence.findLast(row => normalizeReadPath(row.path, cwd) === normalizeReadPath(issue.path, cwd))
      return read !== undefined && !read.isError && observedFileText(read.text).includes(issue.excerpt)
    })
  return supported ? report : { status: 'unverified', issues: [] }
}
