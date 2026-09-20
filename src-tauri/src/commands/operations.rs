use tauri::State;

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

#[tauri::command]
pub fn cancel_operation(
    coordinator: State<'_, OperationCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    coordinator.cancel(&operation_id)
}
