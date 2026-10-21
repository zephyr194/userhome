use std::path::Path;

use super::{
    discover::{FileMeta, ProbeStatus, probe},
    registry::{Entry, Location, Registry, fixture, resolve_path},
    test_support::{FakeFs, Op},
};

const HOME: &str = "/Users/example";

fn home_entry(relative: &'static str) -> Entry {
    Entry {
        location: Location::Home(relative),
        ..fixture("probe-target")
    }
}

fn fixed_entry(absolute: &'static str) -> Entry {
    Entry {
        location: Location::Fixed(absolute),
        ..fixture("probe-target")
    }
}

fn probe_home(fs: &FakeFs, relative: &'static str) -> ProbeStatus {
    probe(&home_entry(relative), Path::new(HOME), fs)
}

#[test]
fn probe_reports_a_regular_file_with_its_size_and_modification_time() {
    let fs = FakeFs::new().dir(HOME).file_bytes(
        "/Users/example/.gitconfig",
        b"[user]\n".to_vec(),
        1_700_000_123_456,
    );

    assert_eq!(
        probe_home(&fs, ".gitconfig"),
        ProbeStatus::Found(FileMeta {
            size: 7,
            modified_unix_millis: 1_700_000_123_456,
        })
    );
}

#[test]
fn probe_reports_not_found_when_only_the_file_is_missing() {
    let fs = FakeFs::new().dir(HOME);

    assert_eq!(probe_home(&fs, ".gitconfig"), ProbeStatus::NotFound);
}

#[test]
fn probe_reports_not_found_when_the_parent_directory_is_missing() {
    let fs = FakeFs::new().dir(HOME);

    assert_eq!(
        probe_home(&fs, "Library/Preferences/pnpm/auth.ini"),
        ProbeStatus::NotFound
    );
}

#[test]
fn probe_reports_a_symlink_to_a_file_inside_home_without_following_it() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file("/Users/example/dotfiles/gitconfig", "[user]\n")
        .symlink(
            "/Users/example/.gitconfig",
            "/Users/example/dotfiles/gitconfig",
        );

    assert_eq!(
        probe_home(&fs, ".gitconfig"),
        ProbeStatus::SymlinkOrNonRegular
    );
}

#[test]
fn probe_reports_a_directory_at_the_entry_path_as_not_regular() {
    let fs = FakeFs::new().dir(HOME).dir("/Users/example/.gitconfig");

    assert_eq!(
        probe_home(&fs, ".gitconfig"),
        ProbeStatus::SymlinkOrNonRegular
    );
}

#[test]
fn probe_reports_a_device_or_fifo_at_the_entry_path_as_not_regular() {
    let fs = FakeFs::new().dir(HOME).special("/Users/example/.gitconfig");

    assert_eq!(
        probe_home(&fs, ".gitconfig"),
        ProbeStatus::SymlinkOrNonRegular
    );
}

#[test]
fn probe_reports_a_leaf_symlink_that_escapes_home_as_out_of_bounds() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file("/etc/passwd", "root:x:0:0\n")
        .symlink("/Users/example/.gitconfig", "/etc/passwd");

    assert_eq!(probe_home(&fs, ".gitconfig"), ProbeStatus::OutOfBounds);
}

#[test]
fn probe_reports_a_symlinked_parent_that_escapes_home_as_out_of_bounds() {
    let fs = FakeFs::new()
        .dir(HOME)
        .symlink("/Users/example/.config", "/opt/shared")
        .file("/opt/shared/zed/settings.json", "{}");

    assert_eq!(
        probe_home(&fs, ".config/zed/settings.json"),
        ProbeStatus::OutOfBounds
    );
}

#[test]
fn probe_accepts_a_symlinked_parent_that_stays_inside_home() {
    let fs = FakeFs::new()
        .dir(HOME)
        .symlink("/Users/example/.config", "/Users/example/dotfiles/config")
        .file("/Users/example/dotfiles/config/zed/settings.json", "{}");

    assert!(matches!(
        probe_home(&fs, ".config/zed/settings.json"),
        ProbeStatus::Found(_)
    ));
}

#[test]
fn probe_rejects_a_same_prefix_sibling_directory_as_out_of_bounds() {
    let fs = FakeFs::new()
        .dir("/Users/ab")
        .symlink("/Users/ab/.config", "/Users/abc/cfg")
        .file("/Users/abc/cfg/zed/settings.json", "{}");

    assert_eq!(
        probe(
            &home_entry(".config/zed/settings.json"),
            Path::new("/Users/ab"),
            &fs
        ),
        ProbeStatus::OutOfBounds
    );
}

#[test]
fn probe_rejects_a_target_that_resolves_into_a_protected_directory() {
    let fs = FakeFs::new()
        .dir(HOME)
        .symlink("/Users/example/.config", "/Users/example/.ssh/zed")
        .file("/Users/example/.ssh/zed/settings.json", "{}");

    assert_eq!(
        probe_home(&fs, ".config/zed/settings.json"),
        ProbeStatus::OutOfBounds
    );
}

#[test]
fn probe_reports_a_permission_denied_parent_as_inaccessible() {
    let fs = FakeFs::new()
        .dir(HOME)
        .dir("/Users/example/.config")
        .denied("/Users/example/.config");

    assert_eq!(
        probe_home(&fs, ".config/zed/settings.json"),
        ProbeStatus::Inaccessible
    );
}

