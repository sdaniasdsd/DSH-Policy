use crate::backup::{BackupError, BackupRecord, BackupStore};
use crate::catalog::{PolicyRelease, ReleaseCatalog};
use crate::installed_dsh::InstalledDsh;
use crate::installer::{DesktopProcessProbe, SystemDesktopProcessProbe};
use crate::manager_state::ManagerMode;
use crate::policy_package::{
    GithubPolicyPackageFetcher, PolicyPackageFetcher, artifact_path, publish_staged_artifact,
    validate_policy_release,
};
use crate::recovery::preserved_home_path;
use crate::transaction::{JournalError, TransitionJournal, TransitionStage};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;
use uuid::Uuid;

const POLICY_PACKAGE: &str = "@deepseek-ai/dsh-policy-extension";
const MAX_CLI_OUTPUT: usize = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CliOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub timed_out: bool,
    pub truncated: bool,
}

pub trait DesktopCliRunner: Send + Sync {
    fn run(
        &self,
        installation: &InstalledDsh,
        home: &Path,
        args: &[String],
        timeout: Duration,
    ) -> Result<CliOutput, String>;
}

pub struct SystemDesktopCliRunner;

impl DesktopCliRunner for SystemDesktopCliRunner {
    fn run(
        &self,
        installation: &InstalledDsh,
        home: &Path,
        args: &[String],
        timeout: Duration,
    ) -> Result<CliOutput, String> {
        let executable = installation.install_location.join("DeepSeek Harness.exe");
        let archive = installation.install_location.join("resources/app.asar");
        let cli = installation
            .install_location
            .join("resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js");
        // The CLI script lives inside app.asar, so `cli.is_file()` would always be false.
        if !executable.is_file() || !archive.is_file() || !home.is_dir() {
            return Err("official DSH CLI files or selected home are missing".to_owned());
        }

        let mut command = Command::new(executable);
        command
            .arg("--expose-internals")
            .arg(cli)
            .args(args)
            .current_dir(home.join("profiles/desktop"))
            .env("ELECTRON_RUN_AS_NODE", "1")
            .env("DSH_HOME", home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = command
            .spawn()
            .map_err(|_| "could not start official DSH CLI".to_owned())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "could not read official DSH CLI output".to_owned())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "could not drain official DSH CLI errors".to_owned())?;
        let stdout_reader = thread::spawn(move || read_capped(stdout));
        let stderr_reader = thread::spawn(move || read_capped(stderr));
        let deadline = Instant::now() + timeout;
        let mut timed_out = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(25)),
                Ok(None) => {
                    timed_out = true;
                    kill_process_tree(child.id());
                    let _ = child.kill();
                    break child.wait().ok();
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("could not wait for official DSH CLI".to_owned());
                }
            }
        };
        let (stdout, stdout_truncated) = stdout_reader
            .join()
            .map_err(|_| "could not collect official DSH CLI output".to_owned())?;
        let (_, stderr_truncated) = stderr_reader
            .join()
            .map_err(|_| "could not drain official DSH CLI errors".to_owned())?;
        let _ = stderr_truncated;
        Ok(CliOutput {
            exit_code: status.and_then(|value| value.code()),
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            timed_out,
            truncated: stdout_truncated,
        })
    }
}

fn read_capped(mut reader: impl Read) -> (Vec<u8>, bool) {
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    let mut truncated = false;
    loop {
        let Ok(count) = reader.read(&mut buffer) else {
            break;
        };
        if count == 0 {
            break;
        }
        let remaining = MAX_CLI_OUTPUT.saturating_sub(bytes.len());
        let keep = remaining.min(count);
        bytes.extend_from_slice(&buffer[..keep]);
        truncated |= keep < count;
    }
    (bytes, truncated)
}

#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    let taskkill = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32/taskkill.exe");
    let _ = Command::new(taskkill)
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(windows))]
fn kill_process_tree(_pid: u32) {}

