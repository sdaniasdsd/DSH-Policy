import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mountWorkingDirectoryFixture } from '../../subagent/tests/working-directory-fixture.ts'
import { loadStoredSession } from '../../subagent/tests/persistence-helpers.ts'
import * as tool from '../src/index.ts'

const fixtures: { ctx: Context; root: string }[] = []
afterEach(async () => {
  for (const { ctx, root } of fixtures.splice(0)) {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

const USER_REQUEST = 'Compare the two approaches in parallel. If a worker finds a missing investigation, have the lead assign it as another parallel task.'
const CHILD_REPORT = 'The comparison is complete. Two independent follow-ups remain: accuracy and latency.'
const FINAL_ANSWER = 'The two approaches are compared, and the lead completed both follow-up investigations in parallel.'

function parallelToolCallResponse(calls: { id: string; name: string; args: object }[]): StreamChunk[] {
  const chunks: StreamChunk[] = calls.flatMap((call, index) => {
    const argumentsJson = JSON.stringify(call.args)
    return [
      { type: 'block-start' as const, index, blockType: 'tool-call' as const },
      { type: 'tool-call-delta' as const, index, id: ToolCallId(call.id), name: call.name, argumentsDelta: argumentsJson },
      { type: 'block-end' as const, index, block: { type: 'tool-call' as const, id: ToolCallId(call.id), name: call.name, arguments: argumentsJson } },
    ]
  })
  return [...chunks, { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }, { type: 'finish', reason: { kind: 'tool-calls' } }]
}

async function setup() {
  const ctx = new Context()
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-supervisor-conversation-'))
  fixtures.push({ ctx, root })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  const childAdapter = new MockAdapter([
    toolCallResponse('nested-dispatch', 'subagent', {
      description: 'missing investigation',
      prompt: 'Investigate the missing comparison point.',
    }),
    textResponse(CHILD_REPORT),
    textResponse('Follow-up A complete: approach accuracy is stronger.'),
    textResponse('Follow-up B complete: approach latency is lower.'),
  ])
  const leadAdapter = new MockAdapter([
    toolCallResponse('lead-worker', 'subagent', { description: 'compare approaches', prompt: USER_REQUEST }),
    parallelToolCallResponse([
      { id: 'sibling-a', name: 'subagent', args: { description: 'accuracy review', prompt: 'Investigate approach accuracy.' } },
      { id: 'sibling-b', name: 'subagent', args: { description: 'latency review', prompt: 'Investigate approach latency.' } },
    ]),
    textResponse(FINAL_ANSWER),
  ])
  ctx.llm.registerAdapter(['leadmock'], leadAdapter)
  ctx.llm.registerAdapter(['workermock'], childAdapter)
  await ctx.plugin(tool, {
    provider: 'spawn',
    maxDepth: 1,
    agentOptions: { provider: 'workermock', model: 'workermock' },
  })
  const lead = await ctx.agentLoop.create(SessionId('supervisor-lead'), { provider: 'leadmock', model: 'leadmock' })
  return { ctx, lead, leadAdapter }
}

function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('supervisor delegation conversation', () => {
  it('returns the worker result and blocks a child from starting a nested delegation', async () => {
    const { ctx, lead } = await setup()
    const dispatch = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('lead-dispatch'),
      name: 'subagent',
      arguments: { description: 'compare approaches', prompt: USER_REQUEST },
      agent: lead,
    })
    if (dispatch.isError) throw new Error('expected child result')
    expect(textOf(dispatch)).toContain(CHILD_REPORT)
    const value = dispatch.value
    if (typeof value !== 'object' || value === null || !('subagentId' in value) || typeof value.subagentId !== 'string') {
      throw new Error('expected a structured supervisor result')
    }
    const childId = SessionId(value.subagentId)
    const child = await loadStoredSession(ctx.sessionPersistence, childId)
    const nestedFailure = child.events.find(event => event.type === 'tool/result' && event.data.message.isError)
    expect(nestedFailure).toBeDefined()
    expect(JSON.stringify(nestedFailure)).toContain('subagent')
  })

  it('runs lead → worker → parallel siblings → final answer from one user text input', async () => {
    const { ctx, lead, leadAdapter } = await setup()
    const startedIds: string[] = []
    ctx.on('subagent/start', (info) => { startedIds.push(String(info.id)) })

    lead.followup(createUserMessage({ content: [{ type: 'text', text: USER_REQUEST }], source: { kind: 'user' } }))
    await lead.whenIdle()

    const assistantMessages = lead.session.snapshotEvents().filter(event => event.type === 'assistant/message')
    const last = assistantMessages.at(-1)
    const finalText = last?.type === 'assistant/message'
      ? last.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
      : ''
    expect(finalText).toBe(FINAL_ANSWER)
    expect(leadAdapter.requests).toHaveLength(3)
    expect(startedIds).toHaveLength(3)
    const worker = await loadStoredSession(ctx.sessionPersistence, SessionId(startedIds[0]!))
    const blockedNestedDispatch = worker.events.find(event => event.type === 'tool/result' && event.data.message.isError)
    expect(blockedNestedDispatch).toBeDefined()
    expect(JSON.stringify(blockedNestedDispatch)).toContain('subagent')
    for (const id of startedIds) {
      const child = await loadStoredSession(ctx.sessionPersistence, SessionId(id))
      expect(child.meta.origin).toBe('subagent')
      expect(child.meta.parentSession).toBe(lead.id)
    }
    const siblingReports = await Promise.all(startedIds.slice(1).map(async (id) => {
      const child = await loadStoredSession(ctx.sessionPersistence, SessionId(id))
      return child.events.filter(event => event.type === 'assistant/message').map(event =>
        event.type === 'assistant/message'
          ? event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
          : '',
      ).join('\n')
    }))
    expect(siblingReports).toEqual([
      'Follow-up A complete: approach accuracy is stronger.',
      'Follow-up B complete: approach latency is lower.',
    ])
  })
})
