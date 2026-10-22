use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::State;

use crate::{
    catalog::{
        ConfigSensitivity,
        preset::{
            ConfigPresetDefinition, ConfigPresetKind, PresetMergeStrategy, PresetTarget,
            PresetValue,
        },
        schema::{
            ConfigFieldDefinition, ConfigFieldType, ConfigSchemaDefinition, FieldReadPolicy,
            FieldWritePolicy, SchemaPlatform,
        },
    },
    config::{
        ConfigCoordinator, ConfigEnvironment,
        backup::{BackupSummary, list_backups as list_backup_records},
        builtin_catalog,
        read::{
            ConfigDiagnostic, ConfigDocument, ConfigSummary, ConfigVariantResolution,
            diagnose_config as diagnose, list_configs as list, read_config_result as read,
            resolve_config_variants as resolve_variants,
        },
        restore::{RestoreBackupInput, execute_restore, prepare_restore},
        validation::{ValidationResult, validate_config as validate},
        write::{
            ConfigWriteInput, MISSING_CONFIG_HASH, PendingConfigMutation,
            SchemaStructuredWriteRequest, StructuredConfigWriteInput, execute_pending_write,
            prepare_schema_structured_write, prepare_structured_write, prepare_write,
        },
    },
    error::AppError,
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
    },
    settings::SettingsCoordinator,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigKey {
    app_id: String,
    config_id: String,
    #[serde(default)]
    variant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidateConfigInput {
    app_id: String,
    config_id: String,
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWritePreview {
    #[serde(flatten)]
    operation: OperationPreview,
    current_hash: String,
    proposed_hash: String,
    diff: crate::config::diff::ConfigDiff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchemaPresentationState {
    Ready,
    Unavailable,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchemaDisabledCode {
    NoSchema,
    InvalidCatalog,
    VersionMismatch,
    CapabilityMismatch,
    ApplicabilityMismatch,
    DocumentUnavailable,
    CurrentValueMismatch,
    UnsafeSecretPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDisabledReason {
    code: SchemaDisabledCode,
    message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSchemaPresentation {
    state: SchemaPresentationState,
    app_id: String,
    config_id: String,
    variant_id: Option<String>,
    document_state: Option<crate::config::read::ConfigDocumentState>,
    expected_hash: Option<String>,
    writable: bool,
    disabled_reason: Option<SchemaDisabledReason>,
    schema: Option<SchemaDefinitionPresentation>,
    presets: Vec<PresetDefinitionPresentation>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDefinitionPresentation {
    schema_id: String,
    schema_version: u16,
    label: String,
    description: String,
    applicability: ApplicabilityPresentation,
    source_ids: Vec<String>,
    fields: Vec<SchemaFieldPresentation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicabilityPresentation {
    minimum_app_version: Option<String>,
    maximum_app_version: Option<String>,
    variant_ids: Vec<String>,
    platforms: Vec<String>,
    feature_flags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaFieldPresentation {
    field_id: String,
    label: String,
    description: String,
    order: u16,
    optional: bool,
    sensitivity: String,
    read_policy: String,
    write_policy: String,
    source_ids: Vec<String>,
    field_type: FieldTypePresentation,
    current: CurrentFieldPresentation,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum FieldTypePresentation {
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
        options: Vec<EnumOptionPresentation>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumOptionPresentation {
    value: String,
    label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentFieldPresentation {
    Unset,
    Value { value: SchemaValuePresentation },
    ReplacementOnly,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchemaValuePresentation {
    Boolean { value: bool },
    String { value: String },
    Integer { value: i64 },
    Enum { value: String },
    StringList { value: Vec<String> },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetDefinitionPresentation {
    preset_id: String,
    preset_version: u16,
    label: String,
    description: String,
    kind: String,
    target: String,
    merge_strategy: String,
    applicability: PresetApplicabilityPresentation,
    field_ids: Vec<String>,
    values: Vec<PresetFieldValuePresentation>,
    source_ids: Vec<String>,
    available: bool,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetApplicabilityPresentation {
    minimum_app_version: Option<String>,
    maximum_app_version: Option<String>,
    variant_ids: Vec<String>,
    feature_flags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetFieldValuePresentation {
    field_id: String,
    value: SchemaValuePresentation,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaConfigWriteInput {
    app_id: String,
    config_id: String,
    variant_id: String,
    schema_id: String,
    schema_version: u16,
    expected_hash: String,
    fields: Vec<SchemaFieldPatch>,
    complete_template: Option<PresetSelection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetSelection {
    preset_id: String,
    preset_version: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemaFieldPatch {
    field_id: String,
    value: SchemaPatchValue,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum SchemaPatchValue {
    Boolean { value: bool },
    String { value: String },
    Integer { value: i64 },
    Enum { value: String },
    StringList { value: Vec<String> },
    Secret { replacement: String },
}

#[tauri::command]
pub fn list_configs(app_id: String) -> Result<Vec<ConfigSummary>, AppError> {
    let environment = ConfigEnvironment::from_environment()?;
    list(&builtin_catalog()?, &environment, &app_id)
}

#[tauri::command]
pub fn read_config(key: ConfigKey) -> Result<ConfigDocument, AppError> {
    let catalog = builtin_catalog()?;
    let environment = ConfigEnvironment::from_environment()?;
    let mut document = read(
        &catalog,
        &environment,
        &key.app_id,
        &key.config_id,
        key.variant_id.as_deref(),
    )?;
    let sources = crate::catalog::load_builtin_sources().map_err(|_| AppError::internal())?;
    let schemas = crate::catalog::load_builtin_schemas(&catalog, &sources)
        .map_err(|_| AppError::internal())?;
    if schemas
        .schemas()
        .iter()
        .any(|schema| schema.app_id() == key.app_id && schema.config_id() == key.config_id)
    {
        document.strip_schema_payload();
    }
    Ok(document)
}

#[tauri::command]
pub fn get_config_schema(key: ConfigKey) -> Result<ConfigSchemaPresentation, AppError> {
    let catalog = builtin_catalog()?;
    let definition = crate::config::resolve_definition(&catalog, &key.app_id, &key.config_id)?;
    let Some(variant_id) = key.variant_id.as_deref() else {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::DocumentUnavailable,
            "Schema presentation requires an explicit configuration variant.",
        ));
    };
    let sources = match crate::catalog::load_builtin_sources() {
        Ok(sources) => sources,
        Err(_) => {
            return Ok(disabled_schema_presentation(
                &key,
                SchemaPresentationState::Disabled,
                SchemaDisabledCode::InvalidCatalog,
                "Schema sources are invalid.",
            ));
        }
    };
    let schemas = match crate::catalog::load_builtin_schemas(&catalog, &sources) {
        Ok(schemas) => schemas,
        Err(_) => {
            return Ok(disabled_schema_presentation(
                &key,
                SchemaPresentationState::Disabled,
                SchemaDisabledCode::InvalidCatalog,
                "Configuration schemas are invalid.",
            ));
        }
    };
    let presets = match crate::catalog::load_builtin_presets(&schemas, &sources) {
        Ok(presets) => presets,
        Err(_) => {
            return Ok(disabled_schema_presentation(
                &key,
                SchemaPresentationState::Disabled,
                SchemaDisabledCode::InvalidCatalog,
                "Configuration presets are invalid.",
            ));
        }
    };

    let matching = schemas
        .schemas()
        .iter()
        .filter(|schema| schema.app_id() == key.app_id && schema.config_id() == key.config_id)
        .collect::<Vec<_>>();
    let Some(schema) = matching
        .iter()
        .max_by_key(|schema| schema.schema_version())
        .copied()
    else {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Unavailable,
            SchemaDisabledCode::NoSchema,
            "No approved schema is packaged for this configuration document.",
        ));
    };
    if matching
        .iter()
        .any(|candidate| candidate.schema_id() != schema.schema_id())
    {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::VersionMismatch,
            "Packaged schema versions do not share one stable schema ID.",
        ));
    }
    if schema.required_capabilities().adapter_id() != definition.adapter_id()
        || schema.required_capabilities().validator_id() != definition.validator_id()
    {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::CapabilityMismatch,
            "Schema capabilities do not match the catalog document.",
        ));
    }
    if let Err(message) = evaluate_applicability(
        schema.applicability().minimum_app_version(),
        schema.applicability().maximum_app_version(),
        schema.applicability().variant_ids(),
        schema.applicability().platforms(),
        schema.applicability().feature_flags(),
        variant_id,
    ) {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::ApplicabilityMismatch,
            message,
        ));
    }
    if schema.fields().iter().any(|field| {
        matches!(
            field.field_type(),
            ConfigFieldType::String {
                pattern: Some(_),
                ..
            }
        )
    }) {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::CapabilityMismatch,
            "Pattern-constrained schema fields cannot be evaluated reliably.",
        ));
    }
    if schema.fields().iter().any(|field| {
        matches!(field.field_type(), ConfigFieldType::Secret { .. })
            && definition.sensitivity_kind() != ConfigSensitivity::Secret
    }) {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::UnsafeSecretPolicy,
            "Secret schema fields require a SECRET catalog document.",
        ));
    }

    let environment = ConfigEnvironment::from_environment()?;
    let document = read(
        &catalog,
        &environment,
        &key.app_id,
        &key.config_id,
        key.variant_id.as_deref(),
    )?;
    let document_state = document.diagnostic().state();
    if !matches!(
        document_state,
        crate::config::read::ConfigDocumentState::Ready
            | crate::config::read::ConfigDocumentState::Redacted
            | crate::config::read::ConfigDocumentState::Missing
    ) {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::DocumentUnavailable,
            "The configuration document is not in an editable state.",
        ));
    }
    if document.exists()
        && definition.adapter_id() == "ssh-config"
        && document.structured().is_none()
    {
        return Ok(disabled_schema_presentation(
            &key,
            SchemaPresentationState::Disabled,
            SchemaDisabledCode::CurrentValueMismatch,
            "The OpenSSH document has no uniquely identified managed host block.",
        ));
    }
    let (structured, projection_absent) = if document.exists() {
        match document.structured() {
            Some(Value::Object(structured)) => (Some(structured), false),
            None => (None, true),
            Some(_) => {
                return Ok(disabled_schema_presentation(
                    &key,
                    SchemaPresentationState::Disabled,
                    SchemaDisabledCode::CurrentValueMismatch,
                    "The adapter did not provide a schema-compatible projection.",
                ));
            }
        }
    } else {
        (None, false)
    };
    let fields = match schema
        .fields()
        .iter()
        .map(|field| field_presentation(field, structured, document.exists(), projection_absent))
        .collect::<Result<Vec<_>, _>>()
    {
        Ok(fields) => fields,
        Err(()) => {
            return Ok(disabled_schema_presentation(
                &key,
                SchemaPresentationState::Disabled,
                SchemaDisabledCode::CurrentValueMismatch,
                "Current adapter values do not match the approved schema.",
            ));
        }
    };

    let expected_hash = if document.exists() {
        document.content_hash().map(str::to_owned)
    } else {
        Some(MISSING_CONFIG_HASH.to_owned())
    };
    let preset_values = presets
        .presets()
        .iter()
        .filter(|preset| {
            preset.schema_id() == schema.schema_id()
                && schema.schema_version() >= preset.compatible_schema_versions().minimum()
                && schema.schema_version() <= preset.compatible_schema_versions().maximum()
        })
        .take(crate::catalog::preset::MAX_PRESETS_PER_DOCUMENT)
        .filter(|preset| {
            evaluate_applicability(
                preset.applicability().minimum_app_version(),
                preset.applicability().maximum_app_version(),
                preset.applicability().variant_ids(),
                &[],
                preset.applicability().feature_flags(),
                variant_id,
            )
            .is_ok()
        })
        .map(|preset| preset_presentation(schema, preset, document.exists()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::not_supported("Preset values are not schema-compatible."))?;

    Ok(ConfigSchemaPresentation {
        state: SchemaPresentationState::Ready,
        app_id: key.app_id,
        config_id: key.config_id,
        variant_id: key.variant_id,
        document_state: Some(document_state),
        expected_hash,
        writable: !definition.is_read_only(),
        disabled_reason: None,
        schema: Some(schema_presentation(schema, fields)),
        presets: preset_values,
    })
}

#[tauri::command]
pub fn resolve_config_variants(key: ConfigKey) -> Result<Vec<ConfigVariantResolution>, AppError> {
    let environment = ConfigEnvironment::from_environment()?;
    resolve_variants(
        &builtin_catalog()?,
        &environment,
        &key.app_id,
        &key.config_id,
    )
}

#[tauri::command]
pub fn diagnose_config(key: ConfigKey) -> Result<ConfigDiagnostic, AppError> {
    let environment = ConfigEnvironment::from_environment()?;
    diagnose(
        &builtin_catalog()?,
        &environment,
        &key.app_id,
        &key.config_id,
        key.variant_id.as_deref(),
    )
}

#[tauri::command]
pub fn validate_config(input: ValidateConfigInput) -> Result<ValidationResult, AppError> {
    let catalog = builtin_catalog()?;
    let definition = crate::config::resolve_definition(&catalog, &input.app_id, &input.config_id)?;
    let environment = ConfigEnvironment::from_environment()?;
    validate(definition, &environment, &input.content)
}

#[tauri::command]
pub fn preview_config_write(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: ConfigWriteInput,
) -> Result<ConfigWritePreview, AppError> {
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &input.app_id, &input.config_id)?;
    let (mutation, prepared) = prepare_write(&catalog, config.environment()?, input)?;
    let intent = mutation_intent(OperationKind::ConfigurationWrite, &mutation);
    let operation = operations.preview(
        intent,
        &format!(
            "Update {} configuration {}.",
            mutation.app_id, mutation.config_id
        ),
        vec![
            format!("Authorized catalog document: {}", mutation.config_id),
            format!("Changed lines: {}", prepared.diff.changed_line_count()),
            "Create a protected backup before atomic replacement.".to_owned(),
        ],
    )?;
    config.remember(operation.operation_id.clone(), mutation)?;
    Ok(ConfigWritePreview {
        operation,
        current_hash: prepared.current_hash,
        proposed_hash: prepared.proposed_hash,
        diff: prepared.diff,
    })
}

#[tauri::command]
pub fn preview_structured_config_write(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: StructuredConfigWriteInput,
) -> Result<ConfigWritePreview, AppError> {
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &input.app_id, &input.config_id)?;
    let (mutation, prepared) = prepare_structured_write(&catalog, config.environment()?, input)?;
    let intent = mutation_intent(OperationKind::ConfigurationWrite, &mutation);
    let operation = operations.preview(
        intent,
        &format!(
            "Update {} configuration {}.",
            mutation.app_id, mutation.config_id
        ),
        vec![
            format!("Authorized catalog document: {}", mutation.config_id),
            "Apply only allowlisted structured fields.".to_owned(),
            "Create a protected backup before atomic replacement.".to_owned(),
        ],
    )?;
    config.remember(operation.operation_id.clone(), mutation)?;
    Ok(ConfigWritePreview {
        operation,
        current_hash: prepared.current_hash,
        proposed_hash: prepared.proposed_hash,
        diff: prepared.diff,
    })
}

#[tauri::command]
pub fn preview_schema_config_write(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: SchemaConfigWriteInput,
) -> Result<ConfigWritePreview, AppError> {
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &input.app_id, &input.config_id)?;
    let definition = crate::config::resolve_definition(&catalog, &input.app_id, &input.config_id)?;
    let sources = crate::catalog::load_builtin_sources()
        .map_err(|_| AppError::not_supported("Configuration schema sources are unavailable."))?;
    let schemas = crate::catalog::load_builtin_schemas(&catalog, &sources)
        .map_err(|_| AppError::not_supported("Configuration schemas are unavailable."))?;
    let presets = crate::catalog::load_builtin_presets(&schemas, &sources)
        .map_err(|_| AppError::not_supported("Configuration presets are unavailable."))?;
    let schema = schemas
        .schema(&input.schema_id, input.schema_version)
        .filter(|schema| schema.app_id() == input.app_id && schema.config_id() == input.config_id)
        .ok_or_else(|| AppError::not_supported("Schema version is not available."))?;
    if schema.required_capabilities().adapter_id() != definition.adapter_id()
        || schema.required_capabilities().validator_id() != definition.validator_id()
    {
        return Err(AppError::not_supported(
            "Schema capabilities do not match the catalog document.",
        ));
    }
    evaluate_applicability(
        schema.applicability().minimum_app_version(),
        schema.applicability().maximum_app_version(),
        schema.applicability().variant_ids(),
        schema.applicability().platforms(),
        schema.applicability().feature_flags(),
        &input.variant_id,
    )
    .map_err(AppError::not_supported)?;
    if schema.fields().iter().any(|field| {
        matches!(
            field.field_type(),
            ConfigFieldType::String {
                pattern: Some(_),
                ..
            }
        )
    }) {
        return Err(AppError::not_supported(
            "Pattern-constrained schema fields cannot be evaluated reliably.",
        ));
    }
    if input.fields.is_empty() || input.fields.len() > crate::catalog::schema::MAX_FIELDS_PER_SCHEMA
    {
        return Err(AppError::invalid_input(
            "Schema field patch is empty or exceeds the approved bound.",
        ));
    }

    let environment = config.environment()?;
    let current_document = read(
        &catalog,
        environment,
        &input.app_id,
        &input.config_id,
        Some(&input.variant_id),
    )?;
    let current_fields = match current_document.structured() {
        Some(Value::Object(values)) => Some(values),
        None => None,
        Some(_) => {
            return Err(AppError::conflict(
                "The current adapter projection is not schema-compatible.",
            ));
        }
    };

    let mut field_ids = HashSet::with_capacity(input.fields.len());
    let mut adapter_fields = Map::new();
    if let Some(current_fields) = current_fields {
        for field in schema.fields() {
            if matches!(field.field_type(), ConfigFieldType::Secret { .. }) {
                continue;
            }
            if let Some(value) = current_fields.get(field.semantic_key()) {
                adapter_fields.insert(field.semantic_key().to_owned(), value.clone());
            }
        }
        if definition.adapter_id() == "ssh-config"
            && let Some(host) = current_fields.get("host")
        {
            adapter_fields.insert("host".to_owned(), host.clone());
        }
    }
    let mut patch_values = HashMap::with_capacity(input.fields.len());
    let mut changed_fields = Vec::with_capacity(input.fields.len());
    for patch in &input.fields {
        if !field_ids.insert(patch.field_id.as_str()) {
            return Err(AppError::invalid_input(
                "Schema field patch contains duplicate fields.",
            ));
        }
        let field = schema
            .field(&patch.field_id)
            .ok_or_else(|| AppError::invalid_input("Schema field is not available."))?;
        if matches!(field.field_type(), ConfigFieldType::Secret { .. })
            && definition.sensitivity_kind() != ConfigSensitivity::Secret
        {
            return Err(AppError::not_supported(
                "Secret fields require a SECRET catalog document.",
            ));
        }
        let schema_value = validate_schema_patch(field, &patch.value)?;
        patch_values.insert(field.field_id(), schema_value.clone());
        let adapter_value =
            adapt_schema_value(definition.adapter_id(), field.semantic_key(), schema_value)?;
        adapter_fields.insert(field.semantic_key().to_owned(), adapter_value);
        changed_fields.push(field.field_id().to_owned());
    }

    let allow_new_file = if let Some(selection) = &input.complete_template {
        let preset = presets
            .presets()
            .iter()
            .find(|preset| {
                preset.preset_id() == selection.preset_id
                    && preset.preset_version() == selection.preset_version
            })
            .ok_or_else(|| AppError::not_supported("Complete template is unavailable."))?;
        evaluate_applicability(
            preset.applicability().minimum_app_version(),
            preset.applicability().maximum_app_version(),
            preset.applicability().variant_ids(),
            &[],
            preset.applicability().feature_flags(),
            &input.variant_id,
        )
        .map_err(AppError::not_supported)?;
        validate_complete_template(schema, preset, &patch_values)?;
        true
    } else {
        false
    };
    if input.expected_hash == MISSING_CONFIG_HASH && !allow_new_file {
        return Err(AppError::not_supported(
            "Creating a configuration file requires an approved complete template.",
        ));
    }

    let (mutation, prepared) = prepare_schema_structured_write(
        &catalog,
        environment,
        SchemaStructuredWriteRequest {
            app_id: input.app_id,
            config_id: input.config_id,
            expected_hash: input.expected_hash,
            fields: Value::Object(adapter_fields),
            allow_new_file,
            variant_id: Some(input.variant_id),
        },
    )?;
    let intent = mutation_intent(OperationKind::ConfigurationWrite, &mutation);
    let mut effects = vec![
        format!("Authorized catalog document: {}", mutation.config_id),
        format!(
            "Schema: {} v{}",
            schema.schema_id(),
            schema.schema_version()
        ),
        format!("Changed schema fields: {}", changed_fields.join(", ")),
    ];
    if let Some(selection) = input.complete_template {
        effects.push(format!(
            "Complete template: {} v{} (new file only).",
            selection.preset_id, selection.preset_version
        ));
        effects.push("Rollback removes the newly created file if validation fails.".to_owned());
    } else {
        effects.push("Create a protected backup before atomic replacement.".to_owned());
    }
    let operation = operations.preview(
        intent,
        &format!(
            "Update {} configuration {} through schema {}.",
            mutation.app_id,
            mutation.config_id,
            schema.schema_id()
        ),
        effects,
    )?;
    config.remember(operation.operation_id.clone(), mutation)?;
    Ok(ConfigWritePreview {
        operation,
        current_hash: prepared.current_hash,
        proposed_hash: prepared.proposed_hash,
        diff: prepared.diff,
    })
}

#[tauri::command]
pub fn execute_config_write(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    let mutation = config.pending(&operation_id)?;
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &mutation.app_id, &mutation.config_id)?;
    let intent = mutation_intent(OperationKind::ConfigurationWrite, &mutation);
    if let Err(error) = operations.authorize_mutation(&operation_id, &intent) {
        if error.code() == crate::error::AppErrorCode::Timeout {
            config.forget(&operation_id);
        }
        return Err(error);
    }
    operations.record_progress(&operation_id, "Creating protected backup.")?;
    let retention = settings.get()?.preferences().backup_retention();
    let result = execute_pending_write(&catalog, config.environment()?, &mutation, retention);
    config.forget(&operation_id);
    match result {
        Ok(audit_id) => {
            operations.record_progress(
                &operation_id,
                &format!("Mutation verified. Audit ID: {audit_id}"),
            )?;
            operations.finish_success(&operation_id)?;
        }
        Err(error) => {
            operations.finish_failure(&operation_id, error.clone())?;
            return Err(error);
        }
    }
    operations.get(&operation_id)
}

fn disabled_schema_presentation(
    key: &ConfigKey,
    state: SchemaPresentationState,
    code: SchemaDisabledCode,
    message: &str,
) -> ConfigSchemaPresentation {
    ConfigSchemaPresentation {
        state,
        app_id: key.app_id.clone(),
        config_id: key.config_id.clone(),
        variant_id: key.variant_id.clone(),
        document_state: None,
        expected_hash: None,
        writable: false,
        disabled_reason: Some(SchemaDisabledReason {
            code,
            message: message.to_owned(),
        }),
        schema: None,
        presets: Vec::new(),
    }
}

fn evaluate_applicability(
    minimum_app_version: Option<&str>,
    maximum_app_version: Option<&str>,
    variant_ids: &[String],
    platforms: &[SchemaPlatform],
    feature_flags: &[String],
    variant_id: &str,
) -> Result<(), &'static str> {
    if !variant_ids.is_empty() && !variant_ids.iter().any(|value| value == variant_id) {
        return Err("Schema or preset does not apply to the selected configuration variant.");
    }
    if !platforms.is_empty() && !platforms.contains(&SchemaPlatform::Macos) {
        return Err("Schema does not apply to the current macOS platform.");
    }
    if minimum_app_version.is_some() || maximum_app_version.is_some() {
        return Err(
            "Application version constraints cannot be evaluated from trusted runtime data.",
        );
    }
    if !feature_flags.is_empty() {
        return Err("Feature-flag constraints cannot be evaluated from trusted runtime data.");
    }
    Ok(())
}

