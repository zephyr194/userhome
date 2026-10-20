//! Preview → confirm → write transactions for authorized resources.
//!
//! A preview binds the resource (authorization id and relative path), the
//! content fingerprint that was read, the proposed content and its diff.
//! Confirming re-resolves the authorization and the target, compares the
//! fingerprint again, and only then runs the transaction: protected backup →
//! atomic replace → verification → restore on failure. A resource that does
//! not exist yet is created without a backup and is reported as "create, no
//! recovery point"; nothing here ever fabricates a restore point.
//!
//! Several files are written one at a time, in order, each with its own
//! preview and confirmation. A batch is a progress record, not an atomic
//! transaction: files that were written stay written and are reported as such.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::Mutex,
};

use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    config::{
        ConfigEnvironment,
        atomic::{
            AtomicReplaceError, atomic_create_new, atomic_replace,
            restore_backup_after_commit_failure, sync_directory,
        },
        backup::create_backup,
        diff::{ConfigDiff, build_diff},
        read::hash_bytes,
    },
    error::{AppError, AppErrorCode},
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
        OperationStatus,
    },
    security::paths::is_safe_catalog_relative_path,
    settings::BackupRetention,
};

use super::{
    ContentFingerprint, DEFAULT_MAX_READ_BYTES, GrantAccess, GrantCoordinator, GrantError, GrantId,
    GrantKind, ReadError, display_path, new_file, path,
};

pub const MAX_PENDING_WRITES: usize = 64;
pub const MAX_BATCH_STEPS: usize = 16;
const MAX_BATCHES: usize = 32;
const MAX_WRITE_BYTES: usize = DEFAULT_MAX_READ_BYTES;
const BACKUP_APP_ID: &str = "grants";
// New files may hold secrets, so they start owner-only.
const NEW_FILE_MODE: u32 = 0o600;
const NOT_ATOMIC_NOTE: &str =
    "Files are written one at a time, in order. A batch is not an atomic transaction.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WriteKind {
    Replace,
    Create,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecoveryPoint {
    /// A protected backup of the previous content exists.
    Backup,
    /// The file is new: there was no previous content, so no recovery point.
    NoneCreated,
    /// The backup could not be created, so nothing was written.
    NoneUnavailable,
}

