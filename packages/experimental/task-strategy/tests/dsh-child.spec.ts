import { expect, it, vi } from 'vitest'
import { executeDshChild } from '../src/dsh-child.ts'
import { liveParent } from './live-parent.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createToolResultMessage, MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'

it('normalizes Windows read separators and isolates each child evidence budget', async () => {
  const { ctx, parent } = await liveParent()
  const child = Session.create(SessionId('child'), undefined, { ...parent.session.header, id: SessionId('child'), parentSession: parent.id })
  const sibling = Session.create(SessionId('sibling'), undefined, { ...parent.session.header, id: SessionId('sibling'), parentSession: parent.id })
  const dispose = vi.fn(async () => {})
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
    continueActivation: async () => { throw new Error('unexpected continuation') },
    startActivation: async () => {
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

it('stops a strategy child after three identical tool calls fail', async () => {
  const { ctx, parent } = await liveParent()
  const childId = SessionId('repeated-tool-error-child')
  const child = Session.create(childId, undefined, { ...parent.session.header, id: childId, parentSession: parent.id })
  const dispose = vi.fn(async () => {})
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
    continueActivation: async () => { throw new Error('unexpected continuation') },
    startActivation: async () => {
      throw new Error('the injected activation should be used')
    } } }
  const activate = async (spec: { signal: AbortSignal }) => {
    for (let index = 0; index < 3; index++) {
      const callId = ToolCallId(`repeated-read-${index}`)
      ctx.emit('session/event', child, child.append('tool/call', {
        turn: 1, step: index + 1, callId, name: 'read',
        arguments: JSON.stringify({ file_path: 'C:\\work' }),
      }))
      ctx.emit('session/event', child, child.append('tool/result', {
        turn: 1, step: index + 1,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'not a regular file' }], isError: true }),
      }, { surfaceOp: 'append' }))
    }
    return {
      childId, messageId: MessageId('repeated-tool-error-work'),
      result: Promise.resolve({ stopReason: spec.signal.aborted ? 'aborted' as const : 'completed' as const, output: [] }),
      dispose,
    }
  }
  const settled = await executeDshChild(services, parent, 'spawn', {
    label: 'understand', preset: 'standard', instruction: 'read only',
  }, 'read only', new AbortController().signal, 65536, undefined, activate)

  expect(settled.stopReason).toBe('aborted')
  expect(settled.diagnostic).toContain('three identical tool calls failed')
  expect(dispose).toHaveBeenCalledOnce()
})

it('does not stop after three failures for different tool arguments', async () => {
  const { ctx, parent } = await liveParent()
  const childId = SessionId('different-tool-errors-child')
  const child = Session.create(childId, undefined, { ...parent.session.header, id: childId, parentSession: parent.id })
  const dispose = vi.fn(async () => {})
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
    continueActivation: async () => { throw new Error('unexpected continuation') },
    startActivation: async () => {
      throw new Error('the injected activation should be used')
    } } }
  const activate = async (spec: { signal: AbortSignal }) => {
    for (let index = 0; index < 3; index++) {
      const callId = ToolCallId(`different-read-${index}`)
      ctx.emit('session/event', child, child.append('tool/call', {
        turn: 1, step: index + 1, callId, name: 'read',
        arguments: JSON.stringify({ file_path: `C:\\work\\file-${index}.txt` }),
      }))
      ctx.emit('session/event', child, child.append('tool/result', {
        turn: 1, step: index + 1,
        message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'not found' }], isError: true }),
      }, { surfaceOp: 'append' }))
    }
    return {
      childId, messageId: MessageId('different-tool-error-work'),
      result: Promise.resolve({ stopReason: spec.signal.aborted ? 'aborted' as const : 'completed' as const, output: [] }),
      dispose,
    }
  }
  const settled = await executeDshChild(services, parent, 'spawn', {
    label: 'understand', preset: 'standard', instruction: 'read only',
  }, 'read only', new AbortController().signal, 65536, undefined, activate)

  expect(settled.stopReason).toBe('completed')
  expect(settled.diagnostic).toBeUndefined()
})

