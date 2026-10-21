use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::error::{AppError, AppErrorCode};

use super::{
    GRANT_SCHEMA_VERSION, GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose,
    GrantRecord, GrantStore, display_path,
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

    // The fixture root plays the injected $HOME, so every fixture target lies
    // strictly below it.
    fn coordinator(&self) -> GrantCoordinator {
        self.coordinator_with_home(Some(self.root.clone()))
    }

    fn coordinator_with_home(&self, home: Option<PathBuf>) -> GrantCoordinator {
        GrantCoordinator::new(GrantStore::new(self.store_directory()), home)
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
            file_name: None,
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

// ---- Authorization is limited to targets strictly below $HOME (R1-2) ----

/// A fixture whose injected $HOME is `<root>/home`, with unrelated locations
/// next to it under the same root.
struct HomeFixture {
    fixture: Fixture,
    home: PathBuf,
}

impl HomeFixture {
    fn new() -> Self {
        let fixture = Fixture::new();
        let home = fixture.directory("home");
        Self { fixture, home }
    }

    fn coordinator(&self) -> GrantCoordinator {
        self.fixture.coordinator_with_home(Some(self.home.clone()))
    }

    fn home_directory(&self, relative: &str) -> PathBuf {
        let path = self.home.join(relative);
        fs::create_dir_all(&path).expect("create home directory");
        path
    }
}

#[test]
fn rejects_directories_and_files_outside_home_without_storing_anything() {
    let home = HomeFixture::new();
    let outside_directory = home.fixture.directory("outside");
    let outside_file = home.fixture.file("outside.txt");
    let coordinator = home.coordinator();

    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &outside_directory),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigFile, &outside_file),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, Path::new("/")),
        Err(GrantError::OutsideHome)
    );
    assert!(!home.fixture.store_file().exists());
}

#[test]
fn rejects_home_itself_and_accepts_its_children() {
    let home = HomeFixture::new();
    let child = home.home_directory(".config/tool");
    let coordinator = home.coordinator();

    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &home.home),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &home.home.join(".config/..")),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        coordinator
            .create(GrantPurpose::ConfigDirectory, &child)
            .expect("child of home")
            .path,
        child
    );
}

#[test]
fn compares_path_components_so_a_prefix_named_sibling_is_outside_home() {
    let fixture = Fixture::new();
    let home = fixture.directory("ab");
    let sibling = fixture.directory("abc");
    let sibling_file = sibling.join("settings.json");
    fs::write(&sibling_file, b"{}").expect("write file");
    let coordinator = fixture.coordinator_with_home(Some(home));

    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &sibling),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigFile, &sibling_file),
        Err(GrantError::OutsideHome)
    );
}

#[test]
fn rejects_sensitive_directories_and_their_subpaths_but_not_lookalikes() {
    let home = HomeFixture::new();
    let coordinator = home.coordinator();
    for protected in [
        ".ssh",
        ".ssh/keys",
        ".gnupg",
        ".gnupg/private-keys-v1.d",
        "Library/Keychains",
        "Library/Keychains/metadata",
        ".SSH",
    ] {
        let directory = home.home_directory(protected);
        assert_eq!(
            coordinator.create(GrantPurpose::ConfigDirectory, &directory),
            Err(GrantError::ProtectedLocation),
            "{protected}"
        );
    }
    let key = home.home.join(".ssh/id_ed25519");
    fs::write(&key, b"secret").expect("write key");
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigFile, &key),
        Err(GrantError::ProtectedLocation)
    );
    assert!(!home.fixture.store_file().exists());

    for allowed in [".ssh-config", ".gnupg2", "Library", "Library/KeychainsOld"] {
        let directory = home.home_directory(allowed);
        coordinator
            .create(GrantPurpose::ConfigDirectory, &directory)
            .unwrap_or_else(|error| panic!("{allowed} must be allowed: {error:?}"));
    }
}

