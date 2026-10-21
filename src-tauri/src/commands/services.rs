use std::{collections::BTreeMap, fs};

use tauri::{AppHandle, Manager, State};

use crate::{
    commands::{
        grants::{
            NativePicker, PICKER_OPEN, PickMode, PickerSlot, canonical_home, grant_save_location,
            native_picker,
        },
        qr::discard_preview,
    },
    config::ConfigCoordinator,
    error::AppError,
    grants::{
        ConfirmRequest, GrantCoordinator, GrantError, GrantId, GrantPurpose, ResourceWriteContext,
        ResourceWriteCoordinator, WriteOutcome, WriteRequest,
    },
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
        adopt::{
            edit::EditRequest,
            flow::{
                AdoptCoordinator, AdoptExecution, AdoptPreview, EditExecution, EditPreview,
                ReleaseOutcome, release_record, with_discovery,
            },
            store::AdoptionStore,
        },
        create::{
            CreateExecution, CreatePreview, CreateServiceRequest, ServiceCreateCoordinator,
            SystemFacts, SystemRegistry,
        },
        inventory::{
            ConfigValidity, ServiceDetails, ServiceInventoryError, ServiceSummary,
            caddy_config_validity, get_service as load_service, list_services as load_services,
        },
        launchd::{Discovery, DiscoveryGate, with_system},
        lifecycle::{
            LaunchdActionCoordinator, LifecycleExecution, LifecycleHost, LifecyclePreview,
            LifecycleRequest, SystemResolver,
        },
        logs::{
            self as logs, LogError, LogExportConfirm, LogExportPreview, LogExportRequest,
            LogGrantSummary, LogRevokeRequest, LogSessions, LogSinceRequest, LogSnapshot,
            LogTailRequest, LogTarget,
        },
        ownership::{
            HomebrewScope, OwnedDiscovery, ServiceRequest, check_homebrew_caddy_system,
            discover_owned_system,
        },
        snapshot::{ResidentCaddySnapshot, read_system},
    },
    settings::SettingsCoordinator,
};

#[tauri::command]
pub async fn list_services(app: AppHandle) -> Result<Vec<ServiceSummary>, AppError> {
    let result = tauri::async_runtime::spawn_blocking(load_services)
        .await
        .map_err(|_| AppError::internal())?;
    crate::tray::update_service_summary(&app, result.as_deref().map_err(|_| ()));
    result.map_err(map_inventory_error)
}

/// Read-only launchd discovery with the backend's ownership verdict on every
/// job. It takes no label or path from the caller; one run at a time, and the
/// partial result says which sources failed.
#[tauri::command]
pub async fn list_launchd_services() -> Result<OwnedDiscovery, AppError> {
    let Some(gate) = DiscoveryGate::try_acquire() else {
        return Err(AppError::conflict(
            "launchd discovery is already running. Retry when it finishes.",
        ));
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = gate;
        discover_owned_system()
    })
    .await
    .map_err(|_| AppError::internal())
}

/// Read-only snapshot of resident Caddy instances for the Caddy module. It takes
/// no input and changes nothing; a discovery already running is a conflict, not
/// a wait.
#[tauri::command]
pub async fn get_resident_caddy_snapshot() -> Result<ResidentCaddySnapshot, AppError> {
    let Some(gate) = DiscoveryGate::try_acquire() else {
        return Err(AppError::conflict(
            "launchd discovery is already running. Retry when it finishes.",
        ));
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = gate;
        read_system()
    })
    .await
    .map_err(|_| AppError::internal())
}

