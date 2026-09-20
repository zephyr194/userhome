use std::sync::Mutex;

use super::{
    elevation::{ElevationTransport, ElevationTransportError},
    elevation_protocol::{
        AuditMetadata, ELEVATION_PROTOCOL_VERSION, ElevationRequest, ElevationResponse,
        HelperResult, RequestVerifier, request_digest,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FakeOutcome {
    Success,
    Denial,
    Timeout,
    Disconnect,
    PartialFailure,
    TamperedResponse,
}

pub struct FakeElevationTransport {
    verifier: Mutex<RequestVerifier>,
    outcome: Mutex<FakeOutcome>,
    now_unix_millis: Mutex<i64>,
}

impl FakeElevationTransport {
    pub fn new(outcome: FakeOutcome, now_unix_millis: i64) -> Self {
        Self {
            verifier: Mutex::new(RequestVerifier::default()),
            outcome: Mutex::new(outcome),
            now_unix_millis: Mutex::new(now_unix_millis),
        }
    }

    pub fn set_outcome(&self, outcome: FakeOutcome) {
        if let Ok(mut current) = self.outcome.lock() {
            *current = outcome;
        }
    }
}

impl ElevationTransport for FakeElevationTransport {
    fn is_available(&self) -> bool {
        true
    }

    fn send(
        &self,
        request: &ElevationRequest,
        payload: &[u8],
    ) -> Result<ElevationResponse, ElevationTransportError> {
        let now = (*self
            .now_unix_millis
            .lock()
            .map_err(|_| ElevationTransportError::Disconnected)?)
        .max(request.issued_at_unix_millis);
        self.verifier
            .lock()
            .map_err(|_| ElevationTransportError::Disconnected)?
            .verify(request, payload, now)
            .map_err(|_| ElevationTransportError::InvalidResponse)?;
        let outcome = *self
            .outcome
            .lock()
            .map_err(|_| ElevationTransportError::Disconnected)?;
        match outcome {
            FakeOutcome::Timeout => return Err(ElevationTransportError::Timeout),
            FakeOutcome::Disconnect => return Err(ElevationTransportError::Disconnected),
            _ => {}
        }
        let mut response = ElevationResponse {
            protocol_version: ELEVATION_PROTOCOL_VERSION,
            request_id: request.request_id.clone(),
            operation_id: request.operation_id.clone(),
            resource_id: request.resource_id.clone(),
            action: request.action,
            expected_hash: request.expected_hash.clone(),
            payload_hash: request.payload_hash.clone(),
            result: match outcome {
                FakeOutcome::Denial => HelperResult::Denied,
                FakeOutcome::PartialFailure => HelperResult::PartialFailure,
                _ => HelperResult::Succeeded,
            },
            audit: AuditMetadata {
                audit_id: format!("audit-{}", request.request_id),
                operation_id: request.operation_id.clone(),
                resource_id: request.resource_id.clone(),
                action: request.action,
                request_digest: request_digest(request),
                completed_at_unix_millis: now,
            },
        };
        if outcome == FakeOutcome::TamperedResponse {
            response.operation_id = "tampered-operation".to_owned();
        }
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::error::AppErrorCode;

    use super::*;
    use crate::security::{
        elevation::ElevationCoordinator,
        elevation_protocol::{CADDY_CONFIG_RESOURCE_ID, ElevationAction, hash_bytes},
    };

    fn execute(outcome: FakeOutcome) -> Result<ElevationResponse, crate::error::AppError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_millis() as i64;
        let transport = Arc::new(FakeElevationTransport::new(outcome, now));
        let coordinator = ElevationCoordinator::new(transport);
        coordinator.execute(
            "operation-1",
            CADDY_CONFIG_RESOURCE_ID,
            ElevationAction::WriteConfig,
            &hash_bytes(b"before"),
            b"after",
            now,
        )
    }

    #[test]
    fn elevation_fake_transport_exercises_success_denial_timeout_and_tampering() {
        assert_eq!(
            execute(FakeOutcome::Success).expect("success").result,
            HelperResult::Succeeded
        );
        assert_eq!(
            execute(FakeOutcome::Denial).expect_err("denied").code(),
            AppErrorCode::PermissionDenied
        );
        assert_eq!(
            execute(FakeOutcome::Timeout).expect_err("timeout").code(),
            AppErrorCode::Timeout
        );
        assert_eq!(
            execute(FakeOutcome::TamperedResponse)
                .expect_err("tampered")
                .code(),
            AppErrorCode::ProcessFailed
        );
    }
}
