//! Read-only launchd commands.
//!
//! The only way to run a command here is a [`ReadOnlyCommand`], and the only
//! ways to build one are the typed constructors and `launchctl_checked`, which
//! accept an allow list of read-only forms (`list`, `print`, `print-disabled`)
//! with a restricted domain (`gui/<uid>`, `user/<uid>`, `system`) and a
//! validated label. Every other subcommand (`load`, `unload`, `bootstrap`,
//! `bootout`, `kickstart`, `kill`, `enable`, `disable`, `remove`, `submit`, ...)
//! is unrepresentable. Commands run through the bounded one-shot runner with an
//! absolute executable, an argument array (no shell), an explicit environment,
//! a timeout and an output limit.

use std::{fs, path::Path, time::Duration};

use crate::{
    process::{EnvPolicy, ProcessError, RunOptions, run_bounded_with},
    process_session::EnvSpec,
};

pub const LAUNCHCTL: &str = "/bin/launchctl";
pub const PLUTIL: &str = "/usr/bin/plutil";

const MAX_LABEL_BYTES: usize = 255;
const LAUNCHCTL_TIMEOUT: Duration = Duration::from_secs(10);
const LAUNCHCTL_MAX_OUTPUT: usize = 2 * 1024 * 1024;
const PLUTIL_TIMEOUT: Duration = Duration::from_secs(5);
const PLUTIL_MAX_OUTPUT: usize = 4 * 1024 * 1024;

/// Why a command was refused before it could be built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    Subcommand,
    Domain,
    Label,
    Path,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Domain {
    Gui(u32),
    User(u32),
    System,
}

impl Domain {
    pub fn target(self) -> String {
        match self {
            Self::Gui(uid) => format!("gui/{uid}"),
            Self::User(uid) => format!("user/{uid}"),
            Self::System => "system".to_owned(),
        }
    }

    fn parse(text: &str) -> Result<Self, Rejected> {
        let uid = |digits: &str| {
            if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(Rejected::Domain);
            }
            digits.parse::<u32>().map_err(|_| Rejected::Domain)
        };
        if text == "system" {
            return Ok(Self::System);
        }
        match text.split_once('/') {
            Some(("gui", digits)) => uid(digits).map(Self::Gui),
            Some(("user", digits)) => uid(digits).map(Self::User),
            _ => Err(Rejected::Domain),
        }
    }
}

/// A job label that is safe to pass as one argument: not empty, bounded, no
/// whitespace or control characters, no `/`, and not an option (`-...`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Label(String);

