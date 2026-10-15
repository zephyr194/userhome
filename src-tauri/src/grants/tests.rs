use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::error::{AppError, AppErrorCode};

use super::{
    GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose, GrantRecord, GrantStore,
    display_path,
};

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-grants-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create fixture root");
        Self { root }
    }

    fn store_directory(&self) -> PathBuf {
        self.root.join("support")
    }

    fn coordinator(&self) -> GrantCoordinator {
        GrantCoordinator::new(GrantStore::new(self.store_directory()))
    }

    fn store_file(&self) -> PathBuf {
        self.store_directory().join("grants.json")
    }

    fn directory(&self, name: &str) -> PathBuf {
        let path = self.root.join(name);
        fs::create_dir_all(&path).expect("create directory");
        path
    }

    fn file(&self, name: &str) -> PathBuf {
        let path = self.root.join(name);
        fs::write(&path, b"content").expect("write file");
        path
    }

    fn write_store(&self, contents: &str) {
        fs::create_dir_all(self.store_directory()).expect("create store directory");
        fs::write(self.store_file(), contents).expect("write store");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Restore access so cleanup works after permission tests.
        let _ = fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700));
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn running_as_privileged_user(probe: &Path) -> bool {
    fs::read_dir(probe).is_ok()
}

#[test]
fn creates_a_grant_with_canonical_path_purpose_and_creation_time() {
    let fixture = Fixture::new();
    let directory = fixture.directory("project");
    let unnormalized = directory.join("..").join("project");

    let record = fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &unnormalized)
        .expect("create grant");

    assert_eq!(record.path, directory);
    assert_eq!(record.purpose, GrantPurpose::ConfigDirectory);
    assert_eq!(record.kind, GrantKind::Directory);
    assert!(record.created_at_epoch_ms > 0);
    assert!(GrantId::parse(record.id.as_str()).is_ok());
}

#[test]
fn creates_file_grants_for_regular_files() {
    let fixture = Fixture::new();
    let file = fixture.file("settings.json");

    let record = fixture
        .coordinator()
        .create(GrantPurpose::ConfigFile, &file)
        .expect("create file grant");

    assert_eq!(record.kind, GrantKind::File);
    assert_eq!(record.path, file);
}

#[test]
fn granting_the_same_target_and_purpose_twice_returns_the_existing_grant() {
    let fixture = Fixture::new();
    let directory = fixture.directory("project");
    let coordinator = fixture.coordinator();

    let first = coordinator
        .create(GrantPurpose::ConfigDirectory, &directory)
        .expect("first grant");
    let second = coordinator
        .create(GrantPurpose::ConfigDirectory, &directory)
        .expect("second grant");

    assert_eq!(first, second);
    assert_eq!(coordinator.list().expect("list grants").len(), 1);
}

#[test]
fn grants_round_trip_through_persistent_storage_with_private_modes() {
    let fixture = Fixture::new();
    let directory = fixture.directory("project");
    let file = fixture.file("settings.json");
    let first = fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &directory)
        .expect("directory grant");
    let second = fixture
        .coordinator()
        .create(GrantPurpose::ConfigFile, &file)
        .expect("file grant");

    let reloaded = fixture.coordinator().list().expect("list after reload");

    assert_eq!(reloaded, vec![first, second]);
    let store_mode = fs::metadata(fixture.store_file())
        .expect("store metadata")
        .permissions()
        .mode()
        & 0o777;
    let directory_mode = fs::metadata(fixture.store_directory())
        .expect("store directory metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(store_mode, 0o600);
    assert_eq!(directory_mode, 0o700);
}

#[test]
fn a_revoked_grant_is_rejected_for_resolution_and_stays_revoked_after_reload() {
    let fixture = Fixture::new();
    let directory = fixture.directory("project");
    fs::write(directory.join("config.toml"), b"a = 1").expect("write child");
    let coordinator = fixture.coordinator();
    let record = coordinator
        .create(GrantPurpose::ConfigDirectory, &directory)
        .expect("create grant");
    assert_eq!(
        coordinator
            .resolve_child(&record.id, "config.toml")
            .expect("resolve before revoke"),
        directory.join("config.toml")
    );

    coordinator.revoke(&record.id).expect("revoke grant");

    assert_eq!(
        coordinator.resolve(&record.id),
        Err(GrantError::UnknownGrant)
    );
    assert_eq!(
        coordinator.resolve_child(&record.id, "config.toml"),
        Err(GrantError::UnknownGrant)
    );
    assert_eq!(
        fixture.coordinator().resolve(&record.id),
        Err(GrantError::UnknownGrant)
    );
    assert!(fixture.coordinator().list().expect("list").is_empty());
}

