/** Bounded model presentation keeps active-member discovery independent of retained task output. */
import type { TaskRunView } from './runtime-types.ts'

/**
 * Present a complete view when it fits, otherwise retain coordination state and complete member identities.
 * @param view - detached, already-authorized runtime view.
 * @param maxBytes - complete UTF-8 tool result bound.
 * @returns valid JSON; omitted details are explicitly marked; the complete Host view remains unchanged.
 */
export function inspectionText(view: TaskRunView, maxBytes: number): string {
  const complete = JSON.stringify(view)
  if (Buffer.byteLength(complete, 'utf8') <= maxBytes) return complete
  const coordination = JSON.stringify({
    phase: view.phase, binding: view.binding, nextStage: view.nextStage,
    completedStages: view.completedStages, startedTasks: view.startedTasks,
    activeMembers: view.activeMembers ?? [], completedTasks: view.results.length,
    detailsOmitted: true, detailsTool: 'job_output',
  })
  if (Buffer.byteLength(coordination, 'utf8') <= maxBytes) return coordination
  throw new Error('Task coordination identities exceed the output byte limit; increase the output limit to inspect members')
}
