use std::fmt;

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use time::OffsetDateTime;

use crate::{
    commands::grants::canonical_home,
    config::ConfigCoordinator,
    environment::{
        self, FileOutcome, FileRequest, RevealRequest, RevealedValue,
        dotenv::{KeyEdit, is_valid_key},
        launchctl::{self, LaunchctlChange, LaunchctlEnvironment, SetPreview},
        save::{
            CreatePreviewRequest, EditPreviewRequest, EnvironmentEditCoordinator,
            EnvironmentEditPreview,
        },
        scan::{ScanConfig, ScanLimits, ScanOutcome},
        zsh::{self, StartupFile, ZshOverview, ZshRequest, ZshRevealRequest},
        zsh_block::{BlockEdit, MAX_PATH_ITEMS, MAX_VARIABLES, VarEdit},
        zsh_edit::{
            self, ZshEditCoordinator, ZshEditEnabled, ZshEditExecuteRequest, ZshEditExecution,
            ZshEditOutcome, ZshEditPreview, ZshEditPreviewRequest, ZshEditTarget,
        },
    },
    error::AppError,
    grants::{
        ConfirmRequest, GrantCoordinator, GrantId, ResourceWriteContext, ResourceWriteCoordinator,
        ResourceWriteExecution,
    },
    operations::OperationCoordinator,
    settings::SettingsCoordinator,
};

// Every command names an authorization id and a path relative to it; the
// frontend never supplies an absolute path. Directory authorizations are made
// through the existing native picker (`select_directory_grant`).

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScanEnvironmentInput {
    pub grant_id: String,
    pub patterns: Vec<String>,
    pub recursive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadEnvironmentFileInput {
    pub grant_id: String,
    pub relative_path: String,
    pub patterns: Vec<String>,
    pub recursive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevealEnvironmentValueInput {
    pub grant_id: String,
    pub relative_path: String,
    pub patterns: Vec<String>,
    pub recursive: bool,
    pub line: usize,
    pub key: String,
}

impl ReadEnvironmentFileInput {
    fn request(self) -> Result<(GrantId, FileRequest), AppError> {
        Ok((
            GrantId::parse(&self.grant_id)?,
            FileRequest {
                relative_path: self.relative_path,
                config: ScanConfig {
                    patterns: self.patterns,
                    recursive: self.recursive,
                },
            },
        ))
    }
}

pub fn scan_with(
    coordinator: &GrantCoordinator,
    input: ScanEnvironmentInput,
    home: Option<&std::path::Path>,
) -> Result<ScanOutcome, AppError> {
    let id = GrantId::parse(&input.grant_id)?;
    let config = ScanConfig {
        patterns: input.patterns,
        recursive: input.recursive,
    };
    environment::scan_files(coordinator, &id, &config, home)
}

pub fn read_with(
    coordinator: &GrantCoordinator,
    input: ReadEnvironmentFileInput,
) -> Result<FileOutcome, AppError> {
    let (id, request) = input.request()?;
    Ok(environment::read_file(
        coordinator,
        &id,
        &request,
        ScanLimits::default(),
    )?)
}

pub fn reveal_with(
    coordinator: &GrantCoordinator,
    input: RevealEnvironmentValueInput,
) -> Result<RevealedValue, AppError> {
    let id = GrantId::parse(&input.grant_id)?;
    let request = RevealRequest {
        file: FileRequest {
            relative_path: input.relative_path,
            config: ScanConfig {
                patterns: input.patterns,
                recursive: input.recursive,
            },
        },
        line: input.line,
        key: input.key,
    };
    environment::reveal_value(coordinator, &id, &request, ScanLimits::default())
}

#[tauri::command]
pub async fn scan_environment_files(
    app: AppHandle,
    input: ScanEnvironmentInput,
) -> Result<ScanOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_with(
            &app.state::<GrantCoordinator>(),
            input,
            canonical_home().as_deref(),
        )
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn read_environment_file(
    app: AppHandle,
    input: ReadEnvironmentFileInput,
) -> Result<FileOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || read_with(&app.state::<GrantCoordinator>(), input))
        .await
        .map_err(|_| AppError::internal())?
}

