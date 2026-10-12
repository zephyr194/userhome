use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{error::AppError, security::paths::is_safe_catalog_relative_path};

pub mod read;

pub const PROFILE_SCHEMA_VERSION: u16 = 1;
pub const MAX_PROFILES: usize = 32;
pub const MAX_DOCUMENTS: usize = 16;
pub const MAX_FIELDS: usize = 64;
pub const MAX_CONTENT_BYTES: usize = 256 * 1024;
pub const PROFILE_JSON_SCHEMA: &str = include_str!("app-profile.schema.json");
const COPILOT_PROFILE: &str = include_str!("github-copilot.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationProfile {
    pub schema_version: u16,
    pub app_id: String,
    pub display_name: String,
    pub root: String,
    pub sources: Vec<ProfileSource>,
    pub documents: Vec<DocumentRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileSource {
    pub id: String,
    pub url: String,
    pub git_blob_sha: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentRule {
    pub id: String,
    pub label: String,
    pub description: String,
    pub path: DocumentPath,
    pub format: DocumentFormat,
    pub view_kind: ViewKind,
    pub max_size_bytes: usize,
    pub source_id: String,
    #[serde(default)]
    pub fields: Vec<FieldDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DocumentPath {
    File {
        relative_path: String,
    },
    Collection {
        relative_path: String,
        suffix: String,
    },
}

impl DocumentPath {
    pub fn relative_path(&self) -> &str {
        match self {
            Self::File { relative_path } | Self::Collection { relative_path, .. } => relative_path,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DocumentFormat {
    Json,
    Jsonc,
    Text,
    Metadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ViewKind {
    Fields,
    Text,
    Metadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldDefinition {
    pub field_id: String,
    pub key: String,
    pub label: String,
    pub description: String,
    pub kind: FieldKind,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FieldKind {
    String,
    Boolean,
    Integer,
    Enum,
    StringList,
}

impl FieldDefinition {
    pub fn accepts(&self, value: &Value) -> bool {
        match self.kind {
            FieldKind::String => value.is_string(),
            FieldKind::Boolean => value.is_boolean(),
            FieldKind::Integer => value.as_i64().is_some(),
            FieldKind::Enum => value
                .as_str()
                .is_some_and(|value| self.options.iter().any(|option| option == value)),
            FieldKind::StringList => value
                .as_array()
                .is_some_and(|values| values.iter().all(Value::is_string)),
        }
    }
}

pub fn builtin_profiles() -> Result<Vec<ApplicationProfile>, AppError> {
    let definitions = [COPILOT_PROFILE];
    if definitions.len() > MAX_PROFILES {
        return Err(invalid_profile());
    }
    definitions.into_iter().map(parse_profile).collect()
}

pub fn parse_profile(content: &str) -> Result<ApplicationProfile, AppError> {
    if content.len() > MAX_CONTENT_BYTES {
        return Err(invalid_profile());
    }
    let profile: ApplicationProfile =
        serde_json::from_str(content).map_err(|_| invalid_profile())?;
    let mut source_ids = HashSet::new();
    if profile.schema_version != PROFILE_SCHEMA_VERSION
        || !crate::catalog::is_kebab_case(&profile.app_id)
        || !bounded_text(&profile.display_name)
        || !safe_relative_path(&profile.root)
        || profile.documents.is_empty()
        || profile.documents.len() > MAX_DOCUMENTS
        || profile.sources.is_empty()
        || profile.sources.len() > MAX_DOCUMENTS
        || profile.sources.iter().any(|source| {
            !crate::catalog::is_kebab_case(&source.id)
                || !source_ids.insert(source.id.as_str())
                || !source.url.starts_with("https://")
                || source.url.len() > 2048
                || source.url.chars().any(char::is_control)
                || source.git_blob_sha.len() != 40
                || !source
                    .git_blob_sha
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err(invalid_profile());
    }
    let mut document_ids = HashSet::new();
    let mut paths = HashSet::new();
    for document in &profile.documents {
        if !crate::catalog::is_kebab_case(&document.id)
            || !document_ids.insert(document.id.as_str())
            || !safe_relative_path(document.path.relative_path())
            || !paths.insert(document.path.relative_path())
            || !bounded_text(&document.label)
            || !bounded_text(&document.description)
            || !source_ids.contains(document.source_id.as_str())
            || document.max_size_bytes == 0
            || document.max_size_bytes > MAX_CONTENT_BYTES
            || document.fields.len() > MAX_FIELDS
        {
            return Err(invalid_profile());
        }
        let compatible = match document.view_kind {
            ViewKind::Fields => {
                matches!(
                    document.format,
                    DocumentFormat::Json | DocumentFormat::Jsonc
                ) && matches!(document.path, DocumentPath::File { .. })
                    && !document.fields.is_empty()
            }
            ViewKind::Text => document.format == DocumentFormat::Text && document.fields.is_empty(),
            ViewKind::Metadata => {
                document.format == DocumentFormat::Metadata
                    && document.fields.is_empty()
                    && matches!(document.path, DocumentPath::File { .. })
            }
        };
        if !compatible {
            return Err(invalid_profile());
        }
        if let DocumentPath::Collection { suffix, .. } = &document.path
            && (!suffix.starts_with('.')
                || suffix.len() > 64
                || !safe_relative_path(suffix)
                || suffix.contains('/'))
        {
            return Err(invalid_profile());
        }
        let mut field_ids = HashSet::new();
        let mut keys = HashSet::new();
        for field in &document.fields {
            if !crate::catalog::is_kebab_case(&field.field_id)
                || !field_ids.insert(field.field_id.as_str())
                || !bounded_text(&field.key)
                || !keys.insert(field.key.as_str())
                || crate::config::redaction::is_secret_key(&field.key)
                || !bounded_text(&field.label)
                || !bounded_text(&field.description)
                || field.options.len() > MAX_FIELDS
                || field.options.iter().any(|option| !bounded_text(option))
                || field.options.iter().collect::<HashSet<_>>().len() != field.options.len()
                || match field.kind {
                    FieldKind::Enum => field.options.is_empty(),
                    _ => !field.options.is_empty(),
                }
                || field
                    .default_value
                    .as_ref()
                    .is_some_and(|value| !field.accepts(value))
            {
                return Err(invalid_profile());
            }
        }
    }
    Ok(profile)
}

pub(crate) fn safe_relative_path(path: &str) -> bool {
    path.len() <= 256
        && is_safe_catalog_relative_path(path)
        && !path.contains(['*', '?', '[', ']', '{', '}'])
        && path
            .split('/')
            .all(|component| !matches!(component, "" | "." | ".."))
}

fn bounded_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= 2048 && !value.chars().any(char::is_control)
}

fn invalid_profile() -> AppError {
    AppError::validation_failed("应用配置定义无效。")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn builtin_profile_and_public_schema_have_matching_limits_and_types() {
        let profiles = builtin_profiles().expect("profiles");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].root, ".copilot");
        assert_eq!(profiles[0].documents[0].fields.len(), 9);
        let schema: Value = serde_json::from_str(PROFILE_JSON_SCHEMA).expect("schema");
        assert_eq!(
            schema["properties"]["schemaVersion"]["const"],
            PROFILE_SCHEMA_VERSION
        );
        assert_eq!(schema["properties"]["documents"]["maxItems"], MAX_DOCUMENTS);
        assert_eq!(
            schema["$defs"]["document"]["properties"]["fields"]["maxItems"],
            MAX_FIELDS
        );
        assert_eq!(
            schema["$defs"]["document"]["properties"]["maxSizeBytes"]["maximum"],
            MAX_CONTENT_BYTES
        );
        assert_eq!(
            schema["$defs"]["profileCollection"]["maxItems"],
            MAX_PROFILES
        );
        assert_eq!(
            schema["$defs"]["field"]["properties"]["kind"]["enum"],
            json!(["STRING", "BOOLEAN", "INTEGER", "ENUM", "STRING_LIST"])
        );
    }

    #[test]
    fn rejects_unknown_paths_versions_defaults_and_capability_extensions() {
        let original: Value = serde_json::from_str(COPILOT_PROFILE).expect("json");
        for (key, value) in [
            ("schemaVersion", json!(2)),
            ("root", json!("../.ssh")),
            ("root", json!(".copilot/./instructions")),
            ("command", json!("copilot")),
        ] {
            let mut invalid = original.clone();
            invalid[key] = value;
            assert!(parse_profile(&invalid.to_string()).is_err());
        }
        let mut invalid = original.clone();
        invalid["documents"][0]["fields"][2]["defaultValue"] = json!(true);
        assert!(parse_profile(&invalid.to_string()).is_err());
        invalid = original.clone();
        invalid["documents"][0]["fields"][0]["key"] = json!("apiToken");
        assert!(parse_profile(&invalid.to_string()).is_err());
        invalid = original;
        invalid["documents"][0]["path"]["relativePath"] = json!("/tmp/settings.json");
        assert!(parse_profile(&invalid.to_string()).is_err());
    }
}
