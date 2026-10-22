use serde_json::Value;

use super::*;

const VALID_TOOL_JSON: &str = include_str!("fixtures/valid-tool.json");

fn fixture() -> Value {
    serde_json::from_str(VALID_TOOL_JSON).expect("fixture is valid JSON")
}

fn tool(value: &mut Value) -> &mut Value {
    &mut value["tools"][0]
}

fn setting(value: &mut Value) -> &mut Value {
    &mut value["tools"][0]["settings"][0]
}

fn remove_key(target: &mut Value, key: &str) {
    assert!(
        target
            .as_object_mut()
            .expect("target is an object")
            .remove(key)
            .is_some(),
        "fixture key {key} exists"
    );
}

fn assert_malformed(value: &Value) {
    assert!(matches!(
        parse_definitions(&value.to_string()),
        Err(RegistryError::Malformed(_))
    ));
}

#[test]
fn fixture_parses_every_item_kind_with_declared_status() {
    let definitions = parse_definitions(&fixture().to_string()).expect("fixture parses");
    let tool = &definitions.tools[0];

    assert_eq!(definitions.schema_version, DEFINITION_SCHEMA_VERSION);
    assert_eq!(tool.id, "fixture-tool");
    assert_eq!(tool.resources[0].layer, ResourceLayer::UserLevel);
    assert_eq!(tool.resources[0].format, ResourceFormat::Json);
    assert_eq!(tool.resources[0].coverage, CoverageStatus::Editable);
    assert_eq!(tool.settings[0].coverage, CoverageStatus::Editable);
    assert_eq!(tool.settings[0].value_type, ValueType::String);
    assert_eq!(tool.flags[0].coverage, CoverageStatus::DisplayOnly);
    assert_eq!(tool.flags[0].excludes, vec!["--json".to_owned()]);
    assert_eq!(tool.env[0].coverage, CoverageStatus::NotApplicable);
    assert!(tool.env[0].secret);
}

#[test]
fn fixture_records_source_url_date_and_documented_version() {
    let definitions = parse_definitions(&fixture().to_string()).expect("fixture parses");
    let source = &definitions.tools[0].settings[0].source;

    assert_eq!(source.url, "https://example.test/fixture-tool/settings");
    assert_eq!(source.retrieved_on, "2026-10-21");
    assert_eq!(source.documented_version, "1.2.3");
}

#[test]
fn versions_may_be_absent_at_parse_time() {
    let mut value = fixture();
    remove_key(setting(&mut value), "versions");

    let definitions = parse_value_ok(&value);

    assert_eq!(definitions.tools[0].settings[0].versions, None);
}

#[test]
fn notices_default_to_empty_when_absent() {
    let mut value = fixture();
    remove_key(tool(&mut value), "notices");

    let definitions = parse_value_ok(&value);

    assert!(definitions.tools[0].notices.is_empty());
}

#[test]
fn builtin_definitions_parse_with_no_tools_yet() {
    let definitions = parse_definitions(BUILTIN_DEFINITIONS_JSON).expect("builtin parses");

    assert_eq!(definitions.schema_version, DEFINITION_SCHEMA_VERSION);
    assert!(definitions.tools.is_empty());
}

#[test]
fn malformed_json_is_rejected() {
    assert!(matches!(
        parse_definitions("{"),
        Err(RegistryError::Malformed(_))
    ));
}

#[test]
fn missing_schema_version_is_rejected() {
    let mut value = fixture();
    remove_key(&mut value, "schemaVersion");

    assert_malformed(&value);
}

#[test]
fn unknown_top_level_field_is_rejected() {
    let mut value = fixture();
    value["extra"] = Value::Bool(true);

    assert_malformed(&value);
}

#[test]
fn unknown_setting_field_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["sourcePath"] = Value::from("/etc/fixture");

    assert_malformed(&value);
}

#[test]
fn unknown_resource_field_is_rejected() {
    let mut value = fixture();
    tool(&mut value)["resources"][0]["absolutePath"] = Value::from("/Users/x/.fixture-tool");

    assert_malformed(&value);
}

#[test]
fn missing_source_url_is_rejected() {
    let mut value = fixture();
    remove_key(&mut tool(&mut value)["source"], "url");

    assert_malformed(&value);
}

#[test]
fn missing_retrieved_on_date_is_rejected() {
    let mut value = fixture();
    remove_key(&mut setting(&mut value)["source"], "retrievedOn");

    assert_malformed(&value);
}

#[test]
fn missing_documented_version_is_rejected() {
    let mut value = fixture();
    remove_key(
        &mut tool(&mut value)["env"][0]["source"],
        "documentedVersion",
    );

    assert_malformed(&value);
}

#[test]
fn missing_coverage_status_is_rejected() {
    let mut value = fixture();
    remove_key(setting(&mut value), "coverage");

    assert_malformed(&value);
}

#[test]
fn unknown_coverage_status_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["coverage"] = Value::from("maybe");

    assert_malformed(&value);
}

#[test]
fn unknown_resource_layer_is_rejected() {
    let mut value = fixture();
    tool(&mut value)["resources"][0]["layer"] = Value::from("global");

    assert_malformed(&value);
}

#[test]
fn unknown_value_type_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["valueType"] = Value::from("float");

    assert_malformed(&value);
}

#[test]
fn unknown_risk_flag_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["risks"] = serde_json::json!(["deleteEverything"]);

    assert_malformed(&value);
}

#[test]
fn missing_secret_marker_is_rejected() {
    let mut value = fixture();
    remove_key(setting(&mut value), "secret");

    assert_malformed(&value);
}

#[test]
fn unknown_key_inside_versions_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["versions"]["since"] = Value::from("1.0.0");

    assert_malformed(&value);
}

fn parse_value_ok(value: &Value) -> Definitions {
    parse_definitions(&value.to_string()).expect("value parses")
}
