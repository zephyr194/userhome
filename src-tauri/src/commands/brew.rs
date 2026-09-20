use std::collections::BTreeMap;

use tauri::State;

use crate::{
    brew::{
        BrewPackageKind,
        actions::{
            BrewAction, BrewActionCoordinator, BrewActionError, BrewActionInput, execute_action,
        },
        details::{BrewDetailsError, BrewPackageDetails, details},
        inventory::{BrewPackagePage, BrewPackageQuery, InventoryError},
        search::{BrewSearchError, BrewSearchPage, BrewSearchQuery, search},
    },
    discovery::refresh::DiscoveryCoordinator,
    error::AppError,
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
    },
};

#[tauri::command]
pub async fn list_brew_packages(
    coordinator: State<'_, DiscoveryCoordinator>,
    query: BrewPackageQuery,
) -> Result<BrewPackagePage, AppError> {
    let coordinator = coordinator.inner().clone();
    tauri::async_runtime::spawn_blocking(move || coordinator.brew_page(&query))
        .await
        .map_err(|_| AppError::internal())?
        .map_err(map_inventory_error)
}

#[tauri::command]
pub async fn search_brew_packages(query: BrewSearchQuery) -> Result<BrewSearchPage, AppError> {
    tauri::async_runtime::spawn_blocking(move || search(&query))
        .await
        .map_err(|_| AppError::internal())?
        .map_err(map_search_error)
}

#[tauri::command]
pub async fn get_brew_package(
    kind: BrewPackageKind,
    identifier: String,
) -> Result<BrewPackageDetails, AppError> {
    tauri::async_runtime::spawn_blocking(move || details(kind, &identifier))
        .await
        .map_err(|_| AppError::internal())?
        .map_err(map_details_error)
}

#[tauri::command]
pub fn preview_brew_action(
    brew: State<'_, BrewActionCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: BrewActionInput,
) -> Result<OperationPreview, AppError> {
    crate::brew::actions::validate_action(&input).map_err(|error| map_action_error(&error))?;
    let intent = brew_action_intent(&input);
    let kind = package_kind_label(input.kind);
    let action = action_label(input.action);
    let destructive = input.action == BrewAction::Uninstall;
    let preview = operations.preview(
        intent,
        &format!("{action} {kind} {}.", input.identifier),
        vec![
            format!("Package kind: {kind}"),
            format!("Package identifier: {}", input.identifier),
            if destructive {
                "Remove the selected package and its Homebrew-managed files.".to_owned()
            } else {
                format!("Run the allowlisted Homebrew {action} operation.")
            },
            "Run without root privileges or elevation.".to_owned(),
        ],
        false,
    )?;
    brew.remember(preview.operation_id.clone(), input)?;
    Ok(preview)
}

#[tauri::command]
pub async fn execute_brew_action(
    brew: State<'_, BrewActionCoordinator>,
    discovery: State<'_, DiscoveryCoordinator>,
    operations: State<'_, OperationCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    let input = brew.pending(&operation_id)?;
    let intent = brew_action_intent(&input);
    if let Err(error) = operations.authorize_mutation(&operation_id, &intent) {
        if error.code() == crate::error::AppErrorCode::Timeout {
            brew.forget(&operation_id);
        }
        return Err(error);
    }
    operations.record_progress(&operation_id, "Running allowlisted Homebrew command.")?;
    let action_result = tauri::async_runtime::spawn_blocking(move || execute_action(&input))
        .await
        .map_err(|_| AppError::internal())?;
    operations.record_progress(&operation_id, "Refreshing Homebrew inventory.")?;
    let discovery = discovery.inner().clone();
    let refresh_result =
        tauri::async_runtime::spawn_blocking(move || discovery.refresh_brew_inventory())
            .await
            .map_err(|_| AppError::internal())?;
    brew.forget(&operation_id);

    match action_result {
        Ok(output) if refresh_result.is_ok() => {
            operations.record_progress(&operation_id, "Inventory refresh completed.")?;
            operations.finish_success_with_output(
                &operation_id,
                Some(&output.stdout),
                Some(&output.stderr),
            )?;
        }
        Ok(output) => {
            let error = AppError::partial_failure(
                "Homebrew command completed, but inventory refresh failed.",
                true,
            );
            operations.finish_failure_with_output(
                &operation_id,
                error.clone(),
                Some(&output.stdout),
                Some(&output.stderr),
            )?;
            return Err(error);
        }
        Err(action_error) => {
            let (stdout, stderr) = action_error_output(&action_error);
            let error = map_action_error(&action_error);
            operations.finish_failure_with_output(&operation_id, error.clone(), stdout, stderr)?;
            return Err(error);
        }
    }
    operations.get(&operation_id)
}

