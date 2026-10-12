import { expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { bootTaskRuntime } from './task-runtime-fixture.ts'

function isInspectionView(value: unknown): value is {
  readonly detailsOmitted: boolean
  readonly completedTasks: number
  readonly activeMembers: readonly { readonly sessionId: string; readonly label: string }[]
  readonly binding: unknown
} {
  return typeof value === 'object' && value !== null && 'detailsOmitted' in value
    && typeof value.detailsOmitted === 'boolean' && 'completedTasks' in value && typeof value.completedTasks === 'number'
    && 'activeMembers' in value && Array.isArray(value.activeMembers) && 'binding' in value
}

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
    const parsed: unknown = JSON.parse(text)
    if (!isInspectionView(parsed)) throw new Error('Invalid task inspection view')
    const view = parsed
    expect(view.detailsOmitted).toBe(true)
    expect(view.completedTasks).toBe(1)
    expect(view.activeMembers).toEqual([{ sessionId: model.requests[1]!.sessionId, label: 'second' }])
    expect(view.binding).toEqual(full.binding)
    const activeMember = view.activeMembers[0]
    if (activeMember === undefined) throw new Error('Missing active member')
    const receipt = await ctx.tools.execute({ callId: ToolCallId('large-adjustment'), name: 'task_strategy_message',
      arguments: { jobId, childId: activeMember.sessionId, text: 'use the adjusted plan' },
      agent: parent, signal: new AbortController().signal })
    expect(receipt.isError).toBe(false)
    expect(ctx.taskStrategies.inspect(parent, jobId).results).toEqual(full.results)
  } finally { gate.resolve(undefined) }
  expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
  expect(model.requests).toHaveLength(3)
  expect(JSON.stringify(model.requests[2]!.messages)).toContain('use the adjusted plan')
})

it('exposes task-scoped records through generic LLM tools while the task is running', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent } = await bootTaskRuntime([{ chunks: textResponse('done'), gate: gate.promise }], undefined, true)
  const jobId = await ctx.taskStrategies.start(parent, 'work', { name: 'record tools', stages: [
    { name: 'work', tasks: [{ label: 'worker', preset: 'coding', instruction: 'work' }] },
  ] }, new AbortController().signal)
  const call = (name: string, args: Record<string, unknown>, id: string) => ctx.tools.execute({
    callId: ToolCallId(id), name, arguments: args, agent: parent, signal: new AbortController().signal,
  })
  try {
    const write = await call('task_strategy_record_write', { jobId, key: 'custom/key', value: { state: 'open' }, expectedRevision: 0 }, 'record-write')
    expect(write.isError).toBe(false)
    const read = await call('task_strategy_record_read', { jobId, key: 'custom/key' }, 'record-read')
    expect(read.isError).toBe(false)
    expect(JSON.parse(read.content.filter(block => block.type === 'text').map(block => block.text).join('')))
      .toMatchObject({ key: 'custom/key', revision: 1, value: { state: 'open' } })
    const list = await call('task_strategy_record_list', { jobId }, 'record-list')
    expect(list.isError).toBe(false)
    expect(JSON.parse(list.content.filter(block => block.type === 'text').map(block => block.text).join('')))
      .toEqual([expect.objectContaining({ key: 'custom/key', revision: 1 })])
    const waiting = call('task_strategy_record_wait', { jobId, key: 'custom/key', afterRevision: 1, timeoutMs: 5000 }, 'record-wait')
    await call('task_strategy_record_write', { jobId, key: 'custom/key', value: { state: 'done' }, expectedRevision: 1 }, 'record-write-next')
    const next = await waiting
    expect(next.isError).toBe(false)
    expect(JSON.parse(next.content.filter(block => block.type === 'text').map(block => block.text).join('')))
      .toMatchObject({ timedOut: false, record: { revision: 2, value: { state: 'done' } } })
  } finally { gate.resolve(undefined) }
  expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
})
