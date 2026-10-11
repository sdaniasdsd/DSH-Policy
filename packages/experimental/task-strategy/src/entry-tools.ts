/** Model controls carry caller ownership; automatic dispatch is host-owned. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type TaskStrategies from './cordis.ts'
import { boundText } from './schema.ts'

/**
 * Build status, cancellation and versioned stage controls for a root Agent.
 * @param service - exact owner checks and entry state authority.
 * @param prefix - configured model tool namespace.
 * @param maxBytes - output byte bound.
 * @returns model-facing controls without implicit task submission.
 */
export function entryTools(service: TaskStrategies, prefix: string, maxBytes: number): ToolDefinition[] {
  const output = { schema: { type: 'string' as const }, render: (_args: object, value: string) => [{ type: 'text' as const, text: value }] }
  return [
    defineTool({ name: `${prefix}_propose`, description: 'Register a task suggestion with a stable proposalId, without executing it. Only a human reply or UI acceptance dispatches it. Never suggest repeating the same accepted work.',
      parameters: { proposalId: { type: 'string', required: true }, task: { type: 'string', required: true }, strategy: { type: 'string' } }, output,
      execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Proposal requires a root Agent')
        const view = service.proposeEntry({ sessionId: exec.agent.id, proposalId: args.proposalId, task: args.task,
          ...args.strategy === undefined ? {} : { strategy: args.strategy } })
        return Promise.resolve(boundText(JSON.stringify(view), maxBytes))
      } }),
    defineTool({ name: `${prefix}_status`, description: 'Read owned task entry states, chosen strategies and binding epochs.',
      parameters: {}, output, execute(_args, exec) {
        if (exec.agent === undefined) throw new Error('Task entry requires a calling Agent')
        return Promise.resolve(boundText(JSON.stringify(service.entryState({ sessionId: exec.agent.id })), maxBytes))
      } }),
    defineTool({ name: `${prefix}_cancel`, description: 'Cancel one owned request during selection or accepted execution.',
      parameters: { requestId: { type: 'string', required: true } }, output, execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task entry requires a calling Agent')
        service.cancelEntry({ sessionId: exec.agent.id, requestId: args.requestId }); return Promise.resolve('Cancellation requested')
      } }),
    defineTool({ name: `${prefix}_switch`, description: 'Reserve a strategy replacement at the next stage boundary, using the binding epoch from task status.',
      parameters: { requestId: { type: 'string', required: true }, strategy: { type: 'string', required: true },
        expectedBindingEpoch: { type: 'number', required: true } }, output,
      execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task entry requires a calling Agent')
        service.switchEntry({ sessionId: exec.agent.id, requestId: args.requestId,
          request: { strategy: args.strategy, expectedBindingEpoch: args.expectedBindingEpoch } })
        return Promise.resolve('Replacement reserved; inspect status for commitment')
      } }),
    defineTool({ name: `${prefix}_resume`, description: 'Resume the retained strategy after a rejected replacement, using its observed binding epoch.',
      parameters: { requestId: { type: 'string', required: true }, epoch: { type: 'number', required: true } }, output,
      execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task entry requires a calling Agent')
        service.resumeEntry({ sessionId: exec.agent.id, requestId: args.requestId, epoch: args.epoch }); return Promise.resolve('Task resumed')
      } }),
  ]
}
