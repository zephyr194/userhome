//! Discovery over fixtures: an injected runner and temporary directories stand
//! in for launchd and the fixed plist locations, so no test starts launchctl or
//! reads a real plist. Output formats follow `man launchctl` and
//! `man launchd.plist`; they were not checked against real launchd output.

use std::{
    collections::HashMap,
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt, symlink},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use uuid::Uuid;

use super::{
    command::{CommandRunner, ReadOnlyCommand, RunError},
    *,
};

const UID: u32 = 501;

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-launchd-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create fixture root");
        let fixture = Self { root };
        for name in [
            "home/Library/LaunchAgents",
            "Library/LaunchAgents",
            "Library/LaunchDaemons",
            "System/Library/LaunchAgents",
            "System/Library/LaunchDaemons",
        ] {
            fs::create_dir_all(fixture.root.join(name)).expect("create directory");
        }
        fixture
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

    fn apple_daemon(&self, name: &str) -> PathBuf {
        self.root.join("System/Library/LaunchDaemons").join(name)
    }

    /// The runner only converts by file name, so the bytes are placeholders.
    fn plist(path: &Path) {
        fs::write(path, b"bplist00 placeholder").expect("write plist");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        for directory in [
            "home/Library/LaunchAgents",
            "Library/LaunchAgents",
            "Library/LaunchDaemons",
        ] {
            let _ =
                fs::set_permissions(self.root.join(directory), fs::Permissions::from_mode(0o755));
        }
        let _ = fs::remove_dir_all(&self.root);
    }
}

type Reply = Result<String, RunError>;

struct FakeRunner {
    list: Reply,
    system: Reply,
    /// JSON (or an error) per plist file name.
    plists: HashMap<String, Reply>,
    plutil_available: bool,
    calls: Mutex<Vec<(String, Vec<String>)>>,
}

impl FakeRunner {
    fn new() -> Self {
        Self {
            list: Ok("PID\tStatus\tLabel\n".into()),
            system: Ok("system = {\n\tservices = {\n\t}\n}\n".into()),
            plists: HashMap::new(),
            plutil_available: true,
            calls: Mutex::new(Vec::new()),
        }
    }

    fn list(mut self, rows: &[(&str, &str, &str)]) -> Self {
        let mut text = "PID\tStatus\tLabel\n".to_owned();
        for (pid, status, label) in rows {
            text.push_str(&format!("{pid}\t{status}\t{label}\n"));
        }
        self.list = Ok(text);
        self
    }

    fn system(mut self, rows: &[(&str, &str, &str)]) -> Self {
        let mut text = "system = {\n\tservices = {\n\t\tPID\tStatus\tLabel\n".to_owned();
        for (pid, status, label) in rows {
            text.push_str(&format!("\t\t{pid}\t{status}\t{label}\n"));
        }
        text.push_str("\t}\n}\n");
        self.system = Ok(text);
        self
    }

    fn json(mut self, name: &str, json: &str) -> Self {
        self.plists.insert(name.to_owned(), Ok(json.to_owned()));
        self
    }

    fn plist_error(mut self, name: &str, error: RunError) -> Self {
        self.plists.insert(name.to_owned(), Err(error));
        self
    }

    fn labelled(self, name: &str, label: &str) -> Self {
        self.json(
            name,
            &format!(r#"{{"Label":"{label}","ProgramArguments":["/usr/bin/{label}"]}}"#),
        )
    }

    fn calls(&self) -> Vec<(String, Vec<String>)> {
        self.calls.lock().expect("calls").clone()
    }

    fn converted(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .filter(|(executable, _)| executable == "/usr/bin/plutil")
            .filter_map(|(_, args)| args.last().cloned())
            .collect()
    }
}

impl CommandRunner for FakeRunner {
    fn tool_available(&self, executable: &str) -> bool {
        executable != "/usr/bin/plutil" || self.plutil_available
    }

    fn run(&self, command: &ReadOnlyCommand) -> Reply {
        self.calls
            .lock()
            .expect("calls")
            .push((command.executable().to_owned(), command.args().to_vec()));
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        match (command.executable(), args.as_slice()) {
            ("/bin/launchctl", ["list"]) => self.list.clone(),
            ("/bin/launchctl", ["print", "system"]) => self.system.clone(),
            ("/usr/bin/plutil", [.., path]) => {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("file name");
                self.plists
                    .get(name)
                    .cloned()
                    .unwrap_or(Err(RunError::Failed))
            }
            other => panic!("unexpected command {other:?}"),
        }
    }
}

fn run(fixture: &Fixture, runner: &FakeRunner) -> LaunchdDiscovery {
    run_with(fixture, runner, Limits::default())
}

fn run_with(fixture: &Fixture, runner: &FakeRunner, limits: Limits) -> LaunchdDiscovery {
    discover(&Discovery {
        uid: UID,
        home: Some(fixture.home()),
        locations: fixture.locations(),
        runner,
        limits,
    })
}

fn find<'a>(discovery: &'a LaunchdDiscovery, id: &str) -> &'a LaunchdService {
    discovery
        .services
        .iter()
        .find(|service| service.id == id)
        .unwrap_or_else(|| {
            let ids: Vec<_> = discovery.services.iter().map(|s| s.id.as_str()).collect();
            panic!("{id} not found in {ids:?}")
        })
}

