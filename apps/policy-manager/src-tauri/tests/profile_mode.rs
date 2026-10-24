use dsh_policy_manager_lib::backup::{BackupStore, DataProtector};
use dsh_policy_manager_lib::catalog::{DesktopRelease, PolicyRelease, ReleaseCatalog};
use dsh_policy_manager_lib::installed_dsh::InstalledDsh;
use dsh_policy_manager_lib::installer::DesktopProcessProbe;
use dsh_policy_manager_lib::manager_state::ManagerMode;
use dsh_policy_manager_lib::profile_mode::{
    CliOutput, DesktopCliRunner, ModeChangeError, ProfileModeManager,
};
use dsh_policy_manager_lib::policy_package::PolicyPackageFetcher;
use dsh_policy_manager_lib::transaction::{TransitionJournal, TransitionStage};
use std::fs::{create_dir_all, read, write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sha2::{Digest, Sha256};
use tempfile::tempdir;
use uuid::Uuid;

const PACKAGE: &str = "@deepseek-ai/dsh-policy-extension";
const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
const PACKAGE_BYTES: &[u8] = b"policy package test fixture";

struct Fetcher;
impl PolicyPackageFetcher for Fetcher {
    fn fetch(&self, _release: &PolicyRelease, destination: &Path) -> Result<(), String> {
        write(destination, PACKAGE_BYTES).map_err(|error| error.to_string())
    }
}

struct Protector;
impl DataProtector for Protector {
    fn protect(&self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        Ok(bytes.to_vec())
    }
    fn unprotect(&self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        Ok(bytes.to_vec())
    }
}

#[derive(Default)]
struct Probe(bool);
impl DesktopProcessProbe for Probe {
    fn is_running(&self) -> Result<bool, String> {
        Ok(self.0)
    }
}

#[derive(Clone)]
struct Call {
    installation: PathBuf,
    home: PathBuf,
    args: Vec<String>,
}
struct Runner {
    outputs: Mutex<Vec<CliOutput>>,
    calls: Mutex<Vec<Call>>,
}
impl Runner {
    fn new(outputs: Vec<CliOutput>) -> Self {
        Self {
            outputs: Mutex::new(outputs),
            calls: Mutex::new(Vec::new()),
        }
    }
}
impl DesktopCliRunner for Runner {
    fn run(
        &self,
        installation: &InstalledDsh,
        home: &Path,
        args: &[String],
        _timeout: Duration,
    ) -> Result<CliOutput, String> {
        self.calls.lock().unwrap().push(Call {
            installation: installation.install_location.clone(),
            home: home.to_path_buf(),
            args: args.to_vec(),
        });
        if args.iter().any(|argument| argument == "add") {
            let installed_package = home.join("profiles/desktop/node_modules/@deepseek-ai/dsh-policy-extension");
            create_dir_all(&installed_package).unwrap();
            write(installed_package.join("package.json"), br#"{"name":"@deepseek-ai/dsh-policy-extension","version":"1.0.3","engines":{"dsh":"0.2.1-rc.2"}}"#).unwrap();
            write(installed_package.join("compatibility.json"), format!(r#"{{"policyVersion":"1.0.3","dshVersion":"0.2.1-rc.2","runtimeBuildCommit":"{COMMIT}"}}"#)).unwrap();
        }
        let mut outputs = self.outputs.lock().unwrap();
        if outputs.is_empty() {
            return Ok(output(0, "[]"));
        }
        Ok(outputs.remove(0))
    }
}

fn output(exit_code: i32, stdout: &str) -> CliOutput {
    CliOutput {
        exit_code: Some(exit_code),
        stdout: stdout.to_owned(),
        timed_out: false,
        truncated: false,
    }
}

fn installed() -> InstalledDsh {
    InstalledDsh {
        install_location: PathBuf::from("C:/Programs/DeepSeek Harness"),
        desktop_version: "1.0.2".into(),
        runtime_version: Some("0.2.1-rc.2".into()),
        runtime_commit: Some(COMMIT.into()),
        build_dirty: false,
    }
}

fn catalog() -> ReleaseCatalog {
    let sha256 = Sha256::digest(PACKAGE_BYTES).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    ReleaseCatalog {
        schema_version: 2,
        catalog_revision: 1,
        expires_at: u64::MAX,
        desktop_releases: vec![DesktopRelease {
            os: "windows".into(),
            architecture: "x86_64".into(),
            desktop_version: "1.0.2".into(),
            runtime_version: "0.2.1-rc.2".into(),
            runtime_commit: COMMIT.into(),
            installer_url: "https://download.deepseek.com/desktop/dsh-1.0.2.exe".into(),
            sha256: "a".repeat(64),
            installer_profile: "nsis".into(),
            policies: vec![PolicyRelease {
                package: PACKAGE.into(),
                version: "1.0.2".into(),
                runtime_version: "0.2.1-rc.2".into(),
                runtime_commit: COMMIT.into(),
                tarball_url: String::new(),
                sha256: String::new(),
                size: 0,
            }],
        }],
        policy_extensions: vec![PolicyRelease {
            package: PACKAGE.into(),
            version: "1.0.3".into(),
            runtime_version: "0.2.1-rc.2".into(),
            runtime_commit: COMMIT.into(),
            tarball_url: "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-extension-v1.0.3/dsh-policy-extension-1.0.3.tgz".into(),
            sha256,
            size: PACKAGE_BYTES.len() as u64,
        }],
    }
}

fn no_policy() -> &'static str {
    r#"[{"name":"desktop","dependencies":{}}]"#
}
fn policy(version: &str) -> String {
    format!(
        r#"[{{"name":"desktop","dependencies":{{"{PACKAGE}":{{"from":"{PACKAGE}@{version}","version":"{version}"}}}}}}]"#
    )
}

fn manager(temp: &Path, runner: Arc<Runner>, probe: Arc<Probe>) -> ProfileModeManager {
    ProfileModeManager::new(
        catalog(),
        BackupStore::with_protector(temp.join("backups"), Arc::new(Protector)),
        TransitionJournal::new(temp.join("journal")),
        runner,
        probe,
        Duration::from_millis(50),
    ).with_package_fetcher(Arc::new(Fetcher))
}

fn initialize_home(home: &Path) {
    create_dir_all(home.join("profiles/desktop")).unwrap();
    write(
        home.join("profiles/desktop/package.json"),
        b"{\"name\":\"desktop\"}\n",
    )
    .unwrap();
    write(home.join("profiles/desktop/cordis.patch.yml"), b"before\n").unwrap();
}

#[test]
fn installs_the_exact_policy_version_and_rechecks_the_profile() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let policy_output = policy("1.0.3");
    let runner = Arc::new(Runner::new(vec![
        output(0, no_policy()),
        output(0, ""),
        output(0, &policy_output),
    ]));
    let result = manager(temp.path(), runner.clone(), Arc::new(Probe(false)))
        .apply(ManagerMode::Policy, &installed(), &home)
        .unwrap();

    assert!(result.changed);
    assert_eq!(result.mode, ManagerMode::Policy);
    assert_eq!(
        runner.calls.lock().unwrap()[0].args,
        vec![
            "plugin",
            "--profile",
            "desktop",
            "list",
            "--json",
            "--depth=0"
        ]
    );
    let add_args = runner.calls.lock().unwrap()[1].args.clone();
    assert_eq!(&add_args[..4], ["plugin", "--profile", "desktop", "add"]);
    assert!(add_args[4].starts_with("file:.dsh-policy-artifacts/dsh-policy-extension-1.0.3-"));
    assert!(add_args[4].ends_with(".tgz"));
    assert_eq!(add_args[5], "--save-exact");
    assert_eq!(
        runner.calls.lock().unwrap()[2].args,
        vec![
            "plugin",
            "--profile",
            "desktop",
            "list",
            "--json",
            "--depth=0"
        ]
    );
    assert!(
        runner
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|call| call.home == home && call.installation == installed().install_location)
    );
    assert!(result.backup.as_ref().unwrap().archive_path.exists());
    assert_eq!(read(home.join("profiles/desktop/.dsh-policy-artifacts").join(format!("dsh-policy-extension-1.0.3-{}.tgz", Sha256::digest(PACKAGE_BYTES).iter().map(|byte| format!("{byte:02x}")).collect::<String>()))).unwrap(), PACKAGE_BYTES);
}

#[test]
fn removes_only_the_policy_bundle_for_official_mode() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let policy_output = policy("1.0.3");
    let runner = Arc::new(Runner::new(vec![
        output(0, &policy_output),
        output(0, ""),
        output(0, no_policy()),
    ]));
    let result = manager(temp.path(), runner.clone(), Arc::new(Probe(false)))
        .apply(ManagerMode::Official, &installed(), &home)
        .unwrap();
    assert!(result.changed);
    assert_eq!(
        runner.calls.lock().unwrap()[1].args,
        vec!["plugin", "--profile", "desktop", "remove", PACKAGE]
    );
}

