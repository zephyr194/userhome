use std::{
    collections::HashMap,
    fs,
    os::unix::fs::symlink,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

use serde_json::{Map, Value};
use uuid::Uuid;

use super::{
    DEFAULT_TAIL_BYTES, LogError, LogReset, LogRevokeRequest, LogSessions, LogSinceRequest,
    LogSnapshot, LogState, LogStream, LogTailRequest, LogTarget, MAX_SINCE_BYTES, authorize,
    check_selection, decode_complete, drop_partial_head, expected_log_path, read_since, read_tail,
    revoke, revoke_all,
};
use crate::{
    error::AppError,
    grants::{GrantCoordinator, GrantError, GrantId, GrantPurpose, GrantStore},
    services::launchd::{
        CommandRunner, Discovery, LaunchdDomain, Limits, ReadOnlyCommand, RunError, ScanLocations,
    },
};

struct Env {
    root: PathBuf,
}

impl Env {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-logs-{}", Uuid::new_v4()));
        for name in [
            "home/Library/LaunchAgents",
            "home/Library/Logs",
            "home/.ssh",
            "Library/LaunchAgents",
            "Library/LaunchDaemons",
            "System/Library/LaunchAgents",
            "System/Library/LaunchDaemons",
            "outside",
        ] {
            fs::create_dir_all(root.join(name)).expect("create directory");
        }
        let env = Self { root };
        Env::write(&env.user_plist("com.example.job.plist"), b"placeholder");
        env
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn log(&self, name: &str) -> PathBuf {
        self.home().join("Library/Logs").join(name)
    }

    fn outside(&self, name: &str) -> PathBuf {
        self.root.join("outside").join(name)
    }

    fn user_plist(&self, name: &str) -> PathBuf {
        self.home().join("Library/LaunchAgents").join(name)
    }

    fn write(path: &Path, bytes: &[u8]) {
        fs::write(path, bytes).expect("write fixture file");
    }

    fn locations(&self) -> ScanLocations {
        ScanLocations {
            user_agents: Some(self.home().join("Library/LaunchAgents")),
            global_agents: self.root.join("Library/LaunchAgents"),
            global_daemons: self.root.join("Library/LaunchDaemons"),
            apple_agents: self.root.join("System/Library/LaunchAgents"),
            apple_daemons: self.root.join("System/Library/LaunchDaemons"),
        }
    }

    fn context<'a>(&self, runner: &'a Runner) -> Discovery<'a> {
        // SAFETY: getuid takes no arguments and cannot fail.
        let uid = unsafe { libc::getuid() };
        Discovery {
            uid,
            home: Some(self.home()),
            locations: self.locations(),
            runner,
            limits: Limits::default(),
        }
    }

    fn grants(&self) -> GrantCoordinator {
        GrantCoordinator::new(
            GrantStore::new(self.root.join("support")),
            Some(self.home()),
        )
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Serves the fixture plists by file name and records every command it ran.
struct Runner {
    plists: HashMap<String, String>,
    calls: Mutex<Vec<String>>,
}

impl Runner {
    fn with(plists: &[(&str, String)]) -> Self {
        Self {
            plists: plists
                .iter()
                .map(|(name, json)| ((*name).to_owned(), json.clone()))
                .collect(),
            calls: Mutex::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("calls").clone()
    }
}

impl CommandRunner for Runner {
    fn tool_available(&self, _: &str) -> bool {
        true
    }

    fn run(&self, command: &ReadOnlyCommand) -> Result<String, RunError> {
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        self.calls.lock().expect("calls").push(format!(
            "{} {}",
            command.executable(),
            args.join(" ")
        ));
        match (command.executable(), args.as_slice()) {
            ("/bin/launchctl", ["list"]) => Ok("PID\tStatus\tLabel\n".to_owned()),
            ("/bin/launchctl", ["print", "system"]) => {
                Ok("system = {\n\tservices = {\n\t}\n}\n".to_owned())
            }
            ("/usr/bin/plutil", [.., path]) => {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("file name");
                self.plists.get(name).cloned().ok_or(RunError::Failed)
            }
            other => panic!("unexpected command {other:?}"),
        }
    }
}

fn plist_json(label: &str, stdout: Option<&Path>, stderr: Option<&Path>) -> String {
    let mut object = Map::new();
    object.insert("Label".to_owned(), Value::String(label.to_owned()));
    object.insert(
        "ProgramArguments".to_owned(),
        Value::Array(vec![Value::String("/usr/bin/true".to_owned())]),
    );
    if let Some(path) = stdout {
        object.insert(
            "StandardOutPath".to_owned(),
            Value::String(path.to_string_lossy().into_owned()),
        );
    }
    if let Some(path) = stderr {
        object.insert(
            "StandardErrorPath".to_owned(),
            Value::String(path.to_string_lossy().into_owned()),
        );
    }
    Value::Object(object).to_string()
}

fn job_runner(stdout: Option<&Path>, stderr: Option<&Path>) -> Runner {
    Runner::with(&[(
        "com.example.job.plist",
        plist_json("com.example.job", stdout, stderr),
    )])
}

fn target(stream: LogStream) -> LogTarget {
    LogTarget {
        domain: LaunchdDomain::Gui,
        label: "com.example.job".to_owned(),
        stream,
    }
}

fn tail_request(target: LogTarget, grant_id: &str, max_bytes: Option<usize>) -> LogTailRequest {
    LogTailRequest {
        target,
        grant_id: grant_id.to_owned(),
        max_bytes,
    }
}

fn since_request(target: LogTarget, grant_id: &str, snapshot: &LogSnapshot) -> LogSinceRequest {
    let identity = snapshot.identity.expect("identity of a content read");
    LogSinceRequest {
        target,
        grant_id: grant_id.to_owned(),
        offset: snapshot.next_offset,
        device: identity.device,
        inode: identity.inode,
    }
}

/// Authorizes the declared stdout of the fixture job and returns its grant id.
fn authorized_stdout(env: &Env, runner: &Runner, grants: &GrantCoordinator) -> String {
    let context = env.context(runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");
    authorize(
        grants,
        &LogSessions::default(),
        &target(LogStream::Stdout),
        &canonical,
    )
    .expect("authorize")
    .id
    .as_str()
    .to_owned()
}

#[test]
fn the_declared_stdout_is_resolved_from_the_plist_rediscovered_now() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let context = env.context(&runner);

    let resolved = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");

    assert_eq!(resolved, fs::canonicalize(&log).expect("canonical log"));
}

#[test]
fn a_stream_the_plist_does_not_declare_has_no_file_log() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let context = env.context(&runner);

    assert_eq!(
        expected_log_path(&context, &target(LogStream::Stderr)),
        Err(LogError::NoFileLog)
    );
}

#[test]
fn a_relative_declared_path_is_unsupported() {
    let env = Env::new();
    let runner = job_runner(Some(Path::new("job.log")), None);
    let context = env.context(&runner);

    assert_eq!(
        expected_log_path(&context, &target(LogStream::Stdout)),
        Err(LogError::Relative)
    );
}

#[test]
fn an_unknown_label_is_not_found_and_a_duplicated_one_is_ambiguous() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    fs::remove_file(env.user_plist("com.example.job.plist")).expect("remove job plist");
    let runner = Runner::with(&[]);
    let context = env.context(&runner);
    assert_eq!(
        expected_log_path(&context, &target(LogStream::Stdout)),
        Err(LogError::NotFound)
    );

    let json = plist_json("com.example.job", Some(&log), None);
    let runner = Runner::with(&[("a.plist", json.clone()), ("b.plist", json)]);
    Env::write(&env.user_plist("a.plist"), b"placeholder");
    Env::write(
        &env.root.join("Library/LaunchAgents/b.plist"),
        b"placeholder",
    );
    let context = env.context(&runner);
    assert_eq!(
        expected_log_path(&context, &target(LogStream::Stdout)),
        Err(LogError::Ambiguous)
    );
}

