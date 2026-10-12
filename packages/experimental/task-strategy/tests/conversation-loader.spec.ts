import { expect, it, vi } from 'vitest'
import { bootTaskRuntime, taskRules, type TaskModel } from './task-runtime-fixture.ts'
import { maxTokensResponse, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import * as activationResults from '../../../subagent/subagent/src/activation.ts'
import type { TaskMemberTurnOutcome } from '../src/member-session-types.ts'
import type { TaskRecordWaitResult } from '../src/coordination-types.ts'
import type { ExecutionPlan } from '../src/types.ts'

const signal = new AbortController().signal
const step = { label: 'member', preset: 'coding', instruction: 'work' }
const plan: ExecutionPlan = { name: 'conversation', stages: [{ name: 'work', tasks: [
  { label: 'lead', executor: 'conversation', instruction: 'coordinate' },
] }] }
const rules = { ...taskRules, allowedExecutors: ['conversation'] }

it('retains the admitted token ceiling across same-session continuation', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: maxTokensResponse('first') },
    { chunks: textResponse('next') }], undefined, true)
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'limits', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open({ ...step, maxTokens: 17 }, 'first', childSignal)
      const next = await context.members.continue(first.sessionId, 'next', childSignal)
      if (next.kind !== 'settled') throw new Error(next.error)
      return next.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(model.requests.map(request => request.maxTokens)).toEqual([17, 17])
})

it('retains structured submission and captures its actual continued result', async () => {
  const proposal = { summary: 'continued workflow', domain: 'coding', nodes: [
    { id: 'work', instruction: 'implement', dependencies: [] },
  ], artifacts: [] }
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: maxTokensResponse('incomplete') },
    { chunks: toolCallResponse('submit', 'structured_output', proposal) }], undefined, true)
  let next: TaskMemberTurnOutcome | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'workflow', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open({ ...step, workflowOutput: true }, 'first', childSignal)
      next = await context.members.continue(first.sessionId, 'submit workflow', childSignal)
      if (next.kind !== 'settled') throw new Error(next.error)
      return next.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(model.requests.map(request => request.tools?.some(tool => tool.name === 'structured_output'))).toEqual([true, true])
  expect(next).toMatchObject({ kind: 'settled', result: { stopReason: 'completed', workflow: proposal } })
})

it('shares synchronous member reservations across parallel executors and releases them after cleanup', async () => {
  const gate = Promise.withResolvers<undefined>()
  const ready = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: textResponse('one'), gate: gate.promise }, { chunks: textResponse('two'), gate: gate.promise },
    { chunks: textResponse('after cleanup') },
  ], undefined, true)
  let rejected = 0
  let opened = 0
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'parallel', check: () => {},
    execute: async (_parent, outer, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = context.members.open(step, 'first', childSignal)
      if (++opened === 2) ready.resolve(undefined)
      await ready.promise
      const extra = context.members.open(step, 'over limit', childSignal)
      await expect(extra).rejects.toThrow(/maxConcurrent/)
      rejected++
      if (rejected === 2) gate.resolve(undefined)
      const result = await first
      if (outer.label === 'one') await context.members.continue(result.sessionId, 'after cleanup', childSignal)
      return { stopReason: 'completed', output: 'bounded' }
    } })
  const parallel: ExecutionPlan = { name: 'parallel', stages: [{ name: 'work', tasks: [
    { label: 'one', executor: 'conversation', instruction: 'work' }, { label: 'two', executor: 'conversation', instruction: 'work' },
  ] }] }
  const id = await ctx.taskRuns.start(parent, 'work', parallel, rules, signal)
  try {
    expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
    expect(rejected).toBe(2)
    expect(model.requests).toHaveLength(3)
  } finally { gate.resolve(undefined) }
})

it('shares task concurrency between ordinary children and executor members', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: textResponse('ordinary'), gate: gate.promise }, { chunks: textResponse('member'), gate: gate.promise },
  ])
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'mixed', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      const first = context.members.open(step, 'first member', childSignal)
      try { await expect(context.members.open(step, 'over limit', childSignal)).rejects.toThrow(/maxConcurrent/) }
      finally { gate.resolve(undefined) }
      await first
      return { stopReason: 'completed', output: 'bounded' }
    } })
  const mixed: ExecutionPlan = { name: 'mixed', stages: [{ name: 'work', tasks: [
    step, { label: 'lead', executor: 'conversation', instruction: 'coordinate' },
  ] }] }
  const id = await ctx.taskRuns.start(parent, 'work', mixed, rules, signal)
  try {
    expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
    expect(model.requests).toHaveLength(2)
  } finally { gate.resolve(undefined) }
})

