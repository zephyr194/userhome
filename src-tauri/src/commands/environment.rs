use std::fmt;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::{
    commands::grants::canonical_home,
    config::ConfigCoordinator,
    environment::{
        self, FileOutcome, FileRequest, RevealRequest, RevealedValue,
        dotenv::KeyEdit,
        save::{
            CreatePreviewRequest, EditPreviewRequest, EnvironmentEditCoordinator,
            EnvironmentEditPreview,
        },
        scan::{ScanConfig, ScanLimits, ScanOutcome},
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
}
