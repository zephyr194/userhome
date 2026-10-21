//! State-changing launchctl commands, kept apart from the read-only allow list.
//!
//! A [`MutatingCommand`] is only ever built by a typed constructor or by
//! [`MutatingCommand::checked`], and both fix the domain to the current user's
//! `gui/<uid>`: `system`, `user/<uid>` and another uid are unrepresentable. The
//! accepted forms are exactly `bootstrap`, `bootout`, `kickstart [-k]`,
//! `kill SIGTERM`, `enable` and `disable`; every other subcommand, flag, signal
//! or extra argument is refused. The label is validated and the plist path (for
//! `bootstrap` only) must be an absolute `.plist` under a `Library/LaunchAgents`
//! directory, which the caller takes from its own rediscovery, never from the
//! frontend. Commands run with an absolute executable, an argument array (no
//! shell), an explicit environment, a timeout and an output limit.

use std::{fs, path::Path, time::Duration};

use crate::{
    process::{EnvPolicy, ProcessError, RunOptions, run_bounded_with},
    process_session::EnvSpec,
    services::launchd::{Label, Rejected},
};

pub const LAUNCHCTL: &str = "/bin/launchctl";

const STEP_TIMEOUT: Duration = Duration::from_secs(15);
const STEP_MAX_OUTPUT: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutatingCommand {
    args: Vec<String>,
}

fn domain_target(uid: u32) -> String {
    format!("gui/{uid}")
}

fn service_target(uid: u32, label: &Label) -> String {
    format!("gui/{uid}/{}", label.as_str())
}

fn plist_path_text(path: &Path) -> Result<&str, Rejected> {
    use std::path::Component;
    let text = path.to_str().ok_or(Rejected::Path)?;
    let plain = path
        .components()
        .all(|component| !matches!(component, Component::ParentDir | Component::CurDir));
    let name = path.file_name().and_then(|name| name.to_str());
    let in_launch_agents = path.parent().is_some_and(|parent| {
        parent
            .file_name()
            .is_some_and(|name| name == "LaunchAgents")
    }) && path
        .parent()
        .and_then(Path::parent)
        .is_some_and(|parent| parent.file_name().is_some_and(|name| name == "Library"));
    let named = name.is_some_and(|name| name.len() > ".plist".len() && name.ends_with(".plist"));
    if path.is_absolute() && !text.contains('\0') && plain && in_launch_agents && named {
        Ok(text)
    } else {
        Err(Rejected::Path)
    }
}

impl MutatingCommand {
    fn launchctl(args: Vec<String>) -> Self {
        Self { args }
    }

    pub fn executable(&self) -> &'static str {
        LAUNCHCTL
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    /// The first argument, for logs and tests.
    pub fn verb(&self) -> &str {
        self.args.first().map_or("", String::as_str)
    }

    /// `launchctl <args…>` as one line for previews and history. Every part is
    /// built by this module from validated pieces; there is no secret in it.
    pub fn display(&self) -> String {
        format!("launchctl {}", self.args.join(" "))
    }

    /// `launchctl bootstrap gui/<uid> <plist>`
    pub fn bootstrap(uid: u32, plist: &Path) -> Result<Self, Rejected> {
        let text = plist_path_text(plist)?;
        Ok(Self::launchctl(vec![
            "bootstrap".to_owned(),
            domain_target(uid),
            text.to_owned(),
        ]))
    }

    /// `launchctl bootout gui/<uid>/<label>`
    pub fn bootout(uid: u32, label: &Label) -> Self {
        Self::launchctl(vec!["bootout".to_owned(), service_target(uid, label)])
    }

    /// `launchctl kickstart gui/<uid>/<label>`
    pub fn kickstart(uid: u32, label: &Label) -> Self {
        Self::launchctl(vec!["kickstart".to_owned(), service_target(uid, label)])
    }

    /// `launchctl kickstart -k gui/<uid>/<label>` (stops a running instance first).
    pub fn kickstart_kill(uid: u32, label: &Label) -> Self {
        Self::launchctl(vec![
            "kickstart".to_owned(),
            "-k".to_owned(),
            service_target(uid, label),
        ])
    }

    /// `launchctl kill SIGTERM gui/<uid>/<label>`; the signal is fixed.
    pub fn kill_term(uid: u32, label: &Label) -> Self {
        Self::launchctl(vec![
            "kill".to_owned(),
            "SIGTERM".to_owned(),
            service_target(uid, label),
        ])
    }

    /// `launchctl enable gui/<uid>/<label>`
    pub fn enable(uid: u32, label: &Label) -> Self {
        Self::launchctl(vec!["enable".to_owned(), service_target(uid, label)])
    }

    /// `launchctl disable gui/<uid>/<label>`
    pub fn disable(uid: u32, label: &Label) -> Self {
        Self::launchctl(vec!["disable".to_owned(), service_target(uid, label)])
    }

