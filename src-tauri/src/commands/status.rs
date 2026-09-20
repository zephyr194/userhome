use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    status: String,
    version: String,
}

#[tauri::command]
pub fn get_app_status() -> Result<AppStatus, AppError> {
    Ok(AppStatus {
        status: "ok".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
    })
}
