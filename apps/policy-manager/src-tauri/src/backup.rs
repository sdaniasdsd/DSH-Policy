use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tempfile::Builder;
use thiserror::Error;
use uuid::Uuid;

const MAGIC: &[u8; 8] = b"DSHBK001";
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
const MAX_FILE_COUNT: usize = 1_000_000;
const MAX_PATH_BYTES: usize = 32 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: Uuid,
    pub archive_path: PathBuf,
    pub source_path: PathBuf,
    pub created_at: u64,
    pub archive_digest: String,
}

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("backup I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("home contains a symbolic link or unsupported file: {0}")]
    UnsupportedEntry(PathBuf),
    #[error("backup encryption failed: {0}")]
    Encrypt(String),
    #[error("backup decryption failed: {0}")]
    Decrypt(String),
    #[error("backup archive is invalid: {0}")]
    InvalidArchive(String),
    #[error("backup content digest does not match")]
    DigestMismatch,
    #[error("restore destination already exists")]
    DestinationExists,
    #[error("backup record points outside the configured backup store")]
    InvalidRecordPath,
    #[error("backup archive exceeds a supported limit")]
    LimitExceeded,
}

pub trait DataProtector: Send + Sync {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String>;
    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String>;
}

pub struct BackupStore {
    directory: PathBuf,
    protector: Arc<dyn DataProtector>,
}

impl BackupStore {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            protector: Arc::new(DpapiProtector),
        }
    }

    pub fn with_protector(directory: PathBuf, protector: Arc<dyn DataProtector>) -> Self {
        Self {
            directory,
            protector,
        }
    }

    pub fn create(&self, home: &Path) -> Result<BackupRecord, BackupError> {
        let mut files = Vec::new();
        match fs::symlink_metadata(home) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
                collect_files(home, home, &mut files)?;
            }
            Ok(_) => return Err(BackupError::UnsupportedEntry(home.to_path_buf())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(BackupError::Io(error)),
        }
        files.sort_by(|left, right| left.0.cmp(&right.0));
        let digest = digest_files(&files);
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| {
                BackupError::InvalidArchive("system clock predates Unix epoch".to_owned())
            })?
            .as_secs();
        let manifest = BackupManifest {
            schema_version: 1,
            source_path: home.to_path_buf(),
            created_at,
            archive_digest: hex(&digest),
            file_count: files.len() as u64,
        };
        let plaintext = encode_archive(&manifest, &files)?;
        let encrypted = self
            .protector
            .protect(&plaintext)
            .map_err(BackupError::Encrypt)?;
        fs::create_dir_all(&self.directory)?;
        let id = Uuid::new_v4();
        let archive_path = self.directory.join(format!("backup-{id}.dshb"));
        let temp_path = self.directory.join(format!(".{id}.tmp"));
        let result = write_new_synced(&temp_path, &encrypted)
            .and_then(|()| fs::rename(&temp_path, &archive_path));
        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }
        result?;
        Ok(BackupRecord {
            id,
            archive_path,
            source_path: home.to_path_buf(),
            created_at,
            archive_digest: hex(&digest),
        })
    }

    pub fn list(&self) -> Result<Vec<BackupRecord>, BackupError> {
        let entries = match fs::read_dir(&self.directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(BackupError::Io(error)),
        };
        let mut records = Vec::new();
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Some(id_text) = name
                .strip_prefix("backup-")
                .and_then(|name| name.strip_suffix(".dshb"))
            else {
                continue;
            };
            let id = Uuid::parse_str(id_text).map_err(|_| BackupError::InvalidRecordPath)?;
            let metadata = fs::symlink_metadata(&path)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(BackupError::InvalidRecordPath);
            }
            let mut encrypted = Vec::new();
            File::open(&path)?.read_to_end(&mut encrypted)?;
            let plaintext = self
                .protector
                .unprotect(&encrypted)
                .map_err(BackupError::Decrypt)?;
            let (manifest, files) = decode_archive(&plaintext)?;
            let digest = hex(&digest_files(&files));
            if manifest.schema_version != 1
                || manifest.archive_digest != digest
                || manifest.file_count != files.len() as u64
            {
                return Err(BackupError::DigestMismatch);
            }
            records.push(BackupRecord {
                id,
                archive_path: path,
                source_path: manifest.source_path,
                created_at: manifest.created_at,
                archive_digest: digest,
            });
        }
        records.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(records)
    }

    pub fn restore(&self, record: &BackupRecord, destination: &Path) -> Result<(), BackupError> {
        let root = fs::canonicalize(&self.directory)?;
        let archive_path = fs::canonicalize(&record.archive_path)?;
        if archive_path.parent() != Some(root.as_path())
            || !record
                .archive_path
                .file_name()
                .is_some_and(|name| name.to_string_lossy() == format!("backup-{}.dshb", record.id))
        {
            return Err(BackupError::InvalidRecordPath);
        }
        match fs::symlink_metadata(destination) {
            Ok(_) => return Err(BackupError::DestinationExists),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(BackupError::Io(error)),
        }
        let mut encrypted = Vec::new();
        File::open(archive_path)?.read_to_end(&mut encrypted)?;
        let plaintext = self
            .protector
            .unprotect(&encrypted)
            .map_err(BackupError::Decrypt)?;
        let (manifest, files) = decode_archive(&plaintext)?;
        if manifest.schema_version != 1
            || manifest.archive_digest != record.archive_digest
            || manifest.source_path != record.source_path
            || manifest.created_at != record.created_at
            || manifest.file_count != files.len() as u64
        {
            return Err(BackupError::DigestMismatch);
        }
        let actual_digest = hex(&digest_files(&files));
        if actual_digest != manifest.archive_digest {
            return Err(BackupError::DigestMismatch);
        }
        let parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let staging = Builder::new().prefix(".dsh-restore-").tempdir_in(parent)?;
        for (relative, bytes) in &files {
            let safe = safe_relative_path(relative)?;
            let output = staging.path().join(safe);
            let output_parent = output.parent().ok_or_else(|| {
                BackupError::InvalidArchive("archive path has no parent".to_owned())
            })?;
            fs::create_dir_all(output_parent)?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)?;
            file.write_all(bytes)?;
            file.sync_all()?;
        }
        let staging_path = staging.keep();
        if let Err(error) = fs::rename(&staging_path, destination) {
            let _ = fs::remove_dir_all(&staging_path);
            return Err(BackupError::Io(error));
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    schema_version: u32,
    source_path: PathBuf,
    created_at: u64,
    archive_digest: String,
    file_count: u64,
}

