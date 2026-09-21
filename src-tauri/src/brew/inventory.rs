use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    BrewPackageKind,
    client::{BrewClient, BrewClientError},
};

const MAX_PACKAGES: usize = 20_000;
const MAX_PACKAGE_TEXT_BYTES: usize = 2 * 1024;
pub const MAX_PAGE_SIZE: u32 = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewPackage {
    kind: BrewPackageKind,
    identifier: String,
    display_name: String,
    description: Option<String>,
    installed_versions: Vec<String>,
    outdated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewInventorySummary {
    available: bool,
    prefix: Option<String>,
    version: Option<String>,
    formula_count: usize,
    cask_count: usize,
}

impl BrewInventorySummary {
    pub fn unavailable() -> Self {
        Self {
            available: false,
            prefix: None,
            version: None,
            formula_count: 0,
            cask_count: 0,
        }
    }

    pub(crate) fn is_available(&self) -> bool {
        self.available
    }
}

#[derive(Debug, Clone)]
pub struct BrewInventory {
    summary: BrewInventorySummary,
    packages: Arc<[BrewPackage]>,
}

impl BrewInventory {
    pub fn summary(&self) -> BrewInventorySummary {
        self.summary.clone()
    }

    pub fn page(&self, query: &BrewPackageQuery) -> Result<BrewPackagePage, InventoryError> {
        if query.page == 0 || query.page_size == 0 || query.page_size > MAX_PAGE_SIZE {
            return Err(InventoryError::InvalidQuery);
        }
        let filter = query
            .filter
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if filter.is_some_and(|value| value.len() > 128 || value.contains('\0')) {
            return Err(InventoryError::InvalidQuery);
        }
        let filter = filter.map(str::to_lowercase);
        let packages = self
            .packages
            .iter()
            .filter(|package| {
                query.kind.is_none_or(|kind| package.kind == kind)
                    && filter.as_ref().is_none_or(|filter| {
                        package.identifier.to_lowercase().contains(filter)
                            || package.display_name.to_lowercase().contains(filter)
                    })
            })
            .cloned()
            .collect::<Vec<_>>();
        let total_items = packages.len();
        let total_pages = total_items.div_ceil(query.page_size as usize);
        let start = (query.page as usize - 1).saturating_mul(query.page_size as usize);
        let items = packages
            .into_iter()
            .skip(start)
            .take(query.page_size as usize)
            .collect();

        Ok(BrewPackagePage {
            page: query.page,
            page_size: query.page_size,
            total_items,
            total_pages,
            items,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrewPackageQuery {
    pub kind: Option<BrewPackageKind>,
    pub filter: Option<String>,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewPackagePage {
    page: u32,
    page_size: u32,
    total_items: usize,
    total_pages: usize,
    items: Vec<BrewPackage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InventoryError {
    NotFound,
    Timeout,
    ProcessFailed,
    OutputTooLarge,
    MalformedJson,
    InvalidQuery,
}

pub fn discover_inventory() -> Result<BrewInventory, InventoryError> {
    let client = BrewClient::resolve().map_err(map_client_error)?;
    let version = client.version().map_err(map_client_error)?;
    let json = client.installed_json().map_err(map_client_error)?;
    parse_inventory(
        &json,
        client.prefix().to_string_lossy().into_owned(),
        version,
    )
}

fn map_client_error(error: BrewClientError) -> InventoryError {
    match error {
        BrewClientError::NotFound => InventoryError::NotFound,
        BrewClientError::Timeout => InventoryError::Timeout,
        BrewClientError::OutputTooLarge => InventoryError::OutputTooLarge,
        BrewClientError::InvalidInstallation | BrewClientError::ProcessFailed { .. } => {
            InventoryError::ProcessFailed
        }
    }
}

fn parse_inventory(
    source: &str,
    prefix: String,
    version: String,
) -> Result<BrewInventory, InventoryError> {
    let root: Value = serde_json::from_str(source).map_err(|_| InventoryError::MalformedJson)?;
    let formulas = root
        .get("formulae")
        .and_then(Value::as_array)
        .ok_or(InventoryError::MalformedJson)?;
    let casks = root
        .get("casks")
        .and_then(Value::as_array)
        .ok_or(InventoryError::MalformedJson)?;
    if formulas.len().saturating_add(casks.len()) > MAX_PACKAGES {
        return Err(InventoryError::MalformedJson);
    }

    let mut packages = Vec::with_capacity(formulas.len() + casks.len());
    for formula in formulas {
        packages.push(parse_formula(formula)?);
    }
    for cask in casks {
        packages.push(parse_cask(cask)?);
    }
    packages.sort_by(|left, right| {
        left.identifier
            .cmp(&right.identifier)
            .then_with(|| kind_order(left.kind).cmp(&kind_order(right.kind)))
    });

    Ok(BrewInventory {
        summary: BrewInventorySummary {
            available: true,
            prefix: Some(prefix),
            version: Some(version),
            formula_count: formulas.len(),
            cask_count: casks.len(),
        },
        packages: packages.into(),
    })
}

fn parse_formula(value: &Value) -> Result<BrewPackage, InventoryError> {
    let object = value.as_object().ok_or(InventoryError::MalformedJson)?;
    let identifier = bounded_text(object.get("name")).ok_or(InventoryError::MalformedJson)?;
    let installed = object
        .get("installed")
        .and_then(Value::as_array)
        .ok_or(InventoryError::MalformedJson)?;
    let installed_versions = installed
        .iter()
        .map(|entry| {
            entry
                .get("version")
                .and_then(Value::as_str)
                .and_then(validate_text)
                .map(ToOwned::to_owned)
                .ok_or(InventoryError::MalformedJson)
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(BrewPackage {
        kind: BrewPackageKind::Formula,
        display_name: identifier.clone(),
        identifier,
        description: optional_text(object.get("desc"))?,
        installed_versions,
        outdated: object
            .get("outdated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn parse_cask(value: &Value) -> Result<BrewPackage, InventoryError> {
    let object = value.as_object().ok_or(InventoryError::MalformedJson)?;
    let identifier = bounded_text(object.get("token")).ok_or(InventoryError::MalformedJson)?;
    let display_name = match object.get("name") {
        Some(Value::String(value)) => validate_text(value)
            .map(ToOwned::to_owned)
            .ok_or(InventoryError::MalformedJson)?,
        Some(Value::Array(values)) => values
            .first()
            .and_then(Value::as_str)
            .and_then(validate_text)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| identifier.clone()),
        None | Some(Value::Null) => identifier.clone(),
        _ => return Err(InventoryError::MalformedJson),
    };
    let installed_versions = match object.get("installed") {
        Some(Value::String(value)) => vec![
            validate_text(value)
                .map(ToOwned::to_owned)
                .ok_or(InventoryError::MalformedJson)?,
        ],
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .and_then(validate_text)
                    .map(ToOwned::to_owned)
                    .ok_or(InventoryError::MalformedJson)
            })
            .collect::<Result<Vec<_>, _>>()?,
        None | Some(Value::Null) => Vec::new(),
        _ => return Err(InventoryError::MalformedJson),
    };

    Ok(BrewPackage {
        kind: BrewPackageKind::Cask,
        identifier,
        display_name,
        description: optional_text(object.get("desc"))?,
        installed_versions,
        outdated: object
            .get("outdated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn bounded_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .and_then(validate_text)
        .map(ToOwned::to_owned)
}

fn optional_text(value: Option<&Value>) -> Result<Option<String>, InventoryError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => validate_text(value)
            .map(|value| Some(value.to_owned()))
            .ok_or(InventoryError::MalformedJson),
        _ => Err(InventoryError::MalformedJson),
    }
}

fn validate_text(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    (!trimmed.is_empty() && trimmed.len() <= MAX_PACKAGE_TEXT_BYTES).then_some(trimmed)
}

fn kind_order(kind: BrewPackageKind) -> u8 {
    match kind {
        BrewPackageKind::Formula => 0,
        BrewPackageKind::Cask => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{
      "formulae": [
        {
          "name": "git",
          "desc": "Distributed revision control",
          "installed": [{"version": "2.51.0"}],
          "outdated": true
        },
        {
          "name": "zsh",
          "desc": null,
          "installed": [{"version": "5.9"}]
        }
      ],
      "casks": [
        {
          "token": "visual-studio-code",
          "name": ["Visual Studio Code"],
          "desc": "Code editor",
          "installed": "1.99.0",
          "outdated": false
        }
      ]
    }"#;

    #[test]
    fn parses_formulae_and_casks_as_distinct_packages() {
        let inventory = parse_inventory(
            FIXTURE,
            "/opt/homebrew".to_owned(),
            "Homebrew 4.6.0".to_owned(),
        )
        .expect("fixture should parse");
        let page = inventory
            .page(&BrewPackageQuery {
                kind: None,
                filter: None,
                page: 1,
                page_size: 20,
            })
            .expect("page should be valid");

        assert_eq!(inventory.summary.formula_count, 2);
        assert_eq!(inventory.summary.cask_count, 1);
        assert_eq!(page.items.len(), 3);
        assert_eq!(page.items[0].kind, BrewPackageKind::Formula);
        assert!(
            page.items
                .iter()
                .any(|package| package.kind == BrewPackageKind::Cask)
        );
    }

    #[test]
    fn paginates_and_filters_inventory() {
        let inventory = parse_inventory(
            FIXTURE,
            "/usr/local".to_owned(),
            "Homebrew 4.6.0".to_owned(),
        )
        .expect("fixture should parse");
        let page = inventory
            .page(&BrewPackageQuery {
                kind: Some(BrewPackageKind::Formula),
                filter: Some("g".to_owned()),
                page: 1,
                page_size: 1,
            })
            .expect("page should be valid");

        assert_eq!(page.total_items, 1);
        assert_eq!(page.total_pages, 1);
        assert_eq!(page.items[0].identifier, "git");
    }

    #[test]
    fn rejects_malformed_or_unbounded_json() {
        assert!(matches!(
            parse_inventory(
                r#"{"formulae": {}, "casks": []}"#,
                "/opt/homebrew".to_owned(),
                "Homebrew".to_owned(),
            ),
            Err(InventoryError::MalformedJson)
        ));
        assert!(matches!(
            parse_inventory(
                r#"{"formulae": [{"name": "git", "installed": "2.0"}], "casks": []}"#,
                "/opt/homebrew".to_owned(),
                "Homebrew".to_owned(),
            ),
            Err(InventoryError::MalformedJson)
        ));
    }
}
