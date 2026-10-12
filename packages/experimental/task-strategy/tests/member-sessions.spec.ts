import { expect, it, vi } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { createMemberSessions } from '../src/member-sessions.ts'
import { taskRules } from './task-runtime-fixture.ts'
import { liveParent } from './live-parent.ts'

const signal = new AbortController().signal
const step = { label: 'member', preset: 'coding', instruction: 'work' }

async function fixture(results: Promise<SubagentResult>[] = [Promise.resolve({ output: [], stopReason: 'completed' })]) {
  const { ctx, parent } = await liveParent()
  const dispose = vi.fn(async () => {})
  let message = 0
  const activation = (childId: SessionId) => ({ childId, messageId: MessageId(`accepted-${++message}`),
    result: results.shift()!, dispose })
  const startActivation = vi.fn(async (spec: SubagentActivationSpec) => activation(spec.childId!))
  const continueActivation = vi.fn(async (_parent, id: SessionId) => activation(id))
  const active = new Set<SessionId>()
  const admitTurn = vi.fn()
  const checkChild = vi.fn(async (candidate) => {
    if (candidate.preset !== 'coding' || candidate.executor !== undefined) throw new Error('preset is not allowed')
  })
  const options = { ctx: { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: { startActivation, continueActivation } },
    parent, rules: taskRules, signal, checkChild, admitTurn, assertOwner: () => {},
    onActive: (id: SessionId) => { active.add(id); return () => { active.delete(id) } } }
  return { options, startActivation, continueActivation, active, dispose, admitTurn, checkChild }
}

it.each(['completed', 'failed', 'cancelled'] as const)('retains identity and actual %s feedback for explicit continuation', async (stopReason) => {
  const f = await fixture([Promise.resolve({ output: [{ type: 'text', text: 'blocked' }], stopReason, diagnostic: 'actual' }),
    Promise.resolve({ output: [{ type: 'text', text: 'recovered' }], stopReason: 'completed' })])
  const members = createMemberSessions(f.options)
  const first = await members.open(step, 'initial', signal)
  expect(first).toMatchObject({ kind: 'settled', result: { stopReason, diagnostic: 'actual', output: 'blocked' } })
  expect(members.inspect()).toEqual([{ sessionId: first.sessionId, label: step.label, phase: 'settled' }])
  const second = await members.continue(first.sessionId, 'adjustment', signal)
  expect(second).toMatchObject({ kind: 'settled', sessionId: first.sessionId, result: { output: 'recovered' } })
  expect(second.messageId).not.toBe(first.messageId)
  expect(f.continueActivation).toHaveBeenCalledWith(f.options.parent, first.sessionId, [{ type: 'text', text: 'adjustment' }], expect.anything())
  expect(f.active.size).toBe(0)
  expect(f.admitTurn).toHaveBeenCalledTimes(2)
  await members.close()
  expect(members.inspect()[0].phase).toBe('closed')
})

it('reports capture failure as unobserved without automatic replay', async () => {
  const broken = Promise.withResolvers<SubagentResult>()
  const f = await fixture([broken.promise])
  const members = createMemberSessions(f.options)
  const pending = members.open(step, 'initial', signal)
  await vi.waitFor(() => { expect(f.active.size).toBe(1) })
  broken.reject(new Error('capture unavailable'))
  expect(await pending).toMatchObject({ kind: 'unobserved', error: expect.stringContaining('capture unavailable') })
  expect(members.inspect()[0].phase).toBe('unobserved')
  expect(f.continueActivation).not.toHaveBeenCalled()
  expect(f.active.size).toBe(0)
  await members.close()
})

it('rejects foreign ids, disallowed/native steps and oversized complete requests before publication', async () => {
  const f = await fixture()
  const members = createMemberSessions(f.options)
  await expect(members.continue(SessionId('foreign'), 'text', signal)).rejects.toThrow(/member/)
  await expect(members.open({ ...step, executor: 'native' }, 'text', signal)).rejects.toThrow()
  await expect(members.open({ ...step, preset: 'unknown' }, 'text', signal)).rejects.toThrow(/allowed/)
  await expect(members.open(step, '中'.repeat(taskRules.maxPlanBytes), signal)).rejects.toThrow(/maxPlanBytes/)
  expect(f.startActivation).not.toHaveBeenCalled()
  await members.close()
})

it('returns detached views and rejects a second turn while the first is pending', async () => {
  const pending = Promise.withResolvers<SubagentResult>()
  const f = await fixture([pending.promise])
  const members = createMemberSessions(f.options)
  const opening = members.open(step, 'initial', signal)
  await vi.waitFor(() => { expect(f.active.size).toBe(1) })
  const view = members.inspect()
  Object.assign(view[0], { phase: 'closed', label: 'tampered' })
  expect(members.inspect()[0].phase).toBe('running')
  await expect(members.continue(view[0].sessionId, 'duplicate', signal)).rejects.toThrow(/executing/)
  pending.resolve({ output: [], stopReason: 'completed' })
  await opening
  await members.close()
})

it('bounds complete captured outcomes including metadata', async () => {
  const f = await fixture([Promise.resolve({ output: [{ type: 'text', text: '中'.repeat(3000) }], stopReason: 'completed' })])
  const members = createMemberSessions(f.options)
  expect(await members.open(step, 'initial', signal)).toMatchObject({ kind: 'unobserved', error: expect.stringContaining('maxResultBytes') })
  await members.close()
})

it('bounds capture diagnostics including escaped multibyte text and receipt metadata', async () => {
  const broken = Promise.withResolvers<SubagentResult>()
  const f = await fixture([broken.promise])
  const members = createMemberSessions(f.options)
  const pending = members.open(step, 'initial', signal)
  await vi.waitFor(() => { expect(f.active.size).toBe(1) })
  broken.reject(new Error('中\n"'.repeat(10000)))
  const outcome = await pending
  expect(outcome.kind).toBe('unobserved')
  expect(Buffer.byteLength(JSON.stringify(outcome), 'utf8')).toBeLessThanOrEqual(taskRules.maxResultBytes)
  await members.close()
})

it('close aborts and adopts an activation published after cancellation, then drains it', async () => {
  const result = Promise.withResolvers<SubagentResult>()
  const publish = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  const f = await fixture([result.promise])
  f.dispose.mockImplementation(async () => { result.resolve({ output: [], stopReason: 'cancelled' }) })
  const original = f.startActivation.getMockImplementation()!
  f.startActivation.mockImplementation(async (spec) => { entered.resolve(undefined); await publish.promise; return original(spec) })
  const members = createMemberSessions(f.options)
  const opening = members.open(step, 'initial', signal)
  await entered.promise
  const closing = members.close()
  const closed = vi.fn()
  void closing.then(closed)
  expect(closed).not.toHaveBeenCalled()
  publish.resolve(undefined)
  expect(await opening).toMatchObject({ kind: 'settled', result: { stopReason: 'cancelled' } })
  await closing
  expect(f.dispose).toHaveBeenCalled()
  expect(f.active.size).toBe(0)
  await expect(members.open(step, 'late', signal)).rejects.toThrow(/closed/)
})
