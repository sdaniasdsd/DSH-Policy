import { describe, expect, it } from 'vitest'
import { verifyArtifacts } from '../src/verification.ts'

const check = { id: 'artifact', path: 'gate.md', contains: 'random-42' }
describe('artifact checks from permission-bound read evidence', () => {
  it('does not accept the assistant saying that a file exists', () => {
    expect(verifyArtifacts([check], []).status).toBe('unverified')
  })
  it('requires matching tool path and content, not an echoed filename', () => {
    expect(verifyArtifacts([check], [{ path: 'elsewhere.md', isError: false, text: '1: random-42' }]).status).toBe('unverified')
    expect(verifyArtifacts([check], [{ path: 'gate.md', isError: false,
      text: '<path>random-42</path>\n<content>\n1: different\n\n(End of file - total 1 lines)\n</content>' }]).status).toBe('failed')
  })
  it('reports permission failures and partial reads as unverified', () => {
    expect(verifyArtifacts([check], [{ path: 'gate.md', isError: true, text: 'denied' }]).status).toBe('unverified')
    expect(verifyArtifacts([check], [{ path: 'gate.md', isError: false, text: '1: different\n(Output capped.)' }]).status).toBe('unverified')
  })
  it('checks actual file lines and lets a later denied read invalidate stale evidence', () => {
    const evidence = { path: 'gate.md', isError: false, text: '1: random-42\n(End of file - total 1 lines)' }
    expect(verifyArtifacts([check], [evidence]).status).toBe('passed')
    expect(verifyArtifacts([check], [evidence, { ...evidence, isError: true }]).status).toBe('unverified')
  })
  it('does not treat an empty check set as verified', () => {
    expect(verifyArtifacts([], []).status).toBe('unverified')
  })
  it('does not treat truncated lines or their synthetic suffix as complete file content', () => {
    const read = { path: 'gate.md', isError: false, text: '1: prefix... (line truncated to 2000 chars)\n(End of file - total 1 lines)' }
    expect(verifyArtifacts([check], [read]).status).toBe('unverified')
    expect(verifyArtifacts([{ ...check, contains: 'line truncated' }], [read]).status).toBe('unverified')
  })
})
