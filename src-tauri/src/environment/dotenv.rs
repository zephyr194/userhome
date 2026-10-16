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

use std::{collections::HashSet, fmt};

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

// ---- structured edits ----------------------------------------------------
//
// Edits are pure text transformations: they never touch the file system and
// never decode, expand or normalize anything. A line that is not edited keeps
// its exact bytes; an entry the model flags as duplicate, dynamic or
// multi-line is refused instead of being rewritten.

/// Longest value (in characters) the editor will write.
pub const MAX_EDIT_VALUE_CHARS: usize = 8192;
const MAX_KEY_LENGTH: usize = 255;

#[derive(Clone, PartialEq, Eq)]
pub enum KeyEdit {
    Add {
        key: String,
        value: String,
        exported: bool,
    },
    Set {
        key: String,
        value: String,
    },
    Remove {
        key: String,
    },
}

impl KeyEdit {
    pub fn key(&self) -> &str {
        match self {
            Self::Add { key, .. } | Self::Set { key, .. } | Self::Remove { key } => key,
        }
    }
}

// Values may be secrets: `Debug` shows only the length.
impl fmt::Debug for KeyEdit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Add {
                key,
                value,
                exported,
            } => formatter
                .debug_struct("Add")
                .field("key", key)
                .field("value_len", &value.chars().count())
                .field("exported", exported)
                .finish(),
            Self::Set { key, value } => formatter
                .debug_struct("Set")
                .field("key", key)
                .field("value_len", &value.chars().count())
                .finish(),
            Self::Remove { key } => formatter.debug_struct("Remove").field("key", key).finish(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChangeKind {
    Add,
    Modify,
    Remove,
}

/// One key-level change, with the plain values the preview must mask for
/// secrets. `before`/`after` are the raw values as the parser reads them.
#[derive(Clone, PartialEq, Eq)]
pub struct KeyChange {
    pub key: String,
    pub kind: ChangeKind,
    pub secret: bool,
    pub before: Option<String>,
    pub after: Option<String>,
}

impl fmt::Debug for KeyChange {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("KeyChange")
            .field("key", &self.key)
            .field("kind", &self.kind)
            .field("secret", &self.secret)
            .field(
                "before_len",
                &self.before.as_ref().map(|v| v.chars().count()),
            )
            .field("after_len", &self.after.as_ref().map(|v| v.chars().count()))
            .finish()
    }
}

pub struct EditOutcome {
    pub text: String,
    pub changes: Vec<KeyChange>,
}

