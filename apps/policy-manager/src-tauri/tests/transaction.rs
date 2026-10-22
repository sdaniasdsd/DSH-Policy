use dsh_policy_manager_lib::transaction::{JournalError, TransitionJournal, TransitionStage};
use tempfile::tempdir;
use uuid::Uuid;

#[test]
fn persists_only_valid_transition_order() {
    let temp = tempdir().unwrap();
    let journal = TransitionJournal::new(temp.path());
    let id = Uuid::new_v4();
    for stage in [
        TransitionStage::Prepared,
        TransitionStage::BackedUp,
        TransitionStage::Installing,
        TransitionStage::ProfileUpdating,
        TransitionStage::Verifying,
        TransitionStage::Committed,
    ] {
        journal.advance(id, stage).unwrap();
        assert_eq!(journal.current(id).unwrap(), Some(stage));
    }
    assert!(matches!(
        journal.advance(id, TransitionStage::Recovering),
        Err(JournalError::IllegalTransition { .. })
    ));
}

#[test]
fn rejects_illegal_skips_and_changes_after_commit() {
    let temp = tempdir().unwrap();
    let journal = TransitionJournal::new(temp.path());
    let id = Uuid::new_v4();
    assert!(matches!(
        journal.advance(id, TransitionStage::Installing),
        Err(JournalError::IllegalTransition { .. })
    ));
    journal.advance(id, TransitionStage::Prepared).unwrap();
    assert!(matches!(
        journal.advance(id, TransitionStage::Verifying),
        Err(JournalError::IllegalTransition { .. })
    ));
    journal.advance(id, TransitionStage::BackedUp).unwrap();
    journal.advance(id, TransitionStage::Installing).unwrap();
    journal.advance(id, TransitionStage::Recovering).unwrap();
    journal
        .advance(id, TransitionStage::RecoveryRequired)
        .unwrap();
    assert_eq!(
        journal.current(id).unwrap(),
        Some(TransitionStage::RecoveryRequired)
    );
    assert!(matches!(
        journal.advance(id, TransitionStage::Committed),
        Err(JournalError::IllegalTransition { .. })
    ));
}

#[test]
fn ignores_an_interrupted_temporary_journal_write() {
    let temp = tempdir().unwrap();
    let journal = TransitionJournal::new(temp.path());
    let id = Uuid::new_v4();
    journal.advance(id, TransitionStage::Prepared).unwrap();
    journal.advance(id, TransitionStage::BackedUp).unwrap();
    std::fs::write(temp.path().join(format!("{id}.tmp")), b"{{partial").unwrap();
    assert_eq!(
        journal.current(id).unwrap(),
        Some(TransitionStage::BackedUp)
    );
}

#[test]
fn refuses_to_advance_from_a_corrupt_durable_record() {
    let temp = tempdir().unwrap();
    let journal = TransitionJournal::new(temp.path());
    let id = Uuid::new_v4();
    journal.advance(id, TransitionStage::Prepared).unwrap();
    let operation_dir = temp.path().join(id.to_string());
    std::fs::write(operation_dir.join("0001-corrupt.json"), b"broken").unwrap();
    assert!(matches!(journal.current(id), Err(JournalError::Corrupt(_))));
}
