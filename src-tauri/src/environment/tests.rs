use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};

use uuid::Uuid;

use crate::grants::{GrantCoordinator, GrantId, GrantPurpose, GrantStore};

use super::{
    FailureKind, FileOutcome, FileRequest, RevealRequest, RowView, read_file, reveal_value,
    scan::{
        FileKind, PartialReason, ScanConfig, ScanError, ScanLimits, ScanOutcome, SkipReason, scan,
    },
};
use crate::error::AppErrorCode;

/// A temporary `$HOME` with a project directory, an outside area and a grant
/// store; nothing outside the temp directory is ever touched.
pub(super) struct Fixture {
    pub root: PathBuf,
    pub home: PathBuf,
    pub project: PathBuf,
    pub outside: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-environment-{}", Uuid::new_v4()));
        let home = root.join("home");
        let project = home.join("proj");
        let outside = root.join("outside");
        for directory in [&project, &outside] {
            fs::create_dir_all(directory).expect("create fixture directory");
        }
        Self {
            root,
            home,
            project,
            outside,
        }
    }

    pub fn coordinator(&self) -> GrantCoordinator {
        GrantCoordinator::new(
            GrantStore::new(self.root.join("support")),
            Some(self.home.clone()),
        )
    }

    pub fn grant(&self, coordinator: &GrantCoordinator, directory: &Path) -> GrantId {
        coordinator
            .create(GrantPurpose::ConfigDirectory, directory)
            .expect("create directory grant")
            .id
    }

    pub fn write(&self, relative: &str, contents: &str) -> PathBuf {
        let path = self.project.join(relative);
        fs::create_dir_all(path.parent().expect("parent")).expect("create parents");
        fs::write(&path, contents).expect("write file");
        path
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Restore permissions that tests removed so cleanup can descend.
        let _ = Command::new("chmod")
            .args(["-R", "u+rwx"])
            .arg(&self.root)
            .status();
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn names(outcome: &ScanOutcome) -> Vec<&str> {
    outcome
        .files
        .iter()
        .map(|file| file.relative_path.as_str())
        .collect()
}

fn local() -> ScanConfig {
    ScanConfig::with_default_patterns(false)
}

fn recursive() -> ScanConfig {
    ScanConfig::with_default_patterns(true)
}

fn run(fixture: &Fixture, config: &ScanConfig, limits: ScanLimits) -> ScanOutcome {
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    scan(&coordinator, &id, config, limits, Some(&fixture.home))
        .unwrap_or_else(|_| panic!("scan should succeed"))
}

fn scan_error(fixture: &Fixture, id: &GrantId, config: &ScanConfig) -> ScanError {
    match scan(
        &fixture.coordinator(),
        id,
        config,
        ScanLimits::default(),
        Some(&fixture.home),
    ) {
        Ok(_) => panic!("scan should fail"),
        Err(error) => error,
    }
}

#[test]
fn default_patterns_match_the_top_level_only() {
    let fixture = Fixture::new();
    for name in [
        ".env",
        ".env.local",
        ".env.production",
        "prod.env",
        ".envrc",
        "env",
        "notes.txt",
        "sub/.env",
    ] {
        fixture.write(name, "A=1\n");
    }

    let outcome = run(&fixture, &local(), ScanLimits::default());

    assert_eq!(
        names(&outcome),
        [".env", ".env.local", ".env.production", "prod.env"]
    );
    assert!(outcome.partial_reasons.is_empty());
    assert_eq!(outcome.root, "~/proj");
    assert!(!outcome.recursive);
    assert_eq!(outcome.limits, ScanLimits::default());
}

#[test]
fn templates_are_labelled_apart_from_real_environment_files() {
    let fixture = Fixture::new();
    for name in [
        ".env",
        ".env.example",
        ".env.sample",
        ".env.template",
        ".env.dist",
        ".env.local",
        "app.env",
    ] {
        fixture.write(name, "A=1\n");
    }

    let outcome = run(&fixture, &local(), ScanLimits::default());

    let kinds: Vec<(&str, FileKind)> = outcome
        .files
        .iter()
        .map(|file| (file.name.as_str(), file.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            (".env", FileKind::Environment),
            (".env.dist", FileKind::Template),
            (".env.example", FileKind::Template),
            (".env.local", FileKind::Environment),
            (".env.sample", FileKind::Template),
            (".env.template", FileKind::Template),
            ("app.env", FileKind::Environment),
        ]
    );
}

#[test]
fn custom_patterns_replace_the_defaults() {
    let fixture = Fixture::new();
    for name in [".env", "app.settings", "other.settings", "x.txt"] {
        fixture.write(name, "A=1\n");
    }
    let config = ScanConfig {
        patterns: vec!["*.settings".to_owned(), "x.tx?".to_owned()],
        recursive: false,
    };

    let outcome = run(&fixture, &config, ScanLimits::default());

    assert_eq!(names(&outcome), ["app.settings", "other.settings", "x.txt"]);
}

#[test]
fn recursion_is_opt_in_and_finds_nested_files_with_name_or_path_patterns() {
    let fixture = Fixture::new();
    for name in [
        ".env",
        "a/.env.local",
        "a/b/prod.env",
        "config/x.env",
        "other/x.env",
    ] {
        fixture.write(name, "A=1\n");
    }

    let shallow = run(&fixture, &local(), ScanLimits::default());
    assert_eq!(names(&shallow), [".env"]);

    let deep = run(&fixture, &recursive(), ScanLimits::default());
    assert_eq!(
        names(&deep),
        [
            ".env",
            "a/.env.local",
            "a/b/prod.env",
            "config/x.env",
            "other/x.env"
        ]
    );

    let scoped = ScanConfig {
        patterns: vec!["config/*.env".to_owned()],
        recursive: true,
    };
    let scoped = run(&fixture, &scoped, ScanLimits::default());
    assert_eq!(names(&scoped), ["config/x.env"]);
}

#[test]
fn recursion_stops_at_the_depth_limit_and_says_so() {
    let fixture = Fixture::new();
    fixture.write("one/.env", "A=1\n");
    fixture.write("one/two/.env", "A=1\n");
    fixture.write("one/two/three/.env", "A=1\n");
    let limits = ScanLimits {
        max_depth: 2,
        ..ScanLimits::default()
    };

    let outcome = run(&fixture, &recursive(), limits);

    assert_eq!(names(&outcome), ["one/.env", "one/two/.env"]);
    assert_eq!(outcome.partial_reasons, [PartialReason::DepthLimit]);
}

#[test]
fn the_default_depth_limit_is_five_levels_of_directories() {
    let fixture = Fixture::new();
    fixture.write("a/b/c/d/e/.env", "A=1\n");
    fixture.write("a/b/c/d/e/f/.env", "A=1\n");

    let outcome = run(&fixture, &recursive(), ScanLimits::default());

    assert_eq!(names(&outcome), ["a/b/c/d/e/.env"]);
    assert_eq!(outcome.partial_reasons, [PartialReason::DepthLimit]);
}

#[test]
fn build_output_dependencies_and_vcs_directories_are_excluded() {
    let fixture = Fixture::new();
    for name in [
        "app/.env",
        ".git/.env",
        "node_modules/pkg/.env",
        "target/debug/.env",
        "dist/.env",
        "build/.env",
    ] {
        fixture.write(name, "A=1\n");
    }

    let outcome = run(&fixture, &recursive(), ScanLimits::default());

    assert_eq!(names(&outcome), ["app/.env"]);
    assert_eq!(outcome.excluded_directories, 5);
    assert!(outcome.partial_reasons.is_empty());
    assert!(outcome.exclusions.contains(&"node_modules".to_owned()));
}

#[test]
fn symbolic_links_that_leave_the_root_are_refused_and_reported() {
    let fixture = Fixture::new();
    fs::write(fixture.outside.join("secret"), "TOKEN=outside\n").expect("write outside file");
    fixture.write("real.env", "A=1\n");
    symlink(
        fixture.outside.join("secret"),
        fixture.project.join(".env.link"),
    )
    .expect("escaping link");
    symlink("real.env", fixture.project.join("alias.env")).expect("in-root link");
    symlink("missing", fixture.project.join("broken.env")).expect("dangling link");
    symlink(&fixture.outside, fixture.project.join("linked-dir")).expect("directory link");
    fs::create_dir_all(fixture.outside.join("inner")).expect("outside directory");
    fs::write(fixture.outside.join("inner/.env"), "A=1\n").expect("outside file");

    let outcome = run(&fixture, &recursive(), ScanLimits::default());

    assert_eq!(names(&outcome), ["alias.env", "real.env"]);
    assert!(outcome.files[0].symlink);
    assert!(!outcome.files[1].symlink);
    let skipped: Vec<(Option<&str>, SkipReason)> = outcome
        .skipped
        .iter()
        .map(|entry| (entry.relative_path.as_deref(), entry.reason))
        .collect();
    assert!(skipped.contains(&(Some(".env.link"), SkipReason::OutsideLink)));
    assert!(skipped.contains(&(Some("broken.env"), SkipReason::BrokenLink)));
    // A linked directory is never followed, so its contents are not listed.
    assert!(!names(&outcome).iter().any(|path| path.contains("inner")));
}

#[test]
fn an_unreadable_subdirectory_is_reported_instead_of_hidden() {
    let fixture = Fixture::new();
    fixture.write("open/.env", "A=1\n");
    fixture.write("closed/.env", "A=1\n");
    fs::set_permissions(
        fixture.project.join("closed"),
        fs::Permissions::from_mode(0o000),
    )
    .expect("remove permissions");

    let outcome = run(&fixture, &recursive(), ScanLimits::default());

    assert_eq!(names(&outcome), ["open/.env"]);
    assert_eq!(
        outcome.partial_reasons,
        [PartialReason::UnreadableDirectory]
    );
    assert!(outcome.skipped.iter().any(|entry| {
        entry.relative_path.as_deref() == Some("closed") && entry.reason == SkipReason::Unreadable
    }));
}

#[test]
fn protected_credential_directories_below_a_broad_root_are_not_entered() {
    let fixture = Fixture::new();
    let library = fixture.home.join("Library");
    fs::create_dir_all(library.join("Keychains")).expect("keychains");
    fs::create_dir_all(library.join("Safe")).expect("safe");
    fs::write(library.join("Keychains/.env"), "A=1\n").expect("keychain file");
    fs::write(library.join("Safe/.env"), "A=1\n").expect("safe file");
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &library);

    let Ok(outcome) = scan(
        &coordinator,
        &id,
        &recursive(),
        ScanLimits::default(),
        Some(&fixture.home),
    ) else {
        panic!("scan should succeed");
    };

    assert_eq!(names(&outcome), ["Safe/.env"]);
    assert!(
        outcome
            .skipped
            .iter()
            .any(|entry| entry.reason == SkipReason::Protected)
    );
}

