import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  assertCompatibleDsh,
  DshCompatibilityError,
  type PolicyCompatibility,
} from '../packages/policy-extension/src/compatibility.ts'
import { policyCompatibilityProblems, readTestedDshSource, type LockfileImporter } from './verify-policy-compatibility.ts'

const expected: PolicyCompatibility = {
  policyVersion: '1.0.2',
  dshVersion: '0.2.1-rc.2',
  dshTag: 'dsh-v0.2.1-rc.2',
  dshCommit: '687f282e8625c6b8d11ff58211a90524be2e4317',
  requiredDshPeers: [
    '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent-preset-registry', '@deepseek-ai/dsh-jobs',
    '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subprocess', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-token-meter',
    '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-typert-protocol',
  ],
}

let checkout: string
let source: ReturnType<typeof readTestedDshSource>
let expectedFixture: PolicyCompatibility
let importer: LockfileImporter

beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'dsh-compat-source-'))
  mkdirSync(join(checkout, 'packages', 'boot', 'app-boot'), { recursive: true })
  writeFileSync(join(checkout, 'packages', 'boot', 'app-boot', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-app-boot', version: expected.dshVersion,
  }))
  execFileSync('git', ['-C', checkout, 'init', '-q'])
  execFileSync('git', ['-C', checkout, 'config', 'user.name', 'Compatibility Test'])
  execFileSync('git', ['-C', checkout, 'config', 'user.email', 'compatibility@example.invalid'])
  execFileSync('git', ['-C', checkout, 'add', '.'])
  execFileSync('git', ['-C', checkout, 'commit', '-q', '-m', 'source fixture'])
  execFileSync('git', ['-C', checkout, 'tag', expected.dshTag])
  source = readTestedDshSource(checkout, 'packages/boot/app-boot/package.json')
  expectedFixture = { ...expected, dshCommit: source.commit }
  importer = { dependencies: Object.fromEntries(expected.requiredDshPeers.map(name => [name, {
    specifier: expected.dshVersion,
    version: expected.dshVersion,
  }])) }
})

afterEach(() => { rmSync(checkout, { recursive: true, force: true }) })

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    name: '@dsh-policy/extension',
    version: expected.policyVersion,
    engines: { dsh: expected.dshVersion },
    peerDependencies: Object.fromEntries(expected.requiredDshPeers.map(name => [name, expected.dshVersion])),
    ...overrides,
  }
}

it('acceptsThePinnedRuntimeVersion', () => {
  expect(() => assertCompatibleDsh(expected.dshVersion, expected)).not.toThrow()
})

it('rejectsDifferentRuntimeVersions', () => {
  expect(() => assertCompatibleDsh('0.2.1-rc.3', expected)).toThrow(DshCompatibilityError)
})

it('rejectsMetadataPeerVersionMismatch', () => {
  const peers = { ...manifest().peerDependencies as Record<string, string>, '@deepseek-ai/dsh-agent': '0.2.1-rc.3' }
  const problems = policyCompatibilityProblems(expectedFixture, [manifest({ peerDependencies: peers })], source, importer, checkout, '.')
  expect(problems.join('\n')).toContain('peerDependencies.@deepseek-ai/dsh-agent')
})

it('rejectsTestedSourceCommitMismatch', () => {
  const problems = policyCompatibilityProblems(expected, [manifest()], source, importer, checkout, '.')
  expect(problems.join('\n')).toContain('commit')
})

it('rejectsPolicyManifestVersionMismatch', () => {
  const problems = policyCompatibilityProblems(expectedFixture, [manifest({ version: '1.0.3' })], source, importer, checkout, '.')
  expect(problems.join('\n')).toContain(`version must be exactly ${expected.policyVersion}`)
})

it('rejectsMissingRequiredDshPeer', () => {
  const peers = { ...manifest().peerDependencies as Record<string, string> }
  delete peers['@deepseek-ai/dsh-agent']
  const problems = policyCompatibilityProblems(expectedFixture, [manifest({ peerDependencies: peers })], source, importer, checkout, '.')
  expect(problems.join('\n')).toContain('missing required peer @deepseek-ai/dsh-agent')
})

it('rejectsLockfilePeerResolutionMismatch', () => {
  const brokenImporter = structuredClone(importer)
  brokenImporter.dependencies!['@deepseek-ai/dsh-agent']!.version = '0.2.1-rc.3'
  const problems = policyCompatibilityProblems(expectedFixture, [manifest()], source, brokenImporter, checkout, '.')
  expect(problems.join('\n')).toContain('lockfile')
})

it('rejectsDeclaredDshPeerMissingFromLockfile', () => {
  const peers = { ...manifest().peerDependencies as Record<string, string>, '@deepseek-ai/dsh-workflow': expected.dshVersion }
  const problems = policyCompatibilityProblems(expectedFixture, [manifest({ peerDependencies: peers })], source, importer, checkout, '.')
  expect(problems.join('\n')).toContain('missing resolution for @deepseek-ai/dsh-workflow')
})

it('acceptsWorkspacePeerResolutionAtPinnedVersion', () => {
  const linkedPackage = join(checkout, 'test-agent')
  mkdirSync(linkedPackage, { recursive: true })
  writeFileSync(join(linkedPackage, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-agent', version: expected.dshVersion,
  }))
  const linkedImporter = structuredClone(importer)
  linkedImporter.dependencies!['@deepseek-ai/dsh-agent'] = {
    specifier: 'workspace:*',
    version: 'link:../../test-agent',
  }
  const problems = policyCompatibilityProblems(expectedFixture, [manifest()], source, linkedImporter, checkout, 'packages/policy-extension')
  expect(problems).toEqual([])
})

it('rejectsSourceTagNotPresentAtCheckoutHead', () => {
  execFileSync('git', ['-C', checkout, 'tag', '-d', expected.dshTag])
  execFileSync('git', ['-C', checkout, 'tag', 'some-other-tag'])
  source = readTestedDshSource(checkout, 'packages/boot/app-boot/package.json')
  const problems = policyCompatibilityProblems(expectedFixture, [manifest()], source, importer, checkout, '.')
  expect(problems.join('\n')).toContain(`tag must include ${expected.dshTag}`)
})
