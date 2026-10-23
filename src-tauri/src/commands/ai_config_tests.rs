use serde_json::{Value, json};

use super::{
    AiBrewUpgradeOutcome, BrewUpgradeStatus, brew_failure_message, brew_outcome, catalog_item,
    edit_status, key_diff, output_tail, value_at,
};
use crate::{
    ai_config::{
        detect::profile_for_tool_id,
        registry::{SettingDefinition, ToolDefinition, VerifiedVersions, parse_definitions},
    },
    brew::client::BrewClientError,
};

const SOURCE_URL: &str = "https://code.claude.com/docs/en/settings-reference";

fn setting(key: &str, value_type: &str, coverage: &str, secret: bool, risks: &[&str]) -> Value {
    let versions = match coverage {
        "editable" => json!({"min": "1.0.0", "max": "1.5.0"}),
        _ => Value::Null,
    };
    json!({
        "id": key,
        "keyPath": key,
        "valueType": value_type,
        "allowedValues": [],
        "description": "fixture",
        "defaultNote": "fixture",
        "mergeRule": "fixture",
        "risks": risks,
        "secret": secret,
        "coverage": coverage,
        "versions": versions,
        "source": {"url": SOURCE_URL, "retrievedOn": "2026-10-21", "documentedVersion": "unknown"}
    })
}

fn tool() -> ToolDefinition {
    let mut settings = vec![
        setting("editableKey", "boolean", "editable", false, &[]),
        setting("displayed", "boolean", "displayOnly", false, &[]),
        setting("unknownTyped", "unknown", "displayOnly", false, &[]),
        setting("secretKey", "string", "editable", true, &[]),
        setting(
            "riskyKey",
            "boolean",
            "editable",
            false,
            &["executesCommand"],
        ),
        setting("unversioned", "boolean", "editable", false, &[]),
    ];
    settings[5]["versions"] = Value::Null;
    let document = json!({
        "schemaVersion": 1,
        "tools": [{
            "id": "claude-code",
            "displayName": "Claude Code",
            "executableNames": ["claude"],
            "source": {"url": SOURCE_URL, "retrievedOn": "2026-10-21", "documentedVersion": "unknown"},
            "resources": [],
            "settings": settings,
            "flags": [],
            "env": [],
            "flagsCoverage": {"snapshotComplete": true, "source": {"url": SOURCE_URL, "retrievedOn": "2026-10-21", "documentedVersion": "unknown"}},
            "envCoverage": {"snapshotComplete": true, "source": {"url": SOURCE_URL, "retrievedOn": "2026-10-21", "documentedVersion": "unknown"}}
        }]
    });
    parse_definitions(&document.to_string())
        .expect("fixture definitions parse")
        .tools
        .remove(0)
}

fn find<'a>(tool: &'a ToolDefinition, key: &str) -> &'a SettingDefinition {
    tool.settings
        .iter()
        .find(|setting| setting.key_path == key)
        .expect("fixture key exists")
}

#[test]
fn editable_key_with_verified_range_is_editable_inside_the_range() {
    let tool = tool();

    assert_eq!(
        edit_status(find(&tool, "editableKey"), Some("1.2.0")),
        (true, None)
    );
}

#[test]
fn secret_and_risky_keys_are_never_editable_whatever_the_version() {
    let tool = tool();

    assert_eq!(
        edit_status(find(&tool, "secretKey"), Some("1.2.0")),
        (false, Some("敏感键，本批不开放编辑"))
    );
    assert_eq!(
        edit_status(find(&tool, "riskyKey"), Some("1.2.0")),
        (false, Some("风险设置，本批不开放编辑"))
    );
}

#[test]
fn display_only_keys_say_whether_their_type_is_unverified() {
    let tool = tool();

    assert_eq!(
        edit_status(find(&tool, "displayed"), Some("1.2.0")),
        (false, Some("仅展示，版本未核实"))
    );
    assert_eq!(
        edit_status(find(&tool, "unknownTyped"), Some("1.2.0")),
        (false, Some("类型未核实，仅展示"))
    );
}

#[test]
fn editable_key_without_a_verified_range_names_the_missing_range() {
    let tool = tool();

    assert_eq!(
        edit_status(find(&tool, "unversioned"), Some("1.2.0")),
        (false, Some("版本未确认，写入已禁用：尚无已验证的版本区间"))
    );
}

