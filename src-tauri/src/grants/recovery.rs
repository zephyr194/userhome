//! Grant store health and the confirmed isolate-and-reset recovery.
//!
//! A damaged or newer-version `grants.json` keeps every grant operation
//! failing closed; nothing here runs on its own. `store_status` only reports
//! what is wrong, and `reset_store` — called after the user confirmed — sets
//! the file aside next to itself under a timestamped name and starts an empty
//! store. The old bytes are never read, returned or deleted.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use serde::Serialize;
use time::OffsetDateTime;

use crate::error::AppError;

use super::{GrantCoordinator, GrantError, GrantStore};

const QUARANTINE_INFIX: &str = ".corrupt-";
const MAX_NAME_ATTEMPTS: u32 = 1000;

/// Why the store cannot be used. Only categories, never paths or contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrantStoreProblem {
    /// Invalid JSON, unexpected fields, malformed or duplicate records, too
    /// many records or an oversize file.
    Corrupt,
    /// Written by a newer schema version.
    NewerVersion,
    /// `grants.json` is a directory, symbolic link or other special file.
    NotRegularFile,
    /// The file could not be accessed (permissions, I/O). A reset cannot
    /// fix this, so it is never offered.
    Io,
}

impl GrantStoreProblem {
    fn is_resettable(self) -> bool {
        matches!(self, Self::Corrupt | Self::NewerVersion)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrantStoreStatus {
    Available,
    Unavailable { reason: GrantStoreProblem },
}

/// Result of a successful reset: the bare file name the old store was kept
/// under (same directory, no path) and why the store was unusable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantStoreReset {
    pub quarantine_file_name: String,
    pub previous_reason: GrantStoreProblem,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GrantResetError {
    /// The store is usable, or its problem (access) is one a reset cannot fix.
    NotResettable,
    /// `grants.json` is a directory, symbolic link or other special file; it is
    /// left for the user to handle.
    NotRegularFile,
    /// A step failed and the store is exactly as it was before the attempt.
    Io,
    /// The old store was set aside but no new one could be created, and it
    /// could not be put back. There is no `grants.json` (an empty store as far
    /// as the next check is concerned).
    IsolatedWithoutStore { quarantine_file_name: String },
}

impl From<GrantResetError> for AppError {
    fn from(error: GrantResetError) -> Self {
        match error {
            GrantResetError::NotResettable => AppError::conflict(
                "The authorization store is not damaged or newer-version, so there is nothing to reset.",
            ),
            GrantResetError::NotRegularFile => AppError::not_supported(
                "The authorization store is not a regular file. Remove or move it manually.",
            ),
            GrantResetError::Io => AppError::permission_denied(
                "The authorization store could not be isolated. Nothing was changed.",
            ),
            GrantResetError::IsolatedWithoutStore {
                quarantine_file_name,
            } => AppError::partial_failure(
                &format!(
                    "The old authorization store was set aside as {quarantine_file_name}, but a new one could not be created. Try again."
                ),
                true,
            ),
        }
    }
}

/// File-system steps of a reset, separated so tests can make one fail.
pub(super) trait ResetOps {
    /// Creates `to` as a second name of `from`; must fail if `to` exists.
    fn link(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::hard_link(from, to)
    }

    fn unlink(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }

    fn create_empty(&self, store: &GrantStore) -> Result<(), GrantError> {
        store.save(&[])
    }
}

pub(super) struct RealResetOps;

impl ResetOps for RealResetOps {}

impl GrantStore {
    pub(super) fn status(&self) -> GrantStoreStatus {
        match fs::symlink_metadata(self.file_path()) {
            Ok(metadata) if !metadata.file_type().is_file() => {
                return GrantStoreStatus::Unavailable {
                    reason: GrantStoreProblem::NotRegularFile,
                };
            }
            Err(error) if error.kind() != io::ErrorKind::NotFound => {
                return GrantStoreStatus::Unavailable {
                    reason: GrantStoreProblem::Io,
                };
            }
            _ => {}
        }
        match self.load() {
            Ok(_) => GrantStoreStatus::Available,
            Err(GrantError::StoreCorrupt) => GrantStoreStatus::Unavailable {
                reason: GrantStoreProblem::Corrupt,
            },
            Err(GrantError::StoreUnsupportedVersion) => GrantStoreStatus::Unavailable {
                reason: GrantStoreProblem::NewerVersion,
            },
            Err(_) => GrantStoreStatus::Unavailable {
                reason: GrantStoreProblem::Io,
            },
        }
    }

    /// Sets the current file aside under a name that does not exist yet and
    /// returns that name. The file is linked to the new name and then the old
    /// name is removed: unlike `rename`, the link step cannot replace an
    /// existing entry, and the bytes and mode stay those of the original.
    fn set_aside(
        &self,
        ops: &dyn ResetOps,
        stamp: &str,
    ) -> Result<(String, PathBuf), GrantResetError> {
        let original = self.file_path();
        for attempt in 0..MAX_NAME_ATTEMPTS {
            let name = quarantine_name(stamp, attempt);
            let target = self.directory.join(&name);
            match ops.link(&original, &target) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err(GrantResetError::Io),
            }
            if ops.unlink(&original).is_err() {
                // The original name is still there, so withdraw the extra one.
                let _ = ops.unlink(&target);
                return Err(GrantResetError::Io);
            }
            return Ok((name, target));
        }
        Err(GrantResetError::Io)
    }

    /// Puts a set-aside file back under the original name, never replacing
    /// something that is there now.
    fn put_back(&self, ops: &dyn ResetOps, aside: &Path) -> bool {
        ops.link(aside, &self.file_path()).is_ok() && {
            let _ = ops.unlink(aside);
            true
        }
    }
}

impl GrantCoordinator {
    pub fn store_status(&self) -> GrantStoreStatus {
        match self.lock() {
            Ok(_guard) => self.store.status(),
            Err(_) => GrantStoreStatus::Unavailable {
                reason: GrantStoreProblem::Io,
            },
        }
    }

