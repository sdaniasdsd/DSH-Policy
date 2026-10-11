/** Artifact checks consume original DSH read results; assistant claims are not evidence. */

import type { ArtifactCheck, ReadEvidence, VerificationReport } from './verification-types.ts'
import { posix, win32 } from 'node:path'
export type { ArtifactCheck, ReadEvidence, VerificationReport } from './verification-types.ts'

/**
 * Resolve lexical workspace paths without granting access or following symlinks.
 * @param path - tool-request or registered-check path.
 * @param cwd - trusted inherited workspace, when available.
 * @returns resolved path with uniform separators; case and symlinks remain unchanged.
 */
export function normalizeReadPath(path: string, cwd?: string): string {
  const resolved = cwd === undefined ? path : (/^[a-z]:[\\/]|^\\\\/i.test(cwd) ? win32 : posix).resolve(cwd, path)
  return resolved.replaceAll('\\', '/')
}

/**
 * Return only file lines, removing the original read tool's synthesized truncation marker.
 * @param text - original read tool's rendered observation.
 * @returns visible file content without tool framing.
 */
export function observedFileText(text: string): string {
  return text.split('\n').filter(line => /^\d+: /.test(line))
    .map(line => line.replace(/^\d+: /, '').replace(/\.\.\. \(line truncated to \d+ chars\)$/, '')).join('\n')
}

/**
 * Check file observations without executing tools or consulting model conclusions.
 * @param checks - requirements captured before the work being checked.
 * @param evidence - exact child-owned tool observations in execution order.
 * @param cwd - inherited workspace used only for lexical path correlation.
 * @returns per-check findings; denial, absent evidence and partial reads cannot imply success.
 */
export function verifyArtifacts(checks: readonly ArtifactCheck[], evidence: readonly ReadEvidence[], cwd?: string): VerificationReport {
  const findings = checks.map((check) => {
    const read = evidence.findLast(row => normalizeReadPath(row.path, cwd) === normalizeReadPath(check.path, cwd))
    if (read === undefined || read.isError) return { id: check.id, status: 'unverified' as const, reason: 'No successful scoped read observation' }
    const lines = observedFileText(read.text)
    if (check.contains === undefined || lines.includes(check.contains)) {
      return { id: check.id, status: 'passed' as const, reason: 'Observed by the original read tool' }
    }
    const numbers = read.text.split('\n').flatMap(line => /^\d+: /.test(line) ? [Number(line.slice(0, line.indexOf(':')))] : [])
    const footer = /^\(End of file - total (\d+) lines\)$/m.exec(read.text)
    const complete = !check.contains.endsWith('\n') && !/\.\.\. \(line truncated to \d+ chars\)$/m.test(read.text) && footer !== null && Number(footer[1]) === numbers.length
      && numbers.every((number, index) => number === index + 1)
    return { id: check.id, status: complete ? 'failed' as const : 'unverified' as const,
      reason: complete ? 'Required content was absent in the read file' : 'The read window did not establish the required content' }
  })
  return { status: findings.length === 0 || findings.some(row => row.status === 'unverified') ? 'unverified'
    : findings.some(row => row.status === 'failed') ? 'failed' : 'passed', checks: findings }
}
