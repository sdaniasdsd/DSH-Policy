import { describe, expect, it } from 'vitest'
import { TaskRun, StrategyRegistry, captureStrategy } from '../../src/index.ts'
import type { ExecutionPlan, TaskRunOptions } from '../../src/index.ts'

const gate = () => Promise.withResolvers<void>()
const plan = (...labels: string[]): ExecutionPlan => ({ name: labels.join('/'), stages: labels.map(label => ({
  name: label, tasks: [{ label, preset: 'coding', instruction: label }],
})) })
const binding = (id: string, ...labels: string[]) => captureStrategy(id, plan(...labels))
const options: TaskRunOptions = { maxConcurrent: 2, maxTasks: 8, maxResultBytes: 4096, prepare: async () => {} }

describe('extracted Policy controller', () => {
  it.todo('memberMessageRequiresNativeExecutor')

  it('feedbackDuringActiveStageAppliesAtNextBoundary', async () => {
    const entered = gate(), release = gate()
    const prompts: string[] = []
    let feedback = 'initial guidance'
    const run = new TaskRun('original task', binding('retained', 'first', 'second'), async (step, prompt) => {
      prompts.push(prompt)
      if (step.label === 'first') { entered.resolve(); await release.promise }
      return { stopReason: 'completed', output: step.label }
    }, { ...options, additionalContext: () => feedback })
    const done = run.start()
    try {
      await entered.promise
      feedback = 'revised guidance'
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain('initial guidance')
      expect(prompts[0]).not.toContain('revised guidance')
      release.resolve()
      expect((await done).status).toBe('completed')
      expect(prompts[1]).toContain('revised guidance')
      expect(prompts[1]).toContain('original task')
      expect(run.inspect()).toMatchObject({ completedStages: 2, startedTasks: 2 })
    } finally { release.resolve(); run.cancel('cleanup'); await done }
  })

  it('staleBindingEpochIsRejected', async () => {
    const entered = gate(), release = gate()
    const run = new TaskRun('task', binding('old', 'old'), async (step) => {
      entered.resolve(); await release.promise
      return { stopReason: 'completed', output: step.label }
    }, options)
    run.requestSwitch(() => binding('new', 'new'), { commandId: 'switch', expectedBindingEpoch: 0 })
    const done = run.start()
    try {
      await entered.promise
      const before = run.inspect()
      let evaluated = false
      expect(before.binding.epoch).toBe(1)
      expect(() => run.requestSwitch(() => { evaluated = true; return binding('stale', 'stale') },
        { commandId: 'stale', expectedBindingEpoch: 0 })).toThrow('binding epoch changed')
      expect(evaluated).toBe(false)
      expect(run.inspect()).toEqual(before)
      release.resolve()
      expect((await done).results.map(row => row.output)).toEqual(['new'])
    } finally { release.resolve(); run.cancel('cleanup'); await done }
  })

  it('failedStrategySwitchResumesRetainedStrategy', async () => {
    const entered = gate(), release = gate(), waiting = gate()
    const run = new TaskRun('task', binding('retained', 'first', 'second'), async (step) => {
      if (step.label === 'first') { entered.resolve(); await release.promise }
      return { stopReason: 'completed', output: step.label }
    }, { ...options, onEvent: (event) => { if (event.type === 'waiting') waiting.resolve() } })
    const done = run.start()
    try {
      await entered.promise
      run.requestSwitch(() => { throw new Error('target unavailable') }, { commandId: 'broken', expectedBindingEpoch: 0 })
      release.resolve()
      await waiting.promise
      expect(run.inspect()).toMatchObject({ phase: 'waiting', nextStage: 1, binding: { id: 'retained', epoch: 0 } })
      const outcome = (await run.waitCommand('broken', 5000, new AbortController().signal)).outcome
      expect(outcome?.status).toBe('rejected')
      expect(outcome?.error).toContain('target unavailable')
      run.resume({ commandId: 'resume', expectedBindingEpoch: 0 })
      expect((await done).results.map(row => row.output)).toEqual(['first', 'second'])
    } finally { release.resolve(); run.cancel('cleanup'); await done }
  })

  it('cancelSettlesTaskAndChildren', async () => {
    const entered = gate(), cleaning = gate(), releaseCleanup = gate()
    let childReleased = false, taskSettled = false
    const run = new TaskRun('task', binding('native', 'child'), async (_step, _prompt, signal) => {
      entered.resolve()
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }) })
      cleaning.resolve()
      await releaseCleanup.promise
      childReleased = true
      return { stopReason: 'cancelled', output: '' }
    }, options)
    const done = run.start().then((result) => { taskSettled = true; return result })
    try {
      await entered.promise
      run.cancel('owner cancelled')
      await cleaning.promise
      expect(taskSettled).toBe(false)
      releaseCleanup.resolve()
      expect((await done).status).toBe('cancelled')
      expect(childReleased).toBe(true)
      expect(run.inspect().phase).toBe('cancelled')
    } finally { releaseCleanup.resolve(); run.cancel('cleanup'); await done }
  })

  it('capturedStrategySurvivesUnregistrationAndUsesSettledResults', async () => {
    const registry = new StrategyRegistry()
    const remove = registry.register({ id: 'adaptive', description: 'adaptive', decide: () => plan('preview'),
      next: (_input, snapshot) => snapshot.nextStage === 0
        ? { kind: 'stage', stage: plan('first').stages[0]! }
        : snapshot.nextStage === 1
          ? { kind: 'stage', stage: plan(`next ${snapshot.results[0]!.output}`).stages[0]! }
          : { kind: 'finish', reason: 'done' },
    })
    const captured = registry.capture('adaptive', { task: 'task' })
    remove()
    const run = new TaskRun('task', captured, async step => ({ stopReason: 'completed', output: step.label }), options)
    expect((await run.start()).results.map(row => row.output)).toEqual(['first', 'next first'])
    expect(registry.list()).toEqual([])
  })
})
