use std::{
    cell::RefCell,
    collections::BTreeMap,
    env,
    ffi::OsStr,
    fs,
    os::unix::fs::{PermissionsExt, symlink},
};

use uuid::Uuid;

use crate::app_config::{registry::Registry, test_support::FakeFs};

use super::*;

const HOME: &str = "/Users/example";

struct FakeVersion {
    by_name: BTreeMap<String, String>,
    fallback: Option<String>,
    calls: RefCell<Vec<PathBuf>>,
}

impl FakeVersion {
    fn none() -> Self {
        Self {
            by_name: BTreeMap::new(),
            fallback: None,
            calls: RefCell::new(Vec::new()),
        }
    }

    fn answering(pairs: &[(&str, &str)]) -> Self {
        Self {
            by_name: pairs
                .iter()
                .map(|(name, version)| ((*name).to_owned(), (*version).to_owned()))
                .collect(),
            fallback: None,
            calls: RefCell::new(Vec::new()),
        }
    }

    fn answering_everything(version: &str) -> Self {
        Self {
            by_name: BTreeMap::new(),
            fallback: Some(version.to_owned()),
            calls: RefCell::new(Vec::new()),
        }
    }

    fn calls(&self) -> Vec<PathBuf> {
        self.calls.borrow().clone()
    }
}

impl VersionProbe for FakeVersion {
    fn version(&self, executable: &Path) -> Option<String> {
        self.calls.borrow_mut().push(executable.to_path_buf());
        let name = executable.file_name()?.to_str()?;
        self.by_name
            .get(name)
            .cloned()
            .or_else(|| self.fallback.clone())
    }
}

struct TempRoot(PathBuf);

impl TempRoot {
    fn new() -> Self {
        let root = fs::canonicalize(env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-ai-detect-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("home")).expect("temp root");
        Self(root)
    }

    fn path(&self, relative: &str) -> PathBuf {
        self.0.join(relative)
    }

    fn home(&self) -> PathBuf {
        self.path("home")
    }

    fn locations(&self) -> Vec<FixedLocation> {
        vec![
            FixedLocation {
                bin_dir: self.path("opt/homebrew/bin"),
                root: self.path("opt/homebrew"),
            },
            FixedLocation {
                bin_dir: self.path("usr/local/bin"),
                root: self.path("usr/local"),
            },
            FixedLocation {
                bin_dir: self.path("home/.local/bin"),
                root: self.path("home/.local"),
            },
        ]
    }

