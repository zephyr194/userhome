use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;

use super::{ConfigEnvironment, read::hash_bytes};

const BACKUP_CONTENT_FILE: &str = "content";
const BACKUP_METADATA_FILE: &str = "metadata.json";
const MAX_BACKUPS_PER_DOCUMENT: usize = 20;
const MAX_BACKUP_METADATA_BYTES: u64 = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupMetadata {
    pub backup_id: String,
    pub app_id: String,
    pub config_id: String,
    pub created_at_epoch_ms: u64,
    pub content_hash: String,
    pub size_bytes: u64,
    pub mode: u32,
}

#[derive(Debug, Clone)]
pub struct BackupRecord {
    pub metadata: BackupMetadata,
    pub content_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub backup_id: String,
    pub app_id: String,
    pub config_id: String,
    pub created_at_epoch_ms: u64,
    pub content_hash: String,
    pub size_bytes: u64,
    pub mode: u32,
}

pub fn create_backup(
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
    bytes: &[u8],
    mode: u32,
) -> Result<BackupRecord, AppError> {
    let root = ensure_backup_root(environment)?;
    let app_root = create_owned_child_dir(&root, app_id)?;
    let document_root = create_owned_child_dir(&app_root, config_id)?;
    let created_at_epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::internal())?
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    let backup_id = format!("backup-{created_at_epoch_ms}-{}", Uuid::new_v4());
    let backup_root = create_owned_child_dir(&document_root, &backup_id)?;

    let metadata = BackupMetadata {
        backup_id,
        app_id: app_id.to_owned(),
        config_id: config_id.to_owned(),
        created_at_epoch_ms,
        content_hash: hash_bytes(bytes),
        size_bytes: bytes.len() as u64,
        mode: mode & 0o777,
    };
    let content_path = backup_root.join(BACKUP_CONTENT_FILE);
    write_protected_file(&content_path, bytes)?;
    let encoded = serde_json::to_vec(&metadata).map_err(|_| AppError::internal())?;
    write_protected_file(&backup_root.join(BACKUP_METADATA_FILE), &encoded)?;
    enforce_retention(environment, app_id, config_id)?;

    Ok(BackupRecord {
        metadata,
        content_path,
    })
}

pub fn list_backups(
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
) -> Result<Vec<BackupSummary>, AppError> {
    Ok(list_records(environment, app_id, config_id)?
        .into_iter()
        .map(|record| BackupSummary {
            backup_id: record.metadata.backup_id,
            app_id: record.metadata.app_id,
            config_id: record.metadata.config_id,
            created_at_epoch_ms: record.metadata.created_at_epoch_ms,
            content_hash: record.metadata.content_hash,
            size_bytes: record.metadata.size_bytes,
            mode: record.metadata.mode,
        })
        .collect())
}

pub fn load_backup(
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
    backup_id: &str,
) -> Result<BackupRecord, AppError> {
    if !is_backup_id(backup_id) {
        return Err(AppError::not_found("Backup was not found."));
    }
    list_records(environment, app_id, config_id)?
        .into_iter()
        .find(|record| record.metadata.backup_id == backup_id)
        .ok_or_else(|| AppError::not_found("Backup was not found."))
}

pub fn enforce_retention(
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
) -> Result<(), AppError> {
    let records = list_records(environment, app_id, config_id)?;
    for record in records.into_iter().skip(MAX_BACKUPS_PER_DOCUMENT) {
        let backup_dir = record
            .content_path
            .parent()
            .ok_or_else(AppError::internal)?;
        fs::remove_dir_all(backup_dir)
            .map_err(|_| AppError::permission_denied("Old backup cannot be removed."))?;
    }
    Ok(())
}

fn ensure_backup_root(environment: &ConfigEnvironment) -> Result<PathBuf, AppError> {
    let canonical_home = fs::canonicalize(environment.home())
        .map_err(|_| AppError::permission_denied("Backup root is not authorized."))?;
    let relative = environment
        .backup_root()
        .strip_prefix(environment.home())
        .map_err(|_| AppError::permission_denied("Backup root is not authorized."))?;
    let mut current = canonical_home;
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(AppError::permission_denied(
                "Backup root is not authorized.",
            ));
        };
        current = create_owned_child_dir(&current, name)?;
    }
    Ok(current)
}

fn create_owned_child_dir(
    parent: &Path,
    name: impl AsRef<std::ffi::OsStr>,
) -> Result<PathBuf, AppError> {
    let path = parent.join(Path::new(name.as_ref()));
    match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(AppError::permission_denied(
                    "Backup directory is not authorized.",
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&path)
                .map_err(|_| AppError::permission_denied("Backup directory cannot be created."))?;
        }
        Err(_) => {
            return Err(AppError::permission_denied(
                "Backup directory is unavailable.",
            ));
        }
    }
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
        .map_err(|_| AppError::permission_denied("Backup permissions cannot be protected."))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|_| AppError::permission_denied("Backup directory is not authorized."))?;
    let canonical_path = fs::canonicalize(&path)
        .map_err(|_| AppError::permission_denied("Backup directory is not authorized."))?;
    if canonical_path.parent() != Some(canonical_parent.as_path()) {
        return Err(AppError::permission_denied(
            "Backup directory is not authorized.",
        ));
    }
    Ok(canonical_path)
}

fn write_protected_file(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| AppError::permission_denied("Backup file cannot be created."))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| AppError::permission_denied("Backup file cannot be written."))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| AppError::permission_denied("Backup permissions cannot be protected."))
}

