use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    catalog::{Catalog, ConfigDocumentDefinition},
    error::AppError,
    security::paths::{PathPolicyError, resolve_rooted_catalog_path},
    settings::BackupRetention,
};

use super::{
    ConfigEnvironment,
    backup::{BackupRecord, create_backup, read_backup_content},
    diff::{ConfigDiff, build_diff},
    read::{hash_bytes, read_bounded},
    resolve_definition, resolve_path,
    validation::{self, validate_bytes, validate_text_bytes},
};

pub const MISSING_CONFIG_HASH: &str = "MISSING";
const VARIANT_SOURCE_PREFIX: &str = "config-variant:";

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

pub struct SchemaStructuredWriteRequest {
    pub app_id: String,
    pub config_id: String,
    pub expected_hash: String,
    pub fields: Value,
    pub allow_new_file: bool,
    pub variant_id: Option<String>,
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

impl PendingConfigMutation {
    pub fn bind_variant(&mut self, variant_id: String) {
        self.source_id = Some(format!("{VARIANT_SOURCE_PREFIX}{variant_id}"));
    }

    pub fn variant_id(&self) -> Option<&str> {
        self.source_id
            .as_deref()
            .and_then(|value| value.strip_prefix(VARIANT_SOURCE_PREFIX))
    }

    pub fn mutation_source_id(&self) -> Option<&str> {
        self.source_id
            .as_deref()
            .filter(|value| !value.starts_with(VARIANT_SOURCE_PREFIX))
    }
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
    prepare_schema_structured_write(
        catalog,
        environment,
        SchemaStructuredWriteRequest {
            app_id: input.app_id,
            config_id: input.config_id,
            expected_hash: input.expected_hash,
            fields: input.fields,
            allow_new_file: false,
            variant_id: None,
        },
    )
}

pub fn prepare_schema_structured_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    request: SchemaStructuredWriteRequest,
) -> Result<(PendingConfigMutation, PreparedWritePreview), AppError> {
    let SchemaStructuredWriteRequest {
        app_id,
        config_id,
        expected_hash,
        fields,
        allow_new_file,
        variant_id,
    } = request;
    let definition = super::resolve_definition(catalog, &app_id, &config_id)?;
    if definition.write_policy() == "READ_ONLY" {
        return Err(AppError::not_supported(
            "Configuration document is read-only.",
        ));
    }
    if allow_new_file && variant_id.is_none() {
        return Err(AppError::invalid_input(
            "Creating a configuration file requires an explicit variant.",
        ));
    }
    let target_path = resolve_mutation_target(definition, environment, variant_id.as_deref())?;
    let (current, current_hash, creating) = match fs::metadata(&target_path) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err(AppError::not_supported(
                    "Only regular configuration files can be written.",
                ));
            }
            if allow_new_file {
                return Err(AppError::conflict(
                    "Complete templates can create only missing configuration files.",
                ));
            }
            let current = read_bounded(&target_path, definition.max_size_bytes())?;
            let current_hash = hash_bytes(&current);
            if expected_hash != current_hash {
                return Err(AppError::conflict(
                    "Configuration changed after it was read.",
                ));
            }
            (current, current_hash, false)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if !allow_new_file || expected_hash != MISSING_CONFIG_HASH {
                return Err(AppError::not_found(
                    "Configuration document does not exist.",
                ));
            }
            if definition.elevation_resource_id().is_some() {
                return Err(AppError::not_supported(
                    "Creating an elevated configuration file is not supported.",
                ));
            }
            (
                initial_schema_content(definition, &fields)?.into_bytes(),
                MISSING_CONFIG_HASH.to_owned(),
                true,
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(AppError::permission_denied(
                "Configuration document cannot be accessed.",
            ));
        }
        Err(_) => return Err(AppError::internal()),
    };
    let current_text = std::str::from_utf8(&current)
        .map_err(|_| AppError::validation_failed("Configuration must be valid UTF-8."))?;
    let content = super::adapters::prepare_structured(definition, current_text, fields)?;
    if creating {
        validate_new_file_bytes(definition, environment, content.as_bytes())?;
    } else {
        validate_bytes(definition, environment, content.as_bytes())?;
    }
    let proposed_hash = hash_bytes(content.as_bytes());
    let diff = build_diff(
        if creating { "" } else { current_text },
        &content,
        definition.sensitivity(),
    );
    let elevation_resource_id = (!creating)
        .then(|| elevation_resource_id(definition, environment, &target_path))
        .flatten();
    let mut mutation = PendingConfigMutation {
        app_id,
        config_id,
        expected_hash: current_hash.clone(),
        proposed_hash: proposed_hash.clone(),
        expected_target: target_path,
        content: content.into_bytes(),
        desired_mode: (definition.adapter_id() == "ssh-config").then_some(0o600),
        source_id: None,
        elevation_resource_id,
    };
    if let Some(variant_id) = variant_id {
        mutation.bind_variant(variant_id);
    }
    Ok((
        mutation,
        PreparedWritePreview {
            current_hash,
            proposed_hash,
            diff,
        },
    ))
}