#[test]
fn gate_reasons_distinguish_an_undetected_version_from_an_out_of_range_one() {
    let tool = tool();
    let key = find(&tool, "editableKey");

    assert_eq!(
        edit_status(key, None),
        (false, Some("版本未确认，写入已禁用：未能检测本机版本"))
    );
    assert_eq!(
        edit_status(key, Some("2.0.0")),
        (
            false,
            Some("版本未确认，写入已禁用：本机版本不在已验证区间内")
        )
    );
}

#[test]
fn catalog_item_carries_the_value_type_label_and_the_same_editability() {
    let tool = tool();
    let item = catalog_item(find(&tool, "editableKey"), Some("1.2.0"));

    assert_eq!(item.key_path, "editableKey");
    assert_eq!(item.value_type, "boolean");
    assert!(item.editable);
    assert_eq!(item.reason, None);
}

#[test]
fn value_at_walks_dotted_paths_and_reports_absent_ones() {
    let root = json!({"outer": {"inner": true}, "flat": "x"});

    assert_eq!(value_at(&root, "outer.inner"), Some(&json!(true)));
    assert_eq!(value_at(&root, "flat"), Some(&json!("x")));
    assert_eq!(value_at(&root, "outer.missing"), None);
    assert_eq!(value_at(&root, "flat.deeper"), None);
}

#[test]
fn diff_shows_the_removed_and_added_key_only() {
    let changed = key_diff("effortLevel", Some(&json!("low")), Some(&json!("high")));
    let lines = serde_json::to_value(&changed).expect("diff serializes");

    assert_eq!(lines["redacted"], json!(false));
    assert_eq!(
        lines["lines"],
        json!([
            {"kind": "REMOVED", "text": "\"effortLevel\": \"low\""},
            {"kind": "ADDED", "text": "\"effortLevel\": \"high\""}
        ])
    );
}

#[test]
fn diff_for_a_restored_default_has_only_the_removed_line_and_for_a_new_key_only_the_added_one() {
    let restored = serde_json::to_value(key_diff("effortLevel", Some(&json!("low")), None))
        .expect("diff serializes");
    let created = serde_json::to_value(key_diff("effortLevel", None, Some(&json!("high"))))
        .expect("diff serializes");

    assert_eq!(
        restored["lines"],
        json!([{"kind": "REMOVED", "text": "\"effortLevel\": \"low\""}])
    );
    assert_eq!(
        created["lines"],
        json!([{"kind": "ADDED", "text": "\"effortLevel\": \"high\""}])
    );
}

#[test]
fn diff_label_is_the_last_segment_of_a_dotted_key() {
    let changed = serde_json::to_value(key_diff("outer.inner", None, Some(&json!(true))))
        .expect("diff serializes");

    assert_eq!(
        changed["lines"],
        json!([{"kind": "ADDED", "text": "\"inner\": true"}])
    );
}

#[test]
fn catalog_item_carries_the_official_description_default_and_source_as_read_only_text() {
    let tool = tool();
    let item = catalog_item(find(&tool, "editableKey"), Some("1.2.0"));
    let wire = serde_json::to_value(&item).expect("item serializes");

    assert_eq!(item.description, "fixture");
    assert!(!item.description_truncated);
    assert_eq!(item.default_note, "fixture");
    assert_eq!(item.source_url, SOURCE_URL);
    assert_eq!(item.source_retrieved_on, "2026-10-21");
    assert_eq!(item.verified_version.as_deref(), Some("1.0.0 至 1.5.0"));
    let mut keys: Vec<&str> = wire
        .as_object()
        .expect("item is an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "allowedValues",
            "defaultNote",
            "description",
            "descriptionTruncated",
            "editable",
            "keyPath",
            "reason",
            "sourceRetrievedOn",
            "sourceUrl",
            "valueType",
            "verifiedVersion",
        ]
    );
}

#[test]
fn verified_version_is_the_single_version_when_the_range_is_exact() {
    let tool = tool();
    let mut setting = find(&tool, "editableKey").clone();
    setting.versions = Some(VerifiedVersions {
        min: "2.1.287".to_owned(),
        max: "2.1.287".to_owned(),
    });
    let item = catalog_item(&setting, Some("2.1.287"));

    assert_eq!(item.verified_version.as_deref(), Some("2.1.287"));
    assert_eq!(
        serde_json::to_value(&item).expect("item serializes")["verifiedVersion"],
        json!("2.1.287")
    );
}

