import { expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootTaskRuntime } from './task-runtime-fixture.ts'

it('discovers and messages a running child after a completed result exceeds the tool output bound', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: textResponse('中'.repeat(2000)) },
    { chunks: textResponse('second'), gate: gate.promise },
    { chunks: textResponse('adjusted') },
  ], { maxOutputBytes: 512 })
  const jobId = await ctx.taskStrategies.start(parent, 'work', { name: 'large output', stages: [
    { name: 'first', tasks: [{ label: 'first', preset: 'coding', instruction: 'work' }] },
    { name: 'second', tasks: [{ label: 'second', preset: 'coding', instruction: 'continue work' }] },
  ] }, new AbortController().signal)
  try {
    await vi.waitFor(() => { expect(model.requests).toHaveLength(2) })
    const full = ctx.taskStrategies.inspect(parent, jobId)
    expect(Buffer.byteLength(JSON.stringify(full.results))).toBeGreaterThan(512)
    const result = await ctx.tools.execute({ callId: ToolCallId('large-inspect'), name: 'task_strategy_inspect',
      arguments: { jobId }, agent: parent, signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
    const view = JSON.parse(text)
    expect(view.detailsOmitted).toBe(true)
    expect(view.completedTasks).toBe(1)
    expect(view.activeMembers).toEqual([{ sessionId: model.requests[1]!.sessionId, label: 'second' }])
    expect(view.binding).toEqual(full.binding)
    const receipt = await ctx.tools.execute({ callId: ToolCallId('large-adjustment'), name: 'task_strategy_message',
      arguments: { jobId, childId: view.activeMembers[0].sessionId, text: 'use the adjusted plan' },
      agent: parent, signal: new AbortController().signal })
    expect(receipt.isError).toBe(false)
    expect(ctx.taskStrategies.inspect(parent, jobId).results).toEqual(full.results)
  } finally { gate.resolve(undefined) }
  expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
  expect(model.requests).toHaveLength(3)
  expect(JSON.stringify(model.requests[2]!.messages)).toContain('use the adjusted plan')
})
