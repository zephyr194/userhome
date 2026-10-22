//! Read-only view of the macOS login session environment: the variables set
//! with `launchctl setenv` in the `gui/<uid>` domain. Only
//! `/bin/launchctl print gui/<uid>` runs, with fixed arguments, no shell, a
//! timeout and an output cap; its output is parsed as text and never executed.
//!
//! `print` is used instead of `export` because its `environment = { ... }`
//! block lists one `KEY => value` line per variable, and that format is what
//! this parser was checked against. The `export` output format was not checked,
//! so it is not used.

use std::{collections::BTreeMap, fmt, path::Path, time::Duration};

use serde::Serialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::dotenv::value_looks_secret;
use crate::{
    error::AppError,
    process::{EnvPolicy, ProcessError, RunOptions, run_bounded_truncated_with},
    process_session::EnvSpec,
};

const LAUNCHCTL: &str = "/bin/launchctl";
const LAUNCHCTL_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_KEY_LENGTH: usize = 256;
const ENVIRONMENT_HEADER: &str = "environment = {";
const ENTRY_SEPARATOR: &str = " => ";

/// A value may be a secret: `Debug` shows only its length.
#[derive(Clone, PartialEq, Eq)]
pub struct ParsedEntry {
    pub key: String,
    pub value: String,
    pub secret: bool,
}

impl fmt::Debug for ParsedEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ParsedEntry")
            .field("key", &self.key)
            .field("value_len", &self.value.chars().count())
            .field("secret", &self.secret)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedEnvironment {
    /// Sorted by key.
    pub entries: Vec<ParsedEntry>,
    pub partial: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedEntry {
    pub key: String,
    /// `None` for secret entries: their values never travel with the list.
    pub value: Option<String>,
    pub secret: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchctlEnvironment {
    pub entries: Vec<ListedEntry>,
    pub read_at: String,
    pub partial: bool,
}

/// Parses the `environment` block of `launchctl print`. A line that starts a
/// new entry is `KEY => value` at the indentation of the first entry; any other
/// non-blank line continues the previous value, so a value spanning lines keeps
/// its newlines. A duplicate key keeps its last value and marks the result
/// partial. `cut` means the text was cut at the output cap: the unfinished last
/// line is dropped and the result is partial.
pub fn parse_print_output(text: &str, cut: bool) -> ParsedEnvironment {
    let text = if cut {
        text.rfind('\n').map_or("", |index| &text[..=index])
    } else {
        text
    };
    let mut partial = cut;
    let mut lines = text.lines();
    let Some(header) = lines.find(|line| line.trim() == ENVIRONMENT_HEADER) else {
        return ParsedEnvironment {
            entries: Vec::new(),
            partial,
        };
    };
    let block_indent = leading_whitespace(header);

    let mut values: BTreeMap<String, String> = BTreeMap::new();
    let mut entry_indent: Option<&str> = None;
    let mut last_key: Option<String> = None;
    let mut closed = false;
    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        if line.trim() == "}" && leading_whitespace(line) == block_indent {
            closed = true;
            break;
        }
        match split_entry(line) {
            Some((indent, key, value))
                if entry_indent.is_none_or(|expected| expected == indent) =>
            {
                entry_indent = Some(indent);
                if values.insert(key.to_owned(), value.to_owned()).is_some() {
                    partial = true;
                }
                last_key = Some(key.to_owned());
            }
            _ => match last_key.as_ref().and_then(|key| values.get_mut(key)) {
                Some(value) => {
                    value.push('\n');
                    value.push_str(line);
                }
                None => partial = true,
            },
        }
    }
    if !closed {
        partial = true;
    }

    let entries = values
        .into_iter()
        .map(|(key, value)| {
            let secret = value_looks_secret(&key, &value);
            ParsedEntry { key, value, secret }
        })
        .collect();
    ParsedEnvironment { entries, partial }
}

fn leading_whitespace(line: &str) -> &str {
    &line[..line.len() - line.trim_start().len()]
}

fn split_entry(line: &str) -> Option<(&str, &str, &str)> {
    let indent = leading_whitespace(line);
    let (key, value) = line[indent.len()..].split_once(ENTRY_SEPARATOR)?;
    let key_is_name = !key.is_empty()
        && key
            .chars()
            .all(|character| !character.is_whitespace() && !character.is_control());
    key_is_name.then_some((indent, key, value))
}

pub fn listing(
    parsed: &ParsedEnvironment,
    read_at: OffsetDateTime,
) -> Result<LaunchctlEnvironment, AppError> {
    let read_at = read_at.format(&Rfc3339).map_err(|_| AppError::internal())?;
    let entries = parsed
        .entries
        .iter()
        .map(|entry| ListedEntry {
            key: entry.key.clone(),
            value: (!entry.secret).then(|| entry.value.clone()),
            secret: entry.secret,
        })
        .collect();
    Ok(LaunchctlEnvironment {
        entries,
        read_at,
        partial: parsed.partial,
    })
}

pub fn validate_key(key: &str) -> Result<(), AppError> {
    let valid = !key.is_empty()
        && key.len() <= MAX_KEY_LENGTH
        && !key
            .chars()
            .any(|character| matches!(character, '\0' | '\n' | '\r' | '='));
    if valid {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "环境变量名无效：名称不能为空，不能超过 256 字节，也不能包含空字符、换行或等号。",
        ))
    }
}

pub fn reveal_from(parsed: &ParsedEnvironment, key: &str) -> Result<String, AppError> {
    parsed
        .entries
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| entry.value.clone())
        .ok_or_else(|| AppError::not_found("登录会话里没有这个环境变量。请刷新列表后再试。"))
}

fn read_print_output() -> Result<(String, bool), AppError> {
    // SAFETY: getuid takes no arguments and cannot fail.
    let uid = unsafe { libc::getuid() };
    let target = format!("gui/{uid}");
    let options = RunOptions {
        env: EnvPolicy::Explicit(EnvSpec::new().set("PATH", "/usr/bin:/bin")),
        cwd: Some(Path::new("/")),
    };
    run_bounded_truncated_with(
        Path::new(LAUNCHCTL),
        &["print", target.as_str()],
        LAUNCHCTL_TIMEOUT,
        MAX_OUTPUT_BYTES,
        &options,
    )
    .map(|(output, cut)| (output.stdout, cut))
    .map_err(map_process_error)
}

fn map_process_error(error: ProcessError) -> AppError {
    match error {
        ProcessError::Spawn => {
            AppError::not_supported("找不到 /bin/launchctl，无法读取登录会话的环境变量。")
        }
        ProcessError::Timeout => {
            AppError::process_failed("读取登录会话的环境变量超时，请稍后重试。", true)
        }
        ProcessError::Io | ProcessError::OutputTooLarge => {
            AppError::process_failed("读取登录会话的环境变量时发生错误，请重试。", true)
        }
        ProcessError::Failed { .. } => AppError::process_failed(
            "系统没有返回登录会话的环境变量。请确认已登录图形会话，然后重试。",
            true,
        ),
    }
}

pub fn read_environment(now: OffsetDateTime) -> Result<LaunchctlEnvironment, AppError> {
    let (text, cut) = read_print_output()?;
    listing(&parse_print_output(&text, cut), now)
}

pub fn reveal_value(key: &str) -> Result<String, AppError> {
    validate_key(key)?;
    let (text, cut) = read_print_output()?;
    reveal_from(&parse_print_output(&text, cut), key)
}

#[cfg(test)]
#[path = "launchctl_tests.rs"]
mod tests;
