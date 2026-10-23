use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use super::{
    edit::{EditMode, FieldChange, PreviewInput, preview, read_for_edit},
    patch::{
        Change, Lookup, Scalar, UNSAFE_LOCATION, apply_change, check_raw, lookup, raw_secret_present,
        scalar_value,
    },
    patch_ini::ini_check,
    patch_toml::toml_check,
    pending::{AppConfigEditState, PendingEdit},
    registry::{Capability, Entry, Format, Registry},
    schema::{FieldKind, FieldSpec, TypedValue, schema_for, typed_value},
    test_support::FakeFs,
};
use crate::{config::{diff::unified_text, read::hash_bytes}, error::AppErrorCode};

const HOME: &str = "/Users/example";
const WRITABLE: [&str; 4] = ["git-config-home", "git-config-xdg", "alacritty-config", "zed-settings"];

fn entry(id: &str) -> Entry {
    *Registry::builtin()
        .expect("built-in registry is valid")
        .get(id)
        .expect("entry is registered")
}

fn field(id: &str, path: &str) -> FieldSpec {
    let format = entry(id).format;
    *schema_for(id, format)
        .expect("writable entry has a schema")
        .fields
        .iter()
        .find(|field| field.path == path)
        .expect("field is in schema")
}

fn set(format: Format, text: &str, path: &str, value: TypedValue) -> String {
    apply_change(format, text, path, &Change::Set(value)).expect("patch applies")
}

fn text(value: &str) -> TypedValue {
    TypedValue::Text(value.to_owned())
}

/// Number of lines whose text differs; the line count must not change.
fn changed_lines(before: &str, after: &str) -> usize {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();
    assert_eq!(old.len(), new.len(), "line count changed");
    old.iter().zip(&new).filter(|(a, b)| a != b).count()
}

#[test]
fn writable_entries_each_have_a_schema_and_no_other_entry_does() {
    let registry = Registry::builtin().expect("built-in registry is valid");
    for entry in registry.entries() {
        let schema = schema_for(entry.id, entry.format);
        if entry.capability == Capability::Writable {
            assert!(schema.is_some(), "{}", entry.id);
        } else {
            assert!(schema.is_none(), "{}", entry.id);
        }
    }
    let writable: Vec<&str> = registry
        .entries()
        .iter()
        .filter(|entry| entry.capability == Capability::Writable)
        .map(|entry| entry.id)
        .collect();
    assert_eq!(writable, WRITABLE);
}

#[test]
fn schema_field_paths_are_unique_and_constraints_are_well_formed() {
    for id in WRITABLE {
        let schema = schema_for(id, entry(id).format).expect("writable");
        let mut paths: Vec<&str> = Vec::new();
        for field in schema.fields {
            assert!(!paths.contains(&field.path), "duplicate {}", field.path);
            paths.push(field.path);
            assert!(!field.sensitive, "{}", field.path);
            assert!(!field.label.is_empty() && !field.description.is_empty(), "{}", field.path);
            match field.kind {
                FieldKind::Enum => assert!(!field.enum_values.is_empty(), "{}", field.path),
                _ => assert!(field.enum_values.is_empty(), "{}", field.path),
            }
            if let (Some(min), Some(max)) = (field.min, field.max) {
                assert!(min <= max, "{}", field.path);
            }
        }
    }
}

#[test]
fn pilot_field_paths_match_the_reviewed_list() {
    let git: Vec<&str> = schema_for("git-config-home", Format::Ini)
        .expect("writable")
        .fields
        .iter()
        .map(|field| field.path)
        .collect();
    assert_eq!(
        git,
        [
            "user.name",
            "user.email",
            "init.defaultBranch",
            "core.editor",
            "core.autocrlf",
            "pull.rebase",
            "push.autoSetupRemote",
            "fetch.prune",
            "commit.gpgsign",
            "color.ui"
        ]
    );
    let alacritty: Vec<&str> = schema_for("alacritty-config", Format::Toml)
        .expect("writable")
        .fields
        .iter()
        .map(|field| field.path)
        .collect();
    assert_eq!(
        alacritty,
        [
            "window.opacity",
            "window.decorations",
            "font.size",
            "font.normal.family",
            "scrolling.history",
            "cursor.style.shape"
        ]
    );
}

