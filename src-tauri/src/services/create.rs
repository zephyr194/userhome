//! Creating a UserHome launchd job: a typed request becomes one LaunchAgent
//! property list at the fixed `~/Library/LaunchAgents/<label>.plist`, saved
//! through the same preview → confirm → write → read-back transaction as every
//! other resource write (`grants::write`, dedicated `LaunchAgentFile` entry).
//!
//! Creation only. The file is written and read back; nothing is loaded or
//! started (that is a separate, confirmed action), no `launchctl` subcommand
//! runs here, and an existing file or an already used label is refused rather
//! than replaced (changing a job is editing, which is another step).
//!
//! What the document can say is deliberately small and fully generated here:
//! `Label`, `ProgramArguments` (the executable plus separate arguments, never
//! one command line), and optionally `WorkingDirectory`, `EnvironmentVariables`,
//! `StandardOutPath`, `StandardErrorPath`, `RunAtLoad`, `KeepAlive` (plain
//! booleans). Shells and generic wrappers are refused as the program, there is
//! no user switch, and every string is escaped, so request text can only ever
//! be a literal string value, never markup that adds a key.

use std::{
    collections::{BTreeMap, HashMap},
    fmt::Write as _,
    fs,
    os::unix::fs::PermissionsExt,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppError,
    grants::{
        ConfirmRequest, GrantError, GrantId, GrantPurpose, ResourceWriteContext,
        ResourceWriteCoordinator, ResourceWriteExecution, ResourceWritePreview, WriteRequest,
        is_below_home,
    },
    operations::OperationStatus,
};

use super::{
    launchd::{Label, discover, redact_arguments, with_system},
    ownership::{USERHOME_LABEL_NAMESPACE, acquire_gate},
};

// ---------------------------------------------------------------- limits

pub const MAX_LABEL_SUFFIX_BYTES: usize = 64;
pub const MAX_ARGUMENTS: usize = 64;
pub const MAX_ARGUMENT_BYTES: usize = 4096;
pub const MAX_ENVIRONMENT_ENTRIES: usize = 32;
pub const MAX_ENV_KEY_BYTES: usize = 128;
pub const MAX_ENV_VALUE_BYTES: usize = 4096;
pub const MAX_PATH_BYTES: usize = 1024;
/// Previews waiting for a confirmation; each holds one single-file authorization.
pub const MAX_PENDING_CREATES: usize = 16;

/// Programs that run other programs from a string. A job that needs a shell
/// must be written as a script with its own interpreter line and be the
/// executable itself; UserHome never wraps a command in a shell for the user.
const SHELLS: [&str; 10] = [
    "sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "rbash", "ash",
];
/// Generic launchers and privilege wrappers: they hide what really runs.
const WRAPPERS: [&str; 8] = [
    "env", "xargs", "nohup", "sudo", "su", "doas", "exec", "command",
];

const PLIST_HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n";

const EFFECT_NOTE: &str = "仅创建配置文件，本步不加载、不启动。";
const CREATED_NOTE: &str = "配置文件已创建。新任务尚未加载，也未启动。";

// --------------------------------------------------------------- request

/// The typed request of the creation form. Every field has a bounded shape,
/// unknown fields are refused, and both persistence options default to off.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateServiceRequest {
    /// The part after the UserHome namespace, or the full label inside it.
    pub label: String,
    /// Absolute path of the program; it is never run through a shell.
    pub executable: String,
    /// One item per argument; they are never joined into a command line.
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    /// Written only into this job's own `EnvironmentVariables`.
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default)]
    pub stdout_path: Option<String>,
    #[serde(default)]
    pub stderr_path: Option<String>,
    #[serde(default)]
    pub run_at_load: bool,
    #[serde(default)]
    pub keep_alive: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Label,
    Executable,
    Arguments,
    WorkingDirectory,
    EnvironmentKey,
    EnvironmentValue,
    StdoutPath,
    StderrPath,
}

