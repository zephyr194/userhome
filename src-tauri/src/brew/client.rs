use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

use crate::process::{ProcessError, ProcessOutput, run_bounded};

use super::{BrewPackageKind, actions::BrewAction, validate_package_identifier};

const BREW_PREFIXES: &[&str] = &["/opt/homebrew", "/usr/local"];
const BREW_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const BREW_MUTATION_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_BREW_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrewClientError {
    NotFound,
    InvalidInstallation,
    Timeout,
    OutputTooLarge,
    ProcessFailed {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrewCommand {
    Search(String),
    Details {
        kind: BrewPackageKind,
        identifier: String,
    },
    Action {
        action: BrewAction,
        kind: BrewPackageKind,
        identifier: String,
    },
    ServicesList,
    ServiceAction(BrewAction),
}

impl BrewCommand {
    pub fn args(&self) -> Vec<String> {
        match self {
            Self::Search(query) => vec!["search".to_owned(), query.clone()],
            Self::Details { identifier, .. } => vec![
                "info".to_owned(),
                "--json=v2".to_owned(),
                identifier.clone(),
            ],
            Self::Action {
                action,
                kind,
                identifier,
            } => {
                let mut args = vec![action.as_brew_subcommand().to_owned()];
                if *kind == BrewPackageKind::Cask {
                    args.push("--cask".to_owned());
                }
                args.push(identifier.clone());
                args
            }
            Self::ServicesList => vec![
                "services".to_owned(),
                "list".to_owned(),
                "--json".to_owned(),
            ],
            Self::ServiceAction(action) => vec![
                "services".to_owned(),
                action.as_brew_subcommand().to_owned(),
                "caddy".to_owned(),
            ],
        }
    }

    fn timeout(&self) -> Duration {
        match self {
            Self::Action { .. } | Self::ServiceAction(_) => BREW_MUTATION_TIMEOUT,
            _ => BREW_COMMAND_TIMEOUT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrewClient {
    executable: PathBuf,
    prefix: PathBuf,
}

impl BrewClient {
    pub fn resolve() -> Result<Self, BrewClientError> {
        for prefix in BREW_PREFIXES {
            let prefix = PathBuf::from(prefix);
            let executable = prefix.join("bin/brew");
            if fs::symlink_metadata(&executable).is_err() {
                continue;
            }
            let canonical =
                fs::canonicalize(&executable).map_err(|_| BrewClientError::InvalidInstallation)?;
            if !canonical.starts_with(&prefix) {
                return Err(BrewClientError::InvalidInstallation);
            }

            let output = run_brew(&executable, &["--prefix"])?;
            if output.stdout.trim() != prefix.to_string_lossy() {
                return Err(BrewClientError::InvalidInstallation);
            }

            return Ok(Self { executable, prefix });
        }

        Err(BrewClientError::NotFound)
    }

    pub fn prefix(&self) -> &Path {
        &self.prefix
    }

    pub fn version(&self) -> Result<String, BrewClientError> {
        let output = run_brew(&self.executable, &["--version"])?;
        output
            .stdout
            .lines()
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= 256)
            .map(ToOwned::to_owned)
            .ok_or(BrewClientError::ProcessFailed {
                code: None,
                stdout: String::new(),
                stderr: String::new(),
            })
    }

    pub fn installed_json(&self) -> Result<String, BrewClientError> {
        run_brew(&self.executable, &["info", "--json=v2", "--installed"])
            .map(|output| output.stdout)
    }

    pub fn run(&self, command: &BrewCommand) -> Result<ProcessOutput, BrewClientError> {
        match command {
            BrewCommand::Search(query) if !valid_search_query(query) => {
                return Err(BrewClientError::InvalidInstallation);
            }
            BrewCommand::Details { identifier, .. } | BrewCommand::Action { identifier, .. }
                if !validate_package_identifier(identifier) =>
            {
                return Err(BrewClientError::InvalidInstallation);
            }
            _ => {}
        }
        let args = command.args();
        let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
        run_brew_with_timeout(&self.executable, &refs, command.timeout())
    }
}

fn run_brew(executable: &Path, args: &[&str]) -> Result<ProcessOutput, BrewClientError> {
    run_brew_with_timeout(executable, args, BREW_COMMAND_TIMEOUT)
}

fn run_brew_with_timeout(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<ProcessOutput, BrewClientError> {
    run_bounded(executable, args, timeout, MAX_BREW_OUTPUT_BYTES).map_err(|error| match error {
        ProcessError::Timeout => BrewClientError::Timeout,
        ProcessError::OutputTooLarge => BrewClientError::OutputTooLarge,
        ProcessError::Spawn | ProcessError::Io => BrewClientError::ProcessFailed {
            code: None,
            stdout: String::new(),
            stderr: String::new(),
        },
        ProcessError::Failed {
            code,
            stdout,
            stderr,
        } => BrewClientError::ProcessFailed {
            code,
            stdout,
            stderr,
        },
    })
}

pub fn valid_search_query(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('-')
        && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_prefixes_are_fixed_and_do_not_consult_path() {
        assert_eq!(BREW_PREFIXES, ["/opt/homebrew", "/usr/local"]);
    }

    #[test]
    fn command_shapes_are_fixed_backend_arrays() {
        assert_eq!(
            BrewCommand::Action {
                action: BrewAction::Install,
                kind: BrewPackageKind::Cask,
                identifier: "visual-studio-code".to_owned(),
            }
            .args(),
            ["install", "--cask", "visual-studio-code"]
        );
        assert_eq!(
            BrewCommand::ServiceAction(BrewAction::Restart).args(),
            ["services", "restart", "caddy"]
        );
    }

    #[test]
    fn search_rejects_flag_shaped_and_control_input() {
        assert!(valid_search_query("reverse proxy"));
        assert!(!valid_search_query("--formula"));
        assert!(!valid_search_query("git\ninstall caddy"));
    }
}
