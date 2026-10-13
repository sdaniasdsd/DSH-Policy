import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, symbols } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { createUserMessage, ToolCallId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import Subagents from '@deepseek-ai/dsh-subagent'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Preset from '@deepseek-ai/dsh-agent-preset'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import * as AskUser from '@deepseek-ai/dsh-tool-ask-user'
import Adapter from '../src/cordis.ts'
import TaskRuns from '../src/task-runtime-service.ts'
import * as CodexOrchestrator from '../src/plugin-codex.ts'
import * as ClaudeOrchestrator from '../src/plugin-claude.ts'
import * as SuperpowersStyle from '../src/plugin-superpowers-style.ts'
import * as CodexStyle from '../src/plugin-codex-style.ts'
import * as ClaudeStyle from '../src/plugin-claude-style.ts'
import * as ZcodeStyle from '../src/plugin-zcode-style.ts'
import { createStyleStrategy, styleSchema } from '../src/style-policy.ts'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { TaskExecutorProvider } from '../src/executor-types.ts'
import { MockAdapter, textResponse, toolCallResponse, maxTokensResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { AdapterConfig, ExecutionPlan, ExecutionResult } from '../src/types.ts'
import type { WorkflowProposal } from '../src/workflow-report.ts'
import { strategyTools } from '../src/tools.ts'
import { ownerRuns } from '../src/task-submissions.ts'
import { bootTaskRuntime, workPlan } from './task-runtime-fixture.ts'

const contexts: Context[] = []
class EntryPtcRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test'
  resolve(request: PtcRunRequest): PtcRunSpec { return { ...request, cwd: process.cwd(), timeoutMs: 5000 } }
  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    return { logs: [], value: await request.bindings[0]!.functions.coding_only!({}) }
  }
}
const directories: string[] = []
function isActiveMemberView(value: unknown): value is { readonly activeMembers: readonly { readonly sessionId: SessionId }[] } {
  if (typeof value !== 'object' || value === null || !('activeMembers' in value) || !Array.isArray(value.activeMembers)) return false
  return value.activeMembers.every((member: unknown) => typeof member === 'object' && member !== null
    && 'sessionId' in member && typeof member.sessionId === 'string')
}
function isMessageReceipt(value: unknown): value is { readonly messageId: string } {
  return typeof value === 'object' && value !== null && 'messageId' in value && typeof value.messageId === 'string'
}
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function boot(
  script: ConstructorParameters<typeof MockAdapter>[0] = [textResponse('risks found'), textResponse('implemented')],
  configureModel?: (model: MockAdapter) => void,
  adapterConfig?: Partial<AdapterConfig>,
  nativeQuestions = false,
) {
  const ctx = new Context()
  contexts.push(ctx)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-task-strategy-'))
  directories.push(directory)
  await cp(join(dirname(fileURLToPath(import.meta.url)), 'fixtures'), directory, { recursive: true })
  const baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader, { baseUrl })
  Object.assign(ctx.loader.builtins, {
    include: Include, llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, 'agent-loop': AgentLoop, subagents: Subagents, spawn: Spawn,
    jobs: Jobs, 'tool-jobs': ToolJobs, presets: Presets, preset: Preset, 'strategy-adapter': Adapter, 'task-runtime': TaskRuns,
    questions: UserQuestions, 'ask-user': AskUser,
    'token-meter': TokenMeter,
    'fs-local': FsLocal, 'working-directory': WorkingDirectory,
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  if (nativeQuestions) {
    await ctx.loader.create({ name: 'cordis:include', config: { path: './questions.yml' } })
    await ctx.loader.await()
  }
  if (adapterConfig !== undefined) {
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    await entry.fiber!.dispose()
    entry.options.config = { ...entry.options.config as AdapterConfig, ...adapterConfig }
    await entry.init()
    await ctx.loader.await()
  }
  const model = new MockAdapter(script)
  configureModel?.(model)
  ctx.llm.registerAdapter(['mock'], model)
  const handle = await ctx.agents.create({
    sessionId: SessionId('strategy-parent'), agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'coding') },
  })
  return { ctx, model, parent: handle.agent, handle }
}

function respondToWorkflow(proposal: WorkflowProposal) {
  return (options: Parameters<MockAdapter['stream']>[0]) => {
    const prompt = JSON.stringify(options.messages)
    if (prompt.includes('以 structured_output 提交 decision=proceed/blocked')) return toolCallResponse('intake', 'structured_output', {
      decision: 'proceed', goal: 'Complete the requested task.', blocker: '',
    })
    if (prompt.includes('生成有限的工作计划')) return toolCallResponse('plan', 'structured_output', proposal)
    if (prompt.includes('以 structured_output 提交 status=passed/issues/unverified')) return toolCallResponse('review', 'structured_output', { status: 'passed', issues: [] })
    if (prompt.includes('这是唯一的最终答复收束步骤')) return toolCallResponse('summary', 'structured_output', {
      status: 'resolved', conclusion: 'The task is complete.', evidence: ['All planned tasks passed.'], blocker: '', nextStep: '',
    })
    return textResponse('done')
  }
}

