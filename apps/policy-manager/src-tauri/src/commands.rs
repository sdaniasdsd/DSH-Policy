use crate::backup::{BackupRecord, BackupStore};
use crate::catalog::{DesktopRelease, ReleaseCatalog};
use crate::catalog_update::CatalogClient;
use crate::harness_home::{HarnessHome, HomeResolution};
use crate::installed_dsh::InstalledDsh;
use crate::installer::{DesktopProcessProbe, InstallerManager, SystemDesktopProcessProbe};
use crate::launcher::DshLauncher;
use crate::manager_state::{ManagerMode, ManagerState, ProfileSnapshot};
use crate::profile_mode::ProfileModeManager;
use crate::recovery::{
    RecoveryManager, RecoverySnapshot, WindowsInstalledDshVerifier, preserved_home_path,
};
use crate::transaction::{TransitionJournal, TransitionStage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeChoice {
    pub standard: PathBuf,
    pub policy: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerSnapshot {
    pub installed: Option<InstalledDsh>,
    pub home: Option<PathBuf>,
    pub home_choice: Option<HomeChoice>,
    pub mode: ManagerMode,
    pub policy_version: Option<String>,
    pub policy_compatible: bool,
    pub compatible_policy: Option<crate::catalog::PolicyRelease>,
    pub unavailable_reason: Option<String>,
    pub catalog_revision: u64,
    pub catalog_status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedCatalog {
    data: String,
    signature: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
struct ManagerSettings {
    selected_home: Option<PathBuf>,
    requested_mode: ManagerMode,
    last_policy_version: Option<String>,
}

impl Default for ManagerSettings {
    fn default() -> Self {
        Self {
            selected_home: None,
            requested_mode: ManagerMode::Official,
            last_policy_version: None,
        }
    }
}

pub struct ManagerServices {
    local_data: PathBuf,
    catalog: RwLock<ReleaseCatalog>,
    settings: Mutex<ManagerSettings>,
    catalog_status: RwLock<String>,
}

impl ManagerServices {
    pub fn new(local_data: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&local_data).map_err(|error| error.to_string())?;
        let settings_path = local_data.join("settings.json");
        let settings = match fs::read(&settings_path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|_| "manager settings are invalid".to_owned())?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ManagerSettings::default()
            }
            Err(error) => return Err(error.to_string()),
        };
        let bundled_catalog: ReleaseCatalog =
            serde_json::from_str(include_str!("../../catalog/releases.json"))
                .map_err(|_| "built-in development catalog is invalid".to_owned())?;
        let (catalog, catalog_status) = load_catalog_cache(&local_data, bundled_catalog)?;
        Ok(Self {
            local_data,
            catalog: RwLock::new(catalog),
            settings: Mutex::new(settings),
            catalog_status: RwLock::new(catalog_status),
        })
    }

    fn save_settings(&self) -> Result<(), String> {
        let settings = self
            .settings
            .lock()
            .map_err(|_| "manager settings are unavailable".to_owned())?;
        let bytes = serde_json::to_vec_pretty(&*settings)
            .map_err(|_| "manager settings could not be encoded".to_owned())?;
        let temporary = self.local_data.join("settings.json.tmp");
        fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
        fs::rename(temporary, self.local_data.join("settings.json"))
            .map_err(|error| error.to_string())
    }

    fn settings(&self) -> Result<ManagerSettings, String> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "manager settings are unavailable".to_owned())
    }

    fn catalog(&self) -> Result<ReleaseCatalog, String> {
        self.catalog
            .read()
            .map(|catalog| catalog.clone())
            .map_err(|_| "release catalog is unavailable".to_owned())
    }

    fn resolve_home(&self) -> Result<HomeResolution, String> {
        let profile = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .ok_or_else(|| "Windows user profile is unavailable".to_owned())?;
        let settings = self.settings()?;
        let explicit = std::env::var_os("DSH_HOME")
            .map(PathBuf::from)
            .or(settings.selected_home);
        Ok(HarnessHome::resolve(explicit, &profile))
    }

    fn backup_store(&self) -> BackupStore {
        BackupStore::new(self.local_data.join("backups"))
    }
    fn journal(&self) -> TransitionJournal {
        TransitionJournal::new(self.local_data.join("journal"))
    }

    fn installed(&self) -> Result<Option<InstalledDsh>, String> {
        #[cfg(windows)]
        {
            use crate::installed_dsh::WindowsInstallRegistry;
            InstalledDsh::detect(&WindowsInstallRegistry).map_err(|error| error.to_string())
        }
        #[cfg(not(windows))]
        {
            Ok(None)
        }
    }

    fn snapshot(&self) -> Result<ManagerSnapshot, String> {
        let catalog = self.catalog()?;
        let resolution = self.resolve_home()?;
        let (home, home_choice) = match resolution {
            HomeResolution::Selected { path, .. } => (Some(path), None),
            HomeResolution::ChoiceRequired { standard, policy } => {
                (None, Some(HomeChoice { standard, policy }))
            }
            HomeResolution::InspectionFailed { reason, .. } => return Err(reason),
        };
        let installed = self.installed()?;
        let settings = self.settings()?;
        let (policy_version, requested_mode) = match (&installed, &home) {
            (Some(installation), Some(home))
                if !SystemDesktopProcessProbe.is_running().unwrap_or(true) =>
            {
                let manager = ProfileModeManager::system(
                    catalog.clone(),
                    self.backup_store(),
                    self.journal(),
                    Duration::from_secs(120),
                );
                match manager.inspect_policy_version(installation, home) {
                    Ok(version) => {
                        let mode = if version.is_some() {
                            ManagerMode::Policy
                        } else {
                            ManagerMode::Official
                        };
                        (version, mode)
                    }
                    Err(_) => (
                        settings.last_policy_version.clone(),
                        settings.requested_mode,
                    ),
                }
            }
            _ => (
                settings.last_policy_version.clone(),
                settings.requested_mode,
            ),
        };
        let state = ManagerState::inspect(
            installed.clone(),
            home.clone().unwrap_or_default(),
            ProfileSnapshot {
                mode: requested_mode,
            },
            &catalog,
        );
        let compatible_policy = state.compatible_policy;
        let policy_compatible = state.policy_compatible;
        let unavailable_reason = if installed.is_none() {
            Some("Install an official DSH Desktop release to manage its profile.".to_owned())
        } else if catalog.expires_at <= now_unix() {
            Some(
                "The verified release catalog has expired; refresh it before enabling Policy mode."
                    .to_owned(),
            )
        } else if let Some(installed) = installed.as_ref().filter(|installed| installed.build_dirty)
        {
            Some(format!(
                "DSH {} is a dirty build and cannot use Policy mode.",
                installed
                    .runtime_version
                    .as_deref()
                    .unwrap_or("with unknown runtime identity")
            ))
        } else if let Some(installed) = installed.as_ref() {
            match (
                installed.runtime_version.as_deref(),
                installed.runtime_commit.as_deref(),
            ) {
                (Some(version), Some(commit)) if !policy_compatible => Some(format!(
                    "No exact Policy release matches DSH {version} at commit {}.",
                    &commit[..commit.len().min(10)]
                )),
                (None, _) | (_, None) => {
                    Some("The bundled DSH runtime version or commit could not be read.".to_owned())
                }
                _ => None,
            }
        } else {
            None
        };
        let catalog_status = self
            .catalog_status
            .read()
            .map(|value| value.clone())
            .unwrap_or_default();
        Ok(ManagerSnapshot {
            installed,
            home,
            home_choice,
            mode: state.mode,
            policy_version,
            policy_compatible,
            compatible_policy,
            unavailable_reason,
            catalog_revision: catalog.catalog_revision,
            catalog_status,
        })
    }

    fn profile_manager(&self) -> Result<ProfileModeManager, String> {
        Ok(ProfileModeManager::system(
            self.catalog()?,
            self.backup_store(),
            self.journal(),
            Duration::from_secs(120),
        ))
    }

    fn save_mode(&self, mode: ManagerMode, policy_version: Option<String>) -> Result<(), String> {
        {
            let mut settings = self
                .settings
                .lock()
                .map_err(|_| "manager settings are unavailable".to_owned())?;
            settings.requested_mode = mode;
            settings.last_policy_version = policy_version;
        }
        self.save_settings()
    }
}

