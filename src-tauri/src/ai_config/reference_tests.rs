use super::*;
use crate::ai_config::registry::Definitions;
use crate::ai_config::validate::load_all;

fn tool<'a>(definitions: &'a Definitions, id: &str) -> &'a ToolDefinition {
    definitions
        .tools
        .iter()
        .find(|tool| tool.id == id)
        .expect("tool is registered")
}

#[test]
fn reference_tool_ids_cover_the_four_registered_tools() {
    for id in ["claude-code", "codex-cli", "gemini-cli", "copilot-cli"] {
        assert!(is_reference_tool_id(id), "{id}");
    }
    for id in ["", "bogus", "Gemini-CLI", "../gemini-cli"] {
        assert!(!is_reference_tool_id(id), "{id}");
    }
}

#[test]
fn each_external_tool_projects_its_resources_settings_and_source() {
    let definitions = load_all().expect("builtin definitions validate");
    for id in ["codex-cli", "gemini-cli", "copilot-cli"] {
        let reference = tool_reference(tool(&definitions, id));

        assert_eq!(reference.tool_id, id);
        assert!(!reference.display_name.is_empty());
        assert!(reference.source.url.starts_with("https://"));
        assert!(!reference.resources.is_empty(), "{id} resources");
        assert!(!reference.settings.is_empty(), "{id} settings");
        assert_eq!(
            reference.settings.len(),
            tool(&definitions, id).settings.len()
        );
    }
}

#[test]
fn gemini_projects_the_official_migration_notice_and_others_have_none() {
    let definitions = load_all().expect("builtin definitions validate");
    let gemini = tool_reference(tool(&definitions, "gemini-cli"));

    assert_eq!(gemini.notices.len(), 1);
    assert!(gemini.notices[0].contains("Antigravity CLI"));
    for id in ["codex-cli", "copilot-cli"] {
        assert!(
            tool_reference(tool(&definitions, id)).notices.is_empty(),
            "{id}"
        );
    }
}

#[test]
fn long_descriptions_are_truncated_and_flagged() {
    let definitions = load_all().expect("builtin definitions validate");
    let mut copilot = tool(&definitions, "copilot-cli").clone();
    copilot.settings[0].description = "x".repeat(700);
    copilot.settings[1].description = "short".to_owned();

    let reference = tool_reference(&copilot);

    assert_eq!(reference.settings[0].description.chars().count(), 600);
    assert!(reference.settings[0].description_truncated);
    assert_eq!(reference.settings[1].description, "short");
    assert!(!reference.settings[1].description_truncated);
}

#[test]
fn oversized_default_notes_are_bounded_for_every_tool() {
    let definitions = load_all().expect("builtin definitions validate");
    for id in ["codex-cli", "gemini-cli", "copilot-cli"] {
        for setting in tool_reference(tool(&definitions, id)).settings {
            assert!(
                setting.default_note.chars().count() <= 600,
                "{id}.{}",
                setting.key_path
            );
        }
    }
    let gemini = tool_reference(tool(&definitions, "gemini-cli"));
    assert!(
        gemini
            .settings
            .iter()
            .any(|setting| setting.default_note_truncated)
    );
}

#[test]
fn authentication_resources_are_marked_metadata_only() {
    let definitions = load_all().expect("builtin definitions validate");
    let gemini = tool_reference(tool(&definitions, "gemini-cli"));

    let credentials = gemini
        .resources
        .iter()
        .find(|resource| resource.id == "gemini-auth-credentials")
        .expect("credentials resource is projected");
    let settings = gemini
        .resources
        .iter()
        .find(|resource| resource.id == "gemini-user-settings")
        .expect("user settings resource is projected");

    assert!(credentials.metadata_only);
    assert!(!settings.metadata_only);
}

#[test]
fn projection_carries_placeholder_locations_only() {
    let definitions = load_all().expect("builtin definitions validate");
    for id in ["codex-cli", "gemini-cli", "copilot-cli"] {
        let reference = tool_reference(tool(&definitions, id));
        for resource in &reference.resources {
            assert!(resource.location.starts_with('{'), "{id}.{}", resource.id);
        }
        let json = serde_json::to_string(&reference).expect("reference serializes");
        assert!(!json.contains("/Users/"), "{id}");
        assert!(!json.contains("/home/"), "{id}");
    }
}

#[test]
fn serialized_reference_uses_camel_case_keys() {
    let definitions = load_all().expect("builtin definitions validate");
    let value = serde_json::to_value(tool_reference(tool(&definitions, "gemini-cli")))
        .expect("reference serializes");

    assert_eq!(value["toolId"], "gemini-cli");
    assert!(value["settings"][0]["keyPath"].is_string());
    assert!(value["settings"][0]["valueType"].is_string());
    assert!(value["envCoverage"]["snapshotComplete"].is_boolean());
    assert!(value["notices"].is_array());
}
