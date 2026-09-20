use std::collections::BTreeMap;

use tauri::{AppHandle, State};

use crate::{
    error::AppError,
    operations::{
        OperationCoordinator, OperationDetails, OperationIntent, OperationKind, OperationPreview,
    },
    security::{
        elevated_actions::execute_system_service_action,
        elevation::{ElevationCoordinator, confirmation_timestamp},
    },
    services::{
        actions::{
            ServiceAction, ServiceActionCoordinator, ServiceActionError, ServiceActionInput,
            execute_action, validate_action, verify_refreshed_state,
        },
        inventory::{
            ConfigValidity, ServiceDetails, ServiceInventoryError, ServiceSummary,
            caddy_config_validity, get_service as load_service, list_services as load_services,
        },
    },
};

#[tauri::command]
pub async fn list_services(app: AppHandle) -> Result<Vec<ServiceSummary>, AppError> {
    let result = tauri::async_runtime::spawn_blocking(load_services)
        .await
        .map_err(|_| AppError::internal())?;
    crate::tray::update_service_summary(&app, result.as_deref().map_err(|_| ()));
    result.map_err(map_inventory_error)
}

#[tauri::command]
pub async fn get_service(service_id: String) -> Result<ServiceDetails, AppError> {
    tauri::async_runtime::spawn_blocking(move || load_service(&service_id))
        .await
        .map_err(|_| AppError::internal())?
        .map_err(map_inventory_error)
}

