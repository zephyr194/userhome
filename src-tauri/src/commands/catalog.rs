use serde::Serialize;

use crate::{
    catalog::{CATALOG_SCHEMA_VERSION, load_builtin_catalog},
    error::AppError,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppSummary {
    id: String,
    display_name: String,
    description: String,
    icon_key: String,
    capabilities: Vec<String>,
    managed_document_count: usize,
    service_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppCatalog {
    schema_version: u16,
    applications: Vec<ManagedAppSummary>,
}

#[tauri::command]
pub fn list_managed_apps() -> Result<ManagedAppCatalog, AppError> {
    let catalog = load_builtin_catalog().map_err(|_| AppError::internal())?;
    let applications = catalog
        .apps()
        .iter()
        .map(|app| ManagedAppSummary {
            id: app.id().to_owned(),
            display_name: app.display_name().to_owned(),
            description: app.description().to_owned(),
            icon_key: app.icon_key().to_owned(),
            capabilities: app.capabilities().to_vec(),
            managed_document_count: app.config_documents().len(),
            service_count: app.services().len(),
        })
        .collect();

    Ok(ManagedAppCatalog {
        schema_version: CATALOG_SCHEMA_VERSION,
        applications,
    })
}
