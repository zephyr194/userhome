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
    config::ConfigEnvironment,
    error::{AppError, AppErrorCode},
    grants::{
        FileState, GrantCoordinator, GrantId, GrantKind, GrantPurpose, RecoveryPoint,
        ResourceWriteContext, ResourceWriteCoordinator, WriteKind, WriteStatus,
    },
    operations::{
        Clock, OperationCoordinator, OperationIdSource, OperationStatus, OperationStore,
        PREVIEW_TTL_MILLIS,
    },
    settings::BackupRetention,
};

use super::super::{
    dotenv::ChangeKind,
    tests::Fixture,
    zsh::{StartupFile, ZshRequest},
    zsh_block::{BEGIN_MARKER, BlockEdit, END_MARKER, VarEdit, quote},
    zsh_parse::ValueState,
};
use super::{
    BlockDiffKind, BlockView, EFFECT_NOTE, EditWarning, ZshEditCoordinator, ZshEditExecuteRequest,
    ZshEditExecution, ZshEditOutcome, ZshEditPreview, ZshEditPreviewRequest, ZshEditState,
    ZshEditTarget, enable, read_state,
};

const TOKEN: &str = "s3cr3t-token-value";

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
    edits: ZshEditCoordinator,
    clock: Arc<FakeClock>,
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
            edits: ZshEditCoordinator::default(),
            clock,
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

    fn home(&self) -> &Path {
        &self.fixture.home
    }

    fn path(&self, file: StartupFile) -> PathBuf {
        self.home().join(file.file_name())
    }

    fn seed(&self, file: StartupFile, content: &str) -> PathBuf {
        let path = self.path(file);
        fs::write(&path, content).expect("seed");
        path
    }

    fn target(file: StartupFile) -> ZshEditTarget {
        ZshEditTarget {
            zsh: ZshRequest::default(),
            file,
        }
    }

    fn state(&self, file: StartupFile) -> ZshEditOutcome {
        read_state(&self.grants, Some(self.home()), &Self::target(file))
    }

    fn ready(&self, file: StartupFile) -> ZshEditState {
        match self.state(file) {
            ZshEditOutcome::Ready(state) => *state,
            other => panic!("not ready: {other:?}"),
        }
    }

    fn enable(&self, file: StartupFile) -> Result<GrantId, AppError> {
        enable(&self.grants, Some(self.home()), &Self::target(file)).map(|enabled| enabled.grant_id)
    }

    fn preview(
        &self,
        file: StartupFile,
        expected: Option<&str>,
        edit: BlockEdit,
    ) -> Result<ZshEditPreview, AppError> {
        self.edits.preview(
            &self.ctx(),
            &self.writes,
            Some(self.home()),
            &ZshEditPreviewRequest {
                target: Self::target(file),
                expected_hash: expected.map(str::to_owned),
                edit,
            },
        )
    }

    /// Enables editing and previews against the file as it is on disk now.
    fn preview_now(&self, file: StartupFile, edit: BlockEdit) -> ZshEditPreview {
        self.enable(file).expect("enable");
        let hash = self.ready(file).content_hash;
        self.preview(file, hash.as_deref(), edit).expect("preview")
    }

    fn confirm(&self, file: StartupFile, operation_id: &str) -> Result<ZshEditExecution, AppError> {
        self.edits.execute(
            &self.ctx(),
            &self.writes,
            Some(self.home()),
            &ZshEditExecuteRequest {
                target: Self::target(file),
                operation_id: operation_id.to_owned(),
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
        walk(&self.home().join("backups"), &mut files);
        files
    }

    fn pending_count(&self) -> usize {
        self.edits.state.lock().expect("state").len()
    }
}

fn set(name: &str, value: &str) -> VarEdit {
    VarEdit::Set {
        name: name.to_owned(),
        value: value.to_owned(),
    }
}

fn vars(edits: Vec<VarEdit>) -> BlockEdit {
    BlockEdit {
        variables: edits,
        path: None,
    }
}

fn path_edit(items: &[&str]) -> BlockEdit {
    BlockEdit {
        variables: Vec::new(),
        path: Some(items.iter().map(|item| (*item).to_owned()).collect()),
    }
}

fn id(preview: &ZshEditPreview) -> String {
    preview.write.operation.operation_id.clone()
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).expect("metadata").permissions().mode() & 0o777
}

fn json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("serialize")
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).expect("read")
}

const SEED: &str =
    "# my zshrc\nexport EDITOR=nano\nalias ll='ls -l'\nexport PATH=\"/opt/homebrew/bin:$PATH\"\n";

// ---- state and enabling ---------------------------------------------------------------

#[test]
fn state_of_a_missing_file_has_no_block_and_creates_no_authorization() {
    let harness = Harness::new();
    let state = harness.ready(StartupFile::Zshrc);
    assert!(!state.exists);
    assert!(!state.enabled);
    assert_eq!(state.content_hash, None);
    assert_eq!(state.block, BlockView::Absent);
    assert_eq!(state.display_path, "~/.zshrc");
    assert_eq!(state.name, ".zshrc");
    assert_eq!(state.position, 6);
    assert!(harness.grants.list().expect("grants").is_empty());
    assert!(!harness.path(StartupFile::Zshrc).exists());
}

