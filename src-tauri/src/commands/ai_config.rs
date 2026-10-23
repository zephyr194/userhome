//! AI CLI detection, Claude Code settings reads and the Claude Code settings edit
//! transaction. Paths never cross this boundary: the only caller-supplied values
//! are opaque grant ids, a fixed key path and a JSON value that is validated
//! against the definition before anything is written.

use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::{
    ai_config::{
        command::{
            BuiltCommand, CLAUDE_CODE_TOOL_ID, CommandRequest, OptionSummary, build_claude_command,
            option_summary,
        },
        detect::{
            AiConfigReport, InstallSource, ProbeEnv, SystemVersionProbe, ToolProfile, ToolReport,
            detect_all, detect_claude_version, detect_tool, fixed_locations, profile_for_tool_id,
        },
        read::{
            ClaudeLocations, ClaudeReadView, ClaudeSnapshotSummary, MAX_SETTINGS_BYTES,
            claude_tool, managed_directory, read_claude_view, snapshot_summary, value_type_label,
        },
        reference::{ToolReference, is_reference_tool_id, tool_reference},
        registry::{
            CoverageStatus, Definitions, SettingDefinition, ToolDefinition, ValueType,
            VerifiedVersions,
        },
        terminal::{SystemLauncher, TerminalPlan, open_command, terminal_directory},
        validate::load_all,
        write::{
            EditAction, EditGate, EditRefusal, EditRequest, apply_edit, edit_gate, is_settings_file,
        },
    },
    app_config::{discover::StdFs, registry::Registry},
    brew::{
        actions::BrewAction,
        client::{BrewClient, BrewClientError, BrewCommand},
    },
    commands::grants::canonical_home,
    config::{
        ConfigCoordinator,
        diff::{ConfigDiff, build_diff},
        read::hash_bytes,
    },
    error::AppError,
    grants::{
        ConfirmRequest, GrantCoordinator, GrantId, GrantKind, GrantPurpose, ReadError,
        RecoveryPoint, ResourceWriteContext, ResourceWriteCoordinator, WriteKind, WriteOutcome,
        WriteRequest,
    },
    operations::{OperationCoordinator, OperationIntent, OperationKind, sanitize_payload},
    settings::SettingsCoordinator,
};

const MAX_PENDING_CLAUDE_EDITS: usize = 32;
const MAX_CATALOG_TEXT_CHARS: usize = 200;
const RELOAD_NOTE: &str = "已写入设置文件。多数设置需新会话或重载后才生效，具体以官方说明为准；本操作不会改变正在运行的 Claude Code 会话。";

#[tauri::command]
pub async fn ai_config_detect() -> Result<AiConfigReport, AppError> {
    let registry =
        Registry::builtin().map_err(|_| AppError::validation_failed("应用配置注册表校验失败。"))?;
    let home =
        canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，AI 配置不可用。"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let locations = fixed_locations(&home);
        detect_all(&ProbeEnv {
            home: &home,
            locations: &locations,
            version: &SystemVersionProbe,
            fs: &StdFs,
            registry: &registry,
        })
    })
    .await
    .map_err(|_| AppError::internal())
}

#[tauri::command]
pub fn ai_config_claude_snapshot() -> Result<ClaudeSnapshotSummary, AppError> {
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    Ok(snapshot_summary(tool))
}

#[tauri::command]
pub fn ai_config_tool_reference(tool_id: String) -> Result<ToolReference, AppError> {
    if !is_reference_tool_id(&tool_id) {
        return Err(AppError::invalid_input(
            "未知的 AI 工具，无法展示官方设置参考。",
        ));
    }
    let definitions =
        load_all().map_err(|_| AppError::validation_failed("AI 配置定义校验失败。"))?;
    let tool = definitions
        .tools
        .iter()
        .find(|tool| tool.id == tool_id)
        .ok_or_else(|| AppError::not_found("未找到该工具的官方设置参考。"))?;
    Ok(tool_reference(tool))
}

