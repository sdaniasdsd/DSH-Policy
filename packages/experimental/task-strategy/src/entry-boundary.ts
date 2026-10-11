/** Root-only orchestration policy; children retain their declared presets. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { renderToolsSdk, renderToolsSdkPy } from '@deepseek-ai/dsh-tools'

/**
 * Mount live model presentation and monotonic execution restrictions.
 * @param ctx - carrier lifetime.
 * @param parent - root owner.
 * @param prefix - configured strategy tool prefix.
 * @param enabled - current entry setting, read at every boundary.
 */
export function mountEntryBoundary(ctx: Context, parent: Agent, prefix: string, enabled: () => boolean): void {
  const controls = new Set(['job_list', 'job_output', 'job_kill', 'ask_user_question',
    `${prefix}_list`, `${prefix}_plan`, `${prefix}_status`, `${prefix}_cancel`, `${prefix}_switch`, `${prefix}_resume`, `${prefix}_propose`])
  const applies = (agent?: Agent) => enabled() && agent?.id === parent.id && agent.session.header.origin !== 'subagent'
  ctx.effect(() => parent.ctx.tools.guard(exec => applies(exec.agent) && !controls.has(exec.name) && exec.name !== 'run_code'
    ? 'Task strategy entry owns execution. Dispatch occurs automatically from original user input; use the owned task controls.' : undefined))
  ctx.effect(() => parent.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    if (applies(context.agent)) {
      result.tools = result.tools.filter(tool => controls.has(tool.name) || tool.name === 'run_code')
      const schemas = parent.ctx.tools.schemas(parent).filter(tool => controls.has(tool.name)).map((tool) => {
        const definition = parent.ctx.tools.get(tool.name, parent)
        if (definition === undefined) throw new Error('Task control disappeared during schema capture')
        return { ...tool, output: definition.output.schema }
      })
      // Native schemas and generated SDK both exclude scoped business registrations.
      result.sections = result.sections.map(section => section.name === 'tools:sdk' ? { ...section,
        text: ctx.get('ptcRuntime')?.language === 'python' ? renderToolsSdkPy(schemas) : renderToolsSdk(schemas) } : section)
    }
    return result
  }))
  ctx.effect(() => parent.ctx.systemPrompt.section({ name: 'task-strategy:root-entry', order: 50, text: () => enabled()
    ? 'You are the task strategy coordinator. Original human requests are routed automatically before your model step. '
      + 'Use the logged Host entry outcome. Never execute business work directly, launch another task for the same input, '
      + 'or claim completion without an observed completed Job. Answer ordinary conversation, clarify ambiguous input, '
      + 'report strategy and estimated cost, inspect job_output for results, and summarize the completed work.' : '' }))
}