impl fmt::Debug for EditOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("EditOutcome")
            .field("text_len", &self.text.len())
            .field("changes", &self.changes)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueProblem {
    /// A newline, tab, other control character or invisible direction/line
    /// separator: the value would not stay one visible line.
    ControlCharacter,
    TooLong,
    /// Needs a quote kind that would also need an escape, `$` or a backtick.
    NoSafeQuoting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditError {
    InvalidKey,
    NoEdits,
    DuplicateEdit(String),
    KeyExists(String),
    KeyNotFound(String),
    /// A double-quoted value with backslashes: escapes are not decoded, so the
    /// meaning of a rewritten value could change.
    EscapedValue(String),
    UnsupportedEntry {
        key: String,
        flags: Vec<EntryFlag>,
    },
    UnsafeValue {
        key: String,
        problem: ValueProblem,
    },
}

impl EditError {
    /// A user-facing explanation. It names keys and reasons, never values.
    pub fn message(&self) -> String {
        match self {
            Self::InvalidKey => {
                "键名必须匹配 [A-Za-z_][A-Za-z0-9_]*，且不超过 255 个字符。".to_owned()
            }
            Self::NoEdits => "没有需要保存的改动。".to_owned(),
            Self::DuplicateEdit(key) => {
                format!("同一次保存里键 {key} 出现了多次改动，请合并后再保存。")
            }
            Self::KeyExists(key) => format!(
                "键 {key} 已存在（或文件中有以它开头但无法解析的行），不能再新增；请改用修改。"
            ),
            Self::KeyNotFound(key) => format!("文件中没有键 {key}。"),
            Self::EscapedValue(key) => format!(
                "键 {key} 的双引号值含反斜杠转义；本工具不解码转义，为避免改变含义，不提供结构化修改。"
            ),
            Self::UnsupportedEntry { key, flags } => {
                let reasons: Vec<&str> = flags
                    .iter()
                    .map(|flag| match flag {
                        EntryFlag::DuplicateKey => "重复键",
                        EntryFlag::Interpolation => "变量插值",
                        EntryFlag::CommandSubstitution => "命令替换",
                        EntryFlag::MultilineValue => "多行值",
                    })
                    .collect();
                format!(
                    "键 {key} 使用了本工具不改写的写法（{}），已保持原样；请在编辑器中手动修改。",
                    reasons.join("、")
                )
            }
            Self::UnsafeValue { key, problem } => match problem {
                ValueProblem::ControlCharacter => format!(
                    "键 {key} 的值含换行、制表符或其他控制 / 不可见方向字符，不能安全写成单行值。"
                ),
                ValueProblem::TooLong => {
                    format!("键 {key} 的值超过 {MAX_EDIT_VALUE_CHARS} 个字符。")
                }
                ValueProblem::NoSafeQuoting => format!(
                    "键 {key} 的值同时含单引号与 $、反引号、反斜杠或双引号，无法在不引入转义或插值的前提下写入。"
                ),
            },
        }
    }
}

/// Name heuristic plus URL credentials: whether a value for `key` must be
/// masked everywhere it is shown.
pub fn value_looks_secret(key: &str, value: &str) -> bool {
    is_secret_name(key) || has_url_credentials(value)
}

pub fn apply_edits(text: &str, edits: &[KeyEdit]) -> Result<EditOutcome, EditError> {
    if edits.is_empty() {
        return Err(EditError::NoEdits);
    }
    let mut seen = HashSet::new();
    for edit in edits {
        let key = edit.key();
        if !is_valid_key(key) || key.len() > MAX_KEY_LENGTH {
            return Err(EditError::InvalidKey);
        }
        if !seen.insert(key) {
            return Err(EditError::DuplicateEdit(key.to_owned()));
        }
    }
    let mut current = text.to_owned();
    let mut changes = Vec::new();
    for edit in edits {
        let (next, change) = apply_one(&current, edit)?;
        current = next;
        changes.extend(change);
    }
    Ok(EditOutcome {
        text: current,
        changes,
    })
}

fn apply_one(text: &str, edit: &KeyEdit) -> Result<(String, Option<KeyChange>), EditError> {
    let document = parse(text);
    let key = edit.key();
    let found: Vec<(&DotenvLine, &DotenvEntry)> = document
        .lines
        .iter()
        .filter_map(|line| match &line.kind {
            LineKind::Entry(entry) if entry.key == key => Some((line, entry)),
            _ => None,
        })
        .collect();
    match edit {
        KeyEdit::Add {
            value, exported, ..
        } => {
            let claimed = document.lines.iter().any(|line| {
                matches!(line.kind, LineKind::Unknown) && unknown_line_claims_key(&line.raw, key)
            });
            if !found.is_empty() || claimed {
                return Err(EditError::KeyExists(key.to_owned()));
            }
            let (rendered, _) = render_checked(key, value, QuoteStyle::None)?;
            let terminator = line_ending(&document);
            let mut next = text.to_owned();
            if !next.is_empty() && !next.ends_with('\n') {
                next.push_str(terminator);
            }
            if *exported {
                next.push_str("export ");
            }
            next.push_str(&format!("{key}={rendered}"));
            next.push_str(terminator);
            Ok((
                next,
                Some(KeyChange {
                    key: key.to_owned(),
                    kind: ChangeKind::Add,
                    secret: value_looks_secret(key, value),
                    before: None,
                    after: Some(value.clone()),
                }),
            ))
        }
        KeyEdit::Set { value, .. } => {
            let (line, entry) = single_supported(key, &found)?;
            if entry.quote == QuoteStyle::Double && entry.value.contains('\\') {
                return Err(EditError::EscapedValue(key.to_owned()));
            }
            if entry.value == *value {
                return Ok((text.to_owned(), None));
            }
            let (rendered, _) = render_checked(key, value, entry.quote)?;
            let rewritten = rewrite_value(&line.raw, entry, &rendered);
            let next = replace_line(&document, line.line, Some(&rewritten));
            Ok((
                next,
                Some(KeyChange {
                    key: key.to_owned(),
                    kind: ChangeKind::Modify,
                    secret: entry.secret || value_looks_secret(key, value),
                    before: Some(entry.value.clone()),
                    after: Some(value.clone()),
                }),
            ))
        }
        KeyEdit::Remove { .. } => {
            let (line, entry) = single_supported(key, &found)?;
            Ok((
                replace_line(&document, line.line, None),
                Some(KeyChange {
                    key: key.to_owned(),
                    kind: ChangeKind::Remove,
                    secret: entry.secret,
                    before: Some(entry.value.clone()),
                    after: None,
                }),
            ))
        }
    }
}

/// The one plain entry for `key`; anything else is refused with its reason.
fn single_supported<'a>(
    key: &str,
    found: &[(&'a DotenvLine, &'a DotenvEntry)],
) -> Result<(&'a DotenvLine, &'a DotenvEntry), EditError> {
    let Some((line, entry)) = found.first().copied() else {
        return Err(EditError::KeyNotFound(key.to_owned()));
    };
    if !entry.flags.is_empty() {
        let mut flags: Vec<EntryFlag> = found
            .iter()
            .flat_map(|(_, entry)| entry.flags.iter().copied())
            .collect();
        flags.sort();
        flags.dedup();
        return Err(EditError::UnsupportedEntry {
            key: key.to_owned(),
            flags,
        });
    }
    Ok((line, entry))
}

