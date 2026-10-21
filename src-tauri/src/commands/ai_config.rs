//! Read-only AI CLI detection and Claude Code settings reads. The commands take no
//! path: the tool list and every probed location are fixed in code, and the only
//! caller-supplied value is an opaque project grant id.

use tauri::State;

use crate::{
    ai_config::{
        detect::{AiConfigReport, ProbeEnv, SystemVersionProbe, detect_all, fixed_locations},
        read::{
            ClaudeLocations, ClaudeReadView, ClaudeSnapshotSummary, claude_tool, managed_directory,
            read_claude_view, snapshot_summary,
        },
        validate::load_all,
    },
    app_config::{discover::StdFs, registry::Registry},
    commands::grants::canonical_home,
    error::AppError,
    grants::{GrantCoordinator, GrantId, GrantKind, GrantPurpose},
};

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
    let definitions =
        load_all().map_err(|_| AppError::validation_failed("AI 配置定义校验失败。"))?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    Ok(snapshot_summary(tool))
}

#[tauri::command]
pub fn ai_config_claude_read(
    project_grant_id: Option<String>,
    coordinator: State<'_, GrantCoordinator>,
) -> Result<ClaudeReadView, AppError> {
    let definitions =
        load_all().map_err(|_| AppError::validation_failed("AI 配置定义校验失败。"))?;
    let tool = claude_tool(&definitions)
        .ok_or_else(|| AppError::not_found("未找到 Claude Code 定义。"))?;
    let home =
        canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，AI 配置不可用。"))?;
    let project = match project_grant_id {
        None => None,
        Some(raw) => {
            let record = coordinator.resolve(&GrantId::parse(&raw)?)?;
            if record.kind != GrantKind::Directory
                || record.purpose != GrantPurpose::ConfigDirectory
            {
                return Err(AppError::validation_failed("所选授权不是项目目录。"));
            }
            Some(record.target_path())
        }
    };
    let locations = ClaudeLocations {
        home,
        project,
        managed_dir: managed_directory(),
    };
    Ok(read_claude_view(tool, &locations, &StdFs))
}