fn list_records(
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
) -> Result<Vec<BackupRecord>, AppError> {
    let root = environment.backup_root();
    if !root.exists() {
        return Ok(Vec::new());
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|_| AppError::permission_denied("Backup root is not authorized."))?;
    let document_root = canonical_root.join(app_id).join(config_id);
    if !document_root.exists() {
        return Ok(Vec::new());
    }
    let app_root = canonical_root.join(app_id);
    for path in [&app_root, &document_root] {
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| AppError::permission_denied("Backup directory is unavailable."))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(AppError::permission_denied(
                "Backup directory is not authorized.",
            ));
        }
    }
    let canonical_document_root = fs::canonicalize(&document_root)
        .map_err(|_| AppError::permission_denied("Backup directory is not authorized."))?;
    if !canonical_document_root.starts_with(&canonical_root) {
        return Err(AppError::permission_denied(
            "Backup directory is not authorized.",
        ));
    }

    let mut records = Vec::new();
    for entry in fs::read_dir(&canonical_document_root)
        .map_err(|_| AppError::permission_denied("Backups cannot be listed."))?
    {
        let entry = entry.map_err(|_| AppError::permission_denied("Backups cannot be listed."))?;
        let file_type = entry
            .file_type()
            .map_err(|_| AppError::permission_denied("Backup metadata is unavailable."))?;
        let backup_id = entry.file_name().to_string_lossy().into_owned();
        if !file_type.is_dir() || !is_backup_id(&backup_id) {
            continue;
        }
        let backup_dir = entry.path();
        let canonical_backup_dir = fs::canonicalize(&backup_dir)
            .map_err(|_| AppError::permission_denied("Backup is not authorized."))?;
        if !canonical_backup_dir.starts_with(&canonical_document_root) {
            return Err(AppError::permission_denied("Backup is not authorized."));
        }
        let metadata_path = canonical_backup_dir.join(BACKUP_METADATA_FILE);
        let metadata_file = match fs::symlink_metadata(&metadata_path) {
            Ok(value) if value.is_file() && !value.file_type().is_symlink() => value,
            _ => continue,
        };
        if metadata_file.len() > MAX_BACKUP_METADATA_BYTES {
            continue;
        }
        let encoded = match fs::read(&metadata_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let metadata: BackupMetadata = match serde_json::from_slice(&encoded) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.backup_id != backup_id
            || metadata.app_id != app_id
            || metadata.config_id != config_id
            || metadata.mode > 0o777
        {
            continue;
        }
        records.push(BackupRecord {
            metadata,
            content_path: canonical_backup_dir.join(BACKUP_CONTENT_FILE),
        });
    }
    records.sort_by(|left, right| {
        right
            .metadata
            .created_at_epoch_ms
            .cmp(&left.metadata.created_at_epoch_ms)
            .then_with(|| right.metadata.backup_id.cmp(&left.metadata.backup_id))
    });
    Ok(records)
}

fn is_backup_id(value: &str) -> bool {
    value.starts_with("backup-")
        && value.len() <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

pub(crate) fn read_backup_content(
    record: &BackupRecord,
    max_size: usize,
) -> Result<Vec<u8>, AppError> {
    if record.metadata.size_bytes > max_size as u64 {
        return Err(AppError::validation_failed(
            "Backup exceeds the catalog size limit.",
        ));
    }
    let metadata = fs::symlink_metadata(&record.content_path)
        .map_err(|_| AppError::not_found("Backup content is unavailable."))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::permission_denied(
            "Backup content is not authorized.",
        ));
    }
    let bytes = fs::read(&record.content_path)
        .map_err(|_| AppError::permission_denied("Backup content cannot be read."))?;
    if bytes.len() > max_size || hash_bytes(&bytes) != record.metadata.content_hash {
        return Err(AppError::validation_failed(
            "Backup content failed integrity validation.",
        ));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

    use uuid::Uuid;

    use super::{super::ConfigEnvironment, create_backup};

    struct Fixture {
        root: PathBuf,
        environment: ConfigEnvironment,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-backup-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            fs::create_dir_all(&home).expect("create home");
            fs::create_dir_all(&brew).expect("create brew");
            let environment =
                ConfigEnvironment::new(home.clone(), brew, home.join(".userhome/backups"));
            Self { root, environment }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn creates_mode_protected_backup_with_exact_bytes_and_mode_metadata() {
        let fixture = Fixture::new();
        let bytes = b"[user]\nname = Before\n";
        let backup = create_backup(
            &fixture.environment,
            "git",
            "git-global-config",
            bytes,
            0o640,
        )
        .expect("create backup");

        assert_eq!(fs::read(&backup.content_path).expect("read backup"), bytes);
        assert_eq!(
            fs::metadata(&backup.content_path)
                .expect("backup metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(backup.metadata.mode, 0o640);
    }

    #[test]
    fn rejects_backup_root_that_escapes_through_a_symlink() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = fixture.root.join("outside");
        fs::create_dir_all(&outside).expect("create outside");
        fs::create_dir_all(fixture.environment.home().join(".userhome"))
            .expect("create app data parent");
        symlink(
            &outside,
            fixture.environment.home().join(".userhome/backups"),
        )
        .expect("create escaping symlink");

        let error = create_backup(
            &fixture.environment,
            "git",
            "git-global-config",
            b"secret",
            0o600,
        )
        .expect_err("reject escaping backup root");

        assert_eq!(error.code(), crate::error::AppErrorCode::PermissionDenied);
        assert!(
            fs::read_dir(&outside)
                .expect("read outside")
                .next()
                .is_none()
        );
    }
}
