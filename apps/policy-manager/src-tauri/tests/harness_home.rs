use dsh_policy_manager_lib::harness_home::{HarnessHome, HomeResolution, HomeSource};
use std::fs::{create_dir_all, write};
use std::path::{Path, PathBuf};
use tempfile::tempdir;

fn add_data(home: &Path) {
    create_dir_all(home).unwrap();
    write(home.join("settings.json"), b"{}").unwrap();
}

#[test]
fn explicit_home_has_highest_precedence() {
    let temp = tempdir().unwrap();
    let explicit = temp.path().join("chosen");
    let resolution = HarnessHome::resolve(Some(explicit.clone()), temp.path());
    assert_eq!(
        resolution,
        HomeResolution::Selected {
            path: explicit,
            source: HomeSource::Explicit
        }
    );
}

#[test]
fn ignores_a_blank_home_override_like_the_dsh_home_resolver() {
    let temp = tempdir().unwrap();
    let resolution = HarnessHome::resolve(Some(PathBuf::from("  ")), temp.path());
    assert_eq!(
        resolution,
        HomeResolution::Selected {
            path: temp.path().join(".dsh"),
            source: HomeSource::Standard,
        }
    );
}

#[test]
fn uses_standard_home_when_no_override_or_data_exists() {
    let temp = tempdir().unwrap();
    let resolution = HarnessHome::resolve(None, temp.path());
    assert_eq!(
        resolution,
        HomeResolution::Selected {
            path: temp.path().join(".dsh"),
            source: HomeSource::Standard,
        }
    );
}

#[test]
fn reuses_the_only_legacy_policy_home_containing_data() {
    let temp = tempdir().unwrap();
    let legacy = temp.path().join(".dsh-policy");
    add_data(&legacy);
    let resolution = HarnessHome::resolve(None, temp.path());
    assert_eq!(
        resolution,
        HomeResolution::Selected {
            path: legacy,
            source: HomeSource::PolicyLegacy
        }
    );
}

#[test]
fn asks_before_choosing_when_both_homes_contain_data() {
    let temp = tempdir().unwrap();
    let standard = temp.path().join(".dsh");
    let policy = temp.path().join(".dsh-policy");
    add_data(&standard);
    add_data(&policy);
    assert_eq!(
        HarnessHome::resolve(None, temp.path()),
        HomeResolution::ChoiceRequired { standard, policy }
    );
}

#[test]
fn keeps_standard_home_when_the_policy_legacy_directory_is_empty() {
    let temp = tempdir().unwrap();
    create_dir_all(temp.path().join(".dsh-policy")).unwrap();
    assert!(matches!(
        HarnessHome::resolve(None, temp.path()),
        HomeResolution::Selected {
            source: HomeSource::Standard,
            ..
        }
    ));
}

#[test]
fn rejects_a_file_at_the_user_profile_root() {
    let temp = tempdir().unwrap();
    let home_file = temp.path().join("not-a-directory");
    write(&home_file, b"x").unwrap();
    let result = HarnessHome::resolve(None, &home_file);
    assert!(matches!(result, HomeResolution::InspectionFailed { .. }));
}
