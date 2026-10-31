use dsh_policy_manager_lib::catalog::DesktopRelease;
use dsh_policy_manager_lib::manager_state::ManagerMode;
use dsh_policy_manager_lib::recovery::{RecoveryDescriptor, RecoveryDescriptorStore};
use std::path::PathBuf;
use tempfile::tempdir;
use uuid::Uuid;

fn descriptor(id: Uuid) -> RecoveryDescriptor {
    RecoveryDescriptor {
        schema_version: 1,
        operation_id: id,
        previous_release: DesktopRelease {
            os: "windows".into(),
            architecture: "x86_64".into(),
            desktop_version: "1.2.3".into(),
            runtime_version: "0.2.1".into(),
            runtime_commit: "a".repeat(40),
            installer_url: "https://download.deepseek.com/dsh-latest-windows-x64.exe".into(),
            sha256: "b".repeat(64),
            installer_profile: "nsis".into(),
            policies: Vec::new(),
        },
        backup_id: Uuid::new_v4(),
        home: PathBuf::from("C:/Users/test/.dsh"),
        installation_location: PathBuf::from("C:/Users/test/AppData/Local/DSH"),
        requested_mode: ManagerMode::Official,
        catalog_revision: 7,
    }
}

#[test]
fn recovery_descriptor_survives_manager_restart() {
    let temp = tempdir().unwrap();
    let store = RecoveryDescriptorStore::new(temp.path().join("recoveries"));
    let id = Uuid::new_v4();
    let saved = descriptor(id);

    store.save(&saved).unwrap();

    assert_eq!(
        RecoveryDescriptorStore::new(temp.path().join("recoveries"))
            .load(id)
            .unwrap(),
        Some(saved)
    );
}

#[test]
fn refuses_a_descriptor_whose_identity_does_not_match_its_filename() {
    let temp = tempdir().unwrap();
    let store = RecoveryDescriptorStore::new(temp.path().join("recoveries"));
    let id = Uuid::new_v4();
    store.save(&descriptor(id)).unwrap();
    let path = temp.path().join("recoveries").join(format!("{id}.json"));
    let mut value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    value["operationId"] = serde_json::json!(Uuid::new_v4());
    std::fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();

    assert!(store.load(id).is_err());
}
