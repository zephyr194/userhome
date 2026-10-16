use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use crate::{
    config::{ConfigEnvironment, read::hash_bytes},
    error::{AppError, AppErrorCode},
    grants::{
        ConfirmRequest, FileState, GrantCoordinator, GrantId, GrantPurpose, RecoveryPoint,
        ResourceWriteContext, ResourceWriteCoordinator, ResourceWriteExecution, WriteKind,
        WriteStatus,
    },
    operations::{
        Clock, OperationCoordinator, OperationIdSource, OperationStatus, OperationStore,
        PREVIEW_TTL_MILLIS,
    },
    settings::BackupRetention,
};

use super::{
    ChangeView, CreatePreviewRequest, EditPreviewRequest, EnvironmentEditCoordinator,
    EnvironmentEditPreview,
};
use crate::environment::{
    FileRequest,
    dotenv::{ChangeKind, KeyEdit},
    scan::{FileKind, ScanConfig},
    tests::Fixture,
};

const TOKEN: &str = "s3cr3t-token-value";
const PASSWORD: &str = "hunter2-password";

#[derive(Default)]
struct FakeClock {
    millis: AtomicU64,
}

impl Clock for FakeClock {
    fn monotonic_millis(&self) -> u64 {
        self.millis.load(Ordering::SeqCst)
    }

    fn unix_seconds(&self) -> i64 {
        1_760_000_000
    }
}

struct Clocked(Arc<FakeClock>);

impl Clock for Clocked {
    fn monotonic_millis(&self) -> u64 {
        self.0.monotonic_millis()
    }

    fn unix_seconds(&self) -> i64 {
        self.0.unix_seconds()
    }
}

struct SequentialIds(AtomicU64);

impl OperationIdSource for SequentialIds {
    fn next_id(&self) -> String {
        format!("op-{}", self.0.fetch_add(1, Ordering::SeqCst))
    }
}

struct Harness {
    fixture: Fixture,
    environment: ConfigEnvironment,
    grants: GrantCoordinator,
    operations: OperationCoordinator,
    writes: ResourceWriteCoordinator,
    edits: EnvironmentEditCoordinator,
    clock: Arc<FakeClock>,
    directory: GrantId,
}

impl Harness {
    fn new() -> Self {
        let fixture = Fixture::new();
        let environment = ConfigEnvironment::new(
            fixture.home.clone(),
            fixture.root.join("brew"),
            fixture.home.join("backups"),
        );
        let grants = fixture.coordinator();
        let directory = fixture.grant(&grants, &fixture.project);
        let clock = Arc::new(FakeClock::default());
        let operations = OperationCoordinator::with_store(OperationStore::with_sources(
            Arc::new(Clocked(clock.clone())),
            Arc::new(SequentialIds(AtomicU64::new(1))),
        ));
        Self {
            fixture,
            environment,
            grants,
            operations,
            writes: ResourceWriteCoordinator::default(),
            edits: EnvironmentEditCoordinator::default(),
            clock,
            directory,
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

    fn seed(&self, name: &str, content: &str) -> PathBuf {
        self.fixture.write(name, content)
    }

    fn edit_request(&self, name: &str, current: &str, edits: Vec<KeyEdit>) -> EditPreviewRequest {
        EditPreviewRequest {
            grant_id: self.directory.clone(),
            file: FileRequest {
                relative_path: name.to_owned(),
                config: ScanConfig::with_default_patterns(false),
            },
            expected_hash: hash_bytes(current.as_bytes()),
            edits,
        }
    }

    fn preview_edit(
        &self,
        name: &str,
        current: &str,
        edits: Vec<KeyEdit>,
    ) -> Result<EnvironmentEditPreview, AppError> {
        self.edits.preview_edit(
            &self.ctx(),
            &self.writes,
            &self.edit_request(name, current, edits),
        )
    }

    fn confirm(
        &self,
        operation_id: &str,
        grant: &GrantId,
        relative: Option<&str>,
    ) -> Result<ResourceWriteExecution, AppError> {
        self.edits.execute(
            &self.ctx(),
            &self.writes,
            &ConfirmRequest {
                operation_id: operation_id.to_owned(),
                grant_id: grant.clone(),
                relative: relative.map(str::to_owned),
            },
        )
    }

    fn confirm_edit(
        &self,
        operation_id: &str,
        name: &str,
    ) -> Result<ResourceWriteExecution, AppError> {
        self.confirm(operation_id, &self.directory, Some(name))
    }

    /// A save-location grant for a file that does not exist yet.
    fn new_file_grant(&self, name: &str) -> GrantId {
        self.grants
            .create_new_file(&self.fixture.project, name)
            .expect("new-file grant")
            .id
    }

    fn preview_create(
        &self,
        grant: &GrantId,
        edits: Vec<KeyEdit>,
    ) -> Result<EnvironmentEditPreview, AppError> {
        self.edits.preview_create(
            &self.ctx(),
            &self.writes,
            &CreatePreviewRequest {
                grant_id: grant.clone(),
                edits,
            },
        )
    }

    fn backup_files(&self) -> Vec<PathBuf> {
        fn walk(path: &Path, files: &mut Vec<PathBuf>) {
            let Ok(entries) = fs::read_dir(path) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, files);
                } else {
                    files.push(path);
                }
            }
        }
        let mut files = Vec::new();
        walk(&self.fixture.home.join("backups"), &mut files);
        files
    }

    fn pending_count(&self) -> usize {
        self.edits.state.lock().expect("state").len()
    }
}