#[tauri::command]
pub fn ai_config_claude_read(
    project_grant_id: Option<String>,
    coordinator: State<'_, GrantCoordinator>,
) -> Result<ClaudeReadView, AppError> {
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    let home =
        canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，AI 配置不可用。"))?;
    let project = match project_grant_id {
        None => None,
        Some(raw) => Some(project_directory(&coordinator, &raw)?),
    };
    let locations = ClaudeLocations {
        home,
        project,
        managed_dir: managed_directory(),
    };
    Ok(read_claude_view(tool, &locations, &StdFs))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEditItem {
    pub key_path: String,
    pub value_type: &'static str,
    pub allowed_values: Vec<String>,
    pub editable: bool,
    pub reason: Option<&'static str>,
    pub verified_version: Option<String>,
    pub description: String,
    pub description_truncated: bool,
    pub default_note: String,
    pub source_url: String,
    pub source_retrieved_on: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEditCatalog {
    pub detected_version: Option<String>,
    pub items: Vec<ClaudeEditItem>,
}

#[tauri::command]
pub async fn ai_config_claude_edit_catalog() -> Result<ClaudeEditCatalog, AppError> {
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    let detected = detected_claude_version().await?;
    let items = tool
        .settings
        .iter()
        .map(|setting| catalog_item(setting, detected.as_deref()))
        .collect();
    Ok(ClaudeEditCatalog {
        detected_version: detected,
        items,
    })
}

fn catalog_item(setting: &SettingDefinition, detected: Option<&str>) -> ClaudeEditItem {
    let (editable, reason) = edit_status(setting, detected);
    let (description, description_truncated) = bounded_text(&setting.description);
    let (default_note, _) = bounded_text(&setting.default_note);
    ClaudeEditItem {
        key_path: setting.key_path.clone(),
        value_type: value_type_label(setting.value_type),
        allowed_values: setting.allowed_values.clone(),
        editable,
        reason,
        verified_version: verified_version_label(setting.versions.as_ref()),
        description,
        description_truncated,
        default_note,
        source_url: setting.source.url.clone(),
        source_retrieved_on: setting.source.retrieved_on.clone(),
    }
}

fn verified_version_label(versions: Option<&VerifiedVersions>) -> Option<String> {
    versions.map(|range| {
        if range.min == range.max {
            range.min.clone()
        } else {
            format!("{} 至 {}", range.min, range.max)
        }
    })
}

fn bounded_text(text: &str) -> (String, bool) {
    match text.char_indices().nth(MAX_CATALOG_TEXT_CHARS) {
        Some((index, _)) => (text[..index].to_owned(), true),
        None => (text.to_owned(), false),
    }
}

fn edit_status(
    setting: &SettingDefinition,
    detected: Option<&str>,
) -> (bool, Option<&'static str>) {
    if setting.secret {
        return (false, Some("敏感键，本批不开放编辑"));
    }
    if !setting.risks.is_empty() {
        return (false, Some("风险设置，本批不开放编辑"));
    }
    if setting.coverage != CoverageStatus::Editable {
        let reason = if setting.value_type == ValueType::Unknown {
            "类型未核实，仅展示"
        } else {
            "仅展示，版本未核实"
        };
        return (false, Some(reason));
    }
    match edit_gate(setting.versions.as_ref(), detected) {
        EditGate::Open => (true, None),
        EditGate::RangeUnverified => (false, Some("版本未确认，写入已禁用：尚无已验证的版本区间")),
        EditGate::VersionUnknown => (false, Some("版本未确认，写入已禁用：未能检测本机版本")),
        EditGate::OutOfRange => (
            false,
            Some("版本未确认，写入已禁用：本机版本不在已验证区间内"),
        ),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaudeEditInput {
    pub grant_id: String,
    pub key_path: String,
    pub action: String,
    #[serde(default)]
    pub value: Option<Value>,
}

impl ClaudeEditInput {
    fn edit_request(&self) -> Result<EditRequest, AppError> {
        let action = match (self.action.as_str(), &self.value) {
            ("set", Some(value)) => EditAction::SetValue(value.clone()),
            ("restoreDefault", None) => EditAction::RestoreDefault,
            ("setNull", None) => EditAction::SetNull,
            _ => return Err(AppError::invalid_input("编辑操作无效。")),
        };
        Ok(EditRequest {
            key_path: self.key_path.clone(),
            action,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEditPreview {
    pub operation_id: String,
    pub summary: String,
    pub effects: Vec<String>,
    pub expires_at: String,
    pub key_path: String,
    pub action: String,
    pub kind: WriteKind,
    pub recovery_point: RecoveryPoint,
    pub diff: ConfigDiff,
    pub reload_note: &'static str,
}

#[tauri::command]
pub async fn ai_config_claude_preview_edit(
    app: AppHandle,
    input: ClaudeEditInput,
) -> Result<ClaudeEditPreview, AppError> {
    let grant_id = GrantId::parse(&input.grant_id)?;
    let request = input.edit_request()?;
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    let detected = detected_claude_version().await?;
    with_write_context(&app, |ctx, writes| {
        ensure_settings_grant(ctx.grants, &grant_id)?;
        let current = read_current(ctx.grants, &grant_id)?;
        let before_text = current
            .as_ref()
            .map_or("{}", |current| current.text.as_str());
        let proposed = apply_edit(before_text, tool, &request).map_err(refusal_error)?;
        ensure_edit_gate(tool, &request.key_path, detected.as_deref())?;

        let before_root = serde_json::from_str::<Value>(before_text).ok();
        let before_value = before_root
            .as_ref()
            .and_then(|root| value_at(root, &request.key_path));
        let null = Value::Null;
        let after_value = match &request.action {
            EditAction::SetValue(value) => Some(value),
            EditAction::SetNull => Some(&null),
            EditAction::RestoreDefault => None,
        };
        let diff = key_diff(&request.key_path, before_value, after_value);

        let batch = writes.preview(
            ctx,
            vec![WriteRequest {
                grant_id: grant_id.clone(),
                relative: None,
                expected_sha256: current.as_ref().map(|current| current.sha256.clone()),
                content: proposed.clone(),
                sensitive: true,
            }],
        )?;
        let step = batch
            .steps
            .into_iter()
            .next()
            .ok_or_else(AppError::internal)?;
        let operation_id = step.operation.operation_id.clone();
        app.state::<ClaudeEditState>().remember(PendingClaudeEdit {
            operation_id: operation_id.clone(),
            key_path: request.key_path.clone(),
            proposed_sha256: hash_bytes(proposed.as_bytes()),
        })?;
        Ok(ClaudeEditPreview {
            operation_id,
            summary: step.operation.summary,
            effects: step.operation.effects,
            expires_at: step.operation.expires_at,
            key_path: request.key_path,
            action: input.action,
            kind: step.kind,
            recovery_point: step.recovery_point,
            diff,
            reload_note: RELOAD_NOTE,
        })
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClaudeConfirmInput {
    pub operation_id: String,
    pub grant_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeEditResult {
    pub operation_id: String,
    pub outcome: WriteOutcome,
    pub reload_note: &'static str,
}

#[tauri::command]
pub async fn ai_config_claude_confirm_edit(
    app: AppHandle,
    input: ClaudeConfirmInput,
) -> Result<ClaudeEditResult, AppError> {
    let grant_id = GrantId::parse(&input.grant_id)?;
    let pending = app.state::<ClaudeEditState>().find(&input.operation_id)?;
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    let detected = detected_claude_version().await?;
    ensure_edit_gate(tool, &pending.key_path, detected.as_deref())?;

    let confirm = ConfirmRequest {
        operation_id: input.operation_id.clone(),
        grant_id: grant_id.clone(),
        relative: None,
    };
    let expected = pending.proposed_sha256.clone();
    let execution = with_write_context(&app, |ctx, writes| {
        ensure_settings_grant(ctx.grants, &grant_id)?;
        writes.execute_with(ctx, &confirm, |bytes| {
            if hash_bytes(bytes) == expected {
                Ok(())
            } else {
                Err(AppError::conflict("写入内容与预览不一致，已取消。"))
            }
        })
    })?;
    app.state::<ClaudeEditState>().forget(&input.operation_id);
    Ok(ClaudeEditResult {
        operation_id: input.operation_id,
        outcome: execution.outcome,
        reload_note: RELOAD_NOTE,
    })
}

struct PendingClaudeEdit {
    operation_id: String,
    key_path: String,
    proposed_sha256: String,
}

#[derive(Default)]
pub struct ClaudeEditState {
    pending: Mutex<Vec<PendingClaudeEdit>>,
}

impl ClaudeEditState {
    fn remember(&self, entry: PendingClaudeEdit) -> Result<(), AppError> {
        let mut pending = self.pending.lock().map_err(|_| AppError::internal())?;
        if pending.len() >= MAX_PENDING_CLAUDE_EDITS {
            pending.remove(0);
        }
        pending.push(entry);
        Ok(())
    }

    fn find(&self, operation_id: &str) -> Result<PendingClaudeEdit, AppError> {
        let pending = self.pending.lock().map_err(|_| AppError::internal())?;
        pending
            .iter()
            .find(|entry| entry.operation_id == operation_id)
            .map(|entry| PendingClaudeEdit {
                operation_id: entry.operation_id.clone(),
                key_path: entry.key_path.clone(),
                proposed_sha256: entry.proposed_sha256.clone(),
            })
            .ok_or_else(AppError::operation_not_found)
    }

    fn forget(&self, operation_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|entry| entry.operation_id != operation_id);
        }
    }
}

fn load_claude_definitions() -> Result<Definitions, AppError> {
    load_all().map_err(|_| AppError::validation_failed("AI 配置定义校验失败。"))
}

async fn detected_claude_version() -> Result<Option<String>, AppError> {
    let registry =
        Registry::builtin().map_err(|_| AppError::validation_failed("应用配置注册表校验失败。"))?;
    let home =
        canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，AI 配置不可用。"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let locations = fixed_locations(&home);
        detect_claude_version(&ProbeEnv {
            home: &home,
            locations: &locations,
            version: &SystemVersionProbe,
            fs: &StdFs,
            registry: &registry,
        })
    })
    .await
    .map_err(|_| AppError::internal())
}

fn ensure_edit_gate(
    tool: &ToolDefinition,
    key_path: &str,
    detected: Option<&str>,
) -> Result<(), AppError> {
    let setting = tool
        .settings
        .iter()
        .find(|setting| setting.key_path == key_path)
        .ok_or_else(|| AppError::invalid_input("该键不在已登记的 Claude Code 设置中。"))?;
    match edit_gate(setting.versions.as_ref(), detected) {
        EditGate::Open => Ok(()),
        EditGate::RangeUnverified => Err(AppError::validation_failed(
            "版本未确认，写入已禁用：尚无已验证的版本区间。",
        )),
        EditGate::VersionUnknown => Err(AppError::validation_failed(
            "版本未确认，写入已禁用：未能检测本机 Claude Code 版本。",
        )),
        EditGate::OutOfRange => Err(AppError::validation_failed(
            "版本未确认，写入已禁用：本机版本不在已验证区间内。",
        )),
    }
}

fn ensure_settings_grant(
    coordinator: &GrantCoordinator,
    grant_id: &GrantId,
) -> Result<(), AppError> {
    let record = coordinator.resolve(grant_id)?;
    if record.kind != GrantKind::File || record.purpose != GrantPurpose::ConfigFile {
        return Err(AppError::invalid_input("所选授权不是配置文件授权。"));
    }
    if !is_settings_file(&record.target_path()) {
        return Err(AppError::validation_failed(
            "所选文件不是 Claude Code 设置文件（需为 .claude 目录内的 settings.json 或 settings.local.json）。",
        ));
    }
    Ok(())
}

fn project_directory(coordinator: &GrantCoordinator, raw: &str) -> Result<PathBuf, AppError> {
    let record = coordinator.resolve(&GrantId::parse(raw)?)?;
    if record.kind != GrantKind::Directory || record.purpose != GrantPurpose::ConfigDirectory {
        return Err(AppError::validation_failed("所选授权不是项目目录。"));
    }
    Ok(record.target_path())
}

struct CurrentSettings {
    text: String,
    sha256: String,
}

fn read_current(
    coordinator: &GrantCoordinator,
    grant_id: &GrantId,
) -> Result<Option<CurrentSettings>, AppError> {
    match coordinator.read_resource_with_limit(grant_id, None, MAX_SETTINGS_BYTES) {
        Ok(read) => {
            let text = read
                .text()
                .map_err(|_| {
                    AppError::validation_failed("设置文件不是有效的 UTF-8 文本，未修改。")
                })?
                .to_owned();
            Ok(Some(CurrentSettings {
                text,
                sha256: read.fingerprint.sha256.clone(),
            }))
        }
        Err(ReadError::NotFound) => Ok(None),
        Err(error) => Err(settings_read_error(error)),
    }
}

fn settings_read_error(error: ReadError) -> AppError {
    match error {
        ReadError::NotFound => AppError::not_found("所选设置文件不存在。"),
        ReadError::PermissionDenied => AppError::permission_denied("没有权限读取所选设置文件。"),
        ReadError::Malformed => AppError::validation_failed("所选设置文件不是有效的 UTF-8 文本。"),
        ReadError::TooLarge => AppError::validation_failed("所选设置文件超过 1 MiB 上限，未修改。"),
        ReadError::Unsupported => AppError::not_supported("所选目标不是普通文件。"),
        ReadError::Excluded => AppError::permission_denied("授权已失效，请重新选择文件。"),
        ReadError::Io => AppError::internal(),
    }
}

fn refusal_error(refusal: EditRefusal) -> AppError {
    match refusal {
        EditRefusal::TooLarge => AppError::validation_failed("设置文件超过 1 MiB 上限，未修改。"),
        EditRefusal::Empty => AppError::validation_failed("设置文件为空，无法无损修改，未修改。"),
        EditRefusal::ByteOrderMark => {
            AppError::validation_failed("设置文件以 BOM 开头，无法无损修改，未修改。")
        }
        EditRefusal::NotAnObject => {
            AppError::validation_failed("设置文件顶层不是 JSON 对象，未修改。")
        }
        EditRefusal::Syntax { line, column } => AppError::validation_failed(&format!(
            "设置文件不是有效的 JSON（第 {line} 行，第 {column} 列），未修改。"
        )),
        EditRefusal::Comment => {
            AppError::validation_failed("设置文件含注释，无法无损修改，未修改。")
        }
        EditRefusal::TrailingComma => {
            AppError::validation_failed("设置文件含尾随逗号，无法无损修改，未修改。")
        }
        EditRefusal::DuplicateKey(key) => AppError::validation_failed(&format!(
            "设置文件含重复键「{key}」，无法无损修改，未修改。"
        )),
        EditRefusal::UnknownKey => AppError::invalid_input("该键不在已登记的 Claude Code 设置中。"),
        EditRefusal::NotEditable(reason) => AppError::validation_failed(reason),
        EditRefusal::InvalidValue(reason) => {
            AppError::validation_failed(&format!("取值无效：{reason}。"))
        }
        EditRefusal::PathConflict => {
            AppError::validation_failed("上级键不是对象，无法在其下写入，未修改。")
        }
        EditRefusal::NoChange => AppError::conflict("该键未设置，无需恢复默认。"),
        EditRefusal::Verification => AppError::internal(),
    }
}

fn value_at<'a>(root: &'a Value, key_path: &str) -> Option<&'a Value> {
    key_path
        .split('.')
        .try_fold(root, |node, segment| node.get(segment))
}

fn key_diff(key_path: &str, before: Option<&Value>, after: Option<&Value>) -> ConfigDiff {
    let label = key_path.rsplit('.').next().unwrap_or(key_path);
    build_diff(
        &key_snippet(label, before),
        &key_snippet(label, after),
        "STANDARD",
    )
}

fn key_snippet(label: &str, value: Option<&Value>) -> String {
    value.map_or_else(String::new, |value| format!("\"{label}\": {value}"))
}

fn with_write_context<T>(
    app: &AppHandle,
    action: impl FnOnce(&ResourceWriteContext<'_>, &ResourceWriteCoordinator) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let grants = app.state::<GrantCoordinator>();
    let operations = app.state::<OperationCoordinator>();
    let writes = app.state::<ResourceWriteCoordinator>();
    let config = app.state::<ConfigCoordinator>();
    let settings = app.state::<SettingsCoordinator>();
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    action(&ctx, &writes)
}

#[tauri::command]
pub fn ai_config_claude_flags() -> Result<OptionSummary, AppError> {
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    Ok(option_summary(tool))
}

#[tauri::command]
pub fn ai_config_claude_build_command(request: CommandRequest) -> Result<BuiltCommand, AppError> {
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    build_claude_command(tool, &request).map_err(|error| AppError::invalid_input(&error.message()))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalOpenInput {
    pub tool_id: String,
    pub request: CommandRequest,
    #[serde(default)]
    pub project_grant_id: Option<String>,
}

#[tauri::command]
pub async fn ai_config_claude_open_in_terminal(
    app: AppHandle,
    input: TerminalOpenInput,
) -> Result<(), AppError> {
    if input.tool_id != CLAUDE_CODE_TOOL_ID {
        return Err(AppError::invalid_input("该工具暂不支持在终端中打开命令。"));
    }
    let definitions = load_claude_definitions()?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    let built = build_claude_command(tool, &input.request)
        .map_err(|error| AppError::invalid_input(&error.message()))?;
    let home =
        canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，AI 配置不可用。"))?;
    let work_dir = match input.project_grant_id {
        None => None,
        Some(raw) => Some(project_directory(&app.state::<GrantCoordinator>(), &raw)?),
    };
    let directory = terminal_directory(
        &app.path()
            .app_data_dir()
            .map_err(|_| AppError::internal())?,
    );
    tauri::async_runtime::spawn_blocking(move || {
        open_command(
            &directory,
            &home,
            &TerminalPlan {
                command: &built.text,
                work_dir: work_dir.as_deref(),
                placeholders: &built.placeholders,
            },
            &SystemLauncher,
        )
    })
    .await
    .map_err(|_| AppError::internal())?
}

const BREW_OUTPUT_TAIL_BYTES: usize = 2 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrewUpgradeStatus {
    Upgraded,
    AlreadyCurrent,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBrewUpgradeOutcome {
    pub status: BrewUpgradeStatus,
    pub message: String,
    pub new_version: Option<String>,
}

#[tauri::command]
pub async fn ai_config_brew_upgrade(
    app: AppHandle,
    tool_id: String,
) -> Result<AiBrewUpgradeOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        brew_upgrade(&app.state::<OperationCoordinator>(), &tool_id)
    })
    .await
    .map_err(|_| AppError::internal())?
}

fn brew_upgrade(
    operations: &OperationCoordinator,
    tool_id: &str,
) -> Result<AiBrewUpgradeOutcome, AppError> {
    let profile = profile_for_tool_id(tool_id)
        .ok_or_else(|| AppError::invalid_input("未知的 AI 工具，无法更新。"))?;
    let report = detect_profile(profile)?;
    let (kind, package) = match report.install_source {
        Some(InstallSource::Homebrew { kind, package }) => (kind, package),
        Some(InstallSource::Direct) => {
            return Err(AppError::validation_failed(
                "该工具是直接安装的，请使用它自带的更新方式。",
            ));
        }
        None => return Err(AppError::not_found("未检测到该工具，请先安装后再更新。")),
    };

    let intent = OperationIntent::new(
        OperationKind::BrewUpgrade,
        package.clone(),
        BTreeMap::from([("tool".to_owned(), tool_id.to_owned())]),
    );
    let preview = operations.preview(
        intent.clone(),
        &format!("更新 {} · brew upgrade {package}", profile.display_name),
        vec![format!("运行 brew upgrade {package}，可能需要几分钟。")],
    )?;
    let operation_id = preview.operation_id;
    operations.authorize_mutation(&operation_id, &intent)?;
    operations.record_progress(&operation_id, "正在运行 brew upgrade。")?;

    let command = BrewCommand::Action {
        action: BrewAction::Upgrade,
        kind,
        identifier: package.clone(),
    };
    match BrewClient::resolve().and_then(|client| client.run(&command)) {
        Ok(_) => {
            let after = detect_profile(profile)
                .ok()
                .and_then(|report| report.version);
            let outcome = brew_outcome(report.version.as_deref(), after.as_deref());
            match outcome.status {
                BrewUpgradeStatus::Failed => operations.finish_failure(
                    &operation_id,
                    AppError::process_failed(&outcome.message, true),
                )?,
                _ => operations.finish_success_with_output(
                    &operation_id,
                    Some(&outcome.message),
                    None,
                )?,
            };
            Ok(outcome)
        }
        Err(error) => {
            let message = brew_failure_message(&error, &package);
            operations.finish_failure(&operation_id, AppError::process_failed(&message, true))?;
            Ok(AiBrewUpgradeOutcome {
                status: BrewUpgradeStatus::Failed,
                message,
                new_version: None,
            })
        }
    }
}

fn brew_outcome(before: Option<&str>, after: Option<&str>) -> AiBrewUpgradeOutcome {
    match after {
        None => AiBrewUpgradeOutcome {
            status: BrewUpgradeStatus::Failed,
            message:
                "Homebrew 已结束，但无法读取新版本，因此不能确认更新结果。请刷新页面重新检测。"
                    .to_owned(),
            new_version: None,
        },
        Some(version) if Some(version) == before => AiBrewUpgradeOutcome {
            status: BrewUpgradeStatus::AlreadyCurrent,
            message: format!("已是最新版本（{version}）。"),
            new_version: Some(version.to_owned()),
        },
        Some(version) => AiBrewUpgradeOutcome {
            status: BrewUpgradeStatus::Upgraded,
            message: format!("已更新到 {version}。"),
            new_version: Some(version.to_owned()),
        },
    }
}

fn brew_failure_message(error: &BrewClientError, package: &str) -> String {
    match error {
        BrewClientError::NotFound => {
            "没有找到 Homebrew，无法更新。请确认 Homebrew 已安装后重试。".to_owned()
        }
        BrewClientError::InvalidInstallation => {
            "Homebrew 安装不完整，无法运行更新。请在终端运行 brew doctor 检查后重试。".to_owned()
        }
        BrewClientError::Timeout => {
            "更新超过时限仍未完成，已停止等待。请稍后刷新核对是否已更新。".to_owned()
        }
        BrewClientError::OutputTooLarge => {
            "Homebrew 输出超过上限，已停止。请稍后刷新核对，或在终端运行 brew upgrade 查看完整输出。"
                .to_owned()
        }
        BrewClientError::ProcessFailed {
            code,
            stdout,
            stderr,
        } => {
            let source = if stderr.trim().is_empty() { stdout } else { stderr };
            let tail = output_tail(source);
            let code = code.map_or_else(|| "未知".to_owned(), |code| code.to_string());
            let mut message = format!("brew upgrade {package} 未能完成（退出码 {code}）。");
            if !tail.is_empty() {
                message.push_str("\n最后的输出：\n");
                message.push_str(&tail);
            }
            message.push_str("\n可稍后重试，或在终端运行 brew upgrade 查看完整输出。");
            message
        }
    }
}

fn output_tail(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .filter(|character| *character == '\n' || !character.is_control())
        .collect();
    let redacted = sanitize_payload(&cleaned, usize::MAX, &[]);
    let mut start = redacted.len().saturating_sub(BREW_OUTPUT_TAIL_BYTES);
    while !redacted.is_char_boundary(start) {
        start += 1;
    }
    redacted[start..].trim().to_owned()
}

fn detect_profile(profile: &ToolProfile) -> Result<ToolReport, AppError> {
    let registry =
        Registry::builtin().map_err(|_| AppError::validation_failed("应用配置注册表校验失败。"))?;
    let home =
        canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，AI 配置不可用。"))?;
    let locations = fixed_locations(&home);
    Ok(detect_tool(
        profile,
        &ProbeEnv {
            home: &home,
            locations: &locations,
            version: &SystemVersionProbe,
            fs: &StdFs,
            registry: &registry,
        },
    ))
}

#[cfg(test)]
#[path = "ai_config_tests.rs"]
mod tests;
