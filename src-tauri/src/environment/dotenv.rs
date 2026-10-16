//! A small, side-effect free dotenv line model. It parses text only: nothing is
//! executed, sourced, expanded or normalized. Every line keeps its exact text
//! and terminator so a later writer can leave untouched lines byte for byte
//! identical; constructs outside the supported subset are flagged instead of
//! being interpreted.
//!
//! Supported subset: blank lines, `#` comments, `[export ]NAME=value` with
//! `NAME` matching `[A-Za-z_][A-Za-z0-9_]*`, unquoted values with an optional
//! ` #` inline comment, and single or double quoted values. Everything else
//! (`NAME = value`, a bare word, an unterminated quote, text after a closing
//! quote) is kept as an unknown line.

use std::fmt;

use serde::Serialize;

/// Why an entry is not a plain static `NAME=value` pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntryFlag {
    /// The key appears more than once in the file; none of them is "the" value.
    DuplicateKey,
    /// The value contains `$VAR` or `${VAR}`; it is not expanded.
    Interpolation,
    /// The value contains `$(…)` or a backtick; it is never evaluated.
    CommandSubstitution,
    /// The quoted value spans several lines.
    MultilineValue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QuoteStyle {
    None,
    Single,
    Double,
}

#[derive(Clone, PartialEq, Eq)]
pub struct DotenvEntry {
    pub key: String,
    /// The text between the quotes (or the trimmed unquoted text), as written:
    /// escapes are not decoded and nothing is expanded.
    pub value: String,
    pub quote: QuoteStyle,
    pub exported: bool,
    /// Name (and URL credential) heuristic; not a guarantee either way.
    pub secret: bool,
    pub flags: Vec<EntryFlag>,
}

// Values may be secrets, so `Debug` (and thus any accidental log or panic
// message) shows only the length.
impl fmt::Debug for DotenvEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DotenvEntry")
            .field("key", &self.key)
            .field("value_len", &self.value.chars().count())
            .field("quote", &self.quote)
            .field("exported", &self.exported)
            .field("secret", &self.secret)
            .field("flags", &self.flags)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineKind {
    Blank,
    Comment,
    Entry(DotenvEntry),
    Unknown,
}

#[derive(Clone, PartialEq, Eq)]
pub struct DotenvLine {
    /// 1-based number of the first physical line of this span.
    pub line: usize,
    /// 1-based number of the last physical line (differs for multi-line values).
    pub end_line: usize,
    /// Exact text of the span, without its final line terminator.
    pub raw: String,
    /// `"\n"`, `"\r\n"` or `""` for a last line without terminator.
    pub terminator: String,
    pub kind: LineKind,
}

impl fmt::Debug for DotenvLine {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // `raw` may hold a secret value, so it is deliberately not printed.
        formatter
            .debug_struct("DotenvLine")
            .field("line", &self.line)
            .field("end_line", &self.end_line)
            .field("raw_len", &self.raw.len())
            .field("kind", &self.kind)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DotenvDocument {
    pub lines: Vec<DotenvLine>,
}

impl DotenvDocument {
    /// Reassembles the exact original text.
    pub fn to_text(&self) -> String {
        let mut text = String::new();
        for line in &self.lines {
            text.push_str(&line.raw);
            text.push_str(&line.terminator);
        }
        text
    }
}

struct Segment<'a> {
    body: &'a str,
    terminator: &'a str,
}

pub fn parse(text: &str) -> DotenvDocument {
    let segments: Vec<Segment<'_>> = text
        .split_inclusive('\n')
        .map(|piece| match piece.strip_suffix("\r\n") {
            Some(body) => Segment {
                body,
                terminator: "\r\n",
            },
            None => match piece.strip_suffix('\n') {
                Some(body) => Segment {
                    body,
                    terminator: "\n",
                },
                None => Segment {
                    body: piece,
                    terminator: "",
                },
            },
        })
        .collect();

    let mut lines = Vec::new();
    let mut index = 0;
    while index < segments.len() {
        let (kind, consumed) = classify(&segments, index);
        let last = index + consumed - 1;
        let mut raw = String::new();
        for (offset, segment) in segments[index..=last].iter().enumerate() {
            raw.push_str(segment.body);
            if index + offset < last {
                raw.push_str(segment.terminator);
            }
        }
        lines.push(DotenvLine {
            line: index + 1,
            end_line: last + 1,
            raw,
            terminator: segments[last].terminator.to_owned(),
            kind,
        });
        index += consumed;
    }
    flag_duplicates(&mut lines);
    DotenvDocument { lines }
}

