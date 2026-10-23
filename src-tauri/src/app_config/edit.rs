//! Read, preview and confirm for writable application configs. Every write is
//! preview -> confirm: the preview binds the exact text, confirm re-checks the
//! file hash, backs up the original, replaces atomically, then verifies.

use std::{
    collections::HashSet,
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Instant,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    app_config::{
        discover::{ConfigFs, FsError, Located, ProbeStatus, locate},
        patch::{
            Change, Lookup, RawError, apply_change, check_raw, lookup, raw_secret_present,
            scalar_value,
        },
        pending::{AppConfigEditState, PendingEdit},
        read::{REDACTED, ReadResult, read_entry},
        registry::{Capability, Entry, Location, Registry, resolve_path},
        schema::{EditSchema, FieldSpec, schema_for, typed_value},
    },
    config::{
        ConfigEnvironment,
        atomic::{
            AtomicReplaceError, atomic_create_new, atomic_replace,
            restore_backup_after_commit_failure,
        },
        backup::{BackupRecord, create_backup},
        diff::unified_text,
        read::{hash_bytes, read_bounded},
    },
    error::AppError,
    grants::is_below_home,
    environment::dotenv::value_looks_secret,
    settings::BackupRetention,
};

pub const MAX_RAW_BYTES: usize = 512 * 1024;
const APP_ID: &str = "app-config";
const NEW_FILE_MODE: u32 = 0o600;
const NOT_EDITABLE: &str = "该应用配置暂不支持在应用内编辑。";
const SECRET_RAW_REASON: &str = "文件里有疑似秘密的值，请用外部编辑器修改。";
const OUTSIDE_HOME: &str = "配置文件位于主目录之外，不能在应用内修改。";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub path: PathBuf,
    pub exists: bool,
}

struct Loaded {
    exists: bool,
    bytes: Vec<u8>,
}

/// Writes that touch the real disk. Confirm goes through this so tests can replace it.
pub(crate) trait ConfigStore {
    fn mode(&self, path: &Path) -> Result<u32, AppError>;
    fn read(&self, path: &Path) -> Result<Vec<u8>, AppError>;
    fn create_new(&self, path: &Path, bytes: &[u8], mode: u32) -> Result<(), AppError>;
    fn backup(&self, config_id: &str, bytes: &[u8], mode: u32) -> Result<BackupRecord, AppError>;
    fn replace(
        &self,
        path: &Path,
        bytes: &[u8],
        mode: u32,
        before_hash: &str,
    ) -> Result<(), AtomicReplaceError>;
    fn restore(&self, path: &Path, backup: &BackupRecord) -> Result<(), AppError>;
}

struct DiskStore<'a> {
    environment: &'a ConfigEnvironment,
    retention: BackupRetention,
}