fn schema_presentation(
    schema: &ConfigSchemaDefinition,
    fields: Vec<SchemaFieldPresentation>,
) -> SchemaDefinitionPresentation {
    SchemaDefinitionPresentation {
        schema_id: schema.schema_id().to_owned(),
        schema_version: schema.schema_version(),
        label: schema.label().to_owned(),
        description: schema.description().to_owned(),
        applicability: ApplicabilityPresentation {
            minimum_app_version: schema
                .applicability()
                .minimum_app_version()
                .map(str::to_owned),
            maximum_app_version: schema
                .applicability()
                .maximum_app_version()
                .map(str::to_owned),
            variant_ids: schema.applicability().variant_ids().to_vec(),
            platforms: schema
                .applicability()
                .platforms()
                .iter()
                .map(|platform| match platform {
                    SchemaPlatform::Macos => "MACOS".to_owned(),
                })
                .collect(),
            feature_flags: schema.applicability().feature_flags().to_vec(),
        },
        source_ids: schema.source_ids().to_vec(),
        fields,
    }
}

fn field_presentation(
    field: &ConfigFieldDefinition,
    structured: Option<&Map<String, Value>>,
    document_exists: bool,
    projection_absent: bool,
) -> Result<SchemaFieldPresentation, ()> {
    let current = if matches!(field.field_type(), ConfigFieldType::Secret { .. }) {
        CurrentFieldPresentation::ReplacementOnly
    } else {
        match structured.and_then(|values| values.get(field.semantic_key())) {
            None if !document_exists || projection_absent => CurrentFieldPresentation::Unset,
            None | Some(Value::Null) if field.optional() => CurrentFieldPresentation::Unset,
            None | Some(Value::Null) => return Err(()),
            Some(value) => {
                let value = current_schema_value(field, value)?;
                if field.read_policy() == FieldReadPolicy::Readable {
                    CurrentFieldPresentation::Value { value }
                } else {
                    CurrentFieldPresentation::Unset
                }
            }
        }
    };
    Ok(SchemaFieldPresentation {
        field_id: field.field_id().to_owned(),
        label: field.label().to_owned(),
        description: field.description().to_owned(),
        order: field.order(),
        optional: field.optional(),
        sensitivity: field.sensitivity().as_str().to_owned(),
        read_policy: match field.read_policy() {
            FieldReadPolicy::Readable => "READABLE",
            FieldReadPolicy::Redacted => "REDACTED",
            FieldReadPolicy::Omitted => "OMITTED",
        }
        .to_owned(),
        write_policy: match field.write_policy() {
            FieldWritePolicy::ReadWrite => "READ_WRITE",
            FieldWritePolicy::ReplacementOnly => "REPLACEMENT_ONLY",
        }
        .to_owned(),
        source_ids: field.source_ids().to_vec(),
        field_type: field_type_presentation(field.field_type()),
        current,
    })
}

