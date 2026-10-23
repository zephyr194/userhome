//! Detection of the four supported AI command-line tools.
//!
//! Executables are looked up only in fixed directories: the two Homebrew-style
//! prefixes, `~/.local/bin`, and the bin directories of known Node version
//! managers and global npm prefixes. `PATH` is not searched, because a `PATH`
//! entry can be relative or user-writable. The version is read with the single
//! fixed argument `--version`, from a private empty directory, with a minimal
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
        registry::{Registry, display_path},
    },
    brew::{BrewPackageKind, validate_package_identifier},
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

impl ToolId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCode => "claude-code",
            Self::CodexCli => "codex-cli",
            Self::GeminiCli => "gemini-cli",
            Self::CopilotCli => "copilot-cli",
        }
    }
}

pub fn profile_for_tool_id(tool_id: &str) -> Option<&'static ToolProfile> {
    TOOL_PROFILES
        .iter()
        .find(|profile| profile.id.as_str() == tool_id)
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
        config: ConfigSource::Registry("gemini-user-settings"),
    },
    ToolProfile {
        id: ToolId::CopilotCli,
        display_name: "GitHub Copilot CLI",
        executable_names: &["copilot"],
        reference_urls: &[
            "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
        ],
        verification_note: "官方设置表与配置路径已收录；适用版本、flags 与环境变量待核实",
        config: ConfigSource::NotRegistered,
    },
];

const MAX_VERSION_DIRS_PER_MANAGER: usize = 50;
const MAX_ALIAS_BYTES: u64 = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixedLocation {
    pub bin_dir: PathBuf,
    pub root: PathBuf,
    /// Node toolchain bin directories whose scripts start with `#!/usr/bin/env node`.
    /// Probing prepends them to `PATH` so `env` resolves the same Node version.
    pub node_bin: bool,
}

impl FixedLocation {
    fn system(bin_dir: PathBuf, root: PathBuf) -> Self {
        Self {
            bin_dir,
            root,
            node_bin: false,
        }
    }

    fn node(bin_dir: PathBuf, root: PathBuf) -> Self {
        Self {
            bin_dir,
            root,
            node_bin: true,
        }
    }
}

pub fn fixed_locations(home: &Path) -> Vec<FixedLocation> {
    let mut locations = vec![
        FixedLocation::system(
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/opt/homebrew"),
        ),
        FixedLocation::system(PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/local")),
        FixedLocation::system(home.join(".local/bin"), home.join(".local")),
    ];
    locations.extend(node_locations(home));
    locations
}

fn node_locations(home: &Path) -> Vec<FixedLocation> {
    let mut locations = nvm_locations(home);
    for root in [
        home.join(".local/share/fnm/node-versions"),
        home.join("Library/Application Support/fnm/node-versions"),
    ] {
        locations.extend(versioned_locations(
            &root,
            &["installation", "bin"],
            true,
            None,
        ));
    }
    locations.push(FixedLocation::node(
        home.join(".volta/bin"),
        home.join(".volta"),
    ));
    locations.push(FixedLocation::node(
        home.join("Library/pnpm"),
        home.join("Library/pnpm"),
    ));
    locations.push(FixedLocation::node(
        home.join(".npm-global/bin"),
        home.join(".npm-global"),
    ));
    locations.extend(versioned_locations(
        &home.join(".local/share/mise/installs/node"),
        &["bin"],
        false,
        None,
    ));
    locations.extend(versioned_locations(
        &home.join(".asdf/installs/nodejs"),
        &["bin"],
        false,
        None,
    ));
    locations
}

fn nvm_locations(home: &Path) -> Vec<FixedLocation> {
    let root = home.join(".nvm/versions/node");
    let preferred =
        read_small_text(&home.join(".nvm/alias/default")).and_then(|text| alias_prefix(&text));
    versioned_locations(&root, &["bin"], true, preferred)
}

fn versioned_locations(
    root: &Path,
    suffix: &[&str],
    require_v: bool,
    preferred: Option<Vec<u64>>,
) -> Vec<FixedLocation> {
    let mut versions = installed_versions(root, require_v);
    let preferred_index =
        preferred.and_then(|prefix| versions.iter().position(|version| version.matches(&prefix)));
    if let Some(index) = preferred_index {
        let first = versions.remove(index);
        versions.insert(0, first);
    }
    versions.truncate(MAX_VERSION_DIRS_PER_MANAGER);
    versions
        .into_iter()
        .filter_map(|version| {
            let bin_dir = suffix
                .iter()
                .fold(root.join(&version.name), |dir, part| dir.join(part));
            contained_dir(&bin_dir, root)
                .map(|bin_dir| FixedLocation::node(bin_dir, root.to_path_buf()))
        })
        .collect()
}

#[derive(Debug)]
struct InstalledVersion {
    name: String,
    key: [u64; 3],
}

impl InstalledVersion {
    fn matches(&self, prefix: &[u64]) -> bool {
        self.key[..].starts_with(prefix)
    }
}

/// Newest first; ties break on name so the order never depends on `read_dir`.
fn installed_versions(root: &Path, require_v: bool) -> Vec<InstalledVersion> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions: Vec<InstalledVersion> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let key = parse_version_dir(&name, require_v)?;
            Some(InstalledVersion { name, key })
        })
        .collect();
    versions.sort_by(|a, b| b.key.cmp(&a.key).then_with(|| a.name.cmp(&b.name)));
    versions
}

