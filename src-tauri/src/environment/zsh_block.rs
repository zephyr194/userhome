//! The UserHome managed block of a zsh startup file, as pure text
//! transformations: nothing here touches the file system, starts a shell or
//! evaluates anything.
//!
//! A block is delimited by two fixed marker lines and holds only lines UserHome
//! generates itself:
//!
//! ```text
//! # >>> UserHome managed block (zsh) >>>
//! export NAME='literal'
//! export path=('/opt/tool/bin' "$HOME"/'bin' $path)
//! # <<< UserHome managed block (zsh) <<<
//! ```
//!
//! * Every value is a shell single-quoted literal (`'` is written `'\''`), so no
//!   quote, `$`, backtick, `;`, `&`, `|`, `\` or non-ASCII character can ever be
//!   read as syntax. Values with a newline, NUL, other control or invisible
//!   direction characters are refused instead of encoded.
//! * `PATH` is written through zsh's tied array: `export path=(… $path)`. The
//!   managed items come first and the PATH that existed before is kept as it
//!   is; because `$path` is an array, an empty or unset PATH can never produce
//!   an empty segment (an empty PATH entry means the current directory). The
//!   string form `PATH='a':"$PATH"` would. Items starting with `~` or `$HOME`
//!   are written `"$HOME"/'rest'` (the one expansion of a known variable); all
//!   other items must be absolute and stay single-quoted literals.
//! * Bytes outside the markers are never touched: a block that does not exist
//!   yet is appended after the existing bytes; an existing block is replaced
//!   between its two marker lines, which stay verbatim. Line endings inside the
//!   block follow the begin marker (or the file's first line ending).
//! * A damaged structure (missing marker, duplicate or nested blocks, wrong
//!   order) or a hand-edited body is reported and never repaired.

use std::fmt;

use super::{
    dotenv::{
        ChangeKind, MAX_EDIT_VALUE_CHARS, is_forbidden_character, is_valid_key, value_looks_secret,
    },
    zsh_parse::{self, LineKind, Operation, ValueState},
};

pub const BEGIN_MARKER: &str = "# >>> UserHome managed block (zsh) >>>";
pub const END_MARKER: &str = "# <<< UserHome managed block (zsh) <<<";

pub const MAX_VARIABLES: usize = 128;
pub const MAX_PATH_ITEMS: usize = 64;
const MAX_NAME_CHARS: usize = 255;
const MAX_PATH_ITEM_CHARS: usize = 1024;
/// Shown in place of a secret value wherever block lines are displayed.
pub const MASK: &str = "••••••";

// ---- model -----------------------------------------------------------------------

#[derive(Clone, PartialEq, Eq)]
pub struct ManagedVariable {
    pub name: String,
    pub value: String,
}

// Values may be secrets: `Debug` shows only the length.
impl fmt::Debug for ManagedVariable {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedVariable")
            .field("name", &self.name)
            .field("value_len", &self.value.chars().count())
            .finish()
    }
}

