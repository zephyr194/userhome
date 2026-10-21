use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::AtomicBool,
    thread,
    time::{Duration, Instant},
};

use uuid::Uuid;

use crate::{
    caddy::{
        config::TlsConfig,
        conflict::{ConflictTargets, Endpoint},
        detect::{DetectReport, DetectStatus},
        session::{
            AdminProbe, CaddyRunCoordinator, ConfigSource, PrepareInput, RunState, RunStatus,
            StartEnvironment, Timing, owned_label,
        },
        tls::TlsPaths,
        validate::{CaddyRunner, RunFailure, RunOutput, RunSpec},
    },
    error::AppError,
    lifecycle::{LifecycleCoordinator, QuitDecision, QuitOutcome},
    process_session::DEFAULT_LOG_CAPACITY,
};

struct Ready(bool);

impl AdminProbe for Ready {
    fn is_ready(&self, _socket: &Path) -> bool {
        self.0
    }
}

struct Accepting;

impl CaddyRunner for Accepting {
    fn run(&self, _spec: &RunSpec, _cancel: &AtomicBool) -> Result<RunOutput, RunFailure> {
        Ok(RunOutput {
            success: true,
            stdout: b"{}".to_vec(),
            stderr: Vec::new(),
        })
    }
}

fn no_tls(_: &[TlsConfig]) -> Result<Vec<TlsPaths>, AppError> {
    Ok(Vec::new())
}

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("userhome-owned-{}", Uuid::new_v4()));
        fs::create_dir_all(path.join("runs")).expect("scratch runs");
        fs::create_dir_all(path.join("checks")).expect("scratch checks");
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

    fn run_directories(&self) -> usize {
        fs::read_dir(self.runs()).expect("runs").count()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
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

fn lifecycle() -> LifecycleCoordinator {
    LifecycleCoordinator::default()
        .with_stop_timeouts(Duration::from_millis(300), Duration::from_secs(2))
}

fn start_on(
    coordinator: &CaddyRunCoordinator,
    scratch: &Scratch,
    executable: &Path,
    lifecycle: &LifecycleCoordinator,
    probe: &dyn AdminProbe,
) -> Result<RunStatus, AppError> {
    let detect = DetectReport {
        status: DetectStatus::Available,
        executable_path: Some(executable.display().to_string()),
        version: Some("v2.8.4 fixture".to_owned()),
        guidance: None,
        candidates: Vec::new(),
    };
    let summary = coordinator.prepare(PrepareInput {
        source: ConfigSource::Raw,
        detect: &detect,
        text: "example.com {\n}\n",
        rules: None,
    });
    let plan_id = summary.plan_id.expect("plan");
    let checks = scratch.checks();
    let runs = scratch.runs();
    coordinator.start(
        &plan_id,
        ConfigSource::Raw,
        &StartEnvironment {
            checks_root: &checks,
            runs_root: &runs,
            runner: &Accepting,
            probe,
            tls: &no_tls,
            owned: lifecycle.registry(),
        },
    )
}

fn endpoint(host: &str, port: u16) -> Endpoint {
    Endpoint {
        host: host.to_owned(),
        port,
    }
}

#[test]
fn owned_label_names_the_instance_and_its_listen_summary() {
    let unknown = ConflictTargets {
        listen: None,
        upstreams: Vec::new(),
    };
    assert_eq!(owned_label(&unknown), "Caddy 自有实例（监听 地址未知）");

    let one = ConflictTargets {
        listen: Some(vec![endpoint("127.0.0.1", 8080)]),
        upstreams: Vec::new(),
    };
    assert_eq!(owned_label(&one), "Caddy 自有实例（监听 127.0.0.1:8080）");

    let two = ConflictTargets {
        listen: Some(vec![
            endpoint("127.0.0.1", 8080),
            endpoint("127.0.0.1", 8443),
        ]),
        upstreams: Vec::new(),
    };
    assert_eq!(
        owned_label(&two),
        "Caddy 自有实例（监听 127.0.0.1:8080 等 2 个地址）"
    );
}

#[test]
fn a_running_instance_is_registered_and_leaves_the_registry_once_it_is_stopped() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 30");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();

    let status = start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");

    assert_eq!(status.state, RunState::Running);
    assert_eq!(lifecycle.registry().running_count(), 1);
    coordinator.stop().expect("stop");
    assert_eq!(lifecycle.registry().running_count(), 0);
}

