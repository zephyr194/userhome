//! Bounded, read-only views of registered configuration files. Content is parsed
//! and masked here before anything leaves this module. Credentials and
//! metadata-only entries are never opened for reading.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::{config::formats::parse_json_document, grants::DEFAULT_MAX_READ_BYTES};

use super::{
    discover::{ConfigFs, FileMeta, FsError, Located, ProbeStatus, locate},
    registry::{Capability, Entry, Format, Sensitivity},
};

pub const REDACTED: &str = "[REDACTED]";

const SECRET_KEY_FRAGMENTS: [&str; 7] = [
    "token",
    "password",
    "passwd",
    "secret",
    "credential",
    "key",
    "auth",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseWarning {
    pub line: usize,
    pub message: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentView {
    /// Masked rendering. Comments and unrecognized lines are withheld.
    pub text: String,
    pub redacted: bool,
    pub withheld_lines: usize,
    pub warnings: Vec<ParseWarning>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadFailure {
    TooLarge,
    ParseError,
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum ReadResult {
    Content { view: ContentView },
    MetadataOnly { meta: FileMeta },
    Unavailable { status: ProbeStatus },
    Failed { kind: ReadFailure },
}

/// Reads a registered entry. Only a `ReadOnly` or `Writable`, non-credential,
/// non-metadata entry whose format this module parses has its content read;
/// everything else returns its discovered metadata, or the probe status when
/// not found.
pub fn read_entry(entry: &Entry, home: &Path, fs: &dyn ConfigFs) -> ReadResult {
    let (path, meta) = match locate(entry, home, fs) {
        Located::Found { path, meta } => (path, meta),
        Located::Unavailable(status) => return ReadResult::Unavailable { status },
    };
    if entry.capability == Capability::DiscoverOnly
        || entry.sensitivity == Sensitivity::Credentials
        || entry.metadata_only
        || matches!(entry.format, Format::Plist | Format::Dotenv)
    {
        return ReadResult::MetadataOnly { meta };
    }
    if meta.size > DEFAULT_MAX_READ_BYTES as u64 {
        return ReadResult::Failed {
            kind: ReadFailure::TooLarge,
        };
    }
    match fs.read_bounded(&path, DEFAULT_MAX_READ_BYTES) {
        Ok(bytes) => render(entry.format, &bytes),
        Err(FsError::TooLarge) => ReadResult::Failed {
            kind: ReadFailure::TooLarge,
        },
        Err(FsError::NotFound) => ReadResult::Unavailable {
            status: ProbeStatus::NotFound,
        },
        Err(FsError::PermissionDenied) => ReadResult::Unavailable {
            status: ProbeStatus::Inaccessible,
        },
        Err(FsError::Other) => ReadResult::Failed {
            kind: ReadFailure::Unreadable,
        },
    }
}

fn render(format: Format, bytes: &[u8]) -> ReadResult {
    let Ok(content) = std::str::from_utf8(bytes) else {
        return ReadResult::Failed {
            kind: ReadFailure::ParseError,
        };
    };
    match format {
        Format::Json => render_json("JSON", content),
        Format::Jsonc => render_json("JSONC", content),
        Format::Ini | Format::Toml | Format::Text => render_keyed_lines(format, content),
        Format::Plist | Format::Dotenv => ReadResult::Failed {
            kind: ReadFailure::Unreadable,
        },
    }
}

fn render_json(family: &str, content: &str) -> ReadResult {
    let Ok(value) = parse_json_document(family, content) else {
        return ReadResult::Failed {
            kind: ReadFailure::ParseError,
        };
    };
    let (masked, redacted) = mask_json(&value, false, false);
    let Ok(pretty) = serde_json::to_string_pretty(&masked) else {
        return ReadResult::Failed {
            kind: ReadFailure::Unreadable,
        };
    };
    ReadResult::Content {
        view: ContentView {
            text: format!("{pretty}\n"),
            redacted,
            withheld_lines: 0,
            warnings: Vec::new(),
        },
    }
}

fn render_keyed_lines(format: Format, content: &str) -> ReadResult {
    let mut output = Vec::new();
    let mut warnings = Vec::new();
    let mut withheld_lines = 0;
    let mut redacted = false;
    for (index, raw) in content.lines().enumerate() {
        let line_number = index + 1;
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with(['#', ';']) {
            withheld_lines += 1;
            continue;
        }
        if matches!(format, Format::Ini | Format::Toml) && line.starts_with('[') {
            if line.ends_with(']') {
                let (shown, changed) = mask_url_credentials(line);
                redacted |= changed;
                output.push(shown);
            } else {
                withheld_lines += 1;
                warnings.push(ParseWarning {
                    line: line_number,
                    message: "段落标题不完整，内容未显示",
                });
            }
            continue;
        }
        let Some((key, value)) = split_pair(line, format) else {
            withheld_lines += 1;
            warnings.push(ParseWarning {
                line: line_number,
                message: "无法识别的行，内容未显示",
            });
            continue;
        };
        let value = strip_inline_comment(value);
        let (shown, changed) = mask_assignment(format, key, value);
        redacted |= changed;
        output.push(match format {
            Format::Text if shown.is_empty() => key.to_owned(),
            Format::Text => format!("{key} {shown}"),
            _ => format!("{key} = {shown}"),
        });
    }
    let text = if output.is_empty() {
        String::new()
    } else {
        format!("{}\n", output.join("\n"))
    };
    ReadResult::Content {
        view: ContentView {
            text,
            redacted,
            withheld_lines,
            warnings,
        },
    }
}

fn split_pair(line: &str, format: Format) -> Option<(&str, &str)> {
    match format {
        Format::Ini | Format::Toml => {
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            (!key.is_empty()).then_some((key, value.trim()))
        }
        _ => {
            let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
            let key = &line[..split];
            let rest = line[split..].trim_start();
            let value = rest.strip_prefix('=').unwrap_or(rest).trim();
            (!key.is_empty()).then_some((key, value))
        }
    }
}

fn mask_assignment(format: Format, key: &str, value: &str) -> (String, bool) {
    if is_secret_key(key) {
        return (REDACTED.to_owned(), !value.is_empty());
    }
    if format == Format::Toml && (value.starts_with('{') || value.starts_with('[')) {
        let names_secret = value
            .split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')))
            .any(|token| !token.is_empty() && is_secret_key(token));
        if names_secret {
            return (REDACTED.to_owned(), true);
        }
    }
    mask_url_credentials(value)
}

/// Drops a trailing `#` or `;` comment that is outside double quotes. The
/// comment text is never shown, so a secret written in it cannot leak.
fn strip_inline_comment(value: &str) -> &str {
    let mut in_quotes = false;
    let mut escaped = false;
    for (index, c) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' if in_quotes => escaped = true,
            '"' => in_quotes = !in_quotes,
            '#' | ';' if !in_quotes => return value[..index].trim_end(),
            _ => {}
        }
    }
    value
}

/// Secret-key heuristic shared by every format. It matches the normalized key
/// (alphanumerics only, lowercase), so `api-key`, `API_KEY` and `apiKey` agree.
/// Deliberately broad: a false positive hides a value, a false negative leaks it.
pub fn is_secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    SECRET_KEY_FRAGMENTS
        .iter()
        .any(|fragment| normalized.contains(fragment))
}

fn is_protected_container(key: &str) -> bool {
    matches!(key.to_ascii_lowercase().as_str(), "env" | "headers")
}

/// Masks a JSON document. A secret key replaces its whole value. Every value
/// inside an `env` or `headers` container is secret, whatever its key.
fn mask_json(value: &Value, secret: bool, secret_children: bool) -> (Value, bool) {
    if secret {
        return (Value::String(REDACTED.to_owned()), true);
    }
    match value {
        Value::Object(map) => {
            let mut redacted = false;
            let masked: serde_json::Map<String, Value> = map
                .iter()
                .map(|(key, child)| {
                    let (child_value, changed) = mask_json(
                        child,
                        secret_children || is_secret_key(key),
                        is_protected_container(key),
                    );
                    redacted |= changed;
                    (key.clone(), child_value)
                })
                .collect();
            (Value::Object(masked), redacted)
        }
        Value::Array(items) => {
            let mut redacted = false;
            let masked = items
                .iter()
                .map(|item| {
                    let (item_value, changed) = mask_json(item, false, false);
                    redacted |= changed;
                    item_value
                })
                .collect();
            (Value::Array(masked), redacted)
        }
        Value::String(text) => {
            let (masked, changed) = mask_url_credentials(text);
            (Value::String(masked), changed)
        }
        other => (other.clone(), false),
    }
}

/// Replaces the password in every `scheme://user:password@host` authority.
pub fn mask_url_credentials(text: &str) -> (String, bool) {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    let mut redacted = false;
    while let Some(index) = rest.find("://") {
        let (head, tail) = rest.split_at(index + 3);
        output.push_str(head);
        let end = tail
            .find(|c: char| c == '/' || c.is_whitespace() || c == '"' || c == '\'')
            .unwrap_or(tail.len());
        let (authority, after) = tail.split_at(end);
        match authority.rfind('@') {
            Some(at) if authority[..at].contains(':') => {
                let colon = authority[..at].find(':').unwrap_or(0);
                output.push_str(&authority[..=colon]);
                output.push_str(REDACTED);
                output.push_str(&authority[at..]);
                redacted = true;
            }
            _ => output.push_str(authority),
        }
        rest = after;
    }
    output.push_str(rest);
    (output, redacted)
}
