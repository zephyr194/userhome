use tauri::State;

use crate::{
    error::AppError,
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
    patch: UpdatePreferencesRequest,
) -> Result<LoadedPreferences, AppError> {
    coordinator.update(patch)
}

#[tauri::command]
pub fn reset_preferences(
    coordinator: State<'_, SettingsCoordinator>,
) -> Result<LoadedPreferences, AppError> {
    coordinator.reset()
}
