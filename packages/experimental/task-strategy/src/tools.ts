/** Model-facing upper-task consumers of the independent strategy component. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type TaskStrategies from './cordis.ts'
import { boundText, parsePlan, parsePreferences } from './schema.ts'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import { inspectionText } from './task-inspection.ts'
import type { TaskSharedRecord } from './coordination-types.ts'

function recordText(record: TaskSharedRecord | undefined, maxBytes: number): string {
  const full = JSON.stringify(record ?? null)
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full
  if (record === undefined) return 'null'
  const compact = JSON.stringify({ key: record.key, revision: record.revision, writer: record.writer, detailsOmitted: true })
  if (Buffer.byteLength(compact, 'utf8') <= maxBytes) return compact
  throw new Error('Shared record identity exceeds the output byte limit')
}

function recordReceiptText(record: TaskSharedRecord, maxBytes: number): string {
  const receipt = JSON.stringify({ key: record.key, revision: record.revision, writer: record.writer })
  if (Buffer.byteLength(receipt, 'utf8') > maxBytes) throw new Error('Shared record receipt exceeds the output byte limit')
  return receipt
}

function recordsText(records: readonly TaskSharedRecord[], maxBytes: number): string {
  const full = JSON.stringify(records)
  if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full
  const compact = JSON.stringify(records.map(({ key, revision, writer }) => ({ key, revision, writer, detailsOmitted: true })))
  if (Buffer.byteLength(compact, 'utf8') <= maxBytes) return compact
  throw new Error('Shared record list exceeds the output byte limit; read records by key')
}

function receiptText(receipt: { jobId: string; name: string }, maxBytes: number): string {
  const text = JSON.stringify(receipt)
  // Identity fields are never sliced. The original Jobs service issues compact kind/ordinal ids.
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const shortened = JSON.stringify({
    ...receipt, name: '[truncated; plan name exceeds output limit]',
  })
  if (Buffer.byteLength(shortened, 'utf8') <= maxBytes) return shortened
  // A retained receipt can outlive a carrier with a larger limit. Refuse presentation,
  // while leaving the accepted Job and its original reservation intact.
  throw new Error(`Task ${receipt.jobId} is already accepted; receipt identity exceeds the current output byte limit. `
    + 'Use job_output for this Job or restore the previous output limit and retry the same request.')
}

/**
 * Create upper-task tools; the carrier registers them only on non-subagent scopes.
 * @param service - DSH carrier.
 * @param prefix - configured tool-name prefix.
 * @param maxBytes - complete model-facing result byte limit.
 * @returns catalogue, preview, direct dispatch and original-request intake definitions.
 */
