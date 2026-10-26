import { describe, expect, it } from 'vitest'
import { recommendInstallation } from './install-recommendation'
import type { GithubReleaseIndex, ManagerSnapshot } from './manager-types'

const commit = 'a'.repeat(40)
const installed = { installLocation: 'C:/DSH', desktopVersion: '1.0.1', runtimeVersion: '0.2.1', runtimeCommit: commit }
const compatiblePolicy = {
  package: '@deepseek-ai/dsh-policy-extension',
  version: '1.0.2',
  runtimeVersion: '0.2.1',
  runtimeCommit: commit,
}
const state: ManagerSnapshot = {
  installed,
  installations: [],
  installationEdition: 'official',
  home: 'C:/home',
  homeChoice: null,
  mode: 'official',
  policyVersion: null,
  policyCompatible: true,
  compatiblePolicy,
  catalogRevision: 1,
  catalogStatus: '',
}
function release(version: string, prerelease = false): GithubReleaseIndex['releases'][number] {
  const installerName = `dsh-policy-${version}-win-x64-unsigned.exe`
  return { tag: `v${version}`, version, name: version, prerelease, htmlUrl: `https://github.com/sdaniasdsd/DSH-Policy/releases/tag/v${version}`, sourceCommit: commit, officialBase: { version: '0.2.1', tag: 'v0.2.1', commit, sourceUrl: 'https://github.com/sdaniasdsd/DSH-Policy/tree/' + commit, verification: 'verified' }, publishedAt: null, installer: { name: installerName, url: `https://github.com/sdaniasdsd/DSH-Policy/releases/download/v${version}/${installerName}`, sha256: null, size: 100 } }
}
const index = (releases: GithubReleaseIndex['releases']): GithubReleaseIndex => ({ repository: 'sdaniasdsd/DSH-Policy', checkedAt: 1, releases })

