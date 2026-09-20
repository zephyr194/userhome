use serde::Serialize;

use crate::{
    catalog::{CATALOG_SCHEMA_VERSION, CatalogCoverageClass, load_builtin_catalog},
    error::AppError,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedConfigDocumentPresentation {
    config_id: String,
    editor_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppPresentation {
    category: String,
    config_documents: Vec<ManagedConfigDocumentPresentation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppSummary {
    id: String,
    display_name: String,
    description: String,
    icon_key: String,
    coverage_class: CatalogCoverageClass,
    presentation: ManagedAppPresentation,
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
            coverage_class: app.coverage_class(),
            presentation: ManagedAppPresentation {
                category: app.presentation_category().to_owned(),
                config_documents: app
                    .config_documents()
                    .iter()
                    .map(|document| ManagedConfigDocumentPresentation {
                        config_id: document.config_id().to_owned(),
                        editor_key: document.editor_key().to_owned(),
                    })
                    .collect(),
            },
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
