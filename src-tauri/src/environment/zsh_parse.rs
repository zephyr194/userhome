//! A conservative, side-effect free line model for zsh startup files. It reads
//! text only: nothing is executed, sourced, expanded or evaluated, and no shell
//! is started. Only plain top-level literal assignments are turned into
//! entries; anything that could change meaning at run time (command
//! substitution, conditionals, blocks, `source`, `eval`, aliases, functions,
//! compound commands, line continuations, here-documents, multi-line quotes)
//! is reported as dynamic with the reason, and lines this model does not
//! understand stay as unrecognized. Nothing is inferred about effective values.

use std::fmt;

use serde::Serialize;

use super::dotenv;

/// How well a value can be read without running anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValueState {
    /// Only literal text; the value is exactly what is written.
    Static,
    /// Literal text plus `$HOME`/`$PATH`/`~` references that are kept as
    /// written and not resolved.
    Reference,
    /// Anything else that needs evaluation; the raw text is kept.
    Dynamic,
}

/// Why a statement or value is dynamic (never evaluated here).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DynamicReason {
    CommandSubstitution,
    Arithmetic,
    UnresolvedReference,
    Conditional,
    /// Inside an `if`/`case`/loop/function/group block.
    Block,
    Source,
    Eval,
    FunctionDefinition,
    Alias,
    /// Several commands, pipes or redirections on one line.
    Compound,
    LineContinuation,
    HereDoc,
    MultilineQuote,
    Expansion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Operation {
    Set,
    Append,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathSegment {
    /// Decoded text when `Static`, the text as written otherwise.
    pub text: String,
    pub state: ValueState,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ZshEntry {
    pub name: String,
    /// Written with `export` or `typeset -x`.
    pub exported: bool,
    pub operation: Operation,
    /// Decoded text when `Static`, the value as written otherwise.
    pub value: String,
    pub state: ValueState,
    pub reason: Option<DynamicReason>,
    /// Name (and URL credential) heuristic; not a guarantee either way.
    pub secret: bool,
    /// Present for `PATH`/`path` entries: the items in written order.
    pub segments: Option<Vec<PathSegment>>,
}

// Values may be secrets, so `Debug` shows only the length.
impl fmt::Debug for ZshEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ZshEntry")
            .field("name", &self.name)
            .field("value_len", &self.value.chars().count())
            .field("exported", &self.exported)
            .field("operation", &self.operation)
            .field("state", &self.state)
            .field("reason", &self.reason)
            .field("secret", &self.secret)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineKind {
    Blank,
    Comment,
    /// One or more entries from a single statement (`export A=1 B=2`).
    Entries(Vec<ZshEntry>),
    Dynamic(DynamicReason),
    Unrecognized,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ParsedLine {
    /// 1-based number of the first physical line of this span.
    pub line: usize,
    /// 1-based number of the last physical line.
    pub end_line: usize,
    /// Exact text of the span, without its final line terminator.
    pub raw: String,
    pub kind: LineKind,
}

impl fmt::Debug for ParsedLine {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // `raw` may hold a secret value, so it is deliberately not printed.
        formatter
            .debug_struct("ParsedLine")
            .field("line", &self.line)
            .field("end_line", &self.end_line)
            .field("raw_len", &self.raw.len())
            .field("kind", &self.kind)
            .finish()
    }
}

/// Longest run of physical lines joined into one statement (multi-line
/// arrays, quotes, continuations). Beyond it the rest of the file is one
/// dynamic span instead of being guessed line by line.
const MAX_SPAN_LINES: usize = 512;
/// Most items kept for one `PATH`/`path` entry.
const MAX_SEGMENTS: usize = 512;

/// Names whose references are kept as readable "references" (never resolved).
const KNOWN_REFERENCES: [&str; 3] = ["HOME", "PATH", "path"];
const BLOCK_OPENERS: [&str; 7] = ["if", "case", "for", "while", "until", "select", "repeat"];
const BLOCK_CLOSERS: [&str; 3] = ["fi", "esac", "done"];

pub fn parse(text: &str) -> Vec<ParsedLine> {
    let physical: Vec<&str> = text.lines().collect();
    let mut parsed = Vec::new();
    let mut depth = 0_usize;
    let mut index = 0;
    while index < physical.len() {
        let span = read_span(&physical, index);
        let kind = classify(&span, &mut depth);
        parsed.push(ParsedLine {
            line: index + 1,
            end_line: span.end,
            raw: span.text,
            kind,
        });
        index = span.end;
    }
    parsed
}

// ---- spans -------------------------------------------------------------------

struct Span {
    /// 1-based number of the last physical line (also the next index, 0-based).
    end: usize,
    text: String,
    lexed: Lexed,
    /// Why the span is dynamic regardless of its content.
    reason: Option<DynamicReason>,
    physical_lines: usize,
}

/// Joins physical lines while the text is still open (quote, continuation,
/// array) and swallows a here-document body, so no line of a multi-line
/// construct is ever read as a top-level statement.
fn read_span(physical: &[&str], start: usize) -> Span {
    let mut end = start + 1;
    let mut text = physical[start].to_owned();
    let mut reason = None;
    let mut lexed = lex(&text);
    while let Some(open) = lexed.incomplete {
        reason = reason.or(match open {
            Incomplete::Quote => Some(DynamicReason::MultilineQuote),
            Incomplete::Continuation => Some(DynamicReason::LineContinuation),
            Incomplete::Array => None,
        });
        if end >= physical.len() {
            break;
        }
        if end - start >= MAX_SPAN_LINES {
            // Too long to follow: the remainder is one span, never guessed.
            for line in &physical[end..] {
                text.push('\n');
                text.push_str(line);
            }
            end = physical.len();
            break;
        }
        text.push('\n');
        text.push_str(physical[end]);
        end += 1;
        lexed = lex(&text);
    }
    if lexed.incomplete.is_none()
        && let Some(heredoc) = &lexed.heredoc
    {
        reason = Some(DynamicReason::HereDoc);
        while end < physical.len() {
            let line = physical[end];
            text.push('\n');
            text.push_str(line);
            end += 1;
            let candidate = if heredoc.strip_tabs {
                line.trim_start_matches('\t')
            } else {
                line
            };
            if candidate == heredoc.delimiter {
                break;
            }
        }
    }
    Span {
        end,
        physical_lines: end - start,
        text,
        lexed,
        reason,
    }
}

// ---- classification ------------------------------------------------------------

fn classify(span: &Span, depth: &mut usize) -> LineKind {
    let trimmed = span.text.trim();
    if span.physical_lines == 1 {
        if trimmed.is_empty() {
            return LineKind::Blank;
        }
        if trimmed.starts_with('#') {
            return LineKind::Comment;
        }
    }
    let lexed = &span.lexed;
    let before = *depth;
    let mut opens = lexed.opens;
    let mut closes = lexed.closes;
    if trimmed.starts_with('(') && !trimmed.starts_with("((") {
        opens += usize::try_from(lexed.paren_net.max(0)).unwrap_or(0);
    } else if trimmed.starts_with(')') && before > 0 {
        closes += 1;
    }
    *depth = (before + opens).saturating_sub(closes);
    let touches_block = before > 0 || opens > 0 || closes > 0;

    if let Some(reason) = span.reason {
        return LineKind::Dynamic(reason);
    }
    match lexed.incomplete {
        Some(Incomplete::Quote) => return LineKind::Dynamic(DynamicReason::MultilineQuote),
        Some(Incomplete::Continuation) => {
            return LineKind::Dynamic(DynamicReason::LineContinuation);
        }
        Some(Incomplete::Array) => return LineKind::Unrecognized,
        None => {}
    }
    let first = lexed.words.first().map(|word| word.raw.as_str());
    if touches_block {
        if before > 0 {
            return LineKind::Dynamic(DynamicReason::Block);
        }
        if closes > 0 && opens == 0 {
            // A closer without an opener: nothing to track, nothing to infer.
            return LineKind::Unrecognized;
        }
        return LineKind::Dynamic(opening_reason(first, lexed));
    }
    if trimmed.starts_with("((") {
        return LineKind::Dynamic(DynamicReason::Arithmetic);
    }
    if let Some(reason) = first.and_then(keyword_reason) {
        return LineKind::Dynamic(reason);
    }
    if lexed.func_paren {
        return LineKind::Dynamic(DynamicReason::FunctionDefinition);
    }
    if lexed.compound {
        return LineKind::Dynamic(DynamicReason::Compound);
    }
    match parse_statement(&lexed.words, lexed.forced_reason()) {
        Some(entries) if !entries.is_empty() => LineKind::Entries(entries),
        _ if lexed.commsub => LineKind::Dynamic(DynamicReason::CommandSubstitution),
        _ if lexed.arith => LineKind::Dynamic(DynamicReason::Arithmetic),
        _ => LineKind::Unrecognized,
    }
}

fn opening_reason(first: Option<&str>, lexed: &Lexed) -> DynamicReason {
    if lexed.func_paren || first == Some("function") {
        return DynamicReason::FunctionDefinition;
    }
    first
        .and_then(keyword_reason)
        .unwrap_or(DynamicReason::Block)
}

/// Statements that are dynamic by their command word alone.
fn keyword_reason(word: &str) -> Option<DynamicReason> {
    match word {
        "source" | "." => Some(DynamicReason::Source),
        "eval" => Some(DynamicReason::Eval),
        "alias" | "unalias" | "galias" => Some(DynamicReason::Alias),
        "function" => Some(DynamicReason::FunctionDefinition),
        "if" | "case" | "for" | "while" | "until" | "select" | "repeat" | "[[" | "[" | "test"
        | "!" => Some(DynamicReason::Conditional),
        _ => None,
    }
}

// ---- statements ----------------------------------------------------------------

/// `NAME=value` words, `export`/`typeset`/`declare` with a few known flags.
/// Anything else (a command with a temporary assignment, a declaration without
/// a value, unknown flags) is not an entry.
fn parse_statement(words: &[Word], forced: Option<DynamicReason>) -> Option<Vec<ZshEntry>> {
    let first = words.first()?.raw.as_str();
    let mut exported = false;
    let mut index = 0;
    if matches!(first, "export" | "typeset" | "declare") {
        exported = first == "export";
        index = 1;
        while let Some(flags) = words
            .get(index)
            .and_then(|word| word.raw.strip_prefix('-'))
            .filter(|flags| !flags.is_empty())
        {
            if !flags
                .chars()
                .all(|flag| matches!(flag, 'x' | 'g' | 'U' | 'r'))
            {
                return None;
            }
            exported |= flags.contains('x');
            index += 1;
        }
    }
    let mut entries = Vec::new();
    for word in &words[index..] {
        let (name, operation, rhs) = split_assignment(&word.raw)?;
        entries.push(build_entry(name, operation, rhs, exported, forced)?);
    }
    Some(entries)
}

fn split_assignment(raw: &str) -> Option<(&str, Operation, &str)> {
    let (left, rhs) = raw.split_once('=')?;
    let (name, operation) = match left.strip_suffix('+') {
        Some(name) => (name, Operation::Append),
        None => (left, Operation::Set),
    };
    dotenv::is_valid_key(name).then_some((name, operation, rhs))
}

fn build_entry(
    name: &str,
    operation: Operation,
    rhs: &str,
    exported: bool,
    forced: Option<DynamicReason>,
) -> Option<ZshEntry> {
    let is_path = matches!(name, "PATH" | "path");
    let (value, mut state, mut reason, segments) = if rhs.starts_with('(') {
        // Only `path`/`PATH` arrays are modelled; other arrays stay unrecognized.
        if !is_path {
            return None;
        }
        let segments: Vec<SegmentDraft> = split_array_items(rhs)?
            .iter()
            .map(|item| segment_of(&decode_pieces(item)))
            .collect();
        path_parts(rhs, segments)?
    } else if is_path {
        let mut segments = split_at_colons(decode_pieces(rhs));
        if operation == Operation::Append
            && rhs.starts_with(':')
            && segments.first().is_some_and(|first| first.text.is_empty())
        {
            segments.remove(0);
        }
        path_parts(rhs, segments)?
    } else {
        let pieces = decode_pieces(rhs);
        let (state, reason) = worst(&pieces);
        let value = if state == ValueState::Static {
            pieces.iter().map(|piece| piece.display.as_str()).collect()
        } else {
            rhs.to_owned()
        };
        (value, state, reason, None)
    };
    let mut value = value;
    if let Some(forced) = forced {
        state = ValueState::Dynamic;
        reason = Some(forced);
        rhs.clone_into(&mut value);
    }
    let secret = dotenv::value_looks_secret(name, &value);
    Some(ZshEntry {
        name: name.to_owned(),
        exported,
        operation,
        value,
        state,
        reason,
        secret,
        segments,
    })
}

type PathParts = (
    String,
    ValueState,
    Option<DynamicReason>,
    Option<Vec<PathSegment>>,
);

/// Value text, overall state and the segments of a `PATH`/`path` entry.
fn path_parts(rhs: &str, segments: Vec<SegmentDraft>) -> Option<PathParts> {
    if segments.len() > MAX_SEGMENTS {
        return None;
    }
    let state = segments
        .iter()
        .map(|segment| segment.state)
        .fold(ValueState::Static, merge_state);
    let reason = segments
        .iter()
        .filter(|segment| segment.state == ValueState::Dynamic)
        .map(|segment| segment.reason)
        .fold(None, merge_reason);
    let value = if state == ValueState::Static {
        segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>()
            .join(":")
    } else {
        rhs.to_owned()
    };
    let segments = segments
        .into_iter()
        .map(|segment| PathSegment {
            text: segment.text,
            state: segment.state,
        })
        .collect();
    Some((value, state, reason, Some(segments)))
}

// ---- value decoding -------------------------------------------------------------

/// One decoded unit of a value: a literal character or one unresolved
/// reference/expansion. `display` is the decoded text for literals and the text
/// as written for references.
struct Piece {
    display: String,
    state: ValueState,
    reason: Option<DynamicReason>,
    /// A literal `:` (a `PATH` separator).
    colon: bool,
}

/// Item of a `PATH`/`path` entry; carries the reason a segment is dynamic while
/// the entry is being built.
struct SegmentDraft {
    text: String,
    state: ValueState,
    reason: Option<DynamicReason>,
}

fn merge_state(left: ValueState, right: ValueState) -> ValueState {
    match (left, right) {
        (ValueState::Dynamic, _) | (_, ValueState::Dynamic) => ValueState::Dynamic,
        (ValueState::Reference, _) | (_, ValueState::Reference) => ValueState::Reference,
        _ => ValueState::Static,
    }
}

fn reason_rank(reason: DynamicReason) -> u8 {
    match reason {
        DynamicReason::CommandSubstitution => 0,
        DynamicReason::Arithmetic => 1,
        DynamicReason::UnresolvedReference => 2,
        _ => 3,
    }
}

fn merge_reason(
    left: Option<DynamicReason>,
    right: Option<DynamicReason>,
) -> Option<DynamicReason> {
    match (left, right) {
        (Some(a), Some(b)) => Some(if reason_rank(b) < reason_rank(a) {
            b
        } else {
            a
        }),
        (a, b) => a.or(b),
    }
}

fn worst(pieces: &[Piece]) -> (ValueState, Option<DynamicReason>) {
    let state = pieces
        .iter()
        .map(|piece| piece.state)
        .fold(ValueState::Static, merge_state);
    let reason = pieces
        .iter()
        .filter(|piece| piece.state == ValueState::Dynamic)
        .map(|piece| piece.reason)
        .fold(None, merge_reason);
    (state, reason)
}

fn segment_of(pieces: &[Piece]) -> SegmentDraft {
    let (state, reason) = worst(pieces);
    SegmentDraft {
        text: pieces.iter().map(|piece| piece.display.as_str()).collect(),
        state,
        reason,
    }
}

fn split_at_colons(pieces: Vec<Piece>) -> Vec<SegmentDraft> {
    let mut segments = Vec::new();
    let mut group: Vec<Piece> = Vec::new();
    for piece in pieces {
        if piece.colon {
            segments.push(segment_of(&group));
            group.clear();
        } else {
            group.push(piece);
        }
    }
    segments.push(segment_of(&group));
    segments
}

fn literal(character: char) -> Piece {
    Piece {
        display: character.to_string(),
        state: ValueState::Static,
        reason: None,
        colon: character == ':',
    }
}

fn unresolved(display: String, state: ValueState, reason: Option<DynamicReason>) -> Piece {
    Piece {
        display,
        state,
        reason,
        colon: false,
    }
}

/// Decodes one shell word without expanding anything: quotes and backslashes
/// are removed from literal text, references and expansions stay as written.
fn decode_pieces(raw: &str) -> Vec<Piece> {
    let chars: Vec<char> = raw.chars().collect();
    let mut pieces: Vec<Piece> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let at_item_start = pieces.last().is_none_or(|piece| piece.colon);
        match chars[i] {
            '\'' => {
                let (inner_end, end) = match skip_single(&chars, i) {
                    Some(end) => (end - 1, end),
                    None => (chars.len(), chars.len()),
                };
                pieces.extend(chars[i + 1..inner_end].iter().copied().map(literal));
                i = end;
            }
            '"' => i = decode_double(&chars, i, &mut pieces),
            '\\' => {
                match chars.get(i + 1) {
                    Some('\n') => {}
                    Some(&next) => pieces.push(literal(next)),
                    None => pieces.push(literal('\\')),
                }
                i += 2;
            }
            '$' => i = decode_dollar(&chars, i, &mut pieces),
            '`' => {
                let end = skip_backtick(&chars, i).unwrap_or(chars.len());
                pieces.push(unresolved(
                    chars[i..end].iter().collect(),
                    ValueState::Dynamic,
                    Some(DynamicReason::CommandSubstitution),
                ));
                i = end;
            }
            '~' if at_item_start => {
                pieces.push(unresolved("~".to_owned(), ValueState::Reference, None));
                i += 1;
            }
            other => {
                pieces.push(literal(other));
                i += 1;
            }
        }
    }
    pieces
}

fn decode_double(chars: &[char], start: usize, pieces: &mut Vec<Piece>) -> usize {
    let mut i = start + 1;
    while i < chars.len() {
        match chars[i] {
            '"' => return i + 1,
            '\\' => {
                match chars.get(i + 1) {
                    Some('\n') => {}
                    Some(&next) if matches!(next, '$' | '`' | '"' | '\\') => {
                        pieces.push(literal(next));
                    }
                    Some(&next) => {
                        pieces.push(literal('\\'));
                        pieces.push(literal(next));
                    }
                    None => pieces.push(literal('\\')),
                }
                i += 2;
            }
            '$' => i = decode_dollar(chars, i, pieces),
            '`' => {
                let end = skip_backtick(chars, i).unwrap_or(chars.len());
                pieces.push(unresolved(
                    chars[i..end].iter().collect(),
                    ValueState::Dynamic,
                    Some(DynamicReason::CommandSubstitution),
                ));
                i = end;
            }
            other => {
                pieces.push(literal(other));
                i += 1;
            }
        }
    }
    chars.len()
}

/// Handles a `$` at `chars[start]` and returns the index after it.
fn decode_dollar(chars: &[char], start: usize, pieces: &mut Vec<Piece>) -> usize {
    let next = chars.get(start + 1).copied();
    let dynamic = |reason: DynamicReason, end: usize, pieces: &mut Vec<Piece>| {
        pieces.push(unresolved(
            chars[start..end].iter().collect(),
            ValueState::Dynamic,
            Some(reason),
        ));
        end
    };
    match next {
        Some('(') => {
            let reason = if chars.get(start + 2) == Some(&'(') {
                DynamicReason::Arithmetic
            } else {
                DynamicReason::CommandSubstitution
            };
            let end = skip_balanced(chars, start + 1, '(', ')').unwrap_or(chars.len());
            dynamic(reason, end, pieces)
        }
        Some('{') => {
            let end = skip_balanced(chars, start + 1, '{', '}').unwrap_or(chars.len());
            let inner: String = chars[start + 2..end.saturating_sub(1).max(start + 2)]
                .iter()
                .collect();
            if KNOWN_REFERENCES.contains(&inner.as_str()) {
                pieces.push(unresolved(
                    chars[start..end].iter().collect(),
                    ValueState::Reference,
                    None,
                ));
                end
            } else {
                dynamic(DynamicReason::UnresolvedReference, end, pieces)
            }
        }
        Some('\'') | Some('"') => {
            // `$'…'` and `$"…"` use their own escape rules; not decoded.
            let end = if next == Some('\'') {
                skip_dollar_quote(chars, start + 1).unwrap_or(chars.len())
            } else {
                start + 1
            };
            dynamic(DynamicReason::Expansion, end, pieces)
        }
        Some(name_start) if name_start.is_ascii_alphabetic() || name_start == '_' => {
            let mut end = start + 1;
            while chars
                .get(end)
                .is_some_and(|c| c.is_ascii_alphanumeric() || *c == '_')
            {
                end += 1;
            }
            let name: String = chars[start + 1..end].iter().collect();
            let display: String = chars[start..end].iter().collect();
            if KNOWN_REFERENCES.contains(&name.as_str()) {
                pieces.push(unresolved(display, ValueState::Reference, None));
                end
            } else {
                dynamic(DynamicReason::UnresolvedReference, end, pieces)
            }
        }
        Some(digit) if digit.is_ascii_digit() => {
            let mut end = start + 1;
            while chars.get(end).is_some_and(char::is_ascii_digit) {
                end += 1;
            }
            dynamic(DynamicReason::UnresolvedReference, end, pieces)
        }
        Some('@' | '*' | '#' | '?' | '!' | '$' | '-') => {
            dynamic(DynamicReason::UnresolvedReference, start + 2, pieces)
        }
        _ => {
            pieces.push(literal('$'));
            start + 1
        }
    }
}

/// Expands the only references a static `ZDOTDIR` may use — a leading `~`,
/// `$HOME` and `${HOME}` — against `home`, and decodes quotes and escapes in
/// the rest. Any other reference or expansion yields `None`: nothing is
/// evaluated or guessed.
pub fn expand_home_literal(raw: &str, home: &str) -> Option<String> {
    let pieces = decode_pieces(raw);
    let mut expanded = String::new();
    for (index, piece) in pieces.iter().enumerate() {
        match (piece.state, piece.display.as_str()) {
            (ValueState::Static, text) => expanded.push_str(text),
            (ValueState::Reference, "~")
                if index == 0
                    && pieces.get(1).is_none_or(|next| {
                        next.state == ValueState::Static && next.display == "/"
                    }) =>
            {
                expanded.push_str(home);
            }
            (ValueState::Reference, "$HOME" | "${HOME}") => expanded.push_str(home),
            _ => return None,
        }
    }
    Some(expanded)
}

// ---- lexing --------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Incomplete {
    Quote,
    Continuation,
    Array,
}

