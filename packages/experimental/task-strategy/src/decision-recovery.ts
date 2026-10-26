/** One side-effect-free retry for truncated routing and strategy decisions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { startCancellableActivation } from './subagent-activation.ts'

/**
 * Retry only output truncation, preserving the decision input, schema, route and deadline.
 * @param subagents - original activation provider.
 * @param spec - restricted decision request; only structured_output may execute.
 * @param maxPromptBytes - complete prompt text bound, including the retry instruction.
 * @returns last result after every activation has been disposed; never starts task execution.
 */
export async function runDecision(subagents: Pick<Context['subagents'], 'startActivation'>,
  spec: SubagentActivationSpec, maxPromptBytes: number): Promise<SubagentResult> {
  const instruction = 'The previous decision reached the output limit. Submit only the shortest valid structured_output value. '
    + 'Keep the same task and candidate choices; omit explanations unless the schema requires one.'
  let current = spec
  for (let attempt = 0; ; attempt++) {
    spec.signal.throwIfAborted()
    const run = await startCancellableActivation(subagents, current)
    let result: SubagentResult
    try { result = await run.result }
    finally { await run.dispose() }
    spec.signal.throwIfAborted()
    if (result.stopReason !== 'max-tokens') return result
    if (attempt === 1) return { ...result, diagnostic: 'Output limit persisted after one restricted decision retry.' }
    const prompt = [...spec.request.prompt, { type: 'text' as const, text: instruction }]
    const bytes = prompt.reduce((sum, block) => sum + (block.type === 'text' ? Buffer.byteLength(block.text, 'utf8') : 0), 0)
    if (bytes > maxPromptBytes) return { ...result, diagnostic: 'Decision retry cannot fit within the configured prompt byte limit.' }
    current = { ...spec, request: { ...spec.request, prompt } }
  }
}