fn source(discovery: &LaunchdDiscovery, source: Source) -> &SourceReport {
    discovery
        .sources
        .iter()
        .find(|report| report.source == source)
        .expect("source report")
}

#[test]
fn merges_loaded_jobs_with_plist_files_by_label() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.agent.plist"));
    Fixture::plist(&fixture.user("com.example.idle.plist"));
    Fixture::plist(&fixture.apple_agent("com.apple.helper.plist"));
    let runner = FakeRunner::new()
        .list(&[
            ("412", "0", "com.example.agent"),
            ("-", "78", "com.example.orphan"),
            ("-", "-15", "com.apple.helper"),
        ])
        .labelled("com.example.agent.plist", "com.example.agent")
        .labelled("com.example.idle.plist", "com.example.idle")
        .labelled("com.apple.helper.plist", "com.apple.helper");

    let discovery = run(&fixture, &runner);

    let agent = find(&discovery, "gui/501/com.example.agent");
    assert_eq!(agent.correlation, Correlation::Matched);
    assert_eq!(agent.load_state, LoadState::Loaded);
    assert_eq!(agent.run_state, RunState::Running);
    assert_eq!(agent.pid, Some(412));
    assert_eq!(agent.last_exit, Some(LastExit::Code(0)));
    assert_eq!(agent.scope, LaunchdScope::UserAgent);
    assert_eq!(agent.domain, LaunchdDomain::Gui);
    assert_eq!(agent.domain_target, "gui/501");
    assert_eq!(agent.config_presence, ConfigPresence::Found);
    assert_eq!(agent.label_source, LabelSource::Plist);
    assert_eq!(agent.config_files.len(), 1);
    let file = &agent.config_files[0];
    assert_eq!(file.path, "~/Library/LaunchAgents/com.example.agent.plist");
    assert_eq!(file.parse_status, ParseStatus::Parsed);
    assert_eq!(file.kind, FileKind::Regular);
    assert_eq!(
        file.details.as_ref().expect("details").program_arguments,
        ["/usr/bin/com.example.agent"]
    );

    // A file whose label is not loaded: both kinds of evidence stay apart.
    let idle = find(&discovery, "gui/501/com.example.idle");
    assert_eq!(idle.correlation, Correlation::FileOnly);
    assert_eq!(idle.load_state, LoadState::NotLoaded);
    assert_eq!(idle.run_state, RunState::NotRunning);
    assert_eq!(idle.pid, None);
    assert_eq!(idle.config_presence, ConfigPresence::Found);

    // A loaded job with no file in the scanned locations.
    let orphan = find(&discovery, "gui/501/com.example.orphan");
    assert_eq!(orphan.correlation, Correlation::LoadedOnly);
    assert_eq!(orphan.load_state, LoadState::Loaded);
    assert_eq!(orphan.run_state, RunState::NotRunning);
    assert_eq!(orphan.last_exit, Some(LastExit::Code(78)));
    assert_eq!(orphan.config_presence, ConfigPresence::NotFoundInScanned);
    assert!(orphan.config_files.is_empty());
    assert_eq!(orphan.scope, LaunchdScope::Unattributed);
    assert_eq!(orphan.label_source, LabelSource::Launchctl);

    // Apple path evidence; exit by signal; nonzero is not an error verdict.
    let apple = find(&discovery, "gui/501/com.apple.helper");
    assert_eq!(apple.scope, LaunchdScope::AppleAgent);
    assert!(apple.config_files[0].is_apple_path);
    assert_eq!(apple.last_exit, Some(LastExit::Signal(15)));
    assert!(discovery.complete);
    assert!(!discovery.truncated);
}

