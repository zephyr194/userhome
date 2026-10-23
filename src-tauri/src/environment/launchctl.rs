//! Read-only view of the macOS login session environment: the variables set
//! with `launchctl setenv` in the `gui/<uid>` domain. Only
//! `/bin/launchctl print gui/<uid>` runs, with fixed arguments, no shell, a
//! timeout and an output cap; its output is parsed as text and never executed.
//!
//! `print` is used instead of `export` because its `environment = { ... }`
//! block lists one `KEY => value` line per variable, and that format is what
//! this parser was checked against. The `export` output format was not checked,
//! so it is not used.

use std::{
    collections::BTreeMap,
    fmt,
    path::Path,
    sync::{Mutex, PoisonError},
    time::Duration,
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::dotenv::value_looks_secret;
use crate::{
    error::AppError,
    process::{EnvPolicy, ProcessError, RunOptions, run_bounded_truncated_with, run_bounded_with},
    process_session::EnvSpec,
};

const LAUNCHCTL: &str = "/bin/launchctl";
const LAUNCHCTL_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_WRITE_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_KEY_LENGTH: usize = 256;
const MAX_SET_NAME_LENGTH: usize = 128;
const MAX_SET_VALUE_BYTES: usize = 4096;
const PROTECTED_NAMES: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "__CF_USER_TEXT_ENCODING",
    "SSH_AUTH_SOCK",
];
const PROTECTED_PREFIXES: &[&str] = &["DYLD_", "LD_", "XPC_"];
const SET_NOTE: &str = "此设置只影响之后启动的应用，注销或重启后失效。";
const UNSET_NOTE: &str = "移除只影响之后启动的应用，已经运行的应用不受影响。";
const ENVIRONMENT_HEADER: &str = "environment = {";
const ENTRY_SEPARATOR: &str = " => ";

/// Serializes the write commands so one check-then-set cannot interleave with another.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

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

/// What a set or unset would change. Holds no value; `expected_current` is a
/// SHA-256 digest of the current value (or `None` when unset) that the execute
/// step sends back so a change made in between is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPreview {
    pub key: String,
    pub current_exists: bool,
    pub current_secret: bool,
    pub expected_current: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchctlChange {
    #[serde(flatten)]
    pub environment: LaunchctlEnvironment,
    pub note: &'static str,
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

fn launchctl_options() -> RunOptions<'static> {
    RunOptions {
        env: EnvPolicy::Explicit(EnvSpec::new().set("PATH", "/usr/bin:/bin")),
        cwd: Some(Path::new("/")),
    }
}

fn read_print_output() -> Result<(String, bool), AppError> {
    // SAFETY: getuid takes no arguments and cannot fail.
    let uid = unsafe { libc::getuid() };
    let target = format!("gui/{uid}");
    run_bounded_truncated_with(
        Path::new(LAUNCHCTL),
        &["print", target.as_str()],
        LAUNCHCTL_TIMEOUT,
        MAX_OUTPUT_BYTES,
        &launchctl_options(),
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

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub fn validate_set_name(key: &str) -> Result<(), AppError> {
    let mut characters = key.chars();
    let shaped = key.len() <= MAX_SET_NAME_LENGTH
        && characters
            .next()
            .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric());
    if !shaped {
        return Err(AppError::invalid_input(
            "变量名只能由字母、数字和下划线组成，不能以数字开头，最长 128 个字符。",
        ));
    }
    let protected = PROTECTED_NAMES.contains(&key)
        || PROTECTED_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix));
    if protected {
        return Err(AppError::invalid_input(
            "这个变量由系统使用，不能在这里修改或移除。",
        ));
    }
    Ok(())
}

pub fn validate_set_value(value: &str) -> Result<(), AppError> {
    if value.len() > MAX_SET_VALUE_BYTES {
        return Err(AppError::invalid_input("值不能超过 4096 字节。"));
    }
    if value.contains('\0') {
        return Err(AppError::invalid_input("值不能包含空字符。"));
    }
    // launchctl's `--` handling is unverified, so a leading hyphen is refused rather than passed through.
    if value.starts_with('-') {
        return Err(AppError::invalid_input(
            "值不能以 - 开头，launchctl 可能把它当作选项。请换一个值。",
        ));
    }
    Ok(())
}

fn validate_expected(expected: Option<&str>) -> Result<(), AppError> {
    let well_formed = expected.is_none_or(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    });
    if well_formed {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "校验信息无效，请重新预览后再确认。",
        ))
    }
}

