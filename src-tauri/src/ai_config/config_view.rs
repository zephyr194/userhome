//! Bounded, read-only view of a tool's registered main configuration file.
//! Secret values are masked here, so no unmasked secret reaches the frontend.

use std::{fs::OpenOptions, io::Read, os::unix::fs::OpenOptionsExt, path::Path};

use serde::Serialize;

use crate::{
    app_config::{
        discover::{ConfigFs, Located, ProbeStatus, locate},
        read::{is_protected_container, is_secret_key, mask_url_credentials},
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
///
/// Two layers run on every line. `Masker` handles the first key of a line and the
/// multi-line forms; `Sweeper` then re-reads the result and masks every other secret
/// pair on the line, values inside `env`/`headers` containers and the value that
/// follows a secret command-line flag, so a secret is not left behind just because
/// it is not the first key of its line.
pub fn mask_config_text(text: &str) -> (String, u32) {
    let mut masker = Masker::default();
    let mut sweeper = Sweeper::default();
    let lines: Vec<String> = text
        .split('\n')
        .map(|line| sweeper.line(&masker.line(line)))
        .collect();
    (lines.join("\n"), masker.redacted + sweeper.redacted)
}

/// Second layer: finds every `key: value` / `key = value` pair on a line, not only the first.
#[derive(Debug, Default)]
struct Sweeper {
    redacted: u32,
    /// Bracket nesting outside strings, carried across lines.
    depth: i32,
    /// Depths opened by a secret value: every value inside is masked.
    forced: Vec<i32>,
    /// Depths opened by an `env`/`headers` object: every value inside is masked.
    protected: Vec<i32>,
    /// The previous string was a secret flag such as `--token`; the next string is its value.
    mask_next: bool,
    /// Inside a TOML `[…env]` / `[…headers]` table.
    toml_protected: bool,
    /// Indent of a YAML `env:` / `headers:` key whose nested lines are all values.
    yaml_protected: Option<usize>,
}

impl Sweeper {
    fn line(&mut self, line: &str) -> String {
        let trimmed = line.trim();
        let indent = indent_of(line);
        if let Some(level) = self.yaml_protected
            && !trimmed.is_empty()
            && indent <= level
        {
            self.yaml_protected = None;
        }
        if is_table_header(trimmed) {
            self.toml_protected = header_is_protected(trimmed);
            return line.to_owned();
        }
        let block_force = self.toml_protected || self.yaml_protected.is_some();
        let bytes = line.as_bytes();
        let mut edits: Vec<(usize, usize)> = Vec::new();
        let mut pending_force = false;
        let mut pending_protect = false;
        let mut index = 0;
        while index < bytes.len() {
            match bytes[index] {
                quote @ (b'"' | b'\'') => {
                    let Some(close) = closing_quote(&line[index + 1..], quote) else {
                        index += 1;
                        continue;
                    };
                    let end = index + 1 + close;
                    if !followed_by_separator(bytes, end + 1) {
                        self.value_string(line, index + 1, end, block_force, &mut edits);
                    }
                    index = end + 1;
                }
                b':' | b'=' if is_pair_separator(bytes, index) => {
                    let Some(key) = key_before(line, index) else {
                        index += 1;
                        continue;
                    };
                    let value_start = skip_spaces(bytes, index + 1);
                    let secret = block_force
                        || !self.forced.is_empty()
                        || !self.protected.is_empty()
                        || is_secret_key(key);
                    if secret {
                        index = self.mask_value(line, value_start, &mut edits, &mut pending_force);
                        continue;
                    }
                    if is_protected_container(key) {
                        pending_protect = bytes.get(value_start) == Some(&b'{');
                        if bytes[index] == b':' && value_start >= bytes.len() {
                            self.yaml_protected = Some(indent);
                        }
                    }
                    index += 1;
                }
                b'{' | b'[' => {
                    self.depth += 1;
                    if pending_force {
                        self.forced.push(self.depth);
                        pending_force = false;
                    }
                    if pending_protect && bytes[index] == b'{' {
                        self.protected.push(self.depth);
                        pending_protect = false;
                    }
                    index += 1;
                }
                b'}' | b']' => {
                    while self.forced.last() == Some(&self.depth) {
                        self.forced.pop();
                    }
                    while self.protected.last() == Some(&self.depth) {
                        self.protected.pop();
                    }
                    self.depth = (self.depth - 1).max(0);
                    self.mask_next = false;
                    index += 1;
                }
                b'#' if index == 0 || bytes[index - 1].is_ascii_whitespace() => break,
                _ => index += 1,
            }
        }
        apply_edits(line, &edits)
    }

    /// A string that is not a key: an array element, a value inside a masked
    /// container, or the value of a secret flag.
    fn value_string(
        &mut self,
        line: &str,
        start: usize,
        end: usize,
        block_force: bool,
        edits: &mut Vec<(usize, usize)>,
    ) {
        let inner = &line[start..end];
        if inner == SECRET_MASK {
            return;
        }
        if self.mask_next || block_force || !self.forced.is_empty() || !self.protected.is_empty() {
            self.mask_next = false;
            if !inner.is_empty() {
                edits.push((start, end));
                self.redacted += 1;
            }
            return;
        }
        if is_secret_flag(inner) {
            match inner.find('=') {
                Some(equals) if equals + 1 < inner.len() => {
                    edits.push((start + equals + 1, end));
                    self.redacted += 1;
                }
                Some(_) => {}
                None => self.mask_next = true,
            }
        }
    }

    /// Masks the value that starts at `start` and returns where scanning resumes.
    fn mask_value(
        &mut self,
        line: &str,
        start: usize,
        edits: &mut Vec<(usize, usize)>,
        pending_force: &mut bool,
    ) -> usize {
        let bytes = line.as_bytes();
        let Some(&first) = bytes.get(start) else {
            return start;
        };
        match first {
            quote @ (b'"' | b'\'') => match closing_quote(&line[start + 1..], quote) {
                Some(close) => {
                    let end = start + 1 + close;
                    let inner = &line[start + 1..end];
                    if !inner.is_empty() && inner != SECRET_MASK {
                        edits.push((start + 1, end));
                        self.redacted += 1;
                    }
                    end + 1
                }
                None => {
                    let inner = &line[start + 1..];
                    if !inner.is_empty() && inner != SECRET_MASK {
                        edits.push((start + 1, line.len()));
                        self.redacted += 1;
                    }
                    line.len()
                }
            },
            b'{' | b'[' => {
                *pending_force = true;
                self.redacted += 1;
                start
            }
            b'|' | b'>' => start + 1,
            _ => {
                let rest = &line[start..];
                let stop = rest
                    .find([',', '}', ']'])
                    .into_iter()
                    .chain(rest.find(" #"))
                    .min()
                    .unwrap_or(rest.len());
                let value = rest[..stop].trim_end();
                if !value.is_empty() && !value.starts_with(SECRET_MASK) {
                    edits.push((start, start + value.len()));
                    self.redacted += 1;
                }
                start + stop
            }
        }
    }
}

fn apply_edits(line: &str, edits: &[(usize, usize)]) -> String {
    if edits.is_empty() {
        return line.to_owned();
    }
    let mut output = String::with_capacity(line.len());
    let mut cursor = 0;
    for &(start, end) in edits {
        if start < cursor || end < start {
            continue;
        }
        output.push_str(&line[cursor..start]);
        output.push_str(SECRET_MASK);
        cursor = end;
    }
    output.push_str(&line[cursor..]);
    output
}

fn skip_spaces(bytes: &[u8], from: usize) -> usize {
    let mut index = from;
    while bytes
        .get(index)
        .is_some_and(|byte| byte.is_ascii_whitespace())
    {
        index += 1;
    }
    index
}

fn followed_by_separator(bytes: &[u8], from: usize) -> bool {
    match bytes.get(skip_spaces(bytes, from)) {
        Some(b':') => true,
        Some(b'=') => bytes.get(skip_spaces(bytes, from) + 1) != Some(&b'='),
        _ => false,
    }
}

/// `:` or `=` that separates a key from its value, not part of `://` or `==`.
fn is_pair_separator(bytes: &[u8], index: usize) -> bool {
    let next = bytes.get(index + 1);
    let previous = bytes[..index]
        .iter()
        .rev()
        .find(|byte| !byte.is_ascii_whitespace());
    match bytes[index] {
        b':' => {
            next.is_none_or(|byte| {
                byte.is_ascii_whitespace() || matches!(byte, b'"' | b'\'' | b'{' | b'[')
            }) || matches!(previous, Some(b'"' | b'\''))
        }
        _ => next != Some(&b'=') && !matches!(previous, Some(b'!' | b'<' | b'>' | b'=')),
    }
}

/// The key to the left of the separator at `separator`: a quoted string or a bare word.
fn key_before(line: &str, separator: usize) -> Option<&str> {
    let bytes = line.as_bytes();
    let mut end = separator;
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    let last = *bytes.get(end.checked_sub(1)?)?;
    if last == b'"' || last == b'\'' {
        let open = line[..end - 1].rfind(char::from(last))?;
        return Some(&line[open + 1..end - 1]);
    }
    let mut start = end;
    while start > 0 && is_key_byte(bytes[start - 1]) {
        start -= 1;
    }
    (start < end).then(|| &line[start..end])
}

fn is_key_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
}

/// A command-line flag whose next argument is a secret, e.g. `--token` or `--api-key=…`.
fn is_secret_flag(text: &str) -> bool {
    let Some(name) = text.strip_prefix('-') else {
        return false;
    };
    let name = name.trim_start_matches('-');
    let name = name.split('=').next().unwrap_or(name);
    !name.is_empty() && is_secret_key(name)
}

fn is_table_header(trimmed: &str) -> bool {
    trimmed.len() > 2
        && trimmed.starts_with('[')
        && trimmed.ends_with(']')
        && !trimmed.contains([',', '=', ':', ' '])
}

fn header_is_protected(trimmed: &str) -> bool {
    let inner = trimmed.trim_matches(['[', ']']);
    let last = inner.rsplit('.').next().unwrap_or(inner);
    is_protected_container(last.trim().trim_matches(['"', '\'']))
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