#[test]
fn system_daemons_come_from_the_system_domain() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.daemon("com.example.daemon.plist"));
    Fixture::plist(&fixture.daemon("com.example.stopped.plist"));
    Fixture::plist(&fixture.apple_daemon("com.apple.thing.plist"));
    let runner = FakeRunner::new()
        .system(&[
            ("88", "0", "com.example.daemon"),
            ("-", "0", "com.apple.thing"),
            ("-", "0", "com.example.unfiled"),
        ])
        .labelled("com.example.daemon.plist", "com.example.daemon")
        .labelled("com.example.stopped.plist", "com.example.stopped")
        .labelled("com.apple.thing.plist", "com.apple.thing");

    let discovery = run(&fixture, &runner);

    let daemon = find(&discovery, "system/com.example.daemon");
    assert_eq!(daemon.domain, LaunchdDomain::System);
    assert_eq!(daemon.domain_target, "system");
    assert_eq!(daemon.scope, LaunchdScope::SystemDaemon);
    assert_eq!(daemon.run_state, RunState::Running);
    assert_eq!(daemon.pid, Some(88));
    let stopped = find(&discovery, "system/com.example.stopped");
    assert_eq!(stopped.load_state, LoadState::NotLoaded);
    assert_eq!(
        find(&discovery, "system/com.apple.thing").scope,
        LaunchdScope::AppleDaemon
    );
    let unfiled = find(&discovery, "system/com.example.unfiled");
    assert_eq!(unfiled.correlation, Correlation::LoadedOnly);
    assert_eq!(unfiled.config_presence, ConfigPresence::NotFoundInScanned);
    // The same label in the other domain would be a different service.
    assert!(
        discovery
            .services
            .iter()
            .all(|s| s.domain == LaunchdDomain::System)
    );
}

#[test]
fn the_same_label_in_agent_and_daemon_directories_stays_two_services() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.both.plist"));
    Fixture::plist(&fixture.daemon("com.example.both.plist"));
    let runner = FakeRunner::new()
        .list(&[("10", "0", "com.example.both")])
        .labelled("com.example.both.plist", "com.example.both");

    let discovery = run(&fixture, &runner);

    assert_eq!(
        find(&discovery, "gui/501/com.example.both").load_state,
        LoadState::Loaded
    );
    assert_eq!(
        find(&discovery, "system/com.example.both").load_state,
        LoadState::NotLoaded
    );
    assert!(
        !find(&discovery, "gui/501/com.example.both")
            .issues
            .contains(&ServiceIssue::DuplicateLabel)
    );
}

#[test]
fn duplicate_labels_keep_every_file_and_are_flagged() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.dup.plist"));
    Fixture::plist(&fixture.global_agent("com.example.dup.plist"));
    Fixture::plist(&fixture.global_agent("other-name.plist"));
    let runner = FakeRunner::new()
        .labelled("com.example.dup.plist", "com.example.dup")
        .labelled("other-name.plist", "com.example.dup");

    let discovery = run(&fixture, &runner);

    let service = find(&discovery, "gui/501/com.example.dup");
    assert_eq!(service.config_files.len(), 3);
    assert!(service.issues.contains(&ServiceIssue::DuplicateLabel));
    assert!(
        service
            .issues
            .contains(&ServiceIssue::LabelFilenameMismatch)
    );
    assert_eq!(service.scope, LaunchdScope::Mixed);
    assert_eq!(discovery.services.len(), 1);
    assert_eq!(service.load_state, LoadState::NotLoaded);
}

#[test]
fn a_label_that_differs_from_the_file_name_is_reported_not_corrected() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("renamed.plist"));
    let runner = FakeRunner::new()
        .list(&[("5", "0", "com.example.real-label")])
        .labelled("renamed.plist", "com.example.real-label");

    let discovery = run(&fixture, &runner);

    let service = find(&discovery, "gui/501/com.example.real-label");
    assert_eq!(service.correlation, Correlation::Matched);
    assert_eq!(service.issues, [ServiceIssue::LabelFilenameMismatch]);
    assert_eq!(discovery.services.len(), 1);
}

