//! Runs one own Caddy instance in the foreground under the process-session runner.
//!
//! The process is `caddy run`, never `caddy start`, and it is never stopped by
//! `caddy stop`: the session owns the pid's process group. The runtime copy of the
//! previewed configuration adds one global `admin` option pointing at a private
//! Unix socket, so the default `localhost:2019` endpoint is never claimed. The
//! saved file on disk is not touched.
//!
//! A session reports `running` only while the process is alive and its admin
//! socket returns a configuration. Stopping goes through the session runner
//! (SIGTERM, then SIGKILL after the grace period) and the socket and working
//! directory are removed only after the exit is confirmed.

use std::{
    fs::{self, DirBuilder, OpenOptions},
    io::{self, Read, Write},
    os::unix::{
        ffi::OsStrExt,
        fs::{DirBuilderExt, OpenOptionsExt},
        net::UnixStream,
    },
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    caddy::{
        config::{CaddyRules, authority},
        detect::{DetectReport, DetectStatus},
        validate::{
            self, CaddyDiagnostic, CaddyRunner, CheckRequest, MAX_CHECK_BYTES, ValidationReport,
            ValidationStatus,
        },
    },
    error::AppError,
    process_session::{
        DEFAULT_LOG_CAPACITY, EnvSpec, LaunchSpec, ProcessSession, SessionError, SessionState,
        StopOutcome,
    },
};

pub const STOP_GRACE: Duration = Duration::from_secs(10);
pub const STOP_KILL_TIMEOUT: Duration = Duration::from_secs(5);
pub const READINESS_TIMEOUT: Duration = Duration::from_secs(10);
pub const PLAN_TTL: Duration = Duration::from_secs(5 * 60);
pub const MAX_LOG_PAGE_BYTES: usize = 64 * 1024;
pub const RUN_WORKING_DIRECTORY_LABEL: &str = "<私有运行目录>";
pub const ADMIN_ENDPOINT_LABEL: &str = "仅本次运行的私有 Unix socket（不占用默认 localhost:2019）";

const ADMIN_SOCKET_FILE: &str = "admin.sock";
/// `sun_path` holds 104 bytes on macOS including the terminator; keep a margin.
const SOCKET_PATH_LIMIT: usize = 100;
const FALLBACK_SOCKET_ROOT: &str = "/tmp";
const READINESS_POLL: Duration = Duration::from_millis(100);
const PROBE_TIMEOUT: Duration = Duration::from_secs(1);
const PROBE_MAX_BYTES: u64 = 256 * 1024;
const PROBE_REQUEST: &[u8] =
    b"GET /config/ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
const FILE_MODE: u32 = 0o600;
const DIRECTORY_MODE: u32 = 0o700;

const NOTES_COMMON: &[&str] = &[
    "以前台 caddy run 启动本应用持有的自有实例；不使用 caddy start，也不使用 caddy stop。",
    "开启前会用同一可执行文件校验配置；校验会加载配置中的模块，可能占用资源。",
    "运行时副本只额外注入私有管理 socket，磁盘上保存的配置不会被改动。",
    "启动失败或运行中崩溃都不会自动重试或自动重启。",
    "开启前不检查上游是否可达；上游不可达只会在请求时体现，不等于进程未运行。",
];
const NOTES_RULES: &[&str] = &[
    "表单配置已关闭自动 HTTPS：不申请证书、不联网、不安装信任。",
    "表单配置不开启访问日志。",
];
const NOTES_RAW: &[&str] = &["原文配置的 TLS 与日志行为以原文为准；原文中的外部引用会被拒绝。"];
const EXPOSURE_NOTE: &str = "至少一个监听地址可能被本机以外访问，请确认是否符合预期。";
const BLOCKED_EMPTY: &str = "保存的配置为空，未开启。";
const BLOCKED_TOO_LARGE: &str = "配置超过 256 KiB 上限，未开启。";
const BLOCKED_ADMIN: &str =
    "原文已包含 admin 全局选项：本应用不会覆盖或替换它。请从原文移除后再开启。";
const BLOCKED_EXTERNAL: &str =
    "原文包含 import、文件或环境变量引用、带参数的 tls 等外部引用，本阶段不允许开启。";
const NO_EXECUTABLE: &str = "未找到可用的 Caddy 可执行文件，请先检测或选择。";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigSource {
    Rules,
    Raw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FailureKind {
    ExecutableUnavailable,
    InvalidSetup,
    ConfigRejected,
    SpawnFailed,
    ExitedBeforeReady,
    ReadinessTimeout,
    CrashedAfterReady,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    pub state: RunState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<FailureKind>,
    pub message: &'static str,
    pub diagnostics: Vec<CaddyDiagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<ConfigSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_signal: Option<i32>,
}

impl RunStatus {
    fn bare(
        state: RunState,
        failure: Option<FailureKind>,
        diagnostics: Vec<CaddyDiagnostic>,
    ) -> Self {
        Self {
            state,
            failure,
            message: message(state, failure),
            diagnostics,
            session_id: None,
            source: None,
            exit_code: None,
            exit_signal: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<String>,
    pub source: ConfigSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub working_directory: &'static str,
    pub config_fingerprint: String,
    pub listen: Vec<String>,
    pub upstreams: Vec<String>,
    pub admin_endpoint: &'static str,
    pub notes: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub session_id: String,
    pub stdout: String,
    pub stderr: String,
    pub stdout_offset: u64,
    pub stderr_offset: u64,
    pub has_more: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Timing {
    pub stop_grace: Duration,
    pub stop_kill: Duration,
    pub readiness: Duration,
    pub log_capacity: usize,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            stop_grace: STOP_GRACE,
            stop_kill: STOP_KILL_TIMEOUT,
            readiness: READINESS_TIMEOUT,
            log_capacity: DEFAULT_LOG_CAPACITY,
        }
    }
}

/// Decides whether the admin endpoint answers. Injected so tests never need a
/// real Caddy process or socket.
pub trait AdminProbe: Send + Sync {
    fn is_ready(&self, socket: &Path) -> bool;
}

pub struct SystemAdminProbe;

impl AdminProbe for SystemAdminProbe {
    fn is_ready(&self, socket: &Path) -> bool {
        let Ok(mut stream) = UnixStream::connect(socket) else {
            return false;
        };
        if stream.set_read_timeout(Some(PROBE_TIMEOUT)).is_err()
            || stream.set_write_timeout(Some(PROBE_TIMEOUT)).is_err()
            || stream.write_all(PROBE_REQUEST).is_err()
        {
            return false;
        }
        let mut response = Vec::new();
        let _ = (&mut stream)
            .take(PROBE_MAX_BYTES)
            .read_to_end(&mut response);
        // A configuration body is a JSON object; `null` means no config is loaded yet.
        response.starts_with(b"HTTP/1.1 200") && response.contains(&b'{')
    }
}

pub struct StartEnvironment<'a> {
    pub checks_root: &'a Path,
    pub runs_root: &'a Path,
    pub runner: &'a dyn CaddyRunner,
    pub probe: &'a dyn AdminProbe,
}

pub struct PrepareInput<'a> {
    pub source: ConfigSource,
    pub detect: &'a DetectReport,
    pub text: &'a str,
    pub rules: Option<&'a CaddyRules>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Facts {
    process: SessionState,
    ready: bool,
    user_stopped: bool,
    recorded: Option<FailureKind>,
    cleanup_failed: bool,
}

