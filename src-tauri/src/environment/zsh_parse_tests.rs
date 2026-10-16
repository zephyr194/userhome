use super::{
    DynamicReason, LineKind, Operation, PathSegment, ValueState, ZshEntry, expand_home_literal,
    parse,
};

fn kinds(text: &str) -> Vec<LineKind> {
    parse(text).into_iter().map(|line| line.kind).collect()
}

fn entries(text: &str) -> Vec<ZshEntry> {
    parse(text)
        .into_iter()
        .flat_map(|line| match line.kind {
            LineKind::Entries(entries) => entries,
            _ => Vec::new(),
        })
        .collect()
}

fn only_entry(text: &str) -> ZshEntry {
    let found = entries(text);
    assert_eq!(found.len(), 1, "{text:?} -> {:?}", parse(text));
    found.into_iter().next().expect("one entry")
}

fn dynamic(text: &str) -> DynamicReason {
    match &parse(text)[..] {
        [line] => match line.kind {
            LineKind::Dynamic(reason) => reason,
            ref other => panic!("{text:?} is not dynamic: {other:?}"),
        },
        other => panic!("{text:?} gave {other:?}"),
    }
}

fn segment(text: &str, state: ValueState) -> PathSegment {
    PathSegment {
        text: text.to_owned(),
        state,
    }
}

// ---- blank lines, comments, literal assignments -----------------------------

#[test]
fn blank_lines_and_comments_keep_their_line_numbers() {
    let lines = parse("\n# a comment\n   \n  # indented\n");
    let shape: Vec<_> = lines
        .iter()
        .map(|line| (line.line, line.end_line, line.kind.clone()))
        .collect();
    assert_eq!(
        shape,
        [
            (1, 1, LineKind::Blank),
            (2, 2, LineKind::Comment),
            (3, 3, LineKind::Blank),
            (4, 4, LineKind::Comment),
        ]
    );
    assert!(parse("").is_empty());
}

