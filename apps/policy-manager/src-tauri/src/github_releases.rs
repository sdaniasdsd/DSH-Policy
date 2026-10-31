//! Read-only GitHub release discovery, separate from the signed install catalog.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;

/// The only repository used for Policy distribution discovery.
pub const POLICY_REPOSITORY: &str = "sdaniasdsd/DSH-Policy";
const RELEASES_API_URL: &str = "https://api.github.com/repos/sdaniasdsd/DSH-Policy/releases";
const TAGS_API_URL: &str = "https://api.github.com/repos/sdaniasdsd/DSH-Policy/tags";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 5;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

/// An anonymous GitHub inventory; entries are not signed install or compatibility records.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubReleaseIndex {
    pub repository: String,
    pub checked_at: u64,
    pub releases: Vec<GithubPolicyRelease>,
    #[serde(default)]
    pub policy_extensions: Vec<GithubPolicyExtensionRelease>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPolicyExtensionRelease {
    pub tag: String,
    pub version: String,
    pub package: String,
    pub name: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub html_url: String,
    /// This is the extension source-tag commit, not the DSH runtime build commit.
    pub source_commit: Option<String>,
    /// Public GitHub discovery does not authorize or establish runtime compatibility.
    pub runtime_version: Option<String>,
    pub runtime_commit: Option<String>,
    pub tarball: Option<GithubInstaller>,
}

/// A published Policy distribution, which is distinct from an official DSH release.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPolicyRelease {
    pub tag: String,
    pub version: String,
    pub name: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub html_url: String,
    pub source_commit: Option<String>,
    pub official_base: Option<OfficialBase>,
    pub installer: Option<GithubInstaller>,
}

/// Historical upstream information, never permission to activate an extension.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialBase {
    pub version: String,
    pub tag: String,
    pub commit: Option<String>,
    pub source_url: String,
    pub verification: BaseVerification,
    pub note: String,
}

/// A source declaration is distinct from a verified upstream commit.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BaseVerification {
    Declared,
    Verified,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyBaseRecord {
    policy_tag: String,
    policy_commit: String,
    official_base: OfficialBase,
}

fn official_bases() -> Result<Vec<PolicyBaseRecord>, GithubReleasesError> {
    Ok(serde_json::from_str(include_str!(
        "../../catalog/policy-bases.json"
    ))?)
}

/// A download source advertised by GitHub, without permission to execute it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubInstaller {
    pub name: String,
    pub url: String,
    pub sha256: Option<String>,
    pub size: u64,
}

/// Discovery failures preserve the distinction between unavailable data and an empty inventory.
#[derive(Debug, Error)]
pub enum GithubReleasesError {
    #[error("GitHub release discovery failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("GitHub release response is invalid: {0}")]
    InvalidResponse(#[from] serde_json::Error),
    #[error("GitHub release response exceeded its size limit")]
    ResponseTooLarge,
    #[error("GitHub release discovery exceeded its pagination limit")]
    PaginationLimit,
    #[error("system clock predates Unix epoch")]
    InvalidClock,
}

/// Fetches only public metadata from the fixed Policy repository, without credentials.
pub struct GithubReleasesClient {
    client: reqwest::Client,
}

impl GithubReleasesClient {
    /// Creates a bounded, anonymous client that does not follow API redirects.
    pub fn new() -> Result<Self, GithubReleasesError> {
        let client = reqwest::Client::builder()
            .user_agent("DSH-Policy-Manager/release-discovery")
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self { client })
    }

    /// Discovers published distributions, including explicitly marked previews.
    ///
    /// Pagination is capped at 500 records. Exceeding that bound returns an error
    /// instead of presenting an incomplete result as a complete inventory.
    pub async fn fetch(&self) -> Result<GithubReleaseIndex, GithubReleasesError> {
        let bases = official_bases()?;
        let source_tags = self.fetch_source_tags().await?;
        let mut releases = Vec::new();
        let mut policy_extensions = Vec::new();
        let mut tags = HashSet::new();
        for page in 1..=MAX_PAGES {
            let response = self
                .client
                .get(RELEASES_API_URL)
                .header(reqwest::header::ACCEPT, "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .query(&[("per_page", PAGE_SIZE), ("page", page)])
                .send()
                .await?
                .error_for_status()?;
            let bytes = read_bounded(response).await?;
            let raw = parse_api_page(&bytes)?;
            let complete = raw.len() < PAGE_SIZE;
            for release in raw {
                let release = resolve_release_source(release, &source_tags);
                if let Some(extension) = policy_extension_release(&release) {
                    if tags.insert(extension.tag.clone()) {
                        policy_extensions.push(extension);
                    }
                    continue;
                }
                if let Some(policy) = policy_release(release, &bases) {
                    if tags.insert(policy.tag.clone()) {
                        releases.push(policy);
                    }
                }
            }
            if complete {
                let checked_at = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|_| GithubReleasesError::InvalidClock)?
                    .as_secs();
                return Ok(GithubReleaseIndex {
                    repository: POLICY_REPOSITORY.to_owned(),
                    checked_at,
                    releases,
                    policy_extensions,
                });
            }
        }
        Err(GithubReleasesError::PaginationLimit)
    }

