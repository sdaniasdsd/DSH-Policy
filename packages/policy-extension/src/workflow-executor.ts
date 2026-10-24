/** Official script execution behind the controller's ordinary child executor contract. */
import type { WorkflowEngine, WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import type { ChildResult, TaskExecutor, TaskStep } from './task-runtime/types.ts'

/**
 * Bind an official Workflow engine and live task owner to a script-stage executor.
 * @param engine - official Workflow service; owns script and child execution.
 * @param parent - active task's parent Agent, retained for every stage invocation.
 * @param request - synchronous captured-stage configuration, including script inputs and engine child limits.
 * @returns executor that settles only after Workflow cleanup; it exposes no member controls.
 * Non-completed results retain their diagnostic and fail the stage unless the task owner cancelled.
 * Start or disposal failures propagate to the controller, which stops dependent stages.
 * Workflow child counts and run IDs do not replace task limits or member session identities.
 */
export function createWorkflowExecutor(
  engine: Pick<WorkflowEngine, 'start'>,
  parent: WorkflowStartRequest['parent'],
  request: (step: TaskStep, prompt: string) => Omit<WorkflowStartRequest, 'parent' | 'signal'>,
  onRun?: (run: WorkflowRun) => void,
): TaskExecutor {
  return async (step, prompt, signal) => {
    signal.throwIfAborted()
    const run: WorkflowRun = engine.start({ ...request(step, prompt), parent, signal })
    onRun?.(run)
    try {
      return stageResult(await run.result)
    } finally {
      await run.dispose()
    }
  }
}

function stageResult(result: WorkflowResult): ChildResult {
  switch (result.stopReason) {
    case 'completed':
      return { stopReason: 'completed', output: typeof result.value === 'string' ? result.value : JSON.stringify(result.value) }
    case 'cancelled':
    case 'error':
      // Only owner cancellation cancels TaskRun; other unsuccessful children fail its stage.
      return { stopReason: result.stopReason, output: '', ...result.error === undefined ? {} : { diagnostic: result.error } }
    default:
      return assertNever(result.stopReason)
  }
}

function assertNever(reason: never): never {
  throw new Error(`Unexpected Workflow stop reason: ${reason}`)
}
