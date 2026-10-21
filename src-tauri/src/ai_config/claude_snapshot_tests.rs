use crate::ai_config::registry::{CoverageStatus, ResourceLayer, RiskFlag, ValueType};
use crate::ai_config::validate::{check_coverage, load_all};

const SNAPSHOT_DATE: &str = "2026-10-21";
const SETTINGS_INDEX_URL: &str = "https://code.claude.com/docs/en/settings-reference";
const DOCUMENTED_SETTING_COUNT: usize = 245;

fn claude_tool() -> crate::ai_config::registry::ToolDefinition {
    let definitions = load_all().expect("aggregated definitions validate");
    definitions
        .tools
        .into_iter()
        .find(|tool| tool.id == "claude-code")
        .expect("claude-code tool is present")
}

fn setting<'a>(
    tool: &'a crate::ai_config::registry::ToolDefinition,
    key: &str,
) -> &'a crate::ai_config::registry::SettingDefinition {
    tool.settings
        .iter()
        .find(|setting| setting.key_path == key)
        .unwrap_or_else(|| panic!("{key} is documented in the snapshot"))
}

#[test]
fn aggregated_definitions_contain_the_claude_code_tool_once() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert_eq!(
        definitions
            .tools
            .iter()
            .filter(|tool| tool.id == "claude-code")
            .count(),
        1
    );
}

#[test]
fn claude_definition_records_source_url_and_retrieval_date_for_every_item() {
    let tool = claude_tool();

    assert_eq!(tool.source.retrieved_on, SNAPSHOT_DATE);
    assert_eq!(tool.source.documented_version, "unknown");
    for item in &tool.settings {
        assert_eq!(item.source.url, SETTINGS_INDEX_URL, "{}", item.id);
        assert_eq!(item.source.retrieved_on, SNAPSHOT_DATE, "{}", item.id);
        assert_eq!(item.source.documented_version, "unknown", "{}", item.id);
    }
    for resource in &tool.resources {
        assert_eq!(
            resource.source.retrieved_on, SNAPSHOT_DATE,
            "{}",
            resource.id
        );
    }
}

#[test]
fn nothing_is_editable_until_versions_are_verified() {
    let tool = claude_tool();

    assert!(
        tool.settings
            .iter()
            .all(|item| item.coverage == CoverageStatus::DisplayOnly)
    );
    assert!(
        tool.resources
            .iter()
            .all(|item| item.coverage == CoverageStatus::DisplayOnly)
    );
    assert!(tool.settings.iter().all(|item| item.versions.is_none()));
}

#[test]
fn snapshot_records_every_documented_setting_key_once() {
    let tool = claude_tool();

    assert_eq!(tool.settings.len(), DOCUMENTED_SETTING_COUNT);
    let mut keys: Vec<&str> = tool
        .settings
        .iter()
        .map(|item| item.key_path.as_str())
        .collect();
    keys.sort_unstable();
    keys.dedup();
    assert_eq!(keys.len(), DOCUMENTED_SETTING_COUNT);
}

#[test]
fn undocumented_value_types_stay_unknown_and_display_only() {
    let tool = claude_tool();

    let unknown = tool
        .settings
        .iter()
        .filter(|item| item.value_type == ValueType::Unknown)
        .count();
    assert!(unknown > 0);
    assert_eq!(
        setting(&tool, "fallbackModel").value_type,
        ValueType::Unknown
    );
    assert_eq!(setting(&tool, "hooks").value_type, ValueType::Unknown);
    assert_eq!(
        setting(&tool, "hooks").coverage,
        CoverageStatus::DisplayOnly
    );
}

#[test]
fn stated_value_types_are_recorded_from_the_documentation() {
    let tool = claude_tool();

    assert_eq!(setting(&tool, "model").value_type, ValueType::String);
    assert_eq!(setting(&tool, "fastMode").value_type, ValueType::Boolean);
    assert_eq!(setting(&tool, "permissions").value_type, ValueType::Object);
    assert_eq!(
        setting(&tool, "permissions.allow").value_type,
        ValueType::StringArray
    );
    assert_eq!(setting(&tool, "sandbox").value_type, ValueType::Object);
}

#[test]
fn executing_and_loosening_settings_carry_risk_flags() {
    let tool = claude_tool();

    assert!(
        setting(&tool, "apiKeyHelper")
            .risks
            .contains(&RiskFlag::ExecutesCommand)
    );
    assert!(
        setting(&tool, "statusLine")
            .risks
            .contains(&RiskFlag::ExecutesCommand)
    );
    assert!(
        setting(&tool, "hooks")
            .risks
            .contains(&RiskFlag::ExecutesCommand)
    );
    assert!(
        setting(&tool, "permissions.allow")
            .risks
            .contains(&RiskFlag::RelaxesPermissions)
    );
    assert!(
        setting(&tool, "managedMcpServers")
            .risks
            .contains(&RiskFlag::ExternalServer)
    );
    assert!(setting(&tool, "model").risks.is_empty());
}

