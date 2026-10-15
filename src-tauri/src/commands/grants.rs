use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

use crate::{
    error::AppError,
    grants::{GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose, GrantSummary},
};

// Grants are created only by backend code after a native picker; there is
// deliberately no command that accepts a path and returns an authorization.
// The select commands below open the picker themselves, hand the chosen path
// to `GrantCoordinator::create` and return only a redacted summary. The dialog
// plugin is registered for the backend alone: the capability file grants the
// frontend no dialog or fs permission.

/// Which native panel a selection command opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickMode {
    Directory,
    File,
    SaveLocation,
}

/// Source of the user's choice. Production uses the native dialog; `e2e`
/// builds swap in a fixture so WDIO can drive the flow without a panel.
pub trait NativePicker: Send + 'static {
    /// Blocks until the user chooses a path (`Some`) or cancels (`None`).
    fn pick(&self, mode: PickMode) -> Result<Option<PathBuf>, AppError>;
}

pub struct DialogPicker {
    app: tauri::AppHandle,
}

impl DialogPicker {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl NativePicker for DialogPicker {
    fn pick(&self, mode: PickMode) -> Result<Option<PathBuf>, AppError> {
        let dialog = self.app.dialog().file();
        let picked = match mode {
            PickMode::Directory => dialog
                .set_title("Choose a directory to authorize")
                .blocking_pick_folder(),
            PickMode::File => dialog
                .set_title("Choose a file to authorize")
                .blocking_pick_file(),
            PickMode::SaveLocation => dialog
                .set_title("Choose a save location to authorize")
                .blocking_save_file(),
        };
        picked
            .map(|chosen| {
                chosen
                    .into_path()
                    .map_err(|_| AppError::invalid_input("The chosen location is not a file path."))
            })
            .transpose()
    }
}

#[cfg(not(feature = "e2e"))]
fn native_picker(app: tauri::AppHandle) -> DialogPicker {
    DialogPicker::new(app)
}

#[cfg(feature = "e2e")]
fn native_picker(_app: tauri::AppHandle) -> e2e_fixture::FixturePicker {
    e2e_fixture::FixturePicker::from_env()
}

/// Fixed-choice picker that only exists in `e2e` builds. The directory named by
/// `USERHOME_E2E_PICKER_DIR` may hold `directory`, `file` and `save` files whose
/// content is the absolute path to "choose"; a missing file means "cancel".
/// It is re-read on every pick so a test can change the answer between steps.
#[cfg(feature = "e2e")]
pub mod e2e_fixture {
    use std::{ffi::OsString, fs::File, io::Read, path::PathBuf};

    use crate::error::AppError;

    use super::{NativePicker, PickMode};

    pub const FIXTURE_DIR_ENV: &str = "USERHOME_E2E_PICKER_DIR";
    const MAX_FIXTURE_BYTES: u64 = 4096;

    pub struct FixturePicker {
        directory: Option<PathBuf>,
    }

    impl FixturePicker {
        pub fn new(directory: Option<PathBuf>) -> Self {
            Self { directory }
        }

        pub fn from_env() -> Self {
            Self::new(std::env::var_os(FIXTURE_DIR_ENV).map(PathBuf::from))
        }
    }

    impl NativePicker for FixturePicker {
        fn pick(&self, mode: PickMode) -> Result<Option<PathBuf>, AppError> {
            let Some(directory) = &self.directory else {
                return Ok(None);
            };
            let name = match mode {
                PickMode::Directory => "directory",
                PickMode::File => "file",
                PickMode::SaveLocation => "save",
            };
            let Ok(file) = File::open(directory.join(name)) else {
                return Ok(None);
            };
            let mut text = String::new();
            file.take(MAX_FIXTURE_BYTES)
                .read_to_string(&mut text)
                .map_err(|_| AppError::invalid_input("The picker fixture is not valid text."))?;
            let trimmed = text.trim();
            Ok((!trimmed.is_empty()).then(|| PathBuf::from(OsString::from(trimmed))))
        }
    }
}

/// Input of every select command. It carries only the purpose; the path comes
/// from the native panel, so any other field (a path in particular) is rejected.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectGrantInput {
    pub purpose: GrantPurpose,
}

/// Result of a selection. Cancelling is its own outcome: no grant is created
/// and the call does not report success.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", content = "grant", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SelectGrantOutcome {
    Selected(GrantSummary),
    Cancelled,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeGrantInput {
    pub grant_id: String,
}