/// What a block says: literal variables in written order and the PATH items
/// (normalized: absolute, or starting with `$HOME`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlockContent {
    pub variables: Vec<ManagedVariable>,
    pub path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedBlock {
    pub content: BlockContent,
    /// 1-based line of each variable, in `content.variables` order.
    pub variable_lines: Vec<usize>,
    pub path_line: Option<usize>,
    pub begin_line: usize,
    pub end_line: usize,
    /// Byte offset just after the begin marker line (and its terminator).
    pub body_start: usize,
    /// Byte offset of the end marker line.
    pub body_end: usize,
    pub eol: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockProblem {
    /// A begin marker without its end marker.
    MissingEnd { begin_line: usize },
    /// An end marker without a begin marker before it.
    MissingBegin { end_line: usize },
    /// The end marker comes before the begin marker.
    WrongOrder { end_line: usize },
    /// A second begin marker before the first block was closed.
    Nested { line: usize },
    /// More than one complete block.
    Duplicate { line: usize },
    /// A line inside the block that UserHome did not generate.
    Unmanaged { line: usize },
}

impl BlockProblem {
    pub fn message(self) -> String {
        match self {
            Self::MissingEnd { begin_line } => {
                format!("第 {begin_line} 行有开始标记，但找不到对应的结束标记。")
            }
            Self::MissingBegin { end_line } => {
                format!("第 {end_line} 行有结束标记，但它之前没有开始标记。")
            }
            Self::WrongOrder { end_line } => {
                format!("第 {end_line} 行的结束标记出现在开始标记之前。")
            }
            Self::Nested { line } => {
                format!("第 {line} 行的开始标记出现在上一个块结束之前（嵌套）。")
            }
            Self::Duplicate { line } => format!("第 {line} 行起存在第二个专用块。"),
            Self::Unmanaged { line } => format!(
                "块内第 {line} 行不是 UserHome 生成的变量或 PATH 行（可能被手工修改，或变量/PATH 重复）。"
            ),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlockState {
    Absent,
    Present(ManagedBlock),
    Broken(BlockProblem),
}

// ---- inspecting ------------------------------------------------------------------

struct Line<'a> {
    start: usize,
    number: usize,
    text: &'a str,
    terminator: &'a str,
}

fn split_lines(text: &str) -> Vec<Line<'_>> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (index, piece) in text.split_inclusive('\n').enumerate() {
        let (body, terminator) = match piece.strip_suffix("\r\n") {
            Some(body) => (body, "\r\n"),
            None => match piece.strip_suffix('\n') {
                Some(body) => (body, "\n"),
                None => (piece, ""),
            },
        };
        lines.push(Line {
            start,
            number: index + 1,
            text: body,
            terminator,
        });
        start += piece.len();
    }
    lines
}

fn marker_of(line: &Line<'_>) -> Option<bool> {
    // A byte order mark in front of the first line is not part of its text.
    let text = if line.number == 1 {
        line.text.trim_start_matches('\u{feff}')
    } else {
        line.text
    };
    match text.trim() {
        BEGIN_MARKER => Some(true),
        END_MARKER => Some(false),
        _ => None,
    }
}

pub fn inspect(text: &str) -> BlockState {
    let lines = split_lines(text);
    let markers: Vec<(usize, bool)> = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| marker_of(line).map(|begin| (index, begin)))
        .collect();
    let mut open: Option<usize> = None;
    let mut complete: Option<(usize, usize)> = None;
    for (position, &(index, is_begin)) in markers.iter().enumerate() {
        let number = lines[index].number;
        match (is_begin, open) {
            (true, None) => {
                if complete.is_some() {
                    return BlockState::Broken(BlockProblem::Duplicate { line: number });
                }
                open = Some(index);
            }
            (true, Some(_)) => return BlockState::Broken(BlockProblem::Nested { line: number }),
            (false, Some(begin)) => {
                complete = Some((begin, index));
                open = None;
            }
            (false, None) => {
                let later_begin = markers[position + 1..].iter().any(|&(_, begin)| begin);
                return BlockState::Broken(if later_begin {
                    BlockProblem::WrongOrder { end_line: number }
                } else if complete.is_some() {
                    BlockProblem::Duplicate { line: number }
                } else {
                    BlockProblem::MissingBegin { end_line: number }
                });
            }
        }
    }
    if let Some(begin) = open {
        return BlockState::Broken(BlockProblem::MissingEnd {
            begin_line: lines[begin].number,
        });
    }
    let Some((begin, end)) = complete else {
        return BlockState::Absent;
    };
    parse_body(&lines, begin, end)
}