fn resolve_mutation_target(
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
    variant_id: Option<&str>,
) -> Result<PathBuf, AppError> {
    let Some(variant_id) = variant_id else {
        return resolve_path(definition, environment).map(|path| path.target_path);
    };
    let variant = definition
        .path_variants()
        .iter()
        .find(|variant| variant.variant_id() == variant_id)
        .ok_or_else(|| AppError::not_found("Configuration variant was not found."))?;
    let (root, display_root) = environment
        .catalog_root(variant.root())
        .ok_or_else(|| AppError::not_supported("Configuration variant root is unsupported."))?;
    resolve_rooted_catalog_path(root, variant.relative_path(), display_root)
        .map(|path| path.target_path)
        .map_err(|error| match error {
            PathPolicyError::OutsideAuthorizedRoot | PathPolicyError::UnsupportedEntry => {
                AppError::permission_denied("Configuration path is not authorized.")
            }
            PathPolicyError::PermissionDenied => {
                AppError::permission_denied("Configuration path cannot be accessed.")
            }
            PathPolicyError::Io => AppError::internal(),
            PathPolicyError::NotFound => AppError::not_found("Configuration path is unavailable."),
        })
}

pub fn execute_pending_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
    retention: BackupRetention,
) -> Result<String, AppError> {
    if mutation.expected_hash == MISSING_CONFIG_HASH {
        execute_new_file_write(catalog, environment, mutation)?;
        Ok("new-file".to_owned())
    } else {
        execute_write(catalog, environment, mutation, retention)
            .map(|backup| backup.metadata.backup_id)
    }
}

pub fn execute_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
    retention: BackupRetention,
) -> Result<BackupRecord, AppError> {
    execute_write_with_post_validator(
        catalog,
        environment,
        mutation,
        retention,
        |definition, bytes| validate_bytes(definition, environment, bytes),
    )
}