#[test]
fn zed_schema_is_advanced_only() {
    let schema = schema_for("zed-settings", Format::Jsonc).expect("writable");
    assert!(!schema.visual_supported);
    assert!(schema.advanced_supported);
    assert!(schema.fields.is_empty());
}

#[test]
fn typed_value_enforces_each_field_kind_and_range() {
    let email = field("git-config-home", "user.email");
    assert_eq!(typed_value(&email, &json!("ada@example.com")), Ok(text("ada@example.com")));
    assert!(typed_value(&email, &json!("not-an-email")).is_err());
    assert!(typed_value(&email, &json!("a@b c")).is_err());

    let branch = field("git-config-home", "init.defaultBranch");
    assert!(typed_value(&branch, &json!("main/x")).is_ok());
    assert!(typed_value(&branch, &json!("a b")).is_err());

    let name = field("git-config-home", "user.name");
    assert!(typed_value(&name, &json!("   ")).is_err());
    assert!(typed_value(&name, &json!("a\u{7}b")).is_err());
    assert!(typed_value(&name, &json!(3)).is_err());

    let rebase = field("git-config-home", "pull.rebase");
    assert_eq!(typed_value(&rebase, &json!(true)), Ok(TypedValue::Bool(true)));
    assert!(typed_value(&rebase, &json!("true")).is_err());

    let decorations = field("alacritty-config", "window.decorations");
    assert!(typed_value(&decorations, &json!("Full")).is_ok());
    assert!(typed_value(&decorations, &json!("Blur")).is_err());

    let opacity = field("alacritty-config", "window.opacity");
    assert!(typed_value(&opacity, &json!(0.5)).is_ok());
    assert!(typed_value(&opacity, &json!(1.5)).is_err());

    let history = field("alacritty-config", "scrolling.history");
    assert_eq!(typed_value(&history, &json!(10)), Ok(TypedValue::Integer(10)));
    assert!(typed_value(&history, &json!(1.5)).is_err());
    assert!(typed_value(&history, &json!(100001)).is_err());
}

#[test]
fn ini_replacing_one_value_changes_exactly_that_line_and_keeps_comments() {
    let before = "# 我的配置\n[user]\n\tname = Ada  ; 作者\n\temail = ada@example.com\n";
    let after = set(Format::Ini, before, "user.name", text("Grace"));
    assert_eq!(
        after,
        "# 我的配置\n[user]\n\tname = Grace  ; 作者\n\temail = ada@example.com\n"
    );
    assert_eq!(changed_lines(before, after.as_str()), 1);
}

#[test]
fn ini_new_key_goes_to_the_end_of_its_section_with_matching_indent() {
    let before = "[user]\n  name = Ada\n[core]\n\teditor = vim\n";
    let after = set(Format::Ini, before, "user.email", text("ada@example.com"));
    assert_eq!(
        after,
        "[user]\n  name = Ada\n  email = ada@example.com\n[core]\n\teditor = vim\n"
    );
}

#[test]
fn ini_missing_section_is_appended_and_missing_final_newline_is_kept() {
    let before = "[core]\n\teditor = vim";
    let after = set(Format::Ini, before, "init.defaultBranch", text("main"));
    assert_eq!(after, "[core]\n\teditor = vim\n\n[init]\n\tdefaultBranch = main");
}

#[test]
fn ini_keeps_crlf_line_endings_when_replacing() {
    let before = "[user]\r\n\tname = Ada\r\n";
    let after = set(Format::Ini, before, "user.name", text("Grace"));
    assert_eq!(after, "[user]\r\n\tname = Grace\r\n");
}