#[test]
fn the_entry_limit_returns_a_partial_result_without_widening_the_scan() {
    let fixture = Fixture::new();
    for index in 0..10 {
        fixture.write(&format!("file{index:02}.env"), "A=1\n");
    }
    let limits = ScanLimits {
        max_entries: 4,
        ..ScanLimits::default()
    };

    let outcome = run(&fixture, &local(), limits);

    assert_eq!(outcome.files.len(), 4);
    assert_eq!(outcome.entries_examined, 4);
    assert_eq!(outcome.partial_reasons, [PartialReason::EntryLimit]);
}

#[test]
fn exactly_filling_the_entry_limit_is_not_partial() {
    let fixture = Fixture::new();
    for index in 0..4 {
        fixture.write(&format!("file{index}.env"), "A=1\n");
    }
    let limits = ScanLimits {
        max_entries: 4,
        ..ScanLimits::default()
    };

    let outcome = run(&fixture, &local(), limits);

    assert_eq!(outcome.files.len(), 4);
    assert!(outcome.partial_reasons.is_empty());
}

#[test]
fn the_match_limit_stops_the_listing_and_reports_it() {
    let fixture = Fixture::new();
    for index in 0..6 {
        fixture.write(&format!("file{index}.env"), "A=1\n");
    }
    let limits = ScanLimits {
        max_matches: 3,
        ..ScanLimits::default()
    };

    let outcome = run(&fixture, &local(), limits);

    assert_eq!(names(&outcome), ["file0.env", "file1.env", "file2.env"]);
    assert_eq!(outcome.partial_reasons, [PartialReason::MatchLimit]);
}

