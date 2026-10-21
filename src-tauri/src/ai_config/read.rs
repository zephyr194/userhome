//! Read-only view of Claude Code settings. Paths come from the definition's location
//! templates; the only per-session input is the project directory, which the caller
//! resolves from a user-granted id. Nothing is enumerated, executed or written, and
//! secret values are masked before they leave this module.

use std::fmt;
use std::path::PathBuf;

use serde::Serialize;
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};

use crate::ai_config::registry::{
    CoverageStatus, Definitions, ResourceLayer, SettingDefinition, ToolDefinition, ValueType,
};
use crate::app_config::discover::{ConfigFs, FsError, NodeKind};
use crate::app_config::read::{REDACTED, is_secret_key};

pub const CLAUDE_TOOL_ID: &str = "claude-code";
pub const MAX_SETTINGS_BYTES: usize = 1024 * 1024;
pub const SIGN_IN_RESOURCE_ID: &str = "claude-sign-in-metadata";
const DUPLICATE_KEY_MARKER: &str = "duplicate key: ";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClaudeLocations {
    pub home: PathBuf,
    pub project: Option<PathBuf>,
    pub managed_dir: Option<PathBuf>,
}

pub fn managed_directory() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(PathBuf::from("/Library/Application Support/ClaudeCode"))
    } else if cfg!(target_os = "linux") {
        Some(PathBuf::from("/etc/claude-code"))
    } else {
        None
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum LayerState {
    Loaded,
    Present,
    Missing,
    NotSelected,
    NotApplicable,
    NotReadable,
    ExistsUnreadable,
    NotRegularFile,
    TooLarge,
    Malformed { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerReport {
    pub id: String,
    pub layer: &'static str,
    pub location: String,
    pub precedence: Option<usize>,
    pub state: LayerState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinedIn {
    pub layer_id: String,
    pub overridden: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingEntry {
    pub key: String,
    pub documented: bool,
    pub value_type: Option<&'static str>,
    pub coverage: Option<&'static str>,
    pub value: Value,
    pub masked: bool,
    pub merged: bool,
    pub winner: Option<String>,
    pub defined_in: Vec<DefinedIn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadWarning {
    pub layer_id: String,
    pub key: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeReadView {
    pub tool_id: String,
    pub layers: Vec<LayerReport>,
    pub entries: Vec<SettingEntry>,
    pub warnings: Vec<ReadWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSnapshotSummary {
    pub tool_id: String,
    pub display_name: String,
    pub source_url: String,
    pub retrieved_on: String,
    pub documented_version: String,
    pub setting_count: usize,
    pub resource_count: usize,
    pub editable: usize,
    pub display_only: usize,
    pub version_unknown: usize,
    pub not_applicable: usize,
    pub unsupported: usize,
    pub unknown_value_type: usize,
}

pub fn claude_tool(definitions: &Definitions) -> Option<&ToolDefinition> {
    definitions
        .tools
        .iter()
        .find(|tool| tool.id == CLAUDE_TOOL_ID)
}

pub fn snapshot_summary(tool: &ToolDefinition) -> ClaudeSnapshotSummary {
    let mut summary = ClaudeSnapshotSummary {
        tool_id: tool.id.clone(),
        display_name: tool.display_name.clone(),
        source_url: tool.source.url.clone(),
        retrieved_on: tool.source.retrieved_on.clone(),
        documented_version: tool.source.documented_version.clone(),
        setting_count: tool.settings.len(),
        resource_count: tool.resources.len(),
        editable: 0,
        display_only: 0,
        version_unknown: 0,
        not_applicable: 0,
        unsupported: 0,
        unknown_value_type: tool
            .settings
            .iter()
            .filter(|setting| setting.value_type == ValueType::Unknown)
            .count(),
    };
    let coverages = tool
        .settings
        .iter()
        .map(|setting| setting.coverage)
        .chain(tool.resources.iter().map(|resource| resource.coverage));
    for coverage in coverages {
        match coverage {
            CoverageStatus::Editable => summary.editable += 1,
            CoverageStatus::DisplayOnly => summary.display_only += 1,
            CoverageStatus::VersionUnknown => summary.version_unknown += 1,
            CoverageStatus::NotApplicable => summary.not_applicable += 1,
            CoverageStatus::Unsupported => summary.unsupported += 1,
        }
    }
    summary
}

enum Gap {
    NotSelected,
    NotApplicable,
}

impl Gap {
    fn state(self) -> LayerState {
        match self {
            Self::NotSelected => LayerState::NotSelected,
            Self::NotApplicable => LayerState::NotApplicable,
        }
    }
}

fn expand_location(template: &str, locations: &ClaudeLocations) -> Result<PathBuf, Gap> {
    let mut expanded = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        expanded.push_str(&rest[..start]);
        let end = rest[start..]
            .find('}')
            .map(|offset| start + offset)
            .ok_or(Gap::NotApplicable)?;
        let base = match &rest[start + 1..end] {
            "home" => locations.home.clone(),
            "project" => locations.project.clone().ok_or(Gap::NotSelected)?,
            "managed" => locations.managed_dir.clone().ok_or(Gap::NotApplicable)?,
            _ => return Err(Gap::NotApplicable),
        };
        expanded.push_str(&base.to_string_lossy());
        rest = &rest[end + 1..];
    }
    expanded.push_str(rest);
    Ok(PathBuf::from(expanded))
}

fn layer_label(layer: ResourceLayer) -> &'static str {
    match layer {
        ResourceLayer::UserLevel => "userLevel",
        ResourceLayer::ProjectShared => "projectShared",
        ResourceLayer::ProjectLocal => "projectLocal",
        ResourceLayer::Managed => "managed",
    }
}

fn coverage_label(coverage: CoverageStatus) -> &'static str {
    match coverage {
        CoverageStatus::Editable => "editable",
        CoverageStatus::DisplayOnly => "displayOnly",
        CoverageStatus::NotApplicable => "notApplicable",
        CoverageStatus::VersionUnknown => "versionUnknown",
        CoverageStatus::Unsupported => "unsupported",
    }
}

fn value_type_label(value_type: ValueType) -> &'static str {
    match value_type {
        ValueType::String => "string",
        ValueType::Boolean => "boolean",
        ValueType::Number => "number",
        ValueType::StringArray => "stringArray",
        ValueType::Object => "object",
        ValueType::Enum => "enum",
        ValueType::Unknown => "unknown",
    }
}

fn type_matches(value_type: ValueType, value: &Value) -> bool {
    match value_type {
        ValueType::String | ValueType::Enum => value.is_string(),
        ValueType::Boolean => value.is_boolean(),
        ValueType::Number => value.is_number(),
        ValueType::StringArray => value.is_array(),
        ValueType::Object => value.is_object(),
        ValueType::Unknown => true,
    }
}

pub fn read_claude_view(
    tool: &ToolDefinition,
    locations: &ClaudeLocations,
    fs: &dyn ConfigFs,
) -> ClaudeReadView {
    let mut layers = Vec::new();
    let mut loaded: Vec<(String, Map<String, Value>)> = Vec::new();
    let mut precedence = 0;
    for resource in &tool.resources {
        let is_sign_in = resource.id == SIGN_IN_RESOURCE_ID;
        let rank = if is_sign_in {
            None
        } else {
            precedence += 1;
            Some(precedence)
        };
        let (state, values) = match expand_location(&resource.location, locations) {
            Ok(path) if is_sign_in => (presence(&path, fs), None),
            Ok(path) => read_settings_file(&path, fs),
            Err(gap) => (gap.state(), None),
        };
        if let Some(values) = values {
            loaded.push((resource.id.clone(), values));
        }
        layers.push(LayerReport {
            id: resource.id.clone(),
            layer: layer_label(resource.layer),
            location: resource.location.clone(),
            precedence: rank,
            state,
        });
    }
    let (entries, warnings) = merge_layers(tool, &loaded);
    ClaudeReadView {
        tool_id: tool.id.clone(),
        layers,
        entries,
        warnings,
    }
}

fn presence(path: &std::path::Path, fs: &dyn ConfigFs) -> LayerState {
    match fs.symlink_metadata(path) {
        Ok(_) => LayerState::Present,
        Err(FsError::NotFound) => LayerState::Missing,
        Err(_) => LayerState::NotReadable,
    }
}

fn read_settings_file(
    path: &std::path::Path,
    fs: &dyn ConfigFs,
) -> (LayerState, Option<Map<String, Value>>) {
    match fs.symlink_metadata(path) {
        Err(FsError::NotFound) => (LayerState::Missing, None),
        Err(_) => (LayerState::NotReadable, None),
        Ok(info) if !matches!(info.kind, NodeKind::File) => (LayerState::NotRegularFile, None),
        Ok(_) => match fs.read_bounded(path, MAX_SETTINGS_BYTES) {
            Ok(bytes) => match parse_settings(&bytes) {
                Ok(map) => (LayerState::Loaded, Some(map)),
                Err(message) => (LayerState::Malformed { message }, None),
            },
            Err(FsError::TooLarge) => (LayerState::TooLarge, None),
            Err(FsError::NotFound) => (LayerState::Missing, None),
            Err(_) => (LayerState::ExistsUnreadable, None),
        },
    }
}

pub fn parse_settings(bytes: &[u8]) -> Result<Map<String, Value>, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "文件不是有效的 UTF-8".to_owned())?;
    let StrictJson(value) =
        serde_json::from_str(text).map_err(|error| describe_parse_error(&error))?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err("顶层不是 JSON 对象".to_owned()),
    }
}

fn describe_parse_error(error: &serde_json::Error) -> String {
    let message = error.to_string();
    match message.strip_prefix(DUPLICATE_KEY_MARKER) {
        Some(rest) => {
            let key = rest.split(" at line ").next().unwrap_or(rest);
            format!("重复键：{key}")
        }
        None => format!(
            "JSON 语法错误（第 {} 行，第 {} 列）",
            error.line(),
            error.column()
        ),
    }
}

struct StrictJson(Value);

impl<'de> Deserialize<'de> for StrictJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(StrictVisitor).map(StrictJson)
    }
}

