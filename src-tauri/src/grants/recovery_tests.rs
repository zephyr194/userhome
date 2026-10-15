//! Grant store health status and the confirmed isolate-and-reset recovery.

use std::{
    cell::{Cell, RefCell},
    fs, io,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use serde_json::json;
use uuid::Uuid;

use super::{
    GrantCoordinator, GrantError, GrantPurpose, GrantResetError, GrantStore, GrantStoreProblem,
    GrantStoreStatus,
    recovery::{RealResetOps, ResetOps},
};

const STAMP: &str = "20260102T030405Z";

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-grant-recovery-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create fixture root");
        Self { root }
    }

    fn store_directory(&self) -> PathBuf {
        self.root.join("support")
    }

    fn store_file(&self) -> PathBuf {
        self.store_directory().join("grants.json")
    }

    fn quarantine(&self, suffix: &str) -> PathBuf {
        self.store_directory()
            .join(format!("grants.json.corrupt-{STAMP}{suffix}"))
    }

    fn coordinator(&self) -> GrantCoordinator {
        GrantCoordinator::new(
            GrantStore::new(self.store_directory()),
            Some(self.root.clone()),
        )
    }

    fn directory(&self, name: &str) -> PathBuf {
        let path = self.root.join(name);
        fs::create_dir_all(&path).expect("create directory");
        path
    }

    fn write_store(&self, contents: &[u8]) {
        fs::create_dir_all(self.store_directory()).expect("create store directory");
        fs::write(self.store_file(), contents).expect("write store");
        fs::set_permissions(self.store_file(), fs::Permissions::from_mode(0o600))
            .expect("restrict store");
    }

    fn store_bytes(&self) -> Vec<u8> {
        fs::read(self.store_file()).expect("read store")
    }

    /// Names of everything in the store directory, sorted.
    fn entries(&self) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(self.store_directory())
            .expect("list store directory")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700));
        let _ = fs::set_permissions(self.store_directory(), fs::Permissions::from_mode(0o700));
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn unavailable(problem: GrantStoreProblem) -> GrantStoreStatus {
    GrantStoreStatus::Unavailable { reason: problem }
}

fn valid_record(id: Uuid) -> String {
    format!(
        r#"{{"id":"{id}","purpose":"CONFIG_DIRECTORY","kind":"DIRECTORY","path":"/tmp","createdAtEpochMs":1}}"#
    )
}

// ---- status ---------------------------------------------------------------

#[test]
fn a_missing_or_valid_store_is_available() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture.coordinator().store_status(),
        GrantStoreStatus::Available
    );

    let project = fixture.directory("project");
    fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("create grant");
    assert_eq!(
        fixture.coordinator().store_status(),
        GrantStoreStatus::Available
    );
}

