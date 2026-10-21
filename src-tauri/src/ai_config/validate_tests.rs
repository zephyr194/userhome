use std::collections::BTreeSet;

use serde_json::{Value, json};

use super::{
    check_coverage, covered_ids, effective_status, load_builtin, load_validated, parse_version,
};
use crate::ai_config::registry::{
    CoverageStatus, Definitions, IssueKind, RegistryError, VerifiedVersions,
};

const VALID_TOOL_JSON: &str = include_str!("fixtures/valid-tool.json");

fn fixture() -> Value {
    serde_json::from_str(VALID_TOOL_JSON).expect("fixture is valid JSON")
}

fn fixture_definitions() -> Definitions {
    load_validated(VALID_TOOL_JSON).expect("fixture validates")
}

fn tool(value: &mut Value) -> &mut Value {
    &mut value["tools"][0]
}

fn setting(value: &mut Value) -> &mut Value {
    &mut value["tools"][0]["settings"][0]
}

fn resource(value: &mut Value) -> &mut Value {
    &mut value["tools"][0]["resources"][0]
}

fn flag(value: &mut Value, index: usize) -> &mut Value {
    &mut value["tools"][0]["flags"][index]
}

fn env(value: &mut Value) -> &mut Value {
    &mut value["tools"][0]["env"][0]
}

fn duplicate_first(value: &mut Value, collection: &str) {
    let copy = tool(value)[collection][0].clone();
    tool(value)[collection]
        .as_array_mut()
        .expect("collection is an array")
        .push(copy);
}

fn issue_kinds(value: &Value) -> Vec<IssueKind> {
    match load_validated(&value.to_string()) {
        Err(RegistryError::Invalid(issues)) => issues.into_iter().map(|issue| issue.kind).collect(),
        other => panic!("expected validation issues, got {other:?}"),
    }
}

fn assert_only(value: &Value, kind: IssueKind) {
    assert_eq!(issue_kinds(value), vec![kind]);
}

fn range(min: &str, max: &str) -> VerifiedVersions {
    VerifiedVersions {
        min: min.to_owned(),
        max: max.to_owned(),
    }
}

#[test]
fn valid_fixture_passes_validation() {
    assert!(load_validated(VALID_TOOL_JSON).is_ok());
}

#[test]
fn builtin_definitions_load_with_no_tools() {
    let definitions = load_builtin().expect("builtin validates");

    assert!(definitions.tools.is_empty());
}

#[test]
fn unsupported_schema_version_is_rejected() {
    let mut value = fixture();
    value["schemaVersion"] = json!(2);

    assert_only(&value, IssueKind::UnsupportedSchemaVersion);
}

#[test]
fn duplicate_tool_id_is_rejected() {
    let mut value = fixture();
    let copy = tool(&mut value).clone();
    value["tools"]
        .as_array_mut()
        .expect("tools is an array")
        .push(copy);

    assert_only(&value, IssueKind::DuplicateToolId);
}

#[test]
fn duplicate_resource_id_is_rejected() {
    let mut value = fixture();
    duplicate_first(&mut value, "resources");

    assert_only(&value, IssueKind::DuplicateItemId);
}

#[test]
fn duplicate_setting_id_is_rejected() {
    let mut value = fixture();
    duplicate_first(&mut value, "settings");

    assert_only(&value, IssueKind::DuplicateItemId);
}

#[test]
fn duplicate_flag_id_is_rejected() {
    let mut value = fixture();
    duplicate_first(&mut value, "flags");

    assert_only(&value, IssueKind::DuplicateItemId);
}

#[test]
fn duplicate_env_name_is_rejected() {
    let mut value = fixture();
    duplicate_first(&mut value, "env");

    assert_only(&value, IssueKind::DuplicateItemId);
}

#[test]
fn invalid_tool_id_is_rejected() {
    let mut value = fixture();
    tool(&mut value)["id"] = json!("bad id");

    assert_only(&value, IssueKind::InvalidId);
}

#[test]
fn invalid_key_path_is_rejected() {
    for key_path in ["", "model..x", "model.", ".model", "model x"] {
        let mut value = fixture();
        setting(&mut value)["keyPath"] = json!(key_path);

        assert_only(&value, IssueKind::InvalidId);
    }
}

#[test]
fn dotted_key_paths_are_accepted() {
    for key_path in ["model", "model.x", "permissions.allow"] {
        let mut value = fixture();
        setting(&mut value)["keyPath"] = json!(key_path);

        assert!(load_validated(&value.to_string()).is_ok());
    }
}

#[test]
fn blank_display_name_is_rejected() {
    let mut value = fixture();
    tool(&mut value)["displayName"] = json!("   ");

    assert_only(&value, IssueKind::EmptyText);
}

