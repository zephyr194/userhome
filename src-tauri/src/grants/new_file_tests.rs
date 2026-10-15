//! New-file authorizations (parent directory + single file name) and the
//! sensitive-location check for sub-paths below directory grants.

use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use serde_json::Value;
use uuid::Uuid;

use crate::{
    config::{ConfigEnvironment, read::hash_bytes},
    error::{AppError, AppErrorCode},
    operations::OperationCoordinator,
    settings::BackupRetention,
};

use super::{
    ConfirmRequest, FileState, GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose,
    GrantRecord, GrantStore, ReadError, RecoveryPoint, ResourceWriteContext,
    ResourceWriteCoordinator, WriteKind, WriteRequest, WriteStatus,
};

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    docs: PathBuf,
    environment: ConfigEnvironment,
    grants: GrantCoordinator,
    operations: OperationCoordinator,
    writes: ResourceWriteCoordinator,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-new-file-{}", Uuid::new_v4()));
        let home = root.join("home");
        let docs = home.join("docs");
        fs::create_dir_all(&docs).expect("create docs");
        let environment =
            ConfigEnvironment::new(home.clone(), root.join("brew"), home.join("backups"));
        let grants =
            GrantCoordinator::new(GrantStore::new(root.join("support")), Some(home.clone()));
        Self {
            root,
            home,
            docs,
            environment,
            grants,
            operations: OperationCoordinator::default(),
            writes: ResourceWriteCoordinator::default(),
        }
    }

    fn store_file(&self) -> PathBuf {
        self.root.join("support").join("grants.json")
    }

    fn write_store(&self, contents: &str) {
        fs::create_dir_all(self.root.join("support")).expect("create store directory");
        fs::write(self.store_file(), contents).expect("write store");
    }

    fn named(&self, name: &str) -> GrantRecord {
        self.grants
            .create_new_file(&self.docs, name)
            .expect("new-file grant")
    }

    fn ctx(&self) -> ResourceWriteContext<'_> {
        ResourceWriteContext {
            grants: &self.grants,
            operations: &self.operations,
            environment: &self.environment,
            retention: BackupRetention::FIVE,
        }
    }

    fn request(&self, id: &GrantId, current: Option<&str>, content: &str) -> WriteRequest {
        WriteRequest {
            grant_id: id.clone(),
            relative: None,
            expected_sha256: current.map(|text| hash_bytes(text.as_bytes())),
            content: content.to_owned(),
            sensitive: false,
        }
    }

    fn confirm_request(&self, operation_id: &str, id: &GrantId) -> ConfirmRequest {
        ConfirmRequest {
            operation_id: operation_id.to_owned(),
            grant_id: id.clone(),
            relative: None,
        }
    }

    fn backup_dir_exists(&self) -> bool {
        self.home.join("backups").exists()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).expect("metadata").permissions().mode() & 0o777
}

fn code(error: &AppError) -> AppErrorCode {
    error.code()
}

// ---------------------------------------------------------------- creation

#[test]
fn a_new_file_grant_records_the_canonical_parent_and_the_name() {
    let fixture = Fixture::new();

    let record = fixture.named("config.toml");

    assert_eq!(record.purpose, GrantPurpose::ConfigFile);
    assert_eq!(record.kind, GrantKind::File);
    assert_eq!(record.path, fixture.docs);
    assert_eq!(record.file_name.as_deref(), Some("config.toml"));
    assert_eq!(record.target_path(), fixture.docs.join("config.toml"));
    assert_eq!(
        record.summary(Some(&fixture.home)).display_path,
        "~/docs/config.toml"
    );
    assert!(!fixture.docs.join("config.toml").exists());
    assert_eq!(fixture.grants.list().expect("list"), vec![record.clone()]);
    assert_eq!(fixture.grants.resolve(&record.id).expect("resolve"), record);
}

#[test]
fn a_new_file_grant_is_recorded_under_the_canonical_parent() {
    let fixture = Fixture::new();
    symlink(&fixture.docs, fixture.home.join("alias")).expect("alias");

    let record = fixture
        .grants
        .create_new_file(&fixture.home.join("alias"), "config.toml")
        .expect("grant through an in-home alias");

    assert_eq!(record.path, fixture.docs);
}