#[test]
fn enabling_creates_a_revocable_file_grant_for_exactly_that_file() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    let enabled = enable(
        &harness.grants,
        Some(harness.home()),
        &Harness::target(StartupFile::Zshrc),
    )
    .expect("enable");
    assert!(enabled.exists);
    assert_eq!(enabled.display_path, "~/.zshrc");
    assert_eq!(enabled.full_path, file.to_str().expect("utf8"));

    let grants = harness.grants.list().expect("grants");
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].purpose, GrantPurpose::ConfigFile);
    assert_eq!(grants[0].kind, GrantKind::File);
    assert_eq!(grants[0].target_path(), file);

    let state = harness.ready(StartupFile::Zshrc);
    assert!(state.enabled);
    assert_eq!(state.grant_id, Some(enabled.grant_id.clone()));

    // Enabling again is the same authorization; revoking switches editing off.
    assert_eq!(
        harness.enable(StartupFile::Zshrc).expect("again"),
        enabled.grant_id
    );
    harness.grants.revoke(&enabled.grant_id).expect("revoke");
    assert!(!harness.ready(StartupFile::Zshrc).enabled);
    let error = harness
        .preview(
            StartupFile::Zshrc,
            state.content_hash.as_deref(),
            vars(vec![set("A", "1")]),
        )
        .expect_err("revoked");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
}

#[test]
fn a_missing_file_gets_a_new_file_grant_whose_parent_is_home_itself() {
    let harness = Harness::new();
    let enabled = enable(
        &harness.grants,
        Some(harness.home()),
        &Harness::target(StartupFile::Zshrc),
    )
    .expect("enable");
    assert!(!enabled.exists);
    let grants = harness.grants.list().expect("grants");
    assert_eq!(grants[0].file_name.as_deref(), Some(".zshrc"));
    assert_eq!(grants[0].path, harness.home());
    assert!(harness.ready(StartupFile::Zshrc).enabled);
    assert!(
        !harness.path(StartupFile::Zshrc).exists(),
        "enabling writes nothing"
    );
}

#[test]
fn nothing_is_previewed_or_written_before_editing_is_enabled() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    let hash = harness.ready(StartupFile::Zshrc).content_hash;
    let error = harness
        .preview(
            StartupFile::Zshrc,
            hash.as_deref(),
            vars(vec![set("A", "1")]),
        )
        .expect_err("not enabled");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
    assert_eq!(read(&file), SEED);
    assert_eq!(harness.pending_count(), 0);
    // A grant for another file is not an authorization for this one.
    harness.seed(StartupFile::Zprofile, "");
    harness.enable(StartupFile::Zprofile).expect("other file");
    assert!(!harness.ready(StartupFile::Zshrc).enabled);
}

#[test]
fn a_symbolic_link_leaving_home_cannot_be_enabled_and_one_inside_home_resolves() {
    let harness = Harness::new();
    let secret = harness.fixture.outside.join("elsewhere");
    fs::write(&secret, "keep\n").expect("outside file");
    symlink(&secret, harness.path(StartupFile::Zshrc)).expect("link out");
    let error = harness.enable(StartupFile::Zshrc).expect_err("outside");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
    assert!(harness.grants.list().expect("grants").is_empty());
    assert!(matches!(
        harness.state(StartupFile::Zshrc),
        ZshEditOutcome::OutsideHome { .. }
    ));
    assert_eq!(read(&secret), "keep\n");

    fs::remove_file(harness.path(StartupFile::Zshrc)).expect("remove");
    let dotfiles = harness.home().join("dotfiles");
    fs::create_dir(&dotfiles).expect("dotfiles");
    fs::write(dotfiles.join("zshrc"), SEED).expect("real file");
    symlink(dotfiles.join("zshrc"), harness.path(StartupFile::Zshrc)).expect("link in");
    let enabled = enable(
        &harness.grants,
        Some(harness.home()),
        &Harness::target(StartupFile::Zshrc),
    )
    .expect("inside home");
    assert_eq!(
        enabled.full_path,
        dotfiles.join("zshrc").to_str().expect("utf8"),
        "the preview shows where the link leads"
    );
    let state = harness.ready(StartupFile::Zshrc);
    let preview = harness
        .preview(
            StartupFile::Zshrc,
            state.content_hash.as_deref(),
            vars(vec![set("A", "1")]),
        )
        .expect("preview");
    assert_eq!(
        preview.full_path,
        dotfiles.join("zshrc").to_str().expect("utf8")
    );
}

#[test]
fn a_missing_zdotdir_directory_is_not_created() {
    let harness = Harness::new();
    harness.seed(
        StartupFile::Zshenv,
        "export ZDOTDIR=\"$HOME/.config/zsh\"\n",
    );
    let error = harness
        .enable(StartupFile::Zshrc)
        .expect_err("no directory");
    assert_eq!(error.code(), AppErrorCode::NotFound);
    assert!(!harness.home().join(".config").exists());
}

// ---- zdotdir ---------------------------------------------------------------------------------

