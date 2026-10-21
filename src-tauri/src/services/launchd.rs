//! launchd discovery: loaded jobs, plist files and the evidence that ties them
//! together, merged into one model.
//!
//! Sources (all read-only, none chosen by the caller):
//! - `launchctl list` for the jobs loaded in the current user's context
//!   (domain `gui/<uid>`), and `launchctl print system` for the system domain;
//! - the five fixed plist directories (`~/Library/LaunchAgents`,
//!   `/Library/LaunchAgents`, `/Library/LaunchDaemons`,
//!   `/System/Library/LaunchAgents`, `/System/Library/LaunchDaemons`). They are
//!   built-in read-only sources, not user-authorized ones: only the directory is
//!   listed (no recursion), only `*.plist` entries are looked at, and a
//!   symbolic link is recorded but never followed or read. Property lists are
//!   converted by `plutil -convert json` and nothing a plist names is run.
//!
//! The merge is by (domain, label). It never guesses: a plist without a usable
//! `Label` stays an unmatched file, a label found twice keeps every file, and
//! "no file" is only claimed when every scanned location of that domain was
//! listed completely. A failed source yields a partial result with one reason
//! per source; the result is `complete` only when nothing failed or was cut.
//! This module reports evidence (domain, directory, file owner, Apple path); it
//! draws no ownership or modifiability conclusion.
//!
//! Output formats follow `man launchctl` and `man launchd.plist`; they have not
//! been checked against real launchd output.