struct Heredoc {
    delimiter: String,
    strip_tabs: bool,
}

struct Word {
    raw: String,
}

#[derive(Default)]
struct Lexed {
    words: Vec<Word>,
    incomplete: Option<Incomplete>,
    commsub: bool,
    arith: bool,
    compound: bool,
    func_paren: bool,
    heredoc: Option<Heredoc>,
    opens: usize,
    closes: usize,
    paren_net: i32,
}

impl Lexed {
    fn forced_reason(&self) -> Option<DynamicReason> {
        if self.commsub {
            Some(DynamicReason::CommandSubstitution)
        } else if self.arith {
            Some(DynamicReason::Arithmetic)
        } else {
            None
        }
    }
}

struct Lexer<'a> {
    chars: &'a [char],
    out: Lexed,
    current: String,
    in_word: bool,
    word_at_command: bool,
    at_command: bool,
    open_braces: usize,
}

fn lex(text: &str) -> Lexed {
    let chars: Vec<char> = text.chars().collect();
    let mut lexer = Lexer {
        chars: &chars,
        out: Lexed::default(),
        current: String::new(),
        in_word: false,
        word_at_command: true,
        at_command: true,
        open_braces: 0,
    };
    lexer.run();
    lexer.flush();
    lexer.out
}

impl Lexer<'_> {
    fn push_chars(&mut self, from: usize, to: usize) {
        if !self.in_word {
            self.in_word = true;
            self.word_at_command = self.at_command;
        }
        self.current.extend(&self.chars[from..to]);
    }

    fn flush(&mut self) {
        if !self.in_word {
            return;
        }
        self.in_word = false;
        let raw = std::mem::take(&mut self.current);
        let command = self.word_at_command;
        let function_keyword = self
            .out
            .words
            .first()
            .is_some_and(|word| word.raw == "function");
        if raw == "{" && (command || function_keyword) {
            self.out.opens += 1;
            self.open_braces += 1;
        } else if raw == "}" && (command || self.open_braces > 0) {
            self.out.closes += 1;
            self.open_braces = self.open_braces.saturating_sub(1);
        } else if command && BLOCK_OPENERS.contains(&raw.as_str()) {
            self.out.opens += 1;
        } else if command && BLOCK_CLOSERS.contains(&raw.as_str()) {
            self.out.closes += 1;
        }
        self.at_command = command
            && matches!(
                raw.as_str(),
                "if" | "elif"
                    | "while"
                    | "until"
                    | "then"
                    | "do"
                    | "else"
                    | "{"
                    | "!"
                    | "time"
                    | "coproc"
                    | "nocorrect"
                    | "noglob"
            );
        self.out.words.push(Word { raw });
    }

    fn separator(&mut self) {
        self.flush();
        self.at_command = true;
    }

    fn run(&mut self) {
        let n = self.chars.len();
        let mut i = 0;
        while i < n {
            let c = self.chars[i];
            match c {
                ' ' | '\t' | '\r' => {
                    self.flush();
                    i += 1;
                }
                '\n' => {
                    self.separator();
                    i += 1;
                }
                '#' if !self.in_word => {
                    while i < n && self.chars[i] != '\n' {
                        i += 1;
                    }
                }
                '\\' => match self.chars.get(i + 1) {
                    None => {
                        self.out.incomplete = Some(Incomplete::Continuation);
                        i += 1;
                    }
                    Some('\n') => i += 2,
                    Some(_) => {
                        self.push_chars(i, i + 2);
                        i += 2;
                    }
                },
                '\'' => match skip_single(self.chars, i) {
                    Some(end) => {
                        self.push_chars(i, end);
                        i = end;
                    }
                    None => {
                        self.push_chars(i, n);
                        self.out.incomplete = Some(Incomplete::Quote);
                        i = n;
                    }
                },
                '"' => {
                    let mut flags = QuoteFlags::default();
                    let end = skip_double(self.chars, i, &mut flags);
                    self.out.commsub |= flags.commsub;
                    self.out.arith |= flags.arith;
                    match end {
                        Some(end) => {
                            self.push_chars(i, end);
                            i = end;
                        }
                        None => {
                            self.push_chars(i, n);
                            self.out.incomplete = Some(Incomplete::Quote);
                            i = n;
                        }
                    }
                }
                '`' => {
                    self.out.commsub = true;
                    match skip_backtick(self.chars, i) {
                        Some(end) => {
                            self.push_chars(i, end);
                            i = end;
                        }
                        None => {
                            self.push_chars(i, n);
                            self.out.incomplete = Some(Incomplete::Quote);
                            i = n;
                        }
                    }
                }
                '$' => i = self.dollar(i),
                ';' => {
                    let mut j = i + 1;
                    while j < n && matches!(self.chars[j], ' ' | '\t' | '\r') {
                        j += 1;
                    }
                    let trailing = j >= n || self.chars[j] == '\n' || self.chars[j] == '#';
                    if !trailing {
                        self.out.compound = true;
                    }
                    self.separator();
                    i += 1;
                }
                '&' | '|' => {
                    self.out.compound = true;
                    self.separator();
                    i += 1;
                }
                '<' | '>' => {
                    self.out.compound = true;
                    self.flush();
                    i = if c == '<' && self.chars.get(i + 1) == Some(&'<') {
                        self.heredoc(i)
                    } else {
                        i + 1
                    };
                }
                '(' => i = self.open_paren(i),
                ')' => {
                    self.out.compound = true;
                    self.out.paren_net -= 1;
                    self.separator();
                    i += 1;
                }
                _ => {
                    self.push_chars(i, i + 1);
                    i += 1;
                }
            }
        }
    }

    fn dollar(&mut self, i: usize) -> usize {
        let n = self.chars.len();
        let end = match self.chars.get(i + 1) {
            Some('(') => {
                if self.chars.get(i + 2) == Some(&'(') {
                    self.out.arith = true;
                } else {
                    self.out.commsub = true;
                }
                skip_balanced(self.chars, i + 1, '(', ')')
            }
            Some('{') => skip_balanced(self.chars, i + 1, '{', '}'),
            Some('\'') => skip_dollar_quote(self.chars, i + 1),
            _ => Some(i + 1),
        };
        match end {
            Some(end) => {
                self.push_chars(i, end);
                end
            }
            None => {
                self.push_chars(i, n);
                self.out.incomplete = Some(Incomplete::Quote);
                n
            }
        }
    }

    /// `NAME=(` starts an array literal that belongs to the word; any other
    /// parenthesis is a function definition marker or a subshell/group.
    fn open_paren(&mut self, i: usize) -> usize {
        let n = self.chars.len();
        let after_assignment = self.in_word
            && split_assignment(&self.current).is_some_and(|(_, _, rhs)| rhs.is_empty());
        if after_assignment {
            return match skip_array(self.chars, i) {
                Ok(end) => {
                    self.push_chars(i, end);
                    end
                }
                Err(open) => {
                    self.push_chars(i, n);
                    self.out.incomplete = Some(open);
                    n
                }
            };
        }
        let mut j = i + 1;
        while j < n && matches!(self.chars[j], ' ' | '\t') {
            j += 1;
        }
        if self.chars.get(j) == Some(&')') {
            self.out.func_paren = true;
            self.flush();
            self.at_command = true;
            return j + 1;
        }
        self.out.compound = true;
        self.out.paren_net += 1;
        self.separator();
        i + 1
    }

    /// `<<` at `chars[i]`: a here-document unless it is the here-string `<<<`.
    fn heredoc(&mut self, i: usize) -> usize {
        let n = self.chars.len();
        if self.chars.get(i + 2) == Some(&'<') {
            return i + 3;
        }
        let mut j = i + 2;
        let strip_tabs = self.chars.get(j) == Some(&'-');
        if strip_tabs {
            j += 1;
        }
        while j < n && matches!(self.chars[j], ' ' | '\t') {
            j += 1;
        }
        let mut delimiter = String::new();
        while j < n
            && !matches!(
                self.chars[j],
                ' ' | '\t' | '\n' | ';' | '&' | '|' | '<' | '>' | '(' | ')'
            )
        {
            match self.chars[j] {
                '\'' | '"' => {
                    let quote = self.chars[j];
                    j += 1;
                    while j < n && self.chars[j] != quote {
                        delimiter.push(self.chars[j]);
                        j += 1;
                    }
                    j += 1;
                }
                '\\' => {
                    j += 1;
                }
                other => {
                    delimiter.push(other);
                    j += 1;
                }
            }
        }
        if !delimiter.is_empty() && self.out.heredoc.is_none() {
            self.out.heredoc = Some(Heredoc {
                delimiter,
                strip_tabs,
            });
        }
        j.min(n)
    }
}