fn derive_state(facts: Facts) -> (RunState, Option<FailureKind>) {
    match facts.process {
        SessionState::Starting => (RunState::Starting, None),
        SessionState::Running if facts.ready => (RunState::Running, None),
        SessionState::Running => (RunState::Starting, None),
        SessionState::Stopping => (RunState::Stopping, None),
        SessionState::Exited if facts.cleanup_failed => (RunState::Unknown, None),
        SessionState::Exited if facts.user_stopped => (RunState::Stopped, None),
        SessionState::Exited => {
            let kind = facts.recorded.unwrap_or(if facts.ready {
                FailureKind::CrashedAfterReady
            } else {
                FailureKind::ExitedBeforeReady
            });
            (RunState::Failed, Some(kind))
        }
        SessionState::Failed | SessionState::Unknown => (RunState::Unknown, None),
    }
}

fn message(state: RunState, failure: Option<FailureKind>) -> &'static str {
    match (state, failure) {
        (RunState::Stopped, _) => "未运行。",
        (RunState::Starting, _) => "正在开启，等待管理端点就绪……",
        (RunState::Running, _) => "运行中：进程存活且管理端点已就绪。",
        (RunState::Stopping, _) => "正在停止，等待进程退出……",
        (RunState::Unknown, _) => "状态未知：未能确认进程已退出或清理完成，请检查后再操作。",
        (RunState::Failed, Some(kind)) => failure_message(kind),
        (RunState::Failed, None) => "开启失败。",
    }
}

fn failure_message(kind: FailureKind) -> &'static str {
    match kind {
        FailureKind::ExecutableUnavailable => NO_EXECUTABLE,
        FailureKind::InvalidSetup => "启动参数或运行目录不正确，未启动。",
        FailureKind::ConfigRejected => "配置未通过校验，未启动。",
        FailureKind::SpawnFailed => "无法启动 Caddy 进程。",
        FailureKind::ExitedBeforeReady => "Caddy 在就绪前退出，请查看诊断与日志。",
        FailureKind::ReadinessTimeout => "Caddy 在时限内未就绪，已停止该进程；未显示为运行中。",
        FailureKind::CrashedAfterReady => "Caddy 在运行后意外退出，未自动重启。",
    }
}

/// Only a configuration whose global options block was not already declared, and
/// without external references, can be run. The check is deliberately
/// conservative: any word `admin` outside a comment counts as declared.
pub fn declares_admin(text: &str) -> bool {
    text.lines().any(|raw| {
        validate::strip_comment(raw)
            .split_whitespace()
            .any(|word| word == "admin")
    })
}