fn flag_duplicates(lines: &mut [DotenvLine]) {
    let mut counts = std::collections::HashMap::<String, usize>::new();
    for line in lines.iter() {
        if let LineKind::Entry(entry) = &line.kind {
            *counts.entry(entry.key.clone()).or_default() += 1;
        }
    }
    for line in lines.iter_mut() {
        if let LineKind::Entry(entry) = &mut line.kind
            && counts.get(&entry.key).copied().unwrap_or(0) > 1
        {
            entry.flags.push(EntryFlag::DuplicateKey);
            entry.flags.sort();
        }
    }
}

fn classify(segments: &[Segment<'_>], index: usize) -> (LineKind, usize) {
    let trimmed = segments[index].body.trim_start();
    if trimmed.is_empty() {
        return (LineKind::Blank, 1);
    }
    if trimmed.starts_with('#') {
        return (LineKind::Comment, 1);
    }
    let Some(assignment) = parse_assignment(trimmed) else {
        return (LineKind::Unknown, 1);
    };
    parse_value(&assignment, segments, index)
}

struct Assignment<'a> {
    exported: bool,
    key: &'a str,
    value: &'a str,
}

fn parse_assignment(trimmed: &str) -> Option<Assignment<'_>> {
    let (exported, rest) = match trimmed.strip_prefix("export") {
        Some(rest) if rest.starts_with(char::is_whitespace) => (true, rest.trim_start()),
        _ => (false, trimmed),
    };
    let equals = rest.find('=')?;
    let key = &rest[..equals];
    is_valid_key(key).then_some(Assignment {
        exported,
        key,
        value: &rest[equals + 1..],
    })
}

pub fn is_valid_key(key: &str) -> bool {
    let mut characters = key.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn parse_value(
    assignment: &Assignment<'_>,
    segments: &[Segment<'_>],
    index: usize,
) -> (LineKind, usize) {
    let quote = match assignment.value.chars().next() {
        Some('"') => Some(('"', QuoteStyle::Double)),
        Some('\'') => Some(('\'', QuoteStyle::Single)),
        _ => None,
    };
    let Some((quote_char, style)) = quote else {
        let value = strip_inline_comment(assignment.value).trim();
        return (
            LineKind::Entry(build_entry(
                assignment,
                value.to_owned(),
                QuoteStyle::None,
                1,
            )),
            1,
        );
    };

    let first = &assignment.value[1..];
    if let Some((inner, tail)) = split_at_closing(first, quote_char) {
        return if is_valid_tail(tail) {
            (
                LineKind::Entry(build_entry(assignment, inner.to_owned(), style, 1)),
                1,
            )
        } else {
            (LineKind::Unknown, 1)
        };
    }

    // No closing quote on this line: a multi-line value if one closes later,
    // otherwise only this line is unknown and parsing resumes on the next.
    let mut inner = first.to_owned();
    for (offset, segment) in segments[index + 1..].iter().enumerate() {
        inner.push_str(segments[index + offset].terminator);
        if let Some((before, tail)) = split_at_closing(segment.body, quote_char) {
            if !is_valid_tail(tail) {
                return (LineKind::Unknown, 1);
            }
            inner.push_str(before);
            let consumed = offset + 2;
            return (
                LineKind::Entry(build_entry(assignment, inner, style, consumed)),
                consumed,
            );
        }
        inner.push_str(segment.body);
    }
    (LineKind::Unknown, 1)
}

fn build_entry(
    assignment: &Assignment<'_>,
    value: String,
    quote: QuoteStyle,
    physical_lines: usize,
) -> DotenvEntry {
    let mut flags = Vec::new();
    if physical_lines > 1 {
        flags.push(EntryFlag::MultilineValue);
    }
    if quote != QuoteStyle::Single {
        let (interpolation, command) = scan_dynamic(&value);
        if interpolation {
            flags.push(EntryFlag::Interpolation);
        }
        if command {
            flags.push(EntryFlag::CommandSubstitution);
        }
    }
    DotenvEntry {
        secret: is_secret_name(assignment.key) || has_url_credentials(&value),
        key: assignment.key.to_owned(),
        value,
        quote,
        exported: assignment.exported,
        flags,
    }
}

/// Finds the first unescaped closing quote. Backslash escapes only apply to
/// double quotes; single quoted text is literal.
fn split_at_closing(text: &str, quote: char) -> Option<(&str, &str)> {
    let mut characters = text.char_indices();
    while let Some((position, character)) = characters.next() {
        if quote == '"' && character == '\\' {
            characters.next();
        } else if character == quote {
            return Some((&text[..position], &text[position + 1..]));
        }
    }
    None
}

/// After a closing quote only whitespace or ` # comment` may follow.
fn is_valid_tail(tail: &str) -> bool {
    let trimmed = tail.trim();
    trimmed.is_empty() || (tail.starts_with(char::is_whitespace) && trimmed.starts_with('#'))
}

fn strip_inline_comment(value: &str) -> &str {
    let mut previous_is_space = false;
    for (position, character) in value.char_indices() {
        if character == '#' && previous_is_space {
            return &value[..position];
        }
        previous_is_space = character.is_whitespace();
    }
    value
}

/// Reports `(interpolation, command substitution)` without evaluating
/// anything. A backslash-escaped `$` or backtick does not count.
fn scan_dynamic(value: &str) -> (bool, bool) {
    let mut interpolation = false;
    let mut command = false;
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\\' => {
                characters.next();
            }
            '`' => command = true,
            '$' => match characters.peek() {
                Some('(') => command = true,
                Some(&next) if next == '{' || next.is_ascii_alphabetic() || next == '_' => {
                    interpolation = true;
                }
                _ => {}
            },
            _ => {}
        }
    }
    (interpolation, command)
}