it('continues a max-token child once and preserves its partial output', async () => {
  const { ctx, parent } = await liveParent()
  const childId = SessionId('max-token-continuation-child')
  const firstDispose = vi.fn(async () => {})
  const continuationDispose = vi.fn(async () => {})
  const continueActivation = vi.fn<typeof ctx.subagents.continueActivation>(async () => ({ childId, messageId: MessageId('continue-once'),
    result: Promise.resolve({ stopReason: 'completed' as const, output: [{ type: 'text' as const, text: 'finished part' }],
      structured: { status: 'resolved', conclusion: 'finished', evidence: ['verified'], blocker: '', nextStep: '' } }),
    dispose: continuationDispose,
  }))
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
    startActivation: async () => ({ childId, messageId: MessageId('initial'),
      result: Promise.resolve({ stopReason: 'max-tokens' as const, output: [{ type: 'text' as const, text: 'partial part' }] }),
      dispose: firstDispose,
    }),
    continueActivation,
  } }

  const settled = await executeDshChild(services, parent, 'spawn', {
    label: 'long output', preset: 'standard', instruction: 'continue', maxTokens: 128, finalSummaryOutput: true,
  }, 'produce a bounded answer', new AbortController().signal, 65536)

  expect(continueActivation).toHaveBeenCalledOnce()
  expect(continueActivation.mock.calls[0]?.[1]).toBe(childId)
  expect(continueActivation.mock.calls[0]?.[2]).toEqual([{ type: 'text',
    text: '上一条回复因单次输出上限被截断。请从截断处继续，不要重写已完成内容；如果剩余内容较长，请拆分成较小部分逐段完成。' }])
  expect(continueActivation.mock.calls[0]?.[3]).toMatchObject({ resume: {
    maxTokens: 128, outputSchema: { type: 'object', properties: expect.any(Object) },
  } })
  expect(settled.stopReason).toBe('completed')
  expect(settled.output).toContain('partial part')
  expect(settled.output).toContain('finished part')
  expect(settled.finalSummary).toMatchObject({ status: 'resolved', conclusion: 'finished', evidence: ['verified'] })
  expect(firstDispose).toHaveBeenCalledOnce()
  expect(continuationDispose).toHaveBeenCalledOnce()
})

it('does not continue again when the extra turn also reaches the output limit', async () => {
  const { ctx, parent } = await liveParent()
  const childId = SessionId('max-token-continuation-limit-child')
  const firstDispose = vi.fn(async () => {})
  const continuationDispose = vi.fn(async () => {})
  const continueActivation = vi.fn<typeof ctx.subagents.continueActivation>(async () => ({ childId, messageId: MessageId('continue-once'),
    result: Promise.resolve({ stopReason: 'max-tokens' as const, output: [{ type: 'text' as const, text: 'second partial' }] }),
    dispose: continuationDispose,
  }))
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
    startActivation: async () => ({ childId, messageId: MessageId('initial'),
      result: Promise.resolve({ stopReason: 'max-tokens' as const, output: [{ type: 'text' as const, text: 'first partial' }] }),
      dispose: firstDispose,
    }),
    continueActivation,
  } }

  const settled = await executeDshChild(services, parent, 'spawn', {
    label: 'long output', preset: 'standard', instruction: 'continue', maxTokens: 128,
  }, 'produce a bounded answer', new AbortController().signal, 65536)

  expect(continueActivation).toHaveBeenCalledOnce()
  expect(settled.stopReason).toBe('max-tokens')
  expect(settled.output).toContain('first partial')
  expect(settled.output).toContain('second partial')
  expect(firstDispose).toHaveBeenCalledOnce()
  expect(continuationDispose).toHaveBeenCalledOnce()
})

