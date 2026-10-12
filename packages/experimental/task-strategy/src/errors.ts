/** Exception rendering for lifecycle paths that must finish cleanup even for non-Error throws. */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Child cleanup failure retaining any observed execution result and primary failure. */
export class ChildDisposalError extends HarnessError {
  /**
   * @param childId - activation whose cleanup failed.
   * @param executionResult - exact result observed before cleanup, absent if awaiting execution rejected.
   * @param executionFailure - primary result or interpretation failure, if any.
   * @param disposalFailure - failure raised by activation disposal.
   * @param executionFailed - whether execution or result interpretation rejected, including non-Error throws.
   */
  constructor(
    readonly childId: SessionId,
    readonly executionResult: SubagentResult | undefined,
    readonly executionFailure: unknown,
    readonly disposalFailure: unknown,
    readonly executionFailed: boolean,
  ) {
    const outcome = executionFailed ? 'execution failed; effects may already have occurred'
      : `execution returned ${executionResult?.stopReason ?? 'an unknown result'}`
    super(`child "${childId}": ${outcome}; activation disposal failed: ${errorText(disposalFailure)}`,
      'CHILD_DISPOSAL_FAILED', { cause: executionFailed
        ? new AggregateError([executionFailure, disposalFailure], 'Child execution and disposal failed')
        : disposalFailure })
  }
}

/**
 * Render an arbitrary thrown value without allowing its conversion to throw again.
 * @param error - author, preparation or executor failure.
 * @returns printable text, or a fixed diagnostic when conversion fails.
 */
export function errorText(error: unknown): string {
  try { return String(error) }
  catch (conversionError) {
    // Thrown values can lack a primitive conversion; reporting must not interrupt cleanup.
    void conversionError
    return 'Unprintable error'
  }
}