pub fn validate_pending_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
) -> Result<(), AppError> {
    let definition = resolve_definition(catalog, &mutation.app_id, &mutation.config_id)?;
    if mutation.expected_hash == MISSING_CONFIG_HASH {
        validate_new_file_bytes(definition, environment, &mutation.content)?;
    } else {
        validate_bytes(definition, environment, &mutation.content)?;
    }
    if hash_bytes(&mutation.content) != mutation.proposed_hash {
        return Err(AppError::conflict(
            "Configuration preview no longer matches its content.",
        ));
    }
    let target_path = resolve_mutation_target(definition, environment, mutation.variant_id())?;
    if target_path != mutation.expected_target {
        return Err(AppError::conflict(
            "Configuration target changed after preview.",
        ));
    }
    if mutation.expected_hash == MISSING_CONFIG_HASH {
        match fs::symlink_metadata(&target_path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => {
                return Err(AppError::conflict(
                    "Configuration file was created after preview.",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(AppError::permission_denied(
                    "Configuration path cannot be rechecked.",
                ));
            }
            Err(_) => return Err(AppError::internal()),
        }
    } else {
        let current = read_bounded(&target_path, definition.max_size_bytes())?;
        if hash_bytes(&current) != mutation.expected_hash {
            return Err(AppError::conflict("Configuration changed after preview."));
        }
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

fn execute_new_file_write(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
) -> Result<(), AppError> {
    let definition = resolve_definition(catalog, &mutation.app_id, &mutation.config_id)?;
    validate_pending_write(catalog, environment, mutation)?;
    let mode = mutation.desired_mode.unwrap_or(0o600);
    atomic_create_new(&mutation.expected_target, &mutation.content, mode)?;
    let written = read_bounded(&mutation.expected_target, definition.max_size_bytes())?;
    let post_result = if written == mutation.content {
        validate_bytes(definition, environment, &written)
    } else {
        Err(AppError::validation_failed(
            "Configuration verification failed after creation.",
        ))
    };
    if let Err(error) = post_result {
        let parent = mutation
            .expected_target
            .parent()
            .ok_or_else(AppError::internal)?;
        fs::remove_file(&mutation.expected_target).map_err(|_| {
            AppError::partial_failure(
                "New configuration validation failed and rollback could not remove it.",
                false,
            )
        })?;
        FileSync::sync_directory(parent).map_err(|_| {
            AppError::partial_failure(
                "New configuration rollback could not be synchronized.",
                false,
            )
        })?;
        return Err(error);
    }
    Ok(())
}

fn initial_schema_content(
    definition: &crate::catalog::ConfigDocumentDefinition,
    fields: &Value,
) -> Result<String, AppError> {
    match definition.adapter_id() {
        "copilot-json" => Ok("{}\n".to_owned()),
        "caddyfile" => {
            let site_address = fields
                .get("siteAddress")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    AppError::invalid_input("A complete Caddy template requires a site address.")
                })?;
            Ok(format!("{site_address} {{\n}}\n"))
        }
        _ => Ok(String::new()),
    }
}

fn validate_new_file_bytes(
    definition: &crate::catalog::ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
    bytes: &[u8],
) -> Result<(), AppError> {
    let text = validate_text_bytes(definition, bytes)?;
    match definition.validator_id() {
        "json" => validation::json::validate(text),
        "markdown" | "text" => Ok(()),
        "caddy" => validation::caddy::validate(environment, text),
        "git-config" => validation::git::validate(text),
        "ssh-config" => validation::ssh::validate(text),
        "zsh" => validation::zsh::validate(text),
        "npmrc" => validation::npm::validate(text),
        _ => Err(AppError::not_supported(
            "Configuration validator is not supported.",
        )),
    }
}

fn execute_write_with_post_validator<F>(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
    retention: BackupRetention,
    post_validate: F,
) -> Result<BackupRecord, AppError>
where
    F: FnOnce(&crate::catalog::ConfigDocumentDefinition, &[u8]) -> Result<(), AppError>,
{
    let definition = resolve_definition(catalog, &mutation.app_id, &mutation.config_id)?;
    validate_pending_write(catalog, environment, mutation)?;
    let current = read_bounded(&mutation.expected_target, definition.max_size_bytes())?;
    if hash_bytes(&current) != mutation.expected_hash {
        return Err(AppError::conflict("Configuration changed after preview."));
    }
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
        retention,
    )?;

    match atomic_replace(
        &mutation.expected_target,
        &mutation.content,
        mutation.desired_mode.unwrap_or(current_mode),
        Some((&mutation.expected_hash, definition.max_size_bytes())),
    ) {
        Ok(()) => {}
        Err(AtomicReplaceError::BeforeCommit(error)) => return Err(error),
        Err(AtomicReplaceError::AfterCommit(error)) => {
            restore_backup_after_commit_failure(definition, &mutation.expected_target, &backup)?;
            return Err(error);
        }
    }
    let written = read_bounded(&mutation.expected_target, definition.max_size_bytes())?;
    let post_result = if written == mutation.content {
        post_validate(definition, &written)
    } else {
        Err(AppError::validation_failed(
            "Configuration verification failed after replacement.",
        ))
    };
    if let Err(error) = post_result {
        restore_backup_after_commit_failure(definition, &mutation.expected_target, &backup)?;
        return Err(error);
    }
    Ok(backup)
}

fn restore_backup_after_commit_failure(
    definition: &ConfigDocumentDefinition,
    target: &Path,
    backup: &BackupRecord,
) -> Result<(), AppError> {
    let prior = read_backup_content(backup, definition.max_size_bytes()).map_err(|_| {
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

enum AtomicReplaceError {
    BeforeCommit(AppError),
    AfterCommit(AppError),
}

fn atomic_replace(
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
        FileSync::sync_directory(parent).map_err(AtomicReplaceError::AfterCommit)?;
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

fn atomic_create_new(path: &Path, bytes: &[u8], mode: u32) -> Result<(), AppError> {
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
            FileSync::sync_directory(parent).map_err(|_| {
                AppError::partial_failure(
                    "Temporary file cleanup rollback could not be synchronized.",
                    false,
                )
            })?;
            return Err(AppError::permission_denied(
                "Temporary file cannot be removed.",
            ));
        }
        if let Err(error) = FileSync::sync_directory(parent) {
            fs::remove_file(path).map_err(|_| {
                AppError::partial_failure(
                    "Configuration creation committed but rollback could not remove the target.",
                    false,
                )
            })?;
            FileSync::sync_directory(parent).map_err(|_| {
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

    use crate::{catalog::load_builtin_catalog, error::AppErrorCode, settings::BackupRetention};

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

        let backup = super::execute_write(
            &catalog,
            &fixture.environment,
            &mutation,
            BackupRetention::TWENTY,
        )
        .expect("execute write");

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

        let error = super::execute_write(
            &catalog,
            &fixture.environment,
            &mutation,
            BackupRetention::TWENTY,
        )
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

        let error = execute_write_with_post_validator(
            &catalog,
            &fixture.environment,
            &mutation,
            BackupRetention::TWENTY,
            |_, _| Err(crate::error::AppError::validation_failed("forced failure")),
        )
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