#[test]
fn files_over_the_size_limit_are_listed_but_marked() {
    let fixture = Fixture::new();
    fixture.write("small.env", "A=1\n");
    fixture.write("large.env", &"x".repeat(2048));
    let limits = ScanLimits {
        max_file_bytes: 1024,
        ..ScanLimits::default()
    };

    let outcome = run(&fixture, &local(), limits);

    let flags: Vec<(&str, bool, u64)> = outcome
        .files
        .iter()
        .map(|file| (file.name.as_str(), file.oversized, file.size_bytes))
        .collect();
    assert_eq!(flags, [("large.env", true, 2048), ("small.env", false, 4)]);
}

#[test]
fn a_matching_name_that_is_not_a_regular_file_is_skipped_without_opening_it() {
    let fixture = Fixture::new();
    fixture.write(".env", "A=1\n");
    let fifo = fixture.project.join(".env.pipe");
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo")
            .success()
    );
    fs::create_dir(fixture.project.join("dir.env")).expect("directory with a matching name");

    let outcome = run(&fixture, &local(), ScanLimits::default());

    assert_eq!(names(&outcome), [".env"]);
    let reasons: Vec<SkipReason> = outcome.skipped.iter().map(|entry| entry.reason).collect();
    assert_eq!(reasons, [SkipReason::NotRegular]);
}