#[tauri::command]
pub async fn get_manager_state(
    services: State<'_, Arc<ManagerServices>>,
) -> Result<ManagerSnapshot, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || services.snapshot())
        .await
        .map_err(|_| "manager state worker failed".to_owned())?
}

#[tauri::command]
pub fn list_releases(
    services: State<'_, Arc<ManagerServices>>,
) -> Result<Vec<ReleaseView>, String> {
    let catalog = services.catalog()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_secs())
        .unwrap_or_default();
    let installable = catalog.expires_at > now;
    Ok(catalog
        .desktop_releases
        .into_iter()
        .map(|release| ReleaseView {
            desktop_version: release.desktop_version,
            runtime_version: release.runtime_version,
            runtime_commit: release.runtime_commit,
            installer_url: release.installer_url,
            sha256: release.sha256,
            installer_profile: release.installer_profile,
            policies: release.policies,
            installable,
        })
        .collect())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseView {
    pub desktop_version: String,
    pub runtime_version: String,
    pub runtime_commit: String,
    pub installer_url: String,
    pub sha256: String,
    pub installer_profile: String,
    pub policies: Vec<crate::catalog::PolicyRelease>,
    pub installable: bool,
}

#[tauri::command]
pub async fn list_backups(
    services: State<'_, Arc<ManagerServices>>,
) -> Result<Vec<BackupRecord>, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || list_backups_inner(&services))
        .await
        .map_err(|_| "backup listing worker failed".to_owned())?
}

