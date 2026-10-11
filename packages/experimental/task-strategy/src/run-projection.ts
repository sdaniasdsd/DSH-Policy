/** Pure projections of settled task results and detached synchronous policy inputs. */
import type { PolicySnapshot } from './policy-types.ts'
import type { TaskRunView } from './runtime-types.ts'
import type { TaskResult } from './types.ts'

/**
 * Project current-binding reports and usage accumulated across every binding.
 * @param results - complete retained child history; report references remain shared with these rows until the caller clones its whole view.
 * @param bindingStartResult - first retained result belonging to the committed binding.
 * @returns latest defined reports from that binding and cumulative usage; absent reports and usage for an empty history are omitted.
 * Missing usage and zero model calls count as unknown children.
 */
export function projectRunResults(results: readonly TaskResult[], bindingStartResult: number): Pick<TaskRunView, 'verification' | 'review' | 'usage'> {
  const currentResults = results.slice(bindingStartResult)
  const verification = currentResults.findLast(row => row.verification !== undefined)?.verification
  const review = currentResults.findLast(row => row.review !== undefined)?.review
  const usage = results.reduce((total, row) => ({
    modelCalls: total.modelCalls + (row.usage?.modelCalls ?? 0), reportedCalls: total.reportedCalls + (row.usage?.reportedCalls ?? 0),
    observedTokens: total.observedTokens + (row.usage?.observedTokens ?? 0),
    unknownChildren: total.unknownChildren + (row.usage === undefined || row.usage.modelCalls === 0 ? 1 : 0),
  }), { modelCalls: 0, reportedCalls: 0, observedTokens: 0, unknownChildren: 0 })
  return {
    ...verification === undefined ? {} : { verification },
    ...review === undefined ? {} : { review },
    ...results.length === 0 ? {} : { usage },
  }
}

/**
 * Construct one detached policy snapshot while preserving shared result and report identities within it.
 * @param progress - task-owned cursor, cumulative counters, remaining allowance and committed binding epoch.
 * @param results - complete retained history, including results from prior bindings.
 * @param currentResults - results for the evaluated binding; replacement previews supply an empty array.
 * @returns a synchronous snapshot whose nested values cannot mutate the supplied task state.
 */
export function createPolicySnapshot(progress: Omit<PolicySnapshot, 'results' | 'currentResults'>,
  results: readonly TaskResult[], currentResults: readonly TaskResult[]): PolicySnapshot {
  return structuredClone({ ...progress, results, currentResults })
}
