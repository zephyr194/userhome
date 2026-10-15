use serde::Deserialize;
use tauri::State;

use crate::{
    config::ConfigCoordinator,
    error::AppError,
    grants::{
        ConfirmRequest, GrantCoordinator, GrantId, ResourceWriteBatchPreview,
        ResourceWriteBatchStatus, ResourceWriteContext, ResourceWriteCoordinator,
        ResourceWriteExecution, WriteRequest,
    },
    operations::OperationCoordinator,
    settings::SettingsCoordinator,
};

// Writes address an authorization id plus an optional path relative to that
// authorization. No command here accepts an absolute path: the backend decides
// what the authorization covers, the frontend only names it.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceWriteInput {
    pub grant_id: String,
    pub relative_path: Option<String>,
    /// SHA-256 of the content that was read; omitted to create a new file.
    pub expected_hash: Option<String>,
    pub content: String,
    #[serde(default)]
    pub sensitive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewResourceWritesInput {
    pub writes: Vec<ResourceWriteInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteResourceWriteInput {
    pub operation_id: String,
    pub grant_id: String,
    pub relative_path: Option<String>,
}

#[tauri::command]
pub fn preview_resource_writes(
    grants: State<'_, GrantCoordinator>,
    operations: State<'_, OperationCoordinator>,
    writes: State<'_, ResourceWriteCoordinator>,
    config: State<'_, ConfigCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    input: PreviewResourceWritesInput,
) -> Result<ResourceWriteBatchPreview, AppError> {
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    preview(&writes, &ctx, input)
}

#[tauri::command]
pub fn execute_resource_write(
    grants: State<'_, GrantCoordinator>,
    operations: State<'_, OperationCoordinator>,
    writes: State<'_, ResourceWriteCoordinator>,
    config: State<'_, ConfigCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    input: ExecuteResourceWriteInput,
) -> Result<ResourceWriteExecution, AppError> {
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    execute(&writes, &ctx, input)
}

#[tauri::command]
pub fn get_resource_write_batch(
    operations: State<'_, OperationCoordinator>,
    writes: State<'_, ResourceWriteCoordinator>,
    batch_id: String,
) -> Result<ResourceWriteBatchStatus, AppError> {
    writes.batch_status(&operations, &batch_id)
}

fn preview(
    writes: &ResourceWriteCoordinator,
    ctx: &ResourceWriteContext<'_>,
    input: PreviewResourceWritesInput,
) -> Result<ResourceWriteBatchPreview, AppError> {
    let requests = input
        .writes
        .into_iter()
        .map(to_request)
        .collect::<Result<Vec<_>, _>>()?;
    writes.preview(ctx, requests)
}

fn execute(
    writes: &ResourceWriteCoordinator,
    ctx: &ResourceWriteContext<'_>,
    input: ExecuteResourceWriteInput,
) -> Result<ResourceWriteExecution, AppError> {
    let request = ConfirmRequest {
        operation_id: input.operation_id,
        grant_id: GrantId::parse(&input.grant_id)?,
        relative: input.relative_path,
    };
    writes.execute(ctx, &request)
}

fn to_request(input: ResourceWriteInput) -> Result<WriteRequest, AppError> {
    if let Some(hash) = &input.expected_hash
        && !is_sha256_hex(hash)
    {
        return Err(AppError::invalid_input(
            "The content hash must be a lowercase SHA-256 hex digest.",
        ));
    }
    Ok(WriteRequest {
        grant_id: GrantId::parse(&input.grant_id)?,
        relative: input.relative_path,
        expected_sha256: input.expected_hash,
        content: input.content,
        sensitive: input.sensitive,
    })
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use uuid::Uuid;

    use crate::{
        config::{ConfigEnvironment, read::hash_bytes},
        error::AppErrorCode,
        grants::{
            FileState, GrantCoordinator, GrantPurpose, GrantStore, RecoveryPoint,
            ResourceWriteContext, ResourceWriteCoordinator, WriteKind, WriteStatus,
        },
        operations::OperationCoordinator,
        settings::BackupRetention,
    };

    use super::{
        ExecuteResourceWriteInput, PreviewResourceWritesInput, ResourceWriteInput, execute, preview,
    };

    #[test]
    fn resources_inputs_reject_unknown_fields_and_absolute_path_fields() {
        let valid: ResourceWriteInput = serde_json::from_str(
            r#"{"grantId":"a","relativePath":"x.toml","expectedHash":null,"content":"c"}"#,
        )
        .expect("known fields");
        assert!(!valid.sensitive);
        for payload in [
            r#"{"grantId":"a","content":"c","path":"/etc/hosts"}"#,
            r#"{"grantId":"a","content":"c","absolutePath":"/etc/hosts"}"#,
            r#"{"grantId":"a","content":"c","target":"/etc/hosts"}"#,
            r#"{"path":"/etc/hosts","content":"c"}"#,
        ] {
            assert!(
                serde_json::from_str::<ResourceWriteInput>(payload).is_err(),
                "{payload}"
            );
        }
        assert!(
            serde_json::from_str::<PreviewResourceWritesInput>(r#"{"writes":[],"force":true}"#)
                .is_err()
        );
        assert!(
            serde_json::from_str::<ExecuteResourceWriteInput>(
                r#"{"operationId":"o","grantId":"a","path":"/etc/hosts"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn resources_preview_rejects_malformed_ids_hashes_and_paths_before_touching_files() {
        let fixture = Fixture::new();
        let write = |grant_id: &str, relative: Option<&str>, hash: Option<&str>| {
            let input = PreviewResourceWritesInput {
                writes: vec![ResourceWriteInput {
                    grant_id: grant_id.to_owned(),
                    relative_path: relative.map(str::to_owned),
                    expected_hash: hash.map(str::to_owned),
                    content: "x = 2\n".to_owned(),
                    sensitive: false,
                }],
            };
            preview(&fixture.writes, &fixture.context(), input)
        };

        assert!(write("../etc", Some("a.toml"), None).is_err());
        let valid_id = fixture.grant.id.as_str();
        assert_eq!(
            write(valid_id, Some("a.toml"), Some("NOT-A-HASH"))
                .expect_err("bad hash")
                .code(),
            AppErrorCode::InvalidInput
        );
        for relative in ["/etc/hosts", "../outside.toml", "a/../../b.toml", ""] {
            assert_eq!(
                write(valid_id, Some(relative), None)
                    .expect_err("unsafe relative path")
                    .code(),
                AppErrorCode::InvalidInput,
                "{relative}"
            );
        }
        assert_eq!(
            write(valid_id, None, None)
                .expect_err("directory grant needs a relative path")
                .code(),
            AppErrorCode::InvalidInput
        );
    }

    #[test]
    fn resources_commands_write_through_preview_and_confirmation_with_a_backup() {
        let fixture = Fixture::new();
        let file = fixture.project.join("settings.toml");
        fs::write(&file, "x = 1\n").expect("seed file");
        let hash = hash_bytes(b"x = 1\n");

        let batch = preview(
            &fixture.writes,
            &fixture.context(),
            PreviewResourceWritesInput {
                writes: vec![
                    ResourceWriteInput {
                        grant_id: fixture.grant.id.as_str().to_owned(),
                        relative_path: Some("settings.toml".to_owned()),
                        expected_hash: Some(hash.clone()),
                        content: "x = 2\n".to_owned(),
                        sensitive: false,
                    },
                    ResourceWriteInput {
                        grant_id: fixture.grant.id.as_str().to_owned(),
                        relative_path: Some("new.toml".to_owned()),
                        expected_hash: None,
                        content: "y = 1\n".to_owned(),
                        sensitive: false,
                    },
                ],
            },
        )
        .expect("preview batch");
        assert!(!batch.atomic);
        assert_eq!(batch.steps[0].kind, WriteKind::Replace);
        assert_eq!(batch.steps[0].recovery_point, RecoveryPoint::Backup);
        assert_eq!(batch.steps[1].kind, WriteKind::Create);
        assert_eq!(batch.steps[1].recovery_point, RecoveryPoint::NoneCreated);
        let json = serde_json::to_string(&batch).expect("serialize");
        assert!(!json.contains(fixture.root.to_str().expect("utf8 root")));
        assert_eq!(fs::read_to_string(&file).expect("untouched"), "x = 1\n");

        for (step, relative) in batch.steps.iter().zip(["settings.toml", "new.toml"]) {
            let execution = execute(
                &fixture.writes,
                &fixture.context(),
                ExecuteResourceWriteInput {
                    operation_id: step.operation.operation_id.clone(),
                    grant_id: fixture.grant.id.as_str().to_owned(),
                    relative_path: Some(relative.to_owned()),
                },
            )
            .expect("execute step");
            assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
            assert_eq!(execution.outcome.file_state, FileState::Written);
        }
        assert_eq!(fs::read_to_string(&file).expect("written"), "x = 2\n");
        assert_eq!(
            fs::read_to_string(fixture.project.join("new.toml")).expect("created"),
            "y = 1\n"
        );
    }

    struct Fixture {
        root: PathBuf,
        project: PathBuf,
        environment: ConfigEnvironment,
        grants: GrantCoordinator,
        operations: OperationCoordinator,
        writes: ResourceWriteCoordinator,
        grant: crate::grants::GrantRecord,
    }

    impl Fixture {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("canonical temp dir")
                .join(format!("userhome-resource-commands-{}", Uuid::new_v4()));
            let home = root.join("home");
            let project = home.join("project");
            fs::create_dir_all(&project).expect("create project");
            let environment =
                ConfigEnvironment::new(home.clone(), root.join("brew"), home.join("backups"));
            let grants =
                GrantCoordinator::new(GrantStore::new(root.join("support")), Some(home.clone()));
            let grant = grants
                .create(GrantPurpose::ConfigDirectory, &project)
                .expect("create grant");
            Self {
                root,
                project,
                environment,
                grants,
                operations: OperationCoordinator::default(),
                writes: ResourceWriteCoordinator::default(),
                grant,
            }
        }

        fn context(&self) -> ResourceWriteContext<'_> {
            ResourceWriteContext {
                grants: &self.grants,
                operations: &self.operations,
                environment: &self.environment,
                retention: BackupRetention::FIVE,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