#[test]
fn an_instance_that_never_becomes_ready_is_failed_and_leaves_nothing_registered() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 30");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();

    let status = start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(false),
    )
    .expect("status");

    assert_eq!(status.state, RunState::Failed);
    assert_eq!(lifecycle.registry().running_count(), 0);
    assert_eq!(scratch.run_directories(), 0);
}

#[test]
fn a_running_instance_is_asked_about_before_quit_and_nothing_is_stopped_by_the_request() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 30");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();
    start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");

    assert_eq!(
        lifecycle.request_quit(),
        QuitDecision::Confirm { process_count: 1 }
    );

    assert_eq!(coordinator.status().state, RunState::Running);
    assert_eq!(lifecycle.registry().running_count(), 1);
    coordinator.stop().expect("cleanup");
}

#[test]
fn cancel_quit_leaves_the_instance_running_and_registered() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 30");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();
    start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");
    lifecycle.request_quit();

    lifecycle.cancel_quit().expect("cancel");

    assert_eq!(coordinator.status().state, RunState::Running);
    assert_eq!(lifecycle.registry().running_count(), 1);
    coordinator.stop().expect("cleanup");
}

#[test]
fn stop_and_quit_stops_the_instance_removes_its_directories_and_lets_the_quit_through() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 30");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();
    start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");
    assert_eq!(
        lifecycle.request_quit(),
        QuitDecision::Confirm { process_count: 1 }
    );

    let outcome = lifecycle.confirm_quit().expect("confirm");

    assert_eq!(outcome, QuitOutcome::ReadyToExit { stopped: 1 });
    assert_eq!(coordinator.status().state, RunState::Stopped);
    assert_eq!(scratch.run_directories(), 0);
}

#[test]
fn an_instance_that_ignores_term_is_killed_after_the_grace_and_the_quit_still_proceeds() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("trap '' TERM\nsleep 30");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();
    start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");
    lifecycle.request_quit();

    let outcome = lifecycle.confirm_quit().expect("confirm");

    assert_eq!(outcome, QuitOutcome::ReadyToExit { stopped: 1 });
    assert_eq!(coordinator.status().state, RunState::Stopped);
    assert_eq!(lifecycle.registry().running_count(), 0);
}

#[test]
fn an_instance_that_exits_by_itself_no_longer_blocks_the_quit() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 0.2");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();
    start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match lifecycle.request_quit() {
            QuitDecision::Proceed => break,
            _ if Instant::now() >= deadline => panic!("an exited instance still blocks the quit"),
            _ => thread::sleep(Duration::from_millis(50)),
        }
    }
    assert_eq!(lifecycle.registry().running_count(), 0);
}

#[test]
fn exit_hook_stops_a_live_instance_and_removes_its_directories() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 30");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();
    start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");

    coordinator.shutdown();

    assert_eq!(coordinator.status().state, RunState::Stopped);
    assert_eq!(scratch.run_directories(), 0);
    assert_eq!(lifecycle.registry().running_count(), 0);
}

#[test]
fn exit_hook_without_an_instance_does_nothing() {
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());

    coordinator.shutdown();

    assert_eq!(coordinator.status().state, RunState::Stopped);
}

#[test]
fn exit_hook_never_signals_an_unrelated_process_even_with_a_similar_name() {
    let scratch = Scratch::new();
    let executable = scratch.fixture("sleep 30");
    let similar = scratch.fixture("sleep 30");
    let mut foreign = Command::new(&similar).spawn().expect("foreign process");
    let coordinator = CaddyRunCoordinator::with_timing(fast_timing());
    let lifecycle = lifecycle();
    start_on(
        &coordinator,
        &scratch,
        &executable,
        &lifecycle,
        &Ready(true),
    )
    .expect("start");

    coordinator.shutdown();

    let still_running = foreign.try_wait().expect("try_wait").is_none();
    let _ = foreign.kill();
    let _ = foreign.wait();
    assert!(still_running, "an unrelated process was signalled");
}
