//! Checks made before this app starts its own Caddy instance. They read the
//! resident snapshot, probe the own listen and upstream addresses, and change
//! nothing: no launchctl, no Caddy process, no admin request. A clear result
//! means only that no conflict was found, not that binding will succeed.

use std::{
    ffi::OsString,
    io,
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    sync::atomic::AtomicBool,
    time::Duration,
};

use serde::Serialize;

use crate::{
    caddy::{
        config::CaddyRules,
        validate::{CaddyRunner, RunSpec},
    },
    services::{
        launchd::{LaunchdDomain, RunState},
        snapshot::ResidentCaddySnapshot,
    },
};

const LSOF_PATH: &str = "/usr/sbin/lsof";
const LSOF_TIMEOUT: Duration = Duration::from_secs(3);
const LSOF_MAX_BYTES: usize = 8 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_NAME_CHARS: usize = 64;

const HEADLINE_BLOCKED: &str = "发现冲突，已拒绝开启。";
const HEADLINE_UNCONFIRMED: &str = "有项目无法确认，开启需你显式确认。";
const HEADLINE_CLEAR: &str = "未发现冲突，不保证绑定成功。";

const SNAPSHOT_COMPLETE: &str = "已读取常驻 Caddy 任务快照，且快照完整。";
const SNAPSHOT_INCOMPLETE: &str =
    "快照不完整，无法确认是否还有外部常驻 Caddy，需你确认后才能开启。";
const SNAPSHOT_UNREADABLE: &str = "无法读取常驻任务快照（读取失败或另一次检查正在进行），无法确认外部 Caddy 状态，需你确认后才能开启。";
const INSTANCE_RUNNING: &str = "外部常驻 Caddy 正在运行。本应用不会停止、重载或接管它；其监听地址无法从快照确认，因此视为冲突。";
const INSTANCE_NOT_RUNNING: &str = "外部常驻 Caddy 已注册但未运行，不构成冲突。";
const INSTANCE_UNKNOWN: &str = "无法确认该任务是否在运行，需你确认后才能开启。";
const PORT_FREE: &str = "预检查未发现该地址有监听（不保证绑定成功）。";
const PORT_OCCUPIED_UNKNOWN: &str =
    "端口已被占用，占用方未知（lsof 不可用或输出无法解析），已拒绝开启。";
const PORT_UNCHECKED: &str =
    "未能检查该端口占用（探测失败），无法确认是否冲突，需你确认后才能开启。";
const UPSTREAM_REACHABLE: &str = "上游可以建立 TCP 连接。";
const UPSTREAM_UNREACHABLE: &str =
    "上游不可达（连接被拒绝或超时）。这只是提示，不等于代理进程未运行，也不阻止开启。";
const UPSTREAM_UNCHECKED: &str = "未能检查该上游（地址无法解析等）。这只是提示，不阻止开启。";
const LISTEN_UNRESOLVED: &str =
    "原文配置的监听地址无法从本应用解析，未检查端口占用，需你确认后才能开启。";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}

impl Endpoint {
    fn new(host: &str, port: u16) -> Self {
        Self {
            host: host.to_owned(),
            port,
        }
    }
}

/// The addresses to check. `listen` is `None` when the saved text does not
/// expose its listen addresses (raw configuration), so no port was checked.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConflictTargets {
    pub listen: Option<Vec<Endpoint>>,
    pub upstreams: Vec<Endpoint>,
}

impl ConflictTargets {
    pub fn for_rules(rules: Option<&CaddyRules>) -> Self {
        let Some(rules) = rules else {
            return Self::default();
        };
        let mut listen = Vec::new();
        let mut upstreams = Vec::new();
        for site in rules.sites.iter().filter(|site| site.enabled) {
            push_unique(
                &mut listen,
                Endpoint::new(&site.listen.host, site.listen.port),
            );
            for upstream in &site.upstreams {
                push_unique(&mut upstreams, Endpoint::new(&upstream.host, upstream.port));
            }
        }
        Self {
            listen: Some(listen),
            upstreams,
        }
    }
}