#[test]
fn a_plist_without_a_label_is_listed_unmatched_and_never_guessed() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.nolabel.plist"));
    Fixture::plist(&fixture.user("com.example.badlabel.plist"));
    let runner = FakeRunner::new()
        // A loaded job named like the file must not be matched to it.
        .list(&[("9", "0", "com.example.nolabel")])
        .json("com.example.nolabel.plist", r#"{"Program":"/bin/true"}"#)
        .json("com.example.badlabel.plist", r#"{"Label":["x"]}"#);

    let discovery = run(&fixture, &runner);

    let loaded = find(&discovery, "gui/501/com.example.nolabel");
    assert_eq!(loaded.correlation, Correlation::LoadedOnly);
    assert!(loaded.config_files.is_empty());
    // The unlabelled file may be its definition, so absence is not concluded.
    assert_eq!(loaded.config_presence, ConfigPresence::Unknown);

    let unmatched: Vec<_> = discovery
        .services
        .iter()
        .filter(|service| service.correlation == Correlation::UnmatchedFile)
        .collect();
    assert_eq!(unmatched.len(), 2);
    for service in &unmatched {
        assert_eq!(service.label_source, LabelSource::FileName);
        assert_eq!(service.load_state, LoadState::Unknown);
        assert_eq!(service.run_state, RunState::Unknown);
        assert_eq!(service.config_files.len(), 1);
        assert_eq!(service.config_files[0].parse_status, ParseStatus::Parsed);
    }
    let missing = unmatched
        .iter()
        .find(|service| service.label == "com.example.nolabel")
        .expect("missing label entry");
    assert_eq!(missing.issues, [ServiceIssue::MissingLabel]);
    let invalid = unmatched
        .iter()
        .find(|service| service.label == "com.example.badlabel")
        .expect("invalid label entry");
    assert_eq!(invalid.issues, [ServiceIssue::InvalidLabel]);
    assert_ne!(missing.id, loaded.id);
}

#[test]
fn a_denied_system_domain_marks_daemons_inaccessible_but_keeps_user_results() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.daemon("com.example.daemon.plist"));
    Fixture::plist(&fixture.user("com.example.agent.plist"));
    let mut runner = FakeRunner::new()
        .list(&[("3", "0", "com.example.agent")])
        .labelled("com.example.daemon.plist", "com.example.daemon")
        .labelled("com.example.agent.plist", "com.example.agent");
    runner.system = Err(RunError::PermissionDenied);

    let discovery = run(&fixture, &runner);

    let daemon = find(&discovery, "system/com.example.daemon");
    assert_eq!(daemon.load_state, LoadState::Inaccessible);
    assert_eq!(daemon.run_state, RunState::Inaccessible);
    assert_eq!(daemon.correlation, Correlation::FileOnly);
    assert_eq!(
        find(&discovery, "gui/501/com.example.agent").load_state,
        LoadState::Loaded
    );
    let report = source(&discovery, Source::LaunchctlPrintSystem);
    assert_eq!(report.status, SourceStatus::Inaccessible);
    assert_eq!(report.reason, Some(SourceReason::PermissionDenied));
    assert!(!discovery.complete);
    assert_eq!(
        source(&discovery, Source::LaunchctlList).status,
        SourceStatus::Complete
    );
}

#[test]
fn command_failures_become_unknown_states_with_a_reason_per_source() {
    for (error, reason) in [
        (RunError::Timeout, SourceReason::Timeout),
        (RunError::OutputTooLarge, SourceReason::OutputTooLarge),
        (RunError::Failed, SourceReason::ProcessFailed),
        (RunError::ToolMissing, SourceReason::ToolUnavailable),
        (RunError::Io, SourceReason::Io),
    ] {
        let fixture = Fixture::new();
        Fixture::plist(&fixture.user("com.example.agent.plist"));
        let mut runner = FakeRunner::new().labelled("com.example.agent.plist", "com.example.agent");
        runner.list = Err(error);

        let discovery = run(&fixture, &runner);

        let service = find(&discovery, "gui/501/com.example.agent");
        assert_eq!(service.load_state, LoadState::Unknown, "{error:?}");
        assert_eq!(service.run_state, RunState::Unknown, "{error:?}");
        assert_eq!(service.config_presence, ConfigPresence::Found);
        let report = source(&discovery, Source::LaunchctlList);
        assert_eq!(report.status, SourceStatus::Failed, "{error:?}");
        assert_eq!(report.reason, Some(reason), "{error:?}");
        assert!(!discovery.complete, "{error:?}");
        // The directory evidence is still reported.
        assert_eq!(
            source(&discovery, Source::UserLaunchAgents).status,
            SourceStatus::Complete
        );
    }
}

#[test]
fn unparsed_or_partly_parsed_command_output_is_not_complete() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.a.plist"));
    let mut runner = FakeRunner::new().labelled("com.example.a.plist", "com.example.a");
    runner.list = Ok("this is not a job list\n".into());
    let discovery = run(&fixture, &runner);
    let report = source(&discovery, Source::LaunchctlList);
    assert_eq!(report.status, SourceStatus::Failed);
    assert_eq!(report.reason, Some(SourceReason::UnparsedOutput));
    assert_eq!(
        find(&discovery, "gui/501/com.example.a").load_state,
        LoadState::Unknown
    );

    let mut runner = FakeRunner::new().labelled("com.example.a.plist", "com.example.a");
    runner.list = Ok("PID\tStatus\tLabel\n-\t0\tcom.example.other\nweird\n".into());
    let discovery = run(&fixture, &runner);
    let report = source(&discovery, Source::LaunchctlList);
    assert_eq!(report.status, SourceStatus::Partial);
    assert_eq!(report.reason, Some(SourceReason::UnparsedOutput));
    // Absence from a partly parsed list is not proof of "not loaded".
    assert_eq!(
        find(&discovery, "gui/501/com.example.a").load_state,
        LoadState::Unknown
    );
    assert_eq!(
        find(&discovery, "gui/501/com.example.other").load_state,
        LoadState::Loaded
    );
    assert!(!discovery.complete);
}

