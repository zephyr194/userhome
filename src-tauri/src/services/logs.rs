//! Read-only views of a launchd job's own log files.
//!
//! The path comes from the job's plist as rediscovered here, never from the
//! caller. A read needs a file grant for exactly that path, and a grant whose
//! path no longer matches the plist is refused. Every read is bounded. A
//! rotated, truncated or missing file is reported as such, never as an empty log.

use std::{
    collections::BTreeMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    grants::{
        DEFAULT_MAX_READ_BYTES, GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose,
        GrantRecord, GrantedRange, RangeStart, ReadError,
    },
    services::launchd::{Discovery, Label, LaunchdDomain, discover},
};

pub const DEFAULT_TAIL_BYTES: usize = 256 * 1024;
pub const MAX_TAIL_BYTES: usize = 1024 * 1024;
pub const MAX_SINCE_BYTES: usize = 256 * 1024;
pub const MAX_EXPORT_BYTES: usize = DEFAULT_MAX_READ_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogTarget {
    pub domain: LaunchdDomain,
    pub label: String,
    pub stream: LogStream,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogTailRequest {
    pub target: LogTarget,
    pub grant_id: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogSinceRequest {
    pub target: LogTarget,
    pub grant_id: String,
    pub offset: u64,
    pub device: u64,
    pub inode: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogRevokeRequest {
    pub grant_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogExportRequest {
    pub target: LogTarget,
    pub grant_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogExportConfirm {
    pub operation_id: String,
    pub grant_id: String,
}

/// What the frontend may show about an authorization. Never the path itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogGrantSummary {
    pub grant_id: String,
    pub display_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LogState {
    Content,
    /// The declared file does not exist (yet, or any more).
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LogReset {
    /// The path now names a different file (rotated or replaced).
    Replaced,
    /// The same file is shorter than the position already read.
    Truncated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogIdentity {
    pub device: u64,
    pub inode: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSnapshot {
    pub state: LogState,
    pub text: String,
    /// Bytes of the file before `text` that were not read (a tail or a backlog
    /// beyond the limit).
    pub skipped_bytes: u64,
    /// The first partial line of a read that began mid-line was dropped.
    pub head_trimmed: bool,
    /// Some bytes were not valid UTF-8 and were shown as replacement characters.
    pub lossy: bool,
    pub reset: Option<LogReset>,
    /// Where the next incremental read continues.
    pub next_offset: u64,
    pub file_size: u64,
    pub identity: Option<LogIdentity>,
}

impl LogSnapshot {
    fn missing() -> Self {
        Self {
            state: LogState::Missing,
            text: String::new(),
            skipped_bytes: 0,
            head_trimmed: false,
            lossy: false,
            reset: None,
            next_offset: 0,
            file_size: 0,
            identity: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogError {
    InvalidLabel,
    NotFound,
    /// More than one definition matches the domain and label.
    Ambiguous,
    /// No plist, or the plist declares no file for this stream.
    NoFileLog,
    /// The declared path is not absolute, so it cannot be read.
    Relative,
    /// The declared file does not exist, so there is nothing to authorize.
    Missing,
    /// The declared path now names something other than the authorized file.
    Changed,
    /// No usable authorization for this log.
    NotAuthorized,
    /// The chosen file is not the file the plist declares.
    Mismatch,
    Busy,
    Read(ReadError),
    Grant(GrantError),
}

impl From<LogError> for AppError {
    fn from(error: LogError) -> Self {
        match error {
            LogError::InvalidLabel => AppError::invalid_input("Service label is not valid."),
            LogError::NotFound => AppError::not_found("launchd service was not found."),
            LogError::Ambiguous => AppError::conflict(
                "The label has more than one definition; the log path is unclear.",
            ),
            LogError::NoFileLog => {
                AppError::not_supported("无可用文件日志：该任务没有声明此输出路径。")
            }
            LogError::Relative => AppError::not_supported(
                "The declared log path is not absolute, so it cannot be read.",
            ),
            LogError::Missing => AppError::not_found(
                "The declared log file does not exist yet, so it cannot be authorized.",
            ),
            LogError::Changed => AppError::conflict(
                "The log path declared by the plist changed since it was authorized. Authorize it again.",
            ),
            LogError::NotAuthorized => AppError::permission_denied(
                "Log access is not authorized or was revoked. Authorize the log again.",
            ),
            LogError::Mismatch => AppError::validation_failed(
                "The chosen file is not the log path declared by this job's plist. The request was refused.",
            ),
            LogError::Busy => {
                AppError::conflict("launchd discovery is already running. Retry when it finishes.")
            }
            LogError::Read(ReadError::PermissionDenied) => {
                AppError::permission_denied("The log file cannot be read: permission denied.")
            }
            LogError::Read(ReadError::Excluded) => AppError::permission_denied(
                "The log file is no longer inside the authorized area (a link or the path changed).",
            ),
            LogError::Read(ReadError::Unsupported) => AppError::not_supported(
                "The log path is not a regular file (it may be a directory, FIFO or device).",
            ),
            LogError::Read(ReadError::Malformed) => {
                AppError::validation_failed("The log authorization could not be read.")
            }
            LogError::Read(ReadError::TooLarge) => {
                AppError::validation_failed("The log read exceeded its limit.")
            }
            LogError::Read(ReadError::NotFound) => {
                AppError::not_found("The log file was not found.")
            }
            LogError::Read(ReadError::Io) => {
                AppError::process_failed("Reading the log failed. Try again.", true)
            }
            LogError::Grant(error) => AppError::from(error),
        }
    }
}

/// The declared path of one stream, from the job's own plist rediscovered now.
/// Only a job with exactly one definition has a path; anything else is refused.
fn declared_log(ctx: &Discovery<'_>, target: &LogTarget) -> Result<PathBuf, LogError> {
    Label::parse(&target.label).map_err(|_| LogError::InvalidLabel)?;
    let discovery = discover(ctx);
    let matches: Vec<_> = discovery
        .services
        .iter()
        .filter(|service| service.domain == target.domain && service.label == target.label)
        .collect();
    let service = match matches.as_slice() {
        [] => return Err(LogError::NotFound),
        [service] => *service,
        _ => return Err(LogError::Ambiguous),
    };
    let file = match service.config_files.as_slice() {
        [] => return Err(LogError::NoFileLog),
        [file] => file,
        _ => return Err(LogError::Ambiguous),
    };
    let details = file.details.as_ref().ok_or(LogError::NoFileLog)?;
    let declared = match target.stream {
        LogStream::Stdout => details.declared_standard_out.as_deref(),
        LogStream::Stderr => details.declared_standard_error.as_deref(),
    }
    .ok_or(LogError::NoFileLog)?;
    let path = Path::new(declared);
    if !path.is_absolute() {
        return Err(LogError::Relative);
    }
    Ok(path.to_path_buf())
}

/// `Ok(None)` when the path does not exist. Other failures keep their kind.
fn canonical_or_missing(path: &Path) -> Result<Option<PathBuf>, LogError> {
    match fs::canonicalize(path) {
        Ok(canonical) => Ok(Some(canonical)),
        Err(error) => match error.kind() {
            ErrorKind::NotFound | ErrorKind::NotADirectory => Ok(None),
            ErrorKind::PermissionDenied => Err(LogError::Read(ReadError::PermissionDenied)),
            _ => Err(LogError::Read(ReadError::Io)),
        },
    }
}

/// The canonical file the plist declares for `target`; the only file a
/// selection may authorize.
pub fn expected_log_path(ctx: &Discovery<'_>, target: &LogTarget) -> Result<PathBuf, LogError> {
    let declared = declared_log(ctx, target)?;
    canonical_or_missing(&declared)?.ok_or(LogError::Missing)
}

/// Compares the file the user picked with the declared one, both canonical.
pub fn check_selection(expected: &Path, picked: &Path) -> Result<PathBuf, LogError> {
    let canonical = canonical_or_missing(picked)?.ok_or(LogError::Read(ReadError::NotFound))?;
    if canonical.as_path() != expected {
        return Err(LogError::Mismatch);
    }
    Ok(canonical)
}

pub fn grant_summary(record: &GrantRecord, home: Option<&Path>) -> LogGrantSummary {
    let summary = record.summary(home);
    LogGrantSummary {
        grant_id: summary.id.as_str().to_owned(),
        display_path: summary.display_path,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogExportPreview {
    pub operation_id: String,
    pub expires_at: String,
    /// The chosen file already exists and would be replaced (with a backup).
    pub replaces: bool,
    pub save: LogGrantSummary,
}

/// Authorization registry: at most one live log grant per job and stream, so
/// reselecting replaces the previous grant instead of accumulating them.
#[derive(Default)]
pub struct LogSessions(Mutex<BTreeMap<String, String>>);

fn target_key(target: &LogTarget) -> String {
    format!("{:?}/{}/{:?}", target.domain, target.label, target.stream)
}

impl LogSessions {
    fn entries(&self) -> std::sync::MutexGuard<'_, BTreeMap<String, String>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn grant_for(&self, key: &str) -> Option<String> {
        self.entries().get(key).cloned()
    }

    fn holds(&self, grant_id: &str) -> bool {
        self.entries().values().any(|id| id == grant_id)
    }

    fn insert(&self, key: String, grant_id: String) {
        self.entries().insert(key, grant_id);
    }

    fn forget(&self, grant_id: &str) {
        self.entries().retain(|_, id| id != grant_id);
    }

    fn all(&self) -> Vec<String> {
        self.entries().values().cloned().collect()
    }
}

fn revoke_grant(grants: &GrantCoordinator, grant_id: &str) -> Result<(), LogError> {
    let id = GrantId::parse(grant_id).map_err(LogError::Grant)?;
    match grants.revoke(&id) {
        Ok(()) | Err(GrantError::UnknownGrant) => Ok(()),
        Err(error) => Err(LogError::Grant(error)),
    }
}

/// Grants read access to exactly the checked file, replacing any earlier
/// authorization for the same job and stream.
pub fn authorize(
    grants: &GrantCoordinator,
    sessions: &LogSessions,
    target: &LogTarget,
    canonical: &Path,
) -> Result<GrantRecord, LogError> {
    let key = target_key(target);
    if let Some(previous) = sessions.grant_for(&key) {
        revoke_grant(grants, &previous)?;
        sessions.forget(&previous);
    }
    let record = grants
        .create(GrantPurpose::ConfigFile, canonical)
        .map_err(LogError::Grant)?;
    sessions.insert(key, record.id.as_str().to_owned());
    Ok(record)
}

/// Revokes a grant this registry issued. A grant it does not hold is not
/// touched, so a stray id from the frontend cannot revoke anything else.
pub fn revoke(
    grants: &GrantCoordinator,
    sessions: &LogSessions,
    grant_id: &str,
) -> Result<(), LogError> {
    if !sessions.holds(grant_id) {
        return Ok(());
    }
    revoke_grant(grants, grant_id)?;
    sessions.forget(grant_id);
    Ok(())
}

/// Best effort at application exit: every log grant this run issued is revoked.
pub fn revoke_all(grants: &GrantCoordinator, sessions: &LogSessions) {
    for grant_id in sessions.all() {
        let _ = revoke(grants, sessions, &grant_id);
        sessions.forget(&grant_id);
    }
}

/// Tail reads for the viewer, bounded by `max_bytes` (clamped to the tail limit).
pub fn read_tail(
    ctx: &Discovery<'_>,
    grants: &GrantCoordinator,
    request: &LogTailRequest,
) -> Result<LogSnapshot, LogError> {
    let max = request
        .max_bytes
        .unwrap_or(DEFAULT_TAIL_BYTES)
        .clamp(1, MAX_TAIL_BYTES);
    read_snapshot(
        ctx,
        grants,
        &request.target,
        &request.grant_id,
        Start::Tail(max),
    )
}

/// Incremental reads after a known position, with the identity seen before.
pub fn read_since(
    ctx: &Discovery<'_>,
    grants: &GrantCoordinator,
    request: &LogSinceRequest,
) -> Result<LogSnapshot, LogError> {
    read_snapshot(
        ctx,
        grants,
        &request.target,
        &request.grant_id,
        Start::Since {
            offset: request.offset,
            identity: LogIdentity {
                device: request.device,
                inode: request.inode,
            },
        },
    )
}

/// The text an export writes: the newest bytes the authorization can read,
/// up to the export limit.
pub fn export_text(
    ctx: &Discovery<'_>,
    grants: &GrantCoordinator,
    target: &LogTarget,
    grant_id: &str,
) -> Result<String, LogError> {
    let snapshot = read_snapshot(ctx, grants, target, grant_id, Start::Tail(MAX_EXPORT_BYTES))?;
    match snapshot.state {
        LogState::Content => Ok(snapshot.text),
        LogState::Missing => Err(LogError::Missing),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Start {
    Tail(usize),
    Since { offset: u64, identity: LogIdentity },
}

fn read_snapshot(
    ctx: &Discovery<'_>,
    grants: &GrantCoordinator,
    target: &LogTarget,
    grant_id: &str,
    start: Start,
) -> Result<LogSnapshot, LogError> {
    let grant_id = GrantId::parse(grant_id).map_err(|_| LogError::NotAuthorized)?;
    let declared = declared_log(ctx, target)?;
    let current = canonical_or_missing(&declared)?;
    let record = grants
        .resolve(&grant_id)
        .map_err(|_| LogError::NotAuthorized)?;
    if record.kind != GrantKind::File || record.purpose != GrantPurpose::ConfigFile {
        return Err(LogError::NotAuthorized);
    }
    let Some(current) = current else {
        return Ok(LogSnapshot::missing());
    };
    if current != record.target_path() {
        return Err(LogError::Changed);
    }
    let Some(read) = read_range(grants, &grant_id, start)? else {
        return Ok(LogSnapshot::missing());
    };
    Ok(decode(read))
}

struct Read {
    range: GrantedRange,
    reset: Option<LogReset>,
    /// Whether the range is the tail of the file, rather than a continuation.
    tail: bool,
}

/// Reads the range for `start`. A file that changed identity or shrank below
/// the position already read is re-read from its tail, and the reset is named.
fn read_range(
    grants: &GrantCoordinator,
    grant_id: &GrantId,
    start: Start,
) -> Result<Option<Read>, LogError> {
    match start {
        Start::Tail(max) => Ok(
            fetch(grants, grant_id, RangeStart::Tail, max)?.map(|range| Read {
                range,
                reset: None,
                tail: true,
            }),
        ),
        Start::Since { offset, identity } => {
            let Some(range) = fetch(grants, grant_id, RangeStart::Since(offset), MAX_SINCE_BYTES)?
            else {
                return Ok(None);
            };
            let reset = if range.device != identity.device || range.inode != identity.inode {
                Some(LogReset::Replaced)
            } else if range.file_size < offset {
                Some(LogReset::Truncated)
            } else {
                None
            };
            match reset {
                None => Ok(Some(Read {
                    range,
                    reset: None,
                    tail: false,
                })),
                Some(reset) => Ok(
                    fetch(grants, grant_id, RangeStart::Tail, DEFAULT_TAIL_BYTES)?.map(|range| {
                        Read {
                            range,
                            reset: Some(reset),
                            tail: true,
                        }
                    }),
                ),
            }
        }
    }
}

fn fetch(
    grants: &GrantCoordinator,
    grant_id: &GrantId,
    start: RangeStart,
    max: usize,
) -> Result<Option<GrantedRange>, LogError> {
    match grants.read_resource_range(grant_id, start, max) {
        Ok(range) => Ok(Some(range)),
        Err(ReadError::NotFound) => Ok(None),
        Err(error) => Err(LogError::Read(error)),
    }
}

fn decode(read: Read) -> LogSnapshot {
    let Read { range, reset, tail } = read;
    let trim = range.start > 0 && (tail || range.skipped > 0);
    let (lead, body) = if trim {
        drop_partial_head(&range.content)
    } else {
        (0, range.content.as_slice())
    };
    let (text, consumed, lossy) = decode_complete(body);
    LogSnapshot {
        state: LogState::Content,
        text,
        skipped_bytes: if tail { range.start } else { range.skipped },
        head_trimmed: trim,
        lossy,
        reset,
        next_offset: range.start + (lead + consumed) as u64,
        file_size: range.file_size,
        identity: Some(LogIdentity {
            device: range.device,
            inode: range.inode,
        }),
    }
}

/// Drops everything up to and including the first line break, since a read
/// that begins mid-line would otherwise show a fragment. Returns the bytes
/// removed and the rest.
fn drop_partial_head(bytes: &[u8]) -> (usize, &[u8]) {
    match bytes.iter().position(|byte| *byte == b'\n') {
        Some(index) => (index + 1, &bytes[index + 1..]),
        None => (bytes.len(), &bytes[bytes.len()..]),
    }
}

/// Decodes the complete UTF-8 prefix. An incomplete sequence at the end is
/// left unconsumed so the next read completes it. Invalid bytes are replaced
/// and the result is marked lossy.
fn decode_complete(bytes: &[u8]) -> (String, usize, bool) {
    match std::str::from_utf8(bytes) {
        Ok(text) => (text.to_owned(), bytes.len(), false),
        Err(error) if error.error_len().is_none() => {
            let complete = error.valid_up_to();
            (
                String::from_utf8_lossy(&bytes[..complete]).into_owned(),
                complete,
                false,
            )
        }
        Err(_) => (
            String::from_utf8_lossy(bytes).into_owned(),
            bytes.len(),
            true,
        ),
    }
}

#[cfg(test)]
#[path = "logs_tests.rs"]
mod tests;
