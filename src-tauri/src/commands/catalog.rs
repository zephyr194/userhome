use serde::Serialize;

use crate::{
    catalog::{
        CATALOG_SCHEMA_VERSION, CatalogCoverageClass, CatalogPriority, ConfigAccessMode,
        ConfigFormatFamily, ConfigPathExistenceRule, ConfigSensitivity,
        MINIMUM_ELIGIBLE_TEXT_COVERAGE_PERCENT, ManagedAppDefinition, PRIORITY_A_APP_IDS,
        PRIORITY_B_APP_IDS, catalog_priority, load_builtin_catalog,
    },
    error::AppError,
    security::paths::CatalogPathRoot,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedConfigPathVariantPresentation {
    variant_id: String,
    root: CatalogPathRoot,
    relative_path: String,
    existence_rule: ConfigPathExistenceRule,
    precedence: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedConfigDocumentPresentation {
    config_id: String,
    purpose: String,
    path_variants: Vec<ManagedConfigPathVariantPresentation>,
    format: String,
    format_family: ConfigFormatFamily,
    sensitivity: ConfigSensitivity,
    access_mode: ConfigAccessMode,
    editor_key: String,
    max_size_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppPresentation {
    category: String,
    config_documents: Vec<ManagedConfigDocumentPresentation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionEvidencePresentation {
    kind: String,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppSupportPresentation {
    limitations: Vec<String>,
    exclusions: Vec<String>,
    requirement: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppSummary {
    id: String,
    display_name: String,
    description: String,
    icon_key: String,
    priority: CatalogPriority,
    coverage_class: CatalogCoverageClass,
    presentation: ManagedAppPresentation,
    detection_evidence: Vec<DetectionEvidencePresentation>,
    support: ManagedAppSupportPresentation,
    capabilities: Vec<String>,
    managed_document_count: usize,
    service_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCoveragePolicy {
    priority_a_total: usize,
    priority_a_usable: usize,
    priority_b_total: usize,
    priority_b_covered: usize,
    minimum_eligible_text_percent: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppCatalog {
    schema_version: u16,
    coverage_policy: CatalogCoveragePolicy,
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
            priority: catalog_priority(app.id()),
            coverage_class: app.coverage_class(),
            presentation: ManagedAppPresentation {
                category: app.presentation_category().to_owned(),
                config_documents: app
                    .config_documents()
                    .iter()
                    .map(|document| ManagedConfigDocumentPresentation {
                        config_id: document.config_id().to_owned(),
                        purpose: document.purpose().to_owned(),
                        path_variants: document
                            .path_variants()
                            .iter()
                            .map(|variant| ManagedConfigPathVariantPresentation {
                                variant_id: variant.variant_id().to_owned(),
                                root: variant.root(),
                                relative_path: variant.relative_path().to_owned(),
                                existence_rule: variant.existence_rule(),
                                precedence: variant.precedence(),
                            })
                            .collect(),
                        format: document.format().to_owned(),
                        format_family: document.format_family(),
                        sensitivity: document.sensitivity_kind(),
                        access_mode: document.access_mode(),
                        editor_key: document.editor_key().to_owned(),
                        max_size_bytes: document.max_size_bytes(),
                    })
                    .collect(),
            },
            detection_evidence: app
                .detection_rules()
                .iter()
                .map(|rule| DetectionEvidencePresentation {
                    kind: rule.kind().to_owned(),
                    value: safe_detection_value(rule.kind(), rule.value()),
                })
                .collect(),
            support: support_presentation(app),
            capabilities: app.capabilities().to_vec(),
            managed_document_count: app.config_documents().len(),
            service_count: app.services().len(),
        })
        .collect();

    Ok(ManagedAppCatalog {
        schema_version: CATALOG_SCHEMA_VERSION,
        coverage_policy: CatalogCoveragePolicy {
            priority_a_total: PRIORITY_A_APP_IDS.len(),
            priority_a_usable: catalog
                .apps()
                .iter()
                .filter(|app| {
                    catalog_priority(app.id()) == CatalogPriority::PriorityA
                        && app.coverage_class() == CatalogCoverageClass::ManagedWritable
                })
                .count(),
            priority_b_total: PRIORITY_B_APP_IDS.len(),
            priority_b_covered: catalog
                .apps()
                .iter()
                .filter(|app| {
                    catalog_priority(app.id()) == CatalogPriority::PriorityB
                        && matches!(
                            app.coverage_class(),
                            CatalogCoverageClass::ManagedWritable
                                | CatalogCoverageClass::ManagedReadOnly
                                | CatalogCoverageClass::Excluded
                        )
                })
                .count(),
            minimum_eligible_text_percent: MINIMUM_ELIGIBLE_TEXT_COVERAGE_PERCENT,
        },
        applications,
    })
}

fn safe_detection_value(kind: &str, value: &str) -> String {
    if kind == "HOME_PATH" {
        if let Some(relative) = value.strip_prefix("~/Library/Application Support/") {
            return format!("APPLICATION_SUPPORT/{relative}");
        }
        if let Some(relative) = value.strip_prefix("~/.config/") {
            return format!("XDG_CONFIG_HOME/{relative}");
        }
        if let Some(relative) = value.strip_prefix("~/") {
            return format!("HOME/{relative}");
        }
    }
    if kind == "HOMEBREW_PATH"
        && let Some(relative) = value.strip_prefix("${HOMEBREW_PREFIX}/")
    {
        return format!("HOMEBREW_PREFIX/{relative}");
    }
    value.to_owned()
}

fn support_presentation(app: &ManagedAppDefinition) -> ManagedAppSupportPresentation {
    let limitation = match app.coverage_class() {
        CatalogCoverageClass::ManagedWritable => "仅支持 catalog 明确授权的配置文档与操作。",
        CatalogCoverageClass::ManagedReadOnly => {
            "仅支持有界读取；不提供写入、备份、恢复、服务或提权操作。"
        }
        CatalogCoverageClass::DetectedUnsupported => {
            "仅检测存在性；不读取配置内容，也不执行管理操作。"
        }
        CatalogCoverageClass::Excluded => {
            "仅展示排除原因与检测证据；不读取内容，也不执行管理操作。"
        }
    };
    let requirement = app.support_requirement().unwrap_or(match app.coverage_class() {
        CatalogCoverageClass::ManagedWritable => {
            "新增路径或格式仍需独立 catalog 授权与安全审查。"
        }
        CatalogCoverageClass::ManagedReadOnly => {
            "提升为可写需要批准 parser、round-trip、validator、sensitivity policy 与 editor capability。"
        }
        CatalogCoverageClass::DetectedUnsupported => {
            "需要明确的设置路径、格式、解析器或产品契约后才能增加支持。"
        }
        CatalogCoverageClass::Excluded => {
            "只有在设置可与敏感或运行时数据可靠分离后才能重新评估支持。"
        }
    });

    ManagedAppSupportPresentation {
        limitations: vec![limitation.to_owned(), app.description().to_owned()],
        exclusions: vec![
            "未在 configDocuments 中声明的路径不获授权。".to_owned(),
            "凭据、会话、历史、日志、缓存、数据库、遥测和运行时状态仅保留分类元数据。".to_owned(),
        ],
        requirement: requirement.to_owned(),
    }
}
