import { describe, expect, it, vi } from 'vitest'
import { StrategyRegistry, executePlan } from '../src/index.ts'
import { parsePlan } from '../src/schema.ts'
import { validatePlan } from '../src/executor.ts'
import type { ExecutionPlan, TaskExecutor } from '../src/types.ts'

const plan: ExecutionPlan = {
  name: 'investigate then build',
  stages: [
    { name: 'investigate', tasks: [
      { label: 'research', preset: 'reader', instruction: 'Read only' },
      { label: 'review', preset: 'reviewer', instruction: 'Check risks' },
    ] },
    { name: 'build', tasks: [{ label: 'implement', preset: 'coding', instruction: 'Implement' }] },
  ],
}
const limits = { maxConcurrent: 2, maxTasks: 5, maxResultBytes: 4096 }

describe('author strategy decisions', () => {
  it.each(['', ' \n\t'])('rejects an empty task before invoking its author: %j', (task) => {
    const registry = new StrategyRegistry()
    let decisions = 0
    registry.register({ id: 'sync', description: 'Synchronous policy', decide: () => { decisions++; return plan } })
    expect(() => registry.decide('sync', { task })).toThrow('Task must not be empty')
    expect(decisions).toBe(0)
  })
  it('returns a detached decision synchronously without retaining author work', () => {
    const registry = new StrategyRegistry()
    registry.register({ id: 'sync', description: 'Synchronous policy', decide: () => plan })
    const decision = registry.decide('sync', { task: 'task' })
    expect(decision).toEqual(plan)
    expect(decision).not.toBe(plan)
  })

  it('lets an author choose the child composition from preferences', () => {
    const registry = new StrategyRegistry()
    registry.register({ id: 'mine', description: 'My preferences', decide: input => ({
      name: input.task,
      stages: [{ name: 'work', tasks: [{ label: 'work', preset: input.preferences?.mode ?? 'coding', instruction: 'Do it' }] }],
    }) })
    expect(registry.decide('mine', { task: 'fix bug', preferences: { mode: 'reader' } })
      .stages[0]?.tasks[0]?.preset).toBe('reader')
    expect(registry.list()).toEqual([{ id: 'mine', description: 'My preferences', cost: { kind: 'unknown', reason: 'dynamic-plan' } }])
  })

  it('removes only its own registration and detaches the returned plan', () => {
    const registry = new StrategyRegistry()
    const remove = registry.register({ id: 'mine', description: 'old', decide: () => plan })
    const decision = registry.decide('mine', { task: 'task' })
    Object.assign(decision.stages[0]!.tasks[0]!, { preset: 'changed' })
    expect(plan.stages[0]?.tasks[0]?.preset).toBe('reader')
    remove()
    registry.register({ id: 'mine', description: 'new', decide: () => plan })
    remove()
    expect(registry.list()).toEqual([{ id: 'mine', description: 'new', cost: { kind: 'unknown', reason: 'dynamic-plan' } }])
    expect(() => registry.register({ id: 'mine', description: '', decide: () => plan })).toThrow('Duplicate')
    expect(() => registry.decide('missing', { task: 'task' })).toThrow('Unknown strategy')
  })
})