impl Label {
    pub fn parse(text: &str) -> Result<Self, Rejected> {
        let valid = !text.is_empty()
            && text.len() <= MAX_LABEL_BYTES
            && !text.starts_with('-')
            && !text.chars().any(|character| {
                character.is_whitespace() || character.is_control() || character == '/'
            });
        if valid {
            Ok(Self(text.to_owned()))
        } else {
            Err(Rejected::Label)
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Splits `domain` or `domain/label` into its parts.
fn parse_target(text: &str) -> Result<(Domain, Option<Label>), Rejected> {
    let (domain_text, label_text) = if text == "system" {
        (text, None)
    } else if let Some(rest) = text.strip_prefix("system/") {
        ("system", Some(rest))
    } else {
        let mut parts = text.splitn(3, '/');
        let kind = parts.next().unwrap_or_default();
        let uid = parts.next().unwrap_or_default();
        let domain_len = kind.len() + 1 + uid.len();
        (&text[..domain_len.min(text.len())], parts.next())
    };
    let domain = Domain::parse(domain_text)?;
    let label = label_text.map(Label::parse).transpose()?;
    Ok((domain, label))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadOnlyCommand {
    executable: &'static str,
    args: Vec<String>,
}

impl ReadOnlyCommand {
    pub fn executable(&self) -> &'static str {
        self.executable
    }

    pub fn args(&self) -> &[String] {
        &self.args
    }

    fn launchctl(args: &[&str]) -> Self {
        Self {
            executable: LAUNCHCTL,
            args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        }
    }

    /// Jobs loaded in the caller's launchd context (PID, last exit, label).
    pub fn launchctl_list() -> Self {
        Self::launchctl(&["list"])
    }

    pub fn launchctl_print_domain(domain: Domain) -> Self {
        Self::launchctl(&["print", &domain.target()])
    }

    pub fn launchctl_print_service(domain: Domain, label: &Label) -> Self {
        Self::launchctl(&["print", &format!("{}/{}", domain.target(), label.as_str())])
    }

    pub fn launchctl_print_disabled(domain: Domain) -> Self {
        Self::launchctl(&["print-disabled", &domain.target()])
    }

    /// Builds a launchctl command from raw arguments, accepting only the
    /// read-only allow list. Anything else, including every state-changing
    /// subcommand, is rejected.
    pub fn launchctl_checked(args: &[&str]) -> Result<Self, Rejected> {
        match args {
            ["list"] => Ok(Self::launchctl_list()),
            ["list", label] => {
                let label = Label::parse(label)?;
                Ok(Self::launchctl(&["list", label.as_str()]))
            }
            ["print", target] => {
                let (domain, label) = parse_target(target)?;
                Ok(match label {
                    Some(label) => Self::launchctl_print_service(domain, &label),
                    None => Self::launchctl_print_domain(domain),
                })
            }
            ["print-disabled", domain] => {
                Ok(Self::launchctl_print_disabled(Domain::parse(domain)?))
            }
            _ => Err(Rejected::Subcommand),
        }
    }

    /// `plutil -convert json -o - -- <path>`: converts one property list to JSON
    /// on stdout. The path comes after `--`, so it can never be read as an
    /// option; it must be absolute and free of NUL.
    pub fn plutil_convert(path: &Path) -> Result<Self, Rejected> {
        let text = path.to_str().ok_or(Rejected::Path)?;
        if !path.is_absolute() || text.contains('\0') {
            return Err(Rejected::Path);
        }
        Ok(Self {
            executable: PLUTIL,
            args: ["-convert", "json", "-o", "-", "--", text]
                .iter()
                .map(|arg| (*arg).to_owned())
                .collect(),
        })
    }

    /// Timeout and output limit of the tool this command runs.
    pub fn limits(&self) -> (Duration, usize) {
        if self.executable == PLUTIL {
            (PLUTIL_TIMEOUT, PLUTIL_MAX_OUTPUT)
        } else {
            (LAUNCHCTL_TIMEOUT, LAUNCHCTL_MAX_OUTPUT)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunError {
    ToolMissing,
    Timeout,
    OutputTooLarge,
    PermissionDenied,
    Failed,
    Io,
}

/// Runs read-only commands. Tests inject a fake; production uses
/// [`SystemRunner`].
pub trait CommandRunner: Sync {
    /// Whether the tool at the absolute `executable` path exists.
    fn tool_available(&self, executable: &str) -> bool;

    /// Standard output of a command that exited successfully.
    fn run(&self, command: &ReadOnlyCommand) -> Result<String, RunError>;
}

pub struct SystemRunner;

impl CommandRunner for SystemRunner {
    fn tool_available(&self, executable: &str) -> bool {
        let path = Path::new(executable);
        path.is_absolute() && fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
    }

    fn run(&self, command: &ReadOnlyCommand) -> Result<String, RunError> {
        if !self.tool_available(command.executable()) {
            return Err(RunError::ToolMissing);
        }
        let (timeout, max_output) = command.limits();
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        let options = RunOptions {
            env: EnvPolicy::Explicit(EnvSpec::new().set("PATH", "/usr/bin:/bin")),
            cwd: Some(Path::new("/")),
        };
        run_bounded_with(
            Path::new(command.executable()),
            &args,
            timeout,
            max_output,
            &options,
        )
        .map(|output| output.stdout)
        .map_err(|error| match error {
            ProcessError::Spawn => RunError::ToolMissing,
            ProcessError::Io => RunError::Io,
            ProcessError::Timeout => RunError::Timeout,
            ProcessError::OutputTooLarge => RunError::OutputTooLarge,
            ProcessError::Failed { stderr, .. } => classify_failure(&stderr),
        })
    }
}

/// Separates "the system said no" from any other nonzero exit.
pub fn classify_failure(stderr: &str) -> RunError {
    let lower = stderr.to_ascii_lowercase();
    if ["not permitted", "permission denied", "not privileged"]
        .iter()
        .any(|phrase| lower.contains(phrase))
    {
        RunError::PermissionDenied
    } else {
        RunError::Failed
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn argv(command: &ReadOnlyCommand) -> Vec<&str> {
        command.args().iter().map(String::as_str).collect()
    }

    #[test]
    fn the_allow_list_accepts_only_the_read_only_forms() {
        let list = ReadOnlyCommand::launchctl_checked(&["list"]).expect("list");
        assert_eq!(list.executable(), "/bin/launchctl");
        assert_eq!(argv(&list), ["list"]);

        for (args, expected) in [
            (
                vec!["list", "com.example.job"],
                vec!["list", "com.example.job"],
            ),
            (vec!["print", "system"], vec!["print", "system"]),
            (vec!["print", "gui/501"], vec!["print", "gui/501"]),
            (vec!["print", "user/501"], vec!["print", "user/501"]),
            (
                vec!["print", "gui/501/com.example.job"],
                vec!["print", "gui/501/com.example.job"],
            ),
            (
                vec!["print", "system/com.example.daemon"],
                vec!["print", "system/com.example.daemon"],
            ),
            (
                vec!["print-disabled", "gui/501"],
                vec!["print-disabled", "gui/501"],
            ),
            (
                vec!["print-disabled", "system"],
                vec!["print-disabled", "system"],
            ),
        ] {
            let command = ReadOnlyCommand::launchctl_checked(&args)
                .unwrap_or_else(|error| panic!("{args:?} rejected: {error:?}"));
            assert_eq!(argv(&command), expected);
        }
    }

    #[test]
    fn every_state_changing_subcommand_is_rejected() {
        let mutating = [
            "load",
            "unload",
            "bootstrap",
            "bootout",
            "kickstart",
            "kill",
            "enable",
            "disable",
            "remove",
            "submit",
            "start",
            "stop",
            "restart",
            "attach",
            "debug",
            "config",
            "reboot",
            "setenv",
            "unsetenv",
            "limit",
            "asuser",
            "managerpid",
            "manageruid",
            "examine",
            "procinfo",
            "hostinfo",
            "resolveport",
            "blame",
            "print-cache",
            "plist",
            "error",
            "version",
            "variant",
            "getenv",
            "bslist",
            "bsexec",
            "shutdown",
            "umask",
            "help",
            "",
            "LIST",
            "list ",
            "-x",
        ];
        for name in mutating {
            for target in [
                None,
                Some("gui/501"),
                Some("system"),
                Some("gui/501/com.example.job"),
            ] {
                let args: Vec<&str> = std::iter::once(name).chain(target).collect();
                assert_eq!(
                    ReadOnlyCommand::launchctl_checked(&args),
                    Err(Rejected::Subcommand),
                    "{args:?}"
                );
            }
        }
        assert_eq!(
            ReadOnlyCommand::launchctl_checked(&[]),
            Err(Rejected::Subcommand)
        );
    }

    #[test]
    fn read_only_subcommands_reject_extra_flags_and_odd_arity() {
        for args in [
            vec!["list", "-x"],
            vec!["list", "a", "b"],
            vec!["print"],
            vec!["print", "system", "extra"],
            vec!["print-disabled"],
            vec!["print-disabled", "gui/501", "extra"],
            vec!["print", "-l", "system"],
        ] {
            assert!(
                ReadOnlyCommand::launchctl_checked(&args).is_err(),
                "{args:?}"
            );
        }
    }

    #[test]
    fn domains_are_limited_to_gui_user_and_system() {
        for domain in [
            "login/100",
            "pid/1",
            "gui",
            "gui/",
            "gui/abc",
            "gui/-1",
            "gui/+5",
            "gui/501/",
            "user/99999999999",
            "systems",
            "System",
            "../system",
            " system",
            "",
        ] {
            assert!(
                ReadOnlyCommand::launchctl_checked(&["print", domain]).is_err(),
                "{domain:?}"
            );
            assert!(
                ReadOnlyCommand::launchctl_checked(&["print-disabled", domain]).is_err(),
                "{domain:?}"
            );
        }
        // Only a domain, never a service target, for `print-disabled`.
        assert_eq!(
            ReadOnlyCommand::launchctl_checked(&["print-disabled", "gui/501/com.example"]),
            Err(Rejected::Domain)
        );
        assert_eq!(Domain::Gui(501).target(), "gui/501");
        assert_eq!(Domain::User(7).target(), "user/7");
        assert_eq!(Domain::System.target(), "system");
    }

    #[test]
    fn labels_are_validated_before_they_reach_an_argument() {
        for label in [
            "com.example.job",
            "application.com.example.App.1234.5678",
            "0x7f.anonymous.launchd",
            "标签.job",
        ] {
            assert!(Label::parse(label).is_ok(), "{label:?}");
        }
        for label in [
            "",
            "-flag",
            "--print",
            "has space",
            "tab\there",
            "new\nline",
            "nul\0byte",
            "bell\u{7}",
            "a/b",
            "/absolute",
            "../up",
            " leading",
            "trailing ",
            "\u{a0}nbsp",
        ] {
            assert_eq!(Label::parse(label), Err(Rejected::Label), "{label:?}");
        }
        assert_eq!(Label::parse(&"a".repeat(256)), Err(Rejected::Label));
        assert!(Label::parse(&"a".repeat(255)).is_ok());

        for args in [
            vec!["list", "has space"],
            vec!["list", "-x"],
            vec!["print", "gui/501/a b"],
            vec!["print", "gui/501/-flag"],
            vec!["print", "system/"],
            vec!["print", "gui/501/a/b"],
        ] {
            assert!(
                ReadOnlyCommand::launchctl_checked(&args).is_err(),
                "{args:?}"
            );
        }
    }

    #[test]
    fn typed_constructors_build_the_same_fixed_arguments() {
        let label = Label::parse("com.example.job").expect("label");
        assert_eq!(argv(&ReadOnlyCommand::launchctl_list()), ["list"]);
        assert_eq!(
            argv(&ReadOnlyCommand::launchctl_print_domain(Domain::System)),
            ["print", "system"]
        );
        assert_eq!(
            argv(&ReadOnlyCommand::launchctl_print_service(
                Domain::Gui(501),
                &label
            )),
            ["print", "gui/501/com.example.job"]
        );
        assert_eq!(
            argv(&ReadOnlyCommand::launchctl_print_disabled(Domain::Gui(501))),
            ["print-disabled", "gui/501"]
        );
    }

    #[test]
    fn plutil_conversion_uses_fixed_arguments_and_an_absolute_path() {
        let command =
            ReadOnlyCommand::plutil_convert(Path::new("/Library/LaunchDaemons/-odd.plist"))
                .expect("absolute path");
        assert_eq!(command.executable(), "/usr/bin/plutil");
        assert_eq!(
            argv(&command),
            [
                "-convert",
                "json",
                "-o",
                "-",
                "--",
                "/Library/LaunchDaemons/-odd.plist"
            ]
        );
        for path in ["relative.plist", "", "/tmp/nul\0.plist"] {
            assert_eq!(
                ReadOnlyCommand::plutil_convert(Path::new(path)),
                Err(Rejected::Path),
                "{path:?}"
            );
        }
    }

    #[test]
    fn limits_are_bounded_per_tool() {
        let (list_timeout, list_bytes) = ReadOnlyCommand::launchctl_list().limits();
        let convert = ReadOnlyCommand::plutil_convert(Path::new("/tmp/x.plist")).expect("path");
        let (convert_timeout, convert_bytes) = convert.limits();
        assert!(list_timeout.as_secs() <= 15 && list_bytes <= 4 * 1024 * 1024);
        assert!(convert_timeout.as_secs() <= 10 && convert_bytes <= 8 * 1024 * 1024);
    }

    #[test]
    fn permission_failures_are_told_apart_from_other_failures() {
        for stderr in [
            "Operation not permitted while System Integrity Protection is engaged",
            "Could not find service \"x\" in domain: Permission denied",
            "Not privileged to signal service.",
        ] {
            assert_eq!(
                classify_failure(stderr),
                RunError::PermissionDenied,
                "{stderr}"
            );
        }
        assert_eq!(classify_failure("Bad request."), RunError::Failed);
        assert_eq!(classify_failure(""), RunError::Failed);
    }
}
