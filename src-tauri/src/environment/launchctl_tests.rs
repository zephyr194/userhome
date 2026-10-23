use super::*;
use crate::error::AppErrorCode;

const PRINT: &str = "gui/501 = {\n\ttype = user\n\tenvironment = {\n\t\tZED_THEME => dark\n\t\tAPI_TOKEN => abc123\n\t\tDATABASE_URL => postgres://user:pw@db/app\n\t\tEDITOR => \"vim -f\"\n\t}\n\tstate = running\n}\n";

fn names(parsed: &ParsedEnvironment) -> Vec<&str> {
    parsed
        .entries
        .iter()
        .map(|entry| entry.key.as_str())
        .collect()
}

fn value_of<'a>(parsed: &'a ParsedEnvironment, key: &str) -> &'a str {
    parsed
        .entries
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.value.as_str())
        .expect("entry present")
}

#[test]
fn parses_entries_sorted_with_values_kept_verbatim() {
    let parsed = parse_print_output(PRINT, false);

    assert_eq!(
        names(&parsed),
        ["API_TOKEN", "DATABASE_URL", "EDITOR", "ZED_THEME"]
    );
    assert_eq!(value_of(&parsed, "EDITOR"), "\"vim -f\"");
    assert_eq!(value_of(&parsed, "ZED_THEME"), "dark");
    assert!(!parsed.partial);
}

#[test]
fn empty_and_missing_environment_blocks_are_empty_not_partial() {
    let empty = parse_print_output("gui/501 = {\n\tenvironment = {\n\t}\n}\n", false);
    assert!(empty.entries.is_empty());
    assert!(!empty.partial);

    let missing = parse_print_output("gui/501 = {\n\ttype = user\n}\n", false);
    assert!(missing.entries.is_empty());
    assert!(!missing.partial);
}

#[test]
fn multi_line_value_keeps_its_continuation_lines() {
    let text = "\tenvironment = {\n\t\tNOTE => first\n second\n\t\tPLAIN => x\n\t}\n";
    let parsed = parse_print_output(text, false);

    assert_eq!(value_of(&parsed, "NOTE"), "first\n second");
    assert_eq!(value_of(&parsed, "PLAIN"), "x");
    assert!(!parsed.partial);
}

#[test]
fn continuation_before_the_first_entry_is_partial() {
    let parsed = parse_print_output("\tenvironment = {\n orphan\n\t\tA => 1\n\t}\n", false);

    assert_eq!(names(&parsed), ["A"]);
    assert!(parsed.partial);
}

#[test]
fn unterminated_block_is_partial() {
    let parsed = parse_print_output("\tenvironment = {\n\t\tA => 1\n", false);

    assert_eq!(names(&parsed), ["A"]);
    assert!(parsed.partial);
}

#[test]
fn cut_output_drops_the_unfinished_last_line_and_is_partial() {
    let text = "\tenvironment = {\n\t\tA => 1\n\t\tB => 2\n\t\tC => partial-li";
    let parsed = parse_print_output(text, true);

    assert_eq!(names(&parsed), ["A", "B"]);
    assert!(parsed.partial);
}

#[test]
fn duplicate_key_keeps_the_last_value_and_is_partial() {
    let parsed = parse_print_output(
        "\tenvironment = {\n\t\tA => first\n\t\tA => second\n\t}\n",
        false,
    );

    assert_eq!(names(&parsed), ["A"]);
    assert_eq!(value_of(&parsed, "A"), "second");
    assert!(parsed.partial);
}

#[test]
fn secret_flags_come_from_the_shared_dotenv_predicate() {
    let parsed = parse_print_output(PRINT, false);
    let secret = |key: &str| {
        parsed
            .entries
            .iter()
            .find(|entry| entry.key == key)
            .unwrap()
            .secret
    };

    assert!(secret("API_TOKEN"));
    assert!(secret("DATABASE_URL"));
    assert!(!secret("ZED_THEME"));
    assert!(!secret("EDITOR"));
}

