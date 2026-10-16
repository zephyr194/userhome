use super::super::{
    dotenv::ChangeKind,
    zsh_parse::{self, LineKind, ValueState},
};
use super::{
    BEGIN_MARKER, BlockContent, BlockEdit, BlockProblem, BlockState, END_MARKER, EditError,
    ManagedVariable, PathProblem, ValueProblem, VarEdit, VerifyError, apply, detect_eol, inspect,
    normalize_path_item, quote, render_lines, verify,
};

fn set(name: &str, value: &str) -> VarEdit {
    VarEdit::Set {
        name: name.to_owned(),
        value: value.to_owned(),
    }
}

fn remove(name: &str) -> VarEdit {
    VarEdit::Remove {
        name: name.to_owned(),
    }
}

fn vars(edits: Vec<VarEdit>) -> BlockEdit {
    BlockEdit {
        variables: edits,
        path: None,
    }
}

fn path(items: &[&str]) -> BlockEdit {
    BlockEdit {
        variables: Vec::new(),
        path: Some(items.iter().map(|item| (*item).to_owned()).collect()),
    }
}

fn block(body: &str) -> String {
    format!("{BEGIN_MARKER}\n{body}{END_MARKER}\n")
}

fn applied(text: &str, edit: &BlockEdit) -> super::Applied {
    apply(text, edit).expect("edit applies")
}

fn present(text: &str) -> super::ManagedBlock {
    match inspect(text) {
        BlockState::Present(block) => block,
        other => panic!("not present: {other:?}"),
    }
}

fn broken(text: &str) -> BlockProblem {
    match inspect(text) {
        BlockState::Broken(problem) => problem,
        other => panic!("not broken: {other:?}"),
    }
}

// ---- structure ---------------------------------------------------------------------

#[test]
fn a_file_without_markers_has_no_block() {
    assert_eq!(inspect(""), BlockState::Absent);
    assert_eq!(
        inspect("export A=1\n# ordinary comment\n"),
        BlockState::Absent
    );
    // Near-misses are ordinary comments, not markers.
    assert_eq!(
        inspect("# >>> UserHome managed block >>>\n# UserHome managed block (zsh)\n"),
        BlockState::Absent
    );
}

#[test]
fn a_well_formed_block_is_read_with_its_variables_and_path() {
    let text = format!(
        "export BEFORE=1\n{BEGIN_MARKER}\nexport Z='a'\\''b'\nexport A=''\nexport path=('/opt/x y' \"$HOME\"/'bin' \"$HOME\" $path)\n{END_MARKER}\nexport AFTER=2\n"
    );
    let parsed = present(&text);
    assert_eq!(
        parsed.content,
        BlockContent {
            variables: vec![
                ManagedVariable {
                    name: "Z".to_owned(),
                    value: "a'b".to_owned()
                },
                ManagedVariable {
                    name: "A".to_owned(),
                    value: String::new()
                },
            ],
            path: vec![
                "/opt/x y".to_owned(),
                "$HOME/bin".to_owned(),
                "$HOME".to_owned()
            ],
        }
    );
    assert_eq!((parsed.begin_line, parsed.end_line), (2, 6));
    assert_eq!(parsed.variable_lines, vec![3, 4]);
    assert_eq!(parsed.path_line, Some(5));
    assert_eq!(&text[parsed.body_end..parsed.body_end + 5], "# <<<");
}

#[test]
fn damaged_structure_is_reported_never_repaired() {
    let begin = format!("{BEGIN_MARKER}\n");
    let end = format!("{END_MARKER}\n");
    assert_eq!(
        broken(&format!("a\n{begin}export A='1'\n")),
        BlockProblem::MissingEnd { begin_line: 2 }
    );
    assert_eq!(
        broken(&format!("a\n{end}")),
        BlockProblem::MissingBegin { end_line: 2 }
    );
    assert_eq!(
        broken(&format!("{end}{begin}")),
        BlockProblem::WrongOrder { end_line: 1 }
    );
    assert_eq!(
        broken(&format!("{begin}{begin}{end}")),
        BlockProblem::Nested { line: 2 }
    );
    assert_eq!(
        broken(&format!("{begin}{end}{begin}{end}")),
        BlockProblem::Duplicate { line: 3 }
    );
    assert_eq!(
        broken(&format!("{begin}{end}{end}")),
        BlockProblem::Duplicate { line: 3 }
    );
    for text in [
        format!("{begin}{begin}"),
        format!("{end}{end}"),
        format!("{begin}{end}{begin}"),
    ] {
        assert!(matches!(inspect(&text), BlockState::Broken(_)), "{text:?}");
    }
}