#[test]
fn files_after_zshenv_follow_a_static_zdotdir_inside_home() {
    let harness = Harness::new();
    harness.seed(
        StartupFile::Zshenv,
        "export ZDOTDIR=\"$HOME/.config/zsh\"\n",
    );
    let dir = harness.home().join(".config/zsh");
    fs::create_dir_all(&dir).expect("dir");
    fs::write(dir.join(".zshrc"), "export A=1\n").expect("rc");

    let state = harness.ready(StartupFile::Zshrc);
    assert_eq!(state.display_path, "~/.config/zsh/.zshrc");
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("B", "2")]));
    harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    assert!(read(&dir.join(".zshrc")).contains("export B='2'"));
    assert!(
        !harness.path(StartupFile::Zshrc).exists(),
        "$HOME/.zshrc is not touched"
    );
    // `.zshenv` itself always stays in $HOME.
    assert_eq!(harness.ready(StartupFile::Zshenv).display_path, "~/.zshenv");
}

#[test]
fn an_undetermined_or_outside_zdotdir_blocks_editing_and_never_guesses() {
    let harness = Harness::new();
    harness.seed(StartupFile::Zshenv, "export ZDOTDIR=\"$(pwd)/zsh\"\n");
    assert!(matches!(
        harness.state(StartupFile::Zshrc),
        ZshEditOutcome::NotLocated { .. }
    ));
    let error = harness
        .enable(StartupFile::Zshrc)
        .expect_err("unknown location");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert!(harness.grants.list().expect("grants").is_empty());

    // With the directory the user chose, it is located.
    let chosen = harness.home().join("zdot");
    fs::create_dir(&chosen).expect("dir");
    let grant = harness
        .grants
        .create(GrantPurpose::ConfigDirectory, &chosen)
        .expect("directory grant");
    let target = ZshEditTarget {
        zsh: ZshRequest {
            zdotdir_grant: Some(grant.id),
        },
        file: StartupFile::Zshrc,
    };
    let enabled = enable(&harness.grants, Some(harness.home()), &target).expect("chosen");
    assert_eq!(enabled.display_path, "~/zdot/.zshrc");

    harness.seed(
        StartupFile::Zshenv,
        &format!("export ZDOTDIR={}\n", harness.fixture.outside.display()),
    );
    assert!(matches!(
        harness.state(StartupFile::Zshrc),
        ZshEditOutcome::OutsideHome { .. }
    ));
    assert_eq!(
        harness
            .enable(StartupFile::Zshrc)
            .expect_err("outside")
            .code(),
        AppErrorCode::PermissionDenied
    );
}

// ---- preview → confirm → write ----------------------------------------------------------------

#[test]
fn an_edit_is_previewed_first_and_only_a_confirmation_writes_it() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).expect("chmod");

    let mut edit = vars(vec![set("GOPATH", "/Users/me/go"), set("API_TOKEN", TOKEN)]);
    edit.path = Some(vec!["~/bin".to_owned(), "/opt/tool/bin".to_owned()]);
    let preview = harness.preview_now(StartupFile::Zshrc, edit);

    assert_eq!(preview.write.kind, WriteKind::Replace);
    assert_eq!(preview.write.recovery_point, RecoveryPoint::Backup);
    assert_eq!(preview.write.target, "~/.zshrc");
    assert_eq!(preview.display_path, "~/.zshrc");
    assert_eq!(preview.full_path, file.to_str().expect("utf8"));
    assert_eq!(preview.position, 6);
    assert!(preview.created_block);
    assert_eq!(preview.effect_note, EFFECT_NOTE);
    assert!(
        json(&preview.write.diff).contains("\"redacted\":true"),
        "the generic diff stays withheld"
    );
    assert_eq!(read(&file), SEED, "a preview writes nothing");
    assert!(harness.backup_files().is_empty());

    let changes: Vec<(&str, ChangeKind, bool)> = preview
        .variable_changes
        .iter()
        .map(|change| (change.name.as_str(), change.change, change.secret))
        .collect();
    assert_eq!(
        changes,
        vec![
            ("GOPATH", ChangeKind::Add, false),
            ("API_TOKEN", ChangeKind::Add, true)
        ]
    );
    assert_eq!(
        preview.variable_changes[0].after.as_deref(),
        Some("/Users/me/go")
    );
    assert_eq!(preview.variable_changes[1].after, None);
    let path_change = preview.path_change.as_ref().expect("path change");
    assert_eq!(path_change.after, vec!["$HOME/bin", "/opt/tool/bin"]);
    let diff: Vec<String> = preview
        .block_diff
        .iter()
        .map(|line| format!("{:?} {}", line.kind, line.text))
        .collect();
    assert_eq!(
        diff.first().map(String::as_str),
        Some(&*format!("Added {BEGIN_MARKER}"))
    );
    assert!(
        diff.iter()
            .any(|line| line == "Added export API_TOKEN='••••••'")
    );
    assert!(
        diff.iter()
            .any(|line| line == "Added export GOPATH='/Users/me/go'")
    );
    assert!(
        preview
            .block_diff
            .iter()
            .all(|line| line.kind == BlockDiffKind::Added)
    );
    assert!(preview.warnings.contains(&EditWarning::BlockAppended));

    let execution = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    assert_eq!(execution.execution.outcome.status, WriteStatus::Succeeded);
    assert_eq!(execution.execution.outcome.file_state, FileState::Written);
    assert_eq!(
        execution.execution.operation.status,
        OperationStatus::Succeeded
    );
    assert_eq!(execution.effect_note, EFFECT_NOTE);
    let written = read(&file);
    assert!(
        written.starts_with(SEED),
        "the original bytes stay a prefix"
    );
    assert_eq!(
        &written[SEED.len()..],
        format!(
            "\n{BEGIN_MARKER}\nexport GOPATH='/Users/me/go'\nexport API_TOKEN='{TOKEN}'\nexport path=(\"$HOME\"/'bin' '/opt/tool/bin' $path)\n{END_MARKER}\n"
        )
    );
    assert_eq!(mode(&file), 0o640, "the file keeps its permissions");
    let backup = harness
        .backup_files()
        .into_iter()
        .find(|path| path.file_name().is_some_and(|name| name == "content"))
        .expect("backup content");
    assert_eq!(read(&backup), SEED);

    // The result is read back through the same state command.
    let state = harness.ready(StartupFile::Zshrc);
    let BlockView::Present {
        variables, path, ..
    } = &state.block
    else {
        panic!("block present");
    };
    assert_eq!(variables.len(), 2);
    assert!(variables[1].secret && variables[1].value.is_none());
    assert_eq!(variables[0].value.as_deref(), Some("/Users/me/go"));
    assert_eq!(
        path,
        &vec!["$HOME/bin".to_owned(), "/opt/tool/bin".to_owned()]
    );
    assert!(!json(&state).contains(TOKEN));
    // The pending preview is consumed.
    assert_eq!(harness.pending_count(), 0);
    assert!(harness.confirm(StartupFile::Zshrc, &id(&preview)).is_err());
}

