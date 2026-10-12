import { startCancellableActivation } from './subagent-activation.ts'
/** Cancellable DSH execution and child-correlated read evidence collection. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivation, SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { ChildResult, TaskStep, ObservedUsage } from './types.ts'
import { parseWorkflowProposal, workflowOutputSchema, parseReviewReport, reviewOutputSchema } from './workflow-report.ts'
import { normalizeReadPath, verifyArtifacts } from './verification.ts'
import type { ReadEvidence } from './verification.ts'
import { selectorAgentOptions } from './selector-agent-options.ts'

function readPath(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || !('file_path' in value) || typeof value.file_path !== 'string') return undefined
  return value.file_path
}

/**
 * Execute one preset task through original Subagents and capture only its actual read observations.
 * @param ctx - captured runtime services; never an author plugin's mutable state.
 * @param parent - original live task owner.
 * @param provider - admitted DSH provider.
 * @param step - detached admitted task, including optional checks and output limits.
 * @param prompt - task and prior results already admitted by the runtime.
 * @param signal - original task cancellation.
 * @param maxEvidenceBytes - cumulative evidence memory bound.
 * @param onActive - optional task-owned registration, released after child cleanup even when cleanup fails.
 * @param activate - optional task-owned turn admission using the same observation and cleanup path.
 * @returns settled child result after temporary listeners, timer and child have been released.
 */
export async function executeDshChild(ctx: Pick<Context, 'on' | 'get'> & { subagents: Pick<Context['subagents'], 'startActivation'> }, parent: Agent, provider: string, step: TaskStep,
  prompt: string, signal: AbortSignal, maxEvidenceBytes: number, onActive?: (id: SessionId) => () => void,
  activate?: (spec: SubagentActivationSpec) => Promise<SubagentActivation>): Promise<ChildResult> {
  const deadline = new AbortController()
  const combined = AbortSignal.any([signal, deadline.signal])
  const timer = step.timeoutMs === undefined ? undefined
    : setTimeout(() => { deadline.abort(new Error('Strategy child deadline exceeded')) }, step.timeoutMs)
  const observations = new Map<SessionId, Map<string, ReadEvidence>>()
  const calls = new Map<SessionId, Map<string, string>>()
  const usages = new Map<SessionId, ObservedUsage>()
  const cwd = ctx.get('workingDirectory')?.get(parent.session) ?? parent.session.header.cwd
  const bytes = new Map<SessionId, number>()
  const overflow = new Set<SessionId>()
  const acceptsPath = (path: string) => step.reviewOutput === true
    || step.artifactChecks?.some(check => normalizeReadPath(check.path, cwd) === normalizeReadPath(path, cwd)) === true
  const recordRead = (id: SessionId, args: unknown, isError: boolean, text: string) => {
    const path = readPath(args)
    if (path === undefined || overflow.has(id) || !acceptsPath(path)) return
    const count = (bytes.get(id) ?? 0) + Buffer.byteLength(text, 'utf8') + Buffer.byteLength(path, 'utf8')
    bytes.set(id, count)
    if (count > maxEvidenceBytes) { overflow.add(id); observations.delete(id); calls.delete(id); return }
    const reads = observations.get(id) ?? new Map<string, ReadEvidence>()
    reads.set(normalizeReadPath(path, cwd), { path, isError, text }); observations.set(id, reads)
  }
  // Install before start: a fast child may log tools before start resolves its handle.
  const release = ctx.on('session/event', (session, event) => {
    if (session.header.parentSession !== parent.id) return
    if (event.type === 'assistant/message') {
      const prior = usages.get(session.id) ?? { modelCalls: 0, reportedCalls: 0, observedTokens: 0 }
      const usage = event.data.usage
      const total = usage?.totalTokens ?? (usage === undefined ? undefined : usage.inputTokens + usage.outputTokens
        + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0))
      const valid = total !== undefined && Number.isSafeInteger(total) && total >= 0
      usages.set(session.id, { modelCalls: prior.modelCalls + 1, reportedCalls: prior.reportedCalls + (valid ? 1 : 0),
        observedTokens: prior.observedTokens + (valid ? total : 0) })
      return
    }
    if (overflow.has(session.id) || step.artifactChecks === undefined && step.reviewOutput !== true) return
    if (event.type === 'tool/call' && event.data.name === 'read') {
      let args: unknown
      try { args = JSON.parse(event.data.arguments) }
      catch (error) { void error; return }
      const path = readPath(args)
      if (path === undefined || !acceptsPath(path)) return
      const entries = calls.get(session.id) ?? new Map<string, string>()
      entries.set(event.data.callId, path); calls.set(session.id, entries)
    } else if (event.type === 'tool/result') {
      const path = calls.get(session.id)?.get(event.data.message.toolCallId)
      if (path === undefined) return
      calls.get(session.id)?.delete(event.data.message.toolCallId)
      recordRead(session.id, { file_path: path }, event.data.message.isError === true,
        event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
    } else if (event.type === 'tool/ptc-dispatch' && event.data.name === 'read') {
      recordRead(session.id, event.data.arguments, event.data.isError,
        event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
    }
  })
  try {
    const agentOptions = (step.workflowOutput === true || step.reviewOutput === true) && step.maxTokens !== undefined
      ? await selectorAgentOptions(parent, { maxTokens: step.maxTokens,
        ...step.model === undefined ? {} : { model: step.model },
        ...step.provider === undefined ? {} : { provider: step.provider } }, combined)
      : { ...step.model === undefined ? {} : { model: step.model },
        ...step.provider === undefined ? {} : { provider: step.provider },
        ...step.maxTokens === undefined ? {} : { maxTokens: step.maxTokens } }
    const start = activate ?? ((spec: SubagentActivationSpec) => startCancellableActivation(ctx.subagents, spec))
    const run = await start({ provider, label: step.label, signal: combined, delivery: 'caller', request: {
      parent, prompt: [{ type: 'text', text: prompt }],
      ...step.preset === undefined ? {} : { agentPreset: step.preset },
      ...step.tools === undefined ? {} : { toolFilter: {
        ...step.tools.allow === undefined ? {} : { allow: step.tools.allow },
        ...step.tools.deny === undefined ? {} : { deny: step.tools.deny } } },
      ...Object.keys(agentOptions).length === 0 ? {} : { agentOptions },
      ...step.workflowOutput === true ? { outputSchema: workflowOutputSchema }
        : step.reviewOutput === true ? { outputSchema: reviewOutputSchema } : {},
    } })
    let releaseMember: (() => void) | undefined
    try {
      releaseMember = onActive?.(run.childId)
      const result = await run.result
      return { sessionId: run.childId, stopReason: result.stopReason,
        usage: usages.get(run.childId) ?? { modelCalls: 0, reportedCalls: 0, observedTokens: 0 },
        output: result.output.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        ...result.diagnostic === undefined ? {} : { diagnostic: result.diagnostic },
        ...step.workflowOutput !== true || result.stopReason !== 'completed' ? {}
          : { workflow: parseWorkflowProposal(result.structured) },
        ...step.reviewOutput !== true || result.stopReason !== 'completed' ? {} : {
          review: parseReviewReport(result.structured,
            overflow.has(run.childId) ? [] : [...observations.get(run.childId)?.values() ?? []], cwd) },
        ...step.artifactChecks === undefined ? {} : {
          verification: verifyArtifacts(step.artifactChecks,
            overflow.has(run.childId) ? [] : [...observations.get(run.childId)?.values() ?? []], cwd) },
      }
    } finally { try { await run.dispose() } finally { releaseMember?.() } }
  } finally { if (timer !== undefined) clearTimeout(timer); release() }
}
