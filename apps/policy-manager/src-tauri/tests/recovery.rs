use dsh_policy_manager_lib::backup::{BackupStore, DataProtector};
use dsh_policy_manager_lib::catalog::{DesktopRelease, ReleaseCatalog};
use dsh_policy_manager_lib::installed_dsh::InstalledDsh;
use dsh_policy_manager_lib::installer::{
    DesktopProcessProbe, InstallerDownloader, InstallerExecutor, InstallerManager,
};
use dsh_policy_manager_lib::manager_state::ManagerMode;
use dsh_policy_manager_lib::recovery::{
    InstalledDshVerifier, RecoveryError, RecoveryManager, RecoverySnapshot, preserved_home_path,
};
use dsh_policy_manager_lib::transaction::{TransitionJournal, TransitionStage};
use sha2::{Digest, Sha256};
use std::fs::{File, create_dir_all, read, write};
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tempfile::tempdir;
use uuid::Uuid;

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn release(version: &str, bytes: &[u8]) -> DesktopRelease {
    DesktopRelease {
        os: "windows".into(),
        architecture: "x86_64".into(),
        desktop_version: "1.0.2".into(),
        runtime_version: version.into(),
        runtime_commit: "0123456789abcdef0123456789abcdef01234567".into(),
        installer_url: format!("https://download.deepseek.com/desktop/dsh-{version}.exe"),
        sha256: digest(bytes),
        installer_profile: "nsis".into(),
        policies: vec![],
    }
}

struct Protector;
impl DataProtector for Protector {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(plaintext.to_vec())
    }
    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(ciphertext.to_vec())
    }
}

struct Downloader {
    bytes: Vec<u8>,
    calls: Mutex<usize>,
}
impl InstallerDownloader for Downloader {
    fn download(&self, _url: &str, destination: &Path, _limit: u64) -> Result<(), String> {
        *self.calls.lock().unwrap() += 1;
        let mut file = File::create(destination).map_err(|error| error.to_string())?;
        file.write_all(&self.bytes)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())
    }
}

struct Probe;
impl DesktopProcessProbe for Probe {
    fn is_running(&self) -> Result<bool, String> {
        Ok(false)
    }
}

struct Executor {
    outcomes: Mutex<Vec<Result<(), String>>>,
}

struct Verifier(InstalledDsh);
impl InstalledDshVerifier for Verifier {
    fn detect(&self) -> Result<Option<InstalledDsh>, String> {
        Ok(Some(self.0.clone()))
    }
}

fn verifier(release: &DesktopRelease, location: &Path) -> Arc<Verifier> {
    Arc::new(Verifier(InstalledDsh {
        install_location: location.to_path_buf(),
        desktop_version: release.desktop_version.clone(),
        runtime_version: Some(release.runtime_version.clone()),
        runtime_commit: Some(release.runtime_commit.clone()),
        build_dirty: false,
    }))
}
impl InstallerExecutor for Executor {
    fn execute(&self, _path: &Path, _args: &[&str]) -> Result<(), String> {
        let mut outcomes = self.outcomes.lock().unwrap();
        if outcomes.is_empty() {
            return Ok(());
        }
        outcomes.remove(0)
    }
}

fn catalog(release: DesktopRelease) -> ReleaseCatalog {
    ReleaseCatalog {
        schema_version: 1,
        catalog_revision: 1,
        expires_at: u64::MAX,
        desktop_releases: vec![release],
    }
}

#[test]
fn rollback_redownloads_a_missing_cached_installer_then_restores_the_backup() {
    let temp = tempdir().unwrap();
    let old_bytes = b"previous installer";
    let previous = release("0.2.1-rc.2", old_bytes);
    let home = temp.path().join(".dsh");
    create_dir_all(&home).unwrap();
    write(home.join("settings.json"), b"before").unwrap();
    let backups = BackupStore::with_protector(temp.path().join("backups"), Arc::new(Protector));
    let backup = backups.create(&home).unwrap();
    write(home.join("settings.json"), b"broken after failed update").unwrap();
    let downloader = Arc::new(Downloader {
        bytes: old_bytes.to_vec(),
        calls: Mutex::new(0),
    });
    let executor = Arc::new(Executor {
        outcomes: Mutex::new(vec![Err("new installer failed".into()), Ok(())]),
    });
    let installer = InstallerManager::new(
        temp.path().join("cache"),
        downloader.clone(),
        executor.clone(),
        Arc::new(Probe),
    );
    let journal = TransitionJournal::new(temp.path().join("journal"));
    let operation = Uuid::new_v4();
    let installation_location = temp.path().join("DeepSeek Harness");
    create_dir_all(&installation_location).unwrap();
    journal
        .advance(operation, TransitionStage::Prepared)
        .unwrap();
    journal
        .advance(operation, TransitionStage::BackedUp)
        .unwrap();
    journal
        .advance(operation, TransitionStage::Installing)
        .unwrap();
    let new_bytes = b"attempted update installer";
    let attempted_installer = InstallerManager::new(
        temp.path().join("attempted-cache"),
        Arc::new(Downloader {
            bytes: new_bytes.to_vec(),
            calls: Mutex::new(0),
        }),
        executor,
        Arc::new(Probe),
    );
    let attempted = attempted_installer
        .stage(&release("0.2.2", new_bytes))
        .unwrap();
    assert!(attempted_installer.install(&attempted).is_err());
    let manager = RecoveryManager::new(
        installer,
        backups,
        journal,
        verifier(&previous, &installation_location),
    );

    let state = manager
        .recover(&RecoverySnapshot {
            operation_id: operation,
            previous_release: previous.clone(),
            backup,
            home: home.clone(),
            installation_location,
            requested_mode: ManagerMode::Official,
            catalog: catalog(previous),
        })
        .unwrap();

    assert_eq!(*downloader.calls.lock().unwrap(), 1);
    assert_eq!(read(home.join("settings.json")).unwrap(), b"before");
    assert!(state.installed.is_some());
    assert_eq!(
        state.installed.unwrap().runtime_version.as_deref(),
        Some("0.2.1-rc.2")
    );
    assert_eq!(state.mode, ManagerMode::Official);
    assert_eq!(std::fs::read_dir(temp.path()).unwrap().count() > 0, true);
}

