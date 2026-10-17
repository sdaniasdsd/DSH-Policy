import { describe, expect, it } from 'vitest'
import { createPolicySnapshot, projectRunResults } from '../src/run-projection.ts'
import type { PolicySnapshot } from '../src/policy-types.ts'
import type { TaskResult } from '../src/types.ts'
import type { VerificationReport } from '../src/verification-types.ts'
import type { ReviewReport } from '../src/workflow-types.ts'

const row = (label: string): TaskResult => ({ stage: 'work', label, stopReason: 'completed', output: label })
const progress: Omit<PolicySnapshot, 'results' | 'currentResults'> = {
  nextStage: 2, completedStages: 3, remainingTasks: 7, bindingEpoch: 1, signals: [],
}
const verification: VerificationReport = { status: 'passed', checks: [] }
const review: ReviewReport = { status: 'passed', issues: [] }

describe('shared task result projections', () => {
  it('omits reports and usage for an empty run', () => {
    expect(projectRunResults([], 0)).toEqual({})
  })

  it('sums every binding and keeps missing or zero-call child usage unknown', () => {
    const results: TaskResult[] = [
      { ...row('old'), usage: { modelCalls: 3, reportedCalls: 2, observedTokens: 100 } },
      row('missing'),
      { ...row('zero'), usage: { modelCalls: 0, reportedCalls: 0, observedTokens: 0 } },
      { ...row('current'), usage: { modelCalls: 2, reportedCalls: 1, observedTokens: 50 } },
    ]
    expect(projectRunResults(results, 3)).toEqual({
      usage: { modelCalls: 5, reportedCalls: 3, observedTokens: 150, unknownChildren: 2 },
    })
    expect(projectRunResults(results, results.length).usage).toEqual(projectRunResults(results, 0).usage)
  })

  it('selects the latest defined report separately within the committed binding', () => {
    const latest: VerificationReport = { status: 'failed', checks: [{ id: 'file', status: 'failed', reason: 'missing' }] }
    const results: TaskResult[] = [
      { ...row('old'), verification, review },
      { ...row('current-review'), verification, review },
      { ...row('current-check'), verification: latest },
      row('current-no-report'),
    ]
    const projected = projectRunResults(results, 1)
    expect(projected.verification).toBe(latest)
    expect(projected.review).toBe(review)
    const afterSwitch = projectRunResults(results, 3)
    expect(afterSwitch).not.toHaveProperty('verification')
    expect(afterSwitch).not.toHaveProperty('review')
  })

  it('preserves report identity for the owning inspect call to detach once', () => {
    const results: TaskResult[] = [{ ...row('current'), verification, review }]
    const projected = projectRunResults(results, 0)
    expect(projected.verification).toBe(results[0]!.verification)
    const view = structuredClone({ results, ...projected })
    expect(view.verification).toBe(view.results[0]!.verification)
    expect(view.review).toBe(view.results[0]!.review)
    expect(view.verification).not.toBe(verification)
    Object.assign(view.results[0]!.verification!.checks, { 0: { id: 'new', status: 'failed', reason: 'changed' } })
    expect(results[0]!.verification!.checks).toEqual([])
  })

  it('detaches policy inputs while preserving shared rows between result lists', () => {
    const results: TaskResult[] = [row('old'), { ...row('current'), verification, review }]
    const current = results.slice(1)
    const snapshot = createPolicySnapshot(progress, results, current)
    expect(snapshot).toMatchObject(progress)
    expect(snapshot.results).not.toBe(results)
    expect(snapshot.currentResults).not.toBe(current)
    expect(snapshot.currentResults[0]).toBe(snapshot.results[1])
    expect(snapshot.results[1]).not.toBe(results[1])
    Object.assign(snapshot.results[1]!, { output: 'mutated' })
    Object.assign(snapshot.currentResults[0]!.verification!, { status: 'failed' })
    expect(results[1]!.output).toBe('current')
    expect(results[1]!.verification!.status).toBe('passed')
    expect(progress).toEqual({ nextStage: 2, completedStages: 3, remainingTasks: 7, bindingEpoch: 1, signals: [] })
  })

  it('retains total history but gives a replacement policy an empty current history', () => {
    const results: TaskResult[] = [{ ...row('old'), verification, review }]
    const snapshot = createPolicySnapshot(progress, results, [])
    expect(snapshot.results).toEqual(results)
    expect(snapshot.currentResults).toEqual([])
    expect(snapshot.results[0]).not.toBe(results[0])
  })
})