fn add(key: &str, value: &str) -> KeyEdit {
    KeyEdit::Add {
        key: key.to_owned(),
        value: value.to_owned(),
        exported: false,
    }
}

fn set(key: &str, value: &str) -> KeyEdit {
    KeyEdit::Set {
        key: key.to_owned(),
        value: value.to_owned(),
    }
}

fn remove(key: &str) -> KeyEdit {
    KeyEdit::Remove {
        key: key.to_owned(),
    }
}

fn operation_id(preview: &EnvironmentEditPreview) -> String {
    preview.write.operation.operation_id.clone()
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).expect("metadata").permissions().mode() & 0o777
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("serialize")
}

fn assert_clean(text: &str, harness: &Harness) {
    for secret in [TOKEN, PASSWORD] {
        assert!(!text.contains(secret), "secret value leaked: {text}");
    }
    assert!(
        !text.contains(harness.fixture.root.to_str().expect("utf8 root")),
        "absolute path leaked: {text}"
    );
}

fn change<'a>(preview: &'a EnvironmentEditPreview, key: &str) -> &'a ChangeView {
    preview
        .changes
        .iter()
        .find(|change| change.key == key)
        .unwrap_or_else(|| panic!("no change for {key}"))
}

const SEED: &str = "# service settings\nPORT=80\n\nnot an assignment\nexport NAME=\"old name\" # label\nAPI_TOKEN=s3cr3t-token-value\n";

// ---- preview → confirm → write -------------------------------------------

