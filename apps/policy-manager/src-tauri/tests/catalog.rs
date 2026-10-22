use dsh_policy_manager_lib::catalog::{CatalogError, ReleaseCatalog};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};

fn fixture_catalog() -> Value {
    json!({
        "schemaVersion": 1,
        "catalogRevision": 1,
        "expiresAt": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is after Unix epoch")
            .as_secs() + 86400,
        "desktopReleases": [{
            "os": "windows",
            "architecture": "x86_64",
            "desktopVersion": "1.0.2",
            "runtimeVersion": "0.2.1-rc.2",
            "runtimeCommit": "0123456789abcdef0123456789abcdef01234567",
            "installerUrl": "https://download.deepseek.com/desktop/dsh-1.0.2.exe",
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "installerProfile": "nsis",
            "policies": [{
                "package": "@deepseek-ai/dsh-policy-extension",
                "version": "1.0.2",
                "runtimeVersion": "0.2.1-rc.2",
                "runtimeCommit": "0123456789abcdef0123456789abcdef01234567"
            }]
        }]
    })
}

fn sign(value: &Value) -> (Vec<u8>, Vec<u8>, [u8; 32]) {
    let bytes = serde_json::to_vec(value).expect("fixture serializes");
    let key = SigningKey::from_bytes(&[7; 32]);
    let signature = key.sign(&bytes).to_bytes().to_vec();
    (bytes, signature, key.verifying_key().to_bytes())
}

#[test]
fn verifies_catalog_with_a_valid_ed25519_signature() {
    let (bytes, signature, public_key) = sign(&fixture_catalog());

    let catalog = ReleaseCatalog::verify(&bytes, &signature, &public_key).unwrap();

    assert_eq!(catalog.desktop_releases.len(), 1);
}

#[test]
fn rejects_an_invalid_signature() {
    let (bytes, _, public_key) = sign(&fixture_catalog());

    assert!(matches!(
        ReleaseCatalog::verify(&bytes, &[0; 64], &public_key),
        Err(CatalogError::InvalidSignature)
    ));
}

#[test]
fn rejects_malformed_catalog_json() {
    let key = SigningKey::from_bytes(&[7; 32]);
    let bytes = b"{not json";
    let signature = key.sign(bytes).to_bytes();

    assert!(matches!(
        ReleaseCatalog::verify(bytes, &signature, &key.verifying_key().to_bytes()),
        Err(CatalogError::InvalidCatalog(_))
    ));
}

#[test]
fn rejects_unsupported_architecture() {
    let mut fixture = fixture_catalog();
    fixture["desktopReleases"][0]["architecture"] = json!("arm64");
    let (bytes, signature, public_key) = sign(&fixture);

    assert!(matches!(
        ReleaseCatalog::verify(&bytes, &signature, &public_key),
        Err(CatalogError::InvalidCatalog(_))
    ));
}

#[test]
fn rejects_a_missing_installer_hash() {
    let mut fixture = fixture_catalog();
    fixture["desktopReleases"][0]
        .as_object_mut()
        .unwrap()
        .remove("sha256");
    let (bytes, signature, public_key) = sign(&fixture);

    assert!(matches!(
        ReleaseCatalog::verify(&bytes, &signature, &public_key),
        Err(CatalogError::InvalidCatalog(_))
    ));
}

#[test]
fn rejects_duplicate_desktop_identities() {
    let mut fixture = fixture_catalog();
    let duplicate = fixture["desktopReleases"][0].clone();
    fixture["desktopReleases"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    let (bytes, signature, public_key) = sign(&fixture);

    assert!(matches!(
        ReleaseCatalog::verify(&bytes, &signature, &public_key),
        Err(CatalogError::InvalidCatalog(_))
    ));
}

#[test]
fn rejects_an_expired_release_catalog() {
    let mut fixture = fixture_catalog();
    fixture["expiresAt"] = json!(1);
    let (bytes, signature, public_key) = sign(&fixture);

    assert!(matches!(
        ReleaseCatalog::verify(&bytes, &signature, &public_key),
        Err(CatalogError::InvalidCatalog(_))
    ));
}

#[test]
fn maps_only_an_exact_runtime_version_and_commit() {
    let (bytes, signature, public_key) = sign(&fixture_catalog());
    let catalog = ReleaseCatalog::verify(&bytes, &signature, &public_key).unwrap();

    assert_eq!(
        catalog
            .policy_for("0.2.1-rc.2", "0123456789abcdef0123456789abcdef01234567")
            .map(|policy| policy.version.as_str()),
        Some("1.0.2")
    );
    assert!(
        catalog
            .policy_for("0.2.1-rc.2", "fedcba9876543210fedcba9876543210fedcba98")
            .is_none()
    );
}
