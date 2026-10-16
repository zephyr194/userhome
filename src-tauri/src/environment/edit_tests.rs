use super::{
    ChangeKind, EditError, EntryFlag, KeyEdit, LineKind, QuoteStyle, ValueProblem, VerifyError,
    apply_edits, parse, render_value, verify_edit,
};

fn add(key: &str, value: &str) -> KeyEdit {
    KeyEdit::Add {
        key: key.to_owned(),
        value: value.to_owned(),
        exported: false,
    }
}

fn set(key: &str, value: &str) -> KeyEdit {
    KeyEdit::Set {
        key: key.to_owned(),
        value: value.to_owned(),
    }
}

fn remove(key: &str) -> KeyEdit {
    KeyEdit::Remove {
        key: key.to_owned(),
    }
}

fn edited(text: &str, edits: &[KeyEdit]) -> String {
    apply_edits(text, edits)
        .unwrap_or_else(|error| panic!("edit should succeed: {error:?}"))
        .text
}

fn refused(text: &str, edits: &[KeyEdit]) -> EditError {
    match apply_edits(text, edits) {
        Ok(_) => panic!("edit should be refused"),
        Err(error) => error,
    }
}

// ---- adding --------------------------------------------------------------

#[test]
fn adding_appends_a_terminated_line_and_leaves_every_other_byte_alone() {
    assert_eq!(edited("A=1\n", &[add("B", "2")]), "A=1\nB=2\n");
    assert_eq!(edited("", &[add("B", "2")]), "B=2\n");
    assert_eq!(
        edited("# head\n\nA=1\n# tail\n", &[add("B", "2")]),
        "# head\n\nA=1\n# tail\nB=2\n"
    );
}

#[test]
fn adding_to_a_file_without_a_final_newline_completes_that_line_first() {
    assert_eq!(edited("A=1", &[add("B", "2")]), "A=1\nB=2\n");
    assert_eq!(
        edited("# only a comment", &[add("B", "2")]),
        "# only a comment\nB=2\n"
    );
}

#[test]
fn adding_follows_the_line_ending_style_of_the_file() {
    assert_eq!(edited("A=1\r\n", &[add("B", "2")]), "A=1\r\nB=2\r\n");
    assert_eq!(
        edited("A=1\r\nC=3", &[add("B", "2")]),
        "A=1\r\nC=3\r\nB=2\r\n"
    );
}

#[test]
fn several_additions_keep_their_order_and_exported_adds_say_so() {
    let edits = [
        add("B", "2"),
        KeyEdit::Add {
            key: "C".to_owned(),
            value: "three words".to_owned(),
            exported: true,
        },
    ];
    assert_eq!(
        edited("A=1\n", &edits),
        "A=1\nB=2\nexport C='three words'\n"
    );
}

#[test]
fn adding_reports_what_changed_without_losing_the_secret_mark() {
    let outcome =
        apply_edits("A=1\n", &[add("API_TOKEN", "tok-123"), add("PORT", "80")]).expect("edit");
    assert_eq!(outcome.changes.len(), 2);
    let token = &outcome.changes[0];
    assert_eq!(
        (token.key.as_str(), token.kind),
        ("API_TOKEN", ChangeKind::Add)
    );
    assert!(token.secret);
    assert_eq!(token.before, None);
    assert_eq!(token.after.as_deref(), Some("tok-123"));
    assert!(!outcome.changes[1].secret);
}

#[test]
fn a_credential_in_a_url_value_makes_a_new_entry_secret() {
    let outcome =
        apply_edits("", &[add("DATABASE_URL", "postgres://user:pw@db/app")]).expect("edit");
    assert!(outcome.changes[0].secret);
}

// ---- modifying -----------------------------------------------------------

#[test]
fn modifying_rewrites_only_the_value_and_keeps_prefix_comment_and_terminator() {
    assert_eq!(edited("A=old\n", &[set("A", "new")]), "A=new\n");
    assert_eq!(
        edited("  export  A=old # keep me\r\n", &[set("A", "new")]),
        "  export  A=new # keep me\r\n"
    );
    assert_eq!(
        edited("A=\"old\" # note\n", &[set("A", "new")]),
        "A=\"new\" # note\n"
    );
    assert_eq!(edited("A='old'", &[set("A", "new")]), "A='new'");
}

#[test]
fn modifying_never_glues_a_trailing_comment_onto_the_value() {
    assert_eq!(edited("A= # note\n", &[set("A", "x")]), "A= x # note\n");
    assert_eq!(edited("A=old # note\n", &[set("A", "")]), "A= # note\n");
}

