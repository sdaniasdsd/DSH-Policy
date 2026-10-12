import { describe, expect, it } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, adoptSessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { validateSessionMessageSources } from '../src/surface.ts'

function message(source: unknown): UserMessage {
  return { id: MessageId('note'), role: 'user', content: [{ type: 'text', text: 'history hint' }],
    ...(source === undefined ? {} : { source: source as UserMessage['source'] }) } as unknown as UserMessage
}

describe('current message source admission', () => {
  it.each([undefined, null, [], {}, { kind: '' }, { kind: 1 }, { kind: 'plugin', plugin: 'deja' }])(
    'rejects an invalid source before publishing or consuming a sequence: %j', (source) => {
      const session = Session.create(SessionId('admission'))
      expect(() => session.append('user/message', message(source), { surfaceOp: 'append' }))
        .toThrow(/producer-owned source kind/)
      expect(session.seq).toBe(0)
      expect(session.surface.nodes).toEqual([])
      session.append('user/message', message({ kind: 'plugin:deja' }), { surfaceOp: 'append' })
      expect(session.seq).toBe(1)
    },
  )

  it('rejects the whole inbox batch before it becomes durable pending input', () => {
    const session = Session.create(SessionId('inbox-admission'))
    expect(() => session.append('agent/inbox/spliced', {
      target: 'next-step', start: 0,
      inserted: [message({ kind: 'user' }), message({ kind: 'plugin', plugin: 'deja' })],
    })).toThrow(/inserted\[1\].*producer-owned source kind/)
    expect(session.seq).toBe(0)
  })

  it.each(['system/message', 'developer/message', 'assistant/message', 'tool/result',
    'session/title-llm-request'])('checks every embedded message slot in %s', (type) => {
    const note = { ...message({ kind: 'plugin', plugin: 'deja' }),
      role: type === 'developer/message' ? 'developer' : type === 'system/message' ? 'system'
        : type === 'assistant/message' ? 'assistant' : type === 'tool/result' ? 'tool' : 'user' }
    const data = type === 'session/title-llm-request' ? { messages: [note] } : { message: note }
    const event = { type, seq: SessionSeq(0), time: 1, data,
      ...(type === 'session/title-llm-request' ? {} : { surfaceOp: 'append' }) } as SessionEvent
    expect(() => { validateSessionMessageSources(event, 'candidate') }).toThrow(/producer-owned source kind/)
    expect(() => adoptSessionEvent(event)).toThrow(/source/)
  })
})
