import type { DetectedInstallation, GithubReleaseIndex, ManagerSnapshot } from './manager-types'

export interface InstallationRecommendation {
  current: 'not-installed' | 'choose-installation' | 'official' | 'policy'
  integratedRelease: GithubReleaseIndex['releases'][number] | null
  integratedAction: 'unavailable' | 'download' | 'current' | 'keep-newer' | 'keep-preview' | 'unknown-current' | 'use-installed'
  existingPolicy: DetectedInstallation | null
  canEnablePolicy: boolean
}

function stableVersion(version: string): bigint[] | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version)
  return match ? match.slice(1, 4).map(value => BigInt(value)) : null
}

function compareVersions(left: bigint[], right: bigint[]): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

/** Identifies a semantic prerelease even when the host marks it as a normal release. */
export function isPrereleaseVersion(version: string): boolean {
  const prereleasePattern = '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)-[0-9A-Za-z-]+'
    + '(?:\\.[0-9A-Za-z-]+)*(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$'
  return new RegExp(prereleasePattern).test(version)
}

function compareStableReleaseVersions(left: string, right: string): number {
  const leftVersion = stableVersion(left)
  const rightVersion = stableVersion(right)
  return leftVersion && rightVersion ? compareVersions(leftVersion, rightVersion) : 0
}

/** Recommends a complete app independently from exact signed extension compatibility. */
export function recommendInstallation(state: ManagerSnapshot, github: GithubReleaseIndex | null): InstallationRecommendation {
  const current = state.installed ? state.installationEdition === 'policy' ? 'policy' : 'official'
    : state.installations.length > 0 || state.selectedInstallationPath ? 'choose-installation' : 'not-installed'
  const candidates = (github?.releases ?? []).filter(release => !release.prerelease
    && stableVersion(release.version)
    && release.officialBase
    && release.installer
    && release.installer.size > 0
    && release.installer.url
    && release.installer.name === `dsh-policy-${release.version}-win-x64-unsigned.exe`)
  candidates.sort((left, right) => compareStableReleaseVersions(right.version, left.version)
    || left.tag.localeCompare(right.tag))
  const integratedRelease = candidates[0] ?? null
  const integratedVersion = integratedRelease ? stableVersion(integratedRelease.version) : null
  let integratedAction: InstallationRecommendation['integratedAction'] = integratedRelease ? 'download' : 'unavailable'
  if (integratedRelease && integratedVersion && current === 'policy' && state.installed) {
    const installedVersion = stableVersion(state.installed.desktopVersion)
    if (!installedVersion) {
      const previewBase = isPrereleaseVersion(state.installed.desktopVersion) ? stableVersion(state.installed.desktopVersion.split('-')[0]) : null
      integratedAction = previewBase
        ? compareVersions(integratedVersion, previewBase) >= 0 ? 'download' : 'keep-preview'
        : 'unknown-current'
    }
    else {
      const comparison = compareVersions(installedVersion, integratedVersion)
      if (comparison === 0) integratedAction = 'current'
      else if (comparison > 0) integratedAction = 'keep-newer'
    }
  }
  const localPolicies = state.installationEdition === 'official' && state.installed
    ? state.installations.filter(item => item.edition === 'policy' && stableVersion(item.installed.desktopVersion)) : []
  localPolicies.sort((left, right) => compareStableReleaseVersions(
    right.installed.desktopVersion,
    left.installed.desktopVersion,
  ) || left.installed.installLocation.localeCompare(right.installed.installLocation))
  const localPolicy = localPolicies[0] ?? null
  const existingPolicy = localPolicy && (!integratedRelease
    || compareStableReleaseVersions(localPolicy.installed.desktopVersion, integratedRelease.version) >= 0)
    ? localPolicy
    : null
  if (existingPolicy) integratedAction = 'use-installed'
  const canEnablePolicy = Boolean(state.installationEdition === 'official' && state.installed && !state.installed.buildDirty
    && state.installed.runtimeVersion && state.installed.runtimeCommit && !state.homeChoice && state.home
    && state.policyCompatible && state.compatiblePolicy?.package === '@deepseek-ai/dsh-policy-extension'
    && state.compatiblePolicy.runtimeVersion === state.installed.runtimeVersion
    && state.compatiblePolicy.runtimeCommit === state.installed.runtimeCommit)
  return { current, integratedRelease, integratedAction, existingPolicy, canEnablePolicy }
}
