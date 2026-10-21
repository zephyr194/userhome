use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::ai_config::read::{
    ClaudeLocations, ClaudeReadView, LayerState, claude_tool, parse_settings, read_claude_view,
    snapshot_summary,
};
use crate::ai_config::registry::Definitions;
use crate::ai_config::validate::load_all;
use crate::app_config::discover::{ConfigFs, FsError, NodeInfo, NodeKind};

const HOME_SETTINGS: &str = "/fake/home/.claude/settings.json";
const HOME_SIGN_IN: &str = "/fake/home/.claude.json";
const PROJECT_SHARED: &str = "/fake/proj/.claude/settings.json";
const PROJECT_LOCAL: &str = "/fake/proj/.claude/settings.local.json";
const MANAGED: &str = "/fake/managed/managed-settings.json";

enum Node {
    File(Vec<u8>),
    Dir,
    StatDenied,
    ReadDenied,
    Oversized,
}

struct FakeFs {
    nodes: BTreeMap<PathBuf, Node>,
    allowed: BTreeSet<PathBuf>,
}

impl FakeFs {
    fn new(nodes: Vec<(&str, Node)>) -> Self {
        let allowed = [
            HOME_SETTINGS,
            HOME_SIGN_IN,
            PROJECT_SHARED,
            PROJECT_LOCAL,
            MANAGED,
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        Self {
            nodes: nodes
                .into_iter()
                .map(|(path, node)| (PathBuf::from(path), node))
                .collect(),
            allowed,
        }
    }

    fn file(text: &str) -> Node {
        Node::File(text.as_bytes().to_vec())
    }
}

impl ConfigFs for FakeFs {
    fn symlink_metadata(&self, path: &Path) -> Result<NodeInfo, FsError> {
        assert!(self.allowed.contains(path), "unexpected stat of {path:?}");
        match self.nodes.get(path) {
            None => Err(FsError::NotFound),
            Some(Node::File(bytes)) => Ok(NodeInfo {
                kind: NodeKind::File,
                size: bytes.len() as u64,
                modified_unix_millis: 0,
            }),
            Some(Node::Dir) => Ok(NodeInfo {
                kind: NodeKind::Other,
                size: 0,
                modified_unix_millis: 0,
            }),
            Some(Node::StatDenied) => Err(FsError::PermissionDenied),
            Some(Node::ReadDenied) | Some(Node::Oversized) => Ok(NodeInfo {
                kind: NodeKind::File,
                size: 0,
                modified_unix_millis: 0,
            }),
        }
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, FsError> {
        panic!("canonicalize is not expected: {path:?}");
    }

    fn read_bounded(&self, path: &Path, max_bytes: usize) -> Result<Vec<u8>, FsError> {
        assert!(self.allowed.contains(path), "unexpected read of {path:?}");
        assert!(
            !path.ends_with(".claude.json"),
            "sign-in metadata content must never be read"
        );
        match self.nodes.get(path) {
            Some(Node::File(bytes)) if bytes.len() <= max_bytes => Ok(bytes.clone()),
            Some(Node::File(_)) | Some(Node::Oversized) => Err(FsError::TooLarge),
            Some(Node::ReadDenied) => Err(FsError::PermissionDenied),
            _ => Err(FsError::NotFound),
        }
    }
}

fn definitions() -> Definitions {
    load_all().expect("aggregated definitions validate")
}

fn locations(managed: bool, project: bool) -> ClaudeLocations {
    ClaudeLocations {
        home: PathBuf::from("/fake/home"),
        project: project.then(|| PathBuf::from("/fake/proj")),
        managed_dir: managed.then(|| PathBuf::from("/fake/managed")),
    }
}

fn layer<'a>(view: &'a ClaudeReadView, id: &str) -> &'a LayerState {
    &view
        .layers
        .iter()
        .find(|layer| layer.id == id)
        .unwrap_or_else(|| panic!("{id} is reported"))
        .state
}

fn entry<'a>(view: &'a ClaudeReadView, key: &str) -> &'a crate::ai_config::read::SettingEntry {
    view.entries
        .iter()
        .find(|entry| entry.key == key)
        .unwrap_or_else(|| panic!("{key} is reported"))
}