    /// Builds a command from raw arguments for `uid`, accepting only the allow
    /// list above.
    pub fn checked(uid: u32, args: &[&str]) -> Result<Self, Rejected> {
        let service = |target: &str| {
            target
                .strip_prefix(&format!("gui/{uid}/"))
                .ok_or(Rejected::Domain)
                .and_then(Label::parse)
        };
        match args {
            ["bootstrap", domain, path] => {
                if *domain == domain_target(uid) {
                    Self::bootstrap(uid, Path::new(path))
                } else {
                    Err(Rejected::Domain)
                }
            }
            ["bootout", target] => Ok(Self::bootout(uid, &service(target)?)),
            ["kickstart", target] => Ok(Self::kickstart(uid, &service(target)?)),
            ["kickstart", "-k", target] => Ok(Self::kickstart_kill(uid, &service(target)?)),
            ["kill", "SIGTERM", target] => Ok(Self::kill_term(uid, &service(target)?)),
            ["enable", target] => Ok(Self::enable(uid, &service(target)?)),
            ["disable", target] => Ok(Self::disable(uid, &service(target)?)),
            _ => Err(Rejected::Subcommand),
        }
    }
}

/// What a step printed. Both streams are bounded by the runner.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StepOutput {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepError {
    ToolMissing,
    Timeout,
    OutputTooLarge,
    /// Nonzero exit; the streams are kept for the (sanitized) history.
    Failed {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
    Io,
}

/// Runs one state-changing command. Tests inject a fake; production uses
/// [`SystemMutatingRunner`]. Tests must never use the real one.
pub trait MutatingRunner: Sync {
    fn run(&self, command: &MutatingCommand) -> Result<StepOutput, StepError>;
}

pub struct SystemMutatingRunner;