#[test]
fn ini_value_needing_quotes_is_quoted_and_reads_back_intact() {
    let after = set(Format::Ini, "[core]\n", "core.editor", text("code --wait # x"));
    assert_eq!(after, "[core]\n\teditor = \"code --wait # x\"\n");
    assert_eq!(
        lookup(Format::Ini, &after, "core.editor"),
        Lookup::Present(Some(Scalar::Text("code --wait # x".to_owned())))
    );
}

#[test]
fn ini_delete_removes_only_the_key_line() {
    let before = "[user]\n\tname = Ada\n\temail = a@b.c\n";
    let after = apply_change(Format::Ini, before, "user.name", &Change::Delete).expect("delete");
    assert_eq!(after, "[user]\n\temail = a@b.c\n");
}

#[test]
fn ini_bare_key_gets_an_explicit_value_when_replaced() {
    let before = "[pull]\n\trebase\n";
    let after = set(Format::Ini, before, "pull.rebase", TypedValue::Bool(true));
    assert_eq!(after, "[pull]\n\trebase = true\n");
}

#[test]
fn toml_replacing_a_table_value_keeps_comments_and_other_lines() {
    let before = "# alacritty\n[window]\nopacity = 1.0 # 默认\n\n[font]\nsize = 11\n";
    let after = set(Format::Toml, before, "window.opacity", TypedValue::Number(0.9));
    assert_eq!(
        after,
        "# alacritty\n[window]\nopacity = 0.9 # 默认\n\n[font]\nsize = 11\n"
    );
    assert_eq!(changed_lines(before, after.as_str()), 1);
}

#[test]
fn toml_whole_number_is_written_with_a_decimal_point() {
    let after = set(Format::Toml, "[window]\nopacity = 0.5\n", "window.opacity", TypedValue::Number(1.0));
    assert_eq!(after, "[window]\nopacity = 1.0\n");
}

#[test]
fn toml_missing_table_is_appended_at_the_end() {
    let before = "[window]\nopacity = 1.0\n";
    let after = set(Format::Toml, before, "font.normal.family", text("JetBrains Mono"));
    assert_eq!(
        after,
        "[window]\nopacity = 1.0\n\n[font.normal]\nfamily = \"JetBrains Mono\"\n"
    );
}

#[test]
fn toml_root_key_is_inserted_before_the_first_table() {
    let after = apply_change(
        Format::Toml,
        "[window]\nopacity = 1.0\n",
        "title",
        &Change::Set(text("x")),
    )
    .expect("root insert");
    assert_eq!(after, "title = \"x\"\n[window]\nopacity = 1.0\n");
}

#[test]
fn toml_multiline_array_does_not_confuse_the_scanner() {
    let before = "[colors]\nlist = [\n  \"a\",\n  \"b\",\n]\n[window]\nopacity = 1.0\n";
    let after = set(Format::Toml, before, "window.opacity", TypedValue::Number(0.5));
    assert_eq!(after, before.replace("opacity = 1.0", "opacity = 0.5"));
    assert_eq!(changed_lines(before, after.as_str()), 1);
}

#[test]
fn toml_inline_table_value_is_refused_with_the_advanced_mode_message() {
    let result = apply_change(
        Format::Toml,
        "[window]\nopacity = { value = 1 }\n",
        "window.opacity",
        &Change::Set(TypedValue::Number(0.5)),
    );
    assert_eq!(result, Err(UNSAFE_LOCATION.to_owned()));
}

#[test]
fn toml_dotted_key_that_defines_the_target_is_refused() {
    let result = apply_change(
        Format::Toml,
        "window.opacity = 1.0\n[window]\n",
        "window.opacity",
        &Change::Set(TypedValue::Number(0.5)),
    );
    assert_eq!(result, Err(UNSAFE_LOCATION.to_owned()));
}