#[test]
fn a_declared_file_that_does_not_exist_cannot_be_authorized() {
    let env = Env::new();
    let runner = job_runner(Some(&env.log("missing.log")), None);
    let context = env.context(&runner);

    assert_eq!(
        expected_log_path(&context, &target(LogStream::Stdout)),
        Err(LogError::Missing)
    );
}

#[test]
fn a_selection_that_is_not_the_declared_file_is_refused() {
    let env = Env::new();
    let log = env.log("job.log");
    let other = env.log("other.log");
    Env::write(&log, b"hello\n");
    Env::write(&other, b"other\n");
    let expected = fs::canonicalize(&log).expect("canonical log");

    assert_eq!(
        check_selection(
            &expected,
            &fs::canonicalize(&other).expect("canonical other")
        ),
        Err(LogError::Mismatch)
    );
    assert_eq!(
        check_selection(&expected, &fs::canonicalize(&log).expect("canonical log")),
        Ok(expected)
    );
}

#[test]
fn a_link_selection_is_compared_by_its_canonical_target() {
    let env = Env::new();
    let log = env.log("job.log");
    let alias = env.log("alias.log");
    Env::write(&log, b"hello\n");
    symlink(&log, &alias).expect("alias link");
    let expected = fs::canonicalize(&log).expect("canonical log");

    assert_eq!(check_selection(&expected, &alias), Ok(expected));
}

