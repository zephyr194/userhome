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

use crate::{error::AppError, settings::BackupRetention};

use super::{
    ConfigEnvironment,
    backup::{BackupRecord, create_backup, read_backup_content},
    read::{hash_bytes, read_bounded},
};

pub(crate) enum AtomicReplaceError {
    BeforeCommit(AppError),
    AfterCommit(AppError),
}

pub(crate) struct BackedUpReplace<'a> {
    pub app_id: &'a str,
    pub config_id: &'a str,
    pub target: &'a Path,
    pub content: &'a [u8],
    pub expected_hash: &'a str,
    pub max_size_bytes: usize,
    pub desired_mode: Option<u32>,
    pub retention: BackupRetention,
}

/// Backs up the current bytes, atomically replaces the target, then runs
/// `post_validate` on the written bytes; any post-commit failure restores the
/// backup before the error is returned.
pub(crate) fn replace_with_backup<F>(
    environment: &ConfigEnvironment,
    request: BackedUpReplace<'_>,
    post_validate: F,
) -> Result<BackupRecord, AppError>
where
    F: FnOnce(&[u8]) -> Result<(), AppError>,
{
    let BackedUpReplace {
        app_id,
        config_id,
        target,
        content,
        expected_hash,
        max_size_bytes,
        desired_mode,
        retention,
    } = request;
    let current = read_bounded(target, max_size_bytes)?;
    if hash_bytes(&current) != expected_hash {
        return Err(AppError::conflict("Configuration changed after preview."));
    }
    let current_mode = fs::metadata(target)
        .map_err(|_| AppError::not_found("Configuration document is unavailable."))?
        .permissions()
        .mode()
        & 0o777;
    let backup = create_backup(
        environment,
        app_id,
        config_id,
        &current,
        current_mode,
        retention,
    )?;

    match atomic_replace(
        target,
        content,
        desired_mode.unwrap_or(current_mode),
        Some((expected_hash, max_size_bytes)),
    ) {
        Ok(()) => {}
        Err(AtomicReplaceError::BeforeCommit(error)) => return Err(error),
        Err(AtomicReplaceError::AfterCommit(error)) => {
            restore_backup_after_commit_failure(target, &backup, max_size_bytes)?;
            return Err(error);
        }
    }
    let written = read_bounded(target, max_size_bytes)?;
    let post_result = if written == content {
        post_validate(&written)
    } else {
        Err(AppError::validation_failed(
            "Configuration verification failed after replacement.",
        ))
    };
    if let Err(error) = post_result {
        restore_backup_after_commit_failure(target, &backup, max_size_bytes)?;
        return Err(error);
    }
    Ok(backup)
}

/// Atomically creates a missing file, verifies it with `post_validate`, and
/// removes it again when verification fails.
pub(crate) fn create_new_verified<F>(
    target: &Path,
    content: &[u8],
    mode: u32,
    max_size_bytes: usize,
    post_validate: F,
) -> Result<(), AppError>
where
    F: FnOnce(&[u8]) -> Result<(), AppError>,
{
    atomic_create_new(target, content, mode)?;
    let written = read_bounded(target, max_size_bytes)?;
    let post_result = if written == content {
        post_validate(&written)
    } else {
        Err(AppError::validation_failed(
            "Configuration verification failed after creation.",
        ))
    };
    if let Err(error) = post_result {
        let parent = target.parent().ok_or_else(AppError::internal)?;
        fs::remove_file(target).map_err(|_| {
            AppError::partial_failure(
                "New configuration validation failed and rollback could not remove it.",
                false,
            )
        })?;
        sync_directory(parent).map_err(|_| {
            AppError::partial_failure(
                "New configuration rollback could not be synchronized.",
                false,
            )
        })?;
        return Err(error);
    }
    Ok(())
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
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
        path::PathBuf,
    };

    use uuid::Uuid;

    use crate::{error::AppError, error::AppErrorCode, settings::BackupRetention};

    use super::{
        super::{ConfigEnvironment, read::hash_bytes},
        BackedUpReplace, atomic_create_new, atomic_replace, create_new_verified,
        replace_with_backup,
    };

    struct Fixture {
        root: PathBuf,
        home: PathBuf,
        environment: ConfigEnvironment,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-atomic-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            fs::create_dir_all(&home).expect("create home");
            fs::create_dir_all(&brew).expect("create brew");
            let environment =
                ConfigEnvironment::new(home.clone(), brew, home.join(".userhome/backups"));
            Self {
                root,
                home,
                environment,
            }
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

    #[test]
    fn create_new_verified_removes_the_file_when_verification_fails() {
        let fixture = Fixture::new();
        let target = fixture.home.join("file");

        let error = create_new_verified(&target, b"new", 0o600, 64, |_| {
            Err(AppError::validation_failed("forced failure"))
        })
        .expect_err("verification must fail");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
        assert!(!target.exists());
    }

    #[test]
    fn replace_with_backup_protects_backup_and_preserves_symlink_and_mode() {
        let fixture = Fixture::new();
        let real = fixture.home.join("real");
        let link = fixture.home.join("link");
        fs::write(&real, b"before").expect("write fixture");
        fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).expect("set mode");
        symlink("real", &link).expect("symlink");
        let target = fs::canonicalize(&link).expect("canonical");

        let backup = replace_with_backup(
            &fixture.environment,
            BackedUpReplace {
                app_id: "app",
                config_id: "doc",
                target: &target,
                content: b"after",
                expected_hash: &hash_bytes(b"before"),
                max_size_bytes: 64,
                desired_mode: None,
                retention: BackupRetention::TWENTY,
            },
            |_| Ok(()),
        )
        .expect("replace");

        assert!(link.is_symlink());
        assert_eq!(fs::read(&real).expect("read"), b"after");
        assert_eq!(mode_of(&real), 0o640);
        assert_eq!(fs::read(&backup.content_path).expect("backup"), b"before");
        assert_eq!(mode_of(&backup.content_path), 0o600);
        assert_eq!(
            mode_of(backup.content_path.parent().expect("backup dir")),
            0o700
        );
    }

    #[test]
    fn replace_with_backup_restores_prior_bytes_when_post_validation_fails() {
        let fixture = Fixture::new();
        let target = fixture.home.join("file");
        fs::write(&target, b"before").expect("write fixture");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).expect("set mode");

        let error = replace_with_backup(
            &fixture.environment,
            BackedUpReplace {
                app_id: "app",
                config_id: "doc",
                target: &target,
                content: b"after",
                expected_hash: &hash_bytes(b"before"),
                max_size_bytes: 64,
                desired_mode: Some(0o644),
                retention: BackupRetention::TWENTY,
            },
            |_| Err(AppError::validation_failed("forced failure")),
        )
        .expect_err("post validation must fail");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
        assert_eq!(fs::read(&target).expect("read"), b"before");
        assert_eq!(mode_of(&target), 0o600);
    }
}