const SECRET_WORDS: [&str; 6] = [
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "SECRET",
    "CREDENTIAL",
    "PRIVATE_KEY",
];
const SECRET_SEGMENTS: [&str; 4] = ["KEY", "PASS", "PWD", "AUTH"];

/// Name heuristic for values that are probably secrets. It errs on the side of
/// hiding (`MONKEY` matches); it is not a complete secret detector.
pub fn is_secret_name(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    SECRET_WORDS.iter().any(|word| upper.contains(word))
        || upper.ends_with("KEY")
        || upper
            .split('_')
            .any(|segment| SECRET_SEGMENTS.contains(&segment))
}

/// `scheme://user:password@host` carries a credential whatever the key is.
fn has_url_credentials(value: &str) -> bool {
    let Some((_, after_scheme)) = value.split_once("://") else {
        return false;
    };
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    authority
        .rsplit_once('@')
        .is_some_and(|(userinfo, _)| userinfo.contains(':'))
}

/// Whether a comment or unknown line looks like a commented-out secret
/// assignment (`# API_KEY=...`), so its text must not be shown.
pub fn looks_like_secret_assignment(text: &str) -> bool {
    let upper = text.to_ascii_uppercase();
    (text.contains('=') || text.contains(':'))
        && (SECRET_WORDS.iter().any(|word| upper.contains(word))
            || upper
                .split(|character: char| !character.is_ascii_alphanumeric())
                .any(|word| {
                    SECRET_SEGMENTS.contains(&word) || (word.len() > 3 && word.ends_with("KEY"))
                }))
}

#[cfg(test)]
mod tests {
    use super::{
        DotenvDocument, DotenvEntry, EntryFlag, LineKind, QuoteStyle, is_secret_name,
        looks_like_secret_assignment, parse,
    };

    fn entries(document: &DotenvDocument) -> Vec<&DotenvEntry> {
        document
            .lines
            .iter()
            .filter_map(|line| match &line.kind {
                LineKind::Entry(entry) => Some(entry),
                _ => None,
            })
            .collect()
    }

    fn only_entry(text: &str) -> DotenvEntry {
        let document = parse(text);
        let found = entries(&document);
        assert_eq!(found.len(), 1, "expected a single entry in {text:?}");
        found[0].clone()
    }