fn field_type_presentation(field_type: &ConfigFieldType) -> FieldTypePresentation {
    match field_type {
        ConfigFieldType::Boolean { default_value } => FieldTypePresentation::Boolean {
            default_value: *default_value,
        },
        ConfigFieldType::String {
            minimum_length,
            maximum_length,
            pattern,
            default_value,
        } => FieldTypePresentation::String {
            minimum_length: *minimum_length,
            maximum_length: *maximum_length,
            pattern: pattern.clone(),
            default_value: default_value.clone(),
        },
        ConfigFieldType::Integer {
            minimum,
            maximum,
            default_value,
        } => FieldTypePresentation::Integer {
            minimum: *minimum,
            maximum: *maximum,
            default_value: *default_value,
        },
        ConfigFieldType::Enum {
            options,
            default_value,
        } => FieldTypePresentation::Enum {
            options: options
                .iter()
                .map(|option| EnumOptionPresentation {
                    value: option.value().to_owned(),
                    label: option.label().to_owned(),
                })
                .collect(),
            default_value: default_value.clone(),
        },
        ConfigFieldType::StringList {
            maximum_items,
            maximum_item_length,
            default_value,
        } => FieldTypePresentation::StringList {
            maximum_items: *maximum_items,
            maximum_item_length: *maximum_item_length,
            default_value: default_value.clone(),
        },
        ConfigFieldType::Secret { replacement_only } => FieldTypePresentation::Secret {
            replacement_only: *replacement_only,
        },
    }
}

