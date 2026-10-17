import { expect, it, vi } from 'vitest'
import { executeDshChild } from '../src/dsh-child.ts'
import { liveParent } from './live-parent.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'

it('normalizes Windows read separators and isolates each child evidence budget', async () => {
  const { ctx, parent } = await liveParent()
  const child = Session.create(SessionId('child'), undefined, { ...parent.session.header, id: SessionId('child'), parentSession: parent.id })
  const sibling = Session.create(SessionId('sibling'), undefined, { ...parent.session.header, id: SessionId('sibling'), parentSession: parent.id })
  const dispose = vi.fn(async () => {})
  let startedCwd: string | undefined
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: { startActivation: async (
    spec: { request: { cwd?: string } }) => {
    startedCwd = spec.request.cwd
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
  expect(startedCwd).toBe(ctx.get('workingDirectory')?.get(parent.session) ?? parent.session.header.cwd)
  expect(result.usage).toEqual({ modelCalls: 1, reportedCalls: 1, observedTokens: 18 })
  expect(dispose).toHaveBeenCalledOnce()
})
