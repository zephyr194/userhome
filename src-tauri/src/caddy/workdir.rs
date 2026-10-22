//! The Caddy work directory: the one directory the user chose to hold the rules,
//! the generated Caddyfile, the original text, check copies, runs and the admin
//! socket. Nothing here creates a directory except `prepare`, which the caller
//! runs only after the user confirmed it.

use std::{
    ffi::OsStr,
    fs::{self, DirBuilder},
    os::unix::{
        ffi::OsStrExt,
        fs::{DirBuilderExt, MetadataExt, PermissionsExt},
    },
    path::{Component, Path, PathBuf},
};

use uuid::Uuid;

use crate::{
    caddy::{
        session::{ADMIN_SOCKET_FILE, SOCKET_PATH_LIMIT, socket_path_usable},
        store::RUNS_DIRECTORY,
    },
    error::AppError,
    grants::ensure_below_home,
};

pub const DEFAULT_DIRECTORY_NAME: &str = ".caddy";
const PRIVATE_MODE: u32 = 0o700;
const PRIVATE_MODE_MASK: u32 = 0o077;
const GROUP_OR_OTHER_WRITE: u32 = 0o022;
const CLOUD_SYNCED_ROOTS: [&[&str]; 2] = [
    &["Library", "Mobile Documents"],
    &["Library", "CloudStorage"],
];
const CLOUD_SYNCED_TOP_LEVEL: &str = "Dropbox";
const ICLOUD_TOP_LEVEL_PREFIX: &str = "iCloud";

/// The suggested work directory, `~/.caddy`. Only a suggestion for the form:
/// nothing is created here.
pub fn default_candidate(home: &Path) -> PathBuf {
    home.join(DEFAULT_DIRECTORY_NAME)
}

/// Checks an existing directory the user picked and returns its canonical path.
pub fn validate_candidate(path: &Path, home: &Path) -> Result<PathBuf, AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::permission_denied(
            "工作目录不能是符号链接，请选择实际的文件夹。",
        ));
    }
    if !metadata.is_dir() {
        return Err(AppError::validation_failed("工作目录必须是文件夹。"));
    }
    let canonical = fs::canonicalize(path).map_err(|_| unavailable())?;
    ensure_below_home(&canonical, Some(home)).map_err(AppError::from)?;
    reject_cloud_synced(&canonical, home)?;
    let owner = fs::metadata(home).map_err(|_| unavailable())?.uid();
    if metadata.uid() != owner {
        return Err(AppError::permission_denied(
            "工作目录必须属于当前用户，请选择自己的文件夹。",
        ));
    }
    if metadata.permissions().mode() & GROUP_OR_OTHER_WRITE != 0 {
        return Err(AppError::permission_denied(
            "工作目录不能被同组或其他用户写入，请收紧权限或选择其他文件夹。",
        ));
    }
    Ok(canonical)
}

/// Creates the confirmed work directory with owner-only permissions, or tightens
/// an existing one to owner-only, then checks it like any candidate. Refuses when
/// the existing directory cannot be tightened.
pub fn prepare(path: &Path, home: &Path) -> Result<PathBuf, AppError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(AppError::permission_denied(
                    "工作目录路径已被占用且不是文件夹，已停止。",
                ));
            }
            if metadata.permissions().mode() & PRIVATE_MODE_MASK != 0 {
                fs::set_permissions(path, fs::Permissions::from_mode(PRIVATE_MODE)).map_err(
                    |_| AppError::permission_denied("工作目录无法收紧为仅本人可访问，已停止。"),
                )?;
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or_else(unavailable)?;
            let canonical_parent = fs::canonicalize(parent).map_err(|_| unavailable())?;
            if canonical_parent != home {
                ensure_below_home(&canonical_parent, Some(home)).map_err(AppError::from)?;
            }
            DirBuilder::new()
                .mode(PRIVATE_MODE)
                .create(path)
                .map_err(|_| AppError::permission_denied("工作目录无法创建，已停止。"))?;
        }
        Err(_) => return Err(unavailable()),
    }
    validate_candidate(path, home)
}

/// The admin socket of a run lives at `<workdir>/runs/<session>/admin.sock`.
/// Refuses, instead of moving the socket to a shared temporary directory or to
/// the default admin port, when that path cannot be used.
pub fn check_socket_path(workdir: &Path) -> Result<(), AppError> {
    let socket = workdir
        .join(RUNS_DIRECTORY)
        .join(Uuid::nil().to_string())
        .join(ADMIN_SOCKET_FILE);
    if socket.as_os_str().as_bytes().len() > SOCKET_PATH_LIMIT {
        return Err(AppError::validation_failed(
            "工作目录路径过长，超出 Unix socket 长度上限，请选择更短的目录。",
        ));
    }
    if !socket_path_usable(&socket) {
        return Err(AppError::validation_failed(
            "工作目录路径包含空格或特殊字符，socket 无法使用，请选择其他目录。",
        ));
    }
    Ok(())
}

fn reject_cloud_synced(canonical: &Path, home: &Path) -> Result<(), AppError> {
    let Ok(relative) = canonical.strip_prefix(home) else {
        return Ok(());
    };
    let parts: Vec<&OsStr> = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name),
            _ => None,
        })
        .collect();
    let synced = parts.first().is_some_and(|first| {
        let first = first.to_string_lossy();
        first.eq_ignore_ascii_case(CLOUD_SYNCED_TOP_LEVEL)
            || first
                .get(..ICLOUD_TOP_LEVEL_PREFIX.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(ICLOUD_TOP_LEVEL_PREFIX))
    }) || CLOUD_SYNCED_ROOTS
        .iter()
        .any(|root| starts_with_components(&parts, root));
    if synced {
        return Err(AppError::permission_denied(
            "云同步目录不能作为工作目录，请选择本地文件夹。",
        ));
    }
    Ok(())
}

fn starts_with_components(parts: &[&OsStr], root: &[&str]) -> bool {
    parts.len() >= root.len()
        && parts
            .iter()
            .zip(root)
            .all(|(part, expected)| part.to_string_lossy().eq_ignore_ascii_case(expected))
}

fn unavailable() -> AppError {
    AppError::permission_denied("工作目录无法访问，请确认该位置存在且可用。")
}