#[test]
fn listing_withholds_secret_values_and_serializes_without_them() {
    let parsed = parse_print_output(PRINT, false);
    let listed = listing(&parsed, OffsetDateTime::UNIX_EPOCH).expect("listing");

    let token = listed
        .entries
        .iter()
        .find(|entry| entry.key == "API_TOKEN")
        .unwrap();
    assert_eq!(token.value, None);
    assert!(token.secret);
    let theme = listed
        .entries
        .iter()
        .find(|entry| entry.key == "ZED_THEME")
        .unwrap();
    assert_eq!(theme.value.as_deref(), Some("dark"));
    assert_eq!(listed.read_at, "1970-01-01T00:00:00Z");

    let json = serde_json::to_string(&listed).expect("json");
    assert!(!json.contains("abc123"));
    assert!(!json.contains("pw@"));
    assert!(json.contains("\"readAt\""));
}

#[test]
fn validate_key_accepts_names_and_rejects_unsafe_ones() {
    assert!(validate_key("PATH").is_ok());
    assert!(validate_key(&"A".repeat(256)).is_ok());

    for key in ["", "A\0B", "A\nB", "A\rB", "A=B"] {
        assert_eq!(
            validate_key(key).unwrap_err().code(),
            AppErrorCode::InvalidInput,
            "{key:?}"
        );
    }
    assert_eq!(
        validate_key(&"A".repeat(257)).unwrap_err().code(),
        AppErrorCode::InvalidInput
    );
}

#[test]
fn reveal_returns_a_present_value_and_reports_missing_keys() {
    let parsed = parse_print_output(PRINT, false);

    assert_eq!(reveal_from(&parsed, "API_TOKEN").unwrap(), "abc123");
    let missing = reveal_from(&parsed, "NOT_SET").unwrap_err();
    assert_eq!(missing.code(), AppErrorCode::NotFound);
    assert!(!missing.message().contains("abc123"));
}

#[test]
fn reveal_does_not_find_keys_cut_off_by_the_output_cap() {
    let text = "\tenvironment = {\n\t\tA => 1\n\t\tC => 3";
    let parsed = parse_print_output(text, true);

    assert_eq!(
        reveal_from(&parsed, "C").unwrap_err().code(),
        AppErrorCode::NotFound
    );
}

#[test]
fn set_names_follow_the_shell_safe_shape_and_length() {
    let longest = "A".repeat(128);
    let too_long = "A".repeat(129);
    for key in ["PATH", "_X", "A1_b", longest.as_str()] {
        assert!(validate_set_name(key).is_ok(), "{key:?}");
    }
    for key in ["", "1A", "A-B", "A B", "A=B", "é", "A.B", too_long.as_str()] {
        assert_eq!(
            validate_set_name(key).unwrap_err().code(),
            AppErrorCode::InvalidInput,
            "{key:?}"
        );
    }
}

#[test]
fn protected_names_are_refused_for_set_and_unset_alike() {
    for key in [
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "TMPDIR",
        "SSH_AUTH_SOCK",
        "__CF_USER_TEXT_ENCODING",
        "DYLD_INSERT_LIBRARIES",
        "LD_PRELOAD",
        "XPC_SERVICE_NAME",
    ] {
        assert_eq!(
            validate_set_name(key).unwrap_err().code(),
            AppErrorCode::InvalidInput,
            "{key}"
        );
    }
    for key in ["PATH", "EDITOR", "LDFLAGS", "XPCX"] {
        assert!(validate_set_name(key).is_ok(), "{key}");
    }
}

#[test]
fn set_values_are_capped_and_may_not_contain_nul() {
    let at_cap = "x".repeat(MAX_SET_VALUE_BYTES);
    let over_cap = "x".repeat(MAX_SET_VALUE_BYTES + 1);
    assert!(validate_set_value("").is_ok());
    assert!(validate_set_value("a b; rm -rf $HOME `x` $(y)").is_ok());
    assert!(validate_set_value(&at_cap).is_ok());
    assert_eq!(
        validate_set_value(&over_cap).unwrap_err().code(),
        AppErrorCode::InvalidInput
    );
    assert_eq!(
        validate_set_value("a\0b").unwrap_err().code(),
        AppErrorCode::InvalidInput
    );
}