#[test]
fn reports_no_change_when_policy_is_already_at_the_exact_version() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let runner = Arc::new(Runner::new(vec![output(0, &policy("1.0.3"))]));
    let result = manager(temp.path(), runner.clone(), Arc::new(Probe(false)))
        .apply(ManagerMode::Policy, &installed(), &home)
        .unwrap();
    assert!(!result.changed);
    assert_eq!(runner.calls.lock().unwrap().len(), 1);
    assert!(result.backup.is_none());
    assert!(!temp.path().join("backups").exists());
}

#[test]
fn rejects_policy_when_the_runtime_does_not_match_the_catalog() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let mut runtime = installed();
    runtime.runtime_commit = Some("fedcba9876543210fedcba9876543210fedcba98".into());
    let runner = Arc::new(Runner::new(vec![]));
    let result = manager(temp.path(), runner.clone(), Arc::new(Probe(false))).apply(
        ManagerMode::Policy,
        &runtime,
        &home,
    );
    assert!(matches!(result, Err(ModeChangeError::IncompatibleRuntime)));
    assert!(runner.calls.lock().unwrap().is_empty());
    assert!(!temp.path().join("backups").exists());
}

#[test]
fn refuses_to_initialize_a_missing_desktop_profile() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    create_dir_all(&home).unwrap();
    let runner = Arc::new(Runner::new(vec![]));
    let result = manager(temp.path(), runner.clone(), Arc::new(Probe(false))).apply(
        ManagerMode::Official,
        &installed(),
        &home,
    );
    assert!(matches!(result, Err(ModeChangeError::UninitializedProfile)));
    assert!(runner.calls.lock().unwrap().is_empty());
}