#[test]
fn the_result_only_claims_new_shells_and_never_a_running_process() {
    let harness = Harness::new();
    harness.seed(StartupFile::Zshrc, SEED);
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("A", "1")]));
    let execution = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    let text = json(&execution);
    assert!(text.contains("新开的终端"));
    assert!(text.contains("不会 source"));
    for claim in ["立即生效", "已生效", "当前会话已", "已更新当前"] {
        assert!(!text.contains(claim), "{claim}");
    }
}

#[test]
fn a_changed_block_keeps_every_byte_outside_the_markers() {
    for (before, after, eol) in [
        ("export A=1\n", "export Z=9\n", "\n"),
        ("export A=1\r\n", "export Z=9\r\n", "\r\n"),
        ("\u{feff}# top\n", "", "\n"),
        ("", "export Z=9", "\n"),
        ("a\n\n\n", "\n\n# end\n", "\n"),
        (
            "if true; then\n  PATH=\"$HOME/x:$PATH\"\nfi\n",
            "export Q=$(date)\n",
            "\n",
        ),
    ] {
        let harness = Harness::new();
        let original =
            format!("{before}{BEGIN_MARKER}{eol}export OLD='1'{eol}{END_MARKER}{eol}{after}");
        let file = harness.seed(StartupFile::Zshrc, &original);
        let preview = harness.preview_now(
            StartupFile::Zshrc,
            vars(vec![set("OLD", "2"), set("NEW", "it's")]),
        );
        assert!(!preview.created_block);
        harness
            .confirm(StartupFile::Zshrc, &id(&preview))
            .expect("confirm");
        let written = read(&file);
        assert!(written.starts_with(before), "{before:?}");
        assert!(
            written.ends_with(&format!("{END_MARKER}{eol}{after}")),
            "{before:?}"
        );
        assert!(written.contains(&format!("export NEW={}{eol}", quote("it's"))));
        assert!(!written.replace("\r\n", "").contains('\r') || eol == "\r\n");
    }
}

#[test]
fn a_file_without_a_final_newline_and_a_bom_file_keep_their_original_bytes() {
    for original in [
        "export A=1",
        "\u{feff}export A=1\n",
        "export A=1\r\nexport B=2",
        "# only a comment",
    ] {
        let harness = Harness::new();
        let file = harness.seed(StartupFile::Zshrc, original);
        let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("C", "3")]));
        harness
            .confirm(StartupFile::Zshrc, &id(&preview))
            .expect("confirm");
        let written = read(&file);
        assert!(written.starts_with(original), "{original:?}");
        assert_eq!(written.matches(BEGIN_MARKER).count(), 1);
    }
}

#[test]
fn a_new_file_is_created_without_a_recovery_point_and_owner_only() {
    let harness = Harness::new();
    let file = harness.path(StartupFile::Zshrc);
    harness.enable(StartupFile::Zshrc).expect("enable");
    let preview = harness
        .preview(StartupFile::Zshrc, None, vars(vec![set("EDITOR", "vim")]))
        .expect("preview");
    assert_eq!(preview.write.kind, WriteKind::Create);
    assert_eq!(preview.write.recovery_point, RecoveryPoint::NoneCreated);
    assert!(preview.warnings.contains(&EditWarning::FileCreated));
    assert!(!file.exists());

    let execution = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    assert_eq!(execution.execution.outcome.kind, WriteKind::Create);
    assert_eq!(execution.execution.outcome.status, WriteStatus::Succeeded);
    assert_eq!(
        execution.execution.outcome.recovery_point,
        RecoveryPoint::NoneCreated
    );
    assert_eq!(execution.execution.outcome.backup_id, None);
    assert_eq!(
        read(&file),
        format!("{BEGIN_MARKER}\nexport EDITOR='vim'\n{END_MARKER}\n")
    );
    assert_eq!(mode(&file), 0o600);
    assert!(harness.backup_files().is_empty());
}

