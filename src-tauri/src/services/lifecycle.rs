//! Lifecycle actions on one UserHome-owned launchd job: load, start, stop,
//! restart, disable/enable (login auto-start override) and unload.
//!
//! The frontend sends `{action, domain, label}` and nothing else. Every preview
//! and every confirmation rediscovers the job through
//! [`ensure_modifiable`](super::ownership::ensure_modifiable) and only goes on
//! for a job UserHome created or adopted in the current user's `gui/<uid>`
//! domain; everything else is refused before any command runs. The plist path of
//! `bootstrap` and `KeepAlive` come from that rediscovery, never from the
//! request.
//!
//! Commands are the typed state-changing allow list in [`command`]; each action
//! is zero or one `launchctl` call. After the call the real state is read back
//! (`launchctl list` and `print-disabled`) and compared with what the action
//! promises. A match is a success; a mismatch is a partial or failed result and
//! an unreadable state is "unknown", which is never reported as stopped.
//!
//! `stop` is the one action with a choice. A job with `KeepAlive` is restarted
//! by launchd when its process dies, so killing the process would not stop it:
//! such a job is booted out (unloaded) and stays down until it is loaded again.
//! A job without `KeepAlive` gets `SIGTERM` and stays loaded.
//!
//! One action per job at a time: a second confirmation for a job that already
//! has an action in flight is refused (not queued). The operation history is
//! the bounded, redacted CORE-9 history.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Mutex, MutexGuard},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
        OperationStatus, sanitize_payload,
    },
};

use super::{
    launchd::{
        CommandRunner, Domain, KeepAliveMode, Label, LaunchdDomain, ReadOnlyCommand, Rejected,
        parse_launchctl_list, parse_print_disabled,
    },
    ownership::{
        Evidence, ModifiableTarget, NoAdoptions, Ownership, OwnershipAssessment, OwnershipError,
        ReadOnlyReason, ServiceRequest, ensure_modifiable_system,
    },
};

pub mod command;
#[cfg(test)]
mod tests;

use command::{MutatingCommand, MutatingRunner, StepError, SystemMutatingRunner};

/// Previews waiting for a confirmation.
pub const MAX_PENDING_ACTIONS: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleAction {
    Load,
    Start,
    Stop,
    Restart,
    Disable,
    Enable,
    Unload,
}

/// What the frontend may send: an action and a (domain, label) pair.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleRequest {
    pub action: LifecycleAction,
    pub domain: LaunchdDomain,
    pub label: String,
}

/// Where the modifiable target comes from. Production rediscovers the real
/// system through `ensure_modifiable_system`; tests rediscover fixtures.
pub trait TargetResolver: Sync {
    fn resolve(&self, request: &ServiceRequest) -> Result<ModifiableTarget, OwnershipError>;
}

pub struct SystemResolver;

impl TargetResolver for SystemResolver {
    fn resolve(&self, request: &ServiceRequest) -> Result<ModifiableTarget, OwnershipError> {
        ensure_modifiable_system(&NoAdoptions, request)
    }
}

/// How long the read-back waits for launchd to settle after a command.
#[derive(Debug, Clone, Copy)]
pub struct SettlePolicy {
    pub attempts: u32,
    pub delay: Duration,
}

impl Default for SettlePolicy {
    fn default() -> Self {
        Self {
            attempts: 6,
            delay: Duration::from_millis(500),
        }
    }
}

pub struct LifecycleHost<'a> {
    /// The current user's uid; the only `gui/<uid>` domain acted on.
    pub uid: u32,
    pub resolver: &'a dyn TargetResolver,
    /// Read-only `launchctl` for the read-back.
    pub reader: &'a dyn CommandRunner,
    pub mutator: &'a dyn MutatingRunner,
    pub settle: SettlePolicy,
}

impl LifecycleHost<'static> {
    /// The real system. Not for tests.
    pub fn system() -> Self {
        // SAFETY: getuid takes no arguments and cannot fail.
        let uid = unsafe { libc::getuid() };
        Self {
            uid,
            resolver: &SystemResolver,
            reader: &super::launchd::SystemRunner,
            mutator: &SystemMutatingRunner,
            settle: SettlePolicy::default(),
        }
    }
}