#[test]
fn verified_version_is_null_for_a_setting_without_a_verified_range() {
    let tool = tool();
    let item = catalog_item(find(&tool, "displayed"), None);

    assert_eq!(item.verified_version, None);
    assert_eq!(
        serde_json::to_value(&item).expect("item serializes")["verifiedVersion"],
        Value::Null
    );
}

#[test]
fn description_longer_than_the_catalog_limit_is_cut_at_a_character_boundary_and_flagged() {
    let tool = tool();
    let mut setting = find(&tool, "editableKey").clone();
    setting.description = "界".repeat(250);
    let item = catalog_item(&setting, Some("1.2.0"));

    assert_eq!(item.description.chars().count(), 200);
    assert!(item.description.chars().all(|character| character == '界'));
    assert!(item.description_truncated);
}

#[test]
fn description_at_exactly_the_catalog_limit_is_kept_whole_and_not_flagged() {
    let tool = tool();
    let mut setting = find(&tool, "editableKey").clone();
    setting.description = "a".repeat(200);
    let item = catalog_item(&setting, Some("1.2.0"));

    assert_eq!(item.description, "a".repeat(200));
    assert!(!item.description_truncated);
}

#[test]
fn upgrade_accepts_only_the_four_ai_tool_ids() {
    for id in ["claude-code", "codex-cli", "gemini-cli", "copilot-cli"] {
        assert!(profile_for_tool_id(id).is_some(), "{id}");
    }
    for id in ["", "--formula", "claude", "brew", "claude-code;whoami"] {
        assert!(profile_for_tool_id(id).is_none(), "{id}");
    }
}

#[test]
fn upgrade_reports_upgraded_only_when_the_version_changed() {
    assert_eq!(
        brew_outcome(Some("1.0.0"), Some("1.1.0")),
        AiBrewUpgradeOutcome {
            status: BrewUpgradeStatus::Upgraded,
            message: "已更新到 1.1.0。".to_owned(),
            new_version: Some("1.1.0".to_owned()),
        }
    );
    assert_eq!(
        brew_outcome(Some("1.1.0"), Some("1.1.0")),
        AiBrewUpgradeOutcome {
            status: BrewUpgradeStatus::AlreadyCurrent,
            message: "已是最新版本（1.1.0）。".to_owned(),
            new_version: Some("1.1.0".to_owned()),
        }
    );
}

#[test]
fn upgrade_does_not_claim_success_when_the_new_version_is_unreadable() {
    let outcome = brew_outcome(Some("1.0.0"), None);

    assert_eq!(outcome.status, BrewUpgradeStatus::Failed);
    assert_eq!(outcome.new_version, None);
}

#[test]
fn upgrade_output_tail_is_bounded_and_drops_escapes_and_secret_lines() {
    let noisy = format!(
        "{}\n\u{1b}[31mdone\u{1b}[0m\nHOMEBREW_GITHUB_API_TOKEN=abc123secret",
        "x".repeat(5000)
    );

    let tail = output_tail(&noisy);

    assert!(tail.len() <= 2 * 1024, "{}", tail.len());
    assert!(!tail.contains('\u{1b}'));
    assert!(tail.contains("done"));
    assert!(!tail.contains("abc123secret"));
}

#[test]
fn upgrade_output_tail_cuts_on_a_character_boundary() {
    let tail = output_tail(&"中".repeat(2000));

    assert!(tail.len() <= 2 * 1024);
    assert!(tail.chars().all(|character| character == '中'));
}

#[test]
fn upgrade_failure_message_names_the_package_and_the_next_step() {
    let message = brew_failure_message(
        &BrewClientError::ProcessFailed {
            code: Some(1),
            stdout: String::new(),
            stderr: "Error: claude-code download failed".to_owned(),
        },
        "claude-code",
    );

    assert!(message.contains("claude-code"));
    assert!(message.contains("退出码 1"));
    assert!(message.contains("download failed"));
    assert!(message.contains("可稍后重试"));
}

#[test]
fn upgrade_timeout_message_says_the_update_stopped_waiting() {
    let message = brew_failure_message(&BrewClientError::Timeout, "claude-code");

    assert!(message.contains("已停止等待"));
    assert!(message.contains("稍后"));
}
