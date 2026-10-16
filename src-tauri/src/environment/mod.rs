//! Read-only environment (dotenv) files below directory authorizations. The
//! frontend names an authorization id and a path relative to it; scanning and
//! reading go through `GrantCoordinator`, files are parsed as text and never
//! executed or sourced, and secret values only leave this module through the
//! explicit `reveal_value` call.

use std::path::Path;

use serde::Serialize;

use crate::{
    error::AppError,
    grants::{GrantCoordinator, GrantId, ReadError},
};

pub mod dotenv;
pub mod save;
pub mod scan;
pub mod zsh;
pub mod zsh_parse;

use dotenv::{DotenvEntry, DotenvLine, EntryFlag, LineKind, QuoteStyle};
use scan::{FileKind, ScanConfig, ScanError, ScanLimits, classify_name};

/// More rows than this are cut off (and reported) so one huge file cannot
/// flood the IPC channel.
const MAX_ROWS: usize = 5000;
/// Longer text is not sent with the list; values are fetched on demand.
const MAX_INLINE_CHARS: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRequest {
    pub relative_path: String,
    pub config: ScanConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RevealRequest {
    pub file: FileRequest,
    pub line: usize,
    pub key: String,
}

/// The six read failure kinds plus `Io`; never folded into an empty file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FailureKind {
    NotFound,
    PermissionDenied,
    Malformed,
    TooLarge,
    Unsupported,
    Excluded,
    Io,
}

impl From<ReadError> for FailureKind {
    fn from(error: ReadError) -> Self {
        match error {
            ReadError::NotFound => Self::NotFound,
            ReadError::PermissionDenied => Self::PermissionDenied,
            ReadError::Malformed => Self::Malformed,
            ReadError::TooLarge => Self::TooLarge,
            ReadError::Unsupported => Self::Unsupported,
            ReadError::Excluded => Self::Excluded,
            ReadError::Io => Self::Io,
        }
    }
}

