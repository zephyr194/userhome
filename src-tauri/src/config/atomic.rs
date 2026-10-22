//! Catalog-independent primitives for atomic file replacement, creation,
//! backup-before-write and restore. Callers resolve and validate their own
//! targets; everything here operates on explicit paths, bytes and limits.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
};

use uuid::Uuid;

use crate::error::AppError;

use super::{
    backup::{BackupRecord, read_backup_content},
    read::{hash_bytes, read_bounded},
};

pub(crate) enum AtomicReplaceError {
    BeforeCommit(AppError),
    AfterCommit(AppError),
}

pub(crate) fn restore_backup_after_commit_failure(
    target: &Path,
    backup: &BackupRecord,
    max_size_bytes: usize,
) -> Result<(), AppError> {
    let prior = read_backup_content(backup, max_size_bytes).map_err(|_| {
        AppError::partial_failure(
            "Configuration replacement failed and backup content could not be read.",
            false,
        )
    })?;
    match atomic_replace(target, &prior, backup.metadata.mode, None) {
        Ok(()) => Ok(()),
        Err(_) => Err(AppError::partial_failure(
            "Configuration replacement failed and backup restoration did not complete.",
            false,
        )),
    }
}

pub(crate) fn atomic_replace(
    path: &Path,
    bytes: &[u8],
    mode: u32,
    expected_current: Option<(&str, usize)>,
) -> Result<(), AtomicReplaceError> {
    let parent = path.parent().ok_or_else(|| {
        AtomicReplaceError::BeforeCommit(AppError::permission_denied(
            "Configuration parent is unavailable.",
        ))
    })?;
    let temp_path = parent.join(format!(".userhome-{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<(), AtomicReplaceError> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&temp_path)
            .map_err(|_| {
                AtomicReplaceError::BeforeCommit(AppError::permission_denied(
                    "Temporary file cannot be created.",
                ))
            })?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| {
                AtomicReplaceError::BeforeCommit(AppError::permission_denied(
                    "Temporary file cannot be written.",
                ))
            })?;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(mode)).map_err(|_| {
            AtomicReplaceError::BeforeCommit(AppError::permission_denied(
                "File permissions cannot be preserved.",
            ))
        })?;
        if let Some((expected_hash, maximum_bytes)) = expected_current {
            let current =
                read_bounded(path, maximum_bytes).map_err(AtomicReplaceError::BeforeCommit)?;
            if hash_bytes(&current) != expected_hash {
                return Err(AtomicReplaceError::BeforeCommit(AppError::conflict(
                    "Configuration changed immediately before replacement.",
                )));
            }
        }
        fs::rename(&temp_path, path).map_err(|_| {
            AtomicReplaceError::BeforeCommit(AppError::permission_denied(
                "Configuration cannot be replaced.",
            ))
        })?;
        sync_directory(parent).map_err(AtomicReplaceError::AfterCommit)?;
        Ok(())
    })();
    if matches!(result, Err(AtomicReplaceError::BeforeCommit(_)))
        && temp_path.exists()
        && fs::remove_file(&temp_path).is_err()
    {
        return Err(AtomicReplaceError::BeforeCommit(AppError::partial_failure(
            "Configuration replacement failed and temporary content could not be removed.",
            false,
        )));
    }
    result
}

pub(crate) fn atomic_create_new(path: &Path, bytes: &[u8], mode: u32) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::permission_denied("Configuration parent is unavailable."))?;
    let temp_path = parent.join(format!(".userhome-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&temp_path)
            .map_err(|_| AppError::permission_denied("Temporary file cannot be created."))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| AppError::permission_denied("Temporary file cannot be written."))?;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(mode))
            .map_err(|_| AppError::permission_denied("File permissions cannot be preserved."))?;
        fs::hard_link(&temp_path, path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                AppError::conflict("Configuration file was created after preview.")
            } else {
                AppError::permission_denied("Configuration file cannot be created.")
            }
        })?;
        if fs::remove_file(&temp_path).is_err() {
            fs::remove_file(path).map_err(|_| {
                AppError::partial_failure(
                    "Temporary file cleanup failed and the new configuration could not be rolled back.",
                    false,
                )
            })?;
            sync_directory(parent).map_err(|_| {
                AppError::partial_failure(
                    "Temporary file cleanup rollback could not be synchronized.",
                    false,
                )
            })?;
            return Err(AppError::permission_denied(
                "Temporary file cannot be removed.",
            ));
        }
        if let Err(error) = sync_directory(parent) {
            fs::remove_file(path).map_err(|_| {
                AppError::partial_failure(
                    "Configuration creation committed but rollback could not remove the target.",
                    false,
                )
            })?;
            sync_directory(parent).map_err(|_| {
                AppError::partial_failure(
                    "Configuration creation rollback could not be synchronized.",
                    false,
                )
            })?;
            return Err(error);
        }
        Ok(())
    })();
    if result.is_err() && temp_path.exists() && fs::remove_file(&temp_path).is_err() {
        return Err(AppError::partial_failure(
            "Configuration creation failed and temporary content could not be removed.",
            false,
        ));
    }
    result
}

pub(crate) fn sync_directory(path: &Path) -> Result<(), AppError> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| AppError::permission_denied("Configuration directory cannot be synced."))
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

    use uuid::Uuid;

    use crate::error::AppErrorCode;

    use super::{super::read::hash_bytes, atomic_create_new, atomic_replace};

    struct Fixture {
        root: PathBuf,
        home: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-atomic-{}", Uuid::new_v4()));
            let home = root.join("home");
            fs::create_dir_all(&home).expect("create home");
            Self { root, home }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn mode_of(path: &std::path::Path) -> u32 {
        fs::metadata(path).expect("metadata").permissions().mode() & 0o777
    }

    #[test]
    fn atomic_replace_sets_mode_and_leaves_no_temporary_file() {
        let fixture = Fixture::new();
        let target = fixture.home.join("file");
        fs::write(&target, b"before").expect("write fixture");

        atomic_replace(&target, b"after", 0o640, Some((&hash_bytes(b"before"), 64)))
            .unwrap_or_else(|_| panic!("replace"));

        assert_eq!(fs::read(&target).expect("read"), b"after");
        assert_eq!(mode_of(&target), 0o640);
        assert_eq!(fs::read_dir(&fixture.home).expect("list").count(), 1);
    }

    #[test]
    fn atomic_replace_rejects_changed_content_without_touching_target() {
        let fixture = Fixture::new();
        let target = fixture.home.join("file");
        fs::write(&target, b"external").expect("write fixture");

        assert!(
            atomic_replace(&target, b"after", 0o600, Some((&hash_bytes(b"before"), 64))).is_err()
        );

        assert_eq!(fs::read(&target).expect("read"), b"external");
        assert_eq!(fs::read_dir(&fixture.home).expect("list").count(), 1);
    }

    #[test]
    fn atomic_create_new_refuses_to_overwrite_an_existing_path() {
        let fixture = Fixture::new();
        let target = fixture.home.join("file");
        fs::write(&target, b"existing").expect("write fixture");

        let error = atomic_create_new(&target, b"new", 0o600).expect_err("must conflict");

        assert_eq!(error.code(), AppErrorCode::Conflict);
        assert_eq!(fs::read(&target).expect("read"), b"existing");
        assert_eq!(fs::read_dir(&fixture.home).expect("list").count(), 1);
    }
}
