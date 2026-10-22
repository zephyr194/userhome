use serde::Serialize;
use serde_json::Value;

use crate::brew::client::{BrewClient, BrewClientError, BrewCommand};

const MAX_SERVICES: usize = 512;
const MAX_TEXT_BYTES: usize = 2 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceScope {
    User,
    System,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServiceState {
    Started,
    Stopped,
    Error,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSummary {
    pub(crate) service_id: String,
    pub(crate) display_name: String,
    pub(crate) state: ServiceState,
    pub(crate) status: String,
    pub(crate) scope: ServiceScope,
    pub(crate) user: Option<String>,
    pub(crate) file: Option<String>,
    pub(crate) pid: Option<u64>,
    pub(crate) exit_code: Option<i64>,
    pub(crate) manageable: bool,
}

impl ServiceSummary {
    pub(crate) fn state(&self) -> ServiceState {
        self.state
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceInventoryError {
    NotFound,
    Timeout,
    OutputTooLarge,
    ProcessFailed,
    MalformedJson,
}

pub fn list_services() -> Result<Vec<ServiceSummary>, ServiceInventoryError> {
    let client = BrewClient::resolve().map_err(map_client_error)?;
    let output = client
        .run(&BrewCommand::ServicesList)
        .map_err(map_client_error)?;
    parse_services(&output.stdout)
}

fn parse_services(source: &str) -> Result<Vec<ServiceSummary>, ServiceInventoryError> {
    let values: Value =
        serde_json::from_str(source).map_err(|_| ServiceInventoryError::MalformedJson)?;
    let values = values
        .as_array()
        .ok_or(ServiceInventoryError::MalformedJson)?;
    if values.len() > MAX_SERVICES {
        return Err(ServiceInventoryError::MalformedJson);
    }

    values
        .iter()
        .map(|value| {
            let object = value
                .as_object()
                .ok_or(ServiceInventoryError::MalformedJson)?;
            let service_id = required_text(object.get("name"))?;
            let status = required_text(object.get("status"))?;
            let user = optional_text(object.get("user"))?;
            let file = optional_text(object.get("file"))?;
            let scope = service_scope(&service_id, user.as_deref(), file.as_deref());
            let state = match status.to_ascii_lowercase().as_str() {
                "started" => ServiceState::Started,
                "stopped" | "none" => ServiceState::Stopped,
                "error" => ServiceState::Error,
                _ => ServiceState::Unknown,
            };
            let manageable = service_id == "caddy" && matches!(scope, ServiceScope::User);
            Ok(ServiceSummary {
                display_name: match service_id.as_str() {
                    "caddy" => "Caddy".to_owned(),
                    "unbound" => "Unbound".to_owned(),
                    _ => service_id.clone(),
                },
                service_id,
                state,
                status,
                scope,
                user,
                file,
                pid: optional_u64(object.get("pid"))?,
                exit_code: optional_i64(object.get("exit_code"))?,
                manageable,
            })
        })
        .collect()
}

fn service_scope(service_id: &str, user: Option<&str>, file: Option<&str>) -> ServiceScope {
    if user == Some("root")
        || file.is_some_and(|value| value.starts_with("/Library/LaunchDaemons/"))
    {
        ServiceScope::System
    } else if user.is_some()
        || file.is_some_and(|value| value.contains("/Library/LaunchAgents/"))
        || service_id == "caddy"
    {
        ServiceScope::User
    } else {
        ServiceScope::Unknown
    }
}

fn required_text(value: Option<&Value>) -> Result<String, ServiceInventoryError> {
    optional_text(value)?.ok_or(ServiceInventoryError::MalformedJson)
}

fn optional_text(value: Option<&Value>) -> Result<Option<String>, ServiceInventoryError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if !value.trim().is_empty() && value.len() <= MAX_TEXT_BYTES => {
            Ok(Some(value.trim().to_owned()))
        }
        _ => Err(ServiceInventoryError::MalformedJson),
    }
}

fn optional_u64(value: Option<&Value>) -> Result<Option<u64>, ServiceInventoryError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .map(Some)
            .ok_or(ServiceInventoryError::MalformedJson),
    }
}

fn optional_i64(value: Option<&Value>) -> Result<Option<i64>, ServiceInventoryError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_i64()
            .map(Some)
            .ok_or(ServiceInventoryError::MalformedJson),
    }
}

fn map_client_error(error: BrewClientError) -> ServiceInventoryError {
    match error {
        BrewClientError::NotFound => ServiceInventoryError::NotFound,
        BrewClientError::Timeout => ServiceInventoryError::Timeout,
        BrewClientError::OutputTooLarge => ServiceInventoryError::OutputTooLarge,
        BrewClientError::InvalidInstallation | BrewClientError::ProcessFailed { .. } => {
            ServiceInventoryError::ProcessFailed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_user_system_and_unknown_service_scope() {
        let services = parse_services(
            r#"[
              {"name":"caddy","status":"started","user":"alice","file":"/Users/alice/Library/LaunchAgents/homebrew.mxcl.caddy.plist","pid":123,"exit_code":0},
              {"name":"unbound","status":"stopped","user":"root","file":"/Library/LaunchDaemons/homebrew.mxcl.unbound.plist","pid":null,"exit_code":0},
              {"name":"other","status":"unknown","user":null,"file":null,"pid":null,"exit_code":null}
            ]"#,
        )
        .expect("fixture should parse");

        assert_eq!(services[0].scope, ServiceScope::User);
        assert!(services[0].manageable);
        assert_eq!(services[1].display_name, "Unbound");
        assert_eq!(services[1].scope, ServiceScope::System);
        assert!(!services[1].manageable);
        assert_eq!(services[2].scope, ServiceScope::Unknown);
        assert!(!services[2].manageable);
    }

    #[test]
    fn rejects_malformed_service_json() {
        assert_eq!(
            parse_services(r#"[{"name":"caddy","status":42}]"#),
            Err(ServiceInventoryError::MalformedJson)
        );
    }

    #[test]
    fn system_caddy_is_not_manageable() {
        let services = parse_services(
            r#"[{"name":"caddy","status":"started","user":"root","file":"/Library/LaunchDaemons/homebrew.mxcl.caddy.plist","pid":123,"exit_code":0}]"#,
        )
        .expect("fixture");
        assert_eq!(services[0].scope, ServiceScope::System);
        assert!(!services[0].manageable);
    }
}
