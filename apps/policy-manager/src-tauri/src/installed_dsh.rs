use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use thiserror::Error;

const MAX_ASAR_HEADER_BYTES: usize = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstallRecord {
    pub display_name: String,
    pub display_version: String,
    pub install_location: PathBuf,
}

pub trait InstallRegistry {
    fn installations(&self) -> Result<Vec<InstallRecord>, String>;
}

#[derive(Debug, Error)]
pub enum DetectError {
    #[error("could not read installed application registry entries: {0}")]
    Registry(String),
    #[error("more than one official DSH installation is registered")]
    AmbiguousInstall,
    #[error("registered DSH installation is invalid: {0}")]
    InvalidInstall(String),
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledDsh {
    pub install_location: PathBuf,
    pub desktop_version: String,
    pub runtime_version: Option<String>,
    pub runtime_commit: Option<String>,
    pub build_dirty: bool,
}

/// The application edition established from its registration and available ASAR identity.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallationEdition {
    Official,
    Policy,
}

/// A registered installation and its edition, retaining the original display name.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedInstallation {
    pub installed: InstalledDsh,
    pub edition: InstallationEdition,
    pub display_name: String,
}

impl InstalledDsh {
    /// Lists registered DSH editions after checking their executable and available application identity.
    pub fn discover(
        registry: &dyn InstallRegistry,
    ) -> Result<Vec<DetectedInstallation>, DetectError> {
        discover_records(registry.installations().map_err(DetectError::Registry)?)
    }

    /// Returns the only official installation, independently of separately installed Policy editions.
    pub fn detect(registry: &dyn InstallRegistry) -> Result<Option<Self>, DetectError> {
        let records = registry
            .installations()
            .map_err(DetectError::Registry)?
            .into_iter()
            .filter(|record| {
                candidate_edition(&record.display_name) == Some(InstallationEdition::Official)
            })
            .collect();
        let mut matches = discover_records(records)?.into_iter();
        let Some(found) = matches.next() else {
            return Ok(None);
        };
        if matches.next().is_some() {
            return Err(DetectError::AmbiguousInstall);
        }
        Ok(Some(found.installed))
    }
}

fn candidate_edition(display_name: &str) -> Option<InstallationEdition> {
    let display_name = display_name.trim();
    for (root, edition) in [
        ("DeepSeek Harness", InstallationEdition::Official),
        ("DSH Policy Edition", InstallationEdition::Policy),
    ] {
        if display_name.eq_ignore_ascii_case(root) {
            return Some(edition);
        }
        if let Some(prefix) = display_name.get(..root.len()) {
            if prefix.eq_ignore_ascii_case(root) {
                if let Some(version) = display_name[root.len()..].strip_prefix(' ') {
                    if is_version_suffix(version) {
                        return Some(edition);
                    }
                }
            }
        }
    }
    None
}

fn is_version_suffix(version: &str) -> bool {
    let valid_identifiers = |value: &str| {
        value.split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    };
    let (version, build) = version
        .split_once('+')
        .map_or((version, None), |(version, build)| (version, Some(build)));
    let (core, prerelease) = version
        .split_once('-')
        .map_or((version, None), |(core, prerelease)| {
            (core, Some(prerelease))
        });
    core.split('.').count() >= 2
        && core
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && build.is_none_or(valid_identifiers)
        && prerelease.is_none_or(valid_identifiers)
}

fn manifest_edition(manifest: &serde_json::Value) -> Option<InstallationEdition> {
    match (
        non_empty_string(manifest, "name"),
        non_empty_string(manifest, "dshDesktopAppId"),
        manifest.get("dshPolicyEdition"),
    ) {
        (
            Some("@deepseek-ai/dsh-desktop"),
            Some("com.deepseek.dsh"),
            None | Some(serde_json::Value::Bool(false)),
        ) => Some(InstallationEdition::Official),
        (
            Some("dsh-policy-desktop"),
            Some("io.github.sdaniasdsd.dshchange"),
            Some(serde_json::Value::Bool(true)),
        ) => Some(InstallationEdition::Policy),
        _ => None,
    }
}

fn discover_records(records: Vec<InstallRecord>) -> Result<Vec<DetectedInstallation>, DetectError> {
    let mut discovered = Vec::new();
    for record in records {
        let Some(edition) = candidate_edition(&record.display_name) else {
            continue;
        };
        if record.install_location.as_os_str().is_empty() {
            return Err(DetectError::InvalidInstall(
                "registry entry has no InstallLocation".to_owned(),
            ));
        }
        if !record
            .install_location
            .join("DeepSeek Harness.exe")
            .is_file()
        {
            return Err(DetectError::InvalidInstall(
                "DeepSeek Harness.exe is missing".to_owned(),
            ));
        }
        let mut installed = InstalledDsh {
            install_location: record.install_location.clone(),
            desktop_version: record.display_version.trim().to_owned(),
            runtime_version: None,
            runtime_commit: None,
            build_dirty: false,
        };
        let archive = record.install_location.join("resources/app.asar");
        match read_manifests(&archive) {
            Ok((desktop_manifest, runtime_manifest)) => {
                if manifest_edition(&desktop_manifest) != Some(edition) {
                    return Err(DetectError::InvalidInstall(format!(
                        "application identity does not match registered edition: {}",
                        record.display_name
                    )));
                }
                if let Some(version) = non_empty_string(&desktop_manifest, "version") {
                    installed.desktop_version = version.to_owned();
                }
                installed.runtime_version = runtime_manifest
                    .as_ref()
                    .and_then(|manifest| non_empty_string(manifest, "version"))
                    .map(ToOwned::to_owned);
                installed.runtime_commit = non_empty_string(&desktop_manifest, "dshBuildCommit")
                    .filter(|commit| is_hex(commit, 40))
                    .map(ToOwned::to_owned);
                installed.build_dirty = desktop_manifest
                    .get("dshBuildDirty")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
            }
            Err(error) if edition == InstallationEdition::Policy => {
                return Err(DetectError::InvalidInstall(format!(
                    "Policy application identity could not be verified: {error}"
                )));
            }
            Err(_error) => {
                // An official registration remains launchable when its runtime identity is unavailable.
            }
        }
        discovered.push(DetectedInstallation {
            installed,
            edition,
            display_name: record.display_name,
        });
    }
    Ok(discovered)
}