#[test]
fn authorizing_grants_a_file_purpose_for_exactly_the_declared_file_and_replaces_the_last_one() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");
    let grants = env.grants();
    let sessions = LogSessions::default();

    let first = authorize(&grants, &sessions, &target(LogStream::Stdout), &canonical)
        .expect("first authorization");
    let second = authorize(&grants, &sessions, &target(LogStream::Stdout), &canonical)
        .expect("second authorization");

    let listed = grants.list().expect("list grants");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, second.id);
    assert_eq!(listed[0].purpose, GrantPurpose::ConfigFile);
    assert_eq!(listed[0].path, canonical);
    assert_ne!(first.id, second.id);
}

#[test]
fn a_file_outside_home_is_refused_even_when_the_plist_declares_it() {
    let env = Env::new();
    let outside = env.outside("job.log");
    Env::write(&outside, b"hello\n");
    let runner = job_runner(Some(&outside), None);
    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");

    assert!(matches!(
        authorize(
            &env.grants(),
            &LogSessions::default(),
            &target(LogStream::Stdout),
            &canonical
        ),
        Err(LogError::Grant(GrantError::OutsideHome))
    ));
}

#[test]
fn a_protected_location_under_home_is_refused() {
    let env = Env::new();
    let secret = env.home().join(".ssh/job.log");
    Env::write(&secret, b"hello\n");
    let runner = job_runner(Some(&secret), None);
    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");

    assert!(matches!(
        authorize(
            &env.grants(),
            &LogSessions::default(),
            &target(LogStream::Stdout),
            &canonical
        ),
        Err(LogError::Grant(GrantError::ProtectedLocation))
    ));
}

#[test]
fn a_link_declared_under_home_that_leaves_home_is_refused_when_authorized() {
    let env = Env::new();
    let outside = env.outside("real.log");
    Env::write(&outside, b"hello\n");
    let link = env.log("linked.log");
    symlink(&outside, &link).expect("escaping link");
    let runner = job_runner(Some(&link), None);
    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");

    assert!(matches!(
        authorize(
            &env.grants(),
            &LogSessions::default(),
            &target(LogStream::Stdout),
            &canonical
        ),
        Err(LogError::Grant(GrantError::OutsideHome))
    ));
}

#[test]
fn a_fifo_declared_as_the_log_cannot_be_authorized() {
    let env = Env::new();
    let fifo = env.log("pipe.log");
    assert!(
        Command::new("/usr/bin/mkfifo")
            .arg(&fifo)
            .status()
            .expect("run mkfifo")
            .success()
    );
    let runner = job_runner(Some(&fifo), None);
    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");

    assert!(matches!(
        authorize(
            &env.grants(),
            &LogSessions::default(),
            &target(LogStream::Stdout),
            &canonical
        ),
        Err(LogError::Grant(_))
    ));
}

