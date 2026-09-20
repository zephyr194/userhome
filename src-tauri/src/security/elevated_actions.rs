use crate::{error::AppError, services::actions::ServiceAction};

use super::{
    elevation::ElevationCoordinator,
    elevation_protocol::{
        CADDY_CONFIG_RESOURCE_ID, CADDY_SERVICE_RESOURCE_ID, ElevationAction, ElevationResponse,
        hash_bytes,
    },
};

pub fn execute_protected_config_write(
    coordinator: &ElevationCoordinator,
    operation_id: &str,
    expected_hash: &str,
    content: &[u8],
    confirmed_at_unix_millis: i64,
) -> Result<ElevationResponse, AppError> {
    coordinator.execute(
        operation_id,
        CADDY_CONFIG_RESOURCE_ID,
        ElevationAction::WriteConfig,
        expected_hash,
        content,
        confirmed_at_unix_millis,
    )
}

pub fn execute_system_service_action(
    coordinator: &ElevationCoordinator,
    operation_id: &str,
    action: ServiceAction,
    confirmed_at_unix_millis: i64,
) -> Result<ElevationResponse, AppError> {
    let elevation_action = match action {
        ServiceAction::Start => ElevationAction::StartService,
        ServiceAction::Stop => ElevationAction::StopService,
        ServiceAction::Restart => ElevationAction::RestartService,
    };
    let expected_hash = hash_bytes(
        format!(
            "{operation_id}:{CADDY_SERVICE_RESOURCE_ID}:{}",
            action.label()
        )
        .as_bytes(),
    );
    coordinator.execute(
        operation_id,
        CADDY_SERVICE_RESOURCE_ID,
        elevation_action,
        &expected_hash,
        &[],
        confirmed_at_unix_millis,
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::{
        error::AppErrorCode,
        security::elevation_fake::{FakeElevationTransport, FakeOutcome},
    };

    use super::*;

    #[test]
    fn elevated_actions_preserve_success_denial_disconnect_timeout_and_partial_failure() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_millis() as i64;
        for (outcome, expected) in [
            (FakeOutcome::Denial, AppErrorCode::PermissionDenied),
            (FakeOutcome::Disconnect, AppErrorCode::ProcessFailed),
            (FakeOutcome::Timeout, AppErrorCode::Timeout),
            (FakeOutcome::PartialFailure, AppErrorCode::PartialFailure),
        ] {
            let coordinator =
                ElevationCoordinator::new(Arc::new(FakeElevationTransport::new(outcome, now)));
            assert_eq!(
                execute_system_service_action(
                    &coordinator,
                    &format!("operation-{outcome:?}"),
                    ServiceAction::Restart,
                    now,
                )
                .expect_err("failure must be explicit")
                .code(),
                expected
            );
        }

        let coordinator = ElevationCoordinator::new(Arc::new(FakeElevationTransport::new(
            FakeOutcome::Success,
            now,
        )));
        let response = execute_protected_config_write(
            &coordinator,
            "operation-success",
            &hash_bytes(b"before"),
            b"after",
            now,
        )
        .expect("success");
        assert_eq!(response.operation_id, "operation-success");
        assert_eq!(response.resource_id, CADDY_CONFIG_RESOURCE_ID);
    }
}
