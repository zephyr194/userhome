//! Read-only source entries for the AI configuration module. This is a Rust
//! interface, not an IPC command: the caller names the directory
//! authorizations (and, optionally, the zsh startup files) to read, and gets
//! back what each source statically says — key, scope, whether it looks
//! secret, why it is unresolved, where it came from and the CORE-5 identity of
//! the bytes that were read.
//!
//! What this module deliberately does not do: inject anything into a global or
//! process environment, merge sources into an "effective" value, decide
//! precedence, or execute / source any file. The same key found in several
//! sources is returned once per source, side by side; which one wins for a
//! given tool is the AI provider's versioned rule, not a guess made here.
//!
//! Secret values are not part of the result (only presence and length).
//! `reveal_entry` is the one explicit, per-entry way to get a value, and no
//! `Debug` output in this module prints a value.

use std::{collections::HashMap, fmt, path::Path};

use crate::{
    error::AppError,
    grants::{ContentFingerprint, GrantCoordinator, GrantError, GrantId},
};

use super::{
    FailureKind, FileRequest, MAX_INLINE_CHARS, RevealRequest, RevealedValue,
    dotenv::{self, DotenvEntry, DotenvLine, EntryFlag, LineKind as DotenvLineKind},
    load,
    scan::{self, FileKind, PartialReason, ScanConfig, ScanError, ScanLimits},
    zsh::{self, AppliesTo, Problem, StartupFile, ZshRequest, ZshRevealRequest},
    zsh_parse::{
        self, DynamicReason, LineKind as ZshLineKind, Operation, ParsedLine, ValueState, ZshEntry,
    },
};

/// One directory authorization to read dotenv files from, with the scan
/// configuration the user chose for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DotenvSource {
    pub grant: GrantId,
    pub config: ScanConfig,
}

/// Which sources to read. Nothing is read that is not named here.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProviderRequest {
    pub dotenv: Vec<DotenvSource>,
    /// `Some` reads the user's zsh startup files (built-in sources); the
    /// request carries the directory the user chose for an undetermined
    /// `ZDOTDIR`, if any.
    pub zsh: Option<ZshRequest>,
}

/// Where an entry (or a failure) comes from. Never carries a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceRef {
    Dotenv {
        grant_id: String,
        /// Display form of the authorized directory (`~/proj`).
        root: String,
        relative_path: String,
    },
    /// A whole authorized directory (for a failure that is not about one file).
    DotenvDirectory {
        grant_id: String,
    },
    Zsh {
        file: StartupFile,
    },
}

/// The scope an entry applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// A dotenv file; templates (`.env.example`) are marked, never runtime values.
    Dotenv { kind: FileKind },
    /// A zsh startup file and the shell types that read it.
    Zsh {
        file: StartupFile,
        applies_to: AppliesTo,
    },
}

/// Why an entry is not a plain, static `NAME=value` pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnresolvedReason {
    /// The key is assigned more than once in the same file.
    DuplicateKey,
    /// `$VAR` / `${VAR}` in a dotenv value; not expanded.
    Interpolation,
    /// `$(…)` or a backtick; never evaluated.
    CommandSubstitution,
    MultilineValue,
    /// A zsh value with `$HOME` / `~` style references kept as written.
    Reference,
    /// A zsh `NAME+=…`: the result depends on an earlier value.
    Append,
    /// Anything else a zsh value needs evaluation for.
    Dynamic(Option<DynamicReason>),
}

#[derive(Clone, PartialEq, Eq)]
pub struct SourceEntry {
    pub key: String,
    pub scope: Scope,
    pub source: SourceRef,
    /// Name (and URL credential) heuristic; not a guarantee either way.
    pub secret: bool,
    /// Empty means a static literal; otherwise the value is not to be read as
    /// the effective one.
    pub unresolved: Vec<UnresolvedReason>,
    pub exported: bool,
    pub has_value: bool,
    pub value_length: usize,
    /// The value as written, only for non-secret values of reasonable length.
    pub value: Option<String>,
    /// Identity of the bytes this entry was read from.
    pub fingerprint: ContentFingerprint,
    pub line: usize,
    pub end_line: usize,
}

impl SourceEntry {
    pub fn is_unresolved(&self) -> bool {
        !self.unresolved.is_empty()
    }
}