#[test]
fn a_body_line_that_userhome_did_not_generate_is_unmanaged() {
    for body in [
        "export A=1\n",
        "export A=\"x\"\n",
        "export A='x' # note\n",
        "A='x'\n",
        "\n",
        "# note\n",
        "export A='x'; rm -rf x\n",
        "export A='x'\nexport A='y'\n",
        "export PATH='/a'\n",
        "export path=($path)\n",
        "export path=('/a' $path)\nexport path=('/b' $path)\n",
        "export path=('relative' $path)\n",
        "export path=('/a'  $path)\n",
        "export path=('$HOME/x' $path)\n",
        "export path=(\"$HOME\"x $path)\n",
        "source ~/x\n",
    ] {
        let text = block(body);
        assert!(
            matches!(broken(&text), BlockProblem::Unmanaged { .. }),
            "{body:?}"
        );
        // And no structured edit proceeds.
        assert!(matches!(
            apply(&text, &vars(vec![set("B", "1")])),
            Err(EditError::Block(BlockProblem::Unmanaged { .. }))
        ));
    }
}

#[test]
fn markers_with_surrounding_space_crlf_and_a_byte_order_mark_are_recognized() {
    let text = format!("\u{feff}{BEGIN_MARKER}\r\nexport A='1'\r\n  {END_MARKER}  \r\n");
    let parsed = present(&text);
    assert_eq!(parsed.eol, "\r\n");
    assert_eq!(parsed.content.variables.len(), 1);
    assert_eq!(parsed.begin_line, 1);
}

// ---- appending a block ----------------------------------------------------------------

#[test]
fn a_block_is_appended_to_an_empty_file_without_a_leading_blank_line() {
    let result = applied("", &vars(vec![set("EDITOR", "vim")]));
    assert!(result.created_block);
    assert_eq!(result.text, block("export EDITOR='vim'\n"));
}

#[test]
fn a_block_is_appended_after_the_existing_bytes_which_stay_a_prefix() {
    for original in [
        "export A=1\n",
        "export A=1",
        "export A=1\n\n",
        "export A=1\r\n",
        "export A=1\r\n\r\n",
        "\u{feff}export A=1\n",
        "# only a comment",
        "\n",
    ] {
        let result = applied(original, &vars(vec![set("B", "2")]));
        assert!(result.text.starts_with(original), "{original:?}");
        let appended = &result.text[original.len()..];
        // The original is never rewritten: only separator bytes and the block follow.
        assert!(appended.contains(BEGIN_MARKER));
        assert!(
            appended.trim_start().starts_with(BEGIN_MARKER),
            "{appended:?}"
        );
        assert_eq!(present(&result.text).content.variables.len(), 1);
        verify(original, result.text.as_bytes(), &result.desired).expect("verifies");
    }
}

#[test]
fn an_unterminated_last_line_gets_a_terminator_and_one_blank_line() {
    let result = applied("export A=1", &vars(vec![set("B", "2")]));
    assert_eq!(
        result.text,
        format!("export A=1\n\n{}", block("export B='2'\n"))
    );
    let blank = applied("export A=1\n\n", &vars(vec![set("B", "2")]));
    assert_eq!(
        blank.text,
        format!("export A=1\n\n{}", block("export B='2'\n"))
    );
}

#[test]
fn the_block_follows_the_line_ending_of_the_file() {
    assert_eq!(detect_eol(""), "\n");
    assert_eq!(detect_eol("a"), "\n");
    assert_eq!(detect_eol("a\nb\r\n"), "\n");
    assert_eq!(detect_eol("a\r\nb\n"), "\r\n");
    let result = applied("export A=1\r\n", &vars(vec![set("B", "2")]));
    assert_eq!(
        result.text,
        format!("export A=1\r\n\r\n{BEGIN_MARKER}\r\nexport B='2'\r\n{END_MARKER}\r\n")
    );
    assert!(!result.text.replace("\r\n", "").contains('\n'));
}

