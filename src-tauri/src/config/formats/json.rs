use serde_json::Value;

use crate::{catalog::ConfigSensitivity, config::redaction::redact_json, error::AppError};

use super::ReadOnlyFormatView;

pub(super) fn inspect(
    format: &str,
    sensitivity: ConfigSensitivity,
    content: &str,
) -> Result<ReadOnlyFormatView, AppError> {
    let normalized = match format {
        "JSON" => content.to_owned(),
        "JSONC" => normalize_jsonc(content)?,
        _ => {
            return Err(AppError::not_supported(
                "JSON format capability is not supported.",
            ));
        }
    };
    let value: Value = serde_json::from_str(&normalized)
        .map_err(|_| AppError::validation_failed("Read-only configuration JSON is invalid."))?;

    if sensitivity == ConfigSensitivity::Standard {
        return Ok(ReadOnlyFormatView {
            content: Some(format_json(&value)?),
            redacted: false,
        });
    }

    let redacted = redact_json(&value);
    Ok(ReadOnlyFormatView {
        content: Some(format_json(&redacted)?),
        redacted: redacted != value,
    })
}

fn format_json(value: &Value) -> Result<String, AppError> {
    serde_json::to_string_pretty(value)
        .map(|content| format!("{content}\n"))
        .map_err(|_| AppError::internal())
}

fn normalize_jsonc(content: &str) -> Result<String, AppError> {
    let without_comments = strip_comments(content)?;
    strip_trailing_commas(&without_comments)
}

fn strip_comments(content: &str) -> Result<String, AppError> {
    let chars = content.as_bytes();
    let mut output = Vec::with_capacity(chars.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    let mut block_comment = false;
    let mut line_comment = false;

    while index < chars.len() {
        let byte = chars[index];
        let next = chars.get(index + 1).copied();
        if line_comment {
            if byte == b'\n' {
                line_comment = false;
                output.push(byte);
            } else {
                output.push(b' ');
            }
        } else if block_comment {
            if byte == b'*' && next == Some(b'/') {
                output.extend_from_slice(b"  ");
                index += 1;
                block_comment = false;
            } else if byte == b'\n' {
                output.push(byte);
            } else {
                output.push(b' ');
            }
        } else if in_string {
            output.push(byte);
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
            output.push(byte);
        } else if byte == b'/' && next == Some(b'/') {
            output.extend_from_slice(b"  ");
            index += 1;
            line_comment = true;
        } else if byte == b'/' && next == Some(b'*') {
            output.extend_from_slice(b"  ");
            index += 1;
            block_comment = true;
        } else {
            output.push(byte);
        }
        index += 1;
    }

    if block_comment || in_string {
        return Err(AppError::validation_failed(
            "Read-only configuration JSONC is invalid.",
        ));
    }
    String::from_utf8(output).map_err(|_| AppError::internal())
}

fn strip_trailing_commas(content: &str) -> Result<String, AppError> {
    let chars = content.as_bytes();
    let mut output = Vec::with_capacity(chars.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;

    while index < chars.len() {
        let byte = chars[index];
        if in_string {
            output.push(byte);
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
            output.push(byte);
        } else if byte == b',' {
            let next = chars[index + 1..]
                .iter()
                .copied()
                .find(|candidate| !candidate.is_ascii_whitespace());
            if !matches!(next, Some(b'}' | b']')) {
                output.push(byte);
            }
        } else {
            output.push(byte);
        }
        index += 1;
    }
    String::from_utf8(output).map_err(|_| AppError::internal())
}