#[test]
fn a_file_created_by_someone_else_after_the_preview_is_not_overwritten() {
    let harness = Harness::new();
    harness.enable(StartupFile::Zshrc).expect("enable");
    let preview = harness
        .preview(StartupFile::Zshrc, None, vars(vec![set("A", "1")]))
        .expect("preview");
    let file = harness.seed(StartupFile::Zshrc, "export THEIRS=1\n");
    let error = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect_err("exists");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(read(&file), "export THEIRS=1\n");
}

#[test]
fn every_startup_file_can_be_edited_when_chosen_one_at_a_time() {
    for (file, position) in [
        (StartupFile::Zshenv, 2),
        (StartupFile::Zprofile, 4),
        (StartupFile::Zshrc, 6),
        (StartupFile::Zlogin, 8),
    ] {
        let harness = Harness::new();
        harness.seed(file, "export KEEP=1\n");
        let preview = harness.preview_now(file, vars(vec![set("A", "1")]));
        assert_eq!(preview.file, file);
        assert_eq!(preview.position, position);
        harness.confirm(file, &id(&preview)).expect("confirm");
        assert!(read(&harness.path(file)).contains("export A='1'"));
        // The other files are untouched and were never authorized.
        assert_eq!(harness.grants.list().expect("grants").len(), 1);
        for other in [
            StartupFile::Zshenv,
            StartupFile::Zprofile,
            StartupFile::Zshrc,
            StartupFile::Zlogin,
        ] {
            if other != file {
                assert!(!harness.path(other).exists());
            }
        }
    }
}

// ---- hostile input ----------------------------------------------------------------------------

#[test]
fn hostile_values_survive_the_whole_transaction_as_literals() {
    let values = [
        "it's",
        "'; touch /tmp/pwned; echo '",
        "$(touch /tmp/pwned)",
        "`touch /tmp/pwned`",
        "$HOME and ${PATH}",
        "a;b&c|d>e<f",
        "back\\slash\\'",
        "-rf --no-preserve-root",
        "",
        "日本語 😀",
        "\"quoted\"",
    ];
    for value in values {
        let harness = Harness::new();
        let file = harness.seed(StartupFile::Zshrc, SEED);
        let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("DEMO", value)]));
        harness
            .confirm(StartupFile::Zshrc, &id(&preview))
            .expect("confirm");
        let written = read(&file);
        assert!(
            written
                .lines()
                .any(|line| line == format!("export DEMO={}", quote(value))),
            "{value:?}"
        );
        // Exactly one managed statement was added, and the view reads the exact value.
        let state = harness.ready(StartupFile::Zshrc);
        let BlockView::Present { variables, .. } = state.block else {
            panic!("present");
        };
        assert_eq!(variables.len(), 1, "{value:?}");
        assert_eq!(variables[0].value.as_deref(), Some(value), "{value:?}");
        assert!(!Path::new("/tmp/pwned").exists() || value.is_empty() || !value.contains("pwned"));
    }
}

#[test]
fn values_that_are_not_one_safe_line_are_refused_and_prepare_nothing() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    harness.enable(StartupFile::Zshrc).expect("enable");
    let hash = harness.ready(StartupFile::Zshrc).content_hash;
    for value in ["a\nb", "a\rb", "nul\0", "tab\t", "\u{1b}[0m", "x\u{202e}y"] {
        let error = harness
            .preview(
                StartupFile::Zshrc,
                hash.as_deref(),
                vars(vec![set("API_TOKEN", value)]),
            )
            .expect_err("refused");
        assert_eq!(error.code(), AppErrorCode::InvalidInput, "{value:?}");
        assert!(!json(&error).contains(value.trim()) || value.trim().is_empty());
    }
    let error = harness
        .preview(
            StartupFile::Zshrc,
            hash.as_deref(),
            vars(vec![set("1BAD", "x")]),
        )
        .expect_err("name");
    assert_eq!(error.code(), AppErrorCode::InvalidInput);
    let error = harness
        .preview(
            StartupFile::Zshrc,
            hash.as_deref(),
            path_edit(&["relative/bin"]),
        )
        .expect_err("path");
    assert_eq!(error.code(), AppErrorCode::InvalidInput);
    assert_eq!(read(&file), SEED);
    assert_eq!(harness.pending_count(), 0);
    assert!(harness.backup_files().is_empty());
}