#[test]
fn revoking_an_unknown_grant_is_reported() {
    let fixture = Fixture::new();
    let id = GrantId::parse(&Uuid::new_v4().to_string()).expect("valid id");

    assert_eq!(
        fixture.coordinator().revoke(&id),
        Err(GrantError::UnknownGrant)
    );
}

#[test]
fn grant_ids_must_be_canonical_uuids() {
    assert_eq!(
        GrantId::parse("../../etc/passwd"),
        Err(GrantError::UnknownGrant)
    );
    assert_eq!(GrantId::parse(""), Err(GrantError::UnknownGrant));
    assert_eq!(
        GrantId::parse(&Uuid::new_v4().to_string().to_uppercase()),
        Err(GrantError::UnknownGrant)
    );
}

#[test]
fn rejects_relative_paths_as_a_normalization_failure() {
    let fixture = Fixture::new();

    assert_eq!(
        fixture
            .coordinator()
            .create(GrantPurpose::ConfigDirectory, Path::new("relative/dir")),
        Err(GrantError::Canonicalize)
    );
    assert!(!fixture.store_file().exists());
}

#[test]
fn rejects_paths_that_cannot_be_canonicalized() {
    let fixture = Fixture::new();
    let loop_a = fixture.root.join("loop-a");
    let loop_b = fixture.root.join("loop-b");
    symlink(&loop_b, &loop_a).expect("link a");
    symlink(&loop_a, &loop_b).expect("link b");

    assert_eq!(
        fixture
            .coordinator()
            .create(GrantPurpose::ConfigDirectory, &loop_a),
        Err(GrantError::Canonicalize)
    );
}

#[test]
fn rejects_missing_targets_as_not_found() {
    let fixture = Fixture::new();

    assert_eq!(
        fixture
            .coordinator()
            .create(GrantPurpose::ConfigDirectory, &fixture.root.join("missing")),
        Err(GrantError::NotFound)
    );
}

#[test]
fn rejects_a_file_for_a_directory_grant_and_a_directory_for_a_file_grant() {
    let fixture = Fixture::new();
    let file = fixture.file("settings.json");
    let directory = fixture.directory("project");
    let coordinator = fixture.coordinator();

    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &file),
        Err(GrantError::NotDirectory)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigFile, &directory),
        Err(GrantError::NotFile)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::Executable, &directory),
        Err(GrantError::NotFile)
    );
}

#[test]
fn rejects_unreadable_directories_and_files_as_permission_denied() {
    let fixture = Fixture::new();
    let directory = fixture.directory("locked-dir");
    let file = fixture.file("locked-file");
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o000)).expect("lock directory");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).expect("lock file");
    if running_as_privileged_user(&directory) {
        // Permission bits are not enforced for this user (for example root).
        return;
    }
    let coordinator = fixture.coordinator();

    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &directory),
        Err(GrantError::PermissionDenied)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigFile, &file),
        Err(GrantError::PermissionDenied)
    );
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).expect("unlock directory");
}

#[test]
fn rejects_targets_below_an_untraversable_directory_as_permission_denied() {
    let fixture = Fixture::new();
    let outer = fixture.directory("outer");
    let inner = outer.join("inner");
    fs::create_dir_all(&inner).expect("create inner");
    fs::set_permissions(&outer, fs::Permissions::from_mode(0o000)).expect("lock outer");
    if running_as_privileged_user(&outer) {
        return;
    }

    let result = fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &inner);

    fs::set_permissions(&outer, fs::Permissions::from_mode(0o700)).expect("unlock outer");
    assert_eq!(result, Err(GrantError::PermissionDenied));
}

#[test]
fn creating_through_a_symbolic_link_records_the_canonical_target() {
    let fixture = Fixture::new();
    let real = fixture.directory("real");
    let link = fixture.root.join("link");
    symlink(&real, &link).expect("create link");

    let record = fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &link)
        .expect("create grant through link");

    assert_eq!(record.path, real);
}

