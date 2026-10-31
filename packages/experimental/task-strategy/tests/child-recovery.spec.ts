import { afterEach, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'
import type { SubagentActivation, SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { executeDshChild } from '../src/dsh-child.ts'
import type { TaskStep } from '../src/types.ts'

afterEach(() => { vi.useRealTimers() })
const parent = { id: SessionId('parent'), session: { header: { cwd: 'C:/workspace' } } } as Agent
const step: TaskStep = { label: 'build', preset: 'coding', instruction: 'Build and verify the existing file',
  timeoutMs: 10, maxTokens: 4096, continuation: { maxAttempts: 2, timeoutMs: 20 } }

function fixture(next: SubagentResult, nextDelay = 15) {
  function activation(result: SubagentResult, delay: number): SubagentActivation {
    const pending = Promise.withResolvers<SubagentResult>()
    const timer = setTimeout(() => { pending.resolve(result) }, delay)
    const run = { childId: SessionId('retained-child'), messageId: MessageId('message'), result: pending.promise,
      dispose: vi.fn(async () => { clearTimeout(timer); pending.resolve({ stopReason: 'aborted', output: [] }) }) }
    return run
  }
  const startActivation = vi.fn(async (_spec: SubagentActivationSpec) => activation({ stopReason: 'max-tokens',
    output: [{ type: 'text', text: 'saved partial; ' }] }, 8))
  const ctx = { on: vi.fn(() => () => {}), get: vi.fn(() => undefined),
    subagents: { startActivation } } as unknown as Parameters<typeof executeDshChild>[0]
  const continueRun = vi.fn(async (spec: SubagentActivationSpec & { childId: SessionId }) => {
    const run = activation(next, nextDelay)
    spec.signal.addEventListener('abort', () => { void run.dispose() }, { once: true })
    return run
  })
  return { ctx, continueRun }
}

it('gives an opted-in continuation its own bounded time while retaining the stage and session', async () => {
  vi.useFakeTimers()
  const f = fixture({ stopReason: 'completed', output: [{ type: 'text', text: 'verified' }] })
  const pending = executeDshChild(f.ctx, parent, 'spawn', step, 'Original user goal', new AbortController().signal, 8192,
    undefined, undefined, undefined, f.continueRun)
  await vi.advanceTimersByTimeAsync(25)
  expect(await pending).toMatchObject({ stopReason: 'completed', sessionId: 'retained-child', output: 'saved partial; verified' })
  expect(f.continueRun.mock.calls[0]![0].request.agentOptions?.maxTokens).toBe(4096)
  expect(JSON.stringify(f.continueRun.mock.calls[0]![0].request.prompt)).toContain(step.instruction)
  expect(vi.getTimerCount()).toBe(0)
})

it('retains the original deadline when no continuation deadline is configured and reports the timeout', async () => {
  vi.useFakeTimers()
  const f = fixture({ stopReason: 'completed', output: [] })
  const pending = executeDshChild(f.ctx, parent, 'spawn', { ...step, continuation: { maxAttempts: 2 } }, 'goal',
    new AbortController().signal, 8192, undefined, undefined, undefined, f.continueRun)
  await vi.advanceTimersByTimeAsync(11)
  const result = await pending
  expect(result).toMatchObject({ stopReason: 'aborted', output: 'saved partial; ' })
  expect(result.diagnostic).toContain('deadline exceeded: build (10 ms)')
})

it('times out a stalled continuation with partial output and its session still available', async () => {
  vi.useFakeTimers()
  const f = fixture({ stopReason: 'completed', output: [] }, 50)
  const pending = executeDshChild(f.ctx, parent, 'spawn', step, 'goal', new AbortController().signal, 8192,
    undefined, undefined, undefined, f.continueRun)
  await vi.advanceTimersByTimeAsync(30)
  const result = await pending
  expect(result).toMatchObject({ stopReason: 'aborted', output: 'saved partial; ', sessionId: 'retained-child' })
  expect(result.diagnostic).toContain('deadline exceeded: build (20 ms)')
  expect(f.continueRun).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves cancellation and never renews it as another recovery attempt', async () => {
  vi.useFakeTimers()
  const f = fixture({ stopReason: 'completed', output: [] })
  const controller = new AbortController()
  const pending = executeDshChild(f.ctx, parent, 'spawn', step, 'goal', controller.signal, 8192,
    undefined, undefined, undefined, f.continueRun)
  await vi.advanceTimersByTimeAsync(9)
  controller.abort(new Error('User cancelled the stage'))
  const result = await pending
  expect(result).toMatchObject({ stopReason: 'aborted', output: 'saved partial; ' })
  expect(result.diagnostic).toContain('User cancelled')
  expect(f.continueRun).toHaveBeenCalledOnce()
})

it('retains prior results when starting the continuation fails', async () => {
  vi.useFakeTimers()
  const f = fixture({ stopReason: 'completed', output: [] })
  f.continueRun.mockRejectedValue(new Error('provider unavailable'))
  const pending = executeDshChild(f.ctx, parent, 'spawn', step, 'goal', new AbortController().signal, 8192,
    undefined, undefined, undefined, f.continueRun)
  await vi.advanceTimersByTimeAsync(9)
  expect(await pending).toMatchObject({ stopReason: 'error', output: 'saved partial; ', sessionId: 'retained-child', diagnostic: 'Error: provider unavailable' })
})
