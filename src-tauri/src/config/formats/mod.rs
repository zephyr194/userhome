mod json;
mod text;

use crate::{
    catalog::{ConfigDocumentDefinition, ConfigFormatFamily, ConfigSensitivity},
    error::AppError,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadOnlyFormatView {
    pub content: Option<String>,
    pub redacted: bool,
}

impl ReadOnlyFormatView {
    fn metadata_only() -> Self {
        Self {
            content: None,
            redacted: true,
        }
    }
}

pub fn inspect_read_only(
    definition: &ConfigDocumentDefinition,
    content: &str,
) -> Result<ReadOnlyFormatView, AppError> {
    if !definition.is_read_only() {
        return Err(AppError::not_supported(
            "Generic format inspection is only available for read-only documents.",
        ));
    }

    let sensitivity = definition.sensitivity_kind();
    if sensitivity == ConfigSensitivity::Secret {
        return Ok(ReadOnlyFormatView::metadata_only());
    }

    match definition.format_family() {
        ConfigFormatFamily::Json | ConfigFormatFamily::Jsonc => {
            json::inspect(definition.format(), sensitivity, content)
        }
        ConfigFormatFamily::Ini | ConfigFormatFamily::GitConfig | ConfigFormatFamily::KeyValue => {
            text::inspect_assignments(sensitivity, content)
        }
        ConfigFormatFamily::PlainText if sensitivity == ConfigSensitivity::Standard => {
            Ok(text::plain(content))
        }
        ConfigFormatFamily::Toml
        | ConfigFormatFamily::Yaml
        | ConfigFormatFamily::Plist
        | ConfigFormatFamily::Command
        | ConfigFormatFamily::PlainText => Ok(ReadOnlyFormatView::metadata_only()),
        ConfigFormatFamily::Unknown => Err(AppError::not_supported(
            "Configuration format is not supported.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use crate::catalog::{BUILTIN_CATALOG_JSON, parse_catalog};

    use super::inspect_read_only;

    fn definition(
        format: &str,
        family: &str,
        sensitivity: &str,
    ) -> crate::catalog::ConfigDocumentDefinition {
        let mut catalog: Value =
            serde_json::from_str(BUILTIN_CATALOG_JSON).expect("built-in catalog");
        let document = &mut catalog["apps"][9]["configDocuments"][0];
        document["format"] = Value::String(format.to_owned());
        document["formatFamily"] = Value::String(family.to_owned());
        document["sensitivity"] = Value::String(sensitivity.to_owned());
        parse_catalog(&serde_json::to_string(&catalog).expect("serialize catalog"))
            .expect("format catalog")
            .apps()[9]
            .config_documents()[0]
            .clone()
    }

    #[test]
    fn shared_read_only_handlers_fail_closed_by_family_and_sensitivity() {
        let json = inspect_read_only(
            &definition("JSON", "JSON", "SENSITIVE"),
            r#"{"theme":"dark","apiToken":"secret"}"#,
        )
        .expect("inspect JSON");
        assert!(json.redacted);
        assert!(json.content.as_deref().is_some_and(|value| {
            value.contains("\"theme\": \"dark\"")
                && value.contains("[REDACTED]")
                && !value.contains("secret")
        }));

        let jsonc = inspect_read_only(
            &definition("JSONC", "JSONC", "SENSITIVE"),
            "{\n// comment with secret\n\"apiToken\": \"secret\",\n}\n",
        )
        .expect("inspect JSONC");
        assert!(jsonc.redacted);
        assert!(jsonc.content.as_deref().is_some_and(|value| {
            value.contains("[REDACTED]")
                && !value.contains("comment with secret")
                && !value.contains("\"secret\"")
        }));
        let unicode_jsonc = inspect_read_only(
            &definition("JSONC", "JSONC", "STANDARD"),
            "{\"theme\": \"深色\", \"url\": \"https://example.com/*safe*/\",}\n",
        )
        .expect("inspect Unicode JSONC");
        assert!(unicode_jsonc.content.as_deref().is_some_and(
            |value| value.contains("深色") && value.contains("https://example.com/*safe*/")
        ));
        assert!(
            inspect_read_only(
                &definition("JSONC", "JSONC", "STANDARD"),
                "{\"theme\": \"dark\" /* unterminated\n",
            )
            .is_err()
        );

        let assignments = inspect_read_only(
            &definition("KEY_VALUE", "KEY_VALUE", "SENSITIVE"),
            "# private note\nregion=us-east-1\ntoken=secret\n",
        )
        .expect("inspect assignments");
        assert!(assignments.redacted);
        assert!(assignments.content.as_deref().is_some_and(|value| {
            value.contains("region=[REDACTED]")
                && value.contains("token=[REDACTED]")
                && !value.contains("private note")
                && !value.contains("secret")
        }));

        let plain = inspect_read_only(&definition("TEXT", "PLAIN_TEXT", "STANDARD"), "safe text\n")
            .expect("inspect plain text");
        assert_eq!(plain.content.as_deref(), Some("safe text\n"));
        assert!(!plain.redacted);

        for (format, family, sensitivity) in [
            ("SHELL", "COMMAND", "SENSITIVE"),
            ("TOML", "TOML", "SENSITIVE"),
            ("YAML", "YAML", "SENSITIVE"),
            ("PLIST", "PLIST", "SENSITIVE"),
            ("JSON", "JSON", "SECRET"),
        ] {
            let view = inspect_read_only(
                &definition(format, family, sensitivity),
                "token=must-not-return\n",
            )
            .expect("inspect metadata-only format");
            assert!(view.content.is_none());
            assert!(view.redacted);
        }
    }
}
