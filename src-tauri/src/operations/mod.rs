mod store;

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::error::AppError;

pub use store::OperationStore;

pub const PREVIEW_TTL_MILLIS: u64 = 5 * 60 * 1_000;
pub const MAX_PROGRESS_MESSAGE_BYTES: usize = 512;
pub const MAX_RESULT_SUMMARY_BYTES: usize = 4_096;
pub const MAX_OPERATION_EVENTS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OperationKind {
    ConfigurationWrite,
    ConfigurationRestore,
    BackupClear,
    BrewInstall,
    BrewUpgrade,
    BrewUninstall,
    ServiceStart,
    ServiceStop,
    ServiceRestart,
    ElevationRegistration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationIntent {
    kind: OperationKind,
    resource_id: String,
    parameters: BTreeMap<String, String>,
}

impl OperationIntent {
    pub fn new(
        kind: OperationKind,
        resource_id: impl Into<String>,
        parameters: BTreeMap<String, String>,
    ) -> Self {
        Self {
            kind,
            resource_id: resource_id.into(),
            parameters,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationStatus {
    Previewed,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationPreview {
    pub operation_id: String,
    pub summary: String,
    pub effects: Vec<String>,
    pub requires_elevation: bool,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OperationEvent {
    Progress {
        operation_id: String,
        sequence: u64,
        message: String,
    },
    Finished {
        operation_id: String,
        sequence: u64,
        status: OperationStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        stdout_summary: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stderr_summary: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<AppError>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationDetails {
    pub operation_id: String,
    pub summary: String,
    pub effects: Vec<String>,
    pub requires_elevation: bool,
    pub expires_at: String,
    pub status: OperationStatus,
    pub events: Vec<OperationEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationSummary {
    pub operation_id: String,
    pub summary: String,
    pub status: OperationStatus,
}

pub trait Clock: Send + Sync {
    fn monotonic_millis(&self) -> u64;
    fn unix_seconds(&self) -> i64;
}

pub trait OperationIdSource: Send + Sync {
    fn next_id(&self) -> String;
}

pub struct OperationCoordinator {
    store: Mutex<OperationStore>,
}

impl Default for OperationCoordinator {
    fn default() -> Self {
        Self {
            store: Mutex::new(OperationStore::default()),
        }
    }
}

impl OperationCoordinator {
    pub(crate) fn preview(
        &self,
        intent: OperationIntent,
        summary: &str,
        effects: Vec<String>,
        requires_elevation: bool,
    ) -> Result<OperationPreview, AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.preview(intent, summary, effects, requires_elevation)
    }

    pub(crate) fn authorize_mutation(
        &self,
        operation_id: &str,
        intent: &OperationIntent,
    ) -> Result<OperationDetails, AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.authorize_mutation(operation_id, intent)
    }

    pub(crate) fn record_progress(
        &self,
        operation_id: &str,
        message: &str,
    ) -> Result<OperationEvent, AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.record_progress(operation_id, message)
    }

    pub(crate) fn finish_success(&self, operation_id: &str) -> Result<OperationEvent, AppError> {
        self.finish_success_with_output(
            operation_id,
            Some("Configuration operation completed."),
            None,
        )
    }

    pub(crate) fn finish_success_with_output(
        &self,
        operation_id: &str,
        stdout: Option<&str>,
        stderr: Option<&str>,
    ) -> Result<OperationEvent, AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.finish_success(operation_id, stdout, stderr)
    }

    pub(crate) fn finish_failure(
        &self,
        operation_id: &str,
        error: AppError,
    ) -> Result<OperationEvent, AppError> {
        self.finish_failure_with_output(operation_id, error, None, None)
    }

    pub(crate) fn finish_failure_with_output(
        &self,
        operation_id: &str,
        error: AppError,
        stdout: Option<&str>,
        stderr: Option<&str>,
    ) -> Result<OperationEvent, AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.finish_failure(operation_id, error, stdout, stderr)
    }

    pub fn list(&self) -> Result<Vec<OperationSummary>, AppError> {
        let store = self.store.lock().map_err(|_| AppError::internal())?;
        Ok(store.list())
    }

    pub fn get(&self, operation_id: &str) -> Result<OperationDetails, AppError> {
        let store = self.store.lock().map_err(|_| AppError::internal())?;
        store.get(operation_id)
    }

    pub fn cancel(&self, operation_id: &str) -> Result<OperationDetails, AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.cancel(operation_id)
    }
}

struct SystemClock {
    started_at: Instant,
}

impl Default for SystemClock {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }
}

impl Clock for SystemClock {
    fn monotonic_millis(&self) -> u64 {
        self.started_at.elapsed().as_millis() as u64
    }

    fn unix_seconds(&self) -> i64 {
        match SystemTime::now().duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_secs() as i64,
            Err(error) => -(error.duration().as_secs() as i64),
        }
    }
}

struct UuidOperationIdSource;

impl OperationIdSource for UuidOperationIdSource {
    fn next_id(&self) -> String {
        Uuid::new_v4().to_string()
    }
}

pub(crate) fn system_clock() -> Arc<dyn Clock> {
    Arc::new(SystemClock::default())
}

pub(crate) fn system_id_source() -> Arc<dyn OperationIdSource> {
    Arc::new(UuidOperationIdSource)
}

pub(crate) fn format_timestamp(unix_seconds: i64) -> Result<String, AppError> {
    let timestamp =
        OffsetDateTime::from_unix_timestamp(unix_seconds).map_err(|_| AppError::internal())?;
    timestamp.format(&Rfc3339).map_err(|_| AppError::internal())
}

pub(crate) fn sanitize_payload(value: &str, max_bytes: usize) -> String {
    truncate_utf8(
        &redact_secret_assignments(&redact_sensitive_lines(value)),
        max_bytes,
    )
}

fn redact_sensitive_lines(value: &str) -> String {
    const MARKERS: [&str; 12] = [
        "token=",
        "token:",
        "\"token\"",
        "secret=",
        "secret:",
        "\"secret\"",
        "password=",
        "password:",
        "\"password\"",
        "_auth=",
        "authorization:",
        "bearer ",
    ];

    value
        .lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if MARKERS.iter().any(|marker| lower.contains(marker)) {
                "[REDACTED]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_secret_assignments(value: &str) -> String {
    const MARKERS: [&str; 5] = ["token=", "password=", "secret=", "api_key=", "apikey="];

    let lower = value.to_ascii_lowercase();
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;

    while cursor < value.len() {
        let next_marker = MARKERS
            .iter()
            .filter_map(|marker| lower[cursor..].find(marker).map(|offset| (offset, *marker)))
            .min_by_key(|(offset, _)| *offset);

        let Some((offset, marker)) = next_marker else {
            output.push_str(&value[cursor..]);
            break;
        };

        let marker_start = cursor + offset;
        let secret_start = marker_start + marker.len();
        output.push_str(&value[cursor..secret_start]);
        output.push_str("[REDACTED]");

        let secret_end = value[secret_start..]
            .find(char::is_whitespace)
            .map_or(value.len(), |offset| secret_start + offset);
        cursor = secret_end;
    }

    output
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }

    const SUFFIX: &str = "...";
    let mut end = max_bytes.saturating_sub(SUFFIX.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }

    format!("{}{}", &value[..end], SUFFIX)
}