#[test]
fn toml_read_returns_typed_scalars_for_nested_tables() {
    let text_file = "[font.normal]\nfamily = \"Iosevka\"\n[window]\ndecorations = 'Full'\nopacity = 0.9\n";
    assert_eq!(
        lookup(Format::Toml, text_file, "font.normal.family"),
        Lookup::Present(Some(Scalar::Text("Iosevka".to_owned())))
    );
    assert_eq!(
        lookup(Format::Toml, text_file, "window.decorations"),
        Lookup::Present(Some(Scalar::Text("Full".to_owned())))
    );
    let opacity = field("alacritty-config", "window.opacity");
    let Lookup::Present(Some(scalar)) = lookup(Format::Toml, text_file, "window.opacity") else {
        panic!("opacity present");
    };
    assert_eq!(scalar_value(&opacity, &scalar), Some(json!(0.9)));
}

#[test]
fn ini_and_toml_line_checks_report_the_offending_line() {
    assert!(ini_check("[user]\n\tname = Ada\n").is_ok());
    assert_eq!(ini_check("name = Ada\n").unwrap_err().line, Some(1));
    assert_eq!(ini_check("[user]\n\tname = \"Ada\n").unwrap_err().line, Some(2));

    assert!(toml_check("[a]\nb = \"x\"\n# c\n").is_ok());
    assert_eq!(toml_check("[a]\nb = \"x\"\nthis is wrong\n").unwrap_err().line, Some(3));
    assert!(toml_check("[a]\nlist = [\n 1,\n").unwrap_err().line.is_none());
}

#[test]
fn jsonc_check_accepts_comments_and_rejects_non_objects() {
    assert!(check_raw(Format::Jsonc, "{\n  // 注释\n  \"theme\": \"dark\"\n}\n").is_ok());
    assert!(check_raw(Format::Jsonc, "{ \"theme\": ").is_err());
    assert!(check_raw(Format::Jsonc, "[1]").is_err());
}

#[test]
fn raw_secret_detection_finds_url_credentials_and_secret_names() {
    assert!(raw_secret_present(
        Format::Ini,
        "[remote \"origin\"]\n\turl = https://ada:hunter2@example.com/r.git\n"
    ));
    assert!(!raw_secret_present(Format::Ini, "[user]\n\tname = Ada\n"));
    assert!(raw_secret_present(Format::Jsonc, "{\"password\": \"abc\"}"));
}

#[test]
fn unified_text_of_one_changed_line_has_one_removed_and_one_added_line() {
    let diff = unified_text("a\nb\nc\n", "a\nB\nc\n");
    let body: Vec<&str> = diff
        .lines()
        .filter(|line| !line.starts_with("---") && !line.starts_with("+++") && !line.starts_with("@@"))
        .collect();
    assert_eq!(body, vec!["-b", "+B"]);
    assert_eq!(unified_text("a\n", "a\n"), "");
}

fn pending_edit(token: &str, created: Instant) -> PendingEdit {
    PendingEdit {
        token: token.to_owned(),
        entry_id: "git-config-home",
        path: PathBuf::from("/Users/example/.gitconfig"),
        exists: true,
        before_hash: "hash".to_owned(),
        proposed: "proposed".to_owned(),
        created,
    }
}

#[test]
fn preview_token_is_single_use() {
    let state = AppConfigEditState::default();
    let now = Instant::now();
    state.remember_at(pending_edit("t1", now), now).expect("stored");
    assert!(state.take_at("t1", now).is_ok());
    assert_eq!(
        state.take_at("t1", now).map(|edit| edit.token).unwrap_err().code(),
        AppErrorCode::NotFound
    );
}

#[test]
fn preview_token_expires_after_ten_minutes() {
    let state = AppConfigEditState::default();
    let created = Instant::now();
    state.remember_at(pending_edit("t", created), created).expect("stored");
    let later = created + Duration::from_secs(601);
    assert!(state.take_at("t", later).is_err());
}