/// An unparsed line that starts like `[export ]KEY =…` still claims the key.
fn unknown_line_claims_key(raw: &str, key: &str) -> bool {
    let trimmed = raw.trim_start();
    let rest = match trimmed.strip_prefix("export") {
        Some(rest) if rest.starts_with(char::is_whitespace) => rest.trim_start(),
        _ => trimmed,
    };
    rest.split_once('=')
        .is_some_and(|(name, _)| name.trim_end() == key)
}

/// New lines follow the style of the file: the terminator of its last
/// terminated line, `\n` for a file without one.
fn line_ending(document: &DotenvDocument) -> &str {
    document
        .lines
        .iter()
        .rev()
        .map(|line| line.terminator.as_str())
        .find(|terminator| !terminator.is_empty())
        .unwrap_or("\n")
}

/// Rebuilds the text with the span starting at `first_line` replaced (or
/// dropped). Its terminator is kept when it is replaced.
fn replace_line(document: &DotenvDocument, first_line: usize, replacement: Option<&str>) -> String {
    let mut text = String::new();
    for line in &document.lines {
        if line.line == first_line {
            if let Some(raw) = replacement {
                text.push_str(raw);
                text.push_str(&line.terminator);
            }
        } else {
            text.push_str(&line.raw);
            text.push_str(&line.terminator);
        }
    }
    text
}

/// Replaces only the value of a single-line entry; the key, `export`, the
/// whitespace around the value and a trailing comment keep their bytes.
fn rewrite_value(raw: &str, entry: &DotenvEntry, rendered: &str) -> String {
    let Some(equals) = raw.find('=') else {
        return raw.to_owned();
    };
    let (prefix, region) = raw.split_at(equals + 1);
    match entry.quote {
        QuoteStyle::None => {
            let stripped = strip_inline_comment(region);
            let value_text = stripped.trim();
            let (lead, tail) = if value_text.is_empty() {
                (stripped, &region[stripped.len()..])
            } else {
                let start = stripped.len() - stripped.trim_start().len();
                (&region[..start], &region[start + value_text.len()..])
            };
            let mut next = format!("{prefix}{lead}{rendered}");
            // A comment must never end up attached to the value.
            if tail.starts_with('#') {
                next.push(' ');
            }
            next.push_str(tail);
            next
        }
        QuoteStyle::Single | QuoteStyle::Double => {
            let quote = if entry.quote == QuoteStyle::Single {
                '\''
            } else {
                '"'
            };
            let tail = split_at_closing(&region[1..], quote).map_or("", |(_, tail)| tail);
            format!("{prefix}{rendered}{tail}")
        }
    }
}

fn render_checked(
    key: &str,
    value: &str,
    prefer: QuoteStyle,
) -> Result<(String, QuoteStyle), EditError> {
    render_value(value, prefer).map_err(|problem| EditError::UnsafeValue {
        key: key.to_owned(),
        problem,
    })
}

pub(super) fn is_forbidden_character(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{200b}'..='\u{200f}'
                | '\u{2028}'..='\u{202e}'
                | '\u{2060}'..='\u{2064}'
                | '\u{2066}'..='\u{2069}'
                | '\u{feff}'
        )
}

fn is_bare_safe(value: &str) -> bool {
    !value.starts_with('=')
        && value.chars().all(|character| {
            character.is_alphanumeric()
                || matches!(
                    character,
                    '_' | '-' | '.' | '/' | ':' | '@' | '%' | '+' | ',' | '='
                )
        })
}