#[test]
fn granting_the_same_parent_and_name_twice_returns_the_existing_grant() {
    let fixture = Fixture::new();

    let first = fixture.named("config.toml");
    let second = fixture.named("config.toml");
    let other = fixture.named("other.toml");

    assert_eq!(first.id, second.id);
    assert_ne!(first.id, other.id);
    assert_eq!(fixture.grants.list().expect("list").len(), 2);
}

#[test]
fn a_new_file_grant_is_independent_of_a_file_grant_on_the_same_path() {
    let fixture = Fixture::new();
    let file = fixture.docs.join("config.toml");
    fs::write(&file, "a = 1\n").expect("seed");

    let file_grant = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("file grant");
    let named = fixture.named("config.toml");

    assert_ne!(file_grant.id, named.id);
    assert_eq!(file_grant.file_name, None);
    assert_eq!(named.target_path(), file_grant.target_path());
    assert!(fixture.grants.resolve(&named.id).is_ok());
}

#[test]
fn file_names_must_be_a_single_plain_segment() {
    let fixture = Fixture::new();
    let long = "n".repeat(256);

    for name in [
        "",
        ".",
        "..",
        "a/b",
        "/abs",
        "../x",
        "x/..",
        "dir/",
        "a\0b",
        "a\\b",
        "tab\tname",
        "new\nline",
        long.as_str(),
    ] {
        assert_eq!(
            fixture.grants.create_new_file(&fixture.docs, name),
            Err(GrantError::InvalidRelativePath),
            "{name:?}"
        );
    }
    assert!(!fixture.store_file().exists(), "nothing may be stored");
    // A name of the maximum length and dot-files are fine.
    fixture
        .grants
        .create_new_file(&fixture.docs, &"n".repeat(255))
        .expect("255 bytes");
    fixture
        .grants
        .create_new_file(&fixture.docs, ".env")
        .expect("dot file");
}

#[test]
fn the_parent_must_exist_be_a_directory_and_be_absolute() {
    let fixture = Fixture::new();
    let file = fixture.docs.join("plain.txt");
    fs::write(&file, "x").expect("file");

    assert_eq!(
        fixture
            .grants
            .create_new_file(&fixture.home.join("missing"), "a.toml"),
        Err(GrantError::NotFound)
    );
    assert_eq!(
        fixture.grants.create_new_file(&file, "a.toml"),
        Err(GrantError::NotDirectory)
    );
    assert_eq!(
        fixture.grants.create_new_file(Path::new("docs"), "a.toml"),
        Err(GrantError::Canonicalize)
    );
    assert!(!fixture.store_file().exists());
}

#[test]
fn the_parent_must_lie_strictly_inside_home() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("outside");
    let sibling = fixture.root.join("home-other");
    fs::create_dir_all(&outside).expect("outside");
    fs::create_dir_all(&sibling).expect("sibling with a shared prefix");
    symlink(&outside, fixture.home.join("escape")).expect("escape link");

    for parent in [
        fixture.home.clone(),
        outside,
        sibling,
        fixture.home.join("escape"),
    ] {
        assert_eq!(
            fixture.grants.create_new_file(&parent, "a.toml"),
            Err(GrantError::OutsideHome),
            "{parent:?}"
        );
    }
    assert!(!fixture.store_file().exists());
}

#[test]
fn credential_locations_are_refused_as_parents_and_as_targets() {
    let fixture = Fixture::new();
    let ssh = fixture.home.join(".ssh");
    let keychains = fixture.home.join("Library/Keychains");
    let gnupg_inner = fixture.home.join(".gnupg/private-keys-v1.d");
    for directory in [&ssh, &keychains, &gnupg_inner] {
        fs::create_dir_all(directory).expect("protected directory");
    }

    for parent in [&ssh, &keychains, &gnupg_inner] {
        assert_eq!(
            fixture.grants.create_new_file(parent, "config"),
            Err(GrantError::ProtectedLocation),
            "{parent:?}"
        );
    }
    // The protected directory itself is not a creatable name either.
    assert_eq!(
        fixture
            .grants
            .create_new_file(&fixture.home.join("Library"), "Keychains"),
        Err(GrantError::ProtectedLocation)
    );
    assert!(!fixture.store_file().exists());
    fixture
        .grants
        .create_new_file(&fixture.home.join("Library"), "Preferences.toml")
        .expect("an ordinary name next to it");
}

