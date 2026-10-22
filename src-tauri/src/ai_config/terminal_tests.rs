use std::{
    cell::RefCell,
    env,
    fs::{self, DirBuilder, Permissions},
    os::unix::fs::{DirBuilderExt, PermissionsExt, symlink},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use uuid::Uuid;

use super::*;
use crate::{
    ai_config::{
        command::{
            BuiltCommand, CommandError, CommandRequest, ItemChoice, SECRET_PLACEHOLDER,
            build_claude_command,
        },
        read::claude_tool,
        validate::load_all,
    },
    error::AppErrorCode,
};

const SECRET_SAMPLE: &str = "sk-ant-test-0123456789";
const VALUE_MATRIX: &[&str] = &[
    "sonnet",
    "a b",
    "中文 🙂 Ünïcode",
    "it's",
    "'",
    "''",
    "$(touch /tmp/pwned)",
    "`id`",
    "a;rm -rf ~",
    "a&&b",
    "a||b",
    "a|b",
    "a>out",
    "a<in",
    "~",
    "*",
    "?",
    "[a-z]",
    "{a,b}",
    "$HOME",
    "${HOME}",
    "x\\y",
    "-rf",
    "--dangerously-skip-permissions",
    "#note",
    "!history",
    "a\"b",
    "%1",
    "a=b",
    "é",
    "\\'",
];

struct Root(PathBuf);

impl Root {
    fn new() -> Self {
        let path = env::temp_dir().join(format!("userhome-terminal-test-{}", Uuid::new_v4()));
        DirBuilder::new().mode(0o700).create(&path).expect("root");
        Self(path)
    }

    fn terminal(&self) -> PathBuf {
        self.0.join(TERMINAL_DIRECTORY)
    }
}

impl Drop for Root {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct FakeLauncher {
    calls: RefCell<Vec<(PathBuf, Vec<String>)>>,
    fail: bool,
}

impl Launcher for FakeLauncher {
    fn run(&self, program: &Path, arguments: &[&str]) -> Result<(), ProcessError> {
        self.calls.borrow_mut().push((
            program.to_path_buf(),
            arguments
                .iter()
                .map(|argument| (*argument).to_owned())
                .collect(),
        ));
        if self.fail {
            Err(ProcessError::Spawn)
        } else {
            Ok(())
        }
    }
}

fn build(request: &CommandRequest) -> Result<BuiltCommand, CommandError> {
    let definitions = load_all().expect("claude definitions load");
    let tool = claude_tool(&definitions).expect("claude tool present");
    build_claude_command(tool, request)
}

fn model_request(value: &str) -> CommandRequest {
    CommandRequest {
        flags: vec![ItemChoice {
            id: "--model".to_owned(),
            value: Some(value.to_owned()),
        }],
        env: Vec::new(),
        acknowledged_risks: Vec::new(),
        detected_version: None,
    }
}

/// Accepts only what zsh would read as one word per run of text: single-quoted
/// literals, bare ASCII words and the `'\''` escape outside quotes. Any other
/// metacharacter could start a second command, so it fails the test. Nothing is run.
fn assert_only_plain_words(line: &str) {
    let mut chars = line.chars();
    let mut quoted = false;
    while let Some(character) = chars.next() {
        if quoted {
            quoted = character != '\'';
            continue;
        }
        match character {
            '\'' => quoted = true,
            '\\' => assert_eq!(chars.next(), Some('\''), "unsafe escape in {line}"),
            ' ' | '=' | '-' | '_' | '.' | '/' | ':' => {}
            other => assert!(
                other.is_ascii_alphanumeric(),
                "unquoted {other:?} in {line}"
            ),
        }
    }
    assert!(!quoted, "unterminated quote in {line}");
}

#[test]
fn script_matches_the_fixed_template_with_a_work_directory() {
    let expected = [
        "#!/bin/zsh",
        "cd -- '/Users/a/My Project' || { rm -- \"$0\"; exit 1; }",
        "printf '%s\\n' '将运行的命令：'",
        "printf '%s\\n' 'claude --print'",
        "read -r \"?按回车运行，Ctrl-C 取消：\"",
        "rm -- \"$0\"",
        "claude --print",
        "",
    ]
    .join("\n");
    assert_eq!(
        script_text("claude --print", Some("/Users/a/My Project")),
        expected
    );
}

#[test]
fn script_without_a_work_directory_never_changes_directory() {
    let script = script_text("claude", None);
    assert!(!script.contains("cd --"));
    assert!(script.starts_with("#!/bin/zsh\nprintf '%s\\n' '将运行的命令：'\n"));
    assert!(script.ends_with("rm -- \"$0\"\nclaude\n"));
}

#[test]
fn script_quotes_the_directory_and_the_printed_command_as_literals() {
    let script = script_text("claude", Some("/tmp/it's here"));
    assert!(script.contains("cd -- '/tmp/it'\\''s here' ||"));
    assert!(script.contains("printf '%s\\n' 'claude'\n"));
}

#[test]
fn hostile_values_never_add_a_second_command() {
    for value in VALUE_MATRIX {
        let built = build(&model_request(value)).expect(value);
        let script = script_text(&built.text, Some("/tmp/work"));
        let command_line = script.lines().last().expect("command line");
        assert_eq!(command_line, built.text, "{value}");
        assert_only_plain_words(command_line);
        assert!(script.contains(&format!("printf '%s\\n' {}", quote(&built.text))));
    }
}

#[test]
fn hostile_directory_names_stay_inside_one_quoted_word() {
    for directory in ["it's; rm -rf ~", "$(id)", "`id`", "a&&b", "中文 空格"] {
        let script = script_text("claude", Some(directory));
        assert!(script.contains(&format!("cd -- {} ||", quote(directory))));
    }
}

#[test]
fn secret_values_are_refused_and_never_echoed() {
    let request = CommandRequest {
        flags: Vec::new(),
        env: vec![ItemChoice {
            id: "ANTHROPIC_API_KEY".to_owned(),
            value: Some(SECRET_SAMPLE.to_owned()),
        }],
        acknowledged_risks: Vec::new(),
        detected_version: None,
    };
    let error = build(&request).expect_err("real secret refused");
    assert_eq!(
        error,
        CommandError::UnexpectedValue("ANTHROPIC_API_KEY".to_owned())
    );
    assert!(!error.message().contains(SECRET_SAMPLE));
}

#[test]
fn secret_variables_only_ever_produce_the_placeholder_in_the_script() {
    let request = CommandRequest {
        flags: Vec::new(),
        env: vec![ItemChoice {
            id: "ANTHROPIC_API_KEY".to_owned(),
            value: None,
        }],
        acknowledged_risks: Vec::new(),
        detected_version: None,
    };
    let built = build(&request).expect("placeholder command");
    let script = script_text(&built.text, None);
    assert!(script.contains(SECRET_PLACEHOLDER));
    assert!(!script.contains(SECRET_SAMPLE));
}

#[test]
fn open_arguments_are_a_fixed_array_with_only_the_script_path_variable() {
    assert_eq!(
        open_arguments("/private/x/ai-command.command"),
        ["-a", "Terminal", "/private/x/ai-command.command"]
    );
    assert_eq!(OPEN_PROGRAM, "/usr/bin/open");
}

#[test]
fn terminal_module_never_uses_applescript() {
    assert!(!include_str!("terminal.rs").contains("osascript"));
}

#[test]
fn opening_writes_one_owner_only_script_and_launches_open_with_fixed_arguments() {
    let root = Root::new();
    let launcher = FakeLauncher::default();
    let work = root.0.join("project");
    let plan = TerminalPlan {
        command: "claude --print",
        work_dir: Some(work.as_path()),
    };
    open_command(&root.terminal(), &root.0, &plan, &launcher).expect("opened");

    let scripts = fs::read_dir(root.terminal())
        .expect("terminal dir")
        .map(|entry| entry.expect("entry").path())
        .collect::<Vec<_>>();
    assert_eq!(scripts.len(), 1);
    let script = &scripts[0];
    let name = script
        .file_name()
        .and_then(|name| name.to_str())
        .expect("name");
    assert!(name.starts_with(SCRIPT_PREFIX) && name.ends_with(SCRIPT_SUFFIX));
    assert_eq!(
        fs::metadata(script).expect("script").permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(root.terminal())
            .expect("dir")
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::read_to_string(script).expect("script text"),
        script_text("claude --print", Some(work.to_str().expect("utf8")))
    );

    let calls = launcher.calls.borrow();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, Path::new("/usr/bin/open"));
    assert_eq!(
        calls[0].1,
        vec![
            "-a".to_owned(),
            "Terminal".to_owned(),
            script.to_str().expect("utf8").to_owned(),
        ]
    );
}

#[test]
fn a_failed_launch_removes_the_script_and_reports_a_process_failure() {
    let root = Root::new();
    let launcher = FakeLauncher {
        fail: true,
        ..FakeLauncher::default()
    };
    let plan = TerminalPlan {
        command: "claude",
        work_dir: None,
    };
    let error = open_command(&root.terminal(), &root.0, &plan, &launcher).expect_err("failed");
    assert_eq!(error.code(), AppErrorCode::ProcessFailed);
    assert_eq!(fs::read_dir(root.terminal()).expect("dir").count(), 0);
}

#[test]
fn a_symlinked_terminal_directory_is_refused_and_nothing_is_launched() {
    let root = Root::new();
    let elsewhere = root.0.join("elsewhere");
    DirBuilder::new()
        .mode(0o700)
        .create(&elsewhere)
        .expect("elsewhere");
    symlink(&elsewhere, root.terminal()).expect("symlink");
    let launcher = FakeLauncher::default();
    let plan = TerminalPlan {
        command: "claude",
        work_dir: None,
    };
    let error = open_command(&root.terminal(), &root.0, &plan, &launcher).expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
    assert!(launcher.calls.borrow().is_empty());
    assert_eq!(fs::read_dir(&elsewhere).expect("elsewhere").count(), 0);
}

#[test]
fn a_terminal_directory_with_group_or_other_access_is_refused() {
    let root = Root::new();
    DirBuilder::new()
        .mode(0o755)
        .create(root.terminal())
        .expect("dir");
    fs::set_permissions(root.terminal(), Permissions::from_mode(0o755)).expect("chmod");
    let launcher = FakeLauncher::default();
    let plan = TerminalPlan {
        command: "claude",
        work_dir: None,
    };
    let error = open_command(&root.terminal(), &root.0, &plan, &launcher).expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
    assert!(launcher.calls.borrow().is_empty());
}

#[test]
fn a_work_directory_with_control_characters_is_refused_before_anything_is_written() {
    let root = Root::new();
    let launcher = FakeLauncher::default();
    let work = PathBuf::from("/tmp/bad\nname");
    let plan = TerminalPlan {
        command: "claude",
        work_dir: Some(work.as_path()),
    };
    let error = open_command(&root.terminal(), &root.0, &plan, &launcher).expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::InvalidInput);
    assert_eq!(fs::read_dir(root.terminal()).expect("dir").count(), 0);
    assert!(launcher.calls.borrow().is_empty());
}

