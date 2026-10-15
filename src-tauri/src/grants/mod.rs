//! Authorization roots: backend-created, persisted, revocable grants for
//! user-approved directories and files. The frontend can only list and revoke
//! grants; creation is an internal API meant to be fed by native dialogs, so no
//! command ever turns a frontend-supplied absolute path into a grant.

use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

mod path;
mod read;
mod store;
mod write;

pub use read::{ContentFingerprint, DEFAULT_MAX_READ_BYTES, GrantedRead, ReadError};
pub use store::{GRANT_SCHEMA_VERSION, GrantStore, MAX_GRANTS};
pub use write::{
    ConfirmRequest, FileState, MAX_BATCH_STEPS, MAX_PENDING_WRITES, RecoveryPoint,
    ResourceWriteBatchPreview, ResourceWriteBatchStatus, ResourceWriteContext,
    ResourceWriteCoordinator, ResourceWriteExecution, ResourceWritePreview, StepState, WriteKind,
    WriteOutcome, WriteRequest, WriteStatus,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrantPurpose {
    ConfigDirectory,
    ConfigFile,
    Executable,
}

impl GrantPurpose {
    pub fn kind(self) -> GrantKind {
        match self {
            Self::ConfigDirectory => GrantKind::Directory,
            Self::ConfigFile | Self::Executable => GrantKind::File,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrantKind {
    Directory,
    File,
}

/// Distinct failure kinds for grant creation, persistence and resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantError {
    /// The path is relative, not valid text, or cannot be canonicalized.
    Canonicalize,
    /// The path or a child resolves outside the approved root.
    SymlinkEscape,
    /// The canonical target is `$HOME` itself or not strictly below it
    /// (including a symbolic link that resolves outside `$HOME`).
    OutsideHome,
    /// The target is one of the protected credential locations below `$HOME`
    /// (`~/.ssh`, `~/.gnupg`, `~/Library/Keychains`) or inside one.
    ProtectedLocation,
    /// `$HOME` is missing, not absolute or unusable, so nothing can be
    /// validated against it.
    HomeUnavailable,
    NotDirectory,
    NotFile,
    PermissionDenied,
    NotFound,
    InvalidRelativePath,
    /// The grant does not exist or has been revoked.
    UnknownGrant,
    LimitReached,
    StoreCorrupt,
    StoreUnsupportedVersion,
    StoreIo,
}

impl From<GrantError> for AppError {
    fn from(error: GrantError) -> Self {
        match error {
            GrantError::Canonicalize => {
                AppError::invalid_input("The path could not be normalized to a canonical path.")
            }
            GrantError::SymlinkEscape => AppError::permission_denied(
                "The path resolves outside the approved location through a symbolic link.",
            ),
            GrantError::OutsideHome => AppError::permission_denied(
                "The location is not strictly inside your home folder, so it cannot be authorized.",
            ),
            GrantError::ProtectedLocation => AppError::permission_denied(
                "The location holds credentials and is protected from authorization.",
            ),
            GrantError::HomeUnavailable => AppError::validation_failed(
                "The home folder could not be determined, so authorizations are unavailable.",
            ),
            GrantError::NotDirectory => {
                AppError::validation_failed("The approved location is not a directory.")
            }
            GrantError::NotFile => {
                AppError::validation_failed("The approved location is not a regular file.")
            }
            GrantError::PermissionDenied => {
                AppError::permission_denied("UserHome does not have permission to access it.")
            }
            GrantError::NotFound => AppError::not_found("The approved location no longer exists."),
            GrantError::InvalidRelativePath => {
                AppError::invalid_input("The relative path is not allowed.")
            }
            GrantError::UnknownGrant => {
                AppError::not_found("The authorization does not exist or was revoked.")
            }
            GrantError::LimitReached => {
                AppError::conflict("The maximum number of authorizations has been reached.")
            }
            GrantError::StoreCorrupt => {
                AppError::validation_failed("The authorization store is damaged and was not used.")
            }
            GrantError::StoreUnsupportedVersion => AppError::not_supported(
                "The authorization store was written by a newer version and was not used.",
            ),
            GrantError::StoreIo => {
                AppError::permission_denied("The authorization store could not be accessed.")
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct GrantId(String);

impl GrantId {
    fn generate() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn parse(value: &str) -> Result<Self, GrantError> {
        match Uuid::parse_str(value) {
            Ok(id) if id.hyphenated().to_string() == value => Ok(Self(value.to_owned())),
            _ => Err(GrantError::UnknownGrant),
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for GrantId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(|_| serde::de::Error::custom("invalid grant id"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GrantRecord {
    pub id: GrantId,
    pub purpose: GrantPurpose,
    pub kind: GrantKind,
    pub path: PathBuf,
    pub created_at_epoch_ms: u64,
}

impl GrantRecord {
    pub(crate) fn is_well_formed(&self) -> bool {
        self.path.is_absolute()
            && self.path.to_str().is_some_and(|path| !path.contains('\0'))
            && self.kind == self.purpose.kind()
    }

    pub fn summary(&self, home: Option<&Path>) -> GrantSummary {
        GrantSummary {
            id: self.id.clone(),
            purpose: self.purpose,
            kind: self.kind,
            display_path: display_path(&self.path, home),
            created_at_epoch_ms: self.created_at_epoch_ms,
        }
    }
}

/// Frontend-facing grant view; never carries more than a display path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantSummary {
    pub id: GrantId,
    pub purpose: GrantPurpose,
    pub kind: GrantKind,
    pub display_path: String,
    pub created_at_epoch_ms: u64,
}

fn display_path(path: &Path, home: Option<&Path>) -> String {
    if let Some(home) = home
        && let Ok(relative) = path.strip_prefix(home)
    {
        return if relative.as_os_str().is_empty() {
            "~".to_owned()
        } else {
            format!("~/{}", relative.to_string_lossy())
        };
    }
    path.to_string_lossy().into_owned()
}

pub struct GrantCoordinator {
    store: GrantStore,
    // Canonical `$HOME` that every grant target must lie strictly below.
    // Injected so tests can use a temporary home; `None` fails closed.
    home: Option<PathBuf>,
    // Serializes read-modify-write cycles; the store itself is stateless.
    lock: Mutex<()>,
}

impl GrantCoordinator {
    /// `home` must already be the canonical home directory (see
    /// `commands::grants::canonical_home`); a missing, relative or root value
    /// rejects every new grant and invalidates stored ones on use.
    pub fn new(store: GrantStore, home: Option<PathBuf>) -> Self {
        Self {
            store,
            home,
            lock: Mutex::new(()),
        }
    }

    /// Internal creation API for backend code that obtained `path` from a
    /// native picker. Re-granting the same canonical path and purpose returns
    /// the existing grant.
    pub fn create(&self, purpose: GrantPurpose, path: &Path) -> Result<GrantRecord, GrantError> {
        let canonical = path::validate_target(path, purpose, self.home.as_deref())?;
        let _guard = self.lock()?;
        let mut grants = self.store.load()?;
        if let Some(existing) = grants
            .iter()
            .find(|grant| grant.purpose == purpose && grant.path == canonical)
        {
            return Ok(existing.clone());
        }
        let record = GrantRecord {
            id: GrantId::generate(),
            purpose,
            kind: purpose.kind(),
            path: canonical,
            created_at_epoch_ms: now_epoch_ms(),
        };
        grants.push(record.clone());
        self.store.save(&grants)?;
        Ok(record)
    }

    pub fn list(&self) -> Result<Vec<GrantRecord>, GrantError> {
        let _guard = self.lock()?;
        self.store.load()
    }

    pub fn revoke(&self, id: &GrantId) -> Result<(), GrantError> {
        let _guard = self.lock()?;
        let mut grants = self.store.load()?;
        let before = grants.len();
        grants.retain(|grant| &grant.id != id);
        if grants.len() == before {
            return Err(GrantError::UnknownGrant);
        }
        self.store.save(&grants)
    }

    /// Looks up a live grant and re-validates its root against the file
    /// system. Revoked or unknown grants are rejected.
    pub fn resolve(&self, id: &GrantId) -> Result<GrantRecord, GrantError> {
        let record = {
            let _guard = self.lock()?;
            self.store
                .load()?
                .into_iter()
                .find(|grant| &grant.id == id)
                .ok_or(GrantError::UnknownGrant)?
        };
        path::revalidate(&record, self.home.as_deref())?;
        Ok(record)
    }

    /// Resolves a relative path below a live directory grant.
    pub fn resolve_child(&self, id: &GrantId, relative: &str) -> Result<PathBuf, GrantError> {
        let record = self.resolve(id)?;
        if record.kind != GrantKind::Directory {
            return Err(GrantError::NotDirectory);
        }
        path::resolve_within(&record.path, relative)
    }

    fn lock(&self) -> Result<MutexGuard<'_, ()>, GrantError> {
        self.lock.lock().map_err(|_| GrantError::StoreIo)
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