fn current_schema_value(
    field: &ConfigFieldDefinition,
    value: &Value,
) -> Result<SchemaValuePresentation, ()> {
    let (normalized, presentation) = match field.field_type() {
        ConfigFieldType::Boolean { .. } => {
            let value = value.as_bool().ok_or(())?;
            (
                Value::Bool(value),
                SchemaValuePresentation::Boolean { value },
            )
        }
        ConfigFieldType::String { .. } => {
            let value = value.as_str().ok_or(())?.to_owned();
            (
                Value::String(value.clone()),
                SchemaValuePresentation::String { value },
            )
        }
        ConfigFieldType::Integer { .. } => {
            let value = value.as_i64().ok_or(())?;
            (
                Value::Number(value.into()),
                SchemaValuePresentation::Integer { value },
            )
        }
        ConfigFieldType::Enum { .. } => {
            let value = value.as_str().ok_or(())?.to_owned();
            (
                Value::String(value.clone()),
                SchemaValuePresentation::Enum { value },
            )
        }
        ConfigFieldType::StringList { .. } => {
            let value = normalize_string_list(value).ok_or(())?;
            (
                Value::Array(value.iter().cloned().map(Value::String).collect()),
                SchemaValuePresentation::StringList { value },
            )
        }
        ConfigFieldType::Secret { .. } => return Err(()),
    };
    validate_field_value(field, &normalized).map_err(|_| ())?;
    Ok(presentation)
}

