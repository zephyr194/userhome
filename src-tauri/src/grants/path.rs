//! Validation of grant targets. Every check works on canonical paths and
//! classifies failures into distinct `GrantError` kinds.

use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
};

use crate::security::paths::is_safe_catalog_relative_path;

use super::{GrantError, GrantKind, GrantPurpose, GrantRecord, new_file};

/// Credential locations below `$HOME` that can never be authorized.
const PROTECTED_BELOW_HOME: [&[&str]; 3] = [&[".ssh"], &[".gnupg"], &["Library", "Keychains"]];

/// Canonicalizes `path` and verifies it matches what `purpose` requires and
/// lies strictly below `home`. Returns the canonical path that a grant must be
/// recorded under.
pub(super) fn validate_target(
    path: &Path,
    purpose: GrantPurpose,
    home: Option<&Path>,
) -> Result<PathBuf, GrantError> {
    if !path.is_absolute() || path.to_str().is_none_or(|value| value.contains('\0')) {
        return Err(GrantError::Canonicalize);
    }
    let canonical = canonicalize_utf8(path)?;
    ensure_below_home(&canonical, home)?;
    check_kind(&canonical, purpose.kind())?;
    Ok(canonical)
}

/// Like `validate_target` for the parent directory of a new-file grant
/// (R1-1/R1-2): the parent may be `$HOME` itself, so `~/.zshrc` can be created.
/// Any other parent must lie strictly below `home` as usual. The caller still
/// checks the resulting target, which must stay strictly below `home`.
pub(super) fn validate_new_file_parent(
    path: &Path,
    home: Option<&Path>,
) -> Result<PathBuf, GrantError> {
    if !path.is_absolute() || path.to_str().is_none_or(|value| value.contains('\0')) {
        return Err(GrantError::Canonicalize);
    }
    let canonical = canonicalize_utf8(path)?;
    ensure_new_file_parent(&canonical, home)?;
    check_kind(&canonical, GrantKind::Directory)?;
    Ok(canonical)
}

fn canonicalize_utf8(path: &Path) -> Result<PathBuf, GrantError> {
    let canonical = fs::canonicalize(path).map_err(classify_io_error)?;
    if canonical.to_str().is_none() {
        return Err(GrantError::Canonicalize);
    }
    Ok(canonical)
}

/// Re-checks a stored grant: the root must still canonicalize to the recorded
/// path (a swapped-in symlink or moved ancestor is an escape) and still be
/// readable as the recorded kind. Records written before the `$HOME` limit
/// (or under another home) fail here without being touched in the store.
pub(super) fn revalidate(record: &GrantRecord, home: Option<&Path>) -> Result<PathBuf, GrantError> {
    if let Some(name) = &record.file_name {
        return new_file::revalidate(record, name, home);
    }
    let current = fs::canonicalize(&record.path).map_err(classify_io_error)?;
    if current != record.path {
        return Err(GrantError::SymlinkEscape);
    }
    ensure_below_home(&current, home)?;
    check_kind(&current, record.kind)?;
    Ok(current)
}

/// Resolves `relative` below a directory grant root, rejecting any target
/// whose canonical form leaves the root or lands in a protected credential
/// location (a broad root such as `~/Library` still excludes `Keychains`).
pub(super) fn resolve_within(
    root: &Path,
    relative: &str,
    home: Option<&Path>,
) -> Result<PathBuf, GrantError> {
    if !is_safe_catalog_relative_path(relative) {
        return Err(GrantError::InvalidRelativePath);
    }
    let canonical = fs::canonicalize(root.join(relative)).map_err(classify_io_error)?;
    if !canonical.starts_with(root) {
        return Err(GrantError::SymlinkEscape);
    }
    ensure_below_home(&canonical, home)?;
    Ok(canonical)
}

/// `canonical` must lie strictly below `home` (component-wise, so `/Users/ab`
/// never covers `/Users/abc`) and outside the protected credential locations.
pub(crate) fn ensure_below_home(canonical: &Path, home: Option<&Path>) -> Result<(), GrantError> {
    let home = usable_home(home)?;
    match canonical.strip_prefix(home) {
        Ok(relative) if !relative.as_os_str().is_empty() => {}
        _ => return Err(GrantError::OutsideHome),
    }
    if PROTECTED_BELOW_HOME
        .iter()
        .any(|components| is_inside_protected(canonical, home, components))
    {
        return Err(GrantError::ProtectedLocation);
    }
    Ok(())
}

/// The parent of a new-file grant: `home` itself or anything that passes
/// `ensure_below_home`. Only the parent gets this exception; every other
/// grant and every target keeps the strict rule.
pub(super) fn ensure_new_file_parent(
    canonical: &Path,
    home: Option<&Path>,
) -> Result<(), GrantError> {
    if canonical == usable_home(home)? {
        return Ok(());
    }
    ensure_below_home(canonical, home)
}

/// `home` must be absolute, not the file system root, and free of NUL;
/// otherwise every authorization fails closed.
fn usable_home(home: Option<&Path>) -> Result<&Path, GrantError> {
    home.filter(|home| {
        home.is_absolute()
            && home.parent().is_some()
            && home.to_str().is_some_and(|value| !value.contains('\0'))
    })
    .ok_or(GrantError::HomeUnavailable)
}

/// Matches the protected directory by its literal location and, when it is a
/// symbolic link, by where it really points. Component comparison ignores
/// ASCII case because the default macOS volume is case-insensitive; a
/// case-sensitive volume's look-alike is rejected too, which is the safe side.
fn is_inside_protected(canonical: &Path, home: &Path, components: &[&str]) -> bool {
    let literal = components
        .iter()
        .fold(home.to_path_buf(), |path, component| path.join(component));
    has_prefix_ignoring_case(canonical, &literal)
        || fs::canonicalize(&literal)
            .is_ok_and(|resolved| has_prefix_ignoring_case(canonical, &resolved))
}

fn has_prefix_ignoring_case(path: &Path, prefix: &Path) -> bool {
    let mut remaining = path.components();
    prefix.components().all(|expected| {
        remaining.next().is_some_and(|actual| {
            actual
                .as_os_str()
                .eq_ignore_ascii_case(expected.as_os_str())
        })
    })
}

pub(super) fn check_kind(canonical: &Path, kind: GrantKind) -> Result<(), GrantError> {
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

pub(super) fn classify_io_error(error: io::Error) -> GrantError {
    match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => GrantError::NotFound,
        io::ErrorKind::PermissionDenied => GrantError::PermissionDenied,
        _ => GrantError::Canonicalize,
    }
}
