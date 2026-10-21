use super::*;
use crate::ai_config::validate::load_all;

const SECRET_SAMPLE: &str = "sk-ant-test-0123456789";
const VALUE_MATRIX: &[&str] = &[
    "sonnet",
    "a b",
    "中文 🙂 Ünïcode",
    "it's",
    "'",
    "''",
    "$(touch /tmp/pwned)",
    "`id`",
    "a;rm -rf ~",
    "a&&b",
    "a||b",
    "a|b",
    "a>out",
    "a<in",
    "~",
    "*",
    "?",
    "[a-z]",
    "{a,b}",
    "$HOME",
    "${HOME}",
    "x\\y",
    "-rf",
    "--dangerously-skip-permissions",
    "#note",
    "!history",
    "a\"b",
    "%1",
    "a=b",
    "é",
    "\\'",
];

fn tool() -> ToolDefinition {
    load_all()
        .expect("claude definitions load")
        .tools
        .into_iter()
        .find(|tool| tool.id == CLAUDE_CODE_TOOL_ID)
        .expect("claude tool present")
}

fn item(id: &str, value: Option<&str>) -> ItemChoice {
    ItemChoice {
        id: id.to_owned(),
        value: value.map(str::to_owned),
    }
}

fn flags(choices: Vec<ItemChoice>) -> CommandRequest {
    CommandRequest {
        flags: choices,
        env: Vec::new(),
        acknowledged_risks: Vec::new(),
        detected_version: None,
    }
}

fn env(choices: Vec<ItemChoice>) -> CommandRequest {
    CommandRequest {
        flags: Vec::new(),
        env: choices,
        acknowledged_risks: Vec::new(),
        detected_version: None,
    }
}

fn build(request: &CommandRequest) -> Result<BuiltCommand, CommandError> {
    build_claude_command(&tool(), request)
}

/// Reverses the rendering as zsh reads it: unquoted text may only use a fixed
/// whitelist, single quotes are literal, and a backslash escapes one character
/// outside quotes. Nothing is executed.
fn parse_words(text: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut in_word = false;
    let mut characters = text.chars();
    while let Some(character) = characters.next() {
        match character {
            ' ' => {
                if in_word {
                    words.push(std::mem::take(&mut word));
                    in_word = false;
                }
            }
            '\'' => {
                in_word = true;
                loop {
                    match characters.next() {
                        Some('\'') => break,
                        Some(inner) => word.push(inner),
                        None => return Err("unterminated single quote".to_owned()),
                    }
                }
            }
            '\\' => {
                in_word = true;
                match characters.next() {
                    Some(escaped) => word.push(escaped),
                    None => return Err("dangling backslash".to_owned()),
                }
            }
            plain if plain.is_ascii_alphanumeric() || "-_=.,/:+@%".contains(plain) => {
                in_word = true;
                word.push(plain);
            }
            other => return Err(format!("unquoted metacharacter {other:?}")),
        }
    }
    if in_word {
        words.push(word);
    }
    Ok(words)
}

fn words(text: &str) -> Vec<String> {
    parse_words(text).unwrap_or_else(|reason| panic!("not literal-only ({reason}): {text}"))
}

fn status_of(built: &BuiltCommand, id: &str) -> VersionStatus {
    built
        .notices
        .iter()
        .find(|notice| notice.id == id)
        .expect("notice for item")
        .status
}

fn request_with_version(id: &str, version: Option<&str>) -> CommandRequest {
    let mut request = flags(vec![item(id, None)]);
    request.detected_version = version.map(str::to_owned);
    request
}

#[test]
fn parser_rejects_unquoted_metacharacters_and_accepts_quoted_ones() {
    assert!(parse_words("claude $(id)").is_err());
    assert!(parse_words("claude a;b").is_err());
    assert_eq!(
        parse_words("claude '$(id)'"),
        Ok(vec!["claude".to_owned(), "$(id)".to_owned()])
    );
    assert_eq!(
        parse_words("claude --model='a'\\''b'"),
        Ok(vec!["claude".to_owned(), "--model=a'b".to_owned()])
    );
}