#[test]
fn sweep_removes_only_expired_files_with_the_generated_name() {
    let root = Root::new();
    let directory = root.terminal();
    DirBuilder::new()
        .mode(0o700)
        .create(&directory)
        .expect("dir");
    let generated = |id: Uuid| format!("{SCRIPT_PREFIX}{id}{SCRIPT_SUFFIX}");
    let expired = directory.join(generated(Uuid::new_v4()));
    let kept = [
        directory.join("notes.command"),
        directory.join(format!("{SCRIPT_PREFIX}not-a-uuid{SCRIPT_SUFFIX}")),
        directory.join(format!("{SCRIPT_PREFIX}{}.txt", Uuid::new_v4())),
    ];
    fs::write(&expired, "#!/bin/zsh\n").expect("expired");
    for path in &kept {
        fs::write(path, "x").expect("kept");
    }
    let outside = root.0.join("outside.txt");
    fs::write(&outside, "secret").expect("outside");
    let link = directory.join(generated(Uuid::new_v4()));
    symlink(&outside, &link).expect("link");

    sweep_expired(&directory, SystemTime::now());
    assert!(expired.exists(), "fresh files survive a current sweep");

    let later = SystemTime::now() + MAX_SCRIPT_AGE + Duration::from_secs(60);
    sweep_expired(&directory, later);
    assert!(!expired.exists());
    for path in &kept {
        assert!(path.exists(), "{} should be kept", path.display());
    }
    assert!(
        fs::symlink_metadata(&link)
            .expect("link")
            .file_type()
            .is_symlink()
    );
    assert!(outside.exists(), "symlink target is never touched");
}

#[test]
fn sweep_tolerates_a_missing_directory() {
    let root = Root::new();
    sweep_expired(&root.terminal(), SystemTime::now());
}