/// Returns one value on explicit request (show/copy). The value is never
/// logged and is not part of any list or error.
#[tauri::command]
pub async fn reveal_environment_value(
    app: AppHandle,
    input: RevealEnvironmentValueInput,
) -> Result<RevealedValue, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        reveal_with(&app.state::<GrantCoordinator>(), input)
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Lists the macOS login session environment (`gui/<uid>`) read-only. Secret
/// values are withheld; `reveal_launchctl_value` returns one on request.
#[tauri::command]
pub async fn read_launchctl_environment() -> Result<LaunchctlEnvironment, AppError> {
    tauri::async_runtime::spawn_blocking(|| launchctl::read_environment(OffsetDateTime::now_utc()))
        .await
        .map_err(|_| AppError::internal())?
}

/// Returns one login session value on explicit request. The value is never
/// logged and is not part of any list or error.
#[tauri::command]
pub async fn reveal_launchctl_value(key: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || launchctl::reveal_value(&key))
        .await
        .map_err(|_| AppError::internal())?
}

/// Says what a login session set would change, without changing anything. The
/// value is only checked; the current value is never returned.
#[tauri::command]
pub async fn preview_launchctl_set(key: String, value: String) -> Result<SetPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || launchctl::preview_set(&key, &value))
        .await
        .map_err(|_| AppError::internal())?
}

/// Sets one login session variable. `expected_current` is the digest from the
/// preview; a value changed since then is refused.
#[tauri::command]
pub async fn execute_launchctl_set(
    key: String,
    value: String,
    expected_current: Option<String>,
) -> Result<LaunchctlChange, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        launchctl::set_value(&key, &value, expected_current.as_deref())
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn execute_launchctl_unset(key: String) -> Result<LaunchctlChange, AppError> {
    tauri::async_runtime::spawn_blocking(move || launchctl::unset_value(&key))
        .await
        .map_err(|_| AppError::internal())?
}

// ---- zsh startup files (read-only) ------------------------------------------
//
// The four files are built-in sources: nothing here accepts a path. The only
// optional input is a directory authorization the user chose (through the
// native picker) for a `ZDOTDIR` that cannot be determined statically.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadZshStartupInput {
    #[serde(default)]
    pub zdotdir_grant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevealZshValueInput {
    pub file: StartupFile,
    pub line: usize,
    pub name: String,
    #[serde(default)]
    pub zdotdir_grant_id: Option<String>,
}

fn zsh_request(zdotdir_grant_id: Option<String>) -> Result<ZshRequest, AppError> {
    Ok(ZshRequest {
        zdotdir_grant: zdotdir_grant_id
            .as_deref()
            .map(GrantId::parse)
            .transpose()?,
    })
}

impl ReadZshStartupInput {
    fn request(self) -> Result<ZshRequest, AppError> {
        zsh_request(self.zdotdir_grant_id)
    }
}

impl RevealZshValueInput {
    fn request(self) -> Result<ZshRevealRequest, AppError> {
        if self.line == 0 || !is_valid_key(&self.name) {
            return Err(AppError::invalid_input("The entry reference is invalid."));
        }
        Ok(ZshRevealRequest {
            zsh: zsh_request(self.zdotdir_grant_id)?,
            file: self.file,
            line: self.line,
            name: self.name,
        })
    }
}

pub fn read_zsh_with(
    coordinator: &GrantCoordinator,
    home: Option<&std::path::Path>,
    input: ReadZshStartupInput,
) -> Result<ZshOverview, AppError> {
    Ok(zsh::read_overview(coordinator, home, &input.request()?))
}

pub fn reveal_zsh_with(
    coordinator: &GrantCoordinator,
    home: Option<&std::path::Path>,
    input: RevealZshValueInput,
) -> Result<RevealedValue, AppError> {
    zsh::reveal_value(coordinator, home, &input.request()?)
}

/// Lists the four zsh startup files with their shell types, the documented
/// reading order, the `ZDOTDIR` decision and the statically recognized
/// entries. Never starts a shell or executes a file; secret values are not
/// part of the result.
#[tauri::command]
pub async fn read_zsh_startup_files(
    app: AppHandle,
    input: ReadZshStartupInput,
) -> Result<ZshOverview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        read_zsh_with(
            &app.state::<GrantCoordinator>(),
            canonical_home().as_deref(),
            input,
        )
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Returns one zsh entry's value on explicit request (show/copy). The value is
/// never logged and is not part of any list or error.
#[tauri::command]
pub async fn reveal_zsh_value(
    app: AppHandle,
    input: RevealZshValueInput,
) -> Result<RevealedValue, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        reveal_zsh_with(
            &app.state::<GrantCoordinator>(),
            canonical_home().as_deref(),
            input,
        )
    })
    .await
    .map_err(|_| AppError::internal())?
}