struct StrictVisitor;

impl<'de> Visitor<'de> for StrictVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("invalid number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_none<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let mut items = Vec::new();
        while let Some(StrictJson(item)) = seq.next_element()? {
            items.push(item);
        }
        Ok(Value::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut object = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            if object.contains_key(&key) {
                return Err(<A::Error as de::Error>::custom(format!(
                    "{DUPLICATE_KEY_MARKER}{key}"
                )));
            }
            let StrictJson(value) = map.next_value()?;
            object.insert(key, value);
        }
        Ok(Value::Object(object))
    }
}

fn lookup<'a>(map: &'a Map<String, Value>, key_path: &str) -> Option<&'a Value> {
    let mut parts = key_path.split('.');
    let mut current = map.get(parts.next()?)?;
    for part in parts {
        current = current.as_object()?.get(part)?;
    }
    Some(current)
}

fn mask_nested(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| {
                    let masked = if is_secret_key(key) {
                        Value::String(REDACTED.to_owned())
                    } else {
                        mask_nested(item)
                    };
                    (key.clone(), masked)
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(mask_nested).collect()),
        other => other.clone(),
    }
}

fn masked_setting_value(setting: &SettingDefinition, value: &Value) -> (Value, bool) {
    let masked = if setting.secret {
        Value::String(REDACTED.to_owned())
    } else {
        mask_nested(value)
    };
    let changed = masked != *value;
    (masked, changed)
}