impl FailureKind {
    fn message(self) -> &'static str {
        match self {
            Self::NotFound => "文件不存在或已被移动。",
            Self::PermissionDenied => "没有读取该文件的权限。",
            Self::Malformed => "文件不是有效的 UTF-8 文本，或路径不合法。",
            Self::TooLarge => "文件超过 1 MiB 的读取上限，未加载。",
            Self::Unsupported => "该位置不是普通文件，无法读取。",
            Self::Excluded => {
                "该文件不在当前授权与扫描范围内（授权已撤销、越界链接、被排除目录或不匹配 pattern）。"
            }
            Self::Io => "读取文件时发生错误，请重试。",
        }
    }

    fn app_error(self) -> AppError {
        let message = self.message();
        match self {
            Self::NotFound => AppError::not_found(message),
            Self::PermissionDenied | Self::Excluded => AppError::permission_denied(message),
            Self::Malformed | Self::TooLarge => AppError::validation_failed(message),
            Self::Unsupported => AppError::not_supported(message),
            Self::Io => AppError::process_failed(message, true),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileView {
    pub relative_path: String,
    pub kind: FileKind,
    /// SHA-256 of the bytes that were read (the version later saves compare).
    pub content_hash: String,
    pub size_bytes: u64,
    pub line_count: usize,
    pub rows: Vec<RowView>,
    pub rows_truncated: bool,
    pub entry_count: usize,
    pub secret_count: usize,
    /// Entries with a duplicate/dynamic/multi-line flag plus unknown lines.
    pub flagged_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileOutcome {
    Ready(FileView),
    Unavailable {
        reason: FailureKind,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RowView {
    #[serde(rename_all = "camelCase")]
    Blank { line: usize },
    #[serde(rename_all = "camelCase")]
    Comment {
        line: usize,
        text: Option<String>,
        withheld: bool,
    },
    #[serde(rename_all = "camelCase")]
    Unknown {
        line: usize,
        text: Option<String>,
        withheld: bool,
    },
    #[serde(rename_all = "camelCase")]
    Entry {
        line: usize,
        end_line: usize,
        key: String,
        exported: bool,
        secret: bool,
        has_value: bool,
        value_length: usize,
        /// Present only for non-secret values of reasonable length.
        value: Option<String>,
        quote: QuoteStyle,
        flags: Vec<EntryFlag>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealedValue {
    pub value: String,
}

// A revealed value may be a secret: `Debug` never prints it.
impl std::fmt::Debug for RevealedValue {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RevealedValue")
            .field("value_len", &self.value.chars().count())
            .finish()
    }
}

pub fn scan_files(
    coordinator: &GrantCoordinator,
    id: &GrantId,
    config: &ScanConfig,
    home: Option<&Path>,
) -> Result<scan::ScanOutcome, AppError> {
    Ok(scan::scan(
        coordinator,
        id,
        config,
        ScanLimits::default(),
        home,
    )?)
}

/// Reads and parses one file. A request the configuration would not list is
/// reported as excluded; read failures keep their kind. Only an invalid
/// configuration is an error.
pub fn read_file(
    coordinator: &GrantCoordinator,
    id: &GrantId,
    request: &FileRequest,
    limits: ScanLimits,
) -> Result<FileOutcome, ScanError> {
    request.config.validate()?;
    Ok(match load(coordinator, id, request, limits) {
        Ok(loaded) => FileOutcome::Ready(build_view(&request.relative_path, &loaded)),
        Err(reason) => FileOutcome::Unavailable {
            reason,
            message: reason.message().to_owned(),
        },
    })
}

/// Returns the value of the entry at `request.line` named `request.key`. The
/// file is read again, so a changed file is a conflict rather than a stale or
/// wrong value.
pub fn reveal_value(
    coordinator: &GrantCoordinator,
    id: &GrantId,
    request: &RevealRequest,
    limits: ScanLimits,
) -> Result<RevealedValue, AppError> {
    request.file.config.validate()?;
    let loaded = load(coordinator, id, &request.file, limits).map_err(FailureKind::app_error)?;
    dotenv::parse(&loaded.text)
        .lines
        .into_iter()
        .find_map(|line| match line.kind {
            LineKind::Entry(entry) if line.line == request.line && entry.key == request.key => {
                Some(RevealedValue { value: entry.value })
            }
            _ => None,
        })
        .ok_or_else(|| AppError::conflict("文件已变化或该项不存在，请重新加载后再试。"))
}

struct Loaded {
    text: String,
    content_hash: String,
    size_bytes: u64,
}

fn load(
    coordinator: &GrantCoordinator,
    id: &GrantId,
    request: &FileRequest,
    limits: ScanLimits,
) -> Result<Loaded, FailureKind> {
    if !request.config.admits(&request.relative_path, &limits) {
        return Err(FailureKind::Excluded);
    }
    let max_bytes = usize::try_from(limits.max_file_bytes).unwrap_or(usize::MAX);
    let read = coordinator.read_resource_with_limit(id, Some(&request.relative_path), max_bytes)?;
    Ok(Loaded {
        text: read.text()?.to_owned(),
        content_hash: read.fingerprint.sha256.clone(),
        size_bytes: read.fingerprint.size,
    })
}

fn build_view(relative_path: &str, loaded: &Loaded) -> FileView {
    let document = dotenv::parse(&loaded.text);
    let line_count = document.lines.last().map_or(0, |line| line.end_line);
    let (mut entry_count, mut secret_count, mut flagged_count) = (0, 0, 0);
    for line in &document.lines {
        match &line.kind {
            LineKind::Entry(entry) => {
                entry_count += 1;
                secret_count += usize::from(entry.secret);
                flagged_count += usize::from(!entry.flags.is_empty());
            }
            LineKind::Unknown => flagged_count += 1,
            _ => {}
        }
    }
    let rows_truncated = document.lines.len() > MAX_ROWS;
    let rows = document.lines.iter().take(MAX_ROWS).map(row_view).collect();
    let name = relative_path.rsplit('/').next().unwrap_or(relative_path);
    FileView {
        relative_path: relative_path.to_owned(),
        kind: classify_name(name),
        content_hash: loaded.content_hash.clone(),
        size_bytes: loaded.size_bytes,
        line_count,
        rows,
        rows_truncated,
        entry_count,
        secret_count,
        flagged_count,
    }
}

fn row_view(line: &DotenvLine) -> RowView {
    match &line.kind {
        LineKind::Blank => RowView::Blank { line: line.line },
        LineKind::Comment => {
            let (text, withheld) = visible_text(&line.raw);
            RowView::Comment {
                line: line.line,
                text,
                withheld,
            }
        }
        LineKind::Unknown => {
            let (text, withheld) = visible_text(&line.raw);
            RowView::Unknown {
                line: line.line,
                text,
                withheld,
            }
        }
        LineKind::Entry(entry) => entry_row(line, entry),
    }
}

fn entry_row(line: &DotenvLine, entry: &DotenvEntry) -> RowView {
    let value_length = entry.value.chars().count();
    let inline = !entry.secret && value_length <= MAX_INLINE_CHARS;
    RowView::Entry {
        line: line.line,
        end_line: line.end_line,
        key: entry.key.clone(),
        exported: entry.exported,
        secret: entry.secret,
        has_value: !entry.value.is_empty(),
        value_length,
        value: inline.then(|| entry.value.clone()),
        quote: entry.quote,
        flags: entry.flags.clone(),
    }
}

/// Comment and unknown-line text, unless it looks like a secret assignment.
fn visible_text(raw: &str) -> (Option<String>, bool) {
    if dotenv::looks_like_secret_assignment(raw) {
        return (None, true);
    }
    let text: String = if raw.chars().count() > MAX_INLINE_CHARS {
        raw.chars().take(MAX_INLINE_CHARS).chain(['…']).collect()
    } else {
        raw.to_owned()
    };
    (Some(text), false)
}

#[cfg(test)]
mod tests;