#[test]
fn values_starting_with_a_hyphen_are_refused_so_launchctl_never_reads_them_as_options() {
    for value in ["-", "-x", "--", "-rf $HOME"] {
        assert_eq!(
            validate_set_value(value).unwrap_err().code(),
            AppErrorCode::InvalidInput,
            "{value:?}"
        );
    }
    assert!(validate_set_value("x-").is_ok());
    assert!(validate_set_value(" -x").is_ok());
}

#[test]
fn expected_digest_must_be_absent_or_lowercase_sha256_hex() {
    let upper = "A".repeat(64);
    let not_hex = "g".repeat(64);
    let short = "a".repeat(63);
    assert!(validate_expected(None).is_ok());
    assert!(validate_expected(Some(&digest("x"))).is_ok());
    for bad in ["", "abc", upper.as_str(), not_hex.as_str(), short.as_str()] {
        assert_eq!(
            validate_expected(Some(bad)).unwrap_err().code(),
            AppErrorCode::InvalidInput,
            "{bad:?}"
        );
    }
}

#[test]
fn write_arguments_are_one_element_per_field_without_a_shell() {
    let value = "a b; rm -rf $HOME";
    assert_eq!(setenv_args("EDITOR", value), ["setenv", "EDITOR", value]);
    assert_eq!(unsetenv_args("EDITOR"), ["unsetenv", "EDITOR"]);
}

#[test]
fn preview_reports_existence_and_secrecy_without_values() {
    let parsed = parse_print_output(PRINT, false);

    let absent = preview_from(&parsed, "NOT_SET").unwrap();
    assert!(!absent.current_exists);
    assert!(!absent.current_secret);
    assert_eq!(absent.expected_current, None);

    let plain = preview_from(&parsed, "ZED_THEME").unwrap();
    assert!(plain.current_exists);
    assert!(!plain.current_secret);
    assert_eq!(plain.expected_current, Some(digest("dark")));

    let secret = preview_from(&parsed, "API_TOKEN").unwrap();
    assert!(secret.current_secret);
    let json = serde_json::to_string(&secret).unwrap();
    assert!(!json.contains("abc123"));
    assert!(json.contains("\"expectedCurrent\""));
}

#[test]
fn preview_refuses_a_missing_key_when_the_read_was_partial() {
    let parsed = parse_print_output("\tenvironment = {\n\t\tA => 1\n\t\tB => 2", true);

    assert!(preview_from(&parsed, "A").is_ok());
    assert_eq!(
        preview_from(&parsed, "C").unwrap_err().code(),
        AppErrorCode::ProcessFailed
    );
}

#[test]
fn execute_refuses_a_change_made_after_the_preview() {
    let parsed = parse_print_output(PRINT, false);

    assert!(check_expected(&parsed, "ZED_THEME", Some(&digest("dark"))).is_ok());
    assert!(check_expected(&parsed, "NOT_SET", None).is_ok());

    assert_eq!(
        check_expected(&parsed, "ZED_THEME", Some(&digest("light")))
            .unwrap_err()
            .code(),
        AppErrorCode::Conflict
    );
    assert_eq!(
        check_expected(&parsed, "ZED_THEME", None)
            .unwrap_err()
            .code(),
        AppErrorCode::Conflict
    );
    assert_eq!(
        check_expected(&parsed, "NOT_SET", Some(&digest("x")))
            .unwrap_err()
            .code(),
        AppErrorCode::Conflict
    );
}

#[test]
fn write_failures_never_carry_the_value_or_the_process_output() {
    let failed = ProcessError::Failed {
        code: Some(1),
        stdout: "leaked-value".to_owned(),
        stderr: "leaked-value".to_owned(),
    };
    let error = map_write_error(failed);
    assert_eq!(error.code(), AppErrorCode::ProcessFailed);
    assert!(error.retryable());
    assert!(!error.message().contains("leaked-value"));

    assert_eq!(
        map_write_error(ProcessError::Spawn).code(),
        AppErrorCode::NotSupported
    );
    assert_eq!(
        map_write_error(ProcessError::Timeout).code(),
        AppErrorCode::ProcessFailed
    );
}

#[test]
fn digest_is_stable_lowercase_hex_and_differs_by_value() {
    let one = digest("dark");
    assert_eq!(one.len(), 64);
    assert!(
        one.bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    );
    assert_eq!(one, digest("dark"));
    assert_ne!(one, digest("light"));
}
