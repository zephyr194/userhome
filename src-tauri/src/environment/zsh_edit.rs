//! Editing the UserHome managed block of the user's zsh startup files.
//!
//! The four files stay built-in sources: the frontend never names a path. A
//! file is located from its fixed name plus the canonical `$HOME` (or a
//! statically determined / user-chosen `ZDOTDIR`), exactly as the read-only
//! view does. Writing needs an explicit "enable editing" per file, which creates
//! an ordinary `ConfigFile` authorization (an existing file, or a new file in an
//! existing parent — the parent may be `$HOME` itself) through the grant
//! coordinator's own creation API, so it is bound to `$HOME`, refuses symbolic
//! links that leave it, and is listed and revocable like any other grant. Every
//! later step finds that authorization again from the file, never from an id
//! supplied by the frontend.
//!
//! Text work lives in `zsh_block` (markers, literal quoting, PATH form,
//! read-back check). The save is the generic preview → confirm → write
//! transaction of `grants::write`: the preview binds target, content hash and
//! proposed content; confirming re-checks them, backs the file up first, writes
//! atomically and reads the bytes back — here with `zsh_block::verify`, which
//! demands that everything outside the markers is unchanged and that the
//! read-only zsh parser reads every managed line back as the exact literal; a
//! failure restores the previous content. The generic diff is always withheld
//! (it would show every line of the file, including secrets outside the block),
//! so the preview carries a diff of the managed lines only, with secret values
//! masked. Nothing is sourced, evaluated or executed, and the result only claims
//! that new shells may pick the change up.

use std::{collections::HashMap, fs, path::Path, path::PathBuf, sync::Mutex};

use serde::Serialize;

use crate::{
    error::AppError,
    grants::{
        ConfirmRequest, DEFAULT_MAX_READ_BYTES, GrantCoordinator, GrantError, GrantId,
        GrantPurpose, GrantRecord, ResourceWriteContext, ResourceWriteCoordinator,
        ResourceWriteExecution, ResourceWritePreview, WriteRequest,
    },
    operations::OperationStatus,
};

use super::{
    FailureKind, MAX_INLINE_CHARS,
    dotenv::{ChangeKind, value_looks_secret},
    visible_text,
    zsh::{
        AppliesTo, Dir, NOT_LOCATED_MESSAGE, OUTSIDE_MESSAGE, Problem, SegmentView, StartupFile,
        ZshRequest, display_path, load, resolve, usable_home,
    },
    zsh_block::{
        self, BEGIN_MARKER, BlockContent, BlockEdit, BlockProblem, BlockState, END_MARKER,
        EditError, ManagedBlock, VerifyError, normalize_path_item,
    },
    zsh_parse::{self, DynamicReason, LineKind, Operation, ValueState},
};

