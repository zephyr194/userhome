use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{
    caddy::{
        config::{CaddyRules, RulesValidation},
        detect::{
            Candidate, DetectReport, DetectStatus, SystemVersionRunner, detect, fixed_candidates,
        },
        diff::{DiffLine, line_diff},
        generate::generate_caddyfile,
        store::{CaddyStore, LoadedRules},
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
    input: CaddyRules,
) -> Result<CaddyPreview, AppError> {
    let saved = store.saved_caddyfile()?;
    build_preview(&input, saved.as_deref())
}

#[tauri::command]
pub fn caddy_save(store: State<'_, CaddyStore>, input: CaddyRules) -> Result<(), AppError> {
    store.save(&input)
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

fn build_preview(rules: &CaddyRules, saved: Option<&str>) -> Result<CaddyPreview, AppError> {
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
    let generated = generate_caddyfile(rules)?;
    let diff = line_diff(saved.unwrap_or(""), &generated)?;
    Ok(CaddyPreview {
        valid: true,
        validation,
        generated_text: Some(generated),
        diff: Some(diff),
        has_saved_version,
    })
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
    let text = source_text(input.source, &grants)?;
    let checks_root = store.checks_root()?;
    let allow = input.allow_external_references;
    let run = runs.begin(&input.run_id)?;
    let cancel = run.cancel_flag();
    tauri::async_runtime::spawn_blocking(move || {
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
    .map_err(|_| AppError::internal())?
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
            generate_caddyfile(&rules)
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
}