#[test]
fn an_edit_that_changes_nothing_is_not_previewed() {
    let harness = Harness::new();
    let original = format!("{BEGIN_MARKER}\nexport A='1'\n{END_MARKER}\n");
    harness.seed(StartupFile::Zshrc, &original);
    harness.enable(StartupFile::Zshrc).expect("enable");
    let hash = harness.ready(StartupFile::Zshrc).content_hash;
    let error = harness
        .preview(
            StartupFile::Zshrc,
            hash.as_deref(),
            vars(vec![set("A", "1")]),
        )
        .expect_err("no change");
    assert_eq!(error.code(), AppErrorCode::InvalidInput);
    assert_eq!(harness.pending_count(), 0);
}

// ---- damaged structure ----------------------------------------------------------------------------

#[test]
fn a_damaged_block_is_reported_and_structured_writing_is_blocked() {
    let begin = format!("{BEGIN_MARKER}\n");
    let end = format!("{END_MARKER}\n");
    for original in [
        format!("export A=1\n{begin}export B='1'\n"),
        format!("{end}export A=1\n"),
        format!("{end}{begin}"),
        format!("{begin}{begin}{end}"),
        format!("{begin}{end}{begin}{end}"),
        format!("{begin}export B=1\n{end}"),
    ] {
        let harness = Harness::new();
        let file = harness.seed(StartupFile::Zshrc, &original);
        let state = harness.ready(StartupFile::Zshrc);
        let BlockView::Broken { message, line, .. } = &state.block else {
            panic!("broken: {original:?}");
        };
        assert!(*line >= 1 && !message.is_empty());
        harness.enable(StartupFile::Zshrc).expect("enable");
        let error = harness
            .preview(
                StartupFile::Zshrc,
                state.content_hash.as_deref(),
                vars(vec![set("A", "1")]),
            )
            .expect_err("blocked");
        assert_eq!(error.code(), AppErrorCode::ValidationFailed, "{original:?}");
        assert!(json(&error).contains("不会尝试修复"));
        assert_eq!(read(&file), original, "nothing is repaired");
        assert_eq!(harness.pending_count(), 0);
    }
}

// ---- outside assignments and PATH ------------------------------------------------------------------

#[test]
fn same_named_assignments_outside_the_block_are_kept_and_flagged_in_the_preview() {
    let harness = Harness::new();
    let original = format!(
        "export EDITOR=nano\n{BEGIN_MARKER}\nexport OTHER='1'\n{END_MARKER}\nexport LANG=C\n"
    );
    let file = harness.seed(StartupFile::Zshrc, &original);
    let preview = harness.preview_now(
        StartupFile::Zshrc,
        vars(vec![
            set("EDITOR", "vim"),
            set("LANG", "en_US.UTF-8"),
            set("FRESH", "1"),
        ]),
    );
    assert!(
        preview
            .warnings
            .contains(&EditWarning::OverridesEarlierAssignment {
                name: "EDITOR".to_owned(),
                line: 1
            })
    );
    assert!(
        preview
            .warnings
            .contains(&EditWarning::OverriddenByLaterAssignment {
                name: "LANG".to_owned(),
                line: 5
            })
    );
    assert_eq!(preview.warnings.len(), 2, "{:?}", preview.warnings);
    harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    let written = read(&file);
    assert!(written.starts_with("export EDITOR=nano\n"));
    assert!(written.ends_with("export LANG=C\n"));
    assert_eq!(
        written.matches("export EDITOR=").count(),
        2,
        "both assignments exist"
    );

    // The state lists the outside assignments with their position.
    let state = harness.ready(StartupFile::Zshrc);
    let positions: Vec<(&str, bool)> = state
        .outside
        .variables
        .iter()
        .map(|variable| (variable.name.as_str(), variable.before_block))
        .collect();
    assert_eq!(positions, vec![("EDITOR", true), ("LANG", false)]);
}

#[test]
fn outside_path_lines_are_shown_never_expanded_or_rewritten() {
    let harness = Harness::new();
    let outside = "export PATH=\"$(brew --prefix)/bin:$PATH\"\nif [ -d ~/x ]; then\n  export PATH=\"$HOME/x:$PATH\"\nfi\nexport PATH=/opt/static/bin:/usr/bin\npath+=(/opt/more)\n";
    let file = harness.seed(StartupFile::Zshrc, outside);
    let state = harness.ready(StartupFile::Zshrc);
    assert_eq!(state.outside.path.len(), 3);
    let first = &state.outside.path[0];
    assert_eq!(first.state, ValueState::Dynamic);
    assert!(first.before_block);
    assert!(
        state.outside.path[1]
            .segments
            .iter()
            .any(|s| s.text == "/opt/static/bin")
    );
    assert_eq!(
        state.outside.dynamic_path_lines.len(),
        1,
        "the if-block line"
    );
    assert_eq!(state.outside.dynamic_path_lines[0].line, 3);

    let preview = harness.preview_now(
        StartupFile::Zshrc,
        path_edit(&["/opt/static/bin", "/opt/new", "/opt/new"]),
    );
    assert!(
        preview
            .warnings
            .contains(&EditWarning::DynamicPathOutside { line: 1 })
    );
    assert!(
        preview
            .warnings
            .contains(&EditWarning::DynamicPathOutside { line: 3 })
    );
    assert!(
        preview
            .warnings
            .contains(&EditWarning::PathItemAlsoOutside {
                item: "/opt/static/bin".to_owned(),
                line: 5
            })
    );
    assert!(preview.warnings.contains(&EditWarning::DuplicatePathItem {
        item: "/opt/new".to_owned()
    }));
    assert!(
        !preview
            .warnings
            .iter()
            .any(|w| matches!(w, EditWarning::LaterPathAssignment { .. }))
    );
    harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    let written = read(&file);
    assert!(
        written.starts_with(outside),
        "the outside PATH lines are byte for byte unchanged"
    );
    assert!(written.contains("export path=('/opt/static/bin' '/opt/new' '/opt/new' $path)"));
}