fn list_backups_inner(services: &ManagerServices) -> Result<Vec<BackupRecord>, String> {
    let home = match services.resolve_home()? {
        HomeResolution::Selected { path, .. } => Some(path),
        HomeResolution::ChoiceRequired { .. } => None,
        HomeResolution::InspectionFailed { reason, .. } => return Err(reason),
    };
    let mut backups = services
        .backup_store()
        .list()
        .map_err(|error| error.to_string())?;
    if let Some(home) = home {
        backups.retain(|backup| same_path_or_value(&backup.source_path, &home));
    } else {
        backups.clear();
    }
    Ok(backups)
}

#[tauri::command]
pub fn get_activity(
    services: State<'_, Arc<ManagerServices>>,
) -> Result<Vec<ActivityView>, String> {
    Ok(services
        .journal()
        .list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|entry| ActivityView {
            id: entry.operation_id.to_string(),
            action: "DSH manager transition".to_owned(),
            stage: format!("{:?}", entry.stage),
            updated_at: entry.updated_at,
            details: Some(format!("Operation {}", entry.operation_id)),
        })
        .collect())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityView {
    pub id: String,
    pub action: String,
    pub stage: String,
    pub updated_at: u64,
    pub details: Option<String>,
}

#[tauri::command]
pub async fn refresh_catalog(
    services: State<'_, Arc<ManagerServices>>,
) -> Result<RefreshResult, String> {
    let client = CatalogClient::from_embedded_key().map_err(|error| error.to_string())?;
    let current = services.catalog()?;
    let verified = client
        .refresh_signed(Some(&current))
        .await
        .map_err(|error| error.to_string())?;
    let result = RefreshResult {
        revision: verified.catalog.catalog_revision,
        expires_at: verified.catalog.expires_at,
    };
    let cached = CachedCatalog {
        data: String::from_utf8(verified.data)
            .map_err(|_| "verified catalog was not UTF-8".to_owned())?,
        signature: verified.signature,
    };
    let bytes = serde_json::to_vec(&cached)
        .map_err(|_| "verified catalog cache could not be encoded".to_owned())?;
    let cache_temp = services.local_data.join("catalog-cache.json.tmp");
    fs::write(&cache_temp, bytes).map_err(|error| error.to_string())?;
    fs::rename(cache_temp, services.local_data.join("catalog-cache.json"))
        .map_err(|error| error.to_string())?;
    *services
        .catalog
        .write()
        .map_err(|_| "release catalog is unavailable".to_owned())? = verified.catalog;
    *services
        .catalog_status
        .write()
        .map_err(|_| "catalog status is unavailable".to_owned())? =
        format!("Verified catalog revision {}.", result.revision);
    Ok(result)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub revision: u64,
    pub expires_at: u64,
}