/// Said after every successful save, and nowhere claimed more broadly.
pub const EFFECT_NOTE: &str = "只修改了文件：不会 source，也不会执行任何命令。改动仅对之后新开的终端（新 shell）可能生效，不影响正在运行的进程、已打开的终端或图形界面应用。";
/// Previews waiting for a confirmation; the write layer bounds its own list.
const MAX_PENDING: usize = 64;
const MAX_OUTSIDE_ROWS: usize = 500;
const MAX_DIFF_LINES: usize = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZshEditTarget {
    pub zsh: ZshRequest,
    pub file: StartupFile,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZshEditPreviewRequest {
    pub target: ZshEditTarget,
    /// Hash of the content the caller was shown; `None` for a file that did not
    /// exist yet.
    pub expected_hash: Option<String>,
    pub edit: BlockEdit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZshEditExecuteRequest {
    pub target: ZshEditTarget,
    pub operation_id: String,
}

// ---- locating -----------------------------------------------------------------------

enum Location {
    Path(PathBuf),
    /// The file resolves outside `$HOME` (or into a protected location).
    Outside,
    NotLocated,
}

fn locate(coordinator: &GrantCoordinator, home: Option<&Path>, target: &ZshEditTarget) -> Location {
    let layout = resolve(coordinator, home, &target.zsh);
    let name = target.file.file_name();
    match (target.file, layout.dir) {
        (StartupFile::Zshenv, _) => usable_home(home).map_or(Location::NotLocated, |home_dir| {
            Location::Path(home_dir.join(name))
        }),
        (_, Dir::Path(dir)) => Location::Path(dir.join(name)),
        (_, Dir::Outside(_)) => Location::Outside,
        (_, Dir::Unknown) => Location::NotLocated,
    }
}

fn located(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    target: &ZshEditTarget,
) -> Result<PathBuf, AppError> {
    match locate(coordinator, home, target) {
        Location::Path(path) => Ok(path),
        Location::Outside => Err(AppError::permission_denied(OUTSIDE_MESSAGE)),
        Location::NotLocated => Err(AppError::conflict(NOT_LOCATED_MESSAGE)),
    }
}

/// The live `ShellStartupFile` authorization that stands for exactly `path`: a
/// file authorization for its canonical location, or a new-file authorization
/// for its name in its canonical parent. Anything revoked, moved, swapped for a
/// symbolic link or no longer valid is not found. A plain `ConfigFile`
/// authorization for the same file (made by an earlier version) is not one:
/// the general write commands can use it, so editing is never enabled by it.
fn find_grant(coordinator: &GrantCoordinator, path: &Path) -> Option<GrantRecord> {
    let name = path.file_name()?.to_str()?;
    let parent = fs::canonicalize(path.parent()?).ok()?;
    let canonical = fs::canonicalize(path).ok();
    coordinator
        .list()
        .ok()?
        .into_iter()
        .filter(|grant| grant.purpose == GrantPurpose::ShellStartupFile)
        .filter(|grant| match &grant.file_name {
            Some(file_name) => file_name == name && grant.path == parent,
            None => canonical.as_deref() == Some(grant.path.as_path()),
        })
        .find(|grant| coordinator.resolve_shell_startup(&grant.id).is_ok())
}

fn grant_error(error: GrantError) -> AppError {
    match error {
        GrantError::OutsideHome | GrantError::SymlinkEscape | GrantError::ProtectedLocation => {
            AppError::permission_denied(
                "该文件（或它的符号链接所指向的位置）不在主目录之内或属于受保护位置，已拒绝启用编辑。",
            )
        }
        GrantError::NotFound => AppError::not_found(
            "该文件所在的目录不存在；UserHome 不会创建目录，请先创建目录后重试。",
        ),
        other => AppError::from(other),
    }
}

// ---- state ----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableView {
    pub name: String,
    pub line: usize,
    pub secret: bool,
    pub has_value: bool,
    pub value_length: usize,
    /// Present only for non-secret values of reasonable length.
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProblemKind {
    MissingEnd,
    MissingBegin,
    WrongOrder,
    Nested,
    Duplicate,
    Unmanaged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BlockView {
    /// No block yet; the first save appends one at the end of the file.
    Absent,
    #[serde(rename_all = "camelCase")]
    Present {
        begin_line: usize,
        end_line: usize,
        variables: Vec<VariableView>,
        /// Normalized items (`$HOME/bin` for `~/bin`), in written order.
        path: Vec<String>,
    },
    /// The structure is damaged; structured editing is disabled.
    #[serde(rename_all = "camelCase")]
    Broken {
        kind: ProblemKind,
        line: usize,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutsideVariableView {
    pub name: String,
    pub line: usize,
    /// The assignment comes before the managed block (the block wins) or after
    /// it (the later assignment wins). Without a block, everything is before.
    pub before_block: bool,
    pub state: ValueState,
    pub secret: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutsidePathView {
    pub line: usize,
    pub before_block: bool,
    pub operation: Operation,
    pub state: ValueState,
    pub reason: Option<DynamicReason>,
    /// The items as the read-only parser sees them: never expanded, never
    /// rewritten; a dynamic item keeps its original text.
    pub segments: Vec<SegmentView>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicLineView {
    pub line: usize,
    pub before_block: bool,
    pub reason: Option<DynamicReason>,
    pub text: Option<String>,
    pub withheld: bool,
}

/// What the file says outside the block. Read-only: UserHome never changes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutsideView {
    pub variables: Vec<OutsideVariableView>,
    pub path: Vec<OutsidePathView>,
    /// Dynamic or unrecognized statements that mention PATH.
    pub dynamic_path_lines: Vec<DynamicLineView>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZshEditState {
    pub file: StartupFile,
    pub name: &'static str,
    pub applies_to: AppliesTo,
    /// Position in the documented reading order (see the read-only view).
    pub position: u8,
    pub display_path: String,
    pub full_path: String,
    pub exists: bool,
    /// Hash of the content that was read; `None` for a file that does not exist.
    pub content_hash: Option<String>,
    /// An authorization for exactly this file exists and is valid.
    pub enabled: bool,
    /// The authorization, so it can be revoked with the ordinary grant commands.
    pub grant_id: Option<GrantId>,
    pub block: BlockView,
    pub outside: OutsideView,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ZshEditOutcome {
    Ready(Box<ZshEditState>),
    Unavailable {
        reason: FailureKind,
        message: String,
    },
    OutsideHome {
        message: String,
    },
    NotLocated {
        message: String,
    },
}

struct OutsideEntry {
    name: String,
    line: usize,
    before_block: bool,
    operation: Operation,
    state: ValueState,
    reason: Option<DynamicReason>,
    secret: bool,
    segments: Option<Vec<SegmentView>>,
}

struct OutsideScan {
    entries: Vec<OutsideEntry>,
    dynamic_path_lines: Vec<DynamicLineView>,
}

fn is_path_name(name: &str) -> bool {
    matches!(name, "PATH" | "path")
}

fn mentions_path(raw: &str) -> bool {
    raw.contains("PATH") || raw.contains("path=") || raw.contains("path+=")
}

/// Statements outside the block, read with the read-only parser.
fn scan_outside(text: &str, block: Option<&ManagedBlock>) -> OutsideScan {
    let mut entries = Vec::new();
    let mut dynamic_path_lines = Vec::new();
    for line in zsh_parse::parse(text) {
        if block.is_some_and(|block| line.line >= block.begin_line && line.line <= block.end_line) {
            continue;
        }
        let before_block = block.is_none_or(|block| line.line < block.begin_line);
        match &line.kind {
            LineKind::Entries(parsed) => {
                entries.extend(parsed.iter().map(|entry| {
                    let inline = !entry.secret && entry.value.chars().count() <= MAX_INLINE_CHARS;
                    OutsideEntry {
                        name: entry.name.clone(),
                        line: line.line,
                        before_block,
                        operation: entry.operation,
                        state: entry.state,
                        reason: entry.reason,
                        secret: entry.secret,
                        segments: entry.segments.as_ref().filter(|_| inline).map(|segments| {
                            segments
                                .iter()
                                .map(|segment| SegmentView {
                                    text: segment.text.clone(),
                                    state: segment.state,
                                })
                                .collect()
                        }),
                    }
                }));
            }
            LineKind::Dynamic(reason) if mentions_path(&line.raw) => {
                let (text, withheld) = visible_text(&line.raw);
                dynamic_path_lines.push(DynamicLineView {
                    line: line.line,
                    before_block,
                    reason: Some(*reason),
                    text,
                    withheld,
                });
            }
            LineKind::Unrecognized if mentions_path(&line.raw) => {
                let (text, withheld) = visible_text(&line.raw);
                dynamic_path_lines.push(DynamicLineView {
                    line: line.line,
                    before_block,
                    reason: None,
                    text,
                    withheld,
                });
            }
            _ => {}
        }
    }
    OutsideScan {
        entries,
        dynamic_path_lines,
    }
}

fn outside_view(scan: &OutsideScan) -> OutsideView {
    let variables: Vec<OutsideVariableView> = scan
        .entries
        .iter()
        .filter(|entry| !is_path_name(&entry.name))
        .map(|entry| OutsideVariableView {
            name: entry.name.clone(),
            line: entry.line,
            before_block: entry.before_block,
            state: entry.state,
            secret: entry.secret,
        })
        .collect();
    let path: Vec<OutsidePathView> = scan
        .entries
        .iter()
        .filter(|entry| is_path_name(&entry.name))
        .map(|entry| OutsidePathView {
            line: entry.line,
            before_block: entry.before_block,
            operation: entry.operation,
            state: entry.state,
            reason: entry.reason,
            segments: entry.segments.clone().unwrap_or_default(),
        })
        .collect();
    let truncated = variables.len() > MAX_OUTSIDE_ROWS
        || path.len() > MAX_OUTSIDE_ROWS
        || scan.dynamic_path_lines.len() > MAX_OUTSIDE_ROWS;
    OutsideView {
        variables: variables.into_iter().take(MAX_OUTSIDE_ROWS).collect(),
        path: path.into_iter().take(MAX_OUTSIDE_ROWS).collect(),
        dynamic_path_lines: scan
            .dynamic_path_lines
            .iter()
            .take(MAX_OUTSIDE_ROWS)
            .cloned()
            .collect(),
        truncated,
    }
}

fn problem_view(problem: BlockProblem) -> (ProblemKind, usize) {
    match problem {
        BlockProblem::MissingEnd { begin_line } => (ProblemKind::MissingEnd, begin_line),
        BlockProblem::MissingBegin { end_line } => (ProblemKind::MissingBegin, end_line),
        BlockProblem::WrongOrder { end_line } => (ProblemKind::WrongOrder, end_line),
        BlockProblem::Nested { line } => (ProblemKind::Nested, line),
        BlockProblem::Duplicate { line } => (ProblemKind::Duplicate, line),
        BlockProblem::Unmanaged { line } => (ProblemKind::Unmanaged, line),
    }
}

fn block_view(state: &BlockState) -> BlockView {
    match state {
        BlockState::Absent => BlockView::Absent,
        BlockState::Broken(problem) => {
            let (kind, line) = problem_view(*problem);
            BlockView::Broken {
                kind,
                line,
                message: problem.message(),
            }
        }
        BlockState::Present(block) => BlockView::Present {
            begin_line: block.begin_line,
            end_line: block.end_line,
            variables: block
                .content
                .variables
                .iter()
                .zip(&block.variable_lines)
                .map(|(variable, line)| {
                    let secret = value_looks_secret(&variable.name, &variable.value);
                    let length = variable.value.chars().count();
                    VariableView {
                        name: variable.name.clone(),
                        line: *line,
                        secret,
                        has_value: !variable.value.is_empty(),
                        value_length: length,
                        value: (!secret && length <= MAX_INLINE_CHARS)
                            .then(|| variable.value.clone()),
                    }
                })
                .collect(),
            path: block.content.path.clone(),
        },
    }
}

fn block_of(state: &BlockState) -> Option<&ManagedBlock> {
    match state {
        BlockState::Present(block) => Some(block),
        _ => None,
    }
}

/// Reads one startup file for editing: the block, what the file says outside
/// it, and whether editing was enabled. Needs no authorization to look (the
/// read uses the same `$HOME` rule as the read-only view).
pub fn read_state(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    target: &ZshEditTarget,
) -> ZshEditOutcome {
    let path = match locate(coordinator, home, target) {
        Location::Path(path) => path,
        Location::Outside => {
            return ZshEditOutcome::OutsideHome {
                message: OUTSIDE_MESSAGE.to_owned(),
            };
        }
        Location::NotLocated => {
            return ZshEditOutcome::NotLocated {
                message: NOT_LOCATED_MESSAGE.to_owned(),
            };
        }
    };
    let (text, exists, content_hash) = match load(&path, home) {
        Ok(loaded) => (loaded.text, true, Some(loaded.content_hash)),
        Err(Problem::Failed(FailureKind::NotFound)) => (String::new(), false, None),
        Err(Problem::Outside) => {
            return ZshEditOutcome::OutsideHome {
                message: OUTSIDE_MESSAGE.to_owned(),
            };
        }
        Err(Problem::Failed(reason)) => {
            return ZshEditOutcome::Unavailable {
                reason,
                message: reason.message().to_owned(),
            };
        }
    };
    let state = zsh_block::inspect(&text);
    let outside = outside_view(&scan_outside(&text, block_of(&state)));
    let grant = find_grant(coordinator, &path);
    let shown = home.map_or_else(
        || path.to_string_lossy().into_owned(),
        |home_dir| display_path(&path, home_dir),
    );
    let step = target.file.step();
    ZshEditOutcome::Ready(Box::new(ZshEditState {
        file: target.file,
        name: target.file.file_name(),
        applies_to: step.3,
        position: step.0,
        display_path: shown,
        full_path: path.to_string_lossy().into_owned(),
        exists,
        content_hash,
        enabled: grant.is_some(),
        grant_id: grant.map(|record| record.id),
        block: block_view(&state),
        outside,
    }))
}

// ---- enabling editing ----------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZshEditEnabled {
    pub file: StartupFile,
    pub display_path: String,
    pub full_path: String,
    pub exists: bool,
    pub grant_id: GrantId,
}

/// Creates the authorization for exactly this file: a file authorization when
/// it exists, a new-file authorization (existing parent + the fixed name)
/// otherwise. Both carry the `ShellStartupFile` purpose, which only this
/// module's entry points can use; the general write commands refuse it. The path is built here from the fixed name and the canonical
/// `$HOME`; the grant coordinator applies its own `$HOME` rules to it.
pub fn enable(
    coordinator: &GrantCoordinator,
    home: Option<&Path>,
    target: &ZshEditTarget,
) -> Result<ZshEditEnabled, AppError> {
    let path = located(coordinator, home, target)?;
    let exists = fs::symlink_metadata(&path).is_ok();
    let record = if exists {
        coordinator.create(GrantPurpose::ShellStartupFile, &path)
    } else {
        let parent = path.parent().ok_or_else(AppError::internal)?;
        coordinator.create_new_file_with(
            GrantPurpose::ShellStartupFile,
            parent,
            target.file.file_name(),
        )
    }
    .map_err(grant_error)?;
    let shown = home.map_or_else(
        || path.to_string_lossy().into_owned(),
        |home_dir| display_path(&path, home_dir),
    );
    Ok(ZshEditEnabled {
        file: target.file,
        display_path: shown,
        full_path: record.target_path().to_string_lossy().into_owned(),
        exists,
        grant_id: record.id,
    })
}

// ---- preview ------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BlockDiffKind {
    Added,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDiffLine {
    pub kind: BlockDiffKind,
    pub text: String,
}

/// One variable-level change; secret entries never carry text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableChangeView {
    pub name: String,
    pub change: ChangeKind,
    pub secret: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    /// A non-secret value was left out because it is too long to show.
    pub omitted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathChangeView {
    pub before: Vec<String>,
    pub after: Vec<String>,
}

/// Something the user should know before confirming. None of them blocks the
/// save; none carries a value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum EditWarning {
    /// A same-named assignment earlier in the file is overridden by the block.
    OverridesEarlierAssignment { name: String, line: usize },
    /// A same-named assignment after the block overrides the block's value.
    OverriddenByLaterAssignment { name: String, line: usize },
    /// The same PATH item appears more than once in the managed list.
    DuplicatePathItem { item: String },
    /// A static PATH item outside the block already contains this item.
    PathItemAlsoOutside { item: String, line: usize },
    /// A PATH assignment outside the block is dynamic or unrecognized: it is
    /// shown as written, never expanded or rewritten, and the managed items are
    /// simply put in front of whatever it produces.
    DynamicPathOutside { line: usize },
    /// A plain `PATH=`/`path=` assignment after the block replaces the PATH
    /// the block built.
    LaterPathAssignment { line: usize },
    /// The managed block is created at the end of the file.
    BlockAppended,
    /// The file does not exist and is created (owner-only, no recovery point).
    FileCreated,
    /// The variable changes how the shell or the dynamic loader behaves
    /// (`IFS`, `ZDOTDIR`, `BASH_ENV`, `ENV`, `PROMPT_COMMAND`, `DYLD_*`,
    /// `LD_*`). Not refused; shown so the user decides knowingly.
    SensitiveVariable { name: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZshEditPreview {
    #[serde(flatten)]
    pub write: ResourceWritePreview,
    pub file: StartupFile,
    pub applies_to: AppliesTo,
    pub position: u8,
    pub display_path: String,
    /// The complete path that will be written (where a symbolic link leads).
    pub full_path: String,
    pub created_block: bool,
    pub variable_changes: Vec<VariableChangeView>,
    pub path_change: Option<PathChangeView>,
    /// The managed lines before and after, secrets masked. The block markers
    /// are part of it when the block is created.
    pub block_diff: Vec<BlockDiffLine>,
    pub warnings: Vec<EditWarning>,
    pub effect_note: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZshEditExecution {
    #[serde(flatten)]
    pub execution: ResourceWriteExecution,
    pub file: StartupFile,
    pub effect_note: &'static str,
}

struct PendingZshEdit {
    grant_id: GrantId,
    file: StartupFile,
    /// The content the edit was computed from (may hold secrets; never printed).
    original: String,
    desired: BlockContent,
}

#[derive(Default)]
pub struct ZshEditCoordinator {
    state: Mutex<HashMap<String, PendingZshEdit>>,
}

fn edit_error(error: &EditError) -> AppError {
    let message = error.message();
    match error {
        EditError::Block(_) | EditError::NotManaged(_) => AppError::validation_failed(&message),
        _ => AppError::invalid_input(&message),
    }
}

fn verify_error(error: &VerifyError) -> AppError {
    let detail = match error {
        VerifyError::NotText => "写入的内容不是有效的 UTF-8 文本".to_owned(),
        VerifyError::BlockMissing | VerifyError::BlockBroken(_) => {
            "专用块的结构读回后不完整".to_owned()
        }
        VerifyError::ContentMismatch => "专用块读回后与预期内容不一致".to_owned(),
        VerifyError::OutsideChanged => "专用块之外的内容发生了变化".to_owned(),
        VerifyError::ReadBackMismatch(name) if name == "?" || name == "PATH" => {
            "PATH 或块内行读回后与预期不一致".to_owned()
        }
        VerifyError::ReadBackMismatch(name) => format!("变量 {name} 读回后与预期不一致"),
    };
    AppError::validation_failed(&format!("读回校验未通过（{detail}）。"))
}

fn view_of(change: &zsh_block::VarChange) -> VariableChangeView {
    let shown = |value: &Option<String>| match value {
        Some(text) if !change.secret => {
            if text.chars().count() <= MAX_INLINE_CHARS {
                (Some(text.clone()), false)
            } else {
                (None, true)
            }
        }
        _ => (None, false),
    };
    let (before, before_omitted) = shown(&change.before);
    let (after, after_omitted) = shown(&change.after);
    VariableChangeView {
        name: change.name.clone(),
        change: change.kind,
        secret: change.secret,
        before,
        after,
        omitted: before_omitted || after_omitted,
    }
}

/// The managed lines that disappear and appear, in order; with the markers when
/// the whole block is new.
fn block_diff(applied: &zsh_block::Applied) -> Vec<BlockDiffLine> {
    let mut lines = Vec::new();
    let mut push = |kind, text: &str| {
        if lines.len() < MAX_DIFF_LINES {
            lines.push(BlockDiffLine {
                kind,
                text: text.to_owned(),
            });
        }
    };
    if applied.created_block {
        push(BlockDiffKind::Added, BEGIN_MARKER);
    }
    for line in &applied.before_lines {
        if !applied.after_lines.contains(line) {
            push(BlockDiffKind::Removed, line);
        }
    }
    for line in &applied.after_lines {
        if !applied.before_lines.contains(line) {
            push(BlockDiffKind::Added, line);
        }
    }
    if applied.created_block {
        push(BlockDiffKind::Added, END_MARKER);
    }
    lines
}

/// Variables that change how the shell, a child shell or the dynamic loader
/// behaves. Names are compared exactly as the shell does (case-sensitive);
/// `DYLD_` and `LD_` are prefixes.
fn is_sensitive_name(name: &str) -> bool {
    matches!(
        name,
        "IFS" | "ZDOTDIR" | "BASH_ENV" | "ENV" | "PROMPT_COMMAND"
    ) || name.starts_with("DYLD_")
        || name.starts_with("LD_")
}

fn warnings_for(
    applied: &zsh_block::Applied,
    scan: &OutsideScan,
    new_file: bool,
) -> Vec<EditWarning> {
    let mut warnings = Vec::new();
    if new_file {
        warnings.push(EditWarning::FileCreated);
    }
    if applied.created_block {
        warnings.push(EditWarning::BlockAppended);
    }
    for change in &applied.variable_changes {
        if change.kind == ChangeKind::Remove {
            continue;
        }
        if is_sensitive_name(&change.name) {
            warnings.push(EditWarning::SensitiveVariable {
                name: change.name.clone(),
            });
        }
        for entry in scan
            .entries
            .iter()
            .filter(|entry| entry.name == change.name && !is_path_name(&entry.name))
        {
            warnings.push(if entry.before_block {
                EditWarning::OverridesEarlierAssignment {
                    name: change.name.clone(),
                    line: entry.line,
                }
            } else {
                EditWarning::OverriddenByLaterAssignment {
                    name: change.name.clone(),
                    line: entry.line,
                }
            });
        }
    }
    if applied.path_change.is_some() && !applied.desired.path.is_empty() {
        let mut seen: Vec<&String> = Vec::new();
        for item in &applied.desired.path {
            if seen.contains(&item) {
                if !warnings.iter().any(
                    |warning| matches!(warning, EditWarning::DuplicatePathItem { item: seen } if seen == item),
                ) {
                    warnings.push(EditWarning::DuplicatePathItem { item: item.clone() });
                }
            } else {
                seen.push(item);
            }
            for entry in scan
                .entries
                .iter()
                .filter(|entry| is_path_name(&entry.name))
            {
                let present = entry.segments.iter().flatten().any(|segment| {
                    segment.state != ValueState::Dynamic
                        && normalize_path_item(&segment.text).as_deref() == Ok(item.as_str())
                });
                if present {
                    warnings.push(EditWarning::PathItemAlsoOutside {
                        item: item.clone(),
                        line: entry.line,
                    });
                }
            }
        }
        for entry in scan
            .entries
            .iter()
            .filter(|entry| is_path_name(&entry.name))
        {
            if entry.state == ValueState::Dynamic {
                warnings.push(EditWarning::DynamicPathOutside { line: entry.line });
            }
            if !entry.before_block && entry.operation == Operation::Set {
                warnings.push(EditWarning::LaterPathAssignment { line: entry.line });
            }
        }
        for line in &scan.dynamic_path_lines {
            warnings.push(EditWarning::DynamicPathOutside { line: line.line });
        }
    }
    warnings
}

impl ZshEditCoordinator {
    pub fn preview(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        home: Option<&Path>,
        request: &ZshEditPreviewRequest,
    ) -> Result<ZshEditPreview, AppError> {
        let path = located(ctx.grants, home, &request.target)?;
        let record = find_grant(ctx.grants, &path).ok_or_else(|| {
            AppError::permission_denied("尚未对该文件启用编辑，请先点击“启用编辑”并确认目标路径。")
        })?;
        let (original, content_hash) =
            match ctx
                .grants
                .read_shell_startup_with_limit(&record.id, None, DEFAULT_MAX_READ_BYTES)
            {
                Ok(read) => (
                    read.text()
                        .map_err(|kind| FailureKind::from(kind).app_error())?
                        .to_owned(),
                    Some(read.fingerprint.sha256.clone()),
                ),
                Err(crate::grants::ReadError::NotFound) => (String::new(), None),
                Err(error) => return Err(FailureKind::from(error).app_error()),
            };
        if content_hash != request.expected_hash {
            return Err(AppError::conflict(
                "文件在你查看之后已发生变化，请重新加载后再编辑。",
            ));
        }
        let applied = zsh_block::apply(&original, &request.edit).map_err(|e| edit_error(&e))?;
        if applied.is_empty() {
            return Err(AppError::invalid_input("没有需要保存的改动。"));
        }
        // The same check that follows the write, on the proposed bytes: a value the
        // parser would not read back exactly is refused before anything is shown.
        zsh_block::verify(&original, applied.text.as_bytes(), &applied.desired)
            .map_err(|e| verify_error(&e))?;

        self.prune(ctx)?;
        if self.state.lock().map_err(|_| AppError::internal())?.len() >= MAX_PENDING {
            return Err(AppError::conflict(
                "等待确认的预览过多，请先确认或等待过期。",
            ));
        }
        // Anything the history might ever echo is masked, whatever its source.
        ctx.operations.register_sensitive_values(
            applied
                .variable_changes
                .iter()
                .filter(|change| change.secret)
                .flat_map(|change| [change.before.clone(), change.after.clone()])
                .flatten(),
        )?;

        let state = zsh_block::inspect(&original);
        let scan = scan_outside(&original, block_of(&state));
        let warnings = warnings_for(&applied, &scan, content_hash.is_none());
        let diff = block_diff(&applied);
        let step = writes
            .preview_shell_startup(
                ctx,
                vec![WriteRequest {
                    grant_id: record.id.clone(),
                    relative: None,
                    expected_sha256: content_hash,
                    content: applied.text.clone(),
                    sensitive: true,
                }],
            )?
            .steps
            .into_iter()
            .next()
            .ok_or_else(AppError::internal)?;
        let shown = home.map_or_else(
            || path.to_string_lossy().into_owned(),
            |home_dir| display_path(&path, home_dir),
        );
        let file_step = request.target.file.step();
        let preview = ZshEditPreview {
            write: step,
            file: request.target.file,
            applies_to: file_step.3,
            position: file_step.0,
            display_path: shown,
            full_path: record.target_path().to_string_lossy().into_owned(),
            created_block: applied.created_block,
            variable_changes: applied.variable_changes.iter().map(view_of).collect(),
            path_change: applied.path_change.as_ref().map(|change| PathChangeView {
                before: change.before.clone(),
                after: change.after.clone(),
            }),
            block_diff: diff,
            warnings,
            effect_note: EFFECT_NOTE,
        };
        self.state.lock().map_err(|_| AppError::internal())?.insert(
            preview.write.operation.operation_id.clone(),
            PendingZshEdit {
                grant_id: record.id,
                file: request.target.file,
                original,
                desired: applied.desired,
            },
        );
        Ok(preview)
    }

    /// Confirms a previewed edit. `Err` means nothing was changed; `Ok` carries
    /// the transaction outcome, which says exactly what the target contains.
    pub fn execute(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        home: Option<&Path>,
        request: &ZshEditExecuteRequest,
    ) -> Result<ZshEditExecution, AppError> {
        let path = located(ctx.grants, home, &request.target)?;
        // A swapped target (symbolic link, replaced directory, revoked
        // authorization) no longer has an authorization of its own.
        let record = find_grant(ctx.grants, &path).ok_or_else(|| {
            AppError::conflict("该文件的编辑授权已失效或目标已变化，请重新预览。")
        })?;
        let pending = {
            let mut state = self.state.lock().map_err(|_| AppError::internal())?;
            let pending = state
                .remove(&request.operation_id)
                .ok_or_else(AppError::operation_not_found)?;
            if pending.grant_id != record.id || pending.file != request.target.file {
                // The preview stays usable for the target it was made for.
                state.insert(request.operation_id.clone(), pending);
                return Err(AppError::operation_mismatch());
            }
            pending
        };
        // Whatever happens next consumes the preview.
        let execution = writes.execute_shell_startup(
            ctx,
            &ConfirmRequest {
                operation_id: request.operation_id.clone(),
                grant_id: record.id,
                relative: None,
            },
            |written| {
                zsh_block::verify(&pending.original, written, &pending.desired)
                    .map_err(|e| verify_error(&e))
            },
        )?;
        Ok(ZshEditExecution {
            execution,
            file: request.target.file,
            effect_note: EFFECT_NOTE,
        })
    }

    /// Drops previews that can no longer be confirmed (expired, consumed).
    fn prune(&self, ctx: &ResourceWriteContext<'_>) -> Result<(), AppError> {
        let mut state = self.state.lock().map_err(|_| AppError::internal())?;
        state.retain(|operation_id, _| {
            ctx.operations
                .get(operation_id)
                .is_ok_and(|details| details.status == OperationStatus::Previewed)
        });
        Ok(())
    }
}

#[cfg(test)]
#[path = "zsh_edit_tests.rs"]
mod tests;