    #[test]
    fn keeps_blank_comment_unknown_and_entry_lines_with_exact_text() {
        let text = "# header\n\nA=1\r\n  # indented comment\nnot an assignment\nB=\"two\"";
        let document = parse(text);

        let kinds: Vec<&str> = document
            .lines
            .iter()
            .map(|line| match line.kind {
                LineKind::Blank => "blank",
                LineKind::Comment => "comment",
                LineKind::Entry(_) => "entry",
                LineKind::Unknown => "unknown",
            })
            .collect();
        assert_eq!(
            kinds,
            ["comment", "blank", "entry", "comment", "unknown", "entry"]
        );
        assert_eq!(document.lines[2].terminator, "\r\n");
        assert_eq!(document.lines[2].raw, "A=1");
        assert_eq!(document.lines[3].raw, "  # indented comment");
        assert_eq!(document.lines[5].terminator, "");
        assert_eq!(document.lines[5].line, 6);
        assert_eq!(document.to_text(), text);
    }

    #[test]
    fn round_trips_every_shape_byte_for_byte() {
        for text in [
            "",
            "\n",
            "\n\n",
            "A=1",
            "A=1\n",
            "A='x\ny'\nB=2\r\n",
            "A=\"never closed\nB=2\n",
            "export A=1 # c\r\n\r\n# end",
            "ünïcode=1\nK=värde\n",
        ] {
            assert_eq!(parse(text).to_text(), text, "{text:?}");
        }
    }

    #[test]
    fn parses_optional_export_and_plain_values() {
        let plain = only_entry("A=1\n");
        assert_eq!((plain.key.as_str(), plain.value.as_str()), ("A", "1"));
        assert!(!plain.exported);
        assert_eq!(plain.quote, QuoteStyle::None);
        assert!(plain.flags.is_empty());

        let exported = only_entry("export  B=two words  \n");
        assert!(exported.exported);
        assert_eq!(exported.value, "two words");

        assert_eq!(only_entry("EMPTY=\n").value, "");
    }

    #[test]
    fn export_is_only_a_keyword_when_followed_by_whitespace() {
        let entry = only_entry("export=1\n");
        assert_eq!(entry.key, "export");
        assert!(!entry.exported);
    }

    #[test]
    fn parses_single_and_double_quotes_without_decoding_escapes() {
        let double = only_entry("A=\"hello \\\"you\\\" \\n # not a comment\"\n");
        assert_eq!(double.quote, QuoteStyle::Double);
        assert_eq!(double.value, "hello \\\"you\\\" \\n # not a comment");

        let single = only_entry("A='raw \\n $HOME'\n");
        assert_eq!(single.quote, QuoteStyle::Single);
        assert_eq!(single.value, "raw \\n $HOME");
        assert!(single.flags.is_empty(), "single quotes are literal");
    }

    #[test]
    fn strips_inline_comments_only_after_whitespace() {
        assert_eq!(only_entry("A=value # note\n").value, "value");
        assert_eq!(only_entry("A=va#lue\n").value, "va#lue");
        assert_eq!(only_entry("A=\"q\" # note\n").value, "q");
        assert_eq!(only_entry("A= # only a comment\n").value, "");
    }

    #[test]
    fn keeps_unsupported_shapes_as_unknown_lines() {
        for text in [
            "NAME = value\n",
            "export FOO\n",
            "1BAD=x\n",
            "bare\n",
            "A=\"closed\"trailing\n",
            "A=\"unterminated\n",
            "A='unterminated\n",
            "=nokey\n",
        ] {
            let document = parse(text);
            assert!(
                document
                    .lines
                    .iter()
                    .all(|line| matches!(line.kind, LineKind::Unknown)),
                "{text:?} must stay an unknown line"
            );
            assert_eq!(document.to_text(), text);
        }
    }

    #[test]
    fn flags_every_occurrence_of_a_duplicate_key() {
        let document = parse("A=1\nB=2\nA=3\n");
        let flagged: Vec<(&str, bool)> = entries(&document)
            .iter()
            .map(|entry| {
                (
                    entry.key.as_str(),
                    entry.flags.contains(&EntryFlag::DuplicateKey),
                )
            })
            .collect();
        assert_eq!(flagged, [("A", true), ("B", false), ("A", true)]);
        // Neither duplicate is dropped or merged.
        assert_eq!(entries(&document)[0].value, "1");
        assert_eq!(entries(&document)[2].value, "3");
    }