// ------------------------------------------------------------- state

/// What launchd reports now. `None` means "could not be read", never "no".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ObservedState {
    pub loaded: Option<bool>,
    pub running: Option<bool>,
    pub pid: Option<u32>,
    /// The login auto-start override; no override entry means enabled.
    pub disabled: Option<bool>,
}

/// The parts of the state an action promises; unset parts are not checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Expectation {
    pub loaded: Option<bool>,
    pub running: Option<bool>,
    pub disabled: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LifecycleOutcome {
    /// Every step ran and the read-back matches.
    Succeeded,
    /// Already in the requested state; no command ran.
    NoChange,
    /// Steps ran and the read-back is known, but only partly as promised (or the
    /// command failed yet the state is as promised).
    Partial,
    /// A step failed and the read-back shows the state is not as promised.
    Failed,
    /// The state could not be read back; nothing is claimed about it.
    Unknown,
    /// Cancelled before any step ran.
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StepStatus {
    Succeeded,
    Failed,
    TimedOut,
    NotRun,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRecord {
    /// `launchctl …` as run; built from validated parts, no secrets.
    pub command: String,
    pub status: StepStatus,
    pub exit_code: Option<i32>,
    /// First line of the tool's complaint, bounded and redacted.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecyclePreview {
    #[serde(flatten)]
    pub operation: OperationPreview,
    pub action: LifecycleAction,
    pub domain: LaunchdDomain,
    pub label: String,
    /// What the action really does to launchd.
    pub meaning: Vec<String>,
    /// What survives a logout or reboot.
    pub persistence: Vec<String>,
    /// The exact commands that will run; empty when nothing needs to run.
    pub commands: Vec<String>,
    pub current: ObservedState,
    pub keep_alive: bool,
    pub no_change: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleExecution {
    pub operation: OperationDetails,
    pub action: LifecycleAction,
    pub domain: LaunchdDomain,
    pub label: String,
    pub outcome: LifecycleOutcome,
    pub message: String,
    pub steps: Vec<StepRecord>,
    pub expected: Expectation,
    pub observed: ObservedState,
    pub cancel_requested: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleError {
    Ownership(OwnershipError),
    /// The rediscovered job is not in the current user's `gui/<uid>` domain.
    DomainMismatch,
    /// The path or label could not form an allowed command.
    Command(Rejected),
    /// launchd's state could not be read, so no plan can be made.
    StateUnknown,
    NotLoaded,
    Disabled,
    /// The state changed since the preview.
    StateChanged,
    /// Another action on this job is running.
    LabelBusy,
    TooManyPending,
}

impl From<LifecycleError> for AppError {
    fn from(error: LifecycleError) -> Self {
        match error {
            LifecycleError::Ownership(error) => AppError::from(error),
            LifecycleError::DomainMismatch => {
                AppError::not_supported("只支持当前用户 gui/<uid> 域内的任务。")
            }
            LifecycleError::Command(_) => {
                AppError::invalid_input("无法为该任务生成允许的 launchctl 命令。")
            }
            LifecycleError::StateUnknown => AppError::process_failed(
                "无法读取 launchd 的当前状态，已放弃操作；请刷新后重试。",
                true,
            ),
            LifecycleError::NotLoaded => {
                AppError::conflict("任务尚未加载。请先执行“加载”；启动不会隐式加载任务。")
            }
            LifecycleError::Disabled => AppError::conflict(
                "该任务的登录自动启动已被禁用，launchd 会拒绝加载它。请先“启用”后再加载。",
            ),
            LifecycleError::StateChanged => {
                AppError::conflict("预览之后任务的状态已变化，未执行任何命令；请重新预览。")
            }
            LifecycleError::LabelBusy => {
                AppError::conflict("同一任务已有动作正在执行，请等它结束后再确认。")
            }
            LifecycleError::TooManyPending => {
                AppError::conflict("等待确认的动作预览过多，请先确认或等待过期。")
            }
        }
    }
}

// ------------------------------------------------------------- planning

#[derive(Debug, Clone, PartialEq, Eq)]
struct Plan {
    steps: Vec<MutatingCommand>,
    expect: Expectation,
    no_change: bool,
    meaning: Vec<String>,
    persistence: Vec<String>,
}

impl Plan {
    fn commands(&self) -> Vec<String> {
        self.steps.iter().map(MutatingCommand::display).collect()
    }

    fn fingerprint(&self) -> (Vec<String>, bool) {
        (self.commands(), self.no_change)
    }
}

/// launchd's state for one job, read with the read-only allow list. A part that
/// cannot be read stays `None`.
fn observe(reader: &dyn CommandRunner, uid: u32, label: &Label) -> ObservedState {
    let jobs = reader
        .run(&ReadOnlyCommand::launchctl_list())
        .ok()
        .and_then(|text| parse_launchctl_list(&text).ok());
    let (loaded, pid) = match &jobs {
        Some(parsed) => match parsed.jobs.iter().find(|job| job.label == label.as_str()) {
            Some(job) => (Some(true), job.pid),
            None => (Some(false), None),
        },
        None => (None, None),
    };
    let disabled = reader
        .run(&ReadOnlyCommand::launchctl_print_disabled(Domain::Gui(uid)))
        .ok()
        .and_then(|text| parse_print_disabled(&text).ok())
        .map(|overrides| {
            overrides
                .entries
                .iter()
                .rev()
                .find(|(name, _)| name == label.as_str())
                .is_some_and(|(_, disabled)| *disabled)
        });
    ObservedState {
        loaded,
        running: loaded.map(|loaded| loaded && pid.is_some()),
        pid,
        disabled,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Matches,
    Mismatch,
    Unknown,
}

fn compare(expect: &Expectation, seen: &ObservedState) -> Verdict {
    let mut unknown = false;
    for (want, got) in [
        (expect.loaded, seen.loaded),
        (expect.running, seen.running),
        (expect.disabled, seen.disabled),
    ] {
        match (want, got) {
            (Some(_), None) => unknown = true,
            (Some(want), Some(got)) if want != got => return Verdict::Mismatch,
            _ => {}
        }
    }
    if unknown {
        Verdict::Unknown
    } else {
        Verdict::Matches
    }
}

fn texts(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| (*item).to_owned()).collect()
}

fn no_change(expect: Expectation, reason: &str) -> Plan {
    Plan {
        steps: Vec::new(),
        expect,
        no_change: true,
        meaning: vec![reason.to_owned(), "不会执行任何命令。".to_owned()],
        persistence: texts(&["没有任何变化。"]),
    }
}

fn expect(loaded: Option<bool>, running: Option<bool>, disabled: Option<bool>) -> Expectation {
    Expectation {
        loaded,
        running,
        disabled,
    }
}

fn build_plan(
    action: LifecycleAction,
    target: &ModifiableTarget,
    observed: &ObservedState,
    uid: u32,
) -> Result<Plan, LifecycleError> {
    let label = Label::parse(&target.label).map_err(LifecycleError::Command)?;
    let keep_alive = matches!(
        target.keep_alive,
        Some(KeepAliveMode::Always | KeepAliveMode::Conditional)
    );
    let loaded = || observed.loaded.ok_or(LifecycleError::StateUnknown);
    let step = |steps: Vec<MutatingCommand>,
                expect: Expectation,
                meaning: &[&str],
                persistence: &[&str]| Plan {
        steps,
        expect,
        no_change: false,
        meaning: texts(meaning),
        persistence: texts(persistence),
    };

    Ok(match action {
        LifecycleAction::Load => {
            if loaded()? {
                no_change(expect(Some(true), None, None), "任务已加载，无需再次加载。")
            } else if observed.disabled == Some(true) {
                return Err(LifecycleError::Disabled);
            } else {
                step(
                    vec![
                        MutatingCommand::bootstrap(uid, &target.config_path)
                            .map_err(LifecycleError::Command)?,
                    ],
                    expect(Some(true), None, None),
                    &[
                        "把配置文件交给 launchd 加载（launchctl bootstrap）。是否立即启动取决于配置里的“登录后自动启动”。",
                    ],
                    &[
                        "只影响当前登录会话的 launchd，配置文件不变。注销或重启后，launchd 仍会按 ~/Library/LaunchAgents 中的配置重新加载它（除非已禁用）。",
                    ],
                )
            }
        }
        LifecycleAction::Start => {
            if !loaded()? {
                return Err(LifecycleError::NotLoaded);
            }
            if observed.running == Some(true) {
                no_change(
                    expect(Some(true), Some(true), None),
                    "任务已在运行，无需启动。",
                )
            } else {
                step(
                    vec![MutatingCommand::kickstart(uid, &label)],
                    expect(Some(true), Some(true), None),
                    &["立即启动已加载的任务（launchctl kickstart）；不会隐式加载任务。"],
                    &["只启动当前这一次，不改变配置、加载状态或登录时的行为。"],
                )
            }
        }
        LifecycleAction::Restart => {
            if !loaded()? {
                return Err(LifecycleError::NotLoaded);
            }
            step(
                vec![MutatingCommand::kickstart_kill(uid, &label)],
                expect(Some(true), Some(true), None),
                &[
                    "先结束正在运行的实例，再重新启动（launchctl kickstart -k）。进行中的工作可能被中断。",
                ],
                &["不改变配置或加载状态，也不影响登录时的行为。"],
            )
        }
        LifecycleAction::Stop => {
            if !loaded()? {
                no_change(
                    expect(Some(false), None, None),
                    "任务未加载，没有可停止的进程。",
                )
            } else if keep_alive {
                step(
                    vec![MutatingCommand::bootout(uid, &label)],
                    expect(Some(false), None, None),
                    &[
                        "该任务配置了 KeepAlive：进程退出后 launchd 会自动重新拉起它，所以只结束进程不算停止。",
                        "将从 launchd 卸载（launchctl bootout），之后不会被自动拉起，需要再次“加载”才会运行。",
                    ],
                    &[
                        "卸载只影响当前登录会话，配置文件保留。下次登录时 launchd 仍会按配置重新加载它（除非先“禁用自启”），随后可能再次启动。",
                    ],
                )
            } else if observed.running == Some(false) {
                no_change(
                    expect(Some(true), Some(false), None),
                    "任务当前没有运行的进程，无需停止。",
                )
            } else {
                step(
                    vec![MutatingCommand::kill_term(uid, &label)],
                    expect(Some(true), Some(false), None),
                    &[
                        "向进程发送 SIGTERM（launchctl kill SIGTERM）。任务仍保持加载。",
                        "该任务没有 KeepAlive，进程退出后 launchd 不会自动重启它；定时、监视等其他触发条件仍可能再次启动它。",
                    ],
                    &["不改变配置或加载状态，也不影响下次登录时的行为。"],
                )
            }
        }
        LifecycleAction::Disable => {
            if observed.disabled == Some(true) {
                no_change(
                    expect(None, None, Some(true)),
                    "任务的登录自动启动已处于禁用状态。",
                )
            } else {
                step(
                    vec![MutatingCommand::disable(uid, &label)],
                    expect(None, None, Some(true)),
                    &[
                        "把任务的“登录自动启动”覆盖设置改为禁用（launchctl disable）。这不会停止当前正在运行的进程，也不会卸载任务。",
                    ],
                    &[
                        "该覆盖设置由 launchd 持久保存：注销或重启后 launchd 都不会自动加载它，手动“加载”也会被拒绝，直到再次启用。",
                    ],
                )
            }
        }
        LifecycleAction::Enable => {
            if observed.disabled == Some(false) {
                no_change(
                    expect(None, None, Some(false)),
                    "任务的登录自动启动已处于启用状态。",
                )
            } else {
                step(
                    vec![MutatingCommand::enable(uid, &label)],
                    expect(None, None, Some(false)),
                    &["撤销禁用覆盖（launchctl enable）。不会加载或启动任务。"],
                    &["之后登录时 launchd 会按配置自动加载该任务；要立即运行请再“加载”。"],
                )
            }
        }
        LifecycleAction::Unload => {
            if !loaded()? {
                no_change(expect(Some(false), None, None), "任务未加载，无需卸载。")
            } else {
                step(
                    vec![MutatingCommand::bootout(uid, &label)],
                    expect(Some(false), None, None),
                    &[
                        "从 launchd 卸载任务（launchctl bootout）：运行中的进程会被终止，任务不再受 launchd 管理。配置文件不会被删除。",
                    ],
                    &[
                        "配置文件仍保留在 ~/Library/LaunchAgents，下次登录时 launchd 仍会自动加载它（除非已禁用）；删除配置文件是另一项单独的操作。",
                    ],
                )
            }
        }
    })
}

fn action_title(action: LifecycleAction) -> &'static str {
    match action {
        LifecycleAction::Load => "加载",
        LifecycleAction::Start => "启动",
        LifecycleAction::Stop => "停止",
        LifecycleAction::Restart => "重启",
        LifecycleAction::Disable => "禁用自启",
        LifecycleAction::Enable => "启用自启",
        LifecycleAction::Unload => "卸载",
    }
}

/// What the read-back confirms for a promise, in words.
fn describe_expectation(expect: &Expectation) -> String {
    let mut parts = Vec::new();
    match (expect.loaded, expect.running) {
        (Some(false), _) => parts.push("任务已从 launchd 卸载"),
        (Some(true), Some(false)) => parts.push("任务仍已加载，但没有运行中的进程"),
        (Some(true), Some(true)) => parts.push("任务已加载并有运行中的进程"),
        (Some(true), None) => parts.push("任务已加载"),
        _ => {}
    }
    match expect.disabled {
        Some(true) => parts.push("登录自动启动已被禁用"),
        Some(false) => parts.push("登录自动启动已启用"),
        None => {}
    }
    parts.join("；")
}

/// The state as read, without claiming anything about the unread parts.
fn describe_observed(observed: &ObservedState) -> String {
    let loaded = match observed.loaded {
        Some(true) => "已加载".to_owned(),
        Some(false) => "未加载".to_owned(),
        None => "加载状态未知".to_owned(),
    };
    let running = match (observed.running, observed.pid) {
        (Some(true), Some(pid)) => format!("有运行中的进程（PID {pid}）"),
        (Some(true), None) => "有运行中的进程".to_owned(),
        (Some(false), _) => "没有运行中的进程".to_owned(),
        (None, _) => "进程状态未知".to_owned(),
    };
    let disabled = match observed.disabled {
        Some(true) => "登录自动启动已禁用",
        Some(false) => "登录自动启动已启用",
        None => "自启设置未知",
    };
    format!("{loaded}，{running}，{disabled}")
}

// ------------------------------------------------------------ coordinator

struct Pending {
    request: LifecycleRequest,
    /// Commands and no-change flag of the previewed plan; the confirmation must
    /// rebuild the same plan.
    fingerprint: (Vec<String>, bool),
}

struct Prepared {
    label: Label,
    keep_alive: bool,
    observed: ObservedState,
    plan: Plan,
}

/// Holds the "one action per job" slot until dropped.
struct InFlight<'a> {
    slots: &'a Mutex<HashSet<String>>,
    key: String,
}

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        if let Ok(mut slots) = self.slots.lock() {
            slots.remove(&self.key);
        }
    }
}

