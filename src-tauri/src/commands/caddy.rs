use std::path::Path;

#[cfg(test)]
use crate::caddy::generate::generate_caddyfile;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{
    caddy::{
        config::{CaddyRules, RulesValidation, TlsConfig},
        conflict::{ConflictReport, ConflictTargets, SystemPortProbe, check_conflicts, start_gate},
        detect::{
            Candidate, DetectReport, DetectStatus, SystemVersionRunner, detect, fixed_candidates,
        },
        diff::{DiffLine, line_diff},
        generate::generate_caddyfile_with_tls,
        reload::ApplyReport,
        session::{
            Applied, ApplyEnvironment, CaddyRunCoordinator, ConfigSource, LogPage, PrepareInput,
            RunStatus, StartEnvironment, StartSummary, SystemAdminProbe,
        },
        store::{CaddyStore, LoadedRules, RulesSource},
        tls::{SystemFileInspector, TlsPaths, TlsWarning, resolve_tls},
        validate::{
            CaddyRunner, CheckRequest, MAX_CHECK_BYTES, SystemCaddyRunner, ValidationReport,
            ValidationRuns, check, valid_run_id,
        },
    },
    config::ConfigCoordinator,
    error::AppError,
    grants::{
        ConfirmRequest, GrantCoordinator, GrantId, GrantPurpose, ReadError,
        ResourceWriteBatchPreview, ResourceWriteContext, ResourceWriteCoordinator,
        ResourceWriteExecution, WriteRequest,
    },
    operations::OperationCoordinator,
    services::{
        launchd::DiscoveryGate,
        snapshot::{ResidentCaddySnapshot, read_system},
    },
    settings::SettingsCoordinator,
};

