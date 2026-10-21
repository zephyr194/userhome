use serde_json::{Value, json};

use super::{
    EditAction, EditGate, EditRefusal, EditRequest, MAX_STRING_CHARS, apply_edit, edit_gate,
};
use crate::ai_config::read::MAX_SETTINGS_BYTES;
use crate::ai_config::registry::{ToolDefinition, VerifiedVersions, parse_definitions};

const SOURCE_URL: &str = "https://code.claude.com/docs/en/settings-reference";

fn setting(
    key: &str,
    value_type: &str,
    allowed: &[&str],
    coverage: &str,
    secret: bool,
    risks: &[&str],
) -> Value {
    let versions = match coverage {
        "editable" => json!({"min": "1.0.0", "max": "1.5.0"}),
        _ => Value::Null,
    };
    json!({
        "id": key,
        "keyPath": key,
        "valueType": value_type,
        "allowedValues": allowed,
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
    let settings = vec![
        setting(
            "alwaysThinkingEnabled",
            "boolean",
            &[],
            "editable",
            false,
            &[],
        ),
        setting(
            "effortLevel",
            "enum",
            &["low", "medium", "high", "xhigh"],
            "editable",
            false,
            &[],
        ),
        setting("language", "string", &[], "editable", false, &[]),
        setting("outer.inner", "boolean", &[], "editable", false, &[]),
        setting("displayed", "boolean", &[], "displayOnly", false, &[]),
        setting("secretKey", "string", &[], "editable", true, &[]),
        setting(
            "riskyKey",
            "boolean",
            &[],
            "editable",
            false,
            &["executesCommand"],
        ),
    ];
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
            "env": []
        }]
    });
    parse_definitions(&document.to_string())
        .expect("fixture definitions parse")
        .tools
        .remove(0)
}

fn edit(text: &str, key: &str, action: EditAction) -> Result<String, EditRefusal> {
    apply_edit(
        text,
        &tool(),
        &EditRequest {
            key_path: key.to_owned(),
            action,
        },
    )
}

fn set(text: &str, key: &str, value: Value) -> Result<String, EditRefusal> {
    edit(text, key, EditAction::SetValue(value))
}

fn restore(text: &str, key: &str) -> Result<String, EditRefusal> {
    edit(text, key, EditAction::RestoreDefault)
}

const RICH: &str = r#"{
  "alwaysThinkingEnabled": true,
  "unknownKey": {"nested": [1, 2.50, 1E+2, -0.0]},
  "big": 123456789012345678901234567890,
  "list": ["a", "b"]
}"#;

#[test]
fn set_changes_only_the_target_value_and_keeps_every_other_byte() {
    let out = set(RICH, "alwaysThinkingEnabled", json!(false)).expect("edit applies");

    assert_eq!(out, RICH.replacen("true", "false", 1));
}

#[test]
fn untouched_numbers_keep_their_source_text_including_big_integers() {
    let text = "{\n  \"alwaysThinkingEnabled\": false,\n  \"n\": 0.1000000000000000055511151231257827,\n  \"big\": 123456789012345678901234567890\n}";

    let out = set(text, "alwaysThinkingEnabled", json!(true)).expect("edit applies");

    assert!(out.contains("0.1000000000000000055511151231257827"));
    assert!(out.contains("123456789012345678901234567890"));
    assert_eq!(out, text.replacen("false", "true", 1));
}

#[test]
fn restore_default_removes_the_first_member() {
    let text = "{\n  \"alwaysThinkingEnabled\": true,\n  \"language\": \"en\"\n}";

    let out = restore(text, "alwaysThinkingEnabled").expect("edit applies");

    assert_eq!(out, "{\n  \"language\": \"en\"\n}");
}

#[test]
fn restore_default_removes_the_last_member_with_its_separator() {
    let text = "{\n  \"alwaysThinkingEnabled\": true,\n  \"language\": \"en\"\n}";

    let out = restore(text, "language").expect("edit applies");

    assert_eq!(out, "{\n  \"alwaysThinkingEnabled\": true\n}");
}

#[test]
fn restore_default_removes_a_middle_member() {
    let text = "{\n  \"language\": \"en\",\n  \"alwaysThinkingEnabled\": true,\n  \"effortLevel\": \"high\"\n}";

    let out = restore(text, "alwaysThinkingEnabled").expect("edit applies");

    assert_eq!(
        out,
        "{\n  \"language\": \"en\",\n  \"effortLevel\": \"high\"\n}"
    );
}

#[test]
fn restore_default_of_the_only_member_leaves_an_empty_object() {
    let text = "{\n  \"alwaysThinkingEnabled\": true\n}";

    let out = restore(text, "alwaysThinkingEnabled").expect("edit applies");

    assert_eq!(out, "{\n}");
}

