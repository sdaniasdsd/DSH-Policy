import { describe, expect, it } from 'vitest'
import { LlmAttemptId, MessageId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { EntryView } from '../src/entry-types.ts'
import { taskEntryDefinition } from '../src/client/task-entry-node.ts'
import { assistantDefinition } from '../../../client/ui-chat/src/client/conversation-nodes/assistant.ts'

describe('task entry live conversation publication', () => {
  it.each(['conversation', 'Associated with request-original'])(
    'keeps publishing after routing settles as %s without reopening the conversation', (progress) => {
      const nodes = new Map<string, ChatConversationViewNode>()
      const assembler = new ConversationNodeAssembler({
        entries: () => [taskEntryDefinition, assistantDefinition], fallbackEntry: () => undefined,
      }, {
        entries: () => [{ target: 'chat', create: () => ({
          empty: null,
          replace: ({ nodes: replacement }) => {
            nodes.clear()
            for (const node of replacement) nodes.set(node.key, node as ChatConversationViewNode)
            return null
          },
          apply: ({ upserts }) => {
            for (const node of upserts) nodes.set(node.key, node as ChatConversationViewNode)
            return null
          },
        }) }],
      })
      assembler.activateTarget('chat')
      const base: EntryView = { sessionId: SessionId('owner'), messageId: MessageId('message'),
        requestId: 'request', state: 'routing' }
      let seq = 0
      const publish = (view: EntryView): void => {
        assembler.append({ type: 'event', event: {
          type: 'task-strategy/entry', seq: SessionSeq(seq++), time: seq,
          data: { view, input: createUserMessage({ source: { kind: 'user' }, content: [] }) },
        } })
        assembler.flush()
      }
      publish(base)
      const initial = [...nodes.values()][0]
      expect(initial?.visibility).toBe('visible')

      publish({ ...base, state: 'completed', progress })
      expect(nodes.get(initial!.key)).toMatchObject({ key: initial!.key, visibility: 'hidden' })

      const next = { ...base, requestId: 'next-request', messageId: MessageId('next-message') }
      publish(next)
      publish({ ...next, state: 'running', progress: 'working' })
      publish({ ...next, state: 'completed', progress: 'done' })
      expect([...nodes.values()].map(node => ({
        id: node.id, visibility: node.visibility, state: (node.data as EntryView).state,
      }))).toMatchInlineSnapshot(`
        [
          {
            "id": "request",
            "state": "completed",
            "visibility": "hidden",
          },
          {
            "id": "next-request",
            "state": "completed",
            "visibility": "visible",
          },
        ]
      `)
      assembler.append({ type: 'event', event: {
        type: 'turn/start', seq: SessionSeq(10), time: 10, data: { turn: 1 },
      } })
      assembler.append({ type: 'event', event: {
        type: 'step/start', seq: SessionSeq(11), time: 11, data: { turn: 1, step: 1 },
      } })
      assembler.append({ type: 'transient', event: {
        type: 'assistant/live-chunk', seq: SessionSeq(12), time: 12, data: {
          attemptId: LlmAttemptId('refresh-probe'), turn: 1, step: 1,
          chunk: { type: 'text-delta', index: 0, text: 'LIVE_PROGRESS' },
        },
      } })
      assembler.flush()
      const live = [...nodes.values()].find(node => node.kind === 'assistant-step')
      expect(live?.visibility).toBe('visible')
      expect(JSON.stringify(live?.data)).toContain('LIVE_PROGRESS')
      assembler.append({ type: 'event', event: {
        type: 'assistant/message', seq: SessionSeq(13), time: 13, surfaceOp: 'append', data: {
          turn: 1, step: 1, stream: [], message: createAssistantMessage({
            content: [{ type: 'text', text: 'FINAL_RESULT' }], source: { provider: 'mock', model: 'mock' },
          }),
        },
      } })
      assembler.flush()
      expect(JSON.stringify(nodes.get(live!.key)?.data)).toContain('FINAL_RESULT')
    },
  )
})
