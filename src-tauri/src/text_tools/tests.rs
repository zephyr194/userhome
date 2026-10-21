use super::*;

fn format_ok(text: &str, mode: JsonFormatMode) -> FormattedJson {
    format(text, mode).unwrap_or_else(|error| panic!("expected ok for {text:?}, got {error:?}"))
}

fn minified(text: &str) -> String {
    format_ok(text, JsonFormatMode::Minify).text
}

fn position(text: &str) -> (usize, usize) {
    match format(text, JsonFormatMode::Minify) {
        Err(JsonError::Syntax { line, column, .. } | JsonError::TooDeep { line, column }) => {
            (line, column)
        }
        other => panic!("expected positioned error for {text:?}, got {other:?}"),
    }
}

#[test]
fn limits_are_the_documented_values() {
    assert_eq!(MAX_INPUT_BYTES, 1_048_576);
    assert_eq!(MAX_DEPTH, 256);
    assert_eq!(MAX_WARNINGS, 100);
    assert_eq!(MAX_KEY_CHARS, 64);
}

#[test]
fn keeps_large_integers_exponents_negative_zero_and_trailing_zeros_verbatim() {
    let input = r#"{"big":123456789012345678901234567890,"exp":1E+2,"neg":-0,"one":1.0,"frac":0.10,"tiny":1e-400}"#;
    assert_eq!(minified(input), input);
}

#[test]
fn keeps_unicode_escapes_and_surrogate_pairs_verbatim() {
    let input = r#"{"s":"\u00e9\ud83d\ude00\u0000","t":"\u4e2d"}"#;
    assert_eq!(minified(input), input);
}

#[test]
fn keeps_simple_string_escapes_verbatim() {
    let input = r#"["a\/b\"c\\d\b\f\n\r\t"]"#;
    assert_eq!(minified(input), input);
}