#[test]
fn probe_reports_a_permission_denied_leaf_file_as_inaccessible() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file(
            "/Users/example/Library/Preferences/pnpm/auth.ini",
            "token=x\n",
        )
        .denied("/Users/example/Library/Preferences/pnpm/auth.ini");

    assert_eq!(
        probe_home(&fs, "Library/Preferences/pnpm/auth.ini"),
        ProbeStatus::Inaccessible
    );
}

#[test]
fn probe_fails_closed_when_home_is_missing() {
    let fs = FakeFs::new();

    assert_eq!(probe_home(&fs, ".gitconfig"), ProbeStatus::Inaccessible);
}

#[test]
fn probe_fails_closed_when_home_is_not_absolute() {
    let fs = FakeFs::new()
        .dir("/relative/home")
        .file("/relative/home/.gitconfig", "[user]\n");

    assert_eq!(
        probe(&home_entry(".gitconfig"), Path::new("relative/home"), &fs),
        ProbeStatus::Inaccessible
    );
}

#[test]
fn probe_reports_a_dangling_leaf_symlink_as_not_regular() {
    let fs = FakeFs::new()
        .dir(HOME)
        .symlink("/Users/example/.gitconfig", "/Users/example/missing");

    assert_eq!(
        probe_home(&fs, ".gitconfig"),
        ProbeStatus::SymlinkOrNonRegular
    );
}

#[test]
fn probe_finds_a_fixed_regular_file_at_its_declared_location() {
    let fs = FakeFs::new().file("/etc/ssh/ssh_config", "Host *\n");

    assert!(matches!(
        probe(&fixed_entry("/etc/ssh/ssh_config"), Path::new(HOME), &fs),
        ProbeStatus::Found(_)
    ));
}

#[test]
fn probe_reports_a_fixed_symlink_resolving_elsewhere_as_out_of_bounds() {
    let fs = FakeFs::new()
        .dir("/etc/ssh")
        .file("/tmp/evil/config", "Host *\n")
        .symlink("/etc/ssh/ssh_config", "/tmp/evil/config");

    assert_eq!(
        probe(&fixed_entry("/etc/ssh/ssh_config"), Path::new(HOME), &fs),
        ProbeStatus::OutOfBounds
    );
}

#[test]
fn probe_reports_a_fixed_directory_as_not_regular_and_a_missing_fixed_file_as_not_found() {
    let directory = FakeFs::new().dir("/etc/ssh/ssh_config");
    assert_eq!(
        probe(
            &fixed_entry("/etc/ssh/ssh_config"),
            Path::new(HOME),
            &directory
        ),
        ProbeStatus::SymlinkOrNonRegular
    );

    let missing = FakeFs::new().dir("/etc/ssh");
    assert_eq!(
        probe(
            &fixed_entry("/etc/ssh/ssh_config"),
            Path::new(HOME),
            &missing
        ),
        ProbeStatus::NotFound
    );
}

#[test]
fn probe_never_lists_directories_or_names_unregistered_entries() {
    let fs = FakeFs::new()
        .dir(HOME)
        .file(
            "/Users/example/Library/Application Support/Secret/unlisted.json",
            "{}",
        )
        .dir("/Users/example/Library/Application Support/Locked")
        .denied("/Users/example/Library/Application Support/Locked")
        .file("/Users/example/.config/unlisted-app/token.json", "{}")
        .file("/Users/example/.config/zed/settings.json", "{}")
        .file(
            "/Users/example/.git-credentials",
            "https://user:pass@host\n",
        )
        .file("/etc/ssh/ssh_config", "Host *\n")
        .forbid_reads();
    let registry = Registry::builtin().expect("built-in registry is valid");
    let home = Path::new(HOME);

    let mut allowed = std::collections::BTreeSet::new();
    for entry in registry.entries() {
        for ancestor in resolve_path(entry, home).ancestors() {
            allowed.insert(ancestor.to_path_buf());
        }
    }

    let statuses: Vec<ProbeStatus> = registry
        .entries()
        .iter()
        .map(|entry| probe(entry, home, &fs))
        .collect();

    assert_eq!(statuses.len(), registry.entries().len());
    let zed = registry.get("zed-settings").expect("zed registered");
    assert!(matches!(probe(zed, home, &fs), ProbeStatus::Found(_)));
    for (op, path) in fs.ops() {
        assert_ne!(op, Op::Read, "probing must not read content");
        assert!(
            allowed.contains(&path),
            "probe touched an unregistered path: {}",
            path.display()
        );
    }
}

#[test]
fn probe_status_serializes_with_a_camel_case_tag_and_no_path() {
    assert_eq!(
        serde_json::to_string(&ProbeStatus::Found(FileMeta {
            size: 7,
            modified_unix_millis: 42,
        }))
        .expect("serializes"),
        r#"{"status":"found","size":7,"modifiedUnixMillis":42}"#
    );
    assert_eq!(
        serde_json::to_string(&ProbeStatus::OutOfBounds).expect("serializes"),
        r#"{"status":"outOfBounds"}"#
    );
}