#[test]
fn an_edit_is_previewed_first_and_only_a_confirmation_writes_it() {
    let harness = Harness::new();
    let file = harness.seed(".env", SEED);
    fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).expect("chmod");

    let preview = harness
        .preview_edit(
            ".env",
            SEED,
            vec![
                set("PORT", "8080"),
                set("API_TOKEN", PASSWORD),
                add("REGION", "eu"),
                remove("NAME"),
            ],
        )
        .expect("preview");

    assert_eq!(preview.write.kind, WriteKind::Replace);
    assert_eq!(preview.write.recovery_point, RecoveryPoint::Backup);
    assert_eq!(preview.file_kind, FileKind::Environment);
    assert!(preview.matches_default_patterns);
    assert_eq!(preview.write.target, "~/proj/.env");
    assert_eq!(fs::read_to_string(&file).expect("untouched"), SEED);
    assert!(harness.backup_files().is_empty());

    let port = change(&preview, "PORT");
    assert_eq!(port.change, ChangeKind::Modify);
    assert_eq!(port.before.as_deref(), Some("80"));
    assert_eq!(port.after.as_deref(), Some("8080"));
    assert!(!port.secret);
    assert_eq!(change(&preview, "REGION").after.as_deref(), Some("eu"));
    assert_eq!(change(&preview, "NAME").change, ChangeKind::Remove);
    assert_eq!(change(&preview, "NAME").before.as_deref(), Some("old name"));

    let execution = harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect("confirm");
    assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
    assert_eq!(execution.outcome.file_state, FileState::Written);
    assert_eq!(execution.operation.status, OperationStatus::Succeeded);
    assert_eq!(
        fs::read_to_string(&file).expect("written"),
        format!(
            "# service settings\nPORT=8080\n\nnot an assignment\nAPI_TOKEN={PASSWORD}\nREGION=eu\n"
        )
    );
    assert_eq!(mode(&file), 0o640, "the file keeps its permissions");
    let backup = harness
        .backup_files()
        .into_iter()
        .find(|path| path.file_name().is_some_and(|name| name == "content"))
        .expect("backup content");
    assert_eq!(fs::read_to_string(backup).expect("backup"), SEED);
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn comments_unknown_lines_and_untouched_keys_keep_their_exact_bytes() {
    let harness = Harness::new();
    let original = "#  odd   spacing \r\n\r\n  # indented\r\nweird line = 1\r\nKEEP=\"a b\" # c\r\nDUP=1\r\nDUP=2\r\nDYN=$HOME/x\r\nMULTI=\"a\r\nb\"\r\nCHANGE=old\r\nTAIL=1";
    harness.seed(".env", original);

    let preview = harness
        .preview_edit(".env", original, vec![set("CHANGE", "new")])
        .expect("preview");
    harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect("confirm");

    let written = fs::read_to_string(harness.fixture.project.join(".env")).expect("read");
    assert_eq!(written, original.replace("CHANGE=old", "CHANGE=new"));
}

#[test]
fn secrets_are_masked_in_the_preview_the_summary_the_history_and_the_result() {
    let harness = Harness::new();
    harness.seed(".env", SEED);
    let edits = vec![
        set("API_TOKEN", PASSWORD),
        add("DATABASE_URL", &format!("postgres://app:{PASSWORD}@db/app")),
        add("PLAIN", "visible"),
    ];

    let preview = harness.preview_edit(".env", SEED, edits).expect("preview");

    let token = change(&preview, "API_TOKEN");
    assert!(token.secret);
    assert_eq!(
        (token.before.as_deref(), token.after.as_deref()),
        (None, None)
    );
    let url = change(&preview, "DATABASE_URL");
    assert!(
        url.secret,
        "a URL credential masks the value whatever the key"
    );
    assert_eq!((url.before.as_deref(), url.after.as_deref()), (None, None));
    assert_eq!(change(&preview, "PLAIN").after.as_deref(), Some("visible"));
    let text = json(&preview);
    assert_clean(&text, &harness);
    assert!(
        text.contains("\"redacted\":true"),
        "the raw diff is withheld: {text}"
    );

    let execution = harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect("confirm");
    assert_clean(&json(&execution), &harness);
    let history = harness.operations.list().expect("history");
    assert_clean(
        &json(&history.iter().map(|op| &op.summary).collect::<Vec<_>>()),
        &harness,
    );
    let details = harness
        .operations
        .get(&operation_id(&preview))
        .expect("operation");
    assert_clean(&json(&details), &harness);
}