/// Previews creating one UserHome-owned launchd job from the typed form. The
/// target is fixed in the backend (`~/Library/LaunchAgents/<label>.plist`); the
/// request carries no file path for it, and nothing is written, loaded or
/// started.
#[tauri::command]
pub async fn preview_create_launchd_service(
    app: AppHandle,
    input: CreateServiceRequest,
) -> Result<CreatePreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_create_context(&app, |ctx, writes, creator| {
            creator.preview(
                ctx,
                writes,
                canonical_home().as_deref(),
                &SystemRegistry,
                &SystemFacts,
                &input,
            )
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Confirms a creation preview: creates the file and reads it back. Does not
/// load or start the job.
#[tauri::command]
pub async fn execute_create_launchd_service(
    app: AppHandle,
    operation_id: String,
) -> Result<CreateExecution, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_create_context(&app, |ctx, writes, creator| {
            creator.execute(ctx, writes, &SystemRegistry, &operation_id)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Runs `action` with the write context and the creation coordinator built
/// from the managed state.
fn with_create_context<T>(
    app: &AppHandle,
    action: impl FnOnce(
        &ResourceWriteContext<'_>,
        &ResourceWriteCoordinator,
        &ServiceCreateCoordinator,
    ) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let grants = app.state::<GrantCoordinator>();
    let operations = app.state::<OperationCoordinator>();
    let writes = app.state::<ResourceWriteCoordinator>();
    let creator = app.state::<ServiceCreateCoordinator>();
    let config = app.state::<ConfigCoordinator>();
    let settings = app.state::<SettingsCoordinator>();
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    action(&ctx, &writes, &creator)
}

/// Previews one lifecycle action (load, start, stop, restart, disable/enable,
/// unload) on a UserHome-owned launchd job. The request is only an action, a
/// domain and a label; the job is rediscovered and its ownership judged again
/// here, and nothing is run.
#[tauri::command]
pub async fn preview_launchd_action(
    app: AppHandle,
    input: LifecycleRequest,
) -> Result<LifecyclePreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let actions = app.state::<LaunchdActionCoordinator>();
        let operations = app.state::<OperationCoordinator>();
        let adoptions = app.state::<AdoptionStore>();
        let resolver = SystemResolver {
            adoptions: &*adoptions,
        };
        actions.preview(&LifecycleHost::system(&resolver), &operations, &input)
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Confirms a lifecycle preview by its operation id only: the job and the plan
/// are checked again, the command runs, and the real state is read back.
#[tauri::command]
pub async fn execute_launchd_action(
    app: AppHandle,
    operation_id: String,
) -> Result<LifecycleExecution, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let actions = app.state::<LaunchdActionCoordinator>();
        let operations = app.state::<OperationCoordinator>();
        let adoptions = app.state::<AdoptionStore>();
        let resolver = SystemResolver {
            adoptions: &*adoptions,
        };
        actions.execute(
            &LifecycleHost::system(&resolver),
            &operations,
            &operation_id,
        )
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Previews adopting one existing user job. Nothing is written: the job and its
/// plist are judged again, the original is named, and the operation waits for
/// `execute_adopt_launchd_service`.
#[tauri::command]
pub async fn preview_adopt_launchd_service(
    app: AppHandle,
    input: ServiceRequest,
) -> Result<AdoptPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_adoption(&app, |discovery, adoptions, ctx, _writes, adopt| {
            adopt.preview_adoption(discovery, adoptions, ctx.operations, &input)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Confirms an adoption preview: the original plist is backed up, the record is
/// written and both are read back. The plist itself is never changed.
#[tauri::command]
pub async fn execute_adopt_launchd_service(
    app: AppHandle,
    operation_id: String,
) -> Result<AdoptExecution, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_adoption(&app, |discovery, adoptions, ctx, _writes, adopt| {
            adopt.execute_adoption(discovery, adoptions, ctx, &operation_id)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Removes UserHome's record of an adopted job. The plist and the job stay as
/// they are.
#[tauri::command]
pub async fn release_adoption(
    app: AppHandle,
    input: ServiceRequest,
) -> Result<ReleaseOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let adoptions = app.state::<AdoptionStore>();
        with_discovery(|discovery| release_record(discovery, &adoptions, &input))
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Previews a structured edit of an adopted job. Only the named fields change;
/// the replacement is confirmed by `execute_edit_launchd_service`.
#[tauri::command]
pub async fn preview_edit_launchd_service(
    app: AppHandle,
    input: EditRequest,
) -> Result<EditPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_adoption(&app, |discovery, adoptions, ctx, writes, adopt| {
            adopt.preview_edit(discovery, adoptions, ctx, writes, &SystemFacts, &input)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn execute_edit_launchd_service(
    app: AppHandle,
    operation_id: String,
) -> Result<EditExecution, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_adoption(&app, |discovery, adoptions, ctx, writes, adopt| {
            adopt.execute_edit(discovery, adoptions, ctx, writes, &operation_id)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Gives up an edit preview: its one-file grant is revoked and the preview
/// cancelled, so it can never be confirmed.
#[tauri::command]
pub async fn discard_edit_launchd_service(
    app: AppHandle,
    operation_id: String,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        with_adoption(&app, |_discovery, _adoptions, ctx, _writes, adopt| {
            adopt.discard_edit(ctx, &operation_id)
        })
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Runs `action` with the discovery gate held, the adoption records and the
/// write context built from the managed state.
fn with_adoption<T>(
    app: &AppHandle,
    action: impl FnOnce(
        &crate::services::launchd::Discovery<'_>,
        &AdoptionStore,
        &ResourceWriteContext<'_>,
        &ResourceWriteCoordinator,
        &AdoptCoordinator,
    ) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let grants = app.state::<GrantCoordinator>();
    let operations = app.state::<OperationCoordinator>();
    let writes = app.state::<ResourceWriteCoordinator>();
    let adopt = app.state::<AdoptCoordinator>();
    let adoptions = app.state::<AdoptionStore>();
    let config = app.state::<ConfigCoordinator>();
    let settings = app.state::<SettingsCoordinator>();
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    with_discovery(|discovery| action(discovery, &adoptions, &ctx, &writes, &adopt))
}

/// Runs `work` against the real launchd discovery; a discovery already running
/// is a conflict, not a wait, so the viewer simply retries on its next tick.
fn with_log_discovery<T>(
    work: impl FnOnce(&Discovery<'_>) -> Result<T, LogError>,
) -> Result<T, AppError> {
    let Some(_gate) = DiscoveryGate::try_acquire() else {
        return Err(LogError::Busy.into());
    };
    with_system(work).map_err(AppError::from)
}

/// Asks for a file that the job's plist declares as this stream's log. The
/// user's choice is checked against the declared file before any grant exists;
/// `None` means the picker was cancelled and nothing was granted.
#[tauri::command]
pub async fn authorize_launchd_log(
    app: AppHandle,
    target: LogTarget,
) -> Result<Option<LogGrantSummary>, AppError> {
    let declared = target.clone();
    let expected = tauri::async_runtime::spawn_blocking(move || {
        with_log_discovery(|ctx| logs::expected_log_path(ctx, &declared))
    })
    .await
    .map_err(|_| AppError::internal())??;
    let _slot = PickerSlot::acquire(&PICKER_OPEN)?;
    let picker = native_picker(app.clone());
    let picked = tauri::async_runtime::spawn_blocking(move || picker.pick(PickMode::File))
        .await
        .map_err(|_| AppError::internal())??;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let home = canonical_home();
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<LogGrantSummary>, AppError> {
        let canonical = logs::check_selection(&expected, &picked)?;
        let grants = app.state::<GrantCoordinator>();
        let sessions = app.state::<LogSessions>();
        let record = logs::authorize(&grants, &sessions, &target, &canonical)?;
        Ok(Some(logs::grant_summary(&record, home.as_deref())))
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn revoke_launchd_log(app: AppHandle, input: LogRevokeRequest) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
        let grants = app.state::<GrantCoordinator>();
        let sessions = app.state::<LogSessions>();
        Ok(logs::revoke(&grants, &sessions, &input.grant_id)?)
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn read_launchd_log_tail(
    app: AppHandle,
    input: LogTailRequest,
) -> Result<LogSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let grants = app.state::<GrantCoordinator>();
        with_log_discovery(|ctx| logs::read_tail(ctx, &grants, &input))
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn read_launchd_log_since(
    app: AppHandle,
    input: LogSinceRequest,
) -> Result<LogSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let grants = app.state::<GrantCoordinator>();
        with_log_discovery(|ctx| logs::read_since(ctx, &grants, &input))
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Reads the log text under the existing authorization, then asks where to
/// save it and previews the write. Nothing is written until the confirmation;
/// a cancelled save dialog creates no grant and returns `None`.
#[tauri::command]
pub async fn prepare_launchd_log_export(
    app: AppHandle,
    input: LogExportRequest,
) -> Result<Option<LogExportPreview>, AppError> {
    let reader = app.clone();
    let text = tauri::async_runtime::spawn_blocking(move || {
        let grants = reader.state::<GrantCoordinator>();
        with_log_discovery(|ctx| logs::export_text(ctx, &grants, &input.target, &input.grant_id))
    })
    .await
    .map_err(|_| AppError::internal())??;
    let _slot = PickerSlot::acquire(&PICKER_OPEN)?;
    let picker = native_picker(app.clone());
    let picked = tauri::async_runtime::spawn_blocking(move || picker.pick(PickMode::SaveLocation))
        .await
        .map_err(|_| AppError::internal())??;
    let Some(path) = picked else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<LogExportPreview>, AppError> {
        let grants = app.state::<GrantCoordinator>();
        let writes = app.state::<ResourceWriteCoordinator>();
        let operations = app.state::<OperationCoordinator>();
        let config = app.state::<ConfigCoordinator>();
        let settings = app.state::<SettingsCoordinator>();
        let ctx = ResourceWriteContext {
            grants: &grants,
            operations: &operations,
            environment: config.environment()?,
            retention: settings.get()?.preferences().backup_retention(),
        };
        let replaces = fs::symlink_metadata(&path).is_ok();
        let save = grant_save_location(&grants, GrantPurpose::ConfigFile, &path)?;
        match preview_log_export(&ctx, &writes, &save.id, text, replaces) {
            Ok((operation_id, expires_at)) => Ok(Some(LogExportPreview {
                operation_id,
                expires_at,
                replaces,
                save: logs::grant_summary(&save, canonical_home().as_deref()),
            })),
            Err(error) => {
                release_grant(&grants, &save.id)?;
                Err(error)
            }
        }
    })
    .await
    .map_err(|_| AppError::internal())?
}

fn preview_log_export(
    ctx: &ResourceWriteContext<'_>,
    writes: &ResourceWriteCoordinator,
    grant: &GrantId,
    text: String,
    replaces: bool,
) -> Result<(String, String), AppError> {
    let expected_sha256 = if replaces {
        let current = ctx
            .grants
            .read_resource_with_limit(grant, None, logs::MAX_EXPORT_BYTES)
            .map_err(|error| AppError::from(LogError::Read(error)))?;
        Some(current.fingerprint.sha256)
    } else {
        None
    };
    let batch = writes.preview(
        ctx,
        vec![WriteRequest {
            grant_id: grant.clone(),
            relative: None,
            expected_sha256,
            content: text,
            sensitive: true,
        }],
    )?;
    let step = batch.steps.first().ok_or_else(AppError::internal)?;
    Ok((
        step.operation.operation_id.clone(),
        step.operation.expires_at.clone(),
    ))
}

/// Writes the previewed export and then revokes the save grant, whatever the
/// write did. The returned outcome says whether the file was written.
#[tauri::command]
pub async fn confirm_launchd_log_export(
    app: AppHandle,
    input: LogExportConfirm,
) -> Result<WriteOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || -> Result<WriteOutcome, AppError> {
        let grants = app.state::<GrantCoordinator>();
        let writes = app.state::<ResourceWriteCoordinator>();
        let operations = app.state::<OperationCoordinator>();
        let config = app.state::<ConfigCoordinator>();
        let settings = app.state::<SettingsCoordinator>();
        let grant = GrantId::parse(&input.grant_id)?;
        let ctx = ResourceWriteContext {
            grants: &grants,
            operations: &operations,
            environment: config.environment()?,
            retention: settings.get()?.preferences().backup_retention(),
        };
        let request = ConfirmRequest {
            operation_id: input.operation_id,
            grant_id: grant.clone(),
            relative: None,
        };
        let executed = writes.execute(&ctx, &request);
        let released = release_grant(&grants, &grant);
        let execution = executed?;
        released?;
        Ok(execution.outcome)
    })
    .await
    .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn discard_launchd_log_export(
    app: AppHandle,
    input: LogExportConfirm,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
        let grants = app.state::<GrantCoordinator>();
        let operations = app.state::<OperationCoordinator>();
        let grant = GrantId::parse(&input.grant_id)?;
        release_grant(&grants, &grant)?;
        discard_preview(&operations, &input.operation_id)
    })
    .await
    .map_err(|_| AppError::internal())?
}

fn release_grant(grants: &GrantCoordinator, grant: &GrantId) -> Result<(), AppError> {
    match grants.revoke(grant) {
        Ok(()) | Err(GrantError::UnknownGrant) => Ok(()),
        Err(error) => Err(AppError::from(error)),
    }
}

/// Revokes every log grant this run issued. Called as the application exits.
pub fn release_log_grants(app: &AppHandle) {
    if let (Some(grants), Some(sessions)) = (
        app.try_state::<GrantCoordinator>(),
        app.try_state::<LogSessions>(),
    ) {
        logs::revoke_all(&grants, &sessions);
    }
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
    ensure_launchd_definition_allows(homebrew_scope(service.scope())?).await?;
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
    if let Err(error) = ensure_launchd_definition_allows(homebrew_scope(pending.scope)?).await {
        service_actions.forget(&operation_id);
        return Err(error);
    }
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

fn homebrew_scope(
    scope: crate::services::inventory::ServiceScope,
) -> Result<HomebrewScope, AppError> {
    match scope {
        crate::services::inventory::ServiceScope::User => Ok(HomebrewScope::User),
        crate::services::inventory::ServiceScope::System => Ok(HomebrewScope::System),
        crate::services::inventory::ServiceScope::Unknown => {
            Err(map_action_error(&ServiceActionError::InvalidInput))
        }
    }
}

/// The legacy Homebrew action is only for Caddy. Before it runs, launchd's own
/// definition of that job is rediscovered; an Apple path, another owner, a link
/// or an unapproved location refuses the action. Nothing the frontend sent is
/// used: the check has no label or path input.
async fn ensure_launchd_definition_allows(scope: HomebrewScope) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || check_homebrew_caddy_system(scope))
        .await
        .map_err(|_| AppError::internal())?
        .map_err(AppError::from)
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
