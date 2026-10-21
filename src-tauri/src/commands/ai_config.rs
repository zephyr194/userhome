//! Read-only AI CLI detection. The command takes no arguments: the tool list and
//! every probed location are fixed in code, so the frontend can never supply a
//! path or an executable.

use crate::{
    ai_config::detect::{
        AiConfigReport, ProbeEnv, SystemVersionProbe, detect_all, fixed_locations,
    },
    app_config::{discover::StdFs, registry::Registry},
    commands::grants::canonical_home,
    error::AppError,
};

#[tauri::command]
pub async fn ai_config_detect() -> Result<AiConfigReport, AppError> {
    let registry =
        Registry::builtin().map_err(|_| AppError::validation_failed("应用配置注册表校验失败。"))?;
    let home =
        canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，AI 配置不可用。"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let locations = fixed_locations(&home);
        detect_all(&ProbeEnv {
            home: &home,
            locations: &locations,
            version: &SystemVersionProbe,
            fs: &StdFs,
            registry: &registry,
        })
    })
    .await
    .map_err(|_| AppError::internal())
}
