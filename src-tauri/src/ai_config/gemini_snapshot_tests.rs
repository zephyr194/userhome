use crate::ai_config::registry::{
    CoverageStatus, ResourceDefinition, ResourceFormat, ResourceLayer, SettingDefinition,
    ToolDefinition, ValueType,
};
use crate::ai_config::validate::{check_coverage, load_all};

const GEMINI_TOOL_ID: &str = "gemini-cli";
const SCHEMA_URL: &str =
    "https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json";
const SNAPSHOT_DATE: &str = "2026-10-22";
const SETTING_COUNT: usize = 258;
const MAX_KEY_SEGMENTS: usize = 3;

fn gemini_tool() -> ToolDefinition {
    load_all()
        .expect("aggregated definitions validate")
        .tools
        .into_iter()
        .find(|tool| tool.id == GEMINI_TOOL_ID)
        .expect("gemini-cli tool is present")
}

fn setting<'a>(tool: &'a ToolDefinition, key: &str) -> &'a SettingDefinition {
    tool.settings
        .iter()
        .find(|setting| setting.key_path == key)
        .unwrap_or_else(|| panic!("{key} is in the gemini schema snapshot"))
}

fn resource<'a>(tool: &'a ToolDefinition, id: &str) -> &'a ResourceDefinition {
    tool.resources
        .iter()
        .find(|resource| resource.id == id)
        .unwrap_or_else(|| panic!("{id} is declared"))
}

#[test]
fn gemini_definition_loads_once_with_its_executable_and_name() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert_eq!(
        definitions
            .tools
            .iter()
            .filter(|tool| tool.id == GEMINI_TOOL_ID)
            .count(),
        1
    );
    let tool = gemini_tool();
    assert_eq!(tool.display_name, "Gemini CLI");
    assert_eq!(tool.executable_names, ["gemini"]);
}

#[test]
fn every_gemini_setting_is_display_only_and_carries_its_schema_source() {
    let tool = gemini_tool();

    assert_eq!(tool.settings.len(), SETTING_COUNT);
    for item in &tool.settings {
        assert_eq!(item.coverage, CoverageStatus::DisplayOnly, "{}", item.id);
        assert!(item.versions.is_none(), "{}", item.id);
        assert_eq!(item.source.url, SCHEMA_URL, "{}", item.id);
        assert_eq!(item.source.retrieved_on, SNAPSHOT_DATE, "{}", item.id);
        assert_eq!(item.source.documented_version, "unknown", "{}", item.id);
    }
}

#[test]
fn gemini_settings_stop_at_three_key_segments_and_skip_the_meta_key() {
    let tool = gemini_tool();

    for item in &tool.settings {
        assert!(
            item.key_path.split('.').count() <= MAX_KEY_SEGMENTS,
            "{}",
            item.key_path
        );
    }
    assert!(tool.settings.iter().all(|item| item.key_path != "$schema"));
    assert!(
        tool.settings
            .iter()
            .all(|item| !item.key_path.starts_with("hooks."))
    );
}

#[test]
fn risky_and_secret_gemini_settings_are_never_editable() {
    let tool = gemini_tool();

    for item in tool
        .settings
        .iter()
        .filter(|item| item.secret || !item.risks.is_empty())
    {
        assert_ne!(item.coverage, CoverageStatus::Editable, "{}", item.id);
    }
}

#[test]
fn gemini_settings_keep_schema_enums_and_leave_unions_unknown() {
    let tool = gemini_tool();

    let approval = setting(&tool, "general.defaultApprovalMode");
    assert_eq!(approval.value_type, ValueType::Enum);
    assert_eq!(approval.allowed_values, ["default", "auto_edit", "plan"]);
    assert_eq!(
        setting(&tool, "general.vimMode").value_type,
        ValueType::Boolean
    );
    assert_eq!(
        setting(&tool, "policyPaths").value_type,
        ValueType::StringArray
    );
    assert_eq!(setting(&tool, "mcpServers").value_type, ValueType::Object);
    assert_eq!(
        setting(&tool, "context.fileName").value_type,
        ValueType::Unknown
    );
}

#[test]
fn gemini_map_containers_are_listed_without_their_children() {
    let tool = gemini_tool();

    assert_eq!(setting(&tool, "hooks").value_type, ValueType::Object);
    assert_eq!(
        setting(&tool, "ui.customThemes").value_type,
        ValueType::Object
    );
}

#[test]
fn gemini_config_resources_are_json_at_their_layers() {
    let tool = gemini_tool();

    let user = resource(&tool, "gemini-user-settings");
    assert_eq!(user.layer, ResourceLayer::UserLevel);
    assert_eq!(user.format, ResourceFormat::Json);
    let project = resource(&tool, "gemini-project-settings");
    assert_eq!(project.layer, ResourceLayer::ProjectShared);
    assert_eq!(project.format, ResourceFormat::Json);
    let system = resource(&tool, "gemini-system-settings");
    assert_eq!(system.layer, ResourceLayer::Managed);
    assert_eq!(system.format, ResourceFormat::Json);
}

#[test]
fn gemini_credential_and_env_resources_are_metadata_only() {
    let tool = gemini_tool();

    for id in ["gemini-auth-credentials", "gemini-env-file"] {
        let item = resource(&tool, id);
        assert!(item.description.contains("仅元数据"), "{id}");
        assert_ne!(item.coverage, CoverageStatus::Editable, "{id}");
    }
}

#[test]
fn gemini_snapshot_coverage_reports_documented_keys_as_covered() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert!(
        check_coverage(
            &[
                "gemini-cli/setting/general.vimMode",
                "gemini-cli/setting/general.defaultApprovalMode",
                "gemini-cli/resource/gemini-user-settings",
            ],
            &definitions,
        )
        .is_empty()
    );
    assert_eq!(
        check_coverage(&["gemini-cli/setting/notInSchema"], &definitions),
        vec!["gemini-cli/setting/notInSchema".to_owned()]
    );
}