#[test]
fn flag_values_round_trip_as_single_literals() {
    for &value in VALUE_MATRIX {
        let built = build(&flags(vec![item("--model", Some(value))])).expect(value);
        assert_eq!(
            words(&built.text),
            vec!["claude".to_owned(), format!("--model={value}")],
            "{value}"
        );
    }
}

#[test]
fn env_values_round_trip_as_single_literals() {
    for &value in VALUE_MATRIX {
        let built = build(&env(vec![item("CLAUDE_CODE_OAUTH_SCOPES", Some(value))])).expect(value);
        assert_eq!(
            words(&built.text),
            vec![
                format!("CLAUDE_CODE_OAUTH_SCOPES={value}"),
                "claude".to_owned()
            ],
            "{value}"
        );
    }
}

#[test]
fn empty_or_missing_values_are_rejected() {
    let expected = Some(CommandError::MissingValue("--model".to_owned()));
    assert_eq!(
        build(&flags(vec![item("--model", Some(""))])).err(),
        expected
    );
    assert_eq!(build(&flags(vec![item("--model", None)])).err(), expected);
}

#[test]
fn control_and_invisible_characters_are_rejected() {
    for value in [
        "a\nb",
        "a\tb",
        "a\0b",
        "a\u{1b}b",
        "a\u{202e}b",
        "a\u{2028}b",
    ] {
        assert!(
            matches!(
                build(&flags(vec![item("--model", Some(value))])),
                Err(CommandError::InvalidValue {
                    reason: ValueReason::ControlCharacter,
                    ..
                })
            ),
            "{value:?}"
        );
    }
}

#[test]
fn value_length_limit_is_enforced_at_the_boundary() {
    let at_limit = "a".repeat(8192);
    assert!(build(&flags(vec![item("--model", Some(at_limit.as_str()))])).is_ok());
    let over = "a".repeat(8193);
    assert!(matches!(
        build(&flags(vec![item("--model", Some(over.as_str()))])),
        Err(CommandError::InvalidValue {
            reason: ValueReason::TooLong,
            ..
        })
    ));
}

#[test]
fn enum_values_must_be_listed() {
    assert_eq!(
        build(&flags(vec![item("--effort", Some("turbo"))])).err(),
        Some(CommandError::InvalidValue {
            item: "--effort".to_owned(),
            reason: ValueReason::NotInAllowedValues,
        })
    );
    assert_eq!(
        build(&flags(vec![item("--effort", Some("high"))]))
            .expect("listed value")
            .text,
        "claude --effort='high'"
    );
}

#[test]
fn number_values_must_be_finite_numbers() {
    for value in ["abc", "NaN", "inf", "1 2", "1e400"] {
        assert_eq!(
            build(&env(vec![item(
                "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
                Some(value)
            )]))
            .err(),
            Some(CommandError::InvalidValue {
                item: "CLAUDE_CODE_API_KEY_HELPER_TTL_MS".to_owned(),
                reason: ValueReason::NotANumber,
            }),
            "{value}"
        );
    }
    assert_eq!(
        build(&env(vec![item(
            "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
            Some("60000")
        )]))
        .expect("number")
        .text,
        "CLAUDE_CODE_API_KEY_HELPER_TTL_MS='60000' claude"
    );
}

#[test]
fn boolean_items_take_no_value() {
    assert_eq!(
        build(&flags(vec![item("--bare", Some("true"))])).err(),
        Some(CommandError::UnexpectedValue("--bare".to_owned()))
    );
    assert_eq!(
        build(&flags(vec![item("--bare", None)]))
            .expect("switch")
            .text,
        "claude --bare"
    );
}