#[test]
fn a_tail_read_drops_a_partial_first_line_and_names_the_bytes_it_skipped() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"aaa\nbbb\nccc\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);

    let snapshot = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, Some(6)),
    )
    .expect("tail");

    assert_eq!(snapshot.state, LogState::Content);
    assert_eq!(snapshot.text, "ccc\n");
    assert_eq!(snapshot.skipped_bytes, 6);
    assert!(snapshot.head_trimmed);
    assert_eq!(snapshot.reset, None);
    assert_eq!(snapshot.next_offset, 12);
    assert_eq!(snapshot.file_size, 12);
}

#[test]
fn a_small_file_is_read_whole_without_trimming() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"one\ntwo\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);

    let snapshot = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, None),
    )
    .expect("tail");

    assert_eq!(snapshot.text, "one\ntwo\n");
    assert_eq!(snapshot.skipped_bytes, 0);
    assert!(!snapshot.head_trimmed);
    assert_eq!(snapshot.next_offset, 8);
    assert!(snapshot.identity.is_some());
}

#[test]
fn a_tail_request_is_clamped_and_defaults_to_the_documented_size() {
    assert_eq!(DEFAULT_TAIL_BYTES, 256 * 1024);
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"line\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);

    let zero = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, Some(0)),
    )
    .expect("zero is clamped to one byte");
    assert_eq!(zero.skipped_bytes, 4);
}

#[test]
fn an_incremental_read_returns_only_what_was_appended() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"one\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);
    let first = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, None),
    )
    .expect("tail");

    let mut appended = fs::read(&log).expect("read log");
    appended.extend_from_slice(b"two\n");
    fs::write(&log, &appended).expect("append");
    let second = read_since(
        &context,
        &grants,
        &since_request(target(LogStream::Stdout), &grant, &first),
    )
    .expect("since");

    assert_eq!(second.text, "two\n");
    assert_eq!(second.skipped_bytes, 0);
    assert!(!second.head_trimmed);
    assert_eq!(second.reset, None);
    assert_eq!(second.next_offset, 8);
    assert_eq!(second.identity, first.identity);
}

#[test]
fn a_backlog_beyond_the_incremental_limit_is_skipped_and_counted() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"start\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);
    let first = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, None),
    )
    .expect("tail");

    let mut appended = fs::read(&log).expect("read log");
    let chunk = b"0123456789\n".repeat(30_000);
    appended.extend_from_slice(&chunk);
    fs::write(&log, &appended).expect("append backlog");
    let size = appended.len() as u64;
    let snapshot = read_since(
        &context,
        &grants,
        &since_request(target(LogStream::Stdout), &grant, &first),
    )
    .expect("since");

    let kept = MAX_SINCE_BYTES as u64;
    assert_eq!(snapshot.skipped_bytes, size - kept - first.next_offset);
    assert!(snapshot.head_trimmed);
    assert!(snapshot.text.len() as u64 <= kept);
    assert!(snapshot.text.lines().all(|line| line == "0123456789"));
    assert_eq!(snapshot.next_offset, size);
}

#[test]
fn a_rotated_file_is_reported_and_read_from_its_tail() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"old\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);
    let first = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, None),
    )
    .expect("tail");

    let staged = env.log("job.log.new");
    Env::write(&staged, b"fresh\n");
    fs::rename(&staged, &log).expect("rotate");
    let snapshot = read_since(
        &context,
        &grants,
        &since_request(target(LogStream::Stdout), &grant, &first),
    )
    .expect("since after rotation");

    assert_eq!(snapshot.reset, Some(LogReset::Replaced));
    assert_eq!(snapshot.text, "fresh\n");
    assert_eq!(snapshot.next_offset, 6);
}

#[test]
fn a_truncated_file_is_reported_and_read_again() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"0123456789\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);
    let first = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, None),
    )
    .expect("tail");

    Env::write(&log, b"x\n");
    let snapshot = read_since(
        &context,
        &grants,
        &since_request(target(LogStream::Stdout), &grant, &first),
    )
    .expect("since after truncation");

    assert_eq!(snapshot.reset, Some(LogReset::Truncated));
    assert_eq!(snapshot.text, "x\n");
    assert_eq!(snapshot.identity, first.identity);
}