impl MutatingRunner for SystemMutatingRunner {
    fn run(&self, command: &MutatingCommand) -> Result<StepOutput, StepError> {
        let path = Path::new(command.executable());
        if !fs::metadata(path).is_ok_and(|metadata| metadata.is_file()) {
            return Err(StepError::ToolMissing);
        }
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        let options = RunOptions {
            env: EnvPolicy::Explicit(EnvSpec::new().set("PATH", "/usr/bin:/bin")),
            cwd: Some(Path::new("/")),
        };
        run_bounded_with(path, &args, STEP_TIMEOUT, STEP_MAX_OUTPUT, &options)
            .map(|output| StepOutput {
                stdout: output.stdout,
                stderr: output.stderr,
            })
            .map_err(|error| match error {
                ProcessError::Spawn => StepError::ToolMissing,
                ProcessError::Io => StepError::Io,
                ProcessError::Timeout => StepError::Timeout,
                ProcessError::OutputTooLarge => StepError::OutputTooLarge,
                ProcessError::Failed {
                    code,
                    stdout,
                    stderr,
                } => StepError::Failed {
                    code,
                    stdout,
                    stderr,
                },
            })
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    const UID: u32 = 501;

    fn label(text: &str) -> Label {
        Label::parse(text).expect("label")
    }

    fn argv(command: &MutatingCommand) -> Vec<&str> {
        command.args().iter().map(String::as_str).collect()
    }

    const PLIST: &str = "/Users/alice/Library/LaunchAgents/com.example.job.plist";

    #[test]
    fn each_typed_constructor_builds_the_exact_argv() {
        let job = label("com.example.job");
        let cases: Vec<(MutatingCommand, Vec<&str>)> = vec![
            (
                MutatingCommand::bootstrap(UID, Path::new(PLIST)).expect("bootstrap"),
                vec!["bootstrap", "gui/501", PLIST],
            ),
            (
                MutatingCommand::bootout(UID, &job),
                vec!["bootout", "gui/501/com.example.job"],
            ),
            (
                MutatingCommand::kickstart(UID, &job),
                vec!["kickstart", "gui/501/com.example.job"],
            ),
            (
                MutatingCommand::kickstart_kill(UID, &job),
                vec!["kickstart", "-k", "gui/501/com.example.job"],
            ),
            (
                MutatingCommand::kill_term(UID, &job),
                vec!["kill", "SIGTERM", "gui/501/com.example.job"],
            ),
            (
                MutatingCommand::enable(UID, &job),
                vec!["enable", "gui/501/com.example.job"],
            ),
            (
                MutatingCommand::disable(UID, &job),
                vec!["disable", "gui/501/com.example.job"],
            ),
        ];
        for (command, expected) in cases {
            assert_eq!(command.executable(), "/bin/launchctl");
            assert_eq!(argv(&command), expected);
        }
    }

    #[test]
    fn the_allow_list_accepts_exactly_the_typed_forms() {
        for args in [
            vec!["bootstrap", "gui/501", PLIST],
            vec!["bootout", "gui/501/com.example.job"],
            vec!["kickstart", "gui/501/com.example.job"],
            vec!["kickstart", "-k", "gui/501/com.example.job"],
            vec!["kill", "SIGTERM", "gui/501/com.example.job"],
            vec!["enable", "gui/501/com.example.job"],
            vec!["disable", "gui/501/com.example.job"],
        ] {
            let command = MutatingCommand::checked(UID, &args)
                .unwrap_or_else(|error| panic!("{args:?} rejected: {error:?}"));
            assert_eq!(argv(&command), args);
        }
    }

    #[test]
    fn every_other_subcommand_is_rejected() {
        for verb in [
            "load",
            "unload",
            "remove",
            "submit",
            "start",
            "stop",
            "kill9",
            "reboot",
            "config",
            "setenv",
            "unsetenv",
            "attach",
            "debug",
            "asuser",
            "managerpid",
            "list",
            "print",
            "print-disabled",
            "dumpstate",
            "",
        ] {
            assert_eq!(
                MutatingCommand::checked(UID, &[verb, "gui/501/com.example.job"]),
                Err(Rejected::Subcommand),
                "{verb:?}"
            );
        }
        assert_eq!(
            MutatingCommand::checked(UID, &[]),
            Err(Rejected::Subcommand)
        );
    }

    #[test]
    fn domains_other_than_the_current_gui_domain_are_rejected() {
        for target in [
            "system/com.example.job",
            "user/501/com.example.job",
            "gui/502/com.example.job",
            "gui/0501/com.example.job",
            "gui/501x/com.example.job",
            "gui/-501/com.example.job",
            "gui//com.example.job",
            "pid/1/com.example.job",
            "session/100005/com.example.job",
            "gui",
            "gui/501",
            "gui/501/",
            "com.example.job",
            "system",
        ] {
            for verb in ["bootout", "kickstart", "enable", "disable"] {
                assert!(
                    MutatingCommand::checked(UID, &[verb, target]).is_err(),
                    "{verb} {target}"
                );
            }
            assert!(
                MutatingCommand::checked(UID, &["kill", "SIGTERM", target]).is_err(),
                "kill {target}"
            );
        }
        for domain in [
            "system",
            "user/501",
            "gui/502",
            "gui/501/com.example.job",
            "",
        ] {
            assert!(
                MutatingCommand::checked(UID, &["bootstrap", domain, PLIST]).is_err(),
                "bootstrap {domain}"
            );
        }
    }

    #[test]
    fn labels_that_could_be_read_as_options_or_paths_are_rejected() {
        for bad in [
            "-k",
            "--help",
            "a b",
            "a\tb",
            "a\nb",
            "",
            "a/b",
            "../x",
            "gui/501/x",
        ] {
            assert_eq!(
                MutatingCommand::checked(UID, &["bootout", &format!("gui/501/{bad}")]),
                Err(Rejected::Label),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn extra_arguments_flags_and_other_signals_are_rejected() {
        let target = "gui/501/com.example.job";
        for args in [
            vec!["bootout", target, "extra"],
            vec!["bootout", "-v", target],
            vec!["kickstart", "-p", target],
            vec!["kickstart", "-k", "-p", target],
            vec!["kickstart", "-kp", target],
            vec!["kickstart", "-k", target, "x"],
            vec!["kickstart", "-k"],
            vec!["kill", target],
            vec!["kill", "SIGKILL", target],
            vec!["kill", "KILL", target],
            vec!["kill", "9", target],
            vec!["kill", "sigterm", target],
            vec!["kill", "SIGTERM", target, "x"],
            vec!["enable"],
            vec!["enable", target, "x"],
            vec!["disable", "-a", target],
            vec!["bootstrap", "gui/501"],
            vec!["bootstrap", "gui/501", PLIST, "extra"],
            vec!["bootstrap", PLIST],
        ] {
            assert!(
                MutatingCommand::checked(UID, &args).is_err(),
                "{args:?} was accepted"
            );
        }
    }

    #[test]
    fn bootstrap_paths_must_be_an_absolute_plist_under_a_launch_agents_directory() {
        for bad in [
            "relative/Library/LaunchAgents/a.plist",
            "Library/LaunchAgents/a.plist",
            "/Users/alice/Library/LaunchAgents/a.txt",
            "/Users/alice/Library/LaunchAgents/.plist",
            "/Users/alice/Library/LaunchAgents/",
            "/Users/alice/Library/LaunchAgents/../Evil/a.plist",
            "/Users/alice/Library/LaunchAgents/./a.plist",
            "/Users/alice/Library/LaunchDaemons/a.plist",
            "/Users/alice/Library/Other/a.plist",
            "/Users/alice/LaunchAgents/a.plist",
            "/tmp/a.plist",
            "/Users/alice/Library/LaunchAgents/sub/a.plist",
            "/Users/alice/Library/LaunchAgents/a\0b.plist",
            "-/Library/LaunchAgents/a.plist",
            "",
        ] {
            assert_eq!(
                MutatingCommand::bootstrap(UID, Path::new(bad)),
                Err(Rejected::Path),
                "{bad:?}"
            );
            assert!(
                MutatingCommand::checked(UID, &["bootstrap", "gui/501", bad]).is_err(),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn display_is_the_plain_command_line() {
        let command = MutatingCommand::kickstart_kill(UID, &label("com.example.job"));
        assert_eq!(
            command.display(),
            "launchctl kickstart -k gui/501/com.example.job"
        );
        assert_eq!(command.verb(), "kickstart");
    }
}
