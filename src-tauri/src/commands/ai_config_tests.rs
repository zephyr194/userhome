use serde_json::{Value, json};

use super::{catalog_item, edit_status, key_diff, value_at};
use crate::ai_config::registry::{SettingDefinition, ToolDefinition, parse_definitions};

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
