use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    caddy::{
        config::{CaddyRules, RulesValidation},
        detect::{Candidate, DetectReport, SystemVersionRunner, detect, fixed_candidates},
        diff::{DiffLine, line_diff},
        generate::generate_caddyfile,
        store::{CaddyStore, LoadedRules},
    },
    error::AppError,
    grants::{GrantCoordinator, GrantId, GrantPurpose},
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

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::{
        caddy::{
            config::{
                Exposure, ExposureReason, IssueCode, Listen, RULES_VERSION, Severity, SiteRule,
                Upstream, UpstreamScheme,
            },
            diff::LineChange,
        },
        error::AppErrorCode,
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
}
