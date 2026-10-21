//! Adopting an existing user job, releasing the adoption, and structured edits
//! of an adopted job. Every flow rediscovers the job first, and every preview
//! binds the content hash it read, so an external change between preview and
//! confirmation is a conflict. Adoption writes no plist: it backs the original
//! up, then records ownership, then reads both back. An edit replaces the plist
//! through the dedicated replacement entry with a one-file grant that is revoked
//! as soon as its write (or its discarded preview) ends.

use std::{
    collections::{BTreeMap, HashMap},
    fs::OpenOptions,
    io::{Cursor, Read},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{
    config::{backup::create_backup, read::hash_bytes},
    error::{AppError, AppErrorCode},
    grants::{
        ConfirmRequest, GrantCoordinator, GrantError, GrantId, ResourceWriteContext,
        ResourceWriteCoordinator, ResourceWriteExecution, ResourceWritePreview, WriteRequest,
    },
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
        OperationStatus,
    },
    services::{
        create::HostFacts,
        launchd::{Discovery, Label, LaunchdDomain, LaunchdService, discover, with_system},
        ownership::{
            AdoptionRecords, ModifiableTarget, Ownership, OwnershipError, ServiceRequest,
            acquire_gate, domain_trusted, ensure_modifiable,
        },
    },
};

use super::{
    MAX_PLIST_BYTES, Refusal, admit,
    edit::{EditRequest, plan_edit, refusal_text},
    store::{AdoptionRecord, AdoptionStore},
};

const BACKUP_APP_ID: &str = "services-adoption";
const MAX_PENDING: usize = 16;
const ADOPT_EFFECT_NOTE: &str = "接管只记录所有权，不修改 plist 内容，也不加载或重启任务。";
const RELOAD_NOTE: &str = "配置已保存，需重新加载任务才生效；本步不会加载或重启。";
const BACKUP_NOTE: &str =
    "执行前把原始 plist 备份到 UserHome 备份目录（仅当前用户可读写）；备份失败则不接管、不写记录。";
