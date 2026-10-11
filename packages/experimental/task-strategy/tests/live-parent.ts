/** Real idle owner for bounded selector and evidence tests. */
import { Context } from '@deepseek-ai/cordis'
import Agents, { type AgentOptions } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { onTestFinished } from 'vitest'

/** Create an idle production owner and release all its services after the test. */
export async function liveParent(options: AgentOptions = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(Llm)
  await ctx.plugin(Sessions)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  await ctx.plugin(Agents)
  await ctx.plugin(AgentLoop, { agents: [] })
  const handle = await ctx.agents.create({ sessionId: SessionId('owner'), agentOptions: options })
  return { ctx, parent: handle.agent }
}