// ---- replacing the body ---------------------------------------------------------------

#[test]
fn bytes_outside_the_markers_stay_identical_when_the_block_changes() {
    for (before, after) in [
        ("export A=1\n", "export Z=9\n"),
        ("export A=1\r\n", "export Z=9\r\n"),
        ("\u{feff}# top\n", ""),
        ("", "export Z=9"),
        ("a\n\n\n", "\n\n# end\n"),
        ("export  SPACED =  1\t\n", "if true; then\n  :\nfi\n"),
    ] {
        let eol = if before.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let original =
            format!("{before}{BEGIN_MARKER}{eol}export OLD='1'{eol}{END_MARKER}{eol}{after}");
        let result = applied(&original, &vars(vec![set("OLD", "2"), set("NEW", "3")]));
        let new = present(&result.text);
        let old = present(&original);
        assert_eq!(&result.text[..new.body_start], &original[..old.body_start]);
        assert_eq!(&result.text[new.body_end..], &original[old.body_end..]);
        assert!(!result.created_block);
        verify(&original, result.text.as_bytes(), &result.desired).expect("verifies");
    }
}

#[test]
fn an_end_marker_without_a_final_newline_stays_that_way() {
    let original = format!("{BEGIN_MARKER}\nexport A='1'\n{END_MARKER}");
    let result = applied(&original, &vars(vec![set("A", "2")]));
    assert_eq!(
        result.text,
        format!("{BEGIN_MARKER}\nexport A='2'\n{END_MARKER}")
    );
}

#[test]
fn set_changes_in_place_adds_at_the_end_and_remove_deletes() {
    let original = block("export A='1'\nexport B='2'\n");
    let result = applied(
        &original,
        &vars(vec![set("A", "x"), set("C", "3"), remove("B")]),
    );
    assert_eq!(result.text, block("export A='x'\nexport C='3'\n"));
    let kinds: Vec<(&str, ChangeKind)> = result
        .variable_changes
        .iter()
        .map(|change| (change.name.as_str(), change.kind))
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("A", ChangeKind::Modify),
            ("C", ChangeKind::Add),
            ("B", ChangeKind::Remove)
        ]
    );
    assert_eq!(result.variable_changes[0].before.as_deref(), Some("1"));
    assert_eq!(result.variable_changes[0].after.as_deref(), Some("x"));
}

#[test]
fn setting_the_same_value_changes_nothing_and_leaves_the_text_alone() {
    let original = block("export A='1'\n");
    let result = applied(&original, &vars(vec![set("A", "1")]));
    assert!(result.is_empty());
    assert_eq!(result.text, original);
}

#[test]
fn removing_everything_keeps_an_empty_block() {
    let original = block("export A='1'\nexport path=('/a' $path)\n");
    let mut edit = vars(vec![remove("A")]);
    edit.path = Some(Vec::new());
    let result = applied(&original, &edit);
    assert_eq!(result.text, block(""));
    assert!(present(&result.text).content.variables.is_empty());
}

#[test]
fn only_variables_inside_the_block_can_be_changed_or_removed() {
    // Same-named assignments outside the block are neither read nor touched.
    let original = format!("export A=outside\n{BEGIN_MARKER}\nexport A_IN='1'\n{END_MARKER}\n");
    assert_eq!(
        apply(&original, &vars(vec![remove("A")])),
        Err(EditError::NotManaged("A".to_owned()))
    );
    let result = applied(&original, &vars(vec![set("A", "inside")]));
    assert!(result.text.starts_with("export A=outside\n"));
    assert_eq!(result.variable_changes[0].kind, ChangeKind::Add);
}

#[test]
fn nothing_is_edited_when_no_edit_is_given_or_the_name_repeats() {
    assert_eq!(apply("", &BlockEdit::default()), Err(EditError::NoEdits));
    assert_eq!(
        apply("", &vars(vec![set("A", "1"), remove("A")])),
        Err(EditError::DuplicateEdit("A".to_owned()))
    );
    // Removing from a file without a block is not a silent no-op.
    assert_eq!(
        apply("export A=1\n", &vars(vec![remove("A")])),
        Err(EditError::NotManaged("A".to_owned()))
    );
}