#[test]
fn blank_description_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["description"] = json!("");

    assert_only(&value, IssueKind::EmptyText);
}

#[test]
fn blank_default_note_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["defaultNote"] = json!("");

    assert_only(&value, IssueKind::EmptyText);
}

#[test]
fn blank_config_alternative_is_rejected() {
    let mut value = fixture();
    env(&mut value)["configAlternative"] = json!("");

    assert_only(&value, IssueKind::EmptyText);
}

#[test]
fn non_https_source_url_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["source"]["url"] = json!("http://example.test/fixture-tool/settings");

    assert_only(&value, IssueKind::InvalidSourceUrl);
}

#[test]
fn source_url_without_host_or_with_whitespace_is_rejected() {
    for url in [
        "https:///settings",
        "https://exa mple.test/settings",
        "https://",
    ] {
        let mut value = fixture();
        setting(&mut value)["source"]["url"] = json!(url);

        assert_only(&value, IssueKind::InvalidSourceUrl);
    }
}

#[test]
fn real_calendar_dates_are_accepted() {
    for date in ["2026-10-21", "2024-02-29", "2000-02-29", "2026-12-31"] {
        let mut value = fixture();
        setting(&mut value)["source"]["retrievedOn"] = json!(date);

        assert!(load_validated(&value.to_string()).is_ok(), "{date}");
    }
}

#[test]
fn impossible_or_malformed_dates_are_rejected() {
    for date in [
        "2026-02-30",
        "2026-02-29",
        "2026-13-01",
        "2026-00-10",
        "2026-10-00",
        "2026-10-32",
        "2026-1-01",
        "20261021",
        "+026-10-21",
    ] {
        let mut value = fixture();
        setting(&mut value)["source"]["retrievedOn"] = json!(date);

        assert_only(&value, IssueKind::InvalidRetrievedOn);
    }
}

#[test]
fn documented_version_accepts_unknown_marker_and_versions() {
    for documented in ["unknown", "1", "1.2", "1.2.3.4"] {
        let mut value = fixture();
        setting(&mut value)["source"]["documentedVersion"] = json!(documented);

        assert!(load_validated(&value.to_string()).is_ok(), "{documented}");
    }
}

#[test]
fn documented_version_rejects_free_text_and_bad_components() {
    for documented in ["abc", "", "1..2", "1.2.3.4.5", "v1.2"] {
        let mut value = fixture();
        setting(&mut value)["source"]["documentedVersion"] = json!(documented);

        assert_only(&value, IssueKind::InvalidDocumentedVersion);
    }
}

#[test]
fn location_must_start_with_known_placeholder() {
    for location in [
        "{home}/.fixture-tool/settings.json",
        "{project}/.fixture-tool/settings.json",
        "{home}/.a/{project}/b",
    ] {
        let mut value = fixture();
        resource(&mut value)["location"] = json!(location);

        assert!(load_validated(&value.to_string()).is_ok(), "{location}");
    }
}

#[test]
fn absolute_relative_or_unknown_placeholder_locations_are_rejected() {
    for location in [
        "/Users/x/.fixture-tool/settings.json",
        "~/.fixture-tool/settings.json",
        "relative/settings.json",
        "{home}/../escape.json",
        "{cwd}/settings.json",
        "{home}/a}b",
        "{}/settings.json",
        "{home/settings.json",
    ] {
        let mut value = fixture();
        resource(&mut value)["location"] = json!(location);

        assert_only(&value, IssueKind::InvalidLocation);
    }
}

#[test]
fn editable_setting_without_versions_is_rejected() {
    let mut value = fixture();
    setting(&mut value)
        .as_object_mut()
        .expect("setting is an object")
        .remove("versions");

    assert_only(&value, IssueKind::MissingVersions);
}

#[test]
fn editable_resource_without_versions_is_rejected() {
    let mut value = fixture();
    resource(&mut value)
        .as_object_mut()
        .expect("resource is an object")
        .remove("versions");

    assert_only(&value, IssueKind::MissingVersions);
}

#[test]
fn enum_setting_without_allowed_values_is_rejected() {
    let mut value = fixture();
    setting(&mut value)["valueType"] = json!("enum");

    assert_only(&value, IssueKind::EnumWithoutValues);
}

#[test]
fn enum_setting_with_allowed_values_is_accepted() {
    let mut value = fixture();
    setting(&mut value)["valueType"] = json!("enum");
    setting(&mut value)["allowedValues"] = json!(["low", "high"]);

    assert!(load_validated(&value.to_string()).is_ok());
}