#[test]
fn literal_assignments_are_static_entries_with_decoded_values() {
    let plain = only_entry("FOO=bar\n");
    assert_eq!(plain.name, "FOO");
    assert_eq!(plain.value, "bar");
    assert_eq!(plain.state, ValueState::Static);
    assert_eq!(plain.reason, None);
    assert!(!plain.exported);
    assert_eq!(plain.operation, Operation::Set);

    let exported = only_entry("export EDITOR=\"vim -f\"");
    assert_eq!(exported.value, "vim -f");
    assert!(exported.exported);

    assert_eq!(only_entry("EMPTY=").value, "");
    assert_eq!(
        only_entry("export Q='$HOME is text'").value,
        "$HOME is text"
    );
    assert_eq!(only_entry("A=a\\ b").value, "a b");
    assert_eq!(
        only_entry(r#"A="say \"hi\" \\ \$x""#).value,
        r#"say "hi" \ $x"#
    );
    assert_eq!(only_entry("A=one\"two\"'three'").value, "onetwothree");
    assert_eq!(only_entry("export A=1 # trailing comment").value, "1");
    assert_eq!(only_entry("export A=1;").value, "1");
    assert_eq!(only_entry("A+=more").operation, Operation::Append);
}

#[test]
fn typeset_and_declare_forms_are_read_literally() {
    let exported = only_entry("typeset -x LANG=en_US.UTF-8");
    assert!(exported.exported);
    assert_eq!(exported.value, "en_US.UTF-8");
    assert!(only_entry("typeset -gx A=1").exported);
    assert!(only_entry("declare -x B=2").exported);
    assert!(!only_entry("typeset C=3").exported);
}

#[test]
fn several_assignments_on_one_statement_give_one_entry_each() {
    let found = entries("export A=1 B='two words' C=\"3\"\n");
    let shape: Vec<_> = found
        .iter()
        .map(|e| (e.name.as_str(), e.value.as_str()))
        .collect();
    assert_eq!(shape, [("A", "1"), ("B", "two words"), ("C", "3")]);
    assert_eq!(entries("A=1 B=2").len(), 2);
}

#[test]
fn the_same_name_twice_is_kept_as_two_entries_without_merging() {
    let found = entries("export EDITOR=vim\nexport EDITOR=nano\n");
    assert_eq!(found.len(), 2);
    assert_eq!(
        (found[0].value.as_str(), found[1].value.as_str()),
        ("vim", "nano")
    );
}

// ---- references and dynamic values -----------------------------------------

#[test]
fn references_to_home_path_and_tilde_are_kept_unresolved() {
    for text in [
        "export X=$HOME/x",
        "export X=\"${HOME}/y\"",
        "export X=~/x",
        "export X=$PATH:/z",
    ] {
        let entry = only_entry(text);
        assert_eq!(entry.state, ValueState::Reference, "{text}");
        assert_eq!(entry.reason, None, "{text}");
    }
    // The text stays as written; nothing is expanded.
    assert_eq!(only_entry("export X=$HOME/x").value, "$HOME/x");
    assert_eq!(only_entry("export X=\"${HOME}/y\"").value, "\"${HOME}/y\"");
}

#[test]
fn other_expansions_are_dynamic_and_never_inferred() {
    let cases = [
        ("X=$OTHER", DynamicReason::UnresolvedReference),
        ("X=${HOME:-/tmp}", DynamicReason::UnresolvedReference),
        (
            "X=\"$XDG_CONFIG_HOME/zsh\"",
            DynamicReason::UnresolvedReference,
        ),
        ("X=$1", DynamicReason::UnresolvedReference),
        ("X=$(brew --prefix)", DynamicReason::CommandSubstitution),
        ("X=`date`", DynamicReason::CommandSubstitution),
        ("X=\"a $(echo b) c\"", DynamicReason::CommandSubstitution),
        ("X=$((1+2))", DynamicReason::Arithmetic),
    ];
    for (text, reason) in cases {
        let entry = only_entry(text);
        assert_eq!(entry.state, ValueState::Dynamic, "{text}");
        assert_eq!(entry.reason, Some(reason), "{text}");
        // The raw text is kept, not an evaluated value.
        assert_eq!(
            entry.value,
            text.split_once('=').expect("assignment").1,
            "{text}"
        );
    }
}

#[test]
fn a_command_substitution_makes_every_assignment_of_the_statement_dynamic() {
    let found = entries("export A=1 B=$(x)\n");
    assert_eq!(found.len(), 2);
    assert!(found.iter().all(|e| e.state == ValueState::Dynamic));
}

#[test]
fn escaped_dollar_and_single_quotes_are_literal() {
    assert_eq!(only_entry("X=\\$HOME").state, ValueState::Static);
    assert_eq!(only_entry("X=\\$HOME").value, "$HOME");
    assert_eq!(only_entry("X='$(not run)'").state, ValueState::Static);
}

// ---- PATH ---------------------------------------------------------------

#[test]
fn path_assignments_are_split_into_segments() {
    let entry = only_entry("export PATH=/usr/local/bin:/opt/bin:$PATH");
    assert_eq!(entry.name, "PATH");
    assert_eq!(entry.state, ValueState::Reference);
    assert_eq!(
        entry.segments,
        Some(vec![
            segment("/usr/local/bin", ValueState::Static),
            segment("/opt/bin", ValueState::Static),
            segment("$PATH", ValueState::Reference),
        ])
    );

    let home = only_entry("PATH=\"$HOME/bin:$PATH\"");
    assert_eq!(
        home.segments,
        Some(vec![
            segment("$HOME/bin", ValueState::Reference),
            segment("$PATH", ValueState::Reference),
        ])
    );
}

#[test]
fn path_arrays_and_appends_keep_every_item_in_order() {
    let entry = only_entry("path+=(~/bin /opt/x '/with space')");
    assert_eq!(entry.name, "path");
    assert_eq!(entry.operation, Operation::Append);
    assert_eq!(
        entry.segments,
        Some(vec![
            segment("~/bin", ValueState::Reference),
            segment("/opt/x", ValueState::Static),
            segment("/with space", ValueState::Static),
        ])
    );

    let set = only_entry("path=($HOME/.local/bin $path)");
    assert_eq!(set.operation, Operation::Set);
    assert_eq!(set.segments.expect("segments").len(), 2);

    let scalar = only_entry("PATH+=:/extra");
    assert_eq!(scalar.operation, Operation::Append);
    assert_eq!(
        scalar.segments,
        Some(vec![segment("/extra", ValueState::Static)])
    );
}

#[test]
fn multi_line_path_arrays_are_read_with_their_span() {
    let text = "path=(\n  $HOME/bin  # mine\n  /opt/x\n  $path\n)\nexport A=1\n";
    let lines = parse(text);
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert_eq!((lines[0].line, lines[0].end_line), (1, 5));
    let LineKind::Entries(found) = &lines[0].kind else {
        panic!("expected entries: {:?}", lines[0]);
    };
    assert_eq!(found[0].segments.as_ref().expect("segments").len(), 3);
    assert_eq!((lines[1].line, lines[1].end_line), (6, 6));
}

#[test]
fn path_items_with_unknown_references_or_substitutions_are_dynamic() {
    let entry = only_entry("export PATH=$(brew --prefix)/bin:$FOO/bin:/ok");
    assert_eq!(entry.state, ValueState::Dynamic);
    let segments = entry.segments.expect("segments");
    assert_eq!(segments[0].state, ValueState::Dynamic);
    assert_eq!(segments[1].state, ValueState::Dynamic);
    assert_eq!(segments[2], segment("/ok", ValueState::Static));
}

#[test]
fn an_empty_path_item_is_kept_because_it_means_the_current_directory() {
    let segments = only_entry("PATH=/a::/b").segments.expect("segments");
    assert_eq!(
        segments,
        [
            segment("/a", ValueState::Static),
            segment("", ValueState::Static),
            segment("/b", ValueState::Static),
        ]
    );
}

#[test]
fn arrays_other_than_path_are_left_unrecognized() {
    assert_eq!(kinds("plugins=(git z)\n"), [LineKind::Unrecognized]);
    assert_eq!(kinds("fpath=(~/.zfunc $fpath)\n"), [LineKind::Unrecognized]);
}

// ---- dynamic statements ----------------------------------------------------

#[test]
fn source_eval_alias_and_function_definitions_are_dynamic() {
    assert_eq!(dynamic("source ~/.zsh_extra"), DynamicReason::Source);
    assert_eq!(dynamic(". ~/.zsh_extra"), DynamicReason::Source);
    assert_eq!(dynamic("eval \"$(brew shellenv)\""), DynamicReason::Eval);
    assert_eq!(dynamic("alias ll='ls -l'"), DynamicReason::Alias);
    assert_eq!(
        dynamic("foo() { export A=1 }"),
        DynamicReason::FunctionDefinition
    );
    assert_eq!(
        dynamic("function foo { export A=1 }"),
        DynamicReason::FunctionDefinition
    );
    assert_eq!(
        dynamic("[[ -f ~/.x ]] && export A=1"),
        DynamicReason::Conditional
    );
    assert_eq!(dynamic("(( count++ ))"), DynamicReason::Arithmetic);
    assert_eq!(dynamic("echo $(date)"), DynamicReason::CommandSubstitution);
}

#[test]
fn everything_inside_a_block_is_dynamic_and_the_block_end_restores_top_level() {
    let text = "\
if [[ $OSTYPE == darwin* ]]; then
  export A=1
fi
export B=2
case $TERM in
  xterm*) export C=3 ;;
esac
for d in a b; do
  export D=4
done
export E=5
";
    let shape: Vec<_> = kinds(text)
        .into_iter()
        .map(|kind| match kind {
            LineKind::Dynamic(reason) => format!("{reason:?}"),
            LineKind::Entries(found) => found[0].name.clone(),
            other => format!("{other:?}"),
        })
        .collect();
    assert_eq!(
        shape,
        [
            "Conditional",
            "Block",
            "Block",
            "B",
            "Conditional",
            "Block",
            "Block",
            "Conditional",
            "Block",
            "Block",
            "E",
        ]
    );
}

