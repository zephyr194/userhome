//! Read-only view of the current user's zsh startup files (`.zshenv`,
//! `.zprofile`, `.zshrc`, `.zlogin`). The four files are built-in sources: the
//! frontend never names a path, the locations come from fixed file names plus
//! the canonical `$HOME` (or a statically determined `ZDOTDIR`), and every read
//! uses the bounded `grants::read_built_in` with the same `$HOME` rule as
//! authorizations. Files are parsed as text by `zsh_parse`; no shell is started
//! and nothing is sourced, evaluated or executed.
//!
//! Order and applicability come from the official zsh documentation
//! (https://zsh.sourceforge.io/Doc/Release/Files.html, consulted 2026-10-15):
//! `/etc/zshenv` and `$ZDOTDIR/.zshenv` are read by every zsh; then, for login
//! shells, `/etc/zprofile` and `$ZDOTDIR/.zprofile`; then, for interactive
//! shells, `/etc/zshrc` and `$ZDOTDIR/.zshrc`; then, for login shells,
//! `/etc/zlogin` and `$ZDOTDIR/.zlogin`. `ZDOTDIR` defaults to `$HOME`. Options
//! such as `NO_RCS` and dynamic configuration can change what really runs, so
//! this view is a static reading, not an evaluation.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    grants::{
        BuiltInReadError, ContentFingerprint, DEFAULT_MAX_READ_BYTES, GrantCoordinator, GrantId,
        GrantKind, GrantPurpose, read_built_in,
    },
};

use super::{
    FailureKind, RevealedValue, visible_text, zsh_parse,
    zsh_parse::{DynamicReason, LineKind, Operation, ParsedLine, ValueState, ZshEntry},
};