#[test]
fn flag_excluding_unknown_flag_is_rejected() {
    let mut value = fixture();
    flag(&mut value, 0)["excludes"] = json!(["--missing"]);

    assert_only(&value, IssueKind::UnknownReference);
}

#[test]
fn flag_excluding_itself_is_rejected() {
    let mut value = fixture();
    flag(&mut value, 0)["excludes"] = json!(["--print"]);

    assert_only(&value, IssueKind::SelfReference);
}

#[test]
fn flag_requiring_unknown_flag_is_rejected() {
    let mut value = fixture();
    flag(&mut value, 1)["requires"] = json!(["--nope"]);

    assert_only(&value, IssueKind::UnknownReference);
}

#[test]
fn env_excluding_unknown_name_is_rejected() {
    let mut value = fixture();
    env(&mut value)["excludes"] = json!(["NOPE"]);

    assert_only(&value, IssueKind::UnknownReference);
}

#[test]
fn env_names_must_be_uppercase_identifiers() {
    for name in ["fixture_token", "1BAD", "BAD-NAME", ""] {
        let mut value = fixture();
        env(&mut value)["name"] = json!(name);

        assert_only(&value, IssueKind::InvalidEnvName);
    }
}

#[test]
fn uppercase_env_names_with_underscores_and_digits_are_accepted() {
    for name in ["_PRIVATE_1", "FIXTURE_TOOL_TOKEN"] {
        let mut value = fixture();
        env(&mut value)["name"] = json!(name);

        assert!(load_validated(&value.to_string()).is_ok(), "{name}");
    }
}

#[test]
fn executable_names_must_be_non_empty_plain_names() {
    for names in [json!([]), json!(["a/b"]), json!([""]), json!([" x"])] {
        let mut value = fixture();
        tool(&mut value)["executableNames"] = names;

        assert_only(&value, IssueKind::InvalidExecutableName);
    }
}

#[test]
fn multiple_independent_issues_are_all_reported_in_order() {
    let mut value = fixture();
    tool(&mut value)["id"] = json!("bad id");
    tool(&mut value)["source"]["url"] = json!("http://example.test/x");

    assert_eq!(
        issue_kinds(&value),
        vec![IssueKind::InvalidId, IssueKind::InvalidSourceUrl]
    );
}

#[test]
fn parse_version_accepts_one_to_four_numeric_components() {
    assert_eq!(parse_version("1"), Some(vec![1]));
    assert_eq!(parse_version("1.2.3"), Some(vec![1, 2, 3]));
    assert_eq!(parse_version("1.2.3.4"), Some(vec![1, 2, 3, 4]));
    assert_eq!(parse_version("01.02"), Some(vec![1, 2]));
}

#[test]
fn parse_version_rejects_malformed_text() {
    for text in [
        "",
        "1..2",
        "1.a",
        "v1.2",
        "1.2.3.4.5",
        "-1",
        "+1",
        " 1.2",
        "1.2 ",
        "1.",
        ".1",
        "99999999999999999999999",
    ] {
        assert_eq!(parse_version(text), None, "{text}");
    }
}

#[test]
fn editable_status_holds_inside_verified_range() {
    let versions = range("1.0.0", "1.2.3");

    assert_eq!(
        effective_status(CoverageStatus::Editable, Some(&versions), Some("1.1.0")),
        CoverageStatus::Editable
    );
}

#[test]
fn verified_range_bounds_are_inclusive() {
    let versions = range("1.0.0", "1.2.3");

    assert_eq!(
        effective_status(CoverageStatus::Editable, Some(&versions), Some("1.0.0")),
        CoverageStatus::Editable
    );
    assert_eq!(
        effective_status(CoverageStatus::Editable, Some(&versions), Some("1.2.3")),
        CoverageStatus::Editable
    );
}

#[test]
fn versions_above_verified_max_are_display_only_not_assumed_compatible() {
    let versions = range("1.0.0", "1.2.3");

    for detected in ["1.2.4", "1.3.0", "2.0.0"] {
        assert_eq!(
            effective_status(CoverageStatus::Editable, Some(&versions), Some(detected)),
            CoverageStatus::DisplayOnly,
            "{detected}"
        );
    }
}

#[test]
fn versions_below_verified_min_are_display_only() {
    let versions = range("1.0.0", "1.2.3");

    assert_eq!(
        effective_status(CoverageStatus::Editable, Some(&versions), Some("0.9.9")),
        CoverageStatus::DisplayOnly
    );
}

#[test]
fn version_comparison_is_numeric_not_lexicographic() {
    let versions = range("1.2.0", "1.10.0");

    assert_eq!(
        effective_status(CoverageStatus::Editable, Some(&versions), Some("1.9.0")),
        CoverageStatus::Editable
    );
}

