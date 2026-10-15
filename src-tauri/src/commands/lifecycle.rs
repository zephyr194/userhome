use tauri::{AppHandle, Manager, State};

use crate::{
    error::AppError,
    lifecycle::{LifecycleCoordinator, QuitResult, confirm_quit_with},
};

/// "Stop and quit". Stopping can wait for seconds, so it runs off the main
/// thread. The app exits only if every own process is confirmed gone; otherwise
/// the result says which ones could not be confirmed.
#[tauri::command]
pub async fn confirm_quit(app: AppHandle) -> Result<QuitResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        confirm_quit_with(&app, &app.state::<LifecycleCoordinator>())
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// "Cancel quit": drops the pending prompt and changes nothing else.
#[tauri::command]
pub fn cancel_quit(coordinator: State<'_, LifecycleCoordinator>) -> Result<(), AppError> {
    coordinator.cancel_quit()
}