#[test]
fn preview_store_keeps_at_most_eight_entries() {
    let state = AppConfigEditState::default();
    let now = Instant::now();
    for index in 0..9 {
        state
            .remember_at(pending_edit(&format!("t{index}"), now), now)
            .expect("stored");
    }
    assert!(state.take_at("t0", now).is_err());
    assert!(state.take_at("t8", now).is_ok());
}

fn gitconfig(content: &str) -> FakeFs {
    FakeFs::new().dir(HOME).file("/Users/example/.gitconfig", content)
}

fn fields_input(hash: &str, changes: Vec<FieldChange>) -> PreviewInput {
    PreviewInput {
        id: "git-config-home".to_owned(),
        mode: EditMode::Fields,
        changes,
        raw_text: None,
        expected_hash: hash.to_owned(),
    }
}

fn change(path: &str, value: Value) -> FieldChange {
    FieldChange {
        path: path.to_owned(),
        value,
    }
}

#[test]
fn preview_of_one_field_returns_a_one_line_diff_and_a_token() {
    let content = "[user]\n\tname = Ada\n";
    let fs = gitconfig(content);
    let state = AppConfigEditState::default();
    let input = fields_input(
        &hash_bytes(content.as_bytes()),
        vec![change("user.name", json!("Grace"))],
    );

    let result = preview(&entry("git-config-home"), Path::new(HOME), &fs, &state, &input)
        .expect("preview succeeds");

    assert!(result.ok);
    assert!(result.preview_token.is_some());
    let removed = result
        .diff
        .lines()
        .filter(|line| line.starts_with('-') && !line.starts_with("---"))
        .count();
    let added = result
        .diff
        .lines()
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .count();
    assert_eq!((removed, added), (1, 1));
}

#[test]
fn preview_rejects_invalid_values_and_fields_outside_the_schema() {
    let content = "[user]\n\tname = Ada\n";
    let fs = gitconfig(content);
    let state = AppConfigEditState::default();
    let hash = hash_bytes(content.as_bytes());

    let invalid = preview(
        &entry("git-config-home"),
        Path::new(HOME),
        &fs,
        &state,
        &fields_input(&hash, vec![change("user.email", json!("not-an-email"))]),
    )
    .expect("validation returns a result, not an error");
    assert!(!invalid.ok);
    assert_eq!(invalid.errors[0].path.as_deref(), Some("user.email"));
    assert!(invalid.preview_token.is_none());

    let outside = preview(
        &entry("git-config-home"),
        Path::new(HOME),
        &fs,
        &state,
        &fields_input(&hash, vec![change("credential.helper", json!("store"))]),
    )
    .expect("validation returns a result");
    assert!(!outside.ok);
    assert_eq!(outside.errors[0].path.as_deref(), Some("credential.helper"));
}

#[test]
fn preview_with_a_stale_hash_is_a_conflict() {
    let fs = gitconfig("[user]\n\tname = Ada\n");
    let state = AppConfigEditState::default();
    let error = preview(
        &entry("git-config-home"),
        Path::new(HOME),
        &fs,
        &state,
        &fields_input("stale", vec![change("user.name", json!("Grace"))]),
    )
    .expect_err("stale hash conflicts");
    assert_eq!(error.code(), AppErrorCode::Conflict);
}

#[test]
fn preview_without_changes_reports_nothing_to_save() {
    let content = "[user]\n\tname = Ada\n";
    let fs = gitconfig(content);
    let state = AppConfigEditState::default();
    let result = preview(
        &entry("git-config-home"),
        Path::new(HOME),
        &fs,
        &state,
        &fields_input(&hash_bytes(content.as_bytes()), Vec::new()),
    )
    .expect("preview returns a result");
    assert!(!result.ok);
    assert!(result.preview_token.is_none());
}

