use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    config::{
        ConfigCoordinator, ConfigEnvironment,
        backup::{BackupSummary, list_backups as list_backup_records},
        builtin_catalog,
        read::{
            ConfigDiagnostic, ConfigDocument, ConfigSummary, ConfigVariantResolution,
            diagnose_config as diagnose, list_configs as list, read_config_result as read,
            resolve_config_variants as resolve_variants,
        },
        restore::{RestoreBackupInput, execute_restore, prepare_restore},
        validation::{ValidationResult, validate_config as validate},
        write::{
            ConfigWriteInput, PendingConfigMutation, StructuredConfigWriteInput, execute_write,
            prepare_structured_write, prepare_write, validate_pending_write,
        },
    },
    error::AppError,
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
    },
    security::{
        elevated_actions::execute_protected_config_write,
        elevation::{ElevationCoordinator, confirmation_timestamp},
    },
    settings::SettingsCoordinator,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigKey {
    app_id: String,
    config_id: String,
    #[serde(default)]
    variant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidateConfigInput {
    app_id: String,
    config_id: String,
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWritePreview {
    #[serde(flatten)]
    operation: OperationPreview,
    current_hash: String,
    proposed_hash: String,
    diff: crate::config::diff::ConfigDiff,
}

#[tauri::command]
pub fn list_configs(app_id: String) -> Result<Vec<ConfigSummary>, AppError> {
    let environment = ConfigEnvironment::from_environment()?;
    list(&builtin_catalog()?, &environment, &app_id)
}

#[tauri::command]
pub fn read_config(key: ConfigKey) -> Result<ConfigDocument, AppError> {
    let environment = ConfigEnvironment::from_environment()?;
    read(
        &builtin_catalog()?,
        &environment,
        &key.app_id,
        &key.config_id,
        key.variant_id.as_deref(),
    )
}

#[tauri::command]
pub fn resolve_config_variants(key: ConfigKey) -> Result<Vec<ConfigVariantResolution>, AppError> {
    let environment = ConfigEnvironment::from_environment()?;
    resolve_variants(
        &builtin_catalog()?,
        &environment,
        &key.app_id,
        &key.config_id,
    )
}

#[tauri::command]
pub fn diagnose_config(key: ConfigKey) -> Result<ConfigDiagnostic, AppError> {
    let environment = ConfigEnvironment::from_environment()?;
    diagnose(
        &builtin_catalog()?,
        &environment,
        &key.app_id,
        &key.config_id,
        key.variant_id.as_deref(),
    )
}

#[tauri::command]
pub fn validate_config(input: ValidateConfigInput) -> Result<ValidationResult, AppError> {
    let catalog = builtin_catalog()?;
    let definition = crate::config::resolve_definition(&catalog, &input.app_id, &input.config_id)?;
    let environment = ConfigEnvironment::from_environment()?;
    validate(definition, &environment, &input.content)
}

#[tauri::command]
pub fn preview_config_write(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: ConfigWriteInput,
) -> Result<ConfigWritePreview, AppError> {
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &input.app_id, &input.config_id)?;
    let (mutation, prepared) = prepare_write(&catalog, config.environment()?, input)?;
    let intent = mutation_intent(OperationKind::ConfigurationWrite, &mutation);
    let operation = operations.preview(
        intent,
        &format!(
            "Update {} configuration {}.",
            mutation.app_id, mutation.config_id
        ),
        vec![
            format!("Authorized catalog document: {}", mutation.config_id),
            format!("Changed lines: {}", prepared.diff.changed_line_count()),
            "Create a protected backup before atomic replacement.".to_owned(),
        ],
        mutation.elevation_resource_id.is_some(),
    )?;
    config.remember(operation.operation_id.clone(), mutation)?;
    Ok(ConfigWritePreview {
        operation,
        current_hash: prepared.current_hash,
        proposed_hash: prepared.proposed_hash,
        diff: prepared.diff,
    })
}

#[tauri::command]
pub fn preview_structured_config_write(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: StructuredConfigWriteInput,
) -> Result<ConfigWritePreview, AppError> {
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &input.app_id, &input.config_id)?;
    let (mutation, prepared) = prepare_structured_write(&catalog, config.environment()?, input)?;
    let intent = mutation_intent(OperationKind::ConfigurationWrite, &mutation);
    let operation = operations.preview(
        intent,
        &format!(
            "Update {} configuration {}.",
            mutation.app_id, mutation.config_id
        ),
        vec![
            format!("Authorized catalog document: {}", mutation.config_id),
            "Apply only allowlisted structured fields.".to_owned(),
            "Create a protected backup before atomic replacement.".to_owned(),
        ],
        mutation.elevation_resource_id.is_some(),
    )?;
    config.remember(operation.operation_id.clone(), mutation)?;
    Ok(ConfigWritePreview {
        operation,
        current_hash: prepared.current_hash,
        proposed_hash: prepared.proposed_hash,
        diff: prepared.diff,
    })
}

