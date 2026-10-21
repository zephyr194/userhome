//! Controlled own-process sessions.
//!
//! A [`ProcessSession`] owns one child started from an absolute executable, an
//! argument array, an explicit working directory and an explicit environment
//! (the environment is cleared first; only names the caller listed are passed).
//! The child leads its own process group, its stdout/stderr go into bounded
//! ring buffers with a visible truncation marker, and it is stopped by signalling
//! the whole group (SIGTERM, then SIGKILL) and confirming the exit.
//!
//! Identity rule: the group id equals the leader pid, and a pid cannot be reused
//! while the leader is unreaped. The monitor therefore observes the leader's exit
//! *without* reaping it (`waitid` + `WNOWAIT`), kills the rest of the group while
//! the pid is still reserved, and only then reaps. Every signal is sent under the
//! session lock after checking that the leader has not been reaped, so a stale
//! handle can never signal an unrelated process that reused the pid.
//!
//! This module is mechanism only: it exposes no IPC command and never runs a
//! shell.

use std::{
    collections::VecDeque,
    fmt, fs,
    io::{self, Read},
    os::unix::{
        fs::PermissionsExt,
        process::{CommandExt, ExitStatusExt},
    },
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError},
    thread,
    time::Duration,
};

pub const DEFAULT_LOG_CAPACITY: usize = 2 * 1024 * 1024;

const READ_CHUNK: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionError {
    InvalidExecutable,
    InvalidWorkingDirectory,
    InvalidArgument,
    InvalidEnvironment,
    Spawn,
    Io,
}

/// Environment for a child: cleared first, then only these names are set.
///
/// `inherit` names are copied from this process when present; `set` entries carry
/// explicit values. `Debug` prints names only so values never reach logs.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct EnvSpec {
    inherit: Vec<String>,
    set: Vec<(String, String)>,
}

impl EnvSpec {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn inherit(mut self, name: impl Into<String>) -> Self {
        self.inherit.push(name.into());
        self
    }

    pub fn set(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.set.push((name.into(), value.into()));
        self
    }

    pub fn validate(&self) -> Result<(), SessionError> {
        let name_ok = |name: &str| !name.is_empty() && !name.contains(['=', '\0']);
        let names_ok = self.inherit.iter().all(|name| name_ok(name));
        let sets_ok = self
            .set
            .iter()
            .all(|(name, value)| name_ok(name) && !value.contains('\0'));
        if names_ok && sets_ok {
            Ok(())
        } else {
            Err(SessionError::InvalidEnvironment)
        }
    }

