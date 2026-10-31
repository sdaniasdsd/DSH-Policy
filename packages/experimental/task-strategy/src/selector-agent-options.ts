/** Model-aware options for bounded decisions, independent of execution options. */
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { parentAgentOptionsForDelegation } from '@deepseek-ai/dsh-subagent'
import type { SelectorOptions } from './selection-types.ts'

/**
 * Keep short structured decisions from inheriting an execution reasoning budget.
 * @param parent - original live owner and request-time model route.
 * @param options - explicit selector route and output cap.
 * @param signal - existing decision timeout and owner cancellation.
 * @returns overrides using the exact model's advertised off/none or least reasoning effort.
 */
export async function selectorAgentOptions(parent: Agent, options: Pick<SelectorOptions, 'maxTokens' | 'model' | 'provider'>, signal: AbortSignal): Promise<AgentOptions> {
  signal.throwIfAborted()
  const overrides: AgentOptions = { maxTokens: options.maxTokens,
    ...options.model === undefined ? {} : { model: options.model },
    ...options.provider === undefined ? {} : { provider: options.provider } }
  const inherited = parentAgentOptionsForDelegation(parent)
  const provider = overrides.provider ?? inherited.provider
  const model = overrides.model ?? inherited.model
  const llm = parent.ctx.get('llm')
  if (llm === undefined || provider === undefined || model === undefined) return overrides
  const info = await llm.resolveModelInfo(provider, model, signal)
  signal.throwIfAborted()
  const efforts = info.reasoning?.efforts
  const off = efforts?.find(effort => effort.id === 'off' || effort.id === 'none') ?? efforts?.[0]
  return { ...overrides, ...off === undefined ? {} : { reasoningEffort: off.id } }
}
