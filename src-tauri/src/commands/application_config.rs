use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use crate::{
    catalog::profiles::{
        builtin_profiles,
        read::{
            self, ConfigurationAppsResult, ConfigurationResourceView, ConfigurationResourcesResult,
        },
    },
    config::ConfigCoordinator,
    error::AppError,
    settings::SettingsCoordinator,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigurationAppInput {
    pub app_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigurationResourceInput {
    pub app_id: String,
    pub resource_id: String,
}

#[tauri::command]
pub async fn get_configuration_apps(
    app: AppHandle,
    config: State<'_, ConfigCoordinator>,
) -> Result<ConfigurationAppsResult, AppError> {
    let home = config.environment()?.home().to_owned();
    let context = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let rules = context
            .state::<SettingsCoordinator>()
            .get_discovery_exclusions()?;
        read::discover_applications(&builtin_profiles()?, &home, &rules)
    })
    .await
    .map_err(|_| AppError::internal())??;
    crate::tray::update_configuration_summary(
        &app,
        result.applications.len(),
        !result.issues.is_empty(),
    );
    Ok(result)
}

#[tauri::command]
pub async fn list_configuration_resources(
    app: AppHandle,
    config: State<'_, ConfigCoordinator>,
    input: ConfigurationAppInput,
) -> Result<ConfigurationResourcesResult, AppError> {
    let home = config.environment()?.home().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let rules = app
            .state::<SettingsCoordinator>()
            .get_discovery_exclusions()?;
        let profile = builtin_profiles()?
            .into_iter()
            .find(|profile| profile.app_id == input.app_id)
            .ok_or_else(|| AppError::not_found("应用尚未支持。"))?;
        read::list_resources(&profile, &home, &rules)
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn read_configuration_resource(
    app: AppHandle,
    config: State<'_, ConfigCoordinator>,
    input: ConfigurationResourceInput,
) -> Result<ConfigurationResourceView, AppError> {
    if input.resource_id.len() != 64
        || !input
            .resource_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(AppError::invalid_input("配置资源标识无效。"));
    }
    let home = config.environment()?.home().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let rules = app
            .state::<SettingsCoordinator>()
            .get_discovery_exclusions()?;
        let profile = builtin_profiles()?
            .into_iter()
            .find(|profile| profile.app_id == input.app_id)
            .ok_or_else(|| AppError::not_found("应用尚未支持。"))?;
        read::read_resource(&profile, &home, &rules, &input.resource_id)
    })
    .await
    .map_err(|_| AppError::internal())?
}