#[test]
fn function_and_group_bodies_across_lines_are_dynamic() {
    let text = "foo() {\n  export A=1\n}\nexport B=2\nbar()\n{\n  export C=3\n}\nexport D=4\n";
    let found: Vec<_> = entries(text).into_iter().map(|e| e.name).collect();
    assert_eq!(found, ["B", "D"]);
    let nested =
        "if true; then\n  if true; then\n    export A=1\n  fi\n  export B=2\nfi\nexport C=3\n";
    let found: Vec<_> = entries(nested).into_iter().map(|e| e.name).collect();
    assert_eq!(found, ["C"]);
}

#[test]
fn block_keywords_used_as_arguments_do_not_open_a_block() {
    let text = "zstyle ':completion:*' menu select\nexport C=3\nsetopt no_case_glob\nexport D=4\n";
    let found: Vec<_> = entries(text).into_iter().map(|e| e.name).collect();
    assert_eq!(found, ["C", "D"]);
}

#[test]
fn an_unclosed_block_keeps_the_rest_of_the_file_dynamic_without_guessing() {
    let found = entries("if true; then\nexport A=1\nexport B=2\n");
    assert!(found.is_empty());
    // A stray closer cannot push the depth below top level.
    let after = entries("fi\n}\ndone\nexport A=1\n");
    assert_eq!(after.len(), 1);
}