#[derive(Default)]
struct QuoteFlags {
    commsub: bool,
    arith: bool,
}

/// `chars[i]` is `'`; returns the index after the closing quote.
fn skip_single(chars: &[char], i: usize) -> Option<usize> {
    chars[i + 1..]
        .iter()
        .position(|c| *c == '\'')
        .map(|offset| i + 1 + offset + 1)
}

/// `$'…'`: like a single quote, but a backslash escapes the next character.
fn skip_dollar_quote(chars: &[char], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < chars.len() {
        match chars[j] {
            '\\' => j += 2,
            '\'' => return Some(j + 1),
            _ => j += 1,
        }
    }
    None
}

/// `chars[i]` is a backtick; returns the index after the closing one.
fn skip_backtick(chars: &[char], i: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < chars.len() {
        match chars[j] {
            '\\' => j += 2,
            '`' => return Some(j + 1),
            _ => j += 1,
        }
    }
    None
}

/// `chars[i]` is `"`; returns the index after the closing quote and records
/// command substitutions inside it.
fn skip_double(chars: &[char], i: usize, flags: &mut QuoteFlags) -> Option<usize> {
    let mut j = i + 1;
    while j < chars.len() {
        match chars[j] {
            '\\' => j += 2,
            '"' => return Some(j + 1),
            '`' => {
                flags.commsub = true;
                j = skip_backtick(chars, j)?;
            }
            '$' if chars.get(j + 1) == Some(&'(') => {
                if chars.get(j + 2) == Some(&'(') {
                    flags.arith = true;
                } else {
                    flags.commsub = true;
                }
                j = skip_balanced(chars, j + 1, '(', ')')?;
            }
            '$' if chars.get(j + 1) == Some(&'{') => {
                j = skip_balanced(chars, j + 1, '{', '}')?;
            }
            _ => j += 1,
        }
    }
    None
}

