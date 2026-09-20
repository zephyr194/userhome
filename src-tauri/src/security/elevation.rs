use std::{
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use uuid::Uuid;

use crate::error::AppError;

use super::{
    elevation_macos::MacOsElevationTransport,
    elevation_protocol::{
        ELEVATION_PROTOCOL_VERSION, ElevationAction, ElevationRequest, ElevationResponse,
        HelperResult, MAX_EXECUTION_MILLIS, ProtocolError, hash_bytes, validate_request_shape,
        validate_response,
    },
};

pub trait ElevationTransport: Send + Sync {
    fn is_available(&self) -> bool;
    fn send(
        &self,
        request: &ElevationRequest,
        payload: &[u8],
    ) -> Result<ElevationResponse, ElevationTransportError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElevationTransportError {
    Unavailable,
    Denied,
    Disconnected,
    Timeout,
    InvalidResponse,
    PartialFailure,
}

pub struct ElevationCoordinator {
    transport: Arc<dyn ElevationTransport>,
    sent_operations: Mutex<Vec<String>>,
}

impl Default for ElevationCoordinator {
    fn default() -> Self {
        Self::new(Arc::new(MacOsElevationTransport))
    }
}

impl ElevationCoordinator {
    pub fn new(transport: Arc<dyn ElevationTransport>) -> Self {
        Self {
            transport,
            sent_operations: Mutex::new(Vec::new()),
        }
    }

    pub fn is_available(&self) -> bool {
        self.transport.is_available()
    }

    pub fn execute(
        &self,
        operation_id: &str,
        resource_id: &str,
        action: ElevationAction,
        expected_hash: &str,
        payload: &[u8],
        confirmed_at_unix_millis: i64,
    ) -> Result<ElevationResponse, AppError> {
        if !self.transport.is_available() {
            return Err(AppError::elevation_unavailable(
                "The signed privileged helper is unavailable.",
            ));
        }
        {
            let mut sent = self
                .sent_operations
                .lock()
                .map_err(|_| AppError::internal())?;
            if sent.iter().any(|sent_id| sent_id == operation_id) {
                return Err(AppError::conflict(
                    "This elevated operation has already been submitted.",
                ));
            }
            sent.push(operation_id.to_owned());
        }
        let issued_at_unix_millis = unix_millis();
        let request = ElevationRequest {
            protocol_version: ELEVATION_PROTOCOL_VERSION,
            request_id: Uuid::new_v4().to_string(),
            operation_id: operation_id.to_owned(),
            resource_id: resource_id.to_owned(),
            action,
            expected_hash: expected_hash.to_owned(),
            payload_hash: hash_bytes(payload),
            issued_at_unix_millis,
            confirmed_at_unix_millis,
            deadline_unix_millis: issued_at_unix_millis.saturating_add(MAX_EXECUTION_MILLIS),
        };
        validate_request_shape(&request, request.issued_at_unix_millis)
            .map_err(map_protocol_error)?;
        if hash_bytes(payload) != request.payload_hash {
            return Err(map_protocol_error(ProtocolError::PayloadMismatch));
        }
        let response = self
            .transport
            .send(&request, payload)
            .map_err(map_transport_error)?;
        validate_response(&request, &response).map_err(map_protocol_error)?;
        match response.result {
            HelperResult::Succeeded => Ok(response),
            HelperResult::Denied => Err(AppError::permission_denied(
                "The privileged helper denied the operation.",
            )),
            HelperResult::PartialFailure => Err(AppError::partial_failure(
                "The privileged helper reported a partial failure.",
                true,
            )),
        }
    }
}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

pub fn confirmation_timestamp() -> i64 {
    unix_millis()
}

fn map_transport_error(error: ElevationTransportError) -> AppError {
    match error {
        ElevationTransportError::Unavailable => {
            AppError::elevation_unavailable("The signed privileged helper is unavailable.")
        }
        ElevationTransportError::Denied => {
            AppError::permission_denied("The privileged helper denied the operation.")
        }
        ElevationTransportError::Disconnected => {
            AppError::process_failed("The privileged helper disconnected.", true)
        }
        ElevationTransportError::Timeout => {
            AppError::timeout("The privileged helper request timed out.")
        }
        ElevationTransportError::InvalidResponse => {
            AppError::process_failed("The privileged helper returned an invalid response.", false)
        }
        ElevationTransportError::PartialFailure => AppError::partial_failure(
            "The privileged helper could not safely complete the operation.",
            true,
        ),
    }
}

fn map_protocol_error(_error: ProtocolError) -> AppError {
    AppError::process_failed(
        "The privileged helper response failed integrity validation.",
        false,
    )
}
