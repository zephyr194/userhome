//! Bounded, read-only discovery of environment files below a directory
//! authorization. Everything goes through `GrantCoordinator`: the root comes
//! from `resolve`, every directory that is entered and every symbolic link is
//! re-resolved with `resolve_child`, so the walk cannot leave the approved
//! directory, enter `~/.ssh` and friends, or follow a link out of the root.
//! Nothing here opens or executes a file; only names and sizes are looked at.

use std::{collections::BTreeSet, fs, io, path::Path};

use serde::Serialize;

use crate::{
    error::AppError,
    grants::{GrantCoordinator, GrantError, GrantId, GrantKind},
    security::paths::is_safe_catalog_relative_path,
};

pub const DEFAULT_PATTERNS: [&str; 3] = [".env", ".env.*", "*.env"];

/// Directory names that are never entered while scanning recursively.
pub const EXCLUDED_DIRECTORIES: [&str; 20] = [
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".gradle",
    ".venv",
    "venv",
    "__pycache__",
    "Pods",
    "DerivedData",
    "coverage",
    ".idea",
];

const MAX_PATTERNS: usize = 16;
const MAX_PATTERN_LENGTH: usize = 128;
const MAX_REPORTED_SKIPS: usize = 100;
const TEMPLATE_WORDS: [&str; 6] = ["example", "sample", "template", "dist", "tmpl", "tpl"];

/// Scan bounds; the defaults are the contract, tests shrink them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanLimits {
    pub max_depth: usize,
    pub max_entries: usize,
    pub max_matches: usize,
    pub max_file_bytes: u64,
}

impl Default for ScanLimits {
    fn default() -> Self {
        Self {
            max_depth: 5,
            max_entries: 2000,
            max_matches: 200,
            max_file_bytes: 1024 * 1024,
        }
    }
}