/// `chars[i]` is `open`; returns the index after its matching `close`,
/// stepping over quotes and escapes.
fn skip_balanced(chars: &[char], i: usize, open: char, close: char) -> Option<usize> {
    let mut depth = 0_usize;
    let mut j = i;
    while j < chars.len() {
        let c = chars[j];
        if c == '\\' {
            j += 2;
            continue;
        }
        if c == '\'' {
            j = skip_single(chars, j)?;
            continue;
        }
        if c == '"' {
            j = skip_double(chars, j, &mut QuoteFlags::default())?;
            continue;
        }
        if c == '`' {
            j = skip_backtick(chars, j)?;
            continue;
        }
        if c == open {
            depth += 1;
        } else if c == close && depth > 0 {
            depth -= 1;
            if depth == 0 {
                return Some(j + 1);
            }
        }
        j += 1;
    }
    None
}

/// `chars[i]` is the `(` of an array literal; comments inside it are skipped.
fn skip_array(chars: &[char], i: usize) -> Result<usize, Incomplete> {
    let mut depth = 0_usize;
    let mut j = i;
    while j < chars.len() {
        match chars[j] {
            '\\' => j += 2,
            '\'' => j = skip_single(chars, j).ok_or(Incomplete::Quote)?,
            '"' => {
                j = skip_double(chars, j, &mut QuoteFlags::default()).ok_or(Incomplete::Quote)?;
            }
            '`' => j = skip_backtick(chars, j).ok_or(Incomplete::Quote)?,
            '$' if chars.get(j + 1) == Some(&'(') => {
                j = skip_balanced(chars, j + 1, '(', ')').ok_or(Incomplete::Quote)?;
            }
            '#' if j == i + 1 || chars[j - 1].is_whitespace() => {
                while j < chars.len() && chars[j] != '\n' {
                    j += 1;
                }
            }
            '(' => {
                depth += 1;
                j += 1;
            }
            ')' => {
                depth = depth.saturating_sub(1);
                j += 1;
                if depth == 0 {
                    return Ok(j);
                }
            }
            _ => j += 1,
        }
    }
    Err(Incomplete::Array)
}

