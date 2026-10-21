//! Existence probes for registered configuration paths. A probe names one
//! registry path: it canonicalizes the parent directory to see where the path
//! really lives, then inspects the entry without following it. `ConfigFs` has
//! no listing operation, so directory enumeration cannot be expressed here.

use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::{self, Read},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::grants::is_below_home;

use super::registry::{Entry, Location, resolve_path};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsError {
    NotFound,
    PermissionDenied,
    TooLarge,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeInfo {
    pub kind: NodeKind,
    pub size: u64,
    pub modified_unix_millis: i64,
}

/// The only file-system access the app-config module is allowed. It has no
/// operation that lists a directory.
pub trait ConfigFs {
    /// Metadata of the node itself; a symbolic link is reported, not followed.
    fn symlink_metadata(&self, path: &Path) -> Result<NodeInfo, FsError>;
    /// Fully resolved location, used only to check where a path really lives.
    fn canonicalize(&self, path: &Path) -> Result<PathBuf, FsError>;
    /// Reads a regular file that is not opened through a symbolic link. The
    /// limit is enforced while streaming; more than `max_bytes` is `TooLarge`.
    fn read_bounded(&self, path: &Path, max_bytes: usize) -> Result<Vec<u8>, FsError>;
}

pub struct StdFs;

impl ConfigFs for StdFs {
    fn symlink_metadata(&self, path: &Path) -> Result<NodeInfo, FsError> {
        let metadata = fs::symlink_metadata(path).map_err(map_io_error)?;
        let kind = if metadata.is_symlink() {
            NodeKind::Symlink
        } else if metadata.is_file() {
            NodeKind::File
        } else {
            NodeKind::Other
        };
        Ok(NodeInfo {
            kind,
            size: metadata.len(),
            modified_unix_millis: modified_millis(&metadata),
        })
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, FsError> {
        fs::canonicalize(path).map_err(map_io_error)
    }

    fn read_bounded(&self, path: &Path, max_bytes: usize) -> Result<Vec<u8>, FsError> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(map_io_error)?;
        if !file.metadata().map_err(map_io_error)?.is_file() {
            return Err(FsError::Other);
        }
        let mut content = Vec::new();
        Read::take(file, (max_bytes as u64).saturating_add(1))
            .read_to_end(&mut content)
            .map_err(map_io_error)?;
        if content.len() > max_bytes {
            return Err(FsError::TooLarge);
        }
        Ok(content)
    }
}

fn map_io_error(error: io::Error) -> FsError {
    match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => FsError::NotFound,
        io::ErrorKind::PermissionDenied => FsError::PermissionDenied,
        _ => FsError::Other,
    }
}

fn modified_millis(metadata: &fs::Metadata) -> i64 {
    metadata.mtime() * 1_000 + metadata.mtime_nsec() / 1_000_000
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub size: u64,
    pub modified_unix_millis: i64,
}

impl From<NodeInfo> for FileMeta {
    fn from(info: NodeInfo) -> Self {
        Self {
            size: info.size,
            modified_unix_millis: info.modified_unix_millis,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ProbeStatus {
    /// A regular file exists at the registered path.
    Found(FileMeta),
    NotFound,
    /// A symbolic link, directory or special file. Shown, never read.
    SymlinkOrNonRegular,
    /// Permission denied or the location could not be determined.
    Inaccessible,
    /// The real location leaves `$HOME`, lands in a protected directory, or a
    /// fixed path resolves somewhere other than where it was declared.
    OutOfBounds,
}

pub enum Located {
    Found { path: PathBuf, meta: FileMeta },
    Unavailable(ProbeStatus),
}

pub fn probe(entry: &Entry, home: &Path, fs: &dyn ConfigFs) -> ProbeStatus {
    match locate(entry, home, fs) {
        Located::Found { meta, .. } => ProbeStatus::Found(meta),
        Located::Unavailable(status) => status,
    }
}

pub fn locate(entry: &Entry, home: &Path, fs: &dyn ConfigFs) -> Located {
    let declared = resolve_path(entry, home);
    match entry.location {
        Location::Home(_) => locate_home(&declared, home, fs),
        Location::Fixed(_) => locate_fixed(&declared, fs),
    }
}

fn locate_home(declared: &Path, home: &Path, fs: &dyn ConfigFs) -> Located {
    if !home.is_absolute() {
        return Located::Unavailable(ProbeStatus::Inaccessible);
    }
    let Ok(canonical_home) = fs.canonicalize(home) else {
        return Located::Unavailable(ProbeStatus::Inaccessible);
    };
    let Some((parent, leaf)) = split(declared) else {
        return Located::Unavailable(ProbeStatus::Inaccessible);
    };
    let real_parent = match fs.canonicalize(parent) {
        Ok(path) => path,
        Err(error) => return Located::Unavailable(status_for(error)),
    };
    let actual = real_parent.join(leaf);
    if !is_below_home(&actual, Some(&canonical_home)) {
        return Located::Unavailable(ProbeStatus::OutOfBounds);
    }
    finish(actual, fs, Some(&canonical_home))
}

fn locate_fixed(declared: &Path, fs: &dyn ConfigFs) -> Located {
    let Some((parent, leaf)) = split(declared) else {
        return Located::Unavailable(ProbeStatus::Inaccessible);
    };
    let expected = match fs.canonicalize(parent) {
        Ok(path) => path.join(leaf),
        Err(error) => return Located::Unavailable(status_for(error)),
    };
    match fs.canonicalize(declared) {
        Ok(resolved) if resolved != expected => {
            return Located::Unavailable(ProbeStatus::OutOfBounds);
        }
        Ok(_) => {}
        Err(error) => return Located::Unavailable(status_for(error)),
    }
    finish(expected, fs, None)
}

fn finish(actual: PathBuf, fs: &dyn ConfigFs, canonical_home: Option<&Path>) -> Located {
    match fs.symlink_metadata(&actual) {
        Err(error) => Located::Unavailable(status_for(error)),
        Ok(info) => match info.kind {
            NodeKind::File => Located::Found {
                path: actual,
                meta: FileMeta::from(info),
            },
            NodeKind::Symlink => Located::Unavailable(match canonical_home {
                Some(home) => classify_symlink(&actual, home, fs),
                None => ProbeStatus::SymlinkOrNonRegular,
            }),
            NodeKind::Other => Located::Unavailable(ProbeStatus::SymlinkOrNonRegular),
        },
    }
}

/// A link whose target leaves `$HOME` is out of bounds. A dangling link has no
/// resolvable target, so it is reported as not regular rather than as escaping.
fn classify_symlink(link: &Path, canonical_home: &Path, fs: &dyn ConfigFs) -> ProbeStatus {
    match fs.canonicalize(link) {
        Ok(target) if !is_below_home(&target, Some(canonical_home)) => ProbeStatus::OutOfBounds,
        Ok(_) => ProbeStatus::SymlinkOrNonRegular,
        Err(FsError::PermissionDenied) => ProbeStatus::Inaccessible,
        Err(_) => ProbeStatus::SymlinkOrNonRegular,
    }
}

fn status_for(error: FsError) -> ProbeStatus {
    match error {
        FsError::NotFound => ProbeStatus::NotFound,
        FsError::PermissionDenied | FsError::TooLarge | FsError::Other => ProbeStatus::Inaccessible,
    }
}

fn split(path: &Path) -> Option<(&Path, &OsStr)> {
    Some((path.parent()?, path.file_name()?))
}
