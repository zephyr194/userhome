mod store;

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::{
    error::{AppError, AppErrorCode},
    process_session::{ProcessSession, StopOutcome},
};

pub use store::{CancelStep, OperationStore};

pub const PREVIEW_TTL_MILLIS: u64 = 5 * 60 * 1_000;
pub const MAX_PROGRESS_MESSAGE_BYTES: usize = 512;
pub const MAX_RESULT_SUMMARY_BYTES: usize = 4_096;
pub const MAX_OPERATION_EVENTS: usize = 128;
/// Default number of operation records kept; the oldest are dropped beyond it.
pub const DEFAULT_MAX_OPERATION_RECORDS: usize = 200;
/// Known sensitive values shorter than this are not registered, because masking
/// every occurrence of a tiny string would mangle unrelated text.
pub const MIN_SENSITIVE_VALUE_BYTES: usize = 4;
/// SIGTERM grace before escalating to SIGKILL when cancelling an own process.
pub const CANCEL_GRACE: Duration = Duration::from_secs(5);
/// Extra wait for the exit after SIGKILL before the exit counts as unconfirmed.
pub const CANCEL_KILL_TIMEOUT: Duration = Duration::from_secs(2);

const REDACTED: &str = "[REDACTED]";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OperationKind {
    ConfigurationWrite,
    ConfigurationRestore,
    ResourceWrite,
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
    /// Older events of this operation dropped to stay within the event bound.
    #[serde(skip_serializing_if = "is_zero")]
    pub dropped_events: u64,
    /// Operation records dropped from the whole history to stay within its bound
    /// (history-wide, as of this read).
    #[serde(skip_serializing_if = "is_zero")]
    pub dropped_records: u64,
}

