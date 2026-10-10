use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::{
    catalog::{
        CATALOG_SCHEMA_VERSION, CatalogCoverageClass, CatalogPriority, CatalogSourceLicenseStatus,
        CatalogSourceReviewStatus, ConfigAccessMode, ConfigFormatFamily, ConfigPathExistenceRule,
        ConfigSensitivity, MINIMUM_ELIGIBLE_TEXT_COVERAGE_PERCENT, ManagedAppDefinition,
        PRIORITY_A_APP_IDS, PRIORITY_B_APP_IDS, catalog_priority, load_builtin_catalog,
    },
    error::AppError,
    security::paths::CatalogPathRoot,
};

const CATALOG_PAGE_SIZE: usize = 50;
const MAX_CATALOG_QUERY_BYTES: usize = 256;
const MAX_DETECTED_APP_IDS: usize = 1_000;
const ALLOWED_QUERY_CAPABILITIES: &[&str] =
    &["DETECT", "READ_CONFIG", "WRITE_CONFIG", "MANAGE_SERVICE"];

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
pub struct ManagedAppSourceEvidencePresentation {
    url: String,
    license_status: CatalogSourceLicenseStatus,
    review_status: CatalogSourceReviewStatus,
    content_sha256: Option<String>,
    verified_at: Option<String>,
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
    source_evidence: Vec<ManagedAppSourceEvidencePresentation>,
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedAppPageQuery {
    #[serde(default)]
    query: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    coverage_class: Option<CatalogCoverageClass>,
    #[serde(default)]
    capability: Option<String>,
    #[serde(default)]
    detected: Option<bool>,
    #[serde(default)]
    detected_app_ids: Vec<String>,
    page: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppPagination {
    page: usize,
    page_size: usize,
    total_items: usize,
    total_pages: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppFacets {
    categories: Vec<String>,
    coverage_classes: Vec<CatalogCoverageClass>,
    capabilities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppPage {
    schema_version: u16,
    coverage_policy: CatalogCoveragePolicy,
    facets: ManagedAppFacets,
    pagination: ManagedAppPagination,
    applications: Vec<ManagedAppSummary>,
}

#[tauri::command]
pub fn list_managed_apps() -> Result<ManagedAppCatalog, AppError> {
    let catalog = load_builtin_catalog().map_err(|_| AppError::internal())?;
    let applications = catalog
        .apps()
        .iter()
        .take(CATALOG_PAGE_SIZE)
        .map(app_summary)
        .collect();

    Ok(ManagedAppCatalog {
        schema_version: CATALOG_SCHEMA_VERSION,
        coverage_policy: coverage_policy(catalog.apps()),
        applications,
    })
}

#[tauri::command]
pub fn query_managed_apps(input: ManagedAppPageQuery) -> Result<ManagedAppPage, AppError> {
    validate_page_query(&input)?;
    let catalog = load_builtin_catalog().map_err(|_| AppError::internal())?;
    let detected_app_ids = input
        .detected_app_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let normalized_query = input.query.trim().to_lowercase();

    let mut applications = catalog
        .apps()
        .iter()
        .filter(|app| {
            input
                .category
                .as_deref()
                .is_none_or(|category| app.presentation_category() == category)
                && input
                    .coverage_class
                    .is_none_or(|coverage_class| app.coverage_class() == coverage_class)
                && input.capability.as_deref().is_none_or(|capability| {
                    app.capabilities().iter().any(|value| value == capability)
                })
                && input
                    .detected
                    .is_none_or(|detected| detected_app_ids.contains(app.id()) == detected)
                && (normalized_query.is_empty() || app_search_text(app).contains(&normalized_query))
        })
        .map(app_summary)
        .collect::<Vec<_>>();
    applications.sort_by(|left, right| {
        left.display_name
            .to_lowercase()
            .cmp(&right.display_name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });

    let total_items = applications.len();
    let total_pages = total_items.div_ceil(CATALOG_PAGE_SIZE);
    if (total_pages == 0 && input.page != 1) || (total_pages > 0 && input.page > total_pages) {
        return Err(AppError::invalid_input(
            "Catalog page is outside the available result range.",
        ));
    }
    let start = input
        .page
        .saturating_sub(1)
        .saturating_mul(CATALOG_PAGE_SIZE);
    let applications = applications
        .into_iter()
        .skip(start)
        .take(CATALOG_PAGE_SIZE)
        .collect();

    Ok(ManagedAppPage {
        schema_version: CATALOG_SCHEMA_VERSION,
        coverage_policy: coverage_policy(catalog.apps()),
        facets: catalog_facets(catalog.apps()),
        pagination: ManagedAppPagination {
            page: input.page,
            page_size: CATALOG_PAGE_SIZE,
            total_items,
            total_pages,
        },
        applications,
    })
}

#[tauri::command]
pub fn get_managed_app(app_id: String) -> Result<ManagedAppSummary, AppError> {
    if !is_kebab_case_identifier(&app_id) {
        return Err(AppError::invalid_input("Invalid application identifier."));
    }
    let catalog = load_builtin_catalog().map_err(|_| AppError::internal())?;
    catalog
        .apps()
        .iter()
        .find(|app| app.id() == app_id)
        .map(app_summary)
        .ok_or_else(|| AppError::not_found("Application definition was not found."))
}

fn validate_page_query(input: &ManagedAppPageQuery) -> Result<(), AppError> {
    if input.page == 0
        || input.page > MAX_DETECTED_APP_IDS
        || input.query.len() > MAX_CATALOG_QUERY_BYTES
        || input.category.as_ref().is_some_and(|category| {
            category.trim().is_empty() || category.len() > MAX_CATALOG_QUERY_BYTES
        })
        || input
            .capability
            .as_ref()
            .is_some_and(|capability| !ALLOWED_QUERY_CAPABILITIES.contains(&capability.as_str()))
        || input.detected_app_ids.len() > MAX_DETECTED_APP_IDS
        || input
            .detected_app_ids
            .iter()
            .any(|app_id| !is_kebab_case_identifier(app_id))
    {
        return Err(AppError::invalid_input("Invalid catalog page query."));
    }
    Ok(())
}

fn app_summary(app: &ManagedAppDefinition) -> ManagedAppSummary {
    ManagedAppSummary {
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
        source_evidence: app
            .source_evidence()
            .iter()
            .map(|evidence| ManagedAppSourceEvidencePresentation {
                url: evidence.url().to_owned(),
                license_status: evidence.license_status(),
                review_status: evidence.review_status(),
                content_sha256: evidence.content_sha256().map(str::to_owned),
                verified_at: evidence.verified_at().map(str::to_owned),
            })
            .collect(),
        support: support_presentation(app),
        capabilities: app.capabilities().to_vec(),
        managed_document_count: app.config_documents().len(),
        service_count: app.services().len(),
    }
}

fn coverage_policy(apps: &[ManagedAppDefinition]) -> CatalogCoveragePolicy {
    CatalogCoveragePolicy {
        priority_a_total: PRIORITY_A_APP_IDS.len(),
        priority_a_usable: apps
            .iter()
            .filter(|app| {
                catalog_priority(app.id()) == CatalogPriority::PriorityA
                    && app.coverage_class() == CatalogCoverageClass::ManagedWritable
            })
            .count(),
        priority_b_total: PRIORITY_B_APP_IDS.len(),
        priority_b_covered: apps
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
    }
}

fn catalog_facets(apps: &[ManagedAppDefinition]) -> ManagedAppFacets {
    let mut categories = apps
        .iter()
        .map(|app| app.presentation_category().to_owned())
        .collect::<Vec<_>>();
    categories.sort();
    categories.dedup();

    ManagedAppFacets {
        categories,
        coverage_classes: vec![
            CatalogCoverageClass::ManagedWritable,
            CatalogCoverageClass::ManagedReadOnly,
            CatalogCoverageClass::DetectedUnsupported,
            CatalogCoverageClass::Excluded,
        ],
        capabilities: ALLOWED_QUERY_CAPABILITIES
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
    }
}

fn app_search_text(app: &ManagedAppDefinition) -> String {
    let mut values = vec![
        app.id().to_owned(),
        app.display_name().to_owned(),
        app.description().to_owned(),
        app.presentation_category().to_owned(),
        app.support_requirement().unwrap_or_default().to_owned(),
    ];
    values.extend(app.capabilities().iter().cloned());
    values.extend(
        app.detection_rules()
            .iter()
            .flat_map(|rule| [rule.kind().to_owned(), rule.value().to_owned()]),
    );
    values.extend(app.config_documents().iter().flat_map(|document| {
        [
            document.config_id().to_owned(),
            document.purpose().to_owned(),
            document.format().to_owned(),
        ]
    }));
    values.join(" ").to_lowercase()
}

fn is_kebab_case_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CATALOG_QUERY_BYTES
        && value.split('-').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
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
