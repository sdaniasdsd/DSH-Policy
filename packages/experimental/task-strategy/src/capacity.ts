/** Bounded waiting for an exhausted admission resource, owned by the task runtime. */
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import type { CapacityLimits, CapacityObservation, CapacityResource } from './capacity-types.ts'

/**
 * The Subagent service's rejection code for a full activation pool. That pool
 * publishes no release notification, so a waiter reattempts admission under its
 * own bound instead of subscribing to a capacity fact.
 */
const ACTIVATION_LIMIT_REACHED = 'ACTIVATION_LIMIT_REACHED'

/** One admission's exhausted resource and rejection code. */
type CapacityFailure = { readonly resource: CapacityResource; readonly code: string }

/**
 * Classify one admission rejection that leaves no child behind.
 * @param error - rejection from a child admission attempt.
 * @returns the exhausted resource and its code, or undefined for any other failure.
 */
export function capacityFailureOf(error: unknown): CapacityFailure | undefined {
  if (!(error instanceof SubagentError) || error.code !== ACTIVATION_LIMIT_REACHED) return undefined
  return { resource: 'subagent', code: error.code }
}

/**
 * Settle after one bounded delay, or reject with the caller's cancellation reason.
 * @param delayMs - positive delay within the schedulable timer range.
 * @param signal - cancellation the delay observes.
 * @returns settlement after the delay.
 */
function delay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      const reason: unknown = signal.reason
      reject(reason instanceof Error ? reason : new Error('Capacity wait cancelled'))
    }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, delayMs)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/**
 * Reattempt one admission while its resource is exhausted, within the configured bound.
 * `attempt` must fail before it starts the child, so no retry can repeat child work.
 * @param attempt - one admission attempt.
 * @param limits - total wait and retry interval for a single admission.
 * @param signal - task cancellation; an aborted wait rejects with its reason.
 * @param observe - receives this admission's capacity facts.
 * @returns the admitted attempt's value.
 */
export async function awaitCapacityAdmission<T>(attempt: () => Promise<T>, limits: CapacityLimits,
  signal: AbortSignal, observe: (observation: CapacityObservation) => void): Promise<T> {
  const entered = Date.now()
  let failure: CapacityFailure | undefined
  for (;;) {
    try {
      const value = await attempt()
      if (failure !== undefined) observe({ kind: 'admitted', ...failure, waitedMs: Date.now() - entered })
      return value
    } catch (error) {
      const rejected = capacityFailureOf(error)
      if (rejected === undefined) throw error
      failure ??= rejected
      const waitedMs = Date.now() - entered
      const remaining = limits.waitMs - waitedMs
      if (remaining <= 0) {
        observe({ kind: 'exhausted', ...failure, waitedMs })
        throw error
      }
      const retryMs = Math.min(limits.retryMs, remaining)
      observe({ kind: 'waiting', ...failure, waitedMs, retryMs })
      await delay(retryMs, signal)
    }
  }
}