it('allows an author stage to raise concurrency above the carrier default', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: textResponse('one'), gate: gate.promise }, { chunks: textResponse('two'), gate: gate.promise },
  ], { maxConcurrent: 1 })
  const parallel: ExecutionPlan = { name: 'parallel', stages: [{ name: 'work', maxConcurrent: 2, tasks: [
    { ...step, label: 'one' }, { ...step, label: 'two' },
  ] }] }
  try {
    const id = await ctx.taskRuns.start(parent, 'work', parallel, { ...taskRules, maxConcurrent: 1 }, signal)
    await vi.waitFor(() => { expect(model.requests).toHaveLength(2) })
    gate.resolve(undefined)
    expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  } finally { gate.resolve(undefined) }
})

it('keeps the carrier concurrency available to members of one executor stage', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: textResponse('one'), gate: gate.promise }, { chunks: textResponse('two'), gate: gate.promise },
  ])
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'nested parallel members', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = context.members.open(step, 'first', childSignal)
      const second = context.members.open(step, 'second', childSignal)
      await vi.waitFor(() => { expect(model.requests).toHaveLength(2) })
      gate.resolve(undefined)
      await Promise.all([first, second])
      return { stopReason: 'completed', output: 'both members settled' }
    } })
  try {
    const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
    expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
    expect(model.requests).toHaveLength(2)
  } finally { gate.resolve(undefined) }
})

it('logs exact accepted identities and sender, retains history, and waits inside the original Job for an explicit decision', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: maxTokensResponse('blocked evidence') },
    { chunks: textResponse('recovered result') }], undefined, true)
  const decision = Promise.withResolvers<undefined>()
  const ready = Promise.withResolvers<TaskMemberTurnOutcome>()
  let second: TaskMemberTurnOutcome | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'decision', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(step, 'original work', childSignal)
      ready.resolve(first)
      await decision.promise
      second = await context.members.continue(first.sessionId, 'chosen repair', childSignal)
      if (second.kind !== 'settled') throw new Error(second.error)
      return second.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  const first = await ready.promise
  try {
    expect(first).toMatchObject({ kind: 'settled', result: { stopReason: 'max-tokens', output: 'blocked evidence' } })
    expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ phase: 'running', startedTasks: 2, activeMembers: [] })
    await expect(ctx.taskRuns.sendMessage(parent, id, { childId: first.sessionId, text: 'late active-only input' }, signal))
      .rejects.toThrow(/active DSH member/)
    expect(model.requests).toHaveLength(1)
  } finally { decision.resolve(undefined) }
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(second?.sessionId).toBe(first.sessionId)
  expect(model.requests.map(request => request.sessionId)).toEqual([first.sessionId, first.sessionId])
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('blocked evidence')
  expect(JSON.stringify(model.requests[1]?.messages)).toContain('chosen repair')
  const stored = await loadStoredSession(ctx.sessionPersistence, first.sessionId)
  const inputs = stored.events.filter(event => event.type === 'user/message')
  expect(inputs.some(event => event.data.id === first.messageId)).toBe(true)
  expect(inputs.some(event => event.data.id === second?.messageId && event.data.source.kind === 'agent-message'
    && event.data.source.form === 'relay' && event.data.source.senderSessionId === parent.id)).toBe(true)
  expect(ctx.taskRuns.inspect(parent, id)).toMatchObject({ phase: 'completed', startedTasks: 3, activeMembers: [] })
})

it('cancels a continued activation and drains it without a post-cancel wake', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('first') },
    { chunks: textResponse('not completed'), gate: gate.promise }], undefined, true)
  let followup: TaskMemberTurnOutcome | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'cancel', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(step, 'first', childSignal)
      followup = await context.members.continue(first.sessionId, 'next', childSignal)
      if (followup.kind !== 'settled') throw new Error(followup.error)
      return followup.result
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  await vi.waitFor(() => { expect(model.requests).toHaveLength(2) })
  ctx.taskRuns.cancel(parent, id)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('killed')
  expect(followup).toMatchObject({ kind: 'settled', result: { stopReason: 'aborted' } })
  expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
  expect(ctx.agents.get(firstModelSession(model))).toBeUndefined()
  gate.resolve(undefined)
  expect(model.requests).toHaveLength(2)
})

it('reports unavailable continuation without replacing the original member or backend', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('first') }], undefined, true, false)
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'missing capability', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      const first = await context.members.open(step, 'first', childSignal)
      await expect(context.members.continue(first.sessionId, 'next', childSignal)).rejects.toMatchObject({ code: 'CONTINUATION_UNAVAILABLE' })
      expect(context.members.inspect()).toEqual([{ sessionId: first.sessionId, label: step.label, phase: 'settled' }])
      return { stopReason: 'failed', output: 'Continuation unavailable' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('failed')
  expect(model.requests).toHaveLength(1)
  expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
})