    async fn fetch_source_tags(&self) -> Result<HashMap<String, String>, GithubReleasesError> {
        let mut commits = HashMap::new();
        for page in 1..=MAX_PAGES {
            let response = self
                .client
                .get(TAGS_API_URL)
                .header(reqwest::header::ACCEPT, "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .query(&[("per_page", PAGE_SIZE), ("page", page)])
                .send()
                .await?
                .error_for_status()?;
            let bytes = read_bounded(response).await?;
            let tags: Vec<ApiTag> = serde_json::from_slice(&bytes)?;
            let complete = tags.len() < PAGE_SIZE;
            commits.extend(
                tags.into_iter()
                    .filter(|tag| is_hex(&tag.commit.sha, 40))
                    .map(|tag| (tag.name, tag.commit.sha)),
            );
            if complete {
                return Ok(commits);
            }
        }
        Err(GithubReleasesError::PaginationLimit)
    }
}

/// Parses standalone extension assets from the public Releases API. Runtime mapping is intentionally
/// absent here; only the signed manager catalog can authorize installation.
pub fn parse_extension_release_page(
    bytes: &[u8],
) -> Result<Vec<GithubPolicyExtensionRelease>, GithubReleasesError> {
    Ok(parse_api_page(bytes)?
        .into_iter()
        .filter_map(|release| policy_extension_release(&release))
        .collect())
}

#[derive(Deserialize)]
struct ApiTag {
    name: String,
    commit: ApiTagCommit,
}

#[derive(Deserialize)]
struct ApiTagCommit {
    sha: String,
}

fn resolve_release_source(mut release: ApiRelease, tags: &HashMap<String, String>) -> ApiRelease {
    release.target_commitish = tags.get(&release.tag_name).cloned();
    release
}

#[derive(Deserialize)]
struct ApiRelease {
    tag_name: String,
    name: Option<String>,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    html_url: String,
    target_commitish: Option<String>,
    assets: Vec<ApiAsset>,
}

#[derive(Deserialize)]
struct ApiAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}

/// Parses one bounded GitHub releases API page and filters it to published Policy tags.
///
/// Only exact repository/tag links survive. Missing hashes or source commits
/// remain unknown; neither release names nor tags establish compatibility.
pub fn parse_release_page(bytes: &[u8]) -> Result<Vec<GithubPolicyRelease>, GithubReleasesError> {
    let bases = official_bases()?;
    Ok(parse_api_page(bytes)?
        .into_iter()
        .filter_map(|release| policy_release(release, &bases))
        .collect())
}

fn parse_api_page(bytes: &[u8]) -> Result<Vec<ApiRelease>, GithubReleasesError> {
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(GithubReleasesError::ResponseTooLarge);
    }
    Ok(serde_json::from_slice(bytes)?)
}

fn policy_release(release: ApiRelease, bases: &[PolicyBaseRecord]) -> Option<GithubPolicyRelease> {
    if release.draft {
        return None;
    }
    let version = release.tag_name.strip_prefix("policy-v")?;
    if version.is_empty() || !safe_path_component(version) {
        return None;
    }
    let expected_page = format!(
        "https://github.com/{POLICY_REPOSITORY}/releases/tag/{}",
        release.tag_name
    );
    if release.html_url != expected_page {
        return None;
    }
    let installer = release.assets.into_iter().find_map(|asset| {
        if asset.name != format!("dsh-policy-{version}-win-x64-unsigned.exe")
            || !safe_path_component(&asset.name)
        {
            return None;
        }
        let expected_url = format!(
            "https://github.com/{POLICY_REPOSITORY}/releases/download/{}/{}",
            release.tag_name, asset.name,
        );
        if asset.browser_download_url != expected_url {
            return None;
        }
        let sha256 = asset
            .digest
            .as_deref()
            .and_then(|digest| digest.strip_prefix("sha256:"))
            .filter(|digest| is_hex(digest, 64))
            .map(str::to_ascii_lowercase);
        Some(GithubInstaller {
            name: asset.name,
            url: asset.browser_download_url,
            sha256,
            size: asset.size,
        })
    });
    let source_commit = release.target_commitish.filter(|value| is_hex(value, 40));
    let official_base = bases
        .iter()
        .find(|base| {
            base.policy_tag == release.tag_name
                && source_commit.as_deref() == Some(base.policy_commit.as_str())
        })
        .map(|base| base.official_base.clone());
    Some(GithubPolicyRelease {
        version: version.to_owned(),
        name: release
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| release.tag_name.clone()),
        tag: release.tag_name,
        published_at: release.published_at,
        prerelease: release.prerelease,
        html_url: release.html_url,
        source_commit,
        official_base,
        installer,
    })
}