#[test]
fn a_directory_that_cannot_be_listed_leaves_absence_unproven() {
    let fixture = Fixture::new();
    fs::remove_dir_all(fixture.root.join("Library/LaunchDaemons")).expect("remove");
    fs::write(
        fixture.root.join("Library/LaunchDaemons"),
        b"a file, not a dir",
    )
    .expect("file");
    Fixture::plist(&fixture.user("com.example.agent.plist"));
    let runner = FakeRunner::new()
        .system(&[("-", "0", "com.example.daemon")])
        .list(&[("1", "0", "com.example.loaded")])
        .labelled("com.example.agent.plist", "com.example.agent");

    let discovery = run(&fixture, &runner);

    let report = source(&discovery, Source::GlobalLaunchDaemons);
    assert_eq!(report.status, SourceStatus::Failed);
    assert_eq!(report.reason, Some(SourceReason::Io));
    // The system domain has an unlistable directory: not concluded.
    assert_eq!(
        find(&discovery, "system/com.example.daemon").config_presence,
        ConfigPresence::Unknown
    );
    // The user domain's directories are complete.
    assert_eq!(
        find(&discovery, "gui/501/com.example.loaded").config_presence,
        ConfigPresence::NotFoundInScanned
    );
    assert!(!discovery.complete);
}

#[test]
fn an_unreadable_directory_is_inaccessible() {
    let fixture = Fixture::new();
    let directory = fixture.root.join("Library/LaunchAgents");
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o000)).expect("lock");
    if fs::read_dir(&directory).is_ok() {
        return; // permissions are not enforced (running as root)
    }
    let runner = FakeRunner::new();

    let discovery = run(&fixture, &runner);

    let report = source(&discovery, Source::GlobalLaunchAgents);
    assert_eq!(report.status, SourceStatus::Inaccessible);
    assert_eq!(report.reason, Some(SourceReason::PermissionDenied));
    assert!(!discovery.complete);
}

#[test]
fn a_missing_directory_is_normal_and_reported_as_such() {
    let fixture = Fixture::new();
    fs::remove_dir_all(fixture.root.join("home/Library/LaunchAgents")).expect("remove");
    let runner = FakeRunner::new();

    let discovery = run(&fixture, &runner);

    let report = source(&discovery, Source::UserLaunchAgents);
    assert_eq!(report.status, SourceStatus::Complete);
    assert_eq!(report.reason, Some(SourceReason::DirectoryMissing));
    assert_eq!(report.items, 0);
    assert!(discovery.complete);
}

#[test]
fn a_corrupt_plist_fails_alone_and_makes_the_source_partial() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.good.plist"));
    Fixture::plist(&fixture.user("com.example.corrupt.plist"));
    Fixture::plist(&fixture.user("com.example.garbage.plist"));
    let runner = FakeRunner::new()
        .labelled("com.example.good.plist", "com.example.good")
        .plist_error("com.example.corrupt.plist", RunError::Failed)
        .json("com.example.garbage.plist", "{ this is not json");

    let discovery = run(&fixture, &runner);

    assert_eq!(
        find(&discovery, "gui/501/com.example.good").config_files[0].parse_status,
        ParseStatus::Parsed
    );
    for name in ["com.example.corrupt", "com.example.garbage"] {
        let service = find(
            &discovery,
            &format!("gui/501/!file/user-launch-agents/{name}.plist"),
        );
        assert_eq!(service.correlation, Correlation::UnmatchedFile);
        assert_eq!(
            service.config_files[0].parse_status,
            ParseStatus::ConvertFailed
        );
        assert!(service.config_files[0].details.is_none());
        assert_eq!(service.label, name);
    }
    let report = source(&discovery, Source::UserLaunchAgents);
    assert_eq!(report.status, SourceStatus::Partial);
    assert_eq!(report.reason, Some(SourceReason::FileErrors));
    assert_eq!(report.failed_files, 2);
    assert_eq!(report.items, 3);
    assert!(!discovery.complete);
}

#[test]
fn converter_timeouts_and_oversized_output_are_classified_per_file() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("slow.plist"));
    Fixture::plist(&fixture.user("huge.plist"));
    let runner = FakeRunner::new()
        .plist_error("slow.plist", RunError::Timeout)
        .plist_error("huge.plist", RunError::OutputTooLarge);

    let discovery = run(&fixture, &runner);

    let status = |name: &str| {
        find(
            &discovery,
            &format!("gui/501/!file/user-launch-agents/{name}.plist"),
        )
        .config_files[0]
            .parse_status
    };
    assert_eq!(status("slow"), ParseStatus::TimedOut);
    assert_eq!(status("huge"), ParseStatus::OutputTooLarge);
    assert_eq!(
        source(&discovery, Source::UserLaunchAgents).status,
        SourceStatus::Partial
    );
}