#[derive(Debug, Error)]
pub enum ModeChangeError {
    #[error("DSH runtime does not have an exact unexpired Policy compatibility mapping")]
    IncompatibleRuntime,
    #[error("the selected DSH home has no initialized desktop profile")]
    UninitializedProfile,
    #[error("the desktop profile is busy or has an unresolved package lock")]
    ProfileBusy,
    #[error("DSH Desktop is running; close it before changing mode")]
    DesktopRunning,
    #[error("official DSH CLI timed out")]
    TimedOut,
    #[error("official DSH CLI exited with status {0}")]
    CommandFailed(i32),
    #[error("official DSH CLI output was incomplete or could not be verified")]
    InvalidCommandOutput,
    #[error("official DSH CLI could not start: {0}")]
    ProcessStart(String),
    #[error("Policy extension package could not be downloaded or verified: {0}")]
    PackageDownload(String),
    #[error("DSH profile mode could not be verified after the package operation")]
    VerificationFailed,
    #[error("the profile could not be safely restored; manual recovery is required")]
    RecoveryRequired,
    #[error(transparent)]
    Backup(#[from] BackupError),
    #[error(transparent)]
    Journal(#[from] JournalError),
    #[error("mode transition filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug)]
pub struct ModeChangeResult {
    pub operation_id: Uuid,
    pub mode: ManagerMode,
    pub changed: bool,
    pub policy_version: Option<String>,
    pub backup: Option<BackupRecord>,
}

pub struct ProfileModeManager {
    catalog: ReleaseCatalog,
    backups: BackupStore,
    journal: TransitionJournal,
    runner: Arc<dyn DesktopCliRunner>,
    process_probe: Arc<dyn DesktopProcessProbe>,
    package_fetcher: Arc<dyn PolicyPackageFetcher>,
    timeout: Duration,
}

impl ProfileModeManager {
    pub fn new(
        catalog: ReleaseCatalog,
        backups: BackupStore,
        journal: TransitionJournal,
        runner: Arc<dyn DesktopCliRunner>,
        process_probe: Arc<dyn DesktopProcessProbe>,
        timeout: Duration,
    ) -> Self {
        Self {
            catalog,
            backups,
            journal,
            runner,
            process_probe,
            package_fetcher: Arc::new(GithubPolicyPackageFetcher),
            timeout,
        }
    }

    pub fn with_package_fetcher(mut self, fetcher: Arc<dyn PolicyPackageFetcher>) -> Self {
        self.package_fetcher = fetcher;
        self
    }

    pub fn system(
        catalog: ReleaseCatalog,
        backups: BackupStore,
        journal: TransitionJournal,
        timeout: Duration,
    ) -> Self {
        Self::new(
            catalog,
            backups,
            journal,
            Arc::new(SystemDesktopCliRunner),
            Arc::new(SystemDesktopProcessProbe),
            timeout,
        )
    }

    pub fn apply(
        &self,
        target: ManagerMode,
        installation: &InstalledDsh,
        home: &Path,
    ) -> Result<ModeChangeResult, ModeChangeError> {
        let policy = if target == ManagerMode::Policy {
            Some(
                self.compatible_policy(installation)
                    .ok_or(ModeChangeError::IncompatibleRuntime)?,
            )
        } else {
            None
        };
        let profile = home.join("profiles/desktop");
        let manifest = profile.join("package.json");
        if !manifest.is_file() {
            return Err(ModeChangeError::UninitializedProfile);
        }
        if profile.join("package.json.lock").exists() {
            return Err(ModeChangeError::ProfileBusy);
        }
        if self
            .process_probe
            .is_running()
            .map_err(ModeChangeError::ProcessStart)?
        {
            return Err(ModeChangeError::DesktopRunning);
        }

        let operation_id = Uuid::new_v4();
        let installed_package = self.list_policy(installation, home)?;
        let policy_selected = policy_bundle_enabled(&manifest)?;
        let desired_policy_version = policy.as_ref().map(|value| value.version.clone());
        let needs_change = match (&policy, &installed_package) {
            (Some(desired), Some(installed)) if installed == &desired.version => !policy_selected,
            (Some(_), Some(_)) => true,
            (Some(_), None) => true,
            (None, Some(_)) | (None, None) => policy_selected,
        };

        if !needs_change {
            return Ok(ModeChangeResult {
                operation_id,
                mode: target,
                changed: false,
                policy_version: desired_policy_version,
                backup: None,
            });
        }

        // When the exact package is already installed, mode changes only alter the
        // selected DSH bundle. This avoids pnpm add/remove and a full DSH_HOME backup.
        let can_toggle_in_place = match (&policy, &installed_package) {
            (Some(desired), Some(installed)) => installed == &desired.version,
            (None, _) => policy_selected,
            _ => false,
        };
        if can_toggle_in_place {
            set_policy_bundle_enabled(&manifest, target == ManagerMode::Policy)?;
            return Ok(ModeChangeResult {
                operation_id,
                mode: target,
                changed: true,
                policy_version: installed_package,
                backup: None,
            });
        }

        // Download and verify before touching the profile or creating its recovery point.
        let staged_package = if let Some(desired) = policy.as_ref() {
            let staging = std::env::temp_dir().join(format!(
                "dsh-policy-{}-{}.tgz",
                desired.version,
                Uuid::new_v4()
            ));
            if let Err(error) = self.package_fetcher.fetch(desired, &staging) {
                let _ = fs::remove_file(&staging);
                return Err(ModeChangeError::PackageDownload(error));
            }
            Some(staging)
        } else {
            None
        };

        // Publish or reuse the immutable, verified download before taking the full-home
        // recovery snapshot. A repeated install must not create a large backup only to
        // fail because the same signed artifact is already cached in the profile.
        if let (Some(desired), Some(staging)) = (policy.as_ref(), staged_package.as_ref()) {
            let destination = artifact_path(&profile, desired);
            if let Err(error) = publish_staged_artifact(staging, &destination, desired) {
                let _ = fs::remove_file(staging);
                return Err(ModeChangeError::PackageDownload(error.to_string()));
            }
        }

        let backup = match self.backups.create(home) {
            Ok(backup) => backup,
            Err(error) => {
                if let Some(staging) = &staged_package {
                    let _ = fs::remove_file(staging);
                }
                return Err(error.into());
            }
        };
        self.journal
            .advance(operation_id, TransitionStage::Prepared)?;
        self.journal
            .advance(operation_id, TransitionStage::BackedUp)?;

        self.journal
            .advance(operation_id, TransitionStage::ProfileUpdating)?;
        let mutation_args = match policy.as_ref() {
            Some(desired) => {
                let artifact = artifact_path(&profile, desired);
                let filename = artifact
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or(ModeChangeError::InvalidCommandOutput)?;
                vec![
                    "plugin".into(),
                    "--profile".into(),
                    "desktop".into(),
                    "add".into(),
                    format!("file:.dsh-policy-artifacts/{filename}"),
                    "--save-exact".into(),
                ]
            }
            None => vec![
                "plugin".into(),
                "--profile".into(),
                "desktop".into(),
                "remove".into(),
                POLICY_PACKAGE.into(),
            ],
        };
        let mutation_error = match self.run(installation, home, &mutation_args) {
            Ok(()) => None,
            Err(error) => Some(error),
        };

        if let Some(error) = mutation_error {
            self.rollback(operation_id, home, &backup)?;
            return Err(error);
        }

        self.journal
            .advance(operation_id, TransitionStage::Verifying)?;
        let verification = self.list_policy(installation, home);
        let verified = match (&policy, verification) {
            (Some(desired), Ok(Some(version))) => version == desired.version,
            (Some(_), _) => false,
            (None, Ok(None)) => true,
            (None, _) => false,
        };
        if !verified {
            self.rollback(operation_id, home, &backup)?;
            return Err(ModeChangeError::VerificationFailed);
        }
        if let Some(desired) = policy.as_ref() {
            if !verify_installed_package(&profile, desired) {
                self.rollback(operation_id, home, &backup)?;
                return Err(ModeChangeError::VerificationFailed);
            }
        }
        self.journal
            .advance(operation_id, TransitionStage::Committed)?;
        Ok(ModeChangeResult {
            operation_id,
            mode: target,
            changed: true,
            policy_version: desired_policy_version,
            backup: Some(backup),
        })
    }

    pub fn journal_stage(
        &self,
        operation_id: Uuid,
    ) -> Result<Option<TransitionStage>, JournalError> {
        self.journal.current(operation_id)
    }

    pub fn inspect_policy_version(
        &self,
        installation: &InstalledDsh,
        home: &Path,
    ) -> Result<Option<String>, ModeChangeError> {
        let profile = home.join("profiles/desktop");
        if !profile.join("package.json").is_file() {
            return Err(ModeChangeError::UninitializedProfile);
        }
        if profile.join("package.json.lock").exists() {
            return Err(ModeChangeError::ProfileBusy);
        }
        self.list_policy(installation, home)
    }

    pub fn inspect_policy_enabled(&self, home: &Path) -> Result<bool, ModeChangeError> {
        let manifest = home.join("profiles/desktop/package.json");
        if !manifest.is_file() {
            return Err(ModeChangeError::UninitializedProfile);
        }
        if manifest.with_file_name("package.json.lock").exists() {
            return Err(ModeChangeError::ProfileBusy);
        }
        policy_bundle_enabled(&manifest)
    }

    fn compatible_policy(&self, installation: &InstalledDsh) -> Option<PolicyRelease> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs();
        if self.catalog.expires_at <= now || installation.build_dirty {
            return None;
        }
        let policy = self.catalog.policy_for(
            installation.runtime_version.as_deref()?,
            installation.runtime_commit.as_deref()?,
        )?;
        if !safe_policy_version(&policy.version) || !validate_policy_release(policy) {
            return None;
        }
        Some(policy.clone())
    }

    fn list_policy(
        &self,
        installation: &InstalledDsh,
        home: &Path,
    ) -> Result<Option<String>, ModeChangeError> {
        let args = vec![
            "plugin".into(),
            "--profile".into(),
            "desktop".into(),
            "list".into(),
            "--json".into(),
            "--depth=0".into(),
        ];
        let output = self
            .runner
            .run(installation, home, &args, self.timeout)
            .map_err(ModeChangeError::ProcessStart)?;
        if output.timed_out {
            return Err(ModeChangeError::TimedOut);
        }
        if output.exit_code != Some(0) {
            return Err(ModeChangeError::CommandFailed(
                output.exit_code.unwrap_or(-1),
            ));
        }
        if output.truncated {
            return Err(ModeChangeError::InvalidCommandOutput);
        }
        parse_policy_version(&output.stdout)
    }

    fn run(
        &self,
        installation: &InstalledDsh,
        home: &Path,
        args: &[String],
    ) -> Result<(), ModeChangeError> {
        let output = self
            .runner
            .run(installation, home, args, self.timeout)
            .map_err(ModeChangeError::ProcessStart)?;
        if output.timed_out {
            return Err(ModeChangeError::TimedOut);
        }
        if output.exit_code != Some(0) {
            return Err(ModeChangeError::CommandFailed(
                output.exit_code.unwrap_or(-1),
            ));
        }
        Ok(())
    }

    fn rollback(
        &self,
        operation_id: Uuid,
        home: &Path,
        backup: &BackupRecord,
    ) -> Result<(), ModeChangeError> {
        self.journal
            .advance(operation_id, TransitionStage::Recovering)?;
        if home.join("profiles/desktop/package.json.lock").exists() {
            self.journal
                .advance(operation_id, TransitionStage::RecoveryRequired)?;
            return Err(ModeChangeError::RecoveryRequired);
        }
        let preserved = preserved_home_path(home, operation_id);
        match fs::symlink_metadata(&preserved) {
            Ok(_) => {
                self.journal
                    .advance(operation_id, TransitionStage::RecoveryRequired)?;
                return Err(ModeChangeError::RecoveryRequired);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ModeChangeError::Io(error)),
        }
        match fs::symlink_metadata(home) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                fs::rename(home, &preserved)?
            }
            Ok(_) => {
                self.journal
                    .advance(operation_id, TransitionStage::RecoveryRequired)?;
                return Err(ModeChangeError::RecoveryRequired);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(ModeChangeError::Io(error)),
        }
        if let Err(error) = self.backups.restore(backup, home) {
            if preserved.exists() && !home.exists() {
                let _ = fs::rename(&preserved, home);
            }
            self.journal
                .advance(operation_id, TransitionStage::RecoveryRequired)?;
            return Err(ModeChangeError::Backup(error));
        }
        self.journal
            .advance(operation_id, TransitionStage::Committed)?;
        Ok(())
    }
}

fn policy_bundle_enabled(manifest: &Path) -> Result<bool, ModeChangeError> {
    let metadata = fs::symlink_metadata(manifest)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(ModeChangeError::InvalidCommandOutput);
    }
    let bytes = fs::read(manifest)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| ModeChangeError::InvalidCommandOutput)?;
    let bundles = value
        .get("dsh")
        .and_then(Value::as_object)
        .and_then(|dsh| dsh.get("profile"))
        .and_then(Value::as_object)
        .and_then(|profile| profile.get("bundles"));
    let Some(bundles) = bundles else {
        return Ok(false);
    };
    let bundles = bundles
        .as_array()
        .ok_or(ModeChangeError::InvalidCommandOutput)?;
    Ok(bundles
        .iter()
        .any(|bundle| bundle.as_str() == Some(POLICY_PACKAGE)))
}