#[test]
fn a_symlinked_sensitive_directory_is_still_protected_through_its_real_location() {
    let home = HomeFixture::new();
    let real = home.home_directory("dotfiles/ssh");
    symlink(&real, home.home.join(".ssh")).expect("link .ssh");
    let coordinator = home.coordinator();

    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &home.home.join(".ssh")),
        Err(GrantError::ProtectedLocation)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &real),
        Err(GrantError::ProtectedLocation)
    );
}

#[test]
fn symbolic_links_below_home_that_resolve_outside_home_are_rejected() {
    let home = HomeFixture::new();
    let outside_directory = home.fixture.directory("outside");
    let outside_file = home.fixture.file("outside.txt");
    let directory_link = home.home.join("directory-link");
    let file_link = home.home.join("file-link");
    symlink(&outside_directory, &directory_link).expect("directory link");
    symlink(&outside_file, &file_link).expect("file link");
    let coordinator = home.coordinator();

    assert_eq!(
        coordinator.create(GrantPurpose::ConfigDirectory, &directory_link),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        coordinator.create(GrantPurpose::ConfigFile, &file_link),
        Err(GrantError::OutsideHome)
    );
    assert!(!home.fixture.store_file().exists());
}

#[test]
fn a_missing_or_unusable_home_makes_every_new_grant_fail_closed() {
    let fixture = Fixture::new();
    let directory = fixture.directory("project");
    for home in [
        None,
        Some(PathBuf::from("relative/home")),
        Some(PathBuf::from("")),
        Some(PathBuf::from("/")),
    ] {
        assert_eq!(
            fixture
                .coordinator_with_home(home.clone())
                .create(GrantPurpose::ConfigDirectory, &directory),
            Err(GrantError::HomeUnavailable),
            "{home:?}"
        );
    }
    assert!(!fixture.store_file().exists());
}

#[test]
fn an_existing_record_outside_home_is_invalid_on_use_but_neither_deleted_nor_rewritten() {
    let home = HomeFixture::new();
    let outside = home.fixture.directory("outside");
    let outside_file = home.fixture.file("outside.txt");
    // Written while a wider $HOME was in effect (or by an older version).
    let wide = home.fixture.coordinator();
    let directory_grant = wide
        .create(GrantPurpose::ConfigDirectory, &outside)
        .expect("wide directory grant");
    let file_grant = wide
        .create(GrantPurpose::ConfigFile, &outside_file)
        .expect("wide file grant");
    let before = fs::read(home.fixture.store_file()).expect("read store");
    let narrow = home.coordinator();

    assert_eq!(
        narrow.resolve(&directory_grant.id),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(narrow.resolve(&file_grant.id), Err(GrantError::OutsideHome));
    assert_eq!(
        narrow.resolve_child(&directory_grant.id, "anything"),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        narrow
            .read_resource(&directory_grant.id, Some("anything"))
            .map(|_| ()),
        Err(super::ReadError::Excluded)
    );
    assert_eq!(
        narrow.list().expect("list still works"),
        vec![directory_grant.clone(), file_grant]
    );
    assert_eq!(
        fs::read(home.fixture.store_file()).expect("read store again"),
        before,
        "the store must not be modified"
    );
    // The record stays revocable.
    narrow.revoke(&directory_grant.id).expect("revoke");
}

#[test]
fn an_existing_record_in_a_protected_location_is_invalid_on_use() {
    let home = HomeFixture::new();
    let protected = home.home_directory(".gnupg");
    let grant = home
        .fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &protected)
        .expect("grant under the wide home");

    assert_eq!(
        home.coordinator().resolve(&grant.id),
        Err(GrantError::ProtectedLocation)
    );
    assert_eq!(home.coordinator().list().expect("list").len(), 1);
}