/// Rediscovers the job and reads its state. Nothing is changed. A request for
/// another domain than `gui` is refused before anything runs.
fn prepare(
    host: &LifecycleHost<'_>,
    request: &LifecycleRequest,
) -> Result<Prepared, LifecycleError> {
    if request.domain != LaunchdDomain::Gui {
        return Err(LifecycleError::Ownership(OwnershipError::ReadOnly(
            OwnershipAssessment {
                ownership: Ownership::SystemDaemon,
                modifiable: false,
                read_only_reasons: vec![ReadOnlyReason::SystemDaemonLocation],
                evidence: vec![Evidence::DomainSystem],
            },
        )));
    }
    let target = host
        .resolver
        .resolve(&ServiceRequest {
            domain: request.domain,
            label: request.label.clone(),
        })
        .map_err(LifecycleError::Ownership)?;
    if target.domain != LaunchdDomain::Gui
        || target.domain_target != format!("gui/{}", host.uid)
        || target.label != request.label
    {
        return Err(LifecycleError::DomainMismatch);
    }
    let label = Label::parse(&target.label).map_err(LifecycleError::Command)?;
    let observed = observe(host.reader, host.uid, &label);
    let plan = build_plan(request.action, &target, &observed, host.uid)?;
    Ok(Prepared {
        label,
        keep_alive: matches!(
            target.keep_alive,
            Some(KeepAliveMode::Always | KeepAliveMode::Conditional)
        ),
        observed,
        plan,
    })
}

