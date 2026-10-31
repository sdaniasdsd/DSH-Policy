import { expect, it } from 'vitest'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootTaskRuntime, taskRules } from './task-runtime-fixture.ts'

it.skipIf(!process.env.DEEPSEEK_API_KEY)('finishes a real-model response longer than one generation and then executes verification', async () => {
  const { ctx } = await bootTaskRuntime([], undefined, true)
  await ctx.plugin(LlmDeepSeek, { retryPolicy: { mode: 'normal', maxRetries: 0 } })
  const { agent: parent } = await ctx.agents.create({ sessionId: SessionId('live-continuation-owner'),
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: ReasoningEffortId('off') },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'coding') },
  })
  const id = await ctx.taskRuns.start(parent,
    'Output exactly 15 numbered lines, ITEM-01 through ITEM-15. Each line must contain the sentence: '
    + 'Graph checkpoints preserve completed node state for reliable recovery. After ITEM-15 output the line ALL-DONE. '
    + 'Do not use tools, abbreviate, or omit lines. If continued, resume from the cutoff without repeating earlier text.',
    { name: 'live continuation', stages: [
      { name: 'answer', tasks: [{ label: 'answer', preset: 'coding', instruction: 'Complete the requested numbered output.', maxTokens: 128 }] },
      { name: 'verify', tasks: [{ label: 'verify', preset: 'coding', instruction: 'If the prior result contains every ITEM-01 through ITEM-15 and ALL-DONE, reply VERIFIED; otherwise reply INCOMPLETE. Do not use tools.', maxTokens: 128 }] },
    ] }, { ...taskRules, maxTasks: 2, maxResultBytes: 32768 }, new AbortController().signal)
  const job = await ctx.jobs.wait(id, 110000, parent.id)
  const view = ctx.taskRuns.inspect(parent, id)
  expect(job.status, JSON.stringify(view)).toBe('completed')
  expect(view.results[0]!.usage?.modelCalls).toBeGreaterThan(1)
  for (let item = 1; item <= 15; item++) {
    expect(view.results[0]!.output.match(new RegExp(`ITEM-${String(item).padStart(2, '0')}`, 'g')), view.results[0]!.output).toHaveLength(1)
  }
  expect(view.results[0]!.output.match(/Graph checkpoints preserve completed node state for reliable recovery\./g)).toHaveLength(15)
  expect(view.results[0]!.output).toContain('ALL-DONE')
  expect(view.results[1]!.output.trim()).toBe('VERIFIED')
  expect(view).toMatchObject({ completedStages: 2, startedTasks: 2, activeMembers: [] })
  console.info('Live continuation:', JSON.stringify({ modelCalls: view.usage?.modelCalls,
    observedTokens: view.usage?.observedTokens, completedStages: view.completedStages, logicalTasks: view.startedTasks }))
})