#[test]
fn compound_statements_are_dynamic_but_a_trailing_semicolon_is_not() {
    assert_eq!(dynamic("export A=1; export B=2"), DynamicReason::Compound);
    assert_eq!(dynamic("export A=1 && export B=2"), DynamicReason::Compound);
    assert_eq!(dynamic("export A=1 | cat"), DynamicReason::Compound);
    assert_eq!(dynamic("export A=1 > /tmp/x"), DynamicReason::Compound);
    assert_eq!(dynamic("echo hi & echo there"), DynamicReason::Compound);
    assert_eq!(entries("export A=1;\n").len(), 1);
}

// ---- spans: continuation, quotes, here-documents -----------------------------

#[test]
fn a_line_continuation_makes_the_whole_span_dynamic() {
    let lines = parse("export A=1 \\\n  B=2\nexport C=3\n");
    assert_eq!(lines.len(), 2);
    assert_eq!((lines[0].line, lines[0].end_line), (1, 2));
    assert_eq!(
        lines[0].kind,
        LineKind::Dynamic(DynamicReason::LineContinuation)
    );
    assert_eq!((lines[1].line, lines[1].end_line), (3, 3));
    assert!(matches!(lines[1].kind, LineKind::Entries(_)));
}

#[test]
fn a_multi_line_quote_makes_the_whole_span_dynamic() {
    let lines = parse("export A=\"one\ntwo\"\nexport B=2\n");
    assert_eq!(lines.len(), 2);
    assert_eq!((lines[0].line, lines[0].end_line), (1, 2));
    assert_eq!(
        lines[0].kind,
        LineKind::Dynamic(DynamicReason::MultilineQuote)
    );
    assert_eq!(lines[1].line, 3);
    let lone = parse("export A='never closed\nexport B=2\n");
    assert_eq!(lone.len(), 1);
    assert_eq!(
        lone[0].kind,
        LineKind::Dynamic(DynamicReason::MultilineQuote)
    );
    assert_eq!(lone[0].end_line, 2);
}

#[test]
fn a_here_document_swallows_its_body_up_to_the_delimiter() {
    let lines = parse("cat <<EOF\nexport A=1\nEOF\nexport B=2\n");
    assert_eq!(lines.len(), 2);
    assert_eq!((lines[0].line, lines[0].end_line), (1, 3));
    assert_eq!(lines[0].kind, LineKind::Dynamic(DynamicReason::HereDoc));
    assert_eq!(lines[1].line, 4);
    let quoted = parse("cat <<-'END'\n\texport A=1\n\tEND\nexport B=2\n");
    assert_eq!(quoted.len(), 2);
    assert_eq!(quoted[0].end_line, 3);
    // A missing delimiter consumes the rest of the file instead of guessing.
    let open = parse("cat <<EOF\nexport A=1\n");
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].kind, LineKind::Dynamic(DynamicReason::HereDoc));
    // A here-string is only a redirection.
    assert_eq!(dynamic("cat <<< hello"), DynamicReason::Compound);
}

// ---- unrecognized lines ----------------------------------------------------