#[tauri::command]
pub async fn choose_home(
    path: String,
    services: State<'_, Arc<ManagerServices>>,
) -> Result<ManagerSnapshot, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || choose_home_inner(path, &services))
        .await
        .map_err(|_| "home selection worker failed".to_owned())?
}

fn choose_home_inner(path: String, services: &ManagerServices) -> Result<ManagerSnapshot, String> {
    let candidate = PathBuf::from(path);
    let choice = match services.resolve_home()? {
        HomeResolution::ChoiceRequired { standard, policy } => (standard, policy),
        _ => return Err("a home choice is no longer required".to_owned()),
    };
    let profile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .ok_or_else(|| "Windows user profile is unavailable".to_owned())?;
    let standard = profile.join(".dsh");
    let policy = profile.join(".dsh-policy");
    if !same_path_or_value(&candidate, &standard) && !same_path_or_value(&candidate, &policy) {
        return Err("choose one of the detected Harness homes".to_owned());
    }
    let backups = services.backup_store();
    backups
        .create(&choice.0)
        .map_err(|error| format!("could not back up the standard Harness home: {error}"))?;
    backups
        .create(&choice.1)
        .map_err(|error| format!("could not back up the former Policy home: {error}"))?;
    services
        .settings
        .lock()
        .map_err(|_| "manager settings are unavailable".to_owned())?
        .selected_home = Some(candidate);
    services.save_settings()?;
    services.snapshot()
}

#[tauri::command]
pub async fn set_mode(
    mode: ManagerMode,
    services: State<'_, Arc<ManagerServices>>,
) -> Result<ModeCommandResult, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || set_mode_inner(mode, &services))
        .await
        .map_err(|_| "mode change worker failed".to_owned())?
}