#[tauri::command]
pub fn list_grants(
    coordinator: State<'_, GrantCoordinator>,
) -> Result<Vec<GrantSummary>, AppError> {
    list_summaries(&coordinator, home_directory())
}

#[tauri::command]
pub fn revoke_grant(
    coordinator: State<'_, GrantCoordinator>,
    input: RevokeGrantInput,
) -> Result<(), AppError> {
    revoke_by_id(&coordinator, &input)
}

#[tauri::command]
pub async fn select_directory_grant(
    app: tauri::AppHandle,
    coordinator: State<'_, GrantCoordinator>,
    input: SelectGrantInput,
) -> Result<SelectGrantOutcome, AppError> {
    select_grant(
        &coordinator,
        &PICKER_OPEN,
        native_picker(app),
        PickMode::Directory,
        input.purpose,
        home_directory(),
    )
    .await
}

#[tauri::command]
pub async fn select_file_grant(
    app: tauri::AppHandle,
    coordinator: State<'_, GrantCoordinator>,
    input: SelectGrantInput,
) -> Result<SelectGrantOutcome, AppError> {
    select_grant(
        &coordinator,
        &PICKER_OPEN,
        native_picker(app),
        PickMode::File,
        input.purpose,
        home_directory(),
    )
    .await
}

#[tauri::command]
pub async fn select_save_location_grant(
    app: tauri::AppHandle,
    coordinator: State<'_, GrantCoordinator>,
    input: SelectGrantInput,
) -> Result<SelectGrantOutcome, AppError> {
    select_grant(
        &coordinator,
        &PICKER_OPEN,
        native_picker(app),
        PickMode::SaveLocation,
        input.purpose,
        home_directory(),
    )
    .await
}

fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

// One native panel at a time; a second request while one is open is refused
// instead of stacking dialogs.
static PICKER_OPEN: AtomicBool = AtomicBool::new(false);

struct PickerSlot<'a>(&'a AtomicBool);

impl<'a> PickerSlot<'a> {
    fn acquire(flag: &'a AtomicBool) -> Result<Self, AppError> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self(flag))
            .map_err(|_| AppError::conflict("A selection dialog is already open."))
    }
}

impl Drop for PickerSlot<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn validate_selection(mode: PickMode, purpose: GrantPurpose) -> Result<(), AppError> {
    let allowed = match mode {
        PickMode::Directory | PickMode::File => purpose.kind() == mode_kind(mode),
        PickMode::SaveLocation => purpose == GrantPurpose::ConfigFile,
    };
    if allowed {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "The authorization purpose does not match this selection.",
        ))
    }
}

fn mode_kind(mode: PickMode) -> GrantKind {
    match mode {
        PickMode::Directory => GrantKind::Directory,
        PickMode::File | PickMode::SaveLocation => GrantKind::File,
    }
}

/// Validates the purpose, shows the picker off the async threads, and turns a
/// chosen path into a grant through `GrantCoordinator::create`. The chosen path
/// is never read, written or returned; only the redacted summary leaves here.
async fn select_grant<P: NativePicker>(
    coordinator: &GrantCoordinator,
    picker_open: &AtomicBool,
    picker: P,
    mode: PickMode,
    purpose: GrantPurpose,
    home: Option<PathBuf>,
) -> Result<SelectGrantOutcome, AppError> {
    validate_selection(mode, purpose)?;
    let _slot = PickerSlot::acquire(picker_open)?;
    let picked = tauri::async_runtime::spawn_blocking(move || picker.pick(mode))
        .await
        .map_err(|_| AppError::internal())??;
    let Some(path) = picked else {
        return Ok(SelectGrantOutcome::Cancelled);
    };
    let record = coordinator.create(purpose, &path).map_err(|error| {
        if mode == PickMode::SaveLocation && error == GrantError::NotFound {
            AppError::validation_failed(
                "The chosen save location does not exist yet; choose an existing file.",
            )
        } else {
            error.into()
        }
    })?;
    Ok(SelectGrantOutcome::Selected(
        record.summary(home.as_deref()),
    ))
}

fn list_summaries(
    coordinator: &GrantCoordinator,
    home: Option<PathBuf>,
) -> Result<Vec<GrantSummary>, AppError> {
    Ok(coordinator
        .list()?
        .iter()
        .map(|record| record.summary(home.as_deref()))
        .collect())
}

