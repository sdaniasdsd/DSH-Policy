use crate::catalog::DesktopRelease;
use reqwest::redirect::Policy;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

pub const MAX_INSTALLER_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const INSTALLER_HOST: &str = "download.deepseek.com";

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("installer URL is not an approved first-party HTTPS URL")]
    InvalidUrl,
    #[error("installer profile is unsupported")]
    UnsupportedProfile,
    #[error("installer release identity is invalid")]
    InvalidReleaseIdentity,
    #[error("installer SHA-256 is invalid")]
    InvalidHash,
    #[error("installer download failed: {0}")]
    Download(String),
    #[error("downloaded installer does not match the catalog SHA-256")]
    HashMismatch,
    #[error("installer cache entry is corrupt or outside the configured cache")]
    CacheCorrupt,
    #[error("installer exceeds the configured size limit")]
    TooLarge,
    #[error("DSH Desktop is still running")]
    DesktopRunning,
    #[error("installer process failed: {0}")]
    Execute(String),
    #[error("installer process probe failed: {0}")]
    ProcessProbe(String),
    #[error("installer cache I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

pub trait InstallerDownloader: Send + Sync {
    fn download(&self, url: &str, destination: &Path, max_bytes: u64) -> Result<(), String>;
}

pub trait InstallerExecutor: Send + Sync {
    fn execute(&self, path: &Path, args: &[&str]) -> Result<(), String>;
}

pub trait DesktopProcessProbe: Send + Sync {
    fn is_running(&self) -> Result<bool, String>;
}

#[derive(Clone, Debug)]
pub struct VerifiedInstaller {
    path: PathBuf,
    release: DesktopRelease,
    sha256: String,
}

impl VerifiedInstaller {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn release(&self) -> &DesktopRelease {
        &self.release
    }

    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

#[derive(Clone)]
pub struct InstallerManager {
    cache: PathBuf,
    downloader: Arc<dyn InstallerDownloader>,
    executor: Arc<dyn InstallerExecutor>,
    process_probe: Arc<dyn DesktopProcessProbe>,
}

impl InstallerManager {
    pub fn new(
        cache: PathBuf,
        downloader: Arc<dyn InstallerDownloader>,
        executor: Arc<dyn InstallerExecutor>,
        process_probe: Arc<dyn DesktopProcessProbe>,
    ) -> Self {
        Self {
            cache,
            downloader,
            executor,
            process_probe,
        }
    }

    pub fn system(cache: PathBuf) -> Result<Self, InstallError> {
        Ok(Self::new(
            cache,
            Arc::new(HttpInstallerDownloader::new().map_err(InstallError::Download)?),
            Arc::new(SystemInstallerExecutor),
            Arc::new(SystemDesktopProcessProbe),
        ))
    }

    pub fn stage(&self, release: &DesktopRelease) -> Result<VerifiedInstaller, InstallError> {
        validate_release(release)?;
        fs::create_dir_all(&self.cache)?;
        let expected = release.sha256.to_ascii_lowercase();
        let target = self.cache.join(format!("installer-{expected}.exe"));
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                if file_sha256(&target)? == expected {
                    return Ok(VerifiedInstaller {
                        path: target,
                        release: release.clone(),
                        sha256: expected,
                    });
                }
                fs::remove_file(&target)?;
            }
            Ok(_) => return Err(InstallError::CacheCorrupt),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(InstallError::Io(error)),
        }

        let partial = self.cache.join(format!(".{}.partial", Uuid::new_v4()));
        let result = self
            .downloader
            .download(&release.installer_url, &partial, MAX_INSTALLER_BYTES)
            .map_err(InstallError::Download)
            .and_then(|()| {
                let metadata = fs::symlink_metadata(&partial)?;
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err(InstallError::Download(
                        "download did not create a regular installer file".to_owned(),
                    ));
                }
                if metadata.len() > MAX_INSTALLER_BYTES {
                    return Err(InstallError::TooLarge);
                }
                if file_sha256(&partial)? != expected {
                    return Err(InstallError::HashMismatch);
                }
                fs::rename(&partial, &target)?;
                Ok(())
            });
        if result.is_err() {
            let _ = fs::remove_file(&partial);
        }
        result?;
        Ok(VerifiedInstaller {
            path: target,
            release: release.clone(),
            sha256: expected,
        })
    }

    pub fn install(&self, installer: &VerifiedInstaller) -> Result<(), InstallError> {
        validate_release(&installer.release)?;
        let expected = installer.release.sha256.to_ascii_lowercase();
        let cache = fs::canonicalize(&self.cache)?;
        let path = fs::canonicalize(&installer.path).map_err(|_| InstallError::CacheCorrupt)?;
        let expected_name = format!("installer-{expected}.exe");
        if path.parent() != Some(cache.as_path())
            || path
                .file_name()
                .is_none_or(|name| name != std::ffi::OsStr::new(&expected_name))
            || installer.sha256 != expected
            || file_sha256(&path)? != expected
        {
            return Err(InstallError::CacheCorrupt);
        }
        if self
            .process_probe
            .is_running()
            .map_err(InstallError::ProcessProbe)?
        {
            return Err(InstallError::DesktopRunning);
        }
        let args = allowed_arguments(&installer.release.installer_profile)?;
        self.executor
            .execute(&path, args)
            .map_err(InstallError::Execute)
    }
}