fn set_mode_inner(
    mode: ManagerMode,
    services: &ManagerServices,
) -> Result<ModeCommandResult, String> {
    let snapshot = services.snapshot()?;
    let installation = snapshot
        .installed
        .ok_or_else(|| "official DSH Desktop is not installed".to_owned())?;
    let home = snapshot
        .home
        .ok_or_else(|| "choose a Harness home before changing mode".to_owned())?;
    let result = services
        .profile_manager()?
        .apply(mode, &installation, &home)
        .map_err(|error| error.to_string())?;
    services.save_mode(mode, result.policy_version.clone())?;
    Ok(ModeCommandResult {
        mode,
        changed: result.changed,
        backup_id: result.backup.id.to_string(),
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeCommandResult {
    pub mode: ManagerMode,
    pub changed: bool,
    pub backup_id: String,
}

#[tauri::command]
pub async fn launch_dsh(
    services: State<'_, Arc<ManagerServices>>,
) -> Result<LaunchCommandResult, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || launch_dsh_inner(&services))
        .await
        .map_err(|_| "desktop launch worker failed".to_owned())?
}

fn launch_dsh_inner(services: &ManagerServices) -> Result<LaunchCommandResult, String> {
    let snapshot = services.snapshot()?;
    let installation = snapshot
        .installed
        .ok_or_else(|| "official DSH Desktop is not installed".to_owned())?;
    let home = snapshot
        .home
        .ok_or_else(|| "choose a Harness home before launching".to_owned())?;
    let requested = if snapshot.mode == ManagerMode::Policy && snapshot.policy_compatible {
        ManagerMode::Policy
    } else {
        ManagerMode::Official
    };
    if !home.join("profiles/desktop/package.json").exists() {
        services.save_mode(ManagerMode::Official, None)?;
        let process_id = DshLauncher::system()
            .launch_official_initialization(&installation, &home)
            .map_err(|error| error.to_string())?;
        return Ok(LaunchCommandResult {
            launched: true,
            process_id,
        });
    }
    let result = services
        .profile_manager()?
        .apply(requested, &installation, &home)
        .map_err(|error| error.to_string())?;
    services.save_mode(requested, result.policy_version)?;
    let process_id = DshLauncher::system()
        .launch(&installation, &home)
        .map_err(|error| error.to_string())?;
    Ok(LaunchCommandResult {
        launched: true,
        process_id,
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCommandResult {
    pub launched: bool,
    pub process_id: u32,
}

#[tauri::command]
pub async fn restore_backup(
    id: String,
    services: State<'_, Arc<ManagerServices>>,
) -> Result<RestoreCommandResult, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || restore_backup_inner(id, &services))
        .await
        .map_err(|_| "backup restore worker failed".to_owned())?
}

fn restore_backup_inner(
    id: String,
    services: &ManagerServices,
) -> Result<RestoreCommandResult, String> {
    let snapshot = services.snapshot()?;
    let home = snapshot
        .home
        .ok_or_else(|| "choose a Harness home before restoring".to_owned())?;
    if SystemDesktopProcessProbe
        .is_running()
        .map_err(|error| error.to_string())?
    {
        return Err("close DSH Desktop before restoring a backup".to_owned());
    }
    if home.join("profiles/desktop/package.json.lock").exists() {
        return Err("the desktop profile is busy".to_owned());
    }
    let backup_id = Uuid::parse_str(&id).map_err(|_| "backup identifier is invalid".to_owned())?;
    let store = services.backup_store();
    let record = store
        .list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|record| record.id == backup_id)
        .ok_or_else(|| "backup was not found or failed validation".to_owned())?;
    if !same_path_or_value(&record.source_path, &home) {
        return Err("backup belongs to a different Harness home".to_owned());
    }
    let pre_restore = store.create(&home).map_err(|error| error.to_string())?;
    let journal = services.journal();
    let operation_id = Uuid::new_v4();
    journal
        .advance(operation_id, TransitionStage::Prepared)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::BackedUp)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::Recovering)
        .map_err(|error| error.to_string())?;
    let preserved = preserved_home_path(&home, operation_id);
    let mut preserved_home = false;
    match fs::symlink_metadata(&home) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            match fs::symlink_metadata(&preserved) {
                Ok(_) => {
                    journal
                        .advance(operation_id, TransitionStage::RecoveryRequired)
                        .map_err(|error| error.to_string())?;
                    return Err(
                        "a recovery copy already exists; current data was left untouched"
                            .to_owned(),
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    journal
                        .advance(operation_id, TransitionStage::RecoveryRequired)
                        .map_err(|journal_error| journal_error.to_string())?;
                    return Err(error.to_string());
                }
            }
            if let Err(error) = fs::rename(&home, &preserved) {
                journal
                    .advance(operation_id, TransitionStage::RecoveryRequired)
                    .map_err(|journal_error| journal_error.to_string())?;
                return Err(error.to_string());
            }
            preserved_home = true;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Ok(_) => {
            journal
                .advance(operation_id, TransitionStage::RecoveryRequired)
                .map_err(|error| error.to_string())?;
            return Err("the current home is not a regular directory".to_owned());
        }
        Err(error) => {
            journal
                .advance(operation_id, TransitionStage::RecoveryRequired)
                .map_err(|journal_error| journal_error.to_string())?;
            return Err(error.to_string());
        }
    }
    if let Err(error) = store.restore(&record, &home) {
        if preserved_home && !home.exists() {
            let _ = fs::rename(&preserved, &home);
        }
        journal
            .advance(operation_id, TransitionStage::RecoveryRequired)
            .map_err(|journal_error| journal_error.to_string())?;
        return Err(format!(
            "backup restore failed; pre-restore backup {} is retained: {error}",
            pre_restore.id
        ));
    }
    journal
        .advance(operation_id, TransitionStage::Committed)
        .map_err(|error| error.to_string())?;
    Ok(RestoreCommandResult {
        restored: true,
        pre_restore_backup_id: pre_restore.id.to_string(),
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreCommandResult {
    pub restored: bool,
    pub pre_restore_backup_id: String,
}

#[tauri::command]
pub async fn install_release(
    desktop_version: String,
    services: State<'_, Arc<ManagerServices>>,
) -> Result<InstallCommandResult, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || install_release_inner(&services, &desktop_version))
        .await
        .map_err(|_| "release installation worker failed".to_owned())?
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCommandResult {
    pub installed: bool,
    pub backup_id: String,
    pub recovered: bool,
}

fn install_release_inner(
    services: &ManagerServices,
    desktop_version: &str,
) -> Result<InstallCommandResult, String> {
    let snapshot = services.snapshot()?;
    let home = snapshot
        .home
        .ok_or_else(|| "choose a Harness home before installing a release".to_owned())?;
    let catalog = services.catalog()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_secs())
        .map_err(|_| "system clock is invalid".to_owned())?;
    if catalog.expires_at <= now {
        return Err("the verified release catalog has expired".to_owned());
    }
    let target = catalog
        .desktop_releases
        .clone()
        .into_iter()
        .find(|release| release.desktop_version == desktop_version)
        .ok_or_else(|| "release is absent from the verified catalog".to_owned())?;
    let Some(installation) = snapshot.installed else {
        return install_fresh_release(services, &target, &home);
    };
    if home.join("profiles/desktop/package.json.lock").exists() {
        return Err(
            "the desktop profile is busy; retry after its package operation finishes".to_owned(),
        );
    }
    if installation.desktop_version == target.desktop_version {
        return Ok(InstallCommandResult {
            installed: true,
            backup_id: String::new(),
            recovered: false,
        });
    }
    let previous_release = catalog
        .desktop_releases
        .iter()
        .find(|release| {
            release.desktop_version == installation.desktop_version
                && release.runtime_version
                    == installation.runtime_version.as_deref().unwrap_or_default()
                && release.runtime_commit
                    == installation.runtime_commit.as_deref().unwrap_or_default()
        })
        .cloned()
        .ok_or_else(|| "the current DSH version has no verified rollback installer".to_owned())?;
    let installers = InstallerManager::system(services.local_data.join("installers"))
        .map_err(|error| error.to_string())?;
    let staged = installers
        .stage(&target)
        .map_err(|error| error.to_string())?;
    let backups = services.backup_store();
    let backup = backups.create(&home).map_err(|error| error.to_string())?;
    let journal = services.journal();
    let operation_id = Uuid::new_v4();
    journal
        .advance(operation_id, TransitionStage::Prepared)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::BackedUp)
        .map_err(|error| error.to_string())?;
    let recovery_snapshot = RecoverySnapshot {
        operation_id,
        previous_release,
        backup: backup.clone(),
        home: home.clone(),
        installation_location: installation.install_location.clone(),
        requested_mode: snapshot.mode,
        catalog: catalog.clone(),
    };
    journal
        .advance(operation_id, TransitionStage::Installing)
        .map_err(|error| error.to_string())?;
    let install_error = installers
        .install(&staged)
        .err()
        .map(|error| error.to_string());
    let verified = if install_error.is_none() {
        #[cfg(windows)]
        {
            InstalledDsh::detect(&crate::installed_dsh::WindowsInstallRegistry)
                .ok()
                .flatten()
                .filter(|installed| release_matches(&target, installed))
        }
        #[cfg(not(windows))]
        {
            None
        }
    } else {
        None
    };
    if let Some(error) = install_error.or_else(|| {
        verified
            .is_none()
            .then(|| "installed DSH version did not match the signed catalog".to_owned())
    }) {
        let recovery = RecoveryManager::new(
            installers,
            backups,
            journal,
            Arc::new(WindowsInstalledDshVerifier),
        );
        match recovery.recover(&recovery_snapshot) {
            Ok(_) => {
                return Err(format!(
                    "{error}; the prior verified DSH release and home were restored"
                ));
            }
            Err(recovery_error) => {
                return Err(format!("{error}; recovery is required: {recovery_error}"));
            }
        }
    }
    journal
        .advance(operation_id, TransitionStage::ProfileUpdating)
        .map_err(|error| error.to_string())?;
    let verified =
        verified.ok_or_else(|| "installed DSH version could not be verified".to_owned())?;
    let requested_mode = if snapshot.mode == ManagerMode::Policy
        && catalog
            .policy_for(
                target.runtime_version.as_str(),
                target.runtime_commit.as_str(),
            )
            .is_some()
    {
        ManagerMode::Policy
    } else {
        ManagerMode::Official
    };
    if let Err(mode_error) = services
        .profile_manager()?
        .apply(requested_mode, &verified, &home)
    {
        let recovery = RecoveryManager::new(
            installers,
            backups,
            journal,
            Arc::new(WindowsInstalledDshVerifier),
        );
        return match recovery.recover(&recovery_snapshot) {
            Ok(_) => Err(format!(
                "profile update failed and the previous DSH release was restored: {mode_error}"
            )),
            Err(recovery_error) => Err(format!(
                "profile update failed; recovery is required: {mode_error}; {recovery_error}"
            )),
        };
    }
    journal
        .advance(operation_id, TransitionStage::Verifying)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::Committed)
        .map_err(|error| error.to_string())?;
    services.save_mode(
        requested_mode,
        if requested_mode == ManagerMode::Policy {
            catalog
                .policy_for(
                    target.runtime_version.as_str(),
                    target.runtime_commit.as_str(),
                )
                .map(|policy| policy.version.clone())
        } else {
            None
        },
    )?;
    Ok(InstallCommandResult {
        installed: true,
        backup_id: backup.id.to_string(),
        recovered: false,
    })
}

