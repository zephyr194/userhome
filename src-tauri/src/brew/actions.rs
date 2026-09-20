use std::{collections::HashMap, sync::Mutex};

use serde::{Deserialize, Serialize};

use crate::process::ProcessOutput;

use super::{
    BrewPackageKind,
    client::{BrewClient, BrewClientError, BrewCommand},
    validate_package_identifier,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrewAction {
    Install,
    Upgrade,
    Uninstall,
    Start,
    Stop,
    Restart,
}

impl BrewAction {
    pub fn as_brew_subcommand(self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Upgrade => "upgrade",
            Self::Uninstall => "uninstall",
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrewActionInput {
    pub action: BrewAction,
    pub kind: BrewPackageKind,
    pub identifier: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrewActionError {
    InvalidInput,
    NotFound,
    Timeout,
    OutputTooLarge,
    Conflict { stdout: String, stderr: String },
    ProcessFailed { stdout: String, stderr: String },
}

pub struct BrewActionCoordinator {
    pending: Mutex<HashMap<String, BrewActionInput>>,
}

impl Default for BrewActionCoordinator {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}

impl BrewActionCoordinator {
    pub fn remember(
        &self,
        operation_id: String,
        input: BrewActionInput,
    ) -> Result<(), crate::error::AppError> {
        self.pending
            .lock()
            .map_err(|_| crate::error::AppError::internal())?
            .insert(operation_id, input);
        Ok(())
    }

    pub fn pending(&self, operation_id: &str) -> Result<BrewActionInput, crate::error::AppError> {
        self.pending
            .lock()
            .map_err(|_| crate::error::AppError::internal())?
            .get(operation_id)
            .cloned()
            .ok_or_else(crate::error::AppError::operation_not_found)
    }

    pub fn forget(&self, operation_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(operation_id);
        }
    }
}

pub fn validate_action(input: &BrewActionInput) -> Result<(), BrewActionError> {
    if !matches!(
        input.action,
        BrewAction::Install | BrewAction::Upgrade | BrewAction::Uninstall
    ) || !validate_package_identifier(&input.identifier)
    {
        return Err(BrewActionError::InvalidInput);
    }
    Ok(())
}

pub fn execute_action(input: &BrewActionInput) -> Result<ProcessOutput, BrewActionError> {
    validate_action(input)?;
    let client = BrewClient::resolve().map_err(map_client_error)?;
    client
        .run(&BrewCommand::Action {
            action: input.action,
            kind: input.kind,
            identifier: input.identifier.clone(),
        })
        .map_err(map_client_error)
}

fn map_client_error(error: BrewClientError) -> BrewActionError {
    match error {
        BrewClientError::NotFound => BrewActionError::NotFound,
        BrewClientError::InvalidInstallation => BrewActionError::InvalidInput,
        BrewClientError::Timeout => BrewActionError::Timeout,
        BrewClientError::OutputTooLarge => BrewActionError::OutputTooLarge,
        BrewClientError::ProcessFailed { stdout, stderr, .. }
            if is_package_manager_conflict(&stderr) =>
        {
            BrewActionError::Conflict { stdout, stderr }
        }
        BrewClientError::ProcessFailed { stdout, stderr, .. } => {
            BrewActionError::ProcessFailed { stdout, stderr }
        }
    }
}

fn is_package_manager_conflict(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("another active homebrew")
        || lower.contains("already locked")
        || lower.contains("lock file")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_manager_lock_is_a_distinct_conflict() {
        assert!(is_package_manager_conflict(
            "Error: Another active Homebrew process is already using this lock file."
        ));
        assert!(!is_package_manager_conflict("Error: download failed"));
    }
}