#[test]
fn env_block_is_marked_secret_and_removed_keys_say_so() {
    let tool = claude_tool();

    assert!(setting(&tool, "env").secret);
    assert!(!setting(&tool, "model").secret);
    assert!(
        setting(&tool, "taskOutputMaxChars")
            .default_note
            .contains("已移除")
    );
    assert!(
        setting(&tool, "includeCoAuthoredBy")
            .default_note
            .contains("已弃用")
    );
}

#[test]
fn resources_are_in_documented_precedence_order() {
    let tool = claude_tool();
    let layers: Vec<ResourceLayer> = tool
        .resources
        .iter()
        .map(|resource| resource.layer)
        .collect();

    assert_eq!(
        layers,
        vec![
            ResourceLayer::Managed,
            ResourceLayer::ProjectLocal,
            ResourceLayer::ProjectShared,
            ResourceLayer::UserLevel,
            ResourceLayer::UserLevel,
        ]
    );
    assert_eq!(tool.resources[0].id, "claude-managed-settings");
    assert_eq!(
        tool.resources[0].location,
        "{managed}/managed-settings.json"
    );
    assert_eq!(
        tool.resources[1].location,
        "{project}/.claude/settings.local.json"
    );
    assert_eq!(
        tool.resources[2].location,
        "{project}/.claude/settings.json"
    );
    assert_eq!(tool.resources[3].location, "{home}/.claude/settings.json");
}

#[test]
fn sign_in_metadata_is_the_only_home_claude_json_resource() {
    let tool = claude_tool();
    let metadata = tool
        .resources
        .iter()
        .find(|resource| resource.id == "claude-sign-in-metadata")
        .expect("metadata resource is present");

    assert_eq!(metadata.location, "{home}/.claude.json");
    assert!(metadata.description.contains("仅元数据"));
}

#[test]
fn snapshot_coverage_reports_documented_keys_as_covered() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert!(
        check_coverage(
            &[
                "claude-code/setting/model",
                "claude-code/setting/permissions.allow",
                "claude-code/resource/claude-user-settings",
            ],
            &definitions,
        )
        .is_empty()
    );
}

#[test]
fn snapshot_coverage_reports_undocumented_keys_as_missing() {
    let definitions = load_all().expect("aggregated definitions validate");

    assert_eq!(
        check_coverage(&["claude-code/setting/notDocumented"], &definitions),
        vec!["claude-code/setting/notDocumented".to_owned()]
    );
}

fn claude_value() -> serde_json::Value {
    serde_json::from_str(crate::ai_config::registry::CLAUDE_CODE_DEFINITIONS_JSON)
        .expect("claude definition is valid JSON")
}

fn issue_kinds_of(value: &serde_json::Value) -> Vec<crate::ai_config::registry::IssueKind> {
    match crate::ai_config::validate::load_validated(&value.to_string()) {
        Err(crate::ai_config::registry::RegistryError::Invalid(issues)) => {
            issues.into_iter().map(|issue| issue.kind).collect()
        }
        other => panic!("expected validation issues, got {other:?}"),
    }
}

#[test]
fn managed_location_placeholder_is_accepted() {
    let mut value = claude_value();
    value["tools"][0]["resources"][0]["location"] =
        serde_json::json!("{managed}/managed-settings.json");

    assert!(crate::ai_config::validate::load_validated(&value.to_string()).is_ok());
}

#[test]
fn unknown_value_type_can_never_be_editable() {
    let mut value = claude_value();
    let hooks = value["tools"][0]["settings"]
        .as_array_mut()
        .expect("settings is an array")
        .iter_mut()
        .find(|item| item["keyPath"] == "hooks")
        .expect("hooks is documented");
    hooks["coverage"] = serde_json::json!("editable");
    hooks["versions"] = serde_json::json!({"min": "1.0.0", "max": "2.0.0"});

    assert_eq!(
        issue_kinds_of(&value),
        vec![crate::ai_config::registry::IssueKind::UnverifiedValueType]
    );
}

#[test]
fn unknown_value_type_may_be_display_only_or_version_unknown() {
    let mut value = claude_value();
    let hooks = value["tools"][0]["settings"]
        .as_array_mut()
        .expect("settings is an array")
        .iter_mut()
        .find(|item| item["keyPath"] == "hooks")
        .expect("hooks is documented");
    hooks["coverage"] = serde_json::json!("versionUnknown");

    assert!(crate::ai_config::validate::load_validated(&value.to_string()).is_ok());
}
