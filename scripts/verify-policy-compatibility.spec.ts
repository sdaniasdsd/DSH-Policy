import { expect, it } from 'vitest'
import {
  assertCompatibleDsh,
  DshCompatibilityError,
  type PolicyCompatibility,
} from '../packages/policy-extension/src/compatibility.ts'
import { policyCompatibilityProblems } from './verify-policy-compatibility.ts'

const expected: PolicyCompatibility = {
  policyVersion: '1.0.2',
  dshVersion: '0.2.1-rc.2',
  dshTag: 'dsh-v0.2.1-rc.2',
  dshCommit: '687f282e8625c6b8d11ff58211a90524be2e4317',
}

it('acceptsThePinnedRuntimeVersion', () => {
  expect(() => assertCompatibleDsh(expected.dshVersion, expected)).not.toThrow()
})

it('rejectsDifferentRuntimeVersions', () => {
  expect(() => assertCompatibleDsh('0.2.1-rc.3', expected)).toThrow(DshCompatibilityError)
})

it('rejectsMetadataPeerVersionMismatch', () => {
  const problems = policyCompatibilityProblems(expected, [{
    name: '@dsh-policy/extension',
    engines: { dsh: expected.dshVersion },
    peerDependencies: {
      '@deepseek-ai/dsh-app-boot': expected.dshVersion,
      '@deepseek-ai/dsh-workflow': '0.2.1-rc.3',
    },
  }], { version: expected.dshVersion, tag: expected.dshTag, commit: expected.dshCommit })
  expect(problems.join('\n')).toContain('@deepseek-ai/dsh-workflow')
})

it('rejectsTestedSourceCommitMismatch', () => {
  const problems = policyCompatibilityProblems(expected, [{
    name: '@dsh-policy/extension',
    engines: { dsh: expected.dshVersion },
    peerDependencies: { '@deepseek-ai/dsh-app-boot': expected.dshVersion },
  }], { version: expected.dshVersion, tag: expected.dshTag, commit: '0000000000000000000000000000000000000000' })
  expect(problems.join('\n')).toContain('commit')
})
