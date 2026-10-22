use crate::backup::{BackupError, BackupRecord, BackupStore};
use crate::catalog::{DesktopRelease, ReleaseCatalog};
use crate::installed_dsh::InstalledDsh;
use crate::installer::{InstallError, InstallerManager};
use crate::manager_state::{ManagerMode, ManagerState, ProfileSnapshot};
use crate::transaction::{JournalError, TransitionJournal, TransitionStage};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone)]
pub struct RecoverySnapshot {
    pub operation_id: Uuid,
    pub previous_release: DesktopRelease,
    pub backup: BackupRecord,
    pub home: PathBuf,
    pub installation_location: PathBuf,
    pub requested_mode: ManagerMode,
    pub catalog: ReleaseCatalog,
}

#[derive(Debug, Error)]
pub enum RecoveryError {
    #[error("recovery snapshot does not exactly match the verified release catalog")]
    UntrustedSnapshot,
    #[error("there is no recoverable active transition")]
    NoActiveOperation,
    #[error("installed Desktop does not match the release being recovered")]
    RuntimeMismatch,
    #[error("could not verify the recovered Desktop installation: {0}")]
    Verify(String),
    #[error(transparent)]
    Install(#[from] InstallError),
    #[error(transparent)]
    Backup(#[from] BackupError),
    #[error(transparent)]
    Journal(#[from] JournalError),
    #[error("recovery filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("recovery destination is not a regular directory")]
    UnsafeHome,
}

pub struct RecoveryManager {
    installers: InstallerManager,
    backups: BackupStore,
    journal: TransitionJournal,
    verifier: Arc<dyn InstalledDshVerifier>,
}

pub trait InstalledDshVerifier: Send + Sync {
    fn detect(&self) -> Result<Option<InstalledDsh>, String>;
}

pub struct WindowsInstalledDshVerifier;

#[cfg(windows)]
impl InstalledDshVerifier for WindowsInstalledDshVerifier {
    fn detect(&self) -> Result<Option<InstalledDsh>, String> {
        use crate::installed_dsh::WindowsInstallRegistry;
        InstalledDsh::detect(&WindowsInstallRegistry).map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
impl InstalledDshVerifier for WindowsInstalledDshVerifier {
    fn detect(&self) -> Result<Option<InstalledDsh>, String> {
        Err("Windows registry verification is only available on Windows".to_owned())
    }
}

impl RecoveryManager {
    pub fn new(
        installers: InstallerManager,
        backups: BackupStore,
        journal: TransitionJournal,
        verifier: Arc<dyn InstalledDshVerifier>,
    ) -> Self {
        Self {
            installers,
            backups,
            journal,
            verifier,
        }
    }

    pub fn journal_stage(
        &self,
        operation_id: Uuid,
    ) -> Result<Option<TransitionStage>, JournalError> {
        self.journal.current(operation_id)
    }

    pub fn recover(&self, snapshot: &RecoverySnapshot) -> Result<ManagerState, RecoveryError> {
        if !snapshot
            .catalog
            .desktop_releases
            .iter()
            .any(|release| release == &snapshot.previous_release)
        {
            return Err(RecoveryError::UntrustedSnapshot);
        }
        if SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|now| snapshot.catalog.expires_at <= now.as_secs())
            .unwrap_or(true)
        {
            return Err(RecoveryError::UntrustedSnapshot);
        }
        match self.journal.current(snapshot.operation_id)? {
            Some(TransitionStage::Committed) | None => {
                return Err(RecoveryError::NoActiveOperation);
            }
            Some(_) => {}
        }
        self.journal
            .advance(snapshot.operation_id, TransitionStage::Recovering)?;

        let installer = match self.installers.stage(&snapshot.previous_release) {
            Ok(installer) => installer,
            Err(error) => return self.fail(snapshot.operation_id, RecoveryError::Install(error)),
        };
        if let Err(error) = self.installers.install(&installer) {
            return self.fail(snapshot.operation_id, RecoveryError::Install(error));
        }
        let installed = match self.verifier.detect() {
            Ok(Some(installed)) => installed,
            Ok(None) => return self.fail(snapshot.operation_id, RecoveryError::RuntimeMismatch),
            Err(error) => return self.fail(snapshot.operation_id, RecoveryError::Verify(error)),
        };
        if installed.desktop_version != snapshot.previous_release.desktop_version
            || installed.runtime_version.as_deref()
                != Some(snapshot.previous_release.runtime_version.as_str())
            || installed.runtime_commit.as_deref()
                != Some(snapshot.previous_release.runtime_commit.as_str())
            || installed.build_dirty
            || !same_path(&installed.install_location, &snapshot.installation_location)
        {
            return self.fail(snapshot.operation_id, RecoveryError::RuntimeMismatch);
        }

        let preserved = match preserve_existing_home(&snapshot.home, snapshot.operation_id) {
            Ok(path) => path,
            Err(error) => return self.fail(snapshot.operation_id, error),
        };
        if let Err(error) = self.backups.restore(&snapshot.backup, &snapshot.home) {
            if let Some(preserved) = &preserved {
                if !snapshot.home.exists() {
                    let _ = fs::rename(preserved, &snapshot.home);
                }
            }
            return self.fail(snapshot.operation_id, RecoveryError::Backup(error));
        }

        if let Err(error) = self
            .journal
            .advance(snapshot.operation_id, TransitionStage::Committed)
        {
            return self.fail(snapshot.operation_id, RecoveryError::Journal(error));
        }
        Ok(ManagerState::inspect(
            Some(installed),
            snapshot.home.clone(),
            ProfileSnapshot {
                mode: snapshot.requested_mode,
            },
            &snapshot.catalog,
        ))
    }

    fn fail<T>(&self, operation_id: Uuid, error: RecoveryError) -> Result<T, RecoveryError> {
        match self.journal.current(operation_id)? {
            Some(TransitionStage::RecoveryRequired) => {}
            Some(_) => self
                .journal
                .advance(operation_id, TransitionStage::RecoveryRequired)?,
            None => return Err(RecoveryError::NoActiveOperation),
        }
        Err(error)
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()),
        _ => false,
    }
}

pub fn preserved_home_path(home: &Path, operation_id: Uuid) -> PathBuf {
    let parent = home
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let base = home
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| "dsh-home".into());
    parent.join(format!(".{base}.recovery-{operation_id}"))
}

fn preserve_existing_home(
    home: &Path,
    operation_id: Uuid,
) -> Result<Option<PathBuf>, RecoveryError> {
    match fs::symlink_metadata(home) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            let preserved = preserved_home_path(home, operation_id);
            fs::rename(home, &preserved)?;
            Ok(Some(preserved))
        }
        Ok(_) => Err(RecoveryError::UnsafeHome),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(RecoveryError::Io(error)),
    }
}