#[test]
fn unknown_and_duplicate_items_are_rejected() {
    assert_eq!(
        build(&flags(vec![item("--not-a-flag", None)])).err(),
        Some(CommandError::UnknownItem)
    );
    assert_eq!(
        build(&env(vec![item("NOT_A_VARIABLE", Some("x"))])).err(),
        Some(CommandError::UnknownItem)
    );
    assert_eq!(
        build(&flags(vec![item("--bare", None), item("--bare", None)])).err(),
        Some(CommandError::DuplicateItem)
    );
}

#[test]
fn unverified_value_types_are_display_only() {
    assert_eq!(
        build(&env(vec![item(
            "CLAUDE_CODE_CLIENT_KEY",
            Some("/tmp/k.pem")
        )]))
        .err(),
        Some(CommandError::NotGeneratable(
            "CLAUDE_CODE_CLIENT_KEY".to_owned()
        ))
    );
    assert_eq!(
        build(&env(vec![item("CLAUDE_CODE_PROCESS_WRAPPER", None)])).err(),
        Some(CommandError::NotGeneratable(
            "CLAUDE_CODE_PROCESS_WRAPPER".to_owned()
        ))
    );
}

#[test]
fn secret_variables_produce_only_a_placeholder() {
    let built = build(&env(vec![item("ANTHROPIC_API_KEY", None)])).expect("placeholder");
    assert_eq!(built.text, "ANTHROPIC_API_KEY='<在此填入，勿提交>' claude");
    assert_eq!(built.placeholders, vec!["ANTHROPIC_API_KEY".to_owned()]);
    assert_eq!(
        words(&built.text),
        vec![
            format!("ANTHROPIC_API_KEY={SECRET_PLACEHOLDER}"),
            "claude".to_owned()
        ]
    );
    assert!(!built.text.contains("sk-"));
}

#[test]
fn real_secret_values_are_refused_and_never_echoed() {
    let error = build(&env(vec![item("ANTHROPIC_API_KEY", Some(SECRET_SAMPLE))]))
        .expect_err("secret value refused");
    assert_eq!(
        error,
        CommandError::UnexpectedValue("ANTHROPIC_API_KEY".to_owned())
    );
    assert!(!format!("{error:?}{}", error.message()).contains(SECRET_SAMPLE));
}

#[test]
fn risk_items_are_never_added_automatically() {
    assert_eq!(build(&flags(Vec::new())).expect("empty").text, "claude");
    assert_eq!(
        build(&flags(vec![item("--print", None)]))
            .expect("print")
            .text,
        "claude --print"
    );
}

#[test]
fn risk_flag_needs_explicit_acknowledgement() {
    let request = flags(vec![item("--dangerously-skip-permissions", None)]);
    assert_eq!(
        build(&request).err(),
        Some(CommandError::RiskNotAcknowledged(
            "--dangerously-skip-permissions".to_owned()
        ))
    );
    let mut acknowledged = request.clone();
    acknowledged.acknowledged_risks = vec!["--dangerously-skip-permissions".to_owned()];
    assert_eq!(
        build(&acknowledged).expect("acknowledged").text,
        "claude --dangerously-skip-permissions"
    );
}

#[test]
fn risk_env_needs_explicit_acknowledgement() {
    let name = "CLAUDE_CODE_DISABLE_DANGEROUS_RM_TIMEOUT";
    let request = env(vec![item(name, None)]);
    assert_eq!(
        build(&request).err(),
        Some(CommandError::RiskNotAcknowledged(name.to_owned()))
    );
    let mut acknowledged = request.clone();
    acknowledged.acknowledged_risks = vec![name.to_owned()];
    assert_eq!(
        build(&acknowledged).expect("acknowledged").text,
        format!("{name}=1 claude")
    );
}

#[test]
fn mutually_exclusive_items_are_rejected() {
    let mut request = flags(vec![
        item("--restricted", None),
        item("--dangerously-skip-permissions", None),
    ]);
    request.acknowledged_risks = vec!["--dangerously-skip-permissions".to_owned()];
    assert!(matches!(
        build(&request).err(),
        Some(CommandError::Excluded { .. })
    ));
}