#[test]
fn an_oversized_plist_is_not_converted() {
    let fixture = Fixture::new();
    fs::write(fixture.user("big.plist"), vec![b'x'; 200]).expect("write");
    Fixture::plist(&fixture.user("small.plist"));
    let runner = FakeRunner::new()
        .labelled("big.plist", "big")
        .labelled("small.plist", "small");
    let limits = Limits {
        max_plist_bytes: 64,
        ..Limits::default()
    };

    let discovery = run_with(&fixture, &runner, limits);

    let big = find(&discovery, "gui/501/!file/user-launch-agents/big.plist");
    assert_eq!(big.config_files[0].parse_status, ParseStatus::TooLarge);
    assert!(big.config_files[0].details.is_none());
    assert!(
        runner
            .converted()
            .iter()
            .all(|path| !path.ends_with("big.plist"))
    );
    assert_eq!(
        find(&discovery, "gui/501/small").config_files[0].parse_status,
        ParseStatus::Parsed
    );
    assert_eq!(
        source(&discovery, Source::UserLaunchAgents).status,
        SourceStatus::Partial
    );
}

#[test]
fn symbolic_links_are_never_followed_or_converted() {
    let fixture = Fixture::new();
    let inside = fixture.home().join("elsewhere.plist");
    Fixture::plist(&inside);
    let outside = fixture.root.join("outside.plist");
    Fixture::plist(&outside);
    symlink(&inside, fixture.user("inside.plist")).expect("link inside");
    symlink(&outside, fixture.user("outside.plist")).expect("link outside");
    symlink(
        fixture.root.join("missing.plist"),
        fixture.user("dangling.plist"),
    )
    .expect("dangling");
    symlink(&outside, fixture.global_agent("system-link.plist")).expect("system link");
    let runner = FakeRunner::new()
        .labelled("inside.plist", "inside")
        .labelled("outside.plist", "outside")
        .labelled("dangling.plist", "dangling");

    let discovery = run(&fixture, &runner);

    assert!(runner.converted().is_empty(), "{:?}", runner.converted());
    let link = |name: &str| {
        let service = find(
            &discovery,
            &format!("gui/501/!file/user-launch-agents/{name}.plist"),
        );
        assert_eq!(service.correlation, Correlation::UnmatchedFile);
        service.config_files[0].clone()
    };
    for name in ["inside", "outside", "dangling"] {
        let file = link(name);
        assert_eq!(file.kind, FileKind::Link, "{name}");
        assert_eq!(file.parse_status, ParseStatus::LinkNotRead, "{name}");
        assert!(file.details.is_none(), "{name}");
    }
    assert_eq!(
        link("inside").link_target.expect("target").state,
        LinkState::Inside
    );
    assert_eq!(
        link("outside").link_target.expect("target").state,
        LinkState::Outside
    );
    assert_eq!(
        link("dangling").link_target.expect("target").state,
        LinkState::Unresolved
    );
    let global = find(
        &discovery,
        "gui/501/!file/global-launch-agents/system-link.plist",
    );
    assert_eq!(
        global.config_files[0]
            .link_target
            .as_ref()
            .expect("target")
            .state,
        LinkState::Outside
    );
    // Links are not an error: nothing failed to read.
    assert_eq!(
        source(&discovery, Source::UserLaunchAgents).status,
        SourceStatus::Complete
    );
}

#[test]
fn a_user_directory_linked_out_of_home_is_outside_and_not_listed() {
    let fixture = Fixture::new();
    let elsewhere = fixture.root.join("elsewhere");
    fs::create_dir_all(&elsewhere).expect("create");
    Fixture::plist(&elsewhere.join("com.example.escape.plist"));
    fs::remove_dir_all(fixture.root.join("home/Library/LaunchAgents")).expect("remove");
    symlink(&elsewhere, fixture.root.join("home/Library/LaunchAgents")).expect("link");
    let runner = FakeRunner::new().labelled("com.example.escape.plist", "com.example.escape");

    let discovery = run(&fixture, &runner);

    let report = source(&discovery, Source::UserLaunchAgents);
    assert_eq!(report.status, SourceStatus::Failed);
    assert_eq!(report.reason, Some(SourceReason::OutsideHome));
    assert!(runner.converted().is_empty());
    assert!(discovery.services.is_empty());
}

#[test]
fn without_a_usable_home_only_the_user_directory_fails() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.global_agent("com.example.global.plist"));
    let runner = FakeRunner::new().labelled("com.example.global.plist", "com.example.global");
    let mut locations = fixture.locations();
    locations.user_agents = None;

    let discovery = discover(&Discovery {
        uid: UID,
        home: None,
        locations,
        runner: &runner,
        limits: Limits::default(),
    });

    let report = source(&discovery, Source::UserLaunchAgents);
    assert_eq!(report.status, SourceStatus::Failed);
    assert_eq!(report.reason, Some(SourceReason::HomeUnavailable));
    assert_eq!(
        find(&discovery, "gui/501/com.example.global").scope,
        LaunchdScope::GlobalAgent
    );
    assert!(!discovery.complete);
}

