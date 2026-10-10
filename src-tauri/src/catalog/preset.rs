use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use super::{
    is_bounded_text, is_kebab_case,
    schema::{ConfigFieldKind, ConfigFieldValueRef, ConfigSchemaDefinition, SchemaCatalog},
    source::{SourceCatalog, SourceScope},
};

pub const PRESET_FORMAT_VERSION: u16 = 1;
pub const MAX_PRESETS_PER_DOCUMENT: usize = 32;
pub const MIN_ALIAS_RETAINED_VERSIONS: u16 = 2;
pub const MIN_ALIAS_RETENTION_DAYS: u16 = 180;

const MAX_PRESET_BYTES: usize = 512 * 1024;
const MAX_PRESETS: usize = 512;
const MAX_PRESET_FIELDS: usize = 64;
const MAX_PRESET_SOURCES: usize = 16;
const MAX_PRESET_ALIASES: usize = 16;
const MAX_COMPATIBLE_SCHEMA_VERSIONS: u16 = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresetValidationError {
    DocumentTooLarge,
    InvalidDocument,
    UnsupportedFormatVersion,
    TooManyEntries,
    InvalidIdentifier,
    DuplicatePresetVersion,
    DuplicateAliasId,
    AliasCollision,
    InvalidAliasRetention,
    InvalidVersionRange,
    MissingSchemaVersion,
    AmbiguousSchemaTarget,
    DuplicateFieldId,
    UnknownField,
    InvalidFieldValue,
    InvalidPresetShape,
    InvalidApplicability,
    MissingSource,
    UnapprovedSource,
    UnsupportedValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetCatalog {
    format_version: u16,
    presets: Vec<ConfigPresetDefinition>,
}

impl PresetCatalog {
    pub fn format_version(&self) -> u16 {
        self.format_version
    }

    pub fn presets(&self) -> &[ConfigPresetDefinition] {
        &self.presets
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigPresetKind {
    CompleteTemplate,
    FieldGroup,
    RecommendedValues,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresetTarget {
    NewFileOnly,
    ExistingOrNew,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresetMergeStrategy {
    ReplaceSchemaProjection,
    NoValues,
    MergeDeclaredFields,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaVersionRange {
    minimum: u16,
    maximum: u16,
}

impl SchemaVersionRange {
    pub fn minimum(&self) -> u16 {
        self.minimum
    }

    pub fn maximum(&self) -> u16 {
        self.maximum
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetApplicability {
    minimum_app_version: Option<String>,
    maximum_app_version: Option<String>,
    variant_ids: Vec<String>,
    feature_flags: Vec<String>,
}

impl PresetApplicability {
    pub fn minimum_app_version(&self) -> Option<&str> {
        self.minimum_app_version.as_deref()
    }

    pub fn maximum_app_version(&self) -> Option<&str> {
        self.maximum_app_version.as_deref()
    }

    pub fn variant_ids(&self) -> &[String] {
        &self.variant_ids
    }

    pub fn feature_flags(&self) -> &[String] {
        &self.feature_flags
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetAlias {
    alias_id: String,
    deprecated_in_preset_version: u16,
    retained_through_preset_version: u16,
    retain_for_days: u16,
}

impl PresetAlias {
    pub fn alias_id(&self) -> &str {
        &self.alias_id
    }

    pub fn deprecated_in_preset_version(&self) -> u16 {
        self.deprecated_in_preset_version
    }

    pub fn retained_through_preset_version(&self) -> u16 {
        self.retained_through_preset_version
    }

    pub fn retain_for_days(&self) -> u16 {
        self.retain_for_days
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigPresetDefinition {
    preset_id: String,
    preset_version: u16,
    label: String,
    description: String,
    kind: ConfigPresetKind,
    schema_id: String,
    compatible_schema_versions: SchemaVersionRange,
    target: PresetTarget,
    merge_strategy: PresetMergeStrategy,
    applicability: PresetApplicability,
    field_ids: Vec<String>,
    values: Vec<PresetFieldValue>,
    source_ids: Vec<String>,
    aliases: Vec<PresetAlias>,
}

impl ConfigPresetDefinition {
    pub fn preset_id(&self) -> &str {
        &self.preset_id
    }

    pub fn preset_version(&self) -> u16 {
        self.preset_version
    }

    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    pub fn kind(&self) -> ConfigPresetKind {
        self.kind
    }

    pub fn schema_id(&self) -> &str {
        &self.schema_id
    }

    pub fn compatible_schema_versions(&self) -> &SchemaVersionRange {
        &self.compatible_schema_versions
    }

    pub fn target(&self) -> PresetTarget {
        self.target
    }

    pub fn merge_strategy(&self) -> PresetMergeStrategy {
        self.merge_strategy
    }

    pub fn applicability(&self) -> &PresetApplicability {
        &self.applicability
    }

    pub fn field_ids(&self) -> &[String] {
        &self.field_ids
    }

    pub fn values(&self) -> &[PresetFieldValue] {
        &self.values
    }

    pub fn source_ids(&self) -> &[String] {
        &self.source_ids
    }

    pub fn aliases(&self) -> &[PresetAlias] {
        &self.aliases
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetFieldValue {
    field_id: String,
    value: PresetValue,
}

impl PresetFieldValue {
    pub fn field_id(&self) -> &str {
        &self.field_id
    }

    pub fn value(&self) -> &PresetValue {
        &self.value
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PresetValue {
    Boolean { value: bool },
    String { value: String },
    Integer { value: i64 },
    Enum { value: String },
    StringList { value: Vec<String> },
}

impl PresetValue {
    fn as_field_value(&self) -> ConfigFieldValueRef<'_> {
        match self {
            Self::Boolean { .. } => ConfigFieldValueRef::Boolean,
            Self::String { value } => ConfigFieldValueRef::String(value),
            Self::Integer { value } => ConfigFieldValueRef::Integer(*value),
            Self::Enum { value } => ConfigFieldValueRef::Enum(value),
            Self::StringList { value } => ConfigFieldValueRef::StringList(value),
        }
    }
}

pub fn parse_preset_catalog(
    source: &str,
    schemas: &SchemaCatalog,
    sources: &SourceCatalog,
) -> Result<PresetCatalog, PresetValidationError> {
    if source.len() > MAX_PRESET_BYTES {
        return Err(PresetValidationError::DocumentTooLarge);
    }

    let presets: PresetCatalog =
        serde_json::from_str(source).map_err(|_| PresetValidationError::InvalidDocument)?;
    validate_preset_catalog(&presets, schemas, sources)?;
    Ok(presets)
}

fn validate_preset_catalog(
    presets: &PresetCatalog,
    schemas: &SchemaCatalog,
    sources: &SourceCatalog,
) -> Result<(), PresetValidationError> {
    if presets.format_version != PRESET_FORMAT_VERSION {
        return Err(PresetValidationError::UnsupportedFormatVersion);
    }
    if presets.presets.len() > MAX_PRESETS {
        return Err(PresetValidationError::TooManyEntries);
    }

    let mut preset_versions = HashSet::with_capacity(presets.presets.len());
    let canonical_ids = presets
        .presets
        .iter()
        .map(|preset| preset.preset_id.as_str())
        .collect::<HashSet<_>>();
    let mut alias_ids = HashSet::new();
    let mut document_counts = HashMap::new();

    for preset in &presets.presets {
        if !is_kebab_case(&preset.preset_id)
            || !is_kebab_case(&preset.schema_id)
            || preset.preset_version == 0
        {
            return Err(PresetValidationError::InvalidIdentifier);
        }
        if !preset_versions.insert((preset.preset_id.as_str(), preset.preset_version)) {
            return Err(PresetValidationError::DuplicatePresetVersion);
        }
        if !is_bounded_text(&preset.label) || !is_bounded_text(&preset.description) {
            return Err(PresetValidationError::UnsupportedValue);
        }
        validate_aliases(preset, &canonical_ids, &mut alias_ids)?;
        validate_source_ids(&preset.source_ids, sources)?;
        validate_version_range(&preset.compatible_schema_versions)?;

        let compatible = compatible_schemas(preset, schemas)?;
        let first = compatible
            .first()
            .ok_or(PresetValidationError::MissingSchemaVersion)?;
        if compatible.iter().any(|schema| {
            schema.app_id() != first.app_id() || schema.config_id() != first.config_id()
        }) {
            return Err(PresetValidationError::AmbiguousSchemaTarget);
        }
        let count = document_counts
            .entry((first.app_id(), first.config_id()))
            .or_insert(0usize);
        *count += 1;
        if *count > MAX_PRESETS_PER_DOCUMENT {
            return Err(PresetValidationError::TooManyEntries);
        }

        validate_applicability(&preset.applicability, &compatible)?;
        validate_fields_and_values(preset, &compatible)?;
    }
    Ok(())
}

fn validate_aliases<'a>(
    preset: &'a ConfigPresetDefinition,
    canonical_ids: &HashSet<&str>,
    alias_ids: &mut HashSet<&'a str>,
) -> Result<(), PresetValidationError> {
    if preset.aliases.len() > MAX_PRESET_ALIASES {
        return Err(PresetValidationError::TooManyEntries);
    }
    for alias in &preset.aliases {
        if !is_kebab_case(&alias.alias_id) {
            return Err(PresetValidationError::InvalidIdentifier);
        }
        if canonical_ids.contains(alias.alias_id.as_str()) {
            return Err(PresetValidationError::AliasCollision);
        }
        if !alias_ids.insert(alias.alias_id.as_str()) {
            return Err(PresetValidationError::DuplicateAliasId);
        }
        let minimum_retained_version = alias
            .deprecated_in_preset_version
            .checked_add(MIN_ALIAS_RETAINED_VERSIONS)
            .ok_or(PresetValidationError::InvalidAliasRetention)?;
        if alias.deprecated_in_preset_version == 0
            || alias.deprecated_in_preset_version > preset.preset_version
            || alias.retained_through_preset_version < minimum_retained_version
            || alias.retained_through_preset_version < preset.preset_version
            || alias.retain_for_days < MIN_ALIAS_RETENTION_DAYS
        {
            return Err(PresetValidationError::InvalidAliasRetention);
        }
    }
    Ok(())
}

fn validate_version_range(range: &SchemaVersionRange) -> Result<(), PresetValidationError> {
    if range.minimum == 0
        || range.minimum > range.maximum
        || range.maximum - range.minimum >= MAX_COMPATIBLE_SCHEMA_VERSIONS
    {
        return Err(PresetValidationError::InvalidVersionRange);
    }
    Ok(())
}

fn compatible_schemas<'a>(
    preset: &ConfigPresetDefinition,
    schemas: &'a SchemaCatalog,
) -> Result<Vec<&'a ConfigSchemaDefinition>, PresetValidationError> {
    let compatible = schemas
        .schemas_for_id(&preset.schema_id)
        .filter(|schema| {
            schema.schema_version() >= preset.compatible_schema_versions.minimum
                && schema.schema_version() <= preset.compatible_schema_versions.maximum
        })
        .collect::<Vec<_>>();
    for version in
        preset.compatible_schema_versions.minimum..=preset.compatible_schema_versions.maximum
    {
        if !compatible
            .iter()
            .any(|schema| schema.schema_version() == version)
        {
            return Err(PresetValidationError::MissingSchemaVersion);
        }
    }
    Ok(compatible)
}

fn validate_applicability(
    applicability: &PresetApplicability,
    schemas: &[&ConfigSchemaDefinition],
) -> Result<(), PresetValidationError> {
    if applicability
        .minimum_app_version
        .as_deref()
        .is_some_and(|value| !is_version_text(value))
        || applicability
            .maximum_app_version
            .as_deref()
            .is_some_and(|value| !is_version_text(value))
        || applicability.variant_ids.len() > 8
        || applicability.feature_flags.len() > 32
    {
        return Err(PresetValidationError::InvalidApplicability);
    }
    let mut variant_ids = HashSet::with_capacity(applicability.variant_ids.len());
    if applicability.variant_ids.iter().any(|variant_id| {
        !is_kebab_case(variant_id)
            || !variant_ids.insert(variant_id.as_str())
            || schemas
                .iter()
                .any(|schema| !schema.applicability().variant_ids().contains(variant_id))
    }) {
        return Err(PresetValidationError::InvalidApplicability);
    }
    let mut feature_flags = HashSet::with_capacity(applicability.feature_flags.len());
    if applicability
        .feature_flags
        .iter()
        .any(|flag| !is_kebab_case(flag) || !feature_flags.insert(flag.as_str()))
    {
        return Err(PresetValidationError::InvalidApplicability);
    }
    Ok(())
}

fn validate_fields_and_values(
    preset: &ConfigPresetDefinition,
    schemas: &[&ConfigSchemaDefinition],
) -> Result<(), PresetValidationError> {
    if preset.field_ids.is_empty()
        || preset.field_ids.len() > MAX_PRESET_FIELDS
        || preset.values.len() > MAX_PRESET_FIELDS
    {
        return Err(PresetValidationError::TooManyEntries);
    }

    let mut field_ids = HashSet::with_capacity(preset.field_ids.len());
    if preset
        .field_ids
        .iter()
        .any(|field_id| !is_kebab_case(field_id) || !field_ids.insert(field_id.as_str()))
    {
        return Err(PresetValidationError::DuplicateFieldId);
    }

    let mut value_ids = HashSet::with_capacity(preset.values.len());
    for field_value in &preset.values {
        if !is_kebab_case(&field_value.field_id)
            || !value_ids.insert(field_value.field_id.as_str())
            || !field_ids.contains(field_value.field_id.as_str())
        {
            return Err(PresetValidationError::DuplicateFieldId);
        }
        for schema in schemas {
            let field = schema
                .field(&field_value.field_id)
                .ok_or(PresetValidationError::UnknownField)?;
            if !field
                .field_type()
                .accepts_value(field_value.value.as_field_value())
            {
                return Err(PresetValidationError::InvalidFieldValue);
            }
        }
    }
    if preset.field_ids.iter().any(|field_id| {
        schemas
            .iter()
            .any(|schema| schema.field(field_id).is_none())
    }) {
        return Err(PresetValidationError::UnknownField);
    }

    match preset.kind {
        ConfigPresetKind::CompleteTemplate => {
            if preset.target != PresetTarget::NewFileOnly
                || preset.merge_strategy != PresetMergeStrategy::ReplaceSchemaProjection
                || value_ids != field_ids
                || schemas.iter().any(|schema| {
                    let expected = schema
                        .fields()
                        .iter()
                        .filter(|field| field.field_type().kind() != ConfigFieldKind::Secret)
                        .map(|field| field.field_id())
                        .collect::<HashSet<_>>();
                    expected != field_ids
                })
            {
                return Err(PresetValidationError::InvalidPresetShape);
            }
        }
        ConfigPresetKind::FieldGroup => {
            if preset.target != PresetTarget::ExistingOrNew
                || preset.merge_strategy != PresetMergeStrategy::NoValues
                || !preset.values.is_empty()
            {
                return Err(PresetValidationError::InvalidPresetShape);
            }
        }
        ConfigPresetKind::RecommendedValues => {
            if preset.target != PresetTarget::ExistingOrNew
                || preset.merge_strategy != PresetMergeStrategy::MergeDeclaredFields
                || value_ids != field_ids
            {
                return Err(PresetValidationError::InvalidPresetShape);
            }
        }
    }
    Ok(())
}

fn validate_source_ids(
    source_ids: &[String],
    sources: &SourceCatalog,
) -> Result<(), PresetValidationError> {
    if source_ids.is_empty() || source_ids.len() > MAX_PRESET_SOURCES {
        return Err(PresetValidationError::MissingSource);
    }
    let mut unique = HashSet::with_capacity(source_ids.len());
    for source_id in source_ids {
        if !is_kebab_case(source_id) || !unique.insert(source_id.as_str()) {
            return Err(PresetValidationError::InvalidIdentifier);
        }
        let source = sources
            .source(source_id)
            .ok_or(PresetValidationError::MissingSource)?;
        if !sources.contains_approved(source_id) || !source.scopes().contains(&SourceScope::Preset)
        {
            return Err(PresetValidationError::UnapprovedSource);
        }
    }
    Ok(())
}

fn is_version_text(value: &str) -> bool {
    is_bounded_text(value) && !value.contains(char::is_whitespace)
}