fn normalize_string_list(value: &Value) -> Option<Vec<String>> {
    value
        .as_array()?
        .iter()
        .map(|entry| {
            if let Some(value) = entry.as_str() {
                return Some(value.to_owned());
            }
            let entry = entry.as_object()?;
            if entry.len() != 2 {
                return None;
            }
            let name = entry.get("name")?.as_str()?;
            let value = entry.get("value")?.as_str()?;
            Some(format!("{name}={value}"))
        })
        .collect()
}

fn preset_presentation(
    schema: &ConfigSchemaDefinition,
    preset: &ConfigPresetDefinition,
    document_exists: bool,
) -> Result<PresetDefinitionPresentation, ()> {
    let complete_existing = preset.kind() == ConfigPresetKind::CompleteTemplate && document_exists;
    let mut warnings = Vec::new();
    if complete_existing {
        warnings.push(
            "Complete templates can be executed only when the configuration file is missing."
                .to_owned(),
        );
    }
    let values = preset
        .values()
        .iter()
        .map(|preset_field| {
            let field = schema.field(preset_field.field_id()).ok_or(())?;
            let value = preset_value_json(preset_field.value());
            validate_field_value(field, &value).map_err(|_| ())?;
            Ok(PresetFieldValuePresentation {
                field_id: preset_field.field_id().to_owned(),
                value: current_schema_value(field, &value)?,
            })
        })
        .collect::<Result<Vec<_>, ()>>()?;
    Ok(PresetDefinitionPresentation {
        preset_id: preset.preset_id().to_owned(),
        preset_version: preset.preset_version(),
        label: preset.label().to_owned(),
        description: preset.description().to_owned(),
        kind: preset_kind(preset.kind()).to_owned(),
        target: preset_target(preset.target()).to_owned(),
        merge_strategy: preset_merge_strategy(preset.merge_strategy()).to_owned(),
        applicability: PresetApplicabilityPresentation {
            minimum_app_version: preset
                .applicability()
                .minimum_app_version()
                .map(str::to_owned),
            maximum_app_version: preset
                .applicability()
                .maximum_app_version()
                .map(str::to_owned),
            variant_ids: preset.applicability().variant_ids().to_vec(),
            feature_flags: preset.applicability().feature_flags().to_vec(),
        },
        field_ids: preset.field_ids().to_vec(),
        values,
        source_ids: preset.source_ids().to_vec(),
        available: !complete_existing,
        warnings,
    })
}