#[test]
fn a_structurally_damaged_block_blocks_every_edit_and_changes_nothing() {
    let text = format!("{BEGIN_MARKER}\nexport A='1'\n");
    assert_eq!(
        apply(&text, &vars(vec![set("B", "1")])),
        Err(EditError::Block(BlockProblem::MissingEnd { begin_line: 1 }))
    );
    assert!(matches!(
        apply(&text, &path(&["/a"])),
        Err(EditError::Block(_))
    ));
}

// ---- names and values ---------------------------------------------------------------

#[test]
fn invalid_and_reserved_names_are_refused() {
    for name in [
        "",
        "1A",
        "A-B",
        "A B",
        "A=1",
        "$(x)",
        "A;B",
        "a.b",
        "é",
        "A\n",
        "-x",
        &"A".repeat(256),
    ] {
        assert_eq!(
            apply("", &vars(vec![set(name, "1")])),
            Err(EditError::InvalidName(name.to_owned())),
            "{name:?}"
        );
    }
    for name in ["PATH", "path"] {
        assert_eq!(
            apply("", &vars(vec![set(name, "1")])),
            Err(EditError::ReservedName(name.to_owned()))
        );
    }
    assert!(
        apply(
            "",
            &vars(vec![set("_ok1", "1"), set(&"A".repeat(255), "1")])
        )
        .is_ok()
    );
}

/// Values that must be stored exactly and never be read as syntax.
const LITERAL_VALUES: [&str; 26] = [
    "plain",
    "",
    " ",
    "  leading and trailing  ",
    "it's",
    "'",
    "''",
    "'; rm -rf / #",
    "\"double\"",
    "a\"b'c",
    "$(touch /tmp/pwned)",
    "`touch /tmp/pwned`",
    "$HOME",
    "${HOME}/x",
    "$PATH:$PATH",
    "a;b&c|d",
    "a && b || c > /tmp/x < /dev/null",
    "back\\slash",
    "\\'",
    "\\",
    "x\\'\\''y",
    "# not a comment",
    "-n",
    "--flag=value",
    "日本語 ünï 😀 \u{00a0}",
    "~/not-a-tilde-expansion",
];

#[test]
fn hostile_values_are_stored_as_literals_and_read_back_exactly() {
    for value in LITERAL_VALUES {
        let result = applied("export KEEP=1\n", &vars(vec![set("DEMO", value)]));
        // 1. The generated line is the plain single-quoted form and nothing else.
        let expected_line = format!("export DEMO={}", quote(value));
        assert!(
            result.text.lines().any(|line| line == expected_line),
            "{value:?}"
        );
        assert_eq!(
            result.text.lines().count(),
            5,
            "{value:?}: one line per entry"
        );
        // 2. The block reader decodes the exact value.
        assert_eq!(
            present(&result.text).content.variables[0].value,
            value,
            "{value:?}"
        );
        // 3. The read-only zsh view's parser agrees: a static literal, one statement.
        let lines = zsh_parse::parse(&result.text);
        let entries: Vec<_> = lines
            .iter()
            .filter_map(|line| match &line.kind {
                LineKind::Entries(entries) => Some(entries),
                _ => None,
            })
            .flatten()
            .filter(|entry| entry.name == "DEMO")
            .collect();
        assert_eq!(entries.len(), 1, "{value:?}");
        assert_eq!(entries[0].value, value, "{value:?}");
        assert_eq!(entries[0].state, ValueState::Static, "{value:?}");
        // 4. The transaction's own check passes.
        verify("export KEEP=1\n", result.text.as_bytes(), &result.desired)
            .unwrap_or_else(|error| panic!("{value:?}: {error:?}"));
    }
}

#[test]
fn no_generated_line_contains_an_unquoted_special_character() {
    // Outside single quotes only the fixed words, `=`, `'` and the `\'` escape appear.
    for value in LITERAL_VALUES {
        let line = format!("export DEMO={}", quote(value));
        let mut inside = false;
        let mut chars = line.chars().peekable();
        let mut unquoted = String::new();
        while let Some(character) = chars.next() {
            match character {
                '\'' => inside = !inside,
                '\\' if !inside => {
                    assert_eq!(chars.next(), Some('\''), "{value:?}");
                }
                other if !inside => unquoted.push(other),
                _ => {}
            }
        }
        assert_eq!(unquoted, "export DEMO=", "{value:?}");
    }
}

