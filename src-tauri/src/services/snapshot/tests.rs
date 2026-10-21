//! Snapshot over fixtures only: temporary directories and a fake runner for the
//! discovery path, and pure checks of the classification and argument rules.
//! No test runs launchctl or plutil, and none reads a real LaunchAgents
//! directory.

use std::{
    collections::{BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use uuid::Uuid;

use super::*;
use crate::services::{
    launchd::{
        CommandRunner, Discovery, LaunchdDomain, LaunchdScope, Limits, LoadState, ReadOnlyCommand,
        RunError, RunState, ScanLocations, Source, SourceReason, SourceStatus,
    },
    ownership::{NoAdoptions, Ownership, OwnershipError, ServiceRequest, ensure_modifiable},
};

fn real_uid() -> u32 {
    // SAFETY: getuid takes no arguments and cannot fail.
    unsafe { libc::getuid() }
}

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

fn keys(value: &serde_json::Value) -> BTreeSet<String> {
    value
        .as_object()
        .expect("json object")
        .keys()
        .cloned()
        .collect()
}

// ---- pure classification and argument rules -----------------------------------

#[test]
fn caddy_executables_are_recognised_by_basename_only() {
    assert!(is_caddy_executable("/opt/homebrew/bin/caddy"));
    assert!(is_caddy_executable("caddy"));
    assert!(!is_caddy_executable("/opt/homebrew/bin/caddyfile-linter"));
    assert!(!is_caddy_executable("/opt/bin/mycaddy"));
    assert!(!is_caddy_executable("/opt/bin/caddy.bak"));
    assert!(!is_caddy_executable("/opt/caddy/run"));
}

#[test]
fn config_location_reads_each_flag_form() {
    let home = Path::new("/Users/me");
    assert_eq!(
        config_location(
            &args(&["caddy", "run", "--config", "/Users/me/Sites/Caddyfile"]),
            Some(home)
        ),
        ConfigLocation {
            path: Some("~/Sites/Caddyfile".to_owned()),
            flag: Some(FlagForm::Long),
            unknown_reason: None,
        }
    );
    assert_eq!(
        config_location(&args(&["caddy", "--config=/etc/Caddyfile"]), None),
        ConfigLocation {
            path: Some("/etc/Caddyfile".to_owned()),
            flag: Some(FlagForm::LongEquals),
            unknown_reason: None,
        }
    );
    assert_eq!(
        config_location(&args(&["caddy", "-c", "/etc/Caddyfile"]), None).flag,
        Some(FlagForm::Short)
    );
}

#[test]
fn config_location_names_the_reason_when_it_cannot_be_read() {
    let missing = config_location(&args(&["caddy", "run"]), None);
    assert_eq!(missing.path, None);
    assert_eq!(missing.unknown_reason, Some(UnknownReason::Missing));

    let trailing = config_location(&args(&["caddy", "run", "--config"]), None);
    assert_eq!(trailing.unknown_reason, Some(UnknownReason::NoValue));

    let next_is_flag = config_location(&args(&["caddy", "--config", "--adapter", "x"]), None);
    assert_eq!(next_is_flag.unknown_reason, Some(UnknownReason::NoValue));

    let empty_equals = config_location(&args(&["caddy", "--config="]), None);
    assert_eq!(empty_equals.unknown_reason, Some(UnknownReason::NoValue));
}

#[test]
fn an_ambiguous_config_is_never_guessed() {
    let repeated = config_location(&args(&["caddy", "-c", "/a", "--config", "/b"]), None);
    assert_eq!(repeated.path, None);
    assert_eq!(repeated.flag, None);
    assert_eq!(repeated.unknown_reason, Some(UnknownReason::Ambiguous));

    let same_twice = config_location(&args(&["caddy", "-c", "/a", "-c", "/a"]), None);
    assert_eq!(same_twice.unknown_reason, Some(UnknownReason::Ambiguous));
}

#[test]
fn adapter_is_reported_only_when_unique() {
    assert_eq!(
        adapter_of(&args(&["caddy", "run", "--adapter", "caddyfile"])),
        Some("caddyfile".to_owned())
    );
    assert_eq!(
        adapter_of(&args(&["caddy", "--adapter=json"])),
        Some("json".to_owned())
    );
    assert_eq!(adapter_of(&args(&["caddy", "run"])), None);
    assert_eq!(
        adapter_of(&args(&["caddy", "--adapter", "a", "--adapter", "b"])),
        None
    );
}

// ---- temporary directories and a recording fake runner ------------------------

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-snapshot-{}", Uuid::new_v4()));
        for name in [
            "home/Library/LaunchAgents",
            "Library/LaunchAgents",
            "Library/LaunchDaemons",
            "System/Library/LaunchAgents",
            "System/Library/LaunchDaemons",
        ] {
            fs::create_dir_all(root.join(name)).expect("create directory");
        }
        Self { root }
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn locations(&self) -> ScanLocations {
        ScanLocations {
            user_agents: Some(self.root.join("home/Library/LaunchAgents")),
            global_agents: self.root.join("Library/LaunchAgents"),
            global_daemons: self.root.join("Library/LaunchDaemons"),
            apple_agents: self.root.join("System/Library/LaunchAgents"),
            apple_daemons: self.root.join("System/Library/LaunchDaemons"),
        }
    }

    fn user(&self, name: &str) -> PathBuf {
        self.root.join("home/Library/LaunchAgents").join(name)
    }

    fn global_agent(&self, name: &str) -> PathBuf {
        self.root.join("Library/LaunchAgents").join(name)
    }

    fn daemon(&self, name: &str) -> PathBuf {
        self.root.join("Library/LaunchDaemons").join(name)
    }

    fn apple_agent(&self, name: &str) -> PathBuf {
        self.root.join("System/Library/LaunchAgents").join(name)
    }

    fn write(path: &Path) {
        fs::write(path, b"bplist00 placeholder").expect("write plist");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Answers the three read-only commands from fixture text and records every
/// call. Anything else is refused, so a changing command shows up as a failure.
struct Fake {
    list: Option<String>,
    system: String,
    plists: HashMap<String, String>,
    calls: Mutex<Vec<(String, Vec<String>)>>,
}

impl Fake {
    fn new() -> Self {
        Self {
            list: Some("PID\tStatus\tLabel\n".to_owned()),
            system: "system = {\n\tservices = {\n\t}\n}\n".to_owned(),
            plists: HashMap::new(),
            calls: Mutex::new(Vec::new()),
        }
    }

    fn with_list(mut self, text: &str) -> Self {
        self.list = Some(text.to_owned());
        self
    }

    fn without_list(mut self) -> Self {
        self.list = None;
        self
    }

    fn with_plist(mut self, file_name: &str, json: &str) -> Self {
        self.plists.insert(file_name.to_owned(), json.to_owned());
        self
    }
}

impl CommandRunner for Fake {
    fn tool_available(&self, _: &str) -> bool {
        true
    }

    fn run(&self, command: &ReadOnlyCommand) -> Result<String, RunError> {
        let owned: Vec<String> = command.args().to_vec();
        self.calls
            .lock()
            .expect("calls")
            .push((command.executable().to_owned(), owned.clone()));
        let borrowed: Vec<&str> = owned.iter().map(String::as_str).collect();
        match (command.executable(), borrowed.as_slice()) {
            ("/bin/launchctl", ["list"]) => self.list.clone().ok_or(RunError::Failed),
            ("/bin/launchctl", ["print", "system"]) => Ok(self.system.clone()),
            ("/usr/bin/plutil", [.., path]) => {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                self.plists.get(name).cloned().ok_or(RunError::Failed)
            }
            _ => Err(RunError::Failed),
        }
    }
}

fn context<'a>(fixture: &Fixture, runner: &'a Fake) -> Discovery<'a> {
    Discovery {
        uid: real_uid(),
        home: Some(fixture.home()),
        locations: fixture.locations(),
        runner,
        limits: Limits::default(),
    }
}

const NOW_MS: u64 = 1_700_000_000_000;

fn take(fixture: &Fixture, fake: &Fake) -> ResidentCaddySnapshot {
    resident_caddy_snapshot(&context(fixture, fake), NOW_MS)
}

fn caddy_json(label: &str, arguments: &[&str]) -> String {
    serde_json::json!({ "Label": label, "ProgramArguments": arguments }).to_string()
}

// ---- discovery over fixtures -------------------------------------------------

#[test]
fn a_loaded_caddy_job_is_an_instance_with_its_argv_and_config() {
    let fixture = Fixture::new();
    let name = "com.example.web.plist";
    Fixture::write(&fixture.user(name));
    let config = format!("{}/Sites/Caddyfile", fixture.home().display());
    let json = serde_json::json!({
        "Label": "com.example.web",
        "ProgramArguments": [
            "/opt/homebrew/bin/caddy", "run", "--config", config,
            "--adapter", "caddyfile", "--api-key", "hunter2"
        ],
        "EnvironmentVariables": { "TOKEN": "sekret-value" }
    })
    .to_string();
    let fake = Fake::new()
        .with_list("PID\tStatus\tLabel\n42\t0\tcom.example.web\n")
        .with_plist(name, &json);

    let snapshot = take(&fixture, &fake);

    assert_eq!(snapshot.instances.len(), 1);
    let instance = &snapshot.instances[0];
    assert_eq!(instance.label, "com.example.web");
    assert_eq!(instance.domain, LaunchdDomain::Gui);
    assert_eq!(instance.scope, LaunchdScope::UserAgent);
    assert_eq!(instance.ownership, Ownership::CurrentUserAgent);
    assert_eq!(
        instance.plist_path.as_deref(),
        Some("~/Library/LaunchAgents/com.example.web.plist")
    );
    assert_eq!(
        instance.executable.as_deref(),
        Some("/opt/homebrew/bin/caddy")
    );
    assert_eq!(instance.config.path.as_deref(), Some("~/Sites/Caddyfile"));
    assert_eq!(instance.config.flag, Some(FlagForm::Long));
    assert_eq!(instance.adapter.as_deref(), Some("caddyfile"));
    assert!(
        instance
            .arguments
            .iter()
            .all(|argument| !argument.contains("hunter2"))
    );
    assert!(instance.arguments.contains(&"[REDACTED]".to_owned()));
    assert_eq!(instance.load_state, LoadState::Loaded);
    assert_eq!(instance.run_state, RunState::Running);
    assert_eq!(instance.pid, Some(42));
    assert_eq!(instance.observed_at_ms, NOW_MS);
    assert!(instance.complete && instance.incomplete_reasons.is_empty());
    assert!(snapshot.complete && snapshot.can_conclude_absence);
    let text = serde_json::to_string(&snapshot).expect("serialize");
    assert!(!text.contains("sekret-value"));
    assert!(!text.contains("hunter2"));
}

#[test]
fn only_an_exact_homebrew_label_or_a_caddy_executable_counts() {
    let fixture = Fixture::new();
    for file in [
        "homebrew_mxcl_caddy.plist",
        "com_example_caddy.plist",
        "homebrew_mxcl_caddy-old.plist",
    ] {
        Fixture::write(&fixture.user(file));
    }
    let fake = Fake::new()
        .with_plist(
            "homebrew_mxcl_caddy.plist",
            &caddy_json("homebrew.mxcl.caddy", &["/usr/bin/true"]),
        )
        .with_plist(
            "com_example_caddy.plist",
            &caddy_json("com.example.caddy", &["/usr/bin/true"]),
        )
        .with_plist(
            "homebrew_mxcl_caddy-old.plist",
            &caddy_json("homebrew.mxcl.caddy-old", &["/usr/bin/true"]),
        );

    let labels: Vec<String> = take(&fixture, &fake)
        .instances
        .into_iter()
        .map(|instance| instance.label)
        .collect();

    assert_eq!(labels, vec!["homebrew.mxcl.caddy".to_owned()]);
}

#[test]
fn caddy_like_executables_are_not_mistaken_for_caddy() {
    let fixture = Fixture::new();
    for file in ["com.example.linter.plist", "com.example.mine.plist"] {
        Fixture::write(&fixture.user(file));
    }
    let fake = Fake::new()
        .with_plist(
            "com.example.linter.plist",
            &caddy_json("com.example.linter", &["/opt/bin/caddyfile-linter"]),
        )
        .with_plist(
            "com.example.mine.plist",
            &caddy_json("com.example.mine", &["/opt/bin/mycaddy"]),
        );

    let snapshot = take(&fixture, &fake);

    assert!(snapshot.instances.is_empty());
    assert!(snapshot.can_conclude_absence);
}

#[test]
fn every_non_created_instance_is_read_only_through_the_ownership_gate() {
    let fixture = Fixture::new();
    let cases = [
        (
            fixture.apple_agent("com.apple.caddy.plist"),
            "com.apple.caddy",
            Ownership::AppleManaged,
            LaunchdDomain::Gui,
        ),
        (
            fixture.daemon("com.example.daemon.plist"),
            "com.example.daemon",
            Ownership::SystemDaemon,
            LaunchdDomain::System,
        ),
        (
            fixture.global_agent("com.example.global.plist"),
            "com.example.global",
            Ownership::GlobalAgent,
            LaunchdDomain::Gui,
        ),
        (
            fixture.user("com.example.user.plist"),
            "com.example.user",
            Ownership::CurrentUserAgent,
            LaunchdDomain::Gui,
        ),
    ];
    let mut fake = Fake::new();
    for (path, label, _, _) in &cases {
        Fixture::write(path);
        fake = fake.with_plist(
            &format!("{label}.plist"),
            &caddy_json(label, &["/usr/local/bin/caddy", "run"]),
        );
    }

    let snapshot = take(&fixture, &fake);
    assert_eq!(snapshot.instances.len(), cases.len());
    let ctx = context(&fixture, &fake);
    for (_, label, ownership, domain) in cases {
        let instance = snapshot
            .instances
            .iter()
            .find(|instance| instance.label == label)
            .expect("instance");
        assert_eq!(instance.ownership, ownership, "{label}");
        assert_eq!(instance.domain, domain, "{label}");
        let request = ServiceRequest {
            domain,
            label: label.to_owned(),
        };
        let denied = ensure_modifiable(&ctx, &NoAdoptions, &request);
        assert!(
            matches!(denied, Err(OwnershipError::ReadOnly(_))),
            "{label}: {denied:?}"
        );
    }
}

#[test]
fn only_a_userhome_created_caddy_job_is_modifiable_through_the_gate() {
    let fixture = Fixture::new();
    let label = "com.zephyr194.userhome.agent.caddy";
    let file = format!("{label}.plist");
    Fixture::write(&fixture.user(&file));
    let fake = Fake::new().with_plist(&file, &caddy_json(label, &["/opt/homebrew/bin/caddy"]));

    let snapshot = take(&fixture, &fake);
    assert_eq!(snapshot.instances[0].ownership, Ownership::UserhomeCreated);

    let request = ServiceRequest {
        domain: LaunchdDomain::Gui,
        label: label.to_owned(),
    };
    let target = ensure_modifiable(&context(&fixture, &fake), &NoAdoptions, &request)
        .expect("a created job is modifiable");
    assert_eq!(target.ownership, Ownership::UserhomeCreated);
}

#[test]
fn an_empty_complete_discovery_concludes_absence() {
    let fixture = Fixture::new();

    let snapshot = take(&fixture, &Fake::new());

    assert!(snapshot.instances.is_empty());
    assert!(snapshot.complete && snapshot.can_conclude_absence);
    assert!(
        snapshot
            .sources
            .iter()
            .all(|source| source.status == SourceStatus::Complete)
    );
}

#[test]
fn a_failed_listing_never_reads_as_no_caddy() {
    let fixture = Fixture::new();

    let snapshot = take(&fixture, &Fake::new().without_list());

    assert!(snapshot.instances.is_empty());
    assert!(!snapshot.complete && !snapshot.can_conclude_absence);
    let listing = snapshot
        .sources
        .iter()
        .find(|source| source.source == Source::LaunchctlList)
        .expect("listing report");
    assert_eq!(listing.status, SourceStatus::Failed);
    assert_eq!(listing.reason, Some(SourceReason::ProcessFailed));
}

#[test]
fn an_unparsed_plist_blocks_the_conclusion_of_absence() {
    let fixture = Fixture::new();
    Fixture::write(&fixture.user("com.example.bad.plist"));
    let fake = Fake::new().with_plist("com.example.bad.plist", "not json");

    let snapshot = take(&fixture, &fake);

    assert!(!snapshot.complete && !snapshot.can_conclude_absence);
}

#[test]
fn a_truncated_listing_blocks_the_conclusion_of_absence() {
    let fixture = Fixture::new();
    let mut fake = Fake::new();
    for name in ["com.example.one", "com.example.two"] {
        Fixture::write(&fixture.user(&format!("{name}.plist")));
        fake = fake.with_plist(
            &format!("{name}.plist"),
            &caddy_json(name, &["/usr/bin/true"]),
        );
    }
    let mut ctx = context(&fixture, &fake);
    ctx.limits.max_entries_per_dir = 1;

    let snapshot = resident_caddy_snapshot(&ctx, NOW_MS);

    assert!(!snapshot.complete && !snapshot.can_conclude_absence);
}

#[test]
fn a_truncated_argument_list_makes_the_instance_incomplete() {
    let fixture = Fixture::new();
    Fixture::write(&fixture.user("com.example.long.plist"));
    let mut arguments = vec!["/opt/homebrew/bin/caddy".to_owned()];
    arguments.extend((0..129).map(|index| format!("arg{index}")));
    let json = serde_json::json!({
        "Label": "com.example.long",
        "ProgramArguments": arguments
    })
    .to_string();
    let fake = Fake::new().with_plist("com.example.long.plist", &json);

    let snapshot = take(&fixture, &fake);

    let instance = &snapshot.instances[0];
    assert_eq!(
        instance.incomplete_reasons,
        vec![IncompleteReason::ArgumentsTruncated]
    );
    assert!(!instance.complete && !snapshot.complete);
}

#[test]
fn a_loaded_job_without_a_process_has_no_pid() {
    let fixture = Fixture::new();
    Fixture::write(&fixture.user("com.example.web.plist"));
    let fake = Fake::new()
        .with_list("PID\tStatus\tLabel\n-\t78\tcom.example.web\n")
        .with_plist(
            "com.example.web.plist",
            &caddy_json("com.example.web", &["/opt/homebrew/bin/caddy"]),
        );

    let snapshot = take(&fixture, &fake);

    let instance = &snapshot.instances[0];
    assert_eq!(instance.load_state, LoadState::Loaded);
    assert_eq!(instance.run_state, RunState::NotRunning);
    assert_eq!(instance.pid, None);
}

#[test]
fn the_snapshot_runs_only_read_only_commands() {
    let fixture = Fixture::new();
    Fixture::write(&fixture.user("com.example.web.plist"));
    let fake = Fake::new()
        .with_list("PID\tStatus\tLabel\n42\t0\tcom.example.web\n")
        .with_plist(
            "com.example.web.plist",
            &caddy_json("com.example.web", &["/opt/homebrew/bin/caddy"]),
        );

    let snapshot = take(&fixture, &fake);

    assert_eq!(snapshot.instances.len(), 1);
    let calls = fake.calls.lock().expect("calls");
    assert!(!calls.is_empty());
    for (executable, arguments) in calls.iter() {
        match executable.as_str() {
            "/bin/launchctl" => assert!(
                matches!(
                    arguments.first().map(String::as_str),
                    Some("list" | "print" | "print-disabled")
                ),
                "{arguments:?}"
            ),
            "/usr/bin/plutil" => {
                assert_eq!(arguments.first().map(String::as_str), Some("-convert"))
            }
            other => panic!("unexpected executable {other}"),
        }
    }
}

#[test]
fn the_snapshot_fields_are_frozen_to_read_only_evidence() {
    let instance = ResidentCaddyInstance {
        label: String::new(),
        domain: LaunchdDomain::Gui,
        scope: LaunchdScope::UserAgent,
        ownership: Ownership::CurrentUserAgent,
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
        run_state: RunState::NotRunning,
        pid: None,
        observed_at_ms: NOW_MS,
        complete: true,
        incomplete_reasons: Vec::new(),
    };
    let snapshot = ResidentCaddySnapshot {
        observed_at_ms: NOW_MS,
        complete: true,
        can_conclude_absence: true,
        sources: Vec::new(),
        instances: vec![instance],
    };

    let value = serde_json::to_value(&snapshot).expect("serialize");

    assert_eq!(
        keys(&value),
        set(&[
            "observedAtMs",
            "complete",
            "canConcludeAbsence",
            "sources",
            "instances"
        ])
    );
    assert_eq!(
        keys(&value["instances"][0]),
        set(&[
            "label",
            "domain",
            "scope",
            "ownership",
            "plistPath",
            "executable",
            "arguments",
            "adapter",
            "config",
            "loadState",
            "runState",
            "pid",
            "observedAtMs",
            "complete",
            "incompleteReasons",
        ])
    );
    assert_eq!(
        keys(&value["instances"][0]["config"]),
        set(&["path", "flag", "unknownReason"])
    );
}
