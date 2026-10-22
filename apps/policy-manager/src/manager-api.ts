import { invoke } from '@tauri-apps/api/core'
import type { ManagerApi } from './manager-types'

export const tauriManagerApi: ManagerApi = {
  getManagerState: () => invoke('get_manager_state'),
  listReleases: () => invoke('list_releases'),
  listBackups: () => invoke('list_backups'),
  getActivity: () => invoke('get_activity'),
  refreshCatalog: () => invoke('refresh_catalog'),
  setMode: mode => invoke('set_mode', { mode }),
  installRelease: desktopVersion => invoke('install_release', { desktopVersion }),
  restoreBackup: id => invoke('restore_backup', { id }),
  launchDsh: () => invoke('launch_dsh'),
  chooseHome: path => invoke('choose_home', { path }),
}