#[test]
fn values_that_cannot_be_one_safe_line_are_refused_without_being_written() {
    for value in [
        "a\nb",
        "a\r\nb",
        "a\rb",
        "trailing\n",
        "nul\0byte",
        "tab\there",
        "\u{1b}[31mred",
        "\u{7f}",
        "bidi\u{202e}override",
        "line\u{2028}separator",
        "zero\u{200b}width",
        "bom\u{feff}inside",
    ] {
        assert_eq!(
            apply("", &vars(vec![set("DEMO", value)])),
            Err(EditError::Value {
                name: "DEMO".to_owned(),
                problem: ValueProblem::ControlCharacter
            }),
            "{value:?}"
        );
    }
    let long = "x".repeat(8192);
    assert!(apply("", &vars(vec![set("DEMO", &long)])).is_ok());
    let too_long = "x".repeat(8193);
    assert_eq!(
        apply("", &vars(vec![set("DEMO", &too_long)])),
        Err(EditError::Value {
            name: "DEMO".to_owned(),
            problem: ValueProblem::TooLong
        })
    );
    // An overlong value of multi-byte characters is counted in characters.
    assert!(apply("", &vars(vec![set("DEMO", &"é".repeat(8192))])).is_ok());
}

#[test]
fn a_hostile_value_is_still_one_statement_in_a_file_with_other_content() {
    let original = "alias ll='ls -l'\nif [ -f ~/.x ]; then\n  export B=1\nfi\n";
    let result = applied(original, &vars(vec![set("DEMO", "x'; echo pwned; echo '")]));
    let lines = zsh_parse::parse(&result.text);
    let in_block = lines
        .iter()
        .filter(|line| line.line > 6 && line.line < lines.last().map_or(0, |l| l.end_line))
        .count();
    assert_eq!(in_block, 1);
    assert!(
        result
            .text
            .lines()
            .any(|line| line == "export DEMO='x'\\''; echo pwned; echo '\\'''")
    );
}

// ---- PATH -----------------------------------------------------------------------------

#[test]
fn path_items_are_normalized_to_absolute_or_home_based_forms() {
    for (raw, expected) in [
        ("/usr/local/bin", "/usr/local/bin"),
        ("/opt/my tool/bin", "/opt/my tool/bin"),
        ("/opt/$weird/`x`/it's", "/opt/$weird/`x`/it's"),
        ("~", "$HOME"),
        ("~/bin", "$HOME/bin"),
        ("$HOME", "$HOME"),
        ("$HOME/.local/bin", "$HOME/.local/bin"),
        ("${HOME}/go/bin", "$HOME/go/bin"),
        ("$HOME/", "$HOME/"),
    ] {
        assert_eq!(normalize_path_item(raw).as_deref(), Ok(expected), "{raw}");
    }
    for (raw, problem) in [
        ("", PathProblem::Empty),
        ("a:b", PathProblem::Colon),
        (":", PathProblem::Colon),
        (" /a", PathProblem::SurroundingSpace),
        ("/a ", PathProblem::SurroundingSpace),
        ("/a\nb", PathProblem::ControlCharacter),
        ("/a\0", PathProblem::ControlCharacter),
        ("relative/bin", PathProblem::NotAbsolute),
        (".", PathProblem::NotAbsolute),
        ("./bin", PathProblem::NotAbsolute),
        ("..", PathProblem::NotAbsolute),
        ("~user/bin", PathProblem::NotAbsolute),
        ("$HOMEX/bin", PathProblem::NotAbsolute),
        ("$PATH", PathProblem::NotAbsolute),
        ("$(pwd)/bin", PathProblem::NotAbsolute),
        ("`pwd`", PathProblem::NotAbsolute),
    ] {
        assert_eq!(normalize_path_item(raw), Err(problem), "{raw:?}");
    }
    assert_eq!(
        normalize_path_item(&format!("/{}", "a".repeat(1024))),
        Err(PathProblem::TooLong)
    );
}