#[test]
fn set_null_writes_null_in_place_and_differs_from_restore_default() {
    let text = "{\n  \"language\": \"en\"\n}";

    let nulled = edit(text, "language", EditAction::SetNull).expect("edit applies");
    let restored = restore(text, "language").expect("edit applies");

    assert_eq!(nulled, "{\n  \"language\": null\n}");
    assert_eq!(restored, "{\n}");
    assert_ne!(nulled, restored);
}

#[test]
fn restore_default_of_an_absent_key_reports_no_change() {
    let text = "{\n  \"language\": \"en\"\n}";

    assert_eq!(
        restore(text, "alwaysThinkingEnabled"),
        Err(EditRefusal::NoChange)
    );
}

#[test]
fn absent_key_is_inserted_after_the_last_member_with_its_indentation() {
    let text = "{\n  \"language\": \"en\"\n}";

    let out = set(text, "alwaysThinkingEnabled", json!(true)).expect("edit applies");

    assert_eq!(
        out,
        "{\n  \"language\": \"en\",\n  \"alwaysThinkingEnabled\": true\n}"
    );
}

#[test]
fn absent_key_in_an_empty_object_is_written_inline() {
    let out = set("{}", "effortLevel", json!("high")).expect("edit applies");

    assert_eq!(out, r#"{"effortLevel": "high"}"#);
}

#[test]
fn spacing_around_the_edited_value_is_preserved() {
    let text = "{ \"language\" : \"en\" }";

    let out = set(text, "language", json!("fr")).expect("edit applies");

    assert_eq!(out, "{ \"language\" : \"fr\" }");
}

#[test]
fn nested_key_is_inserted_into_the_existing_object() {
    let text = r#"{"outer": {"other": 1}}"#;

    let out = set(text, "outer.inner", json!(true)).expect("edit applies");

    assert_eq!(out, r#"{"outer": {"other": 1,"inner": true}}"#);
}

#[test]
fn nested_key_creates_missing_objects() {
    let out = set("{}", "outer.inner", json!(true)).expect("edit applies");

    assert_eq!(out, r#"{"outer": {"inner": true}}"#);
}

#[test]
fn nested_key_refuses_to_replace_a_scalar_parent() {
    let text = r#"{"outer": 5}"#;

    assert_eq!(
        set(text, "outer.inner", json!(true)),
        Err(EditRefusal::PathConflict)
    );
}

#[test]
fn restore_default_under_a_scalar_parent_reports_no_change() {
    let text = r#"{"outer": 5}"#;

    assert_eq!(restore(text, "outer.inner"), Err(EditRefusal::NoChange));
}

#[test]
fn comments_are_refused_line_and_block() {
    let line = "{\n  // note\n  \"language\": \"en\"\n}";
    let block = "{ /* note */ \"language\": \"en\" }";

    assert_eq!(
        set(line, "language", json!("fr")),
        Err(EditRefusal::Comment)
    );
    assert_eq!(
        set(block, "language", json!("fr")),
        Err(EditRefusal::Comment)
    );
}

#[test]
fn trailing_commas_are_refused_in_objects_and_arrays() {
    let object = r#"{"language": "en",}"#;
    let array = r#"{"list": [1,], "language": "en"}"#;

    assert_eq!(
        set(object, "language", json!("fr")),
        Err(EditRefusal::TrailingComma)
    );
    assert_eq!(
        set(array, "language", json!("fr")),
        Err(EditRefusal::TrailingComma)
    );
}

#[test]
fn duplicate_keys_are_refused_at_any_depth() {
    let top = r#"{"language": "en", "language": "fr"}"#;
    let nested = r#"{"x": {"a": 1, "a": 2}, "language": "en"}"#;

    assert_eq!(
        set(top, "alwaysThinkingEnabled", json!(true)),
        Err(EditRefusal::DuplicateKey("language".to_owned()))
    );
    assert_eq!(
        set(nested, "language", json!("fr")),
        Err(EditRefusal::DuplicateKey("a".to_owned()))
    );
}

#[test]
fn invalid_json_is_refused_with_line_and_column_only() {
    let text = "{\n  \"language\": tru\n}";

    assert_eq!(
        set(text, "language", json!("fr")),
        Err(EditRefusal::Syntax {
            line: 2,
            column: 15
        })
    );
}

#[test]
fn byte_order_mark_empty_and_non_object_files_are_refused() {
    let bom = "\u{feff}{\"language\": \"en\"}";

    assert_eq!(
        set(bom, "language", json!("fr")),
        Err(EditRefusal::ByteOrderMark)
    );
    assert_eq!(
        set("  \n", "language", json!("fr")),
        Err(EditRefusal::Empty)
    );
    assert_eq!(
        set("[1]", "language", json!("fr")),
        Err(EditRefusal::NotAnObject)
    );
}

#[test]
fn files_over_one_mebibyte_are_refused_before_scanning() {
    let text = format!("{{\"language\": \"{}\"}}", "a".repeat(MAX_SETTINGS_BYTES));

    assert_eq!(
        set(&text, "language", json!("fr")),
        Err(EditRefusal::TooLarge)
    );
}

#[test]
fn excessive_nesting_is_refused() {
    let text = format!("{{\"a\": {}{}}}", "[".repeat(200), "]".repeat(200));

    assert!(matches!(
        set(&text, "language", json!("fr")),
        Err(EditRefusal::Syntax { .. })
    ));
}

#[test]
fn boolean_must_be_a_json_boolean() {
    assert!(matches!(
        set("{}", "alwaysThinkingEnabled", json!("true")),
        Err(EditRefusal::InvalidValue(_))
    ));
}

#[test]
fn enum_accepts_only_documented_values() {
    assert_eq!(
        set("{}", "effortLevel", json!("xhigh")).expect("documented value"),
        r#"{"effortLevel": "xhigh"}"#
    );
    assert!(matches!(
        set("{}", "effortLevel", json!("max")),
        Err(EditRefusal::InvalidValue(_))
    ));
    assert!(matches!(
        set("{}", "effortLevel", json!(3)),
        Err(EditRefusal::InvalidValue(_))
    ));
}

#[test]
fn string_must_be_non_blank_bounded_and_free_of_control_characters() {
    assert!(matches!(
        set("{}", "language", json!("   ")),
        Err(EditRefusal::InvalidValue(_))
    ));
    assert!(matches!(
        set("{}", "language", json!("a\u{0007}b")),
        Err(EditRefusal::InvalidValue(_))
    ));
    assert!(matches!(
        set("{}", "language", json!("a".repeat(MAX_STRING_CHARS + 1))),
        Err(EditRefusal::InvalidValue(_))
    ));
    assert!(set("{}", "language", json!("a".repeat(MAX_STRING_CHARS))).is_ok());
}

#[test]
fn unknown_keys_are_refused() {
    assert_eq!(
        set("{}", "notInDefinition", json!(true)),
        Err(EditRefusal::UnknownKey)
    );
}

#[test]
fn display_only_secret_and_risky_keys_are_not_editable() {
    assert!(matches!(
        set("{}", "displayed", json!(true)),
        Err(EditRefusal::NotEditable(_))
    ));
    assert!(matches!(
        set("{}", "secretKey", json!("value")),
        Err(EditRefusal::NotEditable(_))
    ));
    assert!(matches!(
        set("{}", "riskyKey", json!(true)),
        Err(EditRefusal::NotEditable(_))
    ));
    assert!(matches!(
        restore("{\"displayed\": true}", "displayed"),
        Err(EditRefusal::NotEditable(_))
    ));
}

#[test]
fn edit_result_is_rechecked_against_the_expected_document() {
    let text = "{\n  \"alwaysThinkingEnabled\": true,\n  \"language\": \"en\"\n}";

    let out = set(text, "language", json!("fr")).expect("edit applies");
    let parsed: Value = serde_json::from_str(&out).expect("output is JSON");

    assert_eq!(parsed["alwaysThinkingEnabled"], json!(true));
    assert_eq!(parsed["language"], json!("fr"));
}

fn versions(min: &str, max: &str) -> VerifiedVersions {
    VerifiedVersions {
        min: min.to_owned(),
        max: max.to_owned(),
    }
}

#[test]
fn gate_is_closed_while_the_range_is_unverified() {
    assert_eq!(edit_gate(None, Some("1.2.0")), EditGate::RangeUnverified);
    assert_eq!(edit_gate(None, None), EditGate::RangeUnverified);
}

#[test]
fn gate_opens_only_inside_the_verified_range() {
    let range = versions("1.0.0", "1.5.0");

    assert_eq!(edit_gate(Some(&range), Some("1.2.0")), EditGate::Open);
    assert_eq!(edit_gate(Some(&range), Some("1.0.0")), EditGate::Open);
    assert_eq!(edit_gate(Some(&range), Some("1.5.0")), EditGate::Open);
}

#[test]
fn gate_closes_outside_the_verified_range_in_both_directions() {
    let range = versions("1.0.0", "1.5.0");

    assert_eq!(edit_gate(Some(&range), Some("0.9.9")), EditGate::OutOfRange);
    assert_eq!(edit_gate(Some(&range), Some("2.0.0")), EditGate::OutOfRange);
}

#[test]
fn gate_reports_unknown_version_when_detection_fails_or_is_unparsable() {
    let range = versions("1.0.0", "1.5.0");

    assert_eq!(edit_gate(Some(&range), None), EditGate::VersionUnknown);
    assert_eq!(
        edit_gate(Some(&range), Some("abc")),
        EditGate::VersionUnknown
    );
}

#[test]
fn gate_fails_closed_for_an_inverted_range() {
    let range = versions("2.0.0", "1.0.0");

    assert_eq!(edit_gate(Some(&range), Some("1.5.0")), EditGate::OutOfRange);
}