fn preset_value_json(value: &PresetValue) -> Value {
    match value {
        PresetValue::Boolean { value } => Value::Bool(*value),
        PresetValue::String { value } | PresetValue::Enum { value } => Value::String(value.clone()),
        PresetValue::Integer { value } => Value::Number((*value).into()),
        PresetValue::StringList { value } => {
            Value::Array(value.iter().cloned().map(Value::String).collect())
        }
    }
}

fn preset_kind(kind: ConfigPresetKind) -> &'static str {
    match kind {
        ConfigPresetKind::CompleteTemplate => "COMPLETE_TEMPLATE",
        ConfigPresetKind::FieldGroup => "FIELD_GROUP",
        ConfigPresetKind::RecommendedValues => "RECOMMENDED_VALUES",
    }
}

fn preset_target(target: PresetTarget) -> &'static str {
    match target {
        PresetTarget::NewFileOnly => "NEW_FILE_ONLY",
        PresetTarget::ExistingOrNew => "EXISTING_OR_NEW",
    }
}

fn preset_merge_strategy(strategy: PresetMergeStrategy) -> &'static str {
    match strategy {
        PresetMergeStrategy::ReplaceSchemaProjection => "REPLACE_SCHEMA_PROJECTION",
        PresetMergeStrategy::NoValues => "NO_VALUES",
        PresetMergeStrategy::MergeDeclaredFields => "MERGE_DECLARED_FIELDS",
    }
}

