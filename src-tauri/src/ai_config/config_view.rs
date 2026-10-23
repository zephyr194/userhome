//! Bounded, read-only view of a tool's registered main configuration file.
//! Secret values are masked here, so no unmasked secret reaches the frontend.

use std::{fs::OpenOptions, io::Read, os::unix::fs::OpenOptionsExt, path::Path};

use serde::Serialize;

use crate::{
    app_config::{
        discover::{ConfigFs, Located, ProbeStatus, locate},
        read::{is_secret_key, mask_url_credentials},
        registry::{Format, Registry, Sensitivity, display_path},
    },
    error::AppError,
};

use super::detect::{ConfigSource, profile_for_tool_id};

pub const MAX_CONFIG_VIEW_BYTES: usize = 256 * 1024;
pub const SECRET_MASK: &str = "••••••";

const MULTILINE_DELIMITERS: [&str; 2] = ["\"\"\"", "'''"];
const TOKEN_PREFIXES: [&str; 4] = ["bearer ", "sk-", "ghp_", "github_pat_"];
const MIN_TOKEN_LEN: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigLanguage {
    Json,
    Toml,
    Yaml,
    Markdown,
    Text,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigFileView {
    pub tool_id: String,
    pub display_path: String,
    pub exists: bool,
    pub language: ConfigLanguage,
    pub content: Option<String>,
    pub truncated: bool,
    pub size_bytes: Option<u64>,
    pub redacted_count: u32,
    pub read_at: String,
}

pub fn read_tool_config(
    tool_id: &str,
    home: &Path,
    registry: &Registry,
    fs: &dyn ConfigFs,
    read_at: String,
) -> Result<AiConfigFileView, AppError> {
    let profile = profile_for_tool_id(tool_id)
        .ok_or_else(|| AppError::invalid_input("未知的 AI 工具，无法查看配置。"))?;
    let ConfigSource::Registry(entry_id) = profile.config else {
        return Err(AppError::invalid_input(
            "该工具没有登记配置文件，无法查看。",
        ));
    };
    let entry = registry
        .get(entry_id)
        .map_err(|_| AppError::validation_failed("应用配置注册表校验失败。"))?;
    if entry.metadata_only
        || entry.sensitivity == Sensitivity::Credentials
        || matches!(entry.format, Format::Plist | Format::Dotenv)
    {
        return Err(AppError::invalid_input("该配置文件不提供内容查看。"));
    }
    let display = display_path(entry);
    let language = language_for(entry.format);
    match locate(entry, home, fs) {
        Located::Found { path, meta } => {
            let (bytes, truncated) = read_prefix(&path, MAX_CONFIG_VIEW_BYTES)?;
            let text = utf8_text(&bytes, truncated)?;
            let (content, redacted_count) = mask_config_text(text);
            Ok(AiConfigFileView {
                tool_id: tool_id.to_owned(),
                display_path: display,
                exists: true,
                language,
                content: Some(content),
                truncated,
                size_bytes: Some(meta.size),
                redacted_count,
                read_at,
            })
        }
        Located::Unavailable(ProbeStatus::NotFound) => Ok(AiConfigFileView {
            tool_id: tool_id.to_owned(),
            display_path: display,
            exists: false,
            language,
            content: None,
            truncated: false,
            size_bytes: None,
            redacted_count: 0,
            read_at,
        }),
        Located::Unavailable(_) => Err(unreadable()),
    }
}

fn language_for(format: Format) -> ConfigLanguage {
    match format {
        Format::Json | Format::Jsonc => ConfigLanguage::Json,
        Format::Toml => ConfigLanguage::Toml,
        Format::Ini | Format::Plist | Format::Dotenv | Format::Text => ConfigLanguage::Text,
    }
}

fn unreadable() -> AppError {
    AppError::validation_failed("无法读取该配置文件。")
}

fn not_utf8() -> AppError {
    AppError::validation_failed("配置文件不是 UTF-8 文本，无法安全展示。")
}

/// Reads at most `max_bytes`, reporting whether the file was longer.
fn read_prefix(path: &Path, max_bytes: usize) -> Result<(Vec<u8>, bool), AppError> {
    // O_NONBLOCK stops a FIFO swapped in after `locate` from blocking the open.
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| unreadable())?;
    if !file.metadata().map_err(|_| unreadable())?.is_file() {
        return Err(unreadable());
    }
    let mut bytes = Vec::new();
    Read::take(file, (max_bytes as u64).saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| unreadable())?;
    let truncated = bytes.len() > max_bytes;
    bytes.truncate(max_bytes);
    Ok((bytes, truncated))
}

