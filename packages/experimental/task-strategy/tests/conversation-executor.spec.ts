import { expect, it, vi } from 'vitest'
import { bootTaskRuntime, taskRules } from './task-runtime-fixture.ts'
import { maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { ExecutionPlan } from '../src/types.ts'
import type { TaskMemberSessions } from '../src/member-session-types.ts'

const signal = new AbortController().signal
const memberStep = { label: 'worker', preset: 'coding', instruction: 'work' }
const plan: ExecutionPlan = { name: 'conversation', stages: [{ name: 'work', tasks: [
  { label: 'lead', executor: 'conversation', instruction: 'manage the work' },
] }] }
const rules = { ...taskRules, allowedExecutors: ['conversation'] }

it('keeps the original Job open through failed-turn feedback and explicit same-member recovery', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: maxTokensResponse('blocked') }, { chunks: textResponse('fixed') }], undefined, true)
  let retained: TaskMemberSessions | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'explicit recovery', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing task-owned member context')
      retained = context.members
      const first = await context.members.open(memberStep, 'initial', childSignal)
      expect(first).toMatchObject({ kind: 'settled', result: { stopReason: 'max-tokens' } })
      const second = await context.members.continue(first.sessionId, 'repair', childSignal)
      expect(second.sessionId).toBe(first.sessionId)
      if (second.kind !== 'settled') throw new Error(second.error)
      return second.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ phase: 'completed', startedTasks: 3, activeMembers: [] })
  expect(model.requests).toHaveLength(2)
  expect(retained?.inspect()[0]?.phase).toBe('closed')
})

it('lets an executor report observed failure without automatically continuing', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: maxTokensResponse('blocked') }], undefined, true)
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'report', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(memberStep, 'initial', childSignal)
      if (first.kind !== 'settled') throw new Error(first.error)
      return first.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('failed')
  expect(model.requests).toHaveLength(1)
  expect(ctx.taskRuns.inspect(parent, id).startedTasks).toBe(2)
})

it('charges nested turns against the original cumulative task limit', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('done') }], undefined, true)
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'limits', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(memberStep, 'initial', childSignal)
      await expect(context.members.continue(first.sessionId, 'again', childSignal)).rejects.toThrow(/cumulative task limit/)
      return { stopReason: 'completed', output: 'within limit' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, { ...rules, maxTasks: 2 }, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(ctx.taskRuns.inspect(parent, id).startedTasks).toBe(2)
  expect(model.requests).toHaveLength(1)
})

it('closes retained members on task cancellation while the executor awaits a decision', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('done') }], undefined, true)
  const waiting = Promise.withResolvers<undefined>()
  let members: TaskMemberSessions | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'wait', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      members = context.members
      await members.open(memberStep, 'initial', childSignal)
      waiting.resolve(undefined)
      await new Promise<void>((resolve) => { childSignal.addEventListener('abort', () => { resolve() }, { once: true }); if (childSignal.aborted) resolve() })
      const member = members.inspect()[0]
      if (member === undefined) throw new Error('Missing retained member')
      await expect(members.continue(member.sessionId, 'late', signal)).rejects.toThrow()
      return { stopReason: 'cancelled', output: '' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  await vi.waitFor(() => { expect(members?.inspect()).toHaveLength(1) })
  await waiting.promise
  ctx.taskRuns.cancel(parent, id)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('killed')
  expect(members?.inspect()[0]?.phase).toBe('closed')
  expect(model.requests).toHaveLength(1)
})

it('preserves a four-argument native executor and creates no local sessions implicitly', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([])
  const execute = vi.fn(async (_parent, _step, _prompt, childSignal) => {
    childSignal.throwIfAborted()
    return { stopReason: 'completed', output: 'native result', sessionId: 'native-session' }
  })
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'native', check: () => {}, execute })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(execute).toHaveBeenCalledOnce()
  expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ activeMembers: [], startedTasks: 1 })
  expect(model.requests).toHaveLength(0)
})

it('charges a rejected attempted member admission without consuming a model call', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([])
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'invalid member', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      await expect(context.members.open({ ...memberStep, preset: 'unknown' }, 'initial', childSignal)).rejects.toThrow(/allowed/)
      return { stopReason: 'completed', output: 'reported' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(ctx.taskRuns.inspect(parent, id).startedTasks).toBe(2)
  expect(model.requests).toHaveLength(0)
})
