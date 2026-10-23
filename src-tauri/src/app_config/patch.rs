//! Format-aware, line-level reads, patches and raw checks. A patch rewrites only
//! the lines it must change; comments, unrelated lines and line endings survive
//! byte for byte. Anything that cannot be located safely is refused, never guessed.

use serde_json::Value;

use crate::{
    config::formats::parse_json_document,
    environment::dotenv::value_looks_secret,
};

use super::{
    patch_ini::{ini_check, ini_lookup, ini_patch},
    patch_toml::{toml_check, toml_lookup, toml_patch},
    registry::Format,
    schema::{FieldKind, FieldSpec, TypedValue},
};

pub const UNSAFE_LOCATION: &str = "这个键的写法无法安全修改，请使用高级模式。";

#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    Set(TypedValue),
    Delete,
}

/// A scalar as written in the file, before type interpretation.
#[derive(Debug, Clone, PartialEq)]
pub enum Scalar {
    /// Text after quotes and escapes are removed.
    Text(String),
    /// An unquoted token such as `true`, `12` or `0.9`.
    Bare(String),
}

impl Scalar {
    pub fn raw(&self) -> &str {
        match self {
            Scalar::Text(text) | Scalar::Bare(text) => text,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Lookup {
    Absent,
    /// `None` means the value exists but is not a simple scalar.
    Present(Option<Scalar>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawError {
    pub line: Option<usize>,
    pub message: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Line {
    pub text: String,
    pub eol: &'static str,
}

pub fn split_lines(text: &str) -> Vec<Line> {
    text.split_inclusive('\n')
        .map(|piece| {
            if let Some(body) = piece.strip_suffix("\r\n") {
                Line { text: body.to_owned(), eol: "\r\n" }
            } else if let Some(body) = piece.strip_suffix('\n') {
                Line { text: body.to_owned(), eol: "\n" }
            } else {
                Line { text: piece.to_owned(), eol: "" }
            }
        })
        .collect()
}

pub fn join_lines(lines: &[Line]) -> String {
    lines
        .iter()
        .map(|line| format!("{}{}", line.text, line.eol))
        .collect()
}

fn default_eol(lines: &[Line]) -> &'static str {
    lines
        .iter()
        .map(|line| line.eol)
        .find(|eol| !eol.is_empty())
        .unwrap_or("\n")
}

/// Inserts lines before `at`. When appending to a file that has no final line
/// break, the file still ends without one afterwards.
pub fn insert_lines(lines: &mut Vec<Line>, at: usize, texts: Vec<String>) {
    let eol = default_eol(lines);
    let appending = at == lines.len();
    let unterminated_end = appending && lines.last().is_some_and(|line| line.eol.is_empty());
    if unterminated_end {
        if let Some(last) = lines.last_mut() {
            last.eol = eol;
        }
    }
    let count = texts.len();
    let inserted: Vec<Line> = texts
        .into_iter()
        .enumerate()
        .map(|(index, text)| {
            let is_final = index + 1 == count;
            let eol = if unterminated_end && is_final { "" } else { eol };
            Line { text, eol }
        })
        .collect();
    lines.splice(at..at, inserted);
}

/// Index of the first `#`, `;` or `#`-style comment marker outside quotes.
/// `literal_single` also treats single quotes as quoting (TOML literal strings).
pub fn comment_start(value: &str, markers: &[char], literal_single: bool) -> Option<usize> {
    let mut in_double = false;
    let mut in_single = false;
    let mut escaped = false;
    for (index, c) in value.char_indices() {
        if in_double {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_double = false;
            }
            continue;
        }
        if in_single {
            if c == '\'' {
                in_single = false;
            }
            continue;
        }
        match c {
            '"' => in_double = true,
            '\'' if literal_single => in_single = true,
            c if markers.contains(&c) => return Some(index),
            _ => {}
        }
    }
    None
}

pub fn quotes_balanced(raw: &str) -> bool {
    let mut open = false;
    let mut escaped = false;
    for c in raw.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '"' => open = !open,
            _ => {}
        }
    }
    !open
}

pub fn render(format: Format, value: &TypedValue) -> String {
    match value {
        TypedValue::Bool(flag) => flag.to_string(),
        TypedValue::Integer(number) => number.to_string(),
        TypedValue::Number(number) => number_text(*number),
        TypedValue::Text(text) => match format {
            Format::Ini => ini_quote(text),
            _ => toml_quote(text),
        },
    }
}

fn number_text(number: f64) -> String {
    if number.fract() == 0.0 {
        format!("{number:.1}")
    } else {
        number.to_string()
    }
}

/// Git values are quoted only when a bare value would change meaning.
fn ini_quote(text: &str) -> String {
    let needs_quotes = text.is_empty()
        || text.starts_with(char::is_whitespace)
        || text.ends_with(char::is_whitespace)
        || text.contains(['#', ';', '"', '\\']);
    if !needs_quotes {
        return text.to_owned();
    }
    format!("\"{}\"", escape(text))
}

fn toml_quote(text: &str) -> String {
    format!("\"{}\"", escape(text))
}

fn escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn ini_unquote(raw: &str) -> String {
    let mut output = String::new();
    let mut in_quotes = false;
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => in_quotes = !in_quotes,
            '\\' => match chars.next() {
                Some('n') => output.push('\n'),
                Some('t') => output.push('\t'),
                Some('b') => output.push('\u{8}'),
                Some(other) => output.push(other),
                None => {}
            },
            other => output.push(other),
        }
    }
    output
}

