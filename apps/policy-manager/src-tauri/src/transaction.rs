use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransitionStage {
    Prepared,
    BackedUp,
    Installing,
    ProfileUpdating,
    Verifying,
    Committed,
    Recovering,
    RecoveryRequired,
}

#[derive(Debug, Error)]
pub enum JournalError {
    #[error("transition journal I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("transition journal record is corrupt: {0}")]
    Corrupt(String),
    #[error("illegal transition from {from:?} to {to:?}")]
    IllegalTransition {
        from: Option<TransitionStage>,
        to: TransitionStage,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct JournalRecord {
    schema_version: u32,
    operation_id: Uuid,
    sequence: u32,
    stage: TransitionStage,
}

pub struct TransitionJournal {
    root: PathBuf,
}

impl TransitionJournal {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn current(&self, operation_id: Uuid) -> Result<Option<TransitionStage>, JournalError> {
        let operation_dir = self.root.join(operation_id.to_string());
        let mut records = match fs::read_dir(&operation_dir) {
            Ok(entries) => entries
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
                .collect::<Vec<_>>(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(JournalError::Io(error)),
        };
        records.sort_by_key(|entry| entry.file_name());
        let mut latest = None;
        for (expected_sequence, entry) in records.iter().enumerate() {
            let mut bytes = Vec::new();
            File::open(entry.path())?.read_to_end(&mut bytes)?;
            let record: JournalRecord = serde_json::from_slice(&bytes)
                .map_err(|error| JournalError::Corrupt(error.to_string()))?;
            if record.schema_version != 1
                || record.operation_id != operation_id
                || record.sequence != expected_sequence as u32
            {
                return Err(JournalError::Corrupt(
                    "record identity or sequence mismatch".to_owned(),
                ));
            }
            if !transition_allowed(latest, record.stage) {
                return Err(JournalError::Corrupt(
                    "record sequence contains an illegal transition".to_owned(),
                ));
            }
            latest = Some(record.stage);
        }
        Ok(latest)
    }

    pub fn advance(&self, operation_id: Uuid, stage: TransitionStage) -> Result<(), JournalError> {
        let current = self.current(operation_id)?;
        if !transition_allowed(current, stage) {
            return Err(JournalError::IllegalTransition {
                from: current,
                to: stage,
            });
        }
        let operation_dir = self.root.join(operation_id.to_string());
        fs::create_dir_all(&operation_dir)?;
        let sequence = fs::read_dir(&operation_dir)?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .count() as u32;
        let record = JournalRecord {
            schema_version: 1,
            operation_id,
            sequence,
            stage,
        };
        let bytes = serde_json::to_vec(&record)
            .map_err(|error| JournalError::Corrupt(error.to_string()))?;
        let final_path = operation_dir.join(format!("{sequence:04}-{}.json", stage_name(stage)));
        let temp_path = operation_dir.join(format!(
            ".{sequence:04}-{}.{}.tmp",
            stage_name(stage),
            Uuid::new_v4()
        ));
        let result =
            write_new_synced(&temp_path, &bytes).and_then(|()| fs::rename(&temp_path, &final_path));
        if result.is_err() {
            let _ = fs::remove_file(&temp_path);
        }
        result?;
        Ok(())
    }
}

fn transition_allowed(from: Option<TransitionStage>, to: TransitionStage) -> bool {
    use TransitionStage::*;
    match (from, to) {
        (None, Prepared) => true,
        (Some(Prepared), BackedUp) => true,
        (Some(BackedUp), ProfileUpdating | Verifying) => true,
        (Some(BackedUp), Installing) => true,
        (Some(Installing), ProfileUpdating) => true,
        (Some(ProfileUpdating), Verifying) => true,
        (Some(Verifying), Committed) => true,
        (Some(RecoveryRequired), Recovering) => true,
        (Some(Recovering), Committed | RecoveryRequired) => true,
        (Some(stage), Recovering) if stage != Committed && stage != RecoveryRequired => true,
        _ => false,
    }
}

fn stage_name(stage: TransitionStage) -> &'static str {
    match stage {
        TransitionStage::Prepared => "prepared",
        TransitionStage::BackedUp => "backed-up",
        TransitionStage::Installing => "installing",
        TransitionStage::ProfileUpdating => "profile-updating",
        TransitionStage::Verifying => "verifying",
        TransitionStage::Committed => "committed",
        TransitionStage::Recovering => "recovering",
        TransitionStage::RecoveryRequired => "recovery-required",
    }
}

fn write_new_synced(path: &std::path::Path, bytes: &[u8]) -> Result<(), std::io::Error> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}