fn validate_schema_patch(
    field: &ConfigFieldDefinition,
    value: &SchemaPatchValue,
) -> Result<Value, AppError> {
    let value = match (field.field_type(), value) {
        (ConfigFieldType::Boolean { .. }, SchemaPatchValue::Boolean { value }) => {
            Ok(Value::Bool(*value))
        }
        (ConfigFieldType::String { .. }, SchemaPatchValue::String { value }) => {
            Ok(Value::String(value.clone()))
        }
        (ConfigFieldType::Integer { .. }, SchemaPatchValue::Integer { value }) => {
            Ok(Value::Number((*value).into()))
        }
        (ConfigFieldType::Enum { .. }, SchemaPatchValue::Enum { value }) => {
            Ok(Value::String(value.clone()))
        }
        (ConfigFieldType::StringList { .. }, SchemaPatchValue::StringList { value }) => Ok(
            Value::Array(value.iter().cloned().map(Value::String).collect()),
        ),
        (
            ConfigFieldType::Secret { replacement_only },
            SchemaPatchValue::Secret { replacement },
        ) if *replacement_only => Ok(Value::String(replacement.clone())),
        _ => Err(AppError::invalid_input(
            "Schema field value kind does not match its definition.",
        )),
    }?;
    validate_field_value(field, &value).map_err(|message| {
        if matches!(
            field.field_type(),
            ConfigFieldType::String {
                pattern: Some(_),
                ..
            }
        ) {
            AppError::not_supported(message)
        } else {
            AppError::invalid_input(message)
        }
    })?;
    Ok(value)
}

fn validate_field_value(field: &ConfigFieldDefinition, value: &Value) -> Result<(), &'static str> {
    match field.field_type() {
        ConfigFieldType::Boolean { .. } if value.is_boolean() => Ok(()),
        ConfigFieldType::String {
            minimum_length,
            maximum_length,
            pattern,
            ..
        } => {
            if pattern.is_some() {
                return Err("Pattern-constrained schema fields cannot be evaluated reliably.");
            }
            let value = value
                .as_str()
                .ok_or("Schema string value has the wrong type.")?;
            if value.contains('\0')
                || value.len() < usize::from(*minimum_length)
                || value.len() > usize::from(*maximum_length)
            {
                return Err("Schema string value is outside its approved bounds.");
            }
            Ok(())
        }
        ConfigFieldType::Integer {
            minimum, maximum, ..
        } => {
            let value = value
                .as_i64()
                .ok_or("Schema integer value has the wrong type.")?;
            if value < *minimum || value > *maximum {
                return Err("Schema integer value is outside its approved bounds.");
            }
            Ok(())
        }
        ConfigFieldType::Enum { options, .. } => {
            let value = value
                .as_str()
                .ok_or("Schema enum value has the wrong type.")?;
            if !options.iter().any(|option| option.value() == value) {
                return Err("Schema enum value is not approved.");
            }
            Ok(())
        }
        ConfigFieldType::StringList {
            maximum_items,
            maximum_item_length,
            ..
        } => {
            let values = value
                .as_array()
                .ok_or("Schema string-list value has the wrong type.")?;
            if values.len() > usize::from(*maximum_items)
                || values.iter().any(|value| {
                    value.as_str().is_none_or(|value| {
                        value.contains('\0') || value.len() > usize::from(*maximum_item_length)
                    })
                })
            {
                return Err("Schema string-list value is outside its approved bounds.");
            }
            Ok(())
        }
        ConfigFieldType::Secret {
            replacement_only: true,
        } => {
            let replacement = value
                .as_str()
                .ok_or("Secret replacement has the wrong type.")?;
            if replacement.is_empty()
                || replacement.len() > 4096
                || replacement.contains(['\n', '\r', '\0'])
            {
                return Err("Secret replacement is outside its approved bounds.");
            }
            Ok(())
        }
        _ => Err("Schema field value kind does not match its definition."),
    }
}