/// The entry for `key`, or `None` when it is unset. A partial read that did not
/// find the key cannot prove it is unset, so it is refused.
fn current_entry<'a>(
    parsed: &'a ParsedEnvironment,
    key: &str,
) -> Result<Option<&'a ParsedEntry>, AppError> {
    match parsed.entries.iter().find(|entry| entry.key == key) {
        Some(entry) => Ok(Some(entry)),
        None if parsed.partial => Err(AppError::process_failed(
            "无法完整读取登录会话的环境变量，没有修改任何内容。请重新读取后再试。",
            true,
        )),
        None => Ok(None),
    }
}

pub fn preview_from(parsed: &ParsedEnvironment, key: &str) -> Result<SetPreview, AppError> {
    let current = current_entry(parsed, key)?;
    Ok(SetPreview {
        key: key.to_owned(),
        current_exists: current.is_some(),
        current_secret: current.is_some_and(|entry| entry.secret),
        expected_current: current.map(|entry| digest(&entry.value)),
    })
}

fn check_expected(
    parsed: &ParsedEnvironment,
    key: &str,
    expected: Option<&str>,
) -> Result<(), AppError> {
    let current = current_entry(parsed, key)?.map(|entry| digest(&entry.value));
    if current.as_deref() == expected {
        Ok(())
    } else {
        Err(AppError::conflict(
            "这个变量在预览后已被修改。请重新预览，确认新的当前值后再设置。",
        ))
    }
}

fn setenv_args<'a>(key: &'a str, value: &'a str) -> [&'a str; 3] {
    ["setenv", key, value]
}

fn unsetenv_args(key: &str) -> [&str; 2] {
    ["unsetenv", key]
}

fn map_write_error(error: ProcessError) -> AppError {
    match error {
        ProcessError::Spawn => {
            AppError::not_supported("找不到 /bin/launchctl，无法修改登录会话的环境变量。")
        }
        ProcessError::Timeout => AppError::process_failed(
            "修改登录会话的环境变量超时，无法确认是否已生效。请重新读取后再试。",
            true,
        ),
        ProcessError::Io | ProcessError::OutputTooLarge => {
            AppError::process_failed("修改登录会话的环境变量时发生错误。请重新读取后再试。", true)
        }
        ProcessError::Failed { .. } => AppError::process_failed(
            "系统没有接受这次修改。请确认已登录图形会话，然后重试。",
            true,
        ),
    }
}

fn run_write(args: &[&str]) -> Result<(), AppError> {
    run_bounded_with(
        Path::new(LAUNCHCTL),
        args,
        LAUNCHCTL_TIMEOUT,
        MAX_WRITE_OUTPUT_BYTES,
        &launchctl_options(),
    )
    .map(|_| ())
    .map_err(map_write_error)
}

fn write_guard() -> std::sync::MutexGuard<'static, ()> {
    WRITE_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

fn finish_write(note: &'static str) -> Result<LaunchctlChange, AppError> {
    let environment = read_environment(OffsetDateTime::now_utc()).map_err(|_| {
        AppError::partial_failure(
            "变量已更新，但无法刷新列表。请点击“重新读取”查看最新结果。",
            true,
        )
    })?;
    Ok(LaunchctlChange { environment, note })
}

pub fn preview_set(key: &str, value: &str) -> Result<SetPreview, AppError> {
    validate_set_name(key)?;
    validate_set_value(value)?;
    let (text, cut) = read_print_output()?;
    preview_from(&parse_print_output(&text, cut), key)
}

pub fn set_value(
    key: &str,
    value: &str,
    expected: Option<&str>,
) -> Result<LaunchctlChange, AppError> {
    validate_set_name(key)?;
    validate_set_value(value)?;
    validate_expected(expected)?;
    let _guard = write_guard();
    let (text, cut) = read_print_output()?;
    check_expected(&parse_print_output(&text, cut), key, expected)?;
    run_write(&setenv_args(key, value))?;
    finish_write(SET_NOTE)
}

pub fn unset_value(key: &str, expected: Option<&str>) -> Result<LaunchctlChange, AppError> {
    validate_set_name(key)?;
    validate_expected(expected)?;
    let _guard = write_guard();
    let (text, cut) = read_print_output()?;
    check_expected(&parse_print_output(&text, cut), key, expected)?;
    run_write(&unsetenv_args(key))?;
    finish_write(UNSET_NOTE)
}

#[cfg(test)]
#[path = "launchctl_tests.rs"]
mod tests;