fn set_policy_bundle_enabled(manifest: &Path, enabled: bool) -> Result<bool, ModeChangeError> {
    let metadata = fs::symlink_metadata(manifest)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(ModeChangeError::InvalidCommandOutput);
    }
    let bytes = fs::read(manifest)?;
    let mut value: Value =
        serde_json::from_slice(&bytes).map_err(|_| ModeChangeError::InvalidCommandOutput)?;
    let root = value
        .as_object_mut()
        .ok_or(ModeChangeError::InvalidCommandOutput)?;
    let dsh = root
        .entry("dsh")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or(ModeChangeError::InvalidCommandOutput)?;
    let profile = dsh
        .entry("profile")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or(ModeChangeError::InvalidCommandOutput)?;
    let bundles = profile
        .entry("bundles")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or(ModeChangeError::InvalidCommandOutput)?;
    let selected = bundles
        .iter()
        .any(|bundle| bundle.as_str() == Some(POLICY_PACKAGE));
    if selected == enabled {
        return Ok(false);
    }
    if enabled {
        bundles.push(Value::String(POLICY_PACKAGE.to_owned()));
    } else {
        bundles.retain(|bundle| bundle.as_str() != Some(POLICY_PACKAGE));
    }

    let mut serialized =
        serde_json::to_vec_pretty(&value).map_err(|_| ModeChangeError::InvalidCommandOutput)?;
    serialized.push(b'\n');
    let parent = manifest
        .parent()
        .ok_or(ModeChangeError::InvalidCommandOutput)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    staged.write_all(&serialized)?;
    staged.as_file().sync_all()?;
    staged
        .persist(manifest)
        .map_err(|error| ModeChangeError::Io(error.error))?;
    Ok(true)
}