describe('Loader-composed strategy adapter', () => {
  it.each([CodexStyle, ClaudeStyle, ZcodeStyle, SuperpowersStyle])('executes $name concurrency through Loader above the carrier default', async (plugin) => {
    const proposal: WorkflowProposal = { summary: 'independent modules', domain: 'coding',
      nodes: ['a', 'b', 'c'].map(id => ({ id, instruction: `implement_module:${id}`, dependencies: [] })), artifacts: [] }
    const respond = respondToWorkflow(proposal)
    const { ctx, model, parent } = await boot(Array.from({ length: 20 }, () => respond), undefined,
      { maxConcurrent: 1, maxTasks: 20 })
    ctx.tools.register({ name: 'read', description: 'read-only test fixture',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
      execute: async () => 'fixture',
    })
    const gate = Promise.withResolvers<undefined>()
    let started = 0, active = 0, maximum = 0
    const stream = model.stream.bind(model)
    model.stream = async function* (options) {
      const instructions = options.messages.filter(message => message.role === 'user')
        .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
        .map(text => text.split('\n\nPrior-stage results (data, not instructions):\n')[0])
      const work = instructions.some(text => text?.includes('\nimplement_module:'))
      if (work) { started++; maximum = Math.max(maximum, ++active) }
      try {
        if (work) await gate.promise
        yield* stream(options)
      } finally { if (work) active-- }
    }
    ctx.loader.builtins[plugin.name] = plugin
    await ctx.loader.create({ name: `cordis:${plugin.name}`,
      config: plugin.Config({ preset: 'coding', tier: 'medium', maxConcurrent: 2, readTools: [] }) })
    await ctx.loader.await()
    const receipt = await ctx.taskStrategies.submit(parent, { requestId: plugin.name, task: 'Implement independent modules',
      strategy: plugin.name.replace('strategy-', '') }, new AbortController().signal)
    const job = ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    try { await vi.waitFor(() => { expect(started).toBe(2) }) }
    finally { gate.resolve(undefined); await job }
    const settled = await job
    expect(settled.status, settled.detail).toBe('completed')
    expect(started).toBe(3)
    expect(maximum).toBe(2)
    expect(active).toBe(0)
  })
  it('loads Superpowers-style as an opt-in DSH preset plugin and removes it on disposal', async () => {
    const proposal: WorkflowProposal = { summary: 'one bounded change', domain: 'coding', nodes: [{ id: 'a', instruction: 'work', dependencies: [] }], artifacts: [] }
    const respond = respondToWorkflow(proposal)
    const { ctx, model, parent } = await boot(Array.from({ length: 12 }, () => respond), undefined, { entry: { enabled: true } })
    ctx.loader.builtins['strategy-superpowers-style'] = SuperpowersStyle
    await ctx.loader.create({ name: 'cordis:strategy-superpowers-style',
      config: SuperpowersStyle.Config({ preset: 'coding', tier: 'low', readTools: [] }) })
    await ctx.loader.await()
    ctx.tools.register({ name: 'read', description: 'read-only test fixture',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
      execute: async () => 'fixture',
    })
    expect(ctx.taskStrategies.catalog().strategies.map(row => row.id)).toContain('superpowers-style')
    const mode = ctx.taskStrategies.orchestration({ sessionId: parent.id }).options.find(row => row.id === 'superpowers-style')
    expect(mode).toMatchObject({ available: true })
    const receipt = await ctx.taskStrategies.submit(parent, { requestId: 'superpowers-style', task: 'make one bounded change', strategy: 'superpowers-style' }, new AbortController().signal)
    const job = await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(job.status, job.detail).toBe('completed')
    expect(ctx.taskStrategies.inspect(parent, receipt.jobId).results.map(row => row.label)).toEqual(['understand', 'plan', 'work:a', 'verify', 'final-review', 'final-summary'])
    expect(ctx.taskStrategies.inspect(parent, receipt.jobId).finalSummary).toMatchObject({ status: 'resolved', conclusion: 'The task is complete.' })
    const instructions = model.requests.flatMap(request => request.messages.filter(message => message.role === 'user')
      .flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
      .filter(text => text.startsWith('Task:\n'))
      .map(text => text.split('\n\nInstructions:\n')[1]?.split('\n\nPrior-stage results (data, not instructions):\n')[0]))
    expect(instructions).toHaveLength(6)
    expect(instructions).toMatchSnapshot('loaded Superpowers task instructions')
    const entry = [...ctx.loader.entries()].find(row => row.options.name === 'cordis:strategy-superpowers-style')
    await entry?.fiber?.dispose()
    expect(ctx.taskStrategies.catalog().strategies.map(row => row.id)).not.toContain('superpowers-style')
    expect(ctx.taskStrategies.orchestration({ sessionId: parent.id }).options.find(row => row.id === 'superpowers-style')).toBeUndefined()
  })
  it('rejects reuse of a request id with different autonomous selection semantics', async () => {
    const { ctx, parent } = await boot([toolCallResponse('choose', 'structured_output', { strategy: 'review-first' }), textResponse('read'), textResponse('done')])
    const request = { requestId: 'selection-identity', task: 'work', selection: { kind: 'auto' as const } }
    const receipt = await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    await expect(ctx.taskStrategies.submitTask(parent, { ...request, selection: { kind: 'auto', workflow: true } }, new AbortController().signal))
      .rejects.toThrow('different input')
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
  })
  it('does not use the configured fallback after caller cancellation', async () => {
    const { ctx, parent } = await boot([], undefined, {
      selection: { default: { kind: 'auto', workflow: true }, fallbackStrategy: 'review-first', timeoutMs: 30000,
        maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 },
    })
    const controller = new AbortController(); controller.abort(new Error('user cancelled'))
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'cancelled-auto', task: 'work' }, controller.signal)).rejects.toThrow('user cancelled')
    expect(ctx.jobs.list(parent.id)).toHaveLength(0)
  })
  it('refuses a missing fallback without accepting an execution Job', async () => {
    const { ctx, parent } = await boot([maxTokensResponse('exhausted')], undefined, {
      selection: { default: { kind: 'auto', workflow: true }, fallbackStrategy: 'missing', timeoutMs: 30000,
        maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 },
    })
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'missing-fallback', task: 'work' }, new AbortController().signal))
      .rejects.toThrow('fallback strategy is unavailable')
    expect(ctx.jobs.list(parent.id)).toHaveLength(0)
  })
  it('chooses a style tier automatically and retains the explanation in its receipt', async () => {
    const { ctx, parent } = await boot([
      toolCallResponse('pick-workflow', 'structured_output', { strategy: 'automatic-policy', tier: 'high', reason: 'Multiple components need review.' }),
      textResponse('done'),
    ], undefined, { entry: { enabled: true } })
    ctx.taskStrategies.register({ id: 'automatic-policy', description: 'Finite style policy',
      decide: input => ({ name: `Selected ${input.preferences?.tier}`, stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }] }) })
    ctx.taskStrategies.registerOrchestration({ id: 'automatic-mode', label: 'Automatic mode', strategy: 'automatic-policy', defaultTier: 'medium' })
    const receipt = await ctx.taskStrategies.submitTask(parent, { requestId: 'auto-tier', task: 'Update several components',
      selection: { kind: 'auto', workflow: true } }, new AbortController().signal)
    expect(receipt).toMatchObject({ strategy: 'automatic-policy', name: 'Selected high',
      selection: { kind: 'auto', tier: 'high', reason: 'Multiple components need review.' } })
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })
  it('offers and retains extreme-high for an explicitly tiered style policy', async () => {
    const { ctx, parent } = await boot([
      toolCallResponse('pick-workflow', 'structured_output', { strategy: 'automatic-policy', tier: 'extreme-high', reason: 'The task needs maximum bounded review.' }),
      textResponse('done'),
    ], undefined, { entry: { enabled: true } })
    ctx.taskStrategies.register({ id: 'automatic-policy', description: 'Finite style policy',
      decide: input => ({ name: `Selected ${input.preferences?.tier}`, stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }] }) })
    ctx.taskStrategies.registerOrchestration({ id: 'automatic-mode', label: 'Automatic mode', strategy: 'automatic-policy', defaultTier: 'medium' })
    const receipt = await ctx.taskStrategies.submitTask(parent, { requestId: 'auto-extreme-tier', task: 'Large task with broad verification',
      selection: { kind: 'auto', workflow: true } }, new AbortController().signal)
    expect(receipt.selection).toEqual({ kind: 'auto', tier: 'extreme-high', reason: 'The task needs maximum bounded review.' })
    expect(receipt.name).toBe('Selected extreme-high')
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })
  it('uses only a configured balanced fallback after a failed automatic choice', async () => {
    const { ctx, parent } = await boot([maxTokensResponse('exhausted'), textResponse('done')], undefined, {
      entry: { enabled: true },
      selection: { default: { kind: 'auto' }, fallbackStrategy: 'balanced', timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 },
    })
    ctx.taskStrategies.register({ id: 'balanced', description: 'Fallback', decide: input => ({ name: `Fallback ${input.preferences?.tier}`,
      stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }] }) })
    ctx.taskStrategies.registerOrchestration({ id: 'balanced-mode', label: 'Balanced', strategy: 'balanced', defaultTier: 'medium' })
    const receipt = await ctx.taskStrategies.submitTask(parent, { requestId: 'auto-fallback', task: 'work',
      selection: { kind: 'auto', workflow: true } }, new AbortController().signal)
    expect(receipt).toMatchObject({ strategy: 'balanced', name: 'Fallback medium', selection: { kind: 'fallback', tier: 'medium' } })
    expect(receipt.selection?.reason).toContain('max-tokens')
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })
  it('accepts an explicit proposal once and clarifies ambiguous short continuations', async () => {
    const { ctx, parent } = await boot([textResponse('done')], undefined, { entry: { enabled: true } })
    ctx.taskStrategies.proposeEntry({ sessionId: parent.id, proposalId: 'p1', task: 'Inspect fixture', strategy: 'review-first' })
    ctx.taskStrategies.proposeEntry({ sessionId: parent.id, proposalId: 'p2', task: 'Inspect another fixture', strategy: 'review-first' })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '跑吧' }] }))
    await parent.whenIdle()
    expect(ctx.jobs.list(parent.id)).toHaveLength(0)
    const views = await Promise.all([ctx.taskStrategies.acceptProposal({ sessionId: parent.id, proposalId: 'p1' }),
      ctx.taskStrategies.acceptProposal({ sessionId: parent.id, proposalId: 'p1' })])
    expect(views[0]?.receipt?.jobId).toBe(views[1]?.receipt?.jobId)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
  })
  it('executes a DSH style with structured planning and actual read observations without native executors', async () => {
    const proposal = { summary: 'file check', domain: 'coding', nodes: [{ id: 'a', instruction: 'work', dependencies: [] }],
      artifacts: [{ id: 'file', path: 'gate.md', contains: 'random-42' }] }
    const respond = (options: Parameters<MockAdapter['stream']>[0]) => {
      const prompt = JSON.stringify(options.messages)
      if (prompt.includes('生成有限的工作计划')) return toolCallResponse('plan', 'structured_output', proposal)
      if (prompt.includes('只用 read 对以下登记路径')) return options.messages.at(-1)?.role === 'tool'
        ? textResponse('read complete') : toolCallResponse('read-file', 'read', { file_path: 'gate.md' })
      return textResponse('work complete')
    }
    const { ctx, parent } = await boot(Array.from({ length: 20 }, () => respond), undefined, { entry: { enabled: true } })
    ctx.tools.register({ name: 'read', description: 'original tool pipeline read fixture',
      parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
      execute: async () => '<content>\n1: random-42\n\n(End of file - total 1 lines)\n</content>',
    })
    const policy = createStyleStrategy('codex', styleSchema('codex')({ preset: 'coding', tier: 'low', readTools: ['read'] }))
    ctx.taskStrategies.register(policy)
    ctx.taskStrategies.registerOrchestration({ id: 'codex-style', label: 'Codex style', strategy: policy.id })
    expect(ctx.taskStrategies.orchestration({ sessionId: parent.id }).options.find(row => row.id === 'codex-style')?.available).toBe(true)
    const receipt = await ctx.taskStrategies.submit(parent, { requestId: 'dsh-style', task: 'write gate.md with random-42', strategy: policy.id }, new AbortController().signal)
    const job = await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(job.status, job.detail).toBe('completed')
    expect(ctx.taskStrategies.inspect(parent, receipt.jobId).verification).toMatchObject({ status: 'passed' })
    expect(ctx.taskStrategies.inspect(parent, receipt.jobId).execution).toMatchObject({ modelProvider: 'mock', model: 'mock', permissionAuthority: 'dsh' })
    expect(ctx.taskRuns.listExecutors()).toEqual([])
    const releaseDeny = ctx.tools.guard(exec => exec.name === 'read' ? 'Fixture original DSH read denial' : undefined)
    const denied = await ctx.taskStrategies.submit(parent, { requestId: 'dsh-style-denied', task: 'write gate.md with random-42',
      strategy: policy.id }, new AbortController().signal)
    expect((await ctx.jobs.wait(denied.jobId, 5000, parent.id)).status).toBe('completed')
    const deniedView = ctx.taskStrategies.inspect(parent, denied.jobId)
    expect(deniedView.verification?.status).toBe('unverified')
    expect(deniedView.results.filter(row => row.label.startsWith('repair:'))).toHaveLength(0)
    releaseDeny()
  })
  it('isolates bounded routing and selection from execution reasoning', async () => {
    const respond: Parameters<MockAdapter['stream']>[0] extends infer T ? (options: T) => ReturnType<typeof textResponse> : never = (options) => {
      const prompt = JSON.stringify(options.messages)
      if (prompt.includes('Route the original user input')) return options.reasoningEffort === 'off'
        ? toolCallResponse('route', 'structured_output', { kind: 'new-task' }) : maxTokensResponse('reasoning budget exhausted')
      if (prompt.includes('Choose exactly one registered strategy')) return options.reasoningEffort === 'off'
        ? toolCallResponse('choose', 'structured_output', { strategy: 'review-first' }) : maxTokensResponse('reasoning budget exhausted')
      return textResponse('executed')
    }
    const { ctx, parent, model } = await boot(Array.from({ length: 12 }, () => respond), (adapter) => {
      vi.spyOn(adapter, 'resolveModel').mockImplementation(async (provider, id) => ({ provider, id, name: id,
        reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }, { id: ReasoningEffortId('high'), name: 'High' }], defaultEffort: ReasoningEffortId('high') } }))
    }, { entry: { enabled: true } })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement the requested change' }] }))
    await parent.whenIdle()
    const entry = ctx.taskStrategies.entryState({ sessionId: parent.id })[0]
    expect(entry?.receipt, JSON.stringify(entry)).toBeDefined()
    if (!entry?.receipt) throw new Error(JSON.stringify(entry))
    expect((await ctx.jobs.wait(entry.receipt.jobId, 5000, parent.id)).status).toBe('completed')
    const decisions = model.requests.filter(request =>
      /Route the original user input|Choose exactly one registered strategy/.test(JSON.stringify(request.messages)),
    )
    expect(decisions).toHaveLength(2)
    expect(decisions.every(request => request.reasoningEffort === 'off' && request.maxTokens === 512)).toBe(true)
    expect(model.requests.filter(request => !decisions.includes(request)).every(request => request.reasoningEffort === 'high')).toBe(true)
  })
  it('reads latest failed task status without re-dispatch and hides incoming wire identity', async () => {
    const respond = (options: Parameters<MockAdapter['stream']>[0]) => options.tools?.some(tool => tool.name === 'structured_output')
      ? toolCallResponse('route', 'structured_output', { kind: JSON.stringify(options.messages).includes('Was the previous task successful?') ? 'status' : 'new-task' })
      : textResponse('reported')
    const { ctx, parent, model } = await boot(Array.from({ length: 12 }, () => respond), undefined,
      { entry: { enabled: true }, allowedExecutors: ['failed-native'] })
    const execute = vi.fn(async () => ({ stopReason: 'error' as const, output: '' }))
    ctx.taskRuns.registerExecutor({ id: 'failed-native', description: 'failure fixture', check: () => {}, execute })
    ctx.taskStrategies.register({ id: 'failed-policy', description: 'fixture', decide: () => ({ name: 'fixture', stages: [{ name: 'native', tasks: [{ label: 'native', executor: 'failed-native', instruction: 'work' }] }] }) })
    ctx.taskStrategies.registerOrchestration({ id: 'failed-mode', label: 'Fixture', strategy: 'failed-policy' }, 'failed-native')
    ctx.taskStrategies.selectOrchestration({ sessionId: parent.id, mode: 'failed-mode' })
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Perform the task' }] })
    parent.followup(message); await parent.whenIdle()
    const first = ctx.taskStrategies.entryState({ sessionId: parent.id })[0]!
    await ctx.jobs.wait(first.receipt!.jobId, 5000, parent.id)
    const status = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Was the previous task successful?' }] })
    parent.followup(status); await parent.whenIdle()
    const views = ctx.taskStrategies.entryState({ sessionId: parent.id })
    expect(views[0]?.state).toBe('failed')
    expect(views[1], JSON.stringify(views)).toMatchObject({ state: 'completed', progress: `Associated with ${first.requestId}` })
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(execute).toHaveBeenCalledOnce()
    const routing = model.requests.filter(request => JSON.stringify(request.messages).includes('Route the original user input'))
    expect(JSON.stringify(routing[0]?.messages)).not.toContain(message.id)
    expect(JSON.stringify(routing[1]?.messages)).not.toContain(status.id)
  })
  it('dispatches a composer-selected plugin through root intake instead of the router default', async () => {
    const { ctx, parent } = await boot([
      toolCallResponse('route', 'structured_output', { kind: 'new-task', strategy: 'review-first' }), textResponse('acknowledged'),
    ], undefined, { entry: { enabled: true }, allowedExecutors: ['composer-native'] })
    const execute = vi.fn(async () => ({ stopReason: 'completed' as const, output: 'native result' }))
    ctx.taskRuns.registerExecutor({ id: 'composer-native', description: 'plugin', check: () => {}, execute })
    ctx.taskStrategies.register({ id: 'composer-policy', description: 'plugin policy', decide: () => ({ name: 'native', stages: [
      { name: 'native', tasks: [{ label: 'work', executor: 'composer-native', instruction: 'native work' }] },
    ] }) })
    ctx.taskStrategies.registerOrchestration({ id: 'custom', label: 'Custom', strategy: 'composer-policy' }, 'composer-native')
    ctx.taskStrategies.selectOrchestration({ sessionId: parent.id, mode: 'custom' })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Perform the task' }] }))
    await parent.whenIdle()
    const job = ctx.jobs.list(parent.id)[0]
    expect(job).toBeDefined()
    if (job === undefined) throw new Error('Expected dispatched task')
    await ctx.jobs.wait(job.id, 5000, parent.id)
    expect(execute).toHaveBeenCalledOnce()
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.receipt?.strategy).toBe('composer-policy')
  })
  it('registers a class executor without losing prototype methods or its receiver', async () => {
    const { ctx, parent } = await boot([], undefined, { allowedExecutors: ['class-native'] })
    class Native implements TaskExecutorProvider {
      id = 'class-native'
      description = 'stateful plugin adapter'
      checks = 0
      executions = 0
      check() { this.checks++ }
      async execute() {
        this.executions++
        return { sessionId: SessionId('class-child'), stopReason: 'completed' as const, output: this.description }
      }
    }
    const adapter = new Native()
    const unregister = ctx.taskRuns.registerExecutor(adapter)
    const receipt = await ctx.taskRuns.start(parent, 'task', { name: 'class', stages: [{ name: 'work', tasks: [
      { label: 'work', executor: adapter.id, instruction: 'native work' },
    ] }] }, { provider: 'spawn', allowedPresets: [], allowedExecutors: [adapter.id],
      maxConcurrent: 1, maxTasks: 1, maxPlanBytes: 8192, maxResultBytes: 8192, maxOutputBytes: 8192 }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt, 5000, parent.id)).status).toBe('completed')
    expect(adapter.checks).toBeGreaterThan(0)
    expect(adapter.executions).toBe(1)
    adapter.id = 'mutated'
    unregister()
    expect(ctx.taskRuns.listExecutors()).toEqual([])
  })
  it.each([
    ['codex', 'codex-native', CodexOrchestrator],
    ['claude-code', 'claude-native', ClaudeOrchestrator],
  ] as const)('mounts %s as a removable orchestration plugin and delegates native planning', async (providerName, strategyId, plugin) => {
    const { ctx, parent } = await boot([], undefined, { allowedExecutors: [providerName] })
    const dispose = vi.fn(async () => {})
    const start = vi.fn(async (_request: SubagentStartRequest) => ({ id: SessionId('native-child'), localAgent: undefined,
      result: Promise.resolve({ stopReason: 'completed' as const, output: [{ type: 'text' as const, text: 'native product result' }] }), dispose }))
    ctx.subagents.registerProvider({ name: providerName, inheritsParentContext: false, capabilities: {
      agentPreset: false, toolFilter: false, agentOptions: false, outputSchema: false, depthLimit: false, persona: false,
    }, start })
    const fiber = await ctx.plugin(plugin)
    expect(ctx.taskStrategies.list().find(row => row.id === strategyId)?.cost).toMatchObject({ kind: 'estimated', tasks: 1 })
    const receipt = await ctx.taskStrategies.submit(parent, { requestId: providerName, task: 'original work', strategy: strategyId }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    expect(start.mock.calls[0]?.[0].parent.id).toBe(parent.id)
    expect(start.mock.calls[0]?.[0].label).toEqual(expect.any(String))
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('agentPreset')
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('toolFilter')
    expect(dispose).toHaveBeenCalledTimes(1)
    await fiber.dispose()
    expect(ctx.taskStrategies.list().some(row => row.id === strategyId)).toBe(false)
    expect(ctx.taskRuns.listExecutors().some(row => row.id === providerName)).toBe(false)
  })
  const orchestratorFields = { providerName: 'codex', executorId: 'codex', strategyId: 'codex-native', description: 'codex', instruction: 'instruction' }
  const nativeCapabilities = {
    agentPreset: false, toolFilter: false, agentOptions: false, outputSchema: false, depthLimit: false, persona: false,
  }
  it.each([
    ['codex', 'codex-native', CodexOrchestrator],
    ['claude-code', 'claude-native', ClaudeOrchestrator],
  ] as const)('refuses to advertise %s before its native backend exists and registers nothing', async (providerName, strategyId, plugin) => {
    const { ctx, parent } = await boot([], undefined, { allowedExecutors: [providerName] })
    await expect(ctx.plugin(plugin)).rejects.toThrow(`Native orchestration backend is unavailable: ${providerName}`)
    expect(ctx.taskStrategies.list().some(row => row.id === strategyId)).toBe(false)
    expect(ctx.taskRuns.listExecutors().some(row => row.id === providerName)).toBe(false)
    expect(ctx.taskStrategies.orchestration({ sessionId: parent.id }).options.map(option => option.id)).not.toContain(providerName)
  })
  it.each(['providerName', 'executorId', 'strategyId', 'description', 'instruction'] as const)(
    'rejects a blank orchestration field %s without registering anything', async (field) => {
      const { ctx } = await boot([], undefined, { allowedExecutors: ['codex'] })
      await expect(ctx.plugin(CodexOrchestrator, { ...orchestratorFields, [field]: ' ' }))
        .rejects.toThrow('Orchestration plugin fields must not be empty')
      expect(ctx.taskStrategies.list().some(row => row.id === 'codex-native')).toBe(false)
      expect(ctx.taskRuns.listExecutors()).toEqual([])
    })
  it('rejects a second orchestration mount for the same executor identity', async () => {
    const { ctx } = await boot([], undefined, { allowedExecutors: ['codex'] })
    ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false, capabilities: nativeCapabilities,
      start: async () => { throw new Error('unused in this case') } })
    await ctx.plugin(CodexOrchestrator)
    await expect(ctx.plugin(CodexOrchestrator, orchestratorFields)).rejects.toThrow('Duplicate task executor: codex')
    expect(ctx.taskRuns.listExecutors().filter(row => row.id === 'codex')).toHaveLength(1)
  })
  it('maps only text blocks and the native child session id into the task result', async () => {
    const { ctx, parent } = await boot([], undefined, { allowedExecutors: ['codex'] })
    const dispose = vi.fn(async () => {})
    ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false, capabilities: nativeCapabilities,
      start: vi.fn(async () => ({ id: SessionId('native-child'), localAgent: undefined,
        result: Promise.resolve({ stopReason: 'completed' as const, output: [
          { type: 'text' as const, text: 'first' }, { type: 'reasoning' as const, text: 'hidden' },
          { type: 'text' as const, text: 'second' },
        ] }), dispose })) })
    await ctx.plugin(CodexOrchestrator)
    const receipt = await ctx.taskStrategies.submit(parent, { requestId: 'text-map', task: 'work', strategy: 'codex-native' }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    expect(ctx.taskRuns.inspect(parent, receipt.jobId).results).toEqual([
      { sessionId: 'native-child', stopReason: 'completed', output: 'first\nsecond', stage: 'native orchestration', label: 'codex-native' },
    ])
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('releases the native run and fails the job when the child result rejects', async () => {
    const { ctx, parent } = await boot([], undefined, { allowedExecutors: ['codex'] })
    const dispose = vi.fn(async () => {})
    ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false, capabilities: nativeCapabilities,
      start: vi.fn(async () => ({ id: SessionId('native-child'), localAgent: undefined,
        result: Promise.reject(new Error('native transport fault')), dispose })) })
    await ctx.plugin(CodexOrchestrator)
    const receipt = await ctx.taskStrategies.submit(parent, { requestId: 'fault', task: 'work', strategy: 'codex-native' }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('failed')
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(ctx.taskRuns.inspect(parent, receipt.jobId).error).toContain('native transport fault')
  })
  it('refuses a new task once the mounted native backend disappears', async () => {
    const { ctx, parent } = await boot([], undefined, { allowedExecutors: ['codex'] })
    const unregister = ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false, capabilities: nativeCapabilities,
      start: async () => { throw new Error('unused in this case') } })
    await ctx.plugin(CodexOrchestrator)
    unregister()
    await expect(ctx.taskStrategies.submit(parent, { requestId: 'gone', task: 'work', strategy: 'codex-native' }, new AbortController().signal))
      .rejects.toThrow('Native orchestration backend is unavailable: codex')
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })
  it('registers a one-task policy carrying the declared instruction and costing assumptions', async () => {
    const { ctx } = await boot([], undefined, { allowedExecutors: ['codex'] })
    ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false, capabilities: nativeCapabilities,
      start: async () => { throw new Error('unused in this case') } })
    const register = vi.spyOn(ctx.taskStrategies, 'register')
    await ctx.plugin(CodexOrchestrator, { ...orchestratorFields, instruction: 'Custom codex instruction',
      tokenCost: { callsPerTask: 2, contextTokensPerCall: 100, outputTokensPerCall: 50 } })
    const policy = register.mock.calls.find(([strategy]) => strategy.id === 'codex-native')?.[0]
    expect(policy?.decide({ task: 'work' })).toEqual({ name: 'codex-native', stages: [{ name: 'native orchestration', tasks: [
      { label: 'codex-native', executor: 'codex', instruction: 'Custom codex instruction' },
    ] }] })
    expect(ctx.taskStrategies.list({ task: 'work' }).find(row => row.id === 'codex-native')?.cost).toMatchObject({
      kind: 'estimated', basis: 'task', tasks: 1, stages: 1,
      assumptions: { callsPerTask: 2, contextTokensPerCall: 100, outputTokensPerCall: 50 },
    })
  })
  it('starts an explicit plan through the independent task runtime', async () => {
    const { ctx, parent } = await boot([textResponse('independent execution')])
    const plan: ExecutionPlan = { name: 'external caller', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'Implement the task' },
    ] }] }
    const jobId = await ctx.taskRuns.start(parent, 'original task', plan, {
      provider: 'spawn', allowedPresets: ['coding'], maxConcurrent: 2, maxTasks: 8,
      maxPlanBytes: 8192, maxResultBytes: 8192, maxOutputBytes: 4096,
    }, new AbortController().signal)
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
    expect(ctx.taskRuns.inspect(parent, jobId)).toMatchObject({ phase: 'completed', startedTasks: 1 })
  })
  it('dispatches an explicitly allowed external executor and removes it on plugin unload', async () => {
    const { ctx, parent } = await boot([])
    const execute = vi.fn<TaskExecutorProvider['execute']>(async () => ({ stopReason: 'completed', output: 'native answer' }))
    const check = vi.fn(() => {})
    const plugin = await ctx.plugin({ inject: ['taskRuns'], apply(pluginCtx: Context) {
      pluginCtx.taskRuns.registerExecutor({ id: 'test-native', description: 'native product', check, execute })
    } })
    const plan: ExecutionPlan = { name: 'native', stages: [{ name: 'delegate', tasks: [
      { label: 'native', executor: 'test-native', instruction: 'Own planning and execution' },
    ] }] }
    const rules = { provider: 'spawn', allowedPresets: ['coding'], allowedExecutors: ['test-native'],
      maxConcurrent: 1, maxTasks: 8, maxPlanBytes: 8192, maxResultBytes: 8192, maxOutputBytes: 4096 }
    const signal = new AbortController().signal
    const jobId = await ctx.taskRuns.start(parent, 'exact original task', plan, rules, signal)
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0]?.[2]).toContain('exact original task')
    expect(check).toHaveBeenCalled()
    await plugin.dispose()
    await expect(ctx.taskRuns.start(parent, 'task', plan, rules, signal)).rejects.toThrow('Unknown task executor')
    await expect(ctx.taskRuns.start(parent, 'task', plan, { ...rules, allowedExecutors: [] }, signal)).rejects.toThrow('not allowed')
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
  })

  it('rejects ambiguous and unsupported external controls before starting a Job', async () => {
    const { ctx, parent } = await boot([])
    const signal = new AbortController().signal
    const rules = { provider: 'spawn', allowedPresets: ['coding'], allowedExecutors: ['native'],
      maxConcurrent: 1, maxTasks: 8, maxPlanBytes: 8192, maxResultBytes: 8192, maxOutputBytes: 4096 }
    ctx.taskRuns.registerExecutor({ id: 'native', description: 'native', check: () => {},
      execute: async () => ({ stopReason: 'completed', output: '' }) })
    for (const step of [
      { label: 'work', instruction: 'work' },
      { label: 'work', instruction: 'work', preset: 'coding', executor: 'native' },
      { label: 'work', instruction: 'work', executor: 'native', tools: { allow: [] } },
      { label: 'work', instruction: 'work', executor: 'native', model: 'pretend-route' },
    ]) {
      await expect(ctx.taskRuns.start(parent, 'task', { name: 'bad', stages: [{ name: 'work', tasks: [step] }] }, rules, signal)).rejects.toThrow()
    }
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })
  it('keeps an active external child owned until cancellation cleanup after plugin unload', async () => {
    const { ctx, parent } = await boot([])
    const started = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let observedAbort = false
    const plugin = await ctx.plugin({ inject: ['taskRuns'], apply(pluginCtx: Context) {
      pluginCtx.taskRuns.registerExecutor({ id: 'owned-native', description: 'native', check: () => {},
        execute: async (_parent, _step, _prompt, signal) => {
          const aborted = Promise.withResolvers<undefined>()
          signal.addEventListener('abort', () => { observedAbort = true; aborted.resolve(undefined) }, { once: true })
          started.resolve(undefined)
          await aborted.promise
          await release.promise
          return { stopReason: 'cancelled', output: '' }
        },
      })
    } })
    const plan: ExecutionPlan = { name: 'native', stages: [{ name: 'work', tasks: [
      { label: 'native', executor: 'owned-native', instruction: 'work' },
    ] }] }
    const jobId = await ctx.taskRuns.start(parent, 'task', plan, {
      provider: 'spawn', allowedPresets: [], allowedExecutors: ['owned-native'], maxConcurrent: 1,
      maxTasks: 2, maxPlanBytes: 8192, maxResultBytes: 8192, maxOutputBytes: 4096,
    }, new AbortController().signal)
    await started.promise
    await plugin.dispose()
    try { ctx.taskRuns.cancel(parent, jobId) }
    catch (error) { release.resolve(undefined); throw error }
    await vi.waitFor(() => { expect(observedAbort).toBe(true) })
    expect(ctx.taskRuns.inspect(parent, jobId).phase).toBe('stopping')
    release.resolve(undefined)
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('killed')
    expect(ctx.taskRuns.inspect(parent, jobId).phase).toBe('cancelled')
  })
  it('transfers cancellation to a Job accepted before receipt delivery', async () => {
    const { ctx, parent } = await boot([
      toolCallResponse('route', 'structured_output', { kind: 'new-task', strategy: 'review-first' }), textResponse('cancelled'),
    ], (model) => {
      const stream = model.stream.bind(model)
      vi.spyOn(model, 'stream').mockImplementation(async function* (options) {
        if (model.requests.length === 0 || options.sessionId === SessionId('strategy-parent')) {
          yield* stream(options)
          return
        }
        model.requests.push(options)
        await new Promise<void>((_resolve, reject) => {
          const abort = () => {
            const reason: unknown = options.signal?.reason
            reject(reason instanceof Error ? reason : new Error(reason === undefined ? 'aborted' : JSON.stringify(reason) ?? 'aborted'))
          }
          options.signal?.addEventListener('abort', abort, { once: true })
          if (options.signal?.aborted) abort()
        })
      })
    }, { entry: { enabled: true } })
    const release = Promise.withResolvers<undefined>()
    const original = ctx.taskStrategies.submitTask.bind(ctx.taskStrategies)
    vi.spyOn(ctx.taskStrategies, 'submitTask').mockImplementation(async (...args) => {
      const receipt = await original(...args)
      await release.promise
      return receipt
    })
    const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Do work' }] })
    parent.followup(input)
    await vi.waitFor(() => { expect(ctx.jobs.list(parent.id)).toHaveLength(1) })
    ctx.taskStrategies.cancelEntry({ sessionId: parent.id, requestId: `message:${input.id}` })
    release.resolve(undefined)
    await parent.whenIdle()
    const job = ctx.jobs.list(parent.id)[0]!
    expect((await ctx.jobs.wait(job.id, 5000, parent.id)).status).toBe('killed')
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.state).toBe('cancelled')
  })

  it('does not revive a human message removed by downstream admission', async () => {
    const { ctx, parent, model } = await boot([], undefined, { entry: { enabled: true } })
    parent.ctx.on('agent/pre-step', async (_input, next) => ({ ...await next(), messages: [] }))
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Do work' }] }))
    await parent.whenIdle()
    expect(model.requests).toHaveLength(0)
    expect(ctx.jobs.list(parent.id)).toHaveLength(0)
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })).toEqual([])
  })

  it('carries bounded prior conversation into routing and dispatched work', async () => {
    const respond = (options: Parameters<MockAdapter['stream']>[0]) => JSON.stringify(options.messages).includes('Route the original user input')
      ? toolCallResponse('route', 'structured_output', { kind: 'new-task', strategy: 'review-first' }) : textResponse('done')
    const { ctx, parent, model } = await boot(Array.from({ length: 12 }, () => respond), undefined, { entry: { enabled: true } })
    parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Prior plan: implement unique_requirement_746 with a green header' }] }), { surfaceOp: 'append' })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement the plan above' }] }))
    await parent.whenIdle()
    const job = ctx.jobs.list(parent.id)[0]!
    await ctx.jobs.wait(job.id, 5000, parent.id)
    expect(JSON.stringify(model.requests[0]?.messages)).toContain('unique_requirement_746')
    const children = model.requests.filter(request => request.tools?.some(tool => tool.name === 'reviewing_only' || tool.name === 'coding_only'))
    expect(children.length).toBeGreaterThan(0)
    expect(children.every(request => JSON.stringify(request.messages).includes('unique_requirement_746'))).toBe(true)
  })

  it('reports that a supplement cannot affect an already running final stage', async () => {
    const respond = (options: Parameters<MockAdapter['stream']>[0]) => JSON.stringify(options.messages).includes('Route the original user input')
      ? toolCallResponse('route', 'structured_output', JSON.stringify(options.messages).includes('Use a blue header') ? { kind: 'supplement' } : { kind: 'new-task', strategy: 'review-first' }) : textResponse('done')
    const { ctx, parent } = await boot(Array.from({ length: 16 }, () => respond), (model) => {
      const original = model.stream.bind(model)
      vi.spyOn(model, 'stream').mockImplementation(async function* (options) {
        if (!options.tools?.some(tool => tool.name === 'coding_only')) { yield* original(options); return }
        model.requests.push(options)
        await new Promise<void>((_resolve, reject) => {
          if (options.signal?.aborted) { reject(new Error('aborted')); return }
          options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        })
      })
    }, { entry: { enabled: true } })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Do work' }] }))
    await parent.whenIdle()
    const job = ctx.jobs.list(parent.id)[0]!
    await vi.waitFor(() => { expect(ctx.taskStrategies.inspect(parent, job.id)).toMatchObject({ phase: 'running', nextStage: 1 }) })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Use a blue header' }] }))
    await parent.whenIdle()
    const state = ctx.taskStrategies.entryState({ sessionId: parent.id }).at(-1)
    expect(state?.state).toBe('failed')
    expect(state?.error).toContain('unstarted stage')
    ctx.jobs.kill(job.id, parent.id)
    await ctx.jobs.wait(job.id, 5000, parent.id)
  })

  it.each(['native', 'ptc'] as const)('filters root model presentation and denies nested PTC business execution in %s mode', async (mode) => {
    const { ctx, parent } = await boot(undefined, undefined, { entry: { enabled: true } })
    await ctx.plugin(EntryPtcRuntime)
    parent.ctx.tools.presentAs(mode)
    const assembly = await parent.ctx.systemPrompt.assemble({ scope: parent, agent: parent })
    expect(assembly.tools.some(tool => tool.name === 'coding_only' || tool.name === 'task_strategy_submit')).toBe(false)
    const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text
    if (mode !== 'native') {
      expect(sdk).not.toContain('coding_only:')
      expect(sdk).not.toContain('task_strategy_submit:')
      expect(sdk).toContain('task_strategy_status:')
      const result = await ctx.tools.execute({ callId: ToolCallId('nested-bypass'), name: 'run_code', arguments: { code: 'return tools.coding_only({})', description: 'Probe nested execution' }, agent: parent, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('Task strategy entry owns execution')
    }
  })
  it('returns no live intake state after owner disposal rather than reviving old work', async () => {
    const { ctx, parent, handle } = await boot()
    await handle.dispose()
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })).toEqual([])
  })

  it('bounds root status output under the configured transport limit', async () => {
    const { ctx, parent } = await boot(undefined, undefined, { maxOutputBytes: 512 })
    vi.spyOn(ctx.taskStrategies, 'entryState').mockReturnValue(Array.from({ length: 80 }, (_, index) => ({
      sessionId: parent.id, messageId: createUserMessage({ source: { kind: 'user' }, content: [] }).id,
      requestId: `request:${index}`, state: 'running' as const, progress: '中'.repeat(80),
    })))
    const result = await ctx.tools.execute({ callId: ToolCallId('bounded-status'), name: 'task_strategy_status', arguments: {}, agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
  })

  it('routes ordinary root input into exactly one strategy Job without a model dispatch call', async () => {
    const respond = (options: Parameters<MockAdapter['stream']>[0]) => {
      const text = JSON.stringify(options.messages)
      if (text.includes('Route the original user input')) return toolCallResponse('route', 'structured_output', { kind: 'new-task' })
      if (text.includes('Choose exactly one registered strategy')) return toolCallResponse('select', 'structured_output', { strategy: 'review-first' })
      return textResponse('done')
    }
    const { ctx, parent, model } = await boot(Array.from({ length: 20 }, () => respond), undefined, { entry: { enabled: true } })
    expect(ctx.taskStrategies.catalog().entryEnabled).toBe(true)
    const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Implement this task' }] })
    parent.followup(input)
    await parent.whenIdle()
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    const job = ctx.jobs.list(parent.id)[0]!
    expect((await ctx.jobs.wait(job.id, 5000, parent.id)).status).toBe('completed')
    parent.followup(input)
    await parent.whenIdle()
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(model.requests.filter(request => JSON.stringify(request.messages).includes('Route the original user input'))).toHaveLength(1)
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]).toMatchObject({ state: 'completed', receipt: { strategy: 'review-first' } })
    const healthy = ctx.taskStrategies.inspect(parent, job.id)
    const inspection = vi.spyOn(ctx.taskStrategies, 'inspect').mockReturnValue({ ...healthy, error: 'replacement rejected' })
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.error).toBe('replacement rejected')
    inspection.mockReturnValue(healthy)
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.error).toBeUndefined()
  })

  it('keeps conversation in the root and blocks locally registered root execution tools', async () => {
    const { ctx, parent, model } = await boot([
      toolCallResponse('route-chat', 'structured_output', { kind: 'chat' }), textResponse('hello'),
    ], undefined, { entry: { enabled: true } })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
    await parent.whenIdle()
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests.at(-1)?.tools?.some(tool => tool.name === 'coding_only')).toBe(false)
    const result = await ctx.tools.execute({ callId: ToolCallId('root-bypass'), name: 'coding_only', arguments: {}, agent: parent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
  })

  it.each(['chat', 'clarify'])('ignores declared task fields on the non-executing %s route', async (kind) => {
    const { ctx, parent } = await boot([
      toolCallResponse('route-extra', 'structured_output', { kind, requestId: '', strategy: 'review-first', expectedBindingEpoch: 0 }),
      textResponse('hello'),
    ], undefined, { entry: { enabled: true } })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
    await parent.whenIdle()
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.state).toBe('completed')
    expect(ctx.agents.list()).toHaveLength(1)
  })

  it.each([
    { kind: 'chat', unknownControl: 'cancel' },
    { kind: 'switch', strategy: 'review-first' },
  ])('rejects unknown fields and incomplete control routes: %j', async (route) => {
    const { ctx, parent } = await boot([toolCallResponse('invalid', 'structured_output', route), textResponse('failed')], undefined, { entry: { enabled: true } })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello' }] }))
    await parent.whenIdle()
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.state).toBe('failed')
    expect(ctx.agents.list()).toHaveLength(1)
  })

  it('records entry failure without executing when the route output is invalid', async () => {
    const { ctx, parent } = await boot([toolCallResponse('invalid', 'structured_output', { kind: 'unknown' }), textResponse('failed')], undefined, { entry: { enabled: true } })
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Make a file' }] }))
    await parent.whenIdle()
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.state).toBe('failed')
    expect(ctx.agents.list()).toHaveLength(1)
  })

  it('cancels automatic routing, retains the original input, and releases the selector', async () => {
    const { ctx, parent, model } = await boot(['hang'], undefined, { entry: { enabled: true } })
    const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Write a file' }] })
    parent.followup(input)
    await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
    parent.cancel({ kind: 'user' })
    await parent.whenIdle()
    expect(ctx.agents.list()).toHaveLength(1)
    expect(ctx.jobs.list(parent.id)).toHaveLength(0)
    expect(ctx.taskStrategies.entryState({ sessionId: parent.id })[0]?.state).toBe('cancelled')
    expect(parent.session.snapshotEvents().some(event => event.type === 'task-strategy/entry' && event.data.input.id === input.id)).toBe(true)
  })
  it('publishes registration and task-specific costs without running children', async () => {
    const { ctx, parent, model } = await boot()
    expect(ctx.taskStrategies.catalog().strategies[0]?.cost).toMatchObject({ kind: 'estimated', basis: 'registration', tasks: 2 })
    const result = await ctx.tools.execute({ callId: ToolCallId('cost-list'), name: 'task_strategy_list',
      arguments: { task: 'Explain token costs', preferences: { speed: 'fast' } }, agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(false)
    const catalog = JSON.parse(text) as ReturnType<Adapter['catalog']>
    expect(catalog.strategies[0]?.cost).toMatchObject({ kind: 'estimated', basis: 'task', tasks: 2 })
    expect(model.requests).toHaveLength(0)
    const plain = await ctx.tools.execute({ callId: ToolCallId('cost-task'), name: 'task_strategy_list',
      arguments: { task: 'Explain token costs' }, agent: parent, signal: new AbortController().signal })
    expect(plain.isError).toBe(false)
    const invalid = await ctx.tools.execute({ callId: ToolCallId('cost-no-task'), name: 'task_strategy_list',
      arguments: { preferences: { speed: 'fast' } }, agent: parent, signal: new AbortController().signal })
    expect(invalid.isError).toBe(true)
    expect(ctx.jobs.list(parent.id)).toHaveLength(0)
  })
  it('loads explicit scenario assumptions and costs configured preference variants', async () => {
    const plan: ExecutionPlan = { name: 'fast', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'Complete briefly' },
    ] }] }
    const { ctx, model } = await boot(undefined, undefined, { strategies: [{ id: 'choice', description: 'choice', plan,
      tokenCost: { callsPerTask: 2, contextTokensPerCall: 100, outputTokensPerCall: 50 },
      variants: [{ preference: 'speed', equals: 'fast', plan }],
    }] })
    expect(ctx.taskStrategies.list({ task: 'task', preferences: { speed: 'fast' } })[0]?.cost).toMatchObject({
      kind: 'estimated', basis: 'task', tasks: 1, estimatedOutputTokens: 100,
    })
    expect(model.requests).toHaveLength(0)
  })
  it.each(['auto', 'named'] as const)('preserves submission identity with a long name for %s intake', async (kind) => {
    const script = [textResponse('risks'), textResponse('done')]
    if (kind === 'auto') script.unshift(toolCallResponse('choose', 'structured_output', { strategy: 'long-name' }))
    const { ctx, parent } = await boot(script, undefined, { maxOutputBytes: 512 })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id: 'long-name', description: 'Long display name', decide: () => ({ ...plan, name: '策略'.repeat(600) }) })
    const result = await ctx.tools.execute({ callId: ToolCallId('long-submit'), name: 'task_strategy_submit',
      arguments: { requestId: 'long-submit', task: 'task', ...kind === 'named' ? { strategy: 'long-name' } : {} },
      agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(false)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
    expect(JSON.parse(text)).toMatchObject({ jobId: 'strategy-1', strategy: 'long-name' })
    expect((await ctx.jobs.wait(ctx.jobs.list(parent.id)[0]!.id, 5000, parent.id)).status).toBe('completed')
  })

  it.each(['auto', 'named'] as const)('rejects an oversized %s strategy identity before accepting a Job', async (kind) => {
    const id = '策'.repeat(300)
    const { ctx, parent } = await boot([toolCallResponse('choose', 'structured_output', { strategy: id })], undefined, { maxOutputBytes: 512 })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let decisions = 0
    ctx.taskStrategies.register({ id, description: 'Oversized identity', decide: () => { decisions++; return plan } })
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'oversized', task: 'task',
      ...kind === 'named' ? { selection: { kind: 'named', strategy: id } as const } : {},
    }, new AbortController().signal)).rejects.toThrow('receipt byte limit')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(decisions).toBe(0)
    expect(ctx.agents.list()).toHaveLength(1)
  })

  it.each(['x'.repeat(254), '\\'.repeat(127), '中'.repeat(84) + 'ab'])('accepts exactly budgeted JSON strategy identities: %j', async (id) => {
    const { ctx, parent } = await boot(undefined, undefined, { maxOutputBytes: 512 })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id, description: 'Boundary identity', decide: () => ({ ...plan, name: '中'.repeat(600) }) })
    expect(Buffer.byteLength(JSON.stringify(id))).toBe(256)
    const result = await ctx.tools.execute({ callId: ToolCallId('boundary-id'), name: 'task_strategy_submit',
      arguments: { requestId: 'boundary-id', task: 'task', strategy: id }, agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(false)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
    expect(JSON.parse(text)).toMatchObject({ strategy: id, jobId: 'strategy-1' })
    expect((await ctx.jobs.wait(ctx.jobs.list(parent.id)[0]!.id, 5000, parent.id)).status).toBe('completed')
  })

  it('keeps accepted request identity when a remount makes its receipt too large for the tool', async () => {
    const { ctx, parent } = await boot()
    const id = 'x'.repeat(600)
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id, description: 'Previously accepted identity', decide: () => plan })
    const request = { requestId: 'retained-large-receipt', task: 'task', selection: { kind: 'named', strategy: id } as const }
    const receipt = await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    await entry.fiber!.dispose()
    entry.options.config = { ...entry.options.config as AdapterConfig, maxOutputBytes: 512 }
    await entry.init()
    await ctx.loader.await()
    const result = await ctx.tools.execute({ callId: ToolCallId('small-receipt-replay'), name: 'task_strategy_submit',
      arguments: { requestId: request.requestId, task: request.task, strategy: id }, agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(true)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
    expect(text).toContain('already accepted')
    expect(text).toContain(receipt.jobId)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)).toEqual(receipt)
  })

  it('captures both selector routes and author preferences through the submit tool', async () => {
    const { ctx, parent, model } = await boot([toolCallResponse('choose', 'structured_output', { strategy: 'review-first' }), textResponse('risks'), textResponse('done')], undefined, {
      selection: { default: { kind: 'auto' }, model: 'mock', provider: 'mock', timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 },
    })
    const receipt = await ctx.tools.execute({ callId: ToolCallId('auto-submit'), name: 'task_strategy_submit', arguments: { requestId: 'tool-auto', task: 'task', preferences: { goal: 'safe' } }, agent: parent, signal: new AbortController().signal })
    expect(receipt.isError).not.toBe(true)
    expect(model.requests[0]!.provider).toBe('mock')
    expect(model.requests[0]!.model).toBe('mock')
    await ctx.jobs.wait(ctx.jobs.list(parent.id)[0]!.id, 5000, parent.id)
    const submitTool = strategyTools(ctx.taskStrategies, 'task_strategy', 4096).find(tool => tool.name === 'task_strategy_submit')!
    await expect(submitTool.execute({ requestId: 'no-agent', task: 'task' }, { signal: new AbortController().signal } as never)).rejects.toThrow('calling agent')
  })
  it('rejects an intake reserved immediately before carrier disposal', async () => {
    const { ctx, parent } = await boot()
    const pending = ctx.taskStrategies.submitTask(parent, { requestId: 'queued-intake', task: 'task' }, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow('closing')
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    await rejected
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })
  it('rejects host inspection through a disposed owner before accessing Jobs', async () => {
    const { ctx, parent, handle } = await boot()
    const carrier = ctx.taskStrategies
    const receipt = await carrier.submit(parent, { requestId: 'inspect-owner', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    await handle.dispose()
    expect(() => carrier.inspect(parent, receipt.jobId)).toThrow('exact live owner')
  })
  it.each(['answered', 'pending'] as const)('composes native timed questions with %s intake without duplicate execution on late replies', async (kind) => {
    let rootStep = 0
    const script: ConstructorParameters<typeof MockAdapter>[0] = Array.from({ length: 18 }, () => (request) => {
      if (request.sessionId !== 'strategy-parent') {
        return request.tools?.some(tool => tool.name === 'structured_output')
          ? toolCallResponse('selection-result', 'structured_output', { strategy: 'review-first' }) : textResponse('done')
      }
      switch (rootStep++) {
        case 0: return toolCallResponse('strategy-choice', 'ask_user_question', { timeout: 1,
          questions: [{ id: 'strategy', question: 'Choose a task strategy, or let the task choose automatically.', options: [{ label: 'review-first' }] }],
        })
        case 1: return toolCallResponse('submit-original', 'task_strategy_submit', { requestId: 'original-task', task: 'task', ...kind === 'answered' ? { strategy: 'review-first' } : {} })
        case 2: return toolCallResponse('wait-original', 'job_output', { job_id: 'strategy-1', wait: true, timeout_ms: 5000 })
        case 4: return toolCallResponse('late-replay', 'task_strategy_submit', { requestId: 'original-task', task: 'task' })
        default: return textResponse('Task execution remains accepted once.')
      }
    })
    const { ctx, parent } = await boot(script, undefined, undefined, true)
    const requestListener = kind === 'answered' ? ctx.on('user-questions/request', async () => ({ answers: [{ id: 'strategy', selected: ['review-first'] }] }))
      : ctx.on('user-questions/request', async request => await new Promise((_resolve, reject) => {
        request.signal!.addEventListener('abort', () => { reject(new Error('question deadline')) }, { once: true })
      }))
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run task with an optional strategy choice.' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const events = parent.session.snapshotEvents()
    const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message)
    const askResult = results.find(message => message.source.callId === 'strategy-choice')!
    expect(askResult.isError).toBe(false)
    if (kind === 'pending') {
      expect(JSON.parse(askResult.content.filter(block => block.type === 'text').map(block => block.text).join(''))).toMatchObject({ pending: true, callId: 'strategy-choice' })
      const liveParent = ctx.agents.get(parent.id)!
      expect(ctx.userQuestions.answer(liveParent, ToolCallId('strategy-choice'), { answers: [{ id: 'strategy', selected: ['review-first'] }] })).toBe(true)
      await liveParent.whenIdle()
      expect(liveParent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'user-question-reply')).toBe(true)
    }
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(ctx.jobs.list(parent.id)[0]!.status).toBe('completed')
    expect(ctx.agents.list()).toHaveLength(1)
    requestListener()
  })
  it('reads live defaults for later intake and retains accepted receipts across carrier remount', async () => {
    const { ctx, parent, model } = await boot([textResponse('risks'), textResponse('done')])
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    const config = entry.fiber!.config as ReturnType<typeof Adapter.Config>
    const { updateVolatile, createVolatile } = await import('@deepseek-ai/cosmokit')
    updateVolatile(config.selection.default, createVolatile({ kind: 'named', strategy: 'review-first' }))
    const request = { requestId: 'saved-default', task: 'task' }
    const receipt = await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(model.requests).toHaveLength(2)
    await entry.fiber!.dispose()
    await entry.init()
    await ctx.loader.await()
    expect(await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)).toEqual(receipt)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
  })

  it('rejects a choice removed during selection and allows retry after correction', async () => {
    const { ctx, parent } = await boot([
      toolCallResponse('choice', 'structured_output', { strategy: 'temporary' }),
      textResponse('done'),
    ])
    const unregister = ctx.taskStrategies.register({ id: 'temporary', description: 'temporary', decide: () => ({
      name: 'temporary', stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }],
    }) })
    const release = ctx.on('subagent/end', () => { unregister() })
    const request = { requestId: 'gone', task: 'task' }
    await expect(ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)).rejects.toThrow('Unknown strategy: temporary')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    release()
    ctx.taskStrategies.register({ id: 'temporary', description: 'temporary', decide: () => ({
      name: 'temporary', stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }],
    }) })
    const receipt = await ctx.taskStrategies.submitTask(parent, { ...request, selection: { kind: 'named', strategy: 'temporary' } }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })

  it('refuses unsupported selection providers and empty candidate sets without starting a child', async () => {
    const { ctx, parent, model } = await boot()
    const provider = ctx.subagents.getProvider('spawn')!
    const dispose = ctx.subagents.registerProvider({ ...provider, name: 'unsupported-selector',
      ...provider.start === undefined ? {} : { start: provider.start.bind(provider) },
      ...provider.prepareContinuable === undefined ? {} : { prepareContinuable: provider.prepareContinuable.bind(provider) },
      capabilities: { ...provider.capabilities, outputSchema: false } })
    const { selectStrategy } = await import('../src/selector.ts')
    const options = { timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 }
    await expect(selectStrategy(parent, [], { task: 'task' }, options, ctx.subagents, 'spawn', new AbortController().signal)).rejects.toThrow('No strategies')
    await expect(selectStrategy(parent, ctx.taskStrategies.list(), { task: 'task' }, options, ctx.subagents, 'unsupported-selector', new AbortController().signal))
      .rejects.toThrow('capabilities')
    dispose()
    expect(model.requests).toEqual([])
  })

  it('reports missing structured output and rejects business tools inside the selector', async () => {
    const { ctx, parent, model } = await boot([
      textResponse('review-first'),
      toolCallResponse('forbidden', 'coding_only', {}),
      toolCallResponse('valid-choice', 'structured_output', { strategy: 'review-first' }),
      textResponse('risks'), textResponse('done'),
    ])
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'missing-result', task: 'task' }, new AbortController().signal))
      .rejects.toThrow('did not complete')
    const receipt = await ctx.taskStrategies.submitTask(parent, { requestId: 'correct-choice', task: 'task' }, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(model.requests.slice(0, 3).every(request => request.tools?.map(tool => tool.name).join(',') === 'structured_output')).toBe(true)
    expect(JSON.stringify(model.requests[2]!.messages)).toContain('coding_only')
  })

  it('keeps first-submitter ownership when a duplicate follower cancels', async () => {
    const { ctx, parent } = await boot([toolCallResponse('choice', 'structured_output', { strategy: 'review-first' }), textResponse('risks'), textResponse('done')])
    const request = { requestId: 'follower', task: 'task' }
    const first = ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    const follower = new AbortController()
    const second = ctx.taskStrategies.submitTask(parent, request, follower.signal)
    follower.abort()
    expect(second).toBe(first)
    const receipt = await second
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })
  it('selects once before admission and retains only structured capture tools', async () => {
    const { ctx, parent, model } = await boot([
      toolCallResponse('choice', 'structured_output', { strategy: 'review-first' }),
      textResponse('risks found'), textResponse('implemented'),
    ])
    const request = { requestId: 'automatic', task: '  修复问题\n', preferences: { b: '2', a: '1' } }
    const first = ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    const second = ctx.taskStrategies.submitTask(parent, { ...request, preferences: { a: '1', b: '2' } }, new AbortController().signal)
    expect(first).toBe(second)
    const receipt = await first
    expect(receipt.strategy).toBe('review-first')
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(model.requests).toHaveLength(3)
    expect(model.requests[0]!.tools?.map(tool => tool.name)).toEqual(['structured_output'])
    expect(JSON.stringify(model.requests[0]!.messages)).toContain('  修复问题')
    expect(ctx.agents.list()).toHaveLength(1)
    const replay = ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    expect(replay).toBe(first)
  })

  it('bypasses the selection model for a named choice', async () => {
    const { ctx, parent, model } = await boot()
    const receipt = await ctx.taskStrategies.submitTask(parent,
      { requestId: 'named', task: 'task', selection: { kind: 'named', strategy: 'review-first' } }, new AbortController().signal)
    expect(receipt.strategy).toBe('review-first')
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(model.requests).toHaveLength(2)
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'named', task: 'task' }, new AbortController().signal))
      .rejects.toThrow('different input')
  })

  it.each(['timeout', 'caller', 'unload', 'owner'] as const)('drains selection on %s without accepting a Job', async (kind) => {
    const { ctx, parent, model, handle } = await boot(['hang-slow'])
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    if (kind === 'timeout') {
      await entry.fiber!.dispose()
      entry.options.config = { ...entry.options.config as AdapterConfig, selection: {
        default: { kind: 'auto' }, timeoutMs: 80, maxTokens: 512, maxPromptBytes: 32768, maxOutputBytes: 2048,
      } }
      await entry.init()
      await ctx.loader.await()
    }
    const controller = new AbortController()
    const pending = ctx.taskStrategies.submitTask(parent, { requestId: kind, task: 'task' }, controller.signal)
    const rejection = expect(pending).rejects.toThrow()
    await expect.poll(() => model.requests.length).toBe(1)
    if (kind === 'caller') controller.abort(new Error('cancelled'))
    if (kind === 'unload') await entry.fiber!.dispose()
    if (kind === 'owner') await handle.dispose()
    await rejection
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(ctx.agents.list().filter(agent => agent.session.header.origin === 'subagent')).toEqual([])
  })

  it.each([
    { maxPromptBytes: 1 }, { maxOutputBytes: 1 },
  ])('refuses selector byte limits without task admission: %j', async (limits) => {
    const { ctx, parent } = await boot([toolCallResponse('choice', 'structured_output', { strategy: 'review-first' })], undefined, {
      selection: { default: { kind: 'auto' }, timeoutMs: 30000, maxTokens: 512, maxPromptBytes: 32768, maxOutputBytes: 2048, ...limits },
    })
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'bounded', task: 'task' }, new AbortController().signal)).rejects.toThrow('byte limit')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(ctx.agents.list()).toHaveLength(1)
  })
  it('forwards the callers binding epoch and rejects stale host controls before author evaluation', async () => {
    let entered!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, parent } = await boot(undefined, (adapter) => {
      const stream = adapter.stream.bind(adapter)
      let first = true
      adapter.stream = async function* (request) {
        if (first) { first = false; entered(); await gate }
        yield* stream(request)
      }
    })
    let decisions = 0
    ctx.taskStrategies.register({ id: 'counted', description: 'counted', decide: () => {
      decisions++
      return { name: 'counted', stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }] }
    } })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'guarded', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    try {
      await started
      const before = ctx.taskStrategies.inspect(parent, receipt.jobId)
      expect(() => ctx.taskStrategies.requestSwitch(parent, receipt.jobId,
        { strategy: 'counted', expectedBindingEpoch: before.binding.epoch + 1 })).toThrow('binding epoch changed')
      expect(decisions).toBe(0)
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId)).toEqual(before)
      ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { strategy: 'missing', expectedBindingEpoch: before.binding.epoch })
      release()
      await expect.poll(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('waiting')
      expect(() => { ctx.taskStrategies.resume(parent, receipt.jobId, 1) }).toThrow('binding epoch changed')
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('waiting')
      ctx.taskStrategies.resume(parent, receipt.jobId, before.binding.epoch)
      expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    } finally { release(); ctx.jobs.kill(receipt.jobId, parent.id) }
  })
  it('rejects an empty host task before reserving a Job', async () => {
    const { ctx, parent, model } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    await expect(ctx.taskStrategies.start(parent, ' \n\t', plan, new AbortController().signal)).rejects.toThrow('Task must not be empty')
    await expect(ctx.taskStrategies.submit(parent,
      { requestId: 'empty-task', strategy: 'review-first', task: '' }, new AbortController().signal)).rejects.toThrow('Task must not be empty')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('records rejection of an empty tool task and allows the model to correct it', async () => {
    let upperStep = 0
    const script: ConstructorParameters<typeof MockAdapter>[0] = Array.from({ length: 10 }, () => (request) => {
      if (request.sessionId !== 'strategy-parent') return textResponse('implemented')
      switch (upperStep++) {
        case 0: return toolCallResponse('empty-task', 'task_strategy_run', { strategy: 'review-first', task: ' \n\t' })
        case 1: return toolCallResponse('corrected-task', 'task_strategy_run', { strategy: 'review-first', task: 'fix bug' })
        case 2: return toolCallResponse('collect', 'job_output', { job_id: 'strategy-1', wait: true, timeout_ms: 5000 })
        default: return textResponse('Corrected the task and collected results')
      }
    })
    const { ctx, parent } = await boot(script)
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'fix bug using review-first' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const messages = parent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message)
    const rejection = messages.find(message => message.source.callId === 'empty-task')!
    expect(rejection.isError).toBe(true)
    expect(rejection.content).toEqual([{ type: 'text', text: 'Error: Task must not be empty' }])
    expect({ content: rejection.content, isError: rejection.isError }).toMatchSnapshot('recorded empty-task rejection')
    expect(messages.find(message => message.source.callId === 'corrected-task')!.isError).toBe(false)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(ctx.jobs.list(parent.id)[0]!.status).toBe('completed')
  })
  it('cancels an owned Job through original Jobs without requiring a reason', async () => {
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const { ctx, parent } = await boot(['hang'], (adapter) => {
      const stream = adapter.stream.bind(adapter)
      adapter.stream = async function* (request) { entered(); yield* stream(request) }
    })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'cancel-no-reason', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await started
    expect(ctx.jobs.kill(receipt.jobId, parent.id)).toBe('requested')
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('killed')
    expect(ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('cancelled')
  })

  it.each([{ maxTasks: Number.MAX_SAFE_INTEGER + 1 }, { provider: ' ' }, { toolPrefix: ' ' }])('rejects invalid deployment semantics at carrier load: %j', async (config) => {
    const { ctx } = await boot(undefined, undefined, config)
    expect(ctx.get('taskStrategies')).toBeUndefined()
  })

  it('rejects a queued submission when its carrier starts closing before acceptance', async () => {
    const { ctx, parent, model } = await boot()
    const carrier = ctx.taskStrategies
    const closing = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    const pending = carrier.submit(parent, { requestId: 'queued-close', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('closing')
    await closing
    await rejection
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('rejects inspecting a Job that was not started by the task runtime', async () => {
    const { ctx, parent } = await boot()
    const job = ctx.jobs.start({ kind: 'strategy', label: 'external', owner: parent.id,
      run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }),
    })
    expect(() => ctx.taskStrategies.inspect(parent, job)).toThrow('Unknown task run')
    await ctx.jobs.wait(job, 5000, parent.id)
  })

  it('resumes through the host API after a failed target capture without replaying completed children', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, parent, model } = await boot(undefined, (adapter) => {
      const stream = adapter.stream.bind(adapter)
      let first = true
      adapter.stream = async function* (request) {
        if (first) { first = false; entered(); await gate }
        yield* stream(request)
      }
    })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'host-resume', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    try {
      await started
      ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'missing', preferences: { speed: 'fast' } })
      release()
      await expect.poll(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('waiting')
      ctx.taskStrategies.resume(parent, receipt.jobId, 0)
      expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId).results.map(result => result.label)).toEqual(['inspect', 'implement'])
      expect(model.requests).toHaveLength(2)
    } finally { release(); ctx.jobs.kill(receipt.jobId, parent.id) }
  })

  it.each([{ model: 'mock' }, { provider: 'mock' }])('routes either model option without requiring its other half: %j', async (route) => {
    const { ctx, parent, model } = await boot()
    const plan: ExecutionPlan = { name: 'route', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work', tools: { deny: [] }, ...route },
    ] }] }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests[0]?.model).toBe('mock')
    expect(model.requests[0]?.tools?.map(tool => tool.name)).toEqual(['coding_only', 'job_kill', 'job_list', 'job_output'])
  })

  it('records executor failure in both task state and original Job outcome', async () => {
    const { ctx, parent } = await boot([textResponse('incomplete')])
    const plan: ExecutionPlan = { name: 'bounded', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work' },
    ] }] }
    const carrierEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    await carrierEntry.fiber!.dispose()
    carrierEntry.options.config = { ...carrierEntry.options.config as AdapterConfig, maxResultBytes: 2 }
    await carrierEntry.init()
    await ctx.loader.await()
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('failed')
    expect(ctx.taskStrategies.inspect(parent, job).error).toContain('result byte limit')
    expect(ctx.jobs.get(job, parent.id).detail).toContain('result byte limit')
  })

  it('canonicalizes traced and original service identities into the same owner store', async () => {
    const { ctx, parent } = await boot()
    const jobs = (ctx.jobs as typeof ctx.jobs & { [symbols.original]: typeof ctx.jobs })[symbols.original]
    expect(ownerRuns(jobs!, parent)).toBe(ownerRuns(ctx.jobs, parent))
  })

  it('selects a configured variant only for matching author preferences', async () => {
    const base: ExecutionPlan = { name: 'base', stages: [{ name: 'base', tasks: [
      { label: 'base', preset: 'coding', instruction: 'base' },
    ] }] }
    const variant: ExecutionPlan = { name: 'fast', stages: [{ name: 'fast', tasks: [
      { label: 'fast', preset: 'coding', instruction: 'fast' },
    ] }] }
    const { ctx } = await boot(undefined, undefined, { strategies: [{ id: 'variant', description: 'variant', plan: base,
      variants: [{ preference: 'speed', equals: 'fast', plan: variant }],
    }] })
    expect(await ctx.taskStrategies.decide('variant', { task: 'task', preferences: { speed: 'fast' } })).toEqual(variant)
    expect(await ctx.taskStrategies.decide('variant', { task: 'task', preferences: { speed: 'slow' } })).toEqual(base)
    expect(await ctx.taskStrategies.decide('variant', { task: 'task' })).toEqual(base)
  })

  it.each([
    { capability: 'agentPreset', step: {}, error: 'preset-selecting' },
    { capability: 'toolFilter', step: { tools: { allow: [] } }, error: 'tool restrictions' },
    { capability: 'agentOptions', step: { model: 'mock' }, error: 'model selection' },
    { capability: 'agentOptions', step: { provider: 'mock' }, error: 'model selection' },
  ])('rejects unsupported child capability $capability before accepting a Job', async ({ capability, step, error }) => {
    const { ctx, parent, model } = await boot()
    Object.assign(ctx.subagents.getProvider('spawn')!.capabilities, { [capability]: false })
    const plan: ExecutionPlan = { name: 'capability', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work', ...step },
    ] }] }
    await expect(ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow(error)
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('rejects a broken preset before child publication', async () => {
    const { ctx, parent, model } = await boot()
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'ef9a660d')!
    await entry.fiber!.dispose()
    const unregister = await ctx.agentPresets.register({ id: 'reviewing', plugins: [{ name: 'cordis:missing-strategy-preset' }] })
    try {
      await expect(ctx.taskStrategies.decide('review-first', { task: 'task' })).rejects.toThrow('Invalid strategy preset')
      expect(ctx.jobs.list(parent.id)).toEqual([])
      expect(model.requests).toHaveLength(0)
    } finally { await unregister() }
  })

  it('rejects a complete plan beyond its captured byte limit', async () => {
    const { ctx, parent, model } = await boot()
    const plan: ExecutionPlan = { name: 'large', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: '中'.repeat(3000) },
    ] }] }
    await expect(ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow('plan exceeds byte limit')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('routes explicit model, provider and both tool filters to original children', async () => {
    const { ctx, parent, model } = await boot()
    const plan: ExecutionPlan = { name: 'routed', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work', model: 'mock', provider: 'mock',
        tools: { allow: ['coding_only'], deny: [] } },
    ] }] }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests[0]).toMatchObject({ model: 'mock', tools: [{ name: 'coding_only' }] })
  })

  it('validates preferences through preview and named dispatch tools', async () => {
    const { ctx, parent } = await boot()
    const preview = await ctx.tools.execute({ callId: ToolCallId('preferences-preview'), name: 'task_strategy_plan',
      arguments: { task: 'task', strategy: 'review-first', preferences: { speed: 'fast' } }, agent: parent,
      signal: new AbortController().signal })
    expect(preview, JSON.stringify(preview.content)).toMatchObject({ isError: false })
    const receipt = await ctx.tools.execute({ callId: ToolCallId('preferences-run'), name: 'task_strategy_run',
      arguments: { task: 'task', strategy: 'review-first', preferences: { speed: 'fast' } }, agent: parent,
      signal: new AbortController().signal })
    expect(receipt.isError).toBe(false)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
  })

  it.each([{}, { strategy: 'review-first', plan: { name: 'unused', stages: [] } }])('rejects ambiguous dispatch without creating a Job: %j', async (selection) => {
    const { ctx, parent, model } = await boot()
    const result = await ctx.tools.execute({ callId: ToolCallId('ambiguous'), name: 'task_strategy_run',
      arguments: { task: 'task', ...selection }, agent: parent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('exactly one')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('rejects dispatch without a calling Agent', async () => {
    const { ctx, model } = await boot()
    ctx.tools.register(strategyTools(ctx.taskStrategies, 'global_strategy', 4096).find(tool => tool.name === 'global_strategy_run')!)
    const result = await ctx.tools.execute({ callId: ToolCallId('no-agent'), name: 'global_strategy_run',
      arguments: { task: 'task', strategy: 'review-first' }, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('calling agent')
    expect(model.requests).toHaveLength(0)
  })

  it('refuses new registrations and work through an unloaded carrier', async () => {
    const { ctx, parent } = await boot()
    const carrier = ctx.taskStrategies
    const plan = await carrier.decide('review-first', { task: 'task' })
    const receipt = await carrier.submit(parent, { requestId: 'closed', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    expect(() => carrier.register({ id: 'late', description: 'late', decide: () => plan })).toThrow('closing')
    await expect(carrier.submit(parent, { requestId: 'late', strategy: 'review-first', task: 'task' }, new AbortController().signal)).rejects.toThrow('closing')
    await expect(carrier.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow('closing')
    expect(() => carrier.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'late' })).toThrow('closing')
  })

  it('releases cancelled admission without evaluating a synchronous author decision', async () => {
    const { ctx, model, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let decisions = 0
    ctx.taskStrategies.register({ id: 'sync-admission', description: 'Synchronous admission', decide: () => {
      decisions++
      return plan
    } })
    const controller = new AbortController()
    const pending = ctx.taskStrategies.submit(parent,
      { requestId: 'sync-admission', strategy: 'sync-admission', task: 'task' }, controller.signal)
    controller.abort(new Error('admission cancelled'))
    await expect(pending).rejects.toThrow('admission cancelled')
    expect(decisions).toBe(0)
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'sync-admission', strategy: 'sync-admission', task: 'task' }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    expect(decisions).toBe(1)
  })

  it('settles owner teardown after capturing a synchronous switch and aborting its child', async () => {
    let entered!: () => void
    const childStarted = new Promise<void>((resolve) => { entered = resolve })
    const { ctx, model, parent, handle } = await boot(['hang'], (adapter) => {
      const stream = adapter.stream.bind(adapter)
      adapter.stream = async function* (request) {
        entered()
        yield* stream(request)
      }
    })
    const target = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let decisions = 0
    ctx.taskStrategies.register({ id: 'sync-switch', description: 'Synchronous switch', decide: () => {
      decisions++
      return target
    } })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'sync-switch-task', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await childStarted
    ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'sync-switch' })
    expect(decisions).toBe(1)
    await handle.dispose()
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(1)
  })

  it('rejects a stale owner after asynchronous preflight even if its session id is reused', async () => {
    const { ctx, model, parent, handle } = await boot()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id: 'delayed', description: 'delayed', decide: () => plan })
    const resolvePreset = ctx.agentPresets.resolve.bind(ctx.agentPresets)
    ctx.agentPresets.resolve = async (name) => { entered(); await gate; return resolvePreset(name) }
    const pending = ctx.taskStrategies.submit(parent, { requestId: 'stale', strategy: 'delayed', task: 'task' }, new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('live owner')
    try {
      await started
      await handle.dispose()
      const replacement = await ctx.agents.create({ sessionId: parent.id, agentOptions: { provider: 'mock', model: 'mock' } })
      release()
      await rejection
      expect(ctx.jobs.list(replacement.agent.id)).toEqual([])
      expect(model.requests).toHaveLength(0)
    } finally {
      release()
      ctx.agentPresets.resolve = resolvePreset
    }
  })

  it('refuses an accepted duplicate receipt from a disposed owner', async () => {
    const { ctx, parent, handle } = await boot()
    const request = { requestId: 'disposed', strategy: 'review-first', task: 'task' }
    const receipt = await ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    await handle.dispose()
    await expect(ctx.taskStrategies.submit(parent, request, new AbortController().signal)).rejects.toThrow('live owner')
  })

  it('rechecks child capabilities without inflating the admitted plan byte count', async () => {
    const { ctx, model, parent } = await boot()
    const plan: ExecutionPlan = { name: 'x', stages: [{ name: 'x', tasks: [
      { label: 'x'.repeat(3000), preset: 'coding', instruction: 'work' },
    ] }] }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests).toHaveLength(1)
  })

  it('reserves equal concurrent submits before resolving author decisions', async () => {
    const { ctx, parent } = await boot()
    expect(typeof ctx.taskStrategies.submit).toBe('function')
    const request = { requestId: 'same-request', strategy: 'review-first', task: 'task' }
    const first = ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    const second = ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    expect(first).toBe(second)
    const receipt = await first
    expect(await second).toEqual(receipt)
    const cancelledDuplicate = new AbortController()
    cancelledDuplicate.abort()
    expect(await ctx.taskStrategies.submit(parent, request, cancelledDuplicate.signal)).toEqual(receipt)
    await expect(ctx.taskStrategies.submit(parent, { ...request, task: 'different' }, new AbortController().signal)).rejects.toThrow('different')
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })

  it('deduplicates preference dictionaries independently of Unicode key insertion order', async () => {
    const { ctx, parent } = await boot()
    const request = { requestId: 'unicode', strategy: 'review-first', task: 'task', preferences: { '\u00e9': 'one', 'e\u0301': 'two' } }
    const receipt = await ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    const repeated = await ctx.taskStrategies.submit(parent, { ...request, preferences: { 'e\u0301': 'two', '\u00e9': 'one' } },
      new AbortController().signal)
    expect(repeated).toEqual(receipt)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })

  it('switches an accepted run after carrier reload while retaining the Job and prior results', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, model, parent } = await boot(undefined, (adapter) => {
      const stream = adapter.stream.bind(adapter)
      let first = true
      adapter.stream = async function* (request) {
        if (first) { first = false; entered(); await gate }
        yield* stream(request)
      }
    })
    expect(typeof ctx.taskStrategies.submit).toBe('function')
    const request = { requestId: 'reload-request', strategy: 'review-first', task: 'task' }
    const receipt = await ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    await started
    try {
      const entry = [...ctx.loader.entries()].find(row => row.options.id === 'task-strategy')!
      await entry.fiber!.dispose()
      await entry.init()
      await ctx.loader.await()
      ctx.taskStrategies.register({ id: 'replacement', description: 'target', decide: () => ({ name: 'replacement', stages: [
        { name: 'deliver', tasks: [{ label: 'deliver', preset: 'coding', instruction: 'Use previous findings' }] },
      ] }) })
      expect((await ctx.taskStrategies.submit(parent, request, new AbortController().signal)).jobId).toBe(receipt.jobId)
      ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'replacement' })
      release()
      expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId)).toMatchObject({ phase: 'completed', binding: { id: 'replacement', epoch: 1 } })
      expect(model.requests).toHaveLength(2)
      expect(JSON.stringify(model.requests[1]!.messages)).toContain('risks found')
      expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
    } finally { release() }
  }, 30_000)

  it('records upper model decisions and original job collection without an API key', async () => {
    let upperStep = 0
    const script: ConstructorParameters<typeof MockAdapter>[0] = Array.from({ length: 10 }, () => (request) => {
      if (request.sessionId !== 'strategy-parent') {
        return textResponse(request.tools?.some(tool => tool.name === 'reviewing_only') ? 'risks found' : 'implemented')
      }
      switch (upperStep++) {
        case 0: return toolCallResponse('preview', 'task_strategy_plan', { strategy: 'review-first', task: 'fix bug' })
        case 1: return toolCallResponse('dispatch', 'task_strategy_run', { strategy: 'review-first', task: 'fix bug' })
        case 2: return toolCallResponse('collect', 'job_output', { job_id: 'strategy-1', wait: true, timeout_ms: 5000 })
        default: return textResponse('Collected the lower tasks')
      }
    })
    const { ctx, parent } = await boot(script)
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'fix bug using my review-first strategy' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const events = parent.session.snapshotEvents()
    const toolResults = events.filter(event => event.type === 'tool/result').map(event => event.data.message)
    const decisionResults = toolResults.filter(message => ['preview', 'dispatch'].includes(message.source.callId))
      .map(message => ({ callId: message.source.callId, content: message.content, isError: message.isError }))
    expect(decisionResults).toMatchSnapshot('recorded upper strategy decisions')
    expect(JSON.stringify(toolResults.filter(message => message.source.callId === 'collect'))).toContain('implemented')
    expect(ctx.jobs.get('strategy-1' as import('@deepseek-ai/dsh-jobs').JobId, parent.id).status).toBe('completed')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
  })

  it('runs original DSH children with independent presets and progress', async () => {
    const { ctx, model, parent } = await boot()
    const decision = await ctx.taskStrategies.decide('review-first', { task: 'fix the bug' })
    const children: { preset: string | undefined; tools: string[] }[] = []
    ctx.on('subagent/start', (info) => {
      const child = ctx.agents.get(info.id)!
      children.push({ preset: child.session.header.agentPreset, tools: ctx.tools.schemas(child).map(tool => tool.name) })
    })
    expect(decision).toMatchSnapshot('model-visible execution plan')
    const jobId = await ctx.taskStrategies.start(parent, 'fix the bug', decision, new AbortController().signal)
    const terminal = await ctx.jobs.wait(jobId, 5000, parent.id)
    expect(terminal.status).toBe('completed')
    expect(model.requests.map(request => request.tools?.map(tool => tool.name).filter(name => name.endsWith('_only')))).toEqual([
      ['reviewing_only'], ['coding_only'],
    ])
    expect(children.map(child => child.preset)).toEqual(['reviewing', 'coding'])
    expect(children.flatMap(child => child.tools).filter(name => name.startsWith('task_strategy_'))).toEqual([])
    expect(JSON.stringify(model.requests[1]?.messages)).toContain('risks found')
    const output = ctx.jobs.read(jobId, parent.id)
    expect(output.chunks.map(chunk => chunk.text).join('')).toContain('reviewing')
    const report = JSON.parse(output.result!) as ExecutionResult
    expect(report.results.map((row: { label: string; output: string }) => ({ label: row.label, output: row.output })))
      .toMatchSnapshot('model-visible execution result')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
  })

  it('exposes upper decision tools without exposing them to lower children', async () => {
    const { ctx, parent } = await boot()
    expect(ctx.tools.schemas(parent).map(tool => tool.name)).toContain('task_strategy_run')
    const value = await ctx.tools.execute({ callId: ToolCallId('strategy-list'), name: 'task_strategy_list', arguments: {},
      agent: parent, signal: new AbortController().signal })
    expect(value.isError).toBe(false)
    const text = value.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const catalog = JSON.parse(text) as ReturnType<Adapter['catalog']>
    expect(catalog.strategies)
      .toEqual(ctx.taskStrategies.list())
    expect(catalog.presets)
      .toEqual(['coding', 'reviewing'])
  })

  it('rejects unauthorized presets before any child starts', async () => {
    const { ctx, model, parent } = await boot()
    const invalid: ExecutionPlan = { name: 'bad', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'not-allowed', instruction: 'work' },
    ] }] }
    await expect(ctx.taskStrategies.start(parent, 'task', invalid, new AbortController().signal)).rejects.toThrow('not allowed')
    expect(model.requests).toHaveLength(0)
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })

  it('keeps accepted jobs alive when the strategy adapter unloads', async () => {
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    let childSignal: AbortSignal | undefined
    const { ctx, parent } = await boot(['hang'], (model) => {
      const stream = model.stream.bind(model)
      model.stream = async function* (options) {
        childSignal = options.signal
        requestStarted()
        yield* stream(options)
      }
    })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    const jobId = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    await started
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    expect(ctx.tools.schemas(parent).map(tool => tool.name)).not.toContain('task_strategy_run')
    expect(childSignal!.aborted).toBe(false)
    expect(ctx.jobs.list(parent.id)).toEqual([expect.objectContaining({ id: jobId, status: 'running' })])
  }, 30_000)

  it('keeps accepted jobs cancellable after the strategy adapter unloads', async () => {
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    let childSignal: AbortSignal | undefined
    const { ctx, parent } = await boot(['hang'], (model) => {
      const stream = model.stream.bind(model)
      model.stream = async function* (options) {
        childSignal = options.signal
        requestStarted()
        yield* stream(options)
      }
    })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    const jobId = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    await started
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    expect(childSignal!.aborted).toBe(false)
    expect(ctx.jobs.kill(jobId, parent.id, 'cancelled by the user')).toBe('requested')
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('killed')
    expect(childSignal!.aborted).toBe(true)
    expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
  }, 30_000)

  it('rejects admission when the adapter unloads during preflight', async () => {
    const { ctx, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const preflightEntered = new Promise<void>((resolve) => { entered = resolve })
    const resolvePreset = ctx.agentPresets.resolve.bind(ctx.agentPresets)
    ctx.agentPresets.resolve = async (name) => {
      entered()
      await gate
      return resolvePreset(name)
    }
    try {
      const pending = ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
      await preflightEntered
      await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
      release()
      await expect(pending).rejects.toThrow('Strategy component is closing')
      expect(ctx.jobs.list(parent.id)).toEqual([])
      expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
    } finally {
      release()
      ctx.agentPresets.resolve = resolvePreset
    }
  }, 30_000)

  it.each([{}, { allow: ['unknown'] }, { deny: ['run_code'] }])('rejects invalid later-stage filters before starting work: %j', async (tools) => {
    const { ctx, model, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    plan.stages[1]!.tasks[0] = { ...plan.stages[1]!.tasks[0]!, tools }
    await expect(ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow()
    expect(model.requests).toHaveLength(0)
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })

  it.each([512, 4096])('bounds the dispatch acknowledgement at %i bytes and rejects malformed model plans', async (maxBytes) => {
    const { ctx, parent } = await boot()
    parent.ctx.tools.register(strategyTools(ctx.taskStrategies, 'bounded', maxBytes).find(tool => tool.name === 'bounded_run')!)
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    const value = await ctx.tools.execute({ callId: ToolCallId('long-name'), name: 'bounded_run',
      arguments: { task: 'task', plan: { ...plan, name: '中'.repeat(1600) } }, agent: parent, signal: new AbortController().signal })
    const text = value.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(value.isError).toBe(false)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(maxBytes)
    expect(text).toContain('truncated')
    expect(JSON.parse(text)).toMatchObject({ jobId: 'strategy-1' })
    const malformed = await ctx.tools.execute({ callId: ToolCallId('malformed'), name: 'task_strategy_run',
      arguments: { task: 'task', plan: { name: 'bad', stages: 'not an array' } }, agent: parent, signal: new AbortController().signal })
    expect(malformed.isError).toBe(true)
  })

  it('applies a valid selected-preset filter and preserves an explicit empty allowlist', async () => {
    const { ctx, model, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    plan.stages[0]!.tasks[0] = { ...plan.stages[0]!.tasks[0]!, tools: { allow: ['reviewing_only'] } }
    plan.stages[1]!.tasks[0] = { ...plan.stages[1]!.tasks[0]!, tools: { allow: [] } }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests.map(request => request.tools?.map(tool => tool.name) ?? [])).toEqual([['reviewing_only'], []])
  })
})

interface CodexRecording {
  fingerprint: string
  source: { captured: string; scope: string }
  task: string
  request: { provider: string; label: string; prompt: ContentBlock[] }
  response: { stopReason: string; output: ContentBlock[] }
}
const codexRecordings = JSON.parse(readFileSync(new URL('./fixtures/codex-recordings.json', import.meta.url), 'utf8')) as CodexRecording[]
function replayCodex(provider: string, label: string | undefined, prompt: readonly ContentBlock[]): CodexRecording {
  const fingerprint = createHash('sha256').update(JSON.stringify({ provider, label, prompt })).digest('hex')
  const fixture = codexRecordings.find(row => row.fingerprint === fingerprint)
  if (fixture === undefined) throw new Error('Missing recorded orchestration response; live calls are forbidden in replay')
  return fixture
}
describe('codex orchestration boundary replay (no network)', () => {
  it.each(codexRecordings)('replays the recorded $response.stopReason for boundary $fingerprint', async (recording) => {
    const { ctx, parent } = await boot([], undefined, { allowedExecutors: ['codex'] })
    const dispose = vi.fn(async () => {})
    const start = vi.fn(async (request: SubagentStartRequest) => {
      const fixture = replayCodex('codex', request.label, request.prompt)
      return { id: SessionId('codex-replay-child'), localAgent: undefined,
        result: Promise.resolve({ stopReason: fixture.response.stopReason as 'completed', output: fixture.response.output }), dispose }
    })
    ctx.subagents.registerProvider({ name: 'codex', inheritsParentContext: false, capabilities: {
      agentPreset: false, toolFilter: false, agentOptions: false, outputSchema: false, depthLimit: false, persona: false,
    }, start })
    await ctx.plugin(CodexOrchestrator)
    const receipt = await ctx.taskStrategies.submit(parent, { requestId: recording.fingerprint, task: recording.task, strategy: 'codex-native' }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    expect(ctx.taskRuns.inspect(parent, receipt.jobId).results).toEqual([{ sessionId: 'codex-replay-child',
      stopReason: recording.response.stopReason, stage: 'native orchestration', label: 'codex-native',
      output: recording.response.output.filter(block => block.type === 'text').map(block => block.text).join('\n') }])
    expect(dispose).toHaveBeenCalledTimes(1)
  })
  it('refuses a changed child prompt instead of recording a live call', () => {
    expect(() => replayCodex('codex', 'codex-native', [{ type: 'text', text: 'unrecorded prompt' }]))
      .toThrow('live calls are forbidden in replay')
    expect(() => replayCodex('codex', 'other-label', codexRecordings[0]!.request.prompt))
      .toThrow('live calls are forbidden in replay')
  })
})

describe('Loader-composed task messaging', () => {
  it('delivers a task-owner adjustment to the active child', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { ctx, parent, model } = await bootTaskRuntime([
      { chunks: textResponse('first'), gate: gate.promise }, { chunks: textResponse('adjusted') },
    ], undefined, true)
    const jobId = await ctx.taskStrategies.start(parent, 'work', workPlan, new AbortController().signal)
    let messageId = ''
    let childId = SessionId('pending')
    try {
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      const inspection = await ctx.tools.execute({ callId: ToolCallId('inspect-members'), name: 'task_strategy_inspect',
        arguments: { jobId }, agent: parent, signal: new AbortController().signal })
      expect(inspection.isError).toBe(false)
      const parsedView: unknown = JSON.parse(inspection.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      if (!isActiveMemberView(parsedView) || parsedView.activeMembers[0] === undefined) throw new Error('Missing active member')
      childId = parsedView.activeMembers[0].sessionId
      expect(childId).toBe(model.requests[0]?.sessionId)
      const receipt = await ctx.tools.execute({ callId: ToolCallId('send-adjustment'), name: 'task_strategy_message',
        arguments: { jobId, childId, text: 'adjustment_746: keep the public API' }, agent: parent,
        signal: new AbortController().signal })
      expect(receipt.isError).toBe(false)
      const parsedReceipt: unknown = JSON.parse(receipt.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      if (!isMessageReceipt(parsedReceipt)) throw new Error('Missing message receipt identity')
      expect(Object.keys(parsedReceipt)).toEqual(['messageId'])
      messageId = parsedReceipt.messageId
      expect(model.requests).toHaveLength(1)
      expect(ctx.tools.get('task_strategy_message', parent)?.description).toContain('Inbox acceptance')
      expect(ctx.tools.get('task_strategy_inspect', parent)?.description).toContain('active')
    } finally { gate.resolve(undefined) }
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
    expect(model.requests).toHaveLength(2)
    expect(JSON.stringify(model.requests[1]!.messages)).toContain('adjustment_746: keep the public API')
    const stored = await ctx.sessionPersistence.open(childId, 'read')
    try {
      const events = (await stored.read()).events
      expect(events.some(event => event.type === 'user/message' && event.data.id === messageId
        && event.data.source.kind === 'agent-message'
        && event.data.source.senderSessionId === parent.id
        && JSON.stringify(event.data.content).includes('adjustment_746'))).toBe(true)
    } finally { await stored.close() }
  })

  it('does not replace an unsupported native target with DSH execution', async () => {
    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const { ctx, parent, model } = await bootTaskRuntime([], { allowedExecutors: ['native'] })
    ctx.taskRuns.registerExecutor({ id: 'native', description: 'native engine', check: () => {},
      execute: async () => { entered.resolve(undefined); await gate.promise; return { stopReason: 'completed', output: 'done' } },
    })
    const jobId = await ctx.taskStrategies.start(parent, 'native work', { name: 'native', stages: [{ name: 'native',
      tasks: [{ label: 'native worker', executor: 'native', instruction: 'work' }] }] }, new AbortController().signal)
    try {
      await entered.promise
      expect(ctx.taskStrategies.inspect(parent, jobId).activeMembers).toEqual([])
      const result = await ctx.tools.execute({ callId: ToolCallId('native-message'), name: 'task_strategy_message',
        arguments: { jobId, childId: 'native-session', text: 'adjust' }, agent: parent, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('not an active DSH member')
      expect(model.requests).toHaveLength(0)
      expect(ctx.agents.list()).toHaveLength(1)
    } finally { gate.resolve(undefined) }
  })

  it('removes inspect and message tools when the carrier is disposed', async () => {
    const { ctx, parent } = await bootTaskRuntime([])
    expect(ctx.tools.get('task_strategy_inspect', parent)).toBeDefined()
    expect(ctx.tools.get('task_strategy_message', parent)).toBeDefined()
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    expect(ctx.tools.get('task_strategy_inspect', parent)).toBeUndefined()
    expect(ctx.tools.get('task_strategy_message', parent)).toBeUndefined()
  })

  it('admits coordination controls at enabled root entry while denying business and foreign-task messages', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { ctx, parent, model } = await bootTaskRuntime([
      { chunks: textResponse('first'), gate: gate.promise }, { chunks: textResponse('adjusted') },
    ], { entry: { enabled: true }, toolPrefix: 'coord' })
    const jobId = await ctx.taskStrategies.start(parent, 'work', workPlan, new AbortController().signal)
    const foreign = await ctx.agents.create({ sessionId: SessionId('foreign-message-owner') })
    try {
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      const childId = model.requests[0]!.sessionId
      if (childId === undefined) throw new Error('Model request has no session identity')
      const assembly = await parent.ctx.systemPrompt.assemble({ scope: parent, agent: parent })
      expect(assembly.tools.map(tool => tool.name)).toContain('coord_inspect')
      expect(assembly.tools.map(tool => tool.name)).toContain('coord_message')
      expect(assembly.tools.map(tool => tool.name)).not.toContain('coding_only')
      const execute = (name: string, args: object, agent = parent) => ctx.tools.execute({
        callId: ToolCallId(name), name, arguments: args, agent, signal: new AbortController().signal,
      })
      expect((await execute('coord_inspect', { jobId })).isError).toBe(false)
      expect((await execute('coord_message', { jobId, childId, text: 'adjust' })).isError).toBe(false)
      expect((await execute('coding_only', {})).isError).toBe(true)
      expect((await execute('coord_message', { jobId, childId, text: 'foreign' }, foreign.agent)).isError).toBe(true)
      expect(ctx.tools.get('coord_message', ctx.agents.get(childId))).toBeUndefined()
    } finally { gate.resolve(undefined) }
  })

  it('keeps a complete receipt identity when its presentation exceeds the output bound', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { ctx, parent, model } = await bootTaskRuntime([
      { chunks: textResponse('first'), gate: gate.promise }, { chunks: textResponse('adjusted') },
    ])
    parent.ctx.tools.register(strategyTools(ctx.taskStrategies, 'tiny', 1).find(tool => tool.name === 'tiny_message')!)
    const jobId = await ctx.taskStrategies.start(parent, 'work', workPlan, new AbortController().signal)
    try {
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      const childId = model.requests[0]!.sessionId
      if (childId === undefined) throw new Error('Model request has no session identity')
      const result = await ctx.tools.execute({ callId: ToolCallId('tiny-message'), name: 'tiny_message',
        arguments: { jobId, childId, text: 'adjust' }, agent: parent, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      const id = ctx.agents.get(childId)!.inbox.nextStep[0]!.id
      expect(JSON.stringify(result.content)).toContain(id)
      expect(JSON.stringify(result.content)).toContain('already accepted')
    } finally { gate.resolve(undefined) }
  })
})