#[tauri::command]
pub async fn preview_service_action(
    service_actions: State<'_, ServiceActionCoordinator>,
    operations: State<'_, OperationCoordinator>,
    input: ServiceActionInput,
) -> Result<OperationPreview, AppError> {
    let service_id = input.service_id.clone();
    let service = tauri::async_runtime::spawn_blocking(move || {
        load_services().and_then(|services| {
            services
                .into_iter()
                .find(|service| service.service_id() == service_id)
                .ok_or(ServiceInventoryError::NotFound)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
    .map_err(map_inventory_error)?;
    validate_action(&input, &service).map_err(|error| map_action_error(&error))?;
    if input.action == ServiceAction::Restart {
        let (validity, _) = tauri::async_runtime::spawn_blocking(caddy_config_validity)
            .await
            .map_err(|_| AppError::internal())?;
        if validity != ConfigValidity::Valid {
            return Err(AppError::validation_failed(
                "Caddyfile must be valid before restarting Caddy.",
            ));
        }
    }

    let elevated = service.scope() == crate::services::inventory::ServiceScope::System;
    let preview = operations.preview(
        service_action_intent(&input, service.scope()),
        &format!(
            "{} {} Caddy service.",
            action_title(input.action),
            if elevated {
                "system-level"
            } else {
                "user-level"
            }
        ),
        vec![
            format!("Service: {}", input.service_id),
            format!("Action: {}", input.action.label()),
            if elevated {
                "Use the signed helper for the allowlisted system service.".to_owned()
            } else {
                "Use Homebrew user-level service control without elevation.".to_owned()
            },
            format!(
                "Refresh service inventory and require {} state.",
                expected_state_label(input.action)
            ),
        ],
        elevated,
    )?;
    service_actions.remember(preview.operation_id.clone(), input, service.scope())?;
    Ok(preview)
}

#[tauri::command]
pub async fn execute_service_action(
    service_actions: State<'_, ServiceActionCoordinator>,
    operations: State<'_, OperationCoordinator>,
    elevation: State<'_, ElevationCoordinator>,
    operation_id: String,
) -> Result<OperationDetails, AppError> {
    let pending = service_actions.pending(&operation_id)?;
    let input = pending.input;
    let intent = service_action_intent(&input, pending.scope);
    if let Err(error) = operations.authorize_mutation(&operation_id, &intent) {
        if error.code() == crate::error::AppErrorCode::Timeout {
            service_actions.forget(&operation_id);
        }
        return Err(error);
    }
    let action_result = if pending.scope == crate::services::inventory::ServiceScope::System {
        operations.record_progress(&operation_id, "Submitting the allowlisted helper request.")?;
        execute_system_service_action(
            &elevation,
            &operation_id,
            input.action,
            confirmation_timestamp(),
        )
        .map(|response| crate::process::ProcessOutput {
            stdout: format!("Audit ID: {}", response.audit.audit_id),
            stderr: String::new(),
        })
        .map_err(ServiceActionError::Elevated)
    } else {
        operations.record_progress(&operation_id, "Running user-level Caddy service command.")?;
        let execution_input = input.clone();
        tauri::async_runtime::spawn_blocking(move || execute_action(&execution_input))
            .await
            .map_err(|_| AppError::internal())?
    };
    operations.record_progress(&operation_id, "Refreshing service inventory.")?;
    let refresh_result = tauri::async_runtime::spawn_blocking(load_services)
        .await
        .map_err(|_| AppError::internal())?;
    service_actions.forget(&operation_id);

    match action_result {
        Ok(output) => {
            let proof = refresh_result
                .map_err(map_inventory_error)
                .and_then(|services| {
                    verify_refreshed_state(&input, &services)
                        .map_err(|error| map_action_error(&error))
                });
            if proof.is_err() {
                let error = AppError::partial_failure(
                    "Service command completed, but refreshed state did not confirm success.",
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
            operations.record_progress(&operation_id, "Refreshed service state confirmed.")?;
            operations.finish_success_with_output(
                &operation_id,
                Some(&output.stdout),
                Some(&output.stderr),
            )?;
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

fn service_action_intent(
    input: &ServiceActionInput,
    scope: crate::services::inventory::ServiceScope,
) -> OperationIntent {
    OperationIntent::new(
        match input.action {
            ServiceAction::Start => OperationKind::ServiceStart,
            ServiceAction::Stop => OperationKind::ServiceStop,
            ServiceAction::Restart => OperationKind::ServiceRestart,
        },
        input.service_id.clone(),
        BTreeMap::from([
            ("action".to_owned(), input.action.label().to_owned()),
            (
                "scope".to_owned(),
                match scope {
                    crate::services::inventory::ServiceScope::User => "USER",
                    crate::services::inventory::ServiceScope::System => "SYSTEM",
                    crate::services::inventory::ServiceScope::Unknown => "UNKNOWN",
                }
                .to_owned(),
            ),
            ("serviceId".to_owned(), input.service_id.clone()),
        ]),
    )
}

fn action_title(action: ServiceAction) -> &'static str {
    match action {
        ServiceAction::Start => "Start",
        ServiceAction::Stop => "Stop",
        ServiceAction::Restart => "Restart",
    }
}

fn expected_state_label(action: ServiceAction) -> &'static str {
    match action {
        ServiceAction::Start | ServiceAction::Restart => "STARTED",
        ServiceAction::Stop => "STOPPED",
    }
}

fn map_inventory_error(error: ServiceInventoryError) -> AppError {
    match error {
        ServiceInventoryError::NotFound => AppError::not_found("Service was not found."),
        ServiceInventoryError::Timeout => AppError::timeout("Service inventory timed out."),
        ServiceInventoryError::MalformedJson => {
            AppError::process_failed("Homebrew returned malformed service inventory.", false)
        }
        ServiceInventoryError::OutputTooLarge => {
            AppError::process_failed("Service inventory exceeded the safe limit.", false)
        }
        ServiceInventoryError::ProcessFailed => {
            AppError::process_failed("Service inventory failed.", true)
        }
    }
}

fn map_action_error(error: &ServiceActionError) -> AppError {
    match error {
        ServiceActionError::InvalidInput => {
            AppError::not_supported("Only user-level Caddy service actions are supported.")
        }
        ServiceActionError::NotFound => AppError::not_found("Homebrew is not installed."),
        ServiceActionError::Timeout => AppError::timeout("Caddy service action timed out."),
        ServiceActionError::OutputTooLarge => {
            AppError::process_failed("Service action output exceeded the safe limit.", false)
        }
        ServiceActionError::Conflict { .. } => {
            AppError::conflict("Homebrew services is busy. Retry after the active action ends.")
        }
        ServiceActionError::ProcessFailed { .. } => {
            AppError::process_failed("Caddy service action failed.", true)
        }
        ServiceActionError::StateMismatch => AppError::partial_failure(
            "Service command completed, but refreshed state did not confirm success.",
            true,
        ),
        ServiceActionError::Elevated(error) => error.clone(),
    }
}

fn action_error_output(error: &ServiceActionError) -> (Option<&str>, Option<&str>) {
    match error {
        ServiceActionError::Conflict { stdout, stderr }
        | ServiceActionError::ProcessFailed { stdout, stderr } => {
            (Some(stdout.as_str()), Some(stderr.as_str()))
        }
        _ => (None, None),
    }
}
