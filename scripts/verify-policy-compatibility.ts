import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PolicyCompatibility } from '../packages/policy-extension/src/compatibility.ts'

export interface PolicyPackageMetadata {
  name?: string
  engines?: { dsh?: unknown }
  peerDependencies?: Record<string, unknown>
}

export interface TestedDshSource {
  version: string
  tag: string
  commit: string
}

/** Return release metadata, package-peer, and tested-source inconsistencies. */
export function policyCompatibilityProblems(
  expected: PolicyCompatibility,
  packages: readonly PolicyPackageMetadata[],
  source: TestedDshSource,
): string[] {
  const problems: string[] = []
  const peers = new Map<string, string>()
  for (const pkg of packages) {
    if (typeof pkg.name !== 'string') {
      problems.push('extension package metadata has no package name')
      continue
    }
    if (pkg.engines?.dsh !== expected.dshVersion) {
      problems.push(`${pkg.name}: engines.dsh must be exactly ${expected.dshVersion}`)
    }
    for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
      if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
      if (typeof version !== 'string' || version !== expected.dshVersion) {
        problems.push(`${pkg.name}: peerDependencies.${name} must be exactly ${expected.dshVersion}`)
      } else peers.set(name, version)
    }
  }
  if (peers.size === 0) problems.push('extension manifests declare no exact DSH peer dependencies')
  if (source.version !== expected.dshVersion) problems.push(`tested DSH version must be ${expected.dshVersion}`)
  if (source.tag !== expected.dshTag) problems.push(`tested DSH tag must be ${expected.dshTag}`)
  if (source.commit !== expected.dshCommit) problems.push(`tested DSH commit must be ${expected.dshCommit}`)
  return problems.sort()
}

function main(): void {
  const root = resolve(import.meta.dirname, '..')
  const expected = JSON.parse(readFileSync(resolve(root, 'packages/policy-extension/compatibility.json'), 'utf8')) as PolicyCompatibility
  const packagePath = process.env.POLICY_EXTENSION_MANIFEST
  const sourcePath = process.env.DSH_SOURCE_PACKAGE_JSON
  const sourceTag = process.env.DSH_SOURCE_TAG
  const sourceCommit = process.env.DSH_SOURCE_COMMIT
  if (packagePath === undefined || sourcePath === undefined || sourceTag === undefined || sourceCommit === undefined) {
    throw new Error('Set POLICY_EXTENSION_MANIFEST, DSH_SOURCE_PACKAGE_JSON, DSH_SOURCE_TAG, and DSH_SOURCE_COMMIT')
  }
  const extension = JSON.parse(readFileSync(packagePath, 'utf8')) as PolicyPackageMetadata
  const sourcePackage = JSON.parse(readFileSync(sourcePath, 'utf8')) as { name?: unknown; version?: unknown }
  if (typeof sourcePackage.name !== 'string'
    || !(sourcePackage.name === '@deepseek-ai/dsh' || sourcePackage.name.startsWith('@deepseek-ai/dsh-'))
    || typeof sourcePackage.version !== 'string') {
    throw new Error('DSH_SOURCE_PACKAGE_JSON must be an official package manifest with name and version')
  }
  const problems = policyCompatibilityProblems(expected, [extension], {
    version: sourcePackage.version,
    tag: sourceTag,
    commit: sourceCommit,
  })
  if (problems.length > 0) {
    console.error(`verify-policy-compatibility: ${problems.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log(`verify-policy-compatibility: Policy ${expected.policyVersion} matches DSH ${expected.dshVersion} (${expected.dshTag} @ ${expected.dshCommit}).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
