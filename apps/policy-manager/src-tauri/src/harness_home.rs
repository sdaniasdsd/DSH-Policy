use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HomeSource {
    Explicit,
    Standard,
    PolicyLegacy,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum HomeResolution {
    Selected { path: PathBuf, source: HomeSource },
    ChoiceRequired { standard: PathBuf, policy: PathBuf },
    InspectionFailed { path: PathBuf, reason: String },
}

pub struct HarnessHome;

impl HarnessHome {
    pub fn resolve(explicit: Option<PathBuf>, user_profile: &Path) -> HomeResolution {
        Self::resolve_with_current_dir(explicit, user_profile, std::env::current_dir)
    }

    fn resolve_with_current_dir(
        explicit: Option<PathBuf>,
        user_profile: &Path,
        current_dir: impl FnOnce() -> Result<PathBuf, std::io::Error>,
    ) -> HomeResolution {
        if let Some(path) =
            explicit.filter(|path| !path.as_os_str().to_string_lossy().trim().is_empty())
        {
            return match normalize(path.clone(), user_profile, current_dir) {
                Ok(path) => HomeResolution::Selected {
                    path,
                    source: HomeSource::Explicit,
                },
                Err(error) => HomeResolution::InspectionFailed {
                    path,
                    reason: format!("could not resolve relative DSH home: {error}"),
                },
            };
        }
        match fs::symlink_metadata(user_profile) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return HomeResolution::InspectionFailed {
                    path: user_profile.to_path_buf(),
                    reason: "user profile root is not a regular directory".to_owned(),
                };
            }
            Err(error) => {
                return HomeResolution::InspectionFailed {
                    path: user_profile.to_path_buf(),
                    reason: error.to_string(),
                };
            }
        }
        let standard = user_profile.join(".dsh");
        let policy = user_profile.join(".dsh-policy");
        let standard_has_data = match has_data(&standard) {
            Ok(value) => value,
            Err(error) => {
                return HomeResolution::InspectionFailed {
                    path: standard,
                    reason: error.to_string(),
                };
            }
        };
        let policy_has_data = match has_data(&policy) {
            Ok(value) => value,
            Err(error) => {
                return HomeResolution::InspectionFailed {
                    path: policy,
                    reason: error.to_string(),
                };
            }
        };
        match (standard_has_data, policy_has_data) {
            (true, true) => HomeResolution::ChoiceRequired { standard, policy },
            (false, true) => HomeResolution::Selected {
                path: policy,
                source: HomeSource::PolicyLegacy,
            },
            _ => HomeResolution::Selected {
                path: standard,
                source: HomeSource::Standard,
            },
        }
    }
}

fn has_data(path: &Path) -> Result<bool, std::io::Error> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Harness home is a symbolic link",
        )),
        Ok(metadata) if !metadata.is_dir() => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Harness home is not a directory",
        )),
        Ok(_) => Ok(fs::read_dir(path)?.next().transpose()?.is_some()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn normalize(
    path: PathBuf,
    user_profile: &Path,
    current_dir: impl FnOnce() -> Result<PathBuf, std::io::Error>,
) -> Result<PathBuf, std::io::Error> {
    let path = expand_home_prefix(path, user_profile);
    let absolute = if path.is_absolute() {
        path
    } else {
        current_dir()?.join(path)
    };
    let normalized = lexical_normalize(absolute);
    if normalized.is_absolute() {
        Ok(normalized)
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "resolved DSH home is not absolute",
        ))
    }
}

fn expand_home_prefix(path: PathBuf, user_profile: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path;
    };
    if text == "~" {
        return user_profile.to_path_buf();
    }
    let suffix = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\"));
    suffix
        .map(|suffix| user_profile.join(suffix))
        .unwrap_or(path)
}

fn lexical_normalize(path: PathBuf) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if normalized.file_name().is_some() {
                    normalized.pop();
                } else if !normalized.has_root() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::{HarnessHome, HomeResolution, HomeSource};
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn relative_explicit_home_is_anchored_to_the_managers_launch_directory() {
        let root = tempdir().unwrap();
        let launch_dir = root.path().join("manager");
        let resolution = HarnessHome::resolve_with_current_dir(
            Some(PathBuf::from("data").join("..").join("dsh")),
            root.path(),
            || Ok(launch_dir.clone()),
        );

        assert_eq!(
            resolution,
            HomeResolution::Selected {
                path: launch_dir.join("dsh"),
                source: HomeSource::Explicit,
            }
        );
    }

    #[test]
    fn tilde_explicit_home_is_expanded_from_the_os_user_profile() {
        let root = tempdir().unwrap();
        let resolution = HarnessHome::resolve_with_current_dir(
            Some(PathBuf::from("~/custom-dsh")),
            root.path(),
            || panic!("tilde expansion must not depend on the launch directory"),
        );

        assert_eq!(
            resolution,
            HomeResolution::Selected {
                path: root.path().join("custom-dsh"),
                source: HomeSource::Explicit,
            }
        );
    }

    #[test]
    fn relative_explicit_home_fails_closed_when_launch_directory_is_unavailable() {
        let root = tempdir().unwrap();
        let resolution = HarnessHome::resolve_with_current_dir(
            Some(PathBuf::from("dsh-data")),
            root.path(),
            || Err(std::io::Error::other("current directory unavailable")),
        );

        assert!(matches!(
            resolution,
            HomeResolution::InspectionFailed { reason, .. }
                if reason.contains("current directory unavailable")
        ));
    }

    #[test]
    fn relative_explicit_home_never_resolves_to_a_relative_result() {
        let root = tempdir().unwrap();
        let resolution = HarnessHome::resolve_with_current_dir(
            Some(PathBuf::from("dsh-data")),
            root.path(),
            || Ok(PathBuf::from("relative-launch-directory")),
        );

        assert!(matches!(
            resolution,
            HomeResolution::InspectionFailed { reason, .. }
                if reason.contains("absolute")
        ));
    }
}