fn map_inventory_error(error: InventoryError) -> AppError {
    match error {
        InventoryError::InvalidQuery => AppError::invalid_input("Invalid inventory query."),
        InventoryError::NotFound => AppError::not_found("Homebrew is not installed."),
        InventoryError::Timeout => AppError::timeout("Homebrew inventory timed out."),
        InventoryError::MalformedJson => {
            AppError::process_failed("Homebrew returned malformed inventory data.", true)
        }
        InventoryError::OutputTooLarge => {
            AppError::process_failed("Homebrew inventory output exceeded the safe limit.", false)
        }
        InventoryError::ProcessFailed => {
            AppError::process_failed("Homebrew inventory failed.", true)
        }
    }
}

fn map_search_error(error: BrewSearchError) -> AppError {
    match error {
        BrewSearchError::InvalidQuery => AppError::invalid_input("Invalid Homebrew search query."),
        BrewSearchError::Timeout => AppError::timeout("Homebrew search timed out."),
        BrewSearchError::MalformedOutput => {
            AppError::process_failed("Homebrew returned malformed search output.", false)
        }
        BrewSearchError::OutputTooLarge => {
            AppError::process_failed("Homebrew search output exceeded the safe limit.", false)
        }
        BrewSearchError::ProcessFailed => AppError::process_failed("Homebrew search failed.", true),
    }
}

fn map_details_error(error: BrewDetailsError) -> AppError {
    match error {
        BrewDetailsError::InvalidIdentifier => {
            AppError::invalid_input("Invalid Homebrew package identifier.")
        }
        BrewDetailsError::NotFound => AppError::not_found("Homebrew package was not found."),
        BrewDetailsError::Timeout => AppError::timeout("Homebrew package details timed out."),
        BrewDetailsError::MalformedJson => {
            AppError::process_failed("Homebrew returned malformed package details.", false)
        }
        BrewDetailsError::OutputTooLarge => {
            AppError::process_failed("Homebrew package details exceeded the safe limit.", false)
        }
        BrewDetailsError::ProcessFailed => {
            AppError::process_failed("Homebrew package details failed.", true)
        }
    }
}

fn map_action_error(error: &BrewActionError) -> AppError {
    match error {
        BrewActionError::InvalidInput => {
            AppError::invalid_input("Invalid Homebrew package action.")
        }
        BrewActionError::NotFound => AppError::not_found("Homebrew is not installed."),
        BrewActionError::Timeout => AppError::timeout("Homebrew package action timed out."),
        BrewActionError::OutputTooLarge => {
            AppError::process_failed("Homebrew action output exceeded the safe limit.", false)
        }
        BrewActionError::Conflict { .. } => {
            AppError::conflict("Homebrew is busy. Retry after the active package operation ends.")
        }
        BrewActionError::ProcessFailed { .. } => {
            AppError::process_failed("Homebrew package action failed.", true)
        }
    }
}

fn action_error_output(error: &BrewActionError) -> (Option<&str>, Option<&str>) {
    match error {
        BrewActionError::Conflict { stdout, stderr }
        | BrewActionError::ProcessFailed { stdout, stderr } => {
            (Some(stdout.as_str()), Some(stderr.as_str()))
        }
        _ => (None, None),
    }
}

fn brew_action_intent(input: &BrewActionInput) -> OperationIntent {
    OperationIntent::new(
        match input.action {
            BrewAction::Install => OperationKind::BrewInstall,
            BrewAction::Upgrade => OperationKind::BrewUpgrade,
            BrewAction::Uninstall => OperationKind::BrewUninstall,
            _ => OperationKind::BrewInstall,
        },
        format!(
            "{}:{}",
            package_kind_label(input.kind).to_ascii_lowercase(),
            input.identifier
        ),
        BTreeMap::from([
            (
                "action".to_owned(),
                input.action.as_brew_subcommand().to_owned(),
            ),
            ("kind".to_owned(), package_kind_label(input.kind).to_owned()),
            ("identifier".to_owned(), input.identifier.clone()),
        ]),
    )
}

fn package_kind_label(kind: BrewPackageKind) -> &'static str {
    match kind {
        BrewPackageKind::Formula => "Formula",
        BrewPackageKind::Cask => "Cask",
    }
}

fn action_label(action: BrewAction) -> &'static str {
    match action {
        BrewAction::Install => "Install",
        BrewAction::Upgrade => "Upgrade",
        BrewAction::Uninstall => "Uninstall",
        _ => "Manage",
    }
}
