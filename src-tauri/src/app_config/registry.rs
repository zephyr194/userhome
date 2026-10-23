//! Registry data model. Entries are static, code-reviewed records; the registry
//! never probes or reads the filesystem itself.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Editor,
    AiClient,
    Terminal,
    DeveloperTool,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Json,
    Jsonc,
    Toml,
    Plist,
    Ini,
    Dotenv,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    DiscoverOnly,
    ReadOnly,
    Writable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Sensitivity {
    None,
    SensitiveKeys,
    Credentials,
}

/// `Home` is relative to `$HOME`; `Fixed` is an absolute path outside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Location {
    Home(&'static str),
    Fixed(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Source {
    pub url: &'static str,
    pub verified_on: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    pub id: &'static str,
    pub name: &'static str,
    pub category: Category,
    pub location: Location,
    pub format: Format,
    pub capability: Capability,
    pub sensitivity: Sensitivity,
    pub metadata_only: bool,
    pub source: Source,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    UnknownEntry(String),
    Invalid(Vec<LintError>),
}

pub struct Registry {
    entries: Vec<Entry>,
}

impl Registry {
    pub fn validated(entries: Vec<Entry>) -> Result<Self, RegistryError> {
        let errors = lint(&entries);
        if errors.is_empty() {
            Ok(Self { entries })
        } else {
            Err(RegistryError::Invalid(errors))
        }
    }

    pub fn builtin() -> Result<Self, RegistryError> {
        Self::validated(BUILTIN_ENTRIES.to_vec())
    }

    #[cfg(test)]
    pub fn new(entries: Vec<Entry>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn get(&self, id: &str) -> Result<&Entry, RegistryError> {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| RegistryError::UnknownEntry(id.to_owned()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LintErrorKind {
    InvalidId,
    DuplicateId,
    EmptyName,
    UnsafePath,
    ProtectedLocation,
    RecursiveGlob,
    GlobPattern,
    MissingSource,
    InvalidVerifiedDate,
    CredentialsReadable,
    CredentialsWritable,
    FixedWritable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LintError {
    pub entry_id: String,
    pub kind: LintErrorKind,
}

const PROTECTED_SEQUENCES: [&[&str]; 3] = [&[".ssh"], &[".gnupg"], &["Library", "Keychains"]];

const APPLICATION_SUPPORT: [&str; 2] = ["Library", "Application Support"];

pub fn lint(entries: &[Entry]) -> Vec<LintError> {
    let mut errors = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let mut kinds = Vec::new();
        if entries[..index]
            .iter()
            .any(|earlier| earlier.id == entry.id)
        {
            kinds.push(LintErrorKind::DuplicateId);
        }
        if !is_kebab_case(entry.id) {
            kinds.push(LintErrorKind::InvalidId);
        }
        if entry.name.trim().is_empty() {
            kinds.push(LintErrorKind::EmptyName);
        }
        lint_location(entry.location, &mut kinds);
        lint_source(entry.source, &mut kinds);
        lint_capability(entry, &mut kinds);
        errors.extend(kinds.into_iter().map(|kind| LintError {
            entry_id: entry.id.to_owned(),
            kind,
        }));
    }
    errors
}

fn lint_location(location: Location, kinds: &mut Vec<LintErrorKind>) {
    match location {
        Location::Home(relative) => lint_home(relative, kinds),
        Location::Fixed(absolute) => lint_fixed(absolute, kinds),
    }
}

fn lint_home(relative: &str, kinds: &mut Vec<LintErrorKind>) {
    if relative.is_empty() || relative.starts_with(['/', '~']) || has_forbidden_bytes(relative) {
        kinds.push(LintErrorKind::UnsafePath);
        return;
    }
    let components: Vec<&str> = relative.split('/').collect();
    if has_unsafe_component(&components) {
        kinds.push(LintErrorKind::UnsafePath);
        return;
    }
    if is_protected(&components) {
        kinds.push(LintErrorKind::ProtectedLocation);
    }
    if components.iter().any(|component| component.contains("**")) {
        kinds.push(LintErrorKind::RecursiveGlob);
        return;
    }
    let Some((last, parents)) = components.split_last() else {
        return;
    };
    let parent_glob = parents.iter().any(|component| has_glob_char(component));
    let in_application_folder = components.len() >= 4 && components[..2] == APPLICATION_SUPPORT;
    if parent_glob || (has_glob_char(last) && !in_application_folder) {
        kinds.push(LintErrorKind::GlobPattern);
    }
}

fn lint_fixed(absolute: &str, kinds: &mut Vec<LintErrorKind>) {
    let Some(rest) = absolute.strip_prefix('/') else {
        kinds.push(LintErrorKind::UnsafePath);
        return;
    };
    if has_forbidden_bytes(absolute) {
        kinds.push(LintErrorKind::UnsafePath);
        return;
    }
    let components: Vec<&str> = rest.split('/').collect();
    if has_unsafe_component(&components) {
        kinds.push(LintErrorKind::UnsafePath);
        return;
    }
    if is_protected(&components) {
        kinds.push(LintErrorKind::ProtectedLocation);
    }
    if components.iter().any(|component| component.contains("**")) {
        kinds.push(LintErrorKind::RecursiveGlob);
        return;
    }
    if components.iter().any(|component| has_glob_char(component)) {
        kinds.push(LintErrorKind::GlobPattern);
    }
}

fn lint_source(source: Source, kinds: &mut Vec<LintErrorKind>) {
    if !is_https_url(source.url) {
        kinds.push(LintErrorKind::MissingSource);
    }
    if !is_iso_date(source.verified_on) {
        kinds.push(LintErrorKind::InvalidVerifiedDate);
    }
}

fn lint_capability(entry: &Entry, kinds: &mut Vec<LintErrorKind>) {
    if entry.sensitivity == Sensitivity::Credentials {
        match entry.capability {
            Capability::ReadOnly => kinds.push(LintErrorKind::CredentialsReadable),
            Capability::Writable => kinds.push(LintErrorKind::CredentialsWritable),
            Capability::DiscoverOnly => {}
        }
    }
    if matches!(entry.location, Location::Fixed(_)) && entry.capability == Capability::Writable {
        kinds.push(LintErrorKind::FixedWritable);
    }
}

fn has_forbidden_bytes(path: &str) -> bool {
    path.contains('\0') || path.contains('\\')
}

fn has_unsafe_component(components: &[&str]) -> bool {
    components
        .iter()
        .any(|component| component.is_empty() || *component == "." || *component == "..")
}

fn has_glob_char(component: &str) -> bool {
    component.contains(['*', '?', '[', ']', '{', '}'])
}

fn is_protected(components: &[&str]) -> bool {
    PROTECTED_SEQUENCES.iter().any(|sequence| {
        components
            .windows(sequence.len())
            .any(|window| window == *sequence)
    })
}

fn is_kebab_case(id: &str) -> bool {
    !id.is_empty()
        && id.split('-').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn is_https_url(url: &str) -> bool {
    url.strip_prefix("https://")
        .is_some_and(|rest| !rest.is_empty() && !rest.chars().any(char::is_whitespace))
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 {
        return false;
    }
    let shaped = bytes.iter().enumerate().all(|(index, byte)| match index {
        4 | 7 => *byte == b'-',
        _ => byte.is_ascii_digit(),
    });
    if !shaped {
        return false;
    }
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

const VERIFIED_ON: &str = "2026-10-21";
const GEMINI_VERIFIED_ON: &str = "2026-10-23";
const GIT_CONFIG_SOURCE: &str = "https://git-scm.com/docs/git-config";
const TMUX_SOURCE: &str = "https://raw.githubusercontent.com/tmux/tmux/master/tmux.1";

pub const BUILTIN_ENTRIES: &[Entry] = &[
    Entry {
        id: "git-config-home",
        name: "Git 全局配置",
        category: Category::DeveloperTool,
        location: Location::Home(".gitconfig"),
        format: Format::Ini,
        capability: Capability::Writable,
        sensitivity: Sensitivity::SensitiveKeys,
        metadata_only: false,
        source: Source {
            url: GIT_CONFIG_SOURCE,
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "git-config-xdg",
        name: "Git 全局配置（XDG 位置）",
        category: Category::DeveloperTool,
        location: Location::Home(".config/git/config"),
        format: Format::Ini,
        capability: Capability::Writable,
        sensitivity: Sensitivity::SensitiveKeys,
        metadata_only: false,
        source: Source {
            url: GIT_CONFIG_SOURCE,
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "git-credentials",
        name: "Git 明文凭据库",
        category: Category::DeveloperTool,
        location: Location::Home(".git-credentials"),
        format: Format::Text,
        capability: Capability::DiscoverOnly,
        sensitivity: Sensitivity::Credentials,
        metadata_only: false,
        source: Source {
            url: "https://git-scm.com/docs/git-credential-store",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "npmrc",
        name: "npm 用户配置",
        category: Category::DeveloperTool,
        location: Location::Home(".npmrc"),
        format: Format::Ini,
        capability: Capability::DiscoverOnly,
        sensitivity: Sensitivity::Credentials,
        metadata_only: false,
        source: Source {
            url: "https://docs.npmjs.com/cli/v10/configuring-npm/npmrc",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "pnpm-auth-ini",
        name: "pnpm 认证文件",
        category: Category::DeveloperTool,
        location: Location::Home("Library/Preferences/pnpm/auth.ini"),
        format: Format::Ini,
        capability: Capability::DiscoverOnly,
        sensitivity: Sensitivity::Credentials,
        metadata_only: false,
        source: Source {
            url: "https://pnpm.io/npmrc",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "zed-settings",
        name: "Zed 设置",
        category: Category::Editor,
        location: Location::Home(".config/zed/settings.json"),
        format: Format::Jsonc,
        capability: Capability::Writable,
        sensitivity: Sensitivity::SensitiveKeys,
        metadata_only: false,
        source: Source {
            url: "https://raw.githubusercontent.com/zed-industries/zed/main/docs/src/configuring-zed.md",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "ghostty-config",
        name: "Ghostty 配置",
        category: Category::Terminal,
        location: Location::Home(".config/ghostty/config.ghostty"),
        format: Format::Text,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::SensitiveKeys,
        metadata_only: true,
        source: Source {
            url: "https://ghostty.org/docs/config",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "alacritty-config",
        name: "Alacritty 配置",
        category: Category::Terminal,
        location: Location::Home(".config/alacritty/alacritty.toml"),
        format: Format::Toml,
        capability: Capability::Writable,
        sensitivity: Sensitivity::SensitiveKeys,
        metadata_only: false,
        source: Source {
            url: "https://alacritty.org/config-alacritty.html",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "tmux-conf",
        name: "tmux 配置",
        category: Category::Terminal,
        location: Location::Home(".tmux.conf"),
        format: Format::Text,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::None,
        metadata_only: true,
        source: Source {
            url: TMUX_SOURCE,
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "tmux-config-xdg",
        name: "tmux 配置（XDG 位置）",
        category: Category::Terminal,
        location: Location::Home(".config/tmux/tmux.conf"),
        format: Format::Text,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::None,
        metadata_only: true,
        source: Source {
            url: TMUX_SOURCE,
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "neovim-init",
        name: "Neovim 初始化文件",
        category: Category::Editor,
        location: Location::Home(".config/nvim/init.lua"),
        format: Format::Text,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::None,
        metadata_only: true,
        source: Source {
            url: "https://raw.githubusercontent.com/neovim/neovim/master/runtime/doc/starting.txt",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "claude-code-settings",
        name: "Claude Code 用户设置",
        category: Category::AiClient,
        location: Location::Home(".claude/settings.json"),
        format: Format::Json,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::SensitiveKeys,
        metadata_only: false,
        source: Source {
            url: "https://code.claude.com/docs/en/settings",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "gemini-user-settings",
        name: "Gemini CLI 用户设置",
        category: Category::AiClient,
        location: Location::Home(".gemini/settings.json"),
        format: Format::Json,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::SensitiveKeys,
        metadata_only: false,
        source: Source {
            url: "https://geminicli.com/docs/reference/configuration",
            verified_on: GEMINI_VERIFIED_ON,
        },
    },
    Entry {
        id: "docker-config",
        name: "Docker CLI 配置",
        category: Category::DeveloperTool,
        location: Location::Home(".docker/config.json"),
        format: Format::Json,
        capability: Capability::DiscoverOnly,
        sensitivity: Sensitivity::Credentials,
        metadata_only: false,
        source: Source {
            url: "https://docs.docker.com/reference/cli/docker/#configuration-files",
            verified_on: VERIFIED_ON,
        },
    },
    Entry {
        id: "ssh-system-config",
        name: "SSH 系统配置",
        category: Category::System,
        location: Location::Fixed("/etc/ssh/ssh_config"),
        format: Format::Text,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::None,
        metadata_only: false,
        source: Source {
            url: "https://man.openbsd.org/ssh_config",
            verified_on: VERIFIED_ON,
        },
    },
];

/// Joins the entry's location onto `home`. Pure string work; the caller decides
/// what to do with the result.
pub fn resolve_path(entry: &Entry, home: &Path) -> PathBuf {
    match entry.location {
        Location::Home(relative) => home.join(relative),
        Location::Fixed(absolute) => PathBuf::from(absolute),
    }
}

pub fn display_path(entry: &Entry) -> String {
    match entry.location {
        Location::Home(relative) => format!("~/{relative}"),
        Location::Fixed(absolute) => absolute.to_owned(),
    }
}

/// The only view of an entry the frontend receives. It carries the `~/` display
/// path, never the resolved `$HOME` directory, and no file content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub id: String,
    pub name: String,
    pub category: Category,
    pub display_path: String,
    pub format: Format,
    pub capability: Capability,
    pub sensitivity: Sensitivity,
    pub metadata_only: bool,
    pub source_url: String,
    pub verified_on: String,
}

impl From<&Entry> for EntrySummary {
    fn from(entry: &Entry) -> Self {
        Self {
            id: entry.id.to_owned(),
            name: entry.name.to_owned(),
            category: entry.category,
            display_path: display_path(entry),
            format: entry.format,
            capability: entry.capability,
            sensitivity: entry.sensitivity,
            metadata_only: entry.metadata_only,
            source_url: entry.source.url.to_owned(),
            verified_on: entry.source.verified_on.to_owned(),
        }
    }
}

#[cfg(test)]
pub fn fixture(id: &'static str) -> Entry {
    Entry {
        id,
        name: "Fixture tool",
        category: Category::DeveloperTool,
        location: Location::Home(".fixture/config.json"),
        format: Format::Json,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::None,
        metadata_only: false,
        source: Source {
            url: "https://example.com/docs",
            verified_on: "2026-10-21",
        },
    }
}
