use crate::ai_config::registry::{
    CoverageStatus, ResourceDefinition, ResourceFormat, ResourceLayer, SettingDefinition,
    ToolDefinition, ValueType,
};
use crate::ai_config::validate::{check_coverage, load_all};

const CODEX_TOOL_ID: &str = "codex-cli";
const SCHEMA_URL: &str = "https://developers.openai.com/codex/config-schema.json";
const SNAPSHOT_DATE: &str = "2026-10-22";
const SNAPSHOT_TOP_LEVEL_COUNT: usize = 103;

fn codex_tool() -> ToolDefinition {
    load_all()
        .expect("aggregated definitions validate")
        .tools
        .into_iter()
        .find(|tool| tool.id == CODEX_TOOL_ID)
        .expect("codex-cli tool is present")
}

fn setting<'a>(tool: &'a ToolDefinition, key: &str) -> &'a SettingDefinition {
    tool.settings
        .iter()
        .find(|setting| setting.key_path == key)
        .unwrap_or_else(|| panic!("{key} is in the codex schema snapshot"))
}

fn resource<'a>(tool: &'a ToolDefinition, id: &str) -> &'a ResourceDefinition {
    tool.resources
        .iter()
        .find(|resource| resource.id == id)
        .unwrap_or_else(|| panic!("{id} is declared"))
}

#[test]
fn codex_definition_loads_once_with_its_executable_and_name() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert_eq!(
        definitions
            .tools
            .iter()
            .filter(|tool| tool.id == CODEX_TOOL_ID)
            .count(),
        1
    );
    let tool = codex_tool();
    assert_eq!(tool.display_name, "OpenAI Codex CLI");
    assert_eq!(tool.executable_names, ["codex"]);
}

#[test]
fn every_codex_setting_is_display_only_and_carries_its_schema_source() {
    let tool = codex_tool();

    assert_eq!(tool.settings.len(), SNAPSHOT_TOP_LEVEL_COUNT);
    for item in &tool.settings {
        assert_eq!(item.coverage, CoverageStatus::DisplayOnly, "{}", item.id);
        assert!(item.versions.is_none(), "{}", item.id);
        assert_eq!(item.source.url, SCHEMA_URL, "{}", item.id);
        assert_eq!(item.source.retrieved_on, SNAPSHOT_DATE, "{}", item.id);
        assert_eq!(item.source.documented_version, "unknown", "{}", item.id);
    }
}

#[test]
fn risky_and_secret_codex_settings_are_never_editable() {
    let tool = codex_tool();

    for item in tool
        .settings
        .iter()
        .filter(|item| item.secret || !item.risks.is_empty())
    {
        assert_ne!(item.coverage, CoverageStatus::Editable, "{}", item.id);
    }
}

#[test]
fn codex_settings_keep_schema_enums_and_leave_unions_unknown() {
    let tool = codex_tool();

    let sandbox = setting(&tool, "sandbox_mode");
    assert_eq!(sandbox.value_type, ValueType::Enum);
    assert_eq!(
        sandbox.allowed_values,
        ["read-only", "workspace-write", "danger-full-access"]
    );
    assert_eq!(setting(&tool, "model").value_type, ValueType::String);
    assert_eq!(
        setting(&tool, "approval_policy").value_type,
        ValueType::Unknown
    );
}

#[test]
fn codex_config_resources_are_toml_at_their_layers() {
    let tool = codex_tool();

    let user = resource(&tool, "codex-user-config");
    assert_eq!(user.layer, ResourceLayer::UserLevel);
    assert_eq!(user.format, ResourceFormat::Toml);
    let project = resource(&tool, "codex-project-config");
    assert_eq!(project.layer, ResourceLayer::ProjectShared);
    assert_eq!(project.format, ResourceFormat::Toml);
    let managed = resource(&tool, "codex-managed-config");
    assert_eq!(managed.layer, ResourceLayer::Managed);
    assert_eq!(managed.format, ResourceFormat::Toml);
}

#[test]
fn codex_credential_resources_are_metadata_only() {
    let tool = codex_tool();

    for id in ["codex-auth-credentials", "codex-mcp-oauth-credentials"] {
        let item = resource(&tool, id);
        assert!(item.description.contains("仅元数据"), "{id}");
        assert_ne!(item.coverage, CoverageStatus::Editable, "{id}");
    }
}

#[test]
fn codex_snapshot_coverage_reports_documented_keys_as_covered() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert!(
        check_coverage(
            &[
                "codex-cli/setting/model",
                "codex-cli/setting/sandbox_mode",
                "codex-cli/resource/codex-user-config",
            ],
            &definitions,
        )
        .is_empty()
    );
    assert_eq!(
        check_coverage(&["codex-cli/setting/notInSchema"], &definitions),
        vec!["codex-cli/setting/notInSchema".to_owned()]
    );
}