#[test]
fn warns_on_duplicate_key_with_its_position_and_keeps_both_entries() {
    let result = format_ok(r#"{"a":1,"a":2}"#, JsonFormatMode::Indent2);
    assert_eq!(result.text, "{\n  \"a\": 1,\n  \"a\": 2\n}");
    assert_eq!(
        result.warnings,
        vec![JsonWarning {
            key: "a".to_owned(),
            line: 1,
            column: 8,
        }]
    );
    assert_eq!(result.omitted_warnings, 0);
}

#[test]
fn duplicate_detection_compares_decoded_keys_but_keeps_raw_text() {
    let result = format_ok(r#"{"\u0061":1,"a":2}"#, JsonFormatMode::Minify);
    assert_eq!(result.text, r#"{"\u0061":1,"a":2}"#);
    assert_eq!(
        result.warnings,
        vec![JsonWarning {
            key: "a".to_owned(),
            line: 1,
            column: 13,
        }]
    );
}

#[test]
fn duplicate_keys_in_different_objects_are_not_warned() {
    let result = format_ok(r#"[{"a":1},{"a":2}]"#, JsonFormatMode::Minify);
    assert!(result.warnings.is_empty());
}

#[test]
fn truncates_long_duplicate_key_names_to_the_key_limit() {
    let key = "k".repeat(100);
    let input = format!(r#"{{"{key}":1,"{key}":2}}"#);
    let result = format_ok(&input, JsonFormatMode::Minify);
    assert_eq!(
        result.warnings,
        vec![JsonWarning {
            key: format!("{}…", "k".repeat(MAX_KEY_CHARS)),
            line: 1,
            column: 107,
        }]
    );
}

#[test]
fn caps_warning_list_and_counts_omitted_warnings() {
    let input = format!(r#"{{"a":0{}}}"#, ",\"a\":0".repeat(150));
    let result = format_ok(&input, JsonFormatMode::Minify);
    assert_eq!(result.warnings.len(), MAX_WARNINGS);
    assert_eq!(result.omitted_warnings, 50);
}

#[test]
fn indent_two_uses_two_spaces_and_compact_empty_containers() {
    let input = r#"{"a":[1,{"b":null}],"c":{},"d":[]}"#;
    let expected = "{\n  \"a\": [\n    1,\n    {\n      \"b\": null\n    }\n  ],\n  \"c\": {},\n  \"d\": []\n}";
    assert_eq!(format_ok(input, JsonFormatMode::Indent2).text, expected);
}

#[test]
fn indent_four_uses_four_spaces() {
    let input = r#"{"a":[1,{"b":null}],"c":{},"d":[]}"#;
    let expected = "{\n    \"a\": [\n        1,\n        {\n            \"b\": null\n        }\n    ],\n    \"c\": {},\n    \"d\": []\n}";
    assert_eq!(format_ok(input, JsonFormatMode::Indent4).text, expected);
}

#[test]
fn minify_removes_all_insignificant_whitespace() {
    assert_eq!(minified("{ \"a\" : [ 1 , true ] }"), r#"{"a":[1,true]}"#);
}

#[test]
fn accepts_rfc_whitespace_and_keeps_key_order() {
    assert_eq!(
        minified("\t\r\n {\r\n\t\"z\" \t:\r\n 1 ,\"a\":2,\"m\":3 }\r\n"),
        r#"{"z":1,"a":2,"m":3}"#
    );
}

#[test]
fn accepts_top_level_scalars() {
    assert_eq!(minified("  42  "), "42");
    assert_eq!(minified("\"x\""), "\"x\"");
    assert_eq!(minified("null"), "null");
}

#[test]
fn accepts_nesting_at_the_depth_limit() {
    let input = format!("{}{}", "[".repeat(MAX_DEPTH), "]".repeat(MAX_DEPTH));
    assert_eq!(minified(&input), input);
}

#[test]
fn rejects_arrays_beyond_the_depth_limit_at_the_offending_bracket() {
    let input = format!("{}{}", "[".repeat(MAX_DEPTH + 1), "]".repeat(MAX_DEPTH + 1));
    assert_eq!(position(&input), (1, MAX_DEPTH + 1));
}

#[test]
fn rejects_objects_beyond_the_depth_limit() {
    let inside = "{\"a\":".repeat(MAX_DEPTH);
    let accepted = format!("{inside}1{}", "}".repeat(MAX_DEPTH));
    assert_eq!(minified(&accepted), accepted);

    let rejected = format!("{inside}{{\"a\":1{}", "}".repeat(MAX_DEPTH + 1));
    assert_eq!(position(&rejected), (1, 5 * MAX_DEPTH + 1));
}

#[test]
fn accepts_input_of_exactly_one_mebibyte() {
    let input = format!("\"{}\"", "a".repeat(MAX_INPUT_BYTES - 2));
    assert_eq!(input.len(), MAX_INPUT_BYTES);
    assert_eq!(minified(&input), input);
}

#[test]
fn rejects_input_one_byte_over_one_mebibyte() {
    let input = format!("\"{}\"", "a".repeat(MAX_INPUT_BYTES - 1));
    assert_eq!(input.len(), MAX_INPUT_BYTES + 1);
    assert_eq!(
        format(&input, JsonFormatMode::Minify),
        Err(JsonError::InputTooLarge)
    );
}

#[test]
fn size_limit_counts_utf8_bytes_not_characters() {
    let input = format!("\"{}\"", "字".repeat(349_525));
    assert!(input.chars().count() < MAX_INPUT_BYTES);
    assert_eq!(input.len(), 1_048_577);
    assert_eq!(
        format(&input, JsonFormatMode::Minify),
        Err(JsonError::InputTooLarge)
    );
}

#[test]
fn rejects_output_beyond_the_output_limit_without_truncating() {
    let chain = format!("{}1{}", "[".repeat(255), "]".repeat(255));
    let input = format!("[{}]", vec![chain; 40].join(","));
    assert_eq!(
        format(&input, JsonFormatMode::Indent4),
        Err(JsonError::OutputTooLarge)
    );
    assert!(format(&input, JsonFormatMode::Minify).is_ok());
}

#[test]
fn reports_exact_line_and_column_for_invalid_input() {
    let cases: &[(&str, (usize, usize))] = &[
        ("", (1, 1)),
        ("  \n ", (2, 2)),
        ("NaN", (1, 1)),
        ("[Infinity]", (1, 2)),
        ("/* c */1", (1, 1)),
        ("{\"a\":1,}", (1, 8)),
        ("[1,]", (1, 4)),
        ("{1:2}", (1, 2)),
        ("{\"a\" 1}", (1, 6)),
        ("{\"a\":1 \"b\":2}", (1, 8)),
        ("{\"a\":1", (1, 7)),
        ("[01]", (1, 3)),
        ("[1.]", (1, 4)),
        ("[1e]", (1, 4)),
        ("[1.5e+]", (1, 7)),
        ("[-]", (1, 3)),
        ("[- 1]", (1, 3)),
        ("tru", (1, 4)),
        ("[1 // c\n]", (1, 4)),
        ("1 2", (1, 3)),
        ("[1,\n2,\n]", (3, 1)),
        ("{\n  \"a\": 1\n  \"b\": 2\n}", (3, 3)),
        ("\"abc", (1, 5)),
        ("\"a\\x\"", (1, 4)),
        ("\"\\u12G4\"", (1, 6)),
        ("\"\\ud800\"", (1, 2)),
        ("\"\\udc00\"", (1, 2)),
        ("\"\\ud800\\u0041\"", (1, 2)),
        ("\"a\tb\"", (1, 3)),
        ("{\"a\u{1}\":1}", (1, 4)),
        ("[\"字\",x]", (1, 6)),
        ("\u{feff}[]", (1, 1)),
    ];
    for (input, expected) in cases {
        assert_eq!(position(input), *expected, "input {input:?}");
    }
}

#[test]
fn rejects_leading_byte_order_mark_explicitly() {
    assert_eq!(position("\u{feff}{}"), (1, 1));
    assert_eq!(position("\u{feff}"), (1, 1));
}

#[test]
fn syntax_errors_never_echo_the_input() {
    let input = format!("[\"secret-token-XYZ\"{}", " x]");
    let error = format(&input, JsonFormatMode::Minify).unwrap_err();
    assert!(!format!("{error:?}").contains("secret"));
}

#[test]
fn rejects_non_json_extensions_strictly() {
    for input in [
        "[1,2,]",
        "{\"a\":NaN}",
        "// c\n{}",
        "{\"a\":1}//x",
        "[+1]",
        "[.5]",
    ] {
        assert!(
            format(input, JsonFormatMode::Minify).is_err(),
            "input {input:?}"
        );
    }
}

#[test]
fn distinct_non_error_inputs_round_trip_through_minify() {
    let input = r#"{"n":[0,-1.5e-3,true,false,null],"s":"中文 😀","e":{}}"#;
    assert_eq!(minified(input), input);
}