fn masked_free_value(key: &str, value: &Value) -> (Value, bool) {
    let masked = if is_secret_key(key) {
        Value::String(REDACTED.to_owned())
    } else {
        mask_nested(value)
    };
    let changed = masked != *value;
    (masked, changed)
}

fn merge_layers(
    tool: &ToolDefinition,
    layers: &[(String, Map<String, Value>)],
) -> (Vec<SettingEntry>, Vec<ReadWarning>) {
    let mut entries = Vec::new();
    let mut warnings = Vec::new();
    let documented_keys: Vec<&str> = tool
        .settings
        .iter()
        .map(|setting| setting.key_path.as_str())
        .collect();

    for setting in &tool.settings {
        let defined: Vec<(&str, &Value)> = layers
            .iter()
            .filter_map(|(id, map)| {
                lookup(map, &setting.key_path).map(|value| (id.as_str(), value))
            })
            .collect();
        if defined.is_empty() {
            continue;
        }
        for (layer_id, value) in &defined {
            if !type_matches(setting.value_type, value) {
                warnings.push(ReadWarning {
                    layer_id: (*layer_id).to_owned(),
                    key: setting.key_path.clone(),
                    message: format!(
                        "类型与定义不符（定义为 {}）",
                        value_type_label(setting.value_type)
                    ),
                });
            }
        }
        let merged = setting.value_type == ValueType::StringArray;
        let (raw, winner, defined_in) = if merged {
            let mut union: Vec<Value> = Vec::new();
            for (_, value) in &defined {
                if let Some(items) = value.as_array() {
                    for item in items {
                        if !union.contains(item) {
                            union.push(item.clone());
                        }
                    }
                }
            }
            let defined_in = defined
                .iter()
                .map(|(id, _)| DefinedIn {
                    layer_id: (*id).to_owned(),
                    overridden: false,
                })
                .collect();
            (Value::Array(union), None, defined_in)
        } else {
            let (winner_id, winner_value) = defined[0];
            let defined_in = defined
                .iter()
                .enumerate()
                .map(|(index, (id, _))| DefinedIn {
                    layer_id: (*id).to_owned(),
                    overridden: index > 0,
                })
                .collect();
            (winner_value.clone(), Some(winner_id.to_owned()), defined_in)
        };
        let (value, masked) = masked_setting_value(setting, &raw);
        entries.push(SettingEntry {
            key: setting.key_path.clone(),
            documented: true,
            value_type: Some(value_type_label(setting.value_type)),
            coverage: Some(coverage_label(setting.coverage)),
            value,
            masked,
            merged,
            winner,
            defined_in,
        });
    }

    let mut undocumented: Vec<&str> = layers
        .iter()
        .flat_map(|(_, map)| map.keys().map(String::as_str))
        .filter(|key| !documented_keys.contains(key))
        .collect();
    undocumented.sort_unstable();
    undocumented.dedup();
    for key in undocumented {
        let defined: Vec<(&str, &Value)> = layers
            .iter()
            .filter_map(|(id, map)| map.get(key).map(|value| (id.as_str(), value)))
            .collect();
        let (winner_id, winner_value) = defined[0];
        let (value, masked) = masked_free_value(key, winner_value);
        let defined_in = defined
            .iter()
            .enumerate()
            .map(|(index, (id, _))| DefinedIn {
                layer_id: (*id).to_owned(),
                overridden: index > 0,
            })
            .collect();
        entries.push(SettingEntry {
            key: key.to_owned(),
            documented: false,
            value_type: None,
            coverage: None,
            value,
            masked,
            merged: false,
            winner: Some(winner_id.to_owned()),
            defined_in,
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    (entries, warnings)
}