fn push_unique(list: &mut Vec<Endpoint>, endpoint: Endpoint) {
    if !list.contains(&endpoint) {
        list.push(endpoint);
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occupant {
    pub name: String,
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListenProbe {
    Free,
    Occupied(Option<Occupant>),
    Unchecked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpstreamProbe {
    Reachable,
    Unreachable,
    Unchecked,
}

/// Injected so tests never open a socket or run lsof.
pub trait PortProbe {
    fn listen(&self, endpoint: &Endpoint) -> ListenProbe;
    fn upstream(&self, endpoint: &Endpoint) -> UpstreamProbe;
}

pub struct SystemPortProbe<'a> {
    pub runner: &'a dyn CaddyRunner,
}

impl PortProbe for SystemPortProbe<'_> {
    fn listen(&self, endpoint: &Endpoint) -> ListenProbe {
        match connect(endpoint) {
            Connect::Connected => ListenProbe::Occupied(lsof_occupant(endpoint.port, self.runner)),
            Connect::Refused => ListenProbe::Free,
            Connect::TimedOut | Connect::Failed => ListenProbe::Unchecked,
        }
    }

    fn upstream(&self, endpoint: &Endpoint) -> UpstreamProbe {
        match connect(endpoint) {
            Connect::Connected => UpstreamProbe::Reachable,
            Connect::Refused | Connect::TimedOut => UpstreamProbe::Unreachable,
            Connect::Failed => UpstreamProbe::Unchecked,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Connect {
    Connected,
    Refused,
    TimedOut,
    Failed,
}

fn connect(endpoint: &Endpoint) -> Connect {
    let Ok(addresses) = (endpoint.host.as_str(), endpoint.port).to_socket_addrs() else {
        return Connect::Failed;
    };
    let results: Vec<Connect> = addresses
        .map(
            |address| match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
                Ok(_) => Connect::Connected,
                Err(error) => match error.kind() {
                    io::ErrorKind::ConnectionRefused => Connect::Refused,
                    io::ErrorKind::TimedOut => Connect::TimedOut,
                    _ => Connect::Failed,
                },
            },
        )
        .collect();
    if results.contains(&Connect::Connected) {
        Connect::Connected
    } else if !results.is_empty() && results.iter().all(|result| *result == Connect::Refused) {
        Connect::Refused
    } else if results.contains(&Connect::TimedOut) {
        Connect::TimedOut
    } else {
        Connect::Failed
    }
}

pub fn lsof_occupant(port: u16, runner: &dyn CaddyRunner) -> Option<Occupant> {
    let spec = RunSpec {
        executable: PathBuf::from(LSOF_PATH),
        arguments: vec![
            OsString::from("-nP"),
            OsString::from(format!("-iTCP:{port}")),
            OsString::from("-sTCP:LISTEN"),
        ],
        cwd: PathBuf::from("/"),
        environment: Vec::new(),
        timeout: LSOF_TIMEOUT,
        max_output_bytes: LSOF_MAX_BYTES,
    };
    let output = runner.run(&spec, &AtomicBool::new(false)).ok()?;
    parse_lsof(&output.stdout)
}

/// Keeps only the command name and pid columns. Arguments are never read.
pub fn parse_lsof(stdout: &[u8]) -> Option<Occupant> {
    if stdout.len() > LSOF_MAX_BYTES {
        return None;
    }
    let text = std::str::from_utf8(stdout).ok()?;
    text.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let name = fields.next()?;
        let pid = fields.next()?.parse::<u32>().ok()?;
        Some(Occupant {
            name: bounded_name(name),
            pid,
        })
    })
}

fn bounded_name(raw: &str) -> String {
    raw.chars()
        .filter(|character| !character.is_control())
        .take(MAX_NAME_CHARS)
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Verdict {
    Clear,
    Unconfirmed,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BlockReason {
    ExternalRunning,
    PortOccupied,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SnapshotStatus {
    Complete,
    Incomplete,
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalInstance {
    pub label: String,
    pub domain: LaunchdDomain,
    pub run_state: RunState,
    pub pid: Option<u32>,
    pub explanation: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalReport {
    pub snapshot: SnapshotStatus,
    pub explanation: &'static str,
    pub instances: Vec<ExternalInstance>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortState {
    Free,
    Occupied,
    Unchecked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortFinding {
    pub host: String,
    pub port: u16,
    pub state: PortState,
    pub occupant: Option<Occupant>,
    pub explanation: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UpstreamState {
    Reachable,
    Unreachable,
    Unchecked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamFinding {
    pub host: String,
    pub port: u16,
    pub state: UpstreamState,
    pub explanation: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReport {
    pub verdict: Verdict,
    pub headline: &'static str,
    pub blocks: Vec<BlockReason>,
    pub external: ExternalReport,
    pub ports: Vec<PortFinding>,
    pub upstreams: Vec<UpstreamFinding>,
    pub notes: Vec<&'static str>,
}

pub fn check_conflicts(
    targets: &ConflictTargets,
    snapshot: Option<&ResidentCaddySnapshot>,
    probe: &dyn PortProbe,
) -> ConflictReport {
    let external = external_report(snapshot);
    let ports: Vec<PortFinding> = targets
        .listen
        .iter()
        .flatten()
        .map(|endpoint| port_finding(endpoint, probe))
        .collect();
    let upstreams: Vec<UpstreamFinding> = targets
        .upstreams
        .iter()
        .map(|endpoint| upstream_finding(endpoint, probe))
        .collect();

    let mut blocks = Vec::new();
    if external
        .instances
        .iter()
        .any(|instance| instance.run_state == RunState::Running)
    {
        blocks.push(BlockReason::ExternalRunning);
    }
    if ports.iter().any(|port| port.state == PortState::Occupied) {
        blocks.push(BlockReason::PortOccupied);
    }

    let mut notes = Vec::new();
    if targets.listen.is_none() {
        notes.push(LISTEN_UNRESOLVED);
    }
    let unconfirmed = external_unconfirmed(&external)
        || targets.listen.is_none()
        || ports.iter().any(|port| port.state == PortState::Unchecked);
    let (verdict, headline) = if !blocks.is_empty() {
        (Verdict::Blocked, HEADLINE_BLOCKED)
    } else if unconfirmed {
        (Verdict::Unconfirmed, HEADLINE_UNCONFIRMED)
    } else {
        (Verdict::Clear, HEADLINE_CLEAR)
    };

    ConflictReport {
        verdict,
        headline,
        blocks,
        external,
        ports,
        upstreams,
        notes,
    }
}

fn external_report(snapshot: Option<&ResidentCaddySnapshot>) -> ExternalReport {
    let Some(snapshot) = snapshot else {
        return ExternalReport {
            snapshot: SnapshotStatus::Unreadable,
            explanation: SNAPSHOT_UNREADABLE,
            instances: Vec::new(),
        };
    };
    let (status, explanation) = if snapshot.complete {
        (SnapshotStatus::Complete, SNAPSHOT_COMPLETE)
    } else {
        (SnapshotStatus::Incomplete, SNAPSHOT_INCOMPLETE)
    };
    ExternalReport {
        snapshot: status,
        explanation,
        instances: snapshot
            .instances
            .iter()
            .map(|instance| ExternalInstance {
                label: instance.label.clone(),
                domain: instance.domain,
                run_state: instance.run_state,
                pid: instance.pid,
                explanation: instance_explanation(instance.run_state),
            })
            .collect(),
    }
}

fn instance_explanation(run_state: RunState) -> &'static str {
    match run_state {
        RunState::Running => INSTANCE_RUNNING,
        RunState::NotRunning => INSTANCE_NOT_RUNNING,
        RunState::Unknown | RunState::Inaccessible => INSTANCE_UNKNOWN,
    }
}

fn external_unconfirmed(external: &ExternalReport) -> bool {
    external.snapshot != SnapshotStatus::Complete
        || external.instances.iter().any(|instance| {
            matches!(
                instance.run_state,
                RunState::Unknown | RunState::Inaccessible
            )
        })
}

fn port_finding(endpoint: &Endpoint, probe: &dyn PortProbe) -> PortFinding {
    let (state, occupant, explanation) = match probe.listen(endpoint) {
        ListenProbe::Free => (PortState::Free, None, PORT_FREE.to_owned()),
        ListenProbe::Occupied(Some(occupant)) => {
            let explanation = format!(
                "已被进程 {}（pid {}）占用，无法绑定，已拒绝开启。",
                occupant.name, occupant.pid
            );
            (PortState::Occupied, Some(occupant), explanation)
        }
        ListenProbe::Occupied(None) => {
            (PortState::Occupied, None, PORT_OCCUPIED_UNKNOWN.to_owned())
        }
        ListenProbe::Unchecked => (PortState::Unchecked, None, PORT_UNCHECKED.to_owned()),
    };
    PortFinding {
        host: endpoint.host.clone(),
        port: endpoint.port,
        state,
        occupant,
        explanation,
    }
}

fn upstream_finding(endpoint: &Endpoint, probe: &dyn PortProbe) -> UpstreamFinding {
    let (state, explanation) = match probe.upstream(endpoint) {
        UpstreamProbe::Reachable => (UpstreamState::Reachable, UPSTREAM_REACHABLE),
        UpstreamProbe::Unreachable => (UpstreamState::Unreachable, UPSTREAM_UNREACHABLE),
        UpstreamProbe::Unchecked => (UpstreamState::Unchecked, UPSTREAM_UNCHECKED),
    };
    UpstreamFinding {
        host: endpoint.host.clone(),
        port: endpoint.port,
        state,
        explanation,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartRefusal {
    Blocked(BlockReason),
    Unconfirmed,
}

impl StartRefusal {
    pub fn code(self) -> &'static str {
        match self {
            Self::Blocked(BlockReason::ExternalRunning) => "EXTERNAL_RUNNING",
            Self::Blocked(BlockReason::PortOccupied) => "PORT_OCCUPIED",
            Self::Unconfirmed => "UNCONFIRMED",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Blocked(BlockReason::ExternalRunning) => {
                "检测到外部常驻 Caddy 正在运行，已拒绝开启。本应用不会停止、重载或接管它。"
            }
            Self::Blocked(BlockReason::PortOccupied) => {
                "自有配置的监听端口已被占用，已拒绝开启。请查看占用方后再试。"
            }
            Self::Unconfirmed => "无法确认外部 Caddy 或端口状态。确认风险后可选择仍然开启。",
        }
    }
}

/// Blocks are never bypassed. An unconfirmed result is bypassed only by an
/// explicit acceptance from the user.
pub fn start_gate(report: &ConflictReport, accept_unconfirmed: bool) -> Option<StartRefusal> {
    if let Some(reason) = report.blocks.first() {
        return Some(StartRefusal::Blocked(*reason));
    }
    match report.verdict {
        Verdict::Unconfirmed if !accept_unconfirmed => Some(StartRefusal::Unconfirmed),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use super::*;
    use crate::{
        caddy::{
            config::{Listen, RULES_VERSION, SiteRule, Upstream, UpstreamScheme},
            validate::{RunFailure, RunOutput},
        },
        services::{
            launchd::{LaunchdScope, LoadState},
            ownership::Ownership,
            snapshot::{ConfigLocation, ResidentCaddyInstance, UnknownReason},
        },
    };

    #[derive(Default)]
    struct FakeProbe {
        listen: Vec<(Endpoint, ListenProbe)>,
        upstream: Vec<(Endpoint, UpstreamProbe)>,
    }

    impl PortProbe for FakeProbe {
        fn listen(&self, endpoint: &Endpoint) -> ListenProbe {
            self.listen
                .iter()
                .find(|(candidate, _)| candidate == endpoint)
                .map(|(_, state)| state.clone())
                .unwrap_or(ListenProbe::Free)
        }

        fn upstream(&self, endpoint: &Endpoint) -> UpstreamProbe {
            self.upstream
                .iter()
                .find(|(candidate, _)| candidate == endpoint)
                .map(|(_, state)| *state)
                .unwrap_or(UpstreamProbe::Reachable)
        }
    }

    struct RecordingRunner {
        result: Result<RunOutput, RunFailure>,
        calls: RefCell<usize>,
    }

    impl RecordingRunner {
        fn answering(stdout: &[u8]) -> Self {
            Self {
                result: Ok(RunOutput {
                    success: true,
                    stdout: stdout.to_vec(),
                    stderr: Vec::new(),
                }),
                calls: RefCell::new(0),
            }
        }

        fn failing(failure: RunFailure) -> Self {
            Self {
                result: Err(failure),
                calls: RefCell::new(0),
            }
        }
    }

    impl CaddyRunner for RecordingRunner {
        fn run(&self, spec: &RunSpec, _cancel: &AtomicBool) -> Result<RunOutput, RunFailure> {
            *self.calls.borrow_mut() += 1;
            assert_eq!(spec.executable, PathBuf::from("/usr/sbin/lsof"));
            assert_eq!(
                spec.arguments,
                vec![
                    OsString::from("-nP"),
                    OsString::from("-iTCP:8080"),
                    OsString::from("-sTCP:LISTEN"),
                ]
            );
            assert_eq!(spec.timeout, Duration::from_secs(3));
            assert_eq!(spec.max_output_bytes, 8 * 1024);
            assert!(spec.environment.is_empty());
            self.result.clone()
        }
    }

    fn endpoint(host: &str, port: u16) -> Endpoint {
        Endpoint::new(host, port)
    }

    fn targets(listen: &[(&str, u16)], upstreams: &[(&str, u16)]) -> ConflictTargets {
        ConflictTargets {
            listen: Some(listen.iter().map(|(h, p)| endpoint(h, *p)).collect()),
            upstreams: upstreams.iter().map(|(h, p)| endpoint(h, *p)).collect(),
        }
    }

    fn resident(label: &str, run_state: RunState, pid: Option<u32>) -> ResidentCaddyInstance {
        ResidentCaddyInstance {
            label: label.to_owned(),
            domain: LaunchdDomain::Gui,
            scope: LaunchdScope::UserAgent,
            ownership: Ownership::ThirdParty,
            plist_path: None,
            executable: None,
            arguments: Vec::new(),
            adapter: None,
            config: ConfigLocation {
                path: None,
                flag: None,
                unknown_reason: Some(UnknownReason::Missing),
            },
            load_state: LoadState::Loaded,
            run_state,
            pid,
            observed_at_ms: 1,
            complete: true,
            incomplete_reasons: Vec::new(),
        }
    }

    fn snapshot(instances: Vec<ResidentCaddyInstance>, complete: bool) -> ResidentCaddySnapshot {
        ResidentCaddySnapshot {
            observed_at_ms: 1,
            complete,
            can_conclude_absence: complete,
            sources: Vec::new(),
            instances,
        }
    }

    fn occupied_by(name: &str, pid: u32) -> ListenProbe {
        ListenProbe::Occupied(Some(Occupant {
            name: name.to_owned(),
            pid,
        }))
    }

    #[test]
    fn running_external_caddy_blocks_even_when_ports_are_free_and_cannot_be_accepted() {
        let snap = snapshot(
            vec![resident("homebrew.mxcl.caddy", RunState::Running, Some(77))],
            true,
        );
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[]),
            Some(&snap),
            &FakeProbe::default(),
        );
        assert_eq!(report.verdict, Verdict::Blocked);
        assert_eq!(report.blocks, vec![BlockReason::ExternalRunning]);
        assert_eq!(report.external.instances[0].explanation, INSTANCE_RUNNING);
        assert_eq!(report.external.instances[0].pid, Some(77));
        assert_eq!(
            start_gate(&report, true),
            Some(StartRefusal::Blocked(BlockReason::ExternalRunning))
        );
    }

    #[test]
    fn complete_snapshot_with_only_a_stopped_external_instance_is_clear() {
        let snap = snapshot(
            vec![resident("homebrew.mxcl.caddy", RunState::NotRunning, None)],
            true,
        );
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[]),
            Some(&snap),
            &FakeProbe::default(),
        );
        assert_eq!(report.verdict, Verdict::Clear);
        assert!(report.blocks.is_empty());
        assert_eq!(start_gate(&report, false), None);
    }

    #[test]
    fn no_resident_caddy_and_free_ports_is_clear_with_the_non_guarantee_headline() {
        let snap = snapshot(Vec::new(), true);
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[]),
            Some(&snap),
            &FakeProbe::default(),
        );
        assert_eq!(report.verdict, Verdict::Clear);
        assert_eq!(report.headline, "未发现冲突，不保证绑定成功。");
        assert!(!report.headline.contains("端口可用"));
        assert_eq!(report.ports[0].state, PortState::Free);
        assert!(report.ports[0].explanation.contains("不保证绑定成功"));
        assert!(!report.ports[0].explanation.contains("端口可用"));
    }

    #[test]
    fn occupied_own_port_blocks_and_names_the_occupant() {
        let snap = snapshot(Vec::new(), true);
        let probe = FakeProbe {
            listen: vec![(endpoint("127.0.0.1", 8080), occupied_by("node", 4242))],
            upstream: Vec::new(),
        };
        let report = check_conflicts(&targets(&[("127.0.0.1", 8080)], &[]), Some(&snap), &probe);
        assert_eq!(report.verdict, Verdict::Blocked);
        assert_eq!(report.blocks, vec![BlockReason::PortOccupied]);
        assert_eq!(report.ports[0].state, PortState::Occupied);
        assert_eq!(
            report.ports[0].occupant,
            Some(Occupant {
                name: "node".to_owned(),
                pid: 4242
            })
        );
        assert!(report.ports[0].explanation.contains("pid 4242"));
        assert_eq!(
            start_gate(&report, true),
            Some(StartRefusal::Blocked(BlockReason::PortOccupied))
        );
    }

    #[test]
    fn occupied_port_with_unknown_occupant_says_so_instead_of_guessing() {
        let snap = snapshot(Vec::new(), true);
        let probe = FakeProbe {
            listen: vec![(endpoint("127.0.0.1", 8080), ListenProbe::Occupied(None))],
            upstream: Vec::new(),
        };
        let report = check_conflicts(&targets(&[("127.0.0.1", 8080)], &[]), Some(&snap), &probe);
        assert_eq!(report.verdict, Verdict::Blocked);
        assert_eq!(report.ports[0].occupant, None);
        assert_eq!(report.ports[0].explanation, PORT_OCCUPIED_UNKNOWN);
    }

    #[test]
    fn incomplete_snapshot_needs_an_explicit_confirmation_and_never_passes_silently() {
        let snap = snapshot(Vec::new(), false);
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[]),
            Some(&snap),
            &FakeProbe::default(),
        );
        assert_eq!(report.verdict, Verdict::Unconfirmed);
        assert_eq!(report.external.snapshot, SnapshotStatus::Incomplete);
        assert_eq!(start_gate(&report, false), Some(StartRefusal::Unconfirmed));
        assert_eq!(start_gate(&report, true), None);
    }

    #[test]
    fn unreadable_snapshot_is_unconfirmed_not_absent() {
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[]),
            None,
            &FakeProbe::default(),
        );
        assert_eq!(report.verdict, Verdict::Unconfirmed);
        assert_eq!(report.external.snapshot, SnapshotStatus::Unreadable);
        assert_eq!(report.external.explanation, SNAPSHOT_UNREADABLE);
        assert_eq!(start_gate(&report, false), Some(StartRefusal::Unconfirmed));
    }

    #[test]
    fn instance_with_unknown_run_state_is_unconfirmed() {
        let snap = snapshot(
            vec![resident("homebrew.mxcl.caddy", RunState::Unknown, None)],
            true,
        );
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[]),
            Some(&snap),
            &FakeProbe::default(),
        );
        assert_eq!(report.verdict, Verdict::Unconfirmed);
        assert_eq!(report.external.instances[0].explanation, INSTANCE_UNKNOWN);
    }

    #[test]
    fn unchecked_port_is_unconfirmed_and_not_counted_as_free() {
        let snap = snapshot(Vec::new(), true);
        let probe = FakeProbe {
            listen: vec![(endpoint("127.0.0.1", 8080), ListenProbe::Unchecked)],
            upstream: Vec::new(),
        };
        let report = check_conflicts(&targets(&[("127.0.0.1", 8080)], &[]), Some(&snap), &probe);
        assert_eq!(report.verdict, Verdict::Unconfirmed);
        assert_eq!(report.ports[0].state, PortState::Unchecked);
        assert_eq!(report.ports[0].explanation, PORT_UNCHECKED);
    }

    #[test]
    fn raw_source_without_listen_addresses_is_unconfirmed_and_says_no_port_was_checked() {
        let snap = snapshot(Vec::new(), true);
        let report = check_conflicts(
            &ConflictTargets::default(),
            Some(&snap),
            &FakeProbe::default(),
        );
        assert_eq!(report.verdict, Verdict::Unconfirmed);
        assert!(report.ports.is_empty());
        assert_eq!(report.notes, vec![LISTEN_UNRESOLVED]);
    }

    #[test]
    fn unreachable_upstream_is_only_a_note_and_does_not_block_or_confirm() {
        let snap = snapshot(Vec::new(), true);
        let probe = FakeProbe {
            listen: Vec::new(),
            upstream: vec![(endpoint("127.0.0.1", 9000), UpstreamProbe::Unreachable)],
        };
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[("127.0.0.1", 9000)]),
            Some(&snap),
            &probe,
        );
        assert_eq!(report.verdict, Verdict::Clear);
        assert_eq!(report.upstreams[0].state, UpstreamState::Unreachable);
        assert!(
            report.upstreams[0]
                .explanation
                .contains("不等于代理进程未运行")
        );
        assert_eq!(start_gate(&report, false), None);
    }

    #[test]
    fn unchecked_upstream_is_reported_without_blocking() {
        let snap = snapshot(Vec::new(), true);
        let probe = FakeProbe {
            listen: Vec::new(),
            upstream: vec![(endpoint("missing.invalid", 9000), UpstreamProbe::Unchecked)],
        };
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[("missing.invalid", 9000)]),
            Some(&snap),
            &probe,
        );
        assert_eq!(report.upstreams[0].state, UpstreamState::Unchecked);
        assert_eq!(report.verdict, Verdict::Clear);
    }

    #[test]
    fn blocked_verdict_takes_precedence_over_unconfirmed() {
        let report = check_conflicts(
            &targets(&[("127.0.0.1", 8080)], &[]),
            None,
            &FakeProbe {
                listen: vec![(endpoint("127.0.0.1", 8080), occupied_by("caddy", 5))],
                upstream: Vec::new(),
            },
        );
        assert_eq!(report.verdict, Verdict::Blocked);
        assert_eq!(
            start_gate(&report, true),
            Some(StartRefusal::Blocked(BlockReason::PortOccupied))
        );
    }

    #[test]
    fn external_block_is_reported_before_port_block_when_both_apply() {
        let snap = snapshot(
            vec![resident("homebrew.mxcl.caddy", RunState::Running, Some(9))],
            true,
        );
        let probe = FakeProbe {
            listen: vec![(endpoint("127.0.0.1", 8080), occupied_by("caddy", 9))],
            upstream: Vec::new(),
        };
        let report = check_conflicts(&targets(&[("127.0.0.1", 8080)], &[]), Some(&snap), &probe);
        assert_eq!(
            report.blocks,
            vec![BlockReason::ExternalRunning, BlockReason::PortOccupied]
        );
        assert_eq!(
            start_gate(&report, false),
            Some(StartRefusal::Blocked(BlockReason::ExternalRunning))
        );
    }

    #[test]
    fn refusal_codes_and_messages_are_stable_and_say_nothing_is_stopped_for_external_runs() {
        assert_eq!(
            StartRefusal::Blocked(BlockReason::ExternalRunning).code(),
            "EXTERNAL_RUNNING"
        );
        assert_eq!(
            StartRefusal::Blocked(BlockReason::PortOccupied).code(),
            "PORT_OCCUPIED"
        );
        assert_eq!(StartRefusal::Unconfirmed.code(), "UNCONFIRMED");
        assert!(
            StartRefusal::Blocked(BlockReason::ExternalRunning)
                .message()
                .contains("不会停止")
        );
    }

    #[test]
    fn disabled_sites_are_not_checked_and_duplicates_are_collapsed() {
        let site = |enabled: bool, port: u16| SiteRule {
            enabled,
            listen: Listen {
                host: "127.0.0.1".to_owned(),
                port,
            },
            upstreams: vec![Upstream {
                scheme: UpstreamScheme::Http,
                host: "127.0.0.1".to_owned(),
                port: 9000,
            }],
        };
        let rules = CaddyRules {
            version: RULES_VERSION,
            sites: vec![site(true, 8080), site(false, 8081), site(true, 8080)],
        };
        let targets = ConflictTargets::for_rules(Some(&rules));
        assert_eq!(targets.listen, Some(vec![endpoint("127.0.0.1", 8080)]));
        assert_eq!(targets.upstreams, vec![endpoint("127.0.0.1", 9000)]);
        assert_eq!(ConflictTargets::for_rules(None).listen, None);
    }

    #[test]
    fn lsof_output_yields_only_the_command_name_and_pid() {
        let stdout = b"COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME\n\
caddy    4242 user    7u  IPv4 0xabc      0t0  TCP 127.0.0.1:8080 (LISTEN)\n";
        assert_eq!(
            parse_lsof(stdout),
            Some(Occupant {
                name: "caddy".to_owned(),
                pid: 4242
            })
        );
    }

    #[test]
    fn lsof_output_without_listeners_or_with_bad_pid_is_unknown() {
        assert_eq!(parse_lsof(b""), None);
        assert_eq!(
            parse_lsof(b"COMMAND PID USER\nnode notanumber user\n"),
            None
        );
    }

    #[test]
    fn lsof_output_over_the_limit_is_ignored_even_when_it_starts_with_a_listener() {
        let mut stdout = b"caddy 1 user 7u IPv4 0x0 0t0 TCP 127.0.0.1:8080 (LISTEN)\n".to_vec();
        stdout.resize(8 * 1024 + 1, b' ');
        assert_eq!(parse_lsof(&stdout), None);
    }

    #[test]
    fn overlong_or_control_character_names_are_bounded() {
        let long = format!("{}\u{7}", "a".repeat(100));
        let stdout = format!("{long} 12 user 1u IPv4 x x TCP x (LISTEN)\n");
        let occupant = parse_lsof(stdout.as_bytes()).expect("occupant");
        assert_eq!(occupant.name.chars().count(), MAX_NAME_CHARS);
        assert!(occupant.name.chars().all(|c| !c.is_control()));
        assert_eq!(occupant.pid, 12);
    }

    #[test]
    fn lsof_occupant_runs_only_the_fixed_lsof_query_once() {
        let runner = RecordingRunner::answering(
            b"COMMAND PID USER\ncaddy 4242 user 7u IPv4 0x0 0t0 TCP 127.0.0.1:8080 (LISTEN)\n",
        );
        let occupant = lsof_occupant(8080, &runner);
        assert_eq!(*runner.calls.borrow(), 1);
        assert_eq!(
            occupant,
            Some(Occupant {
                name: "caddy".to_owned(),
                pid: 4242
            })
        );
    }

    #[test]
    fn lsof_failure_or_oversized_output_reports_the_occupant_as_unknown() {
        let timed_out = RecordingRunner::failing(RunFailure::Timeout);
        assert_eq!(lsof_occupant(8080, &timed_out), None);
        let too_large = RecordingRunner::failing(RunFailure::OutputTooLarge);
        assert_eq!(lsof_occupant(8080, &too_large), None);
    }
}