    fn executable(&self, relative: &str, mode: u32) -> PathBuf {
        let path = self.path(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("parent directory");
        fs::write(&path, b"#!/bin/sh\n").expect("fixture file");
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).expect("mode");
        path
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run(
    home: &Path,
    locations: &[FixedLocation],
    version: &dyn VersionProbe,
    fs: &dyn ConfigFs,
) -> AiConfigReport {
    let registry = Registry::builtin().expect("built-in registry is valid");
    detect_all(&ProbeEnv {
        home,
        locations,
        version,
        fs,
        registry: &registry,
    })
}

fn tool(report: &AiConfigReport, id: ToolId) -> &ToolReport {
    report
        .tools
        .iter()
        .find(|tool| tool.id == id)
        .expect("every fixed tool is reported")
}

#[test]
fn tool_ids_are_the_four_fixed_tools_in_display_order() {
    let ids: Vec<String> = TOOL_PROFILES
        .iter()
        .map(|profile| {
            serde_json::to_value(profile.id)
                .expect("serialize")
                .as_str()
                .expect("string id")
                .to_owned()
        })
        .collect();
    let names: Vec<&str> = TOOL_PROFILES
        .iter()
        .map(|profile| profile.display_name)
        .collect();

    assert_eq!(
        ids,
        ["claude-code", "codex-cli", "gemini-cli", "copilot-cli"]
    );
    assert_eq!(
        names,
        [
            "Claude Code",
            "Codex CLI",
            "Gemini CLI",
            "GitHub Copilot CLI"
        ]
    );
}

#[test]
fn reference_urls_are_exactly_the_sources_recorded_in_the_spec() {
    let urls: Vec<&str> = TOOL_PROFILES
        .iter()
        .flat_map(|profile| profile.reference_urls.iter().copied())
        .collect();

    assert_eq!(
        urls,
        [
            "https://code.claude.com/docs/en/settings",
            "https://code.claude.com/docs/en/cli-reference",
            "https://developers.openai.com/codex/config-basic",
            "https://geminicli.com/docs/reference/configuration",
            "https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference",
        ]
    );
}

#[test]
fn only_claude_config_is_resolved_through_the_app_config_registry() {
    let registry = Registry::builtin().expect("built-in registry is valid");
    for profile in TOOL_PROFILES {
        match profile.config {
            ConfigSource::Registry(id) => {
                assert_eq!(profile.id, ToolId::ClaudeCode);
                assert_eq!(id, "claude-code-settings");
                assert!(registry.get(id).is_ok());
            }
            ConfigSource::NotRegistered => assert_ne!(profile.id, ToolId::ClaudeCode),
        }
    }
}

#[test]
fn fixed_locations_are_the_homebrew_prefixes_and_home_local_bin_only() {
    let bins: Vec<PathBuf> = fixed_locations(Path::new(HOME))
        .into_iter()
        .map(|location| location.bin_dir)
        .collect();

    assert_eq!(
        bins,
        vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/Users/example/.local/bin"),
        ]
    );
}

#[test]
fn missing_everywhere_reports_missing_and_never_runs_a_version_probe() {
    let root = TempRoot::new();
    let version = FakeVersion::answering_everything("1.0.0");

    let report = run(&root.home(), &root.locations(), &version, &FakeFs::new());

    assert_eq!(report.tools.len(), 4);
    for entry in &report.tools {
        assert_eq!(
            entry.install_status,
            InstallStatus::Missing,
            "{:?}",
            entry.id
        );
        assert_eq!(entry.display_path, None);
        assert_eq!(entry.version, None);
        assert_eq!(entry.invalid_reason, None);
    }
    assert!(version.calls().is_empty());
}

#[test]
fn missing_tool_still_shows_its_official_references_and_verification_note() {
    let root = TempRoot::new();

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::none(),
        &FakeFs::new(),
    );

    let copilot = tool(&report, ToolId::CopilotCli);
    assert_eq!(copilot.install_status, InstallStatus::Missing);
    assert_eq!(copilot.references.len(), 1);
    assert!(!copilot.verification_note.is_empty());
}

#[test]
fn regular_executable_in_a_fixed_location_is_found_and_its_version_is_read() {
    let root = TempRoot::new();
    root.executable("opt/homebrew/bin/claude", 0o755);
    let version = FakeVersion::answering(&[("claude", "2.1.0 (Claude Code)")]);

    let report = run(&root.home(), &root.locations(), &version, &FakeFs::new());

    let claude = tool(&report, ToolId::ClaudeCode);
    let expected = root
        .path("opt/homebrew/bin/claude")
        .to_string_lossy()
        .into_owned();
    assert_eq!(claude.install_status, InstallStatus::Found);
    assert_eq!(claude.display_path.as_deref(), Some(expected.as_str()));
    assert_eq!(claude.version.as_deref(), Some("2.1.0 (Claude Code)"));
    assert_eq!(version.calls().len(), 1);
}

#[test]
fn executable_under_home_is_displayed_with_a_tilde_prefix() {
    let root = TempRoot::new();
    root.executable("home/.local/bin/codex", 0o755);

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::answering(&[("codex", "0.9.0")]),
        &FakeFs::new(),
    );

    let codex = tool(&report, ToolId::CodexCli);
    assert_eq!(codex.install_status, InstallStatus::Found);
    assert_eq!(codex.display_path.as_deref(), Some("~/.local/bin/codex"));
}