#[test]
fn failures_never_echo_values_in_errors_or_history() {
    let harness = Harness::new();
    harness.seed(".env", SEED);
    // Refused edits: duplicate key, bad key, unsafe value.
    let cases = vec![
        vec![set("API_TOKEN", &format!("{PASSWORD}\n"))],
        vec![add("BAD KEY", PASSWORD)],
        vec![add("PORT", PASSWORD)],
        vec![set("MISSING", PASSWORD)],
    ];
    for edits in cases {
        let error = harness
            .preview_edit(".env", SEED, edits)
            .expect_err("refused");
        assert_clean(&json(&error), &harness);
        assert_clean(&format!("{error:?}"), &harness);
    }
    assert_eq!(harness.pending_count(), 0);
    let history = harness.operations.list().expect("history");
    assert!(history.is_empty(), "a refused edit creates no operation");
}

// ---- refusals at preview time --------------------------------------------

#[test]
fn unsupported_entries_are_refused_with_a_reason_and_nothing_is_prepared() {
    let harness = Harness::new();
    let original = "DUP=1\nDUP=2\nDYN=$HOME\nCMD=$(id)\nMULTI=\"a\nb\"\nOK=1\n";
    harness.seed(".env", original);
    for key in ["DUP", "DYN", "CMD", "MULTI"] {
        let error = harness
            .preview_edit(".env", original, vec![set(key, "x")])
            .expect_err("unsupported");
        assert_eq!(error.code(), AppErrorCode::ValidationFailed, "{key}");
        assert!(json(&error).contains(key), "{key}: {}", json(&error));
    }
    assert_eq!(harness.pending_count(), 0);
    assert!(harness.backup_files().is_empty());
    assert_eq!(
        fs::read_to_string(harness.fixture.project.join(".env")).expect("untouched"),
        original
    );
}