#[test]
fn invalid_json_malformed_records_and_oversize_are_reported_as_corrupt() {
    let fixture = Fixture::new();
    let id = Uuid::new_v4();
    let record = valid_record(id);
    let too_many = (0..=super::MAX_GRANTS)
        .map(|_| valid_record(Uuid::new_v4()))
        .collect::<Vec<_>>()
        .join(",");
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("invalid json", b"{ not json".to_vec()),
        ("missing version", br#"{"grants":[]}"#.to_vec()),
        (
            "unknown field",
            br#"{"schemaVersion":1,"grants":[],"extra":1}"#.to_vec(),
        ),
        (
            "relative path",
            format!(
                r#"{{"schemaVersion":1,"grants":[{}]}}"#,
                record.replace("\"/tmp\"", "\"relative\"")
            )
            .into_bytes(),
        ),
        (
            "duplicate id",
            format!(r#"{{"schemaVersion":1,"grants":[{record},{record}]}}"#).into_bytes(),
        ),
        (
            "too many records",
            format!(r#"{{"schemaVersion":1,"grants":[{too_many}]}}"#).into_bytes(),
        ),
        ("oversize file", vec![b' '; 256 * 1024 + 1]),
    ];

    for (name, bytes) in cases {
        fixture.write_store(&bytes);
        assert_eq!(
            fixture.coordinator().store_status(),
            unavailable(GrantStoreProblem::Corrupt),
            "{name}"
        );
    }
}

#[test]
fn a_newer_version_is_distinguishable_from_corruption() {
    let fixture = Fixture::new();
    fixture.write_store(br#"{"schemaVersion":2,"grants":[],"extra":true}"#);

    assert_eq!(
        fixture.coordinator().store_status(),
        unavailable(GrantStoreProblem::NewerVersion)
    );
}

#[test]
fn a_store_with_new_file_grants_is_not_reported_as_unavailable() {
    let fixture = Fixture::new();
    let docs = fixture.directory("docs");
    fixture
        .coordinator()
        .create_new_file(&docs, "notes.conf")
        .expect("new-file grant");

    assert_eq!(
        fixture.coordinator().store_status(),
        GrantStoreStatus::Available
    );
}

#[test]
fn a_directory_or_symlink_in_place_of_the_store_is_not_a_regular_file() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.store_file()).expect("directory in place of store");
    assert_eq!(
        fixture.coordinator().store_status(),
        unavailable(GrantStoreProblem::NotRegularFile)
    );
    fs::remove_dir(fixture.store_file()).expect("remove directory");

    let target = fixture.root.join("elsewhere.json");
    fs::write(&target, br#"{"schemaVersion":1,"grants":[]}"#).expect("write target");
    symlink(&target, fixture.store_file()).expect("symlink store");
    assert_eq!(
        fixture.coordinator().store_status(),
        unavailable(GrantStoreProblem::NotRegularFile)
    );
}

#[test]
fn an_unreadable_store_is_an_io_problem_not_corruption() {
    let fixture = Fixture::new();
    fixture.write_store(br#"{"schemaVersion":1,"grants":[]}"#);
    fs::set_permissions(fixture.store_file(), fs::Permissions::from_mode(0o000))
        .expect("lock store");
    // A privileged user can still read a locked file; the case then proves nothing.
    let readable = fs::File::open(fixture.store_file()).is_ok();
    let status = fixture.coordinator().store_status();
    fs::set_permissions(fixture.store_file(), fs::Permissions::from_mode(0o600))
        .expect("unlock store");
    if readable {
        return;
    }

    assert_eq!(status, unavailable(GrantStoreProblem::Io));
}

#[test]
fn status_serializes_as_enums_only() {
    assert_eq!(
        serde_json::to_value(GrantStoreStatus::Available).expect("serialize"),
        json!({"status":"AVAILABLE"})
    );
    for (problem, name) in [
        (GrantStoreProblem::Corrupt, "CORRUPT"),
        (GrantStoreProblem::NewerVersion, "NEWER_VERSION"),
        (GrantStoreProblem::NotRegularFile, "NOT_REGULAR_FILE"),
        (GrantStoreProblem::Io, "IO"),
    ] {
        assert_eq!(
            serde_json::to_value(unavailable(problem)).expect("serialize"),
            json!({"status":"UNAVAILABLE","reason":name})
        );
    }
}

// ---- reset ----------------------------------------------------------------

#[test]
fn resetting_a_healthy_or_missing_store_is_refused_and_changes_nothing() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture.coordinator().reset_store_with(&RealResetOps, STAMP),
        Err(GrantResetError::NotResettable)
    );
    assert!(!fixture.store_directory().exists());

    let project = fixture.directory("project");
    fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("create grant");
    let before = fixture.store_bytes();
    let entries = fixture.entries();

    assert_eq!(
        fixture.coordinator().reset_store_with(&RealResetOps, STAMP),
        Err(GrantResetError::NotResettable)
    );
    assert_eq!(fixture.store_bytes(), before);
    assert_eq!(fixture.entries(), entries);
}

#[test]
fn an_unreadable_store_cannot_be_reset() {
    let fixture = Fixture::new();
    let original = br#"{"schemaVersion":1,"grants":[]}"#;
    fixture.write_store(original);
    fs::set_permissions(fixture.store_file(), fs::Permissions::from_mode(0o000))
        .expect("lock store");
    let readable = fs::File::open(fixture.store_file()).is_ok();
    let result = fixture.coordinator().reset_store_with(&RealResetOps, STAMP);
    fs::set_permissions(fixture.store_file(), fs::Permissions::from_mode(0o600))
        .expect("unlock store");
    if readable {
        return;
    }

    assert_eq!(result, Err(GrantResetError::NotResettable));
    assert_eq!(fixture.store_bytes(), original);
    assert_eq!(fixture.entries(), ["grants.json"]);
}

#[test]
fn a_corrupt_store_is_isolated_byte_for_byte_and_replaced_by_an_empty_usable_store() {
    let fixture = Fixture::new();
    let original = b"{ not json \xff";
    fixture.write_store(original);
    let before = fixture.store_bytes();
    assert_eq!(before, original);

    // Detecting the damage never touches the file.
    assert_eq!(
        fixture.coordinator().store_status(),
        unavailable(GrantStoreProblem::Corrupt)
    );
    assert_eq!(fixture.store_bytes(), original);

    let reset = fixture
        .coordinator()
        .reset_store_with(&RealResetOps, STAMP)
        .expect("reset");

    assert_eq!(
        reset.quarantine_file_name,
        format!("grants.json.corrupt-{STAMP}")
    );
    assert_eq!(reset.previous_reason, GrantStoreProblem::Corrupt);
    assert_eq!(
        fs::read(fixture.quarantine("")).expect("quarantine"),
        original
    );
    assert_eq!(
        fs::metadata(fixture.quarantine(""))
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        fixture.entries(),
        [
            "grants.json".to_owned(),
            format!("grants.json.corrupt-{STAMP}")
        ]
    );
    assert_eq!(
        fs::metadata(fixture.store_file())
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fixture.store_bytes()).expect("json"),
        json!({"schemaVersion":1,"grants":[]})
    );
    assert_eq!(
        fixture.coordinator().store_status(),
        GrantStoreStatus::Available
    );
    assert_eq!(fixture.coordinator().list(), Ok(Vec::new()));

    let project = fixture.directory("project");
    let grant = fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("grants work after the reset");
    assert_eq!(fixture.coordinator().list(), Ok(vec![grant]));
    // Still untouched.
    assert_eq!(
        fs::read(fixture.quarantine("")).expect("quarantine"),
        original
    );
}