#[test]
fn required_flag_must_be_selected_too() {
    assert_eq!(
        build(&flags(vec![item("--no-session-persistence", None)])).err(),
        Some(CommandError::RequiresMissing {
            item: "--no-session-persistence".to_owned(),
            required: "--print".to_owned(),
        })
    );
    assert_eq!(
        build(&flags(vec![
            item("--print", None),
            item("--no-session-persistence", None),
        ]))
        .expect("requirement met")
        .text,
        "claude --print --no-session-persistence"
    );
}

#[test]
fn required_env_must_be_selected_too() {
    assert_eq!(
        build(&env(vec![item("CLAUDE_CODE_OAUTH_REFRESH_TOKEN", None)])).err(),
        Some(CommandError::RequiresMissing {
            item: "CLAUDE_CODE_OAUTH_REFRESH_TOKEN".to_owned(),
            required: "CLAUDE_CODE_OAUTH_SCOPES".to_owned(),
        })
    );
    let satisfied = env(vec![
        item("CLAUDE_CODE_OAUTH_REFRESH_TOKEN", None),
        item("CLAUDE_CODE_OAUTH_SCOPES", Some("user:inference")),
    ]);
    let built = build(&satisfied).expect("requirement met");
    assert!(
        built
            .text
            .contains("CLAUDE_CODE_OAUTH_SCOPES='user:inference'")
    );
    assert_eq!(
        built.placeholders,
        vec!["CLAUDE_CODE_OAUTH_REFRESH_TOKEN".to_owned()]
    );
}

#[test]
fn version_is_unconfirmed_without_a_detected_version() {
    let built = build(&request_with_version("--restricted", None)).expect("still generated");
    assert_eq!(
        status_of(&built, "--restricted"),
        VersionStatus::Unconfirmed
    );
    assert_eq!(built.text, "claude --restricted");
}

#[test]
fn incompatible_version_is_flagged_but_still_generated() {
    let built =
        build(&request_with_version("--restricted", Some("2.1.100"))).expect("still generated");
    assert_eq!(
        status_of(&built, "--restricted"),
        VersionStatus::Incompatible
    );
    assert!(
        built
            .notices
            .iter()
            .any(|notice| notice.message.contains("2.1.100"))
    );
    assert_eq!(built.text, "claude --restricted");
}

#[test]
fn minimum_version_is_compatible_and_maximum_unknown_is_unbounded() {
    let at_minimum =
        build(&request_with_version("--restricted", Some("2.1.248"))).expect("generated");
    assert_eq!(
        status_of(&at_minimum, "--restricted"),
        VersionStatus::Compatible
    );
    let four_part =
        build(&request_with_version("--restricted", Some("2.1.248.1"))).expect("generated");
    assert_eq!(
        status_of(&four_part, "--restricted"),
        VersionStatus::Compatible
    );
    let far_future =
        build(&request_with_version("--restricted", Some("99.0.0"))).expect("generated");
    assert_eq!(
        status_of(&far_future, "--restricted"),
        VersionStatus::Compatible
    );
}

#[test]
fn items_without_a_stated_version_say_so() {
    let built = build(&request_with_version("--bare", Some("2.1.100"))).expect("generated");
    assert_eq!(status_of(&built, "--bare"), VersionStatus::NotStated);
}

#[test]
fn malformed_detected_versions_are_rejected() {
    let long = "1.".repeat(17) + "1";
    for version in ["2.x", "", "1..2", "1.2.3.4.5", long.as_str()] {
        assert_eq!(
            build(&request_with_version("--bare", Some(version))).err(),
            Some(CommandError::InvalidDetectedVersion),
            "{version:?}"
        );
    }
}