#[test]
fn a_root_swapped_for_a_symbolic_link_no_longer_resolves() {
    let fixture = Fixture::new();
    let root = fixture.directory("project");
    let elsewhere = fixture.directory("elsewhere");
    let coordinator = fixture.coordinator();
    let record = coordinator
        .create(GrantPurpose::ConfigDirectory, &root)
        .expect("create grant");
    fs::remove_dir_all(&root).expect("remove root");
    symlink(&elsewhere, &root).expect("replace root with link");

    assert_eq!(
        coordinator.resolve(&record.id),
        Err(GrantError::SymlinkEscape)
    );
}

#[test]
fn child_symbolic_links_may_not_leave_the_granted_directory() {
    let fixture = Fixture::new();
    let root = fixture.directory("project");
    let outside = fixture.file("outside.txt");
    fs::write(root.join("inside.txt"), b"inside").expect("write inside");
    symlink(&outside, root.join("escape")).expect("escaping link");
    symlink("inside.txt", root.join("contained")).expect("contained link");
    let coordinator = fixture.coordinator();
    let record = coordinator
        .create(GrantPurpose::ConfigDirectory, &root)
        .expect("create grant");

    assert_eq!(
        coordinator.resolve_child(&record.id, "escape"),
        Err(GrantError::SymlinkEscape)
    );
    assert_eq!(
        coordinator
            .resolve_child(&record.id, "contained")
            .expect("contained link"),
        root.join("inside.txt")
    );
}

#[test]
fn child_resolution_rejects_traversal_absolute_and_unknown_children() {
    let fixture = Fixture::new();
    let root = fixture.directory("project");
    let coordinator = fixture.coordinator();
    let record = coordinator
        .create(GrantPurpose::ConfigDirectory, &root)
        .expect("create grant");

    for relative in ["../outside", "/etc/passwd", "", "a/../b", "a\\b"] {
        assert_eq!(
            coordinator.resolve_child(&record.id, relative),
            Err(GrantError::InvalidRelativePath),
            "{relative:?}"
        );
    }
    assert_eq!(
        coordinator.resolve_child(&record.id, "missing.toml"),
        Err(GrantError::NotFound)
    );
}

#[test]
fn child_resolution_requires_a_directory_grant() {
    let fixture = Fixture::new();
    let file = fixture.file("settings.json");
    let coordinator = fixture.coordinator();
    let record = coordinator
        .create(GrantPurpose::ConfigFile, &file)
        .expect("create grant");

    assert_eq!(
        coordinator.resolve_child(&record.id, "settings.json"),
        Err(GrantError::NotDirectory)
    );
}

#[test]
fn a_granted_target_that_disappears_stops_resolving() {
    let fixture = Fixture::new();
    let file = fixture.file("settings.json");
    let coordinator = fixture.coordinator();
    let record = coordinator
        .create(GrantPurpose::ConfigFile, &file)
        .expect("create grant");
    fs::remove_file(&file).expect("remove file");

    assert_eq!(coordinator.resolve(&record.id), Err(GrantError::NotFound));
}

#[test]
fn a_corrupt_store_is_reported_and_never_overwritten() {
    let fixture = Fixture::new();
    let directory = fixture.directory("project");
    fixture.write_store("{ not json");
    let coordinator = fixture.coordinator();

    assert_eq!(coordinator.list(), Err(GrantError::StoreCorrupt));
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &directory),
        Err(GrantError::StoreCorrupt)
    );
    assert_eq!(
        fs::read_to_string(fixture.store_file()).expect("read store"),
        "{ not json"
    );
}

#[test]
fn an_unknown_store_version_is_reported_and_never_overwritten() {
    let fixture = Fixture::new();
    let directory = fixture.directory("project");
    let future = r#"{"schemaVersion":2,"grants":[],"extra":true}"#;
    fixture.write_store(future);
    let coordinator = fixture.coordinator();

    assert_eq!(coordinator.list(), Err(GrantError::StoreUnsupportedVersion));
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &directory),
        Err(GrantError::StoreUnsupportedVersion)
    );
    assert_eq!(
        fs::read_to_string(fixture.store_file()).expect("read store"),
        future
    );
}