fn parse_body(lines: &[Line<'_>], begin: usize, end: usize) -> BlockState {
    let begin_line = &lines[begin];
    let eol = if begin_line.terminator == "\r\n" {
        "\r\n"
    } else {
        "\n"
    };
    let mut content = BlockContent::default();
    let mut variable_lines = Vec::new();
    let mut path_line = None;
    for line in &lines[begin + 1..end] {
        let unmanaged = BlockState::Broken(BlockProblem::Unmanaged { line: line.number });
        if let Some(items) = parse_path_line(line.text) {
            if path_line.is_some() {
                return unmanaged;
            }
            content.path = items;
            path_line = Some(line.number);
        } else if let Some((name, value)) = parse_variable_line(line.text) {
            if content
                .variables
                .iter()
                .any(|variable| variable.name == name)
            {
                return unmanaged;
            }
            content.variables.push(ManagedVariable { name, value });
            variable_lines.push(line.number);
        } else {
            return unmanaged;
        }
    }
    if content.variables.len() > MAX_VARIABLES || content.path.len() > MAX_PATH_ITEMS {
        return BlockState::Broken(BlockProblem::Unmanaged {
            line: begin_line.number,
        });
    }
    BlockState::Present(ManagedBlock {
        content,
        variable_lines,
        path_line,
        begin_line: begin_line.number,
        end_line: lines[end].number,
        body_start: begin_line.start + begin_line.text.len() + begin_line.terminator.len(),
        body_end: lines[end].start,
        eol,
    })
}

// ---- rendering and strict parsing of generated lines -------------------------------

/// `'literal'`, with every `'` written as `'\''`.
pub fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Decodes one quoted literal at the start of `input` and returns the rest.
fn parse_literal(input: &str) -> Option<(String, &str)> {
    let mut rest = input.strip_prefix('\'')?;
    let mut value = String::new();
    loop {
        let end = rest.find('\'')?;
        value.push_str(&rest[..end]);
        rest = &rest[end + 1..];
        match rest.strip_prefix("\\''") {
            Some(after) => {
                value.push('\'');
                rest = after;
            }
            None => return Some((value, rest)),
        }
    }
}

fn is_reserved_name(name: &str) -> bool {
    matches!(name, "PATH" | "path")
}

fn variable_line(variable: &ManagedVariable, masked: bool) -> String {
    let shown = if masked && value_looks_secret(&variable.name, &variable.value) {
        format!("'{MASK}'")
    } else {
        quote(&variable.value)
    };
    format!("export {}={shown}", variable.name)
}

fn parse_variable_line(line: &str) -> Option<(String, String)> {
    let (name, rest) = line.strip_prefix("export ")?.split_once('=')?;
    if !is_valid_key(name) || name.chars().count() > MAX_NAME_CHARS || is_reserved_name(name) {
        return None;
    }
    let (value, tail) = parse_literal(rest)?;
    tail.is_empty().then(|| (name.to_owned(), value))
}

fn path_item_text(item: &str) -> String {
    match item.strip_prefix("$HOME") {
        Some("") => "\"$HOME\"".to_owned(),
        Some(rest) => format!(
            "\"$HOME\"/{}",
            quote(rest.strip_prefix('/').unwrap_or(rest))
        ),
        None => quote(item),
    }
}

fn path_line(items: &[String]) -> String {
    let mut parts: Vec<String> = items.iter().map(|item| path_item_text(item)).collect();
    parts.push("$path".to_owned());
    format!("export path=({})", parts.join(" "))
}

fn parse_path_line(line: &str) -> Option<Vec<String>> {
    let mut rest = line.strip_prefix("export path=(")?.strip_suffix(')')?;
    let mut items = Vec::new();
    loop {
        if rest == "$path" {
            return (!items.is_empty()).then_some(items);
        }
        let (item, tail) = if let Some(after) = rest.strip_prefix("\"$HOME\"") {
            match after.strip_prefix('/') {
                Some(literal) => {
                    let (text, tail) = parse_literal(literal)?;
                    (format!("$HOME/{text}"), tail)
                }
                None => ("$HOME".to_owned(), after),
            }
        } else {
            // A quoted literal is an absolute path; `'$HOME/x'` would be a
            // different thing from the `"$HOME"/'x'` the editor writes.
            let (text, tail) = parse_literal(rest)?;
            text.starts_with('/').then_some(())?;
            (text, tail)
        };
        // Only text the editor itself would produce counts as managed.
        if normalize_path_item(&item).as_deref() != Ok(item.as_str()) {
            return None;
        }
        items.push(item);
        rest = tail.strip_prefix(' ')?;
    }
}

/// The lines a block holds, in order. With `masked`, secret values (by the
/// name/URL heuristic) are replaced so the lines are safe to display.
pub fn render_lines(content: &BlockContent, masked: bool) -> Vec<String> {
    let mut lines: Vec<String> = content
        .variables
        .iter()
        .map(|variable| variable_line(variable, masked))
        .collect();
    if !content.path.is_empty() {
        lines.push(path_line(&content.path));
    }
    lines
}

// ---- validation ------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueProblem {
    /// A newline, NUL, tab, other control character or invisible direction or
    /// line-separator character.
    ControlCharacter,
    TooLong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathProblem {
    Empty,
    /// Items are separated by `:`, so an item cannot contain one.
    Colon,
    SurroundingSpace,
    ControlCharacter,
    TooLong,
    /// Not absolute and not starting with `~` or `$HOME`: a relative item
    /// would depend on the current directory.
    NotAbsolute,
}

pub fn check_value(value: &str) -> Result<(), ValueProblem> {
    if value.chars().any(is_forbidden_character) {
        return Err(ValueProblem::ControlCharacter);
    }
    if value.chars().count() > MAX_EDIT_VALUE_CHARS {
        return Err(ValueProblem::TooLong);
    }
    Ok(())
}

/// The stored form of one PATH item: `~` and `${HOME}` become `$HOME`, the
/// rest must be an absolute literal path.
pub fn normalize_path_item(item: &str) -> Result<String, PathProblem> {
    if item.is_empty() {
        return Err(PathProblem::Empty);
    }
    if item.chars().any(is_forbidden_character) {
        return Err(PathProblem::ControlCharacter);
    }
    if item.trim() != item {
        return Err(PathProblem::SurroundingSpace);
    }
    if item.contains(':') {
        return Err(PathProblem::Colon);
    }
    if item.chars().count() > MAX_PATH_ITEM_CHARS {
        return Err(PathProblem::TooLong);
    }
    for prefix in ["~", "$HOME", "${HOME}"] {
        if let Some(rest) = item.strip_prefix(prefix)
            && (rest.is_empty() || rest.starts_with('/'))
        {
            return Ok(format!("$HOME{rest}"));
        }
    }
    if item.starts_with('/') {
        Ok(item.to_owned())
    } else {
        Err(PathProblem::NotAbsolute)
    }
}

// ---- editing ---------------------------------------------------------------------

#[derive(Clone, PartialEq, Eq)]
pub enum VarEdit {
    /// Adds the variable to the block or changes the one that is there.
    Set {
        name: String,
        value: String,
    },
    Remove {
        name: String,
    },
}

impl fmt::Debug for VarEdit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Set { name, value } => formatter
                .debug_struct("Set")
                .field("name", name)
                .field("value_len", &value.chars().count())
                .finish(),
            Self::Remove { name } => formatter
                .debug_struct("Remove")
                .field("name", name)
                .finish(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlockEdit {
    pub variables: Vec<VarEdit>,
    /// The complete managed PATH list (an empty list removes the PATH line).
    pub path: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditError {
    NoEdits,
    Block(BlockProblem),
    InvalidName(String),
    /// `PATH` / `path` are edited through the PATH list.
    ReservedName(String),
    DuplicateEdit(String),
    NotManaged(String),
    Value {
        name: String,
        problem: ValueProblem,
    },
    Path {
        index: usize,
        problem: PathProblem,
    },
    TooManyVariables,
    TooManyPathItems,
}

impl EditError {
    /// A user-facing explanation. It names variables and reasons, never values.
    pub fn message(&self) -> String {
        match self {
            Self::NoEdits => "没有需要保存的改动。".to_owned(),
            Self::Block(problem) => format!(
                "UserHome 专用块的结构异常，已阻止结构化写入（不会尝试修复）：{}",
                problem.message()
            ),
            Self::InvalidName(name) => format!(
                "变量名 {name:?} 无效：必须匹配 [A-Za-z_][A-Za-z0-9_]*，且不超过 {MAX_NAME_CHARS} 个字符。"
            ),
            Self::ReservedName(name) => {
                format!("{name} 请通过 PATH 列表编辑，不能作为普通变量写入。")
            }
            Self::DuplicateEdit(name) => format!("同一次保存中变量 {name} 出现了多次。"),
            Self::NotManaged(name) => format!(
                "变量 {name} 不在 UserHome 专用块内，不会被修改或删除（块外的赋值保持原样）。"
            ),
            Self::Value { name, problem } => match problem {
                ValueProblem::ControlCharacter => format!(
                    "变量 {name} 的值含换行、NUL、制表符、其他控制字符或不可见的方向/分隔字符，无法作为单行字面量安全写入。"
                ),
                ValueProblem::TooLong => {
                    format!("变量 {name} 的值超过 {MAX_EDIT_VALUE_CHARS} 个字符。")
                }
            },
            Self::Path { index, problem } => {
                let position = index + 1;
                match problem {
                    PathProblem::Empty => {
                        format!("第 {position} 个 PATH 项为空；空项会让 shell 搜索当前目录。")
                    }
                    PathProblem::Colon => format!("第 {position} 个 PATH 项含有 “:”，请拆成多项。"),
                    PathProblem::SurroundingSpace => {
                        format!("第 {position} 个 PATH 项首尾有空白。")
                    }
                    PathProblem::ControlCharacter => {
                        format!("第 {position} 个 PATH 项含控制字符或不可见字符。")
                    }
                    PathProblem::TooLong => {
                        format!("第 {position} 个 PATH 项超过 {MAX_PATH_ITEM_CHARS} 个字符。")
                    }
                    PathProblem::NotAbsolute => format!(
                        "第 {position} 个 PATH 项不是绝对路径（需以 / 开头，或以 ~、$HOME 开头）。"
                    ),
                }
            }
            Self::TooManyVariables => format!("专用块最多管理 {MAX_VARIABLES} 个变量。"),
            Self::TooManyPathItems => format!("专用块最多管理 {MAX_PATH_ITEMS} 个 PATH 项。"),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct VarChange {
    pub name: String,
    pub kind: ChangeKind,
    pub secret: bool,
    pub before: Option<String>,
    pub after: Option<String>,
}

impl fmt::Debug for VarChange {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VarChange")
            .field("name", &self.name)
            .field("kind", &self.kind)
            .field("secret", &self.secret)
            .field(
                "before_len",
                &self.before.as_ref().map(|v| v.chars().count()),
            )
            .field("after_len", &self.after.as_ref().map(|v| v.chars().count()))
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathChange {
    pub before: Vec<String>,
    pub after: Vec<String>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct Applied {
    pub text: String,
    /// What the block holds after the edit; what a read-back must find.
    pub desired: BlockContent,
    pub variable_changes: Vec<VarChange>,
    pub path_change: Option<PathChange>,
    /// The block did not exist and is appended.
    pub created_block: bool,
    /// The block's body before and after, masked, for a display diff.
    pub before_lines: Vec<String>,
    pub after_lines: Vec<String>,
}

impl fmt::Debug for Applied {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Applied")
            .field("text_len", &self.text.len())
            .field("variable_changes", &self.variable_changes)
            .field("path_change", &self.path_change)
            .field("created_block", &self.created_block)
            .finish()
    }
}

impl Applied {
    pub fn is_empty(&self) -> bool {
        self.variable_changes.is_empty() && self.path_change.is_none()
    }
}

pub fn apply(text: &str, edit: &BlockEdit) -> Result<Applied, EditError> {
    if edit.variables.is_empty() && edit.path.is_none() {
        return Err(EditError::NoEdits);
    }
    let block = match inspect(text) {
        BlockState::Broken(problem) => return Err(EditError::Block(problem)),
        BlockState::Absent => None,
        BlockState::Present(block) => Some(block),
    };
    let current = block
        .as_ref()
        .map(|block| block.content.clone())
        .unwrap_or_default();
    let mut desired = current.clone();
    let mut variable_changes = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for edit in &edit.variables {
        let (name, value) = match edit {
            VarEdit::Set { name, value } => (name, Some(value)),
            VarEdit::Remove { name } => (name, None),
        };
        if !is_valid_key(name) || name.chars().count() > MAX_NAME_CHARS {
            return Err(EditError::InvalidName(name.clone()));
        }
        if is_reserved_name(name) {
            return Err(EditError::ReservedName(name.clone()));
        }
        if seen.contains(&name.as_str()) {
            return Err(EditError::DuplicateEdit(name.clone()));
        }
        seen.push(name);
        let position = desired
            .variables
            .iter()
            .position(|variable| &variable.name == name);
        match (value, position) {
            (Some(value), position) => {
                check_value(value).map_err(|problem| EditError::Value {
                    name: name.clone(),
                    problem,
                })?;
                match position {
                    Some(index) if desired.variables[index].value == *value => {}
                    Some(index) => {
                        let before =
                            std::mem::replace(&mut desired.variables[index].value, value.clone());
                        variable_changes.push(change(
                            name,
                            ChangeKind::Modify,
                            Some(before),
                            Some(value.clone()),
                        ));
                    }
                    None => {
                        desired.variables.push(ManagedVariable {
                            name: name.clone(),
                            value: value.clone(),
                        });
                        variable_changes.push(change(
                            name,
                            ChangeKind::Add,
                            None,
                            Some(value.clone()),
                        ));
                    }
                }
            }
            (None, Some(index)) => {
                let removed = desired.variables.remove(index);
                variable_changes.push(change(name, ChangeKind::Remove, Some(removed.value), None));
            }
            (None, None) => return Err(EditError::NotManaged(name.clone())),
        }
    }
    if desired.variables.len() > MAX_VARIABLES {
        return Err(EditError::TooManyVariables);
    }
    let mut path_change = None;
    if let Some(items) = &edit.path {
        if items.len() > MAX_PATH_ITEMS {
            return Err(EditError::TooManyPathItems);
        }
        let normalized = items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                normalize_path_item(item).map_err(|problem| EditError::Path { index, problem })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if normalized != current.path {
            path_change = Some(PathChange {
                before: current.path.clone(),
                after: normalized.clone(),
            });
            desired.path = normalized;
        }
    }
    let before_lines = render_lines(&current, true);
    let after_lines = render_lines(&desired, true);
    if variable_changes.is_empty() && path_change.is_none() {
        return Ok(Applied {
            text: text.to_owned(),
            desired,
            variable_changes,
            path_change,
            created_block: false,
            before_lines,
            after_lines,
        });
    }
    let (new_text, created_block) = match &block {
        Some(block) => (replace_body(text, block, &desired), false),
        None => (append_block(text, &desired), true),
    };
    Ok(Applied {
        text: new_text,
        desired,
        variable_changes,
        path_change,
        created_block,
        before_lines,
        after_lines,
    })
}

fn change(
    name: &str,
    kind: ChangeKind,
    before: Option<String>,
    after: Option<String>,
) -> VarChange {
    let secret = [&before, &after]
        .into_iter()
        .flatten()
        .any(|value| value_looks_secret(name, value));
    VarChange {
        name: name.to_owned(),
        kind,
        secret,
        before,
        after,
    }
}

fn body_text(content: &BlockContent, eol: &str) -> String {
    render_lines(content, false)
        .iter()
        .map(|line| format!("{line}{eol}"))
        .collect()
}

fn replace_body(text: &str, block: &ManagedBlock, desired: &BlockContent) -> String {
    format!(
        "{}{}{}",
        &text[..block.body_start],
        body_text(desired, block.eol),
        &text[block.body_end..]
    )
}

/// The line ending the file already uses (its first one), `\n` for a file
/// without any.
pub fn detect_eol(text: &str) -> &'static str {
    match text.find('\n') {
        Some(index) if text[..index].ends_with('\r') => "\r\n",
        _ => "\n",
    }
}

fn append_block(text: &str, desired: &BlockContent) -> String {
    let eol = detect_eol(text);
    let mut result = String::from(text);
    if !text.is_empty() {
        if !text.ends_with('\n') {
            result.push_str(eol);
        }
        // One blank line between the existing content and the block.
        if !(result.ends_with("\n\n") || result.ends_with("\n\r\n")) {
            result.push_str(eol);
        }
    }
    result.push_str(BEGIN_MARKER);
    result.push_str(eol);
    result.push_str(&body_text(desired, eol));
    result.push_str(END_MARKER);
    result.push_str(eol);
    result
}

// ---- verification ------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerifyError {
    NotText,
    BlockMissing,
    BlockBroken(BlockProblem),
    /// The block does not hold what was written.
    ContentMismatch,
    /// Bytes outside the markers differ from the original.
    OutsideChanged,
    /// The line parser of the read-only view does not read the variable back
    /// as the exact literal (or the PATH items back as written).
    ReadBackMismatch(String),
}

/// Checks written bytes: the block holds exactly `desired`, every byte outside
/// the markers equals the original, and the read-only zsh parser (the same one
/// the view uses) reads every managed line back as a static literal.
pub fn verify(original: &str, written: &[u8], desired: &BlockContent) -> Result<(), VerifyError> {
    let written = std::str::from_utf8(written).map_err(|_| VerifyError::NotText)?;
    let block = match inspect(written) {
        BlockState::Present(block) => block,
        BlockState::Absent => return Err(VerifyError::BlockMissing),
        BlockState::Broken(problem) => return Err(VerifyError::BlockBroken(problem)),
    };
    if &block.content != desired {
        return Err(VerifyError::ContentMismatch);
    }
    let outside_unchanged = match inspect(original) {
        BlockState::Absent => {
            let begin_offset = block.body_start - (BEGIN_MARKER.len() + block.eol.len());
            written.starts_with(original) && begin_offset >= original.len()
        }
        BlockState::Present(old) => {
            written[..block.body_start] == original[..old.body_start]
                && written[block.body_end..] == original[old.body_end..]
        }
        BlockState::Broken(_) => false,
    };
    if !outside_unchanged {
        return Err(VerifyError::OutsideChanged);
    }
    read_back(written, &block)
}

/// Parses `written` with `zsh_parse` and compares the lines of the block.
fn read_back(written: &str, block: &ManagedBlock) -> Result<(), VerifyError> {
    let mismatch = |name: &str| VerifyError::ReadBackMismatch(name.to_owned());
    let mut variables = 0;
    let mut path_seen = false;
    for line in zsh_parse::parse(written)
        .into_iter()
        .filter(|line| line.line > block.begin_line && line.line < block.end_line)
    {
        let LineKind::Entries(entries) = &line.kind else {
            return Err(mismatch("?"));
        };
        let [entry] = entries.as_slice() else {
            return Err(mismatch("?"));
        };
        if entry.operation != Operation::Set || !entry.exported {
            return Err(mismatch(&entry.name));
        }
        if entry.name == "path" {
            let items = &block.content.path;
            let segments = entry.segments.as_deref().unwrap_or_default();
            let matches = segments.len() == items.len() + 1
                && segments.iter().zip(items).all(|(segment, item)| {
                    segment.text == *item
                        && segment.state
                            == if item.starts_with("$HOME") {
                                ValueState::Reference
                            } else {
                                ValueState::Static
                            }
                })
                && segments.last().is_some_and(|last| last.text == "$path");
            if !matches || path_seen {
                return Err(mismatch("PATH"));
            }
            path_seen = true;
        } else {
            let expected = block
                .content
                .variables
                .iter()
                .find(|variable| variable.name == entry.name);
            let exact = expected.is_some_and(|variable| {
                entry.state == ValueState::Static && entry.value == variable.value
            });
            if !exact {
                return Err(mismatch(&entry.name));
            }
            variables += 1;
        }
    }
    if variables != block.content.variables.len() || path_seen != !block.content.path.is_empty() {
        return Err(mismatch("?"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "zsh_block_tests.rs"]
mod tests;
