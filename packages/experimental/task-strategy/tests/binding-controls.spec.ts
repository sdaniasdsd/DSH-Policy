import { describe, expect, it } from 'vitest'
import { captureStrategy, TaskRun } from '../src/index.ts'
import { planSchema } from '../src/schema.ts'
import type { TaskRunOptions } from '../src/runtime-types.ts'

const options: TaskRunOptions = { maxConcurrent: 2, maxTasks: 8, maxResultBytes: 4096, prepare: async () => {} }
const captured = (id: string) => captureStrategy(id, { name: id, stages: [{ name: id,
  tasks: [{ label: id, preset: 'coding', instruction: id }],
}] })
const gate = () => {
  let resolve!: () => void
  const promise = new Promise<void>((ready) => { resolve = ready })
  return { promise, resolve }
}

describe('binding versions on task controls', () => {
  it('captures selector JSON and isolates repeated labels after a binding switch', async () => {
    const next = { name: 'next', stages: [
      { name: 'repeated', tasks: [{ label: 'plan', preset: 'coding', instruction: 'plan', priorResults: { scope: 'all' as const } }] },
      { name: 'repeated', tasks: [{ label: 'work', preset: 'coding', instruction: 'work', priorResults: { scope: 'current-binding' as const, labels: ['plan'] } }] },
    ] }
    const parsed = planSchema(JSON.parse(JSON.stringify(next)))
    expect(parsed).toEqual(next)
    const invalid = JSON.parse(JSON.stringify({ ...next, stages: [{ name: 'bad', tasks: [
      { label: 'bad', preset: 'coding', instruction: 'bad', priorResults: { scope: 'invalid' } },
    ] }] }))
    expect(() => planSchema(invalid)).toThrow()
    const target = captureStrategy('next', parsed)
    Reflect.set(parsed.stages[1]!.tasks[0]!.priorResults!, 'labels', ['mutated'])
    const seen = new Map<string, string[]>()
    const runRef: { current: TaskRun | undefined } = { current: undefined }
    const run = new TaskRun('task', captured('plan'), async (step, prompt) => {
      seen.set(step.instruction, JSON.parse(prompt.split('instructions):\n')[1]!).map((r: { output: string }) => r.output))
      return { stopReason: 'completed', output: step.instruction === 'plan' ? String(runRef.current?.inspect().binding.epoch ?? 0) : 'done' }
    }, { ...options, onEvent: (event) => {
      if (event.type === 'task-end' && runRef.current?.inspect().binding.epoch === 0) {
        runRef.current.requestSwitch(() => target, { commandId: 'switch', expectedBindingEpoch: 0 })
      }
    } })
    runRef.current = run
    const result = await run.start()
    expect(result.status).toBe('completed')
    expect(seen.get('plan')).toEqual(['0'])
    expect(seen.get('work')).toEqual(['1'])
    expect(result.results.map(r => r.output)).toEqual(['0', '1', 'done'])
  })

  it('rejects a stale switch before evaluating its author and accepts a refreshed expectation', async () => {
    const entered = gate(), release = gate()
    let loads = 0
    const run = new TaskRun('task', captured('old'), async (step) => {
      if (step.label === 'new') { entered.resolve(); await release.promise }
      return { stopReason: 'completed', output: step.label }
    }, options)
    expect(run.requestSwitch(() => captured('new'), { commandId: 'first', expectedBindingEpoch: 0 }))
      .toMatchObject({ commandId: 'first', command: 1, status: 'queued' })
    const done = run.start()
    try {
      await entered.promise
      const before = run.inspect()
      expect(before.binding.epoch).toBe(1)
      expect(() => run.requestSwitch(() => { loads++; return captured('latest') }, { commandId: 'stale', expectedBindingEpoch: 0 })).toThrow('binding epoch changed')
      expect(loads).toBe(0)
      expect(run.inspect()).toEqual(before)
      expect(run.requestSwitch(() => { loads++; return captured('latest') }, { commandId: 'second', expectedBindingEpoch: before.binding.epoch }))
        .toMatchObject({ commandId: 'second', command: 2, status: 'queued' })
      release.resolve()
      expect((await done).results.map(row => row.label)).toEqual(['new', 'latest'])
      expect(run.inspect().binding).toMatchObject({ id: 'latest', epoch: 2 })
      expect(loads).toBe(1)
    } finally { release.resolve(); run.cancel('test cleanup'); await done }
  })

  it('rejects a stale resume without clearing the retained error or leaving waiting', async () => {
    const waiting = gate()
    const run = new TaskRun('task', captured('old'), async step => ({ stopReason: 'completed', output: step.label }), {
      ...options, onEvent: (event) => {
        if (event.type === 'switch-committed') {
          run.requestSwitch(() => { throw new Error('target unavailable') }, { commandId: 'broken', expectedBindingEpoch: 1 })
        }
        if (event.type === 'waiting') waiting.resolve()
      },
    })
    run.requestSwitch(() => captured('new'), { commandId: 'first', expectedBindingEpoch: 0 })
    const done = run.start()
    try {
      await waiting.promise
      const before = run.inspect()
      expect(before).toMatchObject({ phase: 'waiting', binding: { epoch: 1 } })
      expect(before.error).toContain('target unavailable')
      expect(() => { run.resume({ commandId: 'stale', expectedBindingEpoch: 0 }) }).toThrow('binding epoch changed')
      expect(run.inspect()).toEqual(before)
      expect(run.resume({ commandId: 'resume', expectedBindingEpoch: before.binding.epoch }))
        .toMatchObject({ commandId: 'resume', status: 'applied', epoch: 1 })
      expect((await done).results.map(row => row.label)).toEqual(['new'])
    } finally { run.cancel('test cleanup'); await done }
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expected epoch %s before reserving a command', (epoch) => {
      let loads = 0
      const run = new TaskRun('task', captured('old'), async () => ({ stopReason: 'completed', output: 'done' }), options)
      const before = run.inspect()
      expect(() => run.requestSwitch(() => { loads++; return captured('new') }, { commandId: 'bad', expectedBindingEpoch: epoch })).toThrow('Binding epoch must be a nonnegative safe integer')
      expect(() => { run.resume({ commandId: 'bad', expectedBindingEpoch: epoch }) }).toThrow('Binding epoch must be a nonnegative safe integer')
      expect(run.inspect()).toEqual(before)
      expect(loads).toBe(0)
      expect(run.requestSwitch(() => captured('new'), { commandId: 'ok', expectedBindingEpoch: 0 }))
        .toMatchObject({ commandId: 'ok', command: 1, status: 'queued' })
    },
  )

  it('rejects a blank command identity before evaluating its author', () => {
    let loads = 0
    const run = new TaskRun('task', captured('old'), async () => ({ stopReason: 'completed', output: 'done' }), options)
    expect(() => run.requestSwitch(() => { loads++; return captured('new') }, { commandId: '  ', expectedBindingEpoch: 0 }))
      .toThrow('Task command id must not be empty')
    expect(() => { run.resume({ commandId: '', expectedBindingEpoch: 0 }) }).toThrow('Task command id must not be empty')
    expect(loads).toBe(0)
  })

  it('correlates one accepted replacement with its committed binding and replays its first outcome', async () => {
    const entered = gate(), release = gate()
    const run = new TaskRun('task', captured('old'), async (step) => {
      if (step.label === 'new') { entered.resolve(); await release.promise }
      return { stopReason: 'completed', output: step.label }
    }, options)
    const queued = run.requestSwitch(() => captured('new'), { commandId: 'swap', expectedBindingEpoch: 0 })
    expect(queued).toMatchObject({ commandId: 'swap', command: 1, status: 'queued' })
    expect(queued.effectiveAt).toBeUndefined()
    const settled = run.waitCommand('swap', 5000, new AbortController().signal)
    const done = run.start()
    try {
      await entered.promise
      release.resolve()
      await done
      const applied = await settled
      expect(applied.timedOut).toBe(false)
      expect(applied.outcome).toMatchObject({ commandId: 'swap', command: 1, status: 'applied', epoch: 1 })
      expect(Number.isNaN(Date.parse(applied.outcome?.effectiveAt ?? ''))).toBe(false)
      // A repeated identity reports the settled outcome instead of reserving again.
      expect(run.requestSwitch(() => captured('other'), { commandId: 'swap', expectedBindingEpoch: 0 }))
        .toMatchObject({ status: 'applied', epoch: 1 })
      expect(run.inspect().binding).toMatchObject({ id: 'new', epoch: 1 })
    } finally { release.resolve(); run.cancel('test cleanup'); await done }
  })

  it('correlates a refused replacement with its rejection reason', async () => {
    const waiting = gate()
    const run = new TaskRun('task', captured('old'), async step => ({ stopReason: 'completed', output: step.label }), {
      ...options, onEvent: (event) => { if (event.type === 'waiting') waiting.resolve() },
    })
    run.requestSwitch(() => { throw new Error('target unavailable') }, { commandId: 'broken', expectedBindingEpoch: 0 })
    const settled = run.waitCommand('broken', 5000, new AbortController().signal)
    const done = run.start()
    try {
      await waiting.promise
      const rejected = await settled
      expect(rejected.timedOut).toBe(false)
      expect(rejected.outcome).toMatchObject({ commandId: 'broken', status: 'rejected' })
      expect(rejected.outcome?.error).toContain('target unavailable')
      expect(run.inspect().phase).toBe('waiting')
    } finally { run.cancel('test cleanup'); await done }
  })

  it('bounds a command wait, refuses an unknown identity and releases waiters on cancellation', async () => {
    const entered = gate(), release = gate()
    const run = new TaskRun('task', captured('old'), async (step) => {
      entered.resolve()
      await release.promise
      return { stopReason: 'completed', output: step.label }
    }, options)
    const done = run.start()
    try {
      await entered.promise
      run.requestSwitch(() => captured('new'), { commandId: 'slow', expectedBindingEpoch: 0 })
      expect(await run.waitCommand('slow', 20, new AbortController().signal)).toEqual({ timedOut: true })
      await expect(run.waitCommand('absent', 20, new AbortController().signal)).rejects.toThrow('Unknown task command: absent')
      await expect(run.waitCommand('slow', 0, new AbortController().signal)).rejects.toThrow('bounded positive safe integer')
      await expect(run.waitCommand('slow', 2_147_483_648, new AbortController().signal)).rejects.toThrow('bounded positive safe integer')
      const controller = new AbortController()
      const cancelled = run.waitCommand('slow', 5000, controller.signal)
      controller.abort(new Error('caller withdrew'))
      await expect(cancelled).rejects.toThrow('caller withdrew')
      expect(() => run.requestSwitch(() => captured('other'), { commandId: 'second', expectedBindingEpoch: 0 }))
        .toThrow('A strategy switch is already pending')
    } finally { release.resolve(); run.cancel('test cleanup'); await done }
  })

  it('settles a reservation the run never committed so no waiter hangs', async () => {
    const entered = gate(), release = gate()
    const run = new TaskRun('task', captured('old'), async (step) => {
      entered.resolve()
      await release.promise
      return { stopReason: 'completed', output: step.label }
    }, options)
    const done = run.start()
    await entered.promise
    run.requestSwitch(() => captured('new'), { commandId: 'abandoned', expectedBindingEpoch: 0 })
    const settled = run.waitCommand('abandoned', 5000, new AbortController().signal)
    run.cancel('owner withdrew')
    release.resolve()
    await done
    expect((await settled).outcome).toMatchObject({ commandId: 'abandoned', status: 'rejected' })
    expect(run.inspect().phase).toBe('cancelled')
  })
})