describe('installation recommendations', () => {
  it('selects the highest semantic stable version independent of API order', () => {
    const result = recommendInstallation(state, index([release('1.9.9'), release('1.10.0'), release('1.2.0')]))
    expect(result.integratedRelease?.version).toBe('1.10.0')
  })

  it('excludes previews, semantic prereleases, missing installers, and invalid versions', () => {
    const result = recommendInstallation(state, index([release('2.0.0', true), release('9.0.0-preview.1'), { ...release('8.0.0'), installer: null }, release('latest'), release('01.2.3'), release('1.2.3+build.9')]))
    expect(result.integratedRelease?.version).toBe('1.2.3+build.9')
  })

  it.each([
    { policyCompatible: false },
    { compatiblePolicy: null },
    { compatiblePolicy: { ...compatiblePolicy, runtimeCommit: 'b'.repeat(40) } },
    { compatiblePolicy: { ...compatiblePolicy, runtimeVersion: '0.2.2' } },
    { installed: { ...installed, buildDirty: true } },
    { installed: { ...installed, runtimeCommit: null } },
    { homeChoice: { standard: 'a', policy: 'b' } },
    { installationEdition: 'policy' as const },
    { installed: null },
  ])('rejects an unsafe extension recommendation for %j', (override) => {
    expect(recommendInstallation({ ...state, ...override }, index([release('1.2.3')])).canEnablePolicy).toBe(false)
  })

  it('enables only an exact signed runtime mapping and does not infer it from officialBase', () => {
    expect(recommendInstallation(state, null).canEnablePolicy).toBe(true)
    const mapped = {
      ...release('1.2.3'),
      officialBase: {
        version: '0.2.1',
        tag: 'v0.2.1',
        commit,
        sourceUrl: `https://github.com/sdaniasdsd/DSH-Policy/tree/${commit}`,
        verification: 'verified' as const,
      },
    }
    const unmappedState = { ...state, policyCompatible: false, compatiblePolicy: null }
    expect(recommendInstallation(unmappedState, index([mapped])).canEnablePolicy).toBe(false)
  })

  it.each([
    ['1.2.3', 'current'], ['1.10.0', 'keep-newer'], ['2.0.0-preview.1', 'keep-preview'], ['custom', 'unknown-current'],
  ])('does not recommend a lower stable download for installed %s', (version, action) => {
    expect(recommendInstallation({ ...state, installationEdition: 'policy', installed: { ...installed, desktopVersion: version } }, index([release('1.2.3')])).integratedAction).toBe(action)
  })

  it('distinguishes a missing application from detected applications awaiting selection', () => {
    expect(recommendInstallation({ ...state, installed: null, installations: [] }, null).current).toBe('not-installed')
    expect(recommendInstallation({ ...state, installed: null, installations: [{ installed, edition: 'official', displayName: 'DSH' }] }, index([release('1.2.3')])).current).toBe('choose-installation')
  })

  it('does not recommend releases whose official baseline has not been audited', () => {
    const result = recommendInstallation(state, index([{ ...release('9.0.0'), officialBase: null }, { ...release('8.0.0'), officialBase: undefined }, release('1.2.3')]))
    expect(result.integratedRelease?.version).toBe('1.2.3')
  })

  it('allows a documented declared baseline for a self-contained app without treating it as extension eligibility', () => {
    const declared = {
      ...release('1.2.3'),
      officialBase: {
        version: '0.2.1',
        tag: 'v0.2.1',
        commit: null,
        sourceUrl: `https://github.com/sdaniasdsd/DSH-Policy/tree/${commit}`,
        verification: 'declared' as const,
      },
    }
    const result = recommendInstallation({ ...state, policyCompatible: false, compatiblePolicy: null }, index([declared]))
    expect(result.integratedRelease?.version).toBe('1.2.3')
    expect(result.canEnablePolicy).toBe(false)
  })

  const localPolicy = (version: string) => ({ edition: 'policy' as const, displayName: `DSH Policy Edition ${version}`, installed: { ...installed, desktopVersion: version, installLocation: `C:/Policy/${version}` } })

  it.each(['1.2.3', '1.10.0'])('uses an existing stable Policy application %s instead of downloading an equal or lower release', (version) => {
    const result = recommendInstallation({ ...state, policyCompatible: false, compatiblePolicy: null, installations: [localPolicy(version)] }, index([release('1.2.3')]))
    expect(result.existingPolicy?.installed.desktopVersion).toBe(version)
    expect(result.integratedAction).toBe('use-installed')
    expect(result.current).toBe('official')
    expect(result.canEnablePolicy).toBe(false)
  })

  it('selects the numerically highest local stable Policy application without GitHub information', () => {
    const result = recommendInstallation({ ...state, installations: [localPolicy('1.9.9'), localPolicy('20.0.0-preview.1'), localPolicy('1.10.0'), localPolicy('custom')] }, null)
    expect(result.existingPolicy?.installed.desktopVersion).toBe('1.10.0')
    expect(result.integratedAction).toBe('use-installed')
    expect(result.integratedRelease).toBeNull()
  })

  it('still offers an upgrade download when the existing Policy application is older', () => {
    const result = recommendInstallation({ ...state, installations: [localPolicy('1.2.2')] }, index([release('1.2.3')]))
    expect(result.existingPolicy).toBeNull()
    expect(result.integratedAction).toBe('download')
  })

  it('rejects a recommendation whose installer filename names another version', () => {
    const result = recommendInstallation(state, index([{ ...release('9.0.0'), installer: release('8.0.0').installer }, release('1.2.3')]))
    expect(result.integratedRelease?.version).toBe('1.2.3')
  })

  it.each(['1.0.0-test', '1.2.3-preview.1'])('offers a stable upgrade for preview %s when the stable base is not lower', (version) => {
    const result = recommendInstallation({ ...state, installationEdition: 'policy', installed: { ...installed, desktopVersion: version } }, index([release('1.2.3')]))
    expect(result.integratedAction).toBe('download')
  })
})