#[test]
fn a_plain_path_assignment_after_the_block_is_flagged() {
    let harness = Harness::new();
    let original = format!("{BEGIN_MARKER}\n{END_MARKER}\nPATH=/usr/bin:/bin\n");
    harness.seed(StartupFile::Zshrc, &original);
    let preview = harness.preview_now(StartupFile::Zshrc, path_edit(&["/opt/a"]));
    assert!(
        preview
            .warnings
            .contains(&EditWarning::LaterPathAssignment { line: 3 })
    );
}

#[test]
fn the_path_form_never_drops_the_existing_path_and_has_no_empty_segment() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, "");
    let preview = harness.preview_now(StartupFile::Zshrc, path_edit(&["/opt/a", "~/bin"]));
    harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    let written = read(&file);
    assert!(written.contains("export path=('/opt/a' \"$HOME\"/'bin' $path)"));
    assert!(!written.contains("::") && !written.contains(":'") && !written.contains("':"));
}

// ---- secrets ------------------------------------------------------------------------------------------

#[test]
fn secrets_stay_out_of_the_preview_the_history_the_state_and_errors() {
    let harness = Harness::new();
    let seed = format!("export API_TOKEN={TOKEN}\nexport OPENAI_KEY=\"{TOKEN}-2\"\n");
    harness.seed(StartupFile::Zshrc, &seed);
    let preview = harness.preview_now(
        StartupFile::Zshrc,
        vars(vec![
            set("DB_PASSWORD", TOKEN),
            set("URL", "https://u:p4ss@example.com/x"),
        ]),
    );
    let text = json(&preview);
    for secret in [TOKEN, "p4ss"] {
        assert!(!text.contains(secret), "preview leaks {secret}");
    }
    assert!(text.contains("••••••"));
    let operation = json(&harness.operations.get(&id(&preview)).expect("operation"));
    assert!(!operation.contains(TOKEN));
    let state = json(&harness.ready(StartupFile::Zshrc));
    assert!(!state.contains(TOKEN), "state leaks");

    let execution = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("confirm");
    let text = json(&execution);
    assert!(!text.contains(TOKEN) && !text.contains("p4ss"), "{text}");
    let operation = json(&harness.operations.get(&id(&preview)).expect("operation"));
    assert!(!operation.contains(TOKEN) && !operation.contains("p4ss"));
    assert!(!json(&harness.ready(StartupFile::Zshrc)).contains("p4ss"));
}

#[test]
fn request_debug_output_never_contains_a_value() {
    let request = ZshEditPreviewRequest {
        target: Harness::target(StartupFile::Zshrc),
        expected_hash: None,
        edit: vars(vec![set("API_TOKEN", "very-secret-value")]),
    };
    let printed = format!("{request:?}");
    assert!(!printed.contains("very-secret-value"), "{printed}");
    assert!(printed.contains("API_TOKEN"));
}

// ---- stale, concurrent and failing transactions --------------------------------------------------------

#[test]
fn a_stale_hash_is_a_conflict_and_nothing_is_prepared() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    harness.enable(StartupFile::Zshrc).expect("enable");
    let hash = harness.ready(StartupFile::Zshrc).content_hash;
    fs::write(&file, "export CHANGED=1\n").expect("external edit");
    let error = harness
        .preview(
            StartupFile::Zshrc,
            hash.as_deref(),
            vars(vec![set("A", "1")]),
        )
        .expect_err("stale");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    // Claiming the file is new while it exists is the same conflict.
    let error = harness
        .preview(StartupFile::Zshrc, None, vars(vec![set("A", "1")]))
        .expect_err("exists");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn an_expired_preview_cannot_be_confirmed_and_writes_nothing() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("A", "1")]));
    harness
        .clock
        .millis
        .store(PREVIEW_TTL_MILLIS, Ordering::SeqCst);
    let error = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect_err("expired");
    assert_eq!(error.code(), AppErrorCode::Timeout);
    assert_eq!(read(&file), SEED);
    assert!(harness.backup_files().is_empty());
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn a_concurrent_external_write_makes_the_confirmation_fail_and_is_kept() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("A", "1")]));
    fs::write(&file, "export EXTERNAL=1\n").expect("external edit");
    let error = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect_err("changed");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(read(&file), "export EXTERNAL=1\n");
    assert!(harness.backup_files().is_empty());
}