it('repairs a malformed final-summary structured output once within the existing schema', async () => {
  const { ctx, parent } = await liveParent()
  const childId = SessionId('final-summary-repair-child')
  const firstDispose = vi.fn(async () => {})
  const continuationDispose = vi.fn(async () => {})
  const continueActivation = vi.fn<typeof ctx.subagents.continueActivation>(async () => ({ childId,
    messageId: MessageId('repair-summary'),
    result: Promise.resolve({ stopReason: 'completed' as const, output: [{ type: 'text' as const, text: 'corrected summary' }],
      structured: { status: 'resolved', conclusion: 'Four files were created and verified.',
        evidence: ['All four files exist.', 'All four contents match.', 'The job completed.'], blocker: '', nextStep: '' } }),
    dispose: continuationDispose,
  }))
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
    startActivation: async () => { throw new Error('the injected activation should be used') },
    continueActivation,
  } }
  const activate = async () => ({ childId, messageId: MessageId('invalid-summary'),
    result: Promise.resolve({ stopReason: 'completed' as const, output: [{ type: 'text' as const, text: 'four evidence items' }],
      structured: { status: 'resolved', conclusion: 'Four files were created and verified.',
        evidence: ['File one verified.', 'File two verified.', 'File three verified.', 'File four verified.'], blocker: '', nextStep: '' } }),
    dispose: firstDispose,
  })

  const settled = await executeDshChild(services, parent, 'spawn', {
    label: 'final-summary', preset: 'standard', instruction: 'summarize', maxTokens: 768, finalSummaryOutput: true,
  }, 'return a bounded final summary', new AbortController().signal, 65536, undefined, activate)

  expect(continueActivation).toHaveBeenCalledOnce()
  expect(continueActivation.mock.calls[0]?.[1]).toBe(childId)
  expect(continueActivation.mock.calls[0]?.[2]).toEqual([{ type: 'text', text: expect.stringContaining('evidence') }])
  expect(continueActivation.mock.calls[0]?.[3]).toMatchObject({ resume: {
    maxTokens: 768, outputSchema: { type: 'object', properties: expect.any(Object) },
  } })
  expect(settled.finalSummary?.evidence).toHaveLength(3)
  expect(firstDispose).toHaveBeenCalledOnce()
  expect(continuationDispose).toHaveBeenCalledOnce()
})

it('repairs a final-review response that ended without structured output once', async () => {
  const { ctx, parent } = await liveParent()
  const childId = SessionId('final-review-repair-child')
  const firstDispose = vi.fn(async () => {})
  const continuationDispose = vi.fn(async () => {})
  const continueActivation = vi.fn<typeof ctx.subagents.continueActivation>(async () => ({ childId,
    messageId: MessageId('repair-review'),
    result: Promise.resolve({ stopReason: 'completed' as const, output: [{ type: 'text' as const, text: 'review structured' }],
      structured: { status: 'unverified', issues: [] } }),
    dispose: continuationDispose,
  }))
  const services = { on: ctx.on.bind(ctx), get: ctx.get.bind(ctx), subagents: {
    startActivation: async () => ({ childId, messageId: MessageId('initial-review'),
      result: Promise.resolve({ stopReason: 'error' as const, output: [{ type: 'text' as const, text: 'status: unverified; issues: []' }] }),
      dispose: firstDispose,
    }),
    continueActivation,
  } }

  const settled = await executeDshChild(services, parent, 'spawn', {
    label: 'final-review', preset: 'standard', instruction: 'review read-only evidence', maxTokens: 768, reviewOutput: true,
  }, 'return a concise review', new AbortController().signal, 65536)

  expect(continueActivation).toHaveBeenCalledOnce()
  expect(continueActivation.mock.calls[0]?.[1]).toBe(childId)
  expect(continueActivation.mock.calls[0]?.[2]).toEqual([{ type: 'text', text: expect.stringContaining('structured_output') }])
  expect(continueActivation.mock.calls[0]?.[3]).toMatchObject({ resume: {
    maxTokens: 768, outputSchema: { type: 'object', properties: expect.any(Object) },
  } })
  expect(settled.stopReason).toBe('completed')
  expect(settled.review).toEqual({ status: 'unverified', issues: [] })
  expect(firstDispose).toHaveBeenCalledOnce()
  expect(continuationDispose).toHaveBeenCalledOnce()
})