#[test]
fn the_path_line_prepends_literal_items_and_keeps_the_existing_path() {
    let result = applied(
        "",
        &path(&["/opt/a", "~/bin", "/opt/with space", "/opt/it's", "$HOME"]),
    );
    assert_eq!(
        result.text,
        block(
            "export path=('/opt/a' \"$HOME\"/'bin' '/opt/with space' '/opt/it'\\''s' \"$HOME\" $path)\n"
        )
    );
    // Written form → same items.
    assert_eq!(
        present(&result.text).content.path,
        vec![
            "/opt/a",
            "$HOME/bin",
            "/opt/with space",
            "/opt/it's",
            "$HOME"
        ]
    );
    assert_eq!(result.path_change.as_ref().expect("change").before.len(), 0);
}

#[test]
fn the_path_line_reads_back_through_the_zsh_parser_without_empty_segments() {
    let result = applied(
        "",
        &path(&["/opt/a", "~/bin", "/opt/it's $x `y`", "$HOME/"]),
    );
    let lines = zsh_parse::parse(&result.text);
    let entry = lines
        .iter()
        .find_map(|line| match &line.kind {
            LineKind::Entries(entries) => entries.iter().find(|entry| entry.name == "path"),
            _ => None,
        })
        .expect("path entry");
    let segments = entry.segments.as_ref().expect("segments");
    let texts: Vec<(&str, ValueState)> = segments
        .iter()
        .map(|segment| (segment.text.as_str(), segment.state))
        .collect();
    assert_eq!(
        texts,
        vec![
            ("/opt/a", ValueState::Static),
            ("$HOME/bin", ValueState::Reference),
            ("/opt/it's $x `y`", ValueState::Static),
            ("$HOME/", ValueState::Reference),
            ("$path", ValueState::Reference),
        ]
    );
    assert!(segments.iter().all(|segment| !segment.text.is_empty()));
    assert!(entry.exported);
    verify("", result.text.as_bytes(), &result.desired).expect("verifies");
}

#[test]
fn path_items_can_be_added_removed_and_reordered_by_sending_the_new_list() {
    let original = block("export path=('/a' '/b' '/c' $path)\n");
    let reordered = applied(&original, &path(&["/c", "/a", "/b"]));
    assert_eq!(
        reordered.text,
        block("export path=('/c' '/a' '/b' $path)\n")
    );
    let change = reordered.path_change.expect("changed");
    assert_eq!(change.before, vec!["/a", "/b", "/c"]);
    assert_eq!(change.after, vec!["/c", "/a", "/b"]);
    let removed = applied(&original, &path(&["/a", "/c"]));
    assert_eq!(removed.text, block("export path=('/a' '/c' $path)\n"));
    let added = applied(&original, &path(&["/a", "/b", "/c", "/d"]));
    assert_eq!(
        added.text,
        block("export path=('/a' '/b' '/c' '/d' $path)\n")
    );
    let cleared = applied(&original, &path(&[]));
    assert_eq!(cleared.text, block(""));
    // The same list is no change.
    assert!(applied(&original, &path(&["/a", "/b", "/c"])).is_empty());
}

#[test]
fn a_bad_path_item_names_its_position_and_nothing_is_written() {
    assert_eq!(
        apply("", &path(&["/ok", "relative"])),
        Err(EditError::Path {
            index: 1,
            problem: PathProblem::NotAbsolute
        })
    );
    assert_eq!(
        apply("", &path(&["/ok", "/a:/b"])),
        Err(EditError::Path {
            index: 1,
            problem: PathProblem::Colon
        })
    );
    assert_eq!(
        apply("", &path(&[""])),
        Err(EditError::Path {
            index: 0,
            problem: PathProblem::Empty
        })
    );
    let too_many: Vec<String> = (0..65).map(|index| format!("/p{index}")).collect();
    assert_eq!(
        apply(
            "",
            &BlockEdit {
                variables: Vec::new(),
                path: Some(too_many)
            }
        ),
        Err(EditError::TooManyPathItems)
    );
}

#[test]
fn duplicate_items_are_kept_as_written_not_silently_merged() {
    let result = applied("", &path(&["/a", "/b", "/a"]));
    assert_eq!(present(&result.text).content.path, vec!["/a", "/b", "/a"]);
}

// ---- verification ---------------------------------------------------------------------

