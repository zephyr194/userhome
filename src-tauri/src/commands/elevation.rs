use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    error::AppError,
    security::elevation_macos::{HelperAvailability, MacOsElevationTransport},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperRegistrationInput {
    confirmed: bool,
}

#[tauri::command]
pub fn get_helper_status(transport: State<'_, MacOsElevationTransport>) -> HelperAvailability {
    transport.status()
}

#[tauri::command]
pub fn register_helper(
    transport: State<'_, MacOsElevationTransport>,
    input: HelperRegistrationInput,
) -> Result<HelperAvailability, AppError> {
    if !input.confirmed {
        return Err(AppError::permission_denied(
            "Helper registration requires explicit confirmation.",
        ));
    }
    transport.register().map_err(map_error)
}

#[tauri::command]
pub fn unregister_helper(
    transport: State<'_, MacOsElevationTransport>,
    input: HelperRegistrationInput,
) -> Result<HelperAvailability, AppError> {
    if !input.confirmed {
        return Err(AppError::permission_denied(
            "Helper removal requires explicit confirmation.",
        ));
    }
    transport.unregister().map_err(map_error)
}

fn map_error(error: crate::security::elevation::ElevationTransportError) -> AppError {
    use crate::security::elevation::ElevationTransportError;
    match error {
        ElevationTransportError::Unavailable => {
            AppError::elevation_unavailable("The signed privileged helper is unavailable.")
        }
        ElevationTransportError::Denied => {
            AppError::permission_denied("Helper registration was denied.")
        }
        ElevationTransportError::Timeout => AppError::timeout("Helper registration timed out."),
        ElevationTransportError::Disconnected
        | ElevationTransportError::InvalidResponse
        | ElevationTransportError::PartialFailure => {
            AppError::process_failed("Helper registration failed.", false)
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FakeElevationCheck {
    operation_id: String,
    resource_id: String,
    result: String,
}

#[tauri::command]
pub fn e2e_fake_elevation_roundtrip() -> Result<FakeElevationCheck, AppError> {
    #[cfg(feature = "e2e")]
    {
        use std::{
            sync::Arc,
            time::{SystemTime, UNIX_EPOCH},
        };

        use crate::security::{
            elevated_actions::execute_protected_config_write,
            elevation::ElevationCoordinator,
            elevation_fake::{FakeElevationTransport, FakeOutcome},
            elevation_protocol::hash_bytes,
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::internal())?
            .as_millis() as i64;
        let coordinator = ElevationCoordinator::new(Arc::new(FakeElevationTransport::new(
            FakeOutcome::Success,
            now,
        )));
        let operation_id = "e2e-elevation-operation";
        let response = execute_protected_config_write(
            &coordinator,
            operation_id,
            &hash_bytes(b"before"),
            b"after",
            now,
        )?;
        Ok(FakeElevationCheck {
            operation_id: response.operation_id,
            resource_id: response.resource_id,
            result: "SUCCEEDED".to_owned(),
        })
    }
    #[cfg(not(feature = "e2e"))]
    Err(AppError::not_supported(
        "The fake elevation transport is available only in E2E builds.",
    ))
}
