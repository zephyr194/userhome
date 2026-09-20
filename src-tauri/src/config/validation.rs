pub mod caddy;
pub mod git;
pub mod json;
pub mod npm;
pub mod ssh;
pub mod zsh;

use std::os::unix::fs::PermissionsExt;

use serde::Serialize;

use crate::{catalog::ConfigDocumentDefinition, error::AppError};

use super::ConfigEnvironment;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    valid: bool,
    issues: Vec<String>,
}

impl ValidationResult {
    pub fn valid() -> Self {
        Self {
            valid: true,
            issues: Vec::new(),
        }
    }
}

pub fn validate_bytes(
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
    bytes: &[u8],
) -> Result<(), AppError> {
    let text = validate_text_bytes(definition, bytes)?;
    match definition.validator_id() {
        "json" => json::validate(text)?,
        "markdown" | "text" => {}
        "caddy" => caddy::validate(environment, text)?,
        "git-config" => git::validate(text)?,
        "ssh-config" => {
            validate_ssh_permissions(definition, environment)?;
            ssh::validate(text)?;
        }
        "zsh" => zsh::validate(text)?,
        "npmrc" => npm::validate(text)?,
        _ => {
            return Err(AppError::not_supported(
                "Configuration validator is not supported.",
            ));
        }
    }
    Ok(())
}

pub fn validate_text_bytes<'a>(
    definition: &ConfigDocumentDefinition,
    bytes: &'a [u8],
) -> Result<&'a str, AppError> {
    if bytes.len() > definition.max_size_bytes() {
        return Err(AppError::validation_failed(
            "Configuration exceeds the catalog size limit.",
        ));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| AppError::validation_failed("Configuration must be valid UTF-8."))?;
    if text.contains('\0') {
        return Err(AppError::validation_failed(
            "Configuration contains a forbidden null byte.",
        ));
    }
    Ok(text)
}

pub fn validate_config(
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
    content: &str,
) -> Result<ValidationResult, AppError> {
    validate_bytes(definition, environment, content.as_bytes())?;
    Ok(ValidationResult::valid())
}

fn validate_ssh_permissions(
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
) -> Result<(), AppError> {
    let resolved = super::resolve_path(definition, environment)?;
    let mode = std::fs::metadata(&resolved.target_path)
        .map_err(|_| AppError::not_found("SSH configuration is unavailable."))?
        .permissions()
        .mode()
        & 0o777;
    if mode & 0o077 != 0 {
        return Err(AppError::permission_denied(
            "SSH configuration permissions must not allow group or other access.",
        ));
    }
    Ok(())
}