    #[test]
    fn flags_interpolation_without_expanding_it() {
        for text in ["A=$HOME/bin\n", "A=${HOME}/bin\n", "A=\"x-$NAME\"\n"] {
            let entry = only_entry(text);
            assert_eq!(entry.flags, [EntryFlag::Interpolation], "{text:?}");
        }
        assert_eq!(only_entry("A=${HOME}/bin\n").value, "${HOME}/bin");
        for text in ["A=cost$\n", "A=\"price \\$5\"\n", "A='$HOME'\n", "A=$1\n"] {
            assert!(only_entry(text).flags.is_empty(), "{text:?}");
        }
    }

    #[test]
    fn flags_command_substitution_without_running_it() {
        for text in ["A=$(whoami)\n", "A=`whoami`\n", "A=\"$(id) $USER\"\n"] {
            assert!(
                only_entry(text)
                    .flags
                    .contains(&EntryFlag::CommandSubstitution),
                "{text:?}"
            );
        }
        assert!(only_entry("A='$(whoami)'\n").flags.is_empty());
    }

    #[test]
    fn marks_multi_line_quoted_values_and_resumes_after_them() {
        let text = "A=\"line one\nline two\"\nB=2\n";
        let document = parse(text);

        assert_eq!(document.lines.len(), 2);
        let first = &document.lines[0];
        assert_eq!((first.line, first.end_line), (1, 2));
        assert_eq!(first.raw, "A=\"line one\nline two\"");
        let LineKind::Entry(entry) = &first.kind else {
            panic!("expected an entry");
        };
        assert_eq!(entry.value, "line one\nline two");
        assert_eq!(entry.flags, [EntryFlag::MultilineValue]);
        assert_eq!(document.lines[1].line, 3);
        assert_eq!(document.to_text(), text);
    }

    #[test]
    fn an_unterminated_multi_line_value_does_not_swallow_the_rest() {
        let document = parse("A=\"never closed\nB=2\nC=3\n");
        assert!(matches!(document.lines[0].kind, LineKind::Unknown));
        assert_eq!(document.lines.len(), 3);
        assert_eq!(entries(&document).len(), 2);
    }

    #[test]
    fn decides_secrets_from_names_and_url_credentials() {
        for key in [
            "API_TOKEN",
            "github_token",
            "DB_PASSWORD",
            "DB_PASSWD",
            "CLIENT_SECRET",
            "AWS_ACCESS_KEY_ID",
            "STRIPE_KEY",
            "APIKEY",
            "SERVICE_CREDENTIALS",
            "PRIVATE_KEY_PATH",
            "BASIC_AUTH",
        ] {
            assert!(is_secret_name(key), "{key} should be secret");
        }
        for key in [
            "PORT",
            "NODE_ENV",
            "LOG_LEVEL",
            "KEYBOARD_LAYOUT",
            "PATHNAME",
        ] {
            assert!(!is_secret_name(key), "{key} should not be secret");
        }
        assert!(only_entry("TOKEN=abc\n").secret);
        assert!(only_entry("DATABASE_URL=postgres://user:pw@db/app\n").secret);
        assert!(!only_entry("DATABASE_URL=postgres://db/app\n").secret);
        assert!(!only_entry("HOMEPAGE=https://example.com/a@b\n").secret);
    }

    #[test]
    fn detects_commented_out_secret_assignments() {
        assert!(looks_like_secret_assignment("# API_KEY=abc123"));
        assert!(looks_like_secret_assignment("password: hunter2"));
        assert!(!looks_like_secret_assignment("# remember to rotate"));
        assert!(!looks_like_secret_assignment("# PORT=3000"));
    }

    #[test]
    fn debug_output_never_contains_a_value() {
        let document = parse("API_TOKEN=super-secret-value\n");
        let printed = format!("{document:?}");
        assert!(!printed.contains("super-secret-value"), "{printed}");
        assert!(printed.contains("API_TOKEN"));
    }
}
