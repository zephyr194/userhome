use serde::Deserialize;

pub const DEFINITION_SCHEMA_VERSION: u32 = 1;
pub const BUILTIN_DEFINITIONS_JSON: &str = include_str!("definitions/builtin.json");
pub const CLAUDE_CODE_DEFINITIONS_JSON: &str = include_str!("definitions/claude-code.json");
pub const CODEX_CLI_DEFINITIONS_JSON: &str = include_str!("definitions/codex-cli.json");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    Malformed(String),
    Invalid(Vec<ValidationIssue>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationIssue {
    pub path: String,
    pub kind: IssueKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueKind {
    UnsupportedSchemaVersion,
    DuplicateToolId,
    DuplicateItemId,
    InvalidId,
    EmptyText,
    InvalidSourceUrl,
    InvalidRetrievedOn,
    InvalidDocumentedVersion,
    InvalidLocation,
    InvalidExecutableName,
    MissingVersions,
    EnumWithoutValues,
    UnknownReference,
    SelfReference,
    InvalidEnvName,
    UnverifiedValueType,
    MissingCoverageNote,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definitions {
    pub schema_version: u32,
    pub tools: Vec<ToolDefinition>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolDefinition {
    pub id: String,
    pub display_name: String,
    pub executable_names: Vec<String>,
    pub source: SourceRef,
    pub resources: Vec<ResourceDefinition>,
    pub settings: Vec<SettingDefinition>,
    pub flags: Vec<FlagDefinition>,
    pub env: Vec<EnvDefinition>,
    pub flags_coverage: ListingCoverage,
    pub env_coverage: ListingCoverage,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListingCoverage {
    pub snapshot_complete: bool,
    pub coverage_note: Option<String>,
    pub source: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceRef {
    pub url: String,
    pub retrieved_on: String,
    pub documented_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedVersions {
    pub min: String,
    pub max: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoverageStatus {
    Editable,
    DisplayOnly,
    NotApplicable,
    VersionUnknown,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceLayer {
    UserLevel,
    ProjectShared,
    ProjectLocal,
    Managed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResourceFormat {
    Json,
    Jsonc,
    Toml,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValueType {
    String,
    Boolean,
    Number,
    StringArray,
    Object,
    Enum,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskFlag {
    ExecutesCommand,
    RelaxesPermissions,
    ExternalServer,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceDefinition {
    pub id: String,
    pub layer: ResourceLayer,
    pub format: ResourceFormat,
    pub location: String,
    pub description: String,
    pub coverage: CoverageStatus,
    pub versions: Option<VerifiedVersions>,
    pub source: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingDefinition {
    pub id: String,
    pub key_path: String,
    pub value_type: ValueType,
    pub allowed_values: Vec<String>,
    pub description: String,
    pub default_note: String,
    pub merge_rule: String,
    pub risks: Vec<RiskFlag>,
    pub secret: bool,
    pub coverage: CoverageStatus,
    pub versions: Option<VerifiedVersions>,
    pub source: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlagDefinition {
    pub id: String,
    pub value_type: ValueType,
    pub allowed_values: Vec<String>,
    pub description: String,
    pub single_invocation: bool,
    pub excludes: Vec<String>,
    pub requires: Vec<String>,
    pub risks: Vec<RiskFlag>,
    pub coverage: CoverageStatus,
    pub versions: Option<VerifiedVersions>,
    pub source: SourceRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvDefinition {
    pub name: String,
    pub value_type: ValueType,
    pub allowed_values: Vec<String>,
    pub description: String,
    pub secret: bool,
    pub config_alternative: Option<String>,
    pub excludes: Vec<String>,
    pub requires: Vec<String>,
    pub risks: Vec<RiskFlag>,
    pub coverage: CoverageStatus,
    pub versions: Option<VerifiedVersions>,
    pub source: SourceRef,
}

pub fn parse_definitions(json: &str) -> Result<Definitions, RegistryError> {
    serde_json::from_str(json).map_err(|error| RegistryError::Malformed(error.to_string()))
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
