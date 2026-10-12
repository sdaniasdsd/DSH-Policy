import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { liveParent } from './live-parent.ts'
import { routeEntry } from '../src/entry-router.ts'
import type { EntryView } from '../src/entry-types.ts'

interface Recording {
  fingerprint: string
  request: { input: ContentBlock[]; ownedTasks: { requestId: string; state: EntryView['state'] }[]; route: object }
  response: Pick<SubagentResult, 'stopReason' | 'structured'>
}
const recordings = JSON.parse(readFileSync(new URL('./fixtures/entry-recordings.json', import.meta.url), 'utf8')) as Recording[]
function lookup(request: Recording['request']): Recording {
  const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  const fixture = recordings.find(row => row.fingerprint === fingerprint)
  if (!fixture) throw new Error('Missing recorded boundary response; live calls are forbidden in replay')
  return fixture
}
describe('real incident boundary replay (no network)', () => {
  it.each(recordings)('replays $response.stopReason with recorded request fingerprint $fingerprint', async (fixture) => {
    const recorded = lookup(fixture.request)
    const dispose = vi.fn(async () => {})
    const result: SubagentResult = { ...recorded.response, output: [] }
    const provider: SubagentProvider = { name: 'spawn', inheritsParentContext: false,
      capabilities: { outputSchema: true, toolFilter: true, agentOptions: true, depthLimit: true, persona: true },
      prepareContinuable: async () => ({}) }
    const subagents = { getProvider: () => provider,
      startActivation: vi.fn(async () => ({ childId: SessionId('replay-child'), messageId: MessageId('replay-message'), result: Promise.resolve(result), dispose })) }
    const { parent } = await liveParent()
    const tasks = recorded.request.ownedTasks.map(task => ({ ...task, sessionId: SessionId('replay-owner'), messageId: MessageId('fixture') }))
    const operation = routeEntry(parent, createUserMessage({ source: { kind: 'user' }, content: recorded.request.input }), tasks,
      { timeoutMs: 1000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 }, subagents, 'spawn', new AbortController().signal)
    if (result.stopReason !== 'completed') await expect(operation).rejects.toThrow('max-tokens')
    else if ((result.structured as { kind: string }).kind === 'supplement') await expect(operation).rejects.toThrow('unknown owned task')
    else await expect(operation).resolves.toMatchObject(result.structured as object)
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('refuses changed request fingerprints instead of refreshing recordings', () => {
    expect(() => lookup({ ...recordings[0]!.request, route: { changed: true } })).toThrow('live calls are forbidden')
  })
})
