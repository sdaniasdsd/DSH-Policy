import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Llm, { MessageId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { mountLocalActivations } from '../../../subagent/subagent/tests/local-activation.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

function note(source: unknown): UserMessage {
  return { id: MessageId(randomUUID()), role: 'user', content: [{ type: 'text', text: 'history hint' }], source } as UserMessage
}

async function boot(legacyPluginSources: string[]) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, { llm: Llm, sessions: Sessions, projections: Projections,
    'system-prompt': SystemPrompt, tools: Tools, agents: Agents, 'agent-loop': AgentLoop,
    subagents: Subagents, spawn: Spawn })
  for (const name of ['llm', 'sessions', 'projections', 'system-prompt', 'tools', 'agents',
    'agent-loop', 'subagents', 'spawn']) {
    await ctx.loader.create({ name: `cordis:${name}`,
      ...(name === 'agent-loop' ? { config: { agents: [], legacyPluginSources } } : {}) })
  }
  await ctx.loader.await()
  await mountLocalActivations(ctx)
  ctx.tools.register(defineTool({ name: 'failed_shell', description: 'Simulated exit status 1', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { throw new Error('command exited 1') } }))
  return ctx
}

it.each([{ allowed: ['deja'], producer: 'deja', accepted: true }, { allowed: [], producer: 'deja', accepted: false },
  { allowed: ['deja'], producer: 'other-plugin', accepted: false }])(
  'preserves tool execution and reopens the child log for $producer with compatibility $accepted', async ({ allowed, producer, accepted }) => {
    const ctx = await boot(allowed)
    const original = note({ kind: 'plugin', plugin: producer, form: 'notice' })
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      const decision = await next()
      return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], original] }
    })
    const model = new MockAdapter([toolCallResponse('shell', 'failed_shell', {}), textResponse('recovered')])
    ctx.llm.registerAdapter(['mock'], model)
    const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
    const run = await ctx.subagents.startActivation({ provider: 'spawn', label: 'work:inspect', delivery: 'caller',
      signal: new AbortController().signal, request: { parent, prompt: [{ type: 'text', text: 'inspect' }] } })
    const result = await run.result
    expect(result.stopReason).toBe(accepted ? 'completed' : 'error')
    if (!accepted) expect(result.diagnostic).toMatch(/producer-owned source kind/)
    await expect(run.dispose()).resolves.toBeUndefined()
    const stored = await loadStoredSession(ctx.sessionPersistence, run.childId)
    expect(stored.events.at(-1)?.type).toBe('turn/end')
    const end = stored.events.at(-1)
    if (!accepted) expect(end?.type === 'turn/end' && end.data.reason.kind === 'error' && end.data.reason.error.code)
      .toBe('INVALID_MESSAGE_SOURCE')
    const tool = stored.events.find(event => event.type === 'tool/result')
    expect(tool?.type === 'tool/result' && tool.data.message.isError).toBe(true)
    expect(JSON.stringify(tool)).toContain('command exited 1')
    expect(JSON.stringify(stored.events)).not.toContain('"kind":"plugin"')
    const persistedNote = stored.events.find(event => event.type === 'user/message' && event.data.id === original.id)
    if (accepted) {
      expect(persistedNote?.type === 'user/message' && persistedNote.data.source)
        .toEqual({ kind: 'plugin:deja', form: 'notice' })
      expect(model.requests).toHaveLength(2)
    } else {
      expect(persistedNote).toBeUndefined()
      expect(model.requests).toHaveLength(1)
    }
    expect(original.source).toEqual({ kind: 'plugin', plugin: producer, form: 'notice' })
  },
)

it('rejects an unidentified producer atomically even with a compatibility allowlist', async () => {
  const ctx = await boot(['deja'])
  const handle = await ctx.agents.create({ sessionId: SessionId('queued'), agentOptions: {} })
  const before = handle.agent.session.seq
  expect(() => handle.agent.inbox.splice('next-turn', 0, 0, [
    note({ kind: 'plugin', plugin: 'deja' }), note({ kind: 'plugin' }),
  ])).toThrow(/producer-owned source kind/)
  expect(handle.agent.inbox.nextTurn).toEqual([])
  expect(handle.agent.session.seq).toBe(before)
  await handle.dispose()
})