#[test]
fn a_revoked_or_unknown_authorization_cannot_scan() {
    let fixture = Fixture::new();
    fixture.write(".env", "A=1\n");
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    coordinator.revoke(&id).expect("revoke");

    let error = scan_error(&fixture, &id, &local());

    assert!(matches!(
        error,
        ScanError::Grant(crate::grants::GrantError::UnknownGrant)
    ));
}

#[test]
fn a_removed_root_and_a_file_authorization_are_rejected() {
    let fixture = Fixture::new();
    let file = fixture.write(".env", "A=1\n");
    let coordinator = fixture.coordinator();
    let directory = fixture.grant(&coordinator, &fixture.project);
    let file_grant = coordinator
        .create(GrantPurpose::ConfigFile, &file)
        .expect("file grant")
        .id;

    let wrong_kind = scan(
        &coordinator,
        &file_grant,
        &local(),
        ScanLimits::default(),
        Some(&fixture.home),
    );
    assert!(matches!(
        wrong_kind,
        Err(ScanError::Grant(crate::grants::GrantError::NotDirectory))
    ));

    fs::remove_dir_all(&fixture.project).expect("remove project");
    let missing = scan(
        &coordinator,
        &directory,
        &local(),
        ScanLimits::default(),
        Some(&fixture.home),
    );
    assert!(matches!(
        missing,
        Err(ScanError::Grant(crate::grants::GrantError::NotFound))
    ));
}

#[test]
fn rejects_patterns_that_are_not_simple_relative_globs() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    for pattern in [
        "",
        "/etc/*.env",
        "../*.env",
        "a/../b",
        "a//b",
        "./x",
        "**/.env",
        "[ab].env",
        "{a,b}.env",
        "!x",
        "$(id)",
        "a\\b",
        "x;y",
        "name\n",
        &"a".repeat(200),
    ] {
        let config = ScanConfig {
            patterns: vec![pattern.to_owned()],
            recursive: true,
        };
        assert!(
            matches!(
                scan(&coordinator, &id, &config, ScanLimits::default(), None),
                Err(ScanError::Invalid(_))
            ),
            "{pattern:?} must be rejected"
        );
    }
    let none = ScanConfig {
        patterns: Vec::new(),
        recursive: false,
    };
    assert!(none.validate().is_err());
    let many = ScanConfig {
        patterns: (0..17).map(|index| format!("a{index}")).collect(),
        recursive: false,
    };
    assert!(many.validate().is_err());
}

#[test]
fn a_pattern_with_a_directory_needs_recursion() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    let config = ScanConfig {
        patterns: vec!["config/*.env".to_owned()],
        recursive: false,
    };

    assert!(matches!(
        scan(&coordinator, &id, &config, ScanLimits::default(), None),
        Err(ScanError::Invalid(_))
    ));
}

#[test]
fn admits_follows_depth_exclusions_and_patterns() {
    let limits = ScanLimits::default();
    let local = local();
    let deep = recursive();

    assert!(local.admits(".env", &limits));
    assert!(!local.admits("sub/.env", &limits));
    assert!(deep.admits("a/b/.env.local", &limits));
    assert!(!deep.admits("node_modules/x/.env", &limits));
    assert!(!deep.admits("a/b/c/d/e/f/.env", &limits));
    assert!(!deep.admits("a/README.md", &limits));
    assert!(!deep.admits("../.env", &limits));
    assert!(!deep.admits("/etc/.env", &limits));
    assert!(!deep.admits("a\n/.env", &limits));
}

