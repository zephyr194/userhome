use std::path::Path;

use serde_json::Value;

use crate::grants::DEFAULT_MAX_READ_BYTES;

use super::{
    discover::{FileMeta, ProbeStatus},
    read::{
        ContentView, ParseWarning, ReadFailure, ReadResult, is_secret_key, mask_url_credentials,
        read_entry,
    },
    registry::{Capability, Entry, Format, Registry, resolve_path},
    test_support::FakeFs,
};

const HOME: &str = "/Users/example";

fn builtin(id: &str) -> Entry {
    *Registry::builtin()
        .expect("built-in registry is valid")
        .get(id)
        .expect("entry is registered")
}

fn read(entry: &Entry, fs: &FakeFs) -> ReadResult {
    read_entry(entry, Path::new(HOME), fs)
}

fn content(result: ReadResult) -> ContentView {
    match result {
        ReadResult::Content { view } => view,
        other => panic!("expected content, got {other:?}"),
    }
}

fn serialized(result: &ReadResult) -> String {
    serde_json::to_string(result).expect("result serializes")
}

#[test]
fn json_settings_are_masked_and_env_values_are_always_withheld() {
    let fs = FakeFs::new().dir(HOME).file(
        "/Users/example/.claude/settings.json",
        r#"{"model":"opus","apiKeyHelper":"/bin/helper","env":{"ANTHROPIC_BASE_URL":"https://gw.example"},"permissions":{"allow":["Bash(ls)"]}}"#,
    );

    let view = content(read(&builtin("claude-code-settings"), &fs));

    assert!(view.text.contains("\"opus\""));
    assert!(view.text.contains("Bash(ls)"));
    assert!(!view.text.contains("/bin/helper"));
    assert!(!view.text.contains("gw.example"));
    assert!(view.redacted);
    assert!(view.warnings.is_empty());
}

#[test]
fn json_secret_keys_are_masked_inside_arrays_of_objects() {
    let fs = FakeFs::new().dir(HOME).file(
        "/Users/example/.claude/settings.json",
        r#"{"servers":[{"name":"ci","token":"tok-in-array"}]}"#,
    );

    let view = content(read(&builtin("claude-code-settings"), &fs));

    assert!(view.text.contains("\"ci\""));
    assert!(view.text.contains("[REDACTED]"));
    assert!(!view.text.contains("tok-in-array"));
}

#[test]
fn json_parse_failure_is_reported_as_parse_error_not_an_empty_document() {
    let fs = FakeFs::new().dir(HOME).file(
        "/Users/example/.claude/settings.json",
        r#"{"apiKey":"sk-leak-in-broken-json""#,
    );

    let result = read(&builtin("claude-code-settings"), &fs);

    assert_eq!(
        result,
        ReadResult::Failed {
            kind: ReadFailure::ParseError,
        }
    );
    assert!(!serialized(&result).contains("sk-leak"));
}

#[test]
fn jsonc_comments_are_dropped_and_url_passwords_are_masked() {
    let fs = FakeFs::new().dir(HOME).file(
        "/Users/example/.config/zed/settings.json",
        "// leaked-comment-text\n{\n  \"theme\": \"One Dark\",\n  \"github_token\": \"ghp_realsecret\",\n  \"url\": \"https://user:hunter2@host.example/path\",\n}\n",
    );

    let view = content(read(&builtin("zed-settings"), &fs));

    assert!(view.text.contains("One Dark"));
    assert!(
        view.text
            .contains("https://user:[REDACTED]@host.example/path")
    );
    assert!(!view.text.contains("ghp_realsecret"));
    assert!(!view.text.contains("hunter2"));
    assert!(!view.text.contains("leaked-comment-text"));
}

#[test]
fn ini_view_masks_secret_keys_urls_and_inline_comments_and_reports_unknown_lines() {
    let fs = FakeFs::new().dir(HOME).file(
        "/Users/example/.gitconfig",
        "[user]\n\tname = Ada\n\temail = ada@example.com\n[remote \"origin\"]\n\turl = https://ada:hunter2@example.com/repo.git\n[core]\n\teditor = vim ; leaked-inline-comment\n# leaked-comment hunter2\n[credential]\n\thelper = store\n\tapiToken = abc123\noops line here\n",
    );

    let view = content(read(&builtin("git-config-home"), &fs));

    assert!(view.text.contains("Ada"));
    assert!(view.text.contains("editor = vim"));
    assert!(!view.text.contains("leaked-inline-comment"));
    assert!(
        view.text
            .contains("https://ada:[REDACTED]@example.com/repo.git")
    );
    assert!(!view.text.contains("hunter2"));
    assert!(!view.text.contains("abc123"));
    assert!(!view.text.contains("leaked-comment"));
    assert_eq!(view.withheld_lines, 2);
    assert_eq!(
        view.warnings,
        vec![ParseWarning {
            line: 12,
            message: "无法识别的行，内容未显示",
        }]
    );
}

