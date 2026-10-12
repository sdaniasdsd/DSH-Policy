import { describe, expect, it } from 'vitest'
import { createStyleStrategy, styleSchema } from '../src/style-policy.ts'
import { StrategyRegistry, TaskRun } from '../src/index.ts'
import { parseWorkflowProposal } from '../src/workflow-report.ts'
import type { TaskExecutor } from '../src/types.ts'

const proposal = { summary: 'fixture', domain: 'coding' as const, artifacts: [{ id: 'file', path: 'test.md', contains: 'correct' }],
  nodes: [{ id: 'a', instruction: 'first', dependencies: [] }, { id: 'b', instruction: 'second', dependencies: ['a'] }] }
const options = { maxConcurrent: 1, maxTasks: 16, maxResultBytes: 65536, prepare: async () => {} }

describe('DSH style policy plugins', () => {
  it.each(['codex', 'claude', 'zcode', 'superpowers'] as const)('accepts extreme-high for %s within package bounds', (pattern) => {
    const schema = styleSchema(pattern)
    const defaults = schema({})
    expect(defaults.extremeHigh).toMatchObject({ maxNodes: 12, maxRepairs: 4, maxTokens: 8192, timeoutMs: 600000,
      tokenCost: { callsPerTask: 8, contextTokensPerCall: 8192, outputTokensPerCall: 4096 } })
    expect(Reflect.apply(schema, undefined, [{ tier: 'extreme-high' }]).tier).toBe('extreme-high')
    expect(() => { Reflect.apply(schema, undefined, [{ extremeHigh: { maxNodes: 17 } }]) }).toThrow()
    expect(() => { Reflect.apply(schema, undefined, [{ extremeHigh: { maxRepairs: 5 } }]) }).toThrow()
    expect(() => { Reflect.apply(schema, undefined, [{ tier: 'unbounded' }]) }).toThrow()
  })

  it('runs Superpowers-style understanding, planning, sequential work, verification, and review', async () => {
    const policy = createStyleStrategy('superpowers', styleSchema('superpowers')({ tier: 'extreme-high' }))
    const registry = new StrategyRegistry(text => text.length)
    registry.register(policy)
    const calls: string[] = []
    const run = new TaskRun('create test.md', registry.capture(policy.id, { task: 'create test.md', preferences: { tier: 'extreme-high' } }), async (step) => {
      calls.push(step.label)
      return { stopReason: 'completed', output: 'evidence',
        ...step.workflowOutput ? { workflow: proposal } : {},
        ...step.artifactChecks ? { verification: { status: 'passed', checks: [{ id: 'file', status: 'passed', reason: 'read evidence' }] } as const } : {},
        ...step.reviewOutput ? { review: { status: 'passed', issues: [] } as const } : {} }
    }, options)
    expect((await run.start()).status).toBe('completed')
    expect(calls).toEqual(['understand', 'plan', 'work:a', 'work:b', 'verify', 'final-review'])
    const extreme = registry.list({ task: 'large task', preferences: { tier: 'extreme-high' } })[0]!.cost
    expect(extreme.kind).toBe('estimated')
    if (extreme.kind === 'estimated') expect(extreme.maximumScenarioTasks).toBeGreaterThan(extreme.tasks)
  })

  it('executes the exact 12-node, four-repair extreme-high path with serial writes', async () => {
    const policy = createStyleStrategy('superpowers', styleSchema('superpowers')({ tier: 'extreme-high' }))
    const registry = new StrategyRegistry(); registry.register(policy)
    const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index + 1}`, instruction: 'work', dependencies: [] }))
    let verifications = 0, activeWrites = 0, maximumWrites = 0
    const calls: string[] = []
    const run = new TaskRun('large task', registry.capture(policy.id, { task: 'large task', preferences: { tier: 'extreme-high' } }), async (step) => {
      calls.push(step.label)
      if (step.label.startsWith('work:')) {
        maximumWrites = Math.max(maximumWrites, ++activeWrites)
        await new Promise(resolve => setTimeout(resolve, 1))
        activeWrites--
      }
      return { stopReason: 'completed', output: 'evidence', ...step.workflowOutput ? { workflow: { ...proposal, artifacts: [], nodes } } : {},
        ...step.artifactChecks ? { verification: { status: ++verifications <= 4 ? 'failed' : 'passed', checks: [] } as const } : {},
        ...step.reviewOutput ? { review: { status: 'passed', issues: [] } as const } : {} }
    }, { ...options, maxTasks: 64 })
    expect((await run.start()).status).toBe('completed')
    expect(calls.filter(label => label.startsWith('work:'))).toHaveLength(12)
    expect(calls.filter(label => label.startsWith('repair:'))).toHaveLength(4)
    expect(calls).toHaveLength(28)
    expect(maximumWrites).toBe(1)
    expect(verifications).toBe(5)
  })

  it('rejects a plan beyond the captured extreme-high node limit before work begins', async () => {
    const policy = createStyleStrategy('superpowers', styleSchema('superpowers')({ tier: 'extreme-high' }))
    const registry = new StrategyRegistry(); registry.register(policy)
    const oversized = Array.from({ length: 13 }, (_, index) => ({ id: `n${index}`, instruction: 'work', dependencies: [] }))
    const calls: string[] = []
    const run = new TaskRun('large task', registry.capture(policy.id, { task: 'large task', preferences: { tier: 'extreme-high' } }), async (step) => {
      calls.push(step.label)
      return { stopReason: 'completed', output: 'evidence', ...step.workflowOutput ? { workflow: { ...proposal, nodes: oversized } } : {} }
    }, { ...options, maxTasks: 32 })
    expect(await run.start()).toMatchObject({ status: 'failed', error: expect.stringContaining('node limit 12') })
    expect(calls).toEqual(['understand', 'plan'])
  })

  it('settles a cancelled extreme-high child before ending without repairs', async () => {
    const policy = createStyleStrategy('superpowers', styleSchema('superpowers')({ tier: 'extreme-high' }))
    const registry = new StrategyRegistry(); registry.register(policy)
    const childStarted = Promise.withResolvers<undefined>()
    const calls: string[] = []
    const run = new TaskRun('cancel this task', registry.capture(policy.id, { task: 'cancel this task', preferences: { tier: 'extreme-high' } }),
      async (step, _prompt, signal) => {
        calls.push(step.label)
        if (step.workflowOutput) return { stopReason: 'completed', output: '', workflow: proposal }
        if (step.label === 'work:a') {
          childStarted.resolve(undefined)
          return new Promise(resolve => signal.addEventListener('abort', () => { resolve({ stopReason: 'cancelled', output: '' }) }, { once: true }))
        }
        return { stopReason: 'completed', output: '' }
      }, options)
    const started = run.start()
    await childStarted.promise
    run.cancel(new Error('cancelled by test'))
    expect(await started).toMatchObject({ status: 'cancelled' })
    expect(calls).toEqual(['understand', 'plan', 'work:a'])
  })

  it('does not replay an unknown Superpowers-style work result', async () => {
    const policy = createStyleStrategy('superpowers', styleSchema('superpowers')({ tier: 'extreme-high' }))
    const registry = new StrategyRegistry(); registry.register(policy)
    const calls: string[] = []
    const run = new TaskRun('unknown result', registry.capture(policy.id, { task: 'unknown result', preferences: { tier: 'extreme-high' } }), async (step) => {
      calls.push(step.label)
      if (step.workflowOutput) return { stopReason: 'completed', output: '', workflow: proposal }
      return step.label === 'work:a' ? { stopReason: 'error', output: '', diagnostic: 'outcome unknown' } : { stopReason: 'completed', output: '' }
    }, options)
    expect(await run.start()).toMatchObject({ status: 'failed', error: expect.stringContaining('outcome unknown') })
    expect(calls).toEqual(['understand', 'plan', 'work:a'])
  })

  it.each(['codex', 'claude', 'zcode'] as const)('runs %s with DSH presets and frozen checks', async (pattern) => {
    const policy = createStyleStrategy(pattern, styleSchema(pattern)({}))
    const registry = new StrategyRegistry(text => text.length)
    registry.register(policy)
    const calls: string[] = []
    const execute: TaskExecutor = async (step) => {
      expect(step.executor).toBeUndefined()
      expect(step.preset).toBe('standard')
      calls.push(step.label)
      return { stopReason: 'completed', output: 'evidence',
        ...step.workflowOutput ? { workflow: proposal } : {},
        ...step.artifactChecks ? { verification: { status: 'passed', checks: [{ id: 'file', status: 'passed', reason: 'read evidence' }] } as const } : {} }
    }
    const run = new TaskRun('create test.md', registry.capture(policy.id, { task: 'create test.md' }), execute, options)
    expect((await run.start()).status).toBe('completed')
    expect(run.inspect().verification?.status).toBe('passed')
    expect(calls.indexOf('work:b')).toBeGreaterThan(calls.indexOf('work:a'))
    expect(calls).toContain('verify')
    expect(registry.list()[0]?.cost.kind).toBe('estimated')
    if (pattern === 'codex') expect(calls).toContain('check:a')
    if (pattern === 'claude') expect(calls).toContain('explore')
    if (pattern === 'zcode') expect(calls).not.toContain('check:a')
  })

  it('bounds repairs and never retries an execution error', async () => {
    const policy = createStyleStrategy('codex', styleSchema('codex')({ tier: 'low' }))
    const registry = new StrategyRegistry(); registry.register(policy)
    let calls = 0
    const run = new TaskRun('task', registry.capture(policy.id, { task: 'task' }), async () => {
      calls++; return { stopReason: 'error', output: '', diagnostic: 'denied by DSH' }
    }, options)
    expect(await run.start()).toMatchObject({ status: 'failed', error: expect.stringContaining('denied by DSH') })
    expect(calls).toBe(1)
  })

  it('serializes writable ZCode nodes even when the host permits parallel children', async () => {
    const policy = createStyleStrategy('zcode', styleSchema('zcode')({}))
    const registry = new StrategyRegistry(); registry.register(policy)
    let active = 0, maximum = 0
    const run = new TaskRun('task', registry.capture(policy.id, { task: 'task' }), async (step) => {
      if (step.label.startsWith('work:')) { maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 5)); active-- }
      return { stopReason: 'completed', output: 'ok', ...step.workflowOutput ? {
        workflow: { ...proposal, artifacts: [], nodes: proposal.nodes.map(node => ({ ...node, dependencies: [] })) } } : {} }
    }, { ...options, maxConcurrent: 2 })
    expect((await run.start()).status).toBe('completed')
    expect(maximum).toBe(1)
  })

  it('repairs failed registered content once without changing the checks', async () => {
    const policy = createStyleStrategy('zcode', styleSchema('zcode')({ maxRepairs: 1 }))
    const registry = new StrategyRegistry(); registry.register(policy)
    let checks = 0
    const run = new TaskRun('task', registry.capture(policy.id, { task: 'task' }), async step => ({
      stopReason: 'completed', output: 'ok', ...step.workflowOutput ? { workflow: proposal } : {},
      ...step.artifactChecks ? { verification: { status: ++checks === 1 ? 'failed' : 'passed',
        checks: [{ id: step.artifactChecks[0]!.id, status: checks === 1 ? 'failed' : 'passed', reason: 'read' }] } as const } : {},
    }), options)
    expect((await run.start()).status).toBe('completed')
    expect(checks).toBe(2)
    expect(run.inspect().results.filter(row => row.label.startsWith('repair:'))).toHaveLength(1)
  })

  it('provides different tier scenarios and a separate maximum repair estimate', () => {
    const registry = new StrategyRegistry(text => text.length)
    const policy = createStyleStrategy('codex', styleSchema('codex')({}))
    registry.register(policy)
    const low = registry.list({ task: 'task', preferences: { tier: 'low' } })[0]!.cost
    const high = registry.list({ task: 'task', preferences: { tier: 'high' } })[0]!.cost
    const extreme = registry.list({ task: 'task', preferences: { tier: 'extreme-high' } })[0]!.cost
    expect(low.kind).toBe('estimated'); expect(high.kind).toBe('estimated')
    expect(extreme.kind).toBe('estimated')
    if (low.kind !== 'estimated' || high.kind !== 'estimated' || extreme.kind !== 'estimated') return
    expect(high.tasks).toBeGreaterThan(low.tasks)
    expect(high.maximumScenarioTokens).toBeGreaterThan(high.estimatedTotalTokens!)
    expect(extreme.assumptions).toEqual({ callsPerTask: 8, contextTokensPerCall: 8192, outputTokensPerCall: 4096 })
    expect(extreme.tasks).toBeGreaterThan(high.tasks)
    expect(extreme.maximumScenarioTasks).toBe(38)
  })
  it('uses concrete review issues for a bounded repair and fresh review', async () => {
    const policy = createStyleStrategy('claude', styleSchema('claude')({}))
    const registry = new StrategyRegistry(); registry.register(policy)
    let reviews = 0
    const run = new TaskRun('task', registry.capture(policy.id, { task: 'task' }), async step => ({
      stopReason: 'completed', output: 'ok', ...step.workflowOutput ? { workflow: proposal } : {},
      ...step.reviewOutput ? { review: { status: ++reviews === 1 ? 'issues' : 'passed',
        issues: reviews === 1 ? [{ description: 'Missing requirement', path: 'test.md', excerpt: 'wrong' }] : [] } as const } : {},
      ...step.artifactChecks ? { verification: { status: 'passed', checks: [] } as const } : {},
    }), options)
    expect((await run.start()).status).toBe('completed')
    expect(reviews).toBe(2)
    expect(run.inspect().results.filter(row => row.label.startsWith('repair:'))).toHaveLength(1)
  })

  it.each([
    [{ id: 'a', instruction: 'work', dependencies: ['missing'] }],
    [{ id: 'a', instruction: 'work', dependencies: ['b'] }, { id: 'b', instruction: 'work', dependencies: ['a'] }],
    [{ id: 'a', instruction: 'work', dependencies: [] }, { id: 'a', instruction: 'work', dependencies: [] }],
  ].map(nodes => [nodes]))('rejects invalid dependency graph %#', (nodes) => {
    expect(() => parseWorkflowProposal({ ...proposal, nodes })).toThrow()
  })
})