#[test]
fn a_removed_file_is_reported_as_missing_and_never_as_an_empty_log() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);
    fs::remove_file(&log).expect("remove log");

    let snapshot = read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, None),
    )
    .expect("missing is a state, not an error");

    assert_eq!(snapshot.state, LogState::Missing);
    assert!(snapshot.text.is_empty());
    assert_eq!(snapshot.identity, None);
}

#[test]
fn a_utf8_sequence_split_at_the_end_waits_for_the_next_read() {
    assert_eq!(decode_complete(b"ok\n\xC3"), ("ok\n".to_owned(), 3, false));
    assert_eq!(
        decode_complete("é\n".as_bytes()),
        ("é\n".to_owned(), 3, false)
    );
}

#[test]
fn invalid_utf8_is_shown_as_replacement_and_marked_lossy() {
    assert_eq!(
        decode_complete(b"a\xFFb"),
        ("a\u{FFFD}b".to_owned(), 3, true)
    );
}

#[test]
fn a_leading_partial_line_with_no_line_break_is_fully_dropped() {
    let (dropped, rest) = drop_partial_head(b"no break here");
    assert_eq!(dropped, 13);
    assert!(rest.is_empty());
    let (dropped, rest) = drop_partial_head(b"tail\nnext\n");
    assert_eq!(dropped, 5);
    assert_eq!(rest, b"next\n");
}

#[test]
fn a_changed_plist_path_refuses_the_old_authorization() {
    let env = Env::new();
    let log = env.log("job.log");
    let moved = env.log("moved.log");
    Env::write(&log, b"hello\n");
    Env::write(&moved, b"moved\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);

    let changed = job_runner(Some(&moved), None);
    let context = env.context(&changed);
    assert_eq!(
        read_tail(
            &context,
            &grants,
            &tail_request(target(LogStream::Stdout), &grant, None)
        ),
        Err(LogError::Changed)
    );
}

#[test]
fn a_revoked_or_unknown_grant_is_not_authorized() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let sessions = LogSessions::default();
    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");
    let record =
        authorize(&grants, &sessions, &target(LogStream::Stdout), &canonical).expect("authorize");
    let grant = record.id.as_str().to_owned();
    revoke(&grants, &sessions, &grant).expect("revoke");

    assert_eq!(
        read_tail(
            &context,
            &grants,
            &tail_request(target(LogStream::Stdout), &grant, None)
        ),
        Err(LogError::NotAuthorized)
    );
    let unknown = GrantId::parse(&Uuid::new_v4().to_string()).expect("unknown id");
    assert_eq!(
        read_tail(
            &context,
            &grants,
            &tail_request(target(LogStream::Stdout), unknown.as_str(), None)
        ),
        Err(LogError::NotAuthorized)
    );
}

#[test]
fn a_directory_grant_cannot_be_used_to_read_a_log() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let directory = grants
        .create(
            GrantPurpose::ConfigDirectory,
            &env.home().join("Library/Logs"),
        )
        .expect("directory grant");
    let context = env.context(&runner);

    assert_eq!(
        read_tail(
            &context,
            &grants,
            &tail_request(target(LogStream::Stdout), directory.id.as_str(), None)
        ),
        Err(LogError::NotAuthorized)
    );
}

#[test]
fn revoke_touches_only_grants_the_registry_holds() {
    let env = Env::new();
    let log = env.log("job.log");
    let other = env.log("other.log");
    Env::write(&log, b"hello\n");
    Env::write(&other, b"other\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let foreign = grants
        .create(GrantPurpose::ConfigFile, &other)
        .expect("foreign grant");
    let sessions = LogSessions::default();

    revoke(&grants, &sessions, foreign.id.as_str()).expect("unknown to the registry");
    assert_eq!(grants.list().expect("list").len(), 1);

    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");
    authorize(&grants, &sessions, &target(LogStream::Stdout), &canonical).expect("authorize");
    assert_eq!(grants.list().expect("list").len(), 2);

    revoke_all(&grants, &sessions);
    let remaining = grants.list().expect("list");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, foreign.id);
}