fn revoke_by_id(coordinator: &GrantCoordinator, input: &RevokeGrantInput) -> Result<(), AppError> {
    let id = GrantId::parse(&input.grant_id)?;
    Ok(coordinator.revoke(&id)?)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, sync::atomic::AtomicBool};

    use serde_json::json;
    use uuid::Uuid;

    use crate::{
        error::{AppError, AppErrorCode},
        grants::{GrantCoordinator, GrantPurpose, GrantStore},
    };

    use super::{
        NativePicker, PickMode, PickerSlot, RevokeGrantInput, SelectGrantInput, SelectGrantOutcome,
        list_summaries, revoke_by_id, select_grant, validate_selection,
    };

    struct FakePicker(Result<Option<PathBuf>, AppError>);

    impl NativePicker for FakePicker {
        fn pick(&self, _mode: PickMode) -> Result<Option<PathBuf>, AppError> {
            self.0.clone()
        }
    }

    struct Sandbox {
        root: PathBuf,
    }

    impl Sandbox {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("temp dir")
                .join(format!("userhome-grant-select-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create sandbox");
            Self { root }
        }

        fn coordinator(&self) -> GrantCoordinator {
            GrantCoordinator::new(GrantStore::new(self.root.join("support")))
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn run_select_with(
        coordinator: &GrantCoordinator,
        picker_open: &AtomicBool,
        picker: FakePicker,
        mode: PickMode,
        purpose: GrantPurpose,
        home: Option<PathBuf>,
    ) -> Result<SelectGrantOutcome, AppError> {
        tauri::async_runtime::block_on(select_grant(
            coordinator,
            picker_open,
            picker,
            mode,
            purpose,
            home,
        ))
    }

    fn run_select(
        coordinator: &GrantCoordinator,
        picker: FakePicker,
        mode: PickMode,
        purpose: GrantPurpose,
        home: Option<PathBuf>,
    ) -> Result<SelectGrantOutcome, AppError> {
        run_select_with(
            coordinator,
            &AtomicBool::new(false),
            picker,
            mode,
            purpose,
            home,
        )
    }

    #[test]
    fn select_input_rejects_paths_and_unknown_fields() {
        let valid: SelectGrantInput =
            serde_json::from_value(json!({"purpose":"CONFIG_FILE"})).expect("purpose only");
        assert_eq!(valid.purpose, GrantPurpose::ConfigFile);
        for rejected in [
            json!({"purpose":"CONFIG_FILE","path":"/etc/hosts"}),
            json!({"purpose":"CONFIG_DIRECTORY","directory":"/"}),
            json!({"path":"/etc"}),
            json!({"purpose":"ROOT_SHELL"}),
            json!({}),
        ] {
            assert!(
                serde_json::from_value::<SelectGrantInput>(rejected.clone()).is_err(),
                "{rejected} must be rejected"
            );
        }
    }

    #[test]
    fn cancelling_creates_no_grant_and_reports_cancelled() {
        let sandbox = Sandbox::new();
        let coordinator = sandbox.coordinator();
        for (mode, purpose) in [
            (PickMode::Directory, GrantPurpose::ConfigDirectory),
            (PickMode::File, GrantPurpose::ConfigFile),
            (PickMode::SaveLocation, GrantPurpose::ConfigFile),
        ] {
            let outcome = run_select(&coordinator, FakePicker(Ok(None)), mode, purpose, None)
                .expect("cancel is not an error");
            assert_eq!(outcome, SelectGrantOutcome::Cancelled);
        }
        assert!(coordinator.list().expect("list").is_empty());
        assert_eq!(
            serde_json::to_value(SelectGrantOutcome::Cancelled).expect("serialize"),
            json!({"status":"CANCELLED"})
        );
    }

    #[test]
    fn chosen_paths_become_grants_and_only_a_redacted_summary_returns() {
        let sandbox = Sandbox::new();
        let coordinator = sandbox.coordinator();
        let directory = sandbox.root.join("project");
        fs::create_dir_all(&directory).expect("create directory");
        let file = sandbox.root.join("tool.toml");
        fs::write(&file, b"key = 1").expect("write file");

        let cases = [
            (
                PickMode::Directory,
                GrantPurpose::ConfigDirectory,
                &directory,
                "~/project",
            ),
            (
                PickMode::File,
                GrantPurpose::Executable,
                &file,
                "~/tool.toml",
            ),
            (
                PickMode::SaveLocation,
                GrantPurpose::ConfigFile,
                &file,
                "~/tool.toml",
            ),
        ];
        for (mode, purpose, path, expected_display) in cases {
            let outcome = run_select(
                &coordinator,
                FakePicker(Ok(Some(path.clone()))),
                mode,
                purpose,
                Some(sandbox.root.clone()),
            )
            .expect("selection succeeds");
            let SelectGrantOutcome::Selected(summary) = &outcome else {
                panic!("expected a selection, got {outcome:?}");
            };
            assert_eq!(summary.purpose, purpose);
            assert_eq!(summary.display_path, expected_display);
            let wire = serde_json::to_string(&outcome).expect("serialize");
            assert!(wire.contains(r#""status":"SELECTED""#));
            assert!(!wire.contains(sandbox.root.to_str().expect("utf8 root")));
        }

        // Written through GrantCoordinator::create: the store now holds the
        // three grants and each one resolves again.
        let stored = coordinator.list().expect("list");
        assert_eq!(stored.len(), 3);
        for record in stored {
            coordinator.resolve(&record.id).expect("grant resolves");
        }
    }

    #[test]
    fn selection_failures_create_nothing_and_stay_classified() {
        let sandbox = Sandbox::new();
        let coordinator = sandbox.coordinator();
        let file = sandbox.root.join("plain.txt");
        fs::write(&file, b"x").expect("write file");

        let wrong_kind = run_select(
            &coordinator,
            FakePicker(Ok(Some(file.clone()))),
            PickMode::Directory,
            GrantPurpose::ConfigDirectory,
            None,
        )
        .expect_err("a file is not a directory");
        assert_eq!(wrong_kind.code(), AppErrorCode::ValidationFailed);

        let missing_save = run_select(
            &coordinator,
            FakePicker(Ok(Some(sandbox.root.join("not-yet.json")))),
            PickMode::SaveLocation,
            GrantPurpose::ConfigFile,
            None,
        )
        .expect_err("new files are not granted");
        assert_eq!(missing_save.code(), AppErrorCode::ValidationFailed);

        let relative = run_select(
            &coordinator,
            FakePicker(Ok(Some(PathBuf::from("relative/path")))),
            PickMode::File,
            GrantPurpose::ConfigFile,
            None,
        )
        .expect_err("relative paths are refused");
        assert_eq!(relative.code(), AppErrorCode::InvalidInput);

        let picker_failure = run_select(
            &coordinator,
            FakePicker(Err(AppError::internal())),
            PickMode::File,
            GrantPurpose::ConfigFile,
            None,
        )
        .expect_err("picker errors propagate");
        assert_eq!(picker_failure.code(), AppErrorCode::Internal);
        assert!(coordinator.list().expect("list").is_empty());
    }

    #[test]
    fn purpose_must_match_the_selection_before_any_dialog_opens() {
        assert!(validate_selection(PickMode::Directory, GrantPurpose::ConfigDirectory).is_ok());
        assert!(validate_selection(PickMode::File, GrantPurpose::ConfigFile).is_ok());
        assert!(validate_selection(PickMode::File, GrantPurpose::Executable).is_ok());
        assert!(validate_selection(PickMode::SaveLocation, GrantPurpose::ConfigFile).is_ok());
        for (mode, purpose) in [
            (PickMode::Directory, GrantPurpose::ConfigFile),
            (PickMode::Directory, GrantPurpose::Executable),
            (PickMode::File, GrantPurpose::ConfigDirectory),
            (PickMode::SaveLocation, GrantPurpose::ConfigDirectory),
            (PickMode::SaveLocation, GrantPurpose::Executable),
        ] {
            let error = validate_selection(mode, purpose).expect_err("mismatch");
            assert_eq!(error.code(), AppErrorCode::InvalidInput);
        }
    }

    #[test]
    fn a_second_dialog_is_refused_while_one_is_open() {
        let sandbox = Sandbox::new();
        let coordinator = sandbox.coordinator();
        let flag = AtomicBool::new(false);
        let slot = PickerSlot::acquire(&flag).expect("first slot");
        let refused = run_select_with(
            &coordinator,
            &flag,
            FakePicker(Ok(None)),
            PickMode::File,
            GrantPurpose::ConfigFile,
            None,
        )
        .expect_err("busy");
        assert_eq!(refused.code(), AppErrorCode::Conflict);
        drop(slot);
        run_select_with(
            &coordinator,
            &flag,
            FakePicker(Ok(None)),
            PickMode::File,
            GrantPurpose::ConfigFile,
            None,
        )
        .expect("slot is free again");
    }

    #[test]
    fn capability_gives_the_frontend_no_dialog_or_fs_permission() {
        let capability_path = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json");
        let text = fs::read_to_string(capability_path).expect("capability file");
        let capability: serde_json::Value = serde_json::from_str(&text).expect("valid JSON");
        let permissions = capability["permissions"].as_array().expect("permissions");
        for permission in permissions {
            let name = permission.as_str().expect("permission identifier");
            assert!(
                name.starts_with("core:"),
                "{name} must be a core permission only"
            );
            assert!(!name.contains("dialog") && !name.contains("fs"));
        }
        assert!(!text.contains("dialog") && !text.contains("\"fs:"));
        assert!(capability.get("remote").is_none());
    }

    #[cfg(feature = "e2e")]
    #[test]
    fn e2e_fixture_answers_from_files_and_cancels_when_absent() {
        use super::e2e_fixture::FixturePicker;

        let sandbox = Sandbox::new();
        let fixture = sandbox.root.join("fixture");
        fs::create_dir_all(&fixture).expect("fixture dir");
        let target = sandbox.root.join("chosen");
        fs::create_dir_all(&target).expect("target");
        let picker = FixturePicker::new(Some(fixture.clone()));

        assert_eq!(picker.pick(PickMode::Directory).expect("pick"), None);
        fs::write(fixture.join("directory"), format!("{}\n", target.display())).expect("write");
        assert_eq!(
            picker.pick(PickMode::Directory).expect("pick"),
            Some(target.clone())
        );
        assert_eq!(picker.pick(PickMode::File).expect("pick"), None);
        assert_eq!(
            FixturePicker::new(None)
                .pick(PickMode::Directory)
                .expect("pick"),
            None
        );

        let outcome = tauri::async_runtime::block_on(select_grant(
            &sandbox.coordinator(),
            &AtomicBool::new(false),
            picker,
            PickMode::Directory,
            GrantPurpose::ConfigDirectory,
            None,
        ))
        .expect("select");
        assert!(matches!(outcome, SelectGrantOutcome::Selected(_)));
    }

    #[test]
    fn revoke_input_rejects_unknown_fields_and_paths() {
        let valid: RevokeGrantInput =
            serde_json::from_str(r#"{"grantId":"abc"}"#).expect("known field");
        assert_eq!(valid.grant_id, "abc");
        assert!(serde_json::from_str::<RevokeGrantInput>(r#"{"grantId":"a","path":"/"}"#).is_err());
        assert!(serde_json::from_str::<RevokeGrantInput>(r#"{"path":"/etc"}"#).is_err());
    }

    #[test]
    fn list_and_revoke_work_through_the_command_helpers() {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("temp dir")
            .join(format!("userhome-grant-commands-{}", Uuid::new_v4()));
        let target = root.join("project");
        fs::create_dir_all(&target).expect("create target");
        let coordinator = GrantCoordinator::new(GrantStore::new(root.join("support")));
        let record = coordinator
            .create(GrantPurpose::ConfigDirectory, &target)
            .expect("create grant");

        let summaries = list_summaries(&coordinator, Some(root.clone())).expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].display_path, "~/project");
        let json = serde_json::to_string(&summaries).expect("serialize");
        assert!(!json.contains(root.to_str().expect("utf8 root")));

        let malformed = revoke_by_id(
            &coordinator,
            &RevokeGrantInput {
                grant_id: "../etc".to_owned(),
            },
        )
        .expect_err("malformed id");
        assert_eq!(malformed.code(), AppErrorCode::NotFound);

        revoke_by_id(
            &coordinator,
            &RevokeGrantInput {
                grant_id: record.id.as_str().to_owned(),
            },
        )
        .expect("revoke");
        assert!(
            list_summaries(&coordinator, None)
                .expect("list again")
                .is_empty()
        );
        let _ = fs::remove_dir_all(PathBuf::from(&root));
    }
}