fn is_zero(value: &u64) -> bool {
    *value == 0
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

/// An own process an operation can be cancelled through.
///
/// `stop` must report [`StopOutcome::Terminated`] or
/// [`StopOutcome::AlreadyExited`] only when the exit was actually confirmed.
pub trait StoppableProcess: Send + Sync {
    fn stop(&self, grace: Duration, kill_timeout: Duration) -> StopOutcome;

    /// Bounded `(stdout, stderr)` text captured so far; it is redacted before it
    /// reaches an event.
    fn output(&self) -> (String, String) {
        (String::new(), String::new())
    }
}

impl StoppableProcess for ProcessSession {
    fn stop(&self, grace: Duration, kill_timeout: Duration) -> StopOutcome {
        ProcessSession::stop(self, grace, kill_timeout)
    }

    fn output(&self) -> (String, String) {
        (self.stdout().text(), self.stderr().text())
    }
}

pub struct OperationCoordinator {
    store: Mutex<OperationStore>,
    stop_grace: Duration,
    stop_kill_timeout: Duration,
}

impl Default for OperationCoordinator {
    fn default() -> Self {
        Self::with_store(OperationStore::default())
    }
}

impl OperationCoordinator {
    /// Builds a coordinator around a store with injected clock and id sources.
    pub fn with_store(store: OperationStore) -> Self {
        Self {
            store: Mutex::new(store),
            stop_grace: CANCEL_GRACE,
            stop_kill_timeout: CANCEL_KILL_TIMEOUT,
        }
    }

    /// Overrides how long cancellation waits for an own process to exit.
    pub fn with_stop_timeouts(mut self, grace: Duration, kill_timeout: Duration) -> Self {
        self.stop_grace = grace;
        self.stop_kill_timeout = kill_timeout;
        self
    }

    /// Connects a running operation to the own process its cancellation stops.
    pub fn attach_process(
        &self,
        operation_id: &str,
        process: Arc<dyn StoppableProcess>,
    ) -> Result<(), AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.attach_process(operation_id, process)
    }

    /// Registers values that must never appear in summaries, events or
    /// diagnostics. Already recorded text is redacted too. This masks only the
    /// values given here (plus the existing `token=`-style patterns); it does not
    /// claim to find arbitrary secrets in arbitrary output.
    pub fn register_sensitive_values(
        &self,
        values: impl IntoIterator<Item = String>,
    ) -> Result<(), AppError> {
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.register_sensitive_values(values);
        Ok(())
    }

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

    /// Cancels an operation. For one with an attached process the status is
    /// `Cancelling` while the process is stopped (the store lock is not held, so
    /// reads stay responsive) and becomes `Cancelled` only once the exit is
    /// confirmed; an unconfirmed exit ends as `Failed`.
    pub fn cancel(&self, operation_id: &str) -> Result<OperationDetails, AppError> {
        let step = {
            let mut store = self.store.lock().map_err(|_| AppError::internal())?;
            store.begin_cancel(operation_id)?
        };
        let process = match step {
            CancelStep::Settled(details) => return Ok(details),
            CancelStep::Stop(process) => process,
        };

        let outcome = process.stop(self.stop_grace, self.stop_kill_timeout);
        let (stdout, stderr) = process.output();
        let mut store = self.store.lock().map_err(|_| AppError::internal())?;
        store.finish_stop(operation_id, outcome, &stdout, &stderr)?;
        store.get(operation_id)
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

/// Redacts `known` values first, then the heuristic patterns, then truncates, so
/// truncation can never leave a partial known value behind.
pub(crate) fn sanitize_payload(value: &str, max_bytes: usize, known: &[String]) -> String {
    truncate_utf8(
        &redact_secret_assignments(&redact_sensitive_lines(&redact_known_values(value, known))),
        max_bytes,
    )
}

pub(crate) fn redact_known_values(value: &str, known: &[String]) -> String {
    let mut output = value.to_owned();
    for secret in known {
        if output.contains(secret.as_str()) {
            output = output.replace(secret.as_str(), REDACTED);
        }
    }
    output
}

/// Replaces an error whose serialized form (message or details) contains a known
/// value with a same-code error that withholds the text.
pub(crate) fn redact_error(error: AppError, known: &[String]) -> AppError {
    if known.is_empty() {
        return error;
    }
    let leaks = serde_json::to_string(&error).map_or(true, |serialized| {
        known.iter().any(|secret| {
            let escaped = serde_json::to_string(secret).unwrap_or_default();
            let escaped = escaped.trim_matches('"');
            serialized.contains(secret.as_str()) || serialized.contains(escaped)
        })
    });
    if !leaks {
        return error;
    }

    let message = "Details withheld because they contained a sensitive value.";
    let retryable = error.retryable();
    match error.code() {
        AppErrorCode::InvalidInput => AppError::invalid_input(message),
        AppErrorCode::NotFound => AppError::not_found(message),
        AppErrorCode::NotSupported => AppError::not_supported(message),
        AppErrorCode::PermissionDenied => AppError::permission_denied(message),
        AppErrorCode::ValidationFailed => AppError::validation_failed(message),
        AppErrorCode::Conflict => AppError::conflict(message),
        AppErrorCode::ProcessFailed => AppError::process_failed(message, retryable),
        AppErrorCode::PartialFailure => AppError::partial_failure(message, retryable),
        AppErrorCode::Timeout => AppError::timeout(message),
        AppErrorCode::ElevationUnavailable => AppError::elevation_unavailable(message),
        AppErrorCode::ElevationRequired | AppErrorCode::Internal => AppError::internal(),
    }
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

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        os::unix::fs::PermissionsExt,
        path::PathBuf,
        sync::{Mutex, mpsc},
        thread,
    };

    use serde_json::Value;

    use super::*;
    use crate::process_session::{EnvSpec, ExitInfo, LaunchSpec};

    const SECRET: &str = "hunter2-known-secret";

    struct Fixture {
        dir: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("userhome-ops-{}", Uuid::new_v4()));
            fs::create_dir_all(&dir).expect("create fixture dir");
            Self {
                dir: fs::canonicalize(dir).expect("canonical fixture dir"),
            }
        }

        fn script(&self, name: &str, body: &str) -> PathBuf {
            let path = self.dir.join(name);
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
            path
        }

        fn read_pid(&self, name: &str) -> i32 {
            let path = self.dir.join(name);
            for _ in 0..250 {
                if let Some(pid) = fs::read_to_string(&path)
                    .ok()
                    .and_then(|text| text.trim().parse::<i32>().ok())
                {
                    return pid;
                }
                thread::sleep(Duration::from_millis(20));
            }
            panic!("fixture pid file {name} not written");
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn pid_exists(pid: i32) -> bool {
        // SAFETY: signal 0 only checks that the pid exists; nothing is delivered.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    fn intent() -> OperationIntent {
        OperationIntent::new(OperationKind::ServiceStop, "fixture", BTreeMap::new())
    }

    fn running(coordinator: &OperationCoordinator) -> String {
        let preview = coordinator
            .preview(intent(), "Stop fixture", vec![], false)
            .expect("preview");
        coordinator
            .authorize_mutation(&preview.operation_id, &intent())
            .expect("authorize");
        preview.operation_id
    }

    fn quick(store: OperationStore) -> OperationCoordinator {
        OperationCoordinator::with_store(store)
            .with_stop_timeouts(Duration::from_millis(300), Duration::from_secs(3))
    }

    struct Scripted {
        outcome: StopOutcome,
        output: (String, String),
        entered: Mutex<Option<mpsc::Sender<()>>>,
        release: Mutex<Option<mpsc::Receiver<()>>>,
    }

    impl Scripted {
        fn new(outcome: StopOutcome) -> Self {
            Self {
                outcome,
                output: (String::new(), String::new()),
                entered: Mutex::new(None),
                release: Mutex::new(None),
            }
        }
    }

    impl StoppableProcess for Scripted {
        fn stop(&self, _: Duration, _: Duration) -> StopOutcome {
            if let Some(entered) = self.entered.lock().expect("entered").take() {
                entered.send(()).expect("signal entered");
            }
            if let Some(release) = self.release.lock().expect("release").take() {
                release.recv().expect("wait for release");
            }
            self.outcome
        }

        fn output(&self) -> (String, String) {
            self.output.clone()
        }
    }

    fn exited() -> StopOutcome {
        StopOutcome::Terminated {
            exit: ExitInfo {
                code: None,
                signal: Some(15),
            },
            escalated_to_kill: false,
        }
    }

    #[test]
    fn operations_cancel_reports_cancelled_only_after_the_process_exited() {
        let fixture = Fixture::new();
        let script = fixture.script(
            "run.sh",
            "echo \"$$\" > leader.pid\nsleep 60 &\necho \"$!\" > child.pid\nwait",
        );
        let session = ProcessSession::start(
            &LaunchSpec::new(script, &fixture.dir).env(EnvSpec::new().inherit("PATH")),
        )
        .expect("start fixture process");
        let leader = fixture.read_pid("leader.pid");
        let child = fixture.read_pid("child.pid");
        assert!(pid_exists(leader) && pid_exists(child));

        let coordinator = quick(OperationStore::default());
        let id = running(&coordinator);
        coordinator
            .attach_process(&id, Arc::new(session))
            .expect("attach");

        let details = coordinator.cancel(&id).expect("cancel");
        assert_eq!(details.status, OperationStatus::Cancelled);
        assert!(!pid_exists(leader), "leader must be gone before Cancelled");
        // The orphaned grandchild is reaped by init, which can lag behind us.
        let gone = (0..250).any(|_| {
            let gone = !pid_exists(child);
            if !gone {
                thread::sleep(Duration::from_millis(20));
            }
            gone
        });
        assert!(gone, "the whole group must be gone");
        assert!(matches!(
            details.events.last(),
            Some(OperationEvent::Finished {
                status: OperationStatus::Cancelled,
                ..
            })
        ));
    }

    #[test]
    fn operations_cancel_escalates_to_kill_for_a_process_that_ignores_sigterm() {
        let fixture = Fixture::new();
        let script = fixture.script(
            "stubborn.sh",
            "trap '' TERM\necho \"$$\" > leader.pid\nwhile :; do sleep 1; done",
        );
        let session = ProcessSession::start(
            &LaunchSpec::new(script, &fixture.dir).env(EnvSpec::new().inherit("PATH")),
        )
        .expect("start fixture process");
        let leader = fixture.read_pid("leader.pid");

        let coordinator = quick(OperationStore::default());
        let id = running(&coordinator);
        coordinator
            .attach_process(&id, Arc::new(session))
            .expect("attach");

        assert_eq!(
            coordinator.cancel(&id).expect("cancel").status,
            OperationStatus::Cancelled
        );
        assert!(!pid_exists(leader));
    }

    #[test]
    fn operations_cancel_is_cancelling_while_stopping_and_does_not_block_reads() {
        let coordinator = Arc::new(quick(OperationStore::default()));
        let id = running(&coordinator);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let process = Scripted::new(exited());
        *process.entered.lock().expect("entered") = Some(entered_tx);
        *process.release.lock().expect("release") = Some(release_rx);
        coordinator
            .attach_process(&id, Arc::new(process))
            .expect("attach");

        let worker = {
            let coordinator = Arc::clone(&coordinator);
            let id = id.clone();
            thread::spawn(move || coordinator.cancel(&id))
        };
        entered_rx.recv().expect("stop started");

        // The store lock is free while the process is being stopped.
        assert_eq!(
            coordinator.get(&id).expect("get").status,
            OperationStatus::Cancelling
        );
        // A repeated cancel only observes the state; it does not stop twice.
        assert_eq!(
            coordinator.cancel(&id).expect("repeat").status,
            OperationStatus::Cancelling
        );

        release_tx.send(()).expect("release stop");
        let finished = worker.join().expect("join").expect("cancel result");
        assert_eq!(finished.status, OperationStatus::Cancelled);
    }

    #[test]
    fn operations_cancel_is_not_cancelled_when_the_exit_cannot_be_confirmed() {
        let coordinator = quick(OperationStore::default());
        let id = running(&coordinator);
        coordinator
            .attach_process(&id, Arc::new(Scripted::new(StopOutcome::Unconfirmed)))
            .expect("attach");

        let details = coordinator.cancel(&id).expect("cancel");
        assert_eq!(details.status, OperationStatus::Failed);
        let Some(OperationEvent::Finished { status, error, .. }) = details.events.last() else {
            panic!("final event expected");
        };
        assert_eq!(*status, OperationStatus::Failed);
        let error = error.as_ref().expect("failure carries an error");
        assert_eq!(error.code(), AppErrorCode::ProcessFailed);
        assert!(error.retryable());
    }

    #[test]
    fn operations_cancel_without_a_process_keeps_the_acknowledged_flow() {
        let coordinator = quick(OperationStore::default());
        let id = running(&coordinator);
        assert_eq!(
            coordinator.cancel(&id).expect("cancel").status,
            OperationStatus::Cancelling
        );
        assert_eq!(
            coordinator.cancel(&id).expect("repeat").status,
            OperationStatus::Cancelling
        );
    }

    #[test]
    fn operations_history_is_bounded_and_reports_dropped_records() {
        let mut store = OperationStore::default().with_limits(3, 8);
        let ids: Vec<String> = (0..5)
            .map(|index| {
                store
                    .preview(intent(), &format!("Operation {index}"), vec![], false)
                    .expect("preview")
                    .operation_id
            })
            .collect();

        let summaries = store.list();
        assert_eq!(summaries.len(), 3);
        assert_eq!(summaries[0].summary, "Operation 4");
        assert_eq!(summaries[2].summary, "Operation 2");
        assert!(store.get(&ids[0]).is_err() && store.get(&ids[1]).is_err());
        assert_eq!(store.dropped_records(), 2);

        let details = store.get(&ids[4]).expect("newest kept");
        assert_eq!(details.dropped_records, 2);
        let json = serde_json::to_value(&details).expect("serialize");
        assert_eq!(json["droppedRecords"], 2);
        assert!(json.get("droppedEvents").is_none());
    }

    #[test]
    fn operations_history_default_keeps_the_latest_200_records() {
        let mut store = OperationStore::default();
        for index in 0..205 {
            store
                .preview(intent(), &format!("Operation {index}"), vec![], false)
                .expect("preview");
        }
        let summaries = store.list();
        assert_eq!(summaries.len(), DEFAULT_MAX_OPERATION_RECORDS);
        assert_eq!(summaries[0].summary, "Operation 204");
        assert_eq!(store.dropped_records(), 5);
    }

    #[test]
    fn operations_history_never_drops_the_running_operation() {
        let mut store = OperationStore::default().with_limits(2, 8);
        let running = store
            .preview(intent(), "Running", vec![], false)
            .expect("preview")
            .operation_id;
        store
            .authorize_mutation(&running, &intent())
            .expect("start");
        for index in 0..4 {
            store
                .preview(intent(), &format!("Later {index}"), vec![], false)
                .expect("preview");
        }
        assert_eq!(
            store.get(&running).expect("running kept").status,
            OperationStatus::Running
        );
        assert_eq!(store.list().len(), 2);
        assert!(store.finish_success(&running, None, None).is_ok());
    }

    #[test]
    fn operations_events_are_bounded_and_report_dropped_events() {
        let mut store = OperationStore::default().with_limits(10, 4);
        let id = store
            .preview(intent(), "Busy", vec![], false)
            .expect("preview")
            .operation_id;
        store.authorize_mutation(&id, &intent()).expect("start");
        for index in 0..10 {
            store
                .record_progress(&id, &format!("step {index}"))
                .expect("progress");
        }
        store
            .finish_success(&id, Some("done"), None)
            .expect("finish");

        let details = store.get(&id).expect("details");
        assert_eq!(details.events.len(), 4);
        assert!(matches!(
            details.events.last(),
            Some(OperationEvent::Finished { .. })
        ));
        // 10 progress + 1 final = 11 events, 4 kept.
        assert_eq!(details.dropped_events, 7);
        let json = serde_json::to_value(&details).expect("serialize");
        assert_eq!(json["droppedEvents"], 7);
        // The oldest were dropped: the first kept progress is step 7.
        let Some(OperationEvent::Progress { message, .. }) = details.events.first() else {
            panic!("progress expected first");
        };
        assert_eq!(message, "step 7");
    }

    #[test]
    fn operations_known_sensitive_values_never_appear_in_serialized_state() {
        let mut store = OperationStore::default();
        let earlier = store
            .preview(
                intent(),
                &format!("Earlier {SECRET}"),
                vec![format!("uses {SECRET}")],
                false,
            )
            .expect("preview")
            .operation_id;
        store.register_sensitive_values([SECRET.to_owned(), "ab".to_owned()]);

        let short = store
            .preview(intent(), "table abc", vec![], false)
            .expect("preview")
            .operation_id;
        assert_eq!(store.get(&short).expect("short").summary, "table abc");

        let id = store
            .preview(
                intent(),
                &format!("Run with {SECRET}"),
                vec![format!("env {SECRET}")],
                false,
            )
            .expect("preview")
            .operation_id;
        store.authorize_mutation(&id, &intent()).expect("start");
        store
            .record_progress(&id, &format!("connecting with {SECRET}"))
            .expect("progress");
        store
            .finish_failure(
                &id,
                AppError::process_failed(&format!("login {SECRET} rejected"), false),
                Some(&format!("out {SECRET} {}", "x".repeat(5_000))),
                Some(&format!("err {SECRET}")),
            )
            .expect("finish");

        let mut serialized =
            serde_json::to_string(&store.get(&id).expect("details")).expect("json");
        serialized.push_str(
            &serde_json::to_string(&store.get(&earlier).expect("earlier")).expect("json"),
        );
        serialized.push_str(&serde_json::to_string(&store.list()).expect("list"));
        assert!(!serialized.contains(SECRET), "leaked: {serialized}");
        assert!(serialized.contains("[REDACTED]"));

        let error: Value =
            serde_json::to_value(&store.get(&id).expect("details").events[1]).expect("event json");
        assert_eq!(error["error"]["code"], "PROCESS_FAILED");
    }

    #[test]
    fn operations_cancelled_output_is_redacted_before_it_reaches_events() {
        let coordinator = quick(OperationStore::default());
        coordinator
            .register_sensitive_values([SECRET.to_owned()])
            .expect("register");
        let id = running(&coordinator);
        let mut process = Scripted::new(exited());
        process.output = (format!("listening with {SECRET}"), format!("warn {SECRET}"));
        coordinator
            .attach_process(&id, Arc::new(process))
            .expect("attach");

        let details = coordinator.cancel(&id).expect("cancel");
        let serialized = serde_json::to_string(&details).expect("json");
        assert!(!serialized.contains(SECRET), "leaked: {serialized}");
        assert!(serialized.contains("listening with [REDACTED]"));
    }
}
