use crate::catalog::{CatalogError, ReleaseCatalog};
use reqwest::redirect::Policy;
use thiserror::Error;

pub const RELEASE_CATALOG_BASE_URL: &str =
    "https://github.com/sdaniasdsd/DSH-Policy/releases/latest/download/";

#[derive(Debug, Error)]
pub enum CatalogUpdateError {
    #[error("this manager build has no release catalog verification key")]
    MissingTrustKey,
    #[error("catalog download failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("catalog response exceeded its size limit")]
    ResponseTooLarge,
    #[error("release catalog revision is older than the currently loaded catalog")]
    Rollback,
    #[error(transparent)]
    Catalog(#[from] CatalogError),
}

pub struct CatalogClient {
    client: reqwest::Client,
    public_key: [u8; 32],
}

impl CatalogClient {
    /// Loads the public key embedded from `DSH_POLICY_CATALOG_PUBLIC_KEY` at build time.
    pub fn from_embedded_key() -> Result<Self, CatalogUpdateError> {
        let encoded = option_env!("DSH_POLICY_CATALOG_PUBLIC_KEY")
            .ok_or(CatalogUpdateError::MissingTrustKey)?;
        let key = decode_public_key(encoded).ok_or(CatalogUpdateError::MissingTrustKey)?;
        Ok(Self::new(key)?)
    }

    /// Creates a catalog client pinned to a release verification public key.
    fn new(public_key: [u8; 32]) -> Result<Self, reqwest::Error> {
        let client = reqwest::Client::builder()
            .redirect(Policy::custom(|attempt| match attempt.previous().last() {
                Some(previous)
                    if is_approved_release_redirect(previous.as_str(), attempt.url().as_str()) =>
                {
                    attempt.follow()
                }
                None if is_approved_catalog_url(attempt.url().as_str()) => attempt.follow(),
                _ => attempt.stop(),
            }))
            .build()?;
        Ok(Self { client, public_key })
    }

    /// Downloads and verifies the latest signed catalog from the DSH-Policy release channel.
    pub async fn refresh(
        &self,
        current: Option<&ReleaseCatalog>,
    ) -> Result<ReleaseCatalog, CatalogUpdateError> {
        let catalog_url = format!("{RELEASE_CATALOG_BASE_URL}manager-catalog.json");
        let signature_url = format!("{RELEASE_CATALOG_BASE_URL}manager-catalog.json.sig");
        let bytes = read_bounded(
            self.client
                .get(catalog_url)
                .send()
                .await?
                .error_for_status()?,
            2 * 1024 * 1024,
        )
        .await?;
        let signature = read_bounded(
            self.client
                .get(signature_url)
                .send()
                .await?
                .error_for_status()?,
            64,
        )
        .await?;
        let candidate = verify_catalog_candidate(&bytes, &signature, &self.public_key)?;
        ensure_revision_not_rolled_back(
            current.map(|catalog| catalog.catalog_revision),
            candidate.catalog_revision,
        )?;
        Ok(candidate)
    }
}

fn verify_catalog_candidate(
    bytes: &[u8],
    signature: &[u8],
    public_key: &[u8; 32],
) -> Result<ReleaseCatalog, CatalogError> {
    ReleaseCatalog::verify(bytes, signature, public_key)
}

fn ensure_revision_not_rolled_back(
    current_revision: Option<u64>,
    candidate_revision: u64,
) -> Result<(), CatalogUpdateError> {
    if current_revision.is_some_and(|current| candidate_revision < current) {
        return Err(CatalogUpdateError::Rollback);
    }
    Ok(())
}

async fn read_bounded(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, CatalogUpdateError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(CatalogUpdateError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(CatalogUpdateError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn decode_public_key(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut bytes = [0_u8; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(bytes)
}

pub fn is_approved_release_redirect(from: &str, to: &str) -> bool {
    let Ok(from) = url::Url::parse(from) else {
        return false;
    };
    let Ok(to) = url::Url::parse(to) else {
        return false;
    };
    from.scheme() == "https"
        && to.scheme() == "https"
        && from.username().is_empty()
        && from.password().is_none()
        && from.port().is_none()
        && to.username().is_empty()
        && to.password().is_none()
        && to.port().is_none()
        && is_approved_github_host(from.host_str())
        && is_approved_github_host(to.host_str())
}

fn is_approved_catalog_url(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
}

fn is_approved_github_host(host: Option<&str>) -> bool {
    matches!(
        host,
        Some(
            "github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com"
        )
    )
}

#[cfg(test)]
mod tests {
    use super::{CatalogUpdateError, ensure_revision_not_rolled_back, verify_catalog_candidate};
    use crate::catalog::CatalogError;
    use ed25519_dalek::SigningKey;

    #[test]
    fn rejects_a_replacement_catalog_with_an_invalid_signature() {
        let key = SigningKey::from_bytes(&[9; 32]);

        assert!(matches!(
            verify_catalog_candidate(
                br#"{"schemaVersion":1,"desktopReleases":[]}"#,
                &[0; 64],
                &key.verifying_key().to_bytes(),
            ),
            Err(CatalogError::InvalidSignature)
        ));
    }

    #[test]
    fn rejects_a_signed_catalog_older_than_the_current_revision() {
        assert!(matches!(
            ensure_revision_not_rolled_back(Some(4), 3),
            Err(CatalogUpdateError::Rollback)
        ));
    }
}