#[test]
fn an_edit_that_changes_nothing_is_not_previewed() {
    let harness = Harness::new();
    harness.seed(".env", "A=1\n");
    let error = harness
        .preview_edit(".env", "A=1\n", vec![set("A", "1")])
        .expect_err("no change");
    assert_eq!(error.code(), AppErrorCode::InvalidInput);
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn a_stale_read_hash_asks_for_a_reload() {
    let harness = Harness::new();
    harness.seed(".env", "A=1\n");
    let error = harness
        .preview_edit(".env", "A=0\n", vec![set("A", "2")])
        .expect_err("stale");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn only_files_the_scan_configuration_would_list_can_be_edited() {
    let harness = Harness::new();
    harness.seed("notes.txt", "A=1\n");
    harness.seed("sub/.env", "A=1\n");
    for (name, code) in [
        ("notes.txt", AppErrorCode::PermissionDenied),
        ("sub/.env", AppErrorCode::PermissionDenied),
        ("../escape.env", AppErrorCode::PermissionDenied),
        ("missing.env", AppErrorCode::NotFound),
    ] {
        let error = harness
            .preview_edit(name, "A=1\n", vec![set("A", "2")])
            .expect_err("refused");
        assert_eq!(error.code(), code, "{name}");
    }
    let revoked = harness.directory.clone();
    harness.grants.revoke(&revoked).expect("revoke");
    harness.seed(".env", "A=1\n");
    let error = harness
        .preview_edit(".env", "A=1\n", vec![set("A", "2")])
        .expect_err("revoked");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
}

#[test]
fn a_file_that_is_not_utf8_is_refused_not_rewritten() {
    let harness = Harness::new();
    let path = harness.fixture.project.join(".env");
    fs::write(&path, [0x41, 0x3d, 0xff, 0x0a]).expect("seed");
    let error = harness
        .preview_edit(".env", "", vec![set("A", "2")])
        .expect_err("not text");
    // The hash of "" does not match either; whichever check fires, nothing is
    // prepared and the bytes stay.
    assert!(matches!(
        error.code(),
        AppErrorCode::ValidationFailed | AppErrorCode::Conflict
    ));
    assert_eq!(
        fs::read(&path).expect("untouched"),
        [0x41, 0x3d, 0xff, 0x0a]
    );
}

// ---- the transaction refuses a preview that no longer describes reality ---

#[test]
fn an_expired_preview_cannot_be_confirmed_and_writes_nothing() {
    let harness = Harness::new();
    let file = harness.seed(".env", SEED);
    let preview = harness
        .preview_edit(".env", SEED, vec![set("PORT", "1")])
        .expect("preview");

    harness
        .clock
        .millis
        .store(PREVIEW_TTL_MILLIS, Ordering::SeqCst);
    let error = harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect_err("expired");

    assert_eq!(error.code(), AppErrorCode::Timeout);
    assert_eq!(fs::read_to_string(&file).expect("untouched"), SEED);
    assert!(harness.backup_files().is_empty());
    assert_eq!(harness.pending_count(), 0, "the preview is dropped");
    assert!(
        harness
            .confirm_edit(&operation_id(&preview), ".env")
            .is_err()
    );
}

#[test]
fn a_concurrent_external_write_makes_the_confirmation_fail_and_is_kept() {
    let harness = Harness::new();
    let file = harness.seed(".env", SEED);
    let preview = harness
        .preview_edit(".env", SEED, vec![set("PORT", "1")])
        .expect("preview");

    fs::write(&file, "PORT=99\nEXTERNAL=1\n").expect("external edit");
    let error = harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect_err("changed");

    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert!(json(&error).contains("preview again"), "{}", json(&error));
    assert_eq!(
        fs::read_to_string(&file).expect("external"),
        "PORT=99\nEXTERNAL=1\n"
    );
    assert!(harness.backup_files().is_empty());
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn confirming_for_another_target_is_refused_and_the_preview_stays_usable() {
    let harness = Harness::new();
    let first = harness.seed(".env", "A=1\n");
    let second = harness.seed(".env.local", "B=1\n");
    let preview = harness
        .preview_edit(".env", "A=1\n", vec![set("A", "2")])
        .expect("preview");

    let error = harness
        .confirm_edit(&operation_id(&preview), ".env.local")
        .expect_err("other file");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    let other = harness
        .grants
        .create(GrantPurpose::ConfigFile, &second)
        .expect("file grant")
        .id;
    let error = harness
        .confirm(&operation_id(&preview), &other, None)
        .expect_err("other authorization");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(fs::read_to_string(&first).expect("a"), "A=1\n");
    assert_eq!(fs::read_to_string(&second).expect("b"), "B=1\n");
    assert_eq!(harness.pending_count(), 1);

    harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect("original target");
    assert_eq!(fs::read_to_string(&first).expect("a"), "A=2\n");
}

#[test]
fn a_target_swapped_for_a_symlink_after_the_preview_is_refused() {
    let harness = Harness::new();
    let file = harness.seed(".env", "A=1\n");
    let other = harness.seed("other.txt", "B=1\n");
    let preview = harness
        .preview_edit(".env", "A=1\n", vec![set("A", "2")])
        .expect("preview");

    fs::remove_file(&file).expect("remove");
    symlink(&other, &file).expect("swap");
    let error = harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect_err("swapped");

    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(fs::read_to_string(&other).expect("other"), "B=1\n");
    assert!(harness.backup_files().is_empty());
}

#[test]
fn a_failed_backup_leaves_the_file_untouched_and_says_there_is_no_recovery_point() {
    let harness = Harness::new();
    let file = harness.seed(".env", SEED);
    fs::write(harness.fixture.home.join("backups"), "not a directory").expect("block backups");
    let preview = harness
        .preview_edit(".env", SEED, vec![set("PORT", "1")])
        .expect("preview");

    let execution = harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect("transaction ran");

    assert_eq!(execution.outcome.status, WriteStatus::Failed);
    assert_eq!(execution.outcome.file_state, FileState::Unchanged);
    assert_eq!(
        execution.outcome.recovery_point,
        RecoveryPoint::NoneUnavailable
    );
    assert_eq!(fs::read_to_string(&file).expect("untouched"), SEED);
    assert_clean(&json(&execution), &harness);
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn a_failed_read_back_restores_the_previous_content_and_reports_it() {
    let harness = Harness::new();
    let file = harness.seed(".env", SEED);
    let preview = harness
        .preview_edit(
            ".env",
            SEED,
            vec![set("PORT", "1"), set("API_TOKEN", PASSWORD)],
        )
        .expect("preview");
    // Make the independent read-back disagree with what was previewed.
    {
        let mut state = harness.edits.state.lock().expect("state");
        let pending = state.get_mut(&operation_id(&preview)).expect("pending");
        pending.changes[0].after = Some("2".to_owned());
    }

    let execution = harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect("transaction ran");

    assert_eq!(execution.outcome.status, WriteStatus::Failed);
    assert_eq!(execution.outcome.file_state, FileState::Restored);
    assert_eq!(fs::read_to_string(&file).expect("restored"), SEED);
    assert_eq!(execution.operation.status, OperationStatus::Failed);
    let error = execution.outcome.error.as_ref().expect("cause");
    assert_eq!(error.code(), AppErrorCode::ValidationFailed);
    assert_clean(&json(&execution), &harness);
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn a_consumed_preview_cannot_be_replayed_and_an_unknown_id_is_not_found() {
    let harness = Harness::new();
    harness.seed(".env", "A=1\n");
    let preview = harness
        .preview_edit(".env", "A=1\n", vec![set("A", "2")])
        .expect("preview");
    harness
        .confirm_edit(&operation_id(&preview), ".env")
        .expect("first");
    assert!(
        harness
            .confirm_edit(&operation_id(&preview), ".env")
            .is_err()
    );
    let error = harness
        .confirm_edit("op-unknown", ".env")
        .expect_err("unknown");
    assert_eq!(error.code(), AppErrorCode::NotFound);
}

// ---- creating a file -------------------------------------------------------

#[test]
fn a_new_file_is_created_through_its_save_location_without_a_recovery_point() {
    let harness = Harness::new();
    let grant = harness.new_file_grant(".env.local");
    let target = harness.fixture.project.join(".env.local");

    let preview = harness
        .preview_create(
            &grant,
            vec![
                add("PORT", "3000"),
                add("API_TOKEN", TOKEN),
                add("NOTE", "two words"),
            ],
        )
        .expect("preview");

    assert_eq!(preview.write.kind, WriteKind::Create);
    assert_eq!(preview.write.recovery_point, RecoveryPoint::NoneCreated);
    assert_eq!(preview.write.target, "~/proj/.env.local");
    assert_eq!(preview.file_kind, FileKind::Environment);
    assert!(preview.matches_default_patterns);
    assert!(change(&preview, "API_TOKEN").secret);
    assert_clean(&json(&preview), &harness);
    assert!(!target.exists(), "nothing exists before the confirmation");

    let execution = harness
        .confirm(&operation_id(&preview), &grant, None)
        .expect("confirm");
    assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
    assert_eq!(execution.outcome.kind, WriteKind::Create);
    assert_eq!(execution.outcome.recovery_point, RecoveryPoint::NoneCreated);
    assert!(execution.outcome.backup_id.is_none());
    assert_eq!(
        fs::read_to_string(&target).expect("created"),
        format!("PORT=3000\nAPI_TOKEN={TOKEN}\nNOTE='two words'\n")
    );
    assert_eq!(mode(&target), 0o600, "a new file may hold secrets");
    assert!(harness.backup_files().is_empty(), "no backup is fabricated");
    assert_clean(&json(&execution), &harness);
}

#[test]
fn the_preview_says_what_kind_of_name_was_chosen() {
    let harness = Harness::new();
    let template = harness.new_file_grant(".env.example");
    let preview = harness
        .preview_create(&template, vec![add("A", "1")])
        .expect("template");
    assert_eq!(preview.file_kind, FileKind::Template);
    assert!(preview.matches_default_patterns);

    let odd = harness.new_file_grant("settings.conf");
    let preview = harness
        .preview_create(&odd, vec![add("A", "1")])
        .expect("any name the user chose is allowed");
    assert_eq!(preview.file_kind, FileKind::Environment);
    assert!(
        !preview.matches_default_patterns,
        "the default scan would not list this name"
    );
}

#[test]
fn creation_refuses_directories_existing_files_and_edits_of_missing_keys() {
    let harness = Harness::new();
    let error = harness
        .preview_create(&harness.directory, vec![add("A", "1")])
        .expect_err("a directory authorization is not a save location");
    assert_eq!(error.code(), AppErrorCode::InvalidInput);

    let existing = harness.seed(".env.keep", "A=1\n");
    let file_grant = harness
        .grants
        .create(GrantPurpose::ConfigFile, &existing)
        .expect("existing file grant")
        .id;
    let error = harness
        .preview_create(&file_grant, vec![add("B", "2")])
        .expect_err("existing file");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(fs::read_to_string(&existing).expect("untouched"), "A=1\n");

    let grant = harness.new_file_grant(".env.new");
    for edits in [vec![set("A", "1")], vec![remove("A")]] {
        let error = harness
            .preview_create(&grant, edits)
            .expect_err("no such key");
        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
    }
    assert!(harness.preview_create(&grant, vec![]).is_err());
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn a_file_created_by_someone_else_after_the_preview_is_not_overwritten() {
    let harness = Harness::new();
    let grant = harness.new_file_grant(".env.race");
    let target = harness.fixture.project.join(".env.race");
    let preview = harness
        .preview_create(&grant, vec![add("A", "1")])
        .expect("preview");

    fs::write(&target, "THEIRS=1\n").expect("created meanwhile");
    let error = harness
        .confirm(&operation_id(&preview), &grant, None)
        .expect_err("exists now");

    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(fs::read_to_string(&target).expect("kept"), "THEIRS=1\n");
}

#[test]
fn a_created_file_that_fails_the_read_back_is_removed_again() {
    let harness = Harness::new();
    let grant = harness.new_file_grant(".env.verify");
    let target = harness.fixture.project.join(".env.verify");
    let preview = harness
        .preview_create(&grant, vec![add("A", "1")])
        .expect("preview");
    {
        let mut state = harness.edits.state.lock().expect("state");
        let pending = state.get_mut(&operation_id(&preview)).expect("pending");
        pending.changes[0].after = Some("other".to_owned());
    }

    let execution = harness
        .confirm(&operation_id(&preview), &grant, None)
        .expect("transaction ran");

    assert_eq!(execution.outcome.status, WriteStatus::Failed);
    assert_eq!(execution.outcome.file_state, FileState::CreatedRemoved);
    assert!(!target.exists());
}

#[test]
fn creation_cannot_reach_outside_home_or_through_a_swapped_parent() {
    let harness = Harness::new();
    // The grant layer owns the `$HOME` boundary: no save-location grant can be
    // made outside it, so there is nothing for the editor to write to.
    assert!(
        harness
            .grants
            .create_new_file(&harness.fixture.outside, ".env")
            .is_err()
    );
    let grant = harness.new_file_grant(".env.swap");
    let preview = harness
        .preview_create(&grant, vec![add("A", "1")])
        .expect("preview");
    // Swap the parent directory for a link to the outside area.
    let project = harness.fixture.project.clone();
    let moved = harness.fixture.home.join("proj-moved");
    fs::rename(&project, &moved).expect("move parent");
    symlink(&harness.fixture.outside, &project).expect("link parent");

    let result = harness.confirm(&operation_id(&preview), &grant, None);

    assert!(result.is_err(), "a swapped parent is refused");
    assert!(
        fs::read_dir(&harness.fixture.outside)
            .expect("outside")
            .next()
            .is_none(),
        "nothing was written outside the authorization"
    );
    fs::remove_file(&project).expect("unlink");
    fs::rename(&moved, &project).expect("restore");
}
