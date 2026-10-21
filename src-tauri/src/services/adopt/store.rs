//! Record of adopted launchd jobs: one JSON document beside the other app
//! configuration. No file means nothing is adopted. A document that cannot be
//! read or does not match the schema is refused, and every job then stays
//! read-only. Records hold the domain, label, plist path and a content hash;
//! never environment values or arguments.

use std::{
    fs::{self, DirBuilder},
    io,
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};

use crate::{
    config::atomic::{AtomicReplaceError, atomic_replace},
    error::AppError,
    services::{launchd::LaunchdDomain, ownership::AdoptionRecords},
};

const FILE_NAME: &str = "adoptions.json";
const SCHEMA_VERSION: u32 = 1;
const MAX_RECORDS: usize = 512;
const MAX_DOCUMENT_BYTES: u64 = 512 * 1024;
const FILE_MODE: u32 = 0o600;
const DIRECTORY_MODE: u32 = 0o700;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdoptionRecord {
    pub domain: LaunchdDomain,
    pub label: String,
    /// The plist path as the discovery reports it, `~` abbreviated.
    pub path: String,
    pub sha256: String,
    pub adopted_at_epoch_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    schema_version: u32,
    records: Vec<AdoptionRecord>,
}

#[derive(Clone)]
pub struct AdoptionStore {
    path: PathBuf,
    writes: Arc<Mutex<()>>,
}

fn corrupt() -> AppError {
    AppError::validation_failed("接管记录损坏或版本不受支持，已停止读取，相关任务保持只读。")
}

fn unreadable() -> AppError {
    AppError::permission_denied("接管记录无法读取，相关任务保持只读。")
}

impl AdoptionStore {
    pub fn new(directory: &Path) -> Self {
        Self {
            path: directory.join(FILE_NAME),
            writes: Arc::new(Mutex::new(())),
        }
    }

    pub fn load(&self) -> Result<Vec<AdoptionRecord>, AppError> {
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(unreadable()),
        };
        if !metadata.is_file() || metadata.len() > MAX_DOCUMENT_BYTES {
            return Err(corrupt());
        }
        let bytes = fs::read(&self.path).map_err(|_| unreadable())?;
        let document: Document = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
        if document.schema_version != SCHEMA_VERSION || document.records.len() > MAX_RECORDS {
            return Err(corrupt());
        }
        for (index, record) in document.records.iter().enumerate() {
            let duplicate = document.records[..index]
                .iter()
                .any(|earlier| earlier.domain == record.domain && earlier.label == record.label);
            if duplicate {
                return Err(corrupt());
            }
        }
        Ok(document.records)
    }

    pub fn add(&self, record: AdoptionRecord) -> Result<(), AppError> {
        let _guard = self.writes.lock().map_err(|_| AppError::internal())?;
        let mut records = self.load()?;
        if records
            .iter()
            .any(|existing| existing.domain == record.domain && existing.label == record.label)
        {
            return Err(AppError::conflict("这个任务已经接管。"));
        }
        records.push(record);
        self.save(&records)
    }

    pub fn remove(&self, domain: LaunchdDomain, label: &str) -> Result<bool, AppError> {
        let _guard = self.writes.lock().map_err(|_| AppError::internal())?;
        let mut records = self.load()?;
        let before = records.len();
        records.retain(|record| !(record.domain == domain && record.label == label));
        if records.len() == before {
            return Ok(false);
        }
        self.save(&records)?;
        Ok(true)
    }

    fn save(&self, records: &[AdoptionRecord]) -> Result<(), AppError> {
        let document = Document {
            schema_version: SCHEMA_VERSION,
            records: records.to_vec(),
        };
        let mut bytes = serde_json::to_vec_pretty(&document).map_err(|_| AppError::internal())?;
        bytes.push(b'\n');
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(AppError::invalid_input("接管记录超过大小上限。"));
        }
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AppError::permission_denied("接管记录目录不可用。"))?;
        ensure_directory(parent)?;
        if fs::symlink_metadata(&self.path).is_ok_and(|metadata| !metadata.is_file()) {
            return Err(AppError::permission_denied("接管记录存储不是普通文件。"));
        }
        atomic_replace(&self.path, &bytes, FILE_MODE, None).map_err(|error| match error {
            AtomicReplaceError::BeforeCommit(error) | AtomicReplaceError::AfterCommit(error) => {
                error
            }
        })
    }
}

impl AdoptionRecords for AdoptionStore {
    /// A document that cannot be read counts as nothing adopted.
    fn is_adopted(&self, domain: LaunchdDomain, label: &str, config_path: &str) -> bool {
        self.load().is_ok_and(|records| {
            records.iter().any(|record| {
                record.domain == domain && record.label == label && record.path == config_path
            })
        })
    }
}

fn ensure_directory(directory: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Err(AppError::permission_denied("接管记录目录不可用。")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let mut builder = DirBuilder::new();
            builder.recursive(true).mode(DIRECTORY_MODE);
            builder
                .create(directory)
                .map_err(|_| AppError::permission_denied("接管记录目录无法创建。"))?;
        }
        Err(_) => return Err(AppError::permission_denied("接管记录目录不可用。")),
    }
    Ok(())
}