pub const SOURCE_URL: &str = "https://zsh.sourceforge.io/Doc/Release/Files.html";
pub const SOURCE_CONSULTED_ON: &str = "2026-10-15";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StartupFile {
    Zshenv,
    Zprofile,
    Zshrc,
    Zlogin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppliesTo {
    All,
    Login,
    Interactive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StepScope {
    System,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceNote {
    pub url: &'static str,
    pub consulted_on: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderStep {
    /// 1-based position in the documented reading order.
    pub position: u8,
    pub scope: StepScope,
    pub path_label: &'static str,
    pub applies_to: AppliesTo,
    /// The user file this step stands for; `None` for system-level steps.
    pub file: Option<StartupFile>,
    /// System-level files are only listed, never read.
    pub read_by_user_home: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UndeterminedReason {
    /// Assigned in a dynamic, conditional or unresolvable way.
    Dynamic,
    /// Assigned more than once.
    Multiple,
    /// A relative, empty, appended or otherwise unsupported form.
    UnsupportedForm,
    /// `~/.zshenv` could not be read, so its content is unknown.
    ZshenvNotRead,
    /// A literal path with a `..` segment: not normalized lexically, so it is
    /// neither taken as inside nor as outside `$HOME`.
    ParentSegment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ZdotdirView {
    /// Not assigned in `~/.zshenv`: zsh uses `$HOME`.
    Default,
    #[serde(rename_all = "camelCase")]
    Static { display_path: String, line: usize },
    /// A literal outside `$HOME`; its files are not read.
    #[serde(rename_all = "camelCase")]
    Outside { display_path: String, line: usize },
    #[serde(rename_all = "camelCase")]
    Selected { display_path: String },
    #[serde(rename_all = "camelCase")]
    Undetermined {
        reason: UndeterminedReason,
        /// Why a directory the user chose could not be used.
        selection_problem: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentView {
    pub text: String,
    pub state: ValueState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RowView {
    #[serde(rename_all = "camelCase")]
    Blank { line: usize },
    #[serde(rename_all = "camelCase")]
    Comment {
        line: usize,
        text: Option<String>,
        withheld: bool,
    },
    #[serde(rename_all = "camelCase")]
    Entry {
        line: usize,
        end_line: usize,
        name: String,
        exported: bool,
        operation: Operation,
        secret: bool,
        has_value: bool,
        value_length: usize,
        /// Present only for non-secret values of reasonable length.
        value: Option<String>,
        state: ValueState,
        reason: Option<DynamicReason>,
        path_segments: Option<Vec<SegmentView>>,
    },
    #[serde(rename_all = "camelCase")]
    Dynamic {
        line: usize,
        end_line: usize,
        reason: DynamicReason,
        text: Option<String>,
        withheld: bool,
    },
    #[serde(rename_all = "camelCase")]
    Unrecognized {
        line: usize,
        end_line: usize,
        text: Option<String>,
        withheld: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZshFileDetail {
    /// SHA-256 of the bytes that were read.
    pub content_hash: String,
    pub size_bytes: u64,
    pub line_count: usize,
    pub rows: Vec<RowView>,
    pub rows_truncated: bool,
    pub entry_count: usize,
    pub secret_count: usize,
    /// Dynamic statements plus entries whose value is dynamic.
    pub dynamic_count: usize,
    pub unrecognized_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ZshFileOutcome {
    Ready(ZshFileDetail),
    /// A read failure; a missing file is `NOT_FOUND`, never an empty file.
    Unavailable {
        reason: super::FailureKind,
        message: String,
    },
    /// The file resolves outside `$HOME` (or into a protected location) and
    /// was not read or followed.
    OutsideHome {
        message: String,
    },
    /// `ZDOTDIR` is undetermined, so the location is unknown.
    NotLocated {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZshFileView {
    pub file: StartupFile,
    pub name: &'static str,
    pub applies_to: AppliesTo,
    /// Position of the file in the reading order (see `OrderStep`).
    pub position: u8,
    pub display_path: Option<String>,
    pub outcome: ZshFileOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZshOverview {
    pub source: SourceNote,
    pub order: Vec<OrderStep>,
    pub zdotdir: ZdotdirView,
    pub files: Vec<ZshFileView>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ZshRequest {
    /// A directory authorization the user chose for an undetermined `ZDOTDIR`.
    pub zdotdir_grant: Option<GrantId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZshRevealRequest {
    pub zsh: ZshRequest,
    pub file: StartupFile,
    pub line: usize,
    pub name: String,
}

/// More rows than this are cut off (and reported) so one huge file cannot
/// flood the IPC channel.
const MAX_ROWS: usize = 5000;
/// Longer text is not sent with the list; values are fetched on demand.
const MAX_INLINE_CHARS: usize = 4096;

const ORDER: [(u8, StepScope, &str, AppliesTo, Option<StartupFile>); 8] = [
    (1, StepScope::System, "/etc/zshenv", AppliesTo::All, None),
    (
        2,
        StepScope::User,
        "~/.zshenv",
        AppliesTo::All,
        Some(StartupFile::Zshenv),
    ),
    (
        3,
        StepScope::System,
        "/etc/zprofile",
        AppliesTo::Login,
        None,
    ),
    (
        4,
        StepScope::User,
        "~/.zprofile",
        AppliesTo::Login,
        Some(StartupFile::Zprofile),
    ),
    (
        5,
        StepScope::System,
        "/etc/zshrc",
        AppliesTo::Interactive,
        None,
    ),
    (
        6,
        StepScope::User,
        "~/.zshrc",
        AppliesTo::Interactive,
        Some(StartupFile::Zshrc),
    ),
    (7, StepScope::System, "/etc/zlogin", AppliesTo::Login, None),
    (
        8,
        StepScope::User,
        "~/.zlogin",
        AppliesTo::Login,
        Some(StartupFile::Zlogin),
    ),
];

impl StartupFile {
    pub(super) const ALL: [Self; 4] = [Self::Zshenv, Self::Zprofile, Self::Zshrc, Self::Zlogin];

    pub(super) fn file_name(self) -> &'static str {
        match self {
            Self::Zshenv => ".zshenv",
            Self::Zprofile => ".zprofile",
            Self::Zshrc => ".zshrc",
            Self::Zlogin => ".zlogin",
        }
    }

    pub(super) fn step(
        self,
    ) -> &'static (u8, StepScope, &'static str, AppliesTo, Option<StartupFile>) {
        ORDER
            .iter()
            .find(|step| step.4 == Some(self))
            .expect("every startup file has a step")
    }
}

fn order_steps() -> Vec<OrderStep> {
    ORDER
        .iter()
        .map(
            |&(position, scope, path_label, applies_to, file)| OrderStep {
                position,
                scope,
                path_label,
                applies_to,
                file,
                read_by_user_home: scope == StepScope::User,
            },
        )
        .collect()
}

// ---- locating and reading ----------------------------------------------------

#[derive(Clone)]
pub(super) struct Loaded {
    pub(super) text: String,
    pub(super) content_hash: String,
    pub(super) size_bytes: u64,
    pub(super) fingerprint: ContentFingerprint,
}

/// Why a file was not read; `Outside` is not a read failure but a refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Problem {
    Outside,
    Failed(FailureKind),
}

/// One read through the same `$HOME` rule as authorizations. The size limit is
/// the default 1 MiB of CORE-5.
pub(super) fn load(path: &Path, home: Option<&Path>) -> Result<Loaded, Problem> {
    let read = read_built_in(path, home, DEFAULT_MAX_READ_BYTES).map_err(|error| match error {
        BuiltInReadError::Outside => Problem::Outside,
        BuiltInReadError::Failed(kind) => Problem::Failed(kind.into()),
    })?;
    let text = read
        .text()
        .map_err(|kind| Problem::Failed(kind.into()))?
        .to_owned();
    Ok(Loaded {
        text,
        content_hash: read.fingerprint.sha256.clone(),
        size_bytes: read.fingerprint.size,
        fingerprint: read.fingerprint,
    })
}

/// Where the three files after `.zshenv` live.
pub(super) enum Dir {
    Path(PathBuf),
    /// A literal `ZDOTDIR` outside `$HOME`; kept only to show what was refused.
    Outside(PathBuf),
    Unknown,
}

pub(super) struct Layout {
    pub(super) zdotdir: ZdotdirView,
    pub(super) zshenv: Result<Loaded, Problem>,
    pub(super) dir: Dir,
}

/// `$HOME` must be absolute, not the file system root, and free of NUL; the
/// canonical value is supplied by the caller.
pub(super) fn usable_home(home: Option<&Path>) -> Option<&Path> {
    home.filter(|home| {
        home.is_absolute()
            && home.parent().is_some()
            && home.to_str().is_some_and(|value| !value.contains('\0'))
    })
}

pub(super) fn display_path(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(relative) if relative.as_os_str().is_empty() => "~".to_owned(),
        Ok(relative) => format!("~/{}", relative.to_string_lossy()),
        Err(_) => path.to_string_lossy().into_owned(),
    }
}

/// What `~/.zshenv` says about `ZDOTDIR`, read statically.
enum Decision {
    Default,
    Literal { path: PathBuf, line: usize },
    Undetermined(UndeterminedReason),
}

/// Looks at `ZDOTDIR` in `~/.zshenv` text only. It is only determined by one
/// plain top-level literal assignment; any other mention (conditional, block,
/// function, `unset`, command substitution, variable reference) or a second
/// assignment makes it undetermined. The process environment is not consulted:
/// `/etc/zshenv` or the launching session may set `ZDOTDIR` too, which a
/// static reading of the user file cannot see.
fn decide(text: &str, home: &Path) -> Decision {
    let lines = zsh_parse::parse(text);
    let mut assignments = Vec::new();
    for line in &lines {
        match &line.kind {
            LineKind::Entries(entries) => {
                assignments.extend(
                    entries
                        .iter()
                        .filter(|entry| entry.name == "ZDOTDIR")
                        .map(|entry| (line.line, entry)),
                );
            }
            LineKind::Dynamic(_) | LineKind::Unrecognized if line.raw.contains("ZDOTDIR") => {
                return Decision::Undetermined(UndeterminedReason::Dynamic);
            }
            _ => {}
        }
    }
    let [(line, entry)] = assignments[..] else {
        return if assignments.is_empty() {
            Decision::Default
        } else {
            Decision::Undetermined(UndeterminedReason::Multiple)
        };
    };
    if entry.state == ValueState::Dynamic {
        return Decision::Undetermined(UndeterminedReason::Dynamic);
    }
    let unsupported = Decision::Undetermined(UndeterminedReason::UnsupportedForm);
    if entry.operation == Operation::Append {
        return unsupported;
    }
    let expanded = match entry.state {
        ValueState::Static => Some(entry.value.clone()),
        _ => home
            .to_str()
            .and_then(|home| zsh_parse::expand_home_literal(&entry.value, home)),
    };
    match expanded {
        // `..` is never folded away here: a lexical `starts_with` on such a
        // path says nothing about where the shell really ends up.
        Some(value) if value.starts_with('/') && value.split('/').any(|part| part == "..") => {
            Decision::Undetermined(UndeterminedReason::ParentSegment)
        }
        Some(value) if value.starts_with('/') => Decision::Literal {
            path: PathBuf::from(value),
            line,
        },
        _ => unsupported,
    }
}

const SELECTION_PROBLEM: &str = "所选目录的授权已失效或不是可用的目录授权，请重新选择。";

/// The directory behind a directory authorization the user chose. Grants are
/// already restricted to `$HOME` and re-validated on every use.
fn chosen_directory(coordinator: &GrantCoordinator, id: &GrantId) -> Result<PathBuf, ()> {
    let record = coordinator.resolve(id).map_err(|_| ())?;
    if record.purpose == GrantPurpose::ConfigDirectory && record.kind == GrantKind::Directory {
        Ok(record.path)
    } else {
        Err(())
    }
}

pub(super) fn resolve(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    request: &ZshRequest,
) -> Layout {
    let Some(home_dir) = usable_home(home) else {
        return Layout {
            zdotdir: ZdotdirView::Undetermined {
                reason: UndeterminedReason::ZshenvNotRead,
                selection_problem: None,
            },
            zshenv: Err(Problem::Failed(FailureKind::Excluded)),
            dir: Dir::Unknown,
        };
    };
    // `.zshenv` is read from `$HOME`: UserHome cannot know a `ZDOTDIR` that
    // was set before the shell started, and never reads its own environment.
    let zshenv = load(&home_dir.join(StartupFile::Zshenv.file_name()), home);
    let decision = match &zshenv {
        Ok(loaded) => decide(&loaded.text, home_dir),
        // No `~/.zshenv` means nothing there sets `ZDOTDIR`.
        Err(Problem::Failed(FailureKind::NotFound)) => Decision::Default,
        Err(_) => Decision::Undetermined(UndeterminedReason::ZshenvNotRead),
    };
    let (zdotdir, dir) = match decision {
        Decision::Default => (ZdotdirView::Default, Dir::Path(home_dir.to_path_buf())),
        Decision::Literal { path, line } if path.starts_with(home_dir) => (
            ZdotdirView::Static {
                display_path: display_path(&path, home_dir),
                line,
            },
            Dir::Path(path),
        ),
        Decision::Literal { path, line } => (
            ZdotdirView::Outside {
                display_path: path.to_string_lossy().into_owned(),
                line,
            },
            Dir::Outside(path),
        ),
        Decision::Undetermined(reason) => match request.zdotdir_grant.as_ref() {
            None => (
                ZdotdirView::Undetermined {
                    reason,
                    selection_problem: None,
                },
                Dir::Unknown,
            ),
            Some(id) => match chosen_directory(coordinator, id) {
                Ok(path) => (
                    ZdotdirView::Selected {
                        display_path: display_path(&path, home_dir),
                    },
                    Dir::Path(path),
                ),
                Err(()) => (
                    ZdotdirView::Undetermined {
                        reason,
                        selection_problem: Some(SELECTION_PROBLEM.to_owned()),
                    },
                    Dir::Unknown,
                ),
            },
        },
    };
    Layout {
        zdotdir,
        zshenv,
        dir,
    }
}

// ---- views ---------------------------------------------------------------------

pub(super) const OUTSIDE_MESSAGE: &str =
    "该文件解析到主目录之外（或指向受保护位置），未读取、未跟随。";
pub(super) const NOT_LOCATED_MESSAGE: &str =
    "ZDOTDIR 未确定，位置未知，未读取。请先选择 ZDOTDIR 所在目录。";

/// One startup file as read for a resolved layout.
pub(super) struct StartupRead {
    pub(super) display_path: Option<String>,
    /// `None` when `ZDOTDIR` is undetermined and the location is unknown.
    pub(super) result: Option<Result<Loaded, Problem>>,
}

pub(super) fn read_startup_file(
    layout: &Layout,
    file: StartupFile,
    home: Option<&Path>,
) -> StartupRead {
    let name = file.file_name();
    if file == StartupFile::Zshenv {
        return StartupRead {
            display_path: Some(format!("~/{name}")),
            result: Some(layout.zshenv.clone()),
        };
    }
    match &layout.dir {
        Dir::Path(dir) => {
            let path = dir.join(name);
            let shown = usable_home(home).map_or_else(
                || path.to_string_lossy().into_owned(),
                |h| display_path(&path, h),
            );
            StartupRead {
                display_path: Some(shown),
                result: Some(load(&path, home)),
            }
        }
        Dir::Outside(dir) => StartupRead {
            display_path: Some(dir.join(name).to_string_lossy().into_owned()),
            result: Some(Err(Problem::Outside)),
        },
        Dir::Unknown => StartupRead {
            display_path: None,
            result: None,
        },
    }
}

pub fn read_overview(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    request: &ZshRequest,
) -> ZshOverview {
    let layout = resolve(coordinator, home, request);
    let files = StartupFile::ALL
        .into_iter()
        .map(|file| {
            let read = read_startup_file(&layout, file, home);
            let outcome = match &read.result {
                Some(result) => outcome_of(result),
                None => ZshFileOutcome::NotLocated {
                    message: NOT_LOCATED_MESSAGE.to_owned(),
                },
            };
            ZshFileView {
                file,
                name: file.file_name(),
                applies_to: file.step().3,
                position: file.step().0,
                display_path: read.display_path,
                outcome,
            }
        })
        .collect();
    ZshOverview {
        source: SourceNote {
            url: SOURCE_URL,
            consulted_on: SOURCE_CONSULTED_ON,
        },
        order: order_steps(),
        zdotdir: layout.zdotdir,
        files,
    }
}

fn outcome_of(result: &Result<Loaded, Problem>) -> ZshFileOutcome {
    match result {
        Ok(loaded) => ZshFileOutcome::Ready(detail_of(loaded)),
        Err(Problem::Outside) => ZshFileOutcome::OutsideHome {
            message: OUTSIDE_MESSAGE.to_owned(),
        },
        Err(Problem::Failed(reason)) => ZshFileOutcome::Unavailable {
            reason: *reason,
            message: reason.message().to_owned(),
        },
    }
}

fn detail_of(loaded: &Loaded) -> ZshFileDetail {
    let lines = zsh_parse::parse(&loaded.text);
    let line_count = lines.last().map_or(0, |line| line.end_line);
    let rows: Vec<RowView> = lines.iter().flat_map(row_views).collect();
    let (mut entry_count, mut secret_count, mut dynamic_count, mut unrecognized_count) =
        (0, 0, 0, 0);
    for row in &rows {
        match row {
            RowView::Entry { secret, state, .. } => {
                entry_count += 1;
                secret_count += usize::from(*secret);
                dynamic_count += usize::from(*state == ValueState::Dynamic);
            }
            RowView::Dynamic { .. } => dynamic_count += 1,
            RowView::Unrecognized { .. } => unrecognized_count += 1,
            RowView::Blank { .. } | RowView::Comment { .. } => {}
        }
    }
    let rows_truncated = rows.len() > MAX_ROWS;
    ZshFileDetail {
        content_hash: loaded.content_hash.clone(),
        size_bytes: loaded.size_bytes,
        line_count,
        rows: rows.into_iter().take(MAX_ROWS).collect(),
        rows_truncated,
        entry_count,
        secret_count,
        dynamic_count,
        unrecognized_count,
    }
}

fn row_views(line: &ParsedLine) -> Vec<RowView> {
    match &line.kind {
        LineKind::Blank => vec![RowView::Blank { line: line.line }],
        LineKind::Comment => {
            let (text, withheld) = visible_text(&line.raw);
            vec![RowView::Comment {
                line: line.line,
                text,
                withheld,
            }]
        }
        LineKind::Dynamic(reason) => {
            let (text, withheld) = visible_text(&line.raw);
            vec![RowView::Dynamic {
                line: line.line,
                end_line: line.end_line,
                reason: *reason,
                text,
                withheld,
            }]
        }
        LineKind::Unrecognized => {
            let (text, withheld) = visible_text(&line.raw);
            vec![RowView::Unrecognized {
                line: line.line,
                end_line: line.end_line,
                text,
                withheld,
            }]
        }
        LineKind::Entries(entries) => entries.iter().map(|entry| entry_row(line, entry)).collect(),
    }
}

fn entry_row(line: &ParsedLine, entry: &ZshEntry) -> RowView {
    let value_length = entry.value.chars().count();
    let inline = !entry.secret && value_length <= MAX_INLINE_CHARS;
    RowView::Entry {
        line: line.line,
        end_line: line.end_line,
        name: entry.name.clone(),
        exported: entry.exported,
        operation: entry.operation,
        secret: entry.secret,
        has_value: !entry.value.is_empty(),
        value_length,
        value: inline.then(|| entry.value.clone()),
        state: entry.state,
        reason: entry.reason,
        path_segments: entry.segments.as_ref().filter(|_| inline).map(|segments| {
            segments
                .iter()
                .map(|segment| SegmentView {
                    text: segment.text.clone(),
                    state: segment.state,
                })
                .collect()
        }),
    }
}

// ---- revealing a value ------------------------------------------------------------

/// Returns the value of the entry at `request.line` named `request.name`, as
/// written (decoded for a static value). The file is read again, so a changed
/// file is a conflict rather than a stale or wrong value; the value is never
/// part of any list, log or error.
pub fn reveal_value(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    request: &ZshRevealRequest,
) -> Result<RevealedValue, AppError> {
    let layout = resolve(coordinator, home, &request.zsh);
    let loaded = match request.file {
        StartupFile::Zshenv => layout.zshenv,
        file => match layout.dir {
            Dir::Path(dir) => load(&dir.join(file.file_name()), home),
            Dir::Outside(_) => Err(Problem::Outside),
            Dir::Unknown => {
                return Err(AppError::conflict(
                    "ZDOTDIR 未确定，无法定位该文件，请先选择目录后重试。",
                ));
            }
        },
    }
    .map_err(|problem| match problem {
        Problem::Outside => AppError::permission_denied(OUTSIDE_MESSAGE),
        Problem::Failed(kind) => kind.app_error(),
    })?;
    zsh_parse::parse(&loaded.text)
        .into_iter()
        .filter(|line| line.line == request.line)
        .find_map(|line| match line.kind {
            LineKind::Entries(entries) => entries
                .into_iter()
                .find(|entry| entry.name == request.name)
                .map(|entry| RevealedValue { value: entry.value }),
            _ => None,
        })
        .ok_or_else(|| AppError::conflict("文件已变化或该项不存在，请重新加载后再试。"))
}

#[cfg(test)]
#[path = "zsh_tests.rs"]
mod tests;
