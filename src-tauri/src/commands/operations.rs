use tauri::{AppHandle, Manager, State};

use crate::{
    error::AppError,
    operations::{OperationCoordinator, OperationDetails, OperationSummary},
};

#[tauri::command]
pub fn list_operations(
    coordinator: State<'_, OperationCoordinator>,
) -> Result<Vec<OperationSummary>, AppError> {
    coordinator.list()
}

#[tauri::command]
pub fn get_operation(
    coordinator: State<'_, OperationCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    coordinator.get(&operation_id)
}

/// Stopping an attached process can wait for seconds, so it runs off the main
/// thread; the command name and arguments are unchanged.
#[tauri::command]
pub async fn cancel_operation(
    app: AppHandle,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<OperationCoordinator>().cancel(&operation_id)
    })
    .await
    .map_err(|_| AppError::internal())?
}