#[test]
fn toml_view_keeps_quoted_hashes_drops_comments_and_masks_inline_secret_tables() {
    let fs = FakeFs::new().dir(HOME).file(
        "/Users/example/.config/alacritty/alacritty.toml",
        "[env]\nTERM = \"xterm-256color\"\nGITHUB_TOKEN = \"ghp_secret\"\n[colors]\nbackground = \"#1d1f21\" # leaked-comment\n[[keyboard.bindings]]\nkey = \"V\"\nmulti = \"\"\"\nline one\n\"\"\"\ninline = { API_TOKEN = \"t123\" }\n",
    );

    let view = content(read(&builtin("alacritty-config"), &fs));

    assert!(view.text.contains("xterm-256color"));
    assert!(view.text.contains("\"#1d1f21\""));
    assert!(!view.text.contains("leaked-comment"));
    assert!(!view.text.contains("ghp_secret"));
    assert!(!view.text.contains("t123"));
    assert_eq!(
        view.warnings
            .iter()
            .map(|warning| warning.line)
            .collect::<Vec<_>>(),
        vec![9, 10]
    );
}

#[test]
fn fixed_ssh_config_is_read_bounded_and_masked_without_any_grant() {
    let fs = FakeFs::new().file(
        "/etc/ssh/ssh_config",
        "# leaked-comment hunter2\nHost *\n  SendEnv LANG LC_*\n  HttpProxy http://u:p@proxy.example:3128\n",
    );

    let view = content(read(&builtin("ssh-system-config"), &fs));

    assert!(view.text.contains("Host *"));
    assert!(view.text.contains("SendEnv LANG LC_*"));
    assert!(view.text.contains("http://u:[REDACTED]@proxy.example:3128"));
    assert!(!view.text.contains("u:p@"));
    assert!(!view.text.contains("leaked-comment"));
    assert_eq!(view.withheld_lines, 1);
}

#[test]
fn missing_file_is_unavailable_with_not_found_status() {
    let fs = FakeFs::new().dir(HOME);

    assert_eq!(
        read(&builtin("claude-code-settings"), &fs),
        ReadResult::Unavailable {
            status: ProbeStatus::NotFound,
        }
    );
}

#[test]
fn permission_denied_file_is_unavailable_and_never_empty() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file("/Users/example/.claude/settings.json", "{}")
        .denied("/Users/example/.claude/settings.json");

    assert_eq!(
        read(&builtin("claude-code-settings"), &fs),
        ReadResult::Unavailable {
            status: ProbeStatus::Inaccessible,
        }
    );
}

#[test]
fn symlink_inside_home_is_reported_and_never_opened() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file(
            "/Users/example/dotfiles/settings.json",
            "{\"model\":\"opus\"}",
        )
        .symlink(
            "/Users/example/.claude/settings.json",
            "/Users/example/dotfiles/settings.json",
        )
        .forbid_reads();

    assert_eq!(
        read(&builtin("claude-code-settings"), &fs),
        ReadResult::Unavailable {
            status: ProbeStatus::SymlinkOrNonRegular,
        }
    );
}

#[test]
fn symlink_escaping_home_is_out_of_bounds_and_never_opened() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file("/etc/passwd", "root:x:0:0\n")
        .symlink("/Users/example/.claude/settings.json", "/etc/passwd")
        .forbid_reads();

    assert_eq!(
        read(&builtin("claude-code-settings"), &fs),
        ReadResult::Unavailable {
            status: ProbeStatus::OutOfBounds,
        }
    );
}

#[test]
fn same_prefix_sibling_directory_is_out_of_bounds_and_never_opened() {
    let fs = FakeFs::new()
        .dir("/Users/ab")
        .symlink("/Users/ab/.claude", "/Users/abc/claude")
        .file("/Users/abc/claude/settings.json", "{\"model\":\"opus\"}")
        .forbid_reads();

    assert_eq!(
        read_entry(
            &builtin("claude-code-settings"),
            Path::new("/Users/ab"),
            &fs
        ),
        ReadResult::Unavailable {
            status: ProbeStatus::OutOfBounds,
        }
    );
}

#[test]
fn a_file_larger_than_the_limit_is_too_large_without_being_read() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file_bytes(
            "/Users/example/.gitconfig",
            vec![b'#'; DEFAULT_MAX_READ_BYTES + 1],
            1,
        )
        .forbid_reads();

    assert_eq!(
        read(&builtin("git-config-home"), &fs),
        ReadResult::Failed {
            kind: ReadFailure::TooLarge,
        }
    );
}

#[test]
fn a_file_exactly_at_the_limit_is_still_read() {
    let fs = FakeFs::new().dir(HOME).file_bytes(
        "/Users/example/.gitconfig",
        vec![b'#'; DEFAULT_MAX_READ_BYTES],
        1,
    );

    let view = content(read(&builtin("git-config-home"), &fs));

    assert_eq!(view.withheld_lines, 1);
}

