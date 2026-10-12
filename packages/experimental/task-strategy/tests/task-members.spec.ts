import { describe, expect, it, vi } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { executeDshChild } from '../src/dsh-child.ts'
import { liveParent } from './live-parent.ts'
import { bootTaskRuntime, taskRules, workPlan } from './task-runtime-fixture.ts'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

describe('active task members', () => {
  it('publishes an active child before its result and removes it after cleanup', async () => {
    const gate = Promise.withResolvers<undefined>()
    const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('done'), gate: gate.promise }])
    const jobId = await ctx.taskRuns.start(parent, 'work', workPlan, taskRules, new AbortController().signal)
    try {
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      const view = ctx.taskRuns.inspect(parent, jobId)
      expect(view.activeMembers).toEqual([{ sessionId: model.requests[0]!.sessionId, label: 'worker' }])
      const member = view.activeMembers?.[0]
      if (member === undefined) throw new Error('Missing active member')
      Object.assign(member, { label: 'mutated' })
      expect(ctx.taskRuns.inspect(parent, jobId).activeMembers?.[0]?.label).toBe('worker')
    } finally { gate.resolve(undefined) }
    await ctx.jobs.wait(jobId, 5000, parent.id)
    expect(ctx.taskRuns.inspect(parent, jobId).activeMembers).toEqual([])
  })

  it.each(['success', 'result failure', 'cleanup failure'] as const)('removes a child after %s', async (outcome) => {
    const { ctx, parent } = await liveParent()
    const result = Promise.withResolvers<{ stopReason: 'completed'; output: [] }>()
    const members = new Set<SessionId>()
    const childId = SessionId('member')
    const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
      startActivation: async () => ({ childId, messageId: MessageId('accepted'), result: result.promise,
        dispose: async () => { if (outcome === 'cleanup failure') throw new Error('cleanup failed') },
      }),
    } }
    const execution = executeDshChild(services, parent, 'spawn', workPlan.stages[0]!.tasks[0]!,
      'work', new AbortController().signal, 8192, (id) => { members.add(id); return () => { members.delete(id) } })
    const observed = execution.then(value => ({ value }), (error: unknown) => ({ error }))
    try { await vi.waitFor(() => { expect(members.has(childId)).toBe(true) }) }
    finally {
      if (outcome === 'result failure') result.reject(new Error('result failed'))
      else result.resolve({ stopReason: 'completed', output: [] })
    }
    const settled = await observed
    expect(members.size).toBe(0)
    if (outcome === 'success') expect(settled).toHaveProperty('value.stopReason', 'completed')
    else expect(settled).toHaveProperty('error.message', outcome === 'result failure' ? 'result failed' : 'cleanup failed')
  })

  it('does not register an external executor as a DSH member', async () => {
    const gate = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const { ctx, parent } = await bootTaskRuntime([])
    ctx.taskRuns.registerExecutor({ id: 'external', description: 'external backend', check: () => {},
      execute: async () => { entered.resolve(undefined); await gate.promise; return { stopReason: 'completed', output: 'done' } },
    })
    const jobId = await ctx.taskRuns.start(parent, 'work', {
      name: 'external', stages: [{ name: 'work', tasks: [{ label: 'external', executor: 'external', instruction: 'work' }] }],
    }, { ...taskRules, allowedExecutors: ['external'] }, new AbortController().signal)
    try { await entered.promise; expect(ctx.taskRuns.inspect(parent, jobId).activeMembers).toEqual([]) }
    finally { gate.resolve(undefined) }
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
  })
})
