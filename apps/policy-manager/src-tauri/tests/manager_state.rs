use dsh_policy_manager_lib::catalog::{DesktopRelease, PolicyRelease, ReleaseCatalog};
use dsh_policy_manager_lib::installed_dsh::InstalledDsh;
use dsh_policy_manager_lib::manager_state::{ManagerMode, ManagerState, ProfileSnapshot};
use std::path::PathBuf;

const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

fn catalog(runtime: &str, commit: &str) -> ReleaseCatalog {
    ReleaseCatalog {
        schema_version: 1,
        catalog_revision: 1,
        expires_at: u64::MAX,
        desktop_releases: vec![DesktopRelease {
            os: "windows".to_owned(),
            architecture: "x86_64".to_owned(),
            desktop_version: "1.0.2".to_owned(),
            runtime_version: runtime.to_owned(),
            runtime_commit: commit.to_owned(),
            installer_url: "https://download.deepseek.com/desktop/dsh-1.0.2.exe".to_owned(),
            sha256: "a".repeat(64),
            installer_profile: "nsis".to_owned(),
            policies: vec![PolicyRelease {
                package: "@deepseek-ai/dsh-policy-extension".to_owned(),
                version: "1.0.2".to_owned(),
                runtime_version: runtime.to_owned(),
                runtime_commit: commit.to_owned(),
            }],
        }],
    }
}

fn installed(version: &str, commit: Option<&str>, dirty: bool) -> InstalledDsh {
    InstalledDsh {
        install_location: PathBuf::from("C:/Program Files/DeepSeek Harness"),
        desktop_version: "1.0.2".to_owned(),
        runtime_version: Some(version.to_owned()),
        runtime_commit: commit.map(ToOwned::to_owned),
        build_dirty: dirty,
    }
}

#[test]
fn enables_policy_only_for_the_exact_runtime_version_and_commit() {
    let state = ManagerState::inspect(
        Some(installed("0.2.1-rc.2", Some(COMMIT), false)),
        PathBuf::from("C:/Users/test/.dsh"),
        ProfileSnapshot {
            mode: ManagerMode::Official,
        },
        &catalog("0.2.1-rc.2", COMMIT),
    );

    assert!(state.policy_compatible);
    assert_eq!(
        state
            .compatible_policy
            .as_ref()
            .map(|policy| policy.version.as_str()),
        Some("1.0.2")
    );
    assert_eq!(state.mode, ManagerMode::Official);
}

#[test]
fn rejects_a_different_runtime_commit_even_when_the_version_matches() {
    let state = ManagerState::inspect(
        Some(installed(
            "0.2.1-rc.2",
            Some("fedcba9876543210fedcba9876543210fedcba98"),
            false,
        )),
        PathBuf::from("C:/Users/test/.dsh"),
        ProfileSnapshot {
            mode: ManagerMode::Policy,
        },
        &catalog("0.2.1-rc.2", COMMIT),
    );

    assert!(!state.policy_compatible);
    assert_eq!(state.compatible_policy, None);
    assert_eq!(state.mode, ManagerMode::Official);
}

#[test]
fn disables_policy_for_unknown_or_dirty_builds_but_keeps_official_mode() {
    for runtime in [
        installed("0.2.1-rc.2", None, false),
        installed("0.2.1-rc.2", Some(COMMIT), true),
    ] {
        let state = ManagerState::inspect(
            Some(runtime),
            PathBuf::from("C:/Users/test/.dsh"),
            ProfileSnapshot {
                mode: ManagerMode::Policy,
            },
            &catalog("0.2.1-rc.2", COMMIT),
        );
        assert!(!state.policy_compatible);
        assert_eq!(state.mode, ManagerMode::Official);
    }
}

#[test]
fn missing_installation_reports_policy_unavailable_and_official_mode() {
    let state = ManagerState::inspect(
        None,
        PathBuf::from("C:/Users/test/.dsh"),
        ProfileSnapshot {
            mode: ManagerMode::Policy,
        },
        &catalog("0.2.1-rc.2", COMMIT),
    );
    assert!(!state.policy_compatible);
    assert_eq!(state.mode, ManagerMode::Official);
}

#[test]
fn disables_policy_when_the_verified_catalog_has_expired() {
    let mut expired = catalog("0.2.1-rc.2", COMMIT);
    expired.expires_at = 1;
    let state = ManagerState::inspect(
        Some(installed("0.2.1-rc.2", Some(COMMIT), false)),
        PathBuf::from("C:/Users/test/.dsh"),
        ProfileSnapshot {
            mode: ManagerMode::Policy,
        },
        &expired,
    );
    assert!(!state.policy_compatible);
    assert_eq!(state.mode, ManagerMode::Official);
}