#[test]
fn an_unusable_home_makes_new_file_grants_fail_closed() {
    let fixture = Fixture::new();
    let without_home = GrantCoordinator::new(GrantStore::new(fixture.root.join("support")), None);

    assert_eq!(
        without_home.create_new_file(&fixture.docs, "a.toml"),
        Err(GrantError::HomeUnavailable)
    );
}

#[test]
fn a_name_that_already_names_something_else_is_refused_at_creation() {
    let fixture = Fixture::new();
    fs::create_dir(fixture.docs.join("a-dir")).expect("directory");
    symlink(fixture.docs.join("nowhere"), fixture.docs.join("dangling")).expect("dangling");
    fs::write(fixture.docs.join("real.toml"), "r = 1\n").expect("real");
    symlink(
        fixture.docs.join("real.toml"),
        fixture.docs.join("alias.toml"),
    )
    .expect("alias");

    assert_eq!(
        fixture.grants.create_new_file(&fixture.docs, "a-dir"),
        Err(GrantError::NotFile)
    );
    assert_eq!(
        fixture.grants.create_new_file(&fixture.docs, "dangling"),
        Err(GrantError::SymlinkEscape)
    );
    assert_eq!(
        fixture.grants.create_new_file(&fixture.docs, "alias.toml"),
        Err(GrantError::SymlinkEscape)
    );
    // A regular file that is already there behaves like a file grant.
    let existing = fixture.named("real.toml");
    assert!(fixture.grants.resolve(&existing.id).is_ok());
}

// -------------------------------------------------------------- revalidation

#[test]
fn a_name_that_later_becomes_a_symbolic_link_is_refused() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("outside.toml");
    fs::write(&outside, "o = 1\n").expect("outside file");
    let inside = fixture.docs.join("inside.toml");
    fs::write(&inside, "i = 1\n").expect("inside file");

    for (name, target) in [
        ("to-outside.toml", outside.clone()),
        ("to-inside.toml", inside.clone()),
        ("dangling.toml", fixture.docs.join("gone")),
    ] {
        let record = fixture.named(name);
        symlink(&target, fixture.docs.join(name)).expect("swap in a link");
        assert_eq!(
            fixture.grants.resolve(&record.id),
            Err(GrantError::SymlinkEscape),
            "{name}"
        );
    }
    assert_eq!(fs::read_to_string(&outside).expect("untouched"), "o = 1\n");
}

#[test]
fn a_name_that_later_becomes_a_directory_or_special_file_is_refused() {
    let fixture = Fixture::new();
    let as_dir = fixture.named("later-dir");
    let as_fifo = fixture.named("later-fifo");
    fs::create_dir(fixture.docs.join("later-dir")).expect("directory");
    // A FIFO is neither a regular file nor a directory.
    let status = std::process::Command::new("mkfifo")
        .arg(fixture.docs.join("later-fifo"))
        .status()
        .expect("mkfifo");
    assert!(status.success());

    assert_eq!(fixture.grants.resolve(&as_dir.id), Err(GrantError::NotFile));
    assert_eq!(
        fixture.grants.resolve(&as_fifo.id),
        Err(GrantError::NotFile)
    );
}

#[test]
fn a_name_that_later_becomes_a_regular_file_still_resolves() {
    let fixture = Fixture::new();
    let record = fixture.named("config.toml");
    fs::write(fixture.docs.join("config.toml"), "a = 1\n").expect("created later");

    assert_eq!(fixture.grants.resolve(&record.id).expect("resolve"), record);
    let read = fixture
        .grants
        .read_resource(&record.id, None)
        .expect("read the file");
    assert_eq!(read.content, b"a = 1\n");
}