    pub fn reset_store(&self) -> Result<GrantStoreReset, GrantResetError> {
        self.reset_store_with(&RealResetOps, &utc_stamp(OffsetDateTime::now_utc()))
    }

    /// Re-detects under the lock and only continues for a damaged or
    /// newer-version store. Either the old file ends up isolated next to an
    /// empty store, or nothing changed, or (when even the roll-back fails) the
    /// old file is isolated and no `grants.json` exists.
    pub(super) fn reset_store_with(
        &self,
        ops: &dyn ResetOps,
        stamp: &str,
    ) -> Result<GrantStoreReset, GrantResetError> {
        let _guard = self.lock().map_err(|_| GrantResetError::Io)?;
        let previous_reason = match self.store.status() {
            GrantStoreStatus::Unavailable { reason } if reason.is_resettable() => reason,
            GrantStoreStatus::Unavailable {
                reason: GrantStoreProblem::NotRegularFile,
            } => return Err(GrantResetError::NotRegularFile),
            _ => return Err(GrantResetError::NotResettable),
        };
        let (quarantine_file_name, aside) = self.store.set_aside(ops, stamp)?;
        if ops.create_empty(&self.store).is_err() {
            return Err(if self.store.put_back(ops, &aside) {
                GrantResetError::Io
            } else {
                GrantResetError::IsolatedWithoutStore {
                    quarantine_file_name,
                }
            });
        }
        Ok(GrantStoreReset {
            quarantine_file_name,
            previous_reason,
        })
    }
}

fn quarantine_name(stamp: &str, attempt: u32) -> String {
    let base = format!(
        "{}{QUARANTINE_INFIX}{stamp}",
        super::store::GRANTS_FILE_NAME
    );
    if attempt == 0 {
        base
    } else {
        format!("{base}-{attempt}")
    }
}

/// `YYYYMMDDTHHMMSSZ`, safe in a file name.
fn utc_stamp(moment: OffsetDateTime) -> String {
    format!(
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        moment.year(),
        u8::from(moment.month()),
        moment.day(),
        moment.hour(),
        moment.minute(),
        moment.second()
    )
}