#[test]
fn a_home_that_becomes_unusable_invalidates_existing_grants_on_use() {
    let home = HomeFixture::new();
    let project = home.home_directory("project");
    let grant = home
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("create grant");

    for unusable in [
        None,
        Some(PathBuf::from("relative")),
        Some(PathBuf::from("/")),
    ] {
        assert_eq!(
            home.fixture
                .coordinator_with_home(unusable)
                .resolve(&grant.id),
            Err(GrantError::HomeUnavailable)
        );
    }
    home.coordinator()
        .resolve(&grant.id)
        .expect("still valid under the real home");
}

#[test]
fn a_grant_inside_home_whose_root_is_swapped_for_an_outside_link_stops_resolving() {
    let home = HomeFixture::new();
    let project = home.home_directory("project");
    let outside = home.fixture.directory("outside");
    let coordinator = home.coordinator();
    let grant = coordinator
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("create grant");
    fs::remove_dir_all(&project).expect("remove project");
    symlink(&outside, &project).expect("swap in link");

    assert!(matches!(
        coordinator.resolve(&grant.id),
        Err(GrantError::SymlinkEscape | GrantError::OutsideHome)
    ));
}

#[test]
fn home_boundary_errors_map_to_distinct_messages_that_hide_paths() {
    let cases = [
        (GrantError::OutsideHome, AppErrorCode::PermissionDenied),
        (
            GrantError::ProtectedLocation,
            AppErrorCode::PermissionDenied,
        ),
        (GrantError::HomeUnavailable, AppErrorCode::ValidationFailed),
    ];
    let mut messages = std::collections::BTreeSet::new();
    for (error, code) in cases {
        let app_error = AppError::from(error);
        assert_eq!(app_error.code(), code, "{error:?}");
        let message = serde_json::to_value(&app_error).expect("serialize")["message"]
            .as_str()
            .expect("message")
            .to_owned();
        assert!(!message.contains('/'), "{error:?} leaks a path: {message}");
        assert!(messages.insert(message), "duplicate message for {error:?}");
    }
}

#[test]
fn tls_material_grants_are_refused_by_every_general_entry() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let cert = fixture.file("cert.pem");
    let record = coordinator
        .create(GrantPurpose::TlsMaterialFile, &cert)
        .expect("tls material grant");

    assert_eq!(record.kind, GrantKind::File);
    assert_eq!(
        coordinator.resolve(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        coordinator.resolve_shell_startup(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        coordinator.resolve_launch_agent(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        coordinator.resolve_child(&record.id, "anything"),
        Err(GrantError::ReservedPurpose)
    );
    assert!(
        coordinator
            .read_resource_with_limit(&record.id, None, 1024)
            .is_err()
    );
}

#[test]
fn tls_material_grant_resolves_only_through_the_tls_entry_and_fails_after_revoke() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let key = fixture.file("key.pem");
    let record = coordinator
        .create(GrantPurpose::TlsMaterialFile, &key)
        .expect("tls material grant");

    let resolved = coordinator
        .resolve_tls_material(&record.id)
        .expect("tls entry resolves its own purpose");
    assert_eq!(resolved.purpose, GrantPurpose::TlsMaterialFile);
    assert_eq!(resolved.target_path(), key);

    coordinator.revoke(&record.id).expect("revoke");
    assert_eq!(
        coordinator.resolve_tls_material(&record.id),
        Err(GrantError::UnknownGrant)
    );
}

#[test]
fn tls_material_purpose_survives_a_reload_and_an_unknown_purpose_fails_closed() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let record = coordinator
        .create(GrantPurpose::TlsMaterialFile, &fixture.file("cert.pem"))
        .expect("tls material grant");
    assert_eq!(
        fixture.coordinator().list().expect("reload"),
        vec![record.clone()]
    );

    let future_store = format!(
        r#"{{"schemaVersion":{GRANT_SCHEMA_VERSION},"grants":[{{"id":"{}","purpose":"FUTURE_PURPOSE","kind":"FILE","path":"/tmp/x","createdAtEpochMs":1}}]}}"#,
        Uuid::new_v4()
    );
    fixture.write_store(&future_store);
    assert_eq!(fixture.coordinator().list(), Err(GrantError::StoreCorrupt));
}
