use crate::ai_config::registry::{
    CoverageStatus, ResourceDefinition, ResourceFormat, ResourceLayer, SettingDefinition,
    ToolDefinition, ValueType,
};
use crate::ai_config::validate::{check_coverage, load_all};

const COPILOT_TOOL_ID: &str = "copilot-cli";
const CONFIG_DIR_URL: &str =
    "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference";
const SOURCE_DATE: &str = "2026-10-22";
const SETTING_COUNT: usize = 90;

fn copilot_tool() -> ToolDefinition {
    load_all()
        .expect("aggregated definitions validate")
        .tools
        .into_iter()
        .find(|tool| tool.id == COPILOT_TOOL_ID)
        .expect("copilot-cli tool is present")
}

fn setting<'a>(tool: &'a ToolDefinition, key: &str) -> &'a SettingDefinition {
    tool.settings
        .iter()
        .find(|setting| setting.key_path == key)
        .unwrap_or_else(|| panic!("{key} is in the copilot config docs"))
}

fn resource<'a>(tool: &'a ToolDefinition, id: &str) -> &'a ResourceDefinition {
    tool.resources
        .iter()
        .find(|resource| resource.id == id)
        .unwrap_or_else(|| panic!("{id} is declared"))
}

#[test]
fn copilot_definition_loads_once_with_its_executable_and_name() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert_eq!(
        definitions
            .tools
            .iter()
            .filter(|tool| tool.id == COPILOT_TOOL_ID)
            .count(),
        1
    );
    let tool = copilot_tool();
    assert_eq!(tool.display_name, "GitHub Copilot CLI");
    assert_eq!(tool.executable_names, ["copilot"]);
}

#[test]
fn every_copilot_setting_is_display_only_and_carries_its_docs_source() {
    let tool = copilot_tool();

    assert_eq!(tool.settings.len(), SETTING_COUNT);
    for item in &tool.settings {
        assert_eq!(item.coverage, CoverageStatus::DisplayOnly, "{}", item.id);
        assert!(item.versions.is_none(), "{}", item.id);
        assert_eq!(item.source.url, CONFIG_DIR_URL, "{}", item.id);
        assert_eq!(item.source.retrieved_on, SOURCE_DATE, "{}", item.id);
        assert_eq!(item.source.documented_version, "unknown", "{}", item.id);
    }
}

#[test]
fn risky_and_secret_copilot_settings_are_never_editable() {
    let tool = copilot_tool();

    let restricted: Vec<_> = tool
        .settings
        .iter()
        .filter(|item| item.secret || !item.risks.is_empty())
        .collect();
    assert!(!restricted.is_empty());
    for item in restricted {
        assert_ne!(item.coverage, CoverageStatus::Editable, "{}", item.id);
    }
}

#[test]
fn copilot_settings_take_their_types_only_from_the_docs_table() {
    let tool = copilot_tool();

    let banner = setting(&tool, "banner");
    assert_eq!(banner.value_type, ValueType::Enum);
    assert_eq!(banner.allowed_values, ["always", "once", "never"]);
    assert_eq!(banner.default_note, "文档默认值：\"once\"");

    let effort = setting(&tool, "effortLevel");
    assert_eq!(effort.value_type, ValueType::String);
    assert!(effort.allowed_values.is_empty());
    assert!(
        effort.merge_rule.contains("Replaced"),
        "{}",
        effort.merge_rule
    );

    let auto_tier = setting(&tool, "autoTier");
    assert_eq!(auto_tier.value_type, ValueType::Enum);
    assert_eq!(
        auto_tier.allowed_values,
        ["efficiency", "balance", "intelligence"]
    );

    assert_eq!(setting(&tool, "askUser").value_type, ValueType::Boolean);
    assert_eq!(
        setting(&tool, "powershellFlags").value_type,
        ValueType::StringArray
    );
    assert_eq!(setting(&tool, "hooks").value_type, ValueType::Object);
}

#[test]
fn copilot_settings_do_not_include_keys_the_docs_do_not_list() {
    let tool = copilot_tool();

    assert!(
        tool.settings
            .iter()
            .all(|item| item.key_path != "reasoningEffort")
    );
    assert!(
        tool.settings
            .iter()
            .all(|item| !item.key_path.contains('[') && !item.key_path.contains('"'))
    );
}

#[test]
fn copilot_config_resources_are_json_at_their_layers() {
    let tool = copilot_tool();

    let user = resource(&tool, "copilot-user-settings");
    assert_eq!(user.layer, ResourceLayer::UserLevel);
    assert_eq!(user.format, ResourceFormat::Json);
    let repo = resource(&tool, "copilot-repo-settings");
    assert_eq!(repo.layer, ResourceLayer::ProjectShared);
    assert_eq!(repo.format, ResourceFormat::Json);
    let local = resource(&tool, "copilot-local-settings");
    assert_eq!(local.layer, ResourceLayer::ProjectLocal);
    assert_eq!(local.format, ResourceFormat::Json);
    let managed = resource(&tool, "copilot-managed-settings");
    assert_eq!(managed.layer, ResourceLayer::Managed);
    assert_eq!(managed.format, ResourceFormat::Json);
}

#[test]
fn copilot_internal_state_and_credential_resources_are_metadata_only() {
    let tool = copilot_tool();

    for id in [
        "copilot-config-state",
        "copilot-mcp-oauth-fallback",
        "copilot-mcp-secrets-fallback",
    ] {
        let item = resource(&tool, id);
        assert!(item.description.contains("仅元数据"), "{id}");
        assert_ne!(item.coverage, CoverageStatus::Editable, "{id}");
    }
}

#[test]
fn copilot_snapshot_coverage_reports_documented_keys_as_covered() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert!(
        check_coverage(
            &[
                "copilot-cli/setting/banner",
                "copilot-cli/setting/effortLevel",
                "copilot-cli/resource/copilot-user-settings",
            ],
            &definitions,
        )
        .is_empty()
    );
    assert_eq!(
        check_coverage(&["copilot-cli/setting/reasoningEffort"], &definitions),
        vec!["copilot-cli/setting/reasoningEffort".to_owned()]
    );
}
