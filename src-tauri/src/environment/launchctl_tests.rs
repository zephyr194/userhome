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