/// A cut inside a multi-byte character is only tolerated when the file was truncated.
fn utf8_text(bytes: &[u8], truncated: bool) -> Result<&str, AppError> {
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok(text),
        Err(error) if truncated && error.error_len().is_none() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()]).map_err(|_| not_utf8())
        }
        Err(_) => Err(not_utf8()),
    }
}

/// Masks secret values line by line. The rules ignore the format, so one pass covers
/// JSON, TOML, INI and YAML-like files. Returns the masked text and the masked-value count.
pub fn mask_config_text(text: &str) -> (String, u32) {
    let mut masker = Masker::default();
    let lines: Vec<String> = text.split('\n').map(|line| masker.line(line)).collect();
    (lines.join("\n"), masker.redacted)
}

#[derive(Debug, Default)]
struct Masker {
    redacted: u32,
    block: Option<Block>,
}

#[derive(Debug, Clone, Copy)]
enum Block {
    /// Lines indented deeper than a secret key, which hold its nested value.
    Nested { key_indent: usize, counted: bool },
    /// Lines of a multi-line string, through the line holding the closing delimiter.
    Delimited(&'static str),
}

impl Masker {
    fn line(&mut self, line: &str) -> String {
        match self.block {
            Some(Block::Nested {
                key_indent,
                counted,
            }) if line.trim().is_empty() || indent_of(line) > key_indent => {
                if line.trim().is_empty() {
                    return line.to_owned();
                }
                if !counted {
                    self.redacted += 1;
                    self.block = Some(Block::Nested {
                        key_indent,
                        counted: true,
                    });
                }
                return mask_line(line);
            }
            Some(Block::Nested { .. }) => self.block = None,
            Some(Block::Delimited(delimiter)) => {
                if line.contains(delimiter) {
                    self.block = None;
                }
                return if line.trim().is_empty() {
                    line.to_owned()
                } else {
                    mask_line(line)
                };
            }
            None => {}
        }
        if is_secret_comment(line) {
            self.redacted += 1;
            return mask_line(line);
        }
        let masked = self.secret_value(line).unwrap_or_else(|| line.to_owned());
        let scrubbed = self.scrub_tokens(&masked);
        let (url_masked, changed) = mask_url_credentials(&scrubbed);
        if changed {
            self.redacted += 1;
        }
        url_masked
    }

    fn secret_value(&mut self, line: &str) -> Option<String> {
        let indent = indent_of(line);
        let body_start = indent
            + if line[indent..].starts_with("- ") {
                2
            } else {
                0
            };
        let (key, separator) = split_key(&line[body_start..])?;
        if !is_secret_key(key) {
            return None;
        }
        let value_start = body_start + separator + 1;
        let value = line[value_start..].trim_start();
        let head = &line[..line.len() - value.len()];
        let Some(&first) = value.as_bytes().first() else {
            self.block = Some(Block::Nested {
                key_indent: indent,
                counted: false,
            });
            return None;
        };
        if let Some(delimiter) = MULTILINE_DELIMITERS
            .into_iter()
            .find(|delimiter| value.starts_with(*delimiter))
        {
            self.redacted += 1;
            if value[delimiter.len()..].contains(delimiter) {
                return Some(format!("{head}{delimiter}{SECRET_MASK}{delimiter}"));
            }
            self.block = Some(Block::Delimited(delimiter));
            return Some(format!("{head}{delimiter}{SECRET_MASK}"));
        }
        if matches!(first, b'{' | b'[' | b'|' | b'>') && opens_nested(value) {
            self.redacted += 1;
            self.block = Some(Block::Nested {
                key_indent: indent,
                counted: true,
            });
            return Some(format!("{head}{SECRET_MASK}"));
        }
        if first == b'"' || first == b'\'' {
            let inner = &value[1..];
            let Some(close) = closing_quote(inner, first) else {
                self.redacted += 1;
                return Some(format!("{head}{SECRET_MASK}"));
            };
            if close == 0 {
                return None;
            }
            self.redacted += 1;
            let quote = char::from(first);
            return Some(format!(
                "{head}{quote}{SECRET_MASK}{quote}{}",
                &inner[close + 1..]
            ));
        }
        self.redacted += 1;
        Some(format!("{head}{SECRET_MASK}"))
    }