#[test]
fn glob_matching_supports_only_star_and_question_mark() {
    use super::scan::glob_match;

    assert!(glob_match(".env", ".env"));
    assert!(glob_match(".env.*", ".env.local"));
    assert!(glob_match(".env.*", ".env."));
    assert!(!glob_match(".env.*", ".env"));
    assert!(glob_match("*.env", ".env"));
    assert!(glob_match("*.env", "prod.env"));
    assert!(!glob_match("*.env", "prod.env.bak"));
    assert!(glob_match("a?c", "abc"));
    assert!(!glob_match("a?c", "ac"));
    assert!(glob_match("a*b*c", "aXXbYYc"));
    assert!(!glob_match("a*b*c", "aXXbYY"));
    assert!(glob_match("config/*.env", "config/x.env"));
    assert!(!glob_match("config/*.env", "config/sub/x.env"));
    assert!(!glob_match("*.env", "dir/x.env"));
    // Brackets are literal characters, not a class.
    assert!(!glob_match("[ab].env", "a.env"));
}

// ---- reading one file and revealing one value ----

fn file_request(relative: &str, config: ScanConfig) -> FileRequest {
    FileRequest {
        relative_path: relative.to_owned(),
        config,
    }
}

fn read(fixture: &Fixture, relative: &str, config: ScanConfig) -> FileOutcome {
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    read_file(
        &coordinator,
        &id,
        &file_request(relative, config),
        ScanLimits::default(),
    )
    .unwrap_or_else(|_| panic!("read should not be rejected as invalid"))
}

fn unavailable(outcome: FileOutcome) -> FailureKind {
    match outcome {
        FileOutcome::Unavailable { reason, .. } => reason,
        FileOutcome::Ready(_) => panic!("expected the file to be unavailable"),
    }
}

fn ready(outcome: FileOutcome) -> super::FileView {
    match outcome {
        FileOutcome::Ready(view) => view,
        FileOutcome::Unavailable { reason, .. } => panic!("unexpected failure {reason:?}"),
    }
}

const SAMPLE: &str = "# service settings\n\
PORT=3000\n\
export API_TOKEN=\"tok-secret-123\"\n\
\n\
HOME_DIR=$HOME/app\n\
NAME = loose\n\
PORT=4000\n\
NOTE=\"two\n\
lines\"\n\
# OLD_PASSWORD=hunter2-old\n\
DATABASE_URL=postgres://user:db-pass-456@db/app\n";

#[test]
fn a_file_view_keeps_every_row_and_never_carries_secret_values() {
    let fixture = Fixture::new();
    fixture.write(".env", SAMPLE);

    let view = ready(read(&fixture, ".env", local()));

    let json = serde_json::to_string(&view).expect("serialize view");
    for secret in ["tok-secret-123", "db-pass-456", "hunter2-old"] {
        assert!(!json.contains(secret), "{secret} leaked into the view");
    }
    assert_eq!(view.kind, FileKind::Environment);
    assert_eq!(view.line_count, 11);
    assert_eq!(view.content_hash.len(), 64);
    assert!(!view.rows_truncated);

    let kinds: Vec<&str> = view
        .rows
        .iter()
        .map(|row| match row {
            RowView::Blank { .. } => "blank",
            RowView::Comment { .. } => "comment",
            RowView::Unknown { .. } => "unknown",
            RowView::Entry { .. } => "entry",
        })
        .collect();
    assert_eq!(
        kinds,
        [
            "comment", "entry", "entry", "blank", "entry", "unknown", "entry", "entry", "comment",
            "entry"
        ]
    );
    let RowView::Entry {
        line,
        key,
        secret,
        has_value,
        value_length,
        value,
        exported,
        ..
    } = &view.rows[2]
    else {
        panic!("expected the token entry");
    };
    assert_eq!(
        (*line, key.as_str(), *secret, *has_value),
        (3, "API_TOKEN", true, true)
    );
    assert_eq!(
        (*value_length, value.as_deref(), *exported),
        (14, None, true)
    );

    let RowView::Entry { value, secret, .. } = &view.rows[1] else {
        panic!("expected the port entry");
    };
    assert_eq!((value.as_deref(), *secret), (Some("3000"), false));

    // The comment holding a commented-out secret is withheld, plain ones are shown.
    let RowView::Comment { text, withheld, .. } = &view.rows[8] else {
        panic!("expected the commented-out secret");
    };
    assert_eq!((text.as_deref(), *withheld), (None, true));
    let RowView::Comment { text, withheld, .. } = &view.rows[0] else {
        panic!("expected the header comment");
    };
    assert_eq!(
        (text.as_deref(), *withheld),
        (Some("# service settings"), false)
    );
}