#[test]
fn a_newer_version_store_is_isolated_with_its_own_reason() {
    let fixture = Fixture::new();
    let original = br#"{"schemaVersion":2,"grants":[{"future":true}]}"#;
    fixture.write_store(original);

    let reset = fixture
        .coordinator()
        .reset_store_with(&RealResetOps, STAMP)
        .expect("reset");

    assert_eq!(reset.previous_reason, GrantStoreProblem::NewerVersion);
    assert_eq!(
        fs::read(fixture.quarantine("")).expect("quarantine"),
        original
    );
    assert_eq!(
        fixture.coordinator().store_status(),
        GrantStoreStatus::Available
    );
}

#[test]
fn an_oversize_or_malformed_record_store_is_resettable() {
    let fixture = Fixture::new();
    for original in [
        vec![b' '; 256 * 1024 + 1],
        br#"{"schemaVersion":1,"grants":[1]}"#.to_vec(),
    ] {
        fixture.write_store(&original);
        let reset = fixture
            .coordinator()
            .reset_store_with(&RealResetOps, STAMP)
            .expect("reset");
        assert_eq!(reset.previous_reason, GrantStoreProblem::Corrupt);
        let isolated = fixture.store_directory().join(&reset.quarantine_file_name);
        assert_eq!(fs::read(&isolated).expect("quarantine"), original);
        fs::remove_file(isolated).expect("clean up quarantine");
    }
}

#[test]
fn the_real_timestamp_names_a_utc_quarantine_file() {
    let fixture = Fixture::new();
    fixture.write_store(b"garbage");

    let reset = fixture.coordinator().reset_store().expect("reset");

    let suffix = reset
        .quarantine_file_name
        .strip_prefix("grants.json.corrupt-")
        .expect("prefix");
    assert_eq!(suffix.len(), "20260102T030405Z".len());
    assert!(suffix.ends_with('Z') && suffix.as_bytes()[8] == b'T');
    assert!(
        suffix
            .chars()
            .filter(|c| *c != 'T' && *c != 'Z')
            .all(|c| c.is_ascii_digit())
    );
    assert!(!reset.quarantine_file_name.contains('/'));
    assert!(
        fixture
            .store_directory()
            .join(&reset.quarantine_file_name)
            .is_file()
    );
}

#[test]
fn an_existing_quarantine_name_is_never_overwritten() {
    let fixture = Fixture::new();
    fixture.write_store(b"damaged");
    fs::write(fixture.quarantine(""), b"older quarantine").expect("existing quarantine");
    fs::write(fixture.quarantine("-1"), b"older quarantine 1").expect("existing quarantine 1");

    let reset = fixture
        .coordinator()
        .reset_store_with(&RealResetOps, STAMP)
        .expect("reset");

    assert_eq!(
        reset.quarantine_file_name,
        format!("grants.json.corrupt-{STAMP}-2")
    );
    assert_eq!(
        fs::read(fixture.quarantine("")).expect("read"),
        b"older quarantine"
    );
    assert_eq!(
        fs::read(fixture.quarantine("-1")).expect("read"),
        b"older quarantine 1"
    );
    assert_eq!(
        fs::read(fixture.quarantine("-2")).expect("read"),
        b"damaged"
    );
}

