//! Caddy work directory checks: candidates, confirmed creation, protected, symbolic
//! link, cloud-synced and writable-by-others locations, and the socket path limit.

use std::{
    fmt::Debug,
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use uuid::Uuid;

use super::workdir::{check_socket_path, default_candidate, prepare, validate_candidate};
use crate::error::{AppError, AppErrorCode};

struct Sandbox {
    root: PathBuf,
    home: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-caddy-workdir-{}", Uuid::new_v4()));
        let home = root.join("home");
        fs::create_dir_all(&home).expect("home");
        Self { root, home }
    }

    fn dir(&self, relative: &str) -> PathBuf {
        let path = self.home.join(relative);
        fs::create_dir_all(&path).expect("directory");
        path
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn set_mode(path: &Path, mode: u32) {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("mode");
}

fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).expect("metadata").permissions().mode() & 0o777
}

fn assert_permission_denied<T: Debug>(result: Result<T, AppError>) {
    assert_eq!(
        result.expect_err("refused").code(),
        AppErrorCode::PermissionDenied
    );
}

#[test]
fn the_suggested_directory_is_dot_caddy_under_home_and_nothing_is_created() {
    let sandbox = Sandbox::new();

    let suggestion = default_candidate(&sandbox.home);

    assert_eq!(suggestion, sandbox.home.join(".caddy"));
    assert!(!suggestion.exists());
}

#[test]
fn an_owned_directory_below_home_is_accepted_in_its_canonical_form() {
    let sandbox = Sandbox::new();
    let directory = sandbox.dir("projects/caddy");

    assert_eq!(
        validate_candidate(&directory, &sandbox.home).expect("accepted"),
        directory
    );
}

#[test]
fn home_itself_and_directories_outside_home_are_refused() {
    let sandbox = Sandbox::new();
    let outside = sandbox.root.join("outside");
    fs::create_dir_all(&outside).expect("outside");

    assert_permission_denied(validate_candidate(&sandbox.home, &sandbox.home));
    assert_permission_denied(validate_candidate(&outside, &sandbox.home));
}

#[test]
fn protected_credential_locations_are_refused_with_everything_below_them() {
    let sandbox = Sandbox::new();
    for relative in [
        ".ssh",
        ".ssh/keys",
        ".gnupg",
        "Library/Keychains",
        "Library/Keychains/login",
    ] {
        let directory = sandbox.dir(relative);
        assert_permission_denied(validate_candidate(&directory, &sandbox.home));
    }
}

#[test]
fn symbolic_links_are_refused_and_a_link_path_cannot_reach_outside_home() {
    let sandbox = Sandbox::new();
    let outside = sandbox.root.join("outside");
    fs::create_dir_all(outside.join("inner")).expect("outside");
    let link = sandbox.home.join("link");
    symlink(&outside, &link).expect("link");
    let inside = sandbox.dir("real");
    symlink(outside.join("inner"), inside.join("inner-link")).expect("leaf link");

    assert_permission_denied(validate_candidate(&link, &sandbox.home));
    assert_permission_denied(validate_candidate(&link.join("inner"), &sandbox.home));
    assert_permission_denied(validate_candidate(
        &inside.join("inner-link"),
        &sandbox.home,
    ));
}

#[test]
fn cloud_synced_directories_are_refused() {
    let sandbox = Sandbox::new();
    for relative in [
        "Dropbox",
        "Dropbox/work",
        "iCloud Drive/notes",
        "icloud-old",
        "Library/Mobile Documents/com~apple~CloudDocs/caddy",
        "Library/CloudStorage/OneDrive-Work",
    ] {
        let directory = sandbox.dir(relative);
        assert_permission_denied(validate_candidate(&directory, &sandbox.home));
    }
}

#[test]
fn a_directory_writable_by_its_group_or_by_others_is_refused() {
    let sandbox = Sandbox::new();
    for mode in [0o775, 0o757, 0o727] {
        let directory = sandbox.dir(&format!("shared-{mode:o}"));
        set_mode(&directory, mode);

        assert_permission_denied(validate_candidate(&directory, &sandbox.home));
    }
}

#[test]
fn prepare_creates_the_confirmed_directory_owner_only_and_checks_it() {
    let sandbox = Sandbox::new();
    let target = sandbox.home.join(".caddy");

    let canonical = prepare(&target, &sandbox.home).expect("prepared");

    assert_eq!(canonical, target);
    assert_eq!(mode_of(&target), 0o700);
}

#[test]
fn prepare_tightens_an_existing_directory_to_owner_only() {
    let sandbox = Sandbox::new();
    let target = sandbox.dir(".caddy");
    set_mode(&target, 0o755);

    prepare(&target, &sandbox.home).expect("prepared");

    assert_eq!(mode_of(&target), 0o700);
}

#[test]
fn prepare_refuses_outside_home_symbolic_links_and_files_without_touching_them() {
    let sandbox = Sandbox::new();
    let outside = sandbox.root.join("outside");
    fs::create_dir_all(&outside).expect("outside");
    assert_permission_denied(prepare(&outside.join(".caddy"), &sandbox.home));
    assert!(!outside.join(".caddy").exists());

    let elsewhere = sandbox.root.join("elsewhere");
    fs::create_dir_all(&elsewhere).expect("elsewhere");
    let link = sandbox.home.join(".caddy");
    symlink(&elsewhere, &link).expect("link");
    assert_permission_denied(prepare(&link, &sandbox.home));
    assert_eq!(fs::read_dir(&elsewhere).expect("elsewhere").count(), 0);

    let file = sandbox.home.join("file");
    fs::write(&file, "x").expect("file");
    assert_permission_denied(prepare(&file, &sandbox.home));
    assert_eq!(fs::read(&file).expect("file"), b"x");
}

#[test]
fn a_work_directory_path_past_the_socket_limit_is_refused_with_a_shorter_path_hint() {
    let long = PathBuf::from(format!("/tmp/{}", "x".repeat(80)));

    let error = check_socket_path(&long).expect_err("too long");

    assert_eq!(error.code(), AppErrorCode::ValidationFailed);
    assert!(error.message().contains("更短的目录"));
}

#[test]
fn the_socket_limit_counts_the_run_directory_and_socket_name_exactly() {
    // `<workdir>/runs/<36-char id>/admin.sock` is 53 bytes longer than the workdir.
    let fits = PathBuf::from(format!("/tmp/{}", "x".repeat(42)));
    let too_long = PathBuf::from(format!("/tmp/{}", "x".repeat(43)));

    check_socket_path(&fits).expect("exactly at the limit");
    assert_eq!(
        check_socket_path(&too_long)
            .expect_err("one byte over")
            .code(),
        AppErrorCode::ValidationFailed
    );
}

#[test]
fn a_work_directory_with_spaces_cannot_host_the_socket_and_is_refused_not_moved() {
    let spaced = PathBuf::from("/tmp/caddy work");

    assert_eq!(
        check_socket_path(&spaced)
            .expect_err("unusable characters")
            .code(),
        AppErrorCode::ValidationFailed
    );
}

#[test]
fn a_short_plain_work_directory_passes_the_socket_check_and_creates_nothing() {
    let short = PathBuf::from("/tmp/caddy-socket-check");

    check_socket_path(&short).expect("usable");

    assert!(!short.exists());
}
