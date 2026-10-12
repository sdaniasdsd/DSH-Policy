import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootTaskRuntime, taskRules, workPlan } from './task-runtime-fixture.ts'

const signal = () => new AbortController().signal

async function runningTask() {
  const gate = Promise.withResolvers<undefined>()
  const runtime = await bootTaskRuntime([
    { chunks: textResponse('first'), gate: gate.promise }, { chunks: textResponse('adjusted') },
  ])
  const jobId = await runtime.ctx.taskRuns.start(runtime.parent, 'work', workPlan, taskRules, signal())
  await vi.waitFor(() => { expect(runtime.model.requests).toHaveLength(1) })
  return { ...runtime, jobId, childId: runtime.model.requests[0]!.sessionId, gate }
}

describe('task-owner messages', () => {
  it('returns inbox acceptance without claiming processing', async () => {
    const { ctx, parent, jobId, childId, model, gate } = await runningTask()
    try {
      const receipt = await ctx.taskRuns.sendMessage(parent, jobId, { childId, text: 'adjust work' }, signal())
      expect(Object.keys(receipt)).toEqual(['messageId'])
      expect(ctx.agents.get(childId)?.inbox.nextStep).toContainEqual(expect.objectContaining({
        id: receipt.messageId, content: expect.arrayContaining([{ type: 'text', text: 'adjust work' }]),
        source: { kind: 'agent-message', form: 'relay', senderSessionId: parent.id },
      }))
      expect(model.requests).toHaveLength(1)
    } finally { gate.resolve(undefined) }
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
    expect(model.requests).toHaveLength(2)
  })

  it('rejects a different owner or task', async () => {
    const { ctx, parent, jobId, childId, gate } = await runningTask()
    const foreign = await ctx.agents.create({ sessionId: SessionId('foreign-owner') })
    const otherGate = Promise.withResolvers<undefined>()
    ctx.taskRuns.registerExecutor({ id: 'external', description: 'other task', check: () => {},
      execute: async () => { await otherGate.promise; return { stopReason: 'completed', output: 'done' } },
    })
    const otherJob = await ctx.taskRuns.start(parent, 'other', { name: 'other', stages: [{ name: 'work',
      tasks: [{ label: 'other', executor: 'external', instruction: 'work' }] }] },
    { ...taskRules, allowedExecutors: ['external'] }, signal())
    const send = vi.spyOn(ctx.subagents, 'sendMessage')
    try {
      await expect(ctx.taskRuns.sendMessage(foreign.agent, jobId, { childId, text: 'foreign' }, signal())).rejects.toThrow()
      await expect(ctx.taskRuns.sendMessage(parent, otherJob, { childId, text: 'foreign task' }, signal())).rejects.toThrow()
      expect(send).not.toHaveBeenCalled()
    } finally { send.mockRestore(); gate.resolve(undefined); otherGate.resolve(undefined) }
  })

  it('rejects a settled member after an earlier inspection', async () => {
    const { ctx, parent, jobId, childId, model, gate } = await runningTask()
    gate.resolve(undefined)
    await ctx.jobs.wait(jobId, 5000, parent.id)
    const send = vi.spyOn(ctx.subagents, 'sendMessage')
    try {
      await expect(ctx.taskRuns.sendMessage(parent, jobId, { childId, text: 'late' }, signal())).rejects.toThrow()
      expect(send).not.toHaveBeenCalled()
      expect(model.requests).toHaveLength(1)
    } finally { send.mockRestore() }
  })

  it('rejects empty or oversized messages and admits the exact multibyte bound', async () => {
    const { ctx, parent, jobId, childId, gate } = await runningTask()
    const send = vi.spyOn(ctx.subagents, 'sendMessage')
    try {
      for (const text of ['', ' \n ', '中'.repeat(taskRules.maxPlanBytes)]) {
        await expect(ctx.taskRuns.sendMessage(parent, jobId, { childId, text }, signal())).rejects.toThrow()
      }
      expect(send).not.toHaveBeenCalled()
      const overhead = Buffer.byteLength(JSON.stringify({ childId, text: '' }), 'utf8')
      const budget = taskRules.maxPlanBytes - overhead
      const text = '中'.repeat(Math.floor(budget / 3)) + 'a'.repeat(budget % 3)
      expect(Buffer.byteLength(JSON.stringify({ childId, text }), 'utf8')).toBe(taskRules.maxPlanBytes)
      await expect(ctx.taskRuns.sendMessage(parent, jobId, { childId, text: text + 'a' }, signal())).rejects.toThrow()
      await expect(ctx.taskRuns.sendMessage(parent, jobId, { childId, text }, signal())).resolves.toHaveProperty('messageId')
      expect(send).toHaveBeenCalledTimes(1)
    } finally { send.mockRestore(); gate.resolve(undefined) }
  })

  it.each(['caller', 'task'] as const)('cancels unaccepted delivery when the %s stops', async (source) => {
    const { ctx, parent, jobId, childId, model, gate } = await runningTask()
    const caller = new AbortController()
    const entered = Promise.withResolvers<AbortSignal>()
    const send = vi.spyOn(ctx.subagents, 'sendMessage').mockImplementation(async (_parent, _child, _content, options) => {
      entered.resolve(options.signal)
      await new Promise<never>((_resolve, reject) => {
        const abort = () => { reject(options.signal.reason) }
        options.signal.addEventListener('abort', abort, { once: true })
        if (options.signal.aborted) abort()
      })
      throw new Error('unreachable')
    })
    try {
      const pending = ctx.taskRuns.sendMessage(parent, jobId, { childId, text: 'pending' }, caller.signal)
      const combined = await entered.promise
      const rejected = expect(pending).rejects.toThrow()
      if (source === 'caller') caller.abort(new Error('caller cancelled'))
      else ctx.taskRuns.cancel(parent, jobId)
      await rejected
      expect(combined.aborted).toBe(true)
      expect(model.requests).toHaveLength(1)
      expect(ctx.agents.get(childId)?.inbox.nextStep ?? []).toEqual([])
      if (source === 'task') await expect(ctx.taskRuns.sendMessage(parent, jobId,
        { childId, text: 'after stop' }, signal())).rejects.toThrow()
    } finally { send.mockRestore(); gate.resolve(undefined) }
  })

  it('rejects caller cancellation before delivery', async () => {
    const { ctx, parent, jobId, childId, gate } = await runningTask()
    const caller = new AbortController()
    caller.abort(new Error('already cancelled'))
    const send = vi.spyOn(ctx.subagents, 'sendMessage')
    try {
      await expect(ctx.taskRuns.sendMessage(parent, jobId, { childId, text: 'pending' }, caller.signal)).rejects.toThrow('already cancelled')
      expect(send).not.toHaveBeenCalled()
    } finally { send.mockRestore(); gate.resolve(undefined) }
  })

  it('preserves backend capability errors without restarting the executor', async () => {
    const { ctx, parent, jobId, childId, model, gate } = await runningTask()
    const failure = new SubagentError('backend cannot deliver', 'UNSUPPORTED')
    const send = vi.spyOn(ctx.subagents, 'sendMessage').mockRejectedValue(failure)
    try {
      await expect(ctx.taskRuns.sendMessage(parent, jobId, { childId, text: 'adjust' }, signal())).rejects.toBe(failure)
      expect(send).toHaveBeenCalledTimes(1)
      expect(model.requests).toHaveLength(1)
    } finally { send.mockRestore(); gate.resolve(undefined) }
  })
})