#[test]
fn homebrew_style_symlink_into_its_cellar_is_found() {
    let root = TempRoot::new();
    root.executable("opt/homebrew/Cellar/claude/2.1.0/bin/claude", 0o755);
    fs::create_dir_all(root.path("opt/homebrew/bin")).expect("bin");
    symlink(
        "../Cellar/claude/2.1.0/bin/claude",
        root.path("opt/homebrew/bin/claude"),
    )
    .expect("symlink");

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::answering_everything("2.1.0"),
        &FakeFs::new(),
    );

    assert_eq!(
        tool(&report, ToolId::ClaudeCode).install_status,
        InstallStatus::Found
    );
}

#[test]
fn symlink_escaping_its_fixed_root_is_invalid_and_never_run() {
    let root = TempRoot::new();
    let outside = root.executable("elsewhere/claude", 0o755);
    fs::create_dir_all(root.path("opt/homebrew/bin")).expect("bin");
    symlink(&outside, root.path("opt/homebrew/bin/claude")).expect("symlink");
    let version = FakeVersion::answering_everything("2.1.0");

    let report = run(&root.home(), &root.locations(), &version, &FakeFs::new());

    let claude = tool(&report, ToolId::ClaudeCode);
    assert_eq!(claude.install_status, InstallStatus::Invalid);
    assert_eq!(claude.invalid_reason, Some(InvalidReason::OutsideRoot));
    assert_eq!(claude.version, None);
    assert!(version.calls().is_empty());
}

#[test]
fn non_executable_file_is_invalid_and_never_run() {
    let root = TempRoot::new();
    root.executable("opt/homebrew/bin/gemini", 0o644);
    let version = FakeVersion::answering_everything("0.1.0");

    let report = run(&root.home(), &root.locations(), &version, &FakeFs::new());

    let gemini = tool(&report, ToolId::GeminiCli);
    assert_eq!(gemini.install_status, InstallStatus::Invalid);
    assert_eq!(gemini.invalid_reason, Some(InvalidReason::NotExecutable));
    assert!(version.calls().is_empty());
}

#[test]
fn group_or_world_writable_executable_is_invalid_and_never_run() {
    for mode in [0o775, 0o757] {
        let root = TempRoot::new();
        root.executable("opt/homebrew/bin/copilot", mode);
        let version = FakeVersion::answering_everything("1.0.0");

        let report = run(&root.home(), &root.locations(), &version, &FakeFs::new());

        let copilot = tool(&report, ToolId::CopilotCli);
        assert_eq!(
            copilot.install_status,
            InstallStatus::Invalid,
            "mode {mode:o}"
        );
        assert_eq!(
            copilot.invalid_reason,
            Some(InvalidReason::GroupOrWorldWritable),
            "mode {mode:o}"
        );
        assert!(version.calls().is_empty(), "mode {mode:o}");
    }
}

#[test]
fn directory_at_the_candidate_path_is_invalid_not_regular() {
    let root = TempRoot::new();
    fs::create_dir_all(root.path("opt/homebrew/bin/claude")).expect("directory");

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::answering_everything("2.1.0"),
        &FakeFs::new(),
    );

    let claude = tool(&report, ToolId::ClaudeCode);
    assert_eq!(claude.install_status, InstallStatus::Invalid);
    assert_eq!(claude.invalid_reason, Some(InvalidReason::NotRegularFile));
}

#[test]
fn dangling_symlink_counts_as_missing() {
    let root = TempRoot::new();
    fs::create_dir_all(root.path("opt/homebrew/bin")).expect("bin");
    symlink(root.path("nowhere"), root.path("opt/homebrew/bin/claude")).expect("symlink");

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::answering_everything("2.1.0"),
        &FakeFs::new(),
    );

    assert_eq!(
        tool(&report, ToolId::ClaudeCode).install_status,
        InstallStatus::Missing
    );
}

#[test]
fn a_later_fixed_location_is_used_when_the_first_is_missing() {
    let root = TempRoot::new();
    root.executable("usr/local/bin/claude", 0o755);

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::answering_everything("2.1.0"),
        &FakeFs::new(),
    );

    assert_eq!(
        tool(&report, ToolId::ClaudeCode).install_status,
        InstallStatus::Found
    );
}