// The rules arrive as structured data only. Nothing here accepts a path or raw
// Caddyfile text; the executable can come only from a grant the user picked.

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectCaddyInput {
    #[serde(default)]
    pub executable_grant_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaddyPreview {
    pub valid: bool,
    pub validation: RulesValidation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<Vec<DiffLine>>,
    pub has_saved_version: bool,
}

#[tauri::command]
pub fn caddy_load_rules(store: State<'_, CaddyStore>) -> Result<LoadedRules, AppError> {
    store.load_rules()
}

#[tauri::command]
pub fn caddy_preview(
    store: State<'_, CaddyStore>,
    grants: State<'_, GrantCoordinator>,
    input: CaddyRules,
) -> Result<CaddyPreview, AppError> {
    let saved = store.saved_caddyfile()?;
    build_preview_with(&input, saved.as_deref(), |rules| {
        generate_with_grants(rules, &grants)
    })
}

#[tauri::command]
pub fn caddy_save(
    store: State<'_, CaddyStore>,
    grants: State<'_, GrantCoordinator>,
    input: CaddyRules,
) -> Result<(), AppError> {
    let caddyfile = generate_with_grants(&input, &grants)?;
    store.save_generated(&input, &caddyfile)
}

#[tauri::command]
pub fn caddy_tls_status(
    grants: State<'_, GrantCoordinator>,
    input: CaddyRules,
) -> Vec<TlsSiteStatus> {
    input
        .sites
        .iter()
        .enumerate()
        .filter_map(|(site, rule)| {
            rule.tls
                .as_ref()
                .map(|tls| tls_site_status(&grants, site, tls))
        })
        .collect()
}

#[tauri::command]
pub async fn caddy_detect(
    coordinator: State<'_, GrantCoordinator>,
    input: DetectCaddyInput,
) -> Result<DetectReport, AppError> {
    let user = input
        .executable_grant_id
        .as_deref()
        .map(|raw| resolve_executable_grant(&coordinator, raw))
        .transpose()?;
    tauri::async_runtime::spawn_blocking(move || {
        detect(user, &fixed_candidates(), &SystemVersionRunner)
    })
    .await
    .map_err(|_| AppError::internal())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TlsSiteState {
    Ready,
    Warning,
    Blocked,
}

/// Names and warnings only: directories, paths and key content never reach the
/// frontend. A blocked site carries the same fixed message the save refuses with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TlsSiteStatus {
    pub site: usize,
    pub state: TlsSiteState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub certificate_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_name: Option<String>,
    pub warnings: Vec<TlsWarning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn tls_site_status(grants: &GrantCoordinator, site: usize, tls: &TlsConfig) -> TlsSiteStatus {
    match resolve_tls(grants, tls, &SystemFileInspector) {
        Ok(resolution) => TlsSiteStatus {
            site,
            state: if resolution.warnings.is_empty() {
                TlsSiteState::Ready
            } else {
                TlsSiteState::Warning
            },
            certificate_name: Some(resolution.certificate_name),
            private_key_name: Some(resolution.private_key_name),
            warnings: resolution.warnings,
            message: None,
        },
        Err(error) => TlsSiteStatus {
            site,
            state: TlsSiteState::Blocked,
            certificate_name: None,
            private_key_name: None,
            warnings: Vec::new(),
            message: Some(error.message().to_owned()),
        },
    }
}

#[cfg(test)]
fn build_preview(rules: &CaddyRules, saved: Option<&str>) -> Result<CaddyPreview, AppError> {
    build_preview_with(rules, saved, crate::caddy::generate::generate_caddyfile)
}

fn build_preview_with(
    rules: &CaddyRules,
    saved: Option<&str>,
    generate: impl FnOnce(&CaddyRules) -> Result<String, AppError>,
) -> Result<CaddyPreview, AppError> {
    let validation = rules.validate();
    let has_saved_version = saved.is_some();
    if validation.is_blocking() {
        return Ok(CaddyPreview {
            valid: false,
            validation,
            generated_text: None,
            diff: None,
            has_saved_version,
        });
    }
    let generated = redact_tls_lines(&generate(rules)?);
    let saved = saved.map(redact_tls_lines);
    let diff = line_diff(saved.as_deref().unwrap_or(""), &generated)?;
    Ok(CaddyPreview {
        valid: true,
        validation,
        generated_text: Some(generated),
        diff: Some(diff),
        has_saved_version,
    })
}

fn generate_with_grants(rules: &CaddyRules, grants: &GrantCoordinator) -> Result<String, AppError> {
    generate_caddyfile_with_tls(rules, &|tls: &TlsConfig| tls_paths(grants, tls))
}

fn tls_paths(grants: &GrantCoordinator, tls: &TlsConfig) -> Result<TlsPaths, AppError> {
    resolve_tls(grants, tls, &SystemFileInspector).map(|resolution| resolution.paths)
}

fn ensure_tls_resolvable(rules: &CaddyRules, grants: &GrantCoordinator) -> Result<(), AppError> {
    rules
        .sites
        .iter()
        .filter(|site| site.enabled)
        .filter_map(|site| site.tls.as_ref())
        .try_for_each(|tls| tls_paths(grants, tls).map(|_| ()))
}

fn sensitive_tls_paths(rules: &CaddyRules, grants: &GrantCoordinator) -> Vec<String> {
    rules
        .sites
        .iter()
        .filter(|site| site.enabled)
        .filter_map(|site| site.tls.as_ref())
        .filter_map(|tls| tls_paths(grants, tls).ok())
        .flat_map(|paths| [paths.certificate, paths.private_key])
        .filter_map(|path| path.into_os_string().into_string().ok())
        .collect()
}

/// Shows a TLS line by its file names only, so the directory of a granted file
/// never reaches the preview or the diff.
fn redact_tls_lines(text: &str) -> String {
    text.split('\n')
        .map(|line| match line.strip_prefix("\ttls ") {
            Some(paths) => {
                let names: Vec<&str> = paths.split(' ').map(file_name_of).collect();
                format!("\ttls {}", names.join(" "))
            }
            None => line.to_owned(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_paths(text: &str, paths: &[String]) -> String {
    let mut longest_first = paths.to_vec();
    longest_first.sort_by_key(|path| std::cmp::Reverse(path.len()));
    longest_first.iter().fold(text.to_owned(), |text, path| {
        text.replace(path.as_str(), file_name_of(path))
    })
}

fn file_name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn resolve_executable_grant(
    coordinator: &GrantCoordinator,
    raw: &str,
) -> Result<Candidate, AppError> {
    let id = parse_grant_id(raw)?;
    let record = coordinator.resolve(&id)?;
    if record.purpose != GrantPurpose::Executable {
        return Err(AppError::invalid_input("所选授权不是可执行文件授权。"));
    }
    Ok(Candidate::user_selected(record.target_path()))
}

fn parse_grant_id(raw: &str) -> Result<GrantId, AppError> {
    GrantId::parse(raw).map_err(|_| AppError::invalid_input("授权编号无效。"))
}

const NO_EXECUTABLE: &str = "未找到可用的 Caddy 可执行文件，请先检测或选择。";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RawOrigin {
    Saved,
    Empty,
    External,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDocument {
    pub origin: RawOrigin,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoadRawInput {
    #[serde(default)]
    pub external_grant_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRawInput {
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Rules,
    Raw,
    ExternalFile,
}

/// Exactly one payload field must match `kind`; the combination is checked in
/// `source_text`, so a stray field of another kind is refused, not ignored.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidateSource {
    pub kind: SourceKind,
    #[serde(default)]
    pub rules: Option<CaddyRules>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub grant_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidateInput {
    pub source: ValidateSource,
    #[serde(default)]
    pub executable_grant_id: Option<String>,
    #[serde(default)]
    pub allow_external_references: bool,
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelValidateInput {
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewExternalRawInput {
    pub grant_id: String,
    pub text: String,
    #[serde(default)]
    pub expected_sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmExternalRawInput {
    pub grant_id: String,
    pub operation_id: String,
}

#[tauri::command]
pub fn caddy_load_raw(
    store: State<'_, CaddyStore>,
    grants: State<'_, GrantCoordinator>,
    input: LoadRawInput,
) -> Result<RawDocument, AppError> {
    match input.external_grant_id {
        Some(raw) => {
            let id = parse_grant_id(&raw)?;
            let (text, sha256) = read_external(&grants, &id)?;
            Ok(RawDocument {
                origin: RawOrigin::External,
                text,
                sha256: Some(sha256),
            })
        }
        None => Ok(match store.load_raw()? {
            Some(text) => RawDocument {
                origin: RawOrigin::Saved,
                text,
                sha256: None,
            },
            None => RawDocument {
                origin: RawOrigin::Empty,
                text: String::new(),
                sha256: None,
            },
        }),
    }
}

#[tauri::command]
pub fn caddy_save_raw(store: State<'_, CaddyStore>, input: SaveRawInput) -> Result<(), AppError> {
    store.save_raw(&input.text)
}

#[tauri::command]
pub async fn caddy_validate(
    store: State<'_, CaddyStore>,
    grants: State<'_, GrantCoordinator>,
    runs: State<'_, ValidationRuns>,
    input: ValidateInput,
) -> Result<ValidationReport, AppError> {
    if !valid_run_id(&input.run_id) {
        return Err(AppError::invalid_input("校验编号无效。"));
    }
    let user = input
        .executable_grant_id
        .as_deref()
        .map(|raw| resolve_executable_grant(&grants, raw))
        .transpose()?;
    let sensitive = input
        .source
        .rules
        .as_ref()
        .map_or_else(Vec::new, |rules| sensitive_tls_paths(rules, &grants));
    let text = source_text(input.source, &grants)?;
    let checks_root = store.checks_root()?;
    let allow = input.allow_external_references;
    let run = runs.begin(&input.run_id)?;
    let cancel = run.cancel_flag();
    let mut report = tauri::async_runtime::spawn_blocking(move || {
        let detect = detect(user, &fixed_candidates(), &SystemVersionRunner);
        run_check(
            detect,
            &text,
            allow,
            &checks_root,
            &SystemCaddyRunner,
            &cancel,
        )
    })
    .await
    .map_err(|_| AppError::internal())??;
    for diagnostic in &mut report.diagnostics {
        diagnostic.message = redact_paths(&diagnostic.message, &sensitive);
    }
    Ok(report)
}

#[tauri::command]
pub fn caddy_cancel_validate(
    runs: State<'_, ValidationRuns>,
    input: CancelValidateInput,
) -> Result<bool, AppError> {
    if !valid_run_id(&input.run_id) {
        return Err(AppError::invalid_input("校验编号无效。"));
    }
    runs.cancel(&input.run_id)
}

#[tauri::command]
pub fn caddy_preview_external_raw_save(
    app: AppHandle,
    input: PreviewExternalRawInput,
) -> Result<ResourceWriteBatchPreview, AppError> {
    let grant_id = parse_grant_id(&input.grant_id)?;
    if input.text.len() > MAX_CHECK_BYTES {
        return Err(AppError::invalid_input("原文超过 256 KiB 上限，未预览。"));
    }
    with_write_context(&app, move |ctx, writes| {
        ensure_config_file(ctx.grants, &grant_id)?;
        writes.preview(
            ctx,
            vec![WriteRequest {
                grant_id,
                relative: None,
                expected_sha256: input.expected_sha256,
                content: input.text,
                sensitive: false,
            }],
        )
    })
}

#[tauri::command]
pub fn caddy_confirm_external_raw_save(
    app: AppHandle,
    input: ConfirmExternalRawInput,
) -> Result<ResourceWriteExecution, AppError> {
    let request = ConfirmRequest {
        operation_id: input.operation_id,
        grant_id: parse_grant_id(&input.grant_id)?,
        relative: None,
    };
    with_write_context(&app, |ctx, writes| writes.execute(ctx, &request))
}

fn source_text(source: ValidateSource, grants: &GrantCoordinator) -> Result<String, AppError> {
    match (source.kind, source.rules, source.text, source.grant_id) {
        (SourceKind::Rules, Some(rules), None, None) => {
            if rules.validate().is_blocking() {
                return Err(AppError::validation_failed(
                    "规则未通过校验，请先修正表单。",
                ));
            }
            generate_with_grants(&rules, grants)
        }
        (SourceKind::Raw, None, Some(text), None) => Ok(text),
        (SourceKind::ExternalFile, None, None, Some(grant_id)) => {
            let id = parse_grant_id(&grant_id)?;
            read_external(grants, &id).map(|(text, _)| text)
        }
        _ => Err(AppError::invalid_input("校验来源的字段与类型不匹配。")),
    }
}

fn run_check(
    detect: DetectReport,
    text: &str,
    allow: bool,
    checks_root: &Path,
    runner: &dyn CaddyRunner,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<ValidationReport, AppError> {
    match (detect.status, detect.executable_path) {
        (DetectStatus::Available, Some(path)) => check(
            &CheckRequest {
                executable: Path::new(&path),
                text,
                allow_external_references: allow,
            },
            checks_root,
            runner,
            cancel,
        ),
        _ => Ok(ValidationReport::unavailable(
            detect.guidance.unwrap_or(NO_EXECUTABLE),
        )),
    }
}

fn read_external(
    coordinator: &GrantCoordinator,
    id: &GrantId,
) -> Result<(String, String), AppError> {
    ensure_config_file(coordinator, id)?;
    let read = coordinator
        .read_resource_with_limit(id, None, MAX_CHECK_BYTES)
        .map_err(read_error)?;
    let text = read.text().map_err(read_error)?.to_owned();
    Ok((text, read.fingerprint.sha256.clone()))
}

fn ensure_config_file(coordinator: &GrantCoordinator, id: &GrantId) -> Result<(), AppError> {
    if coordinator.resolve(id)?.purpose != GrantPurpose::ConfigFile {
        return Err(AppError::invalid_input("所选授权不是配置文件授权。"));
    }
    Ok(())
}

fn read_error(error: ReadError) -> AppError {
    match error {
        ReadError::NotFound => AppError::not_found("所选配置文件不存在。"),
        ReadError::PermissionDenied => AppError::permission_denied("没有权限读取所选配置文件。"),
        ReadError::Malformed => AppError::validation_failed("所选配置文件不是有效的 UTF-8 文本。"),
        ReadError::TooLarge => {
            AppError::validation_failed("所选配置文件超过 256 KiB 上限，未读取。")
        }
        ReadError::Unsupported => AppError::not_supported("所选目标不是普通文件。"),
        ReadError::Excluded => AppError::permission_denied("授权已失效，请重新选择文件。"),
        ReadError::Io => AppError::internal(),
    }
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareStartInput {
    pub source: ConfigSource,
    #[serde(default)]
    pub executable_grant_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartInput {
    pub plan_id: String,
    pub source: ConfigSource,
    pub confirmed: bool,
    /// Lets a start proceed when the external state could not be confirmed.
    /// It never overrides a blocking conflict.
    #[serde(default)]
    pub accept_unconfirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogsInput {
    pub session_id: String,
    pub stdout_offset: u64,
    pub stderr_offset: u64,
}

const NOT_SAVED_RULES: &str = "尚未保存表单规则，无法开启。";
const NOT_SAVED_RAW: &str = "尚未保存原文，无法开启。";

/// Read-only: resolves the executable and summarises the saved configuration.
/// Starting later uses exactly the plan this returns.
#[tauri::command]
pub async fn caddy_prepare_start(
    app: AppHandle,
    store: State<'_, CaddyStore>,
    grants: State<'_, GrantCoordinator>,
    input: PrepareStartInput,
) -> Result<StartSummary, AppError> {
    let user = input
        .executable_grant_id
        .as_deref()
        .map(|raw| resolve_executable_grant(&grants, raw))
        .transpose()?;
    let (text, rules) = saved_config(&store, input.source)?;
    if let Some(rules) = rules.as_ref() {
        ensure_tls_resolvable(rules, &grants)?;
    }
    let targets = ConflictTargets::for_rules(rules.as_ref());
    tauri::async_runtime::spawn_blocking(move || {
        let report = detect(user, &fixed_candidates(), &SystemVersionRunner);
        let mut summary = app.state::<CaddyRunCoordinator>().prepare(PrepareInput {
            source: input.source,
            detect: &report,
            text: &text,
            rules: rules.as_ref(),
        });
        summary.conflicts = Some(system_conflicts(&targets));
        summary
    })
    .await
    .map_err(|_| AppError::internal())
}

#[tauri::command]
pub async fn caddy_start(
    app: AppHandle,
    store: State<'_, CaddyStore>,
    input: StartInput,
) -> Result<RunStatus, AppError> {
    if !input.confirmed {
        return Err(AppError::invalid_input("开启前需先确认摘要。"));
    }
    if !valid_run_id(&input.plan_id) {
        return Err(AppError::invalid_input("开启编号无效。"));
    }
    let targets = app
        .state::<CaddyRunCoordinator>()
        .plan_targets(&input.plan_id, input.source)?;
    let checks_root = store.checks_root()?;
    let runs_root = store.runs_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let report = system_conflicts(&targets);
        guard_start(&report, input.accept_unconfirmed, || {
            let env = StartEnvironment {
                checks_root: &checks_root,
                runs_root: &runs_root,
                runner: &SystemCaddyRunner,
                probe: &SystemAdminProbe,
            };
            app.state::<CaddyRunCoordinator>()
                .start(&input.plan_id, input.source, &env)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Waits for the grace period, so it runs off the main thread.
#[tauri::command]
pub async fn caddy_stop(app: AppHandle) -> Result<RunStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || app.state::<CaddyRunCoordinator>().stop())
        .await
        .map_err(|_| AppError::internal())?
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplyInput {
    pub session_id: String,
    pub source: ConfigSource,
    pub confirmed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaddyStatusView {
    #[serde(flatten)]
    pub run: RunStatus,
    pub applied: Applied,
    pub applying: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_apply: Option<ApplyReport>,
}

fn require_confirmation(confirmed: bool) -> Result<(), AppError> {
    if confirmed {
        Ok(())
    } else {
        Err(AppError::invalid_input(
            "应用前需先确认：将重载自有实例，失败时旧配置可能仍在运行。",
        ))
    }
}

/// Reloads the own serving instance with the saved text. The saved text is read
/// here, never supplied by the caller.
#[tauri::command]
pub async fn caddy_apply(
    app: AppHandle,
    store: State<'_, CaddyStore>,
    input: ApplyInput,
) -> Result<ApplyReport, AppError> {
    require_confirmation(input.confirmed)?;
    let (text, _) = saved_config(&store, input.source)?;
    let checks_root = store.checks_root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let env = ApplyEnvironment {
            checks_root: &checks_root,
            runner: &SystemCaddyRunner,
            probe: &SystemAdminProbe,
        };
        app.state::<CaddyRunCoordinator>()
            .apply(&input.session_id, input.source, &text, &env)
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub fn caddy_status(
    runs: State<'_, CaddyRunCoordinator>,
    store: State<'_, CaddyStore>,
) -> CaddyStatusView {
    let run = runs.status();
    let applied = match run.source {
        Some(source) => {
            let saved = saved_config(&store, source).ok().map(|(text, _)| text);
            runs.applied(source, saved.as_deref())
        }
        None => Applied::Unknown,
    };
    CaddyStatusView {
        applied,
        applying: runs.reloading(),
        last_apply: runs.last_apply(),
        run,
    }
}

#[tauri::command]
pub fn caddy_logs(
    runs: State<'_, CaddyRunCoordinator>,
    input: LogsInput,
) -> Result<LogPage, AppError> {
    runs.logs(&input.session_id, input.stdout_offset, input.stderr_offset)
}

fn system_snapshot() -> Option<ResidentCaddySnapshot> {
    let _gate = DiscoveryGate::try_acquire()?;
    Some(read_system())
}

fn system_conflicts(targets: &ConflictTargets) -> ConflictReport {
    let snapshot = system_snapshot();
    check_conflicts(
        targets,
        snapshot.as_ref(),
        &SystemPortProbe {
            runner: &SystemCaddyRunner,
        },
    )
}

/// `launch` runs only when the gate allows it, so a refused start never reaches
/// the runner and never touches a resident Caddy.
fn guard_start<T>(
    report: &ConflictReport,
    accept_unconfirmed: bool,
    launch: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    match start_gate(report, accept_unconfirmed) {
        Some(refusal) => Err(AppError::conflict_with_reason(
            refusal.message(),
            refusal.code(),
        )),
        None => launch(),
    }
}

fn saved_config(
    store: &CaddyStore,
    source: ConfigSource,
) -> Result<(String, Option<CaddyRules>), AppError> {
    match source {
        ConfigSource::Rules => {
            let loaded: LoadedRules = store.load_rules()?;
            let text = store
                .saved_caddyfile()?
                .filter(|_| loaded.source == RulesSource::Saved)
                .ok_or_else(|| AppError::not_found(NOT_SAVED_RULES))?;
            Ok((text, Some(loaded.rules)))
        }
        ConfigSource::Raw => {
            let text = store
                .load_raw()?
                .ok_or_else(|| AppError::not_found(NOT_SAVED_RAW))?;
            Ok((text, None))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, fs, path::PathBuf, sync::atomic::AtomicBool};

    use serde_json::{Value, json};
    use uuid::Uuid;

    use super::*;
    use crate::{
        caddy::{
            config::{
                Exposure, ExposureReason, IssueCode, Listen, RULES_VERSION, Severity, SiteRule,
                Upstream, UpstreamScheme,
            },
            detect::{DetectReport, DetectStatus},
            diff::LineChange,
            validate::{CaddyRunner, RunFailure, RunOutput, RunSpec, ValidationStatus},
        },
        error::AppErrorCode,
        grants::GrantStore,
    };

    fn site(host: &str, port: u16, upstream_port: u16) -> SiteRule {
        SiteRule {
            tls: None,
            access_log: false,
            enabled: true,
            listen: Listen {
                host: host.to_owned(),
                port,
            },
            upstreams: vec![Upstream {
                scheme: UpstreamScheme::Http,
                host: "127.0.0.1".to_owned(),
                port: upstream_port,
            }],
        }
    }

    fn rules(sites: Vec<SiteRule>) -> CaddyRules {
        CaddyRules {
            version: RULES_VERSION,
            sites,
        }
    }

    #[test]
    fn rules_input_rejects_raw_caddyfile_text_and_paths() {
        let raw_text = json!({"version": 1, "sites": [], "caddyfile": "http://evil {}"});
        let path = json!({"version": 1, "sites": [], "path": "/tmp/Caddyfile"});

        assert!(serde_json::from_value::<CaddyRules>(raw_text).is_err());
        assert!(serde_json::from_value::<CaddyRules>(path).is_err());
    }

    #[test]
    fn rules_input_rejects_a_site_that_adds_a_directive_field() {
        let directive = json!({
            "version": 1,
            "sites": [{
                "enabled": true,
                "listen": {"host": "127.0.0.1", "port": 8080},
                "upstreams": [{"scheme": "http", "host": "127.0.0.1", "port": 3000}],
                "directives": ["admin 0.0.0.0:2019"]
            }]
        });

        assert!(serde_json::from_value::<CaddyRules>(directive).is_err());
    }

    #[test]
    fn detect_input_accepts_no_grant_or_a_grant_id_only() {
        let empty: DetectCaddyInput = serde_json::from_value(json!({})).expect("empty input");
        assert_eq!(empty.executable_grant_id, None);

        let with_grant: DetectCaddyInput = serde_json::from_value(json!({
            "executableGrantId": "5f3b6e6e-0000-4000-8000-000000000001"
        }))
        .expect("grant input");
        assert!(with_grant.executable_grant_id.is_some());
    }

    #[test]
    fn detect_input_rejects_any_path_field() {
        assert!(serde_json::from_value::<DetectCaddyInput>(json!({"path": "/bin/sh"})).is_err());
        assert!(
            serde_json::from_value::<DetectCaddyInput>(json!({"executablePath": "/bin/sh"}))
                .is_err()
        );
    }

    #[test]
    fn grant_id_must_be_a_canonical_uuid() {
        assert_eq!(
            parse_grant_id("not-a-uuid").expect_err("refused").code(),
            AppErrorCode::InvalidInput
        );
        assert_eq!(
            parse_grant_id("5F3B6E6E-0000-4000-8000-000000000001")
                .expect_err("uppercase refused")
                .code(),
            AppErrorCode::InvalidInput
        );
        assert!(parse_grant_id("5f3b6e6e-0000-4000-8000-000000000001").is_ok());
    }

    #[test]
    fn preview_of_two_valid_sites_contains_text_and_an_all_added_diff_without_a_saved_version() {
        let input = rules(vec![site("127.0.0.1", 8080, 3000), site("::1", 8081, 3001)]);

        let preview = build_preview(&input, None).expect("preview");

        assert!(preview.valid);
        assert!(!preview.has_saved_version);
        let text = preview.generated_text.expect("generated text");
        assert!(text.contains("http://127.0.0.1:8080 {"));
        assert!(text.contains("http://[::1]:8081 {"));
        let diff = preview.diff.expect("diff");
        assert!(diff.iter().all(|line| line.change == LineChange::Added));
        assert_eq!(diff.len(), text.lines().count());
    }

    #[test]
    fn preview_diff_marks_only_the_changed_lines_against_the_saved_text() {
        let saved =
            generate_caddyfile(&rules(vec![site("127.0.0.1", 8080, 3000)])).expect("saved text");
        let input = rules(vec![site("127.0.0.1", 8080, 3005)]);

        let preview = build_preview(&input, Some(&saved)).expect("preview");

        let diff = preview.diff.expect("diff");
        assert!(preview.has_saved_version);
        assert!(diff.contains(&DiffLine {
            change: LineChange::Removed,
            text: "\treverse_proxy http://127.0.0.1:3000".to_owned(),
        }));
        assert!(diff.contains(&DiffLine {
            change: LineChange::Added,
            text: "\treverse_proxy http://127.0.0.1:3005".to_owned(),
        }));
        assert_eq!(
            diff.iter()
                .filter(|line| line.change == LineChange::Unchanged)
                .count(),
            6
        );
    }

    #[test]
    fn preview_of_injection_is_invalid_and_carries_no_text_or_diff() {
        let input = rules(vec![site("127.0.0.1 {\n\treverse_proxy evil", 8080, 3000)]);

        let preview = build_preview(&input, Some("saved")).expect("preview is a report");

        assert!(!preview.valid);
        assert_eq!(preview.generated_text, None);
        assert_eq!(preview.diff, None);
        assert!(
            preview
                .validation
                .issues
                .iter()
                .any(|issue| issue.code == IssueCode::ForbiddenCharacter)
        );
    }

    #[test]
    fn preview_of_conflicting_rules_is_invalid() {
        let input = rules(vec![
            site("127.0.0.1", 8080, 3000),
            site("127.0.0.1", 8080, 3001),
        ]);

        let preview = build_preview(&input, None).expect("preview");

        assert!(!preview.valid);
        assert_eq!(preview.validation.conflicts.len(), 1);
        assert_eq!(preview.generated_text, None);
    }

    #[test]
    fn privileged_port_is_valid_with_a_warning_only() {
        let preview =
            build_preview(&rules(vec![site("127.0.0.1", 80, 3000)]), None).expect("preview");

        assert!(preview.valid);
        assert_eq!(preview.validation.issues.len(), 1);
        assert_eq!(preview.validation.issues[0].severity, Severity::Warning);
        assert!(preview.generated_text.is_some());
    }

    #[test]
    fn wildcard_listen_is_reported_as_externally_visible() {
        let preview =
            build_preview(&rules(vec![site("0.0.0.0", 8080, 3000)]), None).expect("preview");

        assert_eq!(
            preview.validation.exposures,
            vec![Exposure {
                site: 0,
                listen: "0.0.0.0:8080".to_owned(),
                visible_externally: true,
                reason: ExposureReason::AllInterfaces,
            }]
        );
    }

    #[test]
    fn preview_serialization_omits_text_and_diff_when_invalid() {
        let preview =
            build_preview(&rules(vec![site("bad host", 8080, 3000)]), None).expect("preview");

        let value: Value = serde_json::to_value(&preview).expect("serialize");

        assert_eq!(value["valid"], json!(false));
        assert!(value.get("generatedText").is_none());
        assert!(value.get("diff").is_none());
        assert_eq!(
            value["validation"]["issues"][0]["code"],
            json!("FORBIDDEN_CHARACTER")
        );
    }

    fn grants_fixture() -> GrantCoordinator {
        GrantCoordinator::new(
            GrantStore::new(std::env::temp_dir().join("userhome-cmd-unused-grants")),
            None,
        )
    }

    fn source(kind: SourceKind) -> ValidateSource {
        ValidateSource {
            kind,
            rules: None,
            text: None,
            grant_id: None,
        }
    }

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("userhome-cmd-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("scratch");
            Self(path)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[derive(Default)]
    struct RecordingRunner {
        executables: RefCell<Vec<PathBuf>>,
    }

    impl CaddyRunner for RecordingRunner {
        fn run(&self, spec: &RunSpec, _cancel: &AtomicBool) -> Result<RunOutput, RunFailure> {
            self.executables.borrow_mut().push(spec.executable.clone());
            Err(RunFailure::Timeout)
        }
    }

    #[test]
    fn raw_command_inputs_reject_paths_and_unknown_fields() {
        assert!(serde_json::from_value::<LoadRawInput>(json!({"path": "/tmp/x"})).is_err());
        assert!(
            serde_json::from_value::<SaveRawInput>(json!({"text": "a", "path": "/tmp/x"})).is_err()
        );
        assert!(
            serde_json::from_value::<CancelValidateInput>(json!({"runId": "r", "x": 1})).is_err()
        );
        assert!(
            serde_json::from_value::<ValidateInput>(json!({
                "source": {"kind": "raw", "text": "a"},
                "runId": "run-1",
                "path": "/x"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ValidateInput>(json!({
                "source": {"kind": "raw", "text": "a", "path": "/x"},
                "runId": "run-1"
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<PreviewExternalRawInput>(json!({
                "grantId": "5f3b6e6e-0000-4000-8000-000000000001",
                "text": "a",
                "path": "/x"
            }))
            .is_err()
        );
    }

    #[test]
    fn validate_input_accepts_each_source_kind_with_its_own_payload() {
        let raw: ValidateInput = serde_json::from_value(json!({
            "source": {"kind": "raw", "text": "x"},
            "runId": "run-1"
        }))
        .expect("raw");
        assert!(!raw.allow_external_references);
        assert!(
            serde_json::from_value::<ValidateInput>(json!({
                "source": {"kind": "rules", "rules": {"version": 1, "sites": []}},
                "runId": "run-1"
            }))
            .is_ok()
        );
        assert!(
            serde_json::from_value::<ValidateInput>(json!({
                "source": {
                    "kind": "externalFile",
                    "grantId": "5f3b6e6e-0000-4000-8000-000000000001"
                },
                "runId": "run-1",
                "allowExternalReferences": true
            }))
            .is_ok()
        );
    }

    #[test]
    fn source_text_refuses_fields_that_do_not_match_the_kind() {
        let grants = grants_fixture();
        let raw_with_rules = ValidateSource {
            rules: Some(CaddyRules::example()),
            text: Some("x".to_owned()),
            ..source(SourceKind::Raw)
        };
        let rules_with_text = ValidateSource {
            text: Some("x".to_owned()),
            ..source(SourceKind::Rules)
        };
        let external_with_text = ValidateSource {
            text: Some("x".to_owned()),
            grant_id: Some("5f3b6e6e-0000-4000-8000-000000000001".to_owned()),
            ..source(SourceKind::ExternalFile)
        };

        for case in [raw_with_rules, rules_with_text, external_with_text] {
            assert_eq!(
                source_text(case, &grants).expect_err("mismatch").code(),
                AppErrorCode::InvalidInput
            );
        }
    }

    #[test]
    fn source_text_of_valid_rules_is_the_generated_caddyfile() {
        let grants = grants_fixture();
        let rules = rules(vec![site("127.0.0.1", 8080, 3000)]);
        let input = ValidateSource {
            rules: Some(rules.clone()),
            ..source(SourceKind::Rules)
        };

        assert_eq!(
            source_text(input, &grants).expect("generated"),
            generate_caddyfile(&rules).expect("generate")
        );
    }

    #[test]
    fn source_text_refuses_blocking_rules_without_generating_text() {
        let grants = grants_fixture();
        let input = ValidateSource {
            rules: Some(rules(vec![site("127.0.0.1 {", 8080, 3000)])),
            ..source(SourceKind::Rules)
        };

        assert_eq!(
            source_text(input, &grants).expect_err("refused").code(),
            AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn source_text_of_raw_text_is_verbatim_and_keeps_unknown_directives() {
        let grants = grants_fixture();
        let text = "# keep me\nfrobnicate on\nexample.com {\n\tunknown x\n}\n";
        let input = ValidateSource {
            text: Some(text.to_owned()),
            ..source(SourceKind::Raw)
        };

        assert_eq!(source_text(input, &grants).expect("raw"), text);
    }

    #[test]
    fn external_source_with_a_malformed_grant_id_is_refused_before_any_read() {
        let grants = grants_fixture();
        let input = ValidateSource {
            grant_id: Some("not-a-uuid".to_owned()),
            ..source(SourceKind::ExternalFile)
        };

        assert_eq!(
            source_text(input, &grants).expect_err("refused").code(),
            AppErrorCode::InvalidInput
        );
    }

    #[test]
    fn missing_executable_reports_unavailable_without_running_anything() {
        let scratch = Scratch::new();
        let runner = RecordingRunner::default();
        let detect = DetectReport {
            status: DetectStatus::Missing,
            executable_path: None,
            version: None,
            guidance: Some("未找到测试 Caddy"),
            candidates: Vec::new(),
        };

        let report = run_check(
            detect,
            "example.com {}\n",
            false,
            &scratch.0,
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Unavailable);
        assert_eq!(report.diagnostics[0].message, "未找到测试 Caddy");
        assert!(runner.executables.borrow().is_empty());
    }

    #[test]
    fn the_detected_executable_is_the_one_handed_to_the_runner() {
        let scratch = Scratch::new();
        let runner = RecordingRunner::default();
        let detect = DetectReport {
            status: DetectStatus::Available,
            executable_path: Some("/opt/homebrew/bin/caddy".to_owned()),
            version: Some("v2.8.4".to_owned()),
            guidance: None,
            candidates: Vec::new(),
        };

        let report = run_check(
            detect,
            "example.com {}\n",
            false,
            &scratch.0,
            &runner,
            &AtomicBool::new(false),
        )
        .expect("report");

        assert_eq!(report.status, ValidationStatus::Timeout);
        assert_eq!(
            report.stage,
            Some(crate::caddy::validate::CheckStage::Adapt)
        );
        assert_eq!(
            runner.executables.borrow().as_slice(),
            [PathBuf::from("/opt/homebrew/bin/caddy")]
        );
    }

    #[test]
    fn run_inputs_accept_only_their_declared_fields() {
        let accepted: Result<StartInput, _> = serde_json::from_value(json!({
            "planId": "7f0c9a2e-1b3d-4c5e-8f60-123456789abc",
            "source": "RAW",
            "confirmed": true,
        }));
        assert!(accepted.is_ok());
        let with_path: Result<StartInput, _> = serde_json::from_value(json!({
            "planId": "7f0c9a2e",
            "source": "RAW",
            "confirmed": true,
            "path": "/bin/sh",
        }));
        assert!(with_path.is_err());
        let unknown_source: Result<StartInput, _> = serde_json::from_value(json!({
            "planId": "7f0c9a2e",
            "source": "PATH",
            "confirmed": true,
        }));
        assert!(unknown_source.is_err());
        let logs_with_extra: Result<LogsInput, _> = serde_json::from_value(json!({
            "sessionId": "s",
            "stdoutOffset": 0,
            "stderrOffset": 0,
            "file": "/tmp/x",
        }));
        assert!(logs_with_extra.is_err());
        let prepare: Result<PrepareStartInput, _> =
            serde_json::from_value(json!({"source": "RULES"}));
        assert!(prepare.is_ok());
    }
}

#[cfg(test)]
mod start_gate_tests {
    use std::cell::Cell;

    use serde_json::{Value, json};

    use super::*;
    use crate::{
        caddy::conflict::{
            ConflictTargets, Endpoint, ListenProbe, Occupant, PortProbe, UpstreamProbe,
            UpstreamState,
        },
        error::AppErrorCode,
        services::{
            launchd::{LaunchdDomain, LaunchdScope, LoadState, RunState},
            ownership::Ownership,
            snapshot::{ConfigLocation, ResidentCaddyInstance, UnknownReason},
        },
    };

    struct StaticProbe {
        listen: ListenProbe,
        upstream: UpstreamProbe,
    }

    impl PortProbe for StaticProbe {
        fn listen(&self, _endpoint: &Endpoint) -> ListenProbe {
            self.listen.clone()
        }

        fn upstream(&self, _endpoint: &Endpoint) -> UpstreamProbe {
            self.upstream
        }
    }

    fn targets() -> ConflictTargets {
        ConflictTargets {
            listen: Some(vec![Endpoint {
                host: "127.0.0.1".to_owned(),
                port: 8080,
            }]),
            upstreams: vec![Endpoint {
                host: "127.0.0.1".to_owned(),
                port: 3000,
            }],
        }
    }

    fn resident(run_state: RunState, pid: Option<u32>) -> ResidentCaddyInstance {
        ResidentCaddyInstance {
            label: "homebrew.mxcl.caddy".to_owned(),
            domain: LaunchdDomain::Gui,
            scope: LaunchdScope::UserAgent,
            ownership: Ownership::ThirdParty,
            plist_path: None,
            executable: None,
            arguments: Vec::new(),
            adapter: None,
            config: ConfigLocation {
                path: None,
                flag: None,
                unknown_reason: Some(UnknownReason::Missing),
            },
            load_state: LoadState::Loaded,
            run_state,
            pid,
            observed_at_ms: 1,
            complete: true,
            incomplete_reasons: Vec::new(),
        }
    }

    fn snapshot(instances: Vec<ResidentCaddyInstance>, complete: bool) -> ResidentCaddySnapshot {
        ResidentCaddySnapshot {
            observed_at_ms: 1,
            complete,
            can_conclude_absence: complete,
            sources: Vec::new(),
            instances,
        }
    }

    fn free_ports() -> StaticProbe {
        StaticProbe {
            listen: ListenProbe::Free,
            upstream: UpstreamProbe::Reachable,
        }
    }

    fn report(snapshot: Option<&ResidentCaddySnapshot>, probe: &StaticProbe) -> ConflictReport {
        check_conflicts(&targets(), snapshot, probe)
    }

    fn reason_of(error: &AppError) -> Value {
        serde_json::to_value(error).expect("error json")["details"]["reason"].clone()
    }

    #[test]
    fn external_running_caddy_refuses_the_start_and_the_launch_never_runs_even_when_accepted() {
        let snap = snapshot(vec![resident(RunState::Running, Some(77))], true);
        let launched = Cell::new(false);
        let result = guard_start(&report(Some(&snap), &free_ports()), true, || {
            launched.set(true);
            Ok(())
        });
        let error = result.expect_err("refused");
        assert_eq!(error.code(), AppErrorCode::Conflict);
        assert_eq!(reason_of(&error), json!("EXTERNAL_RUNNING"));
        assert!(!launched.get());
    }

    #[test]
    fn occupied_own_port_refuses_with_the_occupant_in_the_report() {
        let snap = snapshot(Vec::new(), true);
        let probe = StaticProbe {
            listen: ListenProbe::Occupied(Some(Occupant {
                name: "caddy".to_owned(),
                pid: 9,
            })),
            upstream: UpstreamProbe::Reachable,
        };
        let launched = Cell::new(false);
        let conflicts = report(Some(&snap), &probe);
        let error = guard_start(&conflicts, false, || {
            launched.set(true);
            Ok(())
        })
        .expect_err("refused");
        assert_eq!(reason_of(&error), json!("PORT_OCCUPIED"));
        assert_eq!(
            conflicts.ports[0].occupant,
            Some(Occupant {
                name: "caddy".to_owned(),
                pid: 9,
            })
        );
        assert!(!launched.get());
    }

    #[test]
    fn unconfirmed_snapshot_needs_an_explicit_acceptance_and_is_never_silently_allowed() {
        let conflicts = report(None, &free_ports());
        let launched = Cell::new(false);
        let error = guard_start(&conflicts, false, || {
            launched.set(true);
            Ok(7)
        })
        .expect_err("needs confirmation");
        assert_eq!(reason_of(&error), json!("UNCONFIRMED"));
        assert!(!launched.get());

        let accepted = guard_start(&conflicts, true, || {
            launched.set(true);
            Ok(7)
        });
        assert_eq!(accepted, Ok(7));
        assert!(launched.get());
    }

    #[test]
    fn a_clear_check_lets_the_launch_run_and_an_unreachable_upstream_only_notes_it() {
        let snap = snapshot(Vec::new(), true);
        let probe = StaticProbe {
            listen: ListenProbe::Free,
            upstream: UpstreamProbe::Unreachable,
        };
        let conflicts = report(Some(&snap), &probe);
        assert_eq!(conflicts.upstreams[0].state, UpstreamState::Unreachable);
        assert_eq!(guard_start(&conflicts, false, || Ok(1)), Ok(1));
    }

    #[test]
    fn a_blocking_conflict_is_never_bypassed_by_the_acceptance_flag() {
        let snap = snapshot(vec![resident(RunState::Running, Some(1))], false);
        let conflicts = report(Some(&snap), &free_ports());
        let error = guard_start(&conflicts, true, || Ok(())).expect_err("blocked");
        assert_eq!(reason_of(&error), json!("EXTERNAL_RUNNING"));
    }
}

#[cfg(test)]
mod apply_tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::{caddy::reload::ApplyFailure, error::AppErrorCode};

    #[test]
    fn apply_input_takes_only_a_session_a_saved_source_and_a_confirmation() {
        let valid = json!({"sessionId": "s", "source": "RULES", "confirmed": true});
        assert!(serde_json::from_value::<ApplyInput>(valid).is_ok());

        let with_path = json!({"sessionId": "s", "source": "RAW", "confirmed": true, "path": "/x"});
        assert!(serde_json::from_value::<ApplyInput>(with_path).is_err());

        let external = json!({"sessionId": "s", "source": "EXTERNAL", "confirmed": true});
        assert!(serde_json::from_value::<ApplyInput>(external).is_err());

        let with_text = json!({"sessionId": "s", "source": "RAW", "confirmed": true, "text": "x"});
        assert!(serde_json::from_value::<ApplyInput>(with_text).is_err());
    }

    #[test]
    fn an_apply_without_explicit_confirmation_is_refused_before_anything_runs() {
        assert_eq!(
            require_confirmation(false).expect_err("refused").code(),
            AppErrorCode::InvalidInput
        );
        assert!(require_confirmation(true).is_ok());
    }

    #[test]
    fn the_status_view_keeps_run_fields_at_the_top_level_and_adds_apply_state() {
        let view = CaddyStatusView {
            run: CaddyRunCoordinator::default().status(),
            applied: Applied::Unknown,
            applying: false,
            last_apply: None,
        };

        let value: Value = serde_json::to_value(&view).expect("serialize");

        assert_eq!(value["state"], json!("STOPPED"));
        assert_eq!(value["applied"], json!("UNKNOWN"));
        assert_eq!(value["applying"], json!(false));
        assert!(value.get("lastApply").is_none());
    }

    #[test]
    fn the_status_view_carries_the_latest_failed_apply_with_its_category() {
        let view = CaddyStatusView {
            run: CaddyRunCoordinator::default().status(),
            applied: Applied::Pending,
            applying: false,
            last_apply: Some(ApplyReport::failed(
                "session".to_owned(),
                ApplyFailure::Timeout,
                None,
                Vec::new(),
            )),
        };

        let value: Value = serde_json::to_value(&view).expect("serialize");

        assert_eq!(value["applied"], json!("PENDING"));
        assert_eq!(value["lastApply"]["outcome"], json!("FAILED"));
        assert_eq!(value["lastApply"]["failure"], json!("TIMEOUT"));
    }
}

#[cfg(test)]
mod tls_tests {
    use std::path::{Path, PathBuf};

    use serde_json::json;

    use super::*;
    use crate::caddy::{
        config::{Listen, SiteRule, TlsConfig, Upstream, UpstreamScheme},
        generate::generate_caddyfile_with_tls,
        tls::TlsWarning,
    };

    const CERT: &str = "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f";
    const KEY: &str = "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";

    fn tls_rules() -> CaddyRules {
        CaddyRules {
            version: 1,
            sites: vec![SiteRule {
                enabled: true,
                listen: Listen {
                    host: "app.example.test".to_owned(),
                    port: 8443,
                },
                upstreams: vec![Upstream {
                    scheme: UpstreamScheme::Http,
                    host: "127.0.0.1".to_owned(),
                    port: 3000,
                }],
                tls: Some(TlsConfig {
                    certificate_grant_id: CERT.to_owned(),
                    private_key_grant_id: KEY.to_owned(),
                }),
                access_log: true,
            }],
        }
    }

    fn granted(_: &TlsConfig) -> Result<TlsPaths, AppError> {
        Ok(TlsPaths {
            certificate: PathBuf::from("/Users/u/certs/cert.pem"),
            private_key: PathBuf::from("/Users/u/certs/key.pem"),
        })
    }

    #[test]
    fn tls_lines_show_file_names_and_never_directories() {
        let text = "{\n\tauto_https off\n}\n\nhttps://localhost:9443 {\n\ttls /Users/u/certs/cert.pem /Users/u/certs/key.pem\n\tlog\n}\n";
        let redacted = redact_tls_lines(text);

        assert!(
            redacted.contains("\n\ttls cert.pem key.pem\n"),
            "{redacted}"
        );
        assert!(redacted.contains("\n\tlog\n"));
        assert!(!redacted.contains("/Users"));
    }

    #[test]
    fn redacted_paths_are_replaced_longest_first() {
        let paths = vec!["/a/key.pem".to_owned(), "/a/key.pem.bak".to_owned()];

        assert_eq!(
            redact_paths("load /a/key.pem and /a/key.pem.bak", &paths),
            "load key.pem and key.pem.bak"
        );
    }

    #[test]
    fn preview_of_a_tls_site_serializes_without_any_directory() {
        let preview = build_preview_with(&tls_rules(), None, |rules| {
            generate_caddyfile_with_tls(rules, &granted)
        })
        .expect("preview");

        let text = preview.generated_text.clone().expect("generated");
        assert!(text.contains("https://app.example.test:8443 {"));
        assert!(text.contains("\ttls cert.pem key.pem"));
        assert!(text.contains("\tlog"));
        let serialized = serde_json::to_string(&preview).expect("serialize");
        assert!(!serialized.contains("/Users"), "{serialized}");
    }

    #[test]
    fn preview_fails_when_a_tls_authorization_cannot_be_resolved() {
        let result = build_preview_with(&tls_rules(), None, |rules| {
            generate_caddyfile_with_tls(rules, &|_: &TlsConfig| {
                Err(AppError::not_found("私钥授权已撤销，请重新选择私钥文件。"))
            })
        });

        assert!(result.is_err());
    }

    #[test]
    fn tls_status_serializes_names_and_warnings_only() {
        let status = TlsSiteStatus {
            site: 0,
            state: TlsSiteState::Warning,
            certificate_name: Some("cert.pem".to_owned()),
            private_key_name: Some("key.pem".to_owned()),
            warnings: vec![TlsWarning::PrivateKeyReadableByOthers],
            message: None,
        };

        assert_eq!(
            serde_json::to_value(&status).expect("serialize"),
            json!({
                "site": 0,
                "state": "WARNING",
                "certificateName": "cert.pem",
                "privateKeyName": "key.pem",
                "warnings": ["PRIVATE_KEY_READABLE_BY_OTHERS"],
            })
        );
    }

    #[test]
    fn blocked_tls_status_carries_only_the_fixed_message() {
        let blocked = TlsSiteStatus {
            site: 1,
            state: TlsSiteState::Blocked,
            certificate_name: None,
            private_key_name: None,
            warnings: Vec::new(),
            message: Some("证书授权已撤销，请重新选择证书文件。".to_owned()),
        };
        let value = serde_json::to_value(&blocked).expect("serialize");

        assert_eq!(value["state"], json!("BLOCKED"));
        assert!(value.get("certificateName").is_none());
        assert!(!value.to_string().contains('/'));
    }

    #[test]
    fn path_helpers_never_keep_a_directory_component() {
        assert_eq!(file_name_of("/Users/u/certs/key.pem"), "key.pem");
        assert_eq!(file_name_of("key.pem"), "key.pem");
        assert_eq!(
            file_name_of(Path::new("/x/y.pem").to_str().expect("utf8")),
            "y.pem"
        );
    }
}
