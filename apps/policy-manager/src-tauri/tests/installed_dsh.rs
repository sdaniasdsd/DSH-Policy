use dsh_policy_manager_lib::installed_dsh::{
    DetectError, InstallRecord, InstallRegistry, InstallationEdition, InstalledDsh,
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
    asar_manifest(
        path,
        serde_json::json!({
            "name": "@deepseek-ai/dsh-desktop", "dshDesktopAppId": "com.deepseek.dsh",
            "version": desktop, "dshBuildCommit": commit, "dshBuildDirty": dirty
        }),
        runtime,
    );
}

fn asar_manifest(path: &Path, desktop_manifest: serde_json::Value, runtime: &str) {
    let mut root = serde_json::json!({
        "files": {
            "package.json": { "size": 0, "offset": "0" },
            "dsh": { "files": {
                "package.json": { "size": 0, "offset": "0" }
            }}
        }
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
    let aligned_string_size = (header.len() + 3) & !3;
    let header_payload_size = 4 + aligned_string_size;
    output.extend_from_slice(&4u32.to_le_bytes());
    output.extend_from_slice(&((header_payload_size + 4) as u32).to_le_bytes());
    output.extend_from_slice(&(header_payload_size as u32).to_le_bytes());
    output.extend_from_slice(&(header.len() as u32).to_le_bytes());
    output.extend_from_slice(&header);
    output.resize(16 + aligned_string_size, 0);
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

#[test]
fn recognizes_the_versioned_official_uninstall_display_name() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    asar(
        &location.join("resources/app.asar"),
        "0.2.1-rc.2",
        "0.2.1-rc.2",
        Some(COMMIT),
        false,
    );
    let registry = Registry(vec![InstallRecord {
        display_name: "DeepSeek Harness 0.2.1-rc.2".to_owned(),
        display_version: "0.2.1-rc.2".to_owned(),
        install_location: location,
    }]);
    assert_eq!(
        InstalledDsh::detect(&registry)
            .unwrap()
            .unwrap()
            .runtime_commit
            .as_deref(),
        Some(COMMIT)
    );
}

fn record(name: &str, location: PathBuf) -> InstallRecord {
    InstallRecord {
        display_name: name.to_owned(),
        display_version: "1.0.2".to_owned(),
        install_location: location,
    }
}

fn policy_manifest() -> serde_json::Value {
    serde_json::json!({ "name": "dsh-policy-desktop", "dshDesktopAppId": "io.github.sdaniasdsd.dshchange", "dshPolicyEdition": true, "version": "1.0.2", "dshBuildCommit": COMMIT, "dshBuildDirty": true })
}

#[test]
fn discovers_both_editions_without_treating_policy_as_an_official_install() {
    let temp = tempdir().unwrap();
    let official = install(&temp.path().join("official"));
    let policy = install(&temp.path().join("policy"));
    asar(
        &official.join("resources/app.asar"),
        "1.0.2",
        "0.2.1-rc.2",
        Some(COMMIT),
        false,
    );
    asar_manifest(
        &policy.join("resources/app.asar"),
        policy_manifest(),
        "1.0.2",
    );
    let registry = Registry(vec![
        record("DSH Policy Edition 1.0.2", policy.clone()),
        record("DeepSeek Harness 1.0.2", official.clone()),
    ]);
    let found = InstalledDsh::discover(&registry).unwrap();
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].edition, InstallationEdition::Policy);
    assert_eq!(found[0].installed.install_location, policy);
    assert!(found[0].installed.build_dirty);
    assert_eq!(found[1].edition, InstallationEdition::Official);
    assert_eq!(
        InstalledDsh::detect(&registry)
            .unwrap()
            .unwrap()
            .install_location,
        official
    );
    let json = serde_json::to_value(&found[0]).unwrap();
    assert_eq!(json["edition"], "policy");
    assert_eq!(json["displayName"], "DSH Policy Edition 1.0.2");
}

#[test]
fn rejects_non_version_display_name_suffixes() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    let registry = Registry(
        [
            "DeepSeek Harness Helper",
            "DeepSeek Harness 1.0.2 malware",
            "DSH Policy Edition Backup",
            "Unrelated DeepSeek Harness",
            "DeepSeek Harness1.0.2",
            "DeepSeek Harness 1.malware",
            "DeepSeek Harness 1.0.2-",
            "DSH Policy Edition 1.0.2+",
        ]
        .iter()
        .map(|name| record(name, location.clone()))
        .collect(),
    );
    assert!(InstalledDsh::discover(&registry).unwrap().is_empty());
}

#[test]
fn rejects_conflicting_readable_application_identity() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    for manifest in [
        policy_manifest(),
        serde_json::json!({"name":"Other", "dshDesktopAppId":"com.deepseek.dsh"}),
        serde_json::json!({"name":"@deepseek-ai/dsh-desktop", "dshDesktopAppId":"other.application"}),
    ] {
        asar_manifest(&location.join("resources/app.asar"), manifest, "1.0.2");
        assert!(matches!(
            InstalledDsh::discover(&Registry(vec![record(
                "DeepSeek Harness",
                location.clone()
            )])),
            Err(DetectError::InvalidInstall(_))
        ));
    }
}

#[test]
fn requires_all_policy_identity_markers() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    for field in ["name", "dshDesktopAppId", "dshPolicyEdition"] {
        let mut manifest = policy_manifest();
        manifest.as_object_mut().unwrap().remove(field);
        asar_manifest(&location.join("resources/app.asar"), manifest, "1.0.2");
        assert!(matches!(
            InstalledDsh::discover(&Registry(vec![record(
                "DSH Policy Edition",
                location.clone()
            )])),
            Err(DetectError::InvalidInstall(_))
        ));
    }
    write(location.join("resources/app.asar"), b"broken").unwrap();
    assert!(matches!(
        InstalledDsh::discover(&Registry(vec![record("DSH Policy Edition", location)])),
        Err(DetectError::InvalidInstall(_))
    ));
}

#[test]
fn reports_multiple_official_installations_but_lists_each_candidate() {
    let temp = tempdir().unwrap();
    let first = install(&temp.path().join("first"));
    let second = install(&temp.path().join("second"));
    let registry = Registry(vec![
        record("DeepSeek Harness", first),
        record("DeepSeek Harness 1.0.2", second),
    ]);
    assert_eq!(InstalledDsh::discover(&registry).unwrap().len(), 2);
    assert!(matches!(
        InstalledDsh::detect(&registry),
        Err(DetectError::AmbiguousInstall)
    ));
}

#[test]
fn invalid_or_oversized_pickle_headers_do_not_supply_runtime_identity() {
    let temp = tempdir().unwrap();
    let location = install(temp.path());
    let archive = location.join("resources/app.asar");
    asar(&archive, "1.0.2", "0.2.1-rc.2", Some(COMMIT), false);
    let original = std::fs::read(&archive).unwrap();
    for (offset, value) in [(0, 8), (4, 32 * 1024 * 1024), (8, 1), (12, u32::MAX)] {
        let mut bytes = original.clone();
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        write(&archive, bytes).unwrap();
        let found = InstalledDsh::detect(&Registry(vec![record(
            "DeepSeek Harness",
            location.clone(),
        )]))
        .unwrap()
        .unwrap();
        assert!(
            found.runtime_version.is_none(),
            "invalid header at offset {offset} was accepted"
        );
    }
}
