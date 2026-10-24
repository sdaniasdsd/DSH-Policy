export type ManagerMode = 'official' | 'policy'
export type ViewId = 'home' | 'versions' | 'policy' | 'activity'

export interface PolicyRelease {
  package: string
  version: string
  runtimeVersion: string
  runtimeCommit: string
  /** Present only for a policy entry loaded from the verified manager catalog. */
  tarballUrl?: string
  sha256?: string
  size?: number
}

export interface InstalledDsh {
  installLocation: string
  desktopVersion: string
  runtimeVersion: string | null
  runtimeCommit: string | null
  buildDirty?: boolean
}

export interface DetectedInstallation {
  installed: InstalledDsh
  edition: 'official' | 'policy'
  displayName: string
}

export interface GithubReleaseIndex {
  repository: string
  checkedAt: number
  /** Public discovery only; never authorizes installation or compatibility. */
  policyExtensions?: GithubPolicyExtensionRelease[]
  releases: {
    tag: string
    version: string
    name: string
    publishedAt: string | null
    prerelease: boolean
    htmlUrl: string
    sourceCommit: string | null
    officialBase?: { version: string; tag: string; commit: string | null; sourceUrl: string; verification: 'declared' | 'verified'; note?: string } | null
    installer: { name: string; url: string; sha256: string | null; size: number } | null
  }[]
}

export interface GithubPolicyExtensionRelease {
  tag: string
  version: string
  package: string
  name: string
  publishedAt: string | null
  prerelease: boolean
  htmlUrl: string
  sourceCommit: string | null
  /** Public metadata may not represent the installed Desktop build identity. */
  runtimeVersion: string | null
  runtimeCommit: string | null
  tarball: { name: string; url: string; sha256: string | null; size: number } | null
}

export interface ManagerSnapshot {
  installed: InstalledDsh | null
  installations: DetectedInstallation[]
  installationEdition: 'official' | 'policy' | null
  selectedInstallationPath?: string | null
  knownPolicy?: { policyVersion: string; dshVersion: string; dshCommit: string; dshTag: string } | null
  home: string | null
  homeChoice: null | { standard: string; policy: string }
  mode: ManagerMode
  policyVersion: string | null
  policyCompatible: boolean
  compatiblePolicy: PolicyRelease | null
  unavailableReason?: string | null
  catalogRevision: number
  catalogStatus: string
}

export interface DesktopRelease {
  desktopVersion: string
  runtimeVersion: string
  runtimeCommit: string
  installerUrl: string
  sha256: string
  installerProfile: string
  policies: PolicyRelease[]
  installable: boolean
}

export interface BackupItem {
  id: string
  createdAt: number
  archivePath: string
}

export interface ActivityItem {
  id: string
  action: string
  stage: string
  updatedAt: number
  details?: string
  recoverable?: boolean
}

export interface ManagerApi {
  getManagerState(): Promise<ManagerSnapshot>
  listReleases(): Promise<DesktopRelease[]>
  listBackups(): Promise<BackupItem[]>
  getActivity(): Promise<ActivityItem[]>
  refreshCatalog(): Promise<{ revision: number; expiresAt: number }>
  setMode(mode: ManagerMode): Promise<{ mode: ManagerMode; changed: boolean }>
  installRelease(desktopVersion: string): Promise<{ installed: boolean }>
  restoreBackup(id: string): Promise<{ restored: boolean }>
  recoverTransition(operationId: string): Promise<{ recovered: boolean }>
  launchDsh(): Promise<{ launched: boolean }>
  chooseHome(path: string): Promise<ManagerSnapshot>
  selectInstallation(path: string): Promise<ManagerSnapshot>
  resetInstallationSelection(): Promise<ManagerSnapshot>
  refreshGithubReleases(): Promise<GithubReleaseIndex>
  openGithubUrl(url: string): Promise<void>
}
