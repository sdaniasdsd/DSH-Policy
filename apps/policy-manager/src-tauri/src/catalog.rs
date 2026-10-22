use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use url::Url;

#[derive(Debug, Error)]
pub enum CatalogError {
    #[error("catalog signature is invalid")]
    InvalidSignature,
    #[error("catalog data is invalid: {0}")]
    InvalidCatalog(String),
    #[error("catalog signature must be exactly 64 bytes")]
    InvalidSignatureLength,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCatalog {
    pub schema_version: u32,
    pub catalog_revision: u64,
    pub expires_at: u64,
    pub desktop_releases: Vec<DesktopRelease>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRelease {
    pub os: String,
    pub architecture: String,
    pub desktop_version: String,
    pub runtime_version: String,
    pub runtime_commit: String,
    pub installer_url: String,
    pub sha256: String,
    pub installer_profile: String,
    pub policies: Vec<PolicyRelease>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRelease {
    pub package: String,
    pub version: String,
    pub runtime_version: String,
    pub runtime_commit: String,
}

impl ReleaseCatalog {
    pub fn verify(
        bytes: &[u8],
        signature: &[u8],
        public_key: &[u8; 32],
    ) -> Result<Self, CatalogError> {
        let key =
            VerifyingKey::from_bytes(public_key).map_err(|_| CatalogError::InvalidSignature)?;
        let signature =
            Signature::from_slice(signature).map_err(|_| CatalogError::InvalidSignatureLength)?;
        key.verify(bytes, &signature)
            .map_err(|_| CatalogError::InvalidSignature)?;

        let catalog: Self = serde_json::from_slice(bytes)
            .map_err(|error| CatalogError::InvalidCatalog(error.to_string()))?;
        catalog.validate()?;
        Ok(catalog)
    }

    pub fn policy_for(
        &self,
        runtime_version: &str,
        runtime_commit: &str,
    ) -> Option<&PolicyRelease> {
        self.desktop_releases
            .iter()
            .flat_map(|release| &release.policies)
            .find(|policy| {
                policy.runtime_version == runtime_version && policy.runtime_commit == runtime_commit
            })
    }

    fn validate(&self) -> Result<(), CatalogError> {
        if self.schema_version != 1 {
            return invalid("unsupported catalog schema version");
        }
        if self.catalog_revision == 0 {
            return invalid("catalog revision must be positive");
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| {
                CatalogError::InvalidCatalog("system clock predates Unix epoch".to_owned())
            })?
            .as_secs();
        if self.expires_at <= now {
            return invalid("catalog has expired");
        }

        let mut identities = HashSet::new();
        for release in &self.desktop_releases {
            if release.os != "windows" || release.architecture != "x86_64" {
                return invalid("only Windows x86_64 Desktop releases are supported");
            }
            if release.desktop_version.trim().is_empty()
                || release.runtime_version.trim().is_empty()
                || !is_hex(&release.runtime_commit, 40)
                || release.installer_profile != "nsis"
            {
                return invalid("release identity or installer profile is invalid");
            }
            if !is_hex(&release.sha256, 64) {
                return invalid("installer SHA-256 must contain 64 hexadecimal characters");
            }
            if !is_first_party_installer_url(&release.installer_url) {
                return invalid("installer URL must use the official HTTPS download host");
            }
            if !identities.insert((
                release.os.as_str(),
                release.architecture.as_str(),
                release.desktop_version.as_str(),
            )) {
                return invalid("duplicate Desktop release identity");
            }
            let mut policy_versions = HashSet::new();
            for policy in &release.policies {
                if policy.package != "@deepseek-ai/dsh-policy-extension"
                    || policy.version.trim().is_empty()
                    || policy.runtime_version != release.runtime_version
                    || policy.runtime_commit != release.runtime_commit
                    || !policy_versions.insert(policy.version.as_str())
                {
                    return invalid(
                        "Policy mapping must be unique and match the exact bundled runtime",
                    );
                }
            }
        }
        Ok(())
    }
}

fn invalid<T>(message: &str) -> Result<T, CatalogError> {
    Err(CatalogError::InvalidCatalog(message.to_owned()))
}

fn is_hex(value: &str, expected_len: usize) -> bool {
    value.len() == expected_len && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_first_party_installer_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("download.deepseek.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}
