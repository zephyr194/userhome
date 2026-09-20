mod definitions;

use std::{
    collections::HashSet,
    path::{Component, Path},
};

use serde::{Deserialize, Serialize};

pub use definitions::BUILTIN_CATALOG_JSON;

pub const CATALOG_SCHEMA_VERSION: u16 = 1;
pub const MAX_CATALOG_BYTES: usize = 64 * 1024;
pub const MAX_CONFIG_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;

const MAX_APPS: usize = 32;
const MAX_CONFIG_DOCUMENTS_PER_APP: usize = 16;
const MAX_LIST_ENTRIES: usize = 32;
const MAX_STRING_BYTES: usize = 512;
const DEFAULT_PRESENTATION_CATEGORY: &str = "Other";
const ALLOWED_ADAPTERS: &[&str] = &[
    "caddyfile",
    "copilot-instructions",
    "copilot-json",
    "git-config",
    "npmrc",
    "read-only-text",
    "ssh-config",
    "zsh-managed-block",
];
const ALLOWED_VALIDATORS: &[&str] = &[
    "caddy",
    "git-config",
    "json",
    "markdown",
    "npmrc",
    "text",
    "ssh-config",
    "zsh",
];
const ALLOWED_WRITE_POLICIES: &[&str] = &[
    "MANAGED_BLOCK",
    "READ_ONLY",
    "STRUCTURED_AND_RAW",
    "RAW_VALIDATED",
];
const ALLOWED_FORMATS: &[&str] = &[
    "CADDYFILE",
    "GIT_CONFIG",
    "INI",
    "JSON",
    "MARKDOWN",
    "MARKDOWN_DIRECTORY",
    "SHELL",
    "SSH_CONFIG",
];
const ALLOWED_SENSITIVITIES: &[&str] = &["STANDARD", "SENSITIVE", "SECRET"];
const ALLOWED_CAPABILITIES: &[&str] = &["DETECT", "MANAGE_SERVICE", "READ_CONFIG", "WRITE_CONFIG"];
const ALLOWED_DETECTION_RULES: &[&str] = &[
    "BREW_CASK",
    "BREW_FORMULA",
    "EXECUTABLE",
    "HOMEBREW_PATH",
    "HOME_PATH",
    "SERVICE",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogValidationError {
    DocumentTooLarge,
    InvalidDocument,
    UnsupportedSchemaVersion,
    EmptyCatalog,
    TooManyEntries,
    InvalidIdentifier,
    DuplicateAppId,
    DuplicateConfigId,
    UnsafePath,
    MissingAdapter,
    UnsupportedAdapter,
    MissingValidator,
    UnsupportedValidator,
    UnboundedDocument,
    UnsupportedWritePolicy,
    UnsupportedValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    schema_version: u16,
    apps: Vec<ManagedAppDefinition>,
}

impl Catalog {
    pub fn schema_version(&self) -> u16 {
        self.schema_version
    }

    pub fn apps(&self) -> &[ManagedAppDefinition] {
        &self.apps
    }

    pub fn config_document(
        &self,
        app_id: &str,
        config_id: &str,
    ) -> Option<(&ManagedAppDefinition, &ConfigDocumentDefinition)> {
        let app = self.apps.iter().find(|app| app.id == app_id)?;
        let document = app
            .config_documents
            .iter()
            .find(|document| document.config_id == config_id)?;
        Some((app, document))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedAppDefinition {
    id: String,
    display_name: String,
    description: String,
    icon_key: String,
    #[serde(default)]
    coverage_class: Option<CatalogCoverageClass>,
    #[serde(default)]
    presentation: Option<ManagedAppPresentation>,
    detection_rules: Vec<DetectionRule>,
    executables: Vec<String>,
    brew_formulae: Vec<String>,
    brew_casks: Vec<String>,
    config_documents: Vec<ConfigDocumentDefinition>,
    services: Vec<String>,
    capabilities: Vec<String>,
}

impl ManagedAppDefinition {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn icon_key(&self) -> &str {
        &self.icon_key
    }

    pub fn coverage_class(&self) -> CatalogCoverageClass {
        self.coverage_class.unwrap_or_else(|| {
            if self
                .capabilities
                .iter()
                .any(|capability| capability == "WRITE_CONFIG")
            {
                CatalogCoverageClass::ManagedWritable
            } else if self
                .capabilities
                .iter()
                .any(|capability| capability == "READ_CONFIG")
            {
                CatalogCoverageClass::ManagedReadOnly
            } else {
                CatalogCoverageClass::DetectedUnsupported
            }
        })
    }

    pub fn presentation_category(&self) -> &str {
        self.presentation
            .as_ref()
            .map(ManagedAppPresentation::category)
            .unwrap_or(DEFAULT_PRESENTATION_CATEGORY)
    }

    pub fn detection_rules(&self) -> &[DetectionRule] {
        &self.detection_rules
    }

    pub fn executables(&self) -> &[String] {
        &self.executables
    }

    pub fn brew_formulae(&self) -> &[String] {
        &self.brew_formulae
    }

    pub fn brew_casks(&self) -> &[String] {
        &self.brew_casks
    }

    pub fn config_documents(&self) -> &[ConfigDocumentDefinition] {
        &self.config_documents
    }

    pub fn services(&self) -> &[String] {
        &self.services
    }

    pub fn capabilities(&self) -> &[String] {
        &self.capabilities
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogCoverageClass {
    ManagedWritable,
    ManagedReadOnly,
    DetectedUnsupported,
    Excluded,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedAppPresentation {
    category: String,
}

impl ManagedAppPresentation {
    fn category(&self) -> &str {
        &self.category
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectionRule {
    kind: String,
    value: String,
}

impl DetectionRule {
    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigDocumentDefinition {
    config_id: String,
    path_template: String,
    format: String,
    sensitivity: String,
    adapter_id: String,
    #[serde(default)]
    editor_key: Option<String>,
    validator_id: String,
    max_size_bytes: usize,
    write_policy: String,
    elevation_resource_id: Option<String>,
}

impl ConfigDocumentDefinition {
    pub fn config_id(&self) -> &str {
        &self.config_id
    }

    pub fn path_template(&self) -> &str {
        &self.path_template
    }

    pub fn format(&self) -> &str {
        &self.format
    }

    pub fn sensitivity(&self) -> &str {
        &self.sensitivity
    }

    pub fn adapter_id(&self) -> &str {
        &self.adapter_id
    }

    pub fn editor_key(&self) -> &str {
        self.editor_key.as_deref().unwrap_or(&self.adapter_id)
    }

    pub fn validator_id(&self) -> &str {
        &self.validator_id
    }

    pub fn max_size_bytes(&self) -> usize {
        self.max_size_bytes
    }

    pub fn write_policy(&self) -> &str {
        &self.write_policy
    }

    pub fn is_read_only(&self) -> bool {
        self.write_policy == "READ_ONLY"
    }

    pub fn elevation_resource_id(&self) -> Option<&str> {
        self.elevation_resource_id.as_deref()
    }
}

pub fn load_builtin_catalog() -> Result<Catalog, CatalogValidationError> {
    parse_catalog(BUILTIN_CATALOG_JSON)
}

pub fn parse_catalog(source: &str) -> Result<Catalog, CatalogValidationError> {
    if source.len() > MAX_CATALOG_BYTES {
        return Err(CatalogValidationError::DocumentTooLarge);
    }

    let catalog: Catalog =
        serde_json::from_str(source).map_err(|_| CatalogValidationError::InvalidDocument)?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn validate_catalog(catalog: &Catalog) -> Result<(), CatalogValidationError> {
    if catalog.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(CatalogValidationError::UnsupportedSchemaVersion);
    }
    if catalog.apps.is_empty() {
        return Err(CatalogValidationError::EmptyCatalog);
    }
    if catalog.apps.len() > MAX_APPS {
        return Err(CatalogValidationError::TooManyEntries);
    }

    let mut app_ids = HashSet::with_capacity(catalog.apps.len());
    let mut config_ids = HashSet::new();
    for app in &catalog.apps {
        if !is_kebab_case(&app.id) || !is_kebab_case(&app.icon_key) {
            return Err(CatalogValidationError::InvalidIdentifier);
        }
        if !app_ids.insert(app.id.as_str()) {
            return Err(CatalogValidationError::DuplicateAppId);
        }
        validate_text(&app.display_name)?;
        validate_text(&app.description)?;
        validate_text(app.presentation_category())?;
        validate_list(&app.executables)?;
        validate_list(&app.brew_formulae)?;
        validate_list(&app.brew_casks)?;
        validate_list(&app.services)?;
        validate_allowed_list(&app.capabilities, ALLOWED_CAPABILITIES)?;
        validate_coverage_class(app)?;

        if app.detection_rules.len() > MAX_LIST_ENTRIES
            || app.config_documents.len() > MAX_CONFIG_DOCUMENTS_PER_APP
        {
            return Err(CatalogValidationError::TooManyEntries);
        }

        for rule in &app.detection_rules {
            validate_text(&rule.value)?;
            if !ALLOWED_DETECTION_RULES.contains(&rule.kind.as_str()) {
                return Err(CatalogValidationError::UnsupportedValue);
            }
            if matches!(rule.kind.as_str(), "HOME_PATH" | "HOMEBREW_PATH") {
                if !is_safe_path_template(&rule.value) {
                    return Err(CatalogValidationError::UnsafePath);
                }
            } else if !is_kebab_case(&rule.value) {
                return Err(CatalogValidationError::InvalidIdentifier);
            }
        }

        for document in &app.config_documents {
            if !is_kebab_case(&document.config_id) {
                return Err(CatalogValidationError::InvalidIdentifier);
            }
            if !config_ids.insert(document.config_id.as_str()) {
                return Err(CatalogValidationError::DuplicateConfigId);
            }
            if !is_safe_path_template(&document.path_template) {
                return Err(CatalogValidationError::UnsafePath);
            }
            if document.adapter_id.trim().is_empty() {
                return Err(CatalogValidationError::MissingAdapter);
            }
            if !ALLOWED_ADAPTERS.contains(&document.adapter_id.as_str()) {
                return Err(CatalogValidationError::UnsupportedAdapter);
            }
            if !is_kebab_case(document.editor_key()) {
                return Err(CatalogValidationError::InvalidIdentifier);
            }
            if document.validator_id.trim().is_empty() {
                return Err(CatalogValidationError::MissingValidator);
            }
            if !ALLOWED_VALIDATORS.contains(&document.validator_id.as_str()) {
                return Err(CatalogValidationError::UnsupportedValidator);
            }
            if document.max_size_bytes == 0 || document.max_size_bytes > MAX_CONFIG_DOCUMENT_BYTES {
                return Err(CatalogValidationError::UnboundedDocument);
            }
            if !ALLOWED_WRITE_POLICIES.contains(&document.write_policy.as_str()) {
                return Err(CatalogValidationError::UnsupportedWritePolicy);
            }
            let generic_read_only = document.adapter_id == "read-only-text";
            if generic_read_only != (document.validator_id == "text")
                || (generic_read_only && !document.is_read_only())
                || (document.is_read_only() && document.elevation_resource_id.is_some())
            {
                return Err(CatalogValidationError::UnsupportedValue);
            }
            if !ALLOWED_FORMATS.contains(&document.format.as_str())
                || !ALLOWED_SENSITIVITIES.contains(&document.sensitivity.as_str())
            {
                return Err(CatalogValidationError::UnsupportedValue);
            }
            if let Some(resource_id) = &document.elevation_resource_id
                && (app.id != "caddy"
                    || document.config_id != "caddyfile"
                    || resource_id != crate::security::elevation_protocol::CADDY_CONFIG_RESOURCE_ID)
            {
                return Err(CatalogValidationError::UnsupportedValue);
            }
        }
    }

    Ok(())
}

fn validate_coverage_class(app: &ManagedAppDefinition) -> Result<(), CatalogValidationError> {
    let can_read = app
        .capabilities
        .iter()
        .any(|capability| capability == "READ_CONFIG");
    let can_write = app
        .capabilities
        .iter()
        .any(|capability| capability == "WRITE_CONFIG");
    let has_documents = !app.config_documents.is_empty();
    let has_writable_document = app
        .config_documents
        .iter()
        .any(|document| document.write_policy != "READ_ONLY");

    let valid = match app.coverage_class() {
        CatalogCoverageClass::ManagedWritable => can_read && can_write && has_writable_document,
        CatalogCoverageClass::ManagedReadOnly => {
            can_read && !can_write && has_documents && !has_writable_document
        }
        CatalogCoverageClass::DetectedUnsupported | CatalogCoverageClass::Excluded => {
            !can_read && !can_write && !has_documents
        }
    };
    if !valid {
        return Err(CatalogValidationError::UnsupportedValue);
    }
    Ok(())
}

fn validate_text(value: &str) -> Result<(), CatalogValidationError> {
    if !is_bounded_text(value) {
        return Err(CatalogValidationError::UnsupportedValue);
    }
    Ok(())
}

fn validate_list(values: &[String]) -> Result<(), CatalogValidationError> {
    if values.len() > MAX_LIST_ENTRIES || values.iter().any(|value| !is_kebab_case(value)) {
        return Err(CatalogValidationError::UnsupportedValue);
    }
    Ok(())
}

fn validate_allowed_list(
    values: &[String],
    allowed: &[&str],
) -> Result<(), CatalogValidationError> {
    if values.len() > MAX_LIST_ENTRIES
        || values.is_empty()
        || values
            .iter()
            .any(|value| !allowed.contains(&value.as_str()))
    {
        return Err(CatalogValidationError::UnsupportedValue);
    }
    Ok(())
}

fn is_bounded_text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_STRING_BYTES
}

fn is_kebab_case(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn is_safe_path_template(value: &str) -> bool {
    if value.len() > MAX_STRING_BYTES || value.contains('\0') || value.contains('\\') {
        return false;
    }

    let relative = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("${HOMEBREW_PREFIX}/"));
    let Some(relative) = relative else {
        return false;
    };

    !relative.is_empty()
        && Path::new(relative)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}