/// What the user asked to scan. Shared by scanning and reading so a file can
/// only be read when the same configuration would have listed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanConfig {
    pub patterns: Vec<String>,
    pub recursive: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileKind {
    /// A real environment file.
    Environment,
    /// `.env.example`, `.env.sample`, … — a description of variables, never
    /// merged into runtime values.
    Template,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFile {
    pub relative_path: String,
    pub name: String,
    pub kind: FileKind,
    pub size_bytes: u64,
    /// Larger than the single-file limit; it is listed but cannot be read.
    pub oversized: bool,
    pub symlink: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SkipReason {
    /// A symbolic link whose target is outside the approved directory.
    OutsideLink,
    /// A protected credential location.
    Protected,
    /// Not readable by this process.
    Unreadable,
    BrokenLink,
    /// A name that is not valid text or holds control characters.
    InvalidName,
    /// A match that is not a regular file (directory, FIFO, device…).
    NotRegular,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedEntry {
    /// Absent for names that cannot be shown safely.
    pub relative_path: Option<String>,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PartialReason {
    EntryLimit,
    MatchLimit,
    DepthLimit,
    UnreadableDirectory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOutcome {
    pub root: String,
    pub recursive: bool,
    pub patterns: Vec<String>,
    pub files: Vec<ScannedFile>,
    pub skipped: Vec<SkippedEntry>,
    pub skipped_total: usize,
    pub excluded_directories: usize,
    /// Non-empty means the list is incomplete; the reasons say why.
    pub partial_reasons: Vec<PartialReason>,
    pub entries_examined: usize,
    pub limits: ScanLimits,
    pub exclusions: Vec<String>,
}

pub enum ScanError {
    Invalid(&'static str),
    Grant(GrantError),
}

impl From<GrantError> for ScanError {
    fn from(error: GrantError) -> Self {
        Self::Grant(error)
    }
}

impl From<ScanError> for AppError {
    fn from(error: ScanError) -> Self {
        match error {
            ScanError::Invalid(message) => AppError::invalid_input(message),
            ScanError::Grant(error) => error.into(),
        }
    }
}

impl ScanConfig {
    pub fn with_default_patterns(recursive: bool) -> Self {
        Self {
            patterns: DEFAULT_PATTERNS
                .iter()
                .map(|pattern| (*pattern).to_owned())
                .collect(),
            recursive,
        }
    }

    /// Rejects anything that is not a simple relative glob: absolute paths,
    /// `..`, brackets/braces and other shell or regex syntax.
    pub fn validate(&self) -> Result<(), ScanError> {
        if self.patterns.is_empty() || self.patterns.len() > MAX_PATTERNS {
            return Err(ScanError::Invalid("pattern 数量必须在 1 到 16 之间。"));
        }
        for pattern in &self.patterns {
            validate_pattern(pattern)?;
            if pattern.contains('/') && !self.recursive {
                return Err(ScanError::Invalid(
                    "包含目录的 pattern 需要先开启递归扫描。",
                ));
            }
        }
        Ok(())
    }

    fn matches(&self, relative: &str, name: &str) -> bool {
        self.patterns.iter().any(|pattern| {
            if pattern.contains('/') {
                glob_match(pattern, relative)
            } else {
                glob_match(pattern, name)
            }
        })
    }

    /// Whether `relative` is a path this configuration would list: the depth,
    /// the excluded directories and the patterns all apply.
    pub fn admits(&self, relative: &str, limits: &ScanLimits) -> bool {
        if !is_safe_catalog_relative_path(relative) {
            return false;
        }
        let components: Vec<&str> = relative.split('/').collect();
        let Some((name, directories)) = components.split_last() else {
            return false;
        };
        if directories.len() > limits.max_depth || (!self.recursive && !directories.is_empty()) {
            return false;
        }
        if directories
            .iter()
            .any(|directory| EXCLUDED_DIRECTORIES.contains(directory))
        {
            return false;
        }
        self.matches(relative, name)
    }
}

fn validate_pattern(pattern: &str) -> Result<(), ScanError> {
    let invalid = |message: &'static str| Err(ScanError::Invalid(message));
    if pattern.is_empty() || pattern.chars().count() > MAX_PATTERN_LENGTH {
        return invalid("pattern 不能为空，且最长 128 个字符。");
    }
    if pattern.starts_with('/') {
        return invalid("pattern 必须是相对目录的路径，不能是绝对路径。");
    }
    if pattern.contains("**") {
        return invalid("pattern 只支持 * 和 ?，不支持 **。");
    }
    for segment in pattern.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return invalid("pattern 不能包含空段、. 或 .. 段。");
        }
    }
    let allowed = |character: char| {
        character.is_alphanumeric()
            || matches!(
                character,
                '.' | '_' | '-' | '+' | '@' | '=' | ',' | '/' | '*' | '?'
            )
    };
    if !pattern.chars().all(allowed) {
        return invalid("pattern 只支持字母、数字、. _ - + @ = , / 以及通配符 * 和 ?。");
    }
    Ok(())
}

/// `*` matches any run of characters (including none), `?` exactly one. Both
/// stay inside one path segment because only whole names or whole relative
/// paths are matched and `/` is never produced by a wildcard.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let (mut p, mut t) = (0, 0);
    let mut backtrack: Option<(usize, usize)> = None;
    while t < text.len() {
        if p < pattern.len() && pattern[p] == '*' {
            backtrack = Some((p, t));
            p += 1;
        } else if p < pattern.len()
            && ((pattern[p] == '?' && text[t] != '/') || pattern[p] == text[t])
        {
            p += 1;
            t += 1;
        } else if let Some((star_p, star_t)) = backtrack
            && text[star_t] != '/'
        {
            backtrack = Some((star_p, star_t + 1));
            p = star_p + 1;
            t = star_t + 1;
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|character| *character == '*')
}

/// Templates describe variables; they are never runtime values.
pub fn classify_name(name: &str) -> FileKind {
    let lower = name.to_lowercase();
    if lower
        .split(['.', '-', '_'])
        .any(|segment| TEMPLATE_WORDS.contains(&segment))
    {
        FileKind::Template
    } else {
        FileKind::Environment
    }
}

/// Lists the environment files below the directory authorization `id`.
pub fn scan(
    coordinator: &GrantCoordinator,
    id: &GrantId,
    config: &ScanConfig,
    limits: ScanLimits,
    home: Option<&Path>,
) -> Result<ScanOutcome, ScanError> {
    config.validate()?;
    let record = coordinator.resolve(id)?;
    if record.kind != GrantKind::Directory {
        return Err(GrantError::NotDirectory.into());
    }
    let mut walk = Walk {
        coordinator,
        id,
        config,
        limits,
        files: Vec::new(),
        skipped: Vec::new(),
        skipped_total: 0,
        excluded_directories: 0,
        partial: BTreeSet::new(),
        examined: 0,
    };
    walk.visit(&record.path, "", 0)?;
    walk.files
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(ScanOutcome {
        root: record.summary(home).display_path,
        recursive: config.recursive,
        patterns: config.patterns.clone(),
        files: walk.files,
        skipped: walk.skipped,
        skipped_total: walk.skipped_total,
        excluded_directories: walk.excluded_directories,
        partial_reasons: walk.partial.into_iter().collect(),
        entries_examined: walk.examined,
        limits,
        exclusions: EXCLUDED_DIRECTORIES
            .iter()
            .map(|name| (*name).to_owned())
            .collect(),
    })
}

struct Walk<'a> {
    coordinator: &'a GrantCoordinator,
    id: &'a GrantId,
    config: &'a ScanConfig,
    limits: ScanLimits,
    files: Vec<ScannedFile>,
    skipped: Vec<SkippedEntry>,
    skipped_total: usize,
    excluded_directories: usize,
    partial: BTreeSet<PartialReason>,
    examined: usize,
}

/// Whether the walk may continue after an entry.
#[derive(PartialEq, Eq)]
enum Flow {
    Continue,
    Stop,
}

impl Walk<'_> {
    fn visit(&mut self, directory: &Path, relative: &str, depth: usize) -> Result<Flow, ScanError> {
        let budget = self.limits.max_entries.saturating_sub(self.examined);
        let mut entries = Vec::new();
        let listing = match fs::read_dir(directory) {
            Ok(listing) => listing,
            Err(error) if relative.is_empty() => return Err(root_error(&error).into()),
            Err(_) => {
                self.skip(Some(relative), SkipReason::Unreadable);
                self.partial.insert(PartialReason::UnreadableDirectory);
                return Ok(Flow::Continue);
            }
        };
        // One more than the budget tells whether the directory is cut short;
        // an unreadable single entry is dropped rather than failing the scan.
        for entry in listing.flatten().take(budget.saturating_add(1)) {
            entries.push(entry);
        }
        let cut_short = entries.len() > budget;
        entries.sort_by_key(|entry| entry.file_name());
        entries.truncate(budget);

        for entry in entries {
            self.examined += 1;
            if self.visit_entry(&entry, relative, depth)? == Flow::Stop {
                return Ok(Flow::Stop);
            }
        }
        if cut_short {
            self.partial.insert(PartialReason::EntryLimit);
            return Ok(Flow::Stop);
        }
        Ok(Flow::Continue)
    }

    fn visit_entry(
        &mut self,
        entry: &fs::DirEntry,
        parent: &str,
        depth: usize,
    ) -> Result<Flow, ScanError> {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            self.skip(None, SkipReason::InvalidName);
            return Ok(Flow::Continue);
        };
        let relative = if parent.is_empty() {
            name.clone()
        } else {
            format!("{parent}/{name}")
        };
        if !is_safe_catalog_relative_path(&relative) {
            self.skip(None, SkipReason::InvalidName);
            return Ok(Flow::Continue);
        }
        let Ok(file_type) = entry.file_type() else {
            self.skip(Some(&relative), SkipReason::Unreadable);
            return Ok(Flow::Continue);
        };

        if file_type.is_dir() {
            return self.visit_directory(&name, &relative, depth);
        }
        // Only names the configuration would list matter from here on.
        if !self.config.matches(&relative, &name) {
            return Ok(Flow::Continue);
        }
        if file_type.is_symlink() {
            return Ok(self.add_link(&relative, &name));
        }
        if file_type.is_file() {
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            return Ok(self.add_file(&relative, &name, size, false));
        }
        self.skip(Some(&relative), SkipReason::NotRegular);
        Ok(Flow::Continue)
    }

    fn visit_directory(
        &mut self,
        name: &str,
        relative: &str,
        depth: usize,
    ) -> Result<Flow, ScanError> {
        if !self.config.recursive {
            return Ok(Flow::Continue);
        }
        if EXCLUDED_DIRECTORIES.contains(&name) {
            self.excluded_directories += 1;
            return Ok(Flow::Continue);
        }
        if depth + 1 > self.limits.max_depth {
            self.partial.insert(PartialReason::DepthLimit);
            return Ok(Flow::Continue);
        }
        match self.coordinator.resolve_child(self.id, relative) {
            Ok(canonical) => self.visit(&canonical, relative, depth + 1),
            Err(error) => {
                self.skip(Some(relative), skip_reason(error));
                Ok(Flow::Continue)
            }
        }
    }

    /// A matching symbolic link is listed only when it resolves to a regular
    /// file inside the approved directory; anything else is reported.
    fn add_link(&mut self, relative: &str, name: &str) -> Flow {
        let canonical = match self.coordinator.resolve_child(self.id, relative) {
            Ok(canonical) => canonical,
            Err(error) => {
                self.skip(Some(relative), skip_reason(error));
                return Flow::Continue;
            }
        };
        match fs::metadata(&canonical) {
            Ok(metadata) if metadata.is_file() => {
                self.add_file(relative, name, metadata.len(), true)
            }
            Ok(_) => {
                self.skip(Some(relative), SkipReason::NotRegular);
                Flow::Continue
            }
            Err(_) => {
                self.skip(Some(relative), SkipReason::Unreadable);
                Flow::Continue
            }
        }
    }

    fn add_file(&mut self, relative: &str, name: &str, size: u64, symlink: bool) -> Flow {
        if self.files.len() >= self.limits.max_matches {
            self.partial.insert(PartialReason::MatchLimit);
            return Flow::Stop;
        }
        self.files.push(ScannedFile {
            relative_path: relative.to_owned(),
            name: name.to_owned(),
            kind: classify_name(name),
            size_bytes: size,
            oversized: size > self.limits.max_file_bytes,
            symlink,
        });
        Flow::Continue
    }

    fn skip(&mut self, relative: Option<&str>, reason: SkipReason) {
        self.skipped_total += 1;
        if self.skipped.len() < MAX_REPORTED_SKIPS {
            self.skipped.push(SkippedEntry {
                relative_path: relative.map(str::to_owned),
                reason,
            });
        }
    }
}

fn skip_reason(error: GrantError) -> SkipReason {
    match error {
        GrantError::SymlinkEscape | GrantError::OutsideHome => SkipReason::OutsideLink,
        GrantError::ProtectedLocation => SkipReason::Protected,
        GrantError::NotFound => SkipReason::BrokenLink,
        GrantError::InvalidRelativePath | GrantError::Canonicalize => SkipReason::InvalidName,
        _ => SkipReason::Unreadable,
    }
}

fn root_error(error: &io::Error) -> GrantError {
    match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => GrantError::NotFound,
        io::ErrorKind::PermissionDenied => GrantError::PermissionDenied,
        _ => GrantError::Canonicalize,
    }
}