#[test]
fn only_plist_regular_files_of_the_listed_directory_are_considered() {
    let fixture = Fixture::new();
    fs::write(fixture.user("README.txt"), b"x").expect("write");
    fs::write(fixture.user("com.example.a.plist.bak"), b"x").expect("write");
    fs::create_dir_all(fixture.user("nested.plist")).expect("create directory named like a plist");
    fs::create_dir_all(fixture.user("sub")).expect("create");
    Fixture::plist(&fixture.user("sub/com.example.deep.plist"));
    Fixture::plist(&fixture.user("com.example.top.plist"));
    let runner = FakeRunner::new().labelled("com.example.top.plist", "com.example.top");

    let discovery = run(&fixture, &runner);

    assert_eq!(discovery.services.len(), 1);
    assert_eq!(source(&discovery, Source::UserLaunchAgents).items, 1);
    assert_eq!(runner.converted().len(), 1);
}

#[test]
fn entries_per_directory_are_bounded_and_the_result_says_so() {
    let fixture = Fixture::new();
    for index in 0..5 {
        Fixture::plist(&fixture.user(&format!("com.example.{index}.plist")));
    }
    let mut runner = FakeRunner::new();
    for index in 0..5 {
        runner = runner.labelled(
            &format!("com.example.{index}.plist"),
            &format!("com.example.{index}"),
        );
    }
    let limits = Limits {
        max_entries_per_dir: 2,
        ..Limits::default()
    };

    let discovery = run_with(&fixture, &runner, limits);

    let report = source(&discovery, Source::UserLaunchAgents);
    assert_eq!(report.status, SourceStatus::Partial);
    assert_eq!(report.reason, Some(SourceReason::EntryLimit));
    assert_eq!(report.items, 2);
    assert_eq!(discovery.services.len(), 2);
    assert!(!discovery.complete);
}

#[test]
fn the_service_count_is_capped_and_flagged_truncated() {
    let fixture = Fixture::new();
    let rows: Vec<(String, String, String)> = (0..6)
        .map(|index| ("-".into(), "0".into(), format!("com.example.job{index}")))
        .collect();
    let rows: Vec<(&str, &str, &str)> = rows
        .iter()
        .map(|(a, b, c)| (a.as_str(), b.as_str(), c.as_str()))
        .collect();
    let runner = FakeRunner::new().list(&rows);
    let limits = Limits {
        max_services: 4,
        ..Limits::default()
    };

    let discovery = run_with(&fixture, &runner, limits);

    assert_eq!(discovery.services.len(), 4);
    assert!(discovery.truncated);
    assert!(!discovery.complete);
}

#[test]
fn an_exhausted_time_budget_leaves_files_unconverted_and_says_so() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.a.plist"));
    let runner = FakeRunner::new().labelled("com.example.a.plist", "com.example.a");
    let limits = Limits {
        time_budget: Duration::ZERO,
        ..Limits::default()
    };

    let discovery = run_with(&fixture, &runner, limits);

    assert!(runner.converted().is_empty());
    let service = find(
        &discovery,
        "gui/501/!file/user-launch-agents/com.example.a.plist",
    );
    assert_eq!(
        service.config_files[0].parse_status,
        ParseStatus::NotAttempted
    );
    let report = source(&discovery, Source::UserLaunchAgents);
    assert_eq!(report.status, SourceStatus::Partial);
    assert_eq!(report.reason, Some(SourceReason::TimeBudget));
    assert!(!discovery.complete);
}

#[test]
fn a_missing_converter_is_reported_once_and_not_run() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.a.plist"));
    let mut runner = FakeRunner::new().labelled("com.example.a.plist", "com.example.a");
    runner.plutil_available = false;

    let discovery = run(&fixture, &runner);

    assert!(runner.converted().is_empty());
    let service = find(
        &discovery,
        "gui/501/!file/user-launch-agents/com.example.a.plist",
    );
    assert_eq!(
        service.config_files[0].parse_status,
        ParseStatus::ToolUnavailable
    );
    let report = source(&discovery, Source::UserLaunchAgents);
    assert_eq!(report.status, SourceStatus::Partial);
    assert_eq!(report.reason, Some(SourceReason::ToolUnavailable));
}

#[test]
fn secrets_are_masked_end_to_end() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.secret.plist"));
    let runner = FakeRunner::new().json(
        "com.example.secret.plist",
        r#"{
          "Label": "com.example.secret",
          "ProgramArguments": ["/bin/svc", "--token", "tok-123", "API_KEY=key-456", "--name", "ok"],
          "EnvironmentVariables": {"DB_PASSWORD": "pw-789", "MODE": "mode-abc"}
        }"#,
    );

    let discovery = run(&fixture, &runner);

    let serialized = serde_json::to_string(&discovery).expect("serialize");
    for secret in ["tok-123", "key-456", "pw-789", "mode-abc"] {
        assert!(!serialized.contains(secret), "{secret} leaked");
    }
    let details = find(&discovery, "gui/501/com.example.secret").config_files[0]
        .details
        .as_ref()
        .expect("details");
    assert_eq!(details.environment_keys, ["DB_PASSWORD", "MODE"]);
    assert_eq!(
        details.program_arguments,
        [
            "/bin/svc",
            "--token",
            "[REDACTED]",
            "API_KEY=[REDACTED]",
            "--name",
            "ok"
        ]
    );
}

