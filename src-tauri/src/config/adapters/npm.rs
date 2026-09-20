use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::AppError;

use super::AdapterView;
use crate::config::redaction::{redact_assignment_lines, restore_assignment_lines};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NpmFields {
    registry: Option<String>,
    proxy: Option<String>,
    https_proxy: Option<String>,
    strict_ssl: Option<bool>,
    auth_token: Option<String>,
}

pub fn inspect(content: &str) -> Result<AdapterView, AppError> {
    let entries = parse(content)?;
    let (content, redacted) = redact_assignment_lines(content, is_secret_key);
    Ok(AdapterView {
        content: Some(content),
        content_redacted: redacted,
        structured: Some(json!({
            "registry": entries.get("registry"),
            "proxy": entries.get("proxy"),
            "httpsProxy": entries.get("https-proxy"),
            "strictSsl": entries.get("strict-ssl").and_then(|value| match value.to_ascii_lowercase().as_str() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None
            }),
            "hasAuthToken": entries.keys().any(|key| is_secret_key(key))
        })),
    })
}

pub fn prepare_raw(current: &str, proposed: &str) -> Result<String, AppError> {
    restore_assignment_lines(current, proposed, is_secret_key)
}

pub fn prepare_structured(current: &str, fields: Value) -> Result<String, AppError> {
    let fields: NpmFields = serde_json::from_value(fields)
        .map_err(|_| AppError::invalid_input("npm settings are invalid."))?;
    let mut content = current.to_owned();
    update(&mut content, "registry", fields.registry)?;
    update(&mut content, "proxy", fields.proxy)?;
    update(&mut content, "https-proxy", fields.https_proxy)?;
    if let Some(strict_ssl) = fields.strict_ssl {
        content = update_entry(
            &content,
            "strict-ssl",
            Some(if strict_ssl { "true" } else { "false" }),
        );
    }
    if let Some(secret) = fields.auth_token {
        if secret.is_empty() || secret.len() > 4096 || secret.contains(['\n', '\r', '\0']) {
            return Err(AppError::validation_failed(
                "npm authentication replacement is invalid.",
            ));
        }
        let registry = parse(&content)?
            .get("registry")
            .cloned()
            .unwrap_or_else(|| "https://registry.npmjs.org/".to_owned());
        let host = registry
            .strip_prefix("https://")
            .or_else(|| registry.strip_prefix("http://"))
            .unwrap_or(&registry)
            .trim_end_matches('/');
        content = update_entry(&content, &format!("//{host}/:_authToken"), Some(&secret));
    }
    Ok(content)
}

fn parse(content: &str) -> Result<BTreeMap<String, String>, AppError> {
    let mut entries = BTreeMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(['#', ';']) {
            continue;
        }
        let (key, value) = trimmed.split_once('=').ok_or_else(|| {
            AppError::validation_failed("npm configuration entry must use key=value syntax.")
        })?;
        if key.trim().is_empty() {
            return Err(AppError::validation_failed(
                "npm configuration key is invalid.",
            ));
        }
        entries.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
    }
    Ok(entries)
}

fn is_secret_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains(":_authtoken")
        || key.ends_with(":_auth")
        || key.ends_with(":_password")
        || key == "_auth"
        || key == "_authToken".to_ascii_lowercase()
}

fn update(content: &mut String, key: &str, value: Option<String>) -> Result<(), AppError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.len() > 2048 || value.contains(['\n', '\r', '\0']) {
        return Err(AppError::validation_failed("npm setting value is invalid."));
    }
    *content = update_entry(content, key, (!value.is_empty()).then_some(value.as_str()));
    Ok(())
}

fn update_entry(content: &str, key: &str, value: Option<&str>) -> String {
    let mut found = false;
    let mut lines = content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let matches = trimmed
                .split_once('=')
                .is_some_and(|(existing, _)| existing.trim().eq_ignore_ascii_case(key));
            if matches {
                found = true;
                value.map(|value| format!("{key}={value}"))
            } else {
                Some(line.to_owned())
            }
        })
        .collect::<Vec<_>>();
    if !found && let Some(value) = value {
        lines.push(format!("{key}={value}"));
    }
    let mut result = lines.join("\n");
    if content.ends_with('\n') || !result.is_empty() {
        result.push('\n');
    }
    result
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use uuid::Uuid;

    use super::*;
    use crate::{
        catalog::load_builtin_catalog,
        config::{
            ConfigEnvironment,
            read::hash_bytes,
            redaction::REDACTED_VALUE,
            write::{StructuredConfigWriteInput, prepare_structured_write},
        },
    };

    #[test]
    fn masks_existing_auth_and_applies_write_only_replacement() {
        let current = "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=fixture-secret\n";
        let view = inspect(current).expect("inspect");
        let encoded = serde_json::to_string(&view).expect("serialize");
        assert!(!encoded.contains("fixture-secret"));
        assert!(encoded.contains(REDACTED_VALUE));

        let updated = prepare_structured(
            current,
            json!({"registry":null,"proxy":null,"httpsProxy":null,"strictSsl":true,"authToken":"replacement-secret"}),
        )
        .expect("replace");
        assert!(updated.contains("_authToken=replacement-secret"));
        assert!(!updated.contains("fixture-secret"));
    }

    #[test]
    fn raw_editor_cannot_receive_or_replace_plaintext_auth() {
        let current = "//registry.npmjs.org/:_authToken=fixture-secret\n";
        let view = inspect(current).expect("inspect");
        let redacted = view.content.expect("content");
        assert_eq!(
            prepare_raw(current, &redacted).expect("restore placeholder"),
            current
        );
        assert!(prepare_raw(current, "//registry.npmjs.org/:_authToken=leak\n").is_err());
    }

    #[test]
    fn clearing_a_safe_setting_removes_it_without_touching_auth() {
        let current =
            "proxy=http://proxy.example\n//registry.npmjs.org/:_authToken=fixture-secret\n";
        let updated = prepare_structured(
            current,
            json!({"registry":"","proxy":"","httpsProxy":"","strictSsl":null,"authToken":null}),
        )
        .expect("clear");
        assert!(!updated.contains("proxy="));
        assert!(updated.contains("_authToken=fixture-secret"));
    }

    #[test]
    fn secret_replacement_is_absent_from_serialized_preview() {
        let root = std::env::temp_dir().join(format!("userhome-npm-{}", Uuid::new_v4()));
        let home = root.join("home");
        let brew = root.join("brew");
        fs::create_dir_all(&home).expect("home");
        fs::create_dir_all(&brew).expect("brew");
        let current = "registry=https://registry.npmjs.org/\n";
        fs::write(home.join(".npmrc"), current).expect("npmrc");
        let environment = ConfigEnvironment::new(home.clone(), brew, home.join("backups"));
        let (_, preview) = prepare_structured_write(
            &load_builtin_catalog().expect("catalog"),
            &environment,
            StructuredConfigWriteInput {
                app_id: "npm".to_owned(),
                config_id: "npm-user-config".to_owned(),
                expected_hash: hash_bytes(current.as_bytes()),
                fields: json!({
                    "registry": null,
                    "proxy": null,
                    "httpsProxy": null,
                    "strictSsl": true,
                    "authToken": "replacement-secret"
                }),
            },
        )
        .expect("preview");
        let encoded = serde_json::to_string(&preview).expect("serialize");
        assert!(!encoded.contains("replacement-secret"));
        fs::remove_dir_all(root).expect("cleanup");
    }
}