#[test]
fn the_parent_is_canonicalized_again_on_every_use() {
    let fixture = Fixture::new();
    let record = fixture.named("config.toml");
    let outside = fixture.root.join("elsewhere");
    fs::create_dir_all(&outside).expect("elsewhere");

    fs::remove_dir(&fixture.docs).expect("remove parent");
    assert_eq!(
        fixture.grants.resolve(&record.id),
        Err(GrantError::NotFound)
    );

    symlink(&outside, &fixture.docs).expect("parent becomes a link");
    assert_eq!(
        fixture.grants.resolve(&record.id),
        Err(GrantError::SymlinkEscape)
    );
}

#[test]
fn a_stored_new_file_record_below_a_protected_directory_is_invalid_on_use() {
    let fixture = Fixture::new();
    let ssh = fixture.home.join(".ssh");
    fs::create_dir_all(&ssh).expect("ssh");
    let id = Uuid::new_v4();
    fixture.write_store(&format!(
        r#"{{"schemaVersion":1,"grants":[{{"id":"{id}","purpose":"CONFIG_FILE","kind":"FILE","path":"{}","createdAtEpochMs":1,"fileName":"config"}}]}}"#,
        ssh.display()
    ));
    let before = fs::read_to_string(fixture.store_file()).expect("store");
    let id = GrantId::parse(&id.to_string()).expect("id");

    assert_eq!(
        fixture.grants.resolve(&id),
        Err(GrantError::ProtectedLocation)
    );
    assert_eq!(
        fs::read_to_string(fixture.store_file()).expect("store"),
        before,
        "the record is neither deleted nor rewritten"
    );
}

#[test]
fn a_new_file_grant_covers_only_its_own_name() {
    let fixture = Fixture::new();
    let record = fixture.named("config.toml");
    fs::write(fixture.docs.join("other.toml"), "o = 1\n").expect("other");

    assert!(matches!(
        fixture.grants.read_resource(&record.id, Some("other.toml")),
        Err(ReadError::Malformed)
    ));
    assert_eq!(
        fixture.grants.resolve_child(&record.id, "other.toml"),
        Err(GrantError::NotDirectory)
    );
    assert!(matches!(
        fixture.grants.read_resource(&record.id, None),
        Err(ReadError::NotFound)
    ));
}

// ------------------------------------------------------------------- storage

const LEGACY_RECORD: &str = r#"{"id":"3b241101-e2bb-4255-8caf-4136c566a962","purpose":"CONFIG_DIRECTORY","kind":"DIRECTORY","path":"__PATH__","createdAtEpochMs":7}"#;

#[test]
fn a_library_written_before_the_file_name_field_still_loads_and_keeps_its_bytes() {
    let fixture = Fixture::new();
    let legacy = LEGACY_RECORD.replace("__PATH__", &fixture.docs.to_string_lossy());
    fixture.write_store(&format!(r#"{{"schemaVersion":1,"grants":[{legacy}]}}"#));

    let listed = fixture.grants.list().expect("legacy library loads");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].file_name, None);
    assert_eq!(listed[0].created_at_epoch_ms, 7);
    assert!(fixture.grants.resolve(&listed[0].id).is_ok());

    // Saving after adding a new-file grant keeps the legacy record and does
    // not give it a `fileName` key; the schema version is unchanged.
    let added = fixture.named("config.toml");
    let saved: Value =
        serde_json::from_slice(&fs::read(fixture.store_file()).expect("store")).expect("json");
    assert_eq!(saved["schemaVersion"], 1);
    let records = saved["grants"].as_array().expect("grants");
    assert_eq!(records.len(), 2);
    assert!(records[0].get("fileName").is_none());
    assert_eq!(records[0]["id"], "3b241101-e2bb-4255-8caf-4136c566a962");
    assert_eq!(records[1]["fileName"], "config.toml");
    assert_eq!(records[1]["purpose"], "CONFIG_FILE");
    assert_eq!(records[1]["kind"], "FILE");

    let reloaded = fixture.grants.list().expect("reload");
    assert_eq!(reloaded[0], listed[0]);
    assert_eq!(reloaded[1], added);
}

