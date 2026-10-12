import { expect, it, vi } from 'vitest'
import { bootTaskRuntime, taskRules } from './task-runtime-fixture.ts'
import { maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import * as activationResults from '../../../subagent/subagent/src/activation.ts'
import type { TaskMemberTurnOutcome } from '../src/member-session-types.ts'
import type { ExecutionPlan } from '../src/types.ts'

const signal = new AbortController().signal
const step = { label: 'member', preset: 'coding', instruction: 'work' }
const plan: ExecutionPlan = { name: 'conversation', stages: [{ name: 'work', tasks: [
  { label: 'lead', executor: 'conversation', instruction: 'coordinate' },
] }] }
const rules = { ...taskRules, allowedExecutors: ['conversation'] }

it('logs exact accepted identities and sender, retains history, and waits inside the original Job for an explicit decision', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: maxTokensResponse('blocked evidence') },
    { chunks: textResponse('recovered result') }], undefined, true)
  const decision = Promise.withResolvers<undefined>()
  const ready = Promise.withResolvers<TaskMemberTurnOutcome>()
  let second: TaskMemberTurnOutcome | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'decision', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(step, 'original work', childSignal)
      ready.resolve(first)
      await decision.promise
      second = await context.members.continue(first.sessionId, 'chosen repair', childSignal)
      if (second.kind !== 'settled') throw new Error(second.error)
      return second.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  const first = await ready.promise
  try {
    expect(first).toMatchObject({ kind: 'settled', result: { stopReason: 'max-tokens', output: 'blocked evidence' } })
    expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ phase: 'running', startedTasks: 2, activeMembers: [] })
    await expect(ctx.taskRuns.sendMessage(parent, id, { childId: first.sessionId, text: 'late active-only input' }, signal))
      .rejects.toThrow(/active DSH member/)
    expect(model.requests).toHaveLength(1)
  } finally { decision.resolve(undefined) }
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(second?.sessionId).toBe(first.sessionId)
  expect(model.requests.map(request => request.sessionId)).toEqual([first.sessionId, first.sessionId])
  expect(JSON.stringify(model.requests[1].messages)).toContain('blocked evidence')
  expect(JSON.stringify(model.requests[1].messages)).toContain('chosen repair')
  const stored = await loadStoredSession(ctx.sessionPersistence, first.sessionId)
  const inputs = stored.events.filter(event => event.type === 'user/message')
  expect(inputs).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ id: first.messageId }) }))
  expect(inputs).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ id: second?.messageId,
    source: { kind: 'agent-message', form: 'relay', senderSessionId: parent.id } }) }))
  expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ phase: 'completed', startedTasks: 3, activeMembers: [] })
})

it('cancels a continued activation and drains it without a post-cancel wake', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('first') },
    { chunks: textResponse('not completed'), gate: gate.promise }], undefined, true)
  let followup: TaskMemberTurnOutcome | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'cancel', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(step, 'first', childSignal)
      followup = await context.members.continue(first.sessionId, 'next', childSignal)
      if (followup.kind !== 'settled') throw new Error(followup.error)
      return followup.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  await vi.waitFor(() => { expect(model.requests).toHaveLength(2) })
  ctx.taskRuns.cancel(parent, id)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('killed')
  expect(followup).toMatchObject({ kind: 'settled', result: { stopReason: 'aborted' } })
  expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
  expect(ctx.agents.get(model.requests[0].sessionId)).toBeUndefined()
  gate.resolve(undefined)
  expect(model.requests).toHaveLength(2)
})

it('reports unavailable continuation without replacing the original member or backend', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('first') }], undefined, true, false)
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'missing capability', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(step, 'first', childSignal)
      await expect(context.members.continue(first.sessionId, 'next', childSignal)).rejects.toMatchObject({ code: 'CONTINUATION_UNAVAILABLE' })
      expect(context.members.inspect()).toEqual([{ sessionId: first.sessionId, label: step.label, phase: 'settled' }])
      return { stopReason: 'failed', output: 'Continuation unavailable' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('failed')
  expect(model.requests).toHaveLength(1)
  expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
})

it('exposes a capture failure as unobserved after actual execution without replay', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('executed once') }], undefined, true)
  const capture = vi.spyOn(activationResults, 'captureLocalResult').mockImplementationOnce(() => { throw new Error('capture failed') })
  let observed: TaskMemberTurnOutcome | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'unknown', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      observed = await context.members.open(step, 'first', childSignal)
      return { stopReason: 'failed', output: 'Report unobserved result' }
    } })
  try {
    const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
    expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('failed')
    expect(observed).toMatchObject({ kind: 'unobserved', error: expect.stringContaining('capture failed') })
    expect(model.requests).toHaveLength(1)
    expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
  } finally { capture.mockRestore() }
})

it('drains a member still executing when its owning executor returns', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('late'), gate: gate.promise }], undefined, true)
  let pending: Promise<TaskMemberTurnOutcome> | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'owned cleanup', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      pending = context.members.open(step, 'first', childSignal)
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      return { stopReason: 'completed', output: 'executor finished' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(await pending).toMatchObject({ kind: 'settled', result: { stopReason: 'aborted' } })
  expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
  expect(ctx.agents.get(model.requests[0].sessionId)).toBeUndefined()
  gate.resolve(undefined)
})
