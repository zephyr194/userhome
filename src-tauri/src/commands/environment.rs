use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::{
    commands::grants::canonical_home,
    environment::{
        self, FileOutcome, FileRequest, RevealRequest, RevealedValue,
        scan::{ScanConfig, ScanLimits, ScanOutcome},
    },
    error::AppError,
    grants::{GrantCoordinator, GrantId},
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{ReadEnvironmentFileInput, RevealEnvironmentValueInput, ScanEnvironmentInput};

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
}
