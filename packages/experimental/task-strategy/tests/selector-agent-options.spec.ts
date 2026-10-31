import { describe, expect, it, vi } from 'vitest'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { selectorAgentOptions } from '../src/selector-agent-options.ts'
import { liveParent } from './live-parent.ts'

const options = { timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 }
describe('selector reasoning ownership', () => {
  it.each([true, false])('uses only model-supported off reasoning: %s', async (supported) => {
    const { ctx, parent } = await liveParent({ provider: 'old', model: 'old' })
    const resolveModelInfo = vi.spyOn(ctx.llm, 'resolveModelInfo').mockResolvedValue({ provider: 'latest', id: 'latest', name: 'test',
      reasoning: { efforts: [{ id: ReasoningEffortId(supported ? 'off' : 'high'), name: 'test' }] } })
    vi.spyOn(parent.session, 'requestHeader').mockReturnValue({ config: { provider: 'latest', model: 'latest', reasoningEffort: ReasoningEffortId('high') } })
    const signal = new AbortController().signal
    const result = await selectorAgentOptions(parent, options, signal)
    expect(resolveModelInfo).toHaveBeenCalledWith('latest','latest',signal)
    expect(result).toEqual({ maxTokens:512, reasoningEffort: supported ? 'off' : 'high' })
    expect(parent.options).toEqual({ provider:'old',model:'old' })
  })
  it.each([['none', 'low', 'high'], ['low', 'high']])('uses the lowest advertised reasoning effort: %j', async (...efforts) => {
    const { ctx, parent } = await liveParent({ provider: 'mock', model: 'mock' })
    vi.spyOn(ctx.llm, 'resolveModelInfo').mockResolvedValue({ provider: 'mock', id: 'mock', name: 'test',
      reasoning: { efforts: efforts.map(id => ({ id: ReasoningEffortId(id), name: id })) } })
    expect(await selectorAgentOptions(parent, options, new AbortController().signal)).toMatchObject({ reasoningEffort: efforts[0] })
  })
  it('rejects metadata cancellation without starting a child', async () => {
    const controller = new AbortController()
    const { ctx, parent } = await liveParent({ provider: 'mock', model: 'mock' })
    vi.spyOn(ctx.llm, 'resolveModelInfo').mockImplementation(async () => {
      controller.abort(new Error('cancelled metadata')); return { provider: 'mock', id: 'mock', name: 'test' }
    })
    await expect(selectorAgentOptions(parent,options,controller.signal)).rejects.toThrow('cancelled metadata')
  })
})
