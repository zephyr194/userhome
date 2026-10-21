use std::collections::BTreeSet;

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::ai_config::registry::{
    CoverageStatus, DEFINITION_SCHEMA_VERSION, RegistryError, ResourceFormat, ResourceLayer,
    RiskFlag, ValueType, parse_definitions,
};

const SCHEMA_JSON: &str = include_str!("definitions/schema.json");
const FIXTURE_JSON: &str = include_str!("fixtures/valid-tool.json");

const ITEM_POINTERS: [(&str, &str); 9] = [
    ("tool", "/tools/0"),
    ("source", "/tools/0/source"),
    ("resource", "/tools/0/resources/0"),
    ("setting", "/tools/0/settings/0"),
    ("flag", "/tools/0/flags/0"),
    ("env", "/tools/0/env/0"),
    ("versions", "/tools/0/settings/0/versions"),
    ("listingCoverage", "/tools/0/flagsCoverage"),
    ("listingCoverage", "/tools/0/envCoverage"),
];

fn schema() -> Value {
    serde_json::from_str(SCHEMA_JSON).expect("schema is valid JSON")
}

fn fixture() -> Value {
    serde_json::from_str(FIXTURE_JSON).expect("fixture is valid JSON")
}

fn definition<'a>(schema: &'a Value, name: &str) -> &'a Value {
    &schema["$defs"][name]
}

fn properties(schema: &Value, name: &str) -> BTreeSet<String> {
    definition(schema, name)["properties"]
        .as_object()
        .expect("properties is an object")
        .keys()
        .cloned()
        .collect()
}

fn required(schema: &Value, name: &str) -> BTreeSet<String> {
    strings(&definition(schema, name)["required"])
}

fn strings(value: &Value) -> BTreeSet<String> {
    value
        .as_array()
        .expect("array of strings")
        .iter()
        .map(|item| item.as_str().expect("string").to_owned())
        .collect()
}

fn assert_enum<T: DeserializeOwned>(schema: &Value, name: &str, expected: &[&str]) {
    let values: Vec<&str> = definition(schema, name)["enum"]
        .as_array()
        .expect("enum is an array")
        .iter()
        .map(|value| value.as_str().expect("enum value is a string"))
        .collect();
    assert_eq!(values, expected, "{name}");
    for value in expected {
        serde_json::from_value::<T>(json!(value))
            .unwrap_or_else(|error| panic!("{name}:{value} rejected by Rust: {error}"));
    }
    assert!(serde_json::from_value::<T>(json!("__not_a_value__")).is_err());
}

#[test]
fn schema_pins_the_definition_schema_version() {
    assert_eq!(
        schema()["properties"]["schemaVersion"]["const"],
        json!(DEFINITION_SCHEMA_VERSION)
    );
}

#[test]
fn every_object_definition_is_closed() {
    let schema = schema();
    let definitions = schema["$defs"].as_object().expect("$defs is an object");

    for (name, definition) in definitions {
        if definition.get("properties").is_some() {
            assert_eq!(
                definition["additionalProperties"],
                json!(false),
                "{name} must reject unknown fields"
            );
        }
    }
}

#[test]
fn schema_properties_match_fixture_items_exactly() {
    let schema = schema();
    let fixture = fixture();

    for (name, pointer) in ITEM_POINTERS {
        let item = fixture.pointer(pointer).expect("fixture item exists");
        let fixture_keys: BTreeSet<String> = item
            .as_object()
            .expect("fixture item is an object")
            .keys()
            .cloned()
            .collect();

        assert_eq!(properties(&schema, name), fixture_keys, "{name}");
    }
}

#[test]
fn schema_required_fields_match_rust_required_fields() {
    let schema = schema();
    let fixture = fixture();

    for (name, pointer) in ITEM_POINTERS {
        let required = required(&schema, name);
        for key in properties(&schema, name) {
            let mut value = fixture.clone();
            value
                .pointer_mut(pointer)
                .expect("fixture item exists")
                .as_object_mut()
                .expect("fixture item is an object")
                .remove(&key);
            let result = parse_definitions(&value.to_string());

            if required.contains(&key) {
                assert!(
                    matches!(result, Err(RegistryError::Malformed(_))),
                    "{name}.{key} is required by the schema but Rust accepted its absence"
                );
            } else {
                assert!(
                    result.is_ok(),
                    "{name}.{key} is optional by the schema but Rust rejected its absence"
                );
            }
        }
    }
}

#[test]
fn schema_enums_match_rust_variants() {
    let schema = schema();

    assert_enum::<CoverageStatus>(
        &schema,
        "coverageStatus",
        &[
            "editable",
            "displayOnly",
            "notApplicable",
            "versionUnknown",
            "unsupported",
        ],
    );
    assert_enum::<ResourceLayer>(
        &schema,
        "resourceLayer",
        &["userLevel", "projectShared", "projectLocal", "managed"],
    );
    assert_enum::<ResourceFormat>(
        &schema,
        "resourceFormat",
        &["json", "jsonc", "toml", "text"],
    );
    assert_enum::<ValueType>(
        &schema,
        "valueType",
        &[
            "string",
            "boolean",
            "number",
            "stringArray",
            "object",
            "enum",
            "unknown",
        ],
    );
    assert_enum::<RiskFlag>(
        &schema,
        "riskFlag",
        &["executesCommand", "relaxesPermissions", "externalServer"],
    );
}
