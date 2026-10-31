use dsh_policy_manager_lib::catalog::DesktopRelease;
use dsh_policy_manager_lib::installer::{
    DesktopProcessProbe, InstallError, InstallerDownloader, InstallerExecutor, InstallerManager,
    allowed_arguments,
};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn release(bytes: &[u8]) -> DesktopRelease {
    DesktopRelease {
        os: "windows".into(),
        architecture: "x86_64".into(),
        desktop_version: "1.0.2".into(),
        runtime_version: "0.2.1-rc.2".into(),
        runtime_commit: "0123456789abcdef0123456789abcdef01234567".into(),
        installer_url: "https://download.deepseek.com/desktop/dsh-1.0.2.exe".into(),
        sha256: digest(bytes),
        installer_profile: "nsis".into(),
        policies: vec![],
    }
}

struct Downloader {
    bytes: Vec<u8>,
    fail_after_partial: bool,
    calls: Mutex<usize>,
}
impl InstallerDownloader for Downloader {
    fn download(&self, _url: &str, destination: &Path, _max_bytes: u64) -> Result<(), String> {
        *self.calls.lock().unwrap() += 1;
        let mut file = File::create(destination).map_err(|e| e.to_string())?;
        file.write_all(&self.bytes[..self.bytes.len().min(5)])
            .map_err(|e| e.to_string())?;
        if self.fail_after_partial {
            return Err("connection interrupted".to_owned());
        }
        file.write_all(&self.bytes[self.bytes.len().min(5)..])
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())
    }
}

#[derive(Default)]
struct Probe(bool);
impl DesktopProcessProbe for Probe {
    fn is_running(&self) -> Result<bool, String> {
        Ok(self.0)
    }
}

#[derive(Default)]
struct Executor {
    calls: Mutex<Vec<(PathBuf, Vec<String>)>>,
}
impl InstallerExecutor for Executor {
    fn execute(&self, path: &Path, args: &[&str]) -> Result<(), String> {
        self.calls.lock().unwrap().push((
            path.to_path_buf(),
            args.iter().map(|arg| (*arg).to_owned()).collect(),
        ));
        Ok(())
    }
}

fn manager(
    cache: &Path,
    downloader: Arc<Downloader>,
    executor: Arc<Executor>,
    running: bool,
) -> InstallerManager {
    InstallerManager::new(
        cache.to_path_buf(),
        downloader,
        executor,
        Arc::new(Probe(running)),
    )
}

#[test]
fn rejects_unapproved_installer_hosts_before_download() {
    let temp = tempdir().unwrap();
    let downloader = Arc::new(Downloader {
        bytes: b"installer".to_vec(),
        fail_after_partial: false,
        calls: Mutex::new(0),
    });
    let manager = manager(
        temp.path(),
        downloader.clone(),
        Arc::new(Executor::default()),
        false,
    );
    let mut release = release(b"installer");
    release.installer_url = "https://evil.example/dsh.exe".into();
    assert!(matches!(
        manager.stage(&release),
        Err(InstallError::InvalidUrl)
    ));
    assert_eq!(*downloader.calls.lock().unwrap(), 0);
}

#[test]
fn refuses_hash_mismatch_and_does_not_publish_the_partial_artifact() {
    let temp = tempdir().unwrap();
    let downloader = Arc::new(Downloader {
        bytes: b"different bytes".to_vec(),
        fail_after_partial: false,
        calls: Mutex::new(0),
    });
    let manager = manager(
        temp.path(),
        downloader,
        Arc::new(Executor::default()),
        false,
    );
    assert!(matches!(
        manager.stage(&release(b"expected")),
        Err(InstallError::HashMismatch)
    ));
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn removes_a_partial_download_after_transport_failure() {
    let temp = tempdir().unwrap();
    let downloader = Arc::new(Downloader {
        bytes: b"partial installer".to_vec(),
        fail_after_partial: true,
        calls: Mutex::new(0),
    });
    let manager = manager(
        temp.path(),
        downloader,
        Arc::new(Executor::default()),
        false,
    );
    assert!(matches!(
        manager.stage(&release(b"partial installer")),
        Err(InstallError::Download(_))
    ));
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 0);
}

#[test]
fn discards_a_corrupt_cache_entry_and_downloads_a_verified_copy() {
    let temp = tempdir().unwrap();
    let bytes = b"verified official installer";
    let release = release(bytes);
    let cache = temp
        .path()
        .join(format!("installer-{}.exe", release.sha256));
    fs::write(&cache, b"corrupt cache").unwrap();
    let downloader = Arc::new(Downloader {
        bytes: bytes.to_vec(),
        fail_after_partial: false,
        calls: Mutex::new(0),
    });
    let manager = manager(
        temp.path(),
        downloader.clone(),
        Arc::new(Executor::default()),
        false,
    );
    let verified = manager.stage(&release).unwrap();
    assert_eq!(fs::read(verified.path()).unwrap(), bytes);
    assert_eq!(*downloader.calls.lock().unwrap(), 1);
}

#[test]
fn refuses_to_install_while_desktop_is_running() {
    let temp = tempdir().unwrap();
    let bytes = b"official installer";
    let executor = Arc::new(Executor::default());
    let manager = manager(
        temp.path(),
        Arc::new(Downloader {
            bytes: bytes.to_vec(),
            fail_after_partial: false,
            calls: Mutex::new(0),
        }),
        executor.clone(),
        true,
    );
    let verified = manager.stage(&release(bytes)).unwrap();
    assert!(matches!(
        manager.install(&verified),
        Err(InstallError::DesktopRunning)
    ));
    assert!(executor.calls.lock().unwrap().is_empty());
}

#[test]
fn installer_arguments_come_from_the_fixed_profile_allow_list() {
    assert_eq!(allowed_arguments("nsis").unwrap(), &["/S"]);
    assert!(allowed_arguments("custom").is_err());
}

#[test]
fn rechecks_cached_bytes_before_invoking_the_fixed_installer_command() {
    let temp = tempdir().unwrap();
    let bytes = b"official installer";
    let executor = Arc::new(Executor::default());
    let manager = manager(
        temp.path(),
        Arc::new(Downloader {
            bytes: bytes.to_vec(),
            fail_after_partial: false,
            calls: Mutex::new(0),
        }),
        executor.clone(),
        false,
    );
    let verified = manager.stage(&release(bytes)).unwrap();
    manager.install(&verified).unwrap();
    assert_eq!(executor.calls.lock().unwrap()[0].1, vec!["/S"]);
    fs::write(verified.path(), b"replaced after verification").unwrap();
    assert!(matches!(
        manager.install(&verified),
        Err(InstallError::CacheCorrupt)
    ));
}