fn collect_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), BackupError> {
    let mut entries = fs::read_dir(current)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if path
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("node_modules"))
            && (metadata.is_dir() || metadata.file_type().is_symlink())
        {
            continue;
        }
        if metadata.file_type().is_symlink() {
            return Err(BackupError::UnsupportedEntry(path));
        }
        if metadata.is_dir() {
            collect_files(root, &path, files)?;
        } else if metadata.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| BackupError::UnsupportedEntry(path.clone()))?;
            let name = relative.to_string_lossy().replace('\\', "/");
            if name.len() > MAX_PATH_BYTES {
                return Err(BackupError::LimitExceeded);
            }
            files.push((name, fs::read(path)?));
        } else {
            return Err(BackupError::UnsupportedEntry(path));
        }
        if files.len() > MAX_FILE_COUNT {
            return Err(BackupError::LimitExceeded);
        }
    }
    Ok(())
}

fn digest_files(files: &[(String, Vec<u8>)]) -> [u8; 32] {
    let mut digest = Sha256::new();
    for (path, bytes) in files {
        digest.update((path.len() as u64).to_le_bytes());
        digest.update(path.as_bytes());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
    digest.finalize().into()
}

fn encode_archive(
    manifest: &BackupManifest,
    files: &[(String, Vec<u8>)],
) -> Result<Vec<u8>, BackupError> {
    let manifest = serde_json::to_vec(manifest)
        .map_err(|error| BackupError::InvalidArchive(error.to_string()))?;
    if manifest.len() > MAX_MANIFEST_BYTES {
        return Err(BackupError::LimitExceeded);
    }
    let mut output = MAGIC.to_vec();
    output.extend_from_slice(&(manifest.len() as u32).to_le_bytes());
    output.extend_from_slice(&manifest);
    output.extend_from_slice(&(files.len() as u32).to_le_bytes());
    for (path, bytes) in files {
        output.extend_from_slice(&(path.len() as u32).to_le_bytes());
        output.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        output.extend_from_slice(path.as_bytes());
        output.extend_from_slice(bytes);
    }
    Ok(output)
}

fn decode_archive(bytes: &[u8]) -> Result<(BackupManifest, Vec<(String, Vec<u8>)>), BackupError> {
    let mut cursor = 0;
    if take(bytes, &mut cursor, 8)? != MAGIC {
        return Err(BackupError::InvalidArchive(
            "unknown backup format".to_owned(),
        ));
    }
    let manifest_len = read_u32(bytes, &mut cursor)? as usize;
    if manifest_len > MAX_MANIFEST_BYTES {
        return Err(BackupError::LimitExceeded);
    }
    let manifest: BackupManifest = serde_json::from_slice(take(bytes, &mut cursor, manifest_len)?)
        .map_err(|error| BackupError::InvalidArchive(error.to_string()))?;
    let count = read_u32(bytes, &mut cursor)? as usize;
    if count > MAX_FILE_COUNT {
        return Err(BackupError::LimitExceeded);
    }
    let mut files = Vec::with_capacity(count);
    for _ in 0..count {
        let path_len = read_u32(bytes, &mut cursor)? as usize;
        let content_len = read_u64(bytes, &mut cursor)? as usize;
        if path_len == 0 || path_len > MAX_PATH_BYTES || content_len > bytes.len() {
            return Err(BackupError::LimitExceeded);
        }
        let path = std::str::from_utf8(take(bytes, &mut cursor, path_len)?)
            .map_err(|error| BackupError::InvalidArchive(error.to_string()))?
            .to_owned();
        safe_relative_path(&path)?;
        let content = take(bytes, &mut cursor, content_len)?.to_vec();
        files.push((path, content));
    }
    if cursor != bytes.len() {
        return Err(BackupError::InvalidArchive(
            "trailing archive data".to_owned(),
        ));
    }
    Ok((manifest, files))
}

fn safe_relative_path(value: &str) -> Result<PathBuf, BackupError> {
    if value.contains('\\') || value.contains(':') || value.starts_with('/') {
        return Err(BackupError::InvalidArchive(
            "archive path is not relative".to_owned(),
        ));
    }
    let path = Path::new(value);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(BackupError::InvalidArchive(
            "archive path contains traversal".to_owned(),
        ));
    }
    Ok(path.to_path_buf())
}