export function strategyTools(service: TaskStrategies, prefix: string, maxBytes: number): ToolDefinition[] {
  const output = { schema: { type: 'string' as const }, render: (_args: object, value: string) => [{ type: 'text' as const, text: value }] }
  return [
    defineTool({
      name: `${prefix}_inspect`,
      description: 'Inspect an owned task, including its currently active DSH child session identities. '
        + 'Membership is a snapshot; a child may finish before a later message. '
        + 'Large views omit details and return detailsOmitted with completedTasks. Use job_output for recorded task output.',
      parameters: { jobId: { type: 'string', required: true } }, output,
      execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task inspection requires a calling agent')
        const view = service.inspect(exec.agent, JobId(args.jobId))
        return Promise.resolve(inspectionText(view, maxBytes))
      },
    }),
    defineTool({
      name: `${prefix}_message`,
      description: 'Send an adjustment from the exact task owner to one currently active DSH child returned by inspect. '
        + 'Inbox acceptance returns only messageId; it does not mean the child processed or adopted the adjustment. '
        + 'Idle, finished and native executor targets reject; this operation never wakes or restarts them. '
        + 'Do not resend an accepted message because processing has not yet been observed.',
      parameters: { jobId: { type: 'string', required: true }, childId: { type: 'string', required: true },
        text: { type: 'string', required: true } }, output,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task messaging requires a calling agent')
        const receipt = await service.sendMessage(exec.agent, JobId(args.jobId), {
          childId: SessionId(args.childId), text: args.text,
        }, exec.signal)
        const text = JSON.stringify(receipt)
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
          throw new Error(`Message ${receipt.messageId} is already accepted; receipt identity exceeds the output byte limit. Do not resend.`)
        }
        return text
      },
    }),
    defineTool({
      name: `${prefix}_record_read`,
      description: 'Read the latest JSON value for a key in an owned task. Returns null when absent; oversized values return record identity with detailsOmitted.',
      parameters: { jobId: { type: 'string', required: true }, key: { type: 'string', required: true } }, output,
      execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task records require a calling agent')
        return Promise.resolve(recordText(service.recordRead(exec.agent, JobId(args.jobId), args.key), maxBytes))
      },
    }),
    defineTool({
      name: `${prefix}_record_list`,
      description: 'List latest record identities and values for an owned task. If values exceed the output limit, returns identities only.',
      parameters: { jobId: { type: 'string', required: true } }, output,
      execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task records require a calling agent')
        return Promise.resolve(recordsText(service.recordList(exec.agent, JobId(args.jobId)), maxBytes))
      },
    }),
    defineTool({
      name: `${prefix}_record_write`,
      description: 'Compare-and-set a JSON value in an owned task. Supply expectedRevision 0 for an absent key or the current revision; conflicts are returned as errors.',
      parameters: { jobId: { type: 'string', required: true }, key: { type: 'string', required: true },
        value: { type: 'json', required: true }, expectedRevision: { type: 'number', required: true } }, output,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task records require a calling agent')
        const record = await service.recordWrite(exec.agent, JobId(args.jobId), args.key, args.value,
          args.expectedRevision, exec.signal)
        return recordReceiptText(record, maxBytes)
      },
    }),
    defineTool({
      name: `${prefix}_record_wait`,
      description: 'Wait until a task record advances beyond afterRevision or timeoutMs elapses. The owning task signal cancels the wait.',
      parameters: { jobId: { type: 'string', required: true }, key: { type: 'string', required: true },
        afterRevision: { type: 'number', required: true }, timeoutMs: { type: 'number', required: true } }, output,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Task records require a calling agent')
        const result = await service.recordWait(exec.agent, JobId(args.jobId), args.key,
          args.afterRevision, args.timeoutMs, exec.signal)
        const full = JSON.stringify(result)
        if (Buffer.byteLength(full, 'utf8') <= maxBytes) return full
        const compact = result.record === undefined
          ? JSON.stringify({ timedOut: result.timedOut })
          : JSON.stringify({ timedOut: result.timedOut, record: {
            key: result.record.key, revision: result.record.revision, writer: result.record.writer, detailsOmitted: true,
          } })
        if (Buffer.byteLength(compact, 'utf8') > maxBytes) throw new Error('Shared record wait result exceeds the output byte limit')
        return compact
      },
    }),
    defineTool({
      name: `${prefix}_submit`,
      description: 'Submit the original task once using a stable requestId. Omit strategy to use the configured automatic or named default; '
        + 'provide strategy to honor a user choice. Automatic selection needs no user reply. '
        + 'If useful, ask the user with the original timed ask_user_question tool before submitting; a pending or skipped reply uses the default. '
        + 'A late reply must not create another request id or execute this task again. '
        + 'Reuse the same requestId and input when retrying a tool call. Use job_output for results and job_kill to cancel accepted work.',
      parameters: {
        requestId: { type: 'string', required: true }, task: { type: 'string', required: true },
        strategy: { type: 'string', description: 'Optional registered strategy id chosen by the user.' },
        preferences: { type: 'json', description: 'Optional object mapping author preference names to string values.' },
      }, output,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Strategy submission requires a calling agent')
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const receipt = await service.submitTask(exec.agent, { requestId: args.requestId, task: args.task,
          ...args.strategy === undefined ? {} : { selection: { kind: 'named', strategy: args.strategy } },
          ...preferences === undefined ? {} : { preferences },
        }, exec.signal)
        return receiptText(receipt, maxBytes)
      },
    }),
    defineTool({
      name: `${prefix}_list`,
      description: 'List author-defined strategies and explainable child token estimates. Provide the original task and preferences '
        + 'for task-specific estimates; omitted task gives registration baselines. Known input excludes unknown context and outputs. '
        + 'Scenario totals require explicit assumptions. Unknown cost is not zero. Choose a suitable workflow before comparing costs.',
      parameters: { task: { type: 'string', description: 'Optional original task for refining token estimates.' },
        preferences: { type: 'json', description: 'Optional string-valued preferences; requires task.' } }, output,
      execute(args) {
        if (args.task === undefined && args.preferences !== undefined) throw new Error('Cost preferences require the original task')
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const catalogue = args.task === undefined ? service.catalog() : {
          ...service.catalog(), strategies: service.list({ task: args.task, ...preferences === undefined ? {} : { preferences } }),
        }
        return Promise.resolve(boundText(JSON.stringify(catalogue), maxBytes))
      },
    }),
    defineTool({
      name: `${prefix}_plan`,
      description: 'Preview an author strategy decision without starting any task. Inspect the returned stages and child presets before dispatch.',
      parameters: {
        strategy: { type: 'string', required: true }, task: { type: 'string', required: true },
        preferences: { type: 'json', description: 'Optional object mapping author preference names to string values.' },
      }, output,
      async execute(args) {
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const plan = await service.decide(args.strategy, { task: args.task, ...preferences === undefined ? {} : { preferences } })
        return boundText(JSON.stringify(plan), maxBytes)
      },
    }),
    defineTool({
      name: `${prefix}_run`,
      description: 'Dispatch a task using exactly one of a registered author strategy or an explicit execution plan. '
        + 'For strategy, use an id from task_strategy_list.strategies and omit plan. For plan, omit strategy. '
        + 'The plan is an object; a JSON string encoding the same object is also accepted. '
        + 'Its format is {name, stages:[{name,tasks:[{label,preset,instruction,tools?:{allow?:string[],deny?:string[]},model?,provider?}]}]}. '
        + 'Stages run in order; tasks within a stage may run concurrently. Failed children stop the plan. '
        + 'preset is a DSH preset name from task_strategy_list.presets, never a tool name; tools is an object containing allow/deny tool-name arrays. '
        + 'The returned id is a Job id, not a requestId; '
        + 'use job_output with job_id to inspect progress and job_kill with job_id to cancel. Do not pass this id to task_strategy_status, '
        + 'task_strategy_resume, or task_strategy_cancel; those controls operate on request entries. Concurrent tasks share files.',
      parameters: {
        task: { type: 'string', required: true }, strategy: { type: 'string', description: 'Registered author strategy id from task_strategy_list.strategies; omit when providing plan.' },
        plan: { oneOf: [
          { type: 'object', additionalProperties: false, description: 'Explicit upper-authored execution plan.', properties: {
            name: { type: 'string', required: true },
            stages: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              name: { type: 'string', required: true }, serial: { type: 'boolean' }, maxConcurrent: { type: 'integer' },
              tasks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
                label: { type: 'string', required: true },
                preset: { type: 'string', description: 'Allowed DSH preset name, such as standard; not a tool name.' },
                executor: { type: 'string' }, instruction: { type: 'string', required: true },
                tools: { type: 'object', additionalProperties: false, properties: {
                  allow: { type: 'array', items: { type: 'string' } }, deny: { type: 'array', items: { type: 'string' } },
                } },
                model: { type: 'string' }, provider: { type: 'string' },
                workflowOutput: { type: 'boolean' }, reviewOutput: { type: 'boolean' }, intakeOutput: { type: 'boolean' },
                finalSummaryOutput: { type: 'boolean' },
                artifactChecks: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
                  id: { type: 'string', required: true }, path: { type: 'string', required: true }, contains: { type: 'string' },
                } } },
                maxTokens: { type: 'integer' }, timeoutMs: { type: 'integer' },
              } } },
            } } },
          } },
          { type: 'string', description: 'JSON text encoding an explicit execution plan object.' },
        ] },
        preferences: { type: 'json', description: 'String-valued author preferences for a named strategy.' },
      }, output,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Strategy dispatch requires a calling agent')
        const agent = exec.agent
        if ((args.strategy === undefined) === (args.plan === undefined)) {
          throw new Error('Provide exactly one of strategy or plan; strategy requires a registered strategy id and plan must be used alone.')
        }
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const receipt = args.strategy !== undefined
          ? await service.submitTask(agent, { requestId: `${prefix}-run:${exec.callId}`, task: args.task,
            selection: { kind: 'named', strategy: args.strategy },
            ...preferences === undefined ? {} : { preferences },
          }, exec.signal)
          : await (async () => {
            const plan = parsePlan(args.plan)
            const jobId = await service.start(agent, args.task, plan, exec.signal)
            return { jobId, name: plan.name }
          })()
        const dispatch = { jobId: receipt.jobId, name: receipt.name, status: 'running', progress: 'job_output', cancel: 'job_kill' }
        return receiptText(dispatch, maxBytes)
      },
    }),
  ]
}