#[tauri::command]
pub fn execute_config_write(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    elevation: State<'_, ElevationCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    let mutation = config.pending(&operation_id)?;
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &mutation.app_id, &mutation.config_id)?;
    let intent = mutation_intent(OperationKind::ConfigurationWrite, &mutation);
    if let Err(error) = operations.authorize_mutation(&operation_id, &intent) {
        if error.code() == crate::error::AppErrorCode::Timeout {
            config.forget(&operation_id);
        }
        return Err(error);
    }
    let result = if mutation.elevation_resource_id.is_some() {
        operations.record_progress(&operation_id, "Submitting the allowlisted helper request.")?;
        validate_pending_write(&catalog, config.environment()?, &mutation).and_then(|()| {
            execute_protected_config_write(
                &elevation,
                &operation_id,
                &mutation.expected_hash,
                &mutation.content,
                confirmation_timestamp(),
            )
            .map(|response| response.audit.audit_id)
        })
    } else {
        operations.record_progress(&operation_id, "Creating protected backup.")?;
        let retention = settings.get()?.preferences().backup_retention();
        execute_write(&catalog, config.environment()?, &mutation, retention)
            .map(|backup| backup.metadata.backup_id)
    };
    config.forget(&operation_id);
    match result {
        Ok(audit_id) => {
            operations.record_progress(
                &operation_id,
                &format!("Mutation verified. Audit ID: {audit_id}"),
            )?;
            operations.finish_success(&operation_id)?;
        }
        Err(error) => {
            operations.finish_failure(&operation_id, error.clone())?;
            return Err(error);
        }
    }
    operations.get(&operation_id)
}

#[tauri::command]
pub fn list_config_backups(key: ConfigKey) -> Result<Vec<BackupSummary>, AppError> {
    let catalog = builtin_catalog()?;
    let definition = crate::config::resolve_definition(&catalog, &key.app_id, &key.config_id)?;
    if definition.is_read_only() {
        return Ok(Vec::new());
    }
    let environment = ConfigEnvironment::from_environment()?;
    list_backup_records(&environment, &key.app_id, &key.config_id)
}

#[tauri::command]
pub fn preview_restore_backup(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: RestoreBackupInput,
) -> Result<ConfigWritePreview, AppError> {
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &input.app_id, &input.config_id)?;
    let (mutation, prepared) = prepare_restore(&catalog, config.environment()?, input)?;
    let intent = mutation_intent(OperationKind::ConfigurationRestore, &mutation);
    let operation = operations.preview(
        intent,
        &format!(
            "Restore {} configuration {}.",
            mutation.app_id, mutation.config_id
        ),
        vec![
            format!("Authorized catalog document: {}", mutation.config_id),
            "Create a protected backup of the current file.".to_owned(),
            "Restore the selected owned backup atomically.".to_owned(),
        ],
        mutation.elevation_resource_id.is_some(),
    )?;
    config.remember(operation.operation_id.clone(), mutation)?;
    Ok(ConfigWritePreview {
        operation,
        current_hash: prepared.current_hash,
        proposed_hash: prepared.proposed_hash,
        diff: prepared.diff,
    })
}

#[tauri::command]
pub fn execute_restore_backup(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    elevation: State<'_, ElevationCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    let mutation = config.pending(&operation_id)?;
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &mutation.app_id, &mutation.config_id)?;
    let intent = mutation_intent(OperationKind::ConfigurationRestore, &mutation);
    if let Err(error) = operations.authorize_mutation(&operation_id, &intent) {
        if error.code() == crate::error::AppErrorCode::Timeout {
            config.forget(&operation_id);
        }
        return Err(error);
    }
    let result = if mutation.elevation_resource_id.is_some() {
        operations.record_progress(&operation_id, "Submitting the allowlisted helper request.")?;
        if mutation.source_id.is_none() {
            Err(AppError::conflict(
                "Restore preview does not reference a backup.",
            ))
        } else {
            validate_pending_write(&catalog, config.environment()?, &mutation).and_then(|()| {
                execute_protected_config_write(
                    &elevation,
                    &operation_id,
                    &mutation.expected_hash,
                    &mutation.content,
                    confirmation_timestamp(),
                )
                .map(|response| response.audit.audit_id)
            })
        }
    } else {
        operations.record_progress(&operation_id, "Creating protected backup.")?;
        let retention = settings.get()?.preferences().backup_retention();
        execute_restore(&catalog, config.environment()?, &mutation, retention)
            .map(|()| "local-restore".to_owned())
    };
    config.forget(&operation_id);
    match result {
        Ok(audit_id) => {
            operations.record_progress(
                &operation_id,
                &format!("Backup restore verified. Audit ID: {audit_id}"),
            )?;
            operations.finish_success(&operation_id)?;
        }
        Err(error) => {
            operations.finish_failure(&operation_id, error.clone())?;
            return Err(error);
        }
    }
    operations.get(&operation_id)
}

fn require_writable_definition(
    catalog: &crate::catalog::Catalog,
    app_id: &str,
    config_id: &str,
) -> Result<(), AppError> {
    let definition = crate::config::resolve_definition(catalog, app_id, config_id)?;
    if definition.is_read_only() {
        return Err(AppError::not_supported(
            "Configuration document is read-only.",
        ));
    }
    Ok(())
}

pub(crate) fn mutation_intent(
    kind: OperationKind,
    mutation: &PendingConfigMutation,
) -> OperationIntent {
    OperationIntent::new(
        kind,
        format!("{}:{}", mutation.app_id, mutation.config_id),
        BTreeMap::from_iter(
            [
                ("currentHash".to_owned(), mutation.expected_hash.clone()),
                ("proposedHash".to_owned(), mutation.proposed_hash.clone()),
            ]
            .into_iter()
            .chain(
                mutation
                    .source_id
                    .iter()
                    .map(|source_id| ("sourceId".to_owned(), source_id.clone())),
            ),
        ),
    )
}