pub fn allowed_arguments(profile: &str) -> Result<&'static [&'static str], InstallError> {
    match profile {
        "nsis" => Ok(&["/S"]),
        _ => Err(InstallError::UnsupportedProfile),
    }
}

fn validate_release(release: &DesktopRelease) -> Result<(), InstallError> {
    if !is_approved_installer_url(&release.installer_url) {
        return Err(InstallError::InvalidUrl);
    }
    if release.os != "windows"
        || release.architecture != "x86_64"
        || release.desktop_version.trim().is_empty()
        || release.runtime_version.trim().is_empty()
        || release.runtime_commit.len() != 40
        || !release
            .runtime_commit
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(InstallError::InvalidReleaseIdentity);
    }
    allowed_arguments(&release.installer_profile)?;
    if release.sha256.len() != 64 || !release.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(InstallError::InvalidHash);
    }
    Ok(())
}

fn is_approved_installer_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some(INSTALLER_HOST)
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

fn file_sha256(path: &Path) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub struct HttpInstallerDownloader {
    client: reqwest::blocking::Client,
}

impl HttpInstallerDownloader {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .redirect(Policy::custom(|attempt| {
                if is_approved_installer_url(attempt.url().as_str()) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { client })
    }
}

impl InstallerDownloader for HttpInstallerDownloader {
    fn download(&self, url: &str, destination: &Path, max_bytes: u64) -> Result<(), String> {
        if !is_approved_installer_url(url) {
            return Err("unapproved installer URL".to_owned());
        }
        let mut response = self
            .client
            .get(url)
            .send()
            .and_then(reqwest::blocking::Response::error_for_status)
            .map_err(|error| error.to_string())?;
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes)
        {
            return Err("installer response exceeds size limit".to_owned());
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|error| error.to_string())?;
        let mut total = 0u64;
        let mut buffer = [0; 64 * 1024];
        loop {
            let read = response
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            total = total.saturating_add(read as u64);
            if total > max_bytes {
                return Err("installer response exceeds size limit".to_owned());
            }
            file.write_all(&buffer[..read])
                .map_err(|error| error.to_string())?;
        }
        file.sync_all().map_err(|error| error.to_string())
    }
}

pub struct SystemInstallerExecutor;

impl InstallerExecutor for SystemInstallerExecutor {
    fn execute(&self, path: &Path, args: &[&str]) -> Result<(), String> {
        let mut command = Command::new(path);
        command.args(args);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let status = command.status().map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("installer exited with status {status}"))
        }
    }
}

pub struct SystemDesktopProcessProbe;

#[cfg(windows)]
impl DesktopProcessProbe for SystemDesktopProcessProbe {
    fn is_running(&self) -> Result<bool, String> {
        use std::mem::{size_of, zeroed};
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
            TH32CS_SNAPPROCESS,
        };
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(format!("process snapshot failed with {}", unsafe {
                windows_sys::Win32::Foundation::GetLastError()
            }));
        }
        let result = unsafe {
            let mut entry: PROCESSENTRY32W = zeroed();
            entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
            let mut found = false;
            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let length = entry
                        .szExeFile
                        .iter()
                        .position(|unit| *unit == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let image = String::from_utf16_lossy(&entry.szExeFile[..length]);
                    if image.eq_ignore_ascii_case("DeepSeek Harness.exe") {
                        found = true;
                        break;
                    }
                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            found
        };
        unsafe {
            CloseHandle(snapshot);
        }
        Ok(result)
    }
}

#[cfg(not(windows))]
impl DesktopProcessProbe for SystemDesktopProcessProbe {
    fn is_running(&self) -> Result<bool, String> {
        Ok(false)
    }
}
