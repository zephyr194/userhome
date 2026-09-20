use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{catalog::Catalog, error::AppError};

use super::{
    ConfigEnvironment,
    backup::{BackupRecord, create_backup, read_backup_content},
    diff::{ConfigDiff, build_diff},
    read::{hash_bytes, read_bounded},
    resolve_definition, resolve_path,
    validation::validate_bytes,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigWriteInput {
    pub app_id: String,
    pub config_id: String,
    pub expected_hash: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StructuredConfigWriteInput {
    pub app_id: String,
    pub config_id: String,
    pub expected_hash: String,
    pub fields: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedWritePreview {
    pub current_hash: String,
    pub proposed_hash: String,
    pub diff: ConfigDiff,
}

#[derive(Debug, Clone)]
pub struct PendingConfigMutation {
    pub app_id: String,
    pub config_id: String,
    pub expected_hash: String,
    pub proposed_hash: String,
    pub expected_target: PathBuf,
    pub content: Vec<u8>,
    pub desired_mode: Option<u32>,
    pub source_id: Option<String>,
    pub elevation_resource_id: Option<String>,
}

pub fn prepare_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    input: ConfigWriteInput,
) -> Result<(PendingConfigMutation, PreparedWritePreview), AppError> {
    let definition = resolve_definition(catalog, &input.app_id, &input.config_id)?;
    if definition.write_policy() == "READ_ONLY" {
        return Err(AppError::not_supported(
            "Configuration document is read-only.",
        ));
    }
    let resolved = resolve_path(definition, environment)?;
    let metadata = fs::metadata(&resolved.target_path)
        .map_err(|_| AppError::not_found("Configuration document does not exist."))?;
    if !metadata.is_file() {
        return Err(AppError::not_supported(
            "Only regular configuration files can be written.",
        ));
    }
    let current = read_bounded(&resolved.target_path, definition.max_size_bytes())?;
    let current_hash = hash_bytes(&current);
    if input.expected_hash != current_hash {
        return Err(AppError::conflict(
            "Configuration changed after it was read.",
        ));
    }
    let current_text = std::str::from_utf8(&current)
        .map_err(|_| AppError::validation_failed("Configuration must be valid UTF-8."))?;
    let content = super::adapters::prepare_raw(definition, current_text, &input.content)?;
    validate_bytes(definition, environment, content.as_bytes())?;
    let proposed_hash = hash_bytes(content.as_bytes());
    let diff = build_diff(current_text, &content, definition.sensitivity());
    let elevation_resource_id =
        elevation_resource_id(definition, environment, &resolved.target_path);
    let mutation = PendingConfigMutation {
        app_id: input.app_id,
        config_id: input.config_id,
        expected_hash: current_hash.clone(),
        proposed_hash: proposed_hash.clone(),
        expected_target: resolved.target_path,
        content: content.into_bytes(),
        desired_mode: None,
        source_id: None,
        elevation_resource_id,
    };
    Ok((
        mutation,
        PreparedWritePreview {
            current_hash,
            proposed_hash,
            diff,
        },
    ))
}

pub fn prepare_structured_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    input: StructuredConfigWriteInput,
) -> Result<(PendingConfigMutation, PreparedWritePreview), AppError> {
    let definition = super::resolve_definition(catalog, &input.app_id, &input.config_id)?;
    if definition.write_policy() == "READ_ONLY" {
        return Err(AppError::not_supported(
            "Configuration document is read-only.",
        ));
    }
    let resolved = super::resolve_path(definition, environment)?;
    let metadata = fs::metadata(&resolved.target_path)
        .map_err(|_| AppError::not_found("Configuration document does not exist."))?;
    if !metadata.is_file() {
        return Err(AppError::not_supported(
            "Only regular configuration files can be written.",
        ));
    }
    let current = read_bounded(&resolved.target_path, definition.max_size_bytes())?;
    let current_hash = hash_bytes(&current);
    if input.expected_hash != current_hash {
        return Err(AppError::conflict(
            "Configuration changed after it was read.",
        ));
    }
    let current_text = std::str::from_utf8(&current)
        .map_err(|_| AppError::validation_failed("Configuration must be valid UTF-8."))?;
    let content = super::adapters::prepare_structured(definition, current_text, input.fields)?;
    validate_bytes(definition, environment, content.as_bytes())?;
    let proposed_hash = hash_bytes(content.as_bytes());
    let diff = build_diff(current_text, &content, definition.sensitivity());
    let elevation_resource_id =
        elevation_resource_id(definition, environment, &resolved.target_path);
    Ok((
        PendingConfigMutation {
            app_id: input.app_id,
            config_id: input.config_id,
            expected_hash: current_hash.clone(),
            proposed_hash: proposed_hash.clone(),
            expected_target: resolved.target_path,
            content: content.into_bytes(),
            desired_mode: (definition.adapter_id() == "ssh-config").then_some(0o600),
            source_id: None,
            elevation_resource_id,
        },
        PreparedWritePreview {
            current_hash,
            proposed_hash,
            diff,
        },
    ))
}

pub fn execute_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
) -> Result<BackupRecord, AppError> {
    execute_write_with_post_validator(catalog, environment, mutation, |definition, bytes| {
        validate_bytes(definition, environment, bytes)
    })
}

