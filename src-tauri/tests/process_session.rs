//! Fixture-based tests for the process session runner and the one-shot runner.
//! Fixture scripts are created in a temporary directory by the tests themselves.

mod process_runner {
    use std::{
        fs,
        os::unix::fs::PermissionsExt,
        path::{Path, PathBuf},
        time::{Duration, Instant},
    };

    use userhome_lib::{
        process::{EnvPolicy, ProcessError, RunOptions, run_bounded, run_bounded_with},
        process_session::{EnvSpec, LaunchSpec, ProcessSession, SessionState, StopOutcome},
    };

    struct Fixture {
        dir: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("userhome-process-{}", uuid_like()));
            fs::create_dir_all(&dir).expect("create fixture dir");
            let dir = fs::canonicalize(dir).expect("canonical fixture dir");
            Self { dir }
        }

        fn script(&self, name: &str, body: &str) -> PathBuf {
            let path = self.dir.join(name);
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
            path
        }

        fn pid_file(&self) -> PathBuf {
            self.dir.join("grandchild.pid")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    fn uuid_like() -> String {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        format!(
            "{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if condition() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        condition()
    }

    fn read_pid(path: &Path) -> i32 {
        assert!(
            wait_until(Duration::from_secs(5), || fs::read_to_string(path)
                .is_ok_and(|text| text.trim().parse::<i32>().is_ok())),
            "fixture pid file not written"
        );
        fs::read_to_string(path)
            .expect("pid file")
            .trim()
            .parse()
            .expect("pid")
    }

    fn process_exists(pid: i32) -> bool {
        // SAFETY: signal 0 only checks existence; the pid is a fixture process.
        unsafe { libc::kill(pid, 0) == 0 }
    }

    /// A script that starts a background `sleep` holding stdout/stderr, records
    /// its pid, then sleeps itself.
    fn grandchild_script(fixture: &Fixture) -> PathBuf {
        let pid_file = fixture.pid_file();
        fixture.script(
            "with-grandchild.sh",
            &format!(
                "sleep 300 &\necho $! > '{}.tmp'\nmv '{}.tmp' '{}'\necho ready\nsleep 300",
                pid_file.display(),
                pid_file.display(),
                pid_file.display()
            ),
        )
    }

    fn spec(executable: &Path, cwd: &Path) -> LaunchSpec {
        LaunchSpec::new(executable, cwd).env(EnvSpec::new().inherit("PATH"))
    }

    #[test]
    fn process_session_stop_kills_the_whole_group_including_pipe_holding_grandchildren() {
        let fixture = Fixture::new();
        let script = grandchild_script(&fixture);
        let session = ProcessSession::start(&spec(&script, &fixture.dir)).expect("start");
        let grandchild = read_pid(&fixture.pid_file());
        assert!(process_exists(grandchild));
        assert_eq!(session.status().state, SessionState::Running);

        let started = Instant::now();
        let outcome = session.stop(Duration::from_secs(2), Duration::from_secs(2));

        assert!(
            matches!(outcome, StopOutcome::Terminated { .. }),
            "{outcome:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(session.status().state, SessionState::Exited);
        assert!(
            wait_until(Duration::from_secs(3), || !process_exists(grandchild)),
            "grandchild survived the stop"
        );
    }

    #[test]
    fn process_one_shot_timeout_ends_the_whole_group_without_hanging() {
        let fixture = Fixture::new();
        let script = grandchild_script(&fixture);
        let started = Instant::now();

        let error = run_bounded_with(
            &script,
            &[],
            Duration::from_millis(1500),
            1024,
            &RunOptions {
                env: EnvPolicy::Explicit(EnvSpec::new().inherit("PATH")),
                cwd: Some(&fixture.dir),
            },
        )
        .expect_err("timeout");

        assert_eq!(error, ProcessError::Timeout);
        assert!(started.elapsed() < Duration::from_secs(5));
        let grandchild = read_pid(&fixture.pid_file());
        assert!(
            wait_until(Duration::from_secs(3), || !process_exists(grandchild)),
            "grandchild survived the timeout"
        );
    }

    #[test]
    fn process_legacy_run_bounded_timeout_also_ends_the_whole_group() {
        let fixture = Fixture::new();
        let script = grandchild_script(&fixture);

        let error =
            run_bounded(&script, &[], Duration::from_millis(1500), 1024).expect_err("timeout");

        assert_eq!(error, ProcessError::Timeout);
        let grandchild = read_pid(&fixture.pid_file());
        assert!(wait_until(Duration::from_secs(3), || !process_exists(
            grandchild
        )));
    }

    #[test]
    fn process_one_shot_kills_a_pipe_holding_descendant_that_outlives_the_leader() {
        let fixture = Fixture::new();
        let pid_file = fixture.pid_file();
        let script = fixture.script(
            "leader-exits.sh",
            &format!("sleep 300 &\necho $! > '{}'\nexit 0", pid_file.display()),
        );
        let started = Instant::now();

        let error = run_bounded(&script, &[], Duration::from_millis(1500), 1024)
            .expect_err("descendant keeps the pipe open");

        assert_eq!(error, ProcessError::Timeout);
        assert!(started.elapsed() < Duration::from_secs(5));
        let grandchild = read_pid(&pid_file);
        assert!(wait_until(Duration::from_secs(3), || !process_exists(
            grandchild
        )));
    }

    #[test]
    fn process_session_output_flood_stays_within_the_buffer_and_shows_truncation() {
        let fixture = Fixture::new();
        let script = fixture.script(
            "flood.sh",
            "i=0\nwhile [ $i -lt 3000 ]; do\n  echo \"line-$i-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"\n  echo \"err-$i\" >&2\n  i=$((i+1))\ndone",
        );
        let session =
            ProcessSession::start(&spec(&script, &fixture.dir).log_capacity(4096)).expect("start");

        let exit = session.wait(Duration::from_secs(20)).expect("exit");
        assert_eq!(exit.code, Some(0));
        // Pipe readers finish shortly after the leader exits.
        assert!(wait_until(Duration::from_secs(5), || {
            session.stdout().text().contains("line-2999-")
                && session.stderr().text().contains("err-2999")
        }));

        let stdout = session.stdout();
        assert!(stdout.bytes().len() <= 4096);
        assert!(stdout.is_truncated());
        assert!(stdout.dropped_bytes() > 100_000);
        assert!(stdout.text().starts_with("[userhome: "));
        assert!(stdout.text().contains("earlier bytes truncated]"));
        assert!(!stdout.text().contains("line-0-"));
        let stderr = session.stderr();
        assert!(stderr.bytes().len() <= 4096);
        assert!(stderr.is_truncated());
    }

    #[test]
    fn process_session_default_capacity_is_two_mebibytes_and_small_output_is_not_marked() {
        let fixture = Fixture::new();
        let script = fixture.script("small.sh", "echo hello");
        let session = ProcessSession::start(&spec(&script, &fixture.dir)).expect("start");

        session.wait(Duration::from_secs(5)).expect("exit");

        assert!(wait_until(Duration::from_secs(3), || session
            .stdout()
            .text()
            == "hello\n"));
        assert!(!session.stdout().is_truncated());
        assert_eq!(
            userhome_lib::process_session::DEFAULT_LOG_CAPACITY,
            2 * 1024 * 1024
        );
    }

    #[test]
    fn process_session_only_allowed_environment_reaches_the_child() {
        assert!(
            std::env::var_os("CARGO_MANIFEST_DIR").is_some(),
            "cargo sets this for test runs"
        );
        let fixture = Fixture::new();
        let env = EnvSpec::new()
            .inherit("CARGO_PKG_NAME")
            .inherit("USERHOME_NOT_SET_ANYWHERE")
            .set("EXPLICIT_VALUE", "visible");
        let session =
            ProcessSession::start(&LaunchSpec::new("/usr/bin/env", &fixture.dir).env(env))
                .expect("start");

        session.wait(Duration::from_secs(5)).expect("exit");
        assert!(wait_until(Duration::from_secs(3), || !session
            .stdout()
            .bytes()
            .is_empty()));

        let mut names: Vec<String> = session
            .stdout()
            .text()
            .lines()
            .filter_map(|line| line.split('=').next().map(str::to_owned))
            .collect();
        names.sort();
        assert_eq!(names, ["CARGO_PKG_NAME", "EXPLICIT_VALUE"]);
        assert!(session.stdout().text().contains("EXPLICIT_VALUE=visible"));
    }

    #[test]
    fn process_one_shot_explicit_environment_is_cleared_while_legacy_inherits() {
        let fixture = Fixture::new();
        let explicit = run_bounded_with(
            Path::new("/usr/bin/env"),
            &[],
            Duration::from_secs(5),
            4096,
            &RunOptions {
                env: EnvPolicy::Explicit(EnvSpec::new().set("ONLY_THIS", "1")),
                cwd: Some(&fixture.dir),
            },
        )
        .expect("env");
        assert_eq!(explicit.stdout, "ONLY_THIS=1\n");

        let legacy = run_bounded(
            Path::new("/usr/bin/env"),
            &[],
            Duration::from_secs(5),
            1 << 20,
        )
        .expect("env");
        assert!(legacy.stdout.contains("CARGO_MANIFEST_DIR="));
    }

    #[test]
    fn process_arguments_with_shell_metacharacters_are_passed_literally() {
        let fixture = Fixture::new();
        let marker = fixture.dir.join("must-not-exist");
        let tricky = format!("$(touch {}) ; `id` | * && $HOME", marker.display());
        let session = ProcessSession::start(
            &LaunchSpec::new("/usr/bin/printf", &fixture.dir).args(["%s", tricky.as_str()]),
        )
        .expect("start");

        session.wait(Duration::from_secs(5)).expect("exit");

        assert!(wait_until(Duration::from_secs(3), || session
            .stdout()
            .text()
            == tricky));
        assert!(!marker.exists());

        let one_shot = run_bounded_with(
            Path::new("/usr/bin/printf"),
            &["%s", tricky.as_str()],
            Duration::from_secs(5),
            4096,
            &RunOptions {
                env: EnvPolicy::Explicit(EnvSpec::new()),
                cwd: None,
            },
        )
        .expect("printf");
        assert_eq!(one_shot.stdout, tricky);
        assert!(!marker.exists());
    }

    #[test]
    fn process_session_stop_sends_sigterm_first_and_does_not_escalate_when_it_is_honoured() {
        let fixture = Fixture::new();
        let script = fixture.script(
            "term.sh",
            "trap 'echo got-term; exit 0' TERM\necho ready\nwhile :; do sleep 0.05; done",
        );
        let session = ProcessSession::start(&spec(&script, &fixture.dir)).expect("start");
        assert!(wait_until(Duration::from_secs(5), || session
            .stdout()
            .text()
            .contains("ready")));

        let outcome = session.stop(Duration::from_secs(5), Duration::from_secs(2));

        let StopOutcome::Terminated {
            exit,
            escalated_to_kill,
        } = outcome
        else {
            panic!("expected terminated, got {outcome:?}");
        };
        assert!(!escalated_to_kill);
        assert_eq!(exit.code, Some(0));
        assert!(wait_until(Duration::from_secs(3), || session
            .stdout()
            .text()
            .contains("got-term")));
        assert!(session.status().stop_requested);
    }

    #[test]
    fn process_session_stop_escalates_to_sigkill_when_sigterm_is_ignored() {
        let fixture = Fixture::new();
        let script = fixture.script(
            "ignore-term.sh",
            "trap '' TERM\necho ready\nwhile :; do sleep 0.05; done",
        );
        let session = ProcessSession::start(&spec(&script, &fixture.dir)).expect("start");
        assert!(wait_until(Duration::from_secs(5), || session
            .stdout()
            .text()
            .contains("ready")));

        let outcome = session.stop(Duration::from_millis(300), Duration::from_secs(3));

        let StopOutcome::Terminated {
            exit,
            escalated_to_kill,
        } = outcome
        else {
            panic!("expected terminated, got {outcome:?}");
        };
        assert!(escalated_to_kill);
        assert_eq!(exit.signal, Some(libc::SIGKILL));
        assert_eq!(session.status().state, SessionState::Exited);
    }

    #[test]
    fn process_session_reports_exit_codes_and_second_stop_signals_nothing() {
        let fixture = Fixture::new();
        let script = fixture.script("fail.sh", "exit 3");
        let session = ProcessSession::start(&spec(&script, &fixture.dir)).expect("start");

        let exit = session.wait(Duration::from_secs(5)).expect("exit");

        assert_eq!(exit.code, Some(3));
        assert_eq!(session.status().state, SessionState::Exited);
        assert_eq!(
            session.stop(Duration::from_millis(50), Duration::from_millis(50)),
            StopOutcome::AlreadyExited(exit)
        );
    }

    #[test]
    fn process_session_drop_kills_the_group_instead_of_leaving_orphans() {
        let fixture = Fixture::new();
        let script = grandchild_script(&fixture);
        let session = ProcessSession::start(&spec(&script, &fixture.dir)).expect("start");
        let grandchild = read_pid(&fixture.pid_file());
        assert!(process_exists(grandchild));

        drop(session);

        assert!(wait_until(Duration::from_secs(3), || !process_exists(
            grandchild
        )));
    }

    #[test]
    fn process_session_runs_in_the_requested_directory_with_its_own_group() {
        let fixture = Fixture::new();
        let script = fixture.script("pwd.sh", "pwd\nps -o pgid= -p $$");
        let session = ProcessSession::start(&spec(&script, &fixture.dir)).expect("start");

        session.wait(Duration::from_secs(5)).expect("exit");

        assert!(wait_until(Duration::from_secs(3), || session
            .stdout()
            .text()
            .lines()
            .count()
            == 2));
        let text = session.stdout().text();
        let mut lines = text.lines();
        assert_eq!(Path::new(lines.next().expect("pwd")), fixture.dir);
        let child_group: i32 = lines.next().expect("pgid").trim().parse().expect("pgid");
        assert_eq!(child_group, i32::try_from(session.pid()).expect("pid"));
        // SAFETY: getpgrp takes no arguments and cannot fail.
        assert_ne!(child_group, unsafe { libc::getpgrp() });
    }
}