use std::{
    collections::BTreeMap,
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::grants::{BuiltInReadError, ReadError, built_in_dir, is_below_home};

mod command;
mod output;
mod plist;
#[cfg(test)]
mod tests;

pub use self::plist::{KeepAliveMode, redact_arguments};
pub use command::{
    CommandRunner, Domain, Label, ReadOnlyCommand, Rejected, RunError, SystemRunner,
};
pub use output::{LastExit, parse_launchctl_list, parse_print_disabled};

use self::plist::{PlistDetails, PlistLabel, display_path, parse_plist_json};
use command::PLUTIL;
use output::{LoadedJob, OutputError, ParsedJobs, parse_domain_services};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LaunchdDomain {
    Gui,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LaunchdDirectory {
    UserLaunchAgents,
    GlobalLaunchAgents,
    GlobalLaunchDaemons,
    AppleLaunchAgents,
    AppleLaunchDaemons,
}

pub const DIRECTORIES: [LaunchdDirectory; 5] = [
    LaunchdDirectory::UserLaunchAgents,
    LaunchdDirectory::GlobalLaunchAgents,
    LaunchdDirectory::GlobalLaunchDaemons,
    LaunchdDirectory::AppleLaunchAgents,
    LaunchdDirectory::AppleLaunchDaemons,
];

impl LaunchdDirectory {
    pub fn domain(self) -> LaunchdDomain {
        match self {
            Self::UserLaunchAgents | Self::GlobalLaunchAgents | Self::AppleLaunchAgents => {
                LaunchdDomain::Gui
            }
            Self::GlobalLaunchDaemons | Self::AppleLaunchDaemons => LaunchdDomain::System,
        }
    }

    fn scope(self) -> LaunchdScope {
        match self {
            Self::UserLaunchAgents => LaunchdScope::UserAgent,
            Self::GlobalLaunchAgents => LaunchdScope::GlobalAgent,
            Self::GlobalLaunchDaemons => LaunchdScope::SystemDaemon,
            Self::AppleLaunchAgents => LaunchdScope::AppleAgent,
            Self::AppleLaunchDaemons => LaunchdScope::AppleDaemon,
        }
    }

    fn is_apple(self) -> bool {
        matches!(self, Self::AppleLaunchAgents | Self::AppleLaunchDaemons)
    }

    fn slug(self) -> &'static str {
        match self {
            Self::UserLaunchAgents => "user-launch-agents",
            Self::GlobalLaunchAgents => "global-launch-agents",
            Self::GlobalLaunchDaemons => "global-launch-daemons",
            Self::AppleLaunchAgents => "apple-launch-agents",
            Self::AppleLaunchDaemons => "apple-launch-daemons",
        }
    }

    pub fn source(self) -> Source {
        match self {
            Self::UserLaunchAgents => Source::UserLaunchAgents,
            Self::GlobalLaunchAgents => Source::GlobalLaunchAgents,
            Self::GlobalLaunchDaemons => Source::GlobalLaunchDaemons,
            Self::AppleLaunchAgents => Source::AppleLaunchAgents,
            Self::AppleLaunchDaemons => Source::AppleLaunchDaemons,
        }
    }
}

/// Where a service is defined, by directory only. Not an ownership verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LaunchdScope {
    UserAgent,
    GlobalAgent,
    SystemDaemon,
    AppleAgent,
    AppleDaemon,
    /// Files of this label sit in more than one kind of directory.
    Mixed,
    /// Loaded, with no file found in the scanned locations.
    Unattributed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LoadState {
    Loaded,
    NotLoaded,
    Unknown,
    Inaccessible,
}

/// Whether a process exists, not whether the service is healthy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunState {
    Running,
    NotRunning,
    Unknown,
    Inaccessible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Correlation {
    /// A loaded job and a plist file share the label.
    Matched,
    /// A plist file with a usable label; no loaded job was seen for it.
    FileOnly,
    /// A loaded job; no plist file with its label was found.
    LoadedOnly,
    /// A plist file that cannot be tied to a label (unreadable, no `Label`,
    /// an unsafe label, or a link that was not read).
    UnmatchedFile,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigPresence {
    Found,
    /// Not in any of the scanned locations (other places, such as app bundles,
    /// can define loaded jobs).
    NotFoundInScanned,
    /// A scanned location could not be fully read, or a file could not be
    /// tied to a label, so absence is not concluded.
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LabelSource {
    Launchctl,
    Plist,
    /// The label is the file name; the plist gave none that could be used.
    FileName,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceIssue {
    DuplicateLabel,
    DuplicateLoadedLabel,
    LabelFilenameMismatch,
    MissingLabel,
    InvalidLabel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileKind {
    Regular,
    Link,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LinkState {
    /// The resolved target lies in an expected location.
    Inside,
    Outside,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    pub state: LinkState,
    /// The link as written, `~` abbreviated; never read.
    pub display: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ParseStatus {
    Parsed,
    ConvertFailed,
    TooLarge,
    LinkNotRead,
    Unreadable,
    TimedOut,
    OutputTooLarge,
    ToolUnavailable,
    NotAttempted,
}

impl ParseStatus {
    fn is_failure(self) -> bool {
        !matches!(self, Self::Parsed | Self::LinkNotRead)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    /// `~` abbreviated below `$HOME`.
    pub path: String,
    pub directory: LaunchdDirectory,
    pub scope: LaunchdScope,
    pub is_apple_path: bool,
    pub owner_uid: Option<u32>,
    pub kind: FileKind,
    pub link_target: Option<LinkTarget>,
    pub parse_status: ParseStatus,
    pub details: Option<PlistDetails>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchdService {
    /// `<domain target>/<label>`; an unmatched file is
    /// `<domain target>/!file/<directory>/<file name>`.
    pub id: String,
    pub label: String,
    pub label_source: LabelSource,
    pub domain: LaunchdDomain,
    pub domain_target: String,
    pub scope: LaunchdScope,
    pub correlation: Correlation,
    pub load_state: LoadState,
    pub run_state: RunState,
    pub pid: Option<u32>,
    /// The last exit status launchctl reports. A nonzero value is not an error
    /// verdict, and a PID is not a health verdict.
    pub last_exit: Option<LastExit>,
    pub config_presence: ConfigPresence,
    pub config_files: Vec<ConfigFile>,
    pub issues: Vec<ServiceIssue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Source {
    LaunchctlList,
    LaunchctlPrintSystem,
    UserLaunchAgents,
    GlobalLaunchAgents,
    GlobalLaunchDaemons,
    AppleLaunchAgents,
    AppleLaunchDaemons,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceStatus {
    Complete,
    Partial,
    Inaccessible,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceReason {
    Timeout,
    OutputTooLarge,
    ProcessFailed,
    PermissionDenied,
    ToolUnavailable,
    UnparsedOutput,
    EntryLimit,
    /// The directory does not exist, which is normal and not a failure.
    DirectoryMissing,
    OutsideHome,
    HomeUnavailable,
    Io,
    FileErrors,
    TimeBudget,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReport {
    pub source: Source,
    pub status: SourceStatus,
    pub reason: Option<SourceReason>,
    /// Jobs parsed (commands) or plist entries listed (directories).
    pub items: usize,
    pub failed_files: usize,
}

impl SourceReport {
    fn new(source: Source, status: SourceStatus, reason: Option<SourceReason>) -> Self {
        Self {
            source,
            status,
            reason,
            items: 0,
            failed_files: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchdDiscovery {
    pub services: Vec<LaunchdService>,
    pub sources: Vec<SourceReport>,
    /// True only when every source was complete and nothing was cut off.
    pub complete: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct ScanLocations {
    pub user_agents: Option<PathBuf>,
    pub global_agents: PathBuf,
    pub global_daemons: PathBuf,
    pub apple_agents: PathBuf,
    pub apple_daemons: PathBuf,
}

impl ScanLocations {
    /// The fixed built-in locations; the user directory needs a usable home.
    pub fn fixed(home: Option<&Path>) -> Self {
        Self {
            user_agents: home.map(|home| home.join("Library/LaunchAgents")),
            global_agents: PathBuf::from("/Library/LaunchAgents"),
            global_daemons: PathBuf::from("/Library/LaunchDaemons"),
            apple_agents: PathBuf::from("/System/Library/LaunchAgents"),
            apple_daemons: PathBuf::from("/System/Library/LaunchDaemons"),
        }
    }

    fn path(&self, directory: LaunchdDirectory) -> Option<&Path> {
        match directory {
            LaunchdDirectory::UserLaunchAgents => self.user_agents.as_deref(),
            LaunchdDirectory::GlobalLaunchAgents => Some(&self.global_agents),
            LaunchdDirectory::GlobalLaunchDaemons => Some(&self.global_daemons),
            LaunchdDirectory::AppleLaunchAgents => Some(&self.apple_agents),
            LaunchdDirectory::AppleLaunchDaemons => Some(&self.apple_daemons),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_services: usize,
    pub max_entries_per_dir: usize,
    pub max_plist_bytes: u64,
    /// Total time after which remaining plists are not converted.
    pub time_budget: Duration,
    pub workers: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_services: 2000,
            max_entries_per_dir: 1024,
            max_plist_bytes: 1024 * 1024,
            time_budget: Duration::from_secs(30),
            workers: 4,
        }
    }
}

pub struct Discovery<'a> {
    pub uid: u32,
    /// The canonical home directory, when it could be resolved.
    pub home: Option<PathBuf>,
    pub locations: ScanLocations,
    pub runner: &'a dyn CommandRunner,
    pub limits: Limits,
}

/// Lets one discovery run at a time.
pub struct DiscoveryGate;

static DISCOVERY_RUNNING: AtomicBool = AtomicBool::new(false);

impl DiscoveryGate {
    pub fn try_acquire() -> Option<Self> {
        DISCOVERY_RUNNING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
            .then_some(Self)
    }
}

impl Drop for DiscoveryGate {
    fn drop(&mut self) {
        DISCOVERY_RUNNING.store(false, Ordering::Release);
    }
}

/// Runs `use_context` against the real system: the fixed read-only sources and
/// the current user's uid.
pub fn with_system<T>(use_context: impl FnOnce(&Discovery<'_>) -> T) -> T {
    let home = std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .and_then(|value| fs::canonicalize(value).ok());
    let locations = ScanLocations::fixed(home.as_deref());
    // SAFETY: getuid takes no arguments and cannot fail.
    let uid = unsafe { libc::getuid() };
    use_context(&Discovery {
        uid,
        home,
        locations,
        runner: &SystemRunner,
        limits: Limits::default(),
    })
}

/// Discovery against the real system, with the fixed read-only sources.
pub fn discover_system() -> LaunchdDiscovery {
    with_system(discover)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Availability {
    Conclusive,
    Partial,
    Inaccessible,
    Unavailable,
}

struct LoadedSet {
    jobs: Vec<LoadedJob>,
    availability: Availability,
}

fn domain_target(domain: LaunchdDomain, uid: u32) -> String {
    match domain {
        LaunchdDomain::Gui => format!("gui/{uid}"),
        LaunchdDomain::System => "system".to_owned(),
    }
}

fn run_error_report(source: Source, error: RunError) -> SourceReport {
    let (status, reason) = match error {
        RunError::Timeout => (SourceStatus::Failed, SourceReason::Timeout),
        RunError::OutputTooLarge => (SourceStatus::Failed, SourceReason::OutputTooLarge),
        RunError::PermissionDenied => (SourceStatus::Inaccessible, SourceReason::PermissionDenied),
        RunError::ToolMissing => (SourceStatus::Failed, SourceReason::ToolUnavailable),
        RunError::Failed => (SourceStatus::Failed, SourceReason::ProcessFailed),
        RunError::Io => (SourceStatus::Failed, SourceReason::Io),
    };
    SourceReport::new(source, status, Some(reason))
}

fn load_jobs(
    runner: &dyn CommandRunner,
    command: &ReadOnlyCommand,
    source: Source,
    parse: fn(&str) -> Result<ParsedJobs, OutputError>,
) -> (SourceReport, LoadedSet) {
    let unavailable = |report: SourceReport| {
        let availability = match report.status {
            SourceStatus::Inaccessible => Availability::Inaccessible,
            _ => Availability::Unavailable,
        };
        (
            report,
            LoadedSet {
                jobs: Vec::new(),
                availability,
            },
        )
    };
    let text = match runner.run(command) {
        Ok(text) => text,
        Err(error) => return unavailable(run_error_report(source, error)),
    };
    match parse(&text) {
        Ok(parsed) => {
            let partial = parsed.skipped_lines > 0;
            let mut report = SourceReport::new(
                source,
                if partial {
                    SourceStatus::Partial
                } else {
                    SourceStatus::Complete
                },
                partial.then_some(SourceReason::UnparsedOutput),
            );
            report.items = parsed.jobs.len();
            (
                report,
                LoadedSet {
                    jobs: parsed.jobs,
                    availability: if partial {
                        Availability::Partial
                    } else {
                        Availability::Conclusive
                    },
                },
            )
        }
        Err(OutputError::Unparsed) => unavailable(SourceReport::new(
            source,
            SourceStatus::Failed,
            Some(SourceReason::UnparsedOutput),
        )),
    }
}

/// One plist directory entry, before conversion.
struct RawFile {
    directory: LaunchdDirectory,
    path: PathBuf,
    name: String,
    owner_uid: Option<u32>,
    kind: FileKind,
    size: u64,
    link_target: Option<LinkTarget>,
}

struct Scanned {
    report: SourceReport,
    files: Vec<RawFile>,
}

fn classify_io(error: &std::io::Error) -> (SourceStatus, SourceReason) {
    match error.kind() {
        std::io::ErrorKind::NotFound => (SourceStatus::Complete, SourceReason::DirectoryMissing),
        std::io::ErrorKind::PermissionDenied => {
            (SourceStatus::Inaccessible, SourceReason::PermissionDenied)
        }
        _ => (SourceStatus::Failed, SourceReason::Io),
    }
}

fn link_state(
    path: &Path,
    directory: LaunchdDirectory,
    home: Option<&Path>,
    roots: &[PathBuf],
) -> LinkState {
    let Ok(target) = fs::canonicalize(path) else {
        return LinkState::Unresolved;
    };
    let inside = if directory == LaunchdDirectory::UserLaunchAgents {
        is_below_home(&target, home)
    } else {
        roots.iter().any(|root| target.starts_with(root))
    };
    if inside {
        LinkState::Inside
    } else {
        LinkState::Outside
    }
}

fn scan_directory(ctx: &Discovery<'_>, directory: LaunchdDirectory, roots: &[PathBuf]) -> Scanned {
    let source = directory.source();
    let failed = |status, reason| Scanned {
        report: SourceReport::new(source, status, Some(reason)),
        files: Vec::new(),
    };
    let Some(location) = ctx.locations.path(directory) else {
        return failed(SourceStatus::Failed, SourceReason::HomeUnavailable);
    };
    let listing = if directory == LaunchdDirectory::UserLaunchAgents {
        match built_in_dir(location, ctx.home.as_deref()) {
            Ok(canonical) => canonical,
            Err(BuiltInReadError::Outside) => {
                return failed(SourceStatus::Failed, SourceReason::OutsideHome);
            }
            Err(BuiltInReadError::Failed(ReadError::NotFound)) => {
                return failed(SourceStatus::Complete, SourceReason::DirectoryMissing);
            }
            Err(BuiltInReadError::Failed(ReadError::PermissionDenied)) => {
                return failed(SourceStatus::Inaccessible, SourceReason::PermissionDenied);
            }
            Err(BuiltInReadError::Failed(ReadError::Excluded)) => {
                return failed(SourceStatus::Failed, SourceReason::HomeUnavailable);
            }
            Err(BuiltInReadError::Failed(_)) => {
                return failed(SourceStatus::Failed, SourceReason::Io);
            }
        }
    } else {
        location.to_path_buf()
    };
    let entries = match fs::read_dir(&listing) {
        Ok(entries) => entries,
        Err(error) => {
            let (status, reason) = classify_io(&error);
            return failed(status, reason);
        }
    };

    let cap = ctx.limits.max_entries_per_dir;
    let mut names = Vec::new();
    let mut entry_errors = 0;
    let mut cut = false;
    for entry in entries {
        let Ok(entry) = entry else {
            entry_errors += 1;
            continue;
        };
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !name.ends_with(".plist") {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            entry_errors += 1;
            continue;
        };
        if !(file_type.is_file() || file_type.is_symlink()) {
            continue;
        }
        if names.len() == cap {
            cut = true;
            break;
        }
        names.push(name);
    }
    names.sort();

    let mut files = Vec::with_capacity(names.len());
    for name in names {
        let path = listing.join(&name);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            entry_errors += 1;
            continue;
        };
        let (kind, link_target) = if metadata.file_type().is_symlink() {
            let written = fs::read_link(&path).ok().map(|target| {
                display_path(
                    &plist::clip(&target.to_string_lossy(), 1024),
                    ctx.home.as_deref(),
                )
            });
            let state = link_state(&path, directory, ctx.home.as_deref(), roots);
            (
                FileKind::Link,
                Some(LinkTarget {
                    state,
                    display: written,
                }),
            )
        } else if metadata.is_file() {
            (FileKind::Regular, None)
        } else {
            continue;
        };
        files.push(RawFile {
            directory,
            path,
            name,
            owner_uid: Some(metadata.uid()),
            kind,
            size: metadata.len(),
            link_target,
        });
    }

    let mut report = SourceReport::new(source, SourceStatus::Complete, None);
    report.items = files.len();
    report.failed_files = entry_errors;
    if cut {
        report.status = SourceStatus::Partial;
        report.reason = Some(SourceReason::EntryLimit);
    } else if entry_errors > 0 {
        report.status = SourceStatus::Partial;
        report.reason = Some(SourceReason::FileErrors);
    }
    Scanned { report, files }
}

struct Converted {
    status: ParseStatus,
    details: Option<PlistDetails>,
}

fn convert_one(ctx: &Discovery<'_>, file: &RawFile) -> Converted {
    let failed = |status| Converted {
        status,
        details: None,
    };
    let Ok(command) = ReadOnlyCommand::plutil_convert(&file.path) else {
        return failed(ParseStatus::Unreadable);
    };
    match ctx.runner.run(&command) {
        Ok(json) => match parse_plist_json(&json, ctx.home.as_deref()) {
            Ok(details) => Converted {
                status: ParseStatus::Parsed,
                details: Some(details),
            },
            Err(_) => failed(ParseStatus::ConvertFailed),
        },
        Err(RunError::Timeout) => failed(ParseStatus::TimedOut),
        Err(RunError::OutputTooLarge) => failed(ParseStatus::OutputTooLarge),
        Err(RunError::ToolMissing) => failed(ParseStatus::ToolUnavailable),
        Err(RunError::PermissionDenied) => failed(ParseStatus::Unreadable),
        Err(RunError::Failed | RunError::Io) => failed(ParseStatus::ConvertFailed),
    }
}

/// Converts every regular, small enough file, a few at a time, until the time
/// budget is spent. One file's failure never affects another.
fn convert_files(ctx: &Discovery<'_>, files: &[RawFile], deadline: Instant) -> Vec<Converted> {
    let mut results: Vec<Option<Converted>> = files.iter().map(|_| None).collect();
    let mut eligible = Vec::new();
    for (index, file) in files.iter().enumerate() {
        match file.kind {
            FileKind::Link => {
                results[index] = Some(Converted {
                    status: ParseStatus::LinkNotRead,
                    details: None,
                });
            }
            FileKind::Regular if file.size > ctx.limits.max_plist_bytes => {
                results[index] = Some(Converted {
                    status: ParseStatus::TooLarge,
                    details: None,
                });
            }
            FileKind::Regular => eligible.push(index),
        }
    }
    if !eligible.is_empty() && !ctx.runner.tool_available(PLUTIL) {
        for &index in &eligible {
            results[index] = Some(Converted {
                status: ParseStatus::ToolUnavailable,
                details: None,
            });
        }
        eligible.clear();
    }

    let slots = Mutex::new(results);
    let next = AtomicUsize::new(0);
    let workers = ctx.limits.workers.clamp(1, eligible.len().max(1));
    thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                loop {
                    let position = next.fetch_add(1, Ordering::SeqCst);
                    let Some(&index) = eligible.get(position) else {
                        break;
                    };
                    let converted = if Instant::now() >= deadline {
                        Converted {
                            status: ParseStatus::NotAttempted,
                            details: None,
                        }
                    } else {
                        convert_one(ctx, &files[index])
                    };
                    if let Ok(mut slots) = slots.lock() {
                        slots[index] = Some(converted);
                    }
                }
            });
        }
    });
    slots
        .into_inner()
        .unwrap_or_default()
        .into_iter()
        .map(|slot| {
            slot.unwrap_or(Converted {
                status: ParseStatus::NotAttempted,
                details: None,
            })
        })
        .collect()
}

/// A plist file after conversion, with what the merge needs.
struct ScannedFile {
    config: ConfigFile,
    label: PlistLabel,
    stem: String,
    domain: LaunchdDomain,
}

#[derive(Clone)]
struct Entry {
    domain: LaunchdDomain,
    label: String,
    label_source: LabelSource,
    loaded: Vec<LoadedJob>,
    files: Vec<ConfigFile>,
    mismatch: bool,
    unmatched: Option<Option<ServiceIssue>>,
    file_slug: Option<String>,
}

impl Entry {
    fn new(domain: LaunchdDomain, label: String, label_source: LabelSource) -> Self {
        Self {
            domain,
            label,
            label_source,
            loaded: Vec::new(),
            files: Vec::new(),
            mismatch: false,
            unmatched: None,
            file_slug: None,
        }
    }
}

fn domain_order(domain: LaunchdDomain) -> u8 {
    match domain {
        LaunchdDomain::Gui => 0,
        LaunchdDomain::System => 1,
    }
}

pub fn discover(ctx: &Discovery<'_>) -> LaunchdDiscovery {
    let deadline = Instant::now()
        .checked_add(ctx.limits.time_budget)
        .unwrap_or_else(Instant::now);

    let (list_report, user_loaded) = load_jobs(
        ctx.runner,
        &ReadOnlyCommand::launchctl_list(),
        Source::LaunchctlList,
        parse_launchctl_list,
    );
    let (system_report, system_loaded) = load_jobs(
        ctx.runner,
        &ReadOnlyCommand::launchctl_print_domain(command::Domain::System),
        Source::LaunchctlPrintSystem,
        parse_domain_services,
    );

    let roots: Vec<PathBuf> = DIRECTORIES
        .iter()
        .filter_map(|directory| ctx.locations.path(*directory))
        .filter_map(|path| fs::canonicalize(path).ok())
        .collect();
    let mut sources = vec![list_report, system_report];
    let mut raw_files = Vec::new();
    let mut directory_ranges = Vec::new();
    for directory in DIRECTORIES {
        let scanned = scan_directory(ctx, directory, &roots);
        directory_ranges.push((
            directory,
            sources.len(),
            raw_files.len()..raw_files.len() + scanned.files.len(),
        ));
        sources.push(scanned.report);
        raw_files.extend(scanned.files);
    }

    let converted = convert_files(ctx, &raw_files, deadline);
    let mut scanned_files = Vec::with_capacity(raw_files.len());
    for (raw, converted) in raw_files.iter().zip(converted) {
        let label = converted
            .details
            .as_ref()
            .map_or(PlistLabel::Missing, |details| details.label.clone());
        scanned_files.push(ScannedFile {
            config: ConfigFile {
                path: display_path(&raw.path.to_string_lossy(), ctx.home.as_deref()),
                directory: raw.directory,
                scope: raw.directory.scope(),
                is_apple_path: raw.directory.is_apple(),
                owner_uid: raw.owner_uid,
                kind: raw.kind,
                link_target: raw.link_target.clone(),
                parse_status: converted.status,
                details: converted.details,
            },
            label,
            stem: raw
                .name
                .strip_suffix(".plist")
                .unwrap_or(&raw.name)
                .to_owned(),
            domain: raw.directory.domain(),
        });
    }

    // Fold per-file failures into the directory reports.
    for (_, report_index, range) in &directory_ranges {
        let files = &scanned_files[range.clone()];
        let failures = files
            .iter()
            .filter(|file| file.config.parse_status.is_failure())
            .count();
        if failures == 0 {
            continue;
        }
        let report = &mut sources[*report_index];
        report.failed_files += failures;
        let reason = if files
            .iter()
            .any(|file| file.config.parse_status == ParseStatus::NotAttempted)
        {
            SourceReason::TimeBudget
        } else if files
            .iter()
            .any(|file| file.config.parse_status == ParseStatus::ToolUnavailable)
        {
            SourceReason::ToolUnavailable
        } else {
            SourceReason::FileErrors
        };
        if report.status == SourceStatus::Complete {
            report.status = SourceStatus::Partial;
            report.reason = Some(reason);
        }
    }

    let mut services = merge(ctx, &user_loaded, &system_loaded, scanned_files, &sources);
    services.sort_by(|left, right| {
        left.label
            .to_lowercase()
            .cmp(&right.label.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    let truncated = services.len() > ctx.limits.max_services;
    services.truncate(ctx.limits.max_services);
    let complete = !truncated
        && sources
            .iter()
            .all(|report| report.status == SourceStatus::Complete);
    LaunchdDiscovery {
        services,
        sources,
        complete,
        truncated,
    }
}

/// What is known about one domain, for the states of its entries.
struct DomainFacts {
    availability: Availability,
    /// Every scanned directory of the domain was listed completely.
    dirs_complete: bool,
    /// Some file of the domain could not be tied to a label.
    has_unmatched: bool,
}

fn merge(
    ctx: &Discovery<'_>,
    user_loaded: &LoadedSet,
    system_loaded: &LoadedSet,
    files: Vec<ScannedFile>,
    sources: &[SourceReport],
) -> Vec<LaunchdService> {
    let mut labelled: BTreeMap<(u8, String), Entry> = BTreeMap::new();
    let mut unmatched: Vec<Entry> = Vec::new();

    for (domain, set) in [
        (LaunchdDomain::Gui, user_loaded),
        (LaunchdDomain::System, system_loaded),
    ] {
        for job in &set.jobs {
            labelled
                .entry((domain_order(domain), job.label.clone()))
                .or_insert_with(|| Entry::new(domain, job.label.clone(), LabelSource::Launchctl))
                .loaded
                .push(job.clone());
        }
    }

    for file in files {
        if let (PlistLabel::Present(label), ParseStatus::Parsed) =
            (&file.label, file.config.parse_status)
        {
            let entry = labelled
                .entry((domain_order(file.domain), label.clone()))
                .or_insert_with(|| Entry::new(file.domain, label.clone(), LabelSource::Plist));
            entry.label_source = LabelSource::Plist;
            entry.mismatch |= file.stem != *label;
            entry.files.push(file.config);
            continue;
        }
        let issue = match (&file.label, file.config.parse_status) {
            (PlistLabel::Missing, ParseStatus::Parsed) => Some(ServiceIssue::MissingLabel),
            (PlistLabel::Invalid, ParseStatus::Parsed) => Some(ServiceIssue::InvalidLabel),
            _ => None,
        };
        let mut entry = Entry::new(file.domain, file.stem.clone(), LabelSource::FileName);
        entry.file_slug = Some(format!(
            "{}/{}.plist",
            file.config.directory.slug(),
            file.stem
        ));
        entry.unmatched = Some(issue);
        entry.files.push(file.config);
        unmatched.push(entry);
    }

    let facts = |domain: LaunchdDomain, set: &LoadedSet| DomainFacts {
        availability: set.availability,
        dirs_complete: DIRECTORIES
            .iter()
            .filter(|directory| directory.domain() == domain)
            .all(|directory| {
                sources
                    .iter()
                    .find(|report| report.source == directory.source())
                    .is_some_and(|report| report.status == SourceStatus::Complete)
            }),
        has_unmatched: unmatched.iter().any(|entry| entry.domain == domain),
    };
    let gui = facts(LaunchdDomain::Gui, user_loaded);
    let system = facts(LaunchdDomain::System, system_loaded);

    labelled
        .into_values()
        .chain(unmatched.iter().cloned())
        .map(|entry| {
            let facts = match entry.domain {
                LaunchdDomain::Gui => &gui,
                LaunchdDomain::System => &system,
            };
            finish(ctx.uid, entry, facts)
        })
        .collect()
}

fn finish(uid: u32, entry: Entry, facts: &DomainFacts) -> LaunchdService {
    let unmatched = entry.unmatched.is_some();
    let correlation = match (unmatched, entry.loaded.is_empty(), entry.files.is_empty()) {
        (true, _, _) => Correlation::UnmatchedFile,
        (false, false, false) => Correlation::Matched,
        (false, true, _) => Correlation::FileOnly,
        (false, false, true) => Correlation::LoadedOnly,
    };
    let load_state = if !entry.loaded.is_empty() {
        LoadState::Loaded
    } else if unmatched {
        LoadState::Unknown
    } else {
        match facts.availability {
            Availability::Conclusive => LoadState::NotLoaded,
            Availability::Inaccessible => LoadState::Inaccessible,
            Availability::Partial | Availability::Unavailable => LoadState::Unknown,
        }
    };
    let job = entry
        .loaded
        .iter()
        .find(|job| job.pid.is_some())
        .or_else(|| entry.loaded.first());
    let pid = job.and_then(|job| job.pid);
    let run_state = match load_state {
        LoadState::Loaded if pid.is_some() => RunState::Running,
        LoadState::Loaded | LoadState::NotLoaded => RunState::NotRunning,
        LoadState::Unknown => RunState::Unknown,
        LoadState::Inaccessible => RunState::Inaccessible,
    };
    let config_presence = if !entry.files.is_empty() {
        ConfigPresence::Found
    } else if facts.dirs_complete && !facts.has_unmatched {
        ConfigPresence::NotFoundInScanned
    } else {
        ConfigPresence::Unknown
    };
    let scope = match entry.files.split_first() {
        None => LaunchdScope::Unattributed,
        Some((first, rest)) if rest.iter().all(|file| file.scope == first.scope) => first.scope,
        Some(_) => LaunchdScope::Mixed,
    };
    let mut issues = Vec::new();
    if entry.files.len() > 1 && !unmatched {
        issues.push(ServiceIssue::DuplicateLabel);
    }
    if entry.loaded.len() > 1 {
        issues.push(ServiceIssue::DuplicateLoadedLabel);
    }
    if entry.mismatch {
        issues.push(ServiceIssue::LabelFilenameMismatch);
    }
    issues.extend(entry.unmatched.flatten());

    let target = domain_target(entry.domain, uid);
    let id = match &entry.file_slug {
        Some(slug) => format!("{target}/!file/{slug}"),
        None => format!("{target}/{}", entry.label),
    };
    LaunchdService {
        id,
        label: entry.label,
        label_source: entry.label_source,
        domain: entry.domain,
        domain_target: target,
        scope,
        correlation,
        load_state,
        run_state,
        pid,
        last_exit: job.and_then(|job| job.last_exit),
        config_presence,
        config_files: entry.files,
        issues,
    }
}