impl Field {
    fn name(self) -> &'static str {
        match self {
            Self::Label => "label",
            Self::Executable => "可执行文件路径",
            Self::Arguments => "参数",
            Self::WorkingDirectory => "工作目录",
            Self::EnvironmentKey => "环境变量名",
            Self::EnvironmentValue => "环境变量值",
            Self::StdoutPath => "标准输出日志路径",
            Self::StderrPath => "标准错误日志路径",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Empty,
    TooLong,
    TooMany,
    ControlCharacter,
    NotAbsolute,
    NotNormalized,
    InvalidName,
    Reserved,
}

impl Reason {
    fn text(self) -> &'static str {
        match self {
            Self::Empty => "不能为空",
            Self::TooLong => "超出长度上限",
            Self::TooMany => "数量超出上限",
            Self::ControlCharacter => "含有换行、NUL 或其他控制字符",
            Self::NotAbsolute => "必须是以 / 开头的绝对路径（不展开 ~）",
            Self::NotNormalized => "必须是规范路径（不含 . 、.. 、连续或结尾的 /）",
            Self::InvalidName => "含有不允许的字符",
            Self::Reserved => "属于保留名称，不允许设置",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutableProblem {
    Missing,
    NotRegularFile,
    NotExecutable,
    WritableByOthers,
    EscapesHome,
    ProtectedLocation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellUse {
    Executable,
    Arguments,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CreateError {
    Invalid {
        field: Field,
        reason: Reason,
    },
    Executable(ExecutableProblem),
    ShellWrapper(ShellUse),
    /// The directory (or the parent directory of a log file) does not exist.
    Directory(Field),
    /// A log file would land in a protected location or among launch agents.
    LogLocation(Field),
    HomeUnavailable,
}

impl From<CreateError> for AppError {
    fn from(error: CreateError) -> Self {
        let text = match error {
            CreateError::Invalid { field, reason } => {
                format!("{}{}。", field.name(), reason.text())
            }
            CreateError::Executable(problem) => match problem {
                ExecutableProblem::Missing => "可执行文件不存在或无法读取。",
                ExecutableProblem::NotRegularFile => "可执行文件必须是常规文件，而不是目录或特殊文件。",
                ExecutableProblem::NotExecutable => "当前用户没有该文件的执行权限。",
                ExecutableProblem::WritableByOthers => {
                    "该可执行文件允许其他用户写入，随时可能被替换，已拒绝。"
                }
                ExecutableProblem::EscapesHome => {
                    "该路径在主目录内，但其符号链接指向主目录之外，已拒绝。"
                }
                ExecutableProblem::ProtectedLocation => {
                    "该路径（或其符号链接的目标）位于 ~/.ssh、~/.gnupg 等受保护位置，已拒绝。"
                }
            }
            .to_owned(),
            CreateError::ShellWrapper(ShellUse::Executable) => {
                "不能把 shell 或 env、sudo 等包装器作为程序：任务必须直接运行目标程序，不经 shell。"
                    .to_owned()
            }
            CreateError::ShellWrapper(ShellUse::Arguments) => {
                "参数的写法是在借用 shell 或包装器运行命令（如 bash -c …），已拒绝；请直接指定目标程序。"
                    .to_owned()
            }
            CreateError::Directory(field) => format!("{}所在的目录不存在。", field.name()),
            CreateError::LogLocation(field) => format!(
                "{}不能放在 ~/.ssh 等受保护位置或 ~/Library/LaunchAgents 内。",
                field.name()
            ),
            CreateError::HomeUnavailable => "无法确定主目录，已拒绝创建。".to_owned(),
        };
        AppError::validation_failed(&text)
    }
}

// ------------------------------------------------------ host facts (injectable)

/// What is known about one executable path after following links.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutableFacts {
    /// The canonical target.
    pub resolved: PathBuf,
    pub regular_file: bool,
    /// The current user may execute it.
    pub user_executable: bool,
    /// Group or other may write to the target file.
    pub others_writable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FactsError;

/// The file system questions validation asks; tests answer them from fixtures.
pub trait HostFacts: Sync {
    fn inspect_executable(&self, path: &Path) -> Result<ExecutableFacts, FactsError>;
    /// The canonical path of `path` when it is an existing directory.
    fn resolve_directory(&self, path: &Path) -> Option<PathBuf>;
}

pub struct SystemFacts;

impl HostFacts for SystemFacts {
    fn inspect_executable(&self, path: &Path) -> Result<ExecutableFacts, FactsError> {
        let resolved = fs::canonicalize(path).map_err(|_| FactsError)?;
        let metadata = fs::metadata(&resolved).map_err(|_| FactsError)?;
        let mode = metadata.permissions().mode();
        let c_path =
            std::ffi::CString::new(resolved.to_str().ok_or(FactsError)?).map_err(|_| FactsError)?;
        // SAFETY: `c_path` is a valid NUL-terminated string that outlives the call.
        let accessible = unsafe { libc::access(c_path.as_ptr(), libc::X_OK) } == 0;
        Ok(ExecutableFacts {
            resolved,
            regular_file: metadata.is_file(),
            user_executable: accessible,
            others_writable: mode & 0o022 != 0,
        })
    }

    fn resolve_directory(&self, path: &Path) -> Option<PathBuf> {
        let resolved = fs::canonicalize(path).ok()?;
        fs::metadata(&resolved).ok()?.is_dir().then_some(resolved)
    }
}

// ------------------------------------------------------------- validation

/// A request that passed every check; the only thing a plist is rendered from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedService {
    label: String,
    executable: String,
    arguments: Vec<String>,
    working_directory: Option<String>,
    environment: BTreeMap<String, String>,
    stdout_path: Option<String>,
    stderr_path: Option<String>,
    run_at_load: bool,
    keep_alive: bool,
}

impl ValidatedService {
    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn file_name(&self) -> String {
        format!("{}.plist", self.label)
    }

    /// The property list, byte for byte deterministic: fixed key order, sorted
    /// environment names, and XML-escaped strings.
    pub fn plist_xml(&self) -> String {
        let mut xml = String::from(PLIST_HEADER);
        xml.push_str("<dict>\n");
        push_pair(&mut xml, "Label", &string_element(&self.label));
        let mut program_arguments = String::from("<array>\n");
        for item in std::iter::once(&self.executable).chain(&self.arguments) {
            let _ = writeln!(program_arguments, "\t\t{}", string_element(item));
        }
        program_arguments.push_str("\t</array>");
        push_pair(&mut xml, "ProgramArguments", &program_arguments);
        if let Some(directory) = &self.working_directory {
            push_pair(&mut xml, "WorkingDirectory", &string_element(directory));
        }
        if !self.environment.is_empty() {
            let mut environment = String::from("<dict>\n");
            for (key, value) in &self.environment {
                let _ = writeln!(
                    environment,
                    "\t\t<key>{}</key>\n\t\t{}",
                    escape_xml(key),
                    string_element(value)
                );
            }
            environment.push_str("\t</dict>");
            push_pair(&mut xml, "EnvironmentVariables", &environment);
        }
        if let Some(path) = &self.stdout_path {
            push_pair(&mut xml, "StandardOutPath", &string_element(path));
        }
        if let Some(path) = &self.stderr_path {
            push_pair(&mut xml, "StandardErrorPath", &string_element(path));
        }
        push_pair(&mut xml, "RunAtLoad", bool_element(self.run_at_load));
        push_pair(&mut xml, "KeepAlive", bool_element(self.keep_alive));
        xml.push_str("</dict>\n</plist>\n");
        xml
    }
}

fn push_pair(xml: &mut String, key: &str, value: &str) {
    let _ = writeln!(xml, "\t<key>{key}</key>\n\t{value}");
}

fn bool_element(value: bool) -> &'static str {
    if value { "<true/>" } else { "<false/>" }
}

fn string_element(text: &str) -> String {
    format!("<string>{}</string>", escape_xml(text))
}

fn escape_xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other => out.push(other),
        }
    }
    out
}

