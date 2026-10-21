//! Detection of the Caddy executable.
//!
//! Only fixed Homebrew locations and, when the user chose one through the
//! grant picker, that single file are inspected. The version is read with the
//! fixed argument `version` through an injected runner, so tests never execute
//! a real binary. A passing check here is a structural check, not a guarantee
//! that the binary is trustworthy.

use std::{
    fs,
    io::Read,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;

pub const VERSION_ARGUMENT: &str = "version";
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(3);
pub const MAX_VERSION_OUTPUT_BYTES: usize = 4096;
const MAX_VERSION_LINE_CHARS: usize = 200;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
const ANY_EXECUTE_BIT: u32 = 0o111;
const GROUP_OR_WORLD_WRITE_BITS: u32 = 0o022;

const MISSING_GUIDANCE: &str = "未找到 Caddy。请先通过 Homebrew 手动安装（brew install caddy），或选择已安装的 caddy 可执行文件。本应用不会静默安装。";
const FIXED_INVALID_GUIDANCE: &str =
    "找到了 Caddy，但它不能被使用。请检查安装，或选择其他可执行文件；本应用不会自动修复或安装。";
const USER_INVALID_GUIDANCE: &str = "所选文件不是可用的 Caddy 可执行文件，请重新选择或取消选择。";
const TIMEOUT_GUIDANCE: &str = "运行 caddy version 超时，已放弃该可执行文件。";
const FAILED_GUIDANCE: &str = "无法运行 caddy version，请确认该文件是可用的 Caddy 可执行文件。";
const UNRECOGNIZED_GUIDANCE: &str = "caddy version 的输出无法识别，已放弃该可执行文件。";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutableSource {
    Fixed,
    UserSelected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub source: ExecutableSource,
    pub path: PathBuf,
    /// When set, the canonical target must lie below this canonical directory.
    pub root: Option<PathBuf>,
}

impl Candidate {
    fn fixed(path: &str, root: &str) -> Self {
        Self {
            source: ExecutableSource::Fixed,
            path: PathBuf::from(path),
            root: Some(PathBuf::from(root)),
        }
    }

    pub fn user_selected(path: PathBuf) -> Self {
        Self {
            source: ExecutableSource::UserSelected,
            path,
            root: None,
        }
    }
}

pub fn fixed_candidates() -> Vec<Candidate> {
    vec![
        Candidate::fixed("/opt/homebrew/bin/caddy", "/opt/homebrew"),
        Candidate::fixed("/usr/local/bin/caddy", "/usr/local"),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateOutcome {
    Missing,
    Unreadable,
    OutsideRoot,
    NotRegularFile,
    NotExecutable,
    GroupOrWorldWritable,
    Usable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateCheck {
    pub source: ExecutableSource,
    pub display_path: String,
    pub outcome: CandidateOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DetectStatus {
    Available,
    Missing,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectReport {
    pub status: DetectStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guidance: Option<&'static str>,
    pub candidates: Vec<CandidateCheck>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionError {
    Timeout,
    Failed,
    Unrecognized,
}

impl VersionError {
    fn guidance(self) -> &'static str {
        match self {
            Self::Timeout => TIMEOUT_GUIDANCE,
            Self::Failed => FAILED_GUIDANCE,
            Self::Unrecognized => UNRECOGNIZED_GUIDANCE,
        }
    }
}

pub trait VersionRunner {
    fn version(&self, executable: &Path) -> Result<String, VersionError>;
}

pub struct SystemVersionRunner;

impl VersionRunner for SystemVersionRunner {
    fn version(&self, executable: &Path) -> Result<String, VersionError> {
        let mut child = Command::new(executable)
            .arg(VERSION_ARGUMENT)
            .env_clear()
            .current_dir("/")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| VersionError::Failed)?;
        let stdout = child.stdout.take().ok_or(VersionError::Failed)?;
        let reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .take(MAX_VERSION_OUTPUT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        });
        let deadline = Instant::now() + VERSION_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(VersionError::Timeout);
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(VersionError::Failed);
                }
            }
        };
        let bytes = reader
            .join()
            .map_err(|_| VersionError::Failed)?
            .map_err(|_| VersionError::Failed)?;
        if !status.success() {
            return Err(VersionError::Failed);
        }
        parse_version(&bytes)
    }
}

pub fn parse_version(bytes: &[u8]) -> Result<String, VersionError> {
    if bytes.len() > MAX_VERSION_OUTPUT_BYTES {
        return Err(VersionError::Unrecognized);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| VersionError::Unrecognized)?;
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty()
        || line.chars().count() > MAX_VERSION_LINE_CHARS
        || line.chars().any(char::is_control)
    {
        return Err(VersionError::Unrecognized);
    }
    Ok(line.to_owned())
}

pub fn detect(
    user: Option<Candidate>,
    fixed: &[Candidate],
    runner: &dyn VersionRunner,
) -> DetectReport {
    if let Some(candidate) = user {
        let (outcome, usable) = inspect(&candidate);
        let checks = vec![check(&candidate, outcome)];
        return match usable {
            Some(path) => verify(&path, checks, runner),
            None => invalid(checks, USER_INVALID_GUIDANCE),
        };
    }

    let mut checks = Vec::new();
    for candidate in fixed {
        let (outcome, usable) = inspect(candidate);
        checks.push(check(candidate, outcome));
        if let Some(path) = usable {
            return verify(&path, checks, runner);
        }
    }
    if checks
        .iter()
        .any(|check| check.outcome != CandidateOutcome::Missing)
    {
        invalid(checks, FIXED_INVALID_GUIDANCE)
    } else {
        DetectReport {
            status: DetectStatus::Missing,
            executable_path: None,
            version: None,
            guidance: Some(MISSING_GUIDANCE),
            candidates: checks,
        }
    }
}

pub fn inspect(candidate: &Candidate) -> (CandidateOutcome, Option<PathBuf>) {
    let resolved = match fs::canonicalize(&candidate.path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (CandidateOutcome::Missing, None);
        }
        Err(_) => return (CandidateOutcome::Unreadable, None),
    };
    if let Some(root) = &candidate.root {
        let inside_root = fs::canonicalize(root).is_ok_and(|root| resolved.starts_with(root));
        if !inside_root {
            return (CandidateOutcome::OutsideRoot, None);
        }
    }
    let metadata = match fs::metadata(&resolved) {
        Ok(metadata) => metadata,
        Err(_) => return (CandidateOutcome::Unreadable, None),
    };
    if !metadata.is_file() {
        return (CandidateOutcome::NotRegularFile, None);
    }
    let mode = metadata.permissions().mode();
    if mode & ANY_EXECUTE_BIT == 0 {
        return (CandidateOutcome::NotExecutable, None);
    }
    if mode & GROUP_OR_WORLD_WRITE_BITS != 0 {
        return (CandidateOutcome::GroupOrWorldWritable, None);
    }
    (CandidateOutcome::Usable, Some(resolved))
}

