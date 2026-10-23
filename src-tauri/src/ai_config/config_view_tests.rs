use std::{fs, os::unix::fs::symlink, path::PathBuf};

use uuid::Uuid;

use crate::app_config::{discover::StdFs, registry::Registry};

use super::{
    ConfigLanguage, MAX_CONFIG_VIEW_BYTES, mask_config_text, read_prefix, read_tool_config,
    utf8_text,
};

const READ_AT: &str = "2026-10-23T00:00:00Z";

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("userhome-aiview-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("home/.claude")).expect("create fixture home");
        Self { root }
    }

    fn home(&self) -> PathBuf {
        fs::canonicalize(self.root.join("home")).expect("canonical home")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn json_secret_value_is_masked_and_structure_kept() {
    let (out, count) =
        mask_config_text("{\n  \"apiKey\": \"sk-abcdefghijkl\",\n  \"model\": \"sonnet\"\n}");

    assert_eq!(
        out,
        "{\n  \"apiKey\": \"••••••\",\n  \"model\": \"sonnet\"\n}"
    );
    assert_eq!(count, 1);
}

#[test]
fn toml_quoted_secret_is_masked() {
    let (out, count) = mask_config_text("token = \"abc123\"\nname = \"x\"");

    assert_eq!(out, "token = \"••••••\"\nname = \"x\"");
    assert_eq!(count, 1);
}

#[test]
fn unquoted_secret_drops_its_trailing_comment() {
    let (out, count) = mask_config_text("password = hunter2 # note");

    assert_eq!(out, "password = ••••••");
    assert_eq!(count, 1);
}

#[test]
fn secret_key_matches_across_separator_styles() {
    let (out, count) = mask_config_text("API-KEY: abc\napi_key = def\nx-access-key: ghi");

    assert_eq!(
        out,
        "API-KEY: ••••••\napi_key = ••••••\nx-access-key: ••••••"
    );
    assert_eq!(count, 3);
}

#[test]
fn triple_quoted_multiline_secret_masks_every_line_through_the_closer() {
    let (out, count) =
        mask_config_text("[a]\nsecret = \"\"\"\nline one\nline two\n\"\"\"\nafter = 1");

    assert_eq!(
        out,
        "[a]\nsecret = \"\"\"••••••\n••••••\n••••••\n••••••\nafter = 1"
    );
    assert_eq!(count, 1);
}

#[test]
fn nested_secret_object_masks_deeper_lines_only() {
    let (out, count) = mask_config_text(
        "{\n  \"credentials\": {\n    \"user\": \"a\",\n    \"pass\": \"b\"\n  },\n  \"x\": 1\n}",
    );

    assert_eq!(
        out,
        "{\n  \"credentials\": ••••••\n    ••••••\n    ••••••\n  },\n  \"x\": 1\n}"
    );
    assert_eq!(count, 1);
}

#[test]
fn yaml_list_item_secret_is_masked() {
    let (out, count) = mask_config_text("- token: abc123xyz");

    assert_eq!(out, "- token: ••••••");
    assert_eq!(count, 1);
}

#[test]
fn bearer_token_in_a_plain_value_is_masked_and_keeps_the_scheme() {
    let (out, count) = mask_config_text("description = \"use Bearer abcdefgh1234 now\"");

    assert_eq!(out, "description = \"use Bearer •••••• now\"");
    assert_eq!(count, 1);
}

#[test]
fn vendor_key_prefixes_are_masked_but_short_fragments_are_not() {
    let (out, count) = mask_config_text("a = ghp_abcdefghij\nb = github_pat_abcdefgh\nc = sk-ab");

    assert_eq!(out, "a = ••••••\nb = ••••••\nc = sk-ab");
    assert_eq!(count, 2);
}

#[test]
fn escaped_quote_inside_secret_does_not_leak_the_tail() {
    let (out, count) = mask_config_text("\"token\": \"a\\\"bcdef\"");

    assert_eq!(out, "\"token\": \"••••••\"");
    assert_eq!(count, 1);
}

#[test]
fn url_credentials_are_masked_in_any_value() {
    let (out, count) = mask_config_text("url = \"https://user:hunter2@example.com/x\"");

    assert!(!out.contains("hunter2"));
    assert_eq!(count, 1);
}

#[test]
fn commented_out_secret_line_is_masked() {
    let (out, count) = mask_config_text("# password = hunter2\nmodel = 1");

    assert_eq!(out, "••••••\nmodel = 1");
    assert_eq!(count, 1);
}

#[test]
fn empty_secret_and_ordinary_values_are_left_alone() {
    let (out, count) = mask_config_text("\"token\": \"\"\nmodel = \"gpt\"");

    assert_eq!(out, "\"token\": \"\"\nmodel = \"gpt\"");
    assert_eq!(count, 0);
}

#[test]
fn a_second_secret_key_on_the_same_line_is_masked() {
    let (out, count) = mask_config_text("{\"apiKey\": \"x1\", \"password\": \"hunter2\"}");

    assert_eq!(out, "{\"apiKey\": \"••••••\", \"password\": \"••••••\"}");
    assert_eq!(count, 2);
}

#[test]
fn a_secret_key_after_an_ordinary_one_on_a_single_json_line_is_masked() {
    let (out, count) = mask_config_text("{\"model\": \"sonnet\", \"token\": \"abc12345\"}");

    assert_eq!(out, "{\"model\": \"sonnet\", \"token\": \"••••••\"}");
    assert_eq!(count, 1);
}

#[test]
fn the_argument_after_a_secret_flag_is_masked_on_one_line() {
    let (out, count) =
        mask_config_text("\"args\": [\"--serve\", \"--token\", \"abc12345\", \"--port\", \"80\"]");

    assert_eq!(
        out,
        "\"args\": [\"--serve\", \"--token\", \"••••••\", \"--port\", \"80\"]"
    );
    assert_eq!(count, 1);
}

#[test]
fn the_argument_after_a_secret_flag_is_masked_across_lines() {
    let (out, count) =
        mask_config_text("\"args\": [\n  \"--api-key\",\n  \"abc12345\",\n  \"--verbose\"\n]");

    assert_eq!(
        out,
        "\"args\": [\n  \"--api-key\",\n  \"••••••\",\n  \"--verbose\"\n]"
    );
    assert_eq!(count, 1);
}

#[test]
fn a_secret_flag_with_an_inline_value_keeps_the_flag_name() {
    let (out, count) = mask_config_text("\"args\": [\"--token=abc12345\"]");

    assert_eq!(out, "\"args\": [\"--token=••••••\"]");
    assert_eq!(count, 1);
}

#[test]
fn every_value_inside_an_inline_env_table_is_masked() {
    let (out, count) = mask_config_text("env = { API_KEY = \"abc12345\", PLAIN = \"visible\" }");

    assert!(!out.contains("abc12345"));
    assert!(!out.contains("visible"));
    assert!(out.contains("API_KEY") && out.contains("PLAIN"));
    assert_eq!(count, 2);
}

#[test]
fn a_single_line_json_env_object_is_masked() {
    let (out, count) = mask_config_text("\"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"abc12345\"}");

    assert_eq!(out, "\"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"••••••\"}");
    assert_eq!(count, 1);
}

#[test]
fn every_value_inside_a_multi_line_headers_object_is_masked_whatever_its_key() {
    let (out, count) = mask_config_text(
        "{\n  \"headers\": {\n    \"X-Custom-Session\": \"sess-value-1\"\n  },\n  \"model\": \"sonnet\"\n}",
    );

    assert!(!out.contains("sess-value-1"));
    assert!(out.contains("\"model\": \"sonnet\""));
    assert!(out.contains("X-Custom-Session"));
    assert_eq!(count, 1);
}

#[test]
fn a_secret_array_value_is_masked_element_by_element() {
    let (out, count) = mask_config_text("\"tokens\": [\"first-secret\", \"second-secret\"]");

    assert!(!out.contains("first-secret"));
    assert!(!out.contains("second-secret"));
    assert!(out.contains("\"tokens\""));
    assert!(count >= 1);
}

#[test]
fn toml_env_and_headers_tables_mask_every_value() {
    let (out, count) = mask_config_text(
        "[mcp_servers.demo]\ncommand = \"npx\"\n[mcp_servers.demo.env]\nPLAIN = \"visible\"\nOTHER = 12345\n[next]\nname = \"kept\"",
    );

    assert!(!out.contains("visible"));
    assert!(!out.contains("12345"));
    assert!(out.contains("command = \"npx\""));
    assert!(out.contains("name = \"kept\""));
    assert_eq!(count, 2);
}

#[test]
fn a_yaml_env_block_masks_its_nested_values_only() {
    let (out, count) = mask_config_text("env:\n  PLAIN: visible\n  OTHER: value2\nname: kept");

    assert!(!out.contains("visible"));
    assert!(!out.contains("value2"));
    assert!(out.contains("name: kept"));
    assert_eq!(count, 2);
}

#[test]
fn crlf_line_endings_do_not_hide_a_trailing_secret() {
    let (out, count) =
        mask_config_text("{\r\n  \"model\": \"m\", \"token\": \"abc12345\"\r\n}\r\n");

    assert!(!out.contains("abc12345"));
    assert!(out.contains("\r\n"));
    assert_eq!(count, 1);
}

#[test]
fn secrets_after_multibyte_text_are_masked_without_cutting_a_character() {
    let (out, count) = mask_config_text("{\"备注\": \"中文说明\", \"password\": \"秘密值123\"}");

    assert_eq!(out, "{\"备注\": \"中文说明\", \"password\": \"••••••\"}");
    assert_eq!(count, 1);
}

#[test]
fn masking_masked_text_again_changes_nothing() {
    let input =
        "{\"apiKey\": \"x1\", \"password\": \"hunter2\", \"args\": [\"--token\", \"abc12345\"]}";
    let (once, _) = mask_config_text(input);
    let (twice, _) = mask_config_text(&once);

    assert_eq!(once, twice);
    assert!(!once.contains("hunter2") && !once.contains("abc12345"));
}

#[test]
fn urls_and_times_are_not_taken_for_key_value_pairs() {
    let (out, count) = mask_config_text("url = \"http://example.com:8080/path\"\nat = 12:30:45");

    assert_eq!(out, "url = \"http://example.com:8080/path\"\nat = 12:30:45");
    assert_eq!(count, 0);
}

#[test]
fn oversized_file_is_truncated_at_the_limit() {
    let root = Fixture::new();
    let path = root.root.join("big.json");
    fs::write(&path, vec![b'a'; MAX_CONFIG_VIEW_BYTES + 10]).expect("write big file");

    let (bytes, truncated) = read_prefix(&path, MAX_CONFIG_VIEW_BYTES).expect("read prefix");

    assert!(truncated);
    assert_eq!(bytes.len(), MAX_CONFIG_VIEW_BYTES);
}

#[test]
fn truncation_inside_a_multibyte_character_cuts_on_the_boundary() {
    let mut bytes = vec![b'a'; MAX_CONFIG_VIEW_BYTES - 1];
    bytes.extend_from_slice("é".as_bytes());
    bytes.extend_from_slice(b"tail");

    let text = utf8_text(&bytes[..MAX_CONFIG_VIEW_BYTES], true).expect("valid prefix");

    assert_eq!(text.len(), MAX_CONFIG_VIEW_BYTES - 1);
    assert!(text.ends_with('a'));
}

#[test]
fn a_cut_multibyte_character_is_rejected_when_the_file_was_not_truncated() {
    assert!(utf8_text(&[b'a', 0xc3], false).is_err());
}

#[test]
fn non_utf8_content_is_rejected() {
    assert!(utf8_text(&[0xff, 0xfe], false).is_err());
}

#[test]
fn a_directory_is_not_read_as_a_file() {
    let root = Fixture::new();

    assert!(read_prefix(&root.root.join("home/.claude"), MAX_CONFIG_VIEW_BYTES).is_err());
}

#[test]
fn missing_claude_settings_reports_absence_without_error() {
    let root = Fixture::new();
    let registry = Registry::builtin().expect("builtin registry");

    let view = read_tool_config(
        "claude-code",
        &root.home(),
        &registry,
        &StdFs,
        READ_AT.into(),
    )
    .expect("absent file is not an error");

    assert!(!view.exists);
    assert_eq!(view.content, None);
    assert_eq!(view.redacted_count, 0);
}

#[test]
fn present_claude_settings_are_returned_masked() {
    let root = Fixture::new();
    let content = "{\"apiKey\":\"sk-abcdefghijkl\",\"model\":\"sonnet\"}";
    fs::write(root.home().join(".claude/settings.json"), content).expect("write settings");
    let registry = Registry::builtin().expect("builtin registry");

    let view = read_tool_config(
        "claude-code",
        &root.home(),
        &registry,
        &StdFs,
        READ_AT.into(),
    )
    .expect("read settings");

    let shown = view.content.expect("content");
    assert!(view.exists);
    assert_eq!(view.language, ConfigLanguage::Json);
    assert!(!shown.contains("abcdefghijkl"));
    assert!(shown.contains("sonnet"));
    assert_eq!(view.redacted_count, 1);
    assert!(!view.truncated);
    assert_eq!(view.size_bytes, Some(content.len() as u64));
}

#[test]
fn symlinked_settings_are_refused() {
    let root = Fixture::new();
    fs::write(root.root.join("elsewhere.json"), "{}").expect("write target");
    symlink(
        root.root.join("elsewhere.json"),
        root.home().join(".claude/settings.json"),
    )
    .expect("create symlink");
    let registry = Registry::builtin().expect("builtin registry");

    assert!(
        read_tool_config(
            "claude-code",
            &root.home(),
            &registry,
            &StdFs,
            READ_AT.into()
        )
        .is_err()
    );
}

#[test]
fn unknown_and_unregistered_tools_are_invalid_input() {
    let root = Fixture::new();
    let registry = Registry::builtin().expect("builtin registry");

    for tool_id in ["no-such-tool", "codex-cli", "copilot-cli"] {
        assert!(
            read_tool_config(tool_id, &root.home(), &registry, &StdFs, READ_AT.into()).is_err(),
            "{tool_id} must be refused"
        );
    }
}
