use tauri::{AppHandle, State};

use crate::{
    discovery::{
        candidates::ConfigurationCoverage,
        refresh::{DiscoveryCoordinator, DiscoverySnapshot},
    },
    error::AppError,
};

#[tauri::command]
pub async fn get_system_snapshot(
    app: AppHandle,
    coordinator: State<'_, DiscoveryCoordinator>,
) -> Result<DiscoverySnapshot, AppError> {
    let coordinator = coordinator.inner().clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        coordinator.ensure_initial_refresh();
        coordinator.snapshot_after_local()
    })
    .await
    .map_err(|_| AppError::internal())?;
    crate::tray::update_application_summary(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn refresh_system_snapshot(
    app: AppHandle,
    coordinator: State<'_, DiscoveryCoordinator>,
) -> Result<DiscoverySnapshot, AppError> {
    let coordinator = coordinator.inner().clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || coordinator.refresh())
        .await
        .map_err(|_| AppError::internal())?;
    crate::tray::update_application_summary(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn list_unmanaged_candidates(
    coordinator: State<'_, DiscoveryCoordinator>,
) -> Result<ConfigurationCoverage, AppError> {
    let coordinator = coordinator.inner().clone();
    tauri::async_runtime::spawn_blocking(move || coordinator.candidates())
        .await
        .map_err(|_| AppError::internal())?
        .map_err(|_| AppError::process_failed("Candidate discovery failed.", true))
}
