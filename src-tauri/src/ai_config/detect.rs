//! Detection of the four supported AI command-line tools.
//!
//! Executables are looked up only in fixed directories: the two Homebrew-style
//! prefixes and `~/.local/bin`. `PATH` is not searched, because a `PATH` entry
//! can be relative or user-writable. The version is read with the single fixed
//! argument `--version`, from a private empty directory, with a minimal
//! environment and no credentials. Configuration presence comes only from the
//! app-config registry, and an existing configuration file never counts as an
//! installed tool.

use std::{
    env,
    fs::{self, DirBuilder},
    io::{self, Read},
    os::unix::fs::DirBuilderExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use uuid::Uuid;

use crate::{
    app_config::{
        discover::{ConfigFs, ProbeStatus, probe},
        registry::Registry,
    },
    caddy::detect::{Candidate, CandidateOutcome, ExecutableSource, inspect},
};

pub const VERSION_ARGUMENT: &str = "--version";
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(3);
pub const MAX_VERSION_OUTPUT_BYTES: usize = 4096;
const MAX_VERSION_CHARS: usize = 120;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const PROBE_PATH: &str = "/usr/bin:/bin";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolId {
    ClaudeCode,
    CodexCli,
    GeminiCli,
    CopilotCli,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigSource {
    Registry(&'static str),
    NotRegistered,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolProfile {
    pub id: ToolId,
    pub display_name: &'static str,
    pub executable_names: &'static [&'static str],
    pub reference_urls: &'static [&'static str],
    pub verification_note: &'static str,
    pub config: ConfigSource,
}

pub const TOOL_PROFILES: &[ToolProfile] = &[
    ToolProfile {
        id: ToolId::ClaudeCode,
        display_name: "Claude Code",
        executable_names: &["claude"],
        reference_urls: &[
            "https://code.claude.com/docs/en/settings",
            "https://code.claude.com/docs/en/cli-reference",
        ],
        verification_note: "环境变量与逐键合并规则仍待独立核验",
        config: ConfigSource::Registry("claude-code-settings"),
    },
    ToolProfile {
        id: ToolId::CodexCli,
        display_name: "Codex CLI",
        executable_names: &["codex"],
        reference_urls: &["https://developers.openai.com/codex/config-basic"],
        verification_note: "官方页面曾被重定向，当前配置落点与版本待核实",
        config: ConfigSource::NotRegistered,
    },
    ToolProfile {
        id: ToolId::GeminiCli,
        display_name: "Gemini CLI",
        executable_names: &["gemini"],
        reference_urls: &["https://geminicli.com/docs/reference/configuration"],
        verification_note: "页面含产品迁移提示，适用用户与本机版本未核实",
        config: ConfigSource::NotRegistered,
    },
    ToolProfile {
        id: ToolId::CopilotCli,
        display_name: "GitHub Copilot CLI",
        executable_names: &["copilot"],
        reference_urls: &[
            "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
        ],
        verification_note: "独立配置页面未找到，完整字段与格式待核验",
        config: ConfigSource::NotRegistered,
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixedLocation {
    pub bin_dir: PathBuf,
    pub root: PathBuf,
}

pub fn fixed_locations(home: &Path) -> Vec<FixedLocation> {
    vec![
        FixedLocation {
            bin_dir: PathBuf::from("/opt/homebrew/bin"),
            root: PathBuf::from("/opt/homebrew"),
        },
        FixedLocation {
            bin_dir: PathBuf::from("/usr/local/bin"),
            root: PathBuf::from("/usr/local"),
        },
        FixedLocation {
            bin_dir: home.join(".local/bin"),
            root: home.join(".local"),
        },
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallStatus {
    Found,
    Missing,
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InvalidReason {
    Unreadable,
    OutsideRoot,
    NotRegularFile,
    NotExecutable,
    GroupOrWorldWritable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfigPresence {
    Found,
    NotFound,
    Unavailable,
    NotRegistered,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    pub id: ToolId,
    pub display_name: &'static str,
    pub install_status: InstallStatus,
    pub display_path: Option<String>,
    pub invalid_reason: Option<InvalidReason>,
    pub version: Option<String>,
    pub config_presence: ConfigPresence,
    pub references: Vec<&'static str>,
    pub verification_note: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigReport {
    pub tools: Vec<ToolReport>,
}

pub trait VersionProbe {
    fn version(&self, executable: &Path) -> Option<String>;
}

pub struct SystemVersionProbe;

impl VersionProbe for SystemVersionProbe {
    fn version(&self, executable: &Path) -> Option<String> {
        let work = PrivateWorkDir::create().ok()?;
        let mut command = version_command(executable, work.path());
        let bytes = run_bounded(&mut command, VERSION_TIMEOUT, MAX_VERSION_OUTPUT_BYTES)?;
        sanitize_version(&bytes)
    }
}

pub struct ProbeEnv<'a> {
    pub home: &'a Path,
    pub locations: &'a [FixedLocation],
    pub version: &'a dyn VersionProbe,
    pub fs: &'a dyn ConfigFs,
    pub registry: &'a Registry,
}

pub fn detect_all(env: &ProbeEnv<'_>) -> AiConfigReport {
    AiConfigReport {
        tools: TOOL_PROFILES
            .iter()
            .map(|profile| detect_tool(profile, env))
            .collect(),
    }
}

pub fn detect_claude_version(env: &ProbeEnv<'_>) -> Option<String> {
    let profile = TOOL_PROFILES
        .iter()
        .find(|profile| profile.id == ToolId::ClaudeCode)?;
    detect_tool(profile, env).version
}

pub fn detect_tool(profile: &ToolProfile, env: &ProbeEnv<'_>) -> ToolReport {
    let (install_status, display_path, invalid_reason, version) = match locate(profile, env) {
        Located::Found {
            display,
            executable,
        } => (
            InstallStatus::Found,
            Some(display),
            None,
            env.version.version(&executable),
        ),
        Located::Invalid { display, reason } => {
            (InstallStatus::Invalid, Some(display), Some(reason), None)
        }
        Located::Missing => (InstallStatus::Missing, None, None, None),
    };
    ToolReport {
        id: profile.id,
        display_name: profile.display_name,
        install_status,
        display_path,
        invalid_reason,
        version,
        config_presence: config_presence(profile.config, env),
        references: profile.reference_urls.to_vec(),
        verification_note: profile.verification_note,
    }
}

enum Located {
    Found {
        display: String,
        executable: PathBuf,
    },
    Invalid {
        display: String,
        reason: InvalidReason,
    },
    Missing,
}

fn locate(profile: &ToolProfile, env: &ProbeEnv<'_>) -> Located {
    let mut rejected: Option<Located> = None;
    for candidate in candidates(profile, env.locations) {
        let (outcome, usable) = inspect(&candidate);
        if let Some(executable) = usable {
            return Located::Found {
                display: shown_path(&candidate.path, env.home),
                executable,
            };
        }
        rejected = rejected.or_else(|| {
            invalid_reason(outcome).map(|reason| Located::Invalid {
                display: shown_path(&candidate.path, env.home),
                reason,
            })
        });
    }
    rejected.unwrap_or(Located::Missing)
}

fn candidates(profile: &ToolProfile, locations: &[FixedLocation]) -> Vec<Candidate> {
    locations
        .iter()
        .flat_map(|location| {
            profile.executable_names.iter().map(move |name| Candidate {
                source: ExecutableSource::Fixed,
                path: location.bin_dir.join(name),
                root: Some(location.root.clone()),
            })
        })
        .collect()
}

fn invalid_reason(outcome: CandidateOutcome) -> Option<InvalidReason> {
    match outcome {
        CandidateOutcome::Missing | CandidateOutcome::Usable => None,
        CandidateOutcome::Unreadable => Some(InvalidReason::Unreadable),
        CandidateOutcome::OutsideRoot => Some(InvalidReason::OutsideRoot),
        CandidateOutcome::NotRegularFile => Some(InvalidReason::NotRegularFile),
        CandidateOutcome::NotExecutable => Some(InvalidReason::NotExecutable),
        CandidateOutcome::GroupOrWorldWritable => Some(InvalidReason::GroupOrWorldWritable),
    }
}

fn shown_path(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(relative) => format!("~/{}", relative.display()),
        Err(_) => path.display().to_string(),
    }
}

fn config_presence(source: ConfigSource, env: &ProbeEnv<'_>) -> ConfigPresence {
    match source {
        ConfigSource::NotRegistered => ConfigPresence::NotRegistered,
        ConfigSource::Registry(id) => match env.registry.get(id) {
            Err(_) => ConfigPresence::Unavailable,
            Ok(entry) => match probe(entry, env.home, env.fs) {
                ProbeStatus::Found(_) => ConfigPresence::Found,
                ProbeStatus::NotFound => ConfigPresence::NotFound,
                ProbeStatus::SymlinkOrNonRegular
                | ProbeStatus::Inaccessible
                | ProbeStatus::OutOfBounds => ConfigPresence::Unavailable,
            },
        },
    }
}

pub fn version_command(executable: &Path, work_dir: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .arg(VERSION_ARGUMENT)
        .env_clear()
        .env("PATH", PROBE_PATH)
        .env("HOME", work_dir)
        .env("TMPDIR", work_dir)
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    command
}

/// Returns at most `max_bytes + 1` bytes of stdout so the caller can tell an
/// oversized output apart. Any spawn failure, non-zero exit or timeout is `None`.
fn run_bounded(command: &mut Command, timeout: Duration, max_bytes: usize) -> Option<Vec<u8>> {
    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let read = stdout.take(max_bytes as u64 + 1).read_to_end(&mut bytes);
        let _ = sender.send(read.map(|_| bytes));
    });
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let bytes = receiver.recv_timeout(timeout).ok()?.ok()?;
                return status.success().then_some(bytes);
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn sanitize_version(bytes: &[u8]) -> Option<String> {
    if bytes.len() > MAX_VERSION_OUTPUT_BYTES {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let first_line = text.lines().next()?;
    let cleaned: String = first_line
        .chars()
        .filter(|character| !is_display_hazard(*character))
        .collect();
    let trimmed = cleaned.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(MAX_VERSION_CHARS).collect())
}

fn is_display_hazard(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}'
        )
}

/// A fresh, owner-only directory used as the version probe's cwd and home. It
/// is removed when dropped, so the probe leaves no state behind.
struct PrivateWorkDir(PathBuf);

impl PrivateWorkDir {
    fn create() -> io::Result<Self> {
        let path = env::temp_dir().join(format!("userhome-ai-probe-{}", Uuid::new_v4()));
        DirBuilder::new().mode(0o700).create(&path)?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for PrivateWorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
#[path = "detect_tests.rs"]
mod tests;