fn bool_word(text: &str) -> Option<bool> {
    match text.trim().to_ascii_lowercase().as_str() {
        "true" | "yes" | "on" | "1" => Some(true),
        "false" | "no" | "off" | "0" => Some(false),
        _ => None,
    }
}

/// Interprets a scalar as the field's type. `None` when it does not fit.
pub fn scalar_value(field: &FieldSpec, scalar: &Scalar) -> Option<Value> {
    match (field.kind, scalar) {
        (FieldKind::String, Scalar::Text(text)) => Some(Value::String(text.clone())),
        (FieldKind::Enum, Scalar::Text(text)) if field.enum_values.contains(&text.as_str()) => {
            Some(Value::String(text.clone()))
        }
        (FieldKind::Bool, scalar) => bool_word(scalar.raw()).map(Value::Bool),
        (FieldKind::Integer, Scalar::Bare(token)) => token
            .replace('_', "")
            .parse::<i64>()
            .ok()
            .map(|number| Value::Number(number.into())),
        (FieldKind::Number, Scalar::Bare(token)) => token
            .replace('_', "")
            .parse::<f64>()
            .ok()
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number),
        _ => None,
    }
}

/// Splits a dotted field path into its table segments and final key.
pub fn split_path(path: &str) -> Option<(Vec<&str>, &str)> {
    let mut segments: Vec<&str> = path.split('.').collect();
    let key = segments.pop()?;
    Some((segments, key))
}

pub fn apply_change(format: Format, text: &str, path: &str, change: &Change) -> Result<String, String> {
    let (table, key) = split_path(path).ok_or_else(|| "字段路径无效。".to_owned())?;
    match format {
        Format::Ini if table.len() == 1 => ini_patch(text, table[0], key, change),
        Format::Toml => toml_patch(text, &table, key, change),
        _ => Err("这个格式只能使用高级模式修改。".to_owned()),
    }
}

pub fn lookup(format: Format, text: &str, path: &str) -> Lookup {
    let Some((table, key)) = split_path(path) else {
        return Lookup::Absent;
    };
    match format {
        Format::Ini if table.len() == 1 => ini_lookup(text, table[0], key),
        Format::Toml => toml_lookup(text, &table, key),
        _ => Lookup::Absent,
    }
}

pub fn check_raw(format: Format, text: &str) -> Result<(), RawError> {
    match format {
        Format::Ini => ini_check(text),
        Format::Toml => toml_check(text),
        Format::Jsonc => jsonc_check(text),
        _ => Err(RawError {
            line: None,
            message: "这个格式暂不支持在应用内编辑。",
        }),
    }
}

fn jsonc_check(text: &str) -> Result<(), RawError> {
    let value = parse_json_document("JSONC", text).map_err(|_| RawError {
        line: None,
        message: "JSON 语法不正确，请检查逗号、引号和括号。",
    })?;
    if value.is_object() {
        Ok(())
    } else {
        Err(RawError {
            line: None,
            message: "顶层内容应为一个对象，即用 { } 包起来。",
        })
    }
}

/// True when any key/value pair in the file looks like a secret. Used to block
/// raw reads and to warn before a raw write.
pub fn raw_secret_present(format: Format, text: &str) -> bool {
    match format {
        Format::Ini => super::patch_ini::ini_pairs(text)
            .iter()
            .any(|(key, value)| value_looks_secret(key, value)),
        Format::Toml => super::patch_toml::toml_pairs(text)
            .iter()
            .any(|(key, value)| value_looks_secret(key, value)),
        Format::Jsonc => parse_json_document("JSONC", text)
            .map(|value| json_secret(&value))
            .unwrap_or(false),
        _ => false,
    }
}

fn json_secret(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, child)| match child {
            Value::Object(_) | Value::Array(_) => json_secret(child),
            Value::String(text) => value_looks_secret(key, text),
            other => value_looks_secret(key, &other.to_string()),
        }),
        Value::Array(items) => items.iter().any(json_secret),
        _ => false,
    }
}