/// What is known about the target after the transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FileState {
    Written,
    Unchanged,
    /// Verification failed and the previous content was restored and checked.
    Restored,
    /// Verification failed and the previous content could not be restored.
    RestoreFailed,
    /// A new file failed verification and was removed again.
    CreatedRemoved,
    /// A new file failed verification and could not be removed.
    CreatedRemoveFailed,
    /// The transaction could not establish what the target contains.
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WriteStatus {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub kind: WriteKind,
    pub status: WriteStatus,
    pub file_state: FileState,
    pub recovery_point: RecoveryPoint,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backup_id: Option<String>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteRequest {
    pub grant_id: GrantId,
    pub relative: Option<String>,
    /// SHA-256 of the content the caller read; `None` asks to create the file.
    pub expected_sha256: Option<String>,
    pub content: String,
    /// Redacts the diff in the preview.
    pub sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmRequest {
    pub operation_id: String,
    pub grant_id: GrantId,
    pub relative: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWritePreview {
    #[serde(flatten)]
    pub operation: OperationPreview,
    pub kind: WriteKind,
    pub recovery_point: RecoveryPoint,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
    pub proposed_hash: String,
    pub diff: ConfigDiff,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWriteBatchPreview {
    pub batch_id: String,
    pub atomic: bool,
    pub note: &'static str,
    pub steps: Vec<ResourceWritePreview>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StepState {
    Pending,
    Succeeded,
    Failed,
    /// The confirmation was refused before anything was written.
    Rejected,
    /// An earlier step has not succeeded, so this one cannot be confirmed.
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchStepStatus {
    pub index: usize,
    pub operation_id: String,
    pub target: String,
    pub kind: WriteKind,
    pub state: StepState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<WriteOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWriteBatchStatus {
    pub batch_id: String,
    pub atomic: bool,
    pub note: &'static str,
    pub completed: usize,
    pub total: usize,
    pub steps: Vec<BatchStepStatus>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWriteExecution {
    #[serde(flatten)]
    pub operation: OperationDetails,
    pub outcome: WriteOutcome,
}

pub struct ResourceWriteContext<'a> {
    pub grants: &'a GrantCoordinator,
    pub operations: &'a OperationCoordinator,
    pub environment: &'a ConfigEnvironment,
    pub retention: BackupRetention,
}

#[derive(Debug, Clone)]
struct BatchSlot {
    batch_id: String,
    index: usize,
}

#[derive(Debug, Clone)]
struct PendingResourceWrite {
    /// Which kind of entry created the preview; only the same kind confirms it.
    access: GrantAccess,
    grant_id: GrantId,
    relative: Option<String>,
    target_path: PathBuf,
    kind: WriteKind,
    fingerprint: Option<ContentFingerprint>,
    content: String,
    proposed_hash: String,
    batch: Option<BatchSlot>,
}

#[derive(Debug, Clone)]
struct BatchStep {
    operation_id: String,
    target: String,
    kind: WriteKind,
    state: StepState,
    outcome: Option<WriteOutcome>,
    error: Option<AppError>,
}

struct BatchRecord {
    access: GrantAccess,
    steps: Vec<BatchStep>,
}

#[derive(Default)]
struct State {
    pending: HashMap<String, PendingResourceWrite>,
    batches: HashMap<String, BatchRecord>,
    batch_order: Vec<String>,
}

#[derive(Default)]
pub struct ResourceWriteCoordinator {
    state: Mutex<State>,
}

impl ResourceWriteCoordinator {
    /// Previews one or more writes. Every step gets its own operation and its
    /// own confirmation; the batch only records order and progress. This is
    /// the general entry: a shell startup file grant is refused here.
    pub fn preview(
        &self,
        ctx: &ResourceWriteContext<'_>,
        requests: Vec<WriteRequest>,
    ) -> Result<ResourceWriteBatchPreview, AppError> {
        self.preview_with(ctx, requests, GrantAccess::General)
    }

    /// The dedicated entry of the shell startup editor: only shell startup
    /// file grants are accepted. Not reachable from any command that takes a
    /// grant id from the frontend.
    pub fn preview_shell_startup(
        &self,
        ctx: &ResourceWriteContext<'_>,
        requests: Vec<WriteRequest>,
    ) -> Result<ResourceWriteBatchPreview, AppError> {
        self.preview_with(ctx, requests, GrantAccess::ShellStartup)
    }

    fn preview_with(
        &self,
        ctx: &ResourceWriteContext<'_>,
        requests: Vec<WriteRequest>,
        access: GrantAccess,
    ) -> Result<ResourceWriteBatchPreview, AppError> {
        if requests.is_empty() || requests.len() > MAX_BATCH_STEPS {
            return Err(AppError::invalid_input(
                "A write batch must contain between 1 and 16 resources.",
            ));
        }
        let mut seen = BTreeSet::new();
        for request in &requests {
            if !seen.insert((
                request.grant_id.as_str().to_owned(),
                request.relative.clone(),
            )) {
                return Err(AppError::invalid_input(
                    "A write batch cannot target the same resource twice.",
                ));
            }
        }
        self.prune(ctx.operations)?;
        {
            let state = self.state.lock().map_err(|_| AppError::internal())?;
            if state.pending.len() + requests.len() > MAX_PENDING_WRITES {
                return Err(AppError::conflict(
                    "Too many resource previews are pending.",
                ));
            }
        }

        let batch_id = Uuid::new_v4().to_string();
        let mut created: Vec<(String, PendingResourceWrite)> = Vec::new();
        let mut previews = Vec::new();
        for (index, request) in requests.iter().enumerate() {
            match prepare_step(ctx, request, access, &batch_id, index) {
                Ok((pending, preview)) => {
                    created.push((preview.operation.operation_id.clone(), pending));
                    previews.push(preview);
                }
                Err(error) => {
                    for (operation_id, _) in &created {
                        let _ = ctx.operations.cancel(operation_id);
                    }
                    return Err(error);
                }
            }
        }

        let mut state = self.state.lock().map_err(|_| AppError::internal())?;
        let steps = previews
            .iter()
            .zip(&created)
            .map(|(preview, (_, pending))| BatchStep {
                operation_id: preview.operation.operation_id.clone(),
                target: preview.target.clone(),
                kind: pending.kind,
                state: StepState::Pending,
                outcome: None,
                error: None,
            })
            .collect();
        for (operation_id, pending) in created {
            state.pending.insert(operation_id, pending);
        }
        if state.batch_order.len() >= MAX_BATCHES {
            let oldest = state.batch_order.remove(0);
            state.batches.remove(&oldest);
        }
        state.batch_order.push(batch_id.clone());
        state
            .batches
            .insert(batch_id.clone(), BatchRecord { access, steps });
        Ok(ResourceWriteBatchPreview {
            batch_id,
            atomic: false,
            note: NOT_ATOMIC_NOTE,
            steps: previews,
        })
    }

    /// Confirms one previewed step. `Err` means the confirmation was refused
    /// before anything was changed; `Ok` means the transaction ran and the
    /// outcome says exactly what state the target is in.
    pub fn execute(
        &self,
        ctx: &ResourceWriteContext<'_>,
        request: &ConfirmRequest,
    ) -> Result<ResourceWriteExecution, AppError> {
        self.execute_with(ctx, request, |_| Ok(()))
    }

    /// Like `execute`, with a caller-supplied read-back check that runs on the
    /// written bytes after the default text validation, so it can only tighten
    /// it; a failing check restores the previous content. General entry: a
    /// preview made for a shell startup file is refused here.
    pub fn execute_with<F>(
        &self,
        ctx: &ResourceWriteContext<'_>,
        request: &ConfirmRequest,
        post_validate: F,
    ) -> Result<ResourceWriteExecution, AppError>
    where
        F: FnOnce(&[u8]) -> Result<(), AppError>,
    {
        self.execute_inner(ctx, request, GrantAccess::General, post_validate)
    }

    /// Confirms a preview made by `preview_shell_startup`, with the editor's
    /// own read-back check (after the default text validation).
    pub fn execute_shell_startup<F>(
        &self,
        ctx: &ResourceWriteContext<'_>,
        request: &ConfirmRequest,
        post_validate: F,
    ) -> Result<ResourceWriteExecution, AppError>
    where
        F: FnOnce(&[u8]) -> Result<(), AppError>,
    {
        self.execute_inner(ctx, request, GrantAccess::ShellStartup, post_validate)
    }

    fn execute_inner<F>(
        &self,
        ctx: &ResourceWriteContext<'_>,
        request: &ConfirmRequest,
        access: GrantAccess,
        post_validate: F,
    ) -> Result<ResourceWriteExecution, AppError>
    where
        F: FnOnce(&[u8]) -> Result<(), AppError>,
    {
        let pending = {
            let state = self.state.lock().map_err(|_| AppError::internal())?;
            let pending = state
                .pending
                .get(&request.operation_id)
                .cloned()
                .ok_or_else(AppError::operation_not_found)?;
            // A preview is only confirmed by the kind of entry that made it;
            // the refusal leaves it pending.
            if pending.access != access {
                return Err(GrantError::ReservedPurpose.into());
            }
            // A confirmation is only valid for the target that was previewed.
            if pending.grant_id != request.grant_id || pending.relative != request.relative {
                return Err(AppError::operation_mismatch());
            }
            if let Some(slot) = &pending.batch {
                let record = state
                    .batches
                    .get(&slot.batch_id)
                    .ok_or_else(AppError::operation_not_found)?;
                if record.steps[..slot.index]
                    .iter()
                    .any(|step| step.state != StepState::Succeeded)
                {
                    return Err(AppError::conflict(
                        "An earlier step in this batch has not completed; confirm steps in order.",
                    ));
                }
            }
            pending
        };

        if let Err(error) = ctx
            .operations
            .authorize_mutation(&request.operation_id, &intent_for(&pending))
        {
            if error.code() == AppErrorCode::Timeout {
                self.settle(
                    &request.operation_id,
                    &pending,
                    StepState::Rejected,
                    None,
                    Some(&error),
                );
            }
            return Err(error);
        }
        // The preview is consumed from here on, whatever the result.
        ctx.operations.record_progress(
            &request.operation_id,
            "Re-checking authorization and content.",
        )?;

        match run_transaction(ctx, &pending, with_default_validation(post_validate)) {
            Err(error) => {
                ctx.operations
                    .finish_failure(&request.operation_id, error.clone())?;
                self.settle(
                    &request.operation_id,
                    &pending,
                    StepState::Rejected,
                    None,
                    Some(&error),
                );
                Err(error)
            }
            Ok(outcome) => {
                match (&outcome.status, &outcome.error) {
                    (WriteStatus::Succeeded, _) => {
                        ctx.operations.finish_success_with_output(
                            &request.operation_id,
                            Some(&outcome.summary),
                            None,
                        )?;
                    }
                    (WriteStatus::Failed, error) => {
                        ctx.operations.finish_failure_with_output(
                            &request.operation_id,
                            error.clone().unwrap_or_else(AppError::internal),
                            Some(&outcome.summary),
                            None,
                        )?;
                    }
                }
                let state = match outcome.status {
                    WriteStatus::Succeeded => StepState::Succeeded,
                    WriteStatus::Failed => StepState::Failed,
                };
                self.settle(&request.operation_id, &pending, state, Some(&outcome), None);
                Ok(ResourceWriteExecution {
                    operation: ctx.operations.get(&request.operation_id)?,
                    outcome,
                })
            }
        }
    }

    pub fn batch_status(
        &self,
        operations: &OperationCoordinator,
        batch_id: &str,
    ) -> Result<ResourceWriteBatchStatus, AppError> {
        let state = self.state.lock().map_err(|_| AppError::internal())?;
        let record = state
            .batches
            .get(batch_id)
            .ok_or_else(|| AppError::not_found("The write batch was not found."))?;
        if record.access != GrantAccess::General {
            return Err(GrantError::ReservedPurpose.into());
        }
        let mut blocked = false;
        let mut steps = Vec::with_capacity(record.steps.len());
        for (index, step) in record.steps.iter().enumerate() {
            let mut current = step.state;
            if current == StepState::Pending {
                let still_previewed = operations
                    .get(&step.operation_id)
                    .is_ok_and(|details| details.status == OperationStatus::Previewed);
                if !still_previewed {
                    // Expired or cancelled before it could be confirmed.
                    current = StepState::Rejected;
                } else if blocked {
                    current = StepState::Blocked;
                }
            }
            if current != StepState::Succeeded {
                blocked = true;
            }
            steps.push(BatchStepStatus {
                index,
                operation_id: step.operation_id.clone(),
                target: step.target.clone(),
                kind: step.kind,
                state: current,
                outcome: step.outcome.clone(),
                error: step.error.clone(),
            });
        }
        let completed = steps
            .iter()
            .filter(|step| step.state == StepState::Succeeded)
            .count();
        Ok(ResourceWriteBatchStatus {
            batch_id: batch_id.to_owned(),
            atomic: false,
            note: NOT_ATOMIC_NOTE,
            completed,
            total: steps.len(),
            steps,
        })
    }

    fn settle(
        &self,
        operation_id: &str,
        pending: &PendingResourceWrite,
        state: StepState,
        outcome: Option<&WriteOutcome>,
        error: Option<&AppError>,
    ) {
        let Ok(mut guard) = self.state.lock() else {
            return;
        };
        guard.pending.remove(operation_id);
        if let Some(slot) = &pending.batch
            && let Some(step) = guard
                .batches
                .get_mut(&slot.batch_id)
                .and_then(|record| record.steps.get_mut(slot.index))
        {
            step.state = state;
            step.outcome = outcome.cloned();
            step.error = error
                .cloned()
                .or_else(|| outcome.and_then(|o| o.error.clone()));
        }
    }

    /// Drops pending writes whose preview can no longer be confirmed.
    fn prune(&self, operations: &OperationCoordinator) -> Result<(), AppError> {
        let mut state = self.state.lock().map_err(|_| AppError::internal())?;
        state.pending.retain(|operation_id, _| {
            operations
                .get(operation_id)
                .is_ok_and(|details| details.status == OperationStatus::Previewed)
        });
        Ok(())
    }
}

struct Target {
    path: PathBuf,
    exists: bool,
    display: String,
}

fn prepare_step(
    ctx: &ResourceWriteContext<'_>,
    request: &WriteRequest,
    access: GrantAccess,
    batch_id: &str,
    index: usize,
) -> Result<(PendingResourceWrite, ResourceWritePreview), AppError> {
    if request.content.len() > MAX_WRITE_BYTES {
        return Err(AppError::validation_failed(
            "The proposed content exceeds the size limit.",
        ));
    }
    validate_text(request.content.as_bytes())?;
    let target = resolve_target(ctx, &request.grant_id, request.relative.as_deref(), access)?;

    let (kind, fingerprint, current_text) = match (target.exists, &request.expected_sha256) {
        (true, Some(expected)) => {
            let read = ctx
                .grants
                .read_with_access(
                    &request.grant_id,
                    request.relative.as_deref(),
                    MAX_WRITE_BYTES,
                    access,
                )
                .map_err(read_error)?;
            if &read.fingerprint.sha256 != expected {
                return Err(stale_error());
            }
            let text = read
                .text()
                .map_err(|_| {
                    AppError::validation_failed("The current content is not valid UTF-8 text.")
                })?
                .to_owned();
            (WriteKind::Replace, Some(read.fingerprint), text)
        }
        (true, None) => {
            return Err(AppError::conflict(
                "The resource already exists; read it first and send its content hash.",
            ));
        }
        (false, Some(_)) => {
            return Err(AppError::conflict(
                "The resource no longer exists; preview again to create it.",
            ));
        }
        (false, None) => (WriteKind::Create, None, String::new()),
    };

    let proposed_hash = hash_bytes(request.content.as_bytes());
    let current_hash = fingerprint.as_ref().map(|f| f.sha256.clone());
    let pending = PendingResourceWrite {
        access,
        grant_id: request.grant_id.clone(),
        relative: request.relative.clone(),
        target_path: target.path.clone(),
        kind,
        fingerprint,
        content: request.content.clone(),
        proposed_hash: proposed_hash.clone(),
        batch: Some(BatchSlot {
            batch_id: batch_id.to_owned(),
            index,
        }),
    };
    let diff = build_diff(
        &current_text,
        &request.content,
        if request.sensitive {
            "SENSITIVE"
        } else {
            "STANDARD"
        },
    );
    let (summary, recovery_point, backup_effect) = match kind {
        WriteKind::Replace => (
            format!("Replace {}.", target.display),
            RecoveryPoint::Backup,
            "Back up the current file (owner-only), then replace it atomically.",
        ),
        WriteKind::Create => (
            format!("Create {}.", target.display),
            RecoveryPoint::NoneCreated,
            "Create the file. It does not exist yet, so there is no recovery point.",
        ),
    };
    let operation = ctx.operations.preview(
        intent_for(&pending),
        &summary,
        vec![
            format!("Target: {}", target.display),
            backup_effect.to_owned(),
            "Verify the written file; restore the backup if verification fails.".to_owned(),
        ],
        false,
    )?;
    let preview = ResourceWritePreview {
        operation,
        kind,
        recovery_point,
        target: target.display,
        current_hash,
        proposed_hash,
        diff,
    };
    Ok((pending, preview))
}

fn intent_for(pending: &PendingResourceWrite) -> OperationIntent {
    OperationIntent::new(
        OperationKind::ResourceWrite,
        format!(
            "{}:{}",
            pending.grant_id.as_str(),
            pending.relative.as_deref().unwrap_or("")
        ),
        BTreeMap::from([
            (
                "currentHash".to_owned(),
                pending
                    .fingerprint
                    .as_ref()
                    .map_or_else(|| "none".to_owned(), |f| f.sha256.clone()),
            ),
            ("proposedHash".to_owned(), pending.proposed_hash.clone()),
            (
                "kind".to_owned(),
                match pending.kind {
                    WriteKind::Replace => "replace",
                    WriteKind::Create => "create",
                }
                .to_owned(),
            ),
        ]),
    )
}

/// Resolves the write target below a live authorization. An existing target
/// must be a regular file inside the root; a missing one is accepted only when
/// its parent already exists inside the root (directories are never created).
fn resolve_target(
    ctx: &ResourceWriteContext<'_>,
    grant_id: &GrantId,
    relative: Option<&str>,
    access: GrantAccess,
) -> Result<Target, AppError> {
    let record = ctx.grants.resolve_with(grant_id, access)?;
    let home = Some(ctx.environment.home());
    match (record.kind, relative) {
        (GrantKind::File, None) => {
            let path = record.target_path();
            Ok(Target {
                display: display_path(&path, home),
                exists: new_file::target_exists(&record),
                path,
            })
        }
        (GrantKind::File, Some(_)) => Err(GrantError::InvalidRelativePath.into()),
        (GrantKind::Directory, None) => Err(AppError::invalid_input(
            "A relative path is required for a directory authorization.",
        )),
        (GrantKind::Directory, Some(relative)) => {
            if !is_safe_catalog_relative_path(relative) {
                return Err(GrantError::InvalidRelativePath.into());
            }
            let display = format!("{}/{relative}", display_path(&record.path, home));
            if fs::symlink_metadata(record.path.join(relative)).is_ok() {
                let resolved =
                    path::resolve_within(&record.path, relative, ctx.grants.home.as_deref())?;
                return Ok(Target {
                    path: resolved,
                    exists: true,
                    display,
                });
            }
            let (parent, name) = match relative.rsplit_once('/') {
                Some((parent, name)) => (
                    path::resolve_within(&record.path, parent, ctx.grants.home.as_deref())?,
                    name,
                ),
                None => (record.path.clone(), relative),
            };
            if !fs::metadata(&parent).is_ok_and(|metadata| metadata.is_dir()) {
                return Err(AppError::not_found("The parent directory does not exist."));
            }
            Ok(Target {
                path: parent.join(name),
                exists: false,
                display,
            })
        }
    }
}

/// Re-validates everything the preview relied on. Any difference means the
/// preview no longer describes reality and the caller must preview again.
fn recheck(
    ctx: &ResourceWriteContext<'_>,
    pending: &PendingResourceWrite,
) -> Result<Option<Vec<u8>>, AppError> {
    let target = resolve_target(
        ctx,
        &pending.grant_id,
        pending.relative.as_deref(),
        pending.access,
    )
    .map_err(|error| match error.code() {
        AppErrorCode::NotFound | AppErrorCode::PermissionDenied => {
            AppError::conflict("The authorization or target is no longer available; preview again.")
        }
        _ => error,
    })?;
    if target.path != pending.target_path {
        return Err(AppError::conflict(
            "The write target no longer matches the preview; preview again.",
        ));
    }
    match pending.kind {
        WriteKind::Create => {
            if target.exists {
                return Err(AppError::conflict(
                    "The file was created after the preview; preview again.",
                ));
            }
            Ok(None)
        }
        WriteKind::Replace => {
            let expected = pending
                .fingerprint
                .as_ref()
                .ok_or_else(AppError::internal)?;
            let read = ctx
                .grants
                .read_with_access(
                    &pending.grant_id,
                    pending.relative.as_deref(),
                    MAX_WRITE_BYTES,
                    pending.access,
                )
                .map_err(read_error)?;
            if &read.fingerprint != expected {
                return Err(stale_error());
            }
            Ok(Some(read.content))
        }
    }
}

fn run_transaction<F>(
    ctx: &ResourceWriteContext<'_>,
    pending: &PendingResourceWrite,
    post_validate: F,
) -> Result<WriteOutcome, AppError>
where
    F: FnOnce(&[u8]) -> Result<(), AppError>,
{
    let current = recheck(ctx, pending)?;
    Ok(match current {
        Some(current) => replace(ctx, pending, &current, post_validate),
        None => create(pending, post_validate),
    })
}

fn replace<F>(
    ctx: &ResourceWriteContext<'_>,
    pending: &PendingResourceWrite,
    current: &[u8],
    post_validate: F,
) -> WriteOutcome
where
    F: FnOnce(&[u8]) -> Result<(), AppError>,
{
    let target = pending.target_path.as_path();
    let expected_hash = pending
        .fingerprint
        .as_ref()
        .map_or("", |fingerprint| fingerprint.sha256.as_str());
    let outcome =
        |status, file_state, recovery_point, backup_id: Option<String>, summary: &str, error| {
            WriteOutcome {
                kind: WriteKind::Replace,
                status,
                file_state,
                recovery_point,
                backup_id,
                summary: summary.to_owned(),
                error,
            }
        };

    let Ok(metadata) = fs::metadata(target) else {
        return outcome(
            WriteStatus::Failed,
            FileState::Unchanged,
            RecoveryPoint::NoneUnavailable,
            None,
            "The file could not be inspected; it was not changed.",
            Some(AppError::not_found("The resource is unavailable.")),
        );
    };
    let mode = metadata.permissions().mode() & 0o777;
    let backup = match create_backup(
        ctx.environment,
        BACKUP_APP_ID,
        &backup_document_id(&pending.grant_id, pending.relative.as_deref()),
        current,
        mode,
        ctx.retention,
    ) {
        Ok(backup) => backup,
        Err(error) => {
            return outcome(
                WriteStatus::Failed,
                FileState::Unchanged,
                RecoveryPoint::NoneUnavailable,
                None,
                "The backup could not be created, so the file was not changed.",
                Some(error),
            );
        }
    };
    let backup_id = backup.metadata.backup_id.clone();

    match atomic_replace(
        target,
        pending.content.as_bytes(),
        mode,
        Some((expected_hash, MAX_WRITE_BYTES)),
    ) {
        Ok(()) => {}
        Err(AtomicReplaceError::BeforeCommit(error)) => {
            let conflict = error.code() == AppErrorCode::Conflict;
            return outcome(
                WriteStatus::Failed,
                if error.code() == AppErrorCode::PartialFailure {
                    FileState::Unknown
                } else {
                    FileState::Unchanged
                },
                RecoveryPoint::Backup,
                Some(backup_id),
                if conflict {
                    "The file changed immediately before it was replaced; it was not changed. Preview again."
                } else {
                    "The file could not be replaced; it was not changed."
                },
                Some(error),
            );
        }
        Err(AtomicReplaceError::AfterCommit(error)) => {
            return restore_after_failure(pending, &backup, expected_hash, error);
        }
    }

    let verification = ctx
        .grants
        .read_with_access(
            &pending.grant_id,
            pending.relative.as_deref(),
            MAX_WRITE_BYTES,
            pending.access,
        )
        .map_err(read_error)
        .and_then(|written| {
            if written.content == pending.content.as_bytes() {
                post_validate(&written.content)
            } else {
                Err(AppError::validation_failed(
                    "The written file does not match the previewed content.",
                ))
            }
        });
    match verification {
        Ok(()) => outcome(
            WriteStatus::Succeeded,
            FileState::Written,
            RecoveryPoint::Backup,
            Some(backup_id.clone()),
            &format!(
                "The file was written and verified. The previous content is kept as backup {backup_id}."
            ),
            None,
        ),
        Err(error) => restore_after_failure(pending, &backup, expected_hash, error),
    }
}

/// Restores the backup and then checks what the file really contains, so the
/// reported restore result is observed, not assumed.
fn restore_after_failure(
    pending: &PendingResourceWrite,
    backup: &crate::config::backup::BackupRecord,
    original_hash: &str,
    cause: AppError,
) -> WriteOutcome {
    let target = pending.target_path.as_path();
    let backup_id = backup.metadata.backup_id.clone();
    let restore = restore_backup_after_commit_failure(target, backup, MAX_WRITE_BYTES);
    let restored =
        restore.is_ok() && fs::read(target).is_ok_and(|bytes| hash_bytes(&bytes) == original_hash);
    if restored {
        WriteOutcome {
            kind: WriteKind::Replace,
            status: WriteStatus::Failed,
            file_state: FileState::Restored,
            recovery_point: RecoveryPoint::Backup,
            backup_id: Some(backup_id),
            summary:
                "The write failed verification. The previous content was restored and checked."
                    .to_owned(),
            error: Some(cause),
        }
    } else {
        WriteOutcome {
            kind: WriteKind::Replace,
            status: WriteStatus::Failed,
            file_state: FileState::RestoreFailed,
            recovery_point: RecoveryPoint::Backup,
            summary: format!(
                "The write failed verification and the previous content could not be confirmed as restored. The file may contain the new content; backup {backup_id} still holds the previous content."
            ),
            backup_id: Some(backup_id),
            error: Some(restore.err().unwrap_or_else(|| {
                AppError::partial_failure(
                    "Restoration finished but the restored content did not match the backup.",
                    false,
                )
            })),
        }
    }
}

fn create<F>(pending: &PendingResourceWrite, post_validate: F) -> WriteOutcome
where
    F: FnOnce(&[u8]) -> Result<(), AppError>,
{
    let target = pending.target_path.as_path();
    let outcome = |status, file_state, summary: &str, error| WriteOutcome {
        kind: WriteKind::Create,
        status,
        file_state,
        recovery_point: RecoveryPoint::NoneCreated,
        backup_id: None,
        summary: summary.to_owned(),
        error,
    };

    if let Err(error) = atomic_create_new(target, pending.content.as_bytes(), NEW_FILE_MODE) {
        let unknown = error.code() == AppErrorCode::PartialFailure;
        return outcome(
            WriteStatus::Failed,
            if unknown {
                FileState::Unknown
            } else {
                FileState::Unchanged
            },
            if unknown {
                "Creating the file failed and its final state could not be established."
            } else {
                "The file was not created."
            },
            Some(error),
        );
    }

    let verification = fs::read(target)
        .map_err(|_| AppError::permission_denied("The new file cannot be read back."))
        .and_then(|written| {
            if written == pending.content.as_bytes() {
                post_validate(&written)
            } else {
                Err(AppError::validation_failed(
                    "The written file does not match the previewed content.",
                ))
            }
        });
    match verification {
        Ok(()) => outcome(
            WriteStatus::Succeeded,
            FileState::Written,
            "The file was created and verified. It is new, so there is no recovery point.",
            None,
        ),
        Err(cause) => {
            let removed = fs::remove_file(target).is_ok()
                && target
                    .parent()
                    .is_some_and(|parent| sync_directory(parent).is_ok());
            if removed {
                outcome(
                    WriteStatus::Failed,
                    FileState::CreatedRemoved,
                    "The new file failed verification and was removed again.",
                    Some(cause),
                )
            } else {
                outcome(
                    WriteStatus::Failed,
                    FileState::CreatedRemoveFailed,
                    "The new file failed verification and could not be removed; it may still exist.",
                    Some(AppError::partial_failure(
                        "The new file failed verification and could not be removed.",
                        false,
                    )),
                )
            }
        }
    }
}

/// The default text validation always runs first; the caller's own check only
/// runs when it passed, so a caller can tighten the check but never replace it.
fn with_default_validation<F>(post_validate: F) -> impl FnOnce(&[u8]) -> Result<(), AppError>
where
    F: FnOnce(&[u8]) -> Result<(), AppError>,
{
    move |bytes| {
        validate_text(bytes)?;
        post_validate(bytes)
    }
}

/// Default post-write check: the proposed bytes must be NUL-free UTF-8 text.
/// Modules with a real parser pass their own check through the same hook.
fn validate_text(bytes: &[u8]) -> Result<(), AppError> {
    match std::str::from_utf8(bytes) {
        Ok(text) if !text.contains('\0') => Ok(()),
        _ => Err(AppError::validation_failed(
            "The content must be UTF-8 text without NUL bytes.",
        )),
    }
}

fn stale_error() -> AppError {
    AppError::conflict(
        "The resource changed after the preview was created; re-read it and preview again.",
    )
}

fn read_error(error: ReadError) -> AppError {
    match error {
        ReadError::NotFound => AppError::not_found("The resource no longer exists."),
        ReadError::PermissionDenied => {
            AppError::permission_denied("UserHome does not have permission to read the resource.")
        }
        ReadError::Malformed => AppError::validation_failed(
            "The resource is not valid UTF-8 text or its path is invalid.",
        ),
        ReadError::TooLarge => AppError::validation_failed("The resource exceeds the size limit."),
        ReadError::Unsupported => {
            AppError::not_supported("The target is not a regular file that can be written.")
        }
        ReadError::Excluded => {
            AppError::conflict("The authorization no longer covers the resource; preview again.")
        }
        ReadError::Io => AppError::process_failed("The resource could not be read.", true),
    }
}

/// Backup directories are keyed by a digest, never by caller-supplied text.
fn backup_document_id(grant_id: &GrantId, relative: Option<&str>) -> String {
    let digest = Sha256::digest(format!("{}\0{}", grant_id.as_str(), relative.unwrap_or("")));
    format!("resource-{}", &format!("{digest:x}")[..32])
}

impl ResourceWriteCoordinator {
    /// Test helper: swaps the proposed content of a pending write behind the
    /// preview's back (the operation intent stays as previewed).
    #[cfg(test)]
    pub(super) fn poison_pending_content_for_test(&self, operation_id: &str, content: &str) {
        let mut state = self.state.lock().expect("state");
        state
            .pending
            .get_mut(operation_id)
            .expect("pending")
            .content = content.to_owned();
    }
}

/// Test helper: marks a previewed operation as running, as `execute` does
/// before it enters the transaction.
#[cfg(test)]
fn authorize_for_test(
    fixture: &resources_tests::Fixture,
    operation_id: &str,
    pending: &PendingResourceWrite,
) {
    fixture
        .operations
        .authorize_mutation(operation_id, &intent_for(pending))
        .expect("authorize");
}

#[cfg(test)]
mod resources_tests {
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
        path::{Path, PathBuf},
        sync::{
            Arc,
            atomic::{AtomicU64, Ordering},
        },
    };

    use uuid::Uuid;

    use crate::{
        config::{ConfigEnvironment, read::hash_bytes},
        error::{AppError, AppErrorCode},
        operations::{
            Clock, OperationCoordinator, OperationIdSource, OperationStatus, OperationStore,
            PREVIEW_TTL_MILLIS,
        },
        settings::BackupRetention,
    };

    use super::{
        super::{GrantCoordinator, GrantPurpose, GrantRecord, GrantStore},
        ConfirmRequest, FileState, RecoveryPoint, ResourceWriteBatchPreview, ResourceWriteContext,
        ResourceWriteCoordinator, ResourceWriteExecution, StepState, WriteKind, WriteRequest,
        WriteStatus,
    };

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

    struct SequentialIds(AtomicU64);

    impl OperationIdSource for SequentialIds {
        fn next_id(&self) -> String {
            format!("op-{}", self.0.fetch_add(1, Ordering::SeqCst))
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

    pub(super) struct Fixture {
        root: PathBuf,
        home: PathBuf,
        project: PathBuf,
        environment: ConfigEnvironment,
        grants: GrantCoordinator,
        pub(super) operations: OperationCoordinator,
        writes: ResourceWriteCoordinator,
        clock: Arc<FakeClock>,
        grant: GrantRecord,
    }

    impl Fixture {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("canonical temp dir")
                .join(format!("userhome-resource-write-{}", Uuid::new_v4()));
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
            let clock = Arc::new(FakeClock::default());
            let operations = OperationCoordinator::with_store(OperationStore::with_sources(
                Arc::new(Clocked(clock.clone())),
                Arc::new(SequentialIds(AtomicU64::new(1))),
            ));
            Self {
                root,
                home,
                project,
                environment,
                grants,
                operations,
                writes: ResourceWriteCoordinator::default(),
                clock,
                grant,
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
            let path = self.project.join(name);
            fs::write(&path, content).expect("seed file");
            path
        }

        fn request(&self, relative: &str, current: Option<&str>, content: &str) -> WriteRequest {
            WriteRequest {
                grant_id: self.grant.id.clone(),
                relative: Some(relative.to_owned()),
                expected_sha256: current.map(|text| hash_bytes(text.as_bytes())),
                content: content.to_owned(),
                sensitive: false,
            }
        }

        fn preview(&self, requests: Vec<WriteRequest>) -> ResourceWriteBatchPreview {
            self.writes.preview(&self.ctx(), requests).expect("preview")
        }

        fn confirm_request(&self, operation_id: &str, relative: &str) -> ConfirmRequest {
            ConfirmRequest {
                operation_id: operation_id.to_owned(),
                grant_id: self.grant.id.clone(),
                relative: Some(relative.to_owned()),
            }
        }

        fn confirm(
            &self,
            operation_id: &str,
            relative: &str,
        ) -> Result<ResourceWriteExecution, AppError> {
            self.writes
                .execute(&self.ctx(), &self.confirm_request(operation_id, relative))
        }

        fn status(&self, operation_id: &str) -> OperationStatus {
            self.operations.get(operation_id).expect("operation").status
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
            walk(&self.home.join("backups"), &mut files);
            files
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Ok(entries) = fs::read_dir(&self.project) {
                let _ = fs::set_permissions(&self.project, fs::Permissions::from_mode(0o700));
                drop(entries);
            }
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn mode(path: &Path) -> u32 {
        fs::metadata(path).expect("metadata").permissions().mode() & 0o777
    }

    fn assert_re_preview(error: &AppError, code: AppErrorCode) {
        assert_eq!(error.code(), code, "{error:?}");
        let json = serde_json::to_string(error).expect("serialize");
        assert!(json.contains("preview again"), "{json}");
    }

    #[test]
    fn resources_replace_backs_up_then_writes_and_protects_the_backup() {
        let fixture = Fixture::new();
        let file = fixture.seed("settings.toml", "x = 1\n");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).expect("chmod");

        let batch = fixture.preview(vec![fixture.request(
            "settings.toml",
            Some("x = 1\n"),
            "x = 2\n",
        )]);
        assert!(!batch.atomic);
        let step = &batch.steps[0];
        assert_eq!(step.kind, WriteKind::Replace);
        assert_eq!(step.recovery_point, RecoveryPoint::Backup);
        assert_eq!(
            step.current_hash.as_deref(),
            Some(hash_bytes(b"x = 1\n").as_str())
        );
        assert_eq!(step.proposed_hash, hash_bytes(b"x = 2\n"));
        assert_eq!(step.diff.changed_line_count(), 2);
        assert_eq!(fs::read_to_string(&file).expect("untouched"), "x = 1\n");
        assert!(fixture.backup_files().is_empty());

        let execution = fixture
            .confirm(&step.operation.operation_id, "settings.toml")
            .expect("confirm");
        let outcome = &execution.outcome;
        assert_eq!(outcome.status, WriteStatus::Succeeded);
        assert_eq!(outcome.file_state, FileState::Written);
        assert_eq!(outcome.recovery_point, RecoveryPoint::Backup);
        assert!(outcome.backup_id.is_some());
        assert_eq!(execution.operation.status, OperationStatus::Succeeded);
        assert_eq!(fs::read_to_string(&file).expect("written"), "x = 2\n");
        assert_eq!(mode(&file), 0o640, "the original permissions are kept");

        let backups = fixture.backup_files();
        let content = backups
            .iter()
            .find(|path| path.file_name().is_some_and(|name| name == "content"))
            .expect("backup content");
        assert_eq!(fs::read_to_string(content).expect("backup"), "x = 1\n");
        for backup in &backups {
            assert_eq!(mode(backup), 0o600, "{backup:?}");
        }
        let mut directory = content.parent().expect("backup dir").to_path_buf();
        while directory != fixture.home {
            assert_eq!(mode(&directory), 0o700, "{directory:?}");
            directory = directory.parent().expect("parent").to_path_buf();
        }
    }

    #[test]
    fn resources_expired_preview_cannot_be_confirmed() {
        let fixture = Fixture::new();
        let file = fixture.seed("settings.toml", "x = 1\n");
        let batch = fixture.preview(vec![fixture.request(
            "settings.toml",
            Some("x = 1\n"),
            "x = 2\n",
        )]);
        let operation_id = batch.steps[0].operation.operation_id.clone();

        fixture
            .clock
            .millis
            .store(PREVIEW_TTL_MILLIS, Ordering::SeqCst);
        let error = fixture
            .confirm(&operation_id, "settings.toml")
            .expect_err("expired preview");

        assert_eq!(error.code(), AppErrorCode::Timeout);
        assert_eq!(fixture.status(&operation_id), OperationStatus::Expired);
        assert_eq!(fs::read_to_string(&file).expect("untouched"), "x = 1\n");
        assert!(fixture.backup_files().is_empty());
        let status = fixture
            .writes
            .batch_status(&fixture.operations, &batch.batch_id)
            .expect("status");
        assert_eq!(status.steps[0].state, StepState::Rejected);
    }

    #[test]
    fn resources_confirmation_for_another_target_is_refused() {
        let fixture = Fixture::new();
        let first = fixture.seed("a.toml", "a = 1\n");
        let second = fixture.seed("b.toml", "b = 1\n");
        let batch = fixture.preview(vec![fixture.request("a.toml", Some("a = 1\n"), "a = 2\n")]);
        let operation_id = batch.steps[0].operation.operation_id.clone();

        let error = fixture
            .confirm(&operation_id, "b.toml")
            .expect_err("swapped target");
        assert_eq!(error.code(), AppErrorCode::Conflict);

        let other_grant = fixture
            .grants
            .create(GrantPurpose::ConfigFile, &second)
            .expect("second grant");
        let error = fixture
            .writes
            .execute(
                &fixture.ctx(),
                &ConfirmRequest {
                    operation_id: operation_id.clone(),
                    grant_id: other_grant.id,
                    relative: None,
                },
            )
            .expect_err("swapped authorization");
        assert_eq!(error.code(), AppErrorCode::Conflict);

        assert_eq!(fs::read_to_string(&first).expect("a"), "a = 1\n");
        assert_eq!(fs::read_to_string(&second).expect("b"), "b = 1\n");
        assert_eq!(fixture.status(&operation_id), OperationStatus::Previewed);
        // The preview is still usable for its own target.
        fixture
            .confirm(&operation_id, "a.toml")
            .expect("original target");
        assert_eq!(fs::read_to_string(&first).expect("a"), "a = 2\n");
    }

    #[test]
    fn resources_target_swapped_for_a_symlink_after_preview_is_refused() {
        let fixture = Fixture::new();
        let file = fixture.seed("a.toml", "a = 1\n");
        let other = fixture.seed("b.toml", "b = 1\n");
        let batch = fixture.preview(vec![fixture.request("a.toml", Some("a = 1\n"), "a = 2\n")]);
        let operation_id = batch.steps[0].operation.operation_id.clone();

        fs::remove_file(&file).expect("remove");
        symlink(&other, &file).expect("swap in symlink");
        let error = fixture
            .confirm(&operation_id, "a.toml")
            .expect_err("swapped target");

        assert_re_preview(&error, AppErrorCode::Conflict);
        assert_eq!(fs::read_to_string(&other).expect("b"), "b = 1\n");
        assert_eq!(fixture.status(&operation_id), OperationStatus::Failed);
        assert!(fixture.backup_files().is_empty());
    }

    #[test]
    fn resources_external_modification_requires_a_new_preview() {
        let fixture = Fixture::new();
        let file = fixture.seed("settings.toml", "x = 1\n");
        let batch = fixture.preview(vec![fixture.request(
            "settings.toml",
            Some("x = 1\n"),
            "x = 2\n",
        )]);
        let operation_id = batch.steps[0].operation.operation_id.clone();

        fs::write(&file, "x = 99\n").expect("external edit");
        let error = fixture
            .confirm(&operation_id, "settings.toml")
            .expect_err("changed content");

        assert_re_preview(&error, AppErrorCode::Conflict);
        assert_eq!(fs::read_to_string(&file).expect("external"), "x = 99\n");
        assert_eq!(fixture.status(&operation_id), OperationStatus::Failed);
        assert!(fixture.backup_files().is_empty());
        // The consumed preview cannot be replayed.
        assert!(fixture.confirm(&operation_id, "settings.toml").is_err());
    }

    #[test]
    fn resources_stale_read_hash_is_rejected_at_preview() {
        let fixture = Fixture::new();
        fixture.seed("settings.toml", "x = 1\n");
        let error = fixture
            .writes
            .preview(
                &fixture.ctx(),
                vec![fixture.request("settings.toml", Some("x = 0\n"), "x = 2\n")],
            )
            .expect_err("stale hash");
        assert_re_preview(&error, AppErrorCode::Conflict);

        let error = fixture
            .writes
            .preview(
                &fixture.ctx(),
                vec![fixture.request("settings.toml", None, "x = 2\n")],
            )
            .expect_err("existing file without a read hash");
        assert_eq!(error.code(), AppErrorCode::Conflict);
    }

    #[test]
    fn resources_revoked_authorization_is_refused() {
        let fixture = Fixture::new();
        let file = fixture.seed("settings.toml", "x = 1\n");
        let batch = fixture.preview(vec![fixture.request(
            "settings.toml",
            Some("x = 1\n"),
            "x = 2\n",
        )]);
        let operation_id = batch.steps[0].operation.operation_id.clone();

        fixture.grants.revoke(&fixture.grant.id).expect("revoke");
        let error = fixture
            .confirm(&operation_id, "settings.toml")
            .expect_err("revoked");

        assert_re_preview(&error, AppErrorCode::Conflict);
        assert_eq!(fs::read_to_string(&file).expect("untouched"), "x = 1\n");
    }

    #[test]
    fn resources_backup_failure_leaves_the_file_untouched() {
        let fixture = Fixture::new();
        let file = fixture.seed("settings.toml", "x = 1\n");
        // A regular file where the backup root should be makes backups fail.
        fs::write(fixture.home.join("backups"), "not a directory").expect("block backup root");
        let batch = fixture.preview(vec![fixture.request(
            "settings.toml",
            Some("x = 1\n"),
            "x = 2\n",
        )]);

        let execution = fixture
            .confirm(&batch.steps[0].operation.operation_id, "settings.toml")
            .expect("transaction ran");

        assert_eq!(execution.outcome.status, WriteStatus::Failed);
        assert_eq!(execution.outcome.file_state, FileState::Unchanged);
        assert_eq!(
            execution.outcome.recovery_point,
            RecoveryPoint::NoneUnavailable
        );
        assert!(execution.outcome.backup_id.is_none());
        assert!(execution.outcome.error.is_some());
        assert_eq!(execution.operation.status, OperationStatus::Failed);
        assert_eq!(fs::read_to_string(&file).expect("untouched"), "x = 1\n");
        let leftovers = fs::read_dir(&fixture.project)
            .expect("list")
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().contains(".userhome-"))
            .count();
        assert_eq!(leftovers, 0);
    }

    fn pending_for(
        fixture: &Fixture,
        relative: &str,
        current: &str,
        content: &str,
    ) -> (String, super::PendingResourceWrite) {
        let batch = fixture.preview(vec![fixture.request(relative, Some(current), content)]);
        let operation_id = batch.steps[0].operation.operation_id.clone();
        let pending = fixture
            .writes
            .state
            .lock()
            .expect("state")
            .pending
            .get(&operation_id)
            .cloned()
            .expect("pending");
        (operation_id, pending)
    }

    #[test]
    fn resources_failed_verification_restores_and_reports_the_restore() {
        let fixture = Fixture::new();
        let file = fixture.seed("settings.toml", "x = 1\n");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).expect("chmod");
        let batch = fixture.preview(vec![fixture.request(
            "settings.toml",
            Some("x = 1\n"),
            "x = 2\n",
        )]);
        let operation_id = batch.steps[0].operation.operation_id.clone();

        let execution = fixture
            .writes
            .execute_with(
                &fixture.ctx(),
                &fixture.confirm_request(&operation_id, "settings.toml"),
                |_| {
                    Err(AppError::validation_failed(
                        "The configuration does not parse.",
                    ))
                },
            )
            .expect("transaction ran");

        let outcome = &execution.outcome;
        assert_eq!(outcome.status, WriteStatus::Failed);
        assert_eq!(outcome.file_state, FileState::Restored);
        assert_eq!(outcome.recovery_point, RecoveryPoint::Backup);
        assert_eq!(
            outcome.error.as_ref().map(AppError::code),
            Some(AppErrorCode::ValidationFailed)
        );
        assert_eq!(execution.operation.status, OperationStatus::Failed);
        assert_eq!(fs::read_to_string(&file).expect("restored"), "x = 1\n");
        assert_eq!(mode(&file), 0o640);
    }

    #[test]
    fn resources_restore_failure_is_reported_instead_of_claimed_as_restored() {
        let fixture = Fixture::new();
        let file = fixture.seed("settings.toml", "x = 1\n");
        let (operation_id, pending) = pending_for(&fixture, "settings.toml", "x = 1\n", "x = 2\n");
        let project = fixture.project.clone();

        // Verification fails and, at the same moment, the directory becomes
        // read-only, so the temporary file needed for the restore cannot exist.
        let outcome = {
            super::authorize_for_test(&fixture, &operation_id, &pending);
            super::run_transaction(&fixture.ctx(), &pending, |_| {
                fs::set_permissions(&project, fs::Permissions::from_mode(0o500)).expect("lock");
                Err(AppError::validation_failed(
                    "The configuration does not parse.",
                ))
            })
            .expect("transaction ran")
        };
        fs::set_permissions(&fixture.project, fs::Permissions::from_mode(0o700)).expect("unlock");

        assert_eq!(outcome.status, WriteStatus::Failed);
        assert_eq!(outcome.file_state, FileState::RestoreFailed);
        assert_eq!(
            outcome.error.as_ref().map(AppError::code),
            Some(AppErrorCode::PartialFailure)
        );
        assert!(
            outcome
                .summary
                .contains("could not be confirmed as restored")
        );
        let backup_id = outcome.backup_id.expect("backup id is still reported");
        let backup_content = fixture
            .backup_files()
            .into_iter()
            .find(|path| path.file_name().is_some_and(|name| name == "content"))
            .expect("backup survives");
        assert!(backup_content.to_string_lossy().contains(&backup_id));
        assert_eq!(
            fs::read_to_string(backup_content).expect("backup"),
            "x = 1\n"
        );
        assert_eq!(
            fs::read_to_string(&file).expect("new content stays"),
            "x = 2\n"
        );
    }

    #[test]
    fn resources_new_file_is_created_without_a_recovery_point() {
        let fixture = Fixture::new();
        let batch = fixture.preview(vec![fixture.request("fresh.toml", None, "y = 1\n")]);
        let step = &batch.steps[0];
        assert_eq!(step.kind, WriteKind::Create);
        assert_eq!(step.recovery_point, RecoveryPoint::NoneCreated);
        assert!(step.current_hash.is_none());
        assert!(!fixture.project.join("fresh.toml").exists());

        let execution = fixture
            .confirm(&step.operation.operation_id, "fresh.toml")
            .expect("confirm");

        let outcome = &execution.outcome;
        assert_eq!(outcome.kind, WriteKind::Create);
        assert_eq!(outcome.status, WriteStatus::Succeeded);
        assert_eq!(outcome.recovery_point, RecoveryPoint::NoneCreated);
        assert!(outcome.backup_id.is_none());
        assert!(outcome.summary.contains("no recovery point"));
        let created = fixture.project.join("fresh.toml");
        assert_eq!(fs::read_to_string(&created).expect("created"), "y = 1\n");
        assert_eq!(mode(&created), 0o600);
        assert!(
            fixture.backup_files().is_empty() && !fixture.home.join("backups").exists(),
            "a creation must not fabricate a backup"
        );
    }

    #[test]
    fn resources_created_file_failing_verification_is_removed_again() {
        let fixture = Fixture::new();
        let batch = fixture.preview(vec![fixture.request("fresh.toml", None, "y = 1\n")]);
        let operation_id = batch.steps[0].operation.operation_id.clone();

        let execution = fixture
            .writes
            .execute_with(
                &fixture.ctx(),
                &fixture.confirm_request(&operation_id, "fresh.toml"),
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
        assert!(!fixture.project.join("fresh.toml").exists());
    }

    #[test]
    fn resources_file_created_after_preview_is_not_overwritten() {
        let fixture = Fixture::new();
        let batch = fixture.preview(vec![fixture.request("fresh.toml", None, "y = 1\n")]);
        fixture.seed("fresh.toml", "someone else\n");

        let error = fixture
            .confirm(&batch.steps[0].operation.operation_id, "fresh.toml")
            .expect_err("created meanwhile");

        assert_re_preview(&error, AppErrorCode::Conflict);
        assert_eq!(
            fs::read_to_string(fixture.project.join("fresh.toml")).expect("kept"),
            "someone else\n"
        );
    }

    #[test]
    fn resources_creation_stays_inside_the_authorized_directory() {
        let fixture = Fixture::new();
        let outside = fixture.root.join("outside");
        fs::create_dir_all(&outside).expect("outside");
        symlink(&outside, fixture.project.join("link")).expect("escape link");
        fs::create_dir_all(fixture.project.join("nested")).expect("nested");

        for relative in [
            "link/new.toml",
            "missing-dir/new.toml",
            "../new.toml",
            "/abs.toml",
        ] {
            assert!(
                fixture
                    .writes
                    .preview(
                        &fixture.ctx(),
                        vec![fixture.request(relative, None, "a = 1\n")]
                    )
                    .is_err(),
                "{relative}"
            );
        }
        assert!(!outside.join("new.toml").exists());
        // A dangling symlink is neither "missing" nor creatable.
        symlink(outside.join("nope"), fixture.project.join("dangling.toml")).expect("dangling");
        assert!(
            fixture
                .writes
                .preview(
                    &fixture.ctx(),
                    vec![fixture.request("dangling.toml", None, "a = 1\n")]
                )
                .is_err()
        );
        fixture.preview(vec![fixture.request("nested/new.toml", None, "a = 1\n")]);
    }

    #[test]
    fn resources_file_grants_replace_only_their_own_file() {
        let fixture = Fixture::new();
        let file = fixture.seed("single.toml", "s = 1\n");
        let grant = fixture
            .grants
            .create(GrantPurpose::ConfigFile, &file)
            .expect("file grant");
        let request = |relative: Option<&str>| WriteRequest {
            grant_id: grant.id.clone(),
            relative: relative.map(str::to_owned),
            expected_sha256: Some(hash_bytes(b"s = 1\n")),
            content: "s = 2\n".to_owned(),
            sensitive: false,
        };

        assert!(
            fixture
                .writes
                .preview(&fixture.ctx(), vec![request(Some("other.toml"))])
                .is_err()
        );
        let batch = fixture
            .writes
            .preview(&fixture.ctx(), vec![request(None)])
            .expect("preview");
        let operation_id = batch.steps[0].operation.operation_id.clone();
        let execution = fixture
            .writes
            .execute(
                &fixture.ctx(),
                &ConfirmRequest {
                    operation_id,
                    grant_id: grant.id,
                    relative: None,
                },
            )
            .expect("confirm");
        assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
        assert_eq!(fs::read_to_string(&file).expect("written"), "s = 2\n");
    }

    #[test]
    fn resources_batch_keeps_completed_facts_when_a_later_step_fails() {
        let fixture = Fixture::new();
        let first = fixture.seed("one.toml", "1\n");
        let second = fixture.seed("two.toml", "2\n");
        let third = fixture.seed("three.toml", "3\n");
        let batch = fixture.preview(vec![
            fixture.request("one.toml", Some("1\n"), "one\n"),
            fixture.request("two.toml", Some("2\n"), "two\n"),
            fixture.request("three.toml", Some("3\n"), "three\n"),
        ]);
        assert!(!batch.atomic);
        assert_eq!(batch.steps.len(), 3);
        let ids: Vec<String> = batch
            .steps
            .iter()
            .map(|step| step.operation.operation_id.clone())
            .collect();

        // Steps must be confirmed in order.
        let out_of_order = fixture
            .confirm(&ids[1], "two.toml")
            .expect_err("second before first");
        assert_eq!(out_of_order.code(), AppErrorCode::Conflict);
        assert_eq!(fs::read_to_string(&second).expect("two"), "2\n");

        fixture.confirm(&ids[0], "one.toml").expect("first step");
        fs::write(&second, "externally changed\n").expect("external edit");
        let error = fixture
            .confirm(&ids[1], "two.toml")
            .expect_err("second step rejected");
        assert_re_preview(&error, AppErrorCode::Conflict);
        let blocked = fixture
            .confirm(&ids[2], "three.toml")
            .expect_err("third step blocked");
        assert_eq!(blocked.code(), AppErrorCode::Conflict);

        assert_eq!(
            fs::read_to_string(&first).expect("one"),
            "one\n",
            "completed work stays"
        );
        assert_eq!(
            fs::read_to_string(&second).expect("two"),
            "externally changed\n"
        );
        assert_eq!(fs::read_to_string(&third).expect("three"), "3\n");

        let status = fixture
            .writes
            .batch_status(&fixture.operations, &batch.batch_id)
            .expect("batch status");
        assert!(!status.atomic);
        assert_eq!((status.completed, status.total), (1, 3));
        let states: Vec<StepState> = status.steps.iter().map(|step| step.state).collect();
        assert_eq!(
            states,
            [
                StepState::Succeeded,
                StepState::Rejected,
                StepState::Blocked
            ]
        );
        let done = status.steps[0].outcome.as_ref().expect("outcome kept");
        assert_eq!(done.status, WriteStatus::Succeeded);
        assert!(done.backup_id.is_some());
        assert!(status.steps[1].error.is_some());
    }

    #[test]
    fn resources_batch_rejects_duplicates_and_cancels_earlier_previews_on_failure() {
        let fixture = Fixture::new();
        fixture.seed("one.toml", "1\n");
        let duplicate = fixture.writes.preview(
            &fixture.ctx(),
            vec![
                fixture.request("one.toml", Some("1\n"), "a\n"),
                fixture.request("one.toml", Some("1\n"), "b\n"),
            ],
        );
        assert_eq!(
            duplicate.expect_err("duplicate target").code(),
            AppErrorCode::InvalidInput
        );

        let failing = fixture.writes.preview(
            &fixture.ctx(),
            vec![
                fixture.request("one.toml", Some("1\n"), "a\n"),
                fixture.request("two.toml", Some("2\n"), "b\n"),
            ],
        );
        assert!(failing.is_err());
        let summaries = fixture.operations.list().expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].status, OperationStatus::Cancelled);
        assert!(fixture.writes.preview(&fixture.ctx(), Vec::new()).is_err());
    }

    #[test]
    fn resources_oversized_or_non_text_content_is_not_previewed() {
        let fixture = Fixture::new();
        fixture.seed("one.toml", "1\n");
        let huge = "x".repeat(super::MAX_WRITE_BYTES + 1);
        assert_eq!(
            fixture
                .writes
                .preview(
                    &fixture.ctx(),
                    vec![fixture.request("one.toml", Some("1\n"), &huge)]
                )
                .expect_err("too large")
                .code(),
            AppErrorCode::ValidationFailed
        );
        assert_eq!(
            fixture
                .writes
                .preview(
                    &fixture.ctx(),
                    vec![fixture.request("one.toml", Some("1\n"), "a\0b")]
                )
                .expect_err("nul byte")
                .code(),
            AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn resources_sensitive_previews_redact_the_diff_and_never_expose_paths() {
        let fixture = Fixture::new();
        fixture.seed(".env", "TOKEN=old\n");
        let mut request = fixture.request(".env", Some("TOKEN=old\n"), "TOKEN=new\n");
        request.sensitive = true;
        let batch = fixture.preview(vec![request]);
        let json = serde_json::to_string(&batch).expect("serialize");
        assert!(batch.steps[0].diff.changed_line_count() == 0);
        assert!(json.contains("\"redacted\":true"));
        assert!(!json.contains("TOKEN=new"));
        assert!(!json.contains(fixture.root.to_str().expect("utf8 root")));
    }
}
