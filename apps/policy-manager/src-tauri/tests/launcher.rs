use dsh_policy_manager_lib::installed_dsh::InstalledDsh;
use dsh_policy_manager_lib::installer::DesktopProcessProbe;
use dsh_policy_manager_lib::launcher::{DshLauncher, LaunchError, LaunchExecutor, LaunchRequest};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tempfile::tempdir;

#[derive(Default)]
struct Probe(bool);
impl DesktopProcessProbe for Probe {
    fn is_running(&self) -> Result<bool, String> {
        Ok(self.0)
    }
}

#[derive(Default)]
struct Executor(Mutex<Vec<LaunchRequest>>);
impl LaunchExecutor for Executor {
    fn launch(&self, request: &LaunchRequest) -> Result<u32, String> {
        self.0.lock().unwrap().push(request.clone());
        Ok(42)
    }
}

fn installation(path: PathBuf) -> InstalledDsh {
    InstalledDsh {
        install_location: path,
        desktop_version: "1.0.2".into(),
        runtime_version: None,
        runtime_commit: None,
        build_dirty: false,
    }
}

#[test]
fn launches_only_the_detected_desktop_with_the_selected_home() {
    let temp = tempdir().unwrap();
    let install = temp.path().join("install");
    let home = temp.path().join("home");
    std::fs::create_dir_all(&install).unwrap();
    std::fs::write(install.join("DeepSeek Harness.exe"), b"placeholder").unwrap();
    std::fs::create_dir_all(home.join("profiles/desktop")).unwrap();
    std::fs::write(home.join("profiles/desktop/package.json"), b"{}\n").unwrap();
    let executor = Arc::new(Executor::default());
    let launcher = DshLauncher::new(executor.clone(), Arc::new(Probe(false)));

    let pid = launcher
        .launch(&installation(install.clone()), &home)
        .unwrap();
    assert_eq!(pid, 42);
    let request = executor.0.lock().unwrap()[0].clone();
    assert_eq!(request.executable, install.join("DeepSeek Harness.exe"));
    assert_eq!(request.home, home);
}

#[test]
fn refuses_to_launch_when_desktop_is_already_running() {
    let temp = tempdir().unwrap();
    let executor = Arc::new(Executor::default());
    let launcher = DshLauncher::new(executor.clone(), Arc::new(Probe(true)));
    let result = launcher.launch(&installation(temp.path().to_path_buf()), temp.path());
    assert!(matches!(result, Err(LaunchError::DesktopRunning)));
    assert!(executor.0.lock().unwrap().is_empty());
}

#[test]
fn refuses_to_launch_an_uninitialized_home_or_missing_executable() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let executable = temp.path().join("DeepSeek Harness.exe");
    std::fs::write(&executable, b"placeholder").unwrap();
    let executor = Arc::new(Executor::default());
    let launcher = DshLauncher::new(executor.clone(), Arc::new(Probe(false)));
    let result = launcher.launch(&installation(temp.path().to_path_buf()), &home);
    assert!(matches!(result, Err(LaunchError::UninitializedProfile)));
    assert!(executor.0.lock().unwrap().is_empty());

    let missing = temp.path().join("missing-install");
    std::fs::create_dir_all(&missing).unwrap();
    let result = launcher.launch(&installation(missing), &home);
    assert!(matches!(result, Err(LaunchError::InvalidInstallation)));
}

#[test]
fn official_first_launch_can_initialize_a_missing_home() {
    let temp = tempdir().unwrap();
    let install = temp.path().join("install");
    std::fs::create_dir_all(&install).unwrap();
    std::fs::write(install.join("DeepSeek Harness.exe"), b"placeholder").unwrap();
    let home = temp.path().join("first-run-home");
    let executor = Arc::new(Executor::default());
    let launcher = DshLauncher::new(executor.clone(), Arc::new(Probe(false)));

    assert_eq!(
        launcher
            .launch_official_initialization(&installation(install), &home)
            .unwrap(),
        42
    );
    assert_eq!(executor.0.lock().unwrap().len(), 1);
}