/// Control characters (including NUL, newline and tab), the Unicode line and
/// paragraph separators, and the bidirectional override characters that can
/// make a shown command look different from what runs.
fn is_forbidden_char(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
        )
}

fn check_text(text: &str, field: Field, max_bytes: usize) -> Result<(), CreateError> {
    if text.len() > max_bytes {
        return Err(CreateError::Invalid {
            field,
            reason: Reason::TooLong,
        });
    }
    if text.chars().any(is_forbidden_char) {
        return Err(CreateError::Invalid {
            field,
            reason: Reason::ControlCharacter,
        });
    }
    Ok(())
}

fn invalid(field: Field, reason: Reason) -> CreateError {
    CreateError::Invalid { field, reason }
}

/// An absolute path without `.`, `..`, doubled or trailing separators.
fn check_path(text: &str, field: Field) -> Result<(), CreateError> {
    if text.is_empty() {
        return Err(invalid(field, Reason::Empty));
    }
    check_text(text, field, MAX_PATH_BYTES)?;
    if !text.starts_with('/') {
        return Err(invalid(field, Reason::NotAbsolute));
    }
    let normal = text.len() > 1
        && !text.ends_with('/')
        && text[1..]
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..");
    if normal {
        Ok(())
    } else {
        Err(invalid(field, Reason::NotNormalized))
    }
}