#[test]
fn retrying_recovery_preserves_home_when_the_previous_attempt_left_a_recovery_copy() {
    let temp = tempdir().unwrap();
    let previous = release("0.2.1-rc.2", b"previous installer");
    let home = temp.path().join(".dsh");
    create_dir_all(&home).unwrap();
    write(home.join("settings.json"), b"backup state").unwrap();
    let backups = BackupStore::with_protector(temp.path().join("backups"), Arc::new(Protector));
    let backup = backups.create(&home).unwrap();

    let operation = Uuid::new_v4();
    let preserved = preserved_home_path(&home, operation);
    create_dir_all(&preserved).unwrap();
    write(preserved.join("settings.json"), b"previous attempt's copy").unwrap();
    write(home.join("settings.json"), b"current state after crash").unwrap();

    let downloader = Arc::new(Downloader {
        bytes: b"previous installer".to_vec(),
        calls: Mutex::new(0),
    });
    let installer = InstallerManager::new(
        temp.path().join("cache"),
        downloader,
        Arc::new(Executor {
            outcomes: Mutex::new(vec![Ok(())]),
        }),
        Arc::new(Probe),
    );
    let journal = TransitionJournal::new(temp.path().join("journal"));
    journal
        .advance(operation, TransitionStage::Prepared)
        .unwrap();
    journal
        .advance(operation, TransitionStage::BackedUp)
        .unwrap();
    journal
        .advance(operation, TransitionStage::Installing)
        .unwrap();
    journal
        .advance(operation, TransitionStage::Recovering)
        .unwrap();
    journal
        .advance(operation, TransitionStage::RecoveryRequired)
        .unwrap();
    let installation_location = temp.path().join("DeepSeek Harness");
    create_dir_all(&installation_location).unwrap();
    let manager = RecoveryManager::new(
        installer,
        backups,
        journal,
        verifier(&previous, &installation_location),
    );

    manager
        .recover(&RecoverySnapshot {
            operation_id: operation,
            previous_release: previous.clone(),
            backup,
            home: home.clone(),
            installation_location,
            requested_mode: ManagerMode::Official,
            catalog: catalog(previous),
        })
        .unwrap();

    assert_eq!(read(home.join("settings.json")).unwrap(), b"backup state");
    assert_eq!(
        read(preserved.join("settings.json")).unwrap(),
        b"previous attempt's copy"
    );
    assert_eq!(
        manager.journal_stage(operation).unwrap(),
        Some(TransitionStage::Committed)
    );
}

#[test]
fn failed_rollback_keeps_backup_and_records_recovery_required() {
    let temp = tempdir().unwrap();
    let previous = release("0.2.1-rc.2", b"previous installer");
    let home = temp.path().join(".dsh");
    create_dir_all(&home).unwrap();
    write(home.join("settings.json"), b"before").unwrap();
    let backups = BackupStore::with_protector(temp.path().join("backups"), Arc::new(Protector));
    let backup = backups.create(&home).unwrap();
    let downloader = Arc::new(Downloader {
        bytes: b"previous installer".to_vec(),
        calls: Mutex::new(0),
    });
    let executor = Arc::new(Executor {
        outcomes: Mutex::new(vec![Err("installer failed".into())]),
    });
    let installer = InstallerManager::new(
        temp.path().join("cache"),
        downloader,
        executor,
        Arc::new(Probe),
    );
    let journal = TransitionJournal::new(temp.path().join("journal"));
    let operation = Uuid::new_v4();
    let installation_location = temp.path().join("DeepSeek Harness");
    create_dir_all(&installation_location).unwrap();
    journal
        .advance(operation, TransitionStage::Prepared)
        .unwrap();
    journal
        .advance(operation, TransitionStage::BackedUp)
        .unwrap();
    journal
        .advance(operation, TransitionStage::Installing)
        .unwrap();
    let manager = RecoveryManager::new(
        installer,
        backups,
        journal,
        verifier(&previous, &installation_location),
    );

    assert!(matches!(
        manager.recover(&RecoverySnapshot {
            operation_id: operation,
            previous_release: previous.clone(),
            backup: backup.clone(),
            home,
            installation_location,
            requested_mode: ManagerMode::Official,
            catalog: catalog(previous),
        }),
        Err(RecoveryError::Install(_))
    ));
    assert!(backup.archive_path.exists());
    assert_eq!(
        manager.journal_stage(operation).unwrap(),
        Some(TransitionStage::RecoveryRequired)
    );
}