#[test]
fn modifying_keeps_the_quote_style_when_it_can_hold_the_value() {
    assert_eq!(edited("A=\"old\"\n", &[set("A", "a b")]), "A=\"a b\"\n");
    assert_eq!(edited("A='old'\n", &[set("A", "a b")]), "A='a b'\n");
    assert_eq!(edited("A=old\n", &[set("A", "a b")]), "A='a b'\n");
    // A single-quoted value cannot contain `'`, so the style changes for that
    // line only.
    assert_eq!(edited("A='old'\n", &[set("A", "it's")]), "A=\"it's\"\n");
    assert_eq!(edited("A=\"old\"\n", &[set("A", "")]), "A=\"\"\n");
}

#[test]
fn modifying_changes_one_line_and_every_other_line_stays_byte_identical() {
    let text = "# header\n\nFOO=1\nexport BAR=\"two words\" # c\nnot an assignment\nDUP=1\nDUP=2\nMULTI=\"a\nb\"\nDYN=$HOME/x\n  # indented\nLAST=9";
    let outcome = apply_edits(text, &[set("FOO", "changed")]).expect("edit");
    let before = parse(text);
    let after = parse(&outcome.text);
    assert_eq!(before.lines.len(), after.lines.len());
    for (old, new) in before.lines.iter().zip(&after.lines) {
        if old.line == 3 {
            assert_eq!(new.raw, "FOO=changed");
        } else {
            assert_eq!((&old.raw, &old.terminator), (&new.raw, &new.terminator));
        }
    }
}

#[test]
fn modifying_to_the_same_value_changes_nothing() {
    let outcome = apply_edits("A=\"same\" # c\n", &[set("A", "same")]).expect("edit");
    assert_eq!(outcome.text, "A=\"same\" # c\n");
    assert!(outcome.changes.is_empty());
}

#[test]
fn a_modification_reports_before_and_after() {
    let outcome = apply_edits("PORT=80\n", &[set("PORT", "8080")]).expect("edit");
    let change = &outcome.changes[0];
    assert_eq!(change.kind, ChangeKind::Modify);
    assert_eq!(change.before.as_deref(), Some("80"));
    assert_eq!(change.after.as_deref(), Some("8080"));
    assert!(!change.secret);
}

#[test]
fn a_secret_entry_stays_secret_even_when_the_new_value_looks_harmless() {
    let outcome = apply_edits("API_TOKEN=old\n", &[set("API_TOKEN", "new")]).expect("edit");
    assert!(outcome.changes[0].secret);
    // And a harmless key whose old value carried a credential is secret too.
    let outcome =
        apply_edits("DB=postgres://u:p@h/d\n", &[set("DB", "postgres://h/d")]).expect("edit");
    assert!(outcome.changes[0].secret);
}

// ---- removing ------------------------------------------------------------

#[test]
fn removing_drops_exactly_that_line() {
    assert_eq!(
        edited("# c\nA=1\nB=2\n\nC=3\n", &[remove("B")]),
        "# c\nA=1\n\nC=3\n"
    );
    assert_eq!(edited("A=1\r\nB=2\r\n", &[remove("A")]), "B=2\r\n");
    assert_eq!(edited("A=1\nB=2", &[remove("B")]), "A=1\n");
    assert_eq!(edited("A=1\n", &[remove("A")]), "");
}

#[test]
fn a_removal_reports_the_old_value_for_the_preview() {
    let outcome = apply_edits("PORT=80\n", &[remove("PORT")]).expect("edit");
    let change = &outcome.changes[0];
    assert_eq!(change.kind, ChangeKind::Remove);
    assert_eq!(change.before.as_deref(), Some("80"));
    assert_eq!(change.after, None);
}

// ---- refusals ------------------------------------------------------------

#[test]
fn unsupported_entries_are_refused_by_every_operation_and_left_as_they_are() {
    let cases: [(&str, EntryFlag); 5] = [
        ("A=1\nA=2\n", EntryFlag::DuplicateKey),
        ("A=$HOME/x\n", EntryFlag::Interpolation),
        ("A=${HOME}/x\n", EntryFlag::Interpolation),
        ("A=$(whoami)\n", EntryFlag::CommandSubstitution),
        ("A=\"one\ntwo\"\n", EntryFlag::MultilineValue),
    ];
    for (text, flag) in cases {
        for edit in [set("A", "x"), remove("A"), add("A", "x")] {
            let error = refused(text, std::slice::from_ref(&edit));
            match (&edit, &error) {
                (KeyEdit::Add { .. }, EditError::KeyExists(key)) => assert_eq!(key, "A"),
                (_, EditError::UnsupportedEntry { key, flags }) => {
                    assert_eq!(key, "A");
                    assert!(flags.contains(&flag), "{text:?}: {flags:?}");
                }
                other => panic!("{text:?} {edit:?}: unexpected {other:?}"),
            }
        }
    }
}