pub fn validate_pending_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
) -> Result<(), AppError> {
    let definition = resolve_definition(catalog, &mutation.app_id, &mutation.config_id)?;
    validate_bytes(definition, environment, &mutation.content)?;
    if hash_bytes(&mutation.content) != mutation.proposed_hash {
        return Err(AppError::conflict(
            "Configuration preview no longer matches its content.",
        ));
    }
    let resolved = resolve_path(definition, environment)?;
    if resolved.target_path != mutation.expected_target {
        return Err(AppError::conflict(
            "Configuration target changed after preview.",
        ));
    }
    let current = read_bounded(&resolved.target_path, definition.max_size_bytes())?;
    if hash_bytes(&current) != mutation.expected_hash {
        return Err(AppError::conflict("Configuration changed after preview."));
    }
    if mutation.elevation_resource_id.is_some()
        && mutation.elevation_resource_id.as_deref() != definition.elevation_resource_id()
    {
        return Err(AppError::conflict(
            "Configuration elevation policy changed after preview.",
        ));
    }
    Ok(())
}

fn execute_write_with_post_validator<F>(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
    post_validate: F,
) -> Result<BackupRecord, AppError>
where
    F: FnOnce(&crate::catalog::ConfigDocumentDefinition, &[u8]) -> Result<(), AppError>,
{
    let definition = resolve_definition(catalog, &mutation.app_id, &mutation.config_id)?;
    validate_pending_write(catalog, environment, mutation)?;
    let current = read_bounded(&mutation.expected_target, definition.max_size_bytes())?;
    let current_mode = fs::metadata(&mutation.expected_target)
        .map_err(|_| AppError::not_found("Configuration document is unavailable."))?
        .permissions()
        .mode()
        & 0o777;
    let backup = create_backup(
        environment,
        &mutation.app_id,
        &mutation.config_id,
        &current,
        current_mode,
    )?;

    atomic_replace(
        &mutation.expected_target,
        &mutation.content,
        mutation.desired_mode.unwrap_or(current_mode),
    )?;
    let written = read_bounded(&mutation.expected_target, definition.max_size_bytes())?;
    let post_result = if written == mutation.content {
        post_validate(definition, &written)
    } else {
        Err(AppError::validation_failed(
            "Configuration verification failed after replacement.",
        ))
    };
    if let Err(error) = post_result {
        let prior = read_backup_content(&backup, definition.max_size_bytes())?;
        atomic_replace(&mutation.expected_target, &prior, backup.metadata.mode)?;
        return Err(error);
    }
    Ok(backup)
}

pub(super) fn elevation_resource_id(
    definition: &crate::catalog::ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
    target: &Path,
) -> Option<String> {
    let resource_id = definition.elevation_resource_id()?;
    let target_metadata = fs::metadata(target).ok()?;
    let home_metadata = fs::metadata(environment.home()).ok()?;
    use std::os::unix::fs::MetadataExt;
    let mode = target_metadata.permissions().mode();
    let owned_and_writable = target_metadata.uid() == home_metadata.uid() && mode & 0o200 != 0;
    let world_writable = mode & 0o002 != 0;
    (!owned_and_writable && !world_writable).then(|| resource_id.to_owned())
}