/// Splits `(a "b c" $d)` into its raw items; `None` when it is not a plain
/// array literal or has too many items.
fn split_array_items(rhs: &str) -> Option<Vec<String>> {
    let chars: Vec<char> = rhs.chars().collect();
    if chars.last() != Some(&')') {
        return None;
    }
    let end = skip_array(&chars, 0).ok()?;
    if end != chars.len() {
        return None;
    }
    let inner = &chars[1..chars.len() - 1];
    let mut items = Vec::new();
    let mut current = String::new();
    let mut in_item = false;
    let mut i = 0;
    while i < inner.len() {
        let c = inner[i];
        let step_end = match c {
            c if c.is_whitespace() => {
                if in_item {
                    items.push(std::mem::take(&mut current));
                    in_item = false;
                }
                i += 1;
                continue;
            }
            '#' if !in_item => {
                while i < inner.len() && inner[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '\\' => (i + 2).min(inner.len()),
            '\'' => skip_single(inner, i)?,
            '"' => skip_double(inner, i, &mut QuoteFlags::default())?,
            '`' => skip_backtick(inner, i)?,
            '$' if inner.get(i + 1) == Some(&'(') => skip_balanced(inner, i + 1, '(', ')')?,
            '$' if inner.get(i + 1) == Some(&'{') => skip_balanced(inner, i + 1, '{', '}')?,
            _ => i + 1,
        };
        in_item = true;
        current.extend(&inner[i..step_end]);
        i = step_end;
    }
    if in_item {
        items.push(current);
    }
    (items.len() <= MAX_SEGMENTS).then_some(items)
}

#[cfg(test)]
#[path = "zsh_parse_tests.rs"]
mod tests;