fn label_from(input: &str) -> Result<String, CreateError> {
    let suffix = input
        .strip_prefix(USERHOME_LABEL_NAMESPACE)
        .unwrap_or(input);
    let bad = |reason| invalid(Field::Label, reason);
    if suffix.is_empty() {
        return Err(bad(Reason::Empty));
    }
    if suffix.len() > MAX_LABEL_SUFFIX_BYTES {
        return Err(bad(Reason::TooLong));
    }
    let allowed = suffix
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'));
    if !allowed || suffix.starts_with(['.', '-']) || suffix.ends_with('.') || suffix.contains("..")
    {
        return Err(bad(Reason::InvalidName));
    }
    let label = format!("{USERHOME_LABEL_NAMESPACE}{suffix}");
    Label::parse(&label).map_err(|_| bad(Reason::InvalidName))?;
    Ok(label)
}

fn file_name_of(text: &str) -> &str {
    text.rsplit('/').next().unwrap_or(text)
}

fn is_shell_or_wrapper(name: &str) -> bool {
    SHELLS.contains(&name) || WRAPPERS.contains(&name)
}

/// `-c`, `-lc`, `-ic`: short options ending in `c`, the way shells take a command.
fn is_command_flag(argument: &str) -> bool {
    argument.len() >= 2
        && argument.starts_with('-')
        && !argument.starts_with("--")
        && argument.ends_with('c')
        && argument[1..].bytes().all(|byte| byte.is_ascii_alphabetic())
}

pub(super) fn check_arguments(arguments: &[String]) -> Result<(), CreateError> {
    if arguments.len() > MAX_ARGUMENTS {
        return Err(invalid(Field::Arguments, Reason::TooMany));
    }
    for argument in arguments {
        check_text(argument, Field::Arguments, MAX_ARGUMENT_BYTES)?;
    }
    let first_is_launcher = arguments
        .first()
        .is_some_and(|first| is_shell_or_wrapper(file_name_of(first)));
    let shell_with_command = arguments.iter().any(|item| is_command_flag(item))
        && arguments
            .iter()
            .any(|item| is_shell_or_wrapper(file_name_of(item)));
    if first_is_launcher || shell_with_command {
        return Err(CreateError::ShellWrapper(ShellUse::Arguments));
    }
    Ok(())
}

