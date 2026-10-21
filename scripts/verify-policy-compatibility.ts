import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import {
  dshVersionFromPackageMetadata,
  type PolicyCompatibility,
} from '../packages/policy-extension/src/compatibility.ts'

export interface PolicyPackageMetadata {
  name?: string
  version?: string
  engines?: { dsh?: unknown }
  peerDependencies?: Record<string, unknown>
}

export interface LockfileDependencyEntry {
  specifier: string
  version: string
}

export interface LockfileImporter {
  dependencies?: Record<string, LockfileDependencyEntry>
  devDependencies?: Record<string, LockfileDependencyEntry>
  optionalDependencies?: Record<string, LockfileDependencyEntry>
  peerDependencies?: Record<string, LockfileDependencyEntry>
}

export interface TestedDshSource {
  version: string
  tags: readonly string[]
  commit: string
}

/** Read the official DSH version and Git identity from a tested checkout. */
export function readTestedDshSource(checkout: string, packageJson: string): TestedDshSource {
  const sourceRoot = resolve(checkout)
  const manifestPath = resolve(sourceRoot, packageJson)
  const manifestRelativePath = relative(sourceRoot, manifestPath)
  if (isAbsolute(manifestRelativePath) || manifestRelativePath === '..' || manifestRelativePath.startsWith(`..${sep}`)) {
    throw new Error('DSH source package manifest must be inside DSH_SOURCE_CHECKOUT')
  }
  const metadata = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  const version = dshVersionFromPackageMetadata(metadata)
  const commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const tags = execFileSync('git', ['-C', checkout, 'tag', '--points-at', 'HEAD'], { encoding: 'utf8' })
    .split(/\r?\n/u).filter(Boolean)
  return { version, tags, commit }
}

function dshPackageName(name: string): boolean {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
}

function resolvedLockfileVersion(
  name: string,
  entry: LockfileDependencyEntry,
  root: string,
  importerPath: string,
): string | undefined {
  if (!entry.version.startsWith('link:')) return entry.version.split('(', 1)[0]
  const linkedManifestPath = resolve(root, importerPath, entry.version.slice('link:'.length), 'package.json')
  try {
    const metadata = JSON.parse(readFileSync(linkedManifestPath, 'utf8')) as unknown
    if (typeof metadata !== 'object' || metadata === null || !('name' in metadata) || metadata.name !== name) return undefined
    return dshVersionFromPackageMetadata(metadata)
  } catch {
    return undefined
  }
}

