use crate::catalog::PolicyRelease;
use reqwest::redirect::Policy;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Read;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;

const MAX_PACKAGE_BYTES: u64 = 128 * 1024 * 1024;
const GITHUB_REPOSITORY: &str = "sdaniasdsd/DSH-Policy";

#[derive(Debug, Error)]
pub enum PolicyPackageError {
    #[error("Policy extension release metadata is invalid")]
    InvalidMetadata,
    #[error("Policy extension package download failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Policy extension package exceeds its declared size")]
    SizeMismatch,
    #[error("Policy extension package checksum does not match the signed catalog")]
    HashMismatch,
    #[error("Policy extension package could not be stored: {0}")]
    Io(#[from] std::io::Error),
}

pub trait PolicyPackageFetcher: Send + Sync {
    fn fetch(&self, release: &PolicyRelease, destination: &Path) -> Result<(), String>;
}

#[derive(Default)]
pub struct GithubPolicyPackageFetcher;

impl PolicyPackageFetcher for GithubPolicyPackageFetcher {
    fn fetch(&self, release: &PolicyRelease, destination: &Path) -> Result<(), String> {
        download_verified(release, destination).map_err(|error| error.to_string())
    }
}

pub fn expected_policy_asset_url(version: &str) -> String {
    format!(
        "https://github.com/{GITHUB_REPOSITORY}/releases/download/policy-extension-v{version}/dsh-policy-extension-{version}.tgz"
    )
}

pub fn validate_policy_release(release: &PolicyRelease) -> bool {
    safe_version(&release.version)
        && release.package == "@deepseek-ai/dsh-policy-extension"
        && release.tarball_url == expected_policy_asset_url(&release.version)
        && release.runtime_version.trim().len() > 0
        && release.runtime_commit.len() == 40
        && release.runtime_commit.bytes().all(|byte| byte.is_ascii_hexdigit())
        && release.sha256.len() == 64
        && release.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        && release.size > 0
        && release.size <= MAX_PACKAGE_BYTES
}

pub fn artifact_path(profile: &Path, release: &PolicyRelease) -> PathBuf {
    profile.join(".dsh-policy-artifacts").join(format!(
        "dsh-policy-extension-{}-{}.tgz",
        release.version,
        release.sha256.to_ascii_lowercase()
    ))
}

pub fn publish_staged_artifact(
    staged: &Path,
    destination: &Path,
    release: &PolicyRelease,
) -> Result<(), PolicyPackageError> {
    if !validate_policy_release(release) {
        return Err(PolicyPackageError::InvalidMetadata);
    }
    let metadata = fs::symlink_metadata(staged)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() != release.size {
        return Err(PolicyPackageError::InvalidMetadata);
    }
    let mut source = fs::File::open(staged)?;
    let mut bytes = Vec::with_capacity(release.size as usize);
    source.read_to_end(&mut bytes)?;
    verify_bytes(release, &bytes)?;
    let parent = destination.parent().ok_or(PolicyPackageError::InvalidMetadata)?;
    match fs::symlink_metadata(parent) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err(PolicyPackageError::InvalidMetadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(parent)?,
        Err(error) => return Err(PolicyPackageError::Io(error)),
    }
    if fs::symlink_metadata(destination).is_ok() {
        return Err(PolicyPackageError::InvalidMetadata);
    }
    let temporary = parent.join(format!("policy.{}.tmp", Uuid::new_v4()));
    let mut output = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    output.write_all(&bytes)?;
    output.sync_all()?;
    if let Err(error) = fs::rename(&temporary, destination) {
        let _ = fs::remove_file(&temporary);
        return Err(PolicyPackageError::Io(error));
    }
    fs::remove_file(staged)?;
    Ok(())
}

fn download_verified(
    release: &PolicyRelease,
    destination: &Path,
) -> Result<(), PolicyPackageError> {
    if !validate_policy_release(release) {
        return Err(PolicyPackageError::InvalidMetadata);
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .redirect(Policy::custom(|attempt| {
            let from = attempt.previous().last().map(|url| url.as_str());
            if from.is_none() && is_policy_asset_url(attempt.url().as_str())
                || from.is_some_and(|previous| approved_redirect(previous, attempt.url().as_str()))
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()?;
    let mut response = client.get(&release.tarball_url).send()?.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|length| length != release.size || length > MAX_PACKAGE_BYTES)
    {
        return Err(PolicyPackageError::SizeMismatch);
    }
    let mut bytes = Vec::with_capacity(release.size as usize);
    loop {
        let mut chunk = [0u8; 64 * 1024];
        let count = std::io::Read::read(&mut response, &mut chunk)?;
        if count == 0 {
            break;
        }
        if bytes.len().saturating_add(count) as u64 > release.size
            || bytes.len().saturating_add(count) as u64 > MAX_PACKAGE_BYTES
        {
            return Err(PolicyPackageError::SizeMismatch);
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    if bytes.len() as u64 != release.size {
        return Err(PolicyPackageError::SizeMismatch);
    }
    verify_bytes(release, &bytes)?;

    let parent = destination.parent().ok_or(PolicyPackageError::InvalidMetadata)?;
    match fs::symlink_metadata(parent) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err(PolicyPackageError::InvalidMetadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir_all(parent)?,
        Err(error) => return Err(PolicyPackageError::Io(error)),
    }
    if fs::symlink_metadata(destination).is_ok() {
        return Err(PolicyPackageError::InvalidMetadata);
    }
    let temporary = parent.join(format!("{}.{}.tmp", destination.file_name().and_then(|name| name.to_str()).ok_or(PolicyPackageError::InvalidMetadata)?, Uuid::new_v4()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temporary, destination)?;
    Ok(())
}

fn verify_bytes(release: &PolicyRelease, bytes: &[u8]) -> Result<(), PolicyPackageError> {
    if bytes.len() as u64 != release.size { return Err(PolicyPackageError::SizeMismatch); }
    let digest = Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    if !digest.eq_ignore_ascii_case(&release.sha256) { return Err(PolicyPackageError::HashMismatch); }
    Ok(())
}

fn safe_version(value: &str) -> bool {
    !value.is_empty()
        && value.as_bytes()[0].is_ascii_digit()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
}

fn is_policy_asset_url(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path().starts_with(&format!("/{GITHUB_REPOSITORY}/releases/download/policy-extension-v"))
}

fn approved_redirect(from: &str, to: &str) -> bool {
    let Ok(from_url) = url::Url::parse(from) else { return false; };
    let Ok(url) = url::Url::parse(to) else {
        return false;
    };
    let source_allowed = is_policy_asset_url(from)
        || from_url.scheme() == "https"
            && matches!(from_url.host_str(), Some("objects.githubusercontent.com" | "release-assets.githubusercontent.com"))
            && from_url.username().is_empty()
            && from_url.password().is_none()
            && from_url.port().is_none();
    source_allowed
        && url.scheme() == "https"
        && matches!(url.host_str(), Some("objects.githubusercontent.com" | "release-assets.githubusercontent.com"))
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release() -> PolicyRelease {
        PolicyRelease {
            package: "@deepseek-ai/dsh-policy-extension".into(),
            version: "1.0.3".into(),
            runtime_version: "0.2.1-rc.2".into(),
            runtime_commit: "0123456789abcdef0123456789abcdef01234567".into(),
            tarball_url: expected_policy_asset_url("1.0.3"),
            sha256: "a".repeat(64),
            size: 100,
        }
    }

    #[test]
    fn derives_an_unambiguous_profile_local_artifact_name() {
        let path = artifact_path(Path::new("C:/dsh"), &release());
        assert!(path.ends_with(".dsh-policy-artifacts/dsh-policy-extension-1.0.3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.tgz"));
    }

    #[test]
    fn accepts_only_the_exact_first_party_asset_for_a_safe_version() {
        let mut candidate = release();
        assert!(validate_policy_release(&candidate));
        candidate.tarball_url = "https://example.invalid/payload.tgz".into();
        assert!(!validate_policy_release(&candidate));
        candidate = release();
        candidate.version = "1.0.3/../../evil".into();
        assert!(!validate_policy_release(&candidate));
    }
}