#[test]
fn refuses_to_mutate_a_profile_with_an_active_package_lock() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    write(home.join("profiles/desktop/package.json.lock"), b"123\n").unwrap();
    let runner = Arc::new(Runner::new(vec![]));
    let result = manager(temp.path(), runner.clone(), Arc::new(Probe(false))).apply(
        ManagerMode::Official,
        &installed(),
        &home,
    );
    assert!(matches!(result, Err(ModeChangeError::ProfileBusy)));
    assert!(runner.calls.lock().unwrap().is_empty());
}

#[test]
fn refuses_to_change_mode_while_desktop_is_running() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let runner = Arc::new(Runner::new(vec![]));
    let result = manager(temp.path(), runner.clone(), Arc::new(Probe(true))).apply(
        ManagerMode::Official,
        &installed(),
        &home,
    );
    assert!(matches!(result, Err(ModeChangeError::DesktopRunning)));
    assert!(runner.calls.lock().unwrap().is_empty());
}

#[test]
fn reports_cli_timeout_without_starting_a_mutation() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let runner = Arc::new(Runner::new(vec![CliOutput {
        exit_code: None,
        stdout: String::new(),
        timed_out: true,
        truncated: false,
    }]));
    let error = manager(temp.path(), runner.clone(), Arc::new(Probe(false)))
        .apply(ManagerMode::Policy, &installed(), &home)
        .unwrap_err();
    assert!(matches!(error, ModeChangeError::TimedOut));
    assert_eq!(runner.calls.lock().unwrap().len(), 1);
}

#[test]
fn restores_the_backup_when_a_policy_install_command_fails() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let runner = Arc::new(Runner::new(vec![
        output(0, no_policy()),
        output(1, "secret token: sk-test-secret"),
    ]));
    let manager = manager(temp.path(), runner, Arc::new(Probe(false)));
    let error = manager
        .apply(ManagerMode::Policy, &installed(), &home)
        .unwrap_err();
    assert!(matches!(error, ModeChangeError::CommandFailed(1)));
    assert!(!error.to_string().contains("sk-test-secret"));
    assert_eq!(
        read(home.join("profiles/desktop/cordis.patch.yml")).unwrap(),
        b"before\n"
    );
    let operation = std::fs::read_dir(temp.path().join("journal"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .file_name()
        .to_string_lossy()
        .parse::<Uuid>()
        .unwrap();
    assert_eq!(
        manager.journal_stage(operation).unwrap(),
        Some(TransitionStage::Committed)
    );
}

#[test]
fn restores_the_backup_when_post_change_verification_fails() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let runner = Arc::new(Runner::new(vec![
        output(0, no_policy()),
        output(0, ""),
        output(0, no_policy()),
    ]));
    let result = manager(temp.path(), runner, Arc::new(Probe(false))).apply(
        ManagerMode::Policy,
        &installed(),
        &home,
    );
    assert!(matches!(result, Err(ModeChangeError::VerificationFailed)));
    assert_eq!(
        read(home.join("profiles/desktop/cordis.patch.yml")).unwrap(),
        b"before\n"
    );
}

#[test]
fn rejects_policy_versions_that_could_change_cli_argument_parsing() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    initialize_home(&home);
    let mut release_catalog = catalog();
    release_catalog.policy_extensions[0].version = "1.0.3 --config=evil".into();
    let runner = Arc::new(Runner::new(vec![]));
    let result = ProfileModeManager::new(
        release_catalog,
        BackupStore::with_protector(temp.path().join("backups"), Arc::new(Protector)),
        TransitionJournal::new(temp.path().join("journal")),
        runner.clone(),
        Arc::new(Probe(false)),
        Duration::from_millis(50),
    )
    .apply(ManagerMode::Policy, &installed(), &home);
    assert!(matches!(result, Err(ModeChangeError::IncompatibleRuntime)));
    assert!(runner.calls.lock().unwrap().is_empty());
}
