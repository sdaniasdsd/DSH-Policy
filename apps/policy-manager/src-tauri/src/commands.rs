use crate::backup::{BackupRecord, BackupStore};
use crate::catalog::{DesktopRelease, ReleaseCatalog};
use crate::catalog_update::CatalogClient;
use crate::github_releases::{GithubReleaseIndex, GithubReleasesClient};
use crate::harness_home::{HarnessHome, HomeResolution};
use crate::installed_dsh::{DetectedInstallation, InstallationEdition, InstalledDsh};
use crate::installer::{DesktopProcessProbe, InstallerManager, SystemDesktopProcessProbe};
use crate::launcher::DshLauncher;
use crate::manager_state::{ManagerMode, ManagerState, ProfileSnapshot};
use crate::profile_mode::ProfileModeManager;
use crate::recovery::{
    RecoveryDescriptor, RecoveryDescriptorStore, RecoveryManager, RecoverySnapshot,
    WindowsInstalledDshVerifier, preserved_home_path,
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
    pub installations: Vec<DetectedInstallation>,
    pub installation_edition: Option<InstallationEdition>,
    pub selected_installation_path: Option<PathBuf>,
    pub known_policy: KnownPolicyCompatibility,
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
pub struct KnownPolicyCompatibility {
    pub policy_version: String,
    pub dsh_version: String,
    pub dsh_commit: String,
    pub dsh_tag: String,
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
    selected_installation: Option<PathBuf>,
    requested_mode: ManagerMode,
    last_policy_version: Option<String>,
}

impl Default for ManagerSettings {
    fn default() -> Self {
        Self {
            selected_home: None,
            selected_installation: None,
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
    fn recovery_descriptors(&self) -> RecoveryDescriptorStore {
        RecoveryDescriptorStore::new(self.local_data.join("recovery-descriptors"))
    }

    fn ensure_no_pending_recovery(&self) -> Result<(), String> {
        let descriptors = self.recovery_descriptors();
        let mut pending = false;
        for entry in self.journal().list().map_err(|error| error.to_string())? {
            if matches!(entry.stage, TransitionStage::Committed) {
                continue;
            }
            match descriptors.load(entry.operation_id) {
                Ok(Some(_)) => pending = true,
                Ok(None) => {}
                Err(_) => {
                    return Err(
                        "a recovery record is damaged; manager actions are blocked for safety"
                            .to_owned(),
                    );
                }
            }
        }
        if pending {
            Err(
                "recover the interrupted DSH version change from Activity before continuing"
                    .to_owned(),
            )
        } else {
            Ok(())
        }
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

    fn installations(&self) -> Result<Vec<DetectedInstallation>, String> {
        #[cfg(windows)]
        {
            use crate::installed_dsh::WindowsInstallRegistry;
            InstalledDsh::discover(&WindowsInstallRegistry).map_err(|error| error.to_string())
        }
        #[cfg(not(windows))]
        {
            Ok(Vec::new())
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
        let settings = self.settings()?;
        let installations = self.installations()?;
        let selection =
            select_detected_installation(&installations, settings.selected_installation.as_deref());
        let installation_edition = selection.map(|choice| choice.edition.clone());
        let integrated_policy = matches!(installation_edition, Some(InstallationEdition::Policy));
        let installed = selection.map(|choice| choice.installed.clone());
        let (policy_version, requested_mode) = match (&installed, &home) {
            (Some(installation), Some(home))
                if !integrated_policy
                    && !SystemDesktopProcessProbe.is_running().unwrap_or(true) =>
            {
                let manager = ProfileModeManager::system(
                    catalog.clone(),
                    self.backup_store(),
                    self.journal(),
                    Duration::from_secs(120),
                );
                match manager.inspect_policy_version(installation, home) {
                    Ok(version) => {
                        let mode = if manager
                            .inspect_policy_enabled(home)
                            .unwrap_or(settings.requested_mode == ManagerMode::Policy)
                        {
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
            _ if integrated_policy => (None, ManagerMode::Policy),
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
        let compatible_policy = if integrated_policy {
            None
        } else {
            state.compatible_policy
        };
        let policy_compatible = !integrated_policy && state.policy_compatible;
        let unavailable_reason = if integrated_policy {
            Some("当前管理的是内置策略的整合版。切换官方模式请先选择已检测到的官方 DSH；整合版不能通过移除独立增强包变成官方版。".to_owned())
        } else if installed.is_none() && !installations.is_empty() {
            Some("请从检测到的安装中选择管理目标。".to_owned())
        } else if installed.is_none() {
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
            installations,
            installation_edition,
            selected_installation_path: settings.selected_installation,
            known_policy: serde_json::from_str(include_str!(
                "../../../../packages/policy-extension/compatibility.json"
            ))
            .map_err(|_| "built-in Policy compatibility declaration is invalid".to_owned())?,
            home,
            home_choice,
            mode: if integrated_policy {
                ManagerMode::Policy
            } else {
                state.mode
            },
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

fn select_detected_installation<'a>(
    choices: &'a [DetectedInstallation],
    selected_path: Option<&Path>,
) -> Option<&'a DetectedInstallation> {
    if let Some(path) = selected_path {
        return choices
            .iter()
            .find(|choice| same_path_or_value(&choice.installed.install_location, path));
    }
    let mut official = choices
        .iter()
        .filter(|choice| matches!(choice.edition, InstallationEdition::Official));
    match (official.next(), official.next()) {
        (Some(choice), None) => Some(choice),
        _ if choices.len() == 1 => choices.first(),
        _ => None,
    }
}

#[tauri::command]
pub async fn select_installation(
    path: String,
    services: State<'_, Arc<ManagerServices>>,
) -> Result<ManagerSnapshot, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || {
        services.ensure_no_pending_recovery()?;
        let choices = services.installations()?;
        let path = PathBuf::from(path);
        let choice = select_detected_installation(&choices, Some(&path))
            .ok_or_else(|| "所选安装已不可用，请重新检测本机 DSH。".to_owned())?;
        {
            let mut settings = services
                .settings
                .lock()
                .map_err(|_| "manager settings are unavailable".to_owned())?;
            settings.selected_installation = Some(choice.installed.install_location.clone());
            settings.requested_mode = ManagerMode::Official;
            settings.last_policy_version = None;
        }
        services.save_settings()?;
        services.snapshot()
    })
    .await
    .map_err(|_| "installation selection worker failed".to_owned())?
}

#[tauri::command]
pub async fn reset_installation_selection(
    services: State<'_, Arc<ManagerServices>>,
) -> Result<ManagerSnapshot, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || {
        services.ensure_no_pending_recovery()?;
        {
            let mut settings = services
                .settings
                .lock()
                .map_err(|_| "manager settings are unavailable".to_owned())?;
            settings.selected_installation = None;
            settings.requested_mode = ManagerMode::Official;
            settings.last_policy_version = None;
        }
        services.save_settings()?;
        services.snapshot()
    })
    .await
    .map_err(|_| "installation selection worker failed".to_owned())?
}

#[tauri::command]
pub async fn refresh_github_releases() -> Result<GithubReleaseIndex, String> {
    GithubReleasesClient::new()
        .map_err(|error| error.to_string())?
        .fetch()
        .await
        .map_err(|error| format!("无法读取 GitHub 发行版：{error}"))
}

fn github_release_url_allowed(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    let path = url.path();
    let source_commit = path.strip_prefix("/sdaniasdsd/DSH-Policy/tree/");
    (path.starts_with("/sdaniasdsd/DSH-Policy/releases/tag/policy-v")
        || path.starts_with("/sdaniasdsd/DSH-Policy/releases/download/policy-v")
        || source_commit.is_some_and(|commit| {
            commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit())
        }))
        && !path.contains('%')
        && !path.contains('\\')
}

#[tauri::command]
pub fn open_github_url(url: String) -> Result<(), String> {
    if !github_release_url_allowed(&url) {
        return Err(
            "只能打开 DSH-Policy 仓库中的发行版、安装包或已固定提交的源码链接。".to_owned(),
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let windows = std::env::var_os("WINDIR")
            .ok_or_else(|| "Windows directory is unavailable".to_owned())?;
        std::process::Command::new(PathBuf::from(windows).join("explorer.exe"))
            .arg(url)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| "无法打开系统浏览器。".to_owned())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("此管理器仅支持 Windows。".to_owned())
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
    services
        .journal()
        .list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|entry| {
            let recoverable = if matches!(entry.stage, TransitionStage::Committed) {
                false
            } else {
                services
                    .recovery_descriptors()
                    .load(entry.operation_id)
                    .map_err(|error| error.to_string())?
                    .is_some()
            };
            Ok(ActivityView {
                id: entry.operation_id.to_string(),
                action: "DSH manager transition".to_owned(),
                stage: format!("{:?}", entry.stage),
                updated_at: entry.updated_at,
                details: Some(format!("Operation {}", entry.operation_id)),
                recoverable,
            })
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityView {
    pub id: String,
    pub action: String,
    pub stage: String,
    pub updated_at: u64,
    pub details: Option<String>,
    pub recoverable: bool,
}

#[tauri::command]
pub async fn recover_transition(
    operation_id: String,
    services: State<'_, Arc<ManagerServices>>,
) -> Result<RecoveryCommandResult, String> {
    let services = Arc::clone(services.inner());
    tauri::async_runtime::spawn_blocking(move || recover_transition_inner(operation_id, &services))
        .await
        .map_err(|_| "recovery worker failed".to_owned())?
}

fn recover_transition_inner(
    operation_id: String,
    services: &ManagerServices,
) -> Result<RecoveryCommandResult, String> {
    if SystemDesktopProcessProbe
        .is_running()
        .map_err(|error| error.to_string())?
    {
        return Err("close DSH Desktop before recovering the previous version".to_owned());
    }
    let operation_id = Uuid::parse_str(&operation_id)
        .map_err(|_| "transition identifier is invalid".to_owned())?;
    let descriptors = services.recovery_descriptors();
    let descriptor = descriptors
        .load(operation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "this transition has no verified recovery record".to_owned())?;
    let stage = services
        .journal()
        .current(operation_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "this transition is no longer active".to_owned())?;
    if matches!(stage, TransitionStage::Committed) {
        return Err("this transition has already committed".to_owned());
    }
    let catalog = services.catalog()?;
    if catalog.catalog_revision < descriptor.catalog_revision
        || catalog.expires_at <= now_unix()
        || !catalog
            .desktop_releases
            .iter()
            .any(|release| release == &descriptor.previous_release)
    {
        return Err("the signed catalog no longer verifies this rollback release".to_owned());
    }
    let home = match services.resolve_home()? {
        HomeResolution::Selected { path, .. } => path,
        HomeResolution::ChoiceRequired { .. } => {
            return Err("select the original Harness home before recovery".to_owned());
        }
        HomeResolution::InspectionFailed { reason, .. } => return Err(reason),
    };
    if !same_path_or_value(&home, &descriptor.home) {
        return Err("the selected Harness home differs from the interrupted operation".to_owned());
    }
    if home.join("profiles/desktop/package.json.lock").exists() {
        return Err(
            "the desktop profile is busy; retry after its package operation finishes".to_owned(),
        );
    }
    if let Some(installed) = services.installed()? {
        if !same_path_or_value(
            &installed.install_location,
            &descriptor.installation_location,
        ) {
            return Err(
                "the installed DSH location differs from the interrupted operation".to_owned(),
            );
        }
    }
    let backup = services
        .backup_store()
        .list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|record| record.id == descriptor.backup_id)
        .ok_or_else(|| "the verified pre-upgrade backup is missing".to_owned())?;
    if !same_path_or_value(&backup.source_path, &home) {
        return Err("the recovery backup belongs to a different Harness home".to_owned());
    }
    let snapshot = RecoverySnapshot {
        operation_id,
        previous_release: descriptor.previous_release,
        backup,
        home,
        installation_location: descriptor.installation_location,
        requested_mode: descriptor.requested_mode,
        catalog: catalog.clone(),
    };
    let recovery = RecoveryManager::new(
        InstallerManager::system(services.local_data.join("installers"))
            .map_err(|error| error.to_string())?,
        services.backup_store(),
        services.journal(),
        Arc::new(WindowsInstalledDshVerifier),
    );
    let policy_version = catalog
        .policy_for(
            snapshot.previous_release.runtime_version.as_str(),
            snapshot.previous_release.runtime_commit.as_str(),
        )
        .filter(|_| snapshot.requested_mode == ManagerMode::Policy)
        .map(|policy| policy.version.clone());
    services.save_mode(snapshot.requested_mode, policy_version)?;
    recovery
        .recover(&snapshot)
        .map_err(|error| error.to_string())?;
    let _ = descriptors.remove(operation_id);
    Ok(RecoveryCommandResult { recovered: true })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCommandResult {
    pub recovered: bool,
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
    services.ensure_no_pending_recovery()?;
    let snapshot = services.snapshot()?;
    if matches!(
        snapshot.installation_edition,
        Some(InstallationEdition::Policy)
    ) {
        return Err(
            "策略独立包不能通过增删增强包切换官方模式，请选择官方 DSH 安装。".to_owned(),
        );
    }
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
        backup_id: result.backup.map(|backup| backup.id.to_string()),
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeCommandResult {
    pub mode: ManagerMode,
    pub changed: bool,
    pub backup_id: Option<String>,
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
    services.ensure_no_pending_recovery()?;
    let snapshot = services.snapshot()?;
    let installation = snapshot
        .installed
        .ok_or_else(|| "official DSH Desktop is not installed".to_owned())?;
    let home = snapshot
        .home
        .ok_or_else(|| "choose a Harness home before launching".to_owned())?;
    if matches!(
        snapshot.installation_edition,
        Some(InstallationEdition::Policy)
    ) {
        let process_id = DshLauncher::system()
            .launch_official_initialization(&installation, &home)
            .map_err(|error| error.to_string())?;
        return Ok(LaunchCommandResult {
            launched: true,
            process_id,
        });
    }
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
    services.ensure_no_pending_recovery()?;
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
    services.ensure_no_pending_recovery()?;
    let snapshot = services.snapshot()?;
    if matches!(
        snapshot.installation_edition,
        Some(InstallationEdition::Policy)
    ) {
        return Err(
            "当前选择的是策略独立包。官方安装事务只适用于官方 DSH，请先选择官方安装。".to_owned(),
        );
    }
    validate_official_upgrade_target(
        &snapshot.installations,
        snapshot.installed.as_ref(),
        snapshot.selected_installation_path.is_some(),
    )?;
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
    services
        .recovery_descriptors()
        .save(&RecoveryDescriptor {
            schema_version: 1,
            operation_id,
            previous_release: recovery_snapshot.previous_release.clone(),
            backup_id: recovery_snapshot.backup.id,
            home: recovery_snapshot.home.clone(),
            installation_location: recovery_snapshot.installation_location.clone(),
            requested_mode: recovery_snapshot.requested_mode,
            catalog_revision: catalog.catalog_revision,
        })
        .map_err(|error| format!("could not persist the rollback record: {error}"))?;
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
                let _ = services.recovery_descriptors().remove(operation_id);
                services.save_mode(snapshot.mode, snapshot.policy_version.clone())?;
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
            Ok(_) => {
                let _ = services.recovery_descriptors().remove(operation_id);
                services.save_mode(snapshot.mode, snapshot.policy_version.clone())?;
                Err(format!(
                    "profile update failed and the previous DSH release was restored: {mode_error}"
                ))
            }
            Err(recovery_error) => Err(format!(
                "profile update failed; recovery is required: {mode_error}; {recovery_error}"
            )),
        };
    }
    journal
        .advance(operation_id, TransitionStage::Verifying)
        .map_err(|error| error.to_string())?;
    let policy_version = if requested_mode == ManagerMode::Policy {
        catalog
            .policy_for(
                target.runtime_version.as_str(),
                target.runtime_commit.as_str(),
            )
            .map(|policy| policy.version.clone())
    } else {
        None
    };
    services.save_mode(requested_mode, policy_version)?;
    journal
        .advance(operation_id, TransitionStage::Committed)
        .map_err(|error| error.to_string())?;
    let _ = services.recovery_descriptors().remove(operation_id);
    Ok(InstallCommandResult {
        installed: true,
        backup_id: backup.id.to_string(),
        recovered: false,
    })
}

fn validate_official_upgrade_target(
    choices: &[DetectedInstallation],
    selected: Option<&InstalledDsh>,
    has_saved_target: bool,
) -> Result<(), String> {
    if choices
        .iter()
        .filter(|choice| matches!(choice.edition, InstallationEdition::Official))
        .count()
        > 1
    {
        return Err("检测到多个官方 DSH 安装。自动安装器不能保证升级所选路径，请保留当前安装并手动处理版本。".to_owned());
    }
    if selected.is_none() && (has_saved_target || !choices.is_empty()) {
        return Err("所选安装已失效或尚未选择目标，请在概览中重新选择或恢复自动选择。".to_owned());
    }
    Ok(())
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
    use super::{
        ManagerServices, github_release_url_allowed, select_detected_installation,
        validate_official_upgrade_target,
    };
    use crate::installed_dsh::{DetectedInstallation, InstallationEdition, InstalledDsh};
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    fn detected(path: &str, edition: InstallationEdition) -> DetectedInstallation {
        DetectedInstallation {
            display_name: path.to_owned(),
            edition,
            installed: InstalledDsh {
                install_location: PathBuf::from(path),
                desktop_version: "1.0.4".to_owned(),
                runtime_version: None,
                runtime_commit: None,
                build_dirty: false,
            },
        }
    }

    #[test]
    fn installed_target_defaults_to_the_unique_official_installation() {
        let choices = vec![
            detected("policy", InstallationEdition::Policy),
            detected("official", InstallationEdition::Official),
        ];
        assert_eq!(
            select_detected_installation(&choices, None)
                .unwrap()
                .installed
                .install_location,
            PathBuf::from("official")
        );
        assert_eq!(
            select_detected_installation(&choices, Some(Path::new("policy")))
                .unwrap()
                .edition,
            InstallationEdition::Policy
        );
    }

    #[test]
    fn ambiguous_or_missing_selected_installations_require_an_explicit_choice() {
        let choices = vec![
            detected("first", InstallationEdition::Official),
            detected("second", InstallationEdition::Official),
        ];
        assert!(select_detected_installation(&choices, None).is_none());
        assert!(select_detected_installation(&choices, Some(Path::new("removed"))).is_none());
        assert!(select_detected_installation(&[], None).is_none());
        assert!(
            select_detected_installation(&[detected("policy", InstallationEdition::Policy)], None)
                .is_some()
        );
    }

    #[test]
    fn release_links_cannot_open_another_repository_or_local_program() {
        assert!(github_release_url_allowed(
            "https://github.com/sdaniasdsd/DSH-Policy/releases/tag/policy-v1.0.4"
        ));
        assert!(github_release_url_allowed(
            "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v1.0.4/setup.exe"
        ));
        assert!(github_release_url_allowed(
            "https://github.com/sdaniasdsd/DSH-Policy/tree/d9d8a440a60980738ece2fbc5f766d4fb9511c81"
        ));
        for url in [
            "file:///C:/Windows/System32/cmd.exe",
            "https://github.com/other/repo/releases/tag/policy-v1.0.4",
            "https://github.com/sdaniasdsd/DSH-Policy/releases/tag/policy-v1.0.4?x=1",
            "https://github.com@attacker.example/sdaniasdsd/DSH-Policy/releases/tag/policy-v1.0.4",
            "https://github.com/sdaniasdsd/DSH-Policy/tree/main",
            "https://github.com/sdaniasdsd/DSH-Policy/tree/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/other",
        ] {
            assert!(!github_release_url_allowed(url), "{url}");
        }
    }

    #[test]
    fn stale_selection_and_multiple_official_installs_cannot_start_installation() {
        assert!(validate_official_upgrade_target(&[], None, true).is_err());
        assert!(validate_official_upgrade_target(&[], None, false).is_ok());
        let choices = vec![
            detected("first", InstallationEdition::Official),
            detected("second", InstallationEdition::Official),
        ];
        assert!(
            validate_official_upgrade_target(&choices, Some(&choices[0].installed), true).is_err()
        );
        assert!(
            validate_official_upgrade_target(&choices[..1], Some(&choices[0].installed), true)
                .is_ok()
        );
    }

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