#[test]
fn lines_the_model_does_not_understand_stay_unrecognized() {
    for text in [
        "setopt autocd",
        "FOO=1 some-command",
        "typeset -U path",
        "export FOO",
        "FOO[1]=x",
        "autoload -Uz compinit",
        "bindkey -e",
        "}",
        "export -Z X=1",
    ] {
        let lines = parse(text);
        assert_eq!(lines.len(), 1, "{text}");
        assert!(
            matches!(lines[0].kind, LineKind::Unrecognized | LineKind::Dynamic(_)),
            "{text}: {:?}",
            lines[0].kind
        );
    }
    assert_eq!(kinds("setopt autocd\n"), [LineKind::Unrecognized]);
    assert_eq!(kinds("export FOO\n"), [LineKind::Unrecognized]);
    assert_eq!(kinds("FOO=1 some-command\n"), [LineKind::Unrecognized]);
}

// ---- secrets and redaction ---------------------------------------------------

#[test]
fn secret_names_and_url_credentials_are_flagged() {
    assert!(only_entry("export GITHUB_TOKEN=abc").secret);
    assert!(only_entry("export DB_URL=postgres://user:pw@host/db").secret);
    assert!(only_entry("export API_KEY=$(pass show api)").secret);
    assert!(!only_entry("export EDITOR=vim").secret);
}

#[test]
fn debug_output_never_contains_a_value_or_the_raw_text() {
    let lines = parse("export API_TOKEN=very-secret-value\n");
    let printed = format!("{lines:?}");
    assert!(!printed.contains("very-secret-value"), "{printed}");
    assert!(printed.contains("API_TOKEN"));
}

// ---- robustness --------------------------------------------------------------

#[test]
fn crlf_text_parses_like_lf_text_and_raw_has_no_terminator() {
    let lines = parse("export A=1\r\nexport B=2\r\n");
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].raw, "export A=1");
    assert_eq!(only_entry("export A=1\r\n").value, "1");
}

#[test]
fn hostile_or_broken_text_never_panics_and_keeps_line_numbers_monotonic() {
    let samples = [
        "\"",
        "'",
        "`",
        "$(",
        "${",
        "$((",
        "export A=\"$(",
        "path=(",
        "path=($(",
        "\\",
        "cat <<",
        "cat <<'",
        "a=(((",
        ")))",
        "if",
        "export",
        "typeset",
        "=",
        "=x",
        "A=\u{0}",
        "export A=é\u{2028}x",
        "alias",
        "$'unterminated",
        "x=$'a\\'b'",
    ];
    for sample in samples {
        for text in [sample.to_owned(), format!("{sample}\nexport OK=1\n")] {
            let lines = parse(&text);
            let mut previous_end = 0;
            for line in &lines {
                assert!(line.line > previous_end, "{text:?}: {lines:?}");
                assert!(line.end_line >= line.line, "{text:?}: {lines:?}");
                previous_end = line.end_line;
            }
        }
    }
}

#[test]
fn every_physical_line_belongs_to_exactly_one_parsed_line() {
    let text = "a\n\nexport B=\"x\ny\"\nc \\\nd\ncat <<E\nbody\nE\n# end\n";
    let lines = parse(text);
    let covered: usize = lines.iter().map(|line| line.end_line - line.line + 1).sum();
    assert_eq!(covered, text.lines().count());
}

#[test]
fn only_home_references_are_expanded_for_a_static_zdotdir() {
    let expand = |raw: &str| expand_home_literal(raw, "/Users/me");
    assert_eq!(expand("~"), Some("/Users/me".to_owned()));
    assert_eq!(
        expand("~/.config/zsh"),
        Some("/Users/me/.config/zsh".to_owned())
    );
    assert_eq!(expand("$HOME/z"), Some("/Users/me/z".to_owned()));
    assert_eq!(expand("\"${HOME}/z\""), Some("/Users/me/z".to_owned()));
    assert_eq!(expand("/abs/z"), Some("/abs/z".to_owned()));
    assert_eq!(expand("'~/literal'"), Some("~/literal".to_owned()));
    for refused in [
        "~other/z",
        "~+/z",
        "$XDG_CONFIG_HOME/z",
        "$(echo z)",
        "~/$X",
        "$PATH",
        "/a:~/b",
        "`x`",
    ] {
        assert_eq!(expand(refused), None, "{refused}");
    }
}