pub(super) fn check_environment(environment: &BTreeMap<String, String>) -> Result<(), CreateError> {
    if environment.len() > MAX_ENVIRONMENT_ENTRIES {
        return Err(invalid(Field::EnvironmentKey, Reason::TooMany));
    }
    for (key, value) in environment {
        if key.len() > MAX_ENV_KEY_BYTES {
            return Err(invalid(Field::EnvironmentKey, Reason::TooLong));
        }
        let mut bytes = key.bytes();
        let valid = bytes
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic() || first == b'_')
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
        if !valid {
            return Err(invalid(Field::EnvironmentKey, Reason::InvalidName));
        }
        // Loader variables change what code the job's own program loads.
        if key.starts_with("DYLD_") || key.starts_with("LD_") {
            return Err(invalid(Field::EnvironmentKey, Reason::Reserved));
        }
        check_text(value, Field::EnvironmentValue, MAX_ENV_VALUE_BYTES)?;
    }
    Ok(())
}

fn under(path: &Path, home: &Path) -> bool {
    path.starts_with(home)
}

pub(super) fn check_executable(
    text: &str,
    home: &Path,
    facts: &dyn HostFacts,
) -> Result<(), CreateError> {
    check_path(text, Field::Executable)?;
    if is_shell_or_wrapper(file_name_of(text)) {
        return Err(CreateError::ShellWrapper(ShellUse::Executable));
    }
    let given = Path::new(text);
    let found = facts
        .inspect_executable(given)
        .map_err(|_| CreateError::Executable(ExecutableProblem::Missing))?;
    if !found.regular_file {
        return Err(CreateError::Executable(ExecutableProblem::NotRegularFile));
    }
    if !found.user_executable {
        return Err(CreateError::Executable(ExecutableProblem::NotExecutable));
    }
    if found.others_writable {
        return Err(CreateError::Executable(ExecutableProblem::WritableByOthers));
    }
    let resolved = found.resolved.as_path();
    if !resolved.is_absolute() {
        return Err(CreateError::Executable(ExecutableProblem::Missing));
    }
    for path in [given, resolved] {
        if under(path, home) && !is_below_home(path, Some(home)) {
            return Err(CreateError::Executable(
                ExecutableProblem::ProtectedLocation,
            ));
        }
    }
    if under(given, home) && !under(resolved, home) {
        return Err(CreateError::Executable(ExecutableProblem::EscapesHome));
    }
    let resolved_name = resolved
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if is_shell_or_wrapper(resolved_name) {
        return Err(CreateError::ShellWrapper(ShellUse::Executable));
    }
    Ok(())
}

pub(super) fn check_working_directory(
    text: &str,
    facts: &dyn HostFacts,
) -> Result<(), CreateError> {
    check_path(text, Field::WorkingDirectory)?;
    facts
        .resolve_directory(Path::new(text))
        .map(|_| ())
        .ok_or(CreateError::Directory(Field::WorkingDirectory))
}

/// A log file is opened (and created) by launchd, so its real location must
/// not be a credential directory or the LaunchAgents directory itself.
pub(super) fn check_log_path(
    text: &str,
    field: Field,
    home: &Path,
    facts: &dyn HostFacts,
) -> Result<(), CreateError> {
    check_path(text, field)?;
    let path = Path::new(text);
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(invalid(field, Reason::NotNormalized));
    };
    let parent = facts
        .resolve_directory(parent)
        .ok_or(CreateError::Directory(field))?;
    let real = parent.join(name);
    let agents = home.join("Library").join("LaunchAgents");
    let protected = under(&real, home) && !is_below_home(&real, Some(home));
    if protected || real.starts_with(&agents) || path.starts_with(&agents) {
        return Err(CreateError::LogLocation(field));
    }
    Ok(())
}

