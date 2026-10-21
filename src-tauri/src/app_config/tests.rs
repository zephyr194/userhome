use std::path::{Path, PathBuf};

use serde_json::Value;

use super::registry::{
    Capability, Entry, EntrySummary, Location, Registry, RegistryError, Sensitivity, display_path,
    fixture, resolve_path,
};

const HOME: &str = "/Users/example";

#[test]
fn registry_get_returns_the_entry_for_a_known_id() {
    let registry = Registry::new(vec![fixture("alpha-tool"), fixture("beta-tool")]);

    let entry = registry.get("beta-tool").expect("known id resolves");

    assert_eq!(entry.id, "beta-tool");
}

#[test]
fn registry_get_rejects_an_unknown_id_with_a_typed_error() {
    let registry = Registry::new(vec![fixture("alpha-tool")]);

    assert_eq!(
        registry.get("missing-tool"),
        Err(RegistryError::UnknownEntry("missing-tool".to_owned()))
    );
}

#[test]
fn registry_get_matches_ids_exactly() {
    let registry = Registry::new(vec![fixture("alpha-tool")]);

    assert!(matches!(
        registry.get("Alpha-Tool"),
        Err(RegistryError::UnknownEntry(_))
    ));
    assert!(matches!(
        registry.get("alpha-tool "),
        Err(RegistryError::UnknownEntry(_))
    ));
    assert!(matches!(
        registry.get(""),
        Err(RegistryError::UnknownEntry(_))
    ));
}

#[test]
fn registry_entries_returns_every_entry_in_order() {
    let registry = Registry::new(vec![fixture("alpha-tool"), fixture("beta-tool")]);

    let ids: Vec<&str> = registry.entries().iter().map(|entry| entry.id).collect();

    assert_eq!(ids, ["alpha-tool", "beta-tool"]);
}

#[test]
fn resolve_home_entry_joins_the_relative_path_under_home() {
    let entry = with_location(Location::Home(".config/tool/config.toml"));

    assert_eq!(
        resolve_path(&entry, Path::new(HOME)),
        PathBuf::from("/Users/example/.config/tool/config.toml")
    );
}

#[test]
fn resolve_fixed_entry_ignores_the_home_directory() {
    let entry = with_location(Location::Fixed("/etc/example.conf"));

    assert_eq!(
        resolve_path(&entry, Path::new(HOME)),
        PathBuf::from("/etc/example.conf")
    );
}

#[test]
fn display_path_shows_home_entries_with_a_tilde_prefix() {
    let entry = with_location(Location::Home("Library/Preferences/tool/auth.ini"));

    assert_eq!(display_path(&entry), "~/Library/Preferences/tool/auth.ini");
}

#[test]
fn display_path_keeps_fixed_entries_absolute() {
    let entry = with_location(Location::Fixed("/etc/example.conf"));

    assert_eq!(display_path(&entry), "/etc/example.conf");
}

#[test]
fn summary_shows_the_tilde_path_and_never_the_resolved_home() {
    let entry = with_location(Location::Home(".gitconfig"));

    let json = serde_json::to_string(&EntrySummary::from(&entry)).expect("summary serializes");

    assert!(json.contains("\"displayPath\":\"~/.gitconfig\""));
    assert!(!json.contains("/Users/"));
}

#[test]
fn summary_serializes_exactly_the_frontend_fields_in_camel_case() {
    let entry = fixture("git");

    let value: Value =
        serde_json::to_value(EntrySummary::from(&entry)).expect("summary serializes");
    let object = value.as_object().expect("summary is an object");

    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "capability",
            "category",
            "displayPath",
            "format",
            "id",
            "metadataOnly",
            "name",
            "sensitivity",
            "sourceUrl",
            "verifiedOn",
        ]
    );
}

#[test]
fn capability_and_sensitivity_serialize_as_camel_case_names() {
    assert_eq!(
        serde_json::to_value(Capability::DiscoverOnly).expect("serializes"),
        "discoverOnly"
    );
    assert_eq!(
        serde_json::to_value(Capability::ReadOnly).expect("serializes"),
        "readOnly"
    );
    assert_eq!(
        serde_json::to_value(Sensitivity::SensitiveKeys).expect("serializes"),
        "sensitiveKeys"
    );
}

fn with_location(location: Location) -> Entry {
    Entry {
        location,
        ..fixture("location-probe")
    }
}