#[test]
fn too_many_choices_are_rejected_before_resolution() {
    let choices: Vec<ItemChoice> = (0..=MAX_CHOICES).map(|_| item("--bare", None)).collect();
    assert_eq!(
        build(&flags(choices)).err(),
        Some(CommandError::TooManyChoices)
    );
}

#[test]
fn oversized_command_is_rejected() {
    let long = "a".repeat(8000);
    let request = flags(vec![
        item("--name", Some(long.as_str())),
        item("--model", Some(long.as_str())),
        item("--agent", Some(long.as_str())),
    ]);
    assert_eq!(build(&request).err(), Some(CommandError::CommandTooLong));
}

#[test]
fn env_prefix_comes_first_and_flags_keep_request_order() {
    let request = CommandRequest {
        flags: vec![item("--bare", None), item("--model", Some("sonnet"))],
        env: vec![item("CLAUDE_CODE_OAUTH_SCOPES", Some("x"))],
        acknowledged_risks: Vec::new(),
        detected_version: None,
    };
    assert_eq!(
        build(&request).expect("ordered").text,
        "CLAUDE_CODE_OAUTH_SCOPES='x' claude --bare --model='sonnet'"
    );
}

#[test]
fn summary_marks_risks_secrets_and_display_only_items() {
    let summary = option_summary(&tool());
    let find = |id: &str| {
        summary
            .items
            .iter()
            .find(|item| item.id == id)
            .expect("summary item")
            .clone()
    };
    let dangerous = find("--dangerously-skip-permissions");
    assert_eq!(dangerous.kind, "flag");
    assert_eq!(dangerous.risks, vec!["relaxesPermissions"]);
    let key = find("ANTHROPIC_API_KEY");
    assert_eq!(key.kind, "env");
    assert!(key.secret);
    assert!(!find("CLAUDE_CODE_CLIENT_KEY").generatable);
    assert_eq!(summary.coverage_note, COVERAGE_NOTE);
    assert!(
        summary
            .items
            .iter()
            .all(|item| (item.value_type == "unknown") == !item.generatable)
    );
}

#[test]
fn summary_carries_listing_metadata_with_counts_from_the_arrays() {
    let definition = tool();
    let summary = option_summary(&definition);

    assert_eq!(summary.flags_coverage.listed_count, definition.flags.len());
    assert_eq!(summary.env_coverage.listed_count, definition.env.len());
    assert!(!summary.flags_coverage.snapshot_complete);
    assert!(!summary.env_coverage.snapshot_complete);
    assert_eq!(
        summary.env_coverage.coverage_note,
        definition.env_coverage.coverage_note
    );
    assert_eq!(
        summary.env_coverage.source_url,
        "https://code.claude.com/docs/en/env-vars"
    );
    assert_eq!(summary.flags_coverage.retrieved_on, "2026-10-21");
}

#[test]
fn listed_counts_equal_the_items_of_each_kind() {
    let summary = option_summary(&tool());
    let flags = summary
        .items
        .iter()
        .filter(|item| item.kind == "flag")
        .count();
    let env = summary
        .items
        .iter()
        .filter(|item| item.kind == "env")
        .count();

    assert_eq!(summary.flags_coverage.listed_count, flags);
    assert_eq!(summary.env_coverage.listed_count, env);
}

#[test]
fn unlisted_names_are_refused_as_not_for_command_generation() {
    let flag_error = build(&flags(vec![item("--not-listed-in-snapshot", None)]))
        .expect_err("unlisted flag is refused");
    let env_error = build(&env(vec![item("NOT_LISTED_IN_SNAPSHOT", Some("x"))]))
        .expect_err("unlisted variable is refused");

    assert_eq!(flag_error, CommandError::UnknownItem);
    assert_eq!(env_error, CommandError::UnknownItem);
    assert!(flag_error.message().contains("未收录，不能用于命令生成"));
    assert!(env_error.message().contains("未收录，不能用于命令生成"));
}