fn install_fresh_release(
    services: &ManagerServices,
    target: &DesktopRelease,
    home: &Path,
) -> Result<InstallCommandResult, String> {
    let installers = InstallerManager::system(services.local_data.join("installers"))
        .map_err(|error| error.to_string())?;
    let staged = installers
        .stage(target)
        .map_err(|error| error.to_string())?;
    let backups = services.backup_store();
    let backup = backups.create(home).map_err(|error| error.to_string())?;
    let journal = services.journal();
    let operation_id = Uuid::new_v4();
    journal
        .advance(operation_id, TransitionStage::Prepared)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::BackedUp)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::Installing)
        .map_err(|error| error.to_string())?;

    let install_error = installers
        .install(&staged)
        .err()
        .map(|error| error.to_string());
    let installed = if install_error.is_none() {
        #[cfg(windows)]
        {
            InstalledDsh::detect(&crate::installed_dsh::WindowsInstallRegistry)
                .ok()
                .flatten()
                .filter(|installed| release_matches(target, installed))
        }
        #[cfg(not(windows))]
        {
            None
        }
    } else {
        None
    };
    if let Some(error) = install_error.or_else(|| {
        installed
            .is_none()
            .then(|| "installed DSH version did not match the signed catalog".to_owned())
    }) {
        journal
            .advance(operation_id, TransitionStage::Recovering)
            .map_err(|journal_error| journal_error.to_string())?;
        journal
            .advance(operation_id, TransitionStage::RecoveryRequired)
            .map_err(|journal_error| journal_error.to_string())?;
        return Err(format!(
            "fresh DSH installation failed; recovery is required: {error}"
        ));
    }

    journal
        .advance(operation_id, TransitionStage::ProfileUpdating)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::Verifying)
        .map_err(|error| error.to_string())?;
    journal
        .advance(operation_id, TransitionStage::Committed)
        .map_err(|error| error.to_string())?;
    services.save_mode(ManagerMode::Official, None)?;
    Ok(InstallCommandResult {
        installed: true,
        backup_id: backup.id.to_string(),
        recovered: false,
    })
}

