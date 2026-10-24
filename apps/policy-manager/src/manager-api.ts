import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ManagerApi } from './manager-types'

async function call<T>(command: string, args?: Record<string, string>): Promise<T> {
  if (!isTauri()) throw new Error('请在已安装的 DSH 策略管理器桌面应用中运行，浏览器预览无法读取本机安装。')
  return invoke<T>(command, args)
}

export const tauriManagerApi: ManagerApi = {
  getManagerState: () => call('get_manager_state'),
  listReleases: () => call('list_releases'),
  listBackups: () => call('list_backups'),
  getActivity: () => call('get_activity'),
  refreshCatalog: () => call('refresh_catalog'),
  setMode: mode => call('set_mode', { mode }),
  installRelease: desktopVersion => call('install_release', { desktopVersion }),
  restoreBackup: id => call('restore_backup', { id }),
  recoverTransition: operationId => call('recover_transition', { operationId }),
  launchDsh: () => call('launch_dsh'),
  chooseHome: path => call('choose_home', { path }),
  selectInstallation: path => call('select_installation', { path }),
  resetInstallationSelection: () => call('reset_installation_selection'),
  refreshGithubReleases: () => call('refresh_github_releases'),
  openGithubUrl: url => call('open_github_url', { url }),
}