#[test]
fn only_the_exact_claude_paths_are_touched_and_absent_files_are_missing() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![]);

    let view = read_claude_view(tool, &locations(true, true), &fs);

    assert_eq!(
        layer(&view, "claude-managed-settings"),
        &LayerState::Missing
    );
    assert_eq!(
        layer(&view, "claude-project-local-settings"),
        &LayerState::Missing
    );
    assert_eq!(
        layer(&view, "claude-project-shared-settings"),
        &LayerState::Missing
    );
    assert_eq!(layer(&view, "claude-user-settings"), &LayerState::Missing);
    assert_eq!(
        layer(&view, "claude-sign-in-metadata"),
        &LayerState::Missing
    );
    assert!(view.entries.is_empty());
}

#[test]
fn project_layers_are_not_selected_without_a_user_granted_directory() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![(HOME_SETTINGS, FakeFs::file(r#"{"model":"a"}"#))]);

    let view = read_claude_view(tool, &locations(true, false), &fs);

    assert_eq!(
        layer(&view, "claude-project-local-settings"),
        &LayerState::NotSelected
    );
    assert_eq!(
        layer(&view, "claude-project-shared-settings"),
        &LayerState::NotSelected
    );
    assert_eq!(
        entry(&view, "model").winner.as_deref(),
        Some("claude-user-settings")
    );
}

#[test]
fn missing_managed_directory_is_reported_as_not_applicable() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![]);

    let view = read_claude_view(tool, &locations(false, false), &fs);

    assert_eq!(
        layer(&view, "claude-managed-settings"),
        &LayerState::NotApplicable
    );
}

