use std::collections::BTreeSet;

use crate::ai_config::registry::{
    CoverageStatus, ResourceLayer, RiskFlag, ValueType, VerifiedVersions,
};
use crate::ai_config::validate::{check_coverage, load_all};
use crate::ai_config::write::{
    EditAction, EditGate, EditRefusal, EditRequest, apply_edit, edit_gate,
};

const SNAPSHOT_DATE: &str = "2026-10-21";
const SETTINGS_INDEX_URL: &str = "https://code.claude.com/docs/en/settings-reference";
const DOCUMENTED_SETTING_COUNT: usize = 245;
const EDITABLE_POLICY_JSON: &str = include_str!("definitions/sources/claude-editable-keys.json");

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

fn editable_policy_keys() -> BTreeSet<String> {
    let policy: serde_json::Value =
        serde_json::from_str(EDITABLE_POLICY_JSON).expect("editable key policy parses");
    policy["keys"]
        .as_array()
        .expect("keys is an array")
        .iter()
        .map(|key| key.as_str().expect("key is a string").to_owned())
        .collect()
}

#[test]
fn only_the_verified_scalar_keys_are_editable_at_the_single_verified_version() {
    let tool = claude_tool();
    let keys = editable_policy_keys();
    let editable: BTreeSet<String> = tool
        .settings
        .iter()
        .filter(|item| item.coverage == CoverageStatus::Editable)
        .map(|item| item.key_path.clone())
        .collect();

    assert_eq!(keys.len(), 58);
    assert_eq!(editable, keys);
    for item in &tool.settings {
        if keys.contains(&item.key_path) {
            assert_eq!(
                item.versions,
                Some(VerifiedVersions {
                    min: "2.1.287".to_owned(),
                    max: "2.1.287".to_owned(),
                }),
                "{}",
                item.key_path
            );
        } else {
            assert_eq!(
                item.coverage,
                CoverageStatus::DisplayOnly,
                "{}",
                item.key_path
            );
            assert!(item.versions.is_none(), "{}", item.key_path);
        }
    }
    assert!(
        tool.resources
            .iter()
            .all(|item| item.coverage == CoverageStatus::DisplayOnly)
    );
}

#[test]
fn editable_keys_open_only_at_the_verified_version() {
    let tool = claude_tool();
    for key in editable_policy_keys() {
        let versions = setting(&tool, &key).versions.as_ref();

        assert_eq!(
            edit_gate(versions, Some("2.1.287")),
            EditGate::Open,
            "{key}"
        );
        assert_eq!(
            edit_gate(versions, Some("2.1.286")),
            EditGate::OutOfRange,
            "{key}"
        );
        assert_eq!(
            edit_gate(versions, Some("2.1.288")),
            EditGate::OutOfRange,
            "{key}"
        );
        assert_eq!(edit_gate(versions, None), EditGate::VersionUnknown, "{key}");
        assert_eq!(
            edit_gate(versions, Some("abc")),
            EditGate::VersionUnknown,
            "{key}"
        );
    }
}

#[test]
fn keys_outside_the_verified_list_are_not_editable() {
    let tool = claude_tool();
    let keys = editable_policy_keys();
    for item in tool
        .settings
        .iter()
        .filter(|item| !keys.contains(&item.key_path))
    {
        let request = EditRequest {
            key_path: item.key_path.clone(),
            action: EditAction::SetValue(serde_json::json!(true)),
        };

        assert!(
            matches!(
                apply_edit("{}", &tool, &request),
                Err(EditRefusal::NotEditable(_))
            ),
            "{}",
            item.key_path
        );
    }
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

#[test]
fn flag_and_env_listings_are_marked_incomplete_with_lower_bound_notes() {
    let tool = claude_tool();

    assert!(!tool.flags_coverage.snapshot_complete);
    assert!(!tool.env_coverage.snapshot_complete);
    let flags_note = tool
        .flags_coverage
        .coverage_note
        .as_deref()
        .expect("flags listing has a note");
    let env_note = tool
        .env_coverage
        .coverage_note
        .as_deref()
        .expect("env listing has a note");
    assert!(env_note.contains("230 项以上"));
    assert!(flags_note.contains("未收录"));
    assert!(env_note.contains("未收录"));
}

#[test]
fn listing_notes_state_the_counts_of_the_listed_arrays() {
    let tool = claude_tool();
    let flags_note = tool
        .flags_coverage
        .coverage_note
        .as_deref()
        .expect("flags listing has a note");
    let env_note = tool
        .env_coverage
        .coverage_note
        .as_deref()
        .expect("env listing has a note");

    assert!(flags_note.contains(&format!("仅收录 {} 项", tool.flags.len())));
    assert!(env_note.contains(&format!("仅收录 {} 项", tool.env.len())));
}

#[test]
fn listing_sources_point_at_the_flag_and_env_reference_pages() {
    let tool = claude_tool();

    assert_eq!(
        tool.flags_coverage.source.url,
        "https://code.claude.com/docs/en/cli-reference"
    );
    assert_eq!(
        tool.env_coverage.source.url,
        "https://code.claude.com/docs/en/env-vars"
    );
    assert_eq!(tool.flags_coverage.source.retrieved_on, SNAPSHOT_DATE);
    assert_eq!(tool.env_coverage.source.retrieved_on, SNAPSHOT_DATE);
}