fn policy_extension_release(release: &ApiRelease) -> Option<GithubPolicyExtensionRelease> {
    if release.draft {
        return None;
    }
    let version = release.tag_name.strip_prefix("policy-extension-v")?;
    if version.is_empty() || !safe_path_component(version) {
        return None;
    }
    let expected_page = format!(
        "https://github.com/{POLICY_REPOSITORY}/releases/tag/{}",
        release.tag_name
    );
    if release.html_url != expected_page {
        return None;
    }
    let expected_name = format!("dsh-policy-extension-{version}.tgz");
    let tarball = release.assets.iter().find_map(|asset| {
        if asset.name != expected_name || !safe_path_component(&asset.name) {
            return None;
        }
        let expected_url = format!(
            "https://github.com/{POLICY_REPOSITORY}/releases/download/{}/{}",
            release.tag_name, asset.name
        );
        if asset.browser_download_url != expected_url {
            return None;
        }
        let sha256 = asset
            .digest
            .as_deref()
            .and_then(|digest| digest.strip_prefix("sha256:"))
            .filter(|digest| is_hex(digest, 64))
            .map(str::to_ascii_lowercase);
        Some(GithubInstaller {
            name: asset.name.clone(),
            url: asset.browser_download_url.clone(),
            sha256,
            size: asset.size,
        })
    });
    let source_commit = release
        .target_commitish
        .as_deref()
        .filter(|value| is_hex(value, 40))
        .map(str::to_owned);
    Some(GithubPolicyExtensionRelease {
        tag: release.tag_name.clone(),
        version: version.to_owned(),
        package: "@deepseek-ai/dsh-policy-extension".to_owned(),
        name: release
            .name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&release.tag_name)
            .to_owned(),
        published_at: release.published_at.clone(),
        prerelease: release.prerelease,
        html_url: release.html_url.clone(),
        source_commit,
        runtime_version: None,
        runtime_commit: None,
        tarball,
    })
}

fn safe_path_component(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+'))
}

fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

async fn read_bounded(mut response: reqwest::Response) -> Result<Vec<u8>, GithubReleasesError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(GithubReleasesError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(GithubReleasesError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extension_release() -> ApiRelease {
        serde_json::from_value(serde_json::json!({
            "tag_name": "policy-extension-v1.0.3", "name": "Policy extension 1.0.3", "draft": false,
            "prerelease": false, "published_at": null,
            "html_url": "https://github.com/sdaniasdsd/DSH-Policy/releases/tag/policy-extension-v1.0.3",
            "target_commitish": "0123456789abcdef0123456789abcdef01234567",
            "assets": [{
                "name": "dsh-policy-extension-1.0.3.tgz",
                "browser_download_url": "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-extension-v1.0.3/dsh-policy-extension-1.0.3.tgz",
                "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "size": 4096
            }]
        })).unwrap()
    }

    #[test]
    fn discovers_a_separate_standalone_extension_tarball_without_granting_compatibility() {
        let found = policy_extension_release(&extension_release()).unwrap();
        assert_eq!(found.package, "@deepseek-ai/dsh-policy-extension");
        assert_eq!(found.version, "1.0.3");
        assert_eq!(found.runtime_version, None);
        assert_eq!(found.runtime_commit, None);
        assert_eq!(found.tarball.unwrap().sha256, Some("a".repeat(64)));
    }

    #[test]
    fn rejects_an_extension_asset_with_a_different_release_path() {
        let mut release = extension_release();
        release.assets[0].browser_download_url = "https://example.invalid/payload.tgz".into();
        assert!(
            policy_extension_release(&release)
                .unwrap()
                .tarball
                .is_none()
        );
    }

    fn release() -> ApiRelease {
        serde_json::from_value(serde_json::json!({
            "tag_name": "policy-v1.0.4", "name": null, "draft": false,
            "prerelease": false, "published_at": null,
            "html_url": "https://github.com/sdaniasdsd/DSH-Policy/releases/tag/policy-v1.0.4",
            "target_commitish": "main", "assets": []
        }))
        .unwrap()
    }

    #[test]
    fn actual_tag_commit_resolves_a_branch_release_without_guessing_its_base() {
        let bases = official_bases().unwrap();
        let tags = HashMap::from([(
            "policy-v1.0.4".to_owned(),
            "d9d8a440a60980738ece2fbc5f766d4fb9511c81".to_owned(),
        )]);
        let result = policy_release(resolve_release_source(release(), &tags), &bases).unwrap();
        assert_eq!(result.official_base.unwrap().version, "0.2.1-alpha.3");
        assert_eq!(result.source_commit, tags.get("policy-v1.0.4").cloned());
    }

    #[test]
    fn a_missing_or_moved_actual_tag_cannot_inherit_the_old_base() {
        let bases = official_bases().unwrap();
        for tags in [
            HashMap::new(),
            HashMap::from([("policy-v1.0.4".to_owned(), "a".repeat(40))]),
        ] {
            let mut raw = release();
            raw.target_commitish = Some("d9d8a440a60980738ece2fbc5f766d4fb9511c81".to_owned());
            let result = policy_release(resolve_release_source(raw, &tags), &bases).unwrap();
            assert!(result.official_base.is_none());
        }
    }
}