#[test]
fn a_library_without_new_file_grants_is_saved_without_the_field() {
    let fixture = Fixture::new();
    fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &fixture.docs)
        .expect("directory grant");

    let text = fs::read_to_string(fixture.store_file()).expect("store");
    assert!(!text.contains("fileName"), "{text}");
}

#[test]
fn the_file_name_field_survives_a_round_trip_through_a_fresh_coordinator() {
    let fixture = Fixture::new();
    let record = fixture.named("config.toml");

    let fresh = GrantCoordinator::new(
        GrantStore::new(fixture.root.join("support")),
        Some(fixture.home.clone()),
    );
    assert_eq!(fresh.list().expect("list"), vec![record.clone()]);
    assert_eq!(fresh.resolve(&record.id).expect("resolve"), record);
}

#[test]
fn malformed_new_file_records_and_unknown_fields_keep_the_store_corrupt() {
    let fixture = Fixture::new();
    let id = Uuid::new_v4();
    let docs = fixture.docs.to_string_lossy().into_owned();
    let record = |purpose: &str, kind: &str, extra: &str| {
        format!(
            r#"{{"schemaVersion":1,"grants":[{{"id":"{id}","purpose":"{purpose}","kind":"{kind}","path":"{docs}","createdAtEpochMs":1{extra}}}]}}"#
        )
    };
    let good = record("CONFIG_FILE", "FILE", r#","fileName":"ok.toml""#);
    fixture.write_store(&good);
    assert!(
        fixture.grants.list().is_ok(),
        "the well-formed record loads"
    );

    for document in [
        record("CONFIG_FILE", "FILE", r#","fileName":"ok.toml","extra":1"#),
        record("CONFIG_FILE", "FILE", r#","fileName":"""#),
        record("CONFIG_FILE", "FILE", r#","fileName":"a/b""#),
        record("CONFIG_FILE", "FILE", r#","fileName":"..""#),
        record("CONFIG_FILE", "FILE", r#","fileName":".""#),
        record("CONFIG_FILE", "FILE", r#","fileName":"a\u0000b""#),
        record("CONFIG_FILE", "FILE", r#","fileName":7"#),
        record("CONFIG_FILE", "FILE", r#","fileName":null,"extra":1"#),
        // Only ConfigFile grants may carry a name.
        record("CONFIG_DIRECTORY", "DIRECTORY", r#","fileName":"ok.toml""#),
        record("EXECUTABLE", "FILE", r#","fileName":"ok.toml""#),
    ] {
        fixture.write_store(&document);
        assert_eq!(
            fixture.grants.list(),
            Err(GrantError::StoreCorrupt),
            "{document}"
        );
    }
}

#[test]
fn a_newer_schema_version_is_still_reported_instead_of_read() {
    let fixture = Fixture::new();
    fixture.write_store(
        r#"{"schemaVersion":2,"grants":[{"fileName":"x","unknown":true}],"extra":true}"#,
    );

    assert_eq!(
        fixture.grants.list(),
        Err(GrantError::StoreUnsupportedVersion)
    );
}

// --------------------------------------------------------- write transaction

#[test]
fn a_new_file_grant_is_written_with_create_semantics() {
    let fixture = Fixture::new();
    let record = fixture.named("fresh.toml");

    let batch = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.request(&record.id, None, "y = 1\n")],
        )
        .expect("preview");
    let step = &batch.steps[0];
    assert_eq!(step.kind, WriteKind::Create);
    assert_eq!(step.recovery_point, RecoveryPoint::NoneCreated);
    assert_eq!(step.target, "~/docs/fresh.toml", "the full target is shown");
    assert!(step.current_hash.is_none());
    assert!(!fixture.docs.join("fresh.toml").exists());

    let execution = fixture
        .writes
        .execute(
            &fixture.ctx(),
            &fixture.confirm_request(&step.operation.operation_id, &record.id),
        )
        .expect("confirm");

    assert_eq!(execution.outcome.kind, WriteKind::Create);
    assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
    assert_eq!(execution.outcome.recovery_point, RecoveryPoint::NoneCreated);
    assert!(execution.outcome.backup_id.is_none());
    let created = fixture.docs.join("fresh.toml");
    assert_eq!(fs::read_to_string(&created).expect("created"), "y = 1\n");
    assert_eq!(mode(&created), 0o600);
    assert!(!fixture.backup_dir_exists(), "no backup is fabricated");
}

#[test]
fn a_created_file_that_fails_verification_is_removed_again() {
    let fixture = Fixture::new();
    let record = fixture.named("fresh.toml");
    let batch = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.request(&record.id, None, "y = 1\n")],
        )
        .expect("preview");

    let execution = fixture
        .writes
        .execute_with(
            &fixture.ctx(),
            &fixture.confirm_request(&batch.steps[0].operation.operation_id, &record.id),
            |_| {
                Err(AppError::validation_failed(
                    "The configuration does not parse.",
                ))
            },
        )
        .expect("transaction ran");

    assert_eq!(execution.outcome.status, WriteStatus::Failed);
    assert_eq!(execution.outcome.file_state, FileState::CreatedRemoved);
    assert_eq!(execution.outcome.recovery_point, RecoveryPoint::NoneCreated);
    assert!(!fixture.docs.join("fresh.toml").exists());
    assert!(!fixture.backup_dir_exists());
}

#[test]
fn a_new_file_grant_cannot_be_used_for_another_name_or_a_relative_path() {
    let fixture = Fixture::new();
    let record = fixture.named("fresh.toml");

    for relative in ["other.toml", "fresh.toml", "sub/fresh.toml", "../x.toml"] {
        let mut request = fixture.request(&record.id, None, "y = 1\n");
        request.relative = Some(relative.to_owned());
        let error = fixture
            .writes
            .preview(&fixture.ctx(), vec![request])
            .expect_err(relative);
        assert_eq!(code(&error), AppErrorCode::InvalidInput, "{relative}");
    }
    assert_eq!(
        fs::read_dir(&fixture.docs).expect("docs").count(),
        0,
        "nothing was created"
    );
}

#[test]
fn a_new_file_target_swapped_for_a_symbolic_link_after_the_preview_is_refused() {
    let fixture = Fixture::new();
    let record = fixture.named("fresh.toml");
    let outside = fixture.root.join("outside.toml");
    fs::write(&outside, "keep\n").expect("outside");
    let batch = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.request(&record.id, None, "y = 1\n")],
        )
        .expect("preview");
    symlink(&outside, fixture.docs.join("fresh.toml")).expect("swap");

    let error = fixture
        .writes
        .execute(
            &fixture.ctx(),
            &fixture.confirm_request(&batch.steps[0].operation.operation_id, &record.id),
        )
        .expect_err("refused");

    assert!(
        matches!(
            code(&error),
            AppErrorCode::Conflict | AppErrorCode::PermissionDenied
        ),
        "{error:?}"
    );
    assert_eq!(fs::read_to_string(&outside).expect("untouched"), "keep\n");
}

#[test]
fn a_new_file_target_that_became_a_directory_cannot_be_previewed() {
    let fixture = Fixture::new();
    let record = fixture.named("fresh.toml");
    fs::create_dir(fixture.docs.join("fresh.toml")).expect("directory");

    let error = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.request(&record.id, None, "y = 1\n")],
        )
        .expect_err("refused");

    assert_eq!(code(&error), AppErrorCode::ValidationFailed);
}

#[test]
fn a_new_file_created_after_the_preview_is_not_overwritten() {
    let fixture = Fixture::new();
    let record = fixture.named("fresh.toml");
    let batch = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.request(&record.id, None, "y = 1\n")],
        )
        .expect("preview");
    fs::write(fixture.docs.join("fresh.toml"), "someone else\n").expect("created meanwhile");

    let error = fixture
        .writes
        .execute(
            &fixture.ctx(),
            &fixture.confirm_request(&batch.steps[0].operation.operation_id, &record.id),
        )
        .expect_err("conflict");

    assert_eq!(code(&error), AppErrorCode::Conflict);
    assert_eq!(
        fs::read_to_string(fixture.docs.join("fresh.toml")).expect("kept"),
        "someone else\n"
    );
}

#[test]
fn an_existing_file_behind_a_new_file_grant_keeps_the_replace_behavior() {
    let fixture = Fixture::new();
    let record = fixture.named("config.toml");
    let file = fixture.docs.join("config.toml");
    fs::write(&file, "a = 1\n").expect("created later");

    // Without the read hash an existing file is never silently replaced.
    let error = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.request(&record.id, None, "a = 2\n")],
        )
        .expect_err("needs the hash");
    assert_eq!(code(&error), AppErrorCode::Conflict);

    let batch = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.request(&record.id, Some("a = 1\n"), "a = 2\n")],
        )
        .expect("replace preview");
    let step = &batch.steps[0];
    assert_eq!(step.kind, WriteKind::Replace);
    assert_eq!(step.recovery_point, RecoveryPoint::Backup);
    let execution = fixture
        .writes
        .execute(
            &fixture.ctx(),
            &fixture.confirm_request(&step.operation.operation_id, &record.id),
        )
        .expect("confirm");
    assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
    assert!(execution.outcome.backup_id.is_some());
    assert_eq!(fs::read_to_string(&file).expect("replaced"), "a = 2\n");
}

