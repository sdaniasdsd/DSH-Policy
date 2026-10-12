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
  return ownActivation(activation, spec.signal)
}

/** Bind post-publication cancellation to the exact activation, retaining its receipt fields. */
export function ownActivation<T extends SubagentActivation>(activation: T, signal: AbortSignal): T {
  let closing: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    signal.removeEventListener('abort', abort)
    return closing ??= activation.dispose()
  }
  const abort = (): void => {
    // The result finalizer and explicit disposal retain the rejected cleanup promise.
    void dispose().catch((error: unknown) => { void error })
  }
  const result = activation.result.finally(async () => {
    signal.removeEventListener('abort', abort)
    if (closing !== undefined) await closing
  })
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  return { ...activation, result, dispose }
}