#[test]
fn leaves_home_and_backup_untouched_when_reinstalled_runtime_does_not_match() {
    let temp = tempdir().unwrap();
    let previous = release("0.2.1-rc.2", b"previous installer");
    let home = temp.path().join(".dsh");
    create_dir_all(&home).unwrap();
    write(home.join("settings.json"), b"before").unwrap();
    let backups = BackupStore::with_protector(temp.path().join("backups"), Arc::new(Protector));
    let backup = backups.create(&home).unwrap();
    write(home.join("settings.json"), b"preserve current data").unwrap();
    let downloader = Arc::new(Downloader {
        bytes: b"previous installer".to_vec(),
        calls: Mutex::new(0),
    });
    let executor = Arc::new(Executor {
        outcomes: Mutex::new(vec![Ok(())]),
    });
    let installer = InstallerManager::new(
        temp.path().join("cache"),
        downloader,
        executor,
        Arc::new(Probe),
    );
    let journal = TransitionJournal::new(temp.path().join("journal"));
    let operation = Uuid::new_v4();
    let installation_location = temp.path().join("DeepSeek Harness");
    create_dir_all(&installation_location).unwrap();
    journal
        .advance(operation, TransitionStage::Prepared)
        .unwrap();
    journal
        .advance(operation, TransitionStage::BackedUp)
        .unwrap();
    journal
        .advance(operation, TransitionStage::Installing)
        .unwrap();
    let mut mismatched = verifier(&previous, &installation_location).0.clone();
    mismatched.runtime_version = Some("different-runtime".to_owned());
    let manager = RecoveryManager::new(installer, backups, journal, Arc::new(Verifier(mismatched)));

    assert!(matches!(
        manager.recover(&RecoverySnapshot {
            operation_id: operation,
            previous_release: previous.clone(),
            backup: backup.clone(),
            home: home.clone(),
            installation_location,
            requested_mode: ManagerMode::Official,
            catalog: catalog(previous),
        }),
        Err(RecoveryError::RuntimeMismatch)
    ));
    assert_eq!(
        read(home.join("settings.json")).unwrap(),
        b"preserve current data"
    );
    assert!(backup.archive_path.exists());
    assert_eq!(
        manager.journal_stage(operation).unwrap(),
        Some(TransitionStage::RecoveryRequired)
    );
}

#[test]
fn refuses_to_recover_when_snapshot_installer_is_not_in_the_signed_catalog() {
    let temp = tempdir().unwrap();
    let previous = release("0.2.1-rc.2", b"previous installer");
    let wrong = release("0.2.1-rc.3", b"other installer");
    let backups = BackupStore::with_protector(temp.path().join("backups"), Arc::new(Protector));
    let installer = InstallerManager::new(
        temp.path().join("cache"),
        Arc::new(Downloader {
            bytes: b"previous installer".to_vec(),
            calls: Mutex::new(0),
        }),
        Arc::new(Executor {
            outcomes: Mutex::new(vec![]),
        }),
        Arc::new(Probe),
    );
    let journal = TransitionJournal::new(temp.path().join("journal"));
    let operation = Uuid::new_v4();
    let installation_location = temp.path().join("DeepSeek Harness");
    create_dir_all(&installation_location).unwrap();
    journal
        .advance(operation, TransitionStage::Prepared)
        .unwrap();
    let manager = RecoveryManager::new(
        installer,
        backups,
        journal,
        verifier(&previous, &installation_location),
    );
    let home = temp.path().join(".dsh");
    let backup = BackupStore::with_protector(temp.path().join("backups"), Arc::new(Protector))
        .create(&home)
        .unwrap();

    assert!(matches!(
        manager.recover(&RecoverySnapshot {
            operation_id: operation,
            previous_release: previous,
            backup,
            home,
            installation_location,
            requested_mode: ManagerMode::Official,
            catalog: catalog(wrong),
        }),
        Err(RecoveryError::UntrustedSnapshot)
    ));
}
