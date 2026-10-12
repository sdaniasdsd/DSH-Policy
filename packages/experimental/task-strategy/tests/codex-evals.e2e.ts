/**
 * Eval set for the Codex orchestration policy under a real model. Rule
 * assertions replace snapshot comparison; the suite self-skips without a key.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm from '@deepseek-ai/dsh-llm'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Preset from '@deepseek-ai/dsh-agent-preset'
import Adapter from '../src/cordis.ts'
import TaskRuns from '../src/task-runtime-service.ts'
import * as CodexOrchestrator from '../src/plugin-codex.ts'
import type { AdapterConfig } from '../src/types.ts'

const MODEL = 'deepseek-v4-flash'
const live = process.env.DEEPSEEK_API_KEY !== undefined

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** Boot the shipped composition against the real route and alias the native spawn backend as `codex`. */
async function bootLive() {
  const ctx = new Context()
  contexts.push(ctx)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-codex-eval-'))
  directories.push(directory)
  await cp(join(dirname(fileURLToPath(import.meta.url)), 'fixtures'), directory, { recursive: true })
  const baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader, { baseUrl })
  Object.assign(ctx.loader.builtins, {
    include: Include, llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, 'agent-loop': AgentLoop, subagents: Subagents, spawn: Spawn,
    jobs: Jobs, 'tool-jobs': ToolJobs, presets: Presets, preset: Preset, 'strategy-adapter': Adapter,
    'task-runtime': TaskRuns, 'token-meter': TokenMeter,
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  await ctx.plugin(LlmDeepSeek, { retryPolicy: { mode: 'normal', maxRetries: 0 } })
  const entry = [...ctx.loader.entries()].find(row => row.options.id === 'task-strategy')!
  await entry.fiber!.dispose()
  entry.options.config = { ...entry.options.config as AdapterConfig, allowedExecutors: ['codex'] }
  await entry.init()
  await ctx.loader.await()
  const spawn = ctx.subagents.getProvider('spawn')!
  ctx.subagents.registerProvider({ ...spawn, name: 'codex' })
  await ctx.plugin(CodexOrchestrator)
  return { ctx, parent: await createParent(ctx) }
}

async function createParent(ctx: Context) {
  const handle = await ctx.agents.create({ sessionId: SessionId('codex-eval-parent'),
    agentOptions: { provider: 'deepseek-official', model: MODEL },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'coding') } })
  return handle.agent
}

/** One fixed task with a rule that the child output must satisfy. */
interface EvalCase {
  readonly name: string
  readonly task: string
  readonly accept: (output: string) => boolean
}

const cases: EvalCase[] = [
  { name: 'returns a required token verbatim', task: 'Reply with exactly the token EVAL-OK and nothing else.',
    accept: output => output.includes('EVAL-OK') },
  { name: 'states an unknown fact instead of inventing it', task: 'Without using any tool, state only the word UNKNOWN.',
    accept: output => output.includes('UNKNOWN') },
  { name: 'answers in short natural language', task: 'In one short sentence, say what a coding harness is.',
    accept: output => output.trim().length > 0 && output.length < 400 },
]

describe.skipIf(!live)('codex orchestration eval set (real model, rule assertions)', () => {
  it.each(cases)('$name', async (evalCase) => {
    const { ctx, parent } = await bootLive()
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: evalCase.name, task: evalCase.task, strategy: 'codex-native' }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 110_000, parent.id)).status).toBe('completed')
    const view = ctx.taskRuns.inspect(parent, receipt.jobId)
    expect(view.phase).toBe('completed')
    expect(view.results).toHaveLength(1)
    const result = view.results[0]!
    expect(result).toMatchObject({ stage: 'native orchestration', label: 'codex-native', stopReason: 'completed' })
    expect(result.sessionId).toEqual(expect.any(String))
    expect(evalCase.accept(result.output), result.output).toBe(true)
  })
})