/// Checks a request against every rule and returns what a plist may be
/// rendered from. `home` is the canonical home directory.
pub fn validate(
    request: &CreateServiceRequest,
    home: Option<&Path>,
    facts: &dyn HostFacts,
) -> Result<ValidatedService, CreateError> {
    let home = home
        .filter(|home| home.is_absolute() && home.components().count() > 1)
        .ok_or(CreateError::HomeUnavailable)?;
    debug_assert!(home.components().all(|part| part != Component::ParentDir));
    check_text(&request.label, Field::Label, 255)?;
    let label = label_from(&request.label)?;
    check_arguments(&request.arguments)?;
    check_environment(&request.environment)?;
    check_executable(&request.executable, home, facts)?;
    if let Some(directory) = &request.working_directory {
        check_working_directory(directory, facts)?;
    }
    for (path, field) in [
        (&request.stdout_path, Field::StdoutPath),
        (&request.stderr_path, Field::StderrPath),
    ] {
        if let Some(path) = path {
            check_log_path(path, field, home, facts)?;
        }
    }
    Ok(ValidatedService {
        label,
        executable: request.executable.clone(),
        arguments: request.arguments.clone(),
        working_directory: request.working_directory.clone(),
        environment: request.environment.clone(),
        stdout_path: request.stdout_path.clone(),
        stderr_path: request.stderr_path.clone(),
        run_at_load: request.run_at_load,
        keep_alive: request.keep_alive,
    })
}

// ------------------------------------------------------ label registry

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistryError {
    /// Another discovery is running.
    Busy,
    /// Some sources could not be read completely, so a free label cannot be proven.
    Incomplete,
}

/// Whether a label already belongs to a job UserHome can see in any domain or
/// directory (loaded, or defined by a file anywhere it looks).
pub trait LabelRegistry: Sync {
    fn is_taken(&self, label: &str) -> Result<bool, RegistryError>;
}

/// Asks the real read-only discovery. A label found anywhere is taken; a
/// label not found is only free when every source was read completely.
pub struct SystemRegistry;

impl LabelRegistry for SystemRegistry {
    fn is_taken(&self, label: &str) -> Result<bool, RegistryError> {
        let _gate = acquire_gate().map_err(|_| RegistryError::Busy)?;
        let discovery = with_system(discover);
        if discovery
            .services
            .iter()
            .any(|service| service.label == label)
        {
            return Ok(true);
        }
        if discovery.complete {
            Ok(false)
        } else {
            Err(RegistryError::Incomplete)
        }
    }
}

fn registry_check(registry: &dyn LabelRegistry, label: &str) -> Result<(), AppError> {
    match registry.is_taken(label) {
        Ok(false) => Ok(()),
        Ok(true) => Err(AppError::conflict(
            "该 label 已被其他目录或域中已发现的任务占用，请换一个名称。",
        )),
        Err(RegistryError::Busy) => Err(AppError::conflict(
            "launchd 任务发现正在进行，暂时无法确认 label 是否可用，请稍后重试。",
        )),
        Err(RegistryError::Incomplete) => Err(AppError::conflict(
            "任务发现未能完整读取所有来源，无法确认 label 未被占用，已拒绝创建；请刷新后重试。",
        )),
    }
}