describe('phased execution', () => {
  it.each([1, 2, 3])('runs an author-selected stage with %i workers instead of the carrier default', async (concurrency) => {
    const authored = { name: 'author concurrency', stages: [{ name: 'modules', maxConcurrent: concurrency,
      tasks: Array.from({ length: 3 }, (_, index) => ({ label: `module:${index}`, preset: 'coding', instruction: 'Implement assigned module' })) }] }
    const gate = Promise.withResolvers<undefined>()
    let started = 0, active = 0, maximum = 0
    const running = executePlan(authored, 'implement modules', async (step) => {
      started++; maximum = Math.max(maximum, ++active)
      try { await gate.promise; return { stopReason: 'completed', output: step.label } }
      finally { active-- }
    }, { ...limits, maxConcurrent: concurrency === 1 ? 3 : 1, signal: new AbortController().signal })
    try { await vi.waitFor(() => { expect(started).toBe(concurrency) }) }
    finally { gate.resolve(undefined); await running }
    expect(maximum).toBe(concurrency)
    expect(active).toBe(0)
  })
  it('retains strategy-owned concurrency through JSON parsing and rejects contradictory or invalid author choices', () => {
    const authored = { ...plan, stages: [{ ...plan.stages[0]!, maxConcurrent: 3 }] }
    expect(parsePlan(authored).stages[0]).toHaveProperty('maxConcurrent', 3)
    for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = { ...plan, stages: [{ ...plan.stages[0]!, maxConcurrent: value }] }
      expect(() => { validatePlan(invalid, limits) }).toThrow('Stage concurrency')
      expect(() => parsePlan(invalid)).toThrow()
    }
    expect(() => { validatePlan({ ...plan, stages: [{ ...plan.stages[0]!, serial: true, maxConcurrent: 2 }] }, limits) })
      .toThrow('Serial stage')
  })
  it.each(['cancelled', 'failed'] as const)('drains strategy-selected concurrent children before reporting %s', async (status) => {
    const authored: ExecutionPlan = { name: 'parallel modules', stages: [
      { name: 'modules', maxConcurrent: 3, tasks: Array.from({ length: 4 },
        (_, index) => ({ label: `module:${index}`, preset: 'coding', instruction: 'work' })) },
      { name: 'later', tasks: [{ label: 'later', preset: 'coding', instruction: 'work' }] },
    ] }
    const controller = new AbortController()
    const failure = Promise.withResolvers<undefined>(), cleanup = Promise.withResolvers<undefined>()
    const labels: string[] = []
    let active = 0, aborted = 0, settled = false
    const running = executePlan(authored, 'implement modules', async (step, _prompt, signal) => {
      labels.push(step.label); active++
      try {
        if (status === 'failed' && step.label === 'module:0') {
          await failure.promise
          return { stopReason: 'max-tokens', output: 'partial' }
        }
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        aborted++
        await cleanup.promise
        return { stopReason: 'aborted', output: '' }
      } finally { active-- }
    }, { ...limits, maxConcurrent: 1, signal: controller.signal }).then((result) => { settled = true; return result })
    try {
      await vi.waitFor(() => { expect(labels).toHaveLength(3) })
      if (status === 'cancelled') controller.abort()
      else failure.resolve(undefined)
      await vi.waitFor(() => { expect(aborted).toBe(status === 'failed' ? 2 : 3) })
      expect(settled).toBe(false)
    } finally { controller.abort(); failure.resolve(undefined); cleanup.resolve(undefined); await running }
    expect((await running).status).toBe(status)
    expect(labels).toEqual(['module:0', 'module:1', 'module:2'])
    expect(active).toBe(0)
  })
  it('rejects an empty task before dispatching any child', async () => {
    let started = 0
    await expect(executePlan(plan, ' \n\t', async () => {
      started++
      return { stopReason: 'completed', output: 'unused' }
    }, { ...limits, signal: new AbortController().signal })).rejects.toThrow('Task must not be empty')
    expect(started).toBe(0)
  })
  it('waits for a stage before passing its results to the next stage', async () => {
    const calls: string[] = []
    let running = 0
    let maximum = 0
    const execute: TaskExecutor = async (step, prompt) => {
      calls.push(`start:${step.label}`)
      maximum = Math.max(maximum, ++running)
      await new Promise<void>(resolve => setTimeout(resolve, 5))
      if (step.label === 'implement') expect(prompt).toContain('research result')
      calls.push(`end:${step.label}`)
      running--
      return { stopReason: 'completed', output: `${step.label} result`, sessionId: step.label }
    }
    const result = await executePlan(plan, 'fix the bug', execute, { ...limits, signal: new AbortController().signal })
    expect(result.status).toBe('completed')
    expect(maximum).toBe(2)
    expect(calls.indexOf('start:implement')).toBeGreaterThan(calls.indexOf('end:research'))
    expect(calls.indexOf('start:implement')).toBeGreaterThan(calls.indexOf('end:review'))
    expect(result.results.map(row => row.label)).toEqual(['research', 'review', 'implement'])
  })

  it('bounds concurrency independently of stage width', async () => {
    let active = 0
    let maximum = 0
    const result = await executePlan(plan, 'task', async () => {
      maximum = Math.max(maximum, ++active)
      await Promise.resolve()
      active--
      return { stopReason: 'completed', output: 'ok' }
    }, { ...limits, maxConcurrent: 1, signal: new AbortController().signal })
    expect(result.status).toBe('completed')
    expect(maximum).toBe(1)
  })

  it('does not run a later stage after a non-completed child', async () => {
    const labels: string[] = []
    const result = await executePlan(plan, 'task', async (step) => {
      labels.push(step.label)
      return { stopReason: 'max-tokens', output: 'partial' }
    }, { ...limits, maxConcurrent: 1, signal: new AbortController().signal })
    expect(result.status).toBe('failed')
    expect(labels).toEqual(['research'])
    expect(result.error).toContain('max-tokens')
  })

  it('awaits active cancellation and prevents pending starts', async () => {
    const controller = new AbortController()
    const labels: string[] = []
    let released = false
    const result = await executePlan(plan, 'task', async (step, _prompt, signal) => {
      labels.push(step.label)
      controller.abort()
      expect(signal.aborted).toBe(true)
      await Promise.resolve()
      released = true
      return { stopReason: 'aborted', output: '' }
    }, { ...limits, maxConcurrent: 1, signal: controller.signal })
    expect(result.status).toBe('cancelled')
    expect(released).toBe(true)
    expect(labels).toEqual(['research'])
  })

  it('rejects invalid plans and limits before starting work', async () => {
    let starts = 0
    const execute: TaskExecutor = async () => { starts++; return { stopReason: 'completed', output: '' } }
    for (const invalid of [{ name: 'empty', stages: [] }, { ...plan, stages: [{ name: 'empty', tasks: [] }] }]) {
      await expect(executePlan(invalid, 'task', execute, { ...limits, signal: new AbortController().signal })).rejects.toThrow('empty')
    }
    await expect(executePlan(plan, 'task', execute, { ...limits, maxTasks: 1, signal: new AbortController().signal })).rejects.toThrow('task limit')
    await expect(executePlan(plan, 'task', execute, { ...limits, maxConcurrent: 0, signal: new AbortController().signal })).rejects.toThrow('maxConcurrent')
    expect(starts).toBe(0)
  })

  it('bounds retained results in UTF-8 bytes and contains observer errors', async () => {
    const result = await executePlan(plan, 'task', async () => ({ stopReason: 'completed', output: '中'.repeat(100) }), {
      ...limits, maxResultBytes: 200, signal: new AbortController().signal,
      onEvent: () => { throw new Error('observer failure') },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('result byte limit')
    expect(result.results).toEqual([])
  })

  it('reports executor errors without claiming task completion', async () => {
    const result = await executePlan(plan, 'task', async () => { throw new Error('start failed') }, {
      ...limits, maxConcurrent: 1, signal: new AbortController().signal,
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('start failed')
    expect(result.results).toEqual([])
  })
})
