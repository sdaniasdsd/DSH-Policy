use crate::catalog::{PolicyRelease, ReleaseCatalog};
use crate::installed_dsh::InstalledDsh;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ManagerMode {
    Official,
    Policy,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSnapshot {
    pub mode: ManagerMode,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagerState {
    pub installed: Option<InstalledDsh>,
    pub home: PathBuf,
    pub mode: ManagerMode,
    pub requested_mode: ManagerMode,
    pub policy_compatible: bool,
    pub compatible_policy: Option<PolicyRelease>,
}

impl ManagerState {
    pub fn inspect(
        installed: Option<InstalledDsh>,
        home: PathBuf,
        profile: ProfileSnapshot,
        catalog: &ReleaseCatalog,
    ) -> Self {
        let catalog_is_current = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|now| catalog.expires_at > now.as_secs())
            .unwrap_or(false);
        let compatible_policy = installed.as_ref().and_then(|runtime| {
            if !catalog_is_current {
                return None;
            }
            if runtime.build_dirty {
                return None;
            }
            let version = runtime.runtime_version.as_deref()?;
            let commit = runtime.runtime_commit.as_deref()?;
            catalog.policy_for(version, commit).cloned()
        });
        let policy_compatible = compatible_policy.is_some();
        let mode = match profile.mode {
            ManagerMode::Policy if policy_compatible => ManagerMode::Policy,
            _ => ManagerMode::Official,
        };
        Self {
            installed,
            home,
            mode,
            requested_mode: profile.mode,
            policy_compatible,
            compatible_policy,
        }
    }
}