#[test]
fn a_broken_earlier_location_is_reported_when_no_later_one_is_usable() {
    let root = TempRoot::new();
    root.executable("opt/homebrew/bin/claude", 0o644);

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::none(),
        &FakeFs::new(),
    );

    let claude = tool(&report, ToolId::ClaudeCode);
    assert_eq!(claude.install_status, InstallStatus::Invalid);
    assert_eq!(claude.invalid_reason, Some(InvalidReason::NotExecutable));
}

#[test]
fn unconfirmed_version_keeps_the_found_status_and_shows_no_version() {
    let root = TempRoot::new();
    root.executable("opt/homebrew/bin/claude", 0o755);

    let report = run(
        &root.home(),
        &root.locations(),
        &FakeVersion::none(),
        &FakeFs::new(),
    );

    let claude = tool(&report, ToolId::ClaudeCode);
    assert_eq!(claude.install_status, InstallStatus::Found);
    assert_eq!(claude.version, None);
}

#[test]
fn one_failing_tool_does_not_change_the_others() {
    let root = TempRoot::new();
    root.executable("opt/homebrew/bin/claude", 0o644);
    root.executable("opt/homebrew/bin/codex", 0o755);
    let version = FakeVersion::answering(&[("codex", "codex 0.9.0")]);

    let report = run(&root.home(), &root.locations(), &version, &FakeFs::new());

    let claude = tool(&report, ToolId::ClaudeCode);
    let codex = tool(&report, ToolId::CodexCli);
    let gemini = tool(&report, ToolId::GeminiCli);
    assert_eq!(claude.install_status, InstallStatus::Invalid);
    assert_eq!(codex.install_status, InstallStatus::Found);
    assert_eq!(codex.version.as_deref(), Some("codex 0.9.0"));
    assert_eq!(gemini.install_status, InstallStatus::Missing);
    assert_eq!(version.calls().len(), 1);
}

#[test]
fn config_file_presence_never_implies_an_installed_tool() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file("/Users/example/.claude/settings.json", "{}");

    let report = run(Path::new(HOME), &[], &FakeVersion::none(), &fs);

    let claude = tool(&report, ToolId::ClaudeCode);
    assert_eq!(claude.config_presence, ConfigPresence::Found);
    assert_eq!(claude.install_status, InstallStatus::Missing);
}

#[test]
fn absent_claude_settings_are_reported_as_not_found_not_as_unregistered() {
    let fs = FakeFs::new().dir(HOME);

    let report = run(Path::new(HOME), &[], &FakeVersion::none(), &fs);

    assert_eq!(
        tool(&report, ToolId::ClaudeCode).config_presence,
        ConfigPresence::NotFound
    );
}

#[test]
fn tools_without_a_registered_location_say_so_instead_of_guessing_one() {
    let fs = FakeFs::new().dir(HOME);

    let report = run(Path::new(HOME), &[], &FakeVersion::none(), &fs);

    for id in [ToolId::CodexCli, ToolId::GeminiCli, ToolId::CopilotCli] {
        assert_eq!(
            tool(&report, id).config_presence,
            ConfigPresence::NotRegistered,
            "{id:?}"
        );
    }
}

#[test]
fn unreadable_claude_settings_do_not_change_its_install_status() {
    let root = TempRoot::new();
    root.executable("opt/homebrew/bin/claude", 0o755);
    let fs = FakeFs::new()
        .dir(HOME)
        .dir("/Users/example/.claude")
        .denied("/Users/example/.claude");

    let report = run(
        Path::new(HOME),
        &root.locations(),
        &FakeVersion::answering(&[("claude", "2.1.0")]),
        &fs,
    );

    let claude = tool(&report, ToolId::ClaudeCode);
    assert_eq!(claude.config_presence, ConfigPresence::Unavailable);
    assert_eq!(claude.install_status, InstallStatus::Found);
}