/** Return package, required-peer, lockfile, and tested-source inconsistencies. */
export function policyCompatibilityProblems(
  expected: PolicyCompatibility,
  packages: readonly PolicyPackageMetadata[],
  source: TestedDshSource,
  importer: LockfileImporter,
  root: string,
  importerPath: string,
): string[] {
  const problems: string[] = []
  if (expected.requiredDshPeers.length === 0) problems.push('compatibility metadata must list required DSH peers')
  for (const name of expected.requiredDshPeers) {
    if (!dshPackageName(name)) problems.push(`compatibility metadata lists non-DSH required peer ${name}`)
  }
  for (const pkg of packages) {
    if (typeof pkg.name !== 'string') {
      problems.push('extension package metadata has no package name')
      continue
    }
    if (pkg.version !== expected.policyVersion) {
      problems.push(`${pkg.name}: version must be exactly ${expected.policyVersion}`)
    }
    if (pkg.engines?.dsh !== expected.dshVersion) {
      problems.push(`${pkg.name}: engines.dsh must be exactly ${expected.dshVersion}`)
    }
    const peers = pkg.peerDependencies ?? {}
    for (const name of expected.requiredDshPeers) {
      if (peers[name] === undefined) problems.push(`${pkg.name}: missing required peer ${name}`)
    }
    for (const [name, version] of Object.entries(peers)) {
      if (!dshPackageName(name)) continue
      if (typeof version !== 'string' || version !== expected.dshVersion) {
        problems.push(`${pkg.name}: peerDependencies.${name} must be exactly ${expected.dshVersion}`)
      }
    }
  }

  const lockEntries = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
  const lockPeerNames = new Set(expected.requiredDshPeers)
  for (const pkg of packages) {
    for (const name of Object.keys(pkg.peerDependencies ?? {})) {
      if (dshPackageName(name)) lockPeerNames.add(name)
    }
  }
  for (const name of lockPeerNames) {
    const entry = lockEntries.map(section => importer[section]?.[name]).find(candidate => candidate !== undefined)
    if (entry === undefined) {
      problems.push(`lockfile importer ${importerPath}: missing resolution for ${name}`)
      continue
    }
    const version = resolvedLockfileVersion(name, entry, root, importerPath)
    if (entry.specifier !== expected.dshVersion && !entry.specifier.startsWith('workspace:')) {
      problems.push(`lockfile importer ${importerPath}: ${name} specifier must resolve to ${expected.dshVersion}`)
    }
    if (version !== expected.dshVersion) {
      problems.push(`lockfile importer ${importerPath}: ${name} resolution must be ${expected.dshVersion}; found ${version ?? entry.version}`)
    }
  }

  if (source.version !== expected.dshVersion) problems.push(`tested DSH version must be ${expected.dshVersion}`)
  if (!source.tags.includes(expected.dshTag)) problems.push(`tested DSH checkout HEAD tag must include ${expected.dshTag}`)
  if (source.commit !== expected.dshCommit) problems.push(`tested DSH checkout HEAD commit must be ${expected.dshCommit}`)
  return [...new Set(problems)].sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLockfileImporter(lockfilePath: string, importerPath: string): LockfileImporter {
  const parsed: unknown = load(readFileSync(lockfilePath, 'utf8'))
  if (!isRecord(parsed) || !isRecord(parsed.importers) || !isRecord(parsed.importers[importerPath])) {
    throw new Error(`Lockfile has no importer ${importerPath}`)
  }
  const importerData = parsed.importers[importerPath]
  const importer: LockfileImporter = {}
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    const sectionData = importerData[section]
    if (!isRecord(sectionData)) continue
    const entries: Record<string, LockfileDependencyEntry> = {}
    for (const [name, rawEntry] of Object.entries(sectionData)) {
      if (!isRecord(rawEntry) || typeof rawEntry.specifier !== 'string' || typeof rawEntry.version !== 'string') continue
      entries[name] = { specifier: rawEntry.specifier, version: rawEntry.version }
    }
    importer[section] = entries
  }
  return importer
}

function main(): void {
  const root = resolve(import.meta.dirname, '..')
  const expected = JSON.parse(readFileSync(resolve(root, 'packages/policy-extension/compatibility.json'), 'utf8')) as PolicyCompatibility
  const packagePath = process.env.POLICY_EXTENSION_MANIFEST
  const importerPath = process.env.POLICY_LOCKFILE_IMPORTER
  const sourceCheckout = process.env.DSH_SOURCE_CHECKOUT
  const sourcePackage = process.env.DSH_SOURCE_PACKAGE_JSON ?? 'packages/boot/app-boot/package.json'
  const lockfilePath = process.env.POLICY_LOCKFILE ?? resolve(root, 'pnpm-lock.yaml')
  if (packagePath === undefined || importerPath === undefined || sourceCheckout === undefined) {
    throw new Error('Set POLICY_EXTENSION_MANIFEST, POLICY_LOCKFILE_IMPORTER, and DSH_SOURCE_CHECKOUT')
  }
  const extension = JSON.parse(readFileSync(packagePath, 'utf8')) as PolicyPackageMetadata
  const source = readTestedDshSource(sourceCheckout, sourcePackage)
  const importer = parseLockfileImporter(lockfilePath, importerPath)
  const problems = policyCompatibilityProblems(expected, [extension], source, importer, root, importerPath)
  if (problems.length > 0) {
    console.error(`verify-policy-compatibility: ${problems.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log(`verify-policy-compatibility: Policy ${expected.policyVersion} matches DSH ${expected.dshVersion} (${expected.dshTag} @ ${expected.dshCommit}).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