#[test]
fn a_double_quoted_value_with_escapes_is_not_decoded_and_so_not_edited() {
    for text in ["A=\"a\\nb\"\n", "A=\"say \\\"hi\\\"\"\n", "A=\"C:\\\\x\"\n"] {
        assert!(
            matches!(
                refused(text, &[set("A", "x")]),
                EditError::EscapedValue(ref key) if key == "A"
            ),
            "{text:?}"
        );
    }
    // Single quotes and plain values are literal, so they can be edited.
    assert_eq!(edited("A='a\\nb'\n", &[set("A", "x")]), "A='x'\n");
    assert_eq!(edited("A=C:\\x\n", &[set("A", "x")]), "A=x\n");
}

#[test]
fn adding_an_existing_or_unreadable_key_and_changing_a_missing_one_are_refused() {
    assert_eq!(
        refused("A=1\n", &[add("A", "2")]),
        EditError::KeyExists("A".to_owned())
    );
    assert_eq!(
        refused("A=1\n", &[set("B", "2")]),
        EditError::KeyNotFound("B".to_owned())
    );
    assert_eq!(
        refused("A=1\n", &[remove("B")]),
        EditError::KeyNotFound("B".to_owned())
    );
    // A line that starts like `A=…` but is not understood still claims the key.
    for text in [
        "A=\"never closed\nB=1\n",
        "A=\"x\"trailing\n",
        "export A='x\n",
    ] {
        assert_eq!(
            refused(text, &[add("A", "2")]),
            EditError::KeyExists("A".to_owned()),
            "{text:?}"
        );
    }
    assert!(apply_edits("A = 1\n", &[add("A", "2")]).is_err());
}

#[test]
fn a_request_may_name_a_key_only_once_and_must_not_be_empty() {
    assert_eq!(
        refused("A=1\n", &[set("A", "2"), remove("A")]),
        EditError::DuplicateEdit("A".to_owned())
    );
    assert_eq!(
        refused("", &[add("A", "1"), add("A", "2")]),
        EditError::DuplicateEdit("A".to_owned())
    );
    assert_eq!(refused("A=1\n", &[]), EditError::NoEdits);
}

#[test]
fn key_names_must_match_the_dotenv_name_rule() {
    for key in [
        "", "1A", "A-B", "A B", "A=B", "A\nB", "A\r", "é", "A.B", "export ", "A\0", " A",
    ] {
        assert_eq!(
            refused("", &[add(key, "1")]),
            EditError::InvalidKey,
            "{key:?}"
        );
    }
    for key in ["A", "_a", "a_1", "ABC_DEF9"] {
        assert!(apply_edits("", &[add(key, "1")]).is_ok(), "{key}");
    }
}

#[test]
fn a_refused_edit_changes_nothing_even_when_an_earlier_edit_was_fine() {
    let text = "A=1\nB=$X\n";
    assert!(apply_edits(text, &[set("A", "2"), set("B", "3")]).is_err());
}

// ---- value rendering -----------------------------------------------------

#[test]
fn safe_values_are_written_bare_and_others_are_quoted() {
    let cases = [
        ("", "", QuoteStyle::None),
        ("plain", "plain", QuoteStyle::None),
        (
            "a/b.c-d_e:f@g%h+i,j=k",
            "a/b.c-d_e:f@g%h+i,j=k",
            QuoteStyle::None,
        ),
        ("héllo wörld", "'héllo wörld'", QuoteStyle::Single),
        ("héllo", "héllo", QuoteStyle::None),
        ("日本語", "日本語", QuoteStyle::None),
        ("with space", "'with space'", QuoteStyle::Single),
        (" leading", "' leading'", QuoteStyle::Single),
        ("trailing ", "'trailing '", QuoteStyle::Single),
        (
            "a # not a comment",
            "'a # not a comment'",
            QuoteStyle::Single,
        ),
        ("#start", "'#start'", QuoteStyle::Single),
        ("pa$$word", "'pa$$word'", QuoteStyle::Single),
        ("$HOME/bin", "'$HOME/bin'", QuoteStyle::Single),
        ("$(whoami)", "'$(whoami)'", QuoteStyle::Single),
        ("`id`", "'`id`'", QuoteStyle::Single),
        ("back\\slash", "'back\\slash'", QuoteStyle::Single),
        ("say \"hi\"", "'say \"hi\"'", QuoteStyle::Single),
        ("it's", "\"it's\"", QuoteStyle::Double),
        ("it's fine #1", "\"it's fine #1\"", QuoteStyle::Double),
        ("a;b|c&d", "'a;b|c&d'", QuoteStyle::Single),
        ("*glob?", "'*glob?'", QuoteStyle::Single),
        ("~user", "'~user'", QuoteStyle::Single),
        (
            "=starts-with-equals",
            "'=starts-with-equals'",
            QuoteStyle::Single,
        ),
    ];
    for (value, rendered, style) in cases {
        let (text, quote) = render_value(value, QuoteStyle::None)
            .unwrap_or_else(|problem| panic!("{value:?} should render: {problem:?}"));
        assert_eq!((text.as_str(), quote), (rendered, style), "{value:?}");
    }
}

