import { describe, expect, it, vi } from 'vitest'
import { bootTaskRuntime, taskRules } from './task-runtime-fixture.ts'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { ExecutionPlan } from '../src/types.ts'

type Runtime = Awaited<ReturnType<typeof bootTaskRuntime>>

/**
 * Cap the shared subagent pool of the composed runtime.
 * The provider registry lives in the same plugin, so the package re-applies
 * its dependents before this returns.
 */
async function limitSubagentPool(runtime: Runtime, maxActiveSubagents: number): Promise<void> {
  const entry = [...runtime.ctx.loader.entries()].find(value => value.options.name === 'cordis:subagents')
  if (entry?.fiber === undefined) throw new Error('Missing cordis:subagents entry')
  await entry.fiber.dispose()
  entry.options.config = { maxActiveSubagents }
  await entry.init()
  await runtime.ctx.loader.await()
}

/** One stage whose two children must overlap, against a pool that admits only one. */
const concurrentPlan: ExecutionPlan = { name: 'concurrent', stages: [{ name: 'parallel', tasks: [
  { label: 'holder', preset: 'coding', instruction: 'Hold the only slot until released' },
  { label: 'waiter', preset: 'coding', instruction: 'Run once the only slot is free' },
] }] }

describe('subagent capacity waiting', () => {
  it('reports a waiting observation instead of failing, then admits after the holder releases', async () => {
    const holder = Promise.withResolvers<undefined>()
    const runtime = await bootTaskRuntime([
      { chunks: textResponse('holder finished'), gate: holder.promise },
      { chunks: textResponse('waiter finished') },
    ])
    const { ctx, parent, model } = runtime
    await limitSubagentPool(runtime, 1)
    const jobId = await ctx.taskRuns.start(parent, 'concurrent work', concurrentPlan,
      { ...taskRules, capacity: { waitMs: 5000, retryMs: 5 } }, new AbortController().signal)
    // Capacity facts are appended to the Job log as `capacity` events, one per observation.
    const observations = (): { kind: string; resource: string; code: string; retryMs?: number }[] =>
      ctx.jobs.readAt(jobId, 0, parent.id).chunks.map(chunk => chunk.text).join('')
        .split('\n').filter(line => line.startsWith('{"type":"capacity"')).map(line => JSON.parse(line))
    try {
      await vi.waitFor(() => {
        const view = ctx.taskRuns.inspect(parent, jobId)
        expect({ phase: view.phase, requests: model.requests.length, error: view.error })
          .toStrictEqual({ phase: 'running', requests: 1, error: undefined })
      }, { timeout: 5000 })
      // The refused admission waits and stays observable instead of rejecting the child.
      await vi.waitFor(() => { expect(observations().some(entry => entry.kind === 'waiting')).toBe(true) }, { timeout: 5000 })
      expect(observations().find(entry => entry.kind === 'waiting'))
        .toMatchObject({ resource: 'subagent', code: 'ACTIVATION_LIMIT_REACHED', retryMs: 5 })
      // Waiting happens before the child starts, so a refusal cannot repeat child work.
      expect(model.requests).toHaveLength(1)
    } finally { holder.resolve(undefined) }
    await vi.waitFor(() => { expect(observations().some(entry => entry.kind === 'admitted')).toBe(true) }, { timeout: 5000 })
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
    expect(model.requests).toHaveLength(2)
    const view = ctx.taskRuns.inspect(parent, jobId)
    expect(view).toMatchObject({ phase: 'completed', startedTasks: 2 })
    expect(view.results.map(row => row.label)).toEqual(['holder', 'waiter'])
    expect(view.signals).toEqual([{ kind: 'capacity', resource: 'subagent', code: 'ACTIVATION_LIMIT_REACHED',
      waits: 1, waitedMs: expect.any(Number), exhausted: false }])
  })

  it('fails the refused child once the capacity wait expires, without starting it', async () => {
    const holder = Promise.withResolvers<undefined>()
    // One scripted response: a second model request would exhaust the script and fail loudly.
    const runtime = await bootTaskRuntime([{ chunks: textResponse('holder finished'), gate: holder.promise }])
    const { ctx, parent, model } = runtime
    await limitSubagentPool(runtime, 1)
    const jobId = await ctx.taskRuns.start(parent, 'concurrent work', concurrentPlan,
      { ...taskRules, capacity: { waitMs: 1000, retryMs: 5 } }, new AbortController().signal)
    const observations = (): { kind: string; resource: string; code: string }[] =>
      ctx.jobs.readAt(jobId, 0, parent.id).chunks.map(chunk => chunk.text).join('')
        .split('\n').filter(line => line.startsWith('{"type":"capacity"')).map(line => JSON.parse(line))
    try {
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) }, { timeout: 5000 })
      await vi.waitFor(() => { expect(observations().some(entry => entry.kind === 'exhausted')).toBe(true) }, { timeout: 5000 })
    } finally { holder.resolve(undefined) }
    // The wait was observable while it lasted, and its expiry is attributed to the exhausted resource.
    const waited = observations().filter(entry => entry.kind === 'waiting')
    expect(waited.length).toBeGreaterThan(0)
    expect(waited[0]).toMatchObject({ resource: 'subagent', code: 'ACTIVATION_LIMIT_REACHED' })
    expect(observations().find(entry => entry.kind === 'exhausted'))
      .toMatchObject({ resource: 'subagent', code: 'ACTIVATION_LIMIT_REACHED' })
    // The refused child never reached the model: it failed at admission, before any child work.
    expect(model.requests).toHaveLength(1)
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('failed')
    expect(model.requests).toHaveLength(1)
    const view = ctx.taskRuns.inspect(parent, jobId)
    expect(view.phase).toBe('failed')
    expect(view.error).toContain('Task waiter failed')
    expect(view.error).toContain('subagent limit reached')
    expect(view.signals).toEqual([{ kind: 'capacity', resource: 'subagent', code: 'ACTIVATION_LIMIT_REACHED',
      waits: 1, waitedMs: expect.any(Number), exhausted: true }])
  })
})
