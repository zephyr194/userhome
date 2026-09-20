use serde::{Deserialize, Serialize};

use super::{
    BrewPackageKind,
    client::{BrewClient, BrewClientError, BrewCommand, valid_search_query},
    inventory::MAX_PAGE_SIZE,
    validate_package_identifier,
};

const MAX_SEARCH_RESULTS: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BrewSearchQuery {
    pub query: String,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewSearchResult {
    kind: BrewPackageKind,
    identifier: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewSearchPage {
    page: u32,
    page_size: u32,
    total_items: usize,
    total_pages: usize,
    items: Vec<BrewSearchResult>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrewSearchError {
    InvalidQuery,
    Timeout,
    OutputTooLarge,
    ProcessFailed,
    MalformedOutput,
}

pub fn search(query: &BrewSearchQuery) -> Result<BrewSearchPage, BrewSearchError> {
    validate_query(query)?;
    let client = BrewClient::resolve().map_err(map_client_error)?;
    let output = client
        .run(&BrewCommand::Search(query.query.trim().to_owned()))
        .map_err(map_client_error)?;
    page_results(parse_search_output(&output.stdout)?, query)
}

fn validate_query(query: &BrewSearchQuery) -> Result<(), BrewSearchError> {
    if !valid_search_query(&query.query)
        || query.page == 0
        || query.page_size == 0
        || query.page_size > MAX_PAGE_SIZE
    {
        return Err(BrewSearchError::InvalidQuery);
    }
    Ok(())
}

fn page_results(
    results: Vec<BrewSearchResult>,
    query: &BrewSearchQuery,
) -> Result<BrewSearchPage, BrewSearchError> {
    validate_query(query)?;
    let total_items = results.len();
    let total_pages = total_items.div_ceil(query.page_size as usize);
    let start = (query.page as usize - 1).saturating_mul(query.page_size as usize);
    Ok(BrewSearchPage {
        page: query.page,
        page_size: query.page_size,
        total_items,
        total_pages,
        items: results
            .into_iter()
            .skip(start)
            .take(query.page_size as usize)
            .collect(),
    })
}

fn parse_search_output(source: &str) -> Result<Vec<BrewSearchResult>, BrewSearchError> {
    let mut kind = None;
    let mut results = Vec::new();
    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        match line {
            "==> Formulae" => {
                kind = Some(BrewPackageKind::Formula);
                continue;
            }
            "==> Casks" => {
                kind = Some(BrewPackageKind::Cask);
                continue;
            }
            _ => {}
        }
        let current_kind = kind.ok_or(BrewSearchError::MalformedOutput)?;
        for identifier in line.split_whitespace() {
            if !validate_package_identifier(identifier) {
                return Err(BrewSearchError::MalformedOutput);
            }
            results.push(BrewSearchResult {
                kind: current_kind,
                identifier: identifier.to_owned(),
            });
            if results.len() > MAX_SEARCH_RESULTS {
                return Err(BrewSearchError::MalformedOutput);
            }
        }
    }
    Ok(results)
}

fn map_client_error(error: BrewClientError) -> BrewSearchError {
    match error {
        BrewClientError::Timeout => BrewSearchError::Timeout,
        BrewClientError::OutputTooLarge => BrewSearchError::OutputTooLarge,
        BrewClientError::NotFound
        | BrewClientError::InvalidInstallation
        | BrewClientError::ProcessFailed { .. } => BrewSearchError::ProcessFailed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bounded_formula_and_cask_results() {
        let results =
            parse_search_output("==> Formulae\ncaddy\ncaddy-security\n\n==> Casks\ncaddy-ui\n")
                .expect("fixture should parse");

        assert_eq!(results.len(), 3);
        assert_eq!(results[0].kind, BrewPackageKind::Formula);
        assert_eq!(results[2].kind, BrewPackageKind::Cask);
    }

    #[test]
    fn rejects_untyped_or_flag_shaped_output() {
        assert_eq!(
            parse_search_output("caddy"),
            Err(BrewSearchError::MalformedOutput)
        );
        assert_eq!(
            parse_search_output("==> Formulae\n--debug"),
            Err(BrewSearchError::MalformedOutput)
        );
    }

    #[test]
    fn rejects_queries_that_could_become_flags() {
        assert_eq!(
            validate_query(&BrewSearchQuery {
                query: "--formula".to_owned(),
                page: 1,
                page_size: 20,
            }),
            Err(BrewSearchError::InvalidQuery)
        );
    }
}
