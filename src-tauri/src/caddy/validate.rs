//! Checks a Caddyfile with the detected Caddy executable.
//!
//! Two fixed commands run inside a private scratch directory:
//! `caddy adapt --config <file> --adapter caddyfile` converts the text to JSON
//! and reports structural errors; `caddy validate` with the same arguments runs
//! only after adapt succeeded.
//!
//! `caddy validate` provisions the configured modules. That can allocate
//! resources and compete with a running instance for the same ports, so it is
//! not a side-effect-free dry run, and this module never describes it as one.
//!
//! Configurations that read other files or the environment (`import`,
//! `{file.*}`, `{env.*}`, `{$VAR}`, `tls` with arguments) are scanned first.
//! Unless the caller explicitly allows them, nothing is executed. The runner is
//! injected, so tests never run a real binary.

use std::{
    collections::HashMap,
    ffi::OsString,
    fs::{self, DirBuilder, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;

pub const VALIDATE_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024;
pub const MAX_CHECK_BYTES: usize = 256 * 1024;
pub const CONFIG_FILE: &str = "Caddyfile";
pub const ADAPTER: &str = "caddyfile";
pub const LIMITATION: &str = "validate 会 provision（加载）配置中的模块，可能占用资源并与正在运行的实例争用端口；它不是无副作用的 dry-run，校验通过也不代表能够正常启动。";

const MAX_DIAGNOSTICS: usize = 20;
const MAX_MESSAGE_CHARS: usize = 500;
const FILE_MODE: u32 = 0o600;
const SCRATCH_MODE: u32 = 0o700;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const READ_CHUNK: usize = 8192;
const SAFE_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";
const FILE_PLACEHOLDER: &str = "{file.";
const ENV_PLACEHOLDER: &str = "{env.";
const ENV_SUBSTITUTION: &str = "{$";
const CONFIG_MARKER: &str = "Caddyfile:";
const PRIVATE_DIRECTORY_LABEL: &str = "<私有目录>";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationStatus {
    Valid,
    Invalid,
    ExternalReferences,
    Timeout,
    Cancelled,
    OutputTooLarge,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CheckStage {
    Adapt,
    Validate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReferenceKind {
    Import,
    FilePlaceholder,
    EnvPlaceholder,
    TlsArguments,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalReference {
    pub kind: ReferenceKind,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaddyDiagnostic {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub status: ValidationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<CheckStage>,
    pub external_references: Vec<ExternalReference>,
    pub diagnostics: Vec<CaddyDiagnostic>,
    pub limitation: &'static str,
}

impl ValidationReport {
    fn new(
        status: ValidationStatus,
        stage: Option<CheckStage>,
        external_references: Vec<ExternalReference>,
        diagnostics: Vec<CaddyDiagnostic>,
    ) -> Self {
        Self {
            status,
            stage,
            external_references,
            diagnostics,
            limitation: LIMITATION,
        }
    }

    pub fn unavailable(message: &str) -> Self {
        Self::new(
            ValidationStatus::Unavailable,
            None,
            Vec::new(),
            vec![CaddyDiagnostic {
                line: None,
                message: message.to_owned(),
            }],
        )
    }
}

pub fn adapt_arguments(config: &Path) -> Vec<OsString> {
    arguments("adapt", config)
}

pub fn validate_arguments(config: &Path) -> Vec<OsString> {
    arguments("validate", config)
}

fn arguments(subcommand: &'static str, config: &Path) -> Vec<OsString> {
    vec![
        subcommand.into(),
        "--config".into(),
        config.as_os_str().to_owned(),
        "--adapter".into(),
        ADAPTER.into(),
    ]
}

/// Only these variables reach the child. Storage and state directories point
/// into the scratch directory so nothing is written to the user's home.
pub fn minimal_environment(scratch: &Path) -> Vec<(&'static str, OsString)> {
    vec![
        ("HOME", scratch.as_os_str().to_owned()),
        ("TMPDIR", scratch.as_os_str().to_owned()),
        ("XDG_CONFIG_HOME", scratch.join("config").into_os_string()),
        ("XDG_DATA_HOME", scratch.join("data").into_os_string()),
        ("XDG_STATE_HOME", scratch.join("state").into_os_string()),
        ("XDG_CACHE_HOME", scratch.join("cache").into_os_string()),
        ("PATH", SAFE_PATH.into()),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunSpec {
    pub executable: PathBuf,
    pub arguments: Vec<OsString>,
    pub cwd: PathBuf,
    pub environment: Vec<(&'static str, OsString)>,
    pub timeout: Duration,
    pub max_output_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunFailure {
    Timeout,
    Cancelled,
    OutputTooLarge,
    Unavailable,
}

pub trait CaddyRunner {
    fn run(&self, spec: &RunSpec, cancel: &AtomicBool) -> Result<RunOutput, RunFailure>;
}

pub struct SystemCaddyRunner;

impl CaddyRunner for SystemCaddyRunner {
    fn run(&self, spec: &RunSpec, cancel: &AtomicBool) -> Result<RunOutput, RunFailure> {
        let mut child = Command::new(&spec.executable)
            .args(&spec.arguments)
            .env_clear()
            .envs(spec.environment.iter().map(|(name, value)| (name, value)))
            .current_dir(&spec.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|_| RunFailure::Unavailable)?;
        let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
            stop_child(&mut child);
            return Err(RunFailure::Unavailable);
        };
        let overflow = Arc::new(AtomicBool::new(false));
        let stdout_reader = spawn_reader(stdout, spec.max_output_bytes, Arc::clone(&overflow));
        let stderr_reader = spawn_reader(stderr, spec.max_output_bytes, Arc::clone(&overflow));
        let deadline = Instant::now() + spec.timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {}
                Err(_) => {
                    stop_child(&mut child);
                    return Err(RunFailure::Unavailable);
                }
            }
            if overflow.load(Ordering::SeqCst) {
                stop_child(&mut child);
                return Err(RunFailure::OutputTooLarge);
            }
            if cancel.load(Ordering::SeqCst) {
                stop_child(&mut child);
                return Err(RunFailure::Cancelled);
            }
            if Instant::now() >= deadline {
                stop_child(&mut child);
                return Err(RunFailure::Timeout);
            }
            thread::sleep(POLL_INTERVAL);
        };
        let stdout = stdout_reader.join().map_err(|_| RunFailure::Unavailable)?;
        let stderr = stderr_reader.join().map_err(|_| RunFailure::Unavailable)?;
        if overflow.load(Ordering::SeqCst) {
            return Err(RunFailure::OutputTooLarge);
        }
        Ok(RunOutput {
            success: status.success(),
            stdout,
            stderr,
        })
    }
}

fn stop_child(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Keeps at most `limit` bytes and drains the rest, so the child never blocks
/// on a full pipe. Sets `overflow` as soon as more than `limit` arrives.
fn spawn_reader<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
    overflow: Arc<AtomicBool>,
) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut kept = Vec::new();
        let mut buffer = [0u8; READ_CHUNK];
        let mut total: usize = 0;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    total = total.saturating_add(count);
                    if total > limit {
                        overflow.store(true, Ordering::SeqCst);
                    }
                    let room = limit.saturating_sub(kept.len());
                    kept.extend_from_slice(&buffer[..count.min(room)]);
                }
            }
        }
        kept
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Token<'a> {
    Open,
    Close,
    Word(&'a str),
}

fn tokens(code: &str) -> Vec<Token<'_>> {
    let mut tokens = Vec::new();
    for piece in code.split_whitespace() {
        match piece {
            "{" => tokens.push(Token::Open),
            "}" => tokens.push(Token::Close),
            _ => match piece.strip_suffix('{') {
                Some(word) => {
                    tokens.push(Token::Word(word));
                    tokens.push(Token::Open);
                }
                None => tokens.push(Token::Word(piece)),
            },
        }
    }
    tokens
}

/// Removes a `#` comment. A `#` only starts a comment at the beginning of a
/// word and outside quotes, matching how the Caddyfile lexer reads it.
fn strip_comment(line: &str) -> &str {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut previous: Option<char> = None;
    for (index, character) in line.char_indices() {
        match quote {
            Some(open) => {
                if escaped {
                    escaped = false;
                } else if character == '\\' && open == '"' {
                    escaped = true;
                } else if character == open {
                    quote = None;
                }
            }
            None => {
                let starts_word = match previous {
                    None => true,
                    Some(before) => before.is_whitespace(),
                };
                if character == '#' && starts_word {
                    return &line[..index];
                }
                if character == '"' || character == '`' {
                    quote = Some(character);
                }
            }
        }
        previous = Some(character);
    }
    line
}

fn directive_references(code: &str, line: u32) -> Vec<ExternalReference> {
    let tokens = tokens(code);
    let mut found = Vec::new();
    let mut at_directive = true;
    for (position, token) in tokens.iter().enumerate() {
        match token {
            Token::Open | Token::Close => at_directive = true,
            Token::Word(word) => {
                if at_directive {
                    let name = word.trim_matches(|c| c == '"' || c == '`');
                    match name {
                        "import" => found.push(ExternalReference {
                            kind: ReferenceKind::Import,
                            line,
                        }),
                        "tls" if matches!(tokens.get(position + 1), Some(Token::Word(_))) => {
                            found.push(ExternalReference {
                                kind: ReferenceKind::TlsArguments,
                                line,
                            });
                        }
                        _ => {}
                    }
                }
                at_directive = false;
            }
        }
    }
    found
}

/// Finds lines that read another file, read the environment, or load TLS
/// material. Reports only the kind and the 1-based line, never the content.
pub fn scan_external_references(text: &str) -> Vec<ExternalReference> {
    let mut found = Vec::new();
    for (index, raw) in text.lines().enumerate() {
        let line = u32::try_from(index + 1).unwrap_or(u32::MAX);
        let code = strip_comment(raw);
        if code.contains(FILE_PLACEHOLDER) {
            found.push(ExternalReference {
                kind: ReferenceKind::FilePlaceholder,
                line,
            });
        }
        if code.contains(ENV_PLACEHOLDER) || code.contains(ENV_SUBSTITUTION) {
            found.push(ExternalReference {
                kind: ReferenceKind::EnvPlaceholder,
                line,
            });
        }
        found.extend(directive_references(code, line));
    }
    found
}

/// Turns Caddy's stderr into bounded diagnostics. The private directory is
/// replaced by a label, and the original wording is kept otherwise.
pub fn diagnostics_from(stderr: &[u8], directory: &Path) -> Vec<CaddyDiagnostic> {
    let text = String::from_utf8_lossy(stderr);
    let directory_text = directory.display().to_string();
    let prefix = format!("{directory_text}/");
    let mut diagnostics: Vec<CaddyDiagnostic> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(MAX_DIAGNOSTICS)
        .map(|line| {
            let cleaned = line
                .replace(&prefix, "")
                .replace(&directory_text, PRIVATE_DIRECTORY_LABEL);
            let message = cleaned.strip_prefix("Error: ").unwrap_or(&cleaned);
            let message: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
            CaddyDiagnostic {
                line: config_line(&message),
                message,
            }
        })
        .collect();
    if diagnostics.is_empty() {
        diagnostics.push(CaddyDiagnostic {
            line: None,
            message: "Caddy 没有给出可识别的错误信息。".to_owned(),
        });
    }
    diagnostics
}

fn config_line(message: &str) -> Option<u32> {
    let (_, rest) = message.split_once(CONFIG_MARKER)?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

#[derive(Debug)]
struct Scratch(PathBuf);

impl Scratch {
    fn create(root: &Path) -> Result<Self, AppError> {
        let path = root.join(Uuid::new_v4().to_string());
        DirBuilder::new()
            .mode(SCRATCH_MODE)
            .create(&path)
            .map_err(|_| AppError::permission_denied("Caddy 校验的临时目录无法创建。"))?;
        Ok(Self(path))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn write_config(directory: &Path, text: &str) -> Result<PathBuf, AppError> {
    let path = directory.join(CONFIG_FILE);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(FILE_MODE)
        .open(&path)
        .map_err(|_| AppError::permission_denied("Caddy 校验的配置文件无法创建。"))?;
    file.write_all(text.as_bytes())
        .map_err(|_| AppError::permission_denied("Caddy 校验的配置文件无法写入。"))?;
    Ok(path)
}

pub struct CheckRequest<'a> {
    pub executable: &'a Path,
    pub text: &'a str,
    pub allow_external_references: bool,
}

/// Runs adapt, then validate, in a fresh scratch directory under `checks_root`.
/// Nothing is executed while external references are present unless allowed.
pub fn check(
    request: &CheckRequest<'_>,
    checks_root: &Path,
    runner: &dyn CaddyRunner,
    cancel: &AtomicBool,
) -> Result<ValidationReport, AppError> {
    if request.text.len() > MAX_CHECK_BYTES {
        return Err(AppError::invalid_input("配置超过大小上限，未校验。"));
    }
    let references = scan_external_references(request.text);
    if !references.is_empty() && !request.allow_external_references {
        return Ok(ValidationReport::new(
            ValidationStatus::ExternalReferences,
            None,
            references,
            Vec::new(),
        ));
    }
    let scratch = Scratch::create(checks_root)?;
    let config = write_config(&scratch.0, request.text)?;
    let environment = minimal_environment(&scratch.0);
    let run = |arguments: Vec<OsString>| RunSpec {
        executable: request.executable.to_path_buf(),
        arguments,
        cwd: scratch.0.clone(),
        environment: environment.clone(),
        timeout: VALIDATE_TIMEOUT,
        max_output_bytes: MAX_OUTPUT_BYTES,
    };

    let report_stage = |stage: CheckStage, output: Result<RunOutput, RunFailure>| match output {
        Err(failure) => failure_report(failure, stage, &references),
        Ok(output) if !output.success => ValidationReport::new(
            ValidationStatus::Invalid,
            Some(stage),
            references.clone(),
            diagnostics_from(&output.stderr, &scratch.0),
        ),
        Ok(output) if stage == CheckStage::Adapt && !is_json_object(&output.stdout) => {
            ValidationReport::new(
                ValidationStatus::Invalid,
                Some(stage),
                references.clone(),
                vec![CaddyDiagnostic {
                    line: None,
                    message: "Caddy 的适配输出无法识别。".to_owned(),
                }],
            )
        }
        Ok(_) => ValidationReport::new(
            ValidationStatus::Valid,
            Some(stage),
            references.clone(),
            Vec::new(),
        ),
    };

    let adapt = runner.run(&run(adapt_arguments(&config)), cancel);
    let adapt_report = report_stage(CheckStage::Adapt, adapt);
    if adapt_report.status != ValidationStatus::Valid {
        return Ok(adapt_report);
    }
    let validate = runner.run(&run(validate_arguments(&config)), cancel);
    Ok(report_stage(CheckStage::Validate, validate))
}

fn is_json_object(bytes: &[u8]) -> bool {
    matches!(
        serde_json::from_slice::<serde_json::Value>(bytes),
        Ok(serde_json::Value::Object(_))
    )
}

fn failure_report(
    failure: RunFailure,
    stage: CheckStage,
    references: &[ExternalReference],
) -> ValidationReport {
    let (status, message) = match failure {
        RunFailure::Timeout => (
            ValidationStatus::Timeout,
            "校验超过时限，已停止；结果未知，未启动任何实例。",
        ),
        RunFailure::Cancelled => (ValidationStatus::Cancelled, "已取消校验。"),
        RunFailure::OutputTooLarge => (
            ValidationStatus::OutputTooLarge,
            "Caddy 输出超过上限，已停止校验。",
        ),
        RunFailure::Unavailable => (
            ValidationStatus::Unavailable,
            "无法启动所选 Caddy 可执行文件。",
        ),
    };
    ValidationReport::new(
        status,
        Some(stage),
        references.to_vec(),
        vec![CaddyDiagnostic {
            line: None,
            message: message.to_owned(),
        }],
    )
}

pub fn valid_run_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// Tracks checks that can still be cancelled, keyed by a client-chosen run id.
#[derive(Default)]
pub struct ValidationRuns {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ValidationRuns {
    pub fn begin(&self, id: &str) -> Result<RunHandle<'_>, AppError> {
        let mut active = self.active.lock().map_err(|_| AppError::internal())?;
        if active.contains_key(id) {
            return Err(AppError::conflict("该校验已在进行中。"));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        active.insert(id.to_owned(), Arc::clone(&cancel));
        Ok(RunHandle {
            runs: self,
            id: id.to_owned(),
            cancel,
        })
    }

    /// Returns whether a run with this id was active.
    pub fn cancel(&self, id: &str) -> Result<bool, AppError> {
        let active = self.active.lock().map_err(|_| AppError::internal())?;
        Ok(match active.get(id) {
            Some(flag) => {
                flag.store(true, Ordering::SeqCst);
                true
            }
            None => false,
        })
    }
}

pub struct RunHandle<'a> {
    runs: &'a ValidationRuns,
    id: String,
    cancel: Arc<AtomicBool>,
}

impl RunHandle<'_> {
    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }
}

impl Drop for RunHandle<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.runs.active.lock() {
            active.remove(&self.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::BTreeSet, os::unix::fs::PermissionsExt};

    use uuid::Uuid;

    use super::*;
    use crate::error::AppErrorCode;

    fn kinds(text: &str) -> Vec<(ReferenceKind, u32)> {
        scan_external_references(text)
            .into_iter()
            .map(|reference| (reference.kind, reference.line))
            .collect()
    }

    #[test]
    fn scan_finds_a_top_level_import_on_its_line() {
        assert_eq!(
            kinds("import common.caddy\nexample.com {\n}"),
            vec![(ReferenceKind::Import, 1)]
        );
    }

    #[test]
    fn scan_finds_an_import_inside_a_site_block() {
        assert_eq!(
            kinds("example.com {\n\timport snippets\n}"),
            vec![(ReferenceKind::Import, 2)]
        );
    }

    #[test]
    fn scan_finds_an_import_after_an_opening_brace_on_the_same_line() {
        assert_eq!(
            kinds("example.com { import a }"),
            vec![(ReferenceKind::Import, 1)]
        );
        assert_eq!(
            kinds("example.com{\n\timport a\n}"),
            vec![(ReferenceKind::Import, 2)]
        );
    }

    #[test]
    fn scan_finds_a_quoted_import_directive_name() {
        assert_eq!(
            kinds("\"import\" common.caddy"),
            vec![(ReferenceKind::Import, 1)]
        );
    }

    #[test]
    fn scan_ignores_import_in_comments_and_as_an_argument() {
        assert!(kinds("# import x\nrespond \"import me\"\nrespond import").is_empty());
    }

    #[test]
    fn scan_finds_file_and_env_placeholders_and_env_substitution() {
        assert_eq!(
            kinds("respond {file./etc/secret}\nrespond {env.TOKEN}\nrespond {$HOME}"),
            vec![
                (ReferenceKind::FilePlaceholder, 1),
                (ReferenceKind::EnvPlaceholder, 2),
                (ReferenceKind::EnvPlaceholder, 3),
            ]
        );
    }

    #[test]
    fn scan_finds_placeholders_inside_quotes_and_after_a_hash_within_a_word() {
        assert_eq!(
            kinds("respond \"a # {file.x}\""),
            vec![(ReferenceKind::FilePlaceholder, 1)]
        );
        assert_eq!(
            kinds("respond a#b {env.X}"),
            vec![(ReferenceKind::EnvPlaceholder, 1)]
        );
    }

    #[test]
    fn scan_ignores_placeholders_in_comments() {
        assert!(kinds("# {file./etc/x} {env.X}").is_empty());
    }

    #[test]
    fn scan_reports_tls_only_when_arguments_follow() {
        assert_eq!(
            kinds("tls internal\ntls\ntls a.pem b.key\nexample.com {\n\ttls {\n\t}\n}"),
            vec![
                (ReferenceKind::TlsArguments, 1),
                (ReferenceKind::TlsArguments, 3),
            ]
        );
    }

    #[test]
    fn scan_reports_one_entry_per_kind_per_line() {
        assert_eq!(
            kinds("respond {env.A} {env.B} {file.C}"),
            vec![
                (ReferenceKind::FilePlaceholder, 1),
                (ReferenceKind::EnvPlaceholder, 1),
            ]
        );
    }

    #[test]
    fn scan_counts_lines_from_one_across_crlf() {
        assert_eq!(kinds("a\r\nimport x"), vec![(ReferenceKind::Import, 2)]);
    }

    #[test]
    fn scan_of_a_plain_configuration_is_empty() {
        assert!(kinds("example.com {\n\treverse_proxy http://127.0.0.1:3000\n}").is_empty());
    }

    #[test]
    fn scan_never_reports_the_content_of_a_reference() {
        let found = scan_external_references("import /Users/someone/secret.caddy");

        let serialized = serde_json::to_string(&found).expect("serialize");
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("/Users"));
    }

    #[test]
    fn adapt_and_validate_use_fixed_arguments_only() {
        let config = Path::new("/private/Caddyfile");
        let expected = |sub: &str| -> Vec<OsString> {
            vec![
                sub.into(),
                "--config".into(),
                "/private/Caddyfile".into(),
                "--adapter".into(),
                "caddyfile".into(),
            ]
        };

        assert_eq!(adapt_arguments(config), expected("adapt"));
        assert_eq!(validate_arguments(config), expected("validate"));
    }

    #[test]
    fn environment_is_minimal_and_points_storage_into_the_scratch_directory() {
        let scratch = Path::new("/tmp/scratch-x");

        let environment = minimal_environment(scratch);

        let names: BTreeSet<&str> = environment.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names,
            BTreeSet::from([
                "HOME",
                "PATH",
                "TMPDIR",
                "XDG_CACHE_HOME",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
            ])
        );
        for (name, value) in &environment {
            if *name != "PATH" {
                assert!(
                    Path::new(value).starts_with(scratch),
                    "{name} must stay in scratch"
                );
            }
        }
    }

    #[test]
    fn diagnostics_keep_the_wording_and_extract_the_line_number() {
        let directory = Path::new("/tmp/x/checks/abc");
        let stderr = format!(
            "Error: adapting config: {}/Caddyfile:3: unrecognized directive: foo\n",
            directory.display()
        );

        let diagnostics = diagnostics_from(stderr.as_bytes(), directory);

        assert_eq!(
            diagnostics,
            vec![CaddyDiagnostic {
                line: Some(3),
                message: "adapting config: Caddyfile:3: unrecognized directive: foo".to_owned(),
            }]
        );
    }

    #[test]
    fn diagnostics_never_expose_the_private_directory() {
        let directory = Path::new("/Users/someone/Library/caddy/checks/abc");
        let stderr = format!("Error: {}/Caddyfile:1: bad\n", directory.display());

        let diagnostics = diagnostics_from(stderr.as_bytes(), directory);

        assert!(
            diagnostics
                .iter()
                .all(|item| !item.message.contains("/Users/someone"))
        );
        assert_eq!(diagnostics[0].message, "Caddyfile:1: bad");
    }

    #[test]
    fn diagnostics_fall_back_to_a_generic_message_when_stderr_is_empty() {
        let diagnostics = diagnostics_from(b"", Path::new("/tmp/x"));

        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].line, None);
    }

    #[test]
    fn diagnostics_are_capped_and_long_messages_truncated() {
        let many = "line\n".repeat(50);
        assert_eq!(
            diagnostics_from(many.as_bytes(), Path::new("/tmp/x")).len(),
            20
        );

        let long = format!("Error: {}", "a".repeat(1000));
        let message = &diagnostics_from(long.as_bytes(), Path::new("/tmp/x"))[0].message;
        assert_eq!(message.chars().count(), 500);
    }

    #[test]
    fn config_line_requires_digits_right_after_the_marker() {
        assert_eq!(config_line("Caddyfile:12: x"), Some(12));
        assert_eq!(config_line("Caddyfile:x: y"), None);
        assert_eq!(config_line("no marker here"), None);
    }

    #[test]
    fn strip_comment_keeps_hashes_inside_quotes_and_inside_words() {
        assert_eq!(strip_comment("respond \"#x\" # tail"), "respond \"#x\" ");
        assert_eq!(strip_comment("a#b"), "a#b");
        assert_eq!(strip_comment("# all"), "");
    }

    #[test]
    fn run_id_accepts_short_dashed_ids_only() {
        assert!(valid_run_id("run-1"));
        assert!(!valid_run_id(""));
        assert!(!valid_run_id("run 1"));
        assert!(!valid_run_id("../x"));
        assert!(!valid_run_id(&"a".repeat(65)));
    }

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("canonical temp dir")
                .join(format!("userhome-validate-{}", Uuid::new_v4()));
            fs::create_dir_all(root.join("checks")).expect("checks root");
            Self(root)
        }

        fn checks(&self) -> PathBuf {
            self.0.join("checks")
        }

        fn is_empty(directory: &Path) -> bool {
            fs::read_dir(directory).expect("read dir").next().is_none()
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[derive(Debug, Clone)]
    struct Call {
        arguments: Vec<OsString>,
        cwd: PathBuf,
        environment: Vec<(&'static str, OsString)>,
        config_text: String,
        config_mode: u32,
    }

    impl Call {
        fn subcommand(&self) -> &str {
            self.arguments[0].to_str().expect("utf8 subcommand")
        }
    }

    /// Answers each run with the next scripted response and records what it saw,
    /// including the config file content and mode while it still exists.
    struct FakeRunner {
        responses: RefCell<Vec<Result<RunOutput, RunFailure>>>,
        calls: RefCell<Vec<Call>>,
    }

    impl FakeRunner {
        fn new(responses: Vec<Result<RunOutput, RunFailure>>) -> Self {
            Self {
                responses: RefCell::new(responses),
                calls: RefCell::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<Call> {
            self.calls.borrow().clone()
        }
    }

    impl CaddyRunner for FakeRunner {
        fn run(&self, spec: &RunSpec, _cancel: &AtomicBool) -> Result<RunOutput, RunFailure> {
            let position = spec
                .arguments
                .iter()
                .position(|argument| argument.as_os_str() == "--config")
                .expect("config argument");
            let config = PathBuf::from(&spec.arguments[position + 1]);
            self.calls.borrow_mut().push(Call {
                arguments: spec.arguments.clone(),
                cwd: spec.cwd.clone(),
                environment: spec.environment.clone(),
                config_text: fs::read_to_string(&config).expect("config exists during run"),
                config_mode: fs::metadata(&config)
                    .expect("config metadata")
                    .permissions()
                    .mode()
                    & 0o777,
            });
            let mut responses = self.responses.borrow_mut();
            assert!(!responses.is_empty(), "unexpected run");
            responses.remove(0)
        }
    }

    fn request(text: &str, allow: bool) -> CheckRequest<'_> {
        CheckRequest {
            executable: Path::new("/opt/homebrew/bin/caddy"),
            text,
            allow_external_references: allow,
        }
    }

    fn json_ok() -> Result<RunOutput, RunFailure> {
        Ok(RunOutput {
            success: true,
            stdout: b"{\"apps\":{}}".to_vec(),
            stderr: Vec::new(),
        })
    }

    fn empty_ok() -> Result<RunOutput, RunFailure> {
        Ok(RunOutput {
            success: true,
            stdout: Vec::new(),
            stderr: Vec::new(),
        })
    }

    fn failed(stderr: &str) -> Result<RunOutput, RunFailure> {
        Ok(RunOutput {
            success: false,
            stdout: Vec::new(),
            stderr: stderr.as_bytes().to_vec(),
        })
    }

    const CLEAN: &str = "example.com {\n\treverse_proxy http://127.0.0.1:3000\n}\n";

    #[test]
    fn external_references_stop_before_anything_runs() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![]);

        let report = check(
            &request("import x\n", false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::ExternalReferences);
        assert_eq!(report.stage, None);
        assert_eq!(
            report.external_references,
            vec![ExternalReference {
                kind: ReferenceKind::Import,
                line: 1,
            }]
        );
        assert!(runner.calls().is_empty());
        assert!(TempRoot::is_empty(&root.checks()));
    }

    #[test]
    fn allowed_external_references_still_run_adapt_then_validate_in_scratch() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![json_ok(), empty_ok()]);
        let text = "import x\n";

        let report = check(
            &request(text, true),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Valid);
        assert_eq!(report.stage, Some(CheckStage::Validate));
        assert_eq!(report.external_references.len(), 1);
        let calls = runner.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].subcommand(), "adapt");
        assert_eq!(calls[1].subcommand(), "validate");
        for call in &calls {
            assert!(call.cwd.starts_with(root.checks()));
            assert_ne!(call.cwd, root.checks());
            assert_eq!(call.config_text, text);
            assert_eq!(call.config_mode, FILE_MODE);
        }
        assert!(TempRoot::is_empty(&root.checks()));
    }

    #[test]
    fn a_clean_configuration_runs_without_the_external_gate() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![json_ok(), empty_ok()]);

        let report = check(
            &request(CLEAN, false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Valid);
        assert!(report.external_references.is_empty());
        assert_eq!(runner.calls().len(), 2);
    }

    #[test]
    fn every_run_gets_the_minimal_environment_and_no_inherited_secrets() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![json_ok(), empty_ok()]);

        check(
            &request(CLEAN, false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        for call in runner.calls() {
            let names: BTreeSet<&str> = call.environment.iter().map(|(name, _)| *name).collect();
            assert!(names.contains("HOME"));
            assert!(!names.contains("SSH_AUTH_SOCK"));
            assert_eq!(names.len(), 7);
        }
    }

    #[test]
    fn adapt_failure_is_invalid_and_validate_never_runs() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![failed("Error: Caddyfile:2: unknown directive: foo\n")]);

        let report = check(
            &request(CLEAN, false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Invalid);
        assert_eq!(report.stage, Some(CheckStage::Adapt));
        assert_eq!(report.diagnostics[0].line, Some(2));
        assert_eq!(runner.calls().len(), 1);
        assert!(TempRoot::is_empty(&root.checks()));
    }

    #[test]
    fn adapt_output_that_is_not_json_is_invalid() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![Ok(RunOutput {
            success: true,
            stdout: b"not json".to_vec(),
            stderr: Vec::new(),
        })]);

        let report = check(
            &request(CLEAN, false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Invalid);
        assert_eq!(report.stage, Some(CheckStage::Adapt));
        assert_eq!(runner.calls().len(), 1);
    }

    #[test]
    fn adapt_json_that_is_not_an_object_is_invalid() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![Ok(RunOutput {
            success: true,
            stdout: b"[1]".to_vec(),
            stderr: Vec::new(),
        })]);

        let report = check(
            &request(CLEAN, false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Invalid);
    }

    #[test]
    fn validate_failure_is_reported_at_the_validate_stage() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![
            json_ok(),
            failed("Error: Caddyfile:1: module not found: foo\n"),
        ]);

        let report = check(
            &request(CLEAN, false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Invalid);
        assert_eq!(report.stage, Some(CheckStage::Validate));
        assert_eq!(report.diagnostics[0].line, Some(1));
        assert_eq!(runner.calls().len(), 2);
    }

    #[test]
    fn runner_failures_map_to_their_statuses_without_a_verdict() {
        let cases = [
            (RunFailure::Timeout, ValidationStatus::Timeout),
            (RunFailure::Cancelled, ValidationStatus::Cancelled),
            (RunFailure::OutputTooLarge, ValidationStatus::OutputTooLarge),
            (RunFailure::Unavailable, ValidationStatus::Unavailable),
        ];
        for (failure, status) in cases {
            let root = TempRoot::new();
            let runner = FakeRunner::new(vec![Err(failure)]);

            let report = check(
                &request(CLEAN, false),
                &root.checks(),
                &runner,
                &AtomicBool::new(false),
            )
            .expect("report");

            assert_eq!(report.status, status, "{failure:?}");
            assert_eq!(report.stage, Some(CheckStage::Adapt));
            assert!(!report.diagnostics.is_empty());
            assert_eq!(runner.calls().len(), 1);
        }
    }

    #[test]
    fn oversized_text_is_refused_before_anything_is_written() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![]);
        let text = "a".repeat(MAX_CHECK_BYTES + 1);

        let error = check(
            &request(&text, true),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect_err("refused");

        assert_eq!(error.code(), AppErrorCode::InvalidInput);
        assert!(runner.calls().is_empty());
        assert!(TempRoot::is_empty(&root.checks()));
    }

    #[test]
    fn report_serializes_camel_case_keys_and_states_the_limitation() {
        let root = TempRoot::new();
        let runner = FakeRunner::new(vec![]);
        let report = check(
            &request("import x\n", false),
            &root.checks(),
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        let value = serde_json::to_value(&report).expect("serialize");

        assert_eq!(value["status"], "EXTERNAL_REFERENCES");
        assert_eq!(value["externalReferences"][0]["kind"], "IMPORT");
        assert!(value.get("stage").is_none());
        assert!(
            value["limitation"]
                .as_str()
                .expect("text")
                .contains("provision")
        );
    }

    #[test]
    fn a_run_id_cannot_be_registered_twice_and_is_freed_on_drop() {
        let runs = ValidationRuns::default();
        let first = runs.begin("run-1").expect("begin");

        assert_eq!(
            runs.begin("run-1").err().map(|error| error.code()),
            Some(AppErrorCode::Conflict)
        );
        drop(first);
        assert!(runs.begin("run-1").is_ok());
    }

    #[test]
    fn cancel_sets_the_flag_of_an_active_run_only() {
        let runs = ValidationRuns::default();
        let handle = runs.begin("run-2").expect("begin");
        assert!(!handle.cancel_flag().load(Ordering::SeqCst));

        assert!(runs.cancel("run-2").expect("cancel"));
        assert!(handle.cancel_flag().load(Ordering::SeqCst));
        assert!(!runs.cancel("missing").expect("cancel"));
    }

    fn fake_executable(root: &TempRoot, body: &str) -> PathBuf {
        let path = root.0.join("fake-caddy");
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("fixture");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("mode");
        path
    }

    fn system_spec(root: &TempRoot, executable: PathBuf, timeout: Duration) -> RunSpec {
        RunSpec {
            executable,
            arguments: Vec::new(),
            cwd: root.0.clone(),
            environment: minimal_environment(&root.0),
            timeout,
            max_output_bytes: 1024,
        }
    }

    #[test]
    fn system_runner_collects_output_and_exit_status() {
        let root = TempRoot::new();
        let executable = fake_executable(&root, "echo '{\"apps\":{}}'");
        let spec = system_spec(&root, executable, Duration::from_secs(5));

        let output = SystemCaddyRunner
            .run(&spec, &AtomicBool::new(false))
            .expect("run");

        assert!(output.success);
        assert!(String::from_utf8_lossy(&output.stdout).contains("apps"));
    }

    #[test]
    fn system_runner_stops_a_child_that_outlives_the_timeout() {
        let root = TempRoot::new();
        let executable = fake_executable(&root, "exec sleep 30");
        let spec = system_spec(&root, executable, Duration::from_millis(200));

        let failure = SystemCaddyRunner
            .run(&spec, &AtomicBool::new(false))
            .expect_err("timed out");

        assert_eq!(failure, RunFailure::Timeout);
    }

    #[test]
    fn system_runner_honours_cancellation_before_the_timeout() {
        let root = TempRoot::new();
        let executable = fake_executable(&root, "exec sleep 30");
        let spec = system_spec(&root, executable, Duration::from_secs(30));

        let failure = SystemCaddyRunner
            .run(&spec, &AtomicBool::new(true))
            .expect_err("cancelled");

        assert_eq!(failure, RunFailure::Cancelled);
    }

    #[test]
    fn system_runner_refuses_output_past_the_limit() {
        let root = TempRoot::new();
        let executable =
            fake_executable(&root, "exec dd if=/dev/zero bs=1024 count=64 2>/dev/null");
        let spec = system_spec(&root, executable, Duration::from_secs(5));

        let failure = SystemCaddyRunner
            .run(&spec, &AtomicBool::new(false))
            .expect_err("too large");

        assert_eq!(failure, RunFailure::OutputTooLarge);
    }

    #[test]
    fn system_runner_reports_a_missing_executable_as_unavailable() {
        let root = TempRoot::new();
        let spec = system_spec(&root, root.0.join("missing"), Duration::from_secs(5));

        let failure = SystemCaddyRunner
            .run(&spec, &AtomicBool::new(false))
            .expect_err("unavailable");

        assert_eq!(failure, RunFailure::Unavailable);
    }
}
