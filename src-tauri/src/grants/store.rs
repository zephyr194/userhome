//! Versioned, atomically written persistence for grant records. A missing
//! file is an empty store; a corrupt or newer-version file is an error and is
//! never silently replaced.

use std::{
    fs::{self, DirBuilder, File},
    io::{self, Read},
    os::unix::fs::{DirBuilderExt, PermissionsExt},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::atomic::atomic_replace;

use super::{GrantError, GrantRecord};

pub const GRANT_SCHEMA_VERSION: u16 = 1;
pub const MAX_GRANTS: usize = 256;
pub(super) const GRANTS_FILE_NAME: &str = "grants.json";
const MAX_STORE_BYTES: u64 = 256 * 1024;
const STORE_DIRECTORY_MODE: u32 = 0o700;
const STORE_FILE_MODE: u32 = 0o600;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GrantDocument {
    schema_version: u16,
    grants: Vec<GrantRecord>,
}

#[derive(Debug, Clone)]
pub struct GrantStore {
    pub(super) directory: PathBuf,
}

impl GrantStore {
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    pub(super) fn load(&self) -> Result<Vec<GrantRecord>, GrantError> {
        let path = self.file_path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => metadata,
            Ok(_) => return Err(GrantError::StoreCorrupt),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err(GrantError::StoreIo),
        };
        if metadata.len() > MAX_STORE_BYTES {
            return Err(GrantError::StoreCorrupt);
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        File::open(&path)
            .and_then(|file| file.take(MAX_STORE_BYTES + 1).read_to_end(&mut bytes))
            .map_err(|_| GrantError::StoreIo)?;
        if bytes.len() as u64 > MAX_STORE_BYTES {
            return Err(GrantError::StoreCorrupt);
        }
        decode(&bytes)
    }

    pub(super) fn save(&self, grants: &[GrantRecord]) -> Result<(), GrantError> {
        validate_records(grants)?;
        self.ensure_directory()?;
        let path = self.file_path();
        if fs::symlink_metadata(&path).is_ok_and(|metadata| !metadata.file_type().is_file()) {
            return Err(GrantError::StoreCorrupt);
        }
        let document = GrantDocument {
            schema_version: GRANT_SCHEMA_VERSION,
            grants: grants.to_vec(),
        };
        let mut bytes = serde_json::to_vec_pretty(&document).map_err(|_| GrantError::StoreIo)?;
        bytes.push(b'\n');
        if bytes.len() as u64 > MAX_STORE_BYTES {
            return Err(GrantError::LimitReached);
        }
        atomic_replace(&path, &bytes, STORE_FILE_MODE, None).map_err(|_| GrantError::StoreIo)
    }

    pub(super) fn file_path(&self) -> PathBuf {
        self.directory.join(GRANTS_FILE_NAME)
    }

    fn ensure_directory(&self) -> Result<(), GrantError> {
        ensure_private_directory(&self.directory)
    }
}

fn ensure_private_directory(directory: &Path) -> Result<(), GrantError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Err(GrantError::StoreIo),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            DirBuilder::new()
                .recursive(true)
                .mode(STORE_DIRECTORY_MODE)
                .create(directory)
                .map_err(|_| GrantError::StoreIo)?;
        }
        Err(_) => return Err(GrantError::StoreIo),
    }
    fs::set_permissions(directory, fs::Permissions::from_mode(STORE_DIRECTORY_MODE))
        .map_err(|_| GrantError::StoreIo)
}

fn decode(bytes: &[u8]) -> Result<Vec<GrantRecord>, GrantError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| GrantError::StoreCorrupt)?;
    match value.get("schemaVersion").and_then(Value::as_u64) {
        Some(version) if version == u64::from(GRANT_SCHEMA_VERSION) => {}
        Some(_) => return Err(GrantError::StoreUnsupportedVersion),
        None => return Err(GrantError::StoreCorrupt),
    }
    let document: GrantDocument =
        serde_json::from_value(value).map_err(|_| GrantError::StoreCorrupt)?;
    validate_records(&document.grants).map_err(|_| GrantError::StoreCorrupt)?;
    Ok(document.grants)
}

fn validate_records(grants: &[GrantRecord]) -> Result<(), GrantError> {
    if grants.len() > MAX_GRANTS {
        return Err(GrantError::LimitReached);
    }
    for (index, record) in grants.iter().enumerate() {
        if !record.is_well_formed()
            || grants[..index]
                .iter()
                .any(|earlier| earlier.id == record.id)
        {
            return Err(GrantError::StoreCorrupt);
        }
    }
    Ok(())
}
