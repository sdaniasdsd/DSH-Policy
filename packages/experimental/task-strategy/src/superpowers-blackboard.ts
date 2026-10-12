/** Superpowers-only blackboard workflow over DSH task coordination primitives. */
import { createHash } from 'node:crypto'
import type { TaskExecutorProvider } from './executor-types.ts'
import type { TaskMemberTurnOutcome } from './member-session-types.ts'
import type { TaskCoordination, TaskSharedRecord } from './coordination-types.ts'
import type { ExecutionPlan, TaskStep } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface SuperpowersBlackboardConfig {
  readonly strategyId: string
  readonly description: string
  readonly preset: string
  readonly maxNodes: number
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly readTools: string[]
  readonly executorId: string
  readonly mediumMeetingThreshold: number
  readonly highMeetingThreshold: number
  readonly adjudicationPeriodMs: number
}

interface PlannedTask { readonly id: string; readonly instruction: string }
interface LeadPlan { readonly done: boolean; readonly tasks: readonly PlannedTask[] }
interface ReportedProblem {
  readonly title: string
  readonly description: string
  readonly risk: 'low' | 'medium' | 'high'
  readonly evidence: string
  readonly action: string
  readonly status: 'resolved' | 'open'
}
interface WorkReport { readonly summary: string; readonly problems: readonly ReportedProblem[] }
interface IssueRow extends ReportedProblem { readonly taskId: string; readonly sessionId: SessionId }
interface LeadDecision { readonly issueKey: string; readonly decision: string; readonly rationale: string }
interface MeetingResult { readonly decisions: readonly LeadDecision[]; readonly summary: string }
interface AdoptionReport { readonly adopted: boolean; readonly summary: string; readonly nextAction: string }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseObject(output: string, label: string): Record<string, unknown> {
  const text = output.trim()
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`${label} did not return a JSON object`)
  let value: unknown
  try { value = JSON.parse(text.slice(start, end + 1)) }
  catch { throw new Error(`${label} returned invalid JSON`) }
  if (!object(value)) throw new Error(`${label} returned a non-object value`)
  return value
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be nonempty text`)
  return value
}

function settled(outcome: TaskMemberTurnOutcome, label: string): string {
  if (outcome.kind === 'unobserved') throw new Error(`${label} result was accepted but not observed: ${outcome.error}`)
  if (outcome.result.stopReason !== 'completed') throw new Error(`${label} ended with ${outcome.result.stopReason}`)
  return outcome.result.output
}

function parsePlan(output: string, maxNodes: number): LeadPlan {
  const value = parseObject(output, 'Superpowers planner')
  if (typeof value.done !== 'boolean' || !Array.isArray(value.tasks) || value.tasks.length > maxNodes) {
    throw new Error('Superpowers planner returned an invalid or oversized task list')
  }
  const tasks = value.tasks.map((raw, index): PlannedTask => {
    if (!object(raw)) throw new Error(`Superpowers task ${index + 1} must be an object`)
    return { id: requiredText(raw.id, `Superpowers task ${index + 1} id`),
      instruction: requiredText(raw.instruction, `Superpowers task ${index + 1} instruction`) }
  })
  if (!value.done && tasks.length === 0) throw new Error('Superpowers planner made no progress')
  return { done: value.done, tasks }
}

function parseWorkReport(output: string): WorkReport {
  const value = parseObject(output, 'Superpowers work member')
  if (!Array.isArray(value.problems)) throw new Error('Superpowers work report must include problems')
  const problems = value.problems.map((raw, index): ReportedProblem => {
    if (!object(raw) || !['low', 'medium', 'high'].includes(String(raw.risk))
      || !['resolved', 'open'].includes(String(raw.status))) throw new Error(`Superpowers problem ${index + 1} is invalid`)
    const risk = raw.risk as ReportedProblem['risk']
    return {
      title: requiredText(raw.title, `Problem ${index + 1} title`),
      description: requiredText(raw.description, `Problem ${index + 1} description`),
      risk,
      evidence: requiredText(raw.evidence, `Problem ${index + 1} evidence`),
      action: requiredText(raw.action, `Problem ${index + 1} action`),
      // Mid/high reports always await lead discussion, even if a member claims it already acted.
      status: risk === 'low' ? raw.status as ReportedProblem['status'] : 'open',
    }
  })
  return { summary: requiredText(value.summary, 'Superpowers work summary'), problems }
}

function parseMeeting(output: string): MeetingResult {
  const value = parseObject(output, 'Superpowers task lead')
  if (!Array.isArray(value.decisions)) throw new Error('Superpowers adjudication must include decisions')
  const decisions = value.decisions.map((raw, index): LeadDecision => {
    if (!object(raw)) throw new Error(`Decision ${index + 1} is invalid`)
    return { issueKey: requiredText(raw.issueKey, `Decision ${index + 1} issueKey`),
      decision: requiredText(raw.decision, `Decision ${index + 1} decision`),
      rationale: requiredText(raw.rationale, `Decision ${index + 1} rationale`) }
  })
  return { decisions, summary: requiredText(value.summary, 'Superpowers meeting summary') }
}

function parseAdoption(output: string): AdoptionReport {
  const value = parseObject(output, 'Superpowers member adoption report')
  if (typeof value.adopted !== 'boolean') throw new Error('Superpowers member adoption report must state adopted')
  return { adopted: value.adopted, summary: requiredText(value.summary, 'Adoption summary'),
    nextAction: requiredText(value.nextAction, 'Adoption nextAction') }
}

function recordValue(record: TaskSharedRecord | undefined): Record<string, unknown> | undefined {
  return record !== undefined && object(record.value) ? record.value : undefined
}

function workerStep(config: SuperpowersBlackboardConfig, label: string): TaskStep {
  return { label, preset: config.preset, instruction: '按照原始用户任务和明确授权执行，不扩大范围；遇到计划外问题时说明证据、影响、风险等级和已采取动作。低风险问题自行判断并处理后再汇报；中高风险问题先报告并等待 lead 裁决。只输出一个 JSON 对象：{"summary":"...","problems":[{"title":"...","description":"...","risk":"low|medium|high","evidence":"...","action":"...","status":"resolved|open"}]}。resolved 只用于已实际处理的问题，open 用于需要后续决策的问题。没有问题时 problems 为空。',
    maxTokens: config.maxTokens, timeoutMs: config.timeoutMs }
}

function controlStep(config: SuperpowersBlackboardConfig, label: string): TaskStep {
  return { label, preset: config.preset, instruction: '你是本任务的 Superpowers lead。依据任务事实、黑板记录和用户边界组织工作；不要把推测写成事实。只输出要求的 JSON 对象。',
    tools: { allow: [...config.readTools] }, maxTokens: config.maxTokens, timeoutMs: config.timeoutMs }
}

async function currentIssues(coordination: TaskCoordination): Promise<{ key: string; revision: number; issue: IssueRow }[]> {
  return coordination.records.list().flatMap((record) => {
    if (!record.key.startsWith('superpowers/issue/')) return []
    const value = recordValue(record)
    if (value === undefined || value.status !== 'open') return []
    if (!['low', 'medium', 'high'].includes(String(value.risk)) || typeof value.title !== 'string'
      || typeof value.description !== 'string' || typeof value.evidence !== 'string' || typeof value.action !== 'string'
      || typeof value.taskId !== 'string' || typeof value.sessionId !== 'string') {
      throw new Error(`Superpowers issue record is malformed: ${record.key}`)
    }
    return [{ key: record.key, revision: record.revision, issue: value as unknown as IssueRow }]
  })
}

/** Create an opaque-cost policy plan and a Superpowers-owned async executor. */
export function createSuperpowersBlackboard(config: SuperpowersBlackboardConfig): {
  readonly plan: ExecutionPlan
  readonly executor: TaskExecutorProvider
} {
  if (config.highMeetingThreshold >= config.mediumMeetingThreshold) {
    throw new Error('Superpowers high-risk meeting threshold must be lower than the medium-risk threshold')
  }
  if (![config.executorId, config.strategyId, config.preset].every(value => value.trim())) {
    throw new Error('Superpowers blackboard fields must not be empty')
  }
  const captured = structuredClone(config)
  const plan: ExecutionPlan = { name: captured.strategyId, stages: [{ name: 'Superpowers blackboard', serial: true, tasks: [
    { label: 'Superpowers blackboard', executor: captured.executorId,
      instruction: '在原始任务内运行 Superpowers 黑板流程，持续反馈计划外问题、决策及成员采纳情况。' },
  ] }] }
  const executor: TaskExecutorProvider = {
    id: captured.executorId,
    description: 'Superpowers 黑板协调器：低风险成员自治，中高风险汇总讨论并由任务 lead 裁决。',
    check: () => {},
    execute: async (_parent, _step, prompt, signal, context) => {
      if (context === undefined) throw new Error('Superpowers blackboard requires task coordination context')
      const { members, coordination } = context
      const leadOutcome = await members.open(controlStep(captured, 'superpowers-lead'),
        `${prompt}\n\n先将任务拆成有依赖顺序的有限工作项，最多 ${captured.maxNodes} 项。只输出 {"done":false,"tasks":[{"id":"...","instruction":"..."}]}；无需工作时输出 {"done":true,"tasks":[]}。`, signal)
      let leadText = settled(leadOutcome, 'Superpowers lead planning')
      const leadId = leadOutcome.sessionId
      const completed: { taskId: string; summary: string }[] = []
      const adoption: { issueKey: string; sessionId: SessionId; adopted: boolean; summary: string }[] = []
      const workerSessions = new Set<SessionId>()
      const seenTaskIds = new Set<string>()
      let issueNumber = coordination.records.list().filter(record => record.key.startsWith('superpowers/issue/')).length
      let meetingNumber = coordination.records.list().filter(record => record.key.startsWith('superpowers/meeting/')).length
      let taskCount = 0
      let lastAdjudication = Date.now()
      let nextPlan = parsePlan(leadText, captured.maxNodes)

      const write = async (key: string, value: unknown): Promise<TaskSharedRecord> => {
        const revision = coordination.records.read(key)?.revision ?? 0
        return coordination.records.write(key, value, revision, signal)
      }

      const adjudicate = async (reason: 'threshold' | 'periodic' | 'final'): Promise<void> => {
        const pending = await currentIssues(coordination)
        if (pending.length === 0) return
        const discussion: { issueKey: string; view: string }[] = []
        for (const row of pending) {
          signal.throwIfAborted()
          const round = await members.continue(row.issue.sessionId,
            `Superpowers 议题讨论：${JSON.stringify({ issueKey: row.key, issue: row.issue })}\n请从执行成员角度补充风险、反例和可执行选项，只输出 {"view":"..."}。不要自行覆盖 lead 决策。`, signal)
          const view = parseObject(settled(round, `Discussion for ${row.key}`), 'Superpowers member discussion')
          discussion.push({ issueKey: row.key, view: requiredText(view.view, 'Member discussion view') })
        }
        await write(`superpowers/meeting/${++meetingNumber}`, { reason, issueKeys: pending.map(row => row.key), discussion })
        const meeting = await members.continue(leadId,
          `请裁决以下 Superpowers 黑板议题。讨论已汇总，按原任务目标给出可执行决策，并明确关联 issueKey。\n${JSON.stringify({ issues: pending, discussion })}\n只输出 {"summary":"...","decisions":[{"issueKey":"...","decision":"...","rationale":"..."}]}。`, signal)
        const report = parseMeeting(settled(meeting, 'Superpowers adjudication'))
        const byKey = new Map(report.decisions.map(decision => [decision.issueKey, decision]))
        const pendingKeys = new Set(pending.map(row => row.key))
        if (byKey.size !== pending.length || [...byKey.keys()].some(key => !pendingKeys.has(key))) {
          throw new Error('Superpowers lead returned duplicate or unrelated decisions')
        }
        for (const row of pending) {
          const decision = byKey.get(row.key)
          if (decision === undefined) throw new Error(`Superpowers lead omitted decision for ${row.key}`)
          const decisionRecord = await write(`superpowers/decision/${row.key.split('/').at(-1)}`,
            { issueKey: row.key, decision: decision.decision, rationale: decision.rationale, meetingSummary: report.summary })
          let ownerAdopted = false
          let memberNumber = 0
          for (const sessionId of workerSessions) {
            memberNumber++
            const continuation = await members.continue(sessionId,
              `黑板最新内容与裁决：${JSON.stringify({ records: coordination.records.list(), issueKey: row.key,
                decisionRevision: decisionRecord.revision, decision })}\n请将与自己后续工作相关的内容纳入工作；不相关时如实说明。只输出 {"adopted":true|false,"summary":"...","nextAction":"..."}。`, signal)
            const adopted = parseAdoption(settled(continuation, `Adoption for ${row.key}`))
            await write(`superpowers/adoption/${row.key.split('/').at(-1)}/${memberNumber}`,
              { issueKey: row.key, sessionId, decisionRevision: decisionRecord.revision, ...adopted })
            adoption.push({ issueKey: row.key, sessionId, adopted: adopted.adopted, summary: adopted.summary })
            if (sessionId === row.issue.sessionId) ownerAdopted = adopted.adopted
          }
          if (ownerAdopted) {
            const latest = coordination.records.read(row.key)
            if (latest !== undefined) await coordination.records.write(row.key,
              { ...row.issue, status: 'adopted', decisionRevision: decisionRecord.revision }, latest.revision, signal)
          }
        }
        lastAdjudication = Date.now()
      }

      while (!nextPlan.done && taskCount < captured.maxNodes) {
        for (const task of nextPlan.tasks) {
          signal.throwIfAborted()
          if (taskCount >= captured.maxNodes) break
          if (seenTaskIds.has(task.id)) throw new Error(`Superpowers planner repeated task id: ${task.id}`)
          seenTaskIds.add(task.id)
          const worker = await members.open(workerStep(captured, `superpowers-work-${taskCount + 1}`),
            `工作项 ${task.id}: ${task.instruction}\n原始任务和上下文：\n${prompt}`, signal)
          workerSessions.add(worker.sessionId)
          const report = parseWorkReport(settled(worker, `Superpowers task ${task.id}`))
          completed.push({ taskId: task.id, summary: report.summary })
          await write(`superpowers/task/${taskCount + 1}`,
            { taskId: task.id, summary: report.summary, sessionId: worker.sessionId })
          for (const problem of report.problems) {
            issueNumber++
            const issue: IssueRow = { ...problem, taskId: task.id, sessionId: worker.sessionId }
            await write(`superpowers/issue/${issueNumber}`, issue)
          }
          taskCount++
          const pending = await currentIssues(coordination)
          const medium = pending.filter(row => row.issue.risk === 'medium').length
          const high = pending.filter(row => row.issue.risk === 'high').length
          if (high >= captured.highMeetingThreshold || medium >= captured.mediumMeetingThreshold) {
            await adjudicate('threshold')
          } else if (Date.now() - lastAdjudication >= captured.adjudicationPeriodMs) {
            await adjudicate('periodic')
          }
        }
        if (taskCount >= captured.maxNodes) break
        const continued = await members.continue(leadId,
          `黑板新状态：${JSON.stringify({ completed, records: coordination.records.list() })}\n如仍有获授权工作，只给出尚未完成的新工作项，避免重复；否则输出 done=true。格式 {"done":true|false,"tasks":[{"id":"...","instruction":"..."}]}。`, signal)
        leadText = settled(continued, 'Superpowers replanning')
        nextPlan = parsePlan(leadText, captured.maxNodes - taskCount)
      }
      if ((await currentIssues(coordination)).length > 0) await adjudicate('final')
      const unresolved = await currentIssues(coordination)
      const summary = {
        completed,
        adoption,
        unresolved: unresolved.map(row => ({ key: row.key, risk: row.issue.risk, title: row.issue.title })),
      }
      return { sessionId: leadId, stopReason: 'completed', output: JSON.stringify(summary) }
    },
  }
  return { plan, executor }
}

/** Stable identity for policy revision; thresholds and cadence are task semantics. */
export function superpowersPolicyRevision(config: SuperpowersBlackboardConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex')
}
