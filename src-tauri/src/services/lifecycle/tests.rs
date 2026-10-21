//! Lifecycle actions over fixtures only: temporary directories stand in for the
//! LaunchAgents locations, and one recording fake plays launchd. It answers
//! `launchctl list` and `print-disabled`, converts plists by file name, and
//! applies state-changing commands to an in-memory world. No test runs
//! `launchctl` or `plutil`, loads or stops a real job, or touches a real
//! LaunchAgents directory. File owners come from the process's own uid, so
//! "another user's file" is simulated by claiming a different current uid.

use std::{
    collections::HashMap,
    fs,
    os::unix::fs::symlink,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        mpsc::{Receiver, Sender, channel},
    },
    thread,
    time::Duration,
};

use uuid::Uuid;

use super::{
    command::{MutatingCommand, StepOutput},
    *,
};
use crate::{
    error::AppErrorCode,
    operations::{OperationEvent, OperationStatus},
    services::{
        launchd::{Discovery, Limits, ReadOnlyCommand, RunError, ScanLocations},
        ownership::{NoAdoptions, ensure_modifiable},
    },
};

const JOB: &str = "com.zephyr194.userhome.agent.demo";
const SECRET_ENV: &str = "sup3rs3cretvalue";
const SECRET_ARG: &str = "hunter2hunter2";

fn real_uid() -> u32 {
    // SAFETY: getuid takes no arguments and cannot fail.
    unsafe { libc::getuid() }
}

// ------------------------------------------------------------- the fake

#[derive(Default)]
struct World {
    loaded: bool,
    pid: Option<u32>,
    disabled: Option<bool>,
    /// Fail the Nth `list` read (1-based).
    list_fails_on_read: Option<usize>,
    list_reads: usize,
    list_fails_after_writes: bool,
    print_disabled_fails_after_writes: bool,
    step_error: Option<StepError>,
    /// The failing command still took effect before it reported the failure.
    step_error_applies: bool,
    /// `kill SIGTERM` ends the process.
    kill_stops: bool,
    /// After `kickstart`, the process shows up after this many `list` reads.
    pid_appears_after_reads: u32,
    appearing: Option<(u32, u32)>,
    writes: usize,
}

struct Gate {
    started: Sender<()>,
    release: Receiver<()>,
}

enum Dir {
    User,
    GlobalAgent,
    Daemon,
    AppleAgent,
}

struct Env {
    root: PathBuf,
    uid: u32,
    plists: Mutex<HashMap<String, String>>,
    world: Mutex<World>,
    events: Mutex<Vec<String>>,
    on_list: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    gate: Mutex<Option<Gate>>,
}