/// Chooses a quoting form the parser of this tool reads back unchanged, with
/// no escape, interpolation, command substitution or extra line: bare text,
/// single quotes (literal), or double quotes for values that only need a `'`.
/// `prefer` is tried first so an edit keeps the style of the line it replaces.
pub fn render_value(value: &str, prefer: QuoteStyle) -> Result<(String, QuoteStyle), ValueProblem> {
    if value.chars().any(is_forbidden_character) {
        return Err(ValueProblem::ControlCharacter);
    }
    if value.chars().count() > MAX_EDIT_VALUE_CHARS {
        return Err(ValueProblem::TooLong);
    }
    let order = std::iter::once(prefer).chain(
        [QuoteStyle::None, QuoteStyle::Single, QuoteStyle::Double]
            .into_iter()
            .filter(move |style| *style != prefer),
    );
    for style in order {
        let rendered = match style {
            QuoteStyle::None => is_bare_safe(value).then(|| value.to_owned()),
            QuoteStyle::Single => (!value.contains('\'')).then(|| format!("'{value}'")),
            QuoteStyle::Double => {
                (!value.contains(['"', '\\', '$', '`'])).then(|| format!("\"{value}\""))
            }
        };
        if let Some(rendered) = rendered
            && reads_back_exactly(&rendered, value)
        {
            return Ok((rendered, style));
        }
    }
    Err(ValueProblem::NoSafeQuoting)
}

fn reads_back_exactly(rendered: &str, value: &str) -> bool {
    let document = parse(&format!("K={rendered}\n"));
    matches!(
        document.lines.as_slice(),
        [DotenvLine { kind: LineKind::Entry(entry), .. }]
            if entry.value == value && entry.flags.is_empty()
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyError {
    NotText,
    KeyMissing(String),
    KeyStillPresent(String),
    /// The key appears more than once or reads as dynamic/multi-line.
    UnexpectedFlags(String),
    ValueMismatch(String),
    OtherLinesChanged,
}

/// Checks written bytes against the original with an independent read-back:
/// every changed key holds exactly the expected value (or is gone), and every
/// other line is byte for byte what it was. Only the final line of the
/// original may have gained a line terminator.
pub fn verify_edit(
    original: &str,
    written: &[u8],
    changes: &[KeyChange],
) -> Result<(), VerifyError> {
    let Ok(written) = std::str::from_utf8(written) else {
        return Err(VerifyError::NotText);
    };
    let after = parse(written);
    for change in changes {
        let found: Vec<&DotenvEntry> = after
            .lines
            .iter()
            .filter_map(|line| match &line.kind {
                LineKind::Entry(entry) if entry.key == change.key => Some(entry),
                _ => None,
            })
            .collect();
        match (change.kind, found.as_slice()) {
            (ChangeKind::Remove, []) => {}
            (ChangeKind::Remove, _) => {
                return Err(VerifyError::KeyStillPresent(change.key.clone()));
            }
            (_, []) => return Err(VerifyError::KeyMissing(change.key.clone())),
            (_, [entry]) => {
                if !entry.flags.is_empty() {
                    return Err(VerifyError::UnexpectedFlags(change.key.clone()));
                }
                if Some(&entry.value) != change.after.as_ref() {
                    return Err(VerifyError::ValueMismatch(change.key.clone()));
                }
            }
            (_, _) => return Err(VerifyError::UnexpectedFlags(change.key.clone())),
        }
    }
    let changed: HashSet<&str> = changes.iter().map(|change| change.key.as_str()).collect();
    let untouched = |document: &DotenvDocument| -> Vec<(String, String)> {
        document
            .lines
            .iter()
            .filter(|line| match &line.kind {
                LineKind::Entry(entry) => !changed.contains(entry.key.as_str()),
                _ => true,
            })
            .map(|line| (line.raw.clone(), line.terminator.clone()))
            .collect()
    };
    let before = untouched(&parse(original));
    let after = untouched(&after);
    let last = before.len().saturating_sub(1);
    let same = before.len() == after.len()
        && before
            .iter()
            .zip(&after)
            .enumerate()
            .all(|(index, (old, new))| {
                old.0 == new.0 && (old.1 == new.1 || (index == last && old.1.is_empty()))
            });
    if same {
        Ok(())
    } else {
        Err(VerifyError::OtherLinesChanged)
    }
}

#[cfg(test)]
#[path = "edit_tests.rs"]
mod edit_tests;

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