fn release_matches(release: &DesktopRelease, installed: &InstalledDsh) -> bool {
    release.desktop_version == installed.desktop_version
        && Some(release.runtime_version.as_str()) == installed.runtime_version.as_deref()
        && Some(release.runtime_commit.as_str()) == installed.runtime_commit.as_deref()
        && !installed.build_dirty
}

fn same_path_or_value(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()),
        _ => left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()),
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_secs())
        .unwrap_or_default()
}

fn load_catalog_cache(
    local_data: &Path,
    bundled: ReleaseCatalog,
) -> Result<(ReleaseCatalog, String), String> {
    let cache_path = local_data.join("catalog-cache.json");
    let bytes = match fs::read(cache_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let status = if CatalogClient::from_embedded_key().is_err() {
                "This manager build has no catalog trust key; signed releases are unavailable."
                    .to_owned()
            } else {
                "No verified catalog has been loaded; refresh the signed release catalog."
                    .to_owned()
            };
            return Ok((bundled, status));
        }
        Err(error) => return Err(error.to_string()),
    };
    let cached: CachedCatalog = match serde_json::from_slice(&bytes) {
        Ok(cached) => cached,
        Err(_) => {
            return Ok((
                bundled,
                "The cached release catalog is invalid; refresh it.".to_owned(),
            ));
        }
    };
    let client =
        match CatalogClient::from_embedded_key() {
            Ok(client) => client,
            Err(_) => return Ok((
                bundled,
                "This manager build has no catalog trust key; cached releases cannot be verified."
                    .to_owned(),
            )),
        };
    let verified = match client.verify_cached(cached.data.as_bytes(), &cached.signature) {
        Ok(catalog) if catalog.catalog_revision >= bundled.catalog_revision => catalog,
        _ => {
            return Ok((
                bundled,
                "The cached release catalog failed signature, expiry, or revision checks."
                    .to_owned(),
            ));
        }
    };
    let status = format!(
        "Verified cached catalog revision {}.",
        verified.catalog_revision
    );
    Ok((verified, status))
}

#[cfg(test)]
mod tests {
    use super::ManagerServices;
    use tempfile::tempdir;

    #[test]
    fn manager_starts_with_the_empty_development_catalog() {
        let temp = tempdir().unwrap();
        let services = ManagerServices::new(temp.path().join("manager-data")).unwrap();
        assert!(services.catalog().unwrap().desktop_releases.is_empty());
    }

    #[test]
    fn malformed_cached_catalog_does_not_block_the_manager_shell() {
        let temp = tempdir().unwrap();
        let local_data = temp.path().join("manager-data");
        std::fs::create_dir_all(&local_data).unwrap();
        std::fs::write(local_data.join("catalog-cache.json"), b"not-json").unwrap();
        let services = ManagerServices::new(local_data).unwrap();
        assert!(services.catalog().unwrap().desktop_releases.is_empty());
        assert!(services.catalog_status.read().unwrap().contains("invalid"));
    }
}
