use serde::Serialize;
use serde_json::Value;

use super::{
    BrewPackageKind,
    client::{BrewClient, BrewClientError, BrewCommand},
    validate_package_identifier,
};

const MAX_TEXT_BYTES: usize = 2 * 1024;
const MAX_VERSIONS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewPackageDetails {
    kind: BrewPackageKind,
    identifier: String,
    display_name: String,
    description: Option<String>,
    homepage: Option<String>,
    current_version: Option<String>,
    installed_versions: Vec<String>,
    outdated: bool,
}

impl BrewPackageDetails {
    pub(crate) fn current_version(&self) -> Option<&str> {
        self.current_version.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrewDetailsError {
    InvalidIdentifier,
    NotFound,
    Timeout,
    OutputTooLarge,
    ProcessFailed,
    MalformedJson,
}

pub fn details(
    kind: BrewPackageKind,
    identifier: &str,
) -> Result<BrewPackageDetails, BrewDetailsError> {
    if !validate_package_identifier(identifier) {
        return Err(BrewDetailsError::InvalidIdentifier);
    }
    let client = BrewClient::resolve().map_err(map_client_error)?;
    let output = client
        .run(&BrewCommand::Details {
            kind,
            identifier: identifier.to_owned(),
        })
        .map_err(map_client_error)?;
    parse_details(&output.stdout, kind, identifier)
}

fn parse_details(
    source: &str,
    kind: BrewPackageKind,
    identifier: &str,
) -> Result<BrewPackageDetails, BrewDetailsError> {
    let root: Value = serde_json::from_str(source).map_err(|_| BrewDetailsError::MalformedJson)?;
    let entries = root
        .get(match kind {
            BrewPackageKind::Formula => "formulae",
            BrewPackageKind::Cask => "casks",
        })
        .and_then(Value::as_array)
        .ok_or(BrewDetailsError::MalformedJson)?;
    let value = entries
        .iter()
        .find(|entry| {
            entry
                .get(match kind {
                    BrewPackageKind::Formula => "name",
                    BrewPackageKind::Cask => "token",
                })
                .and_then(Value::as_str)
                == Some(identifier)
        })
        .ok_or(BrewDetailsError::NotFound)?;
    match kind {
        BrewPackageKind::Formula => parse_formula(value, identifier),
        BrewPackageKind::Cask => parse_cask(value, identifier),
    }
}

fn parse_formula(value: &Value, identifier: &str) -> Result<BrewPackageDetails, BrewDetailsError> {
    Ok(BrewPackageDetails {
        kind: BrewPackageKind::Formula,
        identifier: identifier.to_owned(),
        display_name: identifier.to_owned(),
        description: optional_text(value.get("desc"))?,
        homepage: optional_text(value.get("homepage"))?,
        current_version: optional_text(value.pointer("/versions/stable"))?,
        installed_versions: array_versions(value.get("installed"), "version")?,
        outdated: value
            .get("outdated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn parse_cask(value: &Value, identifier: &str) -> Result<BrewPackageDetails, BrewDetailsError> {
    let display_name = match value.get("name") {
        Some(Value::String(value)) => bounded_text(value)?,
        Some(Value::Array(values)) => values
            .first()
            .and_then(Value::as_str)
            .map(bounded_text)
            .transpose()?
            .unwrap_or_else(|| identifier.to_owned()),
        None | Some(Value::Null) => identifier.to_owned(),
        _ => return Err(BrewDetailsError::MalformedJson),
    };
    let installed_versions = match value.get("installed") {
        Some(Value::String(value)) => vec![bounded_text(value)?],
        Some(Value::Array(values)) if values.len() <= MAX_VERSIONS => values
            .iter()
            .map(|item| {
                item.as_str()
                    .ok_or(BrewDetailsError::MalformedJson)
                    .and_then(bounded_text)
            })
            .collect::<Result<Vec<_>, _>>()?,
        None | Some(Value::Null) => Vec::new(),
        _ => return Err(BrewDetailsError::MalformedJson),
    };
    Ok(BrewPackageDetails {
        kind: BrewPackageKind::Cask,
        identifier: identifier.to_owned(),
        display_name,
        description: optional_text(value.get("desc"))?,
        homepage: optional_text(value.get("homepage"))?,
        current_version: optional_text(value.get("version"))?,
        installed_versions,
        outdated: value
            .get("outdated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn array_versions(value: Option<&Value>, key: &str) -> Result<Vec<String>, BrewDetailsError> {
    let values = match value {
        Some(Value::Array(values)) if values.len() <= MAX_VERSIONS => values,
        None | Some(Value::Null) => return Ok(Vec::new()),
        _ => return Err(BrewDetailsError::MalformedJson),
    };
    values
        .iter()
        .map(|value| {
            value
                .get(key)
                .and_then(Value::as_str)
                .ok_or(BrewDetailsError::MalformedJson)
                .and_then(bounded_text)
        })
        .collect()
}

fn optional_text(value: Option<&Value>) -> Result<Option<String>, BrewDetailsError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => bounded_text(value).map(Some),
        _ => Err(BrewDetailsError::MalformedJson),
    }
}

fn bounded_text(value: &str) -> Result<String, BrewDetailsError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_TEXT_BYTES {
        Err(BrewDetailsError::MalformedJson)
    } else {
        Ok(value.to_owned())
    }
}

fn map_client_error(error: BrewClientError) -> BrewDetailsError {
    match error {
        BrewClientError::NotFound => BrewDetailsError::NotFound,
        BrewClientError::Timeout => BrewDetailsError::Timeout,
        BrewClientError::OutputTooLarge => BrewDetailsError::OutputTooLarge,
        BrewClientError::InvalidInstallation | BrewClientError::ProcessFailed { .. } => {
            BrewDetailsError::ProcessFailed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_formula_and_cask_into_one_contract() {
        let formula = parse_details(
            r#"{"formulae":[{"name":"caddy","desc":"Web server","homepage":"https://caddyserver.com","versions":{"stable":"2.11.4"},"installed":[{"version":"2.11.4"}],"outdated":false}],"casks":[]}"#,
            BrewPackageKind::Formula,
            "caddy",
        )
        .expect("formula should parse");
        let cask = parse_details(
            r#"{"formulae":[],"casks":[{"token":"firefox","name":["Firefox"],"desc":"Browser","homepage":"https://mozilla.org","version":"143.0","installed":"142.0","outdated":true}]}"#,
            BrewPackageKind::Cask,
            "firefox",
        )
        .expect("cask should parse");

        assert_eq!(formula.current_version.as_deref(), Some("2.11.4"));
        assert_eq!(cask.display_name, "Firefox");
        assert!(cask.outdated);
    }

    #[test]
    fn malformed_json_is_distinct_from_missing_package() {
        assert_eq!(
            parse_details("not-json", BrewPackageKind::Formula, "caddy"),
            Err(BrewDetailsError::MalformedJson)
        );
        assert_eq!(
            parse_details(
                r#"{"formulae":[],"casks":[]}"#,
                BrewPackageKind::Formula,
                "caddy"
            ),
            Err(BrewDetailsError::NotFound)
        );
    }
}