#[test]
fn managed_layer_wins_and_each_lower_layer_is_marked_overridden() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![
        (MANAGED, FakeFs::file(r#"{"model":"managed"}"#)),
        (PROJECT_LOCAL, FakeFs::file(r#"{"model":"local"}"#)),
        (PROJECT_SHARED, FakeFs::file(r#"{"model":"shared"}"#)),
        (HOME_SETTINGS, FakeFs::file(r#"{"model":"user"}"#)),
    ]);

    let view = read_claude_view(tool, &locations(true, true), &fs);
    let model = entry(&view, "model");

    assert_eq!(model.value, serde_json::json!("managed"));
    assert_eq!(model.winner.as_deref(), Some("claude-managed-settings"));
    let order: Vec<(&str, bool)> = model
        .defined_in
        .iter()
        .map(|source| (source.layer_id.as_str(), source.overridden))
        .collect();
    assert_eq!(
        order,
        vec![
            ("claude-managed-settings", false),
            ("claude-project-local-settings", true),
            ("claude-project-shared-settings", true),
            ("claude-user-settings", true),
        ]
    );
}

#[test]
fn list_keys_are_unioned_in_precedence_order_without_duplicates() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![
        (
            PROJECT_SHARED,
            FakeFs::file(r#"{"permissions":{"allow":["Bash(ls)","Read"]}}"#),
        ),
        (
            HOME_SETTINGS,
            FakeFs::file(r#"{"permissions":{"allow":["Read"]}}"#),
        ),
    ]);

    let view = read_claude_view(tool, &locations(false, true), &fs);
    let allow = entry(&view, "permissions.allow");

    assert!(allow.merged);
    assert_eq!(allow.winner, None);
    assert_eq!(allow.value, serde_json::json!(["Bash(ls)", "Read"]));
}

#[test]
fn undocumented_keys_are_kept_and_attributed_to_their_winning_layer() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![
        (PROJECT_SHARED, FakeFs::file(r#"{"customFlag":{"x":1}}"#)),
        (HOME_SETTINGS, FakeFs::file(r#"{"customFlag":{"x":2}}"#)),
    ]);

    let view = read_claude_view(tool, &locations(false, true), &fs);
    let custom = entry(&view, "customFlag");

    assert!(!custom.documented);
    assert_eq!(custom.value, serde_json::json!({"x": 1}));
    assert_eq!(
        custom.winner.as_deref(),
        Some("claude-project-shared-settings")
    );
}

#[test]
fn secret_values_are_masked_and_never_serialized() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![(
        HOME_SETTINGS,
        FakeFs::file(
            r#"{"env":{"ANTHROPIC_KEY":"sk-secret-value"},"apiToken":"tok-secret-value"}"#,
        ),
    )]);

    let view = read_claude_view(tool, &locations(false, false), &fs);
    let serialized = serde_json::to_string(&view).expect("view serializes");

    assert!(entry(&view, "env").masked);
    assert_eq!(entry(&view, "env").value, serde_json::json!("[REDACTED]"));
    assert_eq!(
        entry(&view, "apiToken").value,
        serde_json::json!("[REDACTED]")
    );
    assert!(!serialized.contains("sk-secret-value"));
    assert!(!serialized.contains("tok-secret-value"));
}

#[test]
fn malformed_json_is_a_structured_error_not_an_empty_file() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![(HOME_SETTINGS, FakeFs::file(r#"{"model":"a",}"#))]);

    let view = read_claude_view(tool, &locations(false, false), &fs);

    assert!(matches!(
        layer(&view, "claude-user-settings"),
        LayerState::Malformed { .. }
    ));
    assert!(view.entries.is_empty());
}

#[test]
fn duplicate_keys_are_rejected_with_the_key_name() {
    let error = parse_settings(br#"{"model":"a","model":"b"}"#).expect_err("duplicate key");

    assert_eq!(error, "重复键：model");
}

#[test]
fn top_level_must_be_an_object() {
    assert_eq!(
        parse_settings(b"[1,2]").expect_err("array is not settings"),
        "顶层不是 JSON 对象"
    );
}

#[test]
fn oversized_and_unreadable_files_have_distinct_states() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![
        (HOME_SETTINGS, Node::Oversized),
        (PROJECT_SHARED, Node::ReadDenied),
        (PROJECT_LOCAL, Node::StatDenied),
        (MANAGED, Node::Dir),
    ]);

    let view = read_claude_view(tool, &locations(true, true), &fs);

    assert_eq!(layer(&view, "claude-user-settings"), &LayerState::TooLarge);
    assert_eq!(
        layer(&view, "claude-project-shared-settings"),
        &LayerState::ExistsUnreadable
    );
    assert_eq!(
        layer(&view, "claude-project-local-settings"),
        &LayerState::NotReadable
    );
    assert_eq!(
        layer(&view, "claude-managed-settings"),
        &LayerState::NotRegularFile
    );
}

#[test]
fn sign_in_metadata_reports_presence_without_reading_content() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![(
        HOME_SIGN_IN,
        FakeFs::file(r#"{"token":"never-read"}"#),
    )]);

    let view = read_claude_view(tool, &locations(false, false), &fs);

    assert_eq!(
        layer(&view, "claude-sign-in-metadata"),
        &LayerState::Present
    );
    assert!(view.entries.is_empty());
}

#[test]
fn type_mismatch_against_a_stated_type_is_a_warning_and_the_value_is_kept() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");
    let fs = FakeFs::new(vec![(HOME_SETTINGS, FakeFs::file(r#"{"model":5}"#))]);

    let view = read_claude_view(tool, &locations(false, false), &fs);

    assert_eq!(entry(&view, "model").value, serde_json::json!(5));
    assert_eq!(view.warnings.len(), 1);
    assert_eq!(view.warnings[0].key, "model");
    assert_eq!(view.warnings[0].layer_id, "claude-user-settings");
}

#[test]
fn snapshot_summary_counts_every_documented_item_as_display_only() {
    let definitions = definitions();
    let tool = claude_tool(&definitions).expect("claude tool");

    let summary = snapshot_summary(tool);

    assert_eq!(summary.setting_count, 245);
    assert_eq!(summary.resource_count, 5);
    assert_eq!(summary.display_only, 250);
    assert_eq!(summary.editable, 0);
    assert_eq!(summary.unknown_value_type, 216);
    assert_eq!(
        summary.source_url,
        "https://code.claude.com/docs/en/settings"
    );
    assert_eq!(summary.retrieved_on, "2026-10-21");
    assert_eq!(summary.documented_version, "unknown");
}
