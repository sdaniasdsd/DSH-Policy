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
        if let Some(path) =
            explicit.filter(|path| !path.as_os_str().to_string_lossy().trim().is_empty())
        {
            return HomeResolution::Selected {
                path: normalize(path),
                source: HomeSource::Explicit,
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

fn normalize(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    }
}