fn non_empty_string<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_manifests(
    archive: &Path,
) -> Result<(serde_json::Value, Option<serde_json::Value>), String> {
    let mut file = File::open(archive).map_err(|error| error.to_string())?;
    let mut prefix = [0; 8];
    file.read_exact(&mut prefix)
        .map_err(|error| error.to_string())?;
    let pickle_size = u32::from_le_bytes(prefix[0..4].try_into().unwrap()) as usize;
    let header_size = u32::from_le_bytes(prefix[4..8].try_into().unwrap()) as usize;
    if pickle_size != 4
        || header_size < 8
        || header_size % 4 != 0
        || header_size > MAX_ASAR_HEADER_BYTES
    {
        return Err("invalid or oversized ASAR header".to_owned());
    }
    let mut header_bytes = vec![0; header_size];
    file.read_exact(&mut header_bytes)
        .map_err(|error| error.to_string())?;
    let payload_size = u32::from_le_bytes(header_bytes[0..4].try_into().unwrap()) as usize;
    let json_size = u32::from_le_bytes(header_bytes[4..8].try_into().unwrap()) as usize;
    let aligned_json_size = json_size.checked_add(3).map(|size| size & !3);
    if payload_size != header_size - 4
        || json_size == 0
        || aligned_json_size.and_then(|size| size.checked_add(8)) != Some(header_size)
    {
        return Err("invalid ASAR header pickle lengths".to_owned());
    }
    let header: serde_json::Value = serde_json::from_slice(&header_bytes[8..8 + json_size])
        .map_err(|error| error.to_string())?;
    let payload_start = file.stream_position().map_err(|error| error.to_string())?;
    let desktop = read_asar_entry(&mut file, &header, payload_start, "package.json")?;
    let desktop: serde_json::Value =
        serde_json::from_slice(&desktop).map_err(|error| error.to_string())?;
    let runtime = read_asar_entry(&mut file, &header, payload_start, "dsh/package.json")
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    Ok((desktop, runtime))
}

fn read_asar_entry(
    file: &mut File,
    header: &serde_json::Value,
    payload_start: u64,
    path: &str,
) -> Result<Vec<u8>, String> {
    let mut node = header
        .get("files")
        .ok_or_else(|| "ASAR has no files tree".to_owned())?;
    for part in path.split('/') {
        node = node
            .get(part)
            .and_then(|entry| entry.get("files").or(Some(entry)))
            .ok_or_else(|| format!("ASAR entry is missing: {path}"))?;
    }
    let size = node
        .get("size")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| format!("ASAR entry size is invalid: {path}"))?;
    let offset = node
        .get("offset")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("ASAR entry offset is invalid: {path}"))?;
    let offset = offset
        .parse::<u64>()
        .map_err(|_| format!("ASAR entry offset is invalid: {path}"))?;
    if size == 0 || size > MAX_MANIFEST_BYTES as u64 {
        return Err(format!("ASAR manifest size is invalid: {path}"));
    }
    let absolute_offset = payload_start
        .checked_add(offset)
        .ok_or_else(|| "ASAR entry offset overflow".to_owned())?;
    file.seek(SeekFrom::Start(absolute_offset))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0; size as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

#[cfg(windows)]
pub struct WindowsInstallRegistry;

#[cfg(windows)]
impl InstallRegistry for WindowsInstallRegistry {
    fn installations(&self) -> Result<Vec<InstallRecord>, String> {
        use winreg::RegKey;
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

        const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
        let mut entries = Vec::new();
        let mut opened_hive = false;
        let mut first_open_error = None;
        for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            let root = match RegKey::predef(hive).open_subkey(UNINSTALL_KEY) {
                Ok(root) => {
                    opened_hive = true;
                    root
                }
                Err(error) => {
                    first_open_error.get_or_insert_with(|| error.to_string());
                    continue;
                }
            };
            for key_name in root.enum_keys() {
                let key_name = key_name.map_err(|error| error.to_string())?;
                let Ok(key) = root.open_subkey(key_name) else {
                    continue;
                };
                let display_name: String = match key.get_value("DisplayName") {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                if candidate_edition(&display_name).is_none() {
                    continue;
                }
                let display_version = key.get_value("DisplayVersion").unwrap_or_default();
                let install_location = key
                    .get_value::<String, _>("InstallLocation")
                    .map_err(|error| error.to_string())?;
                entries.push(InstallRecord {
                    display_name,
                    display_version,
                    install_location: PathBuf::from(install_location),
                });
            }
        }
        if !opened_hive {
            return Err(first_open_error
                .unwrap_or_else(|| "uninstall registry key is unavailable".to_owned()));
        }
        Ok(entries)
    }
}