#[test]
fn invalid_utf8_text_is_a_parse_error() {
    let fs = FakeFs::new().dir(HOME).file_bytes(
        "/Users/example/.gitconfig",
        vec![b'[', b'u', 0xff, 0xfe, b']', b'\n'],
        1,
    );

    assert_eq!(
        read(&builtin("git-config-home"), &fs),
        ReadResult::Failed {
            kind: ReadFailure::ParseError,
        }
    );
}

#[test]
fn credential_files_return_metadata_only_and_their_content_is_never_read() {
    let mut fs = FakeFs::new().dir(HOME).forbid_reads();
    let content_line = "https://ada:hunter2@github.com\n";
    for id in ["git-credentials", "npmrc", "pnpm-auth-ini", "docker-config"] {
        let path = resolve_path(&builtin(id), Path::new(HOME));
        let path = path.to_string_lossy().into_owned();
        fs = fs.file_bytes(&path, content_line.as_bytes().to_vec(), 9);
    }

    for id in ["git-credentials", "npmrc", "pnpm-auth-ini", "docker-config"] {
        let result = read(&builtin(id), &fs);
        assert_eq!(
            result,
            ReadResult::MetadataOnly {
                meta: FileMeta {
                    size: content_line.len() as u64,
                    modified_unix_millis: 9,
                },
            },
            "{id} must not be read"
        );
        assert!(!serialized(&result).contains("hunter2"));
    }
}

#[test]
fn metadata_only_entries_return_discovered_size_and_mtime_without_content() {
    let mut fs = FakeFs::new().dir(HOME).forbid_reads();
    for id in ["ghostty-config", "tmux-conf", "neovim-init"] {
        let path = resolve_path(&builtin(id), Path::new(HOME))
            .to_string_lossy()
            .into_owned();
        fs = fs.file(&path, "token = \"leaked-in-metadata-entry\"\n");
    }

    for id in ["ghostty-config", "tmux-conf", "neovim-init"] {
        let result = read(&builtin(id), &fs);
        assert!(
            matches!(result, ReadResult::MetadataOnly { .. }),
            "{id} must be metadata only"
        );
        assert!(!serialized(&result).contains("leaked-in-metadata-entry"));
    }
}

#[test]
fn unsupported_formats_and_non_read_only_capabilities_return_metadata_only() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file("/Users/example/.claude/settings.json", "token=x\n")
        .forbid_reads();
    let claude = builtin("claude-code-settings");

    let plist = Entry {
        format: Format::Plist,
        ..claude
    };
    let writable = Entry {
        capability: Capability::Writable,
        ..claude
    };

    assert!(matches!(read(&plist, &fs), ReadResult::MetadataOnly { .. }));
    assert!(matches!(
        read(&writable, &fs),
        ReadResult::MetadataOnly { .. }
    ));
}

#[test]
fn secret_key_heuristic_matches_credential_names_and_not_ordinary_settings() {
    for key in [
        "token",
        "API_TOKEN",
        "apiToken",
        "api-key",
        "apiKey",
        "password",
        "Password",
        "db_passwd",
        "clientSecret",
        "credential",
        "gitCredentialStore",
        "privateKey",
        "auth",
    ] {
        assert!(is_secret_key(key), "{key} should be masked");
    }
    for key in [
        "theme",
        "model",
        "fontSize",
        "name",
        "email",
        "url",
        "defaultBranch",
    ] {
        assert!(!is_secret_key(key), "{key} should be shown");
    }
}

#[test]
fn url_masking_replaces_only_the_password_in_the_userinfo() {
    assert_eq!(
        mask_url_credentials("https://u:p@h/x"),
        ("https://u:[REDACTED]@h/x".to_owned(), true)
    );
    assert_eq!(
        mask_url_credentials("https://a:b@c and http://d:e@f"),
        (
            "https://a:[REDACTED]@c and http://d:[REDACTED]@f".to_owned(),
            true
        )
    );
    for unchanged in [
        "https://u@h",
        "ssh://git@github.com:22/x",
        "no scheme a:b@c",
        "https://h/path?x=a:b@c",
    ] {
        assert_eq!(
            mask_url_credentials(unchanged),
            (unchanged.to_owned(), false)
        );
    }
}

#[test]
fn read_result_serializes_outcome_tags_in_camel_case() {
    let failed = serde_json::to_value(ReadResult::Failed {
        kind: ReadFailure::TooLarge,
    })
    .expect("serializes");
    assert_eq!(failed["outcome"], Value::String("failed".to_owned()));
    assert_eq!(failed["kind"], Value::String("tooLarge".to_owned()));

    let unavailable = serde_json::to_value(ReadResult::Unavailable {
        status: ProbeStatus::OutOfBounds,
    })
    .expect("serializes");
    assert_eq!(
        unavailable["outcome"],
        Value::String("unavailable".to_owned())
    );
    assert_eq!(
        unavailable["status"]["status"],
        Value::String("outOfBounds".to_owned())
    );
}
