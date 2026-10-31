use crate::backup::{BackupError, BackupRecord, BackupStore};
use crate::catalog::{DesktopRelease, ReleaseCatalog};
use crate::installed_dsh::InstalledDsh;
use crate::installer::{InstallError, InstallerManager};
use crate::manager_state::{ManagerMode, ManagerState, ProfileSnapshot};
use crate::transaction::{JournalError, TransitionJournal, TransitionStage};
use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use uuid::Uuid;

const MAX_RECOVERY_DESCRIPTOR_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDescriptor {
    pub schema_version: u32,
    pub operation_id: Uuid,
    pub previous_release: DesktopRelease,
    pub backup_id: Uuid,
    pub home: PathBuf,
    pub installation_location: PathBuf,
    pub requested_mode: ManagerMode,
    pub catalog_revision: u64,
}

#[derive(Debug, Error)]
pub enum RecoveryDescriptorError {
    #[error("recovery descriptor I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("recovery descriptor is invalid or corrupted")]
    Corrupt,
}

pub struct RecoveryDescriptorStore {
    root: PathBuf,
}

impl RecoveryDescriptorStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn save(&self, descriptor: &RecoveryDescriptor) -> Result<(), RecoveryDescriptorError> {
        if descriptor.schema_version != 1
            || descriptor.operation_id.is_nil()
            || descriptor.backup_id.is_nil()
            || descriptor.catalog_revision == 0
        {
            return Err(RecoveryDescriptorError::Corrupt);
        }
        self.ensure_root()?;
        let target = self.path(descriptor.operation_id);
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(RecoveryDescriptorError::Corrupt),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let bytes = serde_json::to_vec(descriptor).map_err(|_| RecoveryDescriptorError::Corrupt)?;
        if bytes.len() as u64 > MAX_RECOVERY_DESCRIPTOR_BYTES {
            return Err(RecoveryDescriptorError::Corrupt);
        }
        let temp = self.root.join(format!(
            ".{}.{}.tmp",
            descriptor.operation_id,
            Uuid::new_v4()
        ));
        write_descriptor_synced(&temp, &bytes)?;
        if let Err(error) = fs::rename(&temp, &target) {
            let _ = fs::remove_file(&temp);
            return Err(error.into());
        }
        Ok(())
    }

    pub fn load(
        &self,
        operation_id: Uuid,
    ) -> Result<Option<RecoveryDescriptor>, RecoveryDescriptorError> {
        match fs::symlink_metadata(&self.root) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            _ => return Err(RecoveryDescriptorError::Corrupt),
        }
        let path = self.path(operation_id);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            _ => return Err(RecoveryDescriptorError::Corrupt),
        };
        if metadata.len() > MAX_RECOVERY_DESCRIPTOR_BYTES {
            return Err(RecoveryDescriptorError::Corrupt);
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        File::open(path)?
            .take(MAX_RECOVERY_DESCRIPTOR_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_RECOVERY_DESCRIPTOR_BYTES {
            return Err(RecoveryDescriptorError::Corrupt);
        }
        let descriptor: RecoveryDescriptor =
            serde_json::from_slice(&bytes).map_err(|_| RecoveryDescriptorError::Corrupt)?;
        if descriptor.schema_version != 1
            || descriptor.operation_id != operation_id
            || descriptor.backup_id.is_nil()
            || descriptor.catalog_revision == 0
        {
            return Err(RecoveryDescriptorError::Corrupt);
        }
        Ok(Some(descriptor))
    }

    pub fn remove(&self, operation_id: Uuid) -> Result<(), RecoveryDescriptorError> {
        match fs::symlink_metadata(&self.root) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            _ => return Err(RecoveryDescriptorError::Corrupt),
        }
        let path = self.path(operation_id);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                fs::remove_file(path)?;
                Ok(())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            _ => Err(RecoveryDescriptorError::Corrupt),
        }
    }

    fn path(&self, operation_id: Uuid) -> PathBuf {
        self.root.join(format!("{operation_id}.json"))
    }

    fn ensure_root(&self) -> Result<(), RecoveryDescriptorError> {
        match fs::symlink_metadata(&self.root) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
            Ok(_) => Err(RecoveryDescriptorError::Corrupt),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(&self.root)?;
                let metadata = fs::symlink_metadata(&self.root)?;
                if metadata.is_dir() && !metadata.file_type().is_symlink() {
                    Ok(())
                } else {
                    Err(RecoveryDescriptorError::Corrupt)
                }
            }
            Err(error) => Err(error.into()),
        }
    }
}

fn write_descriptor_synced(path: &Path, bytes: &[u8]) -> Result<(), RecoveryDescriptorError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

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
            for attempt in 0..32 {
                let preserved = if attempt == 0 {
                    preserved_home_path(home, operation_id)
                } else {
                    let base = preserved_home_path(home, operation_id);
                    let name = base
                        .file_name()
                        .map(|name| name.to_string_lossy())
                        .unwrap_or_else(|| "dsh-home-recovery".into());
                    base.with_file_name(format!("{name}-{}", Uuid::new_v4()))
                };
                match fs::symlink_metadata(&preserved) {
                    Ok(_) => continue,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(RecoveryError::Io(error)),
                }
                match fs::rename(home, &preserved) {
                    Ok(()) => return Ok(Some(preserved)),
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::AlreadyExists
                                | std::io::ErrorKind::DirectoryNotEmpty
                        ) =>
                    {
                        continue;
                    }
                    Err(error) => return Err(RecoveryError::Io(error)),
                }
            }
            Err(RecoveryError::Io(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "could not allocate a unique recovery copy path",
            )))
        }
        Ok(_) => Err(RecoveryError::UnsafeHome),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(RecoveryError::Io(error)),
    }
}
