use tauri::State;

use crate::{
    discovery::refresh::DiscoveryCoordinator,
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
    discovery: State<'_, DiscoveryCoordinator>,
    patch: UpdatePreferencesRequest,
) -> Result<LoadedPreferences, AppError> {
    let loaded = coordinator.update(patch)?;
    discovery.set_timeout_preset(loaded.preferences().provider_timeout_preset());
    Ok(loaded)
}

#[tauri::command]
pub fn reset_preferences(
    coordinator: State<'_, SettingsCoordinator>,
    discovery: State<'_, DiscoveryCoordinator>,
) -> Result<LoadedPreferences, AppError> {
    let loaded = coordinator.reset()?;
    discovery.set_timeout_preset(loaded.preferences().provider_timeout_preset());
    Ok(loaded)
}