fn plist_json(label: &str, keep_alive: Option<&str>) -> String {
    let keep = keep_alive
        .map(|value| format!(r#","KeepAlive":{value}"#))
        .unwrap_or_default();
    format!(
        r#"{{"Label":"{label}","ProgramArguments":["/usr/bin/true","--password={SECRET_ARG}"],"EnvironmentVariables":{{"API_TOKEN":"{SECRET_ENV}"}}{keep}}}"#
    )
}

impl Env {
    fn build(label: &str, dir: Dir, json: String, uid: u32) -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-lifecycle-{}", Uuid::new_v4()));
        for name in [
            "home/Library/LaunchAgents",
            "Library/LaunchAgents",
            "Library/LaunchDaemons",
            "System/Library/LaunchAgents",
            "System/Library/LaunchDaemons",
        ] {
            fs::create_dir_all(root.join(name)).expect("create directory");
        }
        let file_name = format!("{label}.plist");
        let folder = match dir {
            Dir::User => "home/Library/LaunchAgents",
            Dir::GlobalAgent => "Library/LaunchAgents",
            Dir::Daemon => "Library/LaunchDaemons",
            Dir::AppleAgent => "System/Library/LaunchAgents",
        };
        fs::write(root.join(folder).join(&file_name), b"bplist00 placeholder")
            .expect("write plist");
        let env = Self {
            root,
            uid,
            plists: Mutex::new(HashMap::from([(file_name, json)])),
            world: Mutex::new(World {
                kill_stops: true,
                ..World::default()
            }),
            events: Mutex::new(Vec::new()),
            on_list: Mutex::new(None),
            gate: Mutex::new(None),
        };
        // Discovery only trusts a domain whose directories it could read.
        env
    }

    /// A UserHome-created job with the given `KeepAlive` JSON value.
    fn job(keep_alive: Option<&str>) -> Self {
        Self::build(JOB, Dir::User, plist_json(JOB, keep_alive), real_uid())
    }

    fn loaded(self, pid: Option<u32>) -> Self {
        {
            let mut world = self.world.lock().expect("world");
            world.loaded = true;
            world.pid = pid;
        }
        self
    }

    fn world(&self) -> std::sync::MutexGuard<'_, World> {
        self.world.lock().expect("world")
    }

    fn user_file(&self) -> PathBuf {
        self.root
            .join("home/Library/LaunchAgents")
            .join(format!("{JOB}.plist"))
    }

    fn events(&self) -> Vec<String> {
        self.events.lock().expect("events").clone()
    }

    fn writes(&self) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|event| event.strip_prefix("write ").map(str::to_owned))
            .collect()
    }

    fn lifecycle_reads(&self) -> usize {
        self.events()
            .iter()
            .filter(|event| *event == "read print-disabled")
            .count()
    }

    fn host(&self) -> LifecycleHost<'_> {
        LifecycleHost {
            uid: self.uid,
            resolver: self,
            reader: self,
            mutator: self,
            settle: SettlePolicy {
                attempts: 3,
                delay: Duration::ZERO,
            },
        }
    }

    fn set_hook(&self, hook: Arc<dyn Fn() + Send + Sync>) {
        *self.on_list.lock().expect("hook") = Some(hook);
    }

    fn set_gate(&self, started: Sender<()>, release: Receiver<()>) {
        *self.gate.lock().expect("gate") = Some(Gate { started, release });
    }

    fn log(&self, event: String) {
        self.events.lock().expect("events").push(event);
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

impl TargetResolver for Env {
    fn resolve(&self, request: &ServiceRequest) -> Result<ModifiableTarget, OwnershipError> {
        ensure_modifiable(
            &Discovery {
                uid: self.uid,
                home: Some(self.root.join("home")),
                locations: ScanLocations {
                    user_agents: Some(self.root.join("home/Library/LaunchAgents")),
                    global_agents: self.root.join("Library/LaunchAgents"),
                    global_daemons: self.root.join("Library/LaunchDaemons"),
                    apple_agents: self.root.join("System/Library/LaunchAgents"),
                    apple_daemons: self.root.join("System/Library/LaunchDaemons"),
                },
                runner: self,
                limits: Limits::default(),
            },
            &NoAdoptions,
            request,
        )
    }
}

impl CommandRunner for Env {
    fn tool_available(&self, _: &str) -> bool {
        true
    }

    fn run(&self, command: &ReadOnlyCommand) -> Result<String, RunError> {
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        match (command.executable(), args.as_slice()) {
            ("/bin/launchctl", ["list"]) => {
                let hook = self.on_list.lock().expect("hook").clone();
                if let Some(hook) = hook {
                    hook();
                }
                self.log("read list".to_owned());
                let mut world = self.world();
                world.list_reads += 1;
                if world.list_fails_on_read == Some(world.list_reads)
                    || (world.list_fails_after_writes && world.writes > 0)
                {
                    return Err(RunError::Failed);
                }
                if let Some((pid, left)) = world.appearing {
                    if left == 0 {
                        world.pid = Some(pid);
                        world.appearing = None;
                    } else {
                        world.appearing = Some((pid, left - 1));
                    }
                }
                let mut text = "PID\tStatus\tLabel\n".to_owned();
                if world.loaded {
                    let pid = world.pid.map_or("-".to_owned(), |pid| pid.to_string());
                    text.push_str(&format!("{pid}\t0\t{JOB}\n"));
                }
                Ok(text)
            }
            ("/bin/launchctl", ["print", "system"]) => {
                Ok("system = {\n\tservices = {\n\t}\n}\n".to_owned())
            }
            ("/bin/launchctl", ["print-disabled", domain]) => {
                assert_eq!(*domain, format!("gui/{}", self.uid));
                self.log("read print-disabled".to_owned());
                let world = self.world();
                if world.print_disabled_fails_after_writes && world.writes > 0 {
                    return Err(RunError::Failed);
                }
                let mut text = "disabled services = {\n".to_owned();
                match world.disabled {
                    Some(true) => text.push_str(&format!("\t\"{JOB}\" => disabled\n")),
                    Some(false) => text.push_str(&format!("\t\"{JOB}\" => enabled\n")),
                    None => {}
                }
                text.push_str("}\n");
                Ok(text)
            }
            ("/usr/bin/plutil", [.., path]) => {
                self.log("plutil".to_owned());
                let name = Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("file name");
                self.plists
                    .lock()
                    .expect("plists")
                    .get(name)
                    .cloned()
                    .ok_or(RunError::Failed)
            }
            other => panic!("unexpected read command {other:?}"),
        }
    }
}

impl MutatingRunner for Env {
    fn run(&self, command: &MutatingCommand) -> Result<StepOutput, StepError> {
        // Whatever the executor builds must pass the allow list unchanged.
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        assert_eq!(
            MutatingCommand::checked(self.uid, &args).as_ref(),
            Ok(command),
            "command outside the allow list: {args:?}"
        );
        self.log(format!("write {}", command.display()));
        let gate = self.gate.lock().expect("gate").take();
        if let Some(gate) = gate {
            gate.started.send(()).expect("started");
            gate.release.recv().expect("release");
        }
        let mut world = self.world();
        let failure = world.step_error.clone();
        world.writes += 1;
        if let Some(error) = failure.clone().filter(|_| !world.step_error_applies) {
            return Err(error);
        }
        match command.verb() {
            "bootstrap" => {
                if world.disabled == Some(true) {
                    return Err(StepError::Failed {
                        code: Some(119),
                        stdout: String::new(),
                        stderr: "Bootstrap failed: 119: Service is disabled".to_owned(),
                    });
                }
                world.loaded = true;
            }
            "bootout" => {
                world.loaded = false;
                world.pid = None;
            }
            "kickstart" => {
                let pid = if command.args().iter().any(|arg| arg == "-k") {
                    901
                } else {
                    900
                };
                if world.pid_appears_after_reads == 0 {
                    world.pid = Some(pid);
                } else {
                    let reads = world.pid_appears_after_reads;
                    world.appearing = Some((pid, reads));
                }
            }
            "kill" => {
                if world.kill_stops {
                    world.pid = None;
                }
            }
            "enable" => world.disabled = Some(false),
            "disable" => world.disabled = Some(true),
            other => panic!("unexpected verb {other}"),
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(StepOutput::default()),
        }
    }
}

// -------------------------------------------------------------- helpers

fn request(action: LifecycleAction, label: &str) -> LifecycleRequest {
    LifecycleRequest {
        action,
        domain: LaunchdDomain::Gui,
        label: label.to_owned(),
    }
}

fn job_request(action: LifecycleAction) -> LifecycleRequest {
    request(action, JOB)
}

fn code(error: &AppError) -> AppErrorCode {
    error.code()
}

fn message(error: &AppError) -> String {
    serde_json::to_value(error)
        .expect("error json")
        .get("message")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_owned()
}

fn target(env: &Env) -> String {
    format!("gui/{}/{JOB}", env.uid)
}

struct Run {
    coordinator: LaunchdActionCoordinator,
    operations: OperationCoordinator,
}

impl Run {
    fn new() -> Self {
        Self {
            coordinator: LaunchdActionCoordinator::default(),
            operations: OperationCoordinator::default(),
        }
    }

    fn preview(&self, env: &Env, action: LifecycleAction) -> Result<LifecyclePreview, AppError> {
        self.coordinator
            .preview(&env.host(), &self.operations, &job_request(action))
    }

    fn execute(&self, env: &Env, operation_id: &str) -> Result<LifecycleExecution, AppError> {
        self.coordinator
            .execute(&env.host(), &self.operations, operation_id)
    }

    /// Preview, then confirm.
    fn act(&self, env: &Env, action: LifecycleAction) -> LifecycleExecution {
        let preview = self.preview(env, action).expect("preview");
        self.execute(env, &preview.operation.operation_id)
            .expect("execute")
    }

    fn status(&self, execution: &LifecycleExecution) -> OperationStatus {
        self.operations
            .get(&execution.operation.operation_id)
            .expect("operation")
            .status
    }
}

fn finished(details: &OperationDetails) -> (OperationStatus, Option<AppError>, Option<String>) {
    match details.events.last() {
        Some(OperationEvent::Finished {
            status,
            error,
            stderr_summary,
            ..
        }) => (*status, error.clone(), stderr_summary.clone()),
        other => panic!("no finished event: {other:?}"),
    }
}

// ----------------------------------------------------- argv per action

#[test]
fn load_runs_bootstrap_with_the_path_the_backend_found_and_confirms_it() {
    let env = Env::job(None);
    let run = Run::new();

    let preview = run.preview(&env, LifecycleAction::Load).expect("preview");
    assert_eq!(preview.current.loaded, Some(false));
    assert_eq!(
        preview.commands,
        [format!(
            "launchctl bootstrap gui/{} {}",
            env.uid,
            env.user_file().display()
        )]
    );
    assert!(!preview.meaning.is_empty());
    assert!(!preview.persistence.is_empty());
    assert!(env.writes().is_empty(), "a preview runs nothing");

    let execution = run
        .execute(&env, &preview.operation.operation_id)
        .expect("execute");
    assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(execution.observed.loaded, Some(true));
    assert_eq!(execution.steps.len(), 1);
    assert_eq!(execution.steps[0].status, StepStatus::Succeeded);
    assert_eq!(
        env.writes(),
        [format!(
            "launchctl bootstrap gui/{} {}",
            env.uid,
            env.user_file().display()
        )]
    );
    assert_eq!(run.status(&execution), OperationStatus::Succeeded);
}

#[test]
fn loading_an_already_loaded_job_says_so_and_runs_nothing() {
    let env = Env::job(None).loaded(None);
    let run = Run::new();

    let preview = run.preview(&env, LifecycleAction::Load).expect("preview");
    assert!(preview.no_change);
    assert!(preview.commands.is_empty());

    let execution = run
        .execute(&env, &preview.operation.operation_id)
        .expect("execute");
    assert_eq!(execution.outcome, LifecycleOutcome::NoChange);
    assert!(
        execution.message.contains("已加载"),
        "{}",
        execution.message
    );
    assert!(execution.steps.is_empty());
    assert!(env.writes().is_empty());
    assert_eq!(run.status(&execution), OperationStatus::Succeeded);
}

#[test]
fn loading_a_disabled_job_is_refused_before_any_command() {
    let env = Env::job(None);
    env.world().disabled = Some(true);
    let run = Run::new();

    let error = run
        .preview(&env, LifecycleAction::Load)
        .expect_err("refused");
    assert_eq!(code(&error), AppErrorCode::Conflict);
    assert!(message(&error).contains("启用"), "{}", message(&error));
    assert!(env.writes().is_empty());
}

#[test]
fn start_kickstarts_a_loaded_job_and_never_loads_one_implicitly() {
    let env = Env::job(None).loaded(None);
    let run = Run::new();
    let execution = run.act(&env, LifecycleAction::Start);
    assert_eq!(
        env.writes(),
        [format!("launchctl kickstart {}", target(&env))]
    );
    assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(execution.observed.running, Some(true));
    assert_eq!(execution.observed.pid, Some(900));

    let not_loaded = Env::job(None);
    let error = run
        .preview(&not_loaded, LifecycleAction::Start)
        .expect_err("needs load first");
    assert_eq!(code(&error), AppErrorCode::Conflict);
    assert!(message(&error).contains("加载"), "{}", message(&error));
    assert!(not_loaded.writes().is_empty(), "no implicit bootstrap");
}

#[test]
fn starting_a_job_that_already_runs_changes_nothing() {
    let env = Env::job(None).loaded(Some(700));
    let run = Run::new();
    let execution = run.act(&env, LifecycleAction::Start);
    assert_eq!(execution.outcome, LifecycleOutcome::NoChange);
    assert!(env.writes().is_empty());
}

#[test]
fn restart_uses_kickstart_k() {
    let env = Env::job(None).loaded(Some(700));
    let run = Run::new();
    let execution = run.act(&env, LifecycleAction::Restart);
    assert_eq!(
        env.writes(),
        [format!("launchctl kickstart -k {}", target(&env))]
    );
    assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(execution.observed.pid, Some(901));
}

#[test]
fn disable_and_enable_only_change_the_auto_start_override() {
    let env = Env::job(None).loaded(Some(700));
    let run = Run::new();

    let preview = run
        .preview(&env, LifecycleAction::Disable)
        .expect("preview disable");
    let text = preview.meaning.join("\n") + &preview.persistence.join("\n");
    assert!(text.contains("不会停止"), "{text}");
    let execution = run
        .execute(&env, &preview.operation.operation_id)
        .expect("execute");
    assert_eq!(
        env.writes(),
        [format!("launchctl disable {}", target(&env))]
    );
    assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(execution.observed.disabled, Some(true));
    assert_eq!(
        execution.observed.pid,
        Some(700),
        "the process is untouched"
    );

    let execution = run.act(&env, LifecycleAction::Enable);
    assert_eq!(
        env.writes().last().cloned(),
        Some(format!("launchctl enable {}", target(&env)))
    );
    assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(execution.observed.disabled, Some(false));
}

#[test]
fn unload_boots_the_job_out_and_leaves_the_file() {
    let env = Env::job(None).loaded(Some(700));
    let run = Run::new();
    let preview = run.preview(&env, LifecycleAction::Unload).expect("preview");
    let text = preview.persistence.join("\n");
    assert!(text.contains("配置文件"), "{text}");
    let execution = run
        .execute(&env, &preview.operation.operation_id)
        .expect("execute");
    assert_eq!(
        env.writes(),
        [format!("launchctl bootout {}", target(&env))]
    );
    assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(execution.observed.loaded, Some(false));
    assert!(env.user_file().exists(), "unload never deletes the file");
}

#[test]
fn unloading_a_job_that_is_not_loaded_changes_nothing() {
    let env = Env::job(None);
    let run = Run::new();
    let execution = run.act(&env, LifecycleAction::Unload);
    assert_eq!(execution.outcome, LifecycleOutcome::NoChange);
    assert!(env.writes().is_empty());
}

// ------------------------------------------------------------- stop

#[test]
fn stopping_a_keep_alive_job_unloads_it_so_launchd_cannot_restart_it() {
    for keep_alive in ["true", r#"{"SuccessfulExit":false}"#] {
        let env = Env::job(Some(keep_alive)).loaded(Some(700));
        let run = Run::new();
        let preview = run.preview(&env, LifecycleAction::Stop).expect("preview");
        assert!(preview.keep_alive, "{keep_alive}");
        let text = preview.meaning.join("\n");
        assert!(text.contains("卸载"), "{text}");
        assert!(text.contains("自动拉起"), "{text}");
        assert_eq!(
            preview.commands,
            [format!("launchctl bootout {}", target(&env))]
        );

        let execution = run
            .execute(&env, &preview.operation.operation_id)
            .expect("execute");
        assert_eq!(
            env.writes(),
            [format!("launchctl bootout {}", target(&env))],
            "{keep_alive}: a KeepAlive job must not just be killed"
        );
        assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
        assert_eq!(execution.observed.loaded, Some(false));
        assert_eq!(execution.observed.running, Some(false));
    }
}

#[test]
fn stopping_a_job_without_keep_alive_sends_sigterm_and_keeps_it_loaded() {
    for keep_alive in [None, Some("false")] {
        let env = Env::job(keep_alive).loaded(Some(700));
        let run = Run::new();
        let preview = run.preview(&env, LifecycleAction::Stop).expect("preview");
        assert!(!preview.keep_alive);
        let execution = run
            .execute(&env, &preview.operation.operation_id)
            .expect("execute");
        assert_eq!(
            env.writes(),
            [format!("launchctl kill SIGTERM {}", target(&env))]
        );
        assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
        assert_eq!(execution.observed.loaded, Some(true));
        assert_eq!(execution.observed.running, Some(false));
    }
}

#[test]
fn stopping_a_job_that_is_not_running_or_not_loaded_changes_nothing() {
    let idle = Env::job(None).loaded(None);
    assert_eq!(
        Run::new().act(&idle, LifecycleAction::Stop).outcome,
        LifecycleOutcome::NoChange
    );
    let unloaded = Env::job(Some("true"));
    assert_eq!(
        Run::new().act(&unloaded, LifecycleAction::Stop).outcome,
        LifecycleOutcome::NoChange
    );
    assert!(idle.writes().is_empty() && unloaded.writes().is_empty());
}

#[test]
fn a_stop_the_process_survives_is_partial_and_never_reported_as_stopped() {
    let env = Env::job(None).loaded(Some(700));
    env.world().kill_stops = false;
    let run = Run::new();

    let execution = run.act(&env, LifecycleAction::Stop);

    assert_eq!(execution.outcome, LifecycleOutcome::Partial);
    assert_eq!(execution.observed.running, Some(true));
    assert_eq!(execution.observed.pid, Some(700));
    assert!(
        !execution.message.contains("已停止"),
        "{}",
        execution.message
    );
    assert_eq!(run.status(&execution), OperationStatus::Failed);
    let details = run
        .operations
        .get(&execution.operation.operation_id)
        .expect("operation");
    let (status, error, _) = finished(&details);
    assert_eq!(status, OperationStatus::Failed);
    assert_eq!(
        error.map(|error| code(&error)),
        Some(AppErrorCode::PartialFailure)
    );
    assert_eq!(execution.steps[0].status, StepStatus::Succeeded);
}

// ---------------------------------------------------------- read-back

#[test]
fn an_unreadable_state_after_the_command_is_unknown_not_stopped() {
    let env = Env::job(Some("true")).loaded(Some(700));
    env.world().list_fails_after_writes = true;
    let run = Run::new();

    let execution = run.act(&env, LifecycleAction::Stop);

    assert_eq!(execution.outcome, LifecycleOutcome::Unknown);
    assert_eq!(execution.observed.loaded, None);
    assert_eq!(execution.observed.running, None);
    assert!(
        !execution.message.contains("已停止"),
        "{}",
        execution.message
    );
    assert_eq!(execution.steps.len(), 1, "the executed step stays recorded");
    assert_eq!(execution.steps[0].status, StepStatus::Succeeded);
    assert_eq!(run.status(&execution), OperationStatus::Failed);

    let env = Env::job(None).loaded(Some(700));
    env.world().print_disabled_fails_after_writes = true;
    let execution = Run::new().act(&env, LifecycleAction::Disable);
    assert_eq!(execution.outcome, LifecycleOutcome::Unknown);
    assert_eq!(execution.observed.disabled, None);
}

#[test]
fn the_read_back_waits_for_launchd_to_settle() {
    let env = Env::job(None).loaded(None);
    env.world().pid_appears_after_reads = 1;
    let execution = Run::new().act(&env, LifecycleAction::Start);
    assert_eq!(execution.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(execution.observed.pid, Some(900));
}

#[test]
fn a_failed_step_is_recorded_and_the_state_is_read_back() {
    let env = Env::job(None).loaded(Some(700));
    env.world().step_error = Some(StepError::Failed {
        code: Some(5),
        stdout: String::new(),
        stderr: "Boot-out failed: 5: Input/output error".to_owned(),
    });
    let run = Run::new();

    let execution = run.act(&env, LifecycleAction::Unload);

    assert_eq!(execution.outcome, LifecycleOutcome::Failed);
    assert_eq!(execution.steps[0].status, StepStatus::Failed);
    assert_eq!(execution.steps[0].exit_code, Some(5));
    assert!(
        execution.steps[0]
            .detail
            .as_deref()
            .is_some_and(|detail| detail.contains("Input/output error"))
    );
    assert_eq!(execution.observed.loaded, Some(true), "state read back");
    let details = run
        .operations
        .get(&execution.operation.operation_id)
        .expect("operation");
    let (status, error, stderr) = finished(&details);
    assert_eq!(status, OperationStatus::Failed);
    assert!(error.is_some());
    assert!(stderr.is_some_and(|text| text.contains("Input/output error")));
}

#[test]
fn a_timed_out_step_is_recorded_as_timed_out() {
    let env = Env::job(None).loaded(Some(700));
    env.world().step_error = Some(StepError::Timeout);
    let execution = Run::new().act(&env, LifecycleAction::Unload);
    assert_eq!(execution.steps[0].status, StepStatus::TimedOut);
    assert_eq!(execution.outcome, LifecycleOutcome::Failed);
    assert_eq!(execution.observed.loaded, Some(true));
}

#[test]
fn a_failed_command_whose_effect_is_confirmed_is_partial() {
    let env = Env::job(None).loaded(Some(700));
    {
        let mut world = env.world();
        world.step_error = Some(StepError::Failed {
            code: Some(113),
            stdout: String::new(),
            stderr: "Could not find service".to_owned(),
        });
        world.step_error_applies = true;
    }
    let execution = Run::new().act(&env, LifecycleAction::Unload);
    assert_eq!(execution.outcome, LifecycleOutcome::Partial);
    assert_eq!(execution.steps[0].status, StepStatus::Failed);
    assert_eq!(execution.observed.loaded, Some(false));
}

// ---------------------------------------------- ownership and the domain

const ACTIONS: [LifecycleAction; 7] = [
    LifecycleAction::Load,
    LifecycleAction::Start,
    LifecycleAction::Stop,
    LifecycleAction::Restart,
    LifecycleAction::Disable,
    LifecycleAction::Enable,
    LifecycleAction::Unload,
];

fn assert_refused_without_commands(env: &Env, label: &str, expected: AppErrorCode) {
    let run = Run::new();
    for action in ACTIONS {
        let error = run
            .coordinator
            .preview(&env.host(), &run.operations, &request(action, label))
            .expect_err("read-only job");
        assert_eq!(code(&error), expected, "{action:?}: {}", message(&error));
    }
    assert!(env.writes().is_empty(), "no state-changing command");
    assert_eq!(env.lifecycle_reads(), 0, "no read-back for a refused job");
    assert!(run.coordinator.pending.lock().expect("pending").is_empty());
}

#[test]
fn read_only_ownerships_are_refused_for_every_action_before_any_runner_call() {
    // A forged Apple label in the user's own directory.
    let apple_forged = Env::build(
        "com.apple.forged",
        Dir::User,
        plist_json("com.apple.forged", None),
        real_uid(),
    );
    assert_refused_without_commands(
        &apple_forged,
        "com.apple.forged",
        AppErrorCode::PermissionDenied,
    );

    let apple = Env::build(
        "com.apple.helper",
        Dir::AppleAgent,
        plist_json("com.apple.helper", None),
        real_uid(),
    );
    assert_refused_without_commands(&apple, "com.apple.helper", AppErrorCode::PermissionDenied);

    let global = Env::build(
        "com.example.global",
        Dir::GlobalAgent,
        plist_json("com.example.global", None),
        real_uid(),
    );
    assert_refused_without_commands(
        &global,
        "com.example.global",
        AppErrorCode::PermissionDenied,
    );

    // The current user's own agent that UserHome neither created nor adopted.
    let third_party = Env::build(
        "com.example.thirdparty",
        Dir::User,
        plist_json("com.example.thirdparty", None),
        real_uid(),
    );
    assert_refused_without_commands(
        &third_party,
        "com.example.thirdparty",
        AppErrorCode::PermissionDenied,
    );

    // Created by UserHome, but the file belongs to someone else.
    let other_owner = Env::build(JOB, Dir::User, plist_json(JOB, None), real_uid() + 1);
    assert_refused_without_commands(&other_owner, JOB, AppErrorCode::PermissionDenied);
}

#[test]
fn system_daemons_and_the_system_domain_are_refused() {
    let daemon = Env::build(
        "com.example.daemon",
        Dir::Daemon,
        plist_json("com.example.daemon", None),
        real_uid(),
    );
    let run = Run::new();
    for action in ACTIONS {
        let error = run
            .coordinator
            .preview(
                &daemon.host(),
                &run.operations,
                &LifecycleRequest {
                    action,
                    domain: LaunchdDomain::System,
                    label: "com.example.daemon".to_owned(),
                },
            )
            .expect_err("system domain");
        assert_eq!(code(&error), AppErrorCode::PermissionDenied, "{action:?}");
        // Refused before anything, including the rediscovery, ran.
        assert!(daemon.events().is_empty(), "{:?}", daemon.events());
    }

    // Asking for the daemon in the user's domain finds no such job.
    let error = run
        .coordinator
        .preview(
            &daemon.host(),
            &run.operations,
            &request(LifecycleAction::Unload, "com.example.daemon"),
        )
        .expect_err("not a gui job");
    assert_eq!(code(&error), AppErrorCode::NotFound);
    assert!(daemon.writes().is_empty());
}

#[test]
fn a_link_in_the_launch_agents_directory_is_refused() {
    let env = Env::job(None);
    let link_name = "com.zephyr194.userhome.agent.link";
    symlink(
        env.user_file(),
        env.root
            .join("home/Library/LaunchAgents")
            .join(format!("{link_name}.plist")),
    )
    .expect("link");
    let run = Run::new();
    for action in ACTIONS {
        let error = run
            .coordinator
            .preview(&env.host(), &run.operations, &request(action, link_name))
            .expect_err("link");
        assert!(
            matches!(
                code(&error),
                AppErrorCode::PermissionDenied | AppErrorCode::NotFound
            ),
            "{action:?}: {error:?}"
        );
    }
    assert!(env.writes().is_empty());
}

#[test]
fn forged_labels_and_unknown_jobs_are_refused_before_any_command() {
    let env = Env::job(None).loaded(None);
    let run = Run::new();
    for bad in ["../x", "-k", "a b", "", "a/b", "gui/501/x", " ", "x\n"] {
        let error = run
            .coordinator
            .preview(
                &env.host(),
                &run.operations,
                &request(LifecycleAction::Load, bad),
            )
            .expect_err("bad label");
        assert_eq!(code(&error), AppErrorCode::InvalidInput, "{bad:?}");
    }
    assert!(env.events().is_empty(), "{:?}", env.events());

    let error = run
        .coordinator
        .preview(
            &env.host(),
            &run.operations,
            &request(
                LifecycleAction::Load,
                "com.zephyr194.userhome.agent.nothere",
            ),
        )
        .expect_err("unknown");
    assert_eq!(code(&error), AppErrorCode::NotFound);
    assert!(env.writes().is_empty());
}

#[test]
fn the_request_carries_only_an_action_a_domain_and_a_label() {
    let ok: LifecycleRequest =
        serde_json::from_str(r#"{"action":"LOAD","domain":"GUI","label":"com.example.x"}"#)
            .expect("valid");
    assert_eq!(ok.action, LifecycleAction::Load);
    for text in [
        r#"{"action":"LOAD","domain":"GUI","label":"x","path":"/tmp/x.plist"}"#,
        r#"{"action":"LOAD","domain":"GUI","label":"x","uid":0}"#,
        r#"{"action":"LOAD","domain":"GUI","label":"x","args":["-w"]}"#,
        r#"{"action":"load","domain":"GUI","label":"x"}"#,
        r#"{"action":"KILL","domain":"GUI","label":"x"}"#,
        r#"{"action":"DELETE","domain":"GUI","label":"x"}"#,
        r#"{"action":"REMOVE","domain":"GUI","label":"x"}"#,
        r#"{"action":"LOAD","domain":"USER","label":"x"}"#,
        r#"{"action":"LOAD","domain":"GUI"}"#,
        r#"{"domain":"GUI","label":"x"}"#,
    ] {
        assert!(
            serde_json::from_str::<LifecycleRequest>(text).is_err(),
            "{text}"
        );
    }
}

#[test]
fn the_job_is_rechecked_when_the_preview_is_confirmed() {
    let env = Env::job(None);
    let run = Run::new();
    let preview = run.preview(&env, LifecycleAction::Load).expect("preview");

    // After the preview the file is swapped for a link.
    let original = env.user_file();
    let moved = env.root.join("moved.plist");
    fs::rename(&original, &moved).expect("move");
    symlink(&moved, &original).expect("link");

    let error = run
        .execute(&env, &preview.operation.operation_id)
        .expect_err("no longer modifiable");
    assert_eq!(code(&error), AppErrorCode::PermissionDenied);
    assert!(env.writes().is_empty());
    let details = run
        .operations
        .get(&preview.operation.operation_id)
        .expect("operation");
    assert_eq!(details.status, OperationStatus::Failed);
}

#[test]
fn a_preview_whose_state_changed_is_not_executed() {
    let env = Env::job(None);
    let run = Run::new();
    let preview = run.preview(&env, LifecycleAction::Load).expect("preview");
    env.world().loaded = true;

    let error = run
        .execute(&env, &preview.operation.operation_id)
        .expect_err("changed");
    assert_eq!(code(&error), AppErrorCode::Conflict);
    assert!(env.writes().is_empty());
    assert_eq!(
        run.operations
            .get(&preview.operation.operation_id)
            .expect("operation")
            .status,
        OperationStatus::Failed
    );
}

#[test]
fn a_state_that_cannot_be_read_blocks_the_plan() {
    let env = Env::job(None).loaded(None);
    // The rediscovery reads the list first; the lifecycle read is the second.
    env.world().list_fails_on_read = Some(2);
    let error = Run::new()
        .preview(&env, LifecycleAction::Unload)
        .expect_err("unreadable");
    assert_eq!(code(&error), AppErrorCode::ProcessFailed);
    assert!(env.writes().is_empty());
}

// ------------------------------------------------ cancel and concurrency

#[test]
fn a_cancel_before_the_step_records_cancelled_and_runs_nothing() {
    let env = Env::job(None).loaded(Some(700));
    let operations = Arc::new(OperationCoordinator::default());
    let coordinator = LaunchdActionCoordinator::default();
    let preview = coordinator
        .preview(
            &env.host(),
            &operations,
            &job_request(LifecycleAction::Unload),
        )
        .expect("preview");
    let id = preview.operation.operation_id.clone();
    let hook_operations = Arc::clone(&operations);
    let hook_id = id.clone();
    env.set_hook(Arc::new(move || {
        let _ = hook_operations.cancel(&hook_id);
    }));

    let execution = coordinator
        .execute(&env.host(), &operations, &id)
        .expect("execute");

    assert_eq!(execution.outcome, LifecycleOutcome::Cancelled);
    assert!(execution.cancel_requested);
    assert_eq!(execution.steps.len(), 1);
    assert_eq!(execution.steps[0].status, StepStatus::NotRun);
    assert!(env.writes().is_empty());
    assert_eq!(
        operations.get(&id).expect("operation").status,
        OperationStatus::Cancelled
    );
}

#[test]
fn a_second_action_on_a_job_with_one_in_flight_is_refused() {
    let env = Env::job(None).loaded(Some(700));
    let run = Run::new();
    let first = run.preview(&env, LifecycleAction::Restart).expect("first");
    let second = run.preview(&env, LifecycleAction::Restart).expect("second");
    let (started_tx, started_rx) = channel();
    let (release_tx, release_rx) = channel();
    env.set_gate(started_tx, release_rx);

    thread::scope(|scope| {
        let running = scope.spawn(|| run.execute(&env, &first.operation.operation_id));
        started_rx
            .recv_timeout(Duration::from_secs(10))
            .expect("first action started");

        let error = run
            .execute(&env, &second.operation.operation_id)
            .expect_err("job busy");
        assert_eq!(code(&error), AppErrorCode::Conflict);
        assert!(message(&error).contains("同一任务"), "{}", message(&error));
        assert_eq!(env.writes().len(), 1, "the second action ran nothing");

        release_tx.send(()).expect("release");
        let done = running.join().expect("thread").expect("first result");
        assert_eq!(done.outcome, LifecycleOutcome::Succeeded);
    });

    // The refused confirmation was not consumed; it works once the job is free.
    let again = run
        .execute(&env, &second.operation.operation_id)
        .expect("second after the first");
    assert_eq!(again.outcome, LifecycleOutcome::Succeeded);
    assert_eq!(env.writes().len(), 2);
}

#[test]
fn a_confirmation_works_once() {
    let env = Env::job(None);
    let run = Run::new();
    let preview = run.preview(&env, LifecycleAction::Load).expect("preview");
    run.execute(&env, &preview.operation.operation_id)
        .expect("first");
    let error = run
        .execute(&env, &preview.operation.operation_id)
        .expect_err("second");
    assert_eq!(code(&error), AppErrorCode::NotFound);
    assert_eq!(env.writes().len(), 1);
}

#[test]
fn previews_waiting_for_confirmation_are_bounded() {
    let env = Env::job(None);
    let run = Run::new();
    for _ in 0..MAX_PENDING_ACTIONS {
        run.preview(&env, LifecycleAction::Load).expect("preview");
    }
    let error = run
        .preview(&env, LifecycleAction::Load)
        .expect_err("too many");
    assert_eq!(code(&error), AppErrorCode::Conflict);
}

// ------------------------------------------------------------- secrets

#[test]
fn previews_results_history_and_errors_never_contain_environment_values() {
    let env = Env::job(Some("true")).loaded(Some(700));
    env.world().step_error = Some(StepError::Failed {
        code: Some(5),
        stdout: String::new(),
        stderr: "Boot-out failed: 5: Input/output error".to_owned(),
    });
    let run = Run::new();
    let preview = run.preview(&env, LifecycleAction::Stop).expect("preview");
    let execution = run
        .execute(&env, &preview.operation.operation_id)
        .expect("execute");
    let details = run
        .operations
        .get(&preview.operation.operation_id)
        .expect("operation");
    let refused = run
        .coordinator
        .preview(
            &env.host(),
            &run.operations,
            &request(LifecycleAction::Stop, "com.apple.forged"),
        )
        .expect_err("refused");

    let dumps = [
        serde_json::to_string(&preview).expect("json"),
        serde_json::to_string(&execution).expect("json"),
        serde_json::to_string(&details).expect("json"),
        serde_json::to_string(&refused).expect("json"),
        format!("{preview:?}"),
        format!("{execution:?}"),
        format!("{details:?}"),
        format!("{refused:?}"),
    ];
    for dump in dumps {
        assert!(!dump.contains(SECRET_ENV), "{dump}");
        assert!(!dump.contains(SECRET_ARG), "{dump}");
    }
}