#[test]
fn every_rendering_is_read_back_exactly_with_no_dynamic_flag() {
    let values = [
        "",
        "plain",
        "a b",
        "it's",
        "pa$$word",
        "$HOME",
        "${HOME}",
        "$(id)",
        "`id`",
        "a#b",
        "a #b",
        "\\",
        "\\n",
        "é",
        "😀 emoji",
        "'",
        "\"",
        "a\"b'c ",
        "=",
        "==",
        " ",
        "x\u{00a0}y",
        "https://u:p@h/p?q=1#f",
        "-n",
        "--flag=1",
    ];
    for value in values {
        for prefer in [QuoteStyle::None, QuoteStyle::Single, QuoteStyle::Double] {
            let Ok((rendered, _)) = render_value(value, prefer) else {
                continue;
            };
            let document = parse(&format!("K={rendered}\n"));
            assert_eq!(document.lines.len(), 1, "{value:?} -> {rendered}");
            let LineKind::Entry(entry) = &document.lines[0].kind else {
                panic!("{value:?} -> {rendered} is not an entry");
            };
            assert_eq!(entry.value, value, "{rendered}");
            assert!(
                entry.flags.is_empty(),
                "{value:?} -> {rendered}: {:?}",
                entry.flags
            );
        }
        assert!(
            render_value(value, QuoteStyle::None).is_ok() || value.contains('\''),
            "{value:?} must be representable unless it mixes quote kinds"
        );
    }
}

#[test]
fn values_that_could_become_a_second_line_or_hidden_text_are_refused() {
    for value in [
        "a\nb",
        "a\r\nb",
        "a\rb",
        "a\0b",
        "tab\there",
        "bell\u{7}",
        "esc\u{1b}[31m",
        "line\u{2028}sep",
        "para\u{2029}sep",
        "rtl\u{202e}override",
        "isolate\u{2066}x",
        "mark\u{200f}x",
        "bom\u{feff}x",
        "\n",
    ] {
        assert_eq!(
            render_value(value, QuoteStyle::None),
            Err(ValueProblem::ControlCharacter),
            "{value:?}"
        );
        assert!(
            matches!(
                refused("", &[add("A", value)]),
                EditError::UnsafeValue { ref key, problem: ValueProblem::ControlCharacter } if key == "A"
            ),
            "{value:?}"
        );
    }
}

#[test]
fn a_value_that_needs_both_quote_kinds_and_an_escape_is_refused_not_mangled() {
    for value in ["it's $5", "it's `x`", "it's \"q\"", "it's a\\b"] {
        assert_eq!(
            render_value(value, QuoteStyle::None),
            Err(ValueProblem::NoSafeQuoting),
            "{value:?}"
        );
    }
}

#[test]
fn overlong_values_are_refused() {
    let long = "x".repeat(8193);
    assert_eq!(
        render_value(&long, QuoteStyle::None),
        Err(ValueProblem::TooLong)
    );
    assert!(render_value(&"x".repeat(8192), QuoteStyle::None).is_ok());
}

#[test]
fn malicious_values_never_create_a_second_entry_or_a_dynamic_flag() {
    let attacks = [
        "x'\nEVIL=1",
        "x\"; rm -rf ~ #",
        "$(curl evil)",
        "`curl evil`",
        "${EVIL}",
        "x\u{2028}EVIL=1",
        "a' EVIL='1",
    ];
    for value in attacks {
        match apply_edits("A=1\n", &[add("B", value)]) {
            Err(_) => {}
            Ok(outcome) => {
                let document = parse(&outcome.text);
                let keys: Vec<&str> = document
                    .lines
                    .iter()
                    .filter_map(|line| match &line.kind {
                        LineKind::Entry(entry) => Some(entry.key.as_str()),
                        _ => None,
                    })
                    .collect();
                assert_eq!(keys, ["A", "B"], "{value:?} -> {:?}", outcome.text);
                assert_eq!(document.lines.len(), 2, "{value:?}");
                for line in &document.lines {
                    if let LineKind::Entry(entry) = &line.kind {
                        assert!(entry.flags.is_empty(), "{value:?}: {:?}", entry.flags);
                    }
                }
            }
        }
    }
}

