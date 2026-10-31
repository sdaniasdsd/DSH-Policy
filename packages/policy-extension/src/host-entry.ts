/** Minimal model-facing Host integration using only the 0.2.1-rc.3 public services. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { JobHandle, JobHooks } from '@deepseek-ai/dsh-jobs'
import type { WorkflowAgentEndInfo, WorkflowAgentInfo, WorkflowRun, WorkflowRunInfo, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { TaskRun } from './task-runtime/task-run.ts'
import { StrategyRegistry } from './task-runtime/strategy-registry.ts'
import { createWorkflowExecutor } from './workflow-executor.ts'
import type { PolicyStyleId } from './policy-config-types.ts'
import type { HostPolicyExtensionConfig } from './config.ts'
import { createStylePlan, POLICY_STYLES } from './style-plans.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { policy: 'policy' }
}
const MAX_RESULT_BYTES = 256 * 1024
const MAX_CONCURRENT = 1
const MAX_TASKS = 5
const SCRIPT = 'const result = await agent(args.prompt)\nif (result === null) throw new Error("Policy worker failed")\nreturn result'

function makeRegistry(style: PolicyStyleId, task: string): StrategyRegistry {
  const registry = new StrategyRegistry()
  registry.register({
    id: style,
    description: POLICY_STYLES.find(row => row.id === style)!.label,
    decide: () => createStylePlan(style, task),
  })
  return registry
}

/** Register a visible policy tool and attach Job / Workflow observation to its lifecycle. */
export function registerPolicyHost(ctx: Context, config: HostPolicyExtensionConfig): void {
  const activeRuns = new Map<string, JobHandle>()
  ctx.on('workflow/phase', (info, title) => {
    const job = activeRuns.get(info.id)
    if (job === undefined) return
    job.updateProgress(title)
    job.append(`▸ ${title}\n`, { channel: 'log' })
  })
  ctx.on('workflow/log', (info: WorkflowRunInfo, message: string) => {
    activeRuns.get(info.id)?.append(`${message}\n`, { channel: 'log' })
  })
  ctx.on('workflow/agent-start', (info: WorkflowRunInfo, agent: WorkflowAgentInfo) => {
    activeRuns.get(info.id)?.append(`agent #${agent.seq} ${agent.label} started\n`, { channel: 'log' })
  })
  ctx.on('workflow/agent-end', (info: WorkflowRunInfo, agent: WorkflowAgentEndInfo) => {
    activeRuns.get(info.id)?.append(`agent #${agent.seq} ${agent.outcome}\n`, { channel: 'log' })
  })

  ctx.inject(['tools', 'jobs', 'workflowEngine'], (scope) => {
    scope.tools.register(defineTool({
      name: 'policy_run',
      description: 'Start the DSH Policy strategy for a task. Returns a job id; live phases and agent lifecycle appear in the task job output.',
      parameters: {
        task: { type: 'string', required: true, description: 'The task to execute under the active policy.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          jobId: { type: 'string', required: true },
          strategy: { type: 'string', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: `Policy task started as ${value.jobId} (${value.strategy}). Follow live output with job_output.` }],
      },
      async execute(args, exec) {
        const parent = exec.agent
        if (parent === undefined) throw new Error('policy_run requires a calling agent')
        const style = config.style.get()
        const registry = makeRegistry(style, args.task)
        const captured = registry.capture(style, { task: args.task })
        const jobId = scope.jobs.start({
          kind: 'policy', label: `${style}: ${args.task.slice(0, 120)}`, owner: parent.id,
          run(job) {
            job.updateProgress('Starting policy workflow')
            job.append('Policy strategy accepted; starting official DSH workflow.\n', { channel: 'log' })
            const execute = createWorkflowExecutor(scope.workflowEngine, parent as unknown as WorkflowStartRequest['parent'], (_step, prompt) => ({
              script: SCRIPT,
              meta: { name: style, description: 'Policy style stage executed by the official DSH workflow.' },
              args: { prompt }, maxTotalAgents: 1,
            }), (workflow: WorkflowRun) => {
              activeRuns.set(workflow.id, job)
              job.append(`Workflow ${workflow.id} started.\n`, { channel: 'log' })
            })
            const taskRun = new TaskRun(args.task, captured, execute, {
              maxConcurrent: MAX_CONCURRENT, maxTasks: MAX_TASKS, maxResultBytes: MAX_RESULT_BYTES,
              prepare: async () => {},
              onEvent(event) {
                switch (event.type) {
                  case 'stage': job.updateProgress(event.stage); job.append(`Stage: ${event.stage}\n`, { channel: 'log' }); break
                  case 'task-start': job.append(`Task ${event.label} started\n`, { channel: 'log' }); break
                  case 'task-end': job.append(`Task ${event.label} ${event.stopReason}\n`, { channel: 'log' }); break
                  case 'terminal': job.append(`Policy task ${event.status}.\n`, { channel: 'log' }); break
                }
              },
            })
            const done = taskRun.start().then((result) => {
              const output = JSON.stringify(result.results)
              if (result.status === 'completed') return { status: 'completed' as const, detail: result.status, result: output }
              if (result.status === 'cancelled') return { status: 'killed' as const, detail: 'Policy task cancelled' }
              return { status: 'failed' as const, detail: result.error ?? 'Policy task failed', result: output }
            }).finally(() => { activeRuns.forEach((activeJob, id) => { if (activeJob === job) activeRuns.delete(id) }) })
            const hooks: JobHooks = { cancel: reason => taskRun.cancel(reason ?? 'policy job cancelled'), done }
            return hooks
          },
        })
        return { jobId, strategy: style }
      },
    }))
  })
}