#[test]
fn a_dangling_symlink_at_the_quarantine_name_is_not_followed_or_replaced() {
    let fixture = Fixture::new();
    fixture.write_store(b"damaged");
    let victim = fixture.root.join("victim");
    symlink(&victim, fixture.quarantine("")).expect("dangling symlink");

    let reset = fixture
        .coordinator()
        .reset_store_with(&RealResetOps, STAMP)
        .expect("reset");

    assert_eq!(
        reset.quarantine_file_name,
        format!("grants.json.corrupt-{STAMP}-1")
    );
    assert!(!victim.exists());
    assert!(
        fs::symlink_metadata(fixture.quarantine(""))
            .expect("link")
            .is_symlink()
    );
}

#[test]
fn a_directory_or_symlink_store_is_not_renamed_and_reports_its_own_error() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.store_file()).expect("directory in place of store");
    fs::write(fixture.store_file().join("inner"), b"keep").expect("inner");

    assert_eq!(
        fixture.coordinator().reset_store_with(&RealResetOps, STAMP),
        Err(GrantResetError::NotRegularFile)
    );
    assert!(fixture.store_file().is_dir());
    assert_eq!(fixture.entries(), ["grants.json"]);
    fs::remove_dir_all(fixture.store_file()).expect("remove directory");

    let target = fixture.root.join("elsewhere.json");
    fs::write(&target, b"outside").expect("write target");
    symlink(&target, fixture.store_file()).expect("symlink store");
    assert_eq!(
        fixture.coordinator().reset_store_with(&RealResetOps, STAMP),
        Err(GrantResetError::NotRegularFile)
    );
    assert!(
        fs::symlink_metadata(fixture.store_file())
            .expect("link")
            .is_symlink()
    );
    assert_eq!(fs::read(&target).expect("target"), b"outside");
    assert_eq!(fixture.entries(), ["grants.json"]);
}

// ---- failure paths --------------------------------------------------------

/// Real file operations, except where a flag makes one step fail. Every call
/// is recorded so a test can see which steps ran.
#[derive(Default)]
struct FlakyOps {
    fail_isolate_link: bool,
    fail_original_unlink: bool,
    fail_create: bool,
    fail_restore_link: bool,
    calls: RefCell<Vec<&'static str>>,
    link_calls: Cell<u32>,
}