// ---- no value ever reaches Debug output ----------------------------------

#[test]
fn debug_output_of_edits_changes_and_errors_hides_values() {
    let secret = "hunter2-very-secret";
    let edit = add("API_TOKEN", secret);
    assert!(!format!("{edit:?}").contains(secret));
    let outcome = apply_edits("", std::slice::from_ref(&edit)).expect("edit");
    assert!(!format!("{outcome:?}").contains(secret));
    assert!(!format!("{:?}", outcome.changes).contains(secret));
    let error = refused("", &[add("A", &format!("{secret}\n"))]);
    assert!(!format!("{error:?}").contains(secret));
    assert!(!error.message().contains(secret));
}

#[test]
fn error_messages_name_keys_and_reasons_but_never_values() {
    let cases: Vec<EditError> = vec![
        EditError::InvalidKey,
        EditError::NoEdits,
        EditError::DuplicateEdit("A".to_owned()),
        EditError::KeyExists("A".to_owned()),
        EditError::KeyNotFound("A".to_owned()),
        EditError::EscapedValue("A".to_owned()),
        EditError::UnsupportedEntry {
            key: "A".to_owned(),
            flags: vec![EntryFlag::DuplicateKey, EntryFlag::MultilineValue],
        },
        EditError::UnsafeValue {
            key: "A".to_owned(),
            problem: ValueProblem::NoSafeQuoting,
        },
    ];
    for error in cases {
        assert!(!error.message().is_empty());
    }
    let message = EditError::UnsupportedEntry {
        key: "A".to_owned(),
        flags: vec![EntryFlag::DuplicateKey],
    }
    .message();
    assert!(
        message.contains('A') && message.contains("重复"),
        "{message}"
    );
}

// ---- verification of what was written ------------------------------------

fn changes_of(text: &str, edits: &[KeyEdit]) -> (String, Vec<super::KeyChange>) {
    let outcome = apply_edits(text, edits).expect("edit");
    (outcome.text, outcome.changes)
}

#[test]
fn verification_accepts_exactly_what_the_edit_produced() {
    let original = "# c\nA=1\nB=\"x y\"\nunknown line\n\nC=3";
    for edits in [
        vec![add("D", "4")],
        vec![set("A", "9")],
        vec![remove("B")],
        vec![add("D", "4"), set("A", "9"), remove("C")],
    ] {
        let (written, changes) = changes_of(original, &edits);
        assert_eq!(verify_edit(original, written.as_bytes(), &changes), Ok(()));
    }
}

#[test]
fn verification_rejects_a_wrong_value_a_missing_key_or_a_second_copy() {
    let original = "A=1\nB=2\n";
    let (_, changes) = changes_of(original, &[set("A", "9")]);
    for (written, expected) in [
        ("A=8\nB=2\n", VerifyError::ValueMismatch("A".to_owned())),
        ("B=2\n", VerifyError::KeyMissing("A".to_owned())),
        (
            "A=9\nB=2\nA=9\n",
            VerifyError::UnexpectedFlags("A".to_owned()),
        ),
    ] {
        assert_eq!(
            verify_edit(original, written.as_bytes(), &changes),
            Err(expected),
            "{written:?}"
        );
    }
    let (_, changes) = changes_of(original, &[remove("A")]);
    assert_eq!(
        verify_edit(original, b"A=1\nB=2\n", &changes),
        Err(VerifyError::KeyStillPresent("A".to_owned()))
    );
}

#[test]
fn verification_rejects_any_change_to_an_untouched_line() {
    let original = "# keep\nA=1\nB=2\n\nC=3\n";
    let (_, changes) = changes_of(original, &[set("A", "9")]);
    for written in [
        "# kept\nA=9\nB=2\n\nC=3\n",
        "# keep\nA=9\nB=3\n\nC=3\n",
        "# keep\nA=9\nB=2\nC=3\n",
        "# keep\nA=9\nB=2\n\nC=3\nEXTRA=1\n",
    ] {
        assert_eq!(
            verify_edit(original, written.as_bytes(), &changes),
            Err(VerifyError::OtherLinesChanged),
            "{written:?}"
        );
    }
    assert_eq!(
        verify_edit(original, &[0xff, 0xfe], &changes),
        Err(VerifyError::NotText)
    );
}