// ---- editing and saving ---------------------------------------------------
//
// Saving goes through preview → confirm. Values travel only from the frontend
// to the backend (never back for secrets), and no input type prints them.

const MAX_EDITS: usize = 64;

#[derive(Deserialize)]
#[serde(
    tag = "op",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum KeyEditInput {
    Add {
        key: String,
        value: String,
        #[serde(default)]
        exported: bool,
    },
    Set {
        key: String,
        value: String,
    },
    Remove {
        key: String,
    },
}

impl From<KeyEditInput> for KeyEdit {
    fn from(input: KeyEditInput) -> Self {
        match input {
            KeyEditInput::Add {
                key,
                value,
                exported,
            } => Self::Add {
                key,
                value,
                exported,
            },
            KeyEditInput::Set { key, value } => Self::Set { key, value },
            KeyEditInput::Remove { key } => Self::Remove { key },
        }
    }
}

// Values may be secrets: show the same redacted form `KeyEdit` does.
impl fmt::Debug for KeyEditInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let edit = match self {
            Self::Add {
                key,
                value,
                exported,
            } => KeyEdit::Add {
                key: key.clone(),
                value: value.clone(),
                exported: *exported,
            },
            Self::Set { key, value } => KeyEdit::Set {
                key: key.clone(),
                value: value.clone(),
            },
            Self::Remove { key } => KeyEdit::Remove { key: key.clone() },
        };
        edit.fmt(formatter)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewEnvironmentEditInput {
    pub grant_id: String,
    pub relative_path: String,
    pub patterns: Vec<String>,
    pub recursive: bool,
    /// Hash of the file content the editor was showing.
    pub expected_hash: String,
    pub edits: Vec<KeyEditInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewEnvironmentCreateInput {
    /// A save-location authorization (`select_save_location_grant`).
    pub grant_id: String,
    pub edits: Vec<KeyEditInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteEnvironmentEditInput {
    pub operation_id: String,
    pub grant_id: String,
    pub relative_path: Option<String>,
}

fn edits(inputs: Vec<KeyEditInput>) -> Result<Vec<KeyEdit>, AppError> {
    if inputs.is_empty() || inputs.len() > MAX_EDITS {
        return Err(AppError::invalid_input("一次保存需要 1 到 64 项改动。"));
    }
    Ok(inputs.into_iter().map(KeyEdit::from).collect())
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn preview_edit_with(
    ctx: &ResourceWriteContext<'_>,
    writes: &ResourceWriteCoordinator,
    coordinator: &EnvironmentEditCoordinator,
    input: PreviewEnvironmentEditInput,
) -> Result<EnvironmentEditPreview, AppError> {
    if !is_sha256_hex(&input.expected_hash) {
        return Err(AppError::invalid_input(
            "The content hash must be a lowercase SHA-256 hex digest.",
        ));
    }
    let request = EditPreviewRequest {
        grant_id: GrantId::parse(&input.grant_id)?,
        file: FileRequest {
            relative_path: input.relative_path,
            config: ScanConfig {
                patterns: input.patterns,
                recursive: input.recursive,
            },
        },
        expected_hash: input.expected_hash,
        edits: edits(input.edits)?,
    };
    coordinator.preview_edit(ctx, writes, &request)
}

pub fn preview_create_with(
    ctx: &ResourceWriteContext<'_>,
    writes: &ResourceWriteCoordinator,
    coordinator: &EnvironmentEditCoordinator,
    input: PreviewEnvironmentCreateInput,
) -> Result<EnvironmentEditPreview, AppError> {
    let request = CreatePreviewRequest {
        grant_id: GrantId::parse(&input.grant_id)?,
        edits: edits(input.edits)?,
    };
    coordinator.preview_create(ctx, writes, &request)
}

pub fn execute_edit_with(
    ctx: &ResourceWriteContext<'_>,
    writes: &ResourceWriteCoordinator,
    coordinator: &EnvironmentEditCoordinator,
    input: ExecuteEnvironmentEditInput,
) -> Result<ResourceWriteExecution, AppError> {
    let request = ConfirmRequest {
        operation_id: input.operation_id,
        grant_id: GrantId::parse(&input.grant_id)?,
        relative: input.relative_path,
    };
    coordinator.execute(ctx, writes, &request)
}

/// Runs `action` with the write context built from the managed state.
fn with_write_context<T>(
    app: &AppHandle,
    action: impl FnOnce(
        &ResourceWriteContext<'_>,
        &ResourceWriteCoordinator,
        &EnvironmentEditCoordinator,
    ) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let grants = app.state::<GrantCoordinator>();
    let operations = app.state::<OperationCoordinator>();
    let writes = app.state::<ResourceWriteCoordinator>();
    let edits = app.state::<EnvironmentEditCoordinator>();
    let config = app.state::<ConfigCoordinator>();
    let settings = app.state::<SettingsCoordinator>();
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    action(&ctx, &writes, &edits)
}

#[tauri::command]
pub async fn preview_environment_edit(
    app: AppHandle,
    input: PreviewEnvironmentEditInput,
) -> Result<EnvironmentEditPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_write_context(&app, |ctx, writes, edits| {
            preview_edit_with(ctx, writes, edits, input)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn preview_environment_create(
    app: AppHandle,
    input: PreviewEnvironmentCreateInput,
) -> Result<EnvironmentEditPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_write_context(&app, |ctx, writes, edits| {
            preview_create_with(ctx, writes, edits, input)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn execute_environment_edit(
    app: AppHandle,
    input: ExecuteEnvironmentEditInput,
) -> Result<ResourceWriteExecution, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_write_context(&app, |ctx, writes, edits| {
            execute_edit_with(ctx, writes, edits, input)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

// ---- zsh managed block (editing) ---------------------------------------------
//
// The four startup files stay built-in sources: no input here carries a path or
// an authorization id for the file. "Enable editing" creates the authorization
// in the backend from the fixed file name and the canonical `$HOME`; preview and
// confirm find it again from the file. Values travel only from the frontend to
// the backend and no input type prints them.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadZshEditStateInput {
    pub file: StartupFile,
    #[serde(default)]
    pub zdotdir_grant_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnableZshEditInput {
    pub file: StartupFile,
    #[serde(default)]
    pub zdotdir_grant_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(
    tag = "op",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ZshVariableEditInput {
    Set { name: String, value: String },
    Remove { name: String },
}

impl From<ZshVariableEditInput> for VarEdit {
    fn from(input: ZshVariableEditInput) -> Self {
        match input {
            ZshVariableEditInput::Set { name, value } => Self::Set { name, value },
            ZshVariableEditInput::Remove { name } => Self::Remove { name },
        }
    }
}

// Values may be secrets: show the same redacted form `VarEdit` does.
impl fmt::Debug for ZshVariableEditInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let edit = match self {
            Self::Set { name, value } => VarEdit::Set {
                name: name.clone(),
                value: value.clone(),
            },
            Self::Remove { name } => VarEdit::Remove { name: name.clone() },
        };
        edit.fmt(formatter)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZshBlockEditInput {
    #[serde(default)]
    pub variables: Vec<ZshVariableEditInput>,
    /// The complete managed PATH list; absent leaves PATH as it is.
    #[serde(default)]
    pub path: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewZshEditInput {
    pub file: StartupFile,
    #[serde(default)]
    pub zdotdir_grant_id: Option<String>,
    /// Hash of the content the editor was showing; `null` for a missing file.
    pub expected_hash: Option<String>,
    pub edit: ZshBlockEditInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteZshEditInput {
    pub operation_id: String,
    pub file: StartupFile,
    #[serde(default)]
    pub zdotdir_grant_id: Option<String>,
}

fn zsh_target(
    file: StartupFile,
    zdotdir_grant_id: Option<String>,
) -> Result<ZshEditTarget, AppError> {
    Ok(ZshEditTarget {
        zsh: zsh_request(zdotdir_grant_id)?,
        file,
    })
}

impl ZshBlockEditInput {
    fn into_edit(self) -> Result<BlockEdit, AppError> {
        if self.variables.len() > MAX_VARIABLES
            || self
                .path
                .as_ref()
                .is_some_and(|path| path.len() > MAX_PATH_ITEMS)
        {
            return Err(AppError::invalid_input("一次保存的变量或 PATH 项过多。"));
        }
        Ok(BlockEdit {
            variables: self.variables.into_iter().map(VarEdit::from).collect(),
            path: self.path,
        })
    }
}

pub fn read_zsh_edit_state_with(
    coordinator: &GrantCoordinator,
    home: Option<&std::path::Path>,
    input: ReadZshEditStateInput,
) -> Result<ZshEditOutcome, AppError> {
    let target = zsh_target(input.file, input.zdotdir_grant_id)?;
    Ok(zsh_edit::read_state(coordinator, home, &target))
}

pub fn enable_zsh_edit_with(
    coordinator: &GrantCoordinator,
    home: Option<&std::path::Path>,
    input: EnableZshEditInput,
) -> Result<ZshEditEnabled, AppError> {
    let target = zsh_target(input.file, input.zdotdir_grant_id)?;
    zsh_edit::enable(coordinator, home, &target)
}

pub fn preview_zsh_edit_with(
    ctx: &ResourceWriteContext<'_>,
    writes: &ResourceWriteCoordinator,
    coordinator: &ZshEditCoordinator,
    home: Option<&std::path::Path>,
    input: PreviewZshEditInput,
) -> Result<ZshEditPreview, AppError> {
    if input
        .expected_hash
        .as_deref()
        .is_some_and(|hash| !is_sha256_hex(hash))
    {
        return Err(AppError::invalid_input(
            "The content hash must be a lowercase SHA-256 hex digest.",
        ));
    }
    let request = ZshEditPreviewRequest {
        target: zsh_target(input.file, input.zdotdir_grant_id)?,
        expected_hash: input.expected_hash,
        edit: input.edit.into_edit()?,
    };
    coordinator.preview(ctx, writes, home, &request)
}

pub fn execute_zsh_edit_with(
    ctx: &ResourceWriteContext<'_>,
    writes: &ResourceWriteCoordinator,
    coordinator: &ZshEditCoordinator,
    home: Option<&std::path::Path>,
    input: ExecuteZshEditInput,
) -> Result<ZshEditExecution, AppError> {
    let request = ZshEditExecuteRequest {
        target: zsh_target(input.file, input.zdotdir_grant_id)?,
        operation_id: input.operation_id,
    };
    coordinator.execute(ctx, writes, home, &request)
}

/// Runs `action` with the write context and the zsh edit coordinator built from
/// the managed state.
fn with_zsh_write_context<T>(
    app: &AppHandle,
    action: impl FnOnce(
        &ResourceWriteContext<'_>,
        &ResourceWriteCoordinator,
        &ZshEditCoordinator,
    ) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let grants = app.state::<GrantCoordinator>();
    let operations = app.state::<OperationCoordinator>();
    let writes = app.state::<ResourceWriteCoordinator>();
    let edits = app.state::<ZshEditCoordinator>();
    let config = app.state::<ConfigCoordinator>();
    let settings = app.state::<SettingsCoordinator>();
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    action(&ctx, &writes, &edits)
}

/// Reads one startup file for editing: the managed block, what the file says
/// outside it and whether editing was enabled. Never starts a shell or runs a
/// file; secret values are not part of the result.
#[tauri::command]
pub async fn read_zsh_edit_state(
    app: AppHandle,
    input: ReadZshEditStateInput,
) -> Result<ZshEditOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        read_zsh_edit_state_with(
            &app.state::<GrantCoordinator>(),
            canonical_home().as_deref(),
            input,
        )
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Creates the authorization for exactly one startup file (revocable like any
/// other). The path is built in the backend; nothing is written.
#[tauri::command]
pub async fn enable_zsh_edit(
    app: AppHandle,
    input: EnableZshEditInput,
) -> Result<ZshEditEnabled, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        enable_zsh_edit_with(
            &app.state::<GrantCoordinator>(),
            canonical_home().as_deref(),
            input,
        )
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn preview_zsh_edit(
    app: AppHandle,
    input: PreviewZshEditInput,
) -> Result<ZshEditPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_zsh_write_context(&app, |ctx, writes, edits| {
            preview_zsh_edit_with(ctx, writes, edits, canonical_home().as_deref(), input)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn execute_zsh_edit(
    app: AppHandle,
    input: ExecuteZshEditInput,
) -> Result<ZshEditExecution, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_zsh_write_context(&app, |ctx, writes, edits| {
            execute_zsh_edit_with(ctx, writes, edits, canonical_home().as_deref(), input)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ExecuteEnvironmentEditInput, KeyEditInput, PreviewEnvironmentCreateInput,
        PreviewEnvironmentEditInput, ReadEnvironmentFileInput, RevealEnvironmentValueInput,
        ScanEnvironmentInput,
    };

    const ID: &str = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";

    #[test]
    fn inputs_carry_an_authorization_id_and_never_an_absolute_root() {
        let scan: Result<ScanEnvironmentInput, _> = serde_json::from_value(json!({
            "grantId": ID, "patterns": [".env"], "recursive": false
        }));
        assert!(scan.is_ok());

        for extra in [
            json!({ "grantId": ID, "patterns": [".env"], "recursive": false, "path": "/Users/x" }),
            json!({ "grantId": ID, "patterns": [".env"] }),
            json!({ "patterns": [".env"], "recursive": false }),
        ] {
            assert!(serde_json::from_value::<ScanEnvironmentInput>(extra).is_err());
        }
        assert!(
            serde_json::from_value::<ReadEnvironmentFileInput>(json!({
                "grantId": ID, "relativePath": ".env", "patterns": [".env"],
                "recursive": false, "root": "/"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<RevealEnvironmentValueInput>(json!({
                "grantId": ID, "relativePath": ".env", "patterns": [".env"],
                "recursive": false, "line": 1, "key": "A"
            }))
            .is_ok()
        );
    }

    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn edit_inputs_name_an_authorization_and_never_an_absolute_path() {
        let edit: Result<PreviewEnvironmentEditInput, _> = serde_json::from_value(json!({
            "grantId": ID, "relativePath": ".env", "patterns": [".env"], "recursive": false,
            "expectedHash": HASH,
            "edits": [
                { "op": "ADD", "key": "A", "value": "1", "exported": true },
                { "op": "SET", "key": "B", "value": "2" },
                { "op": "REMOVE", "key": "C" }
            ]
        }));
        assert_eq!(edit.expect("valid input").edits.len(), 3);
        assert!(
            serde_json::from_value::<PreviewEnvironmentCreateInput>(json!({
                "grantId": ID, "edits": [{ "op": "ADD", "key": "A", "value": "1" }]
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<ExecuteEnvironmentEditInput>(json!({
                "operationId": "op-1", "grantId": ID, "relativePath": null
            }))
            .is_ok()
        );
        for bad in [
            json!({ "grantId": ID, "relativePath": ".env", "patterns": [".env"], "recursive": false,
                    "expectedHash": HASH, "edits": [], "path": "/Users/x/.env" }),
            json!({ "grantId": ID, "relativePath": ".env", "patterns": [".env"], "recursive": false,
                    "edits": [] }),
            json!({ "grantId": ID, "relativePath": ".env", "patterns": [".env"], "recursive": false,
                    "expectedHash": HASH, "edits": [{ "op": "TRUNCATE", "key": "A" }] }),
            json!({ "grantId": ID, "relativePath": ".env", "patterns": [".env"], "recursive": false,
                    "expectedHash": HASH, "edits": [{ "op": "SET", "key": "A" }] }),
            json!({ "grantId": ID, "relativePath": ".env", "patterns": [".env"], "recursive": false,
                    "expectedHash": HASH, "edits": [{ "op": "REMOVE", "key": "A", "value": "x" }] }),
        ] {
            assert!(serde_json::from_value::<PreviewEnvironmentEditInput>(bad).is_err());
        }
        assert!(
            serde_json::from_value::<PreviewEnvironmentCreateInput>(json!({
                "grantId": ID, "edits": [], "absolutePath": "/tmp/x"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ExecuteEnvironmentEditInput>(json!({
                "operationId": "o", "grantId": ID, "path": "/etc/hosts"
            }))
            .is_err()
        );
    }

    #[test]
    fn debug_output_of_edit_inputs_never_contains_a_value() {
        let input: PreviewEnvironmentCreateInput = serde_json::from_value(json!({
            "grantId": ID, "edits": [{ "op": "ADD", "key": "API_TOKEN", "value": "very-secret-value" }]
        }))
        .expect("input");
        let printed = format!("{input:?}");
        assert!(!printed.contains("very-secret-value"), "{printed}");
        assert!(printed.contains("API_TOKEN"));
        let single = KeyEditInput::Set {
            key: "A".to_owned(),
            value: "very-secret-value".to_owned(),
        };
        assert!(!format!("{single:?}").contains("very-secret-value"));
    }

    #[test]
    fn a_save_needs_between_one_and_sixty_four_edits_and_a_real_hash() {
        let one = || KeyEditInput::Remove {
            key: "A".to_owned(),
        };
        assert!(super::edits(vec![]).is_err());
        assert!(super::edits((0..65).map(|_| one()).collect()).is_err());
        assert_eq!(
            super::edits((0..64).map(|_| one()).collect())
                .expect("64")
                .len(),
            64
        );
        assert!(super::is_sha256_hex(HASH));
        for bad in ["", "NOT-A-HASH", &HASH.to_uppercase(), &HASH[1..]] {
            assert!(!super::is_sha256_hex(bad), "{bad}");
        }
    }
    #[test]
    fn zsh_inputs_never_carry_a_path_and_only_name_an_optional_directory_authorization() {
        use super::{ReadZshStartupInput, RevealZshValueInput};

        for ok in [
            json!({}),
            json!({ "zdotdirGrantId": null }),
            json!({ "zdotdirGrantId": ID }),
        ] {
            assert!(serde_json::from_value::<ReadZshStartupInput>(ok).is_ok());
        }
        for bad in [
            json!({ "path": "/Users/x/.zshrc" }),
            json!({ "zdotdirGrantId": ID, "directory": "/Users/x" }),
            json!({ "zdotdir": "/Users/x/.config/zsh" }),
            json!({ "zdotdirGrantId": 7 }),
        ] {
            assert!(serde_json::from_value::<ReadZshStartupInput>(bad).is_err());
        }
        let reveal = |value| serde_json::from_value::<RevealZshValueInput>(value);
        assert!(reveal(json!({ "file": "ZSHRC", "line": 3, "name": "API_TOKEN" })).is_ok());
        assert!(
            reveal(json!({ "file": "ZSHENV", "line": 1, "name": "A", "zdotdirGrantId": ID }))
                .is_ok()
        );
        for bad in [
            json!({ "file": "ZSHRC", "line": 3 }),
            json!({ "file": "ZSHRC", "name": "A" }),
            json!({ "line": 3, "name": "A" }),
            json!({ "file": ".zshrc", "line": 3, "name": "A" }),
            json!({ "file": "ZSHRC", "line": -1, "name": "A" }),
            json!({ "file": "ZSHRC", "line": 3, "name": "A", "path": "/etc/zshrc" }),
        ] {
            assert!(reveal(bad).is_err());
        }
    }

    #[test]
    fn zsh_requests_validate_the_authorization_id_and_the_entry_reference() {
        use super::{ReadZshStartupInput, RevealZshValueInput};
        use crate::error::AppErrorCode;

        let read = |grant: Option<&str>| {
            ReadZshStartupInput {
                zdotdir_grant_id: grant.map(str::to_owned),
            }
            .request()
        };
        assert!(read(None).expect("no choice").zdotdir_grant.is_none());
        assert!(read(Some(ID)).expect("valid id").zdotdir_grant.is_some());
        assert!(read(Some("not-a-grant")).is_err());

        let reveal = |line: usize, name: &str| {
            RevealZshValueInput {
                file: crate::environment::zsh::StartupFile::Zshrc,
                line,
                name: name.to_owned(),
                zdotdir_grant_id: None,
            }
            .request()
        };
        assert!(reveal(1, "API_TOKEN").is_ok());
        for (line, name) in [
            (0, "A"),
            (1, ""),
            (1, "1A"),
            (1, "A B"),
            (1, "A=1"),
            (1, "$(x)"),
        ] {
            let error = reveal(line, name).expect_err("invalid reference");
            assert_eq!(error.code(), AppErrorCode::InvalidInput, "{line} {name:?}");
        }
    }
    #[test]
    fn zsh_edit_inputs_never_carry_a_path_or_a_file_authorization() {
        use super::{
            EnableZshEditInput, ExecuteZshEditInput, PreviewZshEditInput, ReadZshEditStateInput,
        };

        for ok in [
            json!({ "file": "ZSHRC" }),
            json!({ "file": "ZSHENV", "zdotdirGrantId": ID }),
        ] {
            assert!(serde_json::from_value::<ReadZshEditStateInput>(ok.clone()).is_ok());
            assert!(serde_json::from_value::<EnableZshEditInput>(ok).is_ok());
        }
        for bad in [
            json!({ "file": "ZSHRC", "path": "/Users/x/.zshrc" }),
            json!({ "file": "ZSHRC", "grantId": ID }),
            json!({ "file": ".zshrc" }),
            json!({}),
        ] {
            assert!(serde_json::from_value::<ReadZshEditStateInput>(bad.clone()).is_err());
            assert!(serde_json::from_value::<EnableZshEditInput>(bad).is_err());
        }
        let preview = |value| serde_json::from_value::<PreviewZshEditInput>(value);
        assert!(
            preview(json!({
                "file": "ZSHRC", "expectedHash": HASH,
                "edit": {
                    "variables": [
                        { "op": "SET", "name": "A", "value": "1" },
                        { "op": "REMOVE", "name": "B" }
                    ],
                    "path": ["/opt/a", "~/bin"]
                }
            }))
            .is_ok()
        );
        assert!(
            preview(json!({ "file": "ZSHRC", "expectedHash": null, "edit": { "path": [] } }))
                .is_ok()
        );
        for bad in [
            json!({ "file": "ZSHRC", "expectedHash": 7, "edit": {} }),
            json!({ "file": "ZSHRC", "expectedHash": HASH, "edit": { "path": "/a" } }),
            json!({ "file": "ZSHRC", "expectedHash": HASH, "edit": { "variables": [{ "op": "TRUNCATE", "name": "A" }] } }),
            json!({ "file": "ZSHRC", "expectedHash": HASH, "edit": { "variables": [{ "op": "SET", "name": "A" }] } }),
            json!({ "file": "ZSHRC", "expectedHash": HASH, "edit": { "variables": [{ "op": "REMOVE", "name": "A", "value": "x" }] } }),
            json!({ "file": "ZSHRC", "expectedHash": HASH, "edit": { "file": "/etc/zshrc" } }),
            json!({ "file": "ZSHRC", "expectedHash": HASH, "edit": {}, "absolutePath": "/etc/zshrc" }),
        ] {
            assert!(preview(bad).is_err());
        }
        let execute = |value| serde_json::from_value::<ExecuteZshEditInput>(value);
        assert!(execute(json!({ "operationId": "op-1", "file": "ZPROFILE" })).is_ok());
        assert!(
            execute(json!({ "operationId": "op-1", "file": "ZPROFILE", "grantId": ID })).is_err()
        );
        assert!(execute(json!({ "operationId": "op-1" })).is_err());
    }

    #[test]
    fn zsh_edit_requests_validate_the_hash_the_grant_id_and_the_size() {
        use super::{ReadZshEditStateInput, ZshBlockEditInput, ZshVariableEditInput, zsh_target};
        use crate::{environment::zsh::StartupFile, error::AppErrorCode};

        assert!(zsh_target(StartupFile::Zshrc, None).is_ok());
        assert!(zsh_target(StartupFile::Zshrc, Some(ID.to_owned())).is_ok());
        assert!(zsh_target(StartupFile::Zshrc, Some("nope".to_owned())).is_err());
        let _ = ReadZshEditStateInput {
            file: StartupFile::Zshrc,
            zdotdir_grant_id: None,
        };
        let many = |count: usize| ZshBlockEditInput {
            variables: (0..count)
                .map(|index| ZshVariableEditInput::Remove {
                    name: format!("V{index}"),
                })
                .collect(),
            path: None,
        };
        assert!(many(128).into_edit().is_ok());
        let error = many(129).into_edit().expect_err("too many");
        assert_eq!(error.code(), AppErrorCode::InvalidInput);
        let long_path = ZshBlockEditInput {
            variables: Vec::new(),
            path: Some((0..65).map(|index| format!("/p{index}")).collect()),
        };
        assert!(long_path.into_edit().is_err());
    }

    #[test]
    fn debug_output_of_zsh_edit_inputs_never_contains_a_value() {
        use super::{PreviewZshEditInput, ZshVariableEditInput};

        let input: PreviewZshEditInput = serde_json::from_value(json!({
            "file": "ZSHRC", "expectedHash": null,
            "edit": { "variables": [{ "op": "SET", "name": "API_TOKEN", "value": "very-secret-value" }] }
        }))
        .expect("input");
        let printed = format!("{input:?}");
        assert!(!printed.contains("very-secret-value"), "{printed}");
        assert!(printed.contains("API_TOKEN"));
        let single = ZshVariableEditInput::Set {
            name: "A".to_owned(),
            value: "very-secret-value".to_owned(),
        };
        assert!(!format!("{single:?}").contains("very-secret-value"));
    }
}
