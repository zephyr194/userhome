use std::collections::HashSet;

use serde::Deserialize;

use super::{
    Catalog, ConfigSensitivity, is_bounded_text, is_kebab_case, source::SourceCatalog,
    source::SourceScope,
};

pub const SCHEMA_FORMAT_VERSION: u16 = 1;
pub const MAX_FIELDS_PER_SCHEMA: usize = 64;

const MAX_SCHEMA_BYTES: usize = 512 * 1024;
const MAX_SCHEMAS: usize = 256;
const MAX_FIELD_SOURCES: usize = 16;
const MAX_ENUM_OPTIONS: usize = 64;
const MAX_STRING_LENGTH: u16 = 4096;
const MAX_LIST_ITEMS: u16 = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaValidationError {
    DocumentTooLarge,
    InvalidDocument,
    UnsupportedFormatVersion,
    TooManyEntries,
    EmptySchema,
    InvalidIdentifier,
    DuplicateSchemaVersion,
    DuplicateDocumentSchemaVersion,
    DuplicateFieldId,
    InvalidFieldOrder,
    UnknownCatalogDocument,
    CapabilityMismatch,
    InvalidApplicability,
    InvalidConstraint,
    InvalidDefaultValue,
    InvalidSensitivity,
    InvalidSecretPolicy,
    MissingSource,
    UnapprovedSource,
    UnsupportedValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaCatalog {
    format_version: u16,
    schemas: Vec<ConfigSchemaDefinition>,
}

impl SchemaCatalog {
    pub fn format_version(&self) -> u16 {
        self.format_version
    }

    pub fn schemas(&self) -> &[ConfigSchemaDefinition] {
        &self.schemas
    }

    pub fn schema(&self, schema_id: &str, schema_version: u16) -> Option<&ConfigSchemaDefinition> {
        self.schemas
            .iter()
            .find(|schema| schema.schema_id == schema_id && schema.schema_version == schema_version)
    }

    pub fn schemas_for_id(&self, schema_id: &str) -> impl Iterator<Item = &ConfigSchemaDefinition> {
        self.schemas
            .iter()
            .filter(move |schema| schema.schema_id == schema_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigSchemaDefinition {
    schema_id: String,
    schema_version: u16,
    app_id: String,
    config_id: String,
    label: String,
    description: String,
    required_capabilities: SchemaRequiredCapabilities,
    applicability: SchemaApplicability,
    source_ids: Vec<String>,
    fields: Vec<ConfigFieldDefinition>,
}

impl ConfigSchemaDefinition {
    pub fn schema_id(&self) -> &str {
        &self.schema_id
    }

    pub fn schema_version(&self) -> u16 {
        self.schema_version
    }

    pub fn app_id(&self) -> &str {
        &self.app_id
    }

    pub fn config_id(&self) -> &str {
        &self.config_id
    }

    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn required_capabilities(&self) -> &SchemaRequiredCapabilities {
        &self.required_capabilities
    }

    pub fn applicability(&self) -> &SchemaApplicability {
        &self.applicability
    }

    pub fn source_ids(&self) -> &[String] {
        &self.source_ids
    }

    pub fn fields(&self) -> &[ConfigFieldDefinition] {
        &self.fields
    }

    pub fn field(&self, field_id: &str) -> Option<&ConfigFieldDefinition> {
        self.fields.iter().find(|field| field.field_id == field_id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaRequiredCapabilities {
    adapter_id: String,
    validator_id: String,
}

impl SchemaRequiredCapabilities {
    pub fn adapter_id(&self) -> &str {
        &self.adapter_id
    }

    pub fn validator_id(&self) -> &str {
        &self.validator_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaApplicability {
    minimum_app_version: Option<String>,
    maximum_app_version: Option<String>,
    variant_ids: Vec<String>,
    platforms: Vec<SchemaPlatform>,
    feature_flags: Vec<String>,
}

impl SchemaApplicability {
    pub fn minimum_app_version(&self) -> Option<&str> {
        self.minimum_app_version.as_deref()
    }

    pub fn maximum_app_version(&self) -> Option<&str> {
        self.maximum_app_version.as_deref()
    }

    pub fn variant_ids(&self) -> &[String] {
        &self.variant_ids
    }

    pub fn platforms(&self) -> &[SchemaPlatform] {
        &self.platforms
    }

    pub fn feature_flags(&self) -> &[String] {
        &self.feature_flags
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchemaPlatform {
    Macos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldReadPolicy {
    Readable,
    Redacted,
    Omitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldWritePolicy {
    ReadWrite,
    ReplacementOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigFieldDefinition {
    field_id: String,
    label: String,
    description: String,
    semantic_key: String,
    order: u16,
    optional: bool,
    sensitivity: ConfigSensitivity,
    read_policy: FieldReadPolicy,
    write_policy: FieldWritePolicy,
    restore_unchanged_redacted: bool,
    source_ids: Vec<String>,
    field_type: ConfigFieldType,
}

impl ConfigFieldDefinition {
    pub fn field_id(&self) -> &str {
        &self.field_id
    }

    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn semantic_key(&self) -> &str {
        &self.semantic_key
    }

    pub fn order(&self) -> u16 {
        self.order
    }

    pub fn optional(&self) -> bool {
        self.optional
    }

    pub fn sensitivity(&self) -> ConfigSensitivity {
        self.sensitivity
    }

    pub fn read_policy(&self) -> FieldReadPolicy {
        self.read_policy
    }

    pub fn write_policy(&self) -> FieldWritePolicy {
        self.write_policy
    }

    pub fn restore_unchanged_redacted(&self) -> bool {
        self.restore_unchanged_redacted
    }

    pub fn source_ids(&self) -> &[String] {
        &self.source_ids
    }

    pub fn field_type(&self) -> &ConfigFieldType {
        &self.field_type
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigFieldKind {
    Boolean,
    String,
    Integer,
    Enum,
    StringList,
    Secret,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ConfigFieldType {
    Boolean {
        default_value: Option<bool>,
    },
    String {
        minimum_length: u16,
        maximum_length: u16,
        pattern: Option<String>,
        default_value: Option<String>,
    },
    Integer {
        minimum: i64,
        maximum: i64,
        default_value: Option<i64>,
    },
    Enum {
        options: Vec<ConfigEnumOption>,
        default_value: Option<String>,
    },
    StringList {
        maximum_items: u16,
        maximum_item_length: u16,
        default_value: Option<Vec<String>>,
    },
    Secret {
        replacement_only: bool,
    },
}

impl ConfigFieldType {
    pub fn kind(&self) -> ConfigFieldKind {
        match self {
            Self::Boolean { .. } => ConfigFieldKind::Boolean,
            Self::String { .. } => ConfigFieldKind::String,
            Self::Integer { .. } => ConfigFieldKind::Integer,
            Self::Enum { .. } => ConfigFieldKind::Enum,
            Self::StringList { .. } => ConfigFieldKind::StringList,
            Self::Secret { .. } => ConfigFieldKind::Secret,
        }
    }

    pub(super) fn accepts_value(&self, value: ConfigFieldValueRef<'_>) -> bool {
        match (self, value) {
            (Self::Boolean { .. }, ConfigFieldValueRef::Boolean) => true,
            (
                Self::String {
                    minimum_length,
                    maximum_length,
                    ..
                },
                ConfigFieldValueRef::String(value),
            ) => {
                !value.contains('\0')
                    && value.len() >= usize::from(*minimum_length)
                    && value.len() <= usize::from(*maximum_length)
            }
            (
                Self::Integer {
                    minimum, maximum, ..
                },
                ConfigFieldValueRef::Integer(value),
            ) => value >= *minimum && value <= *maximum,
            (Self::Enum { options, .. }, ConfigFieldValueRef::Enum(value)) => {
                options.iter().any(|option| option.value == value)
            }
            (
                Self::StringList {
                    maximum_items,
                    maximum_item_length,
                    ..
                },
                ConfigFieldValueRef::StringList(values),
            ) => {
                values.len() <= usize::from(*maximum_items)
                    && values.iter().all(|value| {
                        !value.contains('\0') && value.len() <= usize::from(*maximum_item_length)
                    })
            }
            _ => false,
        }
    }
}

pub(super) enum ConfigFieldValueRef<'a> {
    Boolean,
    String(&'a str),
    Integer(i64),
    Enum(&'a str),
    StringList(&'a [String]),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigEnumOption {
    value: String,
    label: String,
}

impl ConfigEnumOption {
    pub fn value(&self) -> &str {
        &self.value
    }

    pub fn label(&self) -> &str {
        &self.label
    }
}

pub fn parse_schema_catalog(
    source: &str,
    catalog: &Catalog,
    sources: &SourceCatalog,
) -> Result<SchemaCatalog, SchemaValidationError> {
    if source.len() > MAX_SCHEMA_BYTES {
        return Err(SchemaValidationError::DocumentTooLarge);
    }

    let schemas: SchemaCatalog =
        serde_json::from_str(source).map_err(|_| SchemaValidationError::InvalidDocument)?;
    validate_schema_catalog(&schemas, catalog, sources)?;
    Ok(schemas)
}

fn validate_schema_catalog(
    schemas: &SchemaCatalog,
    catalog: &Catalog,
    sources: &SourceCatalog,
) -> Result<(), SchemaValidationError> {
    if schemas.format_version != SCHEMA_FORMAT_VERSION {
        return Err(SchemaValidationError::UnsupportedFormatVersion);
    }
    if schemas.schemas.len() > MAX_SCHEMAS {
        return Err(SchemaValidationError::TooManyEntries);
    }

    let mut schema_versions = HashSet::with_capacity(schemas.schemas.len());
    let mut document_versions = HashSet::with_capacity(schemas.schemas.len());
    for schema in &schemas.schemas {
        if !is_kebab_case(&schema.schema_id)
            || !is_kebab_case(&schema.app_id)
            || !is_kebab_case(&schema.config_id)
            || schema.schema_version == 0
        {
            return Err(SchemaValidationError::InvalidIdentifier);
        }
        if !schema_versions.insert((schema.schema_id.as_str(), schema.schema_version)) {
            return Err(SchemaValidationError::DuplicateSchemaVersion);
        }
        if !document_versions.insert((
            schema.app_id.as_str(),
            schema.config_id.as_str(),
            schema.schema_version,
        )) {
            return Err(SchemaValidationError::DuplicateDocumentSchemaVersion);
        }
        if !is_bounded_text(&schema.label) || !is_bounded_text(&schema.description) {
            return Err(SchemaValidationError::UnsupportedValue);
        }
        let document = catalog
            .config_document(&schema.app_id, &schema.config_id)
            .map(|(_, document)| document)
            .ok_or(SchemaValidationError::UnknownCatalogDocument)?;
        if document.adapter_id() != schema.required_capabilities.adapter_id
            || document.validator_id() != schema.required_capabilities.validator_id
        {
            return Err(SchemaValidationError::CapabilityMismatch);
        }
        validate_applicability(&schema.applicability, document.path_variants())?;
        validate_source_ids(&schema.source_ids, sources)?;
        if schema.fields.is_empty() {
            return Err(SchemaValidationError::EmptySchema);
        }
        if schema.fields.len() > MAX_FIELDS_PER_SCHEMA {
            return Err(SchemaValidationError::TooManyEntries);
        }

        let mut field_ids = HashSet::with_capacity(schema.fields.len());
        for (index, field) in schema.fields.iter().enumerate() {
            if !is_kebab_case(&field.field_id) || !is_semantic_key(&field.semantic_key) {
                return Err(SchemaValidationError::InvalidIdentifier);
            }
            if !field_ids.insert(field.field_id.as_str()) {
                return Err(SchemaValidationError::DuplicateFieldId);
            }
            if usize::from(field.order) != index {
                return Err(SchemaValidationError::InvalidFieldOrder);
            }
            if !is_bounded_text(&field.label) || !is_bounded_text(&field.description) {
                return Err(SchemaValidationError::UnsupportedValue);
            }
            validate_source_ids(&field.source_ids, sources)?;
            validate_field(field)?;
        }
    }
    Ok(())
}

fn validate_applicability(
    applicability: &SchemaApplicability,
    variants: &[super::ConfigPathVariant],
) -> Result<(), SchemaValidationError> {
    if applicability
        .minimum_app_version
        .as_deref()
        .is_some_and(|value| !is_version_text(value))
        || applicability
            .maximum_app_version
            .as_deref()
            .is_some_and(|value| !is_version_text(value))
        || applicability.variant_ids.len() > 8
        || applicability.platforms.len() > 1
        || applicability.feature_flags.len() > 32
    {
        return Err(SchemaValidationError::InvalidApplicability);
    }
    let mut variant_ids = HashSet::with_capacity(applicability.variant_ids.len());
    if applicability.variant_ids.iter().any(|variant_id| {
        !is_kebab_case(variant_id)
            || !variant_ids.insert(variant_id.as_str())
            || !variants
                .iter()
                .any(|variant| variant.variant_id() == variant_id)
    }) {
        return Err(SchemaValidationError::InvalidApplicability);
    }
    let mut platforms = HashSet::with_capacity(applicability.platforms.len());
    if applicability
        .platforms
        .iter()
        .any(|platform| !platforms.insert(*platform))
    {
        return Err(SchemaValidationError::InvalidApplicability);
    }
    let mut feature_flags = HashSet::with_capacity(applicability.feature_flags.len());
    if applicability
        .feature_flags
        .iter()
        .any(|flag| !is_kebab_case(flag) || !feature_flags.insert(flag.as_str()))
    {
        return Err(SchemaValidationError::InvalidApplicability);
    }
    Ok(())
}

fn validate_source_ids(
    source_ids: &[String],
    sources: &SourceCatalog,
) -> Result<(), SchemaValidationError> {
    if source_ids.is_empty() || source_ids.len() > MAX_FIELD_SOURCES {
        return Err(SchemaValidationError::MissingSource);
    }
    let mut unique = HashSet::with_capacity(source_ids.len());
    for source_id in source_ids {
        if !is_kebab_case(source_id) || !unique.insert(source_id.as_str()) {
            return Err(SchemaValidationError::InvalidIdentifier);
        }
        let source = sources
            .source(source_id)
            .ok_or(SchemaValidationError::MissingSource)?;
        if !sources.contains_approved(source_id)
            || !source.scopes().contains(&SourceScope::FieldSchema)
        {
            return Err(SchemaValidationError::UnapprovedSource);
        }
    }
    Ok(())
}

fn validate_field(field: &ConfigFieldDefinition) -> Result<(), SchemaValidationError> {
    if field.sensitivity == ConfigSensitivity::Unknown {
        return Err(SchemaValidationError::InvalidSensitivity);
    }
    match &field.field_type {
        ConfigFieldType::Boolean { .. } => validate_non_secret_policy(field),
        ConfigFieldType::String {
            minimum_length,
            maximum_length,
            pattern,
            default_value,
        } => {
            validate_non_secret_policy(field)?;
            if maximum_length == &0
                || minimum_length > maximum_length
                || maximum_length > &MAX_STRING_LENGTH
                || pattern.as_deref().is_some_and(|value| {
                    !is_bounded_text(value) || value.contains(['\0', '\r', '\n'])
                })
            {
                return Err(SchemaValidationError::InvalidConstraint);
            }
            if default_value.as_deref().is_some_and(|value| {
                value.contains('\0')
                    || value.len() < usize::from(*minimum_length)
                    || value.len() > usize::from(*maximum_length)
            }) {
                return Err(SchemaValidationError::InvalidDefaultValue);
            }
            Ok(())
        }
        ConfigFieldType::Integer {
            minimum,
            maximum,
            default_value,
        } => {
            validate_non_secret_policy(field)?;
            if minimum > maximum {
                return Err(SchemaValidationError::InvalidConstraint);
            }
            if default_value.is_some_and(|value| value < *minimum || value > *maximum) {
                return Err(SchemaValidationError::InvalidDefaultValue);
            }
            Ok(())
        }
        ConfigFieldType::Enum {
            options,
            default_value,
        } => {
            validate_non_secret_policy(field)?;
            if options.is_empty() || options.len() > MAX_ENUM_OPTIONS {
                return Err(SchemaValidationError::InvalidConstraint);
            }
            let mut option_values = HashSet::with_capacity(options.len());
            for option in options {
                if !is_bounded_text(&option.value)
                    || !is_bounded_text(&option.label)
                    || option.value.contains('\0')
                    || !option_values.insert(option.value.as_str())
                {
                    return Err(SchemaValidationError::InvalidConstraint);
                }
            }
            if default_value
                .as_deref()
                .is_some_and(|value| !option_values.contains(value))
            {
                return Err(SchemaValidationError::InvalidDefaultValue);
            }
            Ok(())
        }
        ConfigFieldType::StringList {
            maximum_items,
            maximum_item_length,
            default_value,
        } => {
            validate_non_secret_policy(field)?;
            if maximum_items == &0
                || maximum_items > &MAX_LIST_ITEMS
                || maximum_item_length == &0
                || maximum_item_length > &MAX_STRING_LENGTH
            {
                return Err(SchemaValidationError::InvalidConstraint);
            }
            if default_value.as_ref().is_some_and(|values| {
                values.len() > usize::from(*maximum_items)
                    || values.iter().any(|value| {
                        value.contains('\0') || value.len() > usize::from(*maximum_item_length)
                    })
            }) {
                return Err(SchemaValidationError::InvalidDefaultValue);
            }
            Ok(())
        }
        ConfigFieldType::Secret { replacement_only } => {
            if !replacement_only
                || field.sensitivity != ConfigSensitivity::Secret
                || field.read_policy != FieldReadPolicy::Omitted
                || field.write_policy != FieldWritePolicy::ReplacementOnly
                || !field.restore_unchanged_redacted
            {
                return Err(SchemaValidationError::InvalidSecretPolicy);
            }
            Ok(())
        }
    }
}

fn validate_non_secret_policy(field: &ConfigFieldDefinition) -> Result<(), SchemaValidationError> {
    if field.sensitivity == ConfigSensitivity::Secret
        || field.read_policy == FieldReadPolicy::Omitted
        || field.write_policy != FieldWritePolicy::ReadWrite
        || field.restore_unchanged_redacted
    {
        return Err(SchemaValidationError::InvalidSecretPolicy);
    }
    Ok(())
}

fn is_semantic_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.contains("..")
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':' | b' ')
        })
}

fn is_version_text(value: &str) -> bool {
    is_bounded_text(value) && !value.contains(char::is_whitespace)
}
