//! Saving dotenv edits. Key edits are computed from text (`dotenv::apply_edits`)
//! and then go through the generic preview → confirm → write transaction of
//! `grants::write`: the preview binds the target, the content that was read and
//! the new content; confirming re-checks all of it, backs the file up first,
//! writes atomically and reads the result back. The read-back here is an
//! independent dotenv check (`dotenv::verify_edit`): every changed key must hold
//! the expected value and every other line must be byte for byte unchanged,
//! otherwise the transaction restores the previous content.
//!
//! Secret values never leave this module: the generic diff is always withheld
//! (`sensitive`), the key-level changes carry no text for secret entries, and
//! every secret value is registered with the operation history as a value to
//! mask. A new file is created through a save-location authorization (existing
//! parent + one file name) and is reported as "created, no recovery point".

use std::{collections::HashMap, fs, sync::Mutex};

use serde::Serialize;

use crate::{
    error::AppError,
    grants::{
        ConfirmRequest, GrantId, GrantKind, ResourceWriteContext, ResourceWriteCoordinator,
        ResourceWriteExecution, ResourceWritePreview, WriteRequest,
    },
    operations::OperationStatus,
};

use super::{
    FailureKind, FileRequest, MAX_INLINE_CHARS,
    dotenv::{ChangeKind, EditError, KeyChange, KeyEdit, VerifyError, apply_edits, verify_edit},
    load,
    scan::{FileKind, ScanConfig, ScanLimits, classify_name},
};

