use crate::installed_dsh::InstalledDsh;
use crate::installer::{DesktopProcessProbe, SystemDesktopProcessProbe};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchRequest {
    pub executable: PathBuf,
    pub home: PathBuf,
}

pub trait LaunchExecutor: Send + Sync {
    fn launch(&self, request: &LaunchRequest) -> Result<u32, String>;
}

pub struct SystemLaunchExecutor;

impl LaunchExecutor for SystemLaunchExecutor {
    fn launch(&self, request: &LaunchRequest) -> Result<u32, String> {
        let mut command = Command::new(&request.executable);
        command
            .env("DSH_HOME", &request.home)
            .current_dir(request.executable.parent().unwrap_or(&request.home))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000 | 0x00000008 | 0x00000200);
        }
        command
            .spawn()
            .map(|child| child.id())
            .map_err(|_| "could not launch official DSH Desktop".to_owned())
    }
}

#[derive(Debug, Error)]
pub enum LaunchError {
    #[error("DSH Desktop is already running")]
    DesktopRunning,
    #[error("the selected DSH home has no initialized desktop profile")]
    UninitializedProfile,
    #[error("the desktop profile is busy")]
    ProfileBusy,
    #[error("the detected DSH Desktop executable is missing or unsafe")]
    InvalidInstallation,
    #[error("the selected DSH home is not a regular directory")]
    UnsafeHome,
    #[error("could not inspect whether DSH Desktop is running: {0}")]
    ProcessProbe(String),
    #[error("could not start official DSH Desktop: {0}")]
    Execute(String),
}

pub struct DshLauncher {
    executor: Arc<dyn LaunchExecutor>,
    process_probe: Arc<dyn DesktopProcessProbe>,
}

impl DshLauncher {
    pub fn new(
        executor: Arc<dyn LaunchExecutor>,
        process_probe: Arc<dyn DesktopProcessProbe>,
    ) -> Self {
        Self {
            executor,
            process_probe,
        }
    }

    pub fn system() -> Self {
        Self::new(
            Arc::new(SystemLaunchExecutor),
            Arc::new(SystemDesktopProcessProbe),
        )
    }

    pub fn launch(&self, installation: &InstalledDsh, home: &Path) -> Result<u32, LaunchError> {
        self.launch_with_profile_policy(installation, home, false)
    }

    pub fn launch_official_initialization(
        &self,
        installation: &InstalledDsh,
        home: &Path,
    ) -> Result<u32, LaunchError> {
        self.launch_with_profile_policy(installation, home, true)
    }

    fn launch_with_profile_policy(
        &self,
        installation: &InstalledDsh,
        home: &Path,
        allow_initialization: bool,
    ) -> Result<u32, LaunchError> {
        if self
            .process_probe
            .is_running()
            .map_err(LaunchError::ProcessProbe)?
        {
            return Err(LaunchError::DesktopRunning);
        }
        let executable = installation.install_location.join("DeepSeek Harness.exe");
        let metadata =
            fs::symlink_metadata(&executable).map_err(|_| LaunchError::InvalidInstallation)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(LaunchError::InvalidInstallation);
        }
        match fs::symlink_metadata(home) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_initialization => {}
            _ => return Err(LaunchError::UnsafeHome),
        }
        let profile = home.join("profiles/desktop");
        let manifest = profile.join("package.json");
        let profile_metadata = fs::symlink_metadata(&profile);
        match profile_metadata {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                match fs::symlink_metadata(&manifest) {
                    Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
                        if profile.join("package.json.lock").exists() {
                            return Err(LaunchError::ProfileBusy);
                        }
                    }
                    Err(error)
                        if error.kind() == std::io::ErrorKind::NotFound && allow_initialization => {
                    }
                    _ => return Err(LaunchError::UninitializedProfile),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_initialization => {}
            _ => return Err(LaunchError::UninitializedProfile),
        }
        self.executor
            .launch(&LaunchRequest {
                executable,
                home: home.to_path_buf(),
            })
            .map_err(LaunchError::Execute)
    }
}