// A value may be a secret: `Debug` shows only whether one is present.
impl fmt::Debug for SourceEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SourceEntry")
            .field("key", &self.key)
            .field("scope", &self.scope)
            .field("source", &self.source)
            .field("secret", &self.secret)
            .field("unresolved", &self.unresolved)
            .field("exported", &self.exported)
            .field("has_value", &self.has_value)
            .field("value_length", &self.value_length)
            .field("value_included", &self.value.is_some())
            .field("fingerprint", &self.fingerprint)
            .field("line", &self.line)
            .field("end_line", &self.end_line)
            .finish()
    }
}

/// What happened to one source file that was reached.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileStatus {
    Read {
        fingerprint: ContentFingerprint,
        entry_count: usize,
        /// Statements this reading cannot interpret (dotenv: unsupported
        /// lines; zsh: lines it does not recognize).
        unrecognized_lines: usize,
        /// zsh statements that need evaluation (`source`, `if`, `eval`, …);
        /// they may change what is really set but are not guessed into entries.
        dynamic_statements: usize,
    },
    /// A zsh startup file that does not exist. That is a normal state, not a
    /// failure, but it is still reported rather than hidden.
    Absent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileReport {
    pub source: SourceRef,
    pub status: FileStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectoryOutcome {
    Scanned {
        file_count: usize,
        skipped_total: usize,
        /// Non-empty means the list of files is incomplete.
        partial_reasons: Vec<PartialReason>,
    },
    Failed {
        kind: ProblemKind,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryReport {
    pub grant_id: String,
    pub outcome: DirectoryOutcome,
}

/// Why a source could not be read. Never folded into an empty configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProblemKind {
    NotFound,
    PermissionDenied,
    Malformed,
    TooLarge,
    Unsupported,
    /// Authorization revoked, link leaving the authorized area, excluded
    /// directory or a name the scan configuration would not list.
    Excluded,
    Io,
    /// A zsh file that resolves outside `$HOME` (or into a protected place).
    OutsideHome,
    /// `ZDOTDIR` is undetermined, so the file's location is unknown.
    NotLocated,
}

impl From<FailureKind> for ProblemKind {
    fn from(kind: FailureKind) -> Self {
        match kind {
            FailureKind::NotFound => Self::NotFound,
            FailureKind::PermissionDenied => Self::PermissionDenied,
            FailureKind::Malformed => Self::Malformed,
            FailureKind::TooLarge => Self::TooLarge,
            FailureKind::Unsupported => Self::Unsupported,
            FailureKind::Excluded => Self::Excluded,
            FailureKind::Io => Self::Io,
        }
    }
}

impl ProblemKind {
    pub fn message(self) -> &'static str {
        match self {
            Self::NotFound => FailureKind::NotFound.message(),
            Self::PermissionDenied => FailureKind::PermissionDenied.message(),
            Self::Malformed => FailureKind::Malformed.message(),
            Self::TooLarge => FailureKind::TooLarge.message(),
            Self::Unsupported => FailureKind::Unsupported.message(),
            Self::Excluded => FailureKind::Excluded.message(),
            Self::Io => FailureKind::Io.message(),
            Self::OutsideHome => zsh::OUTSIDE_MESSAGE,
            Self::NotLocated => zsh::NOT_LOCATED_MESSAGE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceFailure {
    pub source: SourceRef,
    pub kind: ProblemKind,
    pub message: String,
}

/// Why the entry list is empty, when it is. Absence of sources is a reason,
/// not an error; read failures are in `failures` instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmptyReason {
    NoDotenvAuthorization,
    /// Authorized directories were scanned and hold no matching file.
    NoDotenvFiles,
    /// None of the zsh startup files exists.
    NoZshFiles,
    /// Files were read, but none holds a recognizable entry.
    NoEntries,
}

impl EmptyReason {
    pub fn message(self) -> &'static str {
        match self {
            Self::NoDotenvAuthorization => "没有任何 dotenv 目录授权。",
            Self::NoDotenvFiles => "已授权的目录中没有匹配的 dotenv 文件。",
            Self::NoZshFiles => "未发现 zsh 启动文件。",
            Self::NoEntries => "已读取的文件中没有可识别的条目。",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceSnapshot {
    /// Every entry of every source that was read, per source in request order
    /// (dotenv directories, then the zsh files in reading order), lines in
    /// file order. Same keys from different sources stay separate.
    pub entries: Vec<SourceEntry>,
    pub files: Vec<FileReport>,
    pub directories: Vec<DirectoryReport>,
    /// Sources that could not be read; the entries above are what was.
    pub failures: Vec<SourceFailure>,
    pub empty_reasons: Vec<EmptyReason>,
}

/// Reads the requested sources. A source that fails is reported in `failures`
/// and the rest are still read; only an invalid scan configuration is an error.
pub fn collect(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    request: &ProviderRequest,
) -> Result<SourceSnapshot, AppError> {
    for source in &request.dotenv {
        source.config.validate()?;
    }
    let mut snapshot = SourceSnapshot {
        entries: Vec::new(),
        files: Vec::new(),
        directories: Vec::new(),
        failures: Vec::new(),
        empty_reasons: Vec::new(),
    };
    for source in &request.dotenv {
        collect_dotenv(coordinator, home, source, &mut snapshot)?;
    }
    if let Some(zsh_request) = &request.zsh {
        collect_zsh(coordinator, home, zsh_request, &mut snapshot);
    }
    snapshot.empty_reasons = empty_reasons(request, &snapshot);
    Ok(snapshot)
}

fn empty_reasons(request: &ProviderRequest, snapshot: &SourceSnapshot) -> Vec<EmptyReason> {
    if !snapshot.entries.is_empty() {
        return Vec::new();
    }
    let mut reasons = Vec::new();
    if request.dotenv.is_empty() {
        reasons.push(EmptyReason::NoDotenvAuthorization);
    } else if snapshot.directories.iter().all(|directory| {
        matches!(
            directory.outcome,
            DirectoryOutcome::Scanned { file_count: 0, .. }
        )
    }) {
        reasons.push(EmptyReason::NoDotenvFiles);
    }
    if request.zsh.is_some()
        && snapshot
            .files
            .iter()
            .filter(|file| matches!(file.source, SourceRef::Zsh { .. }))
            .all(|file| file.status == FileStatus::Absent)
        && snapshot
            .failures
            .iter()
            .all(|failure| !matches!(failure.source, SourceRef::Zsh { .. }))
    {
        reasons.push(EmptyReason::NoZshFiles);
    }
    if snapshot
        .files
        .iter()
        .any(|file| matches!(file.status, FileStatus::Read { .. }))
    {
        reasons.push(EmptyReason::NoEntries);
    }
    reasons
}

fn failure(source: SourceRef, kind: ProblemKind) -> SourceFailure {
    SourceFailure {
        source,
        kind,
        message: kind.message().to_owned(),
    }
}

// ---- dotenv --------------------------------------------------------------------

fn directory_problem(error: &GrantError) -> FailureKind {
    match error {
        GrantError::NotFound => FailureKind::NotFound,
        GrantError::PermissionDenied => FailureKind::PermissionDenied,
        GrantError::NotDirectory | GrantError::NotFile => FailureKind::Unsupported,
        GrantError::UnknownGrant
        | GrantError::SymlinkEscape
        | GrantError::OutsideHome
        | GrantError::ProtectedLocation
        | GrantError::HomeUnavailable => FailureKind::Excluded,
        _ => FailureKind::Io,
    }
}

fn collect_dotenv(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    source: &DotenvSource,
    snapshot: &mut SourceSnapshot,
) -> Result<(), AppError> {
    let limits = ScanLimits::default();
    let grant_id = source.grant.as_str().to_owned();
    let scanned = match scan::scan(coordinator, &source.grant, &source.config, limits, home) {
        Ok(scanned) => scanned,
        Err(ScanError::Invalid(message)) => return Err(AppError::invalid_input(message)),
        Err(ScanError::Grant(error)) => {
            let kind = ProblemKind::from(directory_problem(&error));
            snapshot.directories.push(DirectoryReport {
                grant_id: grant_id.clone(),
                outcome: DirectoryOutcome::Failed { kind },
            });
            snapshot
                .failures
                .push(failure(SourceRef::DotenvDirectory { grant_id }, kind));
            return Ok(());
        }
    };
    snapshot.directories.push(DirectoryReport {
        grant_id: grant_id.clone(),
        outcome: DirectoryOutcome::Scanned {
            file_count: scanned.files.len(),
            skipped_total: scanned.skipped_total,
            partial_reasons: scanned.partial_reasons.clone(),
        },
    });
    for file in &scanned.files {
        let reference = SourceRef::Dotenv {
            grant_id: grant_id.clone(),
            root: scanned.root.clone(),
            relative_path: file.relative_path.clone(),
        };
        let file_request = FileRequest {
            relative_path: file.relative_path.clone(),
            config: source.config.clone(),
        };
        let loaded = match load(coordinator, &source.grant, &file_request, limits) {
            Ok(loaded) => loaded,
            Err(kind) => {
                snapshot.failures.push(failure(reference, kind.into()));
                continue;
            }
        };
        let document = dotenv::parse(&loaded.text);
        let (mut entry_count, mut unrecognized_lines) = (0, 0);
        for line in &document.lines {
            match &line.kind {
                DotenvLineKind::Entry(entry) => {
                    entry_count += 1;
                    snapshot.entries.push(dotenv_entry(
                        &reference,
                        file.kind,
                        &loaded.fingerprint,
                        line,
                        entry,
                    ));
                }
                DotenvLineKind::Unknown => unrecognized_lines += 1,
                DotenvLineKind::Blank | DotenvLineKind::Comment => {}
            }
        }
        snapshot.files.push(FileReport {
            source: reference,
            status: FileStatus::Read {
                fingerprint: loaded.fingerprint,
                entry_count,
                unrecognized_lines,
                dynamic_statements: 0,
            },
        });
    }
    Ok(())
}

fn dotenv_entry(
    source: &SourceRef,
    kind: FileKind,
    fingerprint: &ContentFingerprint,
    line: &DotenvLine,
    entry: &DotenvEntry,
) -> SourceEntry {
    let unresolved = entry
        .flags
        .iter()
        .map(|flag| match flag {
            EntryFlag::DuplicateKey => UnresolvedReason::DuplicateKey,
            EntryFlag::Interpolation => UnresolvedReason::Interpolation,
            EntryFlag::CommandSubstitution => UnresolvedReason::CommandSubstitution,
            EntryFlag::MultilineValue => UnresolvedReason::MultilineValue,
        })
        .collect();
    entry_of(
        EntryParts {
            key: &entry.key,
            value: &entry.value,
            secret: entry.secret,
            exported: entry.exported,
            unresolved,
            line: line.line,
            end_line: line.end_line,
        },
        Scope::Dotenv { kind },
        source.clone(),
        fingerprint,
    )
}

// ---- zsh -------------------------------------------------------------------------

fn collect_zsh(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    request: &ZshRequest,
    snapshot: &mut SourceSnapshot,
) {
    let layout = zsh::resolve(coordinator, home, request);
    for file in StartupFile::ALL {
        let reference = SourceRef::Zsh { file };
        let loaded = match zsh::read_startup_file(&layout, file, home).result {
            None => {
                snapshot
                    .failures
                    .push(failure(reference, ProblemKind::NotLocated));
                continue;
            }
            Some(Err(Problem::Outside)) => {
                snapshot
                    .failures
                    .push(failure(reference, ProblemKind::OutsideHome));
                continue;
            }
            Some(Err(Problem::Failed(FailureKind::NotFound))) => {
                snapshot.files.push(FileReport {
                    source: reference,
                    status: FileStatus::Absent,
                });
                continue;
            }
            Some(Err(Problem::Failed(kind))) => {
                snapshot.failures.push(failure(reference, kind.into()));
                continue;
            }
            Some(Ok(loaded)) => loaded,
        };
        let lines = zsh_parse::parse(&loaded.text);
        let mut occurrences: HashMap<&str, usize> = HashMap::new();
        for entry in lines.iter().flat_map(zsh_entries) {
            *occurrences.entry(entry.name.as_str()).or_default() += 1;
        }
        let scope = Scope::Zsh {
            file,
            applies_to: file.step().3,
        };
        let (mut entry_count, mut unrecognized_lines, mut dynamic_statements) = (0, 0, 0);
        for line in &lines {
            match &line.kind {
                ZshLineKind::Entries(entries) => {
                    for entry in entries {
                        entry_count += 1;
                        let repeated = occurrences.get(entry.name.as_str()).copied() > Some(1);
                        snapshot.entries.push(zsh_entry(
                            &reference,
                            scope,
                            &loaded.fingerprint,
                            line,
                            entry,
                            repeated,
                        ));
                    }
                }
                ZshLineKind::Dynamic(_) => dynamic_statements += 1,
                ZshLineKind::Unrecognized => unrecognized_lines += 1,
                ZshLineKind::Blank | ZshLineKind::Comment => {}
            }
        }
        snapshot.files.push(FileReport {
            source: reference,
            status: FileStatus::Read {
                fingerprint: loaded.fingerprint,
                entry_count,
                unrecognized_lines,
                dynamic_statements,
            },
        });
    }
}

fn zsh_entries(line: &ParsedLine) -> &[ZshEntry] {
    match &line.kind {
        ZshLineKind::Entries(entries) => entries,
        _ => &[],
    }
}

fn zsh_entry(
    source: &SourceRef,
    scope: Scope,
    fingerprint: &ContentFingerprint,
    line: &ParsedLine,
    entry: &ZshEntry,
    repeated: bool,
) -> SourceEntry {
    let mut unresolved = Vec::new();
    match (entry.state, entry.reason) {
        (ValueState::Static, _) => {}
        (ValueState::Reference, _) => unresolved.push(UnresolvedReason::Reference),
        (ValueState::Dynamic, Some(DynamicReason::CommandSubstitution)) => {
            unresolved.push(UnresolvedReason::CommandSubstitution);
        }
        (ValueState::Dynamic, reason) => unresolved.push(UnresolvedReason::Dynamic(reason)),
    }
    if entry.operation == Operation::Append {
        unresolved.push(UnresolvedReason::Append);
    }
    if repeated {
        unresolved.push(UnresolvedReason::DuplicateKey);
    }
    entry_of(
        EntryParts {
            key: &entry.name,
            value: &entry.value,
            secret: entry.secret,
            exported: entry.exported,
            unresolved,
            line: line.line,
            end_line: line.end_line,
        },
        scope,
        source.clone(),
        fingerprint,
    )
}

// ---- shared ---------------------------------------------------------------------------

struct EntryParts<'a> {
    key: &'a str,
    value: &'a str,
    secret: bool,
    exported: bool,
    unresolved: Vec<UnresolvedReason>,
    line: usize,
    end_line: usize,
}

fn entry_of(
    parts: EntryParts<'_>,
    scope: Scope,
    source: SourceRef,
    fingerprint: &ContentFingerprint,
) -> SourceEntry {
    let value_length = parts.value.chars().count();
    let inline = !parts.secret && value_length <= MAX_INLINE_CHARS;
    SourceEntry {
        key: parts.key.to_owned(),
        scope,
        source,
        secret: parts.secret,
        unresolved: parts.unresolved,
        exported: parts.exported,
        has_value: !parts.value.is_empty(),
        value_length,
        value: inline.then(|| parts.value.to_owned()),
        fingerprint: fingerprint.clone(),
        line: parts.line,
        end_line: parts.end_line,
    }
}

// ---- explicit value access ---------------------------------------------------------------

/// Returns the value of one entry, on explicit request. The source must be one
/// that `request` names (so a revoked authorization or an unrequested source
/// is refused), and the file is read again: a changed file is a conflict, not
/// a stale or wrong value. The value is never part of a list, log or error.
pub fn reveal_entry(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    request: &ProviderRequest,
    entry: &SourceEntry,
) -> Result<RevealedValue, AppError> {
    let not_requested = || AppError::permission_denied("该来源不在本次请求的授权范围内。");
    match &entry.source {
        SourceRef::Dotenv {
            grant_id,
            relative_path,
            ..
        } => {
            let source = request
                .dotenv
                .iter()
                .find(|source| source.grant.as_str() == grant_id)
                .ok_or_else(not_requested)?;
            super::reveal_value(
                coordinator,
                &source.grant,
                &RevealRequest {
                    file: FileRequest {
                        relative_path: relative_path.clone(),
                        config: source.config.clone(),
                    },
                    line: entry.line,
                    key: entry.key.clone(),
                },
                ScanLimits::default(),
            )
        }
        SourceRef::Zsh { file } => {
            let zsh_request = request.zsh.as_ref().ok_or_else(not_requested)?;
            zsh::reveal_value(
                coordinator,
                home,
                &ZshRevealRequest {
                    zsh: zsh_request.clone(),
                    file: *file,
                    line: entry.line,
                    name: entry.key.clone(),
                },
            )
        }
        SourceRef::DotenvDirectory { .. } => {
            Err(AppError::invalid_input("该引用不是一个条目来源。"))
        }
    }
}

#[cfg(test)]
#[path = "provider_tests.rs"]
mod tests;
