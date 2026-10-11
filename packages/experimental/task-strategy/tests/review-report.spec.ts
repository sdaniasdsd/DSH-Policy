import { expect, it } from 'vitest'
import { parseReviewReport } from '../src/workflow-report.ts'

it('requires child-owned read excerpts for actionable model review findings', () => {
  const report = { status: 'issues', issues: [{ description: 'wrong', path: 'a.md', excerpt: 'actual' }] }
  expect(parseReviewReport(report, []).status).toBe('unverified')
  expect(parseReviewReport(report, [{ path: 'a.md', isError: false, text: '1: fabricated' }]).status).toBe('unverified')
  expect(parseReviewReport(report, [{ path: 'a.md', isError: false, text: '1: actual' }]).status).toBe('issues')
})

it('marks ambiguous review status unverified rather than failing the execution or granting a pass', () => {
  expect(parseReviewReport({ status: 'passed', issues: [{ description: 'unknown encoding', path: 'a.md', excerpt: 'actual' }] },
    [{ path: 'a.md', isError: false, text: '1: actual' }]).status).toBe('unverified')
})

it('matches child absolute paths to workspace-relative requirements and literal file excerpts', () => {
  expect(parseReviewReport({ status: 'issues', issues: [{ description: 'wrong', path: 'a.md', excerpt: 'actual' }] },
    [{ path: 'C:/work/a.md', isError: false, text: '1: actual' }], 'C:/work').status).toBe('issues')
})
