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

impl InstalledDsh {
    pub fn detect(registry: &dyn InstallRegistry) -> Result<Option<Self>, DetectError> {
        let mut matches = registry
            .installations()
            .map_err(DetectError::Registry)?
            .into_iter()
            .filter(|entry| {
                entry
                    .display_name
                    .trim()
                    .eq_ignore_ascii_case("DeepSeek Harness")
            });
        let Some(record) = matches.next() else {
            return Ok(None);
        };
        if matches.next().is_some() {
            return Err(DetectError::AmbiguousInstall);
        }
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

        let fallback_version = record.display_version.trim().to_owned();
        let mut installed = Self {
            install_location: record.install_location.clone(),
            desktop_version: fallback_version,
            runtime_version: None,
            runtime_commit: None,
            build_dirty: false,
        };

        let archive = record.install_location.join("resources").join("app.asar");
        match read_manifests(&archive) {
            Ok((desktop_manifest, runtime_manifest)) => {
                if let Some(version) = non_empty_string(&desktop_manifest, "version") {
                    installed.desktop_version = version.to_owned();
                }
                if let Some(version) = non_empty_string(&runtime_manifest, "version") {
                    installed.runtime_version = Some(version.to_owned());
                }
                installed.runtime_commit = non_empty_string(&desktop_manifest, "dshBuildCommit")
                    .filter(|commit| is_hex(commit, 40))
                    .map(ToOwned::to_owned);
                installed.build_dirty = desktop_manifest
                    .get("dshBuildDirty")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
            }
            Err(_) => {}
        }

        Ok(Some(installed))
    }
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

fn read_manifests(archive: &Path) -> Result<(serde_json::Value, serde_json::Value), String> {
    let mut file = File::open(archive).map_err(|error| error.to_string())?;
    let mut prefix = [0; 8];
    file.read_exact(&mut prefix)
        .map_err(|error| error.to_string())?;
    let pickle_size = u32::from_le_bytes(prefix[0..4].try_into().unwrap()) as usize;
    let header_size = u32::from_le_bytes(prefix[4..8].try_into().unwrap()) as usize;
    if pickle_size != header_size.saturating_add(4)
        || header_size == 0
        || header_size > MAX_ASAR_HEADER_BYTES
    {
        return Err("invalid or oversized ASAR header".to_owned());
    }
    let mut header_bytes = vec![0; header_size];
    file.read_exact(&mut header_bytes)
        .map_err(|error| error.to_string())?;
    let header: serde_json::Value =
        serde_json::from_slice(&header_bytes).map_err(|error| error.to_string())?;
    let payload_start = file.stream_position().map_err(|error| error.to_string())?;
    let desktop = read_asar_entry(&mut file, &header, payload_start, "package.json")?;
    let runtime = read_asar_entry(&mut file, &header, payload_start, "dsh/package.json")?;
    let desktop: serde_json::Value =
        serde_json::from_slice(&desktop).map_err(|error| error.to_string())?;
    let runtime: serde_json::Value =
        serde_json::from_slice(&runtime).map_err(|error| error.to_string())?;
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
                if !display_name.trim().eq_ignore_ascii_case("DeepSeek Harness") {
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
