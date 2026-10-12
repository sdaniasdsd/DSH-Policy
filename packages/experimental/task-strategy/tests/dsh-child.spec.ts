import { expect, it, vi } from 'vitest'
import { executeDshChild } from '../src/dsh-child.ts'
import { liveParent } from './live-parent.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'

it.each([false, true])('preserves execution facts when child disposal also fails: execution failure %s', async (fails) => {
  const { ctx, parent } = await liveParent()
  const result = { stopReason: 'completed' as const, output: [{ type: 'text' as const, text: 'already executed' }] }
  const executionError = new Error('execution failed after partial work')
  const disposalError = new Error('persistence failed')
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: { startActivation: async () => ({
    childId: SessionId('child'), messageId: MessageId('work'),
    result: fails ? Promise.reject(executionError) : Promise.resolve(result),
    dispose: async () => { throw disposalError },
  }) } }
  let failure: unknown
  try {
    await executeDshChild(services, parent, 'spawn', { label: 'inspect', instruction: 'inspect' },
      'inspect', new AbortController().signal, 65536)
  } catch (error) { failure = error }
  expect(failure).toMatchObject({ code: 'CHILD_DISPOSAL_FAILED', childId: 'child',
    executionResult: fails ? undefined : result, executionFailure: fails ? executionError : undefined,
    disposalFailure: disposalError })
  expect(String(failure)).toContain(fails ? 'execution failed' : 'execution returned completed')
})

it('normalizes Windows read separators and isolates each child evidence budget', async () => {
  const { ctx, parent } = await liveParent()
  const child = Session.create(SessionId('child'), undefined, { ...parent.session.header, id: SessionId('child'), parentSession: parent.id })
  const sibling = Session.create(SessionId('sibling'), undefined, { ...parent.session.header, id: SessionId('sibling'), parentSession: parent.id })
  const dispose = vi.fn(async () => {})
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: { startActivation: async () => {
    for (const session of [sibling, child]) {
      const event = session.append('tool/ptc-dispatch', {
        rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: ToolCallId('read'),
        name: 'read', arguments: { file_path: 'out/gate.md' }, isError: false,
        content: [{ type: 'text', text: '1: observed\n' + 'x'.repeat(40000) }],
      })
      ctx.emit('session/event', session, event)
    }
    const event = child.append('assistant/message', { turn: 1, step: 1, stream: [],
      message: createAssistantMessage({ content: [], source: { provider: 'mock', model: 'mock' } }),
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, totalTokens: 18 },
    }, { surfaceOp: 'append' })
    ctx.emit('session/event', child, event)
    return { childId: child.id, messageId: MessageId('work'),
      result: Promise.resolve({ stopReason: 'completed' as const, output: [] }), dispose }
  } } }
  const result = await executeDshChild(services, parent, 'spawn', {
    label: 'verify', preset: 'standard', instruction: 'read', artifactChecks: [{ id: 'file', path: 'out\\gate.md', contains: 'observed' }],
  }, 'read', new AbortController().signal, 65536)
  expect(result.verification?.status).toBe('passed')
  expect(result.usage).toEqual({ modelCalls: 1, reportedCalls: 1, observedTokens: 18 })
  expect(dispose).toHaveBeenCalledOnce()
})
