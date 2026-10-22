use dsh_policy_manager_lib::installed_dsh::{
    DetectError, InstallRecord, InstallRegistry, InstalledDsh,
};
use std::fs::{create_dir_all, write};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

struct Registry(Vec<InstallRecord>);

impl InstallRegistry for Registry {
    fn installations(&self) -> Result<Vec<InstallRecord>, String> {
        Ok(self.0.clone())
    }
}

fn asar(path: &Path, desktop: &str, runtime: &str, commit: Option<&str>, dirty: bool) {
    let mut root = serde_json::json!({
        "files": {
            "package.json": { "size": 0, "offset": "0" },
            "dsh": { "files": {
                "package.json": { "size": 0, "offset": "0" }
            }}
        }
    });
    let desktop_manifest = serde_json::json!({
        "version": desktop,
        "dshBuildCommit": commit,
        "dshBuildDirty": dirty
    });
    let runtime_manifest = serde_json::json!({ "version": runtime });
    let mut payload = Vec::new();
    let mut append = |manifest: serde_json::Value| {
        let bytes = serde_json::to_vec(&manifest).unwrap();
        let offset = payload.len();
        payload.extend_from_slice(&bytes);
        (bytes.len(), offset.to_string())
    };
    let desktop_entry = append(desktop_manifest);
    let runtime_entry = append(runtime_manifest);
    root["files"]["package.json"] =
        serde_json::json!({ "size": desktop_entry.0, "offset": desktop_entry.1 });
    root["files"]["dsh"]["files"]["package.json"] =
        serde_json::json!({ "size": runtime_entry.0, "offset": runtime_entry.1 });
    let header = serde_json::to_vec(&root).unwrap();
    let mut output = Vec::new();
    let pickle_size = (header.len() + 4) as u32;
    output.extend_from_slice(&pickle_size.to_le_bytes());
    output.extend_from_slice(&(header.len() as u32).to_le_bytes());
    output.extend_from_slice(&header);
    output.extend_from_slice(&payload);
    create_dir_all(path.parent().unwrap()).unwrap();
    let mut file = std::fs::File::create(path).unwrap();
    file.write_all(&output).unwrap();
}

fn install(root: &Path) -> PathBuf {
    let location = root.join("DeepSeek Harness");
    create_dir_all(&location).unwrap();
    write(location.join("DeepSeek Harness.exe"), b"executable").unwrap();
    location
}

#[test]
fn returns_none_when_no_official_installation_is_registered() {
    assert!(InstalledDsh::detect(&Registry(vec![])).unwrap().is_none());
}

#[test]
fn reads_runtime_identity_from_the_installed_read_only_asar() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    asar(
        &location.join("resources/app.asar"),
        "1.0.2",
        "0.2.1-rc.2",
        Some(COMMIT),
        false,
    );
    let registry = Registry(vec![InstallRecord {
        display_name: "DeepSeek Harness".to_owned(),
        display_version: "1.0.2".to_owned(),
        install_location: location.clone(),
    }]);

    let found = InstalledDsh::detect(&registry).unwrap().unwrap();

    assert_eq!(found.install_location, location);
    assert_eq!(found.desktop_version, "1.0.2");
    assert_eq!(found.runtime_version.as_deref(), Some("0.2.1-rc.2"));
    assert_eq!(found.runtime_commit.as_deref(), Some(COMMIT));
    assert!(!found.build_dirty);
}

#[test]
fn ignores_unrelated_registry_entries() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    asar(
        &location.join("resources/app.asar"),
        "1.0.2",
        "0.2.1-rc.2",
        Some(COMMIT),
        false,
    );
    let registry = Registry(vec![InstallRecord {
        display_name: "Other application".to_owned(),
        display_version: "1.0.2".to_owned(),
        install_location: location,
    }]);

    assert!(InstalledDsh::detect(&registry).unwrap().is_none());
}

#[test]
fn fails_closed_when_the_registered_install_has_no_executable_or_asar() {
    let temp = tempdir().unwrap();
    let location = temp.path().join("DeepSeek Harness");
    create_dir_all(&location).unwrap();
    let registry = Registry(vec![InstallRecord {
        display_name: "DeepSeek Harness".to_owned(),
        display_version: "1.0.2".to_owned(),
        install_location: location,
    }]);

    assert!(matches!(
        InstalledDsh::detect(&registry),
        Err(DetectError::InvalidInstall(_))
    ));
}

#[test]
fn keeps_unknown_identity_when_asar_manifest_is_unreadable() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    create_dir_all(location.join("resources")).unwrap();
    write(location.join("resources/app.asar"), b"broken").unwrap();
    let registry = Registry(vec![InstallRecord {
        display_name: "DeepSeek Harness".to_owned(),
        display_version: "1.0.2".to_owned(),
        install_location: location,
    }]);

    let found = InstalledDsh::detect(&registry).unwrap().unwrap();
    assert!(found.runtime_version.is_none());
    assert!(found.runtime_commit.is_none());
}

#[test]
fn reports_an_external_desktop_update_from_installed_manifests() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    asar(
        &location.join("resources/app.asar"),
        "9.9.0",
        "9.9.0",
        None,
        false,
    );
    let registry = Registry(vec![InstallRecord {
        display_name: "DeepSeek Harness".to_owned(),
        display_version: "1.0.2".to_owned(),
        install_location: location,
    }]);

    let found = InstalledDsh::detect(&registry).unwrap().unwrap();
    assert_eq!(found.desktop_version, "9.9.0");
    assert_eq!(found.runtime_version.as_deref(), Some("9.9.0"));
    assert!(found.runtime_commit.is_none());
}

#[test]
fn propagates_registry_read_errors() {
    struct BrokenRegistry;
    impl InstallRegistry for BrokenRegistry {
        fn installations(&self) -> Result<Vec<InstallRecord>, String> {
            Err("access denied".to_owned())
        }
    }
    assert!(matches!(
        InstalledDsh::detect(&BrokenRegistry),
        Err(DetectError::Registry(_))
    ));
}