#[test]
fn preview_refuses_the_visual_mode_for_zed() {
    let content = "{ \"theme\": \"dark\" }";
    let fs = FakeFs::new()
        .dir(HOME)
        .file("/Users/example/.config/zed/settings.json", content);
    let state = AppConfigEditState::default();
    let input = PreviewInput {
        id: "zed-settings".to_owned(),
        mode: EditMode::Fields,
        changes: vec![change("theme", json!("light"))],
        raw_text: None,
        expected_hash: hash_bytes(content.as_bytes()),
    };
    let result = preview(&entry("zed-settings"), Path::new(HOME), &fs, &state, &input)
        .expect("preview returns a result");
    assert!(!result.ok);
    assert!(result.errors[0].path.is_none());
}

#[test]
fn read_for_edit_returns_schema_values_and_the_raw_text() {
    let fs = gitconfig("[user]\n\tname = Ada\n");
    let read = read_for_edit(&entry("git-config-home"), Path::new(HOME), &fs).expect("reads");

    let name = read.fields.iter().find(|f| f.path == "user.name").expect("field");
    assert!(name.present);
    assert_eq!(name.value, Some(json!("Ada")));
    let email = read.fields.iter().find(|f| f.path == "user.email").expect("field");
    assert!(!email.present);
    assert_eq!(read.raw_text.as_deref(), Some("[user]\n\tname = Ada\n"));
    assert!(read.raw_blocked_reason.is_none());
}

#[test]
fn read_for_edit_blocks_raw_text_that_holds_a_secret() {
    let fs = gitconfig("[remote \"origin\"]\n\turl = https://ada:hunter2@example.com/r.git\n");
    let read = read_for_edit(&entry("git-config-home"), Path::new(HOME), &fs).expect("reads");
    assert!(read.raw_text.is_none());
    assert_eq!(
        read.raw_blocked_reason,
        Some("文件里有疑似秘密的值，请用外部编辑器修改。")
    );
}

#[test]
fn read_for_edit_hides_a_visual_value_that_looks_secret() {
    let fs = gitconfig("[user]\n\tname = https://ada:hunter2@host\n");
    let read = read_for_edit(&entry("git-config-home"), Path::new(HOME), &fs).expect("reads");
    let name = read.fields.iter().find(|f| f.path == "user.name").expect("field");
    assert!(name.present);
    assert!(name.value.is_none());
}

#[test]
fn read_for_edit_of_a_missing_file_allows_creation_with_empty_defaults() {
    let fs = FakeFs::new().dir(HOME);
    let read = read_for_edit(&entry("git-config-home"), Path::new(HOME), &fs).expect("reads");
    assert!(read.fields.iter().all(|f| !f.present && f.value.is_none()));
    assert_eq!(read.raw_text.as_deref(), Some(""));
    assert_eq!(read.hash, hash_bytes(b""));
}

#[test]
fn read_for_edit_refuses_creation_when_the_parent_directory_is_missing() {
    let fs = FakeFs::new().dir(HOME);
    let error = read_for_edit(&entry("git-config-xdg"), Path::new(HOME), &fs)
        .expect_err("parent directory is missing");
    assert_eq!(error.code(), AppErrorCode::NotFound);
}

#[test]
fn read_for_edit_refuses_entries_that_are_not_writable() {
    let fs = FakeFs::new().dir(HOME);
    let error = read_for_edit(&entry("claude-code-settings"), Path::new(HOME), &fs)
        .expect_err("not writable");
    assert_eq!(error.code(), AppErrorCode::NotSupported);
}

#[test]
fn fields_are_typed_values_for_scalar_kinds_used_in_reads() {
    let scalar = Scalar::Text("true".to_owned());
    let pull = field("git-config-home", "pull.rebase");
    assert_eq!(scalar_value(&pull, &scalar), Some(json!(true)));
    assert!(matches!(lookup(Format::Ini, "[pull]\n\trebase = yes\n", "pull.rebase"), Lookup::Present(_)));
}