#[test]
fn conflicts_and_unsupported_values_are_flagged_not_resolved() {
    let fixture = Fixture::new();
    fixture.write(".env", SAMPLE);

    let view = ready(read(&fixture, ".env", local()));
    let json = serde_json::to_value(&view).expect("serialize view");
    let rows = json["rows"].as_array().expect("rows");

    let flags = |index: usize| rows[index]["flags"].clone();
    assert_eq!(flags(1), serde_json::json!(["DUPLICATE_KEY"]));
    assert_eq!(flags(6), serde_json::json!(["DUPLICATE_KEY"]));
    assert_eq!(flags(4), serde_json::json!(["INTERPOLATION"]));
    assert_eq!(flags(7), serde_json::json!(["MULTILINE_VALUE"]));
    assert_eq!(rows[7]["line"], 8);
    assert_eq!(rows[7]["endLine"], 9);
    assert_eq!(rows[5]["kind"], "UNKNOWN");
    assert_eq!(rows[5]["text"], "NAME = loose");
    // Both duplicates keep their own values; nothing is merged.
    assert_eq!(rows[1]["value"], "3000");
    assert_eq!(rows[6]["value"], "4000");
    // The interpolated value is shown as written, not expanded.
    assert_eq!(rows[4]["value"], "$HOME/app");
    assert_eq!(json["flaggedCount"], 5);
}

#[test]
fn templates_are_marked_in_the_file_view() {
    let fixture = Fixture::new();
    fixture.write(".env.example", "API_TOKEN=changeme\n");

    let view = ready(read(&fixture, ".env.example", local()));

    assert_eq!(view.kind, FileKind::Template);
}

#[test]
fn reading_never_executes_or_sources_the_file() {
    let fixture = Fixture::new();
    let marker = fixture.root.join("executed");
    fixture.write(
        ".env",
        &format!(
            "A=$(touch {0})\nB=`touch {0}`\nexport C=1; touch {0}\n",
            marker.display()
        ),
    );

    let view = ready(read(&fixture, ".env", local()));

    assert!(!marker.exists(), "the file content was executed");
    assert!(!view.rows.is_empty());
}

#[test]
fn read_failures_keep_their_kind_and_are_never_an_empty_file() {
    let fixture = Fixture::new();
    fixture.write(".env", "A=1\n");
    fixture.write("locked.env", "A=1\n");
    fixture.write("bad.env", "");
    fs::write(fixture.project.join("bad.env"), [0xff, 0xfe, b'A']).expect("invalid text");
    fixture.write("huge.env", &"A=1\n".repeat(400_000));
    fs::create_dir(fixture.project.join("dir.env")).expect("directory");
    assert!(
        Command::new("mkfifo")
            .arg(fixture.project.join("pipe.env"))
            .status()
            .expect("mkfifo")
            .success()
    );
    fixture.write("notes.txt", "A=1\n");
    fixture.write("node_modules/pkg/.env", "A=1\n");
    fs::write(fixture.outside.join("secret"), "TOKEN=outside\n").expect("outside");
    symlink(
        fixture.outside.join("secret"),
        fixture.project.join("link.env"),
    )
    .expect("link");
    fs::set_permissions(
        fixture.project.join("locked.env"),
        fs::Permissions::from_mode(0o000),
    )
    .expect("lock file");

    let cases: [(&str, ScanConfig, FailureKind); 10] = [
        ("missing.env", local(), FailureKind::NotFound),
        ("locked.env", local(), FailureKind::PermissionDenied),
        ("bad.env", local(), FailureKind::Malformed),
        ("huge.env", local(), FailureKind::TooLarge),
        ("dir.env", local(), FailureKind::Unsupported),
        ("pipe.env", local(), FailureKind::Unsupported),
        ("notes.txt", local(), FailureKind::Excluded),
        ("node_modules/pkg/.env", recursive(), FailureKind::Excluded),
        ("link.env", local(), FailureKind::Excluded),
        ("../outside/secret", recursive(), FailureKind::Excluded),
    ];
    for (relative, config, expected) in cases {
        assert_eq!(
            unavailable(read(&fixture, relative, config)),
            expected,
            "{relative}"
        );
    }
}