fn adapt_schema_value(
    adapter_id: &str,
    semantic_key: &str,
    value: Value,
) -> Result<Value, AppError> {
    if adapter_id != "zsh-managed-block"
        || !matches!(semantic_key, "aliases" | "environment")
        || value.is_null()
    {
        return Ok(value);
    }
    let values = value
        .as_array()
        .ok_or_else(|| AppError::invalid_input("Zsh schema value must be a string list."))?;
    values
        .iter()
        .map(|value| {
            let value = value
                .as_str()
                .ok_or_else(|| AppError::invalid_input("Zsh entry must be text."))?;
            let (name, value) = value
                .split_once('=')
                .ok_or_else(|| AppError::invalid_input("Zsh entry must use name=value."))?;
            if name.trim().is_empty() {
                return Err(AppError::invalid_input("Zsh entry name is required."));
            }
            Ok(Value::Object(Map::from_iter([
                ("name".to_owned(), Value::String(name.trim().to_owned())),
                ("value".to_owned(), Value::String(value.to_owned())),
            ])))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn validate_complete_template(
    schema: &ConfigSchemaDefinition,
    preset: &ConfigPresetDefinition,
    patch_values: &HashMap<&str, Value>,
) -> Result<(), AppError> {
    if preset.kind() != ConfigPresetKind::CompleteTemplate
        || preset.target() != PresetTarget::NewFileOnly
        || preset.merge_strategy() != PresetMergeStrategy::ReplaceSchemaProjection
        || preset.schema_id() != schema.schema_id()
        || schema.schema_version() < preset.compatible_schema_versions().minimum()
        || schema.schema_version() > preset.compatible_schema_versions().maximum()
    {
        return Err(AppError::not_supported(
            "Preset is not a compatible complete template.",
        ));
    }
    if patch_values.len() != preset.values().len() {
        return Err(AppError::conflict(
            "Complete template draft no longer matches the approved preset.",
        ));
    }
    for field in preset.values() {
        let definition = schema
            .field(field.field_id())
            .ok_or_else(|| AppError::not_supported("Preset field is unavailable."))?;
        let expected = preset_value_json(field.value());
        validate_field_value(definition, &expected).map_err(AppError::not_supported)?;
        if patch_values.get(field.field_id()) != Some(&expected) {
            return Err(AppError::conflict(
                "Complete template draft no longer matches the approved preset.",
            ));
        }
    }
    Ok(())
}
#[tauri::command]
pub fn list_config_backups(key: ConfigKey) -> Result<Vec<BackupSummary>, AppError> {
    let catalog = builtin_catalog()?;
    let definition = crate::config::resolve_definition(&catalog, &key.app_id, &key.config_id)?;
    if definition.is_read_only() {
        return Ok(Vec::new());
    }
    let environment = ConfigEnvironment::from_environment()?;
    list_backup_records(&environment, &key.app_id, &key.config_id)
}

#[tauri::command]
pub fn preview_restore_backup(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: RestoreBackupInput,
) -> Result<ConfigWritePreview, AppError> {
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &input.app_id, &input.config_id)?;
    let (mutation, prepared) = prepare_restore(&catalog, config.environment()?, input)?;
    let intent = mutation_intent(OperationKind::ConfigurationRestore, &mutation);
    let operation = operations.preview(
        intent,
        &format!(
            "Restore {} configuration {}.",
            mutation.app_id, mutation.config_id
        ),
        vec![
            format!("Authorized catalog document: {}", mutation.config_id),
            "Create a protected backup of the current file.".to_owned(),
            "Restore the selected owned backup atomically.".to_owned(),
        ],
    )?;
    config.remember(operation.operation_id.clone(), mutation)?;
    Ok(ConfigWritePreview {
        operation,
        current_hash: prepared.current_hash,
        proposed_hash: prepared.proposed_hash,
        diff: prepared.diff,
    })
}

#[tauri::command]
pub fn execute_restore_backup(
    config: State<'_, ConfigCoordinator>,
    operations: State<'_, OperationCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    let mutation = config.pending(&operation_id)?;
    let catalog = builtin_catalog()?;
    require_writable_definition(&catalog, &mutation.app_id, &mutation.config_id)?;
    let intent = mutation_intent(OperationKind::ConfigurationRestore, &mutation);
    if let Err(error) = operations.authorize_mutation(&operation_id, &intent) {
        if error.code() == crate::error::AppErrorCode::Timeout {
            config.forget(&operation_id);
        }
        return Err(error);
    }
    operations.record_progress(&operation_id, "Creating protected backup.")?;
    let retention = settings.get()?.preferences().backup_retention();
    let result = execute_restore(&catalog, config.environment()?, &mutation, retention)
        .map(|()| "local-restore".to_owned());
    config.forget(&operation_id);
    match result {
        Ok(audit_id) => {
            operations.record_progress(
                &operation_id,
                &format!("Backup restore verified. Audit ID: {audit_id}"),
            )?;
            operations.finish_success(&operation_id)?;
        }
        Err(error) => {
            operations.finish_failure(&operation_id, error.clone())?;
            return Err(error);
        }
    }
    operations.get(&operation_id)
}

fn require_writable_definition(
    catalog: &crate::catalog::Catalog,
    app_id: &str,
    config_id: &str,
) -> Result<(), AppError> {
    let definition = crate::config::resolve_definition(catalog, app_id, config_id)?;
    if definition.is_read_only() {
        return Err(AppError::not_supported(
            "Configuration document is read-only.",
        ));
    }
    Ok(())
}

pub(crate) fn mutation_intent(
    kind: OperationKind,
    mutation: &PendingConfigMutation,
) -> OperationIntent {
    OperationIntent::new(
        kind,
        format!("{}:{}", mutation.app_id, mutation.config_id),
        BTreeMap::from_iter(
            [
                ("currentHash".to_owned(), mutation.expected_hash.clone()),
                ("proposedHash".to_owned(), mutation.proposed_hash.clone()),
            ]
            .into_iter()
            .chain(
                mutation
                    .mutation_source_id()
                    .map(|source_id| ("sourceId".to_owned(), source_id.to_owned())),
            )
            .chain(
                mutation
                    .variant_id()
                    .map(|variant_id| ("variantId".to_owned(), variant_id.to_owned())),
            ),
        ),
    )
}
