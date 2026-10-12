/** Transfer caller cancellation from unpublished startup to the exact published activation. */
import type { SubagentActivation, SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'
import type { Context } from '@deepseek-ai/cordis'

/**
 * Start one managed child and retain caller cancellation until result settlement.
 * @param subagents - original DSH activation service.
 * @param spec - child request, owner, delivery and caller cancellation.
 * @returns the exact child activation; result and disposal report teardown failures.
 */
export async function startCancellableActivation(
  subagents: Pick<Context['subagents'], 'startActivation'>, spec: SubagentActivationSpec,
): Promise<SubagentActivation> {
  const activation = await subagents.startActivation(spec)
  let closing: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    spec.signal.removeEventListener('abort', abort)
    return closing ??= activation.dispose()
  }
  const abort = (): void => {
    // The result finalizer and explicit disposal retain the rejected cleanup promise.
    void dispose().catch((error: unknown) => { void error })
  }
  const result = (async () => {
    try { return await activation.result }
    finally {
      spec.signal.removeEventListener('abort', abort)
      if (closing !== undefined) await closing
    }
  })()
  spec.signal.addEventListener('abort', abort, { once: true })
  if (spec.signal.aborted) abort()
  return { ...activation, result, dispose }
}