#[test]
fn a_target_swapped_for_a_symbolic_link_after_the_preview_is_refused() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    let other = harness.fixture.outside.join("other");
    fs::write(&other, "victim\n").expect("other");
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("A", "1")]));
    fs::remove_file(&file).expect("remove");
    symlink(&other, &file).expect("swap");
    let error = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect_err("swapped");
    assert!(matches!(
        error.code(),
        AppErrorCode::Conflict | AppErrorCode::PermissionDenied
    ));
    assert_eq!(read(&other), "victim\n");
    assert!(harness.backup_files().is_empty());
}

#[test]
fn a_revoked_authorization_cannot_confirm() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("A", "1")]));
    let grant = harness.ready(StartupFile::Zshrc).grant_id.expect("grant");
    harness.grants.revoke(&grant).expect("revoke");
    let error = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect_err("revoked");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(read(&file), SEED);
}

#[test]
fn confirming_for_another_file_is_refused_and_the_preview_stays_usable() {
    let harness = Harness::new();
    let rc = harness.seed(StartupFile::Zshrc, SEED);
    let profile = harness.seed(StartupFile::Zprofile, "export P=1\n");
    harness.enable(StartupFile::Zprofile).expect("enable other");
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("A", "1")]));
    let error = harness
        .confirm(StartupFile::Zprofile, &id(&preview))
        .expect_err("other");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert_eq!(read(&rc), SEED);
    assert_eq!(read(&profile), "export P=1\n");
    assert_eq!(harness.pending_count(), 1);
    harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("original target");
    assert!(read(&rc).contains("export A='1'"));
}

#[test]
fn a_failed_backup_leaves_the_file_untouched_and_says_so() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    fs::write(harness.home().join("backups"), "not a directory").expect("block backups");
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("API_TOKEN", TOKEN)]));
    let execution = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("ran");
    assert_eq!(execution.execution.outcome.status, WriteStatus::Failed);
    assert_eq!(execution.execution.outcome.file_state, FileState::Unchanged);
    assert_eq!(
        execution.execution.outcome.recovery_point,
        RecoveryPoint::NoneUnavailable
    );
    assert_eq!(read(&file), SEED);
    assert!(!json(&execution).contains(TOKEN));
}

#[test]
fn a_failed_read_back_restores_the_previous_content_and_reports_it() {
    let harness = Harness::new();
    let file = harness.seed(StartupFile::Zshrc, SEED);
    let preview = harness.preview_now(
        StartupFile::Zshrc,
        vars(vec![set("A", "1"), set("API_TOKEN", TOKEN)]),
    );
    {
        // Make the independent read-back disagree with what was previewed.
        let mut state = harness.edits.state.lock().expect("state");
        let pending = state.get_mut(&id(&preview)).expect("pending");
        pending.desired.variables[0].value = "2".to_owned();
    }
    let execution = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("ran");
    assert_eq!(execution.execution.outcome.status, WriteStatus::Failed);
    assert_eq!(execution.execution.outcome.file_state, FileState::Restored);
    assert_eq!(read(&file), SEED);
    let error = execution.execution.outcome.error.as_ref().expect("cause");
    assert_eq!(error.code(), AppErrorCode::ValidationFailed);
    assert!(!json(&execution).contains(TOKEN));
    assert_eq!(harness.pending_count(), 0);
}

#[test]
fn a_created_file_that_fails_the_read_back_is_removed_again() {
    let harness = Harness::new();
    let file = harness.path(StartupFile::Zshrc);
    harness.enable(StartupFile::Zshrc).expect("enable");
    let preview = harness
        .preview(StartupFile::Zshrc, None, vars(vec![set("A", "1")]))
        .expect("preview");
    {
        let mut state = harness.edits.state.lock().expect("state");
        state
            .get_mut(&id(&preview))
            .expect("pending")
            .desired
            .variables[0]
            .value = "2".to_owned();
    }
    let execution = harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("ran");
    assert_eq!(execution.execution.outcome.status, WriteStatus::Failed);
    assert_eq!(
        execution.execution.outcome.file_state,
        FileState::CreatedRemoved
    );
    assert!(!file.exists());
}

#[test]
fn a_consumed_or_unknown_preview_cannot_be_confirmed() {
    let harness = Harness::new();
    harness.seed(StartupFile::Zshrc, SEED);
    let preview = harness.preview_now(StartupFile::Zshrc, vars(vec![set("A", "1")]));
    harness
        .confirm(StartupFile::Zshrc, &id(&preview))
        .expect("first");
    assert!(harness.confirm(StartupFile::Zshrc, &id(&preview)).is_err());
    let error = harness
        .confirm(StartupFile::Zshrc, "op-unknown")
        .expect_err("unknown");
    assert_eq!(error.code(), AppErrorCode::NotFound);
}

#[test]
fn nothing_here_reads_or_writes_the_real_home() {
    // The harness resolves every path from the fixture home; the real one is only
    // ever named by the environment, which no function in this module reads.
    let harness = Harness::new();
    let real = std::env::var_os("HOME").map(PathBuf::from);
    assert_ne!(real.as_deref(), Some(harness.home()));
    let path = match harness.state(StartupFile::Zshrc) {
        ZshEditOutcome::Ready(state) => state.full_path,
        other => panic!("{other:?}"),
    };
    assert!(path.starts_with(harness.home().to_str().expect("utf8")));
}