#[test]
fn the_registry_revokes_everything_it_issued_at_exit() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let sessions = LogSessions::default();
    let context = env.context(&runner);
    let canonical = expected_log_path(&context, &target(LogStream::Stdout)).expect("declared");
    authorize(&grants, &sessions, &target(LogStream::Stdout), &canonical).expect("authorize");

    revoke_all(&grants, &sessions);

    assert!(grants.list().expect("list").is_empty());
}

#[test]
fn reading_a_log_runs_only_read_only_discovery_commands() {
    let env = Env::new();
    let log = env.log("job.log");
    Env::write(&log, b"hello\n");
    let runner = job_runner(Some(&log), None);
    let grants = env.grants();
    let grant = authorized_stdout(&env, &runner, &grants);
    let context = env.context(&runner);
    read_tail(
        &context,
        &grants,
        &tail_request(target(LogStream::Stdout), &grant, None),
    )
    .expect("tail");

    let calls = runner.calls();
    assert!(!calls.is_empty());
    for call in calls {
        assert!(
            !call.contains("bootstrap")
                && !call.contains("bootout")
                && !call.contains("kickstart")
                && !call.contains("kill")
                && !call.contains("enable")
                && !call.contains("disable")
                && !call.contains("load")
                && !call.contains("unload"),
            "unexpected command: {call}"
        );
    }
}

#[test]
fn error_messages_never_carry_a_path_or_log_content() {
    let errors = [
        LogError::InvalidLabel,
        LogError::NotFound,
        LogError::Ambiguous,
        LogError::NoFileLog,
        LogError::Relative,
        LogError::Missing,
        LogError::Changed,
        LogError::NotAuthorized,
        LogError::Mismatch,
        LogError::Busy,
        LogError::Read(crate::grants::ReadError::Excluded),
        LogError::Read(crate::grants::ReadError::Unsupported),
        LogError::Read(crate::grants::ReadError::PermissionDenied),
        LogError::Grant(GrantError::OutsideHome),
    ];
    for error in errors {
        let app = AppError::from(error);
        let value = serde_json::to_value(&app).expect("serialize error");
        let message = value["message"].as_str().expect("message");
        assert!(!message.contains('/'), "message carries a path: {message}");
    }
}

#[test]
fn the_requests_reject_unknown_fields_and_take_camel_case_only() {
    let accepted = serde_json::from_str::<LogTailRequest>(
        r#"{"target":{"domain":"GUI","label":"com.example.job","stream":"STDOUT"},"grantId":"g","maxBytes":4}"#,
    );
    assert!(accepted.is_ok());

    let with_path = serde_json::from_str::<LogTailRequest>(
        r#"{"target":{"domain":"GUI","label":"com.example.job","stream":"STDOUT"},"grantId":"g","path":"/etc/passwd"}"#,
    );
    assert!(with_path.is_err());

    let target_with_path = serde_json::from_str::<LogTarget>(
        r#"{"domain":"GUI","label":"com.example.job","stream":"STDOUT","path":"/tmp/x"}"#,
    );
    assert!(target_with_path.is_err());

    let revoke = serde_json::from_str::<LogRevokeRequest>(r#"{"grantId":"g","extra":1}"#);
    assert!(revoke.is_err());
}

#[test]
fn a_since_request_names_a_position_without_a_path() {
    let json = r#"{"target":{"domain":"GUI","label":"com.example.job","stream":"STDERR"},"grantId":"g","offset":12,"device":1,"inode":2}"#;
    let request = serde_json::from_str::<LogSinceRequest>(json).expect("since request");
    assert_eq!(request.target.stream, LogStream::Stderr);
    assert_eq!(request.offset, 12);
    assert!(
        serde_json::from_str::<LogSinceRequest>(
            r#"{"target":{"domain":"GUI","label":"com.example.job","stream":"STDERR"},"grantId":"g","offset":1,"device":1,"inode":2,"file":"/x"}"#
        )
        .is_err()
    );
}