#[test]
fn a_label_loaded_twice_is_flagged_not_merged_silently() {
    let fixture = Fixture::new();
    let runner = FakeRunner::new().list(&[
        ("1", "0", "com.example.twice"),
        ("2", "0", "com.example.twice"),
    ]);

    let discovery = run(&fixture, &runner);

    let service = find(&discovery, "gui/501/com.example.twice");
    assert!(service.issues.contains(&ServiceIssue::DuplicateLoadedLabel));
    assert_eq!(discovery.services.len(), 1);
}

#[test]
fn file_evidence_includes_the_owner_and_directory_without_a_verdict() {
    let fixture = Fixture::new();
    let path = fixture.global_agent("com.example.global.plist");
    Fixture::plist(&path);
    let runner = FakeRunner::new().labelled("com.example.global.plist", "com.example.global");

    let discovery = run(&fixture, &runner);

    let file = &find(&discovery, "gui/501/com.example.global").config_files[0];
    assert_eq!(
        file.owner_uid,
        Some(fs::metadata(&path).expect("metadata").uid())
    );
    assert_eq!(file.directory, LaunchdDirectory::GlobalLaunchAgents);
    assert_eq!(file.scope, LaunchdScope::GlobalAgent);
    assert!(!file.is_apple_path);
    // Outside $HOME the path is shown absolute.
    assert_eq!(file.path, path.to_string_lossy());
    let serialized = serde_json::to_string(&discovery).expect("serialize");
    assert!(!serialized.to_lowercase().contains("modifiable"));
    assert!(!serialized.to_lowercase().contains("manageable"));
}

#[test]
fn only_read_only_commands_are_ever_issued() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.a.plist"));
    Fixture::plist(&fixture.daemon("com.example.b.plist"));
    let runner = FakeRunner::new()
        .labelled("com.example.a.plist", "com.example.a")
        .labelled("com.example.b.plist", "com.example.b");

    run(&fixture, &runner);

    let calls = runner.calls();
    assert!(calls.contains(&("/bin/launchctl".into(), vec!["list".into()])));
    assert!(calls.contains(&(
        "/bin/launchctl".into(),
        vec!["print".into(), "system".into()]
    )));
    for (executable, args) in &calls {
        match executable.as_str() {
            "/bin/launchctl" => {
                let args: Vec<&str> = args.iter().map(String::as_str).collect();
                assert!(
                    ReadOnlyCommand::launchctl_checked(&args).is_ok(),
                    "{args:?}"
                );
            }
            "/usr/bin/plutil" => assert_eq!(&args[..5], ["-convert", "json", "-o", "-", "--"]),
            other => panic!("unexpected executable {other}"),
        }
    }
}

#[test]
fn the_result_serializes_with_stable_names() {
    let fixture = Fixture::new();
    Fixture::plist(&fixture.user("com.example.a.plist"));
    let runner = FakeRunner::new()
        .list(&[("7", "-15", "com.example.a")])
        .labelled("com.example.a.plist", "com.example.a");

    let value = serde_json::to_value(run(&fixture, &runner)).expect("serialize");

    let service = &value["services"][0];
    assert_eq!(service["id"], "gui/501/com.example.a");
    assert_eq!(service["loadState"], "LOADED");
    assert_eq!(service["runState"], "RUNNING");
    assert_eq!(service["domain"], "GUI");
    assert_eq!(service["scope"], "USER_AGENT");
    assert_eq!(service["correlation"], "MATCHED");
    assert_eq!(service["configPresence"], "FOUND");
    assert_eq!(
        service["lastExit"],
        serde_json::json!({"kind": "SIGNAL", "value": 15})
    );
    assert_eq!(service["configFiles"][0]["parseStatus"], "PARSED");
    assert_eq!(service["configFiles"][0]["directory"], "USER_LAUNCH_AGENTS");
    assert!(service["configFiles"][0]["details"]["programArguments"].is_array());
    assert_eq!(value["complete"], true);
    assert_eq!(value["sources"][0]["source"], "LAUNCHCTL_LIST");
}

#[test]
fn only_one_discovery_runs_at_a_time() {
    let first = DiscoveryGate::try_acquire().expect("first acquires");
    assert!(DiscoveryGate::try_acquire().is_none());
    drop(first);
    assert!(DiscoveryGate::try_acquire().is_some());
}