// ------------------------------------------------- preview and execution

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePreview {
    #[serde(flatten)]
    pub write: ResourceWritePreview,
    pub label: String,
    /// `~/Library/LaunchAgents/<label>.plist`
    pub file_path: String,
    pub executable: String,
    /// The real argument list with secret-looking values hidden.
    pub arguments: Vec<String>,
    pub arguments_redacted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    /// Names only; values never leave the backend.
    pub environment_keys: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr_path: Option<String>,
    pub run_at_load: bool,
    pub keep_alive: bool,
    /// What the two options mean once the file is loaded; always both shown.
    pub persistence_notes: Vec<String>,
    pub effect_note: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExecution {
    #[serde(flatten)]
    pub execution: ResourceWriteExecution,
    pub label: String,
    pub file_path: String,
    /// Creating the file never loads it.
    pub loaded: bool,
    pub effect_note: &'static str,
}

struct PendingCreate {
    grant_id: GrantId,
    label: String,
    file_path: String,
    content: String,
}

#[derive(Default)]
pub struct ServiceCreateCoordinator {
    pending: Mutex<HashMap<String, PendingCreate>>,
}

fn display(path: &str, home: &Path) -> String {
    match Path::new(path).strip_prefix(home) {
        Ok(relative) if !relative.as_os_str().is_empty() => {
            format!("~/{}", relative.to_string_lossy())
        }
        _ => path.to_owned(),
    }
}

fn persistence_notes(run_at_load: bool, keep_alive: bool) -> Vec<String> {
    vec![
        if run_at_load {
            "登录后自动启动：已开启。任务一旦被加载（登录时 launchd 会自动加载 ~/Library/LaunchAgents 中的配置）就会立即启动，并在之后每次登录时继续如此，直到配置被卸载或删除。"
        } else {
            "登录后自动启动：已关闭。任务不会自动启动，需要时再手动启动。"
        }
        .to_owned(),
        if keep_alive {
            "退出后自动重启：已开启。任务无论正常退出还是崩溃，launchd 都会立即重新启动它；要让它真正停下，需要卸载或禁用该任务。"
        } else {
            "退出后自动重启：已关闭。任务退出后不会自动重启。"
        }
        .to_owned(),
        "参数与环境变量会以明文写入该配置文件（仅当前用户可读写）；预览里敏感参数已隐藏，环境变量只显示名称。"
            .to_owned(),
    ]
}

fn grant_failure(error: GrantError) -> AppError {
    match error {
        GrantError::NotFound => AppError::not_found(
            "~/Library/LaunchAgents 目录不存在；UserHome 不会创建目录，请先创建后重试。",
        ),
        GrantError::NotFile => {
            AppError::conflict("已存在同名配置文件（或同名的链接/目录），不会覆盖；请换一个名称。")
        }
        other => AppError::from(other),
    }
}

impl ServiceCreateCoordinator {
    /// Validates the request, proves the name is free (no file, no job with
    /// that label), makes the one-file authorization for the fixed target and
    /// previews the creation. Nothing is written.
    pub fn preview(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        home: Option<&Path>,
        registry: &dyn LabelRegistry,
        facts: &dyn HostFacts,
        request: &CreateServiceRequest,
    ) -> Result<CreatePreview, AppError> {
        let service = validate(request, home, facts)?;
        let home = home.ok_or(CreateError::HomeUnavailable)?;
        self.prune(ctx)?;
        if self.lock()?.len() >= MAX_PENDING_CREATES {
            return Err(AppError::conflict(
                "等待确认的创建预览过多，请先确认或等待过期。",
            ));
        }
        let agents = home.join("Library").join("LaunchAgents");
        let target = agents.join(service.file_name());
        // Any entry under the name (file, link, dangling link, directory) is "exists".
        if fs::symlink_metadata(&target).is_ok() {
            return Err(AppError::conflict(
                "已存在同名配置文件，不会覆盖；编辑已有任务是另一项操作，请换一个名称。",
            ));
        }
        registry_check(registry, service.label())?;

        let content = service.plist_xml();
        let sensitive = sensitive_values(&service);
        ctx.operations.register_sensitive_values(sensitive)?;

        let record = ctx
            .grants
            .create_new_file_with(GrantPurpose::LaunchAgentFile, &agents, &service.file_name())
            .map_err(grant_failure)?;
        let step = match writes.preview_launch_agent(
            ctx,
            WriteRequest {
                grant_id: record.id.clone(),
                relative: None,
                expected_sha256: None,
                content: content.clone(),
                sensitive: true,
            },
        ) {
            Ok(preview) => preview.steps.into_iter().next(),
            Err(error) => {
                let _ = ctx.grants.revoke(&record.id);
                return Err(error);
            }
        };
        let Some(write) = step else {
            let _ = ctx.grants.revoke(&record.id);
            return Err(AppError::internal());
        };

        let redacted = redact_arguments(&service.arguments);
        let file_path = display(&target.to_string_lossy(), home);
        let operation_id = write.operation.operation_id.clone();
        let preview = CreatePreview {
            write,
            label: service.label.clone(),
            file_path: file_path.clone(),
            executable: display(&service.executable, home),
            arguments_redacted: redacted != service.arguments,
            arguments: redacted,
            working_directory: service
                .working_directory
                .as_deref()
                .map(|path| display(path, home)),
            environment_keys: service.environment.keys().cloned().collect(),
            stdout_path: service
                .stdout_path
                .as_deref()
                .map(|path| display(path, home)),
            stderr_path: service
                .stderr_path
                .as_deref()
                .map(|path| display(path, home)),
            run_at_load: service.run_at_load,
            keep_alive: service.keep_alive,
            persistence_notes: persistence_notes(service.run_at_load, service.keep_alive),
            effect_note: EFFECT_NOTE,
        };
        self.lock()?.insert(
            operation_id,
            PendingCreate {
                grant_id: record.id,
                label: service.label,
                file_path,
                content,
            },
        );
        Ok(preview)
    }

    /// Confirms a preview: the label is checked again, then the file is
    /// created and read back. Whatever happens, the preview and its one-file
    /// authorization are gone afterwards.
    pub fn execute(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        registry: &dyn LabelRegistry,
        operation_id: &str,
    ) -> Result<CreateExecution, AppError> {
        let pending = self
            .lock()?
            .remove(operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        let result = (|| {
            if let Err(error) = registry_check(registry, &pending.label) {
                let _ = ctx.operations.cancel(operation_id);
                return Err(error);
            }
            let expected = pending.content.clone();
            writes.execute_launch_agent(
                ctx,
                &ConfirmRequest {
                    operation_id: operation_id.to_owned(),
                    grant_id: pending.grant_id.clone(),
                    relative: None,
                },
                move |written| {
                    if written == expected.as_bytes() {
                        Ok(())
                    } else {
                        Err(AppError::validation_failed(
                            "写入后回读的内容与预览不一致。",
                        ))
                    }
                },
            )
        })();
        let _ = ctx.grants.revoke(&pending.grant_id);
        result.map(|execution| CreateExecution {
            execution,
            label: pending.label,
            file_path: pending.file_path,
            loaded: false,
            effect_note: CREATED_NOTE,
        })
    }

    /// Drops previews that can no longer be confirmed, with their authorizations.
    fn prune(&self, ctx: &ResourceWriteContext<'_>) -> Result<(), AppError> {
        let mut state = self.lock()?;
        let gone: Vec<String> = state
            .keys()
            .filter(|operation_id| {
                !ctx.operations
                    .get(operation_id)
                    .is_ok_and(|details| details.status == OperationStatus::Previewed)
            })
            .cloned()
            .collect();
        for operation_id in gone {
            if let Some(pending) = state.remove(&operation_id) {
                let _ = ctx.grants.revoke(&pending.grant_id);
            }
        }
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, PendingCreate>>, AppError> {
        self.pending.lock().map_err(|_| AppError::internal())
    }
}

/// Everything the operation history must never echo: environment values and
/// every argument the redaction would hide.
fn sensitive_values(service: &ValidatedService) -> Vec<String> {
    sensitive_values_of(
        &service.arguments,
        service.environment.values().cloned().collect(),
    )
}

/// The values a history entry or error must never echo, given the arguments
/// and the environment values an operation writes.
pub(super) fn sensitive_values_of(arguments: &[String], environment: Vec<String>) -> Vec<String> {
    let redacted = redact_arguments(arguments);
    environment
        .into_iter()
        .chain(
            arguments
                .iter()
                .zip(&redacted)
                .filter(|(original, shown)| original != shown)
                .map(|(original, _)| original.clone()),
        )
        .collect()
}

#[cfg(test)]
mod tests;
