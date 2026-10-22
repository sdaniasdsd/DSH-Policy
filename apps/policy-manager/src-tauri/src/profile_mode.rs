use crate::backup::{BackupError, BackupRecord, BackupStore};
use crate::catalog::{PolicyRelease, ReleaseCatalog};
use crate::installed_dsh::InstalledDsh;
use crate::installer::{DesktopProcessProbe, SystemDesktopProcessProbe};
use crate::manager_state::ManagerMode;
use crate::recovery::preserved_home_path;
use crate::transaction::{JournalError, TransitionJournal, TransitionStage};
use serde_json::Value;
use std::fs;
use std::io::Read;
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
    pub backup: BackupRecord,
}

pub struct ProfileModeManager {
    catalog: ReleaseCatalog,
    backups: BackupStore,
    journal: TransitionJournal,
    runner: Arc<dyn DesktopCliRunner>,
    process_probe: Arc<dyn DesktopProcessProbe>,
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
            timeout,
        }
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

        let backup = self.backups.create(home)?;
        let operation_id = Uuid::new_v4();
        self.journal
            .advance(operation_id, TransitionStage::Prepared)?;
        self.journal
            .advance(operation_id, TransitionStage::BackedUp)?;

        let installed_package = match self.list_policy(installation, home) {
            Ok(version) => version,
            Err(error) => {
                self.journal
                    .advance(operation_id, TransitionStage::Verifying)?;
                self.journal
                    .advance(operation_id, TransitionStage::Committed)?;
                return Err(error);
            }
        };
        let desired_policy_version = policy.as_ref().map(|value| value.version.clone());
        let needs_change = match (&policy, &installed_package) {
            (Some(desired), Some(installed)) => installed != &desired.version,
            (Some(_), None) => true,
            (None, Some(_)) => true,
            (None, None) => false,
        };

        if !needs_change {
            self.journal
                .advance(operation_id, TransitionStage::Verifying)?;
            self.journal
                .advance(operation_id, TransitionStage::Committed)?;
            return Ok(ModeChangeResult {
                operation_id,
                mode: target,
                changed: false,
                policy_version: desired_policy_version,
                backup,
            });
        }

        self.journal
            .advance(operation_id, TransitionStage::ProfileUpdating)?;
        let mutation_args = match policy.as_ref() {
            Some(desired) => vec![
                "plugin".into(),
                "--profile".into(),
                "desktop".into(),
                "add".into(),
                format!("{}@{}", POLICY_PACKAGE, desired.version),
                "--save-exact".into(),
            ],
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
        self.journal
            .advance(operation_id, TransitionStage::Committed)?;
        Ok(ModeChangeResult {
            operation_id,
            mode: target,
            changed: true,
            policy_version: desired_policy_version,
            backup,
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
        if !safe_policy_version(&policy.version) {
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

fn safe_policy_version(value: &str) -> bool {
    !value.is_empty()
        && value.as_bytes()[0].is_ascii_digit()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
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
