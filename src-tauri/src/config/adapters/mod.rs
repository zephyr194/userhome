pub mod caddy;
pub mod copilot;
pub mod git;
pub mod npm;
pub mod ssh;
pub mod zsh;

use serde::Serialize;
use serde_json::Value;

use crate::{catalog::ConfigDocumentDefinition, error::AppError};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterView {
    pub content: Option<String>,
    pub content_redacted: bool,
    pub structured: Option<Value>,
}

pub fn inspect(
    definition: &ConfigDocumentDefinition,
    content: &str,
) -> Result<AdapterView, AppError> {
    match definition.adapter_id() {
        "copilot-json" | "copilot-instructions" => copilot::inspect(definition, content),
        "caddyfile" => caddy::inspect(content),
        "git-config" => git::inspect(content),
        "ssh-config" => ssh::inspect(content),
        "zsh-managed-block" => zsh::inspect(content),
        "npmrc" => npm::inspect(content),
        _ => Err(AppError::not_supported(
            "Configuration adapter is not supported.",
        )),
    }
}

pub fn prepare_raw(
    definition: &ConfigDocumentDefinition,
    current: &str,
    proposed: &str,
) -> Result<String, AppError> {
    match definition.adapter_id() {
        "copilot-json" | "copilot-instructions" => {
            copilot::prepare_raw(definition, current, proposed)
        }
        "caddyfile" | "ssh-config" => Ok(proposed.to_owned()),
        "git-config" => git::prepare_raw(current, proposed),
        "zsh-managed-block" => zsh::prepare_raw(current, proposed),
        "npmrc" => npm::prepare_raw(current, proposed),
        _ => Err(AppError::not_supported(
            "Configuration adapter is not supported.",
        )),
    }
}

pub fn prepare_structured(
    definition: &ConfigDocumentDefinition,
    current: &str,
    fields: Value,
) -> Result<String, AppError> {
    match definition.adapter_id() {
        "copilot-json" => copilot::prepare_structured(definition, current, fields),
        "copilot-instructions" => Err(AppError::not_supported(
            "Instruction documents use the validated raw editor.",
        )),
        "caddyfile" => caddy::prepare_structured(current, fields),
        "git-config" => git::prepare_structured(current, fields),
        "ssh-config" => ssh::prepare_structured(current, fields),
        "zsh-managed-block" => zsh::prepare_structured(current, fields),
        "npmrc" => npm::prepare_structured(current, fields),
        _ => Err(AppError::not_supported(
            "Configuration adapter is not supported.",
        )),
    }
}