fn intent(request: &LifecycleRequest, uid: u32) -> OperationIntent {
    OperationIntent::new(
        OperationKind::LaunchdLifecycle,
        format!("gui/{uid}/{}", request.label),
        BTreeMap::from([
            (
                "action".to_owned(),
                serde_json::to_value(request.action)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_default(),
            ),
            ("domain".to_owned(), "GUI".to_owned()),
            ("label".to_owned(), request.label.clone()),
        ]),
    )
}

/// Reads the state again until it matches the promise or the attempts run out.
fn settle(
    host: &LifecycleHost<'_>,
    label: &Label,
    expect: &Expectation,
) -> (ObservedState, Verdict) {
    let attempts = host.settle.attempts.max(1);
    let mut attempt = 1;
    loop {
        let observed = observe(host.reader, host.uid, label);
        let verdict = compare(expect, &observed);
        if verdict == Verdict::Matches || attempt >= attempts {
            return (observed, verdict);
        }
        attempt += 1;
        if !host.settle.delay.is_zero() {
            thread::sleep(host.settle.delay);
        }
    }
}

fn step_record(command: &MutatingCommand, status: StepStatus) -> StepRecord {
    StepRecord {
        command: command.display(),
        status,
        exit_code: None,
        detail: None,
    }
}

fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| sanitize_payload(line, 200, &[]))
}