impl ConfigStore for DiskStore<'_> {
    fn mode(&self, path: &Path) -> Result<u32, AppError> {
        let metadata = fs::metadata(path)
            .map_err(|_| AppError::permission_denied("无法读取配置文件，请检查文件权限。"))?;
        Ok(metadata.permissions().mode() & 0o777)
    }

    fn read(&self, path: &Path) -> Result<Vec<u8>, AppError> {
        read_bounded(path, MAX_RAW_BYTES)
    }

    fn create_new(&self, path: &Path, bytes: &[u8], mode: u32) -> Result<(), AppError> {
        atomic_create_new(path, bytes, mode)
    }

    fn backup(&self, config_id: &str, bytes: &[u8], mode: u32) -> Result<BackupRecord, AppError> {
        create_backup(self.environment, APP_ID, config_id, bytes, mode, self.retention)
    }

    fn replace(
        &self,
        path: &Path,
        bytes: &[u8],
        mode: u32,
        before_hash: &str,
    ) -> Result<(), AtomicReplaceError> {
        atomic_replace(path, bytes, mode, Some((before_hash, MAX_RAW_BYTES)))
    }

    fn restore(&self, path: &Path, backup: &BackupRecord) -> Result<(), AppError> {
        restore_backup_after_commit_failure(path, backup, MAX_RAW_BYTES)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldReadout {
    pub path: &'static str,
    pub present: bool,
    pub value: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRead {
    pub fields: Vec<FieldReadout>,
    pub raw_text: Option<String>,
    pub hash: String,
    pub raw_blocked_reason: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditMode {
    Fields,
    Raw,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FieldChange {
    pub path: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewInput {
    pub id: String,
    pub mode: EditMode,
    #[serde(default)]
    pub changes: Vec<FieldChange>,
    #[serde(default)]
    pub raw_text: Option<String>,
    pub expected_hash: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewIssue {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    pub ok: bool,
    pub errors: Vec<PreviewIssue>,
    pub diff: String,
    pub warnings: Vec<String>,
    pub preview_token: Option<String>,
}

pub fn ensure_writable(entry: &Entry) -> Result<(), AppError> {
    if entry.capability == Capability::Writable {
        Ok(())
    } else {
        Err(AppError::not_supported(NOT_EDITABLE))
    }
}

pub fn resolve_target(entry: &Entry, home: &Path, fs: &dyn ConfigFs) -> Result<Target, AppError> {
    if matches!(entry.location, Location::Fixed(_)) {
        return Err(AppError::not_supported(NOT_EDITABLE));
    }
    match locate(entry, home, fs) {
        Located::Found { path, .. } => Ok(Target { path, exists: true }),
        // The list only includes existing entries; this branch is kept for later.
        Located::Unavailable(ProbeStatus::NotFound) => creatable_target(entry, home, fs),
        Located::Unavailable(ProbeStatus::OutOfBounds) => Err(AppError::permission_denied(OUTSIDE_HOME)),
        Located::Unavailable(ProbeStatus::SymlinkOrNonRegular) => Err(AppError::permission_denied(
            "配置文件是符号链接或特殊文件，不能在应用内修改，请用外部编辑器。",
        )),
        Located::Unavailable(ProbeStatus::Inaccessible) => Err(AppError::permission_denied(
            "无法访问配置文件，请检查文件权限。",
        )),
        Located::Unavailable(ProbeStatus::Found(_)) => Err(AppError::internal()),
    }
}

/// A missing file may be created only inside `$HOME`, in a directory that already exists.
fn creatable_target(entry: &Entry, home: &Path, fs: &dyn ConfigFs) -> Result<Target, AppError> {
    let declared = resolve_path(entry, home);
    let (Some(parent), Some(leaf)) = (declared.parent(), declared.file_name()) else {
        return Err(AppError::internal());
    };
    let canonical_home = fs
        .canonicalize(home)
        .map_err(|_| AppError::not_found("无法确定主目录，应用配置不可用。"))?;
    let real_parent = fs.canonicalize(parent).map_err(|_| {
        AppError::not_found("配置文件所在的目录不存在，请先创建该目录再修改。")
    })?;
    if !is_below_home(&real_parent, Some(&canonical_home)) {
        return Err(AppError::permission_denied(OUTSIDE_HOME));
    }
    Ok(Target {
        path: real_parent.join(leaf),
        exists: false,
    })
}

fn load(target: &Target, fs: &dyn ConfigFs) -> Result<Loaded, AppError> {
    if !target.exists {
        return Ok(Loaded {
            exists: false,
            bytes: Vec::new(),
        });
    }
    let bytes = fs
        .read_bounded(&target.path, MAX_RAW_BYTES)
        .map_err(|error| match error {
            FsError::TooLarge => AppError::validation_failed("配置文件超过 512 KiB，请用外部编辑器修改。"),
            FsError::NotFound => AppError::not_found("配置文件已不存在，请重新读取。"),
            FsError::PermissionDenied | FsError::Other => {
                AppError::permission_denied("无法读取配置文件，请检查文件权限。")
            }
        })?;
    Ok(Loaded {
        exists: true,
        bytes,
    })
}

fn text_of(bytes: &[u8]) -> Result<String, AppError> {
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        AppError::validation_failed("配置文件不是 UTF-8 文本，请用外部编辑器修改。")
    })
}

pub fn read_for_edit(entry: &Entry, home: &Path, fs: &dyn ConfigFs) -> Result<EditRead, AppError> {
    ensure_writable(entry)?;
    let schema = schema_for(entry.id, entry.format).ok_or_else(|| AppError::not_supported(NOT_EDITABLE))?;
    let target = resolve_target(entry, home, fs)?;
    let loaded = load(&target, fs)?;
    let hash = hash_bytes(&loaded.bytes);
    let text = text_of(&loaded.bytes)?;
    let fields = schema
        .fields
        .iter()
        .map(|field| field_readout(entry, &text, field))
        .collect();
    let (raw_text, raw_blocked_reason) = if raw_secret_present(entry.format, &text) {
        (None, Some(SECRET_RAW_REASON))
    } else {
        (Some(text), None)
    };
    Ok(EditRead {
        fields,
        raw_text,
        hash,
        raw_blocked_reason,
    })
}

fn field_readout(entry: &Entry, text: &str, field: &FieldSpec) -> FieldReadout {
    match lookup(entry.format, text, field.path) {
        Lookup::Absent => FieldReadout {
            path: field.path,
            present: false,
            value: None,
        },
        Lookup::Present(scalar) => {
            let hidden = scalar
                .as_ref()
                .is_some_and(|scalar| value_looks_secret(field.path, scalar.raw()));
            let value = match (&scalar, hidden) {
                (Some(scalar), false) => scalar_value(field, scalar),
                _ => None,
            };
            FieldReadout {
                path: field.path,
                present: true,
                value,
            }
        }
    }
}

struct Plan {
    proposed: String,
    issues: Vec<PreviewIssue>,
    warnings: Vec<String>,
}

impl Plan {
    fn new(proposed: String) -> Self {
        Self {
            proposed,
            issues: Vec::new(),
            warnings: Vec::new(),
        }
    }

    fn issue(&mut self, path: Option<&str>, line: Option<usize>, message: impl Into<String>) {
        self.issues.push(PreviewIssue {
            path: path.map(str::to_owned),
            line,
            message: message.into(),
        });
    }
}

pub fn preview(
    entry: &Entry,
    home: &Path,
    fs: &dyn ConfigFs,
    state: &AppConfigEditState,
    input: &PreviewInput,
) -> Result<PreviewResult, AppError> {
    ensure_writable(entry)?;
    let schema = schema_for(entry.id, entry.format).ok_or_else(|| AppError::not_supported(NOT_EDITABLE))?;
    let target = resolve_target(entry, home, fs)?;
    let loaded = load(&target, fs)?;
    let current_hash = hash_bytes(&loaded.bytes);
    if input.expected_hash != current_hash {
        return Err(AppError::conflict("配置文件已经变化，请重新读取后再预览。"));
    }
    let current = text_of(&loaded.bytes)?;
    if input.mode == EditMode::Raw && raw_secret_present(entry.format, &current) {
        return Ok(PreviewResult {
            ok: false,
            errors: vec![PreviewIssue {
                path: None,
                line: None,
                message: SECRET_RAW_REASON.to_owned(),
            }],
            diff: String::new(),
            warnings: Vec::new(),
            preview_token: None,
        });
    }
    let mut plan = match input.mode {
        EditMode::Fields => plan_fields(entry.format, &schema, &current, &input.changes),
        EditMode::Raw => plan_raw(entry.format, input.raw_text.as_deref()),
    };
    if plan.proposed.as_bytes() == loaded.bytes.as_slice() {
        plan.issue(None, None, "没有需要保存的改动。");
    }
    if !plan.issues.is_empty() {
        return Ok(PreviewResult {
            ok: false,
            errors: plan.issues,
            diff: String::new(),
            warnings: plan.warnings,
            preview_token: None,
        });
    }
    let diff = masked_diff(&current, &plan.proposed);
    let token = Uuid::new_v4().to_string();
    state.remember(PendingEdit {
        token: token.clone(),
        entry_id: entry.id,
        path: target.path,
        exists: loaded.exists,
        before_hash: current_hash,
        proposed: plan.proposed,
        created: Instant::now(),
    })?;
    Ok(PreviewResult {
        ok: true,
        errors: Vec::new(),
        diff,
        warnings: plan.warnings,
        preview_token: Some(token),
    })
}

fn plan_fields(format: crate::app_config::registry::Format, schema: &EditSchema, current: &str, changes: &[FieldChange]) -> Plan {
    let mut plan = Plan::new(current.to_owned());
    if !schema.visual_supported {
        plan.issue(None, None, "这个文件只能使用高级模式修改。");
        return plan;
    }
    let mut seen = HashSet::new();
    for change in changes {
        let Some(field) = schema.fields.iter().find(|field| field.path == change.path) else {
            plan.issue(Some(change.path.as_str()), None, "不支持修改这个字段。");
            continue;
        };
        if !seen.insert(field.path) {
            plan.issue(Some(field.path), None, "同一个字段只能修改一次。");
            continue;
        }
        let operation = if change.value.is_null() {
            if lookup(format, &plan.proposed, field.path) == Lookup::Absent {
                plan.warnings
                    .push(format!("{}原本不存在，删除无需改动。", field.label));
            }
            Change::Delete
        } else {
            match typed_value(field, &change.value) {
                Ok(value) => Change::Set(value),
                Err(message) => {
                    plan.issue(Some(field.path), None, message);
                    continue;
                }
            }
        };
        match apply_change(format, &plan.proposed, field.path, &operation) {
            Ok(next) => plan.proposed = next,
            Err(message) => plan.issue(Some(field.path), None, message),
        }
    }
    if plan.issues.is_empty() {
        if let Err(RawError { line, message }) = check_raw(format, &plan.proposed) {
            plan.issue(None, line, message);
        }
    }
    plan
}

fn plan_raw(format: crate::app_config::registry::Format, raw: Option<&str>) -> Plan {
    let Some(raw) = raw else {
        let mut plan = Plan::new(String::new());
        plan.issue(None, None, "缺少要保存的内容。");
        return plan;
    };
    let mut plan = Plan::new(raw.to_owned());
    if raw.len() > MAX_RAW_BYTES {
        plan.issue(None, None, "内容超过 512 KiB，请用外部编辑器修改。");
        return plan;
    }
    if let Err(RawError { line, message }) = check_raw(format, raw) {
        plan.issue(None, line, message);
    }
    if raw_secret_present(format, raw) {
        plan.warnings
            .push("内容里有疑似秘密的值，保存后会写入文件，请确认。".to_owned());
    }
    plan
}

fn masked_diff(before: &str, after: &str) -> String {
    let unified = unified_text(before, after);
    if unified.is_empty() {
        return if before == after {
            String::new()
        } else {
            "只有文件末尾或换行符发生了变化。\n".to_owned()
        };
    }
    let mut output = String::new();
    for line in unified.lines() {
        output.push_str(&mask_diff_line(line));
        output.push('\n');
    }
    output
}

fn mask_diff_line(line: &str) -> String {
    let Some(body) = line.strip_prefix('+').or_else(|| line.strip_prefix('-')) else {
        return line.to_owned();
    };
    if body.starts_with('-') || body.starts_with('+') {
        return line.to_owned();
    }
    let Some(index) = body.find(['=', ':']) else {
        return line.to_owned();
    };
    let key = body[..index].trim().trim_matches('"');
    let value = body[index + 1..].trim();
    if value.is_empty() || !value_looks_secret(key, value) {
        return line.to_owned();
    }
    format!("{}{} {REDACTED}", &line[..1], body[..=index].trim_end())
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmInput {
    pub preview_token: String,
}

pub fn confirm(
    registry: &Registry,
    home: &Path,
    fs: &dyn ConfigFs,
    state: &AppConfigEditState,
    environment: &ConfigEnvironment,
    retention: BackupRetention,
    token: &str,
) -> Result<ReadResult, AppError> {
    let store = DiskStore {
        environment,
        retention,
    };
    confirm_at(registry, home, fs, &store, state, token, Instant::now())
}

pub(crate) fn confirm_at(
    registry: &Registry,
    home: &Path,
    fs: &dyn ConfigFs,
    store: &dyn ConfigStore,
    state: &AppConfigEditState,
    token: &str,
    now: Instant,
) -> Result<ReadResult, AppError> {
    let pending = state.take_at(token, now)?;
    let entry = registry
        .get(pending.entry_id)
        .map_err(|_| AppError::not_found("未知的应用配置条目。"))?;
    ensure_writable(entry)?;
    let target = resolve_target(entry, home, fs)?;
    if target.path != pending.path || target.exists != pending.exists {
        return Err(AppError::conflict("配置位置已变化，请重新预览。"));
    }
    let loaded = load(&target, fs)?;
    if hash_bytes(&loaded.bytes) != pending.before_hash {
        return Err(AppError::conflict(
            "配置文件已在预览后变化，请重新读取并预览。",
        ));
    }
    let mode = if target.exists {
        store.mode(&target.path)?
    } else {
        NEW_FILE_MODE
    };
    write_and_verify(
        store,
        &target,
        &loaded.bytes,
        mode,
        pending.proposed.as_bytes(),
        entry.id,
    )?;
    Ok(read_entry(entry, home, fs))
}

fn write_and_verify(
    store: &dyn ConfigStore,
    target: &Target,
    before: &[u8],
    mode: u32,
    proposed: &[u8],
    config_id: &str,
) -> Result<(), AppError> {
    if !target.exists {
        store.create_new(&target.path, proposed, mode)?;
        if store.read(&target.path)? != proposed {
            return Err(AppError::partial_failure(
                "写入后的内容与预览不一致，请检查该文件。",
                false,
            ));
        }
        return Ok(());
    }
    let backup = store.backup(config_id, before, mode)?;
    let before_hash = hash_bytes(before);
    match store.replace(&target.path, proposed, mode, &before_hash) {
        Ok(()) => {}
        Err(AtomicReplaceError::BeforeCommit(error)) => return Err(error),
        Err(AtomicReplaceError::AfterCommit(error)) => {
            store.restore(&target.path, &backup)?;
            return Err(error);
        }
    }
    if store.read(&target.path)? != proposed {
        store.restore(&target.path, &backup)?;
        return Err(AppError::partial_failure(
            "写入后的内容与预览不一致，已恢复原内容。",
            false,
        ));
    }
    Ok(())
}