/// Adds the private admin endpoint to the first global options block, or creates
/// one in front of a configuration that has none.
pub fn inject_admin(text: &str, socket: &Path) -> String {
    let directive = format!("\tadmin unix/{}", socket.display());
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let opening = lines
        .iter()
        .position(|line| !validate::strip_comment(line).trim().is_empty());
    match opening {
        Some(index) if validate::strip_comment(&lines[index]).trim() == "{" => {
            lines.insert(index + 1, directive);
        }
        _ => {
            lines.insert(0, "}".to_owned());
            lines.insert(0, directive);
            lines.insert(0, "{".to_owned());
        }
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

fn socket_path_usable(path: &Path) -> bool {
    let bytes = path.as_os_str().as_bytes();
    bytes.len() <= SOCKET_PATH_LIMIT
        && bytes.iter().all(|byte| {
            byte.is_ascii_graphic() && !matches!(byte, b'"' | b'\'' | b'\\' | b'{' | b'}' | b'#')
        })
}

fn fingerprint(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn create_private_directory(path: &Path) -> Result<(), AppError> {
    DirBuilder::new()
        .mode(DIRECTORY_MODE)
        .create(path)
        .map_err(|_| AppError::permission_denied("Caddy 运行目录无法创建。"))
}

fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

fn remove_tree_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Working directory of one run plus its admin socket. The socket lives in the
/// directory when the path is short and plain, otherwise in a private 0700
/// directory under `/tmp`, because `sun_path` is limited to about 104 bytes.
#[derive(Debug)]
struct RunDirectory {
    dir: PathBuf,
    socket: PathBuf,
    fallback: Option<PathBuf>,
}

impl RunDirectory {
    fn create(runs_root: &Path) -> Result<Self, AppError> {
        let id = Uuid::new_v4().to_string();
        let dir = runs_root.join(&id);
        create_private_directory(&dir)?;
        let preferred = dir.join(ADMIN_SOCKET_FILE);
        if socket_path_usable(&preferred) {
            return Ok(Self {
                dir,
                socket: preferred,
                fallback: None,
            });
        }
        let fallback = PathBuf::from(FALLBACK_SOCKET_ROOT).join(format!("userhome-{}", &id[..8]));
        create_private_directory(&fallback)?;
        let socket = fallback.join(ADMIN_SOCKET_FILE);
        Ok(Self {
            dir,
            socket,
            fallback: Some(fallback),
        })
    }

    fn remove(&self) -> io::Result<()> {
        remove_file_if_exists(&self.socket)?;
        if let Some(fallback) = &self.fallback {
            remove_tree_if_exists(fallback)?;
        }
        remove_tree_if_exists(&self.dir)
    }
}

impl Drop for RunDirectory {
    fn drop(&mut self) {
        let _ = self.remove();
    }
}

fn write_runtime_config(directory: &Path, text: &str) -> Result<PathBuf, AppError> {
    let path = directory.join(validate::CONFIG_FILE);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(FILE_MODE)
        .open(&path)
        .map_err(|_| AppError::permission_denied("Caddy 运行配置无法创建。"))?;
    file.write_all(text.as_bytes())
        .map_err(|_| AppError::permission_denied("Caddy 运行配置无法写入。"))?;
    Ok(path)
}

fn launch_spec(
    executable: &Path,
    directory: &Path,
    config: &Path,
    log_capacity: usize,
) -> Result<LaunchSpec, AppError> {
    let config = config.to_str().ok_or_else(AppError::internal)?;
    let mut environment = EnvSpec::new();
    for (name, value) in validate::minimal_environment(directory) {
        let value = value.into_string().map_err(|_| AppError::internal())?;
        environment = environment.set(name, value);
    }
    Ok(LaunchSpec::new(executable, directory)
        .args(["run", "--config", config, "--adapter", validate::ADAPTER])
        .env(environment)
        .log_capacity(log_capacity))
}

fn refusal_kind(report: &ValidationReport) -> Option<FailureKind> {
    match report.status {
        ValidationStatus::Valid => None,
        ValidationStatus::Unavailable => Some(FailureKind::ExecutableUnavailable),
        _ => Some(FailureKind::ConfigRejected),
    }
}

struct Refusal {
    kind: FailureKind,
    diagnostics: Vec<CaddyDiagnostic>,
}

struct RunPlan {
    id: String,
    source: ConfigSource,
    executable: PathBuf,
    text: String,
    stored_at: Instant,
}

/// One started own process. Logs, exit facts and the failure reason stay here
/// until the next start, so a failed run keeps its bounded output.
struct Run {
    session: ProcessSession,
    source: ConfigSource,
    directory: RunDirectory,
    ready: AtomicBool,
    user_stopped: AtomicBool,
    cleaned: AtomicBool,
    cleanup_failed: AtomicBool,
    recorded: Mutex<Option<FailureKind>>,
    diagnostics: Mutex<Option<Vec<CaddyDiagnostic>>>,
}

impl Run {
    fn new(session: ProcessSession, source: ConfigSource, directory: RunDirectory) -> Self {
        Self {
            session,
            source,
            directory,
            ready: AtomicBool::new(false),
            user_stopped: AtomicBool::new(false),
            cleaned: AtomicBool::new(false),
            cleanup_failed: AtomicBool::new(false),
            recorded: Mutex::new(None),
            diagnostics: Mutex::new(None),
        }
    }

    fn is_live(&self) -> bool {
        matches!(
            self.session.status().state,
            SessionState::Starting | SessionState::Running | SessionState::Stopping
        )
    }

    fn record(&self, kind: FailureKind) {
        let mut recorded = lock(&self.recorded);
        if recorded.is_none() {
            *recorded = Some(kind);
        }
    }

    /// Releases the directory once the process is confirmed gone; retried on
    /// every observation until it succeeds.
    fn settle(&self) {
        if self.cleaned.load(Ordering::SeqCst) {
            return;
        }
        match self.directory.remove() {
            Ok(()) => {
                self.cleaned.store(true, Ordering::SeqCst);
                self.cleanup_failed.store(false, Ordering::SeqCst);
            }
            Err(_) => self.cleanup_failed.store(true, Ordering::SeqCst),
        }
    }

    fn captured_diagnostics(&self) -> Vec<CaddyDiagnostic> {
        lock(&self.diagnostics)
            .get_or_insert_with(|| {
                validate::diagnostics_from(self.session.stderr().bytes(), &self.directory.dir)
            })
            .clone()
    }

    fn status(&self) -> RunStatus {
        let process = self.session.status();
        if process.state == SessionState::Exited {
            self.settle();
        }
        let (state, failure) = derive_state(Facts {
            process: process.state,
            ready: self.ready.load(Ordering::SeqCst),
            user_stopped: self.user_stopped.load(Ordering::SeqCst),
            recorded: *lock(&self.recorded),
            cleanup_failed: self.cleanup_failed.load(Ordering::SeqCst),
        });
        let diagnostics = if state == RunState::Failed {
            self.captured_diagnostics()
        } else {
            Vec::new()
        };
        let mut status = RunStatus::bare(state, failure, diagnostics);
        status.session_id = Some(self.session.id().to_owned());
        status.source = Some(self.source);
        status.exit_code = process.exit.and_then(|exit| exit.code);
        status.exit_signal = process.exit.and_then(|exit| exit.signal);
        status
    }
}

#[derive(Default)]
struct Slot {
    busy: bool,
    active: Option<Arc<Run>>,
    refusal: Option<Refusal>,
}

pub struct CaddyRunCoordinator {
    slot: Mutex<Slot>,
    plan: Mutex<Option<RunPlan>>,
    timing: Timing,
}

impl Default for CaddyRunCoordinator {
    fn default() -> Self {
        Self::with_timing(Timing::default())
    }
}

impl CaddyRunCoordinator {
    pub fn with_timing(timing: Timing) -> Self {
        Self {
            slot: Mutex::new(Slot::default()),
            plan: Mutex::new(None),
            timing,
        }
    }

    /// Read-only summary of what starting would do. It stores a single-use plan
    /// only when nothing blocks the start, so `start` runs exactly this text.
    pub fn prepare(&self, input: PrepareInput<'_>) -> StartSummary {
        let mut summary = StartSummary {
            plan_id: None,
            source: input.source,
            executable_path: None,
            version: None,
            working_directory: RUN_WORKING_DIRECTORY_LABEL,
            config_fingerprint: fingerprint(input.text),
            listen: Vec::new(),
            upstreams: Vec::new(),
            admin_endpoint: ADMIN_ENDPOINT_LABEL,
            notes: NOTES_COMMON.to_vec(),
            blocked: None,
        };
        let source_notes = match input.source {
            ConfigSource::Rules => NOTES_RULES,
            ConfigSource::Raw => NOTES_RAW,
        };
        summary.notes.extend(source_notes.iter().copied());

        let executable = match (input.detect.status, &input.detect.executable_path) {
            (DetectStatus::Available, Some(path)) => {
                summary.executable_path = Some(path.clone());
                summary.version = input.detect.version.clone();
                Some(PathBuf::from(path))
            }
            _ => None,
        };
        if let Some(rules) = input.rules {
            for site in rules.sites.iter().filter(|site| site.enabled) {
                summary.listen.push(format!(
                    "http://{}",
                    authority(&site.listen.host, site.listen.port)
                ));
                for upstream in &site.upstreams {
                    summary.upstreams.push(format!(
                        "{}://{}",
                        upstream.scheme.as_str(),
                        authority(&upstream.host, upstream.port)
                    ));
                }
            }
            if rules
                .validate()
                .exposures
                .iter()
                .any(|exposure| exposure.visible_externally)
            {
                summary.notes.push(EXPOSURE_NOTE);
            }
        }

        summary.blocked = if executable.is_none() {
            Some(input.detect.guidance.unwrap_or(NO_EXECUTABLE))
        } else if input.text.trim().is_empty() {
            Some(BLOCKED_EMPTY)
        } else if input.text.len() > MAX_CHECK_BYTES {
            Some(BLOCKED_TOO_LARGE)
        } else if declares_admin(input.text) {
            Some(BLOCKED_ADMIN)
        } else if !validate::scan_external_references(input.text).is_empty() {
            Some(BLOCKED_EXTERNAL)
        } else {
            None
        };
        let Some(executable) = executable.filter(|_| summary.blocked.is_none()) else {
            return summary;
        };
        let id = Uuid::new_v4().to_string();
        summary.plan_id = Some(id.clone());
        *lock(&self.plan) = Some(RunPlan {
            id,
            source: input.source,
            executable,
            text: input.text.to_owned(),
            stored_at: Instant::now(),
        });
        summary
    }

    pub fn start(
        &self,
        plan_id: &str,
        source: ConfigSource,
        env: &StartEnvironment<'_>,
    ) -> Result<RunStatus, AppError> {
        let plan = self.take_plan(plan_id, source)?;
        {
            let mut slot = lock(&self.slot);
            let live = slot.active.as_ref().is_some_and(|run| run.is_live());
            if slot.busy || live {
                return Err(AppError::conflict("已有运行中的 Caddy，请先关闭。"));
            }
            slot.busy = true;
        }
        let status = self.launch(&plan, env);
        lock(&self.slot).busy = false;
        Ok(status)
    }

    fn take_plan(&self, id: &str, source: ConfigSource) -> Result<RunPlan, AppError> {
        let stored = lock(&self.plan).take();
        match stored {
            Some(plan)
                if plan.id == id
                    && plan.source == source
                    && plan.stored_at.elapsed() <= PLAN_TTL =>
            {
                Ok(plan)
            }
            _ => Err(AppError::conflict("开启前摘要已失效，请重新预览后再开启。")),
        }
    }

    fn launch(&self, plan: &RunPlan, env: &StartEnvironment<'_>) -> RunStatus {
        let cancel = AtomicBool::new(false);
        let request = CheckRequest {
            executable: &plan.executable,
            text: &plan.text,
            allow_external_references: false,
        };
        let report = match validate::check(&request, env.checks_root, env.runner, &cancel) {
            Ok(report) => report,
            Err(_) => return self.refuse(FailureKind::InvalidSetup, Vec::new()),
        };
        if let Some(kind) = refusal_kind(&report) {
            return self.refuse(kind, report.diagnostics);
        }
        let directory = match RunDirectory::create(env.runs_root) {
            Ok(directory) => directory,
            Err(_) => return self.refuse(FailureKind::InvalidSetup, Vec::new()),
        };
        let runtime = inject_admin(&plan.text, &directory.socket);
        let Ok(config) = write_runtime_config(&directory.dir, &runtime) else {
            return self.refuse(FailureKind::InvalidSetup, Vec::new());
        };
        let Ok(spec) = launch_spec(
            &plan.executable,
            &directory.dir,
            &config,
            self.timing.log_capacity,
        ) else {
            return self.refuse(FailureKind::InvalidSetup, Vec::new());
        };
        let session = match ProcessSession::start(&spec) {
            Ok(session) => session,
            Err(SessionError::Spawn | SessionError::Io) => {
                return self.refuse(FailureKind::SpawnFailed, Vec::new());
            }
            Err(_) => return self.refuse(FailureKind::InvalidSetup, Vec::new()),
        };
        let run = Arc::new(Run::new(session, plan.source, directory));
        {
            let mut slot = lock(&self.slot);
            slot.active = Some(Arc::clone(&run));
            slot.refusal = None;
        }
        self.await_ready(&run, env.probe)
    }

    fn refuse(&self, kind: FailureKind, diagnostics: Vec<CaddyDiagnostic>) -> RunStatus {
        let mut slot = lock(&self.slot);
        slot.active = None;
        slot.refusal = Some(Refusal {
            kind,
            diagnostics: diagnostics.clone(),
        });
        RunStatus::bare(RunState::Failed, Some(kind), diagnostics)
    }

    fn await_ready(&self, run: &Arc<Run>, probe: &dyn AdminProbe) -> RunStatus {
        let deadline = Instant::now() + self.timing.readiness;
        loop {
            if run.user_stopped.load(Ordering::SeqCst) {
                return run.status();
            }
            match run.session.status().state {
                SessionState::Starting | SessionState::Running => {}
                SessionState::Exited => {
                    run.record(FailureKind::ExitedBeforeReady);
                    run.settle();
                    return run.status();
                }
                SessionState::Stopping | SessionState::Failed | SessionState::Unknown => {
                    return run.status();
                }
            }
            if probe.is_ready(&run.directory.socket) {
                run.ready.store(true, Ordering::SeqCst);
                return run.status();
            }
            if Instant::now() >= deadline {
                run.record(FailureKind::ReadinessTimeout);
                self.finish(run);
                return run.status();
            }
            thread::sleep(READINESS_POLL);
        }
    }

    fn finish(&self, run: &Run) {
        match run
            .session
            .stop(self.timing.stop_grace, self.timing.stop_kill)
        {
            StopOutcome::AlreadyExited(_) | StopOutcome::Terminated { .. } => run.settle(),
            StopOutcome::Unconfirmed => {}
        }
    }

    /// Stops only the own live session. Exit confirmation is the completion
    /// condition; an unconfirmed exit leaves the directory alone and reports Unknown.
    pub fn stop(&self) -> Result<RunStatus, AppError> {
        let live = {
            let slot = lock(&self.slot);
            match slot.active.clone().filter(|run| run.is_live()) {
                Some(run) => Some(run),
                None if slot.busy => {
                    return Err(AppError::conflict("正在开启，请稍后再停止。"));
                }
                None => None,
            }
        };
        if let Some(run) = live {
            run.user_stopped.store(true, Ordering::SeqCst);
            self.finish(&run);
        }
        Ok(self.status())
    }

    pub fn status(&self) -> RunStatus {
        let (busy, active, refusal) = {
            let slot = lock(&self.slot);
            (
                slot.busy,
                slot.active.clone(),
                slot.refusal
                    .as_ref()
                    .map(|refusal| (refusal.kind, refusal.diagnostics.clone())),
            )
        };
        if busy {
            return match active {
                Some(run) if run.is_live() => run.status(),
                _ => RunStatus::bare(RunState::Starting, None, Vec::new()),
            };
        }
        if let Some(run) = active {
            return run.status();
        }
        if let Some((kind, diagnostics)) = refusal {
            return RunStatus::bare(RunState::Failed, Some(kind), diagnostics);
        }
        RunStatus::bare(RunState::Stopped, None, Vec::new())
    }

    pub fn logs(
        &self,
        session_id: &str,
        stdout_offset: u64,
        stderr_offset: u64,
    ) -> Result<LogPage, AppError> {
        let run = lock(&self.slot)
            .active
            .clone()
            .filter(|run| run.session.id() == session_id)
            .ok_or_else(|| AppError::not_found("没有该运行会话的日志。"))?;
        let stdout = run.session.stdout();
        let stderr = run.session.stderr();
        let out = page(
            stdout.bytes(),
            stdout.dropped_bytes(),
            stdout_offset,
            MAX_LOG_PAGE_BYTES,
        );
        let err = page(
            stderr.bytes(),
            stderr.dropped_bytes(),
            stderr_offset,
            MAX_LOG_PAGE_BYTES,
        );
        Ok(LogPage {
            session_id: session_id.to_owned(),
            stdout: out.text,
            stderr: err.text,
            stdout_offset: out.next,
            stderr_offset: err.next,
            has_more: out.has_more || err.has_more,
        })
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Page {
    text: String,
    next: u64,
    has_more: bool,
}

/// One page of a bounded stream. Offsets are absolute byte positions; bytes
/// older than `dropped` are gone and the page says so before resuming. A page
/// that stops early ends on a line break when one is available.
fn page(bytes: &[u8], dropped: u64, offset: u64, limit: usize) -> Page {
    let end = dropped + bytes.len() as u64;
    let notice = if offset < dropped {
        format!("[userhome: 已截断更早的 {} 字节]\n", dropped - offset)
    } else {
        String::new()
    };
    let start = offset.max(dropped).min(end);
    let index = (start - dropped) as usize;
    let available = bytes.len() - index;
    let mut take = available.min(limit);
    if take < available {
        take = bytes[index..index + take]
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map_or(take, |position| position + 1);
    }
    Page {
        text: format!(
            "{notice}{}",
            String::from_utf8_lossy(&bytes[index..index + take])
        ),
        next: start + take as u64,
        has_more: take < available,
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;
    use crate::{
        caddy::{
            config::{Listen, RULES_VERSION, SiteRule, Upstream, UpstreamScheme},
            validate::{RunFailure, RunOutput},
        },
        error::AppErrorCode,
    };

    struct Ready(bool);

    impl AdminProbe for Ready {
        fn is_ready(&self, _socket: &Path) -> bool {
            self.0
        }
    }

    struct StubRunner(Result<RunOutput, RunFailure>);

    impl CaddyRunner for StubRunner {
        fn run(
            &self,
            _spec: &validate::RunSpec,
            _cancel: &AtomicBool,
        ) -> Result<RunOutput, RunFailure> {
            self.0.clone()
        }
    }

    fn accepting() -> StubRunner {
        StubRunner(Ok(RunOutput {
            success: true,
            stdout: b"{}".to_vec(),
            stderr: Vec::new(),
        }))
    }

    fn rejecting() -> StubRunner {
        StubRunner(Ok(RunOutput {
            success: false,
            stdout: Vec::new(),
            stderr: b"Error: adapting config: Caddyfile:2: unrecognized directive".to_vec(),
        }))
    }

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("userhome-session-{}", Uuid::new_v4()));
            fs::create_dir_all(path.join("runs")).expect("scratch");
            fs::create_dir_all(path.join("checks")).expect("scratch");
            Self(path)
        }

        fn runs(&self) -> PathBuf {
            self.0.join("runs")
        }

        fn checks(&self) -> PathBuf {
            self.0.join("checks")
        }

        fn fixture(&self, body: &str) -> PathBuf {
            let path = self.0.join(format!("caddy-{}", Uuid::new_v4()));
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("fixture");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("fixture mode");
            path
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn available(executable: &Path) -> DetectReport {
        DetectReport {
            status: DetectStatus::Available,
            executable_path: Some(executable.display().to_string()),
            version: Some("v2.8.4 fixture".to_owned()),
            guidance: None,
            candidates: Vec::new(),
        }
    }

    fn missing() -> DetectReport {
        DetectReport {
            status: DetectStatus::Missing,
            executable_path: None,
            version: None,
            guidance: Some("未找到 Caddy。"),
            candidates: Vec::new(),
        }
    }

    fn fast_timing() -> Timing {
        Timing {
            stop_grace: Duration::from_millis(300),
            stop_kill: Duration::from_secs(2),
            readiness: Duration::from_millis(400),
            log_capacity: DEFAULT_LOG_CAPACITY,
        }
    }

    fn prepare_raw(
        coordinator: &CaddyRunCoordinator,
        executable: &Path,
        text: &str,
    ) -> StartSummary {
        coordinator.prepare(PrepareInput {
            source: ConfigSource::Raw,
            detect: &available(executable),
            text,
            rules: None,
        })
    }

    fn start_with(
        coordinator: &CaddyRunCoordinator,
        scratch: &Scratch,
        executable: &Path,
        runner: &dyn CaddyRunner,
        probe: &dyn AdminProbe,
    ) -> Result<RunStatus, AppError> {
        let summary = prepare_raw(coordinator, executable, "example.com {\n}\n");
        let plan_id = summary.plan_id.expect("plan");
        let checks = scratch.checks();
        let runs = scratch.runs();
        coordinator.start(
            &plan_id,
            ConfigSource::Raw,
            &StartEnvironment {
                checks_root: &checks,
                runs_root: &runs,
                runner,
                probe,
            },
        )
    }

    fn wait_for(coordinator: &CaddyRunCoordinator, state: RunState) -> RunStatus {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let status = coordinator.status();
            if status.state == state || Instant::now() >= deadline {
                return status;
            }
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn facts(process: SessionState) -> Facts {
        Facts {
            process,
            ready: false,
            user_stopped: false,
            recorded: None,
            cleanup_failed: false,
        }
    }

    #[test]
    fn starting_and_alive_but_unready_processes_are_starting_not_running() {
        assert_eq!(
            derive_state(facts(SessionState::Starting)),
            (RunState::Starting, None)
        );
        assert_eq!(
            derive_state(facts(SessionState::Running)),
            (RunState::Starting, None)
        );
    }

    #[test]
    fn running_is_reported_only_once_ready() {
        let ready = Facts {
            ready: true,
            ..facts(SessionState::Running)
        };
        assert_eq!(derive_state(ready), (RunState::Running, None));
    }

    #[test]
    fn exit_before_ready_is_failed_with_a_reason() {
        assert_eq!(
            derive_state(facts(SessionState::Exited)),
            (RunState::Failed, Some(FailureKind::ExitedBeforeReady))
        );
    }

    #[test]
    fn crash_after_ready_is_failed_with_a_distinct_reason() {
        let crashed = Facts {
            ready: true,
            ..facts(SessionState::Exited)
        };
        assert_eq!(
            derive_state(crashed),
            (RunState::Failed, Some(FailureKind::CrashedAfterReady))
        );
    }

    #[test]
    fn recorded_readiness_timeout_wins_over_the_generic_exit_reason() {
        let timed_out = Facts {
            recorded: Some(FailureKind::ReadinessTimeout),
            ..facts(SessionState::Exited)
        };
        assert_eq!(
            derive_state(timed_out),
            (RunState::Failed, Some(FailureKind::ReadinessTimeout))
        );
    }

    #[test]
    fn user_stop_after_exit_is_stopped_unless_cleanup_failed() {
        let stopped = Facts {
            user_stopped: true,
            ..facts(SessionState::Exited)
        };
        assert_eq!(derive_state(stopped), (RunState::Stopped, None));
        let uncleaned = Facts {
            cleanup_failed: true,
            ..stopped
        };
        assert_eq!(derive_state(uncleaned), (RunState::Unknown, None));
    }

    #[test]
    fn stopping_and_unconfirmed_processes_never_report_running() {
        assert_eq!(
            derive_state(facts(SessionState::Stopping)),
            (RunState::Stopping, None)
        );
        assert_eq!(
            derive_state(facts(SessionState::Unknown)),
            (RunState::Unknown, None)
        );
        assert_eq!(
            derive_state(facts(SessionState::Failed)),
            (RunState::Unknown, None)
        );
    }

    #[test]
    fn declared_admin_is_detected_outside_comments_only() {
        assert!(declares_admin("{\n\tadmin off\n}\n"));
        assert!(declares_admin("{ admin unix//tmp/x.sock }\n"));
        assert!(!declares_admin("# admin off\nexample.com {\n}\n"));
        assert!(!declares_admin(
            "example.com {\n\treverse_proxy 127.0.0.1:3000\n}\n"
        ));
    }

    #[test]
    fn admin_joins_an_existing_leading_global_block() {
        let text = "{\n\tauto_https off\n}\n\nhttp://127.0.0.1:8080 {\n\treverse_proxy http://127.0.0.1:3000\n}\n";
        let injected = inject_admin(text, Path::new("/tmp/s/admin.sock"));
        assert_eq!(
            injected,
            "{\n\tadmin unix//tmp/s/admin.sock\n\tauto_https off\n}\n\nhttp://127.0.0.1:8080 {\n\treverse_proxy http://127.0.0.1:3000\n}\n"
        );
    }

    #[test]
    fn admin_opens_a_global_block_after_a_leading_comment() {
        let injected = inject_admin(
            "# note\n{\n\tauto_https off\n}\n",
            Path::new("/tmp/s/admin.sock"),
        );
        assert_eq!(
            injected,
            "# note\n{\n\tadmin unix//tmp/s/admin.sock\n\tauto_https off\n}\n"
        );
    }

    #[test]
    fn admin_creates_a_global_block_before_a_configuration_without_one() {
        let injected = inject_admin("example.com {\n}\n", Path::new("/tmp/s/admin.sock"));
        assert_eq!(
            injected,
            "{\n\tadmin unix//tmp/s/admin.sock\n}\nexample.com {\n}\n"
        );
    }

    #[test]
    fn socket_path_must_be_short_and_plain() {
        assert!(socket_path_usable(Path::new("/tmp/a/admin.sock")));
        assert!(!socket_path_usable(Path::new("/tmp/a b/admin.sock")));
        let long = format!("/tmp/{}/admin.sock", "x".repeat(100));
        assert!(!socket_path_usable(Path::new(&long)));
    }

    #[test]
    fn long_runs_root_moves_the_socket_to_a_private_tmp_directory() {
        let scratch = Scratch::new();
        let deep = scratch.runs().join("y".repeat(90));
        fs::create_dir_all(&deep).expect("deep runs root");
        let directory = RunDirectory::create(&deep).expect("run directory");
        assert!(directory.socket.starts_with(FALLBACK_SOCKET_ROOT));
        assert!(directory.fallback.is_some());
        let fallback = directory.fallback.clone().expect("fallback");
        assert_eq!(
            fs::metadata(&fallback)
                .expect("fallback")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        directory.remove().expect("removed");
        assert!(!fallback.exists());
        assert!(!directory.dir.exists());
    }

    #[test]
    fn page_reports_a_visible_notice_when_older_bytes_were_dropped() {
        let part = page(b"tail\n", 10, 0, 1024);
        assert_eq!(part.text, "[userhome: 已截断更早的 10 字节]\ntail\n");
        assert_eq!(part.next, 15);
        assert!(!part.has_more);
    }

    #[test]
    fn page_resumes_from_a_cursor_and_clamps_beyond_the_end() {
        let part = page(b"abc\ndef\n", 0, 4, 1024);
        assert_eq!(part.text, "def\n");
        assert_eq!(part.next, 8);
        let beyond = page(b"abc\n", 0, 99, 1024);
        assert_eq!(beyond.text, "");
        assert_eq!(beyond.next, 4);
    }

    #[test]
    fn page_ends_on_a_line_break_when_the_limit_cuts_a_line() {
        let part = page(b"aaaa\nbbbb\ncccc\n", 0, 0, 7);
        assert_eq!(part.text, "aaaa\n");
        assert_eq!(part.next, 5);
        assert!(part.has_more);
    }

    #[test]
    fn prepare_summarises_rules_and_stores_a_plan_when_nothing_blocks() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 30");
        let rules = CaddyRules {
            version: RULES_VERSION,
            sites: vec![SiteRule {
                enabled: true,
                listen: Listen {
                    host: "127.0.0.1".to_owned(),
                    port: 8080,
                },
                upstreams: vec![Upstream {
                    scheme: UpstreamScheme::Http,
                    host: "127.0.0.1".to_owned(),
                    port: 3000,
                }],
            }],
        };
        let coordinator = CaddyRunCoordinator::default();
        let summary = coordinator.prepare(PrepareInput {
            source: ConfigSource::Rules,
            detect: &available(&executable),
            text: "{\n\tauto_https off\n}\n",
            rules: Some(&rules),
        });
        assert_eq!(summary.listen, vec!["http://127.0.0.1:8080".to_owned()]);
        assert_eq!(summary.upstreams, vec!["http://127.0.0.1:3000".to_owned()]);
        assert_eq!(summary.blocked, None);
        assert!(summary.plan_id.is_some());
        assert_eq!(summary.working_directory, RUN_WORKING_DIRECTORY_LABEL);
    }

    #[test]
    fn prepare_blocks_without_a_usable_executable_and_stores_no_plan() {
        let coordinator = CaddyRunCoordinator::default();
        let summary = coordinator.prepare(PrepareInput {
            source: ConfigSource::Raw,
            detect: &missing(),
            text: "example.com {\n}\n",
            rules: None,
        });
        assert_eq!(summary.blocked, Some("未找到 Caddy。"));
        assert_eq!(summary.plan_id, None);
    }

    #[test]
    fn prepare_blocks_raw_text_that_declares_admin_or_external_references() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 30");
        let coordinator = CaddyRunCoordinator::default();
        let admin = prepare_raw(&coordinator, &executable, "{\n\tadmin off\n}\n");
        assert_eq!(admin.blocked, Some(BLOCKED_ADMIN));
        let external = prepare_raw(
            &coordinator,
            &executable,
            "example.com {\n\timport snippets\n}\n",
        );
        assert_eq!(external.blocked, Some(BLOCKED_EXTERNAL));
        assert_eq!(external.plan_id, None);
    }

    #[test]
    fn start_refuses_a_plan_that_was_never_prepared_or_was_already_used() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 30");
        let coordinator = CaddyRunCoordinator::default();
        let checks = scratch.checks();
        let runs = scratch.runs();
        let runner = accepting();
        let probe = Ready(false);
        let env = StartEnvironment {
            checks_root: &checks,
            runs_root: &runs,
            runner: &runner,
            probe: &probe,
        };
        let error = coordinator
            .start("not-a-plan", ConfigSource::Raw, &env)
            .expect_err("no plan");
        assert_eq!(error.code(), AppErrorCode::Conflict);
        let summary = prepare_raw(&coordinator, &executable, "example.com {\n}\n");
        let plan_id = summary.plan_id.expect("plan");
        let wrong_source = coordinator.start(&plan_id, ConfigSource::Rules, &env);
        assert!(wrong_source.is_err());
        let consumed = coordinator.start(&plan_id, ConfigSource::Raw, &env);
        assert!(consumed.is_err());
    }

    #[test]
    fn config_rejected_by_validation_never_spawns_a_process() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 30");
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        let status = start_with(
            &coordinator,
            &scratch,
            &executable,
            &rejecting(),
            &Ready(true),
        )
        .expect("status");
        assert_eq!(status.state, RunState::Failed);
        assert_eq!(status.failure, Some(FailureKind::ConfigRejected));
        assert_eq!(status.session_id, None);
        assert!(!status.diagnostics.is_empty());
        assert_eq!(fs::read_dir(scratch.runs()).expect("runs").count(), 0);
    }

    #[test]
    fn missing_caddy_at_run_time_is_reported_as_unavailable() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 30");
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        let runner = StubRunner(Err(RunFailure::Unavailable));
        let status =
            start_with(&coordinator, &scratch, &executable, &runner, &Ready(true)).expect("status");
        assert_eq!(status.failure, Some(FailureKind::ExecutableUnavailable));
        assert_eq!(
            coordinator.status().failure,
            Some(FailureKind::ExecutableUnavailable)
        );
    }

    #[test]
    fn a_ready_long_running_process_is_running_and_stop_removes_its_directory() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 30");
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        let status = start_with(
            &coordinator,
            &scratch,
            &executable,
            &accepting(),
            &Ready(true),
        )
        .expect("status");
        assert_eq!(status.state, RunState::Running);
        let stopped = coordinator.stop().expect("stop");
        assert_eq!(stopped.state, RunState::Stopped);
        assert_eq!(fs::read_dir(scratch.runs()).expect("runs").count(), 0);
    }

    #[test]
    fn a_process_that_exits_before_ready_is_failed_and_never_running() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("exit 1");
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        let status = start_with(
            &coordinator,
            &scratch,
            &executable,
            &accepting(),
            &Ready(false),
        )
        .expect("status");
        assert_eq!(status.state, RunState::Failed);
        assert_eq!(status.failure, Some(FailureKind::ExitedBeforeReady));
        assert_eq!(status.exit_code, Some(1));
    }

    #[test]
    fn a_process_that_never_becomes_ready_times_out_as_failed_not_running() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 30");
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        let status = start_with(
            &coordinator,
            &scratch,
            &executable,
            &accepting(),
            &Ready(false),
        )
        .expect("status");
        assert_eq!(status.state, RunState::Failed);
        assert_eq!(status.failure, Some(FailureKind::ReadinessTimeout));
        assert_eq!(fs::read_dir(scratch.runs()).expect("runs").count(), 0);
    }

    #[test]
    fn a_crash_after_ready_is_failed_with_the_exit_code_and_is_not_retried() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("sleep 0.3\nexit 3");
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        let started = start_with(
            &coordinator,
            &scratch,
            &executable,
            &accepting(),
            &Ready(true),
        )
        .expect("status");
        assert_eq!(started.state, RunState::Running);
        let crashed = wait_for(&coordinator, RunState::Failed);
        assert_eq!(crashed.failure, Some(FailureKind::CrashedAfterReady));
        assert_eq!(crashed.exit_code, Some(3));
    }

    #[test]
    fn a_process_ignoring_sigterm_is_killed_after_the_grace_period() {
        let scratch = Scratch::new();
        let executable = scratch.fixture("trap '' TERM\nwhile true; do sleep 1; done");
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        let started = start_with(
            &coordinator,
            &scratch,
            &executable,
            &accepting(),
            &Ready(true),
        )
        .expect("status");
        assert_eq!(started.state, RunState::Running);
        let stopped = coordinator.stop().expect("stop");
        assert_eq!(stopped.state, RunState::Stopped);
        assert_eq!(stopped.exit_signal, Some(libc::SIGKILL));
    }

    #[test]
    fn logs_are_bounded_and_report_truncation_and_resume_from_a_cursor() {
        let scratch = Scratch::new();
        let executable = scratch.fixture(
            "echo hello-from-stdout\ni=0\nwhile [ $i -lt 300 ]; do echo 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' >&2; i=$((i+1)); done\nsleep 30",
        );
        let timing = Timing {
            log_capacity: 1024,
            ..fast_timing()
        };
        let coordinator = CaddyRunCoordinator::with_timing(timing);
        let status = start_with(
            &coordinator,
            &scratch,
            &executable,
            &accepting(),
            &Ready(true),
        )
        .expect("status");
        let session_id = status.session_id.expect("session");
        thread::sleep(Duration::from_millis(500));
        let page = coordinator.logs(&session_id, 0, 0).expect("logs");
        assert!(page.stderr.starts_with("[userhome: 已截断更早的 "));
        assert!(page.stdout.contains("hello-from-stdout"));
        let next = coordinator
            .logs(&session_id, page.stdout_offset, page.stderr_offset)
            .expect("logs");
        assert_eq!(next.stdout, "");
        assert!(coordinator.logs("other-session", 0, 0).is_err());
        coordinator.stop().expect("stop");
    }

    #[test]
    fn stop_without_an_own_session_only_reports_status() {
        let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
        assert_eq!(coordinator.stop().expect("stop").state, RunState::Stopped);
    }
}
