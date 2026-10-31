import { describe, expect, it } from 'vitest'
import type { WorkflowEngine, WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { createWorkflowExecutor } from '../src/workflow-executor.ts'
import { TaskRun, captureStrategy, StrategyRegistry } from '../src/index.ts'
import type { ExecutionPlan, TaskRunOptions, TaskStep } from '../src/index.ts'

const parent = {} as WorkflowStartRequest['parent']
const options: TaskRunOptions = { maxConcurrent: 2, maxTasks: 4, maxResultBytes: 4096, prepare: async () => {} }
const step: TaskStep = { label: 'script', executor: 'workflow', instruction: 'compute' }
const stage = (label: string): ExecutionPlan['stages'][number] => ({ name: label, tasks: [{ ...step, label }] })
const plan = (...labels: string[]): ExecutionPlan => ({ name: 'scripts', stages: labels.map(stage) })
const request = (_step: TaskStep, prompt: string): Omit<WorkflowStartRequest, 'parent' | 'signal'> => ({
  script: 'return args.prompt', meta: { name: 'test-script', description: 'Script stage' }, args: { prompt },
  maxTotalAgents: 3, subagentProvider: 'local',
})
const completed = (value: unknown): WorkflowResult => ({ stopReason: 'completed', value, agentsStarted: 0 })

// The engine seam is external; these fixtures control settlement and child quiescence.
function engineFixture(result: Promise<WorkflowResult>, dispose: () => Promise<void> = async () => {}) {
  const requests: WorkflowStartRequest[] = []
  const engine: Pick<WorkflowEngine, 'start'> = { start(input) {
    requests.push(input)
    return { id: 'workflow-id' as WorkflowRun['id'], meta: input.meta, result, cancel() {}, dispose }
  } }
  return { engine, requests }
}

describe('official Workflow executor', () => {
  it('passesTaskParentAndCancellationSignal', async () => {
    const fixture = engineFixture(Promise.resolve(completed('ready')))
    const signal = new AbortController().signal
    await createWorkflowExecutor(fixture.engine, parent, request)(step, 'captured prompt', signal)
    expect(fixture.requests).toEqual([{
      script: 'return args.prompt', meta: { name: 'test-script', description: 'Script stage' },
      args: { prompt: 'captured prompt' }, maxTotalAgents: 3, subagentProvider: 'local', parent, signal,
    }])
    expect(fixture.requests[0]!.parent).toBe(parent)
    expect(fixture.requests[0]!.signal).toBe(signal)
  })

  it('returnsWorkflowValueToLaterStage', async () => {
    const fixture = engineFixture(Promise.resolve(completed({ answer: 42 })))
    const run = new TaskRun('original task', captureStrategy('scripts', plan('first', 'second')),
      createWorkflowExecutor(fixture.engine, parent, request), options)
    expect((await run.start()).status).toBe('completed')
    expect(fixture.requests[1]!.args).toMatchObject({ prompt: expect.stringContaining('{\\"answer\\":42}') })
    expect(run.inspect()).toMatchObject({ binding: { id: 'scripts', epoch: 0 }, completedStages: 2, startedTasks: 2 })
    expect(run.inspect().results[0]).toEqual({ stage: 'first', label: 'first', stopReason: 'completed', output: '{"answer":42}' })
  })

  it('completedResultChangesTheNextStrategyDecision', async () => {
    const fixture = engineFixture(Promise.resolve(completed('repair needed')))
    const registry = new StrategyRegistry()
    registry.register({ id: 'adaptive', description: 'Inspect result', decide: () => plan('preview'),
      next: (_input, snapshot) => snapshot.nextStage === 0
        ? { kind: 'stage', stage: stage('inspect') }
        : snapshot.nextStage === 1 && snapshot.results[0]?.output === 'repair needed'
          ? { kind: 'stage', stage: stage('repair') }
          : { kind: 'finish', reason: 'done' },
    })
    const run = new TaskRun('task', registry.capture('adaptive', { task: 'task' }),
      createWorkflowExecutor(fixture.engine, parent, request), options)
    expect((await run.start()).results.map(row => row.label)).toEqual(['inspect', 'repair'])
    expect(run.inspect().binding).toMatchObject({ id: 'adaptive', epoch: 0 })
  })

  it('mapsWorkflowErrorAndCancellation', async () => {
    for (const stopReason of ['error', 'cancelled'] as const) {
      const fixture = engineFixture(Promise.resolve({ value: null, stopReason, error: 'script stopped', agentsStarted: 1 }))
      const run = new TaskRun('task', captureStrategy('scripts', plan('first', 'skipped')),
        createWorkflowExecutor(fixture.engine, parent, request), options)
      const outcome = await run.start()
      expect(outcome.status).toBe('failed')
      expect(outcome.error).toContain('script stopped')
      expect(outcome.results).toEqual([{ stage: 'first', label: 'first', stopReason, output: '', diagnostic: 'script stopped' }])
      expect(fixture.requests).toHaveLength(1)
    }
    const entered = Promise.withResolvers<void>()
    const engine: Pick<WorkflowEngine, 'start'> = { start(input) {
      const result = new Promise<WorkflowResult>((resolve) => {
        input.signal!.addEventListener('abort', () => resolve({ value: null, stopReason: 'cancelled', error: 'owner cancelled', agentsStarted: 0 }), { once: true })
      })
      entered.resolve()
      return { id: 'cancelled-run' as WorkflowRun['id'], meta: input.meta, result, cancel() {}, dispose: async () => {} }
    } }
    const run = new TaskRun('task', captureStrategy('scripts', plan('first', 'skipped')),
      createWorkflowExecutor(engine, parent, request), options)
    const done = run.start()
    await entered.promise
    run.cancel('owner cancelled')
    expect((await done).status).toBe('cancelled')
    expect(run.inspect().phase).toBe('cancelled')
  })

  it('disposesRunOnEverySettlement', async () => {
    for (const result of [completed(null), { value: null, stopReason: 'error', error: 'failed', agentsStarted: 0 },
      { value: null, stopReason: 'cancelled', error: 'cancelled', agentsStarted: 0 }] satisfies WorkflowResult[]) {
      const cleaning = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
      let disposed = 0, settled = false
      const fixture = engineFixture(Promise.resolve(result), async () => { disposed++; cleaning.resolve(); await release.promise })
      const done = createWorkflowExecutor(fixture.engine, parent, request)(step, 'task', new AbortController().signal)
        .then((value) => { settled = true; return value })
      try {
        await cleaning.promise
        expect(settled).toBe(false)
        release.resolve()
        await done
        expect(disposed).toBe(1)
      } finally { release.resolve(); await done }
    }
  })

  it('doesNotExposeMemberMessagingForWorkflowStages', async () => {
    const result = Promise.withResolvers<WorkflowResult>(), entered = Promise.withResolvers<void>()
    const fixture = engineFixture(result.promise)
    const execute = createWorkflowExecutor(fixture.engine, parent, (step, prompt) => {
      entered.resolve()
      return request(step, prompt)
    })
    const run = new TaskRun('task', captureStrategy('scripts', plan('script')), execute, options)
    const done = run.start()
    try {
      await entered.promise
      expect(run.inspect().phase).toBe('running')
      expect(execute).not.toHaveProperty('sendMessage')
      expect(run).not.toHaveProperty('sendMessage')
      expect(run.inspect().activeMembers).toBeUndefined()
      result.resolve({ ...completed('done'), agentsStarted: 5 })
      const outcome = await done
      expect(run.inspect().startedTasks).toBe(1)
      expect(outcome.results[0]).not.toHaveProperty('sessionId')
    } finally { result.resolve(completed(null)); run.cancel('cleanup'); await done }
  })
})
