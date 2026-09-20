use std::{collections::HashMap, sync::Mutex};

use serde::Deserialize;

use crate::{
    brew::{
        actions::BrewAction,
        client::{BrewClient, BrewClientError, BrewCommand},
    },
    error::AppError,
    process::ProcessOutput,
};

use super::inventory::{ServiceScope, ServiceState, ServiceSummary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceAction {
    Start,
    Stop,
    Restart,
}

impl ServiceAction {
    pub fn label(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
        }
    }

    fn brew_action(self) -> BrewAction {
        match self {
            Self::Start => BrewAction::Start,
            Self::Stop => BrewAction::Stop,
            Self::Restart => BrewAction::Restart,
        }
    }

    pub fn expected_state(self) -> ServiceState {
        match self {
            Self::Start | Self::Restart => ServiceState::Started,
            Self::Stop => ServiceState::Stopped,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceActionInput {
    pub action: ServiceAction,
    pub service_id: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ServiceActionError {
    InvalidInput,
    NotFound,
    Timeout,
    OutputTooLarge,
    Conflict { stdout: String, stderr: String },
    ProcessFailed { stdout: String, stderr: String },
    StateMismatch,
    Elevated(AppError),
}

pub struct ServiceActionCoordinator {
    pending: Mutex<HashMap<String, PendingServiceAction>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingServiceAction {
    pub input: ServiceActionInput,
    pub scope: ServiceScope,
}

impl Default for ServiceActionCoordinator {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}

impl ServiceActionCoordinator {
    pub fn remember(
        &self,
        operation_id: String,
        input: ServiceActionInput,
        scope: ServiceScope,
    ) -> Result<(), AppError> {
        self.pending
            .lock()
            .map_err(|_| AppError::internal())?
            .insert(operation_id, PendingServiceAction { input, scope });
        Ok(())
    }

    pub fn pending(&self, operation_id: &str) -> Result<PendingServiceAction, AppError> {
        self.pending
            .lock()
            .map_err(|_| AppError::internal())?
            .get(operation_id)
            .cloned()
            .ok_or_else(AppError::operation_not_found)
    }

    pub fn forget(&self, operation_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(operation_id);
        }
    }
}

pub fn validate_action(
    input: &ServiceActionInput,
    service: &ServiceSummary,
) -> Result<(), ServiceActionError> {
    if input.service_id != "caddy"
        || service.service_id() != input.service_id
        || !matches!(service.scope(), ServiceScope::User | ServiceScope::System)
    {
        return Err(ServiceActionError::InvalidInput);
    }
    Ok(())
}

pub fn execute_action(input: &ServiceActionInput) -> Result<ProcessOutput, ServiceActionError> {
    if input.service_id != "caddy" {
        return Err(ServiceActionError::InvalidInput);
    }
    let client = BrewClient::resolve().map_err(map_client_error)?;
    client
        .run(&BrewCommand::ServiceAction(input.action.brew_action()))
        .map_err(map_client_error)
}

pub fn verify_refreshed_state(
    input: &ServiceActionInput,
    services: &[ServiceSummary],
) -> Result<(), ServiceActionError> {
    let service = services
        .iter()
        .find(|service| service.service_id() == input.service_id)
        .ok_or(ServiceActionError::StateMismatch)?;
    if service.state() != input.action.expected_state() {
        return Err(ServiceActionError::StateMismatch);
    }
    Ok(())
}

fn map_client_error(error: BrewClientError) -> ServiceActionError {
    match error {
        BrewClientError::NotFound => ServiceActionError::NotFound,
        BrewClientError::InvalidInstallation => ServiceActionError::InvalidInput,
        BrewClientError::Timeout => ServiceActionError::Timeout,
        BrewClientError::OutputTooLarge => ServiceActionError::OutputTooLarge,
        BrewClientError::ProcessFailed { stdout, stderr, .. } if is_service_conflict(&stderr) => {
            ServiceActionError::Conflict { stdout, stderr }
        }
        BrewClientError::ProcessFailed { stdout, stderr, .. } => {
            ServiceActionError::ProcessFailed { stdout, stderr }
        }
    }
}

fn is_service_conflict(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("another active homebrew")
        || lower.contains("already locked")
        || lower.contains("lock file")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::inventory::{ServiceScope, ServiceState, ServiceSummary};

    fn caddy(state: ServiceState) -> ServiceSummary {
        ServiceSummary {
            service_id: "caddy".to_owned(),
            display_name: "Caddy".to_owned(),
            state,
            status: "fixture".to_owned(),
            scope: ServiceScope::User,
            user: Some("alice".to_owned()),
            file: None,
            pid: None,
            exit_code: Some(0),
            manageable: true,
        }
    }

    #[test]
    fn success_requires_the_expected_refreshed_state() {
        let input = ServiceActionInput {
            action: ServiceAction::Restart,
            service_id: "caddy".to_owned(),
        };
        assert!(verify_refreshed_state(&input, &[caddy(ServiceState::Started)]).is_ok());
        assert_eq!(
            verify_refreshed_state(&input, &[caddy(ServiceState::Stopped)]),
            Err(ServiceActionError::StateMismatch)
        );
    }
}