#[test]
fn verification_rejects_changed_outside_bytes_and_wrong_content() {
    let original = format!("export A=1\n{}", block("export B='1'\n"));
    let result = applied(&original, &vars(vec![set("B", "2")]));
    assert_eq!(
        verify(&original, result.text.as_bytes(), &result.desired),
        Ok(())
    );

    let tampered_outside = result.text.replace("export A=1", "export A=2");
    assert_eq!(
        verify(&original, tampered_outside.as_bytes(), &result.desired),
        Err(VerifyError::OutsideChanged)
    );
    let tampered_tail = format!("{}# trailing\n", result.text);
    assert_eq!(
        verify(&original, tampered_tail.as_bytes(), &result.desired),
        Err(VerifyError::OutsideChanged)
    );
    let wrong_value = result.text.replace("'2'", "'3'");
    assert_eq!(
        verify(&original, wrong_value.as_bytes(), &result.desired),
        Err(VerifyError::ContentMismatch)
    );
    assert_eq!(
        verify(&original, b"export A=1\n", &result.desired),
        Err(VerifyError::BlockMissing)
    );
    assert_eq!(
        verify(&original, &[0xff, 0xfe], &result.desired),
        Err(VerifyError::NotText)
    );
    let broken_text = format!("{BEGIN_MARKER}\n");
    assert!(matches!(
        verify(&original, broken_text.as_bytes(), &result.desired),
        Err(VerifyError::BlockBroken(_))
    ));
}

#[test]
fn verification_of_an_appended_block_requires_the_original_to_be_a_prefix() {
    let original = "export A=1\n";
    let result = applied(original, &vars(vec![set("B", "2")]));
    let changed = result.text.replacen("export A=1", "export A=9", 1);
    assert_eq!(
        verify(original, changed.as_bytes(), &result.desired),
        Err(VerifyError::OutsideChanged)
    );
}

#[test]
fn debug_output_never_contains_a_value() {
    let secret = "very-secret-value";
    let result = applied("", &vars(vec![set("API_TOKEN", secret)]));
    let printed = format!(
        "{:?} {:?} {:?}",
        result,
        set("API_TOKEN", secret),
        ManagedVariable {
            name: "API_TOKEN".to_owned(),
            value: secret.to_owned()
        }
    );
    assert!(!printed.contains(secret), "{printed}");
    assert!(printed.contains("API_TOKEN"));
}

#[test]
fn display_lines_mask_secret_values_and_keep_the_rest() {
    let result = applied(
        "",
        &vars(vec![
            set("API_TOKEN", "hunter2-token"),
            set("URL", "https://user:pass@example.com/x"),
            set("EDITOR", "vim"),
        ]),
    );
    let shown = result.after_lines.join("\n");
    assert!(!shown.contains("hunter2-token"));
    assert!(!shown.contains("user:pass"));
    assert!(shown.contains("export EDITOR='vim'"));
    assert!(shown.contains("export API_TOKEN='••••••'"));
    assert!(
        result
            .variable_changes
            .iter()
            .any(|c| c.name == "API_TOKEN" && c.secret)
    );
    assert!(
        !result
            .variable_changes
            .iter()
            .any(|c| c.name == "EDITOR" && c.secret)
    );
    // The real rendering still carries the value.
    assert!(render_lines(&result.desired, false)[0].contains("hunter2-token"));
}

#[test]
fn a_block_may_hold_the_variable_cap_and_not_more() {
    let edits: Vec<VarEdit> = (0..128)
        .map(|index| set(&format!("V{index}"), "1"))
        .collect();
    let result = applied("", &vars(edits));
    assert_eq!(present(&result.text).content.variables.len(), 128);
    assert_eq!(
        apply(&result.text, &vars(vec![set("EXTRA", "1")])),
        Err(EditError::TooManyVariables)
    );
}

#[test]
fn error_messages_name_the_variable_and_never_the_value() {
    let secret = "very-secret-value\n";
    let error = apply("", &vars(vec![set("API_TOKEN", secret)])).expect_err("refused");
    let message = error.message();
    assert!(message.contains("API_TOKEN"));
    assert!(!message.contains("very-secret-value"));
    assert!(!format!("{error:?}").contains("very-secret-value"));
}
