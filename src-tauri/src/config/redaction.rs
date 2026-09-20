use serde_json::Value;

use crate::error::AppError;

pub const REDACTED_VALUE: &str = "[REDACTED]";

pub fn is_secret_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '.'], "_");
    normalized.contains("token")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("authorization")
        || normalized.contains("api_key")
        || normalized == "_auth"
        || normalized.ends_with("_auth")
}

pub fn redact_json(value: &Value) -> Value {
    redact_json_inner(value, false)
}

fn redact_json_inner(value: &Value, force_secret: bool) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    let protected_container =
                        matches!(key.to_ascii_lowercase().as_str(), "env" | "headers");
                    (
                        key.clone(),
                        if force_secret || is_secret_key(key) {
                            Value::String(REDACTED_VALUE.to_owned())
                        } else {
                            redact_json_inner(value, protected_container)
                        },
                    )
                })
                .collect(),
        ),
        Value::Array(values) if force_secret => Value::String(REDACTED_VALUE.to_owned()),
        Value::Array(values) => Value::Array(
            values
                .iter()
                .map(|value| redact_json_inner(value, false))
                .collect(),
        ),
        _ if force_secret => Value::String(REDACTED_VALUE.to_owned()),
        _ => value.clone(),
    }
}

pub fn restore_redacted_json(current: &Value, proposed: &mut Value) -> Result<(), AppError> {
    restore_redacted_json_inner(current, proposed, false)
}

fn restore_redacted_json_inner(
    current: &Value,
    proposed: &mut Value,
    force_secret: bool,
) -> Result<(), AppError> {
    if force_secret {
        if let (Value::Object(current), Value::Object(proposed)) = (current, &mut *proposed) {
            for (key, proposed_value) in proposed {
                let current_value = current.get(key).ok_or_else(|| {
                    AppError::validation_failed(
                        "Secret JSON fields must use the replacement-only editor.",
                    )
                })?;
                restore_redacted_json_inner(current_value, proposed_value, true)?;
            }
            return Ok(());
        }
        if proposed.as_str() == Some(REDACTED_VALUE) {
            *proposed = current.clone();
            return Ok(());
        }
        return Err(AppError::validation_failed(
            "Secret JSON fields must use the replacement-only editor.",
        ));
    }
    match (current, proposed) {
        (Value::Object(current), Value::Object(proposed)) => {
            for (key, proposed_value) in proposed {
                let protected_container =
                    matches!(key.to_ascii_lowercase().as_str(), "env" | "headers");
                if is_secret_key(key) {
                    if proposed_value.as_str() != Some(REDACTED_VALUE) {
                        return Err(AppError::validation_failed(
                            "Secret JSON fields must use the replacement-only editor.",
                        ));
                    }
                    let current_value = current.get(key).ok_or_else(|| {
                        AppError::validation_failed(
                            "A redacted JSON field does not match the current document.",
                        )
                    })?;
                    *proposed_value = current_value.clone();
                } else if let Some(current_value) = current.get(key) {
                    restore_redacted_json_inner(
                        current_value,
                        proposed_value,
                        protected_container,
                    )?;
                }
            }
            Ok(())
        }
        (Value::Array(current), Value::Array(proposed)) => {
            for (index, proposed_value) in proposed.iter_mut().enumerate() {
                if let Some(current_value) = current.get(index) {
                    restore_redacted_json_inner(current_value, proposed_value, false)?;
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

pub fn redact_assignment_lines(content: &str, is_secret: impl Fn(&str) -> bool) -> (String, bool) {
    let trailing_newline = content.ends_with('\n');
    let mut redacted = false;
    let content = content
        .lines()
        .map(|line| {
            let Some((key, _)) = line.split_once('=') else {
                return line.to_owned();
            };
            if !is_secret(key.trim()) {
                return line.to_owned();
            }
            redacted = true;
            let prefix_len = line.find('=').unwrap_or(line.len()) + 1;
            format!("{}{}", &line[..prefix_len], REDACTED_VALUE)
        })
        .collect::<Vec<_>>()
        .join("\n");
    (
        if trailing_newline {
            format!("{content}\n")
        } else {
            content
        },
        redacted,
    )
}

pub fn restore_assignment_lines(
    current: &str,
    proposed: &str,
    is_secret: impl Fn(&str) -> bool,
) -> Result<String, AppError> {
    let current_secrets = current
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            is_secret(key).then(|| (key.to_ascii_lowercase(), value.to_owned()))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut output = Vec::new();
    for line in proposed.lines() {
        let Some((key, value)) = line.split_once('=') else {
            output.push(line.to_owned());
            continue;
        };
        let normalized = key.trim().to_ascii_lowercase();
        if !is_secret(&normalized) {
            output.push(line.to_owned());
            continue;
        }
        if value != REDACTED_VALUE {
            return Err(AppError::validation_failed(
                "Secret values must use the replacement-only editor.",
            ));
        }
        let current_value = current_secrets.get(&normalized).ok_or_else(|| {
            AppError::validation_failed("A redacted value does not match the current document.")
        })?;
        output.push(format!("{key}={current_value}"));
    }
    let mut content = output.join("\n");
    if proposed.ends_with('\n') {
        content.push('\n');
    }
    Ok(content)
}