pub(crate) fn atomic_replace(path: &Path, bytes: &[u8], mode: u32) -> Result<(), AppError> {
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
        fs::rename(&temp_path, path)
            .map_err(|_| AppError::permission_denied("Configuration cannot be replaced."))?;
        FileSync::sync_directory(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

struct FileSync;

impl FileSync {
    fn sync_directory(path: &Path) -> Result<(), AppError> {
        fs::File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| AppError::permission_denied("Configuration directory cannot be synced."))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
        path::PathBuf,
    };

    use uuid::Uuid;

    use crate::{catalog::load_builtin_catalog, error::AppErrorCode};

    use super::{
        super::ConfigEnvironment, ConfigWriteInput, execute_write_with_post_validator,
        prepare_write,
    };

    struct Fixture {
        root: PathBuf,
        home: PathBuf,
        environment: ConfigEnvironment,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-write-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            fs::create_dir_all(home.join("dotfiles")).expect("create dotfiles");
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

    #[test]
    fn writes_atomically_preserving_permissions_and_symlink() {
        let fixture = Fixture::new();
        let target = fixture.home.join("dotfiles/gitconfig");
        let logical = fixture.home.join(".gitconfig");
        fs::write(&target, b"[user]\nname = Before\n").expect("write fixture");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).expect("set fixture mode");
        symlink("dotfiles/gitconfig", &logical).expect("create symlink");
        let catalog = load_builtin_catalog().expect("catalog");
        let current_hash = super::hash_bytes(b"[user]\nname = Before\n");
        let (mutation, _) = prepare_write(
            &catalog,
            &fixture.environment,
            ConfigWriteInput {
                app_id: "git".to_owned(),
                config_id: "git-global-config".to_owned(),
                expected_hash: current_hash,
                content: "[user]\nname = After\n".to_owned(),
            },
        )
        .expect("prepare write");

        let backup =
            super::execute_write(&catalog, &fixture.environment, &mutation).expect("execute write");

        assert!(logical.is_symlink());
        assert_eq!(
            fs::read(&target).expect("read target"),
            b"[user]\nname = After\n"
        );
        assert_eq!(
            fs::metadata(&target)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o640
        );
        assert_eq!(
            fs::read(backup.content_path).expect("read backup"),
            b"[user]\nname = Before\n"
        );
    }

    #[test]
    fn rejects_stale_content_before_creating_a_backup() {
        let fixture = Fixture::new();
        let target = fixture.home.join(".gitconfig");
        fs::write(&target, b"[user]\nname = Before\n").expect("write fixture");
        let catalog = load_builtin_catalog().expect("catalog");
        let (mutation, _) = prepare_write(
            &catalog,
            &fixture.environment,
            ConfigWriteInput {
                app_id: "git".to_owned(),
                config_id: "git-global-config".to_owned(),
                expected_hash: super::hash_bytes(b"[user]\nname = Before\n"),
                content: "[user]\nname = After\n".to_owned(),
            },
        )
        .expect("prepare write");
        fs::write(&target, b"[user]\nname = External\n").expect("external edit");

        let error = super::execute_write(&catalog, &fixture.environment, &mutation)
            .expect_err("reject stale write");

        assert_eq!(error.code(), AppErrorCode::Conflict);
        assert_eq!(
            fs::read(&target).expect("read target"),
            b"[user]\nname = External\n"
        );
        assert!(!fixture.environment.backup_root().exists());
    }

    #[test]
    fn restores_exact_bytes_and_mode_when_post_write_validation_fails() {
        let fixture = Fixture::new();
        let target = fixture.home.join(".gitconfig");
        let original = b"[user]\nname = Before\n";
        fs::write(&target, original).expect("write fixture");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).expect("set fixture mode");
        let catalog = load_builtin_catalog().expect("catalog");
        let (mutation, _) = prepare_write(
            &catalog,
            &fixture.environment,
            ConfigWriteInput {
                app_id: "git".to_owned(),
                config_id: "git-global-config".to_owned(),
                expected_hash: super::hash_bytes(original),
                content: "[user]\nname = After\n".to_owned(),
            },
        )
        .expect("prepare write");

        let error =
            execute_write_with_post_validator(&catalog, &fixture.environment, &mutation, |_, _| {
                Err(crate::error::AppError::validation_failed("forced failure"))
            })
            .expect_err("post validation must fail");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
        assert_eq!(fs::read(&target).expect("read target"), original);
        assert_eq!(
            fs::metadata(&target)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