    fn apply(&self, command: &mut Command) {
        command.env_clear();
        for name in &self.inherit {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        for (name, value) in &self.set {
            command.env(name, value);
        }
    }
}

impl fmt::Debug for EnvSpec {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let set_names: Vec<&str> = self.set.iter().map(|(name, _)| name.as_str()).collect();
        formatter
            .debug_struct("EnvSpec")
            .field("inherit", &self.inherit)
            .field("set", &set_names)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    executable: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    env: EnvSpec,
    log_capacity: usize,
}

impl LaunchSpec {
    pub fn new(executable: impl Into<PathBuf>, cwd: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            args: Vec::new(),
            cwd: cwd.into(),
            env: EnvSpec::new(),
            log_capacity: DEFAULT_LOG_CAPACITY,
        }
    }

    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.args = args.into_iter().map(Into::into).collect();
        self
    }

    pub fn env(mut self, env: EnvSpec) -> Self {
        self.env = env;
        self
    }

    /// Capacity of each of the stdout and stderr ring buffers (at least one byte).
    pub fn log_capacity(mut self, bytes: usize) -> Self {
        self.log_capacity = bytes.max(1);
        self
    }

    pub fn validate(&self) -> Result<(), SessionError> {
        let executable_ok = self.executable.is_absolute()
            && fs::metadata(&self.executable)
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0);
        if !executable_ok {
            return Err(SessionError::InvalidExecutable);
        }
        let cwd_ok = self.cwd.is_absolute() && self.cwd.is_dir();
        if !cwd_ok {
            return Err(SessionError::InvalidWorkingDirectory);
        }
        if self.args.iter().any(|arg| arg.contains('\0')) {
            return Err(SessionError::InvalidArgument);
        }
        self.env.validate()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionState {
    Starting,
    Running,
    Stopping,
    Exited,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExitInfo {
    pub code: Option<i32>,
    pub signal: Option<i32>,
}

impl From<ExitStatus> for ExitInfo {
    fn from(status: ExitStatus) -> Self {
        Self {
            code: status.code(),
            signal: status.signal(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionStatus {
    pub state: SessionState,
    pub exit: Option<ExitInfo>,
    pub stop_requested: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopOutcome {
    /// The leader had already exited and been reaped; nothing was signalled.
    AlreadyExited(ExitInfo),
    /// The group was signalled and the leader's exit was confirmed.
    Terminated {
        exit: ExitInfo,
        escalated_to_kill: bool,
    },
    /// No reliable exit result; the session is reported as `Unknown`.
    Unconfirmed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogSnapshot {
    bytes: Vec<u8>,
    dropped_bytes: u64,
}

impl LogSnapshot {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn dropped_bytes(&self) -> u64 {
        self.dropped_bytes
    }

    pub fn is_truncated(&self) -> bool {
        self.dropped_bytes > 0
    }

    /// Lossy text, prefixed with a visible marker when older output was dropped.
    pub fn text(&self) -> String {
        let body = String::from_utf8_lossy(&self.bytes);
        if self.is_truncated() {
            format!(
                "[userhome: {} earlier bytes truncated]\n{body}",
                self.dropped_bytes
            )
        } else {
            body.into_owned()
        }
    }
}

struct RingBuffer {
    data: VecDeque<u8>,
    capacity: usize,
    dropped: u64,
}

impl RingBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            data: VecDeque::new(),
            capacity,
            dropped: 0,
        }
    }

    fn push(&mut self, chunk: &[u8]) {
        let chunk = if chunk.len() > self.capacity {
            let skipped = chunk.len() - self.capacity;
            self.dropped += skipped as u64;
            &chunk[skipped..]
        } else {
            chunk
        };
        let overflow = (self.data.len() + chunk.len()).saturating_sub(self.capacity);
        if overflow > 0 {
            self.data.drain(..overflow);
            self.dropped += overflow as u64;
        }
        self.data.extend(chunk);
    }

    fn snapshot(&self) -> LogSnapshot {
        LogSnapshot {
            bytes: self.data.iter().copied().collect(),
            dropped_bytes: self.dropped,
        }
    }
}

struct Inner {
    state: SessionState,
    leader_pid: i32,
    pgid: i32,
    /// True once the leader has been reaped; no signal may be sent afterwards.
    reaped: bool,
    exit: Option<ExitInfo>,
    stop_requested: bool,
}

struct Shared {
    inner: Mutex<Inner>,
    changed: Condvar,
    stdout: Mutex<RingBuffer>,
    stderr: Mutex<RingBuffer>,
}

impl Shared {
    fn new(leader_pid: i32, log_capacity: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: SessionState::Starting,
                leader_pid,
                pgid: leader_pid,
                reaped: false,
                exit: None,
                stop_requested: false,
            }),
            changed: Condvar::new(),
            stdout: Mutex::new(RingBuffer::new(log_capacity)),
            stderr: Mutex::new(RingBuffer::new(log_capacity)),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Handle to one own process. Dropping the handle force-kills a still-running
/// group so no unaccounted process is left behind.
pub struct ProcessSession {
    id: String,
    shared: Arc<Shared>,
}

impl fmt::Debug for ProcessSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProcessSession")
            .field("id", &self.id)
            .field("state", &self.status().state)
            .finish()
    }
}

/// Transforms each output stream before its bytes enter the bounded buffer, so
/// text that must never be kept is never stored. `finish` flushes what a filter
/// still holds once the stream ends.
pub trait OutputFilter: Send {
    fn push(&mut self, chunk: &[u8]) -> Vec<u8>;
    fn finish(&mut self) -> Vec<u8>;
}

struct PassThrough;

impl OutputFilter for PassThrough {
    fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        chunk.to_vec()
    }

    fn finish(&mut self) -> Vec<u8> {
        Vec::new()
    }
}

impl ProcessSession {
    pub fn start(spec: &LaunchSpec) -> Result<Self, SessionError> {
        Self::start_filtered(spec, &|| Box::new(PassThrough))
    }

    /// Each stream gets its own filter from `filter`.
    pub fn start_filtered(
        spec: &LaunchSpec,
        filter: &dyn Fn() -> Box<dyn OutputFilter>,
    ) -> Result<Self, SessionError> {
        spec.validate()?;
        let mut command = grouped_command(
            &spec.executable,
            spec.args.iter().map(String::as_str),
            Some(&spec.cwd),
            Some(&spec.env),
        );
        let mut child = command.spawn().map_err(|_| SessionError::Spawn)?;
        let Ok(pid) = i32::try_from(child.id()) else {
            kill_and_reap(&mut child, None);
            return Err(SessionError::Io);
        };
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            kill_and_reap(&mut child, Some(pid));
            return Err(SessionError::Io);
        };

        let shared = Arc::new(Shared::new(pid, spec.log_capacity));
        // The monitor thread takes the child out of this slot; if any thread
        // fails to start, the child is still here to be killed and reaped.
        let slot = Arc::new(Mutex::new(Some(child)));
        let spawned = spawn_pump(&shared, stdout, Stream::Stdout, filter()).is_ok()
            && spawn_pump(&shared, stderr, Stream::Stderr, filter()).is_ok()
            && spawn_monitor(&shared, &slot).is_ok();
        if !spawned {
            let child = slot.lock().unwrap_or_else(PoisonError::into_inner).take();
            if let Some(mut child) = child {
                kill_and_reap(&mut child, Some(pid));
            }
            return Err(SessionError::Io);
        }
        {
            let mut inner = shared.lock();
            if inner.state == SessionState::Starting {
                inner.state = SessionState::Running;
            }
        }
        Ok(Self {
            id: uuid::Uuid::new_v4().to_string(),
            shared,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn pid(&self) -> u32 {
        u32::try_from(self.shared.lock().leader_pid).unwrap_or(0)
    }

    pub fn status(&self) -> SessionStatus {
        let inner = self.shared.lock();
        SessionStatus {
            state: inner.state,
            exit: inner.exit,
            stop_requested: inner.stop_requested,
        }
    }

    pub fn stdout(&self) -> LogSnapshot {
        self.shared
            .stdout
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .snapshot()
    }

    pub fn stderr(&self) -> LogSnapshot {
        self.shared
            .stderr
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .snapshot()
    }

    /// Waits for a reliable exit result; `None` if it does not arrive in time.
    pub fn wait(&self, timeout: Duration) -> Option<ExitInfo> {
        let inner = self.shared.lock();
        let (inner, _) = self
            .shared
            .changed
            .wait_timeout_while(inner, timeout, |inner| !inner.reaped)
            .unwrap_or_else(PoisonError::into_inner);
        inner.exit
    }

    /// Stops the whole process group: SIGTERM, then SIGKILL after `grace`, and
    /// waits up to `kill_timeout` more for the exit. Reports `Terminated` only
    /// with a reliable exit result.
    pub fn stop(&self, grace: Duration, kill_timeout: Duration) -> StopOutcome {
        let shared = &self.shared;
        let mut inner = shared.lock();
        if inner.reaped {
            return inner
                .exit
                .map_or(StopOutcome::Unconfirmed, StopOutcome::AlreadyExited);
        }
        if !leader_is_ours(inner.leader_pid, inner.pgid) {
            inner.state = SessionState::Unknown;
            return StopOutcome::Unconfirmed;
        }
        inner.state = SessionState::Stopping;
        inner.stop_requested = true;
        // A failed SIGTERM is not final: the leader may be exiting right now.
        let _ = signal_group(inner.pgid, GroupSignal::Terminate);

        let (guard, _) = shared
            .changed
            .wait_timeout_while(inner, grace, |inner| !inner.reaped)
            .unwrap_or_else(PoisonError::into_inner);
        inner = guard;
        if let Some(exit) = inner.exit.filter(|_| inner.reaped) {
            return StopOutcome::Terminated {
                exit,
                escalated_to_kill: false,
            };
        }
        if inner.reaped {
            return StopOutcome::Unconfirmed;
        }
        if !leader_is_ours(inner.leader_pid, inner.pgid) {
            inner.state = SessionState::Unknown;
            return StopOutcome::Unconfirmed;
        }
        let _ = signal_group(inner.pgid, GroupSignal::Kill);

        let (guard, _) = shared
            .changed
            .wait_timeout_while(inner, kill_timeout, |inner| !inner.reaped)
            .unwrap_or_else(PoisonError::into_inner);
        inner = guard;
        if let Some(exit) = inner.exit.filter(|_| inner.reaped) {
            return StopOutcome::Terminated {
                exit,
                escalated_to_kill: true,
            };
        }
        if !inner.reaped {
            inner.state = SessionState::Unknown;
        }
        StopOutcome::Unconfirmed
    }
}

impl Drop for ProcessSession {
    fn drop(&mut self) {
        let inner = self.shared.lock();
        if !inner.reaped && leader_is_ours(inner.leader_pid, inner.pgid) {
            let _ = signal_group(inner.pgid, GroupSignal::Kill);
        }
    }
}

#[derive(Clone, Copy)]
enum Stream {
    Stdout,
    Stderr,
}

fn spawn_pump(
    shared: &Arc<Shared>,
    mut reader: impl Read + Send + 'static,
    stream: Stream,
    mut filter: Box<dyn OutputFilter>,
) -> Result<(), ()> {
    let shared = Arc::clone(shared);
    thread::Builder::new()
        .name("process-session-log".into())
        .spawn(move || {
            let mut buffer = [0_u8; READ_CHUNK];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => push_output(&shared, stream, &filter.push(&buffer[..read])),
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }
            push_output(&shared, stream, &filter.finish());
        })
        .map(|_| ())
        .map_err(|_| ())
}

fn push_output(shared: &Shared, stream: Stream, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let target = match stream {
        Stream::Stdout => &shared.stdout,
        Stream::Stderr => &shared.stderr,
    };
    target
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(bytes);
}

/// Starts the monitor thread, which takes the child from `slot` and is the only
/// place that reaps it.
fn spawn_monitor(shared: &Arc<Shared>, slot: &Arc<Mutex<Option<Child>>>) -> Result<(), ()> {
    let slot = Arc::clone(slot);
    let shared = Arc::clone(shared);
    thread::Builder::new()
        .name("process-session-monitor".into())
        .spawn(move || {
            let child = slot.lock().unwrap_or_else(PoisonError::into_inner).take();
            if let Some(child) = child {
                monitor(&shared, child);
            }
        })
        .map(|_| ())
        .map_err(|_| ())
}

fn monitor(shared: &Shared, mut child: Child) {
    // Take the pid first: the lock must not be held while blocking in waitid.
    let leader_pid = shared.lock().leader_pid;
    let observed = peek_exit(leader_pid, true);
    let mut inner = shared.lock();
    match observed {
        Ok(_) => {
            // Leader is a zombie, so its pid (= pgid) is still reserved: kill any
            // remaining group members before reaping.
            let _ = signal_group(inner.pgid, GroupSignal::Kill);
            finish(&mut inner, child.wait());
        }
        // Could not observe without reaping: fall back to a plain wait.
        Err(_) => {
            drop(inner);
            let result = child.wait();
            inner = shared.lock();
            finish(&mut inner, result);
        }
    }
    drop(inner);
    shared.changed.notify_all();
}

fn finish(inner: &mut Inner, result: io::Result<ExitStatus>) {
    inner.reaped = true;
    match result {
        Ok(status) => {
            inner.exit = Some(status.into());
            inner.state = SessionState::Exited;
        }
        Err(_) => inner.state = SessionState::Unknown,
    }
}

// ---- crate-internal helpers shared with the one-shot runner -----------------

/// Builds a shell-free command in its own process group with a cleared,
/// explicit environment (or the inherited one when `env` is `None`), null
/// stdin and piped stdout/stderr.
pub(crate) fn grouped_command<'a>(
    executable: &Path,
    args: impl IntoIterator<Item = &'a str>,
    cwd: Option<&Path>,
    env: Option<&EnvSpec>,
) -> Command {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // setpgid(0, 0) in the child before exec: new group led by the child.
        .process_group(0);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    if let Some(env) = env {
        env.apply(&mut command);
    }
    command
}

#[derive(Clone, Copy)]
pub(crate) enum GroupSignal {
    Terminate,
    Kill,
}

/// Signals a whole process group. The caller must hold an unreaped leader (or
/// otherwise know the group is ours); refuses ids that could hit the caller's
/// own group or everything.
pub(crate) fn signal_group(pgid: i32, signal: GroupSignal) -> io::Result<()> {
    if pgid <= 1 || pgid == current_group() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    let signal = match signal {
        GroupSignal::Terminate => libc::SIGTERM,
        GroupSignal::Kill => libc::SIGKILL,
    };
    // SAFETY: killpg only takes two integers and touches no memory; `pgid` was
    // checked above to be neither 0/1 nor this process's own group.
    let result = unsafe { libc::killpg(pgid, signal) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn current_group() -> i32 {
    // SAFETY: getpgrp has no arguments, cannot fail and touches no memory.
    unsafe { libc::getpgrp() }
}

/// True when the unreaped leader `pid` still leads group `pgid`. A zombie leader
/// (ESRCH) still reserves its pid, so it counts as ours.
pub(crate) fn leader_is_ours(pid: i32, pgid: i32) -> bool {
    // SAFETY: getpgid takes one integer and touches no memory.
    let group = unsafe { libc::getpgid(pid) };
    if group >= 0 {
        return group == pgid;
    }
    io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}

/// Waits (or, with `block == false`, polls) for child `pid` to exit without
/// reaping it. `Ok(true)` means the exit was observed.
pub(crate) fn peek_exit(pid: i32, block: bool) -> io::Result<bool> {
    let Ok(id) = libc::id_t::try_from(pid) else {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    };
    let mut options = libc::WEXITED | libc::WNOWAIT;
    if !block {
        options |= libc::WNOHANG;
    }
    loop {
        // SAFETY: siginfo_t is a plain C struct of integers and one raw pointer;
        // all-zero is a valid value, and zero also means "no state change".
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // SAFETY: `info` is a valid exclusive pointer for the whole call, and
        // `pid` is a child of this process (WNOWAIT leaves it unreaped).
        let result = unsafe { libc::waitid(libc::P_PID, id, &mut info, options) };
        if result == 0 {
            return Ok(info.si_signo != 0);
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
    }
}

/// Kills the child's group (when its pid is known) and reaps it.
pub(crate) fn kill_and_reap(child: &mut Child, pid: Option<i32>) {
    if let Some(pid) = pid {
        let _ = signal_group(pid, GroupSignal::Kill);
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exit_info() -> ExitInfo {
        ExitInfo {
            code: Some(0),
            signal: None,
        }
    }

    fn bystander() -> Child {
        let mut command = Command::new("/bin/sleep");
        command
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        command.spawn().expect("spawn bystander")
    }

    fn is_alive(child: &mut Child) -> bool {
        matches!(child.try_wait(), Ok(None))
    }

    fn forged(pid: i32, pgid: i32, reaped: bool, exit: Option<ExitInfo>) -> ProcessSession {
        let shared = Arc::new(Shared::new(pid, 16));
        {
            let mut inner = shared.lock();
            inner.pgid = pgid;
            inner.reaped = reaped;
            inner.exit = exit;
            inner.state = if reaped {
                SessionState::Exited
            } else {
                SessionState::Running
            };
        }
        ProcessSession {
            id: "forged".into(),
            shared,
        }
    }

    #[test]
    fn ring_buffer_keeps_only_the_newest_bytes_and_counts_dropped() {
        let mut buffer = RingBuffer::new(8);
        buffer.push(b"abcdef");
        buffer.push(b"ghij");
        buffer.push(b"0123456789ABCDEF");
        let snapshot = buffer.snapshot();
        assert_eq!(snapshot.bytes(), b"89ABCDEF");
        assert_eq!(snapshot.dropped_bytes(), 6 + 4 + 8);
        assert!(
            snapshot
                .text()
                .starts_with("[userhome: 18 earlier bytes truncated]\n")
        );
    }

    #[test]
    fn process_env_spec_debug_never_prints_values() {
        let env = EnvSpec::new().inherit("PATH").set("TOKEN", "super-secret");
        let printed = format!("{env:?}");
        assert!(printed.contains("TOKEN"));
        assert!(!printed.contains("super-secret"));
    }

    #[test]
    fn process_stale_handle_never_signals_a_live_unrelated_group() {
        let mut other = bystander();
        let other_pid = i32::try_from(other.id()).expect("pid");
        // The handle claims a group that is now someone else's, and is reaped.
        let session = forged(other_pid, other_pid, true, Some(exit_info()));

        let outcome = session.stop(Duration::from_millis(50), Duration::from_millis(50));

        assert_eq!(outcome, StopOutcome::AlreadyExited(exit_info()));
        assert!(is_alive(&mut other));
        drop(session);
        assert!(is_alive(&mut other));
        let _ = other.kill();
        let _ = other.wait();
    }

    #[test]
    fn process_identity_mismatch_refuses_to_signal_and_reports_unknown() {
        let mut first = bystander();
        let mut second = bystander();
        let first_pid = i32::try_from(first.id()).expect("pid");
        let second_pid = i32::try_from(second.id()).expect("pid");
        // Leader pid belongs to `second`, but the recorded group is `first`'s.
        let session = forged(second_pid, first_pid, false, None);

        let outcome = session.stop(Duration::from_millis(50), Duration::from_millis(50));

        assert_eq!(outcome, StopOutcome::Unconfirmed);
        assert_eq!(session.status().state, SessionState::Unknown);
        assert!(is_alive(&mut first));
        assert!(is_alive(&mut second));
        drop(session);
        assert!(is_alive(&mut first));
        assert!(is_alive(&mut second));
        for child in [&mut first, &mut second] {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    #[test]
    fn process_stop_without_a_reliable_exit_result_is_unknown_not_exited() {
        let mut child = bystander();
        let pid = i32::try_from(child.id()).expect("pid");
        // Nobody reaps this child, so no exit result can ever be confirmed.
        let session = forged(pid, pid, false, None);

        let outcome = session.stop(Duration::from_millis(100), Duration::from_millis(100));

        assert_eq!(outcome, StopOutcome::Unconfirmed);
        let status = session.status();
        assert_eq!(status.state, SessionState::Unknown);
        assert_eq!(status.exit, None);
        assert!(status.stop_requested);
        let _ = child.wait();
    }

    #[test]
    fn process_launch_spec_rejects_relative_missing_and_non_executable_targets() {
        let cwd = std::env::temp_dir();
        for executable in ["sleep", "/nonexistent/for/process/tests", "/etc/hosts"] {
            assert_eq!(
                LaunchSpec::new(executable, &cwd).validate(),
                Err(SessionError::InvalidExecutable),
                "{executable}"
            );
        }
        assert_eq!(
            LaunchSpec::new("/bin/sleep", "relative/dir").validate(),
            Err(SessionError::InvalidWorkingDirectory)
        );
        assert_eq!(
            LaunchSpec::new("/bin/sleep", "/nonexistent/for/process/tests").validate(),
            Err(SessionError::InvalidWorkingDirectory)
        );
        assert_eq!(
            LaunchSpec::new("/bin/sleep", &cwd)
                .args(["a\0b"])
                .validate(),
            Err(SessionError::InvalidArgument)
        );
        assert_eq!(
            LaunchSpec::new("/bin/sleep", &cwd)
                .env(EnvSpec::new().set("A=B", "x"))
                .validate(),
            Err(SessionError::InvalidEnvironment)
        );
    }
}