/// Previews waiting for a confirmation; the write layer bounds its own list.
const MAX_PENDING_EDITS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditPreviewRequest {
    pub grant_id: GrantId,
    pub file: FileRequest,
    /// Hash of the content the caller was shown; a different file is stale.
    pub expected_hash: String,
    pub edits: Vec<KeyEdit>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatePreviewRequest {
    /// A save-location authorization for a file that does not exist yet.
    pub grant_id: GrantId,
    pub edits: Vec<KeyEdit>,
}

/// One key-level change for the preview. Secret entries never carry text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeView {
    pub key: String,
    pub change: ChangeKind,
    pub secret: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    /// A non-secret value was left out because it is too long to show.
    pub omitted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentEditPreview {
    #[serde(flatten)]
    pub write: ResourceWritePreview,
    pub changes: Vec<ChangeView>,
    /// Template (`.env.example`, …) or real environment file, by name.
    pub file_kind: FileKind,
    /// Whether the default scan patterns would list this name; a name outside
    /// them is allowed but the file will not show up in a default scan.
    pub matches_default_patterns: bool,
}

struct PendingEdit {
    grant_id: GrantId,
    relative: Option<String>,
    original: String,
    changes: Vec<KeyChange>,
}

#[derive(Default)]
pub struct EnvironmentEditCoordinator {
    state: Mutex<HashMap<String, PendingEdit>>,
}

impl EnvironmentEditCoordinator {
    /// Previews edits of an existing file below a directory authorization.
    pub fn preview_edit(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        request: &EditPreviewRequest,
    ) -> Result<EnvironmentEditPreview, AppError> {
        request.file.config.validate()?;
        let loaded = load(
            ctx.grants,
            &request.grant_id,
            &request.file,
            ScanLimits::default(),
        )
        .map_err(FailureKind::app_error)?;
        if loaded.content_hash != request.expected_hash {
            return Err(AppError::conflict(
                "文件在你查看之后已发生变化，请重新加载后再编辑。",
            ));
        }
        let outcome = apply_edits(&loaded.text, &request.edits).map_err(edit_error)?;
        let name = request
            .file
            .relative_path
            .rsplit('/')
            .next()
            .unwrap_or(&request.file.relative_path);
        self.finish(
            ctx,
            writes,
            Prepared {
                write: WriteRequest {
                    grant_id: request.grant_id.clone(),
                    relative: Some(request.file.relative_path.clone()),
                    expected_sha256: Some(loaded.content_hash.clone()),
                    content: outcome.text,
                    sensitive: true,
                },
                original: loaded.text,
                changes: outcome.changes,
                name,
            },
        )
    }

    /// Previews a new file created through its save-location authorization.
    pub fn preview_create(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        request: &CreatePreviewRequest,
    ) -> Result<EnvironmentEditPreview, AppError> {
        let record = ctx.grants.resolve(&request.grant_id)?;
        if record.kind != GrantKind::File {
            return Err(AppError::invalid_input(
                "新建文件需要先通过“选择保存位置”指定目标与文件名。",
            ));
        }
        let Some(name) = record.file_name.as_deref() else {
            return Err(AppError::conflict(
                "该授权指向一个已存在的文件，不能当作新文件创建；请在目录授权中编辑它。",
            ));
        };
        if fs::symlink_metadata(record.target_path()).is_ok() {
            return Err(AppError::conflict(
                "目标文件已经存在，不会被覆盖；请换一个文件名或在目录授权中编辑它。",
            ));
        }
        let outcome = apply_edits("", &request.edits).map_err(edit_error)?;
        self.finish(
            ctx,
            writes,
            Prepared {
                write: WriteRequest {
                    grant_id: request.grant_id.clone(),
                    relative: None,
                    expected_sha256: None,
                    content: outcome.text,
                    sensitive: true,
                },
                original: String::new(),
                changes: outcome.changes,
                name,
            },
        )
    }

    /// Confirms a previewed edit. `Err` means nothing was changed; `Ok` carries
    /// the transaction outcome, which says exactly what the target contains.
    pub fn execute(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        request: &ConfirmRequest,
    ) -> Result<ResourceWriteExecution, AppError> {
        let pending = self
            .state
            .lock()
            .map_err(|_| AppError::internal())?
            .remove(&request.operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        if pending.grant_id != request.grant_id || pending.relative != request.relative {
            // The preview stays usable for the target it was made for.
            self.state
                .lock()
                .map_err(|_| AppError::internal())?
                .insert(request.operation_id.clone(), pending);
            return Err(AppError::operation_mismatch());
        }
        // Whatever happens next consumes the preview.
        writes.execute_with(ctx, request, |written| {
            verify_edit(&pending.original, written, &pending.changes).map_err(verify_error)
        })
    }

    fn finish(
        &self,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        prepared: Prepared<'_>,
    ) -> Result<EnvironmentEditPreview, AppError> {
        let Prepared {
            write,
            original,
            changes,
            name,
        } = prepared;
        if changes.is_empty() {
            return Err(AppError::invalid_input("没有需要保存的改动。"));
        }
        self.prune(ctx)?;
        if self.state.lock().map_err(|_| AppError::internal())?.len() >= MAX_PENDING_EDITS {
            return Err(AppError::conflict(
                "等待确认的预览过多，请先确认或等待过期。",
            ));
        }
        // Anything the history might ever echo is masked, whatever its source.
        ctx.operations.register_sensitive_values(
            changes
                .iter()
                .filter(|change| change.secret)
                .flat_map(|change| [change.before.clone(), change.after.clone()])
                .flatten(),
        )?;
        let (grant_id, relative) = (write.grant_id.clone(), write.relative.clone());
        let step = writes
            .preview(ctx, vec![write])?
            .steps
            .into_iter()
            .next()
            .ok_or_else(AppError::internal)?;
        let views = changes.iter().map(view).collect();
        self.state.lock().map_err(|_| AppError::internal())?.insert(
            step.operation.operation_id.clone(),
            PendingEdit {
                grant_id,
                relative,
                original,
                changes,
            },
        );
        Ok(EnvironmentEditPreview {
            write: step,
            changes: views,
            file_kind: classify_name(name),
            matches_default_patterns: ScanConfig::with_default_patterns(false)
                .admits(name, &ScanLimits::default()),
        })
    }

    /// Drops previews that can no longer be confirmed (expired, consumed).
    fn prune(&self, ctx: &ResourceWriteContext<'_>) -> Result<(), AppError> {
        let mut state = self.state.lock().map_err(|_| AppError::internal())?;
        state.retain(|operation_id, _| {
            ctx.operations
                .get(operation_id)
                .is_ok_and(|details| details.status == OperationStatus::Previewed)
        });
        Ok(())
    }
}

struct Prepared<'a> {
    write: WriteRequest,
    original: String,
    changes: Vec<KeyChange>,
    name: &'a str,
}

fn view(change: &KeyChange) -> ChangeView {
    let shown = |value: &Option<String>| match value {
        Some(text) if !change.secret => {
            if text.chars().count() <= MAX_INLINE_CHARS {
                (Some(text.clone()), false)
            } else {
                (None, true)
            }
        }
        _ => (None, false),
    };
    let (before, before_omitted) = shown(&change.before);
    let (after, after_omitted) = shown(&change.after);
    ChangeView {
        key: change.key.clone(),
        change: change.kind,
        secret: change.secret,
        before,
        after,
        omitted: before_omitted || after_omitted,
    }
}

fn edit_error(error: EditError) -> AppError {
    let message = error.message();
    match error {
        EditError::InvalidKey | EditError::NoEdits | EditError::DuplicateEdit(_) => {
            AppError::invalid_input(&message)
        }
        _ => AppError::validation_failed(&message),
    }
}

fn verify_error(error: VerifyError) -> AppError {
    let detail = match error {
        VerifyError::NotText => "写入的内容不是有效的 UTF-8 文本".to_owned(),
        VerifyError::KeyMissing(key)
        | VerifyError::KeyStillPresent(key)
        | VerifyError::UnexpectedFlags(key)
        | VerifyError::ValueMismatch(key) => format!("键 {key} 读回后与预期不一致"),
        VerifyError::OtherLinesChanged => "其他行的内容发生了变化".to_owned(),
    };
    AppError::validation_failed(&format!("写入后的读回校验未通过（{detail}）。"))
}

#[cfg(test)]
#[path = "save_tests.rs"]
mod save_tests;