fn finish_failed(
    operations: &OperationCoordinator,
    operation_id: &str,
    error: AppError,
) -> AppError {
    let _ = operations.finish_failure(operation_id, error.clone());
    error
}

#[derive(Default)]
pub struct LaunchdActionCoordinator {
    pending: Mutex<HashMap<String, Pending>>,
    in_flight: Mutex<HashSet<String>>,
}

impl LaunchdActionCoordinator {
    fn pending(&self) -> Result<MutexGuard<'_, HashMap<String, Pending>>, AppError> {
        self.pending.lock().map_err(|_| AppError::internal())
    }

    /// Drops previews that can no longer be confirmed.
    fn prune(&self, operations: &OperationCoordinator) -> Result<(), AppError> {
        self.pending()?.retain(|operation_id, _| {
            operations
                .get(operation_id)
                .is_ok_and(|details| details.status == OperationStatus::Previewed)
        });
        Ok(())
    }

    fn begin(&self, key: String) -> Result<InFlight<'_>, AppError> {
        let mut slots = self.in_flight.lock().map_err(|_| AppError::internal())?;
        if !slots.insert(key.clone()) {
            return Err(LifecycleError::LabelBusy.into());
        }
        Ok(InFlight {
            slots: &self.in_flight,
            key,
        })
    }

    /// Rediscovers the job, reads its state, and previews the action. Nothing
    /// is run.
    pub fn preview(
        &self,
        host: &LifecycleHost<'_>,
        operations: &OperationCoordinator,
        request: &LifecycleRequest,
    ) -> Result<LifecyclePreview, AppError> {
        let prepared = prepare(host, request).map_err(AppError::from)?;
        self.prune(operations)?;
        if self.pending()?.len() >= MAX_PENDING_ACTIONS {
            return Err(LifecycleError::TooManyPending.into());
        }
        let commands = prepared.plan.commands();
        let mut effects = prepared.plan.meaning.clone();
        effects.extend(prepared.plan.persistence.iter().cloned());
        effects.extend(commands.iter().map(|command| format!("将执行：{command}")));
        let operation = operations.preview(
            intent(request, host.uid),
            &format!("{}任务 {}", action_title(request.action), request.label),
            effects,
            false,
        )?;
        self.pending()?.insert(
            operation.operation_id.clone(),
            Pending {
                request: request.clone(),
                fingerprint: prepared.plan.fingerprint(),
            },
        );
        Ok(LifecyclePreview {
            operation,
            action: request.action,
            domain: request.domain,
            label: request.label.clone(),
            meaning: prepared.plan.meaning,
            persistence: prepared.plan.persistence,
            commands,
            current: prepared.observed,
            keep_alive: prepared.keep_alive,
            no_change: prepared.plan.no_change,
        })
    }

    /// Confirms a preview: rediscovers and re-reads, runs the planned step,
    /// reads the state back and records the result. A confirmation for a job
    /// that already has an action in flight is refused and stays usable.
    pub fn execute(
        &self,
        host: &LifecycleHost<'_>,
        operations: &OperationCoordinator,
        operation_id: &str,
    ) -> Result<LifecycleExecution, AppError> {
        let request = self
            .pending()?
            .get(operation_id)
            .map(|pending| pending.request.clone())
            .ok_or_else(AppError::operation_not_found)?;
        let _slot = self.begin(format!("gui/{}/{}", host.uid, request.label))?;
        let pending = self
            .pending()?
            .remove(operation_id)
            .ok_or_else(AppError::operation_not_found)?;

        if let Err(error) = operations.authorize_mutation(operation_id, &intent(&request, host.uid))
        {
            self.pending()?.insert(operation_id.to_owned(), pending);
            return Err(error);
        }
        operations.record_progress(operation_id, "已确认，正在重新核对任务与当前状态。")?;

        let prepared = match prepare(host, &request) {
            Ok(prepared) => prepared,
            Err(error) => return Err(finish_failed(operations, operation_id, error.into())),
        };
        if prepared.plan.fingerprint() != pending.fingerprint {
            return Err(finish_failed(
                operations,
                operation_id,
                LifecycleError::StateChanged.into(),
            ));
        }
        self.carry_out(host, operations, operation_id, &request, prepared)
    }

    fn carry_out(
        &self,
        host: &LifecycleHost<'_>,
        operations: &OperationCoordinator,
        operation_id: &str,
        request: &LifecycleRequest,
        prepared: Prepared,
    ) -> Result<LifecycleExecution, AppError> {
        let is_cancelled = || {
            operations
                .get(operation_id)
                .is_ok_and(|details| details.status == OperationStatus::Cancelling)
        };
        let Prepared {
            label,
            observed: before,
            plan,
            ..
        } = prepared;

        let mut steps: Vec<StepRecord> = Vec::new();
        let mut stdout_log = String::new();
        let mut stderr_log = String::new();
        let mut cancelled_before_work = false;
        let mut any_run = false;
        let mut any_failed = false;

        if is_cancelled() {
            cancelled_before_work = true;
            steps.extend(
                plan.steps
                    .iter()
                    .map(|command| step_record(command, StepStatus::NotRun)),
            );
        } else if plan.no_change {
            operations.record_progress(operation_id, "任务已处于目标状态，未执行任何命令。")?;
        } else {
            for command in &plan.steps {
                if any_failed {
                    steps.push(step_record(command, StepStatus::NotRun));
                    continue;
                }
                operations.record_progress(operation_id, &format!("执行 {}", command.display()))?;
                any_run = true;
                match host.mutator.run(command) {
                    Ok(output) => {
                        stdout_log.push_str(&output.stdout);
                        stderr_log.push_str(&output.stderr);
                        steps.push(step_record(command, StepStatus::Succeeded));
                    }
                    Err(error) => {
                        any_failed = true;
                        let mut record = step_record(command, StepStatus::Failed);
                        match error {
                            StepError::Timeout => {
                                record.status = StepStatus::TimedOut;
                                record.detail = Some("命令超时，已被终止。".to_owned());
                            }
                            StepError::Failed {
                                code,
                                stdout,
                                stderr,
                            } => {
                                record.exit_code = code;
                                record.detail = first_line(&stderr).or_else(|| first_line(&stdout));
                                stdout_log.push_str(&stdout);
                                stderr_log.push_str(&stderr);
                            }
                            StepError::ToolMissing => {
                                record.detail = Some("找不到 /bin/launchctl。".to_owned());
                            }
                            StepError::OutputTooLarge => {
                                record.detail = Some("命令输出超过上限。".to_owned());
                            }
                            StepError::Io => {
                                record.detail = Some("无法运行命令。".to_owned());
                            }
                        }
                        steps.push(record);
                    }
                }
            }
        }
        let cancel_requested = cancelled_before_work || is_cancelled();

        let (observed, outcome) = if cancelled_before_work {
            (before, LifecycleOutcome::Cancelled)
        } else if !any_run {
            (before, LifecycleOutcome::NoChange)
        } else {
            let (observed, verdict) = settle(host, &label, &plan.expect);
            let outcome = match (verdict, any_failed) {
                (Verdict::Unknown, _) => LifecycleOutcome::Unknown,
                (Verdict::Matches, false) => LifecycleOutcome::Succeeded,
                (Verdict::Matches, true) | (Verdict::Mismatch, false) => LifecycleOutcome::Partial,
                (Verdict::Mismatch, true) => LifecycleOutcome::Failed,
            };
            (observed, outcome)
        };

        let message = match outcome {
            LifecycleOutcome::Succeeded => {
                format!("已完成，并已通过回读确认：{}。", describe_expectation(&plan.expect))
            }
            LifecycleOutcome::NoChange => plan
                .meaning
                .first()
                .cloned()
                .unwrap_or_else(|| "任务已处于目标状态。".to_owned()),
            LifecycleOutcome::Partial => format!(
                "部分完成：回读结果与预期不完全一致（{}）。任务可能处于中间状态，请刷新核对后再决定下一步。",
                describe_observed(&observed)
            ),
            LifecycleOutcome::Failed => format!(
                "执行失败，回读显示状态未达到预期（{}）。",
                describe_observed(&observed)
            ),
            LifecycleOutcome::Unknown => "状态未知：无法读取 launchd 的当前状态，不能确认结果。这不代表已成功，也不代表已停止；请刷新核对。".to_owned(),
            LifecycleOutcome::Cancelled => "已在执行前取消，没有运行任何命令。".to_owned(),
        };

        let log = |text: &str| (!text.is_empty()).then(|| text.to_owned());
        match outcome {
            LifecycleOutcome::Succeeded | LifecycleOutcome::NoChange => {
                operations.finish_success_with_output(operation_id, Some(&message), None)?;
            }
            LifecycleOutcome::Cancelled => {
                operations.acknowledge_cancelled(operation_id)?;
            }
            LifecycleOutcome::Failed => {
                operations.finish_failure_with_output(
                    operation_id,
                    AppError::process_failed(&message, true),
                    log(&stdout_log).as_deref(),
                    log(&stderr_log).as_deref(),
                )?;
            }
            LifecycleOutcome::Partial | LifecycleOutcome::Unknown => {
                operations.finish_failure_with_output(
                    operation_id,
                    AppError::partial_failure(&message, true),
                    log(&stdout_log).as_deref(),
                    log(&stderr_log).as_deref(),
                )?;
            }
        }

        Ok(LifecycleExecution {
            operation: operations.get(operation_id)?,
            action: request.action,
            domain: request.domain,
            label: request.label.clone(),
            outcome,
            message,
            steps,
            expected: plan.expect,
            observed,
            cancel_requested,
        })
    }
}