fn verify(
    path: &Path,
    candidates: Vec<CandidateCheck>,
    runner: &dyn VersionRunner,
) -> DetectReport {
    match runner.version(path) {
        Ok(version) => DetectReport {
            status: DetectStatus::Available,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: Some(version),
            guidance: None,
            candidates,
        },
        Err(error) => invalid(candidates, error.guidance()),
    }
}

fn invalid(candidates: Vec<CandidateCheck>, guidance: &'static str) -> DetectReport {
    DetectReport {
        status: DetectStatus::Invalid,
        executable_path: None,
        version: None,
        guidance: Some(guidance),
        candidates,
    }
}

fn check(candidate: &Candidate, outcome: CandidateOutcome) -> CandidateCheck {
    CandidateCheck {
        source: candidate.source,
        display_path: candidate.path.to_string_lossy().into_owned(),
        outcome,
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, os::unix::fs::symlink};

    use uuid::Uuid;

    use super::*;

    struct FakeRunner {
        result: Result<String, VersionError>,
        calls: RefCell<Vec<PathBuf>>,
    }

    impl FakeRunner {
        fn answering(result: Result<&str, VersionError>) -> Self {
            Self {
                result: result.map(str::to_owned),
                calls: RefCell::new(Vec::new()),
            }
        }

        fn calls(&self) -> Vec<PathBuf> {
            self.calls.borrow().clone()
        }
    }

    impl VersionRunner for FakeRunner {
        fn version(&self, executable: &Path) -> Result<String, VersionError> {
            self.calls.borrow_mut().push(executable.to_path_buf());
            self.result.clone()
        }
    }

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("canonical temp dir")
                .join(format!("userhome-caddy-detect-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("temp root");
            Self(root)
        }

        fn path(&self, relative: &str) -> PathBuf {
            self.0.join(relative)
        }

        fn executable(&self, relative: &str, mode: u32) -> PathBuf {
            let path = self.path(relative);
            fs::create_dir_all(path.parent().expect("parent")).expect("parent directory");
            fs::write(&path, b"#!/bin/sh\n").expect("fixture file");
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).expect("mode");
            path
        }

        fn homebrew(&self) -> Candidate {
            Candidate {
                source: ExecutableSource::Fixed,
                path: self.path("opt/homebrew/bin/caddy"),
                root: Some(self.path("opt/homebrew")),
            }
        }

        fn usr_local(&self) -> Candidate {
            Candidate {
                source: ExecutableSource::Fixed,
                path: self.path("usr/local/bin/caddy"),
                root: Some(self.path("usr/local")),
            }
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn outcomes(report: &DetectReport) -> Vec<CandidateOutcome> {
        report
            .candidates
            .iter()
            .map(|check| check.outcome)
            .collect()
    }

    #[test]
    fn missing_fixed_candidates_report_guidance_and_never_run_anything() {
        let root = TempRoot::new();
        let runner = FakeRunner::answering(Ok("never used"));

        let report = detect(None, &[root.homebrew(), root.usr_local()], &runner);

        assert_eq!(report.status, DetectStatus::Missing);
        assert_eq!(report.guidance, Some(MISSING_GUIDANCE));
        assert_eq!(report.executable_path, None);
        assert_eq!(
            outcomes(&report),
            vec![CandidateOutcome::Missing, CandidateOutcome::Missing]
        );
        assert!(runner.calls().is_empty());
    }

    #[test]
    fn regular_executable_in_a_fixed_location_is_available() {
        let root = TempRoot::new();
        let executable = root.executable("opt/homebrew/bin/caddy", 0o755);
        let runner = FakeRunner::answering(Ok("v2.8.4 h1:fixture"));

        let report = detect(None, &[root.homebrew()], &runner);

        let canonical = fs::canonicalize(&executable).expect("canonical");
        assert_eq!(report.status, DetectStatus::Available);
        assert_eq!(
            report.executable_path,
            Some(canonical.to_string_lossy().into_owned())
        );
        assert_eq!(report.version.as_deref(), Some("v2.8.4 h1:fixture"));
        assert_eq!(report.guidance, None);
        assert_eq!(outcomes(&report), vec![CandidateOutcome::Usable]);
        assert_eq!(runner.calls(), vec![canonical]);
    }

    #[test]
    fn homebrew_style_symlink_into_the_cellar_is_available() {
        let root = TempRoot::new();
        root.executable("opt/homebrew/Cellar/caddy/2.8.4/bin/caddy", 0o755);
        fs::create_dir_all(root.path("opt/homebrew/bin")).expect("bin");
        symlink(
            "../Cellar/caddy/2.8.4/bin/caddy",
            root.path("opt/homebrew/bin/caddy"),
        )
        .expect("symlink");
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.status, DetectStatus::Available);
        assert_eq!(outcomes(&report), vec![CandidateOutcome::Usable]);
    }

    #[test]
    fn symlink_escaping_the_fixed_root_is_refused_and_not_run() {
        let root = TempRoot::new();
        let outside = root.executable("elsewhere/caddy", 0o755);
        fs::create_dir_all(root.path("opt/homebrew/bin")).expect("bin");
        symlink(&outside, root.path("opt/homebrew/bin/caddy")).expect("symlink");
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(outcomes(&report), vec![CandidateOutcome::OutsideRoot]);
        assert!(runner.calls().is_empty());
    }

    #[test]
    fn non_executable_file_is_invalid() {
        let root = TempRoot::new();
        root.executable("opt/homebrew/bin/caddy", 0o644);
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(outcomes(&report), vec![CandidateOutcome::NotExecutable]);
        assert!(runner.calls().is_empty());
    }

    #[test]
    fn group_or_world_writable_executable_is_refused() {
        for mode in [0o775, 0o757] {
            let root = TempRoot::new();
            root.executable("opt/homebrew/bin/caddy", mode);
            let runner = FakeRunner::answering(Ok("v2.8.4"));

            let report = detect(None, &[root.homebrew()], &runner);

            assert_eq!(report.status, DetectStatus::Invalid, "mode {mode:o}");
            assert_eq!(
                outcomes(&report),
                vec![CandidateOutcome::GroupOrWorldWritable],
                "mode {mode:o}"
            );
            assert!(runner.calls().is_empty());
        }
    }

    #[test]
    fn directory_at_the_candidate_path_is_not_a_regular_file() {
        let root = TempRoot::new();
        fs::create_dir_all(root.path("opt/homebrew/bin/caddy")).expect("directory");
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(outcomes(&report), vec![CandidateOutcome::NotRegularFile]);
    }

    #[test]
    fn dangling_symlink_counts_as_missing() {
        let root = TempRoot::new();
        fs::create_dir_all(root.path("opt/homebrew/bin")).expect("bin");
        symlink(root.path("nowhere"), root.path("opt/homebrew/bin/caddy")).expect("symlink");
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.status, DetectStatus::Missing);
        assert_eq!(outcomes(&report), vec![CandidateOutcome::Missing]);
    }

    #[test]
    fn a_later_fixed_candidate_is_used_when_the_first_is_missing() {
        let root = TempRoot::new();
        root.executable("usr/local/bin/caddy", 0o755);
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(None, &[root.homebrew(), root.usr_local()], &runner);

        assert_eq!(report.status, DetectStatus::Available);
        assert_eq!(
            outcomes(&report),
            vec![CandidateOutcome::Missing, CandidateOutcome::Usable]
        );
    }

    #[test]
    fn a_broken_fixed_candidate_is_invalid_even_when_another_is_missing() {
        let root = TempRoot::new();
        root.executable("opt/homebrew/bin/caddy", 0o644);
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(None, &[root.homebrew(), root.usr_local()], &runner);

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(report.guidance, Some(FIXED_INVALID_GUIDANCE));
    }

    #[test]
    fn user_selected_executable_is_used_without_inspecting_fixed_candidates() {
        let root = TempRoot::new();
        let chosen = root.executable("home/bin/caddy", 0o755);
        root.executable("opt/homebrew/bin/caddy", 0o755);
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(
            Some(Candidate::user_selected(chosen.clone())),
            &[root.homebrew()],
            &runner,
        );

        let canonical = fs::canonicalize(&chosen).expect("canonical");
        assert_eq!(report.status, DetectStatus::Available);
        assert_eq!(
            report.executable_path,
            Some(canonical.to_string_lossy().into_owned())
        );
        assert_eq!(report.candidates.len(), 1);
        assert_eq!(report.candidates[0].source, ExecutableSource::UserSelected);
        assert_eq!(runner.calls(), vec![canonical]);
    }

    #[test]
    fn invalid_user_selection_does_not_silently_fall_back_to_a_fixed_install() {
        let root = TempRoot::new();
        let chosen = root.executable("home/bin/caddy", 0o644);
        root.executable("opt/homebrew/bin/caddy", 0o755);
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(
            Some(Candidate::user_selected(chosen)),
            &[root.homebrew()],
            &runner,
        );

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(report.executable_path, None);
        assert_eq!(report.guidance, Some(USER_INVALID_GUIDANCE));
        assert_eq!(outcomes(&report), vec![CandidateOutcome::NotExecutable]);
        assert!(runner.calls().is_empty());
    }

    #[test]
    fn a_missing_user_selection_is_invalid_not_missing() {
        let root = TempRoot::new();
        let runner = FakeRunner::answering(Ok("v2.8.4"));

        let report = detect(
            Some(Candidate::user_selected(root.path("home/bin/caddy"))),
            &[],
            &runner,
        );

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(outcomes(&report), vec![CandidateOutcome::Missing]);
    }

    #[test]
    fn version_timeout_makes_the_executable_invalid_without_a_version() {
        let root = TempRoot::new();
        root.executable("opt/homebrew/bin/caddy", 0o755);
        let runner = FakeRunner::answering(Err(VersionError::Timeout));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(report.guidance, Some(TIMEOUT_GUIDANCE));
        assert_eq!(report.version, None);
        assert_eq!(report.executable_path, None);
    }

    #[test]
    fn unrecognized_version_output_makes_the_executable_invalid() {
        let root = TempRoot::new();
        root.executable("opt/homebrew/bin/caddy", 0o755);
        let runner = FakeRunner::answering(Err(VersionError::Unrecognized));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.status, DetectStatus::Invalid);
        assert_eq!(report.guidance, Some(UNRECOGNIZED_GUIDANCE));
    }

    #[test]
    fn version_failure_is_reported_as_failed_guidance() {
        let root = TempRoot::new();
        root.executable("opt/homebrew/bin/caddy", 0o755);
        let runner = FakeRunner::answering(Err(VersionError::Failed));

        let report = detect(None, &[root.homebrew()], &runner);

        assert_eq!(report.guidance, Some(FAILED_GUIDANCE));
    }

    #[test]
    fn version_line_is_the_first_line_and_must_be_printable() {
        assert_eq!(
            parse_version(b"v2.8.4 h1:abc\nextra line\n"),
            Ok("v2.8.4 h1:abc".to_owned())
        );
        assert_eq!(parse_version(b"  v2.8.4  \n"), Ok("v2.8.4".to_owned()));
    }

    #[test]
    fn version_output_that_is_empty_binary_or_too_long_is_unrecognized() {
        assert_eq!(parse_version(b""), Err(VersionError::Unrecognized));
        assert_eq!(parse_version(b"\n"), Err(VersionError::Unrecognized));
        assert_eq!(
            parse_version(&[0xff, 0xfe]),
            Err(VersionError::Unrecognized)
        );
        assert_eq!(
            parse_version(b"v2\x07bell"),
            Err(VersionError::Unrecognized)
        );
        assert_eq!(parse_version(b"v2\x00"), Err(VersionError::Unrecognized));
        let long_line = "a".repeat(MAX_VERSION_LINE_CHARS + 1);
        assert_eq!(
            parse_version(long_line.as_bytes()),
            Err(VersionError::Unrecognized)
        );
        let at_limit = "a".repeat(MAX_VERSION_LINE_CHARS);
        assert_eq!(parse_version(at_limit.as_bytes()), Ok(at_limit));
        let oversized = vec![b'v'; MAX_VERSION_OUTPUT_BYTES + 1];
        assert_eq!(parse_version(&oversized), Err(VersionError::Unrecognized));
    }

    #[test]
    fn version_probe_uses_a_fixed_argument_and_bounded_limits() {
        assert_eq!(VERSION_ARGUMENT, "version");
        assert_eq!(VERSION_TIMEOUT, Duration::from_secs(3));
        assert_eq!(MAX_VERSION_OUTPUT_BYTES, 4096);
    }

    #[test]
    fn fixed_candidates_are_the_two_homebrew_locations_only() {
        let paths: Vec<PathBuf> = fixed_candidates()
            .into_iter()
            .map(|candidate| candidate.path)
            .collect();

        assert_eq!(
            paths,
            vec![
                PathBuf::from("/opt/homebrew/bin/caddy"),
                PathBuf::from("/usr/local/bin/caddy"),
            ]
        );
    }

    #[test]
    fn missing_report_omits_optional_fields_in_json() {
        let report = DetectReport {
            status: DetectStatus::Missing,
            executable_path: None,
            version: None,
            guidance: Some(MISSING_GUIDANCE),
            candidates: Vec::new(),
        };

        let value = serde_json::to_value(&report).expect("serialize");

        assert_eq!(value["status"], "MISSING");
        assert!(value.get("executablePath").is_none());
        assert!(value.get("version").is_none());
    }
}