fn safe_policy_version(value: &str) -> bool {
    !value.is_empty()
        && value.as_bytes()[0].is_ascii_digit()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
}

fn verify_installed_package(profile: &Path, release: &PolicyRelease) -> bool {
    let package_dir = profile.join("node_modules/@deepseek-ai/dsh-policy-extension");
    let Ok(resolved) = package_dir.canonicalize() else {
        return false;
    };
    let Ok(node_modules) = profile.join("node_modules").canonicalize() else {
        return false;
    };
    if !resolved.starts_with(&node_modules) {
        return false;
    }
    let Ok(package_bytes) = fs::read(resolved.join("package.json")) else {
        return false;
    };
    let Ok(package) = serde_json::from_slice::<Value>(&package_bytes) else {
        return false;
    };
    let package_matches = package.get("name").and_then(Value::as_str) == Some(POLICY_PACKAGE)
        && package.get("version").and_then(Value::as_str) == Some(release.version.as_str())
        && package.pointer("/engines/dsh").and_then(Value::as_str)
            == Some(release.runtime_version.as_str());
    if !package_matches {
        return false;
    }
    let Ok(compatibility_bytes) = fs::read(resolved.join("compatibility.json")) else {
        return false;
    };
    let Ok(compatibility) = serde_json::from_slice::<Value>(&compatibility_bytes) else {
        return false;
    };
    compatibility.get("policyVersion").and_then(Value::as_str) == Some(release.version.as_str())
        && compatibility.get("dshVersion").and_then(Value::as_str)
            == Some(release.runtime_version.as_str())
        && compatibility
            .get("runtimeBuildCommit")
            .and_then(Value::as_str)
            == Some(release.runtime_commit.as_str())
}

fn parse_policy_version(output: &str) -> Result<Option<String>, ModeChangeError> {
    let start = output
        .find(['[', '{'])
        .ok_or(ModeChangeError::InvalidCommandOutput)?;
    let value: Value = serde_json::from_str(&output[start..])
        .map_err(|_| ModeChangeError::InvalidCommandOutput)?;
    let mut found: Option<String> = None;
    let profiles = match &value {
        Value::Array(values) => values.as_slice(),
        Value::Object(_) => std::slice::from_ref(&value),
        _ => return Err(ModeChangeError::InvalidCommandOutput),
    };
    for profile in profiles {
        let Some(dependencies) = profile.get("dependencies").and_then(Value::as_object) else {
            continue;
        };
        if let Some(package) = dependencies.get(POLICY_PACKAGE) {
            let version = package
                .as_str()
                .or_else(|| package.get("version").and_then(Value::as_str))
                .ok_or(ModeChangeError::InvalidCommandOutput)?
                .to_owned();
            if found.replace(version).is_some() {
                return Err(ModeChangeError::InvalidCommandOutput);
            }
        }
    }
    Ok(found)
}