#[test]
fn stores_with_a_missing_version_unknown_fields_or_malformed_records_are_corrupt() {
    let fixture = Fixture::new();
    let id = Uuid::new_v4();
    let record = |extra: &str| {
        format!(
            r#"{{"id":"{id}","purpose":"CONFIG_DIRECTORY","kind":"DIRECTORY","path":"/tmp","createdAtEpochMs":1{extra}}}"#
        )
    };
    let cases = [
        r#"{"grants":[]}"#.to_owned(),
        r#"{"schemaVersion":1}"#.to_owned(),
        r#"{"schemaVersion":1,"grants":[],"extra":1}"#.to_owned(),
        format!(
            r#"{{"schemaVersion":1,"grants":[{}]}}"#,
            record(r#","extra":1"#)
        ),
        format!(
            r#"{{"schemaVersion":1,"grants":[{}]}}"#,
            record("").replace("DIRECTORY\",\"path", "FILE\",\"path")
        ),
        format!(
            r#"{{"schemaVersion":1,"grants":[{}]}}"#,
            record("").replace("\"/tmp\"", "\"relative\"")
        ),
        format!(
            r#"{{"schemaVersion":1,"grants":[{},{}]}}"#,
            record(""),
            record("")
        ),
        format!(
            r#"{{"schemaVersion":1,"grants":[{}]}}"#,
            record("").replace(&id.to_string(), "not-a-uuid")
        ),
    ];

    for case in cases {
        fixture.write_store(&case);
        assert_eq!(
            fixture.coordinator().list(),
            Err(GrantError::StoreCorrupt),
            "{case}"
        );
    }
}

#[test]
fn a_store_that_is_not_a_regular_file_is_corrupt() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.store_file()).expect("directory in place of store");

    assert_eq!(fixture.coordinator().list(), Err(GrantError::StoreCorrupt));
}

#[test]
fn a_missing_store_is_an_empty_list() {
    let fixture = Fixture::new();

    assert_eq!(fixture.coordinator().list(), Ok(Vec::new()));
}

#[test]
fn saving_more_grants_than_the_limit_is_refused() {
    let fixture = Fixture::new();
    let store = GrantStore::new(fixture.store_directory());
    let records: Vec<GrantRecord> = (0..=super::MAX_GRANTS)
        .map(|index| GrantRecord {
            id: GrantId::generate(),
            purpose: GrantPurpose::ConfigDirectory,
            kind: GrantKind::Directory,
            path: PathBuf::from(format!("/tmp/grant-{index}")),
            created_at_epoch_ms: 1,
        })
        .collect();

    assert_eq!(store.save(&records), Err(GrantError::LimitReached));
    assert!(!fixture.store_file().exists());
}

#[test]
fn summaries_use_home_relative_display_paths_and_hide_nothing_else_needed() {
    let home = Path::new("/Users/someone");

    assert_eq!(display_path(Path::new("/Users/someone"), Some(home)), "~");
    assert_eq!(
        display_path(Path::new("/Users/someone/.config/tool"), Some(home)),
        "~/.config/tool"
    );
    assert_eq!(
        display_path(Path::new("/Volumes/data/tool"), Some(home)),
        "/Volumes/data/tool"
    );
    assert_eq!(display_path(Path::new("/opt/tool"), None), "/opt/tool");
}

#[test]
fn grant_errors_map_to_distinct_application_errors() {
    let cases = [
        (GrantError::Canonicalize, AppErrorCode::InvalidInput),
        (GrantError::SymlinkEscape, AppErrorCode::PermissionDenied),
        (GrantError::NotDirectory, AppErrorCode::ValidationFailed),
        (GrantError::NotFile, AppErrorCode::ValidationFailed),
        (GrantError::PermissionDenied, AppErrorCode::PermissionDenied),
        (GrantError::NotFound, AppErrorCode::NotFound),
        (GrantError::UnknownGrant, AppErrorCode::NotFound),
        (GrantError::LimitReached, AppErrorCode::Conflict),
        (GrantError::StoreCorrupt, AppErrorCode::ValidationFailed),
        (
            GrantError::StoreUnsupportedVersion,
            AppErrorCode::NotSupported,
        ),
    ];
    let mut messages = std::collections::BTreeSet::new();
    for (error, code) in cases {
        let app_error = AppError::from(error);
        assert_eq!(app_error.code(), code, "{error:?}");
        let message = serde_json::to_value(&app_error).expect("serialize")["message"]
            .as_str()
            .expect("message")
            .to_owned();
        assert!(messages.insert(message), "duplicate message for {error:?}");
    }
}