impl ResetOps for FlakyOps {
    fn link(&self, from: &Path, to: &Path) -> io::Result<()> {
        let call = self.link_calls.get();
        self.link_calls.set(call + 1);
        let is_restore = call > 0;
        self.calls
            .borrow_mut()
            .push(if is_restore { "restore" } else { "isolate" });
        if (!is_restore && self.fail_isolate_link) || (is_restore && self.fail_restore_link) {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
        fs::hard_link(from, to)
    }

    fn unlink(&self, path: &Path) -> io::Result<()> {
        let is_original = path.file_name().is_some_and(|name| name == "grants.json");
        self.calls.borrow_mut().push(if is_original {
            "unlink-original"
        } else {
            "unlink-other"
        });
        if is_original && self.fail_original_unlink {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
        fs::remove_file(path)
    }

    fn create_empty(&self, store: &GrantStore) -> Result<(), GrantError> {
        self.calls.borrow_mut().push("create");
        if self.fail_create {
            return Err(GrantError::StoreIo);
        }
        RealResetOps.create_empty(store)
    }
}

#[test]
fn a_failed_isolation_changes_nothing() {
    let fixture = Fixture::new();
    let original = b"damaged";
    fixture.write_store(original);
    let ops = FlakyOps {
        fail_isolate_link: true,
        ..FlakyOps::default()
    };

    assert_eq!(
        fixture.coordinator().reset_store_with(&ops, STAMP),
        Err(GrantResetError::Io)
    );

    assert_eq!(fixture.store_bytes(), original);
    assert_eq!(fixture.entries(), ["grants.json"]);
    assert_eq!(
        fixture.coordinator().store_status(),
        unavailable(GrantStoreProblem::Corrupt)
    );
    assert!(!ops.calls.borrow().contains(&"create"));
}

#[test]
fn a_failure_removing_the_original_name_withdraws_the_isolation_copy() {
    let fixture = Fixture::new();
    let original = b"damaged";
    fixture.write_store(original);
    let ops = FlakyOps {
        fail_original_unlink: true,
        ..FlakyOps::default()
    };

    assert_eq!(
        fixture.coordinator().reset_store_with(&ops, STAMP),
        Err(GrantResetError::Io)
    );

    assert_eq!(fixture.store_bytes(), original);
    assert_eq!(fixture.entries(), ["grants.json"]);
    assert!(!ops.calls.borrow().contains(&"create"));
}

#[test]
fn a_failed_store_creation_rolls_the_isolation_back() {
    let fixture = Fixture::new();
    let original = b"damaged";
    fixture.write_store(original);
    let ops = FlakyOps {
        fail_create: true,
        ..FlakyOps::default()
    };

    assert_eq!(
        fixture.coordinator().reset_store_with(&ops, STAMP),
        Err(GrantResetError::Io)
    );

    // Terminal state: exactly as before the attempt.
    assert_eq!(fixture.store_bytes(), original);
    assert_eq!(fixture.entries(), ["grants.json"]);
    assert_eq!(
        fixture.coordinator().store_status(),
        unavailable(GrantStoreProblem::Corrupt)
    );
    assert!(ops.calls.borrow().contains(&"restore"));
}

#[test]
fn a_failed_store_creation_with_a_failed_rollback_reports_isolation_without_a_store() {
    let fixture = Fixture::new();
    let original = b"damaged";
    fixture.write_store(original);
    let ops = FlakyOps {
        fail_create: true,
        fail_restore_link: true,
        ..FlakyOps::default()
    };

    assert_eq!(
        fixture.coordinator().reset_store_with(&ops, STAMP),
        Err(GrantResetError::IsolatedWithoutStore {
            quarantine_file_name: format!("grants.json.corrupt-{STAMP}")
        })
    );

    // Terminal state: the old bytes live only in the isolation file, no
    // half-written grants.json, and the next detection sees a usable (empty)
    // store.
    assert_eq!(fixture.entries(), [format!("grants.json.corrupt-{STAMP}")]);
    assert_eq!(
        fs::read(fixture.quarantine("")).expect("quarantine"),
        original
    );
    assert_eq!(
        fixture.coordinator().store_status(),
        GrantStoreStatus::Available
    );
    assert_eq!(fixture.coordinator().list(), Ok(Vec::new()));
    let project = fixture.directory("project");
    fixture
        .coordinator()
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("a fresh store can be created afterwards");
    assert_eq!(
        fs::read(fixture.quarantine("")).expect("quarantine"),
        original
    );
}

#[test]
fn a_rollback_never_replaces_a_store_that_appeared_in_the_meantime() {
    struct RacingOps;
    impl ResetOps for RacingOps {
        fn create_empty(&self, store: &GrantStore) -> Result<(), GrantError> {
            // Someone else put a file at the original name, then creation failed.
            fs::write(store.file_path(), b"someone else's file").expect("racing file");
            Err(GrantError::StoreIo)
        }
    }
    let fixture = Fixture::new();
    fixture.write_store(b"damaged");

    let result = fixture.coordinator().reset_store_with(&RacingOps, STAMP);

    assert!(matches!(
        result,
        Err(GrantResetError::IsolatedWithoutStore { .. })
    ));
    assert_eq!(fixture.store_bytes(), b"someone else's file");
    assert_eq!(
        fs::read(fixture.quarantine("")).expect("quarantine"),
        b"damaged"
    );
}

// ---- command input --------------------------------------------------------

#[test]
fn reset_errors_map_to_distinguishable_app_errors() {
    use crate::error::{AppError, AppErrorCode};

    let codes: Vec<AppErrorCode> = [
        GrantResetError::NotResettable,
        GrantResetError::NotRegularFile,
        GrantResetError::Io,
        GrantResetError::IsolatedWithoutStore {
            quarantine_file_name: "grants.json.corrupt-x".to_owned(),
        },
    ]
    .into_iter()
    .map(|error| AppError::from(error).code())
    .collect();

    assert_eq!(
        codes,
        [
            AppErrorCode::Conflict,
            AppErrorCode::NotSupported,
            AppErrorCode::PermissionDenied,
            AppErrorCode::PartialFailure,
        ]
    );
}
