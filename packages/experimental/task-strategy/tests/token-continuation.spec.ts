import { expect, it } from 'vitest'
import { bootTaskRuntime, taskRules } from './task-runtime-fixture.ts'
import { maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import type { ExecutionPlan } from '../src/types.ts'

const signal = new AbortController().signal
const waitMs = 30_000
const plan: ExecutionPlan = { name: 'research', stages: ['criteria', 'research', 'verify'].map(name => ({
  name, tasks: [{ label: name, preset: 'coding', instruction: name, maxTokens: 256 }],
})) }

it('continues a truncated node in the same session before running dependent research and verification', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: maxTokensResponse('Criteria: ') },
    { chunks: textResponse('complete criteria') },
    { chunks: textResponse('verified project sources') },
    { chunks: textResponse('final research report') },
  ], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'Find open-source architectures', plan, taskRules, signal)
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('completed')
  const view = ctx.taskRuns.inspect(parent, id)
  expect(view).toMatchObject({ phase: 'completed', completedStages: 3, startedTasks: 3, activeMembers: [] })
  expect(view.results.map(row => [row.label, row.stopReason, row.output])).toEqual([
    ['criteria', 'completed', 'Criteria: complete criteria'],
    ['research', 'completed', 'verified project sources'],
    ['verify', 'completed', 'final research report'],
  ])
  expect(model.requests).toHaveLength(4)
  expect(model.requests[1]!.sessionId).toBe(model.requests[0]!.sessionId)
  expect(JSON.stringify(model.requests[1]!.messages)).toContain('Criteria: ')
  expect(model.requests.map(request => request.maxTokens)).toEqual([256, 256, 256, 256])
  expect(view.results[0]!.usage?.modelCalls).toBe(2)
  const initialSessionId = model.requests[0]!.sessionId
  if (initialSessionId === undefined) throw new Error('initial model request has no session id')
  const stored = await loadStoredSession(ctx.sessionPersistence, initialSessionId)
  const inputs = stored.events.filter(event => event.type === 'user/message')
  expect(inputs.at(-1)?.data.content.filter(block => block.type === 'text').map(block => block.text)).toMatchInlineSnapshot(`
    [
      "Agent task-owner sent a message: ",
      "The previous response reached the model output limit. Continue the same task from the existing conversation and completed tool results. Do not restart the task or repeat completed actions or text. Continue from the cutoff and finish the remaining work. If a structured result is required, submit a complete concise value through structured_output.",
    ]
  `)
}, waitMs)

it('keeps repeated output-limit continuations inside one logical task', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([
    ...Array.from({ length: 4 }, () => ({ chunks: maxTokensResponse('') })),
    { chunks: textResponse('complete criteria') },
    { chunks: textResponse('sources') },
    { chunks: textResponse('report') },
  ], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'research', plan, { ...taskRules, maxTasks: 3 }, signal)
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('completed')
  expect(model.requests).toHaveLength(7)
  expect(new Set(model.requests.slice(0, 5).map(request => request.sessionId)).size).toBe(1)
  expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ completedStages: 3, startedTasks: 3, usage: { modelCalls: 7 } })
}, waitMs)

it('retains earlier answer fragments when the model continues from a cutoff', async () => {
  const { ctx, parent } = await bootTaskRuntime([
    { chunks: maxTokensResponse('LangGraph: ') },
    { chunks: maxTokensResponse('checkpoint; ') },
    { chunks: textResponse('Temporal: event history.') },
  ], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'research', { name: 'answer', stages: [plan.stages[0]!] }, taskRules, signal)
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('completed')
  expect(ctx.taskRuns.inspect(parent, id).results[0]!.output).toBe('LangGraph: checkpoint; Temporal: event history.')
}, waitMs)

it('accepts a repeated full answer prefix as a replacement instead of duplicating it', async () => {
  const { ctx, parent } = await bootTaskRuntime([
    { chunks: maxTokensResponse('LangGraph: checkpoint; ') },
    { chunks: maxTokensResponse('LangGraph: checkpoint; Temporal: ') },
    { chunks: textResponse('event history.') },
  ], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'research', { name: 'answer', stages: [plan.stages[0]!] }, taskRules, signal)
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('completed')
  expect(ctx.taskRuns.inspect(parent, id).results[0]!.output).toBe('LangGraph: checkpoint; Temporal: event history.')
}, waitMs)

it('merges a retransmitted partial line at the cutoff without duplicating it', async () => {
  const { ctx, parent } = await bootTaskRuntime([
    { chunks: maxTokensResponse('ITEM-01. complete\nITEM-02. Graph checkpoints preserve') },
    { chunks: textResponse('ITEM-02. Graph checkpoints preserve completed state.\nALL-DONE') },
  ], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'research', { name: 'answer', stages: [plan.stages[0]!] }, taskRules, signal)
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('completed')
  expect(ctx.taskRuns.inspect(parent, id).results[0]!.output).toBe(
    'ITEM-01. complete\nITEM-02. Graph checkpoints preserve completed state.\nALL-DONE')
}, waitMs)

it('restores structured output capture when a truncated planner is reconstructed', async () => {
  const workflow = { summary: 'research projects', domain: 'problem-research', artifacts: [],
    nodes: [{ id: 'n1', instruction: 'inspect official sources', dependencies: [] }] }
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: maxTokensResponse('') },
    { chunks: toolCallResponse('proposal', 'structured_output', workflow) },
    { chunks: textResponse('report') },
  ], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'research', { name: 'structured', stages: [
    { name: 'plan', tasks: [{ label: 'plan', preset: 'coding', instruction: 'plan', workflowOutput: true, maxTokens: 256 }] },
    { name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'use the plan' }] },
  ] }, taskRules, signal)
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('completed')
  expect(ctx.taskRuns.inspect(parent, id).results[0]!.workflow).toEqual(workflow)
  expect(model.requests[1]!.tools?.some(tool => tool.name === 'structured_output')).toBe(true)
}, waitMs)

it('honors user cancellation during continuation and does not start dependent nodes', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: maxTokensResponse('partial') },
    { chunks: textResponse('unfinished'), gate: gate.promise },
  ], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'research', plan, taskRules, signal)
  await expect.poll(() => model.requests.length, { timeout: waitMs }).toBe(2)
  expect(ctx.jobs.kill(id, parent.id)).toBe('requested')
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('killed')
  expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ phase: 'cancelled', startedTasks: 1, activeMembers: [] })
  expect(model.requests).toHaveLength(2)
}, waitMs)

it('keeps genuine model failures visible instead of treating them as output-limit continuations', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([], undefined, true)
  const id = await ctx.taskRuns.start(parent, 'research', plan, taskRules, signal)
  expect((await ctx.jobs.wait(id, waitMs, parent.id)).status).toBe('failed')
  expect(model.requests).toHaveLength(1)
  expect(ctx.taskRuns.inspect(parent, id).results[0]!.stopReason).toBe('error')
}, waitMs)
