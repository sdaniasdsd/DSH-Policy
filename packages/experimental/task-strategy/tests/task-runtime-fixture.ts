import { afterEach } from 'vitest'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Preset from '@deepseek-ai/dsh-agent-preset'
import Adapter from '../src/cordis.ts'
import TaskRuns from '../src/task-runtime-service.ts'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuerySqlite from '@deepseek-ai/dsh-session-query-sqlite'
import type { AdapterConfig, ExecutionPlan } from '../src/types.ts'
import type { TaskRuntimeRules } from '../src/runtime-types.ts'

export interface TaskModelEntry { readonly chunks: StreamChunk[]; readonly gate?: Promise<void> }

export class TaskModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly entries: TaskModelEntry[]) { super() }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('TaskModel script exhausted')
    if (entry.gate !== undefined) {
      const abort = Promise.withResolvers<never>()
      const onAbort = () => { abort.reject(options.signal?.reason ?? new Error('cancelled')) }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) onAbort()
      try { await Promise.race([entry.gate, abort.promise]) }
      finally { options.signal?.removeEventListener('abort', onAbort) }
    }
    for (const chunk of entry.chunks) { options.signal?.throwIfAborted(); yield chunk }
  }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

export const taskRules: TaskRuntimeRules = {
  provider: 'spawn', allowedPresets: ['coding', 'reviewing'], allowedExecutors: [],
  maxConcurrent: 2, maxTasks: 8, maxPlanBytes: 8192, maxResultBytes: 8192, maxOutputBytes: 4096,
}

export const workPlan: ExecutionPlan = {
  name: 'work', stages: [{ name: 'work', tasks: [{ label: 'worker', preset: 'coding', instruction: 'do the work' }] }],
}

/** Real Loader composition; only the external model stream is deterministic. */
export async function bootTaskRuntime(entries: TaskModelEntry[], config?: Partial<AdapterConfig>, persistence = false) {
  const ctx = new Context()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-task-message-'))
  cleanups.push(async () => {
    try { await ctx.fiber.dispose() }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  await cp(join(dirname(fileURLToPath(import.meta.url)), 'fixtures'), directory, { recursive: true })
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(directory).href + '/' })
  Object.assign(ctx.loader.builtins, {
    include: Include, llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, 'agent-loop': AgentLoop, subagents: Subagents, spawn: Spawn,
    jobs: Jobs, 'tool-jobs': ToolJobs, presets: Presets, preset: Preset, 'strategy-adapter': Adapter,
    'task-runtime': TaskRuns, 'token-meter': TokenMeter, 'fs-local': FsLocal, 'working-directory': WorkingDirectory,
    'session-query': SessionQuerySqlite,
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  if (config !== undefined) {
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    await entry.fiber!.dispose()
    entry.options.config = { ...entry.options.config as AdapterConfig, ...config }
    await entry.init()
    await ctx.loader.await()
  }
  if (persistence) {
    await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions') })
    await ctx.loader.create({ name: 'cordis:session-query', config: { path: ':memory:', openAt: 'never' } })
    await ctx.loader.await()
  }
  const model = new TaskModel(entries)
  ctx.llm.registerAdapter(['mock'], model)
  const handle = await ctx.agents.create({ sessionId: SessionId('task-owner'),
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'coding') },
  })
  return { ctx, parent: handle.agent, model, handle }
}
