//! Read-only official settings reference. It projects the versioned definitions
//! for tools without an editing surface: no user file is read and no process runs.

use serde::Serialize;

use super::read::{CLAUDE_TOOL_ID, coverage_label, value_type_label};
use super::registry::{
    ListingCoverage, ResourceDefinition, ResourceFormat, ResourceLayer, RiskFlag,
    SettingDefinition, SourceRef, ToolDefinition,
};

pub const REFERENCE_TOOL_IDS: [&str; 4] =
    [CLAUDE_TOOL_ID, "codex-cli", "gemini-cli", "copilot-cli"];
const MAX_REFERENCE_TEXT_CHARS: usize = 600;
const METADATA_ONLY_MARKERS: [&str; 5] = ["auth", "oauth", "credential", "secret", "sign-in"];

pub fn is_reference_tool_id(tool_id: &str) -> bool {
    REFERENCE_TOOL_IDS.contains(&tool_id)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolReference {
    pub tool_id: String,
    pub display_name: String,
    pub source: ReferenceSource,
    pub notices: Vec<String>,
    pub resources: Vec<ReferenceResource>,
    pub settings: Vec<ReferenceSetting>,
    pub flags_coverage: ReferenceListing,
    pub env_coverage: ReferenceListing,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSource {
    pub url: String,
    pub retrieved_on: String,
    pub documented_version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceResource {
    pub id: String,
    pub layer: &'static str,
    pub format: &'static str,
    pub location: String,
    pub coverage: &'static str,
    pub description: String,
    pub description_truncated: bool,
    pub metadata_only: bool,
    pub source_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceSetting {
    pub id: String,
    pub key_path: String,
    pub value_type: &'static str,
    pub allowed_values: Vec<String>,
    pub description: String,
    pub description_truncated: bool,
    pub default_note: String,
    pub default_note_truncated: bool,
    pub coverage: &'static str,
    pub risks: Vec<&'static str>,
    pub secret: bool,
    pub source_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceListing {
    pub snapshot_complete: bool,
    pub coverage_note: Option<String>,
    pub coverage_note_truncated: bool,
    pub source_url: String,
}

pub fn tool_reference(tool: &ToolDefinition) -> ToolReference {
    ToolReference {
        tool_id: tool.id.clone(),
        display_name: tool.display_name.clone(),
        source: source_item(&tool.source),
        notices: tool.notices.clone(),
        resources: tool.resources.iter().map(resource_item).collect(),
        settings: tool.settings.iter().map(setting_item).collect(),
        flags_coverage: listing_item(&tool.flags_coverage),
        env_coverage: listing_item(&tool.env_coverage),
    }
}

fn source_item(source: &SourceRef) -> ReferenceSource {
    ReferenceSource {
        url: source.url.clone(),
        retrieved_on: source.retrieved_on.clone(),
        documented_version: source.documented_version.clone(),
    }
}

fn resource_item(resource: &ResourceDefinition) -> ReferenceResource {
    let (description, description_truncated) = bounded_text(&resource.description);
    ReferenceResource {
        id: resource.id.clone(),
        layer: layer_label(resource.layer),
        format: format_label(resource.format),
        location: resource.location.clone(),
        coverage: coverage_label(resource.coverage),
        description,
        description_truncated,
        metadata_only: is_metadata_only(&resource.id),
        source_url: resource.source.url.clone(),
    }
}

fn setting_item(setting: &SettingDefinition) -> ReferenceSetting {
    let (description, description_truncated) = bounded_text(&setting.description);
    let (default_note, default_note_truncated) = bounded_text(&setting.default_note);
    ReferenceSetting {
        id: setting.id.clone(),
        key_path: setting.key_path.clone(),
        value_type: value_type_label(setting.value_type),
        allowed_values: setting.allowed_values.clone(),
        description,
        description_truncated,
        default_note,
        default_note_truncated,
        coverage: coverage_label(setting.coverage),
        risks: setting.risks.iter().copied().map(risk_label).collect(),
        secret: setting.secret,
        source_url: setting.source.url.clone(),
    }
}

fn listing_item(listing: &ListingCoverage) -> ReferenceListing {
    let (coverage_note, coverage_note_truncated) = match &listing.coverage_note {
        Some(note) => {
            let (text, truncated) = bounded_text(note);
            (Some(text), truncated)
        }
        None => (None, false),
    };
    ReferenceListing {
        snapshot_complete: listing.snapshot_complete,
        coverage_note,
        coverage_note_truncated,
        source_url: listing.source.url.clone(),
    }
}

fn is_metadata_only(resource_id: &str) -> bool {
    METADATA_ONLY_MARKERS
        .iter()
        .any(|marker| resource_id.contains(marker))
}

fn bounded_text(text: &str) -> (String, bool) {
    match text.char_indices().nth(MAX_REFERENCE_TEXT_CHARS) {
        Some((index, _)) => (text[..index].to_owned(), true),
        None => (text.to_owned(), false),
    }
}

fn layer_label(layer: ResourceLayer) -> &'static str {
    match layer {
        ResourceLayer::UserLevel => "userLevel",
        ResourceLayer::ProjectShared => "projectShared",
        ResourceLayer::ProjectLocal => "projectLocal",
        ResourceLayer::Managed => "managed",
    }
}

fn format_label(format: ResourceFormat) -> &'static str {
    match format {
        ResourceFormat::Json => "json",
        ResourceFormat::Jsonc => "jsonc",
        ResourceFormat::Toml => "toml",
        ResourceFormat::Text => "text",
    }
}

fn risk_label(risk: RiskFlag) -> &'static str {
    match risk {
        RiskFlag::ExecutesCommand => "executesCommand",
        RiskFlag::RelaxesPermissions => "relaxesPermissions",
        RiskFlag::ExternalServer => "externalServer",
    }
}

#[cfg(test)]
#[path = "reference_tests.rs"]
mod tests;
