import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Release metadata binding one Policy version to one tested DSH release. */
export interface PolicyCompatibility {
  policyVersion: string
  dshVersion: string
  dshTag: string
  dshCommit: string
}

/** Raised when the active DSH version differs from this extension's release pair. */
export class DshCompatibilityError extends Error {
  readonly actualVersion: string
  readonly expectedVersion: string

  constructor(actualVersion: string, expectedVersion: string) {
    super(`This Policy release requires DSH ${expectedVersion}; found ${actualVersion}`)
    this.name = 'DshCompatibilityError'
    this.actualVersion = actualVersion
    this.expectedVersion = expectedVersion
  }
}

const moduleDir = dirname(fileURLToPath(import.meta.url))

/** The pinned DSH pair recorded in the extension's release metadata. */
export const POLICY_COMPATIBILITY = JSON.parse(
  readFileSync(resolve(moduleDir, '../compatibility.json'), 'utf8'),
) as PolicyCompatibility

/** Require an exact match with the DSH version declared by supported package metadata. */
export function assertCompatibleDsh(
  actualVersion: string,
  expected: PolicyCompatibility = POLICY_COMPATIBILITY,
): void {
  if (actualVersion !== expected.dshVersion) {
    throw new DshCompatibilityError(actualVersion, expected.dshVersion)
  }
}

/** Read a DSH version only from an official DSH package manifest. */
export function dshVersionFromPackageMetadata(metadata: unknown): string {
  if (typeof metadata !== 'object' || metadata === null
    || !('name' in metadata) || typeof metadata.name !== 'string'
    || !(metadata.name === '@deepseek-ai/dsh' || metadata.name.startsWith('@deepseek-ai/dsh-'))
    || !('version' in metadata) || typeof metadata.version !== 'string' || metadata.version.length === 0) {
    throw new TypeError('Cannot establish DSH version from supported official package metadata')
  }
  return metadata.version
}
