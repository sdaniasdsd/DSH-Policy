export type ManagerMode = 'official' | 'policy'
export type ViewId = 'home' | 'versions' | 'policy' | 'activity'

export interface PolicyRelease {
  package: string
  version: string
  runtimeVersion: string
  runtimeCommit: string
}

export interface ManagerSnapshot {
  installed: null | {
    desktopVersion: string
    runtimeVersion: string | null
    runtimeCommit: string | null
    buildDirty?: boolean
  }
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
  launchDsh(): Promise<{ launched: boolean }>
  chooseHome(path: string): Promise<ManagerSnapshot>
}
