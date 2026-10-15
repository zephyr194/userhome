//! Validation of grant targets. Every check works on canonical paths and
//! classifies failures into distinct `GrantError` kinds.

use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};

use crate::security::paths::is_safe_catalog_relative_path;

use super::{GrantError, GrantKind, GrantPurpose, GrantRecord};

/// Canonicalizes `path` and verifies it matches what `purpose` requires.
/// Returns the canonical path that a grant must be recorded under.
pub(super) fn validate_target(path: &Path, purpose: GrantPurpose) -> Result<PathBuf, GrantError> {
    if !path.is_absolute() || path.to_str().is_none_or(|value| value.contains('\0')) {
        return Err(GrantError::Canonicalize);
    }
    let canonical = fs::canonicalize(path).map_err(classify_io_error)?;
    if canonical.to_str().is_none() {
        return Err(GrantError::Canonicalize);
    }
    check_kind(&canonical, purpose.kind())?;
    Ok(canonical)
}

/// Re-checks a stored grant: the root must still canonicalize to the recorded
/// path (a swapped-in symlink or moved ancestor is an escape) and still be
/// readable as the recorded kind.
pub(super) fn revalidate(record: &GrantRecord) -> Result<PathBuf, GrantError> {
    let current = fs::canonicalize(&record.path).map_err(classify_io_error)?;
    if current != record.path {
        return Err(GrantError::SymlinkEscape);
    }
    check_kind(&current, record.kind)?;
    Ok(current)
}

/// Resolves `relative` below a directory grant root, rejecting any target
/// whose canonical form leaves the root.
pub(super) fn resolve_within(root: &Path, relative: &str) -> Result<PathBuf, GrantError> {
    if !is_safe_catalog_relative_path(relative) {
        return Err(GrantError::InvalidRelativePath);
    }
    let canonical = fs::canonicalize(root.join(relative)).map_err(classify_io_error)?;
    if canonical.starts_with(root) {
        Ok(canonical)
    } else {
        Err(GrantError::SymlinkEscape)
    }
}

fn check_kind(canonical: &Path, kind: GrantKind) -> Result<(), GrantError> {
    let metadata = fs::metadata(canonical).map_err(classify_io_error)?;
    match kind {
        GrantKind::Directory => {
            if !metadata.is_dir() {
                return Err(GrantError::NotDirectory);
            }
            fs::read_dir(canonical).map_err(classify_io_error)?;
        }
        GrantKind::File => {
            if !metadata.is_file() {
                return Err(GrantError::NotFile);
            }
            File::open(canonical).map_err(classify_io_error)?;
        }
    }
    Ok(())
}

fn classify_io_error(error: io::Error) -> GrantError {
    match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => GrantError::NotFound,
        io::ErrorKind::PermissionDenied => GrantError::PermissionDenied,
        _ => GrantError::Canonicalize,
    }
}