    fn scrub_tokens(&mut self, line: &str) -> String {
        let mut scrubbed = String::with_capacity(line.len());
        let mut cursor = 0;
        while let Some((keep, end)) = find_token(line, cursor) {
            scrubbed.push_str(&line[cursor..keep]);
            scrubbed.push_str(SECRET_MASK);
            cursor = end;
            self.redacted += 1;
        }
        scrubbed.push_str(&line[cursor..]);
        scrubbed
    }
}

fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

fn mask_line(line: &str) -> String {
    format!("{}{SECRET_MASK}", &line[..indent_of(line)])
}

fn is_secret_comment(line: &str) -> bool {
    let trimmed = line.trim_start();
    if !trimmed.starts_with(['#', ';', '/']) {
        return false;
    }
    let body = trimmed.trim_start_matches(['#', ';', '/']).trim_start();
    split_key(body).is_some_and(|(key, _)| is_secret_key(key))
}

/// Returns the key and the byte index of its `:` or `=` within `body`.
fn split_key(body: &str) -> Option<(&str, usize)> {
    let first = *body.as_bytes().first()?;
    if first == b'"' || first == b'\'' {
        let close = closing_quote(&body[1..], first)? + 1;
        let after = &body[close + 1..];
        let separator = close + 1 + (after.len() - after.trim_start().len());
        return matches!(body.as_bytes().get(separator), Some(b':' | b'='))
            .then_some((&body[1..close], separator));
    }
    let separator = body.find([':', '='])?;
    let key = body[..separator].trim_end();
    (!key.is_empty() && !key.contains(char::is_whitespace)).then_some((key, separator))
}

fn opens_nested(value: &str) -> bool {
    !value.trim_end_matches(',').ends_with(['}', ']'])
}

/// Index of the first unescaped `quote` in `text`; only double quotes take backslash escapes.
fn closing_quote(text: &str, quote: u8) -> Option<usize> {
    let mut escaped = false;
    for (index, byte) in text.bytes().enumerate() {
        if escaped {
            escaped = false;
        } else if byte == b'\\' && quote == b'"' {
            escaped = true;
        } else if byte == quote {
            return Some(index);
        }
    }
    None
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
}

fn is_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'~' | b'+' | b'/' | b'=')
}

/// Returns `(keep, end)`: bytes before `keep` stay visible and `keep..end` is masked.
fn find_token(line: &str, from: usize) -> Option<(usize, usize)> {
    let bytes = line.as_bytes();
    for index in from..bytes.len() {
        if index > 0 && is_word_byte(bytes[index - 1]) {
            continue;
        }
        for prefix in TOKEN_PREFIXES {
            let prefix = prefix.as_bytes();
            let Some(candidate) = bytes.get(index..index + prefix.len()) else {
                continue;
            };
            if !candidate.eq_ignore_ascii_case(prefix) {
                continue;
            }
            let value_start = index + prefix.len();
            let value_len = bytes[value_start..]
                .iter()
                .take_while(|byte| is_token_byte(**byte))
                .count();
            if value_len >= MIN_TOKEN_LEN {
                let keep = if prefix.ends_with(b" ") {
                    value_start
                } else {
                    index
                };
                return Some((keep, value_start + value_len));
            }
        }
    }
    None
}

#[cfg(test)]
#[path = "config_view_tests.rs"]
mod tests;
