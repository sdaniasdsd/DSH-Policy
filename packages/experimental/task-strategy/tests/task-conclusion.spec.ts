import { describe, expect, it } from 'vitest'
import { parseTaskConclusion, parseTaskIntakeAssessment } from '../src/workflow-report.ts'

describe('bounded task intake and final conclusion', () => {
  it('retains one decisive intake conflict so execution can stop before planning', () => {
    expect(parseTaskIntakeAssessment({ decision: 'blocked', goal: 'Verify current project state',
      blocker: 'The evidence list conflicts with the requested 500-character ceiling.' })).toEqual({
      decision: 'blocked', goal: 'Verify current project state', blocker: 'The evidence list conflicts with the requested 500-character ceiling.',
    })
    expect(() => parseTaskIntakeAssessment({ decision: 'blocked', goal: 'Verify current project state', blocker: '' }))
      .toThrow('Blocked intake must name its conflict')
  })

  it('limits the final answer to three evidence items and requires a blocker when blocked', () => {
    const conclusion = { status: 'blocked', conclusion: 'The request cannot be answered under its conflicting constraints.',
      evidence: ['Ten checks requested.', 'Evidence required for each.', 'Output capped at 500 characters.'],
      blocker: 'Choose the evidence scope or the output limit.', nextStep: 'Resolve that conflict.' }
    expect(parseTaskConclusion(conclusion)).toEqual(conclusion)
    expect(() => parseTaskConclusion({ ...conclusion, evidence: [...conclusion.evidence, 'fourth'] })).toThrow()
    expect(() => parseTaskConclusion({ ...conclusion, blocker: '' })).toThrow('Blocked conclusion must name its blocker')
  })
})
