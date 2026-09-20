use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::AppError;

use super::AdapterView;
use crate::config::redaction::{is_secret_key, redact_assignment_lines, restore_assignment_lines};

pub const START_MARKER: &str = "# >>> UserHome managed >>>";
pub const END_MARKER: &str = "# <<< UserHome managed <<<";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ZshFields {
    aliases: Option<Vec<Entry>>,
    environment: Option<Vec<Entry>>,
    sources: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    name: String,
    value: String,
}

pub fn inspect(content: &str) -> Result<AdapterView, AppError> {
    let range = managed_range(content)?;
    let structured = range.map(|(start, end)| {
        let block = &content[start + START_MARKER.len()..end];
        parse_block(block)
    });
    let (content, redacted) = redact_assignment_lines(content, |key| {
        let key = key.trim_start_matches("export ").trim();
        is_secret_key(key)
    });
    Ok(AdapterView {
        content: Some(content),
        content_redacted: redacted,
        structured,
    })
}

pub fn prepare_structured(current: &str, fields: Value) -> Result<String, AppError> {
    let fields: ZshFields = serde_json::from_value(fields)
        .map_err(|_| AppError::invalid_input("Zsh managed block settings are invalid."))?;
    let block = build_block(fields)?;
    match managed_range(current)? {
        Some((start, end)) => Ok(format!(
            "{}{}{}{}",
            &current[..start],
            START_MARKER,
            block,
            &current[end..]
        )),
        None => {
            let mut output = current.trim_end_matches('\n').to_owned();
            if !output.is_empty() {
                output.push_str("\n\n");
            }
            output.push_str(START_MARKER);
            output.push_str(&block);
            output.push_str(END_MARKER);
            output.push('\n');
            Ok(output)
        }
    }
}

pub fn prepare_raw(current: &str, proposed: &str) -> Result<String, AppError> {
    managed_range(proposed)?;
    restore_assignment_lines(current, proposed, |key| {
        let key = key.trim_start_matches("export ").trim();
        is_secret_key(key)
    })
}

pub fn managed_range(content: &str) -> Result<Option<(usize, usize)>, AppError> {
    let starts = content.match_indices(START_MARKER).collect::<Vec<_>>();
    let ends = content.match_indices(END_MARKER).collect::<Vec<_>>();
    match (starts.as_slice(), ends.as_slice()) {
        ([], []) => Ok(None),
        ([(start, _)], [(end, _)]) if start < end => Ok(Some((*start, *end))),
        _ => Err(AppError::conflict(
            "UserHome managed block markers are missing, duplicated, or out of order.",
        )),
    }
}

fn build_block(fields: ZshFields) -> Result<String, AppError> {
    let mut lines = Vec::new();
    for entry in fields.aliases.unwrap_or_default() {
        validate_name(&entry.name)?;
        validate_shell_value(&entry.value)?;
        lines.push(format!(
            "alias {}={}",
            entry.name,
            shell_quote(&entry.value)
        ));
    }
    for entry in fields.environment.unwrap_or_default() {
        validate_name(&entry.name)?;
        validate_shell_value(&entry.value)?;
        lines.push(format!(
            "export {}={}",
            entry.name,
            shell_quote(&entry.value)
        ));
    }
    for source in fields.sources.unwrap_or_default() {
        if source.is_empty()
            || source.len() > 512
            || source.contains(['\n', '\r', '\0', ';', '`'])
            || source.contains("$(")
        {
            return Err(AppError::validation_failed("Zsh source path is invalid."));
        }
        lines.push(format!("source {}", shell_quote(&source)));
    }
    Ok(format!("\n{}\n", lines.join("\n")))
}

fn parse_block(block: &str) -> Value {
    let mut aliases = Vec::new();
    let mut environment = Vec::new();
    let mut sources = Vec::new();
    for line in block.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("alias ") {
            if let Some((name, value)) = value.split_once('=') {
                aliases.push(json!({"name": name, "value": unquote(value)}));
            }
        } else if let Some(value) = line.strip_prefix("export ") {
            if let Some((name, value)) = value.split_once('=') {
                environment.push(json!({"name": name, "value": unquote(value)}));
            }
        } else if let Some(value) = line.strip_prefix("source ") {
            sources.push(Value::String(unquote(value)));
        }
    }
    json!({"aliases": aliases, "environment": environment, "sources": sources})
}

fn validate_name(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(AppError::validation_failed(
            "Zsh variable or alias name is invalid.",
        ));
    }
    Ok(())
}

fn validate_shell_value(value: &str) -> Result<(), AppError> {
    if value.len() > 1024 || value.contains(['\n', '\r', '\0']) {
        return Err(AppError::validation_failed("Zsh value is invalid."));
    }
    Ok(())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn unquote(value: &str) -> String {
    value
        .strip_prefix('\'')
        .and_then(|value| value.strip_suffix('\''))
        .unwrap_or(value)
        .replace("'\\''", "'")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn only_managed_block_changes() {
        let current = "source ~/.before\n# >>> UserHome managed >>>\nalias old='value'\n# <<< UserHome managed <<<\nsource ~/.after\n";
        let updated = prepare_structured(
            current,
            json!({"aliases":[{"name":"ll","value":"ls -la"}],"environment":[],"sources":[]}),
        )
        .expect("update");
        assert!(updated.starts_with("source ~/.before\n"));
        assert!(updated.ends_with("source ~/.after\n"));
        assert!(updated.contains("alias ll='ls -la'"));
    }

    #[test]
    fn duplicate_or_corrupt_markers_conflict() {
        let duplicate = format!("{START_MARKER}\n{END_MARKER}\n{START_MARKER}\n{END_MARKER}\n");
        assert_eq!(
            managed_range(&duplicate).expect_err("conflict").code(),
            crate::error::AppErrorCode::Conflict
        );
        assert!(managed_range(START_MARKER).is_err());
    }
}
