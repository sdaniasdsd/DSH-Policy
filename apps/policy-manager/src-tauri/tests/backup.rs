use dsh_policy_manager_lib::backup::{BackupError, BackupStore, DataProtector, DpapiProtector};
use sha2::{Digest, Sha256};
use std::fs::{create_dir_all, read, write};
use std::path::Path;
use std::sync::Arc;
use tempfile::tempdir;

struct TestProtector([u8; 32]);

impl DataProtector for TestProtector {
    fn protect(&self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let ciphertext: Vec<_> = plaintext
            .iter()
            .enumerate()
            .map(|(i, byte)| byte ^ self.0[i % 32])
            .collect();
        let mut result = b"TESTENC1".to_vec();
        result.extend_from_slice(&ciphertext);
        result.extend_from_slice(&Sha256::digest([self.0.as_slice(), plaintext].concat()));
        Ok(result)
    }

    fn unprotect(&self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        if ciphertext.len() < 40 || &ciphertext[..8] != b"TESTENC1" {
            return Err("invalid test encryption".to_owned());
        }
        let end = ciphertext.len() - 32;
        let plaintext: Vec<_> = ciphertext[8..end]
            .iter()
            .enumerate()
            .map(|(i, byte)| byte ^ self.0[i % 32])
            .collect();
        let expected = Sha256::digest([self.0.as_slice(), plaintext.as_slice()].concat());
        if expected.as_slice() != &ciphertext[end..] {
            return Err("test authentication failed".to_owned());
        }
        Ok(plaintext)
    }
}

fn store(root: &Path) -> BackupStore {
    BackupStore::with_protector(root.to_path_buf(), Arc::new(TestProtector([3; 32])))
}

#[test]
fn creates_an_encrypted_backup_and_restores_home_contents() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    create_dir_all(home.join("profiles/desktop")).unwrap();
    write(
        home.join("profiles/desktop/cordis.patch.yml"),
        b"plugins: []\n",
    )
    .unwrap();
    write(home.join(".credentials.yaml"), b"private: secret\n").unwrap();
    let store = store(&temp.path().join("backups"));

    let record = store.create(&home).unwrap();
    let encrypted = read(&record.archive_path).unwrap();
    assert!(
        !encrypted
            .windows(b"private: secret".len())
            .any(|part| part == b"private: secret")
    );
    assert_eq!(record.archive_digest.len(), 64);

    let destination = temp.path().join("restored");
    store.restore(&record, &destination).unwrap();
    assert_eq!(
        read(destination.join("profiles/desktop/cordis.patch.yml")).unwrap(),
        b"plugins: []\n"
    );
    assert_eq!(
        read(destination.join(".credentials.yaml")).unwrap(),
        b"private: secret\n"
    );
}

#[test]
fn backs_up_an_uncreated_home_as_an_empty_snapshot() {
    let temp = tempdir().unwrap();
    let store = store(&temp.path().join("backups"));
    let missing_home = temp.path().join("not-created-yet");
    let record = store.create(&missing_home).unwrap();
    let destination = temp.path().join("restored-empty");
    store.restore(&record, &destination).unwrap();
    assert!(destination.is_dir());
    assert_eq!(std::fs::read_dir(destination).unwrap().count(), 0);
}

#[test]
fn refuses_a_tampered_encrypted_archive_without_writing_destination() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    create_dir_all(&home).unwrap();
    write(home.join("settings.json"), b"safe").unwrap();
    let store = store(&temp.path().join("backups"));
    let record = store.create(&home).unwrap();
    let mut encrypted = read(&record.archive_path).unwrap();
    encrypted[9] ^= 0xff;
    write(&record.archive_path, encrypted).unwrap();

    let destination = temp.path().join("restored");
    assert!(matches!(
        store.restore(&record, &destination),
        Err(BackupError::Decrypt(_))
    ));
    assert!(!destination.exists());
}

#[test]
fn rejects_restore_into_an_existing_nonempty_home() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    create_dir_all(&home).unwrap();
    write(home.join("one"), b"1").unwrap();
    let store = store(&temp.path().join("backups"));
    let record = store.create(&home).unwrap();
    let destination = temp.path().join("destination");
    add_nonempty(&destination);
    assert!(matches!(
        store.restore(&record, &destination),
        Err(BackupError::DestinationExists)
    ));
    assert_eq!(read(destination.join("keep")).unwrap(), b"keep");
}

fn add_nonempty(path: &Path) {
    create_dir_all(path).unwrap();
    write(path.join("keep"), b"keep").unwrap();
}

#[test]
fn rejects_a_backup_record_with_the_wrong_digest() {
    let temp = tempdir().unwrap();
    let home = temp.path().join("home");
    create_dir_all(&home).unwrap();
    write(home.join("x"), b"x").unwrap();
    let store = store(&temp.path().join("backups"));
    let mut record = store.create(&home).unwrap();
    record.archive_digest = "0".repeat(64);
    assert!(matches!(
        store.restore(&record, &temp.path().join("out")),
        Err(BackupError::DigestMismatch)
    ));
}

#[cfg(windows)]
#[test]
fn protects_and_unprotects_with_windows_dpapi() {
    let protector = DpapiProtector;
    let plaintext = b"DSH home backup round trip";
    let protected = protector.protect(plaintext).unwrap();
    assert_ne!(protected, plaintext);
    assert_eq!(protector.unprotect(&protected).unwrap(), plaintext);
}
