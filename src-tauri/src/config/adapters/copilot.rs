use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::{catalog::ConfigDocumentDefinition, error::AppError};

use super::AdapterView;
use crate::config::redaction::{redact_json, restore_redacted_json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CopilotSettings {
    model: Option<String>,
    theme: Option<String>,
    banner: Option<bool>,
    reasoning_effort: Option<String>,
}

pub fn inspect(
    definition: &ConfigDocumentDefinition,
    content: &str,
) -> Result<AdapterView, AppError> {
    if definition.adapter_id() == "copilot-instructions" {
        return Ok(AdapterView {
            content: Some(content.to_owned()),
            content_redacted: false,
            structured: None,
        });
    }

    let value = parse_object(content)?;
    let redacted = redact_json(&Value::Object(value.clone()));
    let structured = matches!(
        definition.config_id(),
        "copilot-config" | "copilot-settings"
    )
    .then(|| {
        json!({
            "model": value.get("model").and_then(Value::as_str),
            "theme": value.get("theme").and_then(Value::as_str),
            "banner": value.get("banner").and_then(Value::as_bool),
            "reasoningEffort": value.get("reasoningEffort").and_then(Value::as_str)
        })
    });
    let content = serde_json::to_string_pretty(&redacted).map_err(|_| AppError::internal())?;
    Ok(AdapterView {
        content: Some(format!("{content}\n")),
        content_redacted: redacted != Value::Object(value),
        structured,
    })
}

pub fn prepare_raw(
    definition: &ConfigDocumentDefinition,
    current: &str,
    proposed: &str,
) -> Result<String, AppError> {
    if definition.adapter_id() == "copilot-instructions" {
        return Ok(proposed.to_owned());
    }
    let current = Value::Object(parse_object(current)?);
    let mut proposed = Value::Object(parse_object(proposed)?);
    restore_redacted_json(&current, &mut proposed)?;
    let encoded = serde_json::to_string_pretty(&proposed).map_err(|_| AppError::internal())?;
    Ok(format!("{encoded}\n"))
}

pub fn prepare_structured(
    definition: &ConfigDocumentDefinition,
    current: &str,
    fields: Value,
) -> Result<String, AppError> {
    if !matches!(
        definition.config_id(),
        "copilot-config" | "copilot-settings"
    ) {
        return Err(AppError::not_supported(
            "This Copilot document has no supported structured fields.",
        ));
    }
    let fields: CopilotSettings = serde_json::from_value(fields)
        .map_err(|_| AppError::invalid_input("Copilot settings are invalid."))?;
    let mut object = parse_object(current)?;
    set_optional_string(&mut object, "model", fields.model)?;
    set_optional_string(&mut object, "theme", fields.theme)?;
    set_optional_string(&mut object, "reasoningEffort", fields.reasoning_effort)?;
    if let Some(value) = fields.banner {
        object.insert("banner".to_owned(), Value::Bool(value));
    }
    let encoded =
        serde_json::to_string_pretty(&Value::Object(object)).map_err(|_| AppError::internal())?;
    Ok(format!("{encoded}\n"))
}

fn parse_object(content: &str) -> Result<Map<String, Value>, AppError> {
    serde_json::from_str::<Value>(content)
        .map_err(|_| AppError::validation_failed("Copilot configuration JSON is invalid."))?
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::validation_failed("Copilot configuration must be a JSON object."))
}

fn set_optional_string(
    object: &mut Map<String, Value>,
    key: &str,
    value: Option<String>,
) -> Result<(), AppError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.len() > 128 || value.contains(['\n', '\0']) {
        return Err(AppError::validation_failed(
            "Copilot setting value is invalid.",
        ));
    }
    if value.is_empty() {
        object.remove(key);
    } else {
        object.insert(key.to_owned(), Value::String(value));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::catalog::load_builtin_catalog;

    use super::*;

    fn definition(config_id: &str) -> ConfigDocumentDefinition {
        load_builtin_catalog()
            .expect("catalog")
            .config_document("github-copilot", config_id)
            .expect("definition")
            .1
            .clone()
    }

    #[test]
    fn preserves_unknown_keys_and_redacts_secret_values() {
        let current = r#"{"model":"gpt","futureKey":{"enabled":true},"apiToken":"fixture-secret"}"#;
        let updated = prepare_structured(
            &definition("copilot-config"),
            current,
            json!({"model":"auto","theme":null,"banner":true,"reasoningEffort":null}),
        )
        .expect("structured update");
        let value: Value = serde_json::from_str(&updated).expect("json");
        assert_eq!(value["model"], "auto");
        assert_eq!(value["futureKey"]["enabled"], true);
        assert_eq!(value["apiToken"], "fixture-secret");

        let view = inspect(&definition("copilot-config"), current).expect("inspect");
        let encoded = serde_json::to_string(&view).expect("serialize");
        assert!(!encoded.contains("fixture-secret"));
        assert!(encoded.contains("[REDACTED]"));
    }

    #[test]
    fn raw_edit_restores_redacted_unknown_secret() {
        let current = r#"{"futureToken":"fixture-secret","unknown":1}"#;
        let proposed = "{\n  \"futureToken\": \"[REDACTED]\",\n  \"unknown\": 2\n}\n";
        let updated =
            prepare_raw(&definition("copilot-config"), current, proposed).expect("raw update");
        let value: Value = serde_json::from_str(&updated).expect("json");
        assert_eq!(value["futureToken"], "fixture-secret");
        assert_eq!(value["unknown"], 2);
    }

    #[test]
    fn mcp_environment_values_are_never_exposed() {
        let current =
            r#"{"mcpServers":{"example":{"command":"server","env":{"OPAQUE":"fixture-secret"}}}}"#;
        let view = inspect(&definition("copilot-mcp-config"), current).expect("inspect");
        let encoded = serde_json::to_string(&view).expect("serialize");
        assert!(!encoded.contains("fixture-secret"));
        assert!(encoded.contains("[REDACTED]"));
        let redacted = view.content.expect("redacted content");
        let restored = prepare_raw(&definition("copilot-mcp-config"), current, &redacted)
            .expect("restore unchanged secrets");
        let restored: Value = serde_json::from_str(&restored).expect("json");
        assert_eq!(
            restored["mcpServers"]["example"]["env"]["OPAQUE"],
            "fixture-secret"
        );
    }
}