#[test]
fn missing_trailing_components_compare_as_zero() {
    let versions = range("1.0", "1.2.3");

    assert_eq!(
        effective_status(CoverageStatus::Editable, Some(&versions), Some("1.0.0")),
        CoverageStatus::Editable
    );
    assert_eq!(
        effective_status(CoverageStatus::Editable, Some(&versions), Some("1.2")),
        CoverageStatus::Editable
    );
}

#[test]
fn undetected_or_unparsable_local_version_is_version_unknown() {
    let versions = range("1.0.0", "1.2.3");

    for detected in [None, Some("v1.2"), Some("")] {
        assert_eq!(
            effective_status(CoverageStatus::Editable, Some(&versions), detected),
            CoverageStatus::VersionUnknown,
            "{detected:?}"
        );
    }
}

#[test]
fn editable_without_verified_range_fails_closed_to_display_only() {
    assert_eq!(
        effective_status(CoverageStatus::Editable, None, Some("1.2.3")),
        CoverageStatus::DisplayOnly
    );
    assert_eq!(
        effective_status(CoverageStatus::Editable, None, None),
        CoverageStatus::DisplayOnly
    );
}

#[test]
fn inverted_or_unparsable_range_fails_closed_to_display_only() {
    for versions in [
        range("2.0.0", "1.0.0"),
        range("x", "1.0.0"),
        range("1.0.0", "1..0"),
    ] {
        assert_eq!(
            effective_status(CoverageStatus::Editable, Some(&versions), Some("1.5.0")),
            CoverageStatus::DisplayOnly,
            "{versions:?}"
        );
    }
}

#[test]
fn non_editable_statuses_are_never_upgraded_by_version_match() {
    let versions = range("1.0.0", "1.2.3");

    for status in [
        CoverageStatus::DisplayOnly,
        CoverageStatus::NotApplicable,
        CoverageStatus::VersionUnknown,
        CoverageStatus::Unsupported,
    ] {
        assert_eq!(
            effective_status(status, Some(&versions), Some("1.1.0")),
            status
        );
        assert_eq!(effective_status(status, None, None), status);
    }
}

#[test]
fn covered_ids_contain_every_public_item_kind() {
    let expected: BTreeSet<String> = [
        "fixture-tool/resource/user-settings",
        "fixture-tool/setting/model",
        "fixture-tool/flag/--print",
        "fixture-tool/flag/--json",
        "fixture-tool/env/FIXTURE_TOOL_TOKEN",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();

    assert_eq!(covered_ids(&fixture_definitions()), expected);
}

#[test]
fn check_coverage_is_empty_when_snapshot_is_fully_covered() {
    let snapshot = [
        "fixture-tool/resource/user-settings",
        "fixture-tool/setting/model",
        "fixture-tool/flag/--print",
        "fixture-tool/flag/--json",
        "fixture-tool/env/FIXTURE_TOOL_TOKEN",
    ];

    assert!(check_coverage(&snapshot, &fixture_definitions()).is_empty());
}

#[test]
fn check_coverage_lists_missing_items_sorted_and_deduplicated() {
    let snapshot = [
        "fixture-tool/setting/model",
        "fixture-tool/setting/missing",
        "fixture-tool/env/NOPE",
        "fixture-tool/setting/missing",
    ];

    assert_eq!(
        check_coverage(&snapshot, &fixture_definitions()),
        vec![
            "fixture-tool/env/NOPE".to_owned(),
            "fixture-tool/setting/missing".to_owned(),
        ]
    );
}

#[test]
fn display_only_and_not_applicable_items_count_as_covered() {
    let snapshot = [
        "fixture-tool/flag/--print",
        "fixture-tool/env/FIXTURE_TOOL_TOKEN",
    ];

    assert!(check_coverage(&snapshot, &fixture_definitions()).is_empty());
}

#[test]
fn coverage_does_not_match_other_tool_or_other_kind() {
    let snapshot = ["other-tool/setting/model", "fixture-tool/flag/model"];

    assert_eq!(
        check_coverage(&snapshot, &fixture_definitions()),
        vec![
            "fixture-tool/flag/model".to_owned(),
            "other-tool/setting/model".to_owned(),
        ]
    );
}

#[test]
fn empty_definitions_report_every_snapshot_item_as_missing() {
    let definitions = load_builtin().expect("builtin validates");
    let snapshot = ["fixture-tool/setting/model"];

    assert_eq!(
        check_coverage(&snapshot, &definitions),
        vec!["fixture-tool/setting/model".to_owned()]
    );
}
