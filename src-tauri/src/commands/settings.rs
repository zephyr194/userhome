use std::collections::BTreeMap;

use tauri::State;

use crate::{
    config::{
        ConfigCoordinator, builtin_catalog,
        retention::{BackupStorageSummary, clear_owned, enforce_all, summarize},
    },
    discovery::refresh::DiscoveryCoordinator,
    error::AppError,
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
    },
    settings::{LoadedPreferences, SettingsCoordinator, UpdatePreferencesRequest},
};

#[tauri::command]
pub fn get_preferences(
    coordinator: State<'_, SettingsCoordinator>,
) -> Result<LoadedPreferences, AppError> {
    coordinator.get()
}

#[tauri::command]
pub fn update_preferences(
    coordinator: State<'_, SettingsCoordinator>,
    config: State<'_, ConfigCoordinator>,
    discovery: State<'_, DiscoveryCoordinator>,
    patch: UpdatePreferencesRequest,
) -> Result<LoadedPreferences, AppError> {
    let requested_retention = patch.backup_retention();
    let loaded = coordinator.update_with(patch, |preferences| {
        if requested_retention.is_some() {
            enforce_all(
                &builtin_catalog()?,
                config.environment()?,
                preferences.backup_retention(),
            )?;
        }
        Ok(())
    })?;
    discovery.set_timeout_preset(loaded.preferences().provider_timeout_preset());
    discovery.set_optional_discovery_roots(loaded.preferences().optional_discovery_roots());
    Ok(loaded)
}

#[tauri::command]
pub fn reset_preferences(
    coordinator: State<'_, SettingsCoordinator>,
    discovery: State<'_, DiscoveryCoordinator>,
) -> Result<LoadedPreferences, AppError> {
    let loaded = coordinator.reset()?;
    discovery.set_timeout_preset(loaded.preferences().provider_timeout_preset());
    discovery.set_optional_discovery_roots(loaded.preferences().optional_discovery_roots());
    Ok(loaded)
}

#[tauri::command]
pub fn get_backup_storage(
    config: State<'_, ConfigCoordinator>,
) -> Result<BackupStorageSummary, AppError> {
    summarize(&builtin_catalog()?, config.environment()?)
}

#[tauri::command]
pub fn preview_clear_backups(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
) -> Result<OperationPreview, AppError> {
    let summary = summarize(&builtin_catalog()?, config.environment()?)?;
    if summary.backup_count == 0 {
        return Err(AppError::conflict(
            "No UserHome backups are available to clear.",
        ));
    }
    create_clear_backups_preview(&operations, &summary)
}

fn create_clear_backups_preview(
    operations: &OperationCoordinator,
    summary: &BackupStorageSummary,
) -> Result<OperationPreview, AppError> {
    operations.preview(
        clear_backups_intent(&summary),
        &format!(
            "Clear {} UserHome configuration backups.",
            summary.backup_count
        ),
        vec![
            format!("Location: {}", summary.display_location),
            format!("Delete {} owned backups.", summary.backup_count),
            format!("Release {} bytes of backup files.", summary.size_bytes),
            "Managed configuration files and preferences are not modified.".to_owned(),
        ],
        false,
    )
}

#[tauri::command]
pub fn execute_clear_backups(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    let catalog = builtin_catalog()?;
    let before = summarize(&catalog, config.environment()?)?;
    operations.authorize_mutation(&operation_id, &clear_backups_intent(&before))?;
    operations.record_progress(&operation_id, "Removing UserHome-owned backup records.")?;
    match clear_owned(&catalog, config.environment()?) {
        Ok(cleared) => {
            operations.finish_success_with_output(
                &operation_id,
                Some(&format!(
                    "Removed {} backups from {}.",
                    cleared.backup_count, cleared.display_location
                )),
                None,
            )?;
        }
        Err(error) => {
            operations.finish_failure(&operation_id, error.clone())?;
            return Err(error);
        }
    }
    operations.get(&operation_id)
}

fn clear_backups_intent(summary: &BackupStorageSummary) -> OperationIntent {
    OperationIntent::new(
        OperationKind::BackupClear,
        "configuration-backups",
        BTreeMap::from([
            ("backupCount".to_owned(), summary.backup_count.to_string()),
            (
                "displayLocation".to_owned(),
                summary.display_location.clone(),
            ),
            ("sizeBytes".to_owned(), summary.size_bytes.to_string()),
        ]),
    )
}

#[cfg(test)]
mod tests {
    use crate::operations::OperationCoordinator;

    use super::{BackupStorageSummary, create_clear_backups_preview};

    #[test]
    fn clear_preview_names_the_safe_location_and_exact_backup_count() {
        let operations = OperationCoordinator::default();
        let preview = create_clear_backups_preview(
            &operations,
            &BackupStorageSummary {
                display_location: "APP_SUPPORT/backups".to_owned(),
                backup_count: 3,
                size_bytes: 512,
            },
        )
        .expect("preview backup clear");

        assert_eq!(preview.summary, "Clear 3 UserHome configuration backups.");
        assert_eq!(
            preview.effects,
            [
                "Location: APP_SUPPORT/backups",
                "Delete 3 owned backups.",
                "Release 512 bytes of backup files.",
                "Managed configuration files and preferences are not modified.",
            ]
        );
    }
}
