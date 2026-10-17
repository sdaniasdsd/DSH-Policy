import { expect, it } from 'vitest'
import { parseReviewReport } from '../src/workflow-report.ts'

type Evidence = { path: string; isError: boolean; text: string }
const parseWithRequiredPaths = parseReviewReport as unknown as
  (value: unknown, evidence: readonly Evidence[], cwd: string | undefined,
    requiredPaths: readonly string[]) => ReturnType<typeof parseReviewReport>

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

it('does not accept a pass based on unrelated reads or an empty review scope', () => {
  const report = { status: 'passed', issues: [] }
  const evidence = [{ path: 'notes.md', isError: false, text: '1: unrelated' }]
  expect(parseWithRequiredPaths(report, evidence, 'C:/work', ['src/main.ts']).status).toBe('unverified')
  expect(parseWithRequiredPaths(report, evidence, 'C:/work', []).status).toBe('unverified')
})

it('accepts a pass only after every required review path was read successfully', () => {
  const report = { status: 'passed', issues: [] }
  const evidence = [
    { path: 'C:/work/src/main.ts', isError: false, text: '1: main' },
    { path: 'tests/main.spec.ts', isError: false, text: '1: test' },
  ]
  expect(parseWithRequiredPaths(report, evidence, 'C:/work', ['src/main.ts', 'tests/main.spec.ts']).status).toBe('passed')
  expect(parseWithRequiredPaths(report, evidence.slice(0, 1), 'C:/work', ['src/main.ts', 'tests/main.spec.ts']).status).toBe('unverified')
})