it('waits for a persisted shared-record revision and rejects a stale compare-and-set', async () => {
  const { ctx, parent } = await bootTaskRuntime([], undefined, true)
  let observed: TaskRecordWaitResult | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'shared records', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing coordination context')
      const pending = context.coordination.records.wait('issue/1', 0, 5000, childSignal)
      const first = await context.coordination.records.write('issue/1', { status: 'open' }, 0, childSignal)
      observed = await pending
      await expect(context.coordination.records.write('issue/1', { status: 'stale' }, 0, childSignal))
        .rejects.toThrow(/revision conflict/)
      await context.coordination.records.write('issue/1', { status: 'adopted' }, first.revision, childSignal)
      expect(context.coordination.records.read('issue/1')).toMatchObject({ revision: 2, value: { status: 'adopted' } })
      return { stopReason: 'completed', output: 'record saved' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(observed).toMatchObject({ timedOut: false, record: { revision: 1, value: { status: 'open' }, writer: parent.id } })
  const stored = await loadStoredSession(ctx.sessionPersistence, parent.id)
  const records = stored.events.flatMap((event) => {
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:task-strategy/shared-record' ? [record.data] : []
  })
  expect(records).toHaveLength(2)
})

it('delivers coordination-facade messages to an active local member with the task owner as sender', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([
    { chunks: textResponse('first turn'), gate: gate.promise }, { chunks: textResponse('accepted adjustment') },
  ], undefined, true)
  let receipt: { readonly messageId: string } | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'coordination messages', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing coordination context')
      const first = context.members.open(step, 'initial', childSignal)
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      const sessionId = model.requests[0]?.sessionId
      if (sessionId === undefined) throw new Error('Missing active member session')
      receipt = await context.coordination.messages.send(sessionId, 'owner adjustment', childSignal)
      gate.resolve(undefined)
      const outcome = await first
      if (outcome.kind !== 'settled') throw new Error(outcome.error)
      return outcome.result
    } })
  try {
    const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
    expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
    expect(model.requests.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(model.requests.slice(1).map(request => request.messages))).toContain('owner adjustment')
    const memberSessionId = model.requests[0]?.sessionId
    if (memberSessionId === undefined) throw new Error('Missing active member session')
    const stored = await loadStoredSession(ctx.sessionPersistence, memberSessionId)
    expect(stored.events.some(event => event.type === 'user/message' && event.data.id === receipt?.messageId
      && event.data.source.kind === 'agent-message' && event.data.source.senderSessionId === parent.id
      && JSON.stringify(event.data.content).includes('owner adjustment'))).toBe(true)
  } finally { gate.resolve(undefined) }
})

it('exposes a capture failure as unobserved after actual execution without replay', async () => {
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('executed once') }], undefined, true)
  const capture = vi.spyOn(activationResults, 'captureLocalResult').mockImplementationOnce(() => { throw new Error('capture failed') })
  let observed: TaskMemberTurnOutcome | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'unknown', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      observed = await context.members.open(step, 'first', childSignal)
      return { stopReason: 'failed', output: 'Report unobserved result' }
    } })
  try {
    const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
    expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('failed')
    expect(observed?.kind).toBe('unobserved')
    if (observed?.kind === 'unobserved') expect(observed.error).toContain('capture failed')
    expect(model.requests).toHaveLength(1)
    expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
  } finally { capture.mockRestore() }
})

it('drains a member still executing when its owning executor returns', async () => {
  const gate = Promise.withResolvers<undefined>()
  const { ctx, parent, model } = await bootTaskRuntime([{ chunks: textResponse('late'), gate: gate.promise }], undefined, true)
  let pending: Promise<TaskMemberTurnOutcome> | undefined
  ctx.taskRuns.registerExecutor({ id: 'conversation', description: 'owned cleanup', check: () => {},
    execute: async (_parent, _step, _prompt, childSignal, context) => {
      if (context === undefined) throw new Error('Missing member context')
      pending = context.members.open(step, 'first', childSignal)
      await vi.waitFor(() => { expect(model.requests).toHaveLength(1) })
      return { stopReason: 'completed', output: 'executor finished' }
    } })
  const id = await ctx.taskRuns.start(parent, 'work', plan, rules, signal)
  expect((await ctx.jobs.wait(id, 5000, parent.id)).status).toBe('completed')
  expect(await pending).toMatchObject({ kind: 'settled', result: { stopReason: 'aborted' } })
  expect(ctx.taskRuns.inspect(parent, id).activeMembers).toEqual([])
  expect(ctx.agents.get(firstModelSession(model))).toBeUndefined()
  gate.resolve(undefined)
})

function firstModelSession(model: TaskModel) {
  const id = model.requests[0]?.sessionId
  if (id === undefined) throw new Error('Model request has no session identity')
  return id
}