#[test]
fn version_command_uses_only_the_fixed_argument_private_cwd_and_minimal_env() {
    let work = Path::new("/tmp/userhome-ai-probe-fixture");

    let command = version_command(Path::new("/opt/homebrew/bin/claude"), work);

    let args: Vec<&OsStr> = command.get_args().collect();
    assert_eq!(args, vec![OsStr::new("--version")]);
    assert_eq!(command.get_current_dir(), Some(work));
    let mut keys: Vec<String> = command
        .get_envs()
        .map(|(key, _)| key.to_string_lossy().into_owned())
        .collect();
    keys.sort();
    assert_eq!(keys, ["HOME", "PATH", "TMPDIR"]);
    let home = command
        .get_envs()
        .find(|(key, _)| *key == OsStr::new("HOME"))
        .and_then(|(_, value)| value);
    assert_eq!(home, Some(work.as_os_str()));
}

#[test]
fn private_work_dir_is_owner_only_and_removed_when_dropped() {
    let path = {
        let work = PrivateWorkDir::create().expect("create work dir");
        let path = work.path().to_path_buf();
        let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        assert!(path.is_dir());
        path
    };

    assert!(!path.exists());
}

#[test]
fn a_command_that_cannot_be_spawned_yields_no_output() {
    let mut command = Command::new("/nonexistent/userhome-ai-probe-fixture");

    assert_eq!(
        run_bounded(&mut command, VERSION_TIMEOUT, MAX_VERSION_OUTPUT_BYTES),
        None
    );
}

#[test]
fn version_output_keeps_only_the_first_line() {
    assert_eq!(
        sanitize_version(b"2.1.0 (Claude Code)\nsecond line"),
        Some("2.1.0 (Claude Code)".to_owned())
    );
}

#[test]
fn version_output_drops_control_and_bidi_characters() {
    assert_eq!(
        sanitize_version(b"\x1b[31m2.1.0\x1b[0m"),
        Some("[31m2.1.0[0m".to_owned())
    );
    assert_eq!(
        sanitize_version("2.1\u{202E}0".as_bytes()),
        Some("2.10".to_owned())
    );
    assert_eq!(
        sanitize_version("\u{FEFF}1.2".as_bytes()),
        Some("1.2".to_owned())
    );
}

#[test]
fn empty_or_control_only_version_output_is_unconfirmed() {
    assert_eq!(sanitize_version(b""), None);
    assert_eq!(sanitize_version(b"\n"), None);
    assert_eq!(sanitize_version(b"\x00\x07"), None);
}

#[test]
fn version_output_that_is_not_utf8_is_unconfirmed() {
    assert_eq!(sanitize_version(&[0xff, 0xfe]), None);
}

#[test]
fn version_output_over_the_byte_cap_is_unconfirmed() {
    let oversized = vec![b'1'; MAX_VERSION_OUTPUT_BYTES + 1];
    let at_cap = vec![b'1'; MAX_VERSION_OUTPUT_BYTES];

    assert_eq!(sanitize_version(&oversized), None);
    assert!(sanitize_version(&at_cap).is_some());
}

#[test]
fn version_line_is_truncated_to_the_display_length() {
    let long_line = "a".repeat(MAX_VERSION_CHARS + 50);

    let version = sanitize_version(long_line.as_bytes()).expect("non-empty");

    assert_eq!(version.chars().count(), MAX_VERSION_CHARS);
}

#[test]
fn version_timeout_and_argument_are_fixed() {
    assert_eq!(VERSION_ARGUMENT, "--version");
    assert_eq!(VERSION_TIMEOUT, Duration::from_secs(3));
    assert_eq!(MAX_VERSION_OUTPUT_BYTES, 4096);
}

#[test]
fn serialized_report_omits_the_resolved_home_and_any_candidate_list() {
    let fs = FakeFs::new().dir(HOME);

    let report = run(Path::new(HOME), &[], &FakeVersion::none(), &fs);
    let json = serde_json::to_string(&report).expect("serialize");

    assert!(!json.contains("/Users/example"));
    assert!(!json.contains("candidates"));
    assert!(json.contains("\"installStatus\":\"missing\""));
    assert!(json.contains("\"configPresence\":\"notRegistered\""));
}