fn take<'a>(bytes: &'a [u8], cursor: &mut usize, length: usize) -> Result<&'a [u8], BackupError> {
    let end = cursor
        .checked_add(length)
        .ok_or(BackupError::LimitExceeded)?;
    let slice = bytes
        .get(*cursor..end)
        .ok_or_else(|| BackupError::InvalidArchive("truncated archive".to_owned()))?;
    *cursor = end;
    Ok(slice)
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, BackupError> {
    Ok(u32::from_le_bytes(
        take(bytes, cursor, 4)?.try_into().unwrap(),
    ))
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> Result<u64, BackupError> {
    Ok(u64::from_le_bytes(
        take(bytes, cursor, 8)?.try_into().unwrap(),
    ))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> Result<(), std::io::Error> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::safe_relative_path;

    #[test]
    fn rejects_absolute_and_traversing_archive_paths() {
        for path in [
            "../outside",
            "profiles/../../outside",
            "C:/outside",
            "/outside",
        ] {
            assert!(safe_relative_path(path).is_err(), "accepted {path}");
        }
        assert!(safe_relative_path("profiles/desktop/package.json").is_ok());
    }
}

#[cfg(windows)]
pub struct DpapiProtector;

#[cfg(not(windows))]
pub struct DpapiProtector;

#[cfg(windows)]
impl DataProtector for DpapiProtector {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        use std::ffi::c_void;
        use windows_sys::Win32::Foundation::LocalFree;
        use windows_sys::Win32::Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData,
        };
        if plaintext.len() > u32::MAX as usize {
            return Err("input exceeds DPAPI size limit".to_owned());
        }
        let input = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut::<c_void>(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(format!("CryptProtectData failed with {}", unsafe {
                windows_sys::Win32::Foundation::GetLastError()
            }));
        }
        let result =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            LocalFree(output.pbData as *mut c_void);
        }
        Ok(result)
    }

    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        use std::ffi::c_void;
        use windows_sys::Win32::Foundation::LocalFree;
        use windows_sys::Win32::Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData,
        };
        if ciphertext.len() > u32::MAX as usize {
            return Err("input exceeds DPAPI size limit".to_owned());
        }
        let input = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut::<c_void>(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(format!("CryptUnprotectData failed with {}", unsafe {
                windows_sys::Win32::Foundation::GetLastError()
            }));
        }
        let result =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            LocalFree(output.pbData as *mut c_void);
        }
        Ok(result)
    }
}

#[cfg(not(windows))]
impl DataProtector for DpapiProtector {
    fn protect(&self, _plaintext: &[u8]) -> Result<Vec<u8>, String> {
        Err("Windows DPAPI is only available on Windows".to_owned())
    }

    fn unprotect(&self, _ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        Err("Windows DPAPI is only available on Windows".to_owned())
    }
}
