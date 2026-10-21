//! New-file authorizations: an already existing parent directory plus one file
//! name, for saving or creating a `ConfigFile` that does not exist yet. The
//! record keeps the canonical parent in `path` and the covered name in
//! `file_name`; the grant stands for that single name only, never for other
//! entries of the parent. Every use canonicalizes the parent again and
//! re-checks what the name currently is, so a swapped-in symbolic link,
//! directory or special file is refused with its own error.

use std::{
    fs, io,
    path::{Path, PathBuf},
};

use crate::security::paths::is_safe_catalog_relative_path;

use super::{
    GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose, GrantRecord, now_epoch_ms, path,
};

/// `NAME_MAX` on macOS file systems.
const MAX_FILE_NAME_BYTES: usize = 255;

/// A single plain path segment: non-empty, no separator, `.`, `..`, NUL or
/// control character, and short enough for a file system entry.
pub(super) fn is_valid_file_name(name: &str) -> bool {
    name.len() <= MAX_FILE_NAME_BYTES && !name.contains('/') && is_safe_catalog_relative_path(name)
}

/// A LaunchAgent grant covers one `<something>.plist` name.
pub(super) fn is_launch_agent_name(name: &str) -> bool {
    name.strip_suffix(".plist")
        .is_some_and(|stem| !stem.is_empty())
}

/// The parent of a LaunchAgent grant is exactly `$HOME/Library/LaunchAgents`
/// (canonical): no other directory, no link that leads elsewhere.
fn ensure_launch_agents_parent(parent: &Path, home: Option<&Path>) -> Result<(), GrantError> {
    let fixed = home
        .map(|home| home.join("Library").join("LaunchAgents"))
        .and_then(|dir| fs::canonicalize(dir).ok());
    if fixed.as_deref() == Some(parent) {
        Ok(())
    } else {
        Err(GrantError::OutsideHome)
    }
}

/// Whether the covered name currently exists. Callers have just resolved the
/// grant, so an existing name is a regular file; plain file grants always
/// stand for an existing file.
pub(super) fn target_exists(record: &GrantRecord) -> bool {
    record.file_name.is_none() || fs::symlink_metadata(record.target_path()).is_ok()
}

/// Re-checks a stored new-file grant against the file system.
pub(super) fn revalidate(
    record: &GrantRecord,
    name: &str,
    home: Option<&Path>,
) -> Result<PathBuf, GrantError> {
    let parent = fs::canonicalize(&record.path).map_err(path::classify_io_error)?;
    if parent != record.path {
        return Err(GrantError::SymlinkEscape);
    }
    path::ensure_new_file_parent(&parent, home)?;
    path::check_kind(&parent, GrantKind::Directory)?;
    if record.purpose == GrantPurpose::LaunchAgentFile {
        ensure_launch_agents_parent(&parent, home)?;
        if !is_launch_agent_name(name) {
            return Err(GrantError::InvalidRelativePath);
        }
    }
    check_name(&parent, name, home)?;
    Ok(parent.join(name))
}

/// The covered name must be free to create or already a readable regular
/// file, and the resulting target must itself lie strictly below `$HOME`
/// (the parent may be `$HOME`, the target may not) and stay clear of the
/// protected credential locations.
fn check_name(parent: &Path, name: &str, home: Option<&Path>) -> Result<(), GrantError> {
    let target = parent.join(name);
    path::ensure_below_home(&target, home)?;
    match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(GrantError::SymlinkEscape),
        Ok(metadata) if metadata.file_type().is_file() => {
            path::check_kind(&target, GrantKind::File)
        }
        Ok(_) => Err(GrantError::NotFile),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(path::classify_io_error(error)),
    }
}

impl GrantCoordinator {
    /// Internal creation API for backend code that obtained a save location
    /// from a native picker and found its target missing. Re-granting the same
    /// canonical parent and name returns the existing grant.
    pub fn create_new_file(
        &self,
        parent: &Path,
        file_name: &str,
    ) -> Result<GrantRecord, GrantError> {
        self.create_new_file_with(GrantPurpose::ConfigFile, parent, file_name)
    }

    /// `create_new_file` for another file purpose (`ShellStartupFile`,
    /// `LaunchAgentFile`).
    /// Purposes that are not file purposes are refused.
    pub fn create_new_file_with(
        &self,
        purpose: GrantPurpose,
        parent: &Path,
        file_name: &str,
    ) -> Result<GrantRecord, GrantError> {
        if !purpose.allows_new_file() {
            return Err(GrantError::NotFile);
        }
        if !is_valid_file_name(file_name) {
            return Err(GrantError::InvalidRelativePath);
        }
        if purpose == GrantPurpose::LaunchAgentFile && !is_launch_agent_name(file_name) {
            return Err(GrantError::InvalidRelativePath);
        }
        let canonical = path::validate_new_file_parent(parent, self.home.as_deref())?;
        if purpose == GrantPurpose::LaunchAgentFile {
            ensure_launch_agents_parent(&canonical, self.home.as_deref())?;
            // Creation only: any existing entry under this name (file, link
            // or anything else) is not a new file.
            if fs::symlink_metadata(canonical.join(file_name)).is_ok() {
                return Err(GrantError::NotFile);
            }
        }
        check_name(&canonical, file_name, self.home.as_deref())?;
        let _guard = self.lock()?;
        let mut grants = self.store.load()?;
        if let Some(existing) = grants.iter().find(|grant| {
            grant.purpose == purpose
                && grant.path == canonical
                && grant.file_name.as_deref() == Some(file_name)
        }) {
            return Ok(existing.clone());
        }
        let record = GrantRecord {
            id: GrantId::generate(),
            purpose,
            kind: GrantKind::File,
            path: canonical,
            created_at_epoch_ms: now_epoch_ms(),
            file_name: Some(file_name.to_owned()),
        };
        grants.push(record.clone());
        self.store.save(&grants)?;
        Ok(record)
    }

    /// Authorizes one existing `<label>.plist` in the fixed LaunchAgents
    /// directory, for the backend to replace through the dedicated replacement
    /// entry. Only a regular file qualifies. Every call makes a new grant, which
    /// the caller revokes when its write or its discarded preview ends.
    pub fn create_launch_agent_replacement(
        &self,
        file_name: &str,
    ) -> Result<GrantRecord, GrantError> {
        if !is_valid_file_name(file_name) || !is_launch_agent_name(file_name) {
            return Err(GrantError::InvalidRelativePath);
        }
        let home = self.home.as_deref();
        let agents = home
            .ok_or(GrantError::HomeUnavailable)?
            .join("Library")
            .join("LaunchAgents");
        let canonical = path::validate_new_file_parent(&agents, home)?;
        ensure_launch_agents_parent(&canonical, home)?;
        match fs::symlink_metadata(canonical.join(file_name)) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(GrantError::SymlinkEscape);
            }
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => return Err(GrantError::NotFile),
            Err(error) => return Err(path::classify_io_error(error)),
        }
        check_name(&canonical, file_name, home)?;
        let _guard = self.lock()?;
        let mut grants = self.store.load()?;
        let record = GrantRecord {
            id: GrantId::generate(),
            purpose: GrantPurpose::LaunchAgentFile,
            kind: GrantKind::File,
            path: canonical,
            created_at_epoch_ms: now_epoch_ms(),
            file_name: Some(file_name.to_owned()),
        };
        grants.push(record.clone());
        self.store.save(&grants)?;
        Ok(record)
    }
}