// ------------------------------------------- sub-paths below directory grants

#[test]
fn sub_paths_below_a_directory_grant_cannot_reach_credential_locations() {
    let fixture = Fixture::new();
    let library = fixture.home.join("Library");
    let keychains = library.join("Keychains");
    fs::create_dir_all(&keychains).expect("keychains");
    fs::create_dir_all(library.join("Preferences")).expect("preferences");
    fs::write(keychains.join("login.keychain-db"), "secret").expect("keychain");
    fs::write(library.join("Preferences/app.toml"), "p = 1\n").expect("pref");
    symlink(&keychains, library.join("alias")).expect("in-root alias");
    let grant = fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &library)
        .expect("Library is below home and is not protected itself");

    for relative in [
        "Keychains",
        "Keychains/login.keychain-db",
        "keychains/login.keychain-db",
        "alias/login.keychain-db",
        "alias",
    ] {
        assert_eq!(
            fixture.grants.resolve_child(&grant.id, relative),
            Err(GrantError::ProtectedLocation),
            "{relative}"
        );
        assert!(
            matches!(
                fixture.grants.read_resource(&grant.id, Some(relative)),
                Err(ReadError::Excluded)
            ),
            "{relative}"
        );
    }
    assert!(
        fixture
            .grants
            .resolve_child(&grant.id, "Preferences/app.toml")
            .is_ok()
    );
    assert!(
        fixture
            .grants
            .read_resource(&grant.id, Some("Preferences/app.toml"))
            .is_ok()
    );
}

#[test]
fn writes_through_a_directory_grant_cannot_reach_credential_locations() {
    let fixture = Fixture::new();
    let library = fixture.home.join("Library");
    let keychains = library.join("Keychains");
    fs::create_dir_all(&keychains).expect("keychains");
    fs::write(keychains.join("login.keychain-db"), "secret").expect("keychain");
    let grant = fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &library)
        .expect("grant");

    for (relative, current) in [
        ("Keychains/new.toml", None),
        ("Keychains/login.keychain-db", Some("secret")),
    ] {
        let mut request = fixture.request(&grant.id, current, "x = 1\n");
        request.relative = Some(relative.to_owned());
        let error = fixture
            .writes
            .preview(&fixture.ctx(), vec![request])
            .expect_err(relative);
        assert_eq!(code(&error), AppErrorCode::PermissionDenied, "{relative}");
    }
    assert!(!keychains.join("new.toml").exists());
}