fn parse_version_dir(name: &str, require_v: bool) -> Option<[u64; 3]> {
    let digits = match name.strip_prefix('v') {
        Some(rest) => rest,
        None if require_v => return None,
        None => name,
    };
    match parse_numeric_parts(digits)?[..] {
        [major, minor, patch] => Some([major, minor, patch]),
        _ => None,
    }
}

/// Accepts only a numeric prefix (`22`, `22.23`) or a full version (`v22.23.2`).
/// Aliases such as `lts/*` or `node` are not version prefixes and are ignored.
fn alias_prefix(text: &str) -> Option<Vec<u64>> {
    let trimmed = text.trim();
    let digits = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let parts = parse_numeric_parts(digits)?;
    (1..=3).contains(&parts.len()).then_some(parts)
}

fn parse_numeric_parts(text: &str) -> Option<Vec<u64>> {
    text.split('.')
        .map(|part| {
            (!part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
                .then(|| part.parse().ok())
                .flatten()
        })
        .collect()
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}

/// Checked before opening, because opening a FIFO or device would block.
fn read_small_text(path: &Path) -> Option<String> {
    if !is_regular_file(path) {
        return None;
    }
    let mut text = String::new();
    fs::File::open(path)
        .ok()?
        .take(MAX_ALIAS_BYTES)
        .read_to_string(&mut text)
        .ok()?;
    Some(text)
}

/// Each level of the path is checked through the canonical form, so a version
/// directory or bin directory that is a symlink out of `root` is not used.
fn contained_dir(dir: &Path, root: &Path) -> Option<PathBuf> {
    let real_dir = fs::canonicalize(dir).ok()?;
    let real_root = fs::canonicalize(root).ok()?;
    (real_dir.is_dir() && real_dir.starts_with(real_root)).then(|| dir.to_path_buf())
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

const HOMEBREW_STORES: &[(&str, BrewPackageKind)] = &[
    ("/opt/homebrew/Cellar/", BrewPackageKind::Formula),
    ("/usr/local/Cellar/", BrewPackageKind::Formula),
    ("/opt/homebrew/Caskroom/", BrewPackageKind::Cask),
    ("/usr/local/Caskroom/", BrewPackageKind::Cask),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum InstallSource {
    Homebrew {
        kind: BrewPackageKind,
        package: String,
    },
    Direct,
}

/// Classifies an already-resolved executable path. Only the Homebrew store
/// prefixes count; the package name is the directory right below them.
pub fn classify_install_source(real_path: &str) -> InstallSource {
    for (store, kind) in HOMEBREW_STORES {
        let Some(rest) = real_path.strip_prefix(store) else {
            continue;
        };
        let Some((package, below)) = rest.split_once('/') else {
            return InstallSource::Direct;
        };
        if below.is_empty() || !is_plain_package_name(package) {
            return InstallSource::Direct;
        }
        return InstallSource::Homebrew {
            kind: *kind,
            package: package.to_owned(),
        };
    }
    InstallSource::Direct
}

fn is_plain_package_name(name: &str) -> bool {
    name != "." && name != ".." && !name.contains('/') && validate_package_identifier(name)
}

pub fn install_source_of(executable: &Path) -> InstallSource {
    match fs::canonicalize(executable) {
        Ok(real) => real
            .to_str()
            .map_or(InstallSource::Direct, classify_install_source),
        Err(_) => InstallSource::Direct,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    pub id: ToolId,
    pub display_name: &'static str,
    pub install_status: InstallStatus,
    pub install_source: Option<InstallSource>,
    pub display_path: Option<String>,
    pub invalid_reason: Option<InvalidReason>,
    pub version: Option<String>,
    pub config_presence: ConfigPresence,
    pub config_display_path: Option<String>,
    pub references: Vec<&'static str>,
    pub verification_note: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigReport {
    pub tools: Vec<ToolReport>,
}

pub trait VersionProbe {
    fn version(&self, executable: &Path, launch_dir: Option<&Path>) -> Option<String>;
}

pub struct SystemVersionProbe;

impl VersionProbe for SystemVersionProbe {
    fn version(&self, executable: &Path, launch_dir: Option<&Path>) -> Option<String> {
        let work = PrivateWorkDir::create().ok()?;
        let mut command = version_command(executable, work.path(), &probe_path(launch_dir));
        let bytes = run_bounded(&mut command, VERSION_TIMEOUT, MAX_VERSION_OUTPUT_BYTES)?;
        sanitize_version(&bytes)
    }
}

/// Node-manager launches put their own bin directory first, so `#!/usr/bin/env node`
/// finds the Node version next to the executable. Any other directory keeps the
/// fixed probe `PATH`, and a directory containing `:` is never added because it would
/// split into several entries.
pub fn probe_path(launch_dir: Option<&Path>) -> String {
    match launch_dir.and_then(Path::to_str) {
        Some(dir) if dir.starts_with('/') && !dir.contains(':') => {
            format!("{dir}:{PROBE_PATH}")
        }
        _ => PROBE_PATH.to_owned(),
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
    let (install_status, install_source, display_path, invalid_reason, version) =
        match locate(profile, env) {
            Located::Found {
                display,
                executable,
                launch_dir,
            } => (
                InstallStatus::Found,
                Some(install_source_of(&executable)),
                Some(display),
                None,
                env.version.version(&executable, launch_dir.as_deref()),
            ),
            Located::Invalid { display, reason } => (
                InstallStatus::Invalid,
                None,
                Some(display),
                Some(reason),
                None,
            ),
            Located::Missing => (InstallStatus::Missing, None, None, None, None),
        };
    ToolReport {
        id: profile.id,
        display_name: profile.display_name,
        install_status,
        install_source,
        display_path,
        invalid_reason,
        version,
        config_presence: config_presence(profile.config, env),
        config_display_path: config_display_path(profile.config, env.registry),
        references: profile.reference_urls.to_vec(),
        verification_note: profile.verification_note,
    }
}

enum Located {
    Found {
        display: String,
        executable: PathBuf,
        launch_dir: Option<PathBuf>,
    },
    Invalid {
        display: String,
        reason: InvalidReason,
    },
    Missing,
}

fn locate(profile: &ToolProfile, env: &ProbeEnv<'_>) -> Located {
    let mut rejected: Option<Located> = None;
    for location in env.locations {
        for name in profile.executable_names {
            let candidate = Candidate {
                source: ExecutableSource::Fixed,
                path: location.bin_dir.join(name),
                root: Some(location.root.clone()),
            };
            let (outcome, usable) = inspect(&candidate);
            if let Some(executable) = usable {
                return Located::Found {
                    display: shown_path(&candidate.path, env.home),
                    executable,
                    launch_dir: location.node_bin.then(|| location.bin_dir.clone()),
                };
            }
            rejected = rejected.or_else(|| {
                invalid_reason(outcome).map(|reason| Located::Invalid {
                    display: shown_path(&candidate.path, env.home),
                    reason,
                })
            });
        }
    }
    rejected.unwrap_or(Located::Missing)
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

fn config_display_path(source: ConfigSource, registry: &Registry) -> Option<String> {
    match source {
        ConfigSource::NotRegistered => None,
        ConfigSource::Registry(id) => registry.get(id).ok().map(display_path),
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

pub fn version_command(executable: &Path, work_dir: &Path, path: &str) -> Command {
    let mut command = Command::new(executable);
    command
        .arg(VERSION_ARGUMENT)
        .env_clear()
        .env("PATH", path)
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
