import { describe, expect, it } from 'vitest'
import { captureStrategy, StrategyRegistry, TaskRun } from '../src/index.ts'
import type { TaskRunOptions } from '../src/runtime-types.ts'
import type { ExecutionPlan } from '../src/types.ts'

const stage = (label: string): ExecutionPlan['stages'][number] => ({ name: label,
  tasks: [{ label, preset: 'standard', instruction: label }] })
const plan = { name: 'adaptive', stages: [stage('preview')] }
const options: TaskRunOptions = { maxConcurrent: 1, maxTasks: 3, maxResultBytes: 8192, prepare: async () => {} }
let commands = 0
/** Distinct identity per reservation; a repeated id would replay its first recorded outcome. */
const nextCommand = (): string => `cmd-${++commands}`

describe('synchronous stage policies', () => {
  it('hands global results to a replacement without confusing them with its own planner output', async () => {
    const observed: number[] = []
    let once = false
    const run = new TaskRun('task', captureStrategy('old', plan), async () => ({ stopReason: 'completed', output: 'old evidence',
      verification: { status: 'passed', checks: [] } }), { ...options, onEvent: (event) => {
      if (event.type === 'task-end' && !once) { once = true; run.requestSwitch(() => ({ ...captureStrategy('new', plan), next: (snapshot) => {
        observed.push(snapshot.currentResults.length)
        if (snapshot.nextStage === 0) { expect(snapshot.results).toHaveLength(1); return { kind: 'stage', stage: stage('new planner') } }
        return { kind: 'finish', reason: 'done' }
      } }), { commandId: nextCommand(), expectedBindingEpoch: 0 }) }
    } })
    expect((await run.start()).status).toBe('completed')
    expect(observed).toEqual([0, 1])
  })
  it('captures a registered policy, then uses settled results after unregister', async () => {
    const registry = new StrategyRegistry()
    const remove = registry.register({ id: 'adaptive', description: 'adaptive', decide: () => plan,
      next: (_input, snapshot) => snapshot.nextStage === 0
        ? { kind: 'stage', stage: stage('work') }
        : snapshot.nextStage === 1
          ? { kind: 'stage', stage: stage(`check ${snapshot.results[0]!.output}`) }
          : { kind: 'finish', reason: 'finished' },
    })
    const binding = registry.capture('adaptive', { task: 'task' })
    remove()
    const run = new TaskRun('task', binding, async () => ({ stopReason: 'completed', output: 'evidence' }), options)
    const result = await run.start()
    expect(result.status).toBe('completed')
    expect(result.results.map(row => row.label)).toEqual(['work', 'check evidence'])
  })

  it('limits adaptive work cumulatively and does not repeat side effects on failure', async () => {
    let count = 0
    const run = new TaskRun('task', { ...captureStrategy('bounded', plan),
      next: () => ({ kind: 'stage', stage: stage('again') }),
    }, async () => { count++; return { stopReason: 'completed', output: 'ok' } }, options)
    const result = await run.start()
    expect(result.status).toBe('failed')
    expect(result.error).toContain('cumulative task limit')
    expect(count).toBe(3)
  })

  it('does not evaluate another policy decision after cancellation', async () => {
    let decisions = 0
    const run = new TaskRun('task', { ...captureStrategy('cancel', plan), next: () => {
      decisions++; return { kind: 'stage', stage: stage('work') }
    } }, async () => { run.cancel('stop'); return { stopReason: 'completed', output: 'ok' } }, options)
    expect((await run.start()).status).toBe('cancelled')
    expect(decisions).toBe(1)
  })

  it('reports a blocked decision and can still be cancelled', async () => {
    const run = new TaskRun('task', { ...captureStrategy('blocked', plan),
      next: () => ({ kind: 'blocked', reason: 'Need a target' }),
    }, async () => { throw new Error('must not execute') }, { ...options,
      onEvent: (event) => { if (event.type === 'waiting') {
        expect(run.inspect()).toMatchObject({ phase: 'waiting', error: 'Need a target' })
        run.cancel('stop')
      } },
    })
    expect((await run.start()).status).toBe('cancelled')
  })

  it('keeps a blocked decision nonterminal until resumed, then continues the retained policy', async () => {
    let decisions = 0
    const waiting = Promise.withResolvers<undefined>()
    const run = new TaskRun('task', { ...captureStrategy('blocked-resumable', plan),
      next: () => decisions++ === 0 ? { kind: 'blocked', reason: 'Need a target' }
        : decisions === 2 ? { kind: 'stage', stage: stage('work-after-resume') } : { kind: 'finish', reason: 'finished' },
    }, async () => ({ stopReason: 'completed', output: 'done' }), { ...options,
      onEvent: (event) => {
        if (event.type === 'waiting') {
          expect(run.inspect()).toMatchObject({ phase: 'waiting', error: 'Need a target' })
          waiting.resolve(undefined)
        }
      },
    })
    let settled = false
    const execution = run.start().then((result) => { settled = true; return result })
    await waiting.promise
    expect(settled).toBe(false)
    expect(run.inspect().phase).toBe('waiting')
    expect(run.resume({ commandId: 'resume-after-block', expectedBindingEpoch: 0 })).toMatchObject({ status: 'applied' })
    expect(await execution).toMatchObject({ status: 'completed', results: [{ label: 'work-after-resume' }] })
  })
})