#[test]
fn nested_files_need_recursion_and_an_absolute_path_is_never_accepted() {
    let fixture = Fixture::new();
    fixture.write("sub/.env", "A=1\n");

    assert_eq!(
        unavailable(read(&fixture, "sub/.env", local())),
        FailureKind::Excluded
    );
    assert!(matches!(
        read(&fixture, "sub/.env", recursive()),
        FileOutcome::Ready(_)
    ));
    let absolute = fixture.project.join("sub/.env");
    assert_eq!(
        unavailable(read(
            &fixture,
            absolute.to_str().expect("utf-8"),
            recursive()
        )),
        FailureKind::Excluded
    );
}

#[test]
fn a_revoked_authorization_cannot_read_and_says_it_is_excluded() {
    let fixture = Fixture::new();
    fixture.write(".env", "A=1\n");
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    coordinator.revoke(&id).expect("revoke");

    let outcome = read_file(
        &coordinator,
        &id,
        &file_request(".env", local()),
        ScanLimits::default(),
    )
    .unwrap_or_else(|_| panic!("a revoked grant is a file outcome, not a request error"));

    assert_eq!(unavailable(outcome), FailureKind::Excluded);
}

#[test]
fn a_file_over_the_row_cap_is_truncated_and_says_so() {
    let fixture = Fixture::new();
    fixture.write(".env", &"A=1\n".repeat(6000));

    let view = ready(read(&fixture, ".env", local()));

    assert!(view.rows_truncated);
    assert_eq!(view.rows.len(), 5000);
    assert_eq!(view.line_count, 6000);
}

fn reveal(
    fixture: &Fixture,
    relative: &str,
    line: usize,
    key: &str,
) -> Result<super::RevealedValue, crate::error::AppError> {
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    reveal_value(
        &coordinator,
        &id,
        &RevealRequest {
            file: file_request(relative, local()),
            line,
            key: key.to_owned(),
        },
        ScanLimits::default(),
    )
}

#[test]
fn revealing_returns_exactly_the_requested_value() {
    let fixture = Fixture::new();
    fixture.write(".env", SAMPLE);

    let token = reveal(&fixture, ".env", 3, "API_TOKEN").expect("reveal token");
    assert_eq!(token.value, "tok-secret-123");
    let duplicate = reveal(&fixture, ".env", 7, "PORT").expect("reveal second PORT");
    assert_eq!(duplicate.value, "4000");
    let multiline = reveal(&fixture, ".env", 8, "NOTE").expect("reveal multi-line value");
    assert_eq!(multiline.value, "two\nlines");
    assert!(!format!("{token:?}").contains("tok-secret-123"));
}

#[test]
fn revealing_refuses_a_changed_file_or_a_wrong_target() {
    let fixture = Fixture::new();
    fixture.write(".env", SAMPLE);

    for (line, key) in [
        (3, "OTHER"),
        (4, "API_TOKEN"),
        (99, "API_TOKEN"),
        (6, "NAME"),
    ] {
        let error = reveal(&fixture, ".env", line, key).expect_err("must refuse");
        assert_eq!(error.code(), AppErrorCode::Conflict, "{line} {key}");
    }
    let error = reveal(&fixture, "notes.txt", 1, "A").expect_err("outside the scan");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
    let error = reveal(&fixture, "missing.env", 1, "A").expect_err("missing file");
    assert_eq!(error.code(), AppErrorCode::NotFound);
}

#[test]
fn revealing_needs_a_live_authorization() {
    let fixture = Fixture::new();
    fixture.write(".env", SAMPLE);
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    coordinator.revoke(&id).expect("revoke");

    let error = reveal_value(
        &coordinator,
        &id,
        &RevealRequest {
            file: file_request(".env", local()),
            line: 3,
            key: "API_TOKEN".to_owned(),
        },
        ScanLimits::default(),
    )
    .expect_err("revoked grant");

    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
}