const EXTERNAL_MANAGER_NOTE: &str = "若该任务由 Homebrew services 或其他工具管理，它们可能重写此文件；接管后请只通过 UserHome 修改，外部改动会被检测并阻止写入。";
const SOURCE_NOTE: &str = "~/Library/LaunchAgents（当前用户）";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptPreview {
    #[serde(flatten)]
    pub operation: OperationPreview,
    pub label: String,
    pub domain: LaunchdDomain,
    pub source: &'static str,
    pub file_path: String,
    pub backup: &'static str,
    /// Always empty: adoption never changes the plist.
    pub changed_fields: Vec<String>,
    pub external_manager_note: &'static str,
    pub effect_note: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptExecution {
    #[serde(flatten)]
    pub operation: OperationDetails,
    pub label: String,
    pub domain: LaunchdDomain,
    pub file_path: String,
    pub backup_id: String,
    pub plist_changed: bool,
    pub effect_note: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseOutcome {
    pub label: String,
    pub domain: LaunchdDomain,
    pub released: bool,
    pub plist_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPreview {
    #[serde(flatten)]
    pub write: ResourceWritePreview,
    pub label: String,
    pub domain: LaunchdDomain,
    pub file_path: String,
    pub changes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<String>>,
    /// Names only; the values are never shown or recorded.
    pub environment_set: Vec<String>,
    pub environment_removed: Vec<String>,
    pub backup: &'static str,
    pub reload_note: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditExecution {
    #[serde(flatten)]
    pub execution: ResourceWriteExecution,
    pub label: String,
    pub domain: LaunchdDomain,
    pub file_path: String,
    /// The write result is kept when its grant could not be revoked; the revoke
    /// failure is reported beside it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant_release_error: Option<AppError>,
    pub reload_required: bool,
    pub reload_note: &'static str,
}

struct PendingAdoption {
    domain: LaunchdDomain,
    label: String,
    sha256: String,
}

struct PendingEdit {
    grant_id: GrantId,
    domain: LaunchdDomain,
    label: String,
    config_path: PathBuf,
    file_path: String,
}

#[derive(Default)]
pub struct AdoptCoordinator {
    adoptions: Mutex<HashMap<String, PendingAdoption>>,
    edits: Mutex<HashMap<String, PendingEdit>>,
}

struct AdoptionTarget {
    file_path: String,
    config_path: PathBuf,
    bytes: Vec<u8>,
    mode: u32,
    sha256: String,
}

impl AdoptCoordinator {
    pub fn preview_adoption(
        &self,
        discovery: &Discovery<'_>,
        adoptions: &AdoptionStore,
        operations: &OperationCoordinator,
        request: &ServiceRequest,
    ) -> Result<AdoptPreview, AppError> {
        let target = resolve_adoption(discovery, adoptions, request)?;
        prune_adoptions(&self.adoptions, operations)?;
        if lock(&self.adoptions)?.len() >= MAX_PENDING {
            return Err(AppError::conflict(
                "等待确认的接管预览过多，请先确认或等待过期。",
            ));
        }
        let file_path = tilde_path(&target.config_path, discovery.home.as_deref());
        let operation = operations.preview(
            adoption_intent(request.domain, &request.label, &target.sha256),
            &format!("接管任务 {}", request.label),
            vec![
                format!("任务：{} {}", domain_name(request.domain), request.label),
                format!("配置：{file_path}"),
                BACKUP_NOTE.to_owned(),
                "拟变更字段：无（接管不改 plist）。".to_owned(),
                EXTERNAL_MANAGER_NOTE.to_owned(),
            ],
            false,
        )?;
        lock(&self.adoptions)?.insert(
            operation.operation_id.clone(),
            PendingAdoption {
                domain: request.domain,
                label: request.label.clone(),
                sha256: target.sha256,
            },
        );
        Ok(AdoptPreview {
            operation,
            label: request.label.clone(),
            domain: request.domain,
            source: SOURCE_NOTE,
            file_path,
            backup: BACKUP_NOTE,
            changed_fields: Vec::new(),
            external_manager_note: EXTERNAL_MANAGER_NOTE,
            effect_note: ADOPT_EFFECT_NOTE,
        })
    }

    pub fn execute_adoption(
        &self,
        discovery: &Discovery<'_>,
        adoptions: &AdoptionStore,
        ctx: &ResourceWriteContext<'_>,
        operation_id: &str,
    ) -> Result<AdoptExecution, AppError> {
        let pending = lock(&self.adoptions)?
            .remove(operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        ctx.operations.authorize_mutation(
            operation_id,
            &adoption_intent(pending.domain, &pending.label, &pending.sha256),
        )?;
        ctx.operations
            .record_progress(operation_id, "Re-checking the job and its plist.")?;
        let request = ServiceRequest {
            domain: pending.domain,
            label: pending.label.clone(),
        };
        match adopt_now(discovery, adoptions, ctx, &request, &pending.sha256) {
            Ok((backup_id, file_path)) => {
                let summary = format!(
                    "已接管 {}；原始 plist 已备份为 {backup_id}；plist 未改动。",
                    pending.label
                );
                ctx.operations
                    .finish_success_with_output(operation_id, Some(&summary), None)?;
                Ok(AdoptExecution {
                    operation: ctx.operations.get(operation_id)?,
                    label: pending.label,
                    domain: pending.domain,
                    file_path,
                    backup_id,
                    plist_changed: false,
                    effect_note: ADOPT_EFFECT_NOTE,
                })
            }
            Err(error) => {
                ctx.operations.finish_failure(operation_id, error.clone())?;
                Err(error)
            }
        }
    }

    pub fn preview_edit(
        &self,
        discovery: &Discovery<'_>,
        adoptions: &AdoptionStore,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        facts: &dyn HostFacts,
        request: &EditRequest,
    ) -> Result<EditPreview, AppError> {
        prune_edits(&self.edits, ctx)?;
        if lock(&self.edits)?.len() >= MAX_PENDING {
            return Err(AppError::conflict(
                "等待确认的编辑预览过多，请先确认或放弃。",
            ));
        }
        let service = ServiceRequest {
            domain: request.domain,
            label: request.label.clone(),
        };
        let target = adopted_target(discovery, adoptions, &service)?;
        let home = discovery
            .home
            .as_deref()
            .ok_or(GrantError::HomeUnavailable)?;
        let (bytes, _) = read_regular(&target.config_path)
            .ok_or_else(|| AppError::permission_denied("无法读取该 plist。"))?;
        let plan = plan_edit(&bytes, &request.label, request, home, facts)?;
        ctx.operations
            .register_sensitive_values(plan.sensitive.clone())?;
        let file_name = target
            .config_path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(AppError::internal)?
            .to_owned();
        let grant = ctx.grants.create_launch_agent_replacement(&file_name)?;
        let file_path = tilde_path(&target.config_path, Some(home));

        let content = match String::from_utf8(plan.content) {
            Ok(content) => content,
            Err(_) => {
                let _ = ctx.grants.revoke(&grant.id);
                return Err(AppError::internal());
            }
        };
        let write = WriteRequest {
            grant_id: grant.id.clone(),
            relative: None,
            expected_sha256: Some(hash_bytes(&bytes)),
            content,
            sensitive: true,
        };
        let step = match writes.preview_launch_agent_replace(ctx, &request.label, write) {
            Ok(batch) => batch.steps.into_iter().next(),
            Err(error) => {
                let _ = ctx.grants.revoke(&grant.id);
                return Err(error);
            }
        };
        let Some(step) = step else {
            let _ = ctx.grants.revoke(&grant.id);
            return Err(AppError::internal());
        };
        lock(&self.edits)?.insert(
            step.operation.operation_id.clone(),
            PendingEdit {
                grant_id: grant.id,
                domain: request.domain,
                label: request.label.clone(),
                config_path: target.config_path,
                file_path: file_path.clone(),
            },
        );
        Ok(EditPreview {
            write: step,
            label: request.label.clone(),
            domain: request.domain,
            file_path,
            changes: plan.changes,
            executable: plan.executable,
            arguments: plan.arguments,
            environment_set: plan.environment_set,
            environment_removed: plan.environment_removed,
            backup: BACKUP_NOTE,
            reload_note: RELOAD_NOTE,
        })
    }

    pub fn execute_edit(
        &self,
        discovery: &Discovery<'_>,
        adoptions: &AdoptionStore,
        ctx: &ResourceWriteContext<'_>,
        writes: &ResourceWriteCoordinator,
        operation_id: &str,
    ) -> Result<EditExecution, AppError> {
        let pending = lock(&self.edits)?
            .remove(operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        let result = run_edit(discovery, adoptions, ctx, writes, operation_id, &pending);
        let released = release_grant(ctx.grants, &pending.grant_id);
        let execution = result?;
        Ok(EditExecution {
            execution,
            label: pending.label,
            domain: pending.domain,
            file_path: pending.file_path,
            grant_release_error: released.err(),
            reload_required: true,
            reload_note: RELOAD_NOTE,
        })
    }

    /// Gives up a previewed edit: its grant is revoked and the preview cancelled.
    /// Safe to repeat.
    pub fn discard_edit(
        &self,
        ctx: &ResourceWriteContext<'_>,
        operation_id: &str,
    ) -> Result<(), AppError> {
        let pending = lock(&self.edits)?.remove(operation_id);
        if let Some(pending) = pending {
            release_grant(ctx.grants, &pending.grant_id)?;
        }
        match ctx.operations.get(operation_id) {
            Ok(details) if details.status == OperationStatus::Previewed => {
                ctx.operations.cancel(operation_id).map(|_| ())
            }
            Ok(_) => Ok(()),
            Err(error) if error.code() == AppErrorCode::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

/// Runs `action` against the real system while holding the discovery gate, so
/// one rediscovery runs at a time.
pub fn with_discovery<T>(
    action: impl FnOnce(&Discovery<'_>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let _gate = acquire_gate().map_err(AppError::from)?;
    with_system(action)
}

/// Removes the adoption record of a job the backend still sees as adopted. The
/// plist is not touched.
pub fn release_record(
    discovery: &Discovery<'_>,
    adoptions: &AdoptionStore,
    request: &ServiceRequest,
) -> Result<ReleaseOutcome, AppError> {
    adopted_target(discovery, adoptions, request)?;
    let released = adoptions.remove(request.domain, &request.label)?;
    Ok(ReleaseOutcome {
        label: request.label.clone(),
        domain: request.domain,
        released,
        plist_changed: false,
    })
}

fn run_edit(
    discovery: &Discovery<'_>,
    adoptions: &AdoptionStore,
    ctx: &ResourceWriteContext<'_>,
    writes: &ResourceWriteCoordinator,
    operation_id: &str,
    pending: &PendingEdit,
) -> Result<ResourceWriteExecution, AppError> {
    let service = ServiceRequest {
        domain: pending.domain,
        label: pending.label.clone(),
    };
    match adopted_target(discovery, adoptions, &service) {
        Ok(target) if target.config_path == pending.config_path => {}
        Ok(_) => {
            let _ = ctx.operations.cancel(operation_id);
            return Err(AppError::conflict("任务配置位置已变化，请重新预览。"));
        }
        Err(error) => {
            let _ = ctx.operations.cancel(operation_id);
            return Err(error);
        }
    }
    writes.execute_launch_agent_replace(
        ctx,
        &ConfirmRequest {
            operation_id: operation_id.to_owned(),
            grant_id: pending.grant_id.clone(),
            relative: None,
        },
        |written| {
            plist::Value::from_reader_xml(Cursor::new(written))
                .map(|_| ())
                .map_err(|_| AppError::validation_failed("写入后的 plist 无法解析。"))
        },
    )
}

/// Adoption proper: the job is judged again, the original is backed up, the
/// record is added, and both are read back. A failed read-back takes the record
/// away again.
fn adopt_now(
    discovery: &Discovery<'_>,
    adoptions: &AdoptionStore,
    ctx: &ResourceWriteContext<'_>,
    request: &ServiceRequest,
    expected_sha256: &str,
) -> Result<(String, String), AppError> {
    let target = resolve_adoption(discovery, adoptions, request)?;
    if target.sha256 != expected_sha256 {
        return Err(AppError::conflict(
            "任务或 plist 在预览后已变化，请重新预览。",
        ));
    }
    let backup = create_backup(
        ctx.environment,
        BACKUP_APP_ID,
        &backup_config_id(request.domain, &request.label),
        &target.bytes,
        target.mode,
        ctx.retention,
    )?;
    adoptions.add(AdoptionRecord {
        domain: request.domain,
        label: request.label.clone(),
        path: target.file_path.clone(),
        sha256: target.sha256.clone(),
        adopted_at_epoch_ms: now_epoch_ms(),
    })?;
    if !read_back(adoptions, request, &target) {
        let _ = adoptions.remove(request.domain, &request.label);
        return Err(AppError::validation_failed(
            "接管记录回读不一致，已撤销接管。",
        ));
    }
    Ok((backup.metadata.backup_id, target.file_path))
}

fn read_back(adoptions: &AdoptionStore, request: &ServiceRequest, target: &AdoptionTarget) -> bool {
    let recorded = adoptions.load().is_ok_and(|records| {
        records.iter().any(|record| {
            record.domain == request.domain
                && record.label == request.label
                && record.path == target.file_path
                && record.sha256 == target.sha256
        })
    });
    recorded
        && read_regular(&target.config_path)
            .is_some_and(|(bytes, _)| hash_bytes(&bytes) == target.sha256)
}

/// Rediscovers the job and asks the admission rules. Nothing is changed.
fn resolve_adoption(
    discovery: &Discovery<'_>,
    adoptions: &dyn AdoptionRecords,
    request: &ServiceRequest,
) -> Result<AdoptionTarget, AppError> {
    Label::parse(&request.label).map_err(|_| OwnershipError::InvalidLabel)?;
    let found = discover(discovery);
    let trusted = domain_trusted(&found, request.domain);
    let matches: Vec<&LaunchdService> = found
        .services
        .iter()
        .filter(|service| service.domain == request.domain && service.label == request.label)
        .collect();
    let service = match matches.as_slice() {
        [only] => *only,
        [] => return Err(OwnershipError::NotFound.into()),
        _ => {
            return Err(AppError::permission_denied(
                "同一 label 有多个定义，无法接管。",
            ));
        }
    };
    let file = match service.config_files.as_slice() {
        [file] => file,
        _ => {
            return Err(AppError::permission_denied(
                "该任务没有或有多个配置文件，无法接管。",
            ));
        }
    };
    let config_path =
        expand_home(&file.path, discovery.home.as_deref()).ok_or(OwnershipError::NotFound)?;
    let (bytes, mode) = read_regular(&config_path).unwrap_or_default();
    let admitted =
        admit(service, discovery.uid, adoptions, trusted, &bytes).map_err(refusals_error)?;
    Ok(AdoptionTarget {
        file_path: file.path.clone(),
        config_path,
        bytes,
        mode,
        sha256: admitted.sha256,
    })
}

fn adopted_target(
    discovery: &Discovery<'_>,
    adoptions: &dyn AdoptionRecords,
    request: &ServiceRequest,
) -> Result<ModifiableTarget, AppError> {
    let target = ensure_modifiable(discovery, adoptions, request)?;
    if target.ownership != Ownership::UserhomeAdopted {
        return Err(AppError::permission_denied(
            "只能对已接管的任务执行此操作。",
        ));
    }
    Ok(target)
}

fn refusals_error(refusals: Vec<Refusal>) -> AppError {
    let texts: Vec<&str> = refusals.into_iter().map(refusal_text).collect();
    AppError::permission_denied(&format!("该任务不能接管：{}", texts.join("；")))
}

/// The bytes and permission bits of a regular file, read without following a
/// link and with one byte past the limit, so an oversized file is refused by
/// the rules rather than read whole.
fn read_regular(path: &Path) -> Option<(Vec<u8>, u32)> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_PLIST_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    Some((bytes, metadata.permissions().mode() & 0o777))
}

fn release_grant(grants: &GrantCoordinator, grant_id: &GrantId) -> Result<(), AppError> {
    match grants.revoke(grant_id) {
        Ok(()) | Err(GrantError::UnknownGrant) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn prune_adoptions(
    pending: &Mutex<HashMap<String, PendingAdoption>>,
    operations: &OperationCoordinator,
) -> Result<(), AppError> {
    lock(pending)?.retain(|operation_id, _| is_previewed(operations, operation_id));
    Ok(())
}

fn prune_edits(
    pending: &Mutex<HashMap<String, PendingEdit>>,
    ctx: &ResourceWriteContext<'_>,
) -> Result<(), AppError> {
    let mut edits = lock(pending)?;
    let gone: Vec<String> = edits
        .keys()
        .filter(|operation_id| !is_previewed(ctx.operations, operation_id))
        .cloned()
        .collect();
    for operation_id in gone {
        if let Some(edit) = edits.remove(&operation_id) {
            let _ = ctx.grants.revoke(&edit.grant_id);
        }
    }
    Ok(())
}

fn is_previewed(operations: &OperationCoordinator, operation_id: &str) -> bool {
    operations
        .get(operation_id)
        .is_ok_and(|details| details.status == OperationStatus::Previewed)
}

fn lock<T>(mutex: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, AppError> {
    mutex.lock().map_err(|_| AppError::internal())
}

fn adoption_intent(domain: LaunchdDomain, label: &str, sha256: &str) -> OperationIntent {
    OperationIntent::new(
        OperationKind::ResourceWrite,
        format!("launchd:{}/{label}", domain_name(domain)),
        BTreeMap::from([
            ("action".to_owned(), "adopt".to_owned()),
            ("sha256".to_owned(), sha256.to_owned()),
        ]),
    )
}

fn backup_config_id(domain: LaunchdDomain, label: &str) -> String {
    let digest = hash_bytes(format!("{}/{label}", domain_name(domain)).as_bytes());
    format!("adopt-{}", &digest[..32])
}

fn domain_name(domain: LaunchdDomain) -> &'static str {
    match domain {
        LaunchdDomain::Gui => "gui",
        LaunchdDomain::System => "system",
    }
}

fn expand_home(path: &str, home: Option<&Path>) -> Option<PathBuf> {
    match path.strip_prefix("~/") {
        Some(rest) => home.map(|home| home.join(rest)),
        None => Some(PathBuf::from(path)),
    }
}

fn tilde_path(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) if !rest.as_os_str().is_empty() => format!("~/{}", rest.to_string_lossy()),
        _ => path.to_string_lossy().into_owned(),
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}
