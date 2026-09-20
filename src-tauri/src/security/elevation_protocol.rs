use std::collections::{HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const ELEVATION_PROTOCOL_VERSION: u16 = 1;
pub const MAX_REQUEST_AGE_MILLIS: i64 = 5 * 60 * 1_000;
pub const MAX_EXECUTION_MILLIS: i64 = 12_000;
const MAX_ID_BYTES: usize = 128;
const MAX_REPLAY_ENTRIES: usize = 1_024;

pub const CADDY_CONFIG_RESOURCE_ID: &str = "caddy:system-caddyfile";
pub const CADDY_SERVICE_RESOURCE_ID: &str = "caddy:system-service";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ElevationAction {
    WriteConfig,
    StartService,
    StopService,
    RestartService,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElevationRequest {
    pub protocol_version: u16,
    pub request_id: String,
    pub operation_id: String,
    pub resource_id: String,
    pub action: ElevationAction,
    pub expected_hash: String,
    pub payload_hash: String,
    pub issued_at_unix_millis: i64,
    pub confirmed_at_unix_millis: i64,
    pub deadline_unix_millis: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HelperResult {
    Succeeded,
    Denied,
    PartialFailure,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuditMetadata {
    pub audit_id: String,
    pub operation_id: String,
    pub resource_id: String,
    pub action: ElevationAction,
    pub request_digest: String,
    pub completed_at_unix_millis: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElevationResponse {
    pub protocol_version: u16,
    pub request_id: String,
    pub operation_id: String,
    pub resource_id: String,
    pub action: ElevationAction,
    pub expected_hash: String,
    pub payload_hash: String,
    pub result: HelperResult,
    pub audit: AuditMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolError {
    UnsupportedVersion,
    InvalidIdentifier,
    InvalidHash,
    UnknownResource,
    ActionNotAllowed,
    StaleRequest,
    InvalidConfirmation,
    Replay,
    PayloadMismatch,
    ResponseMismatch,
}

#[derive(Default)]
pub struct RequestVerifier {
    seen: HashSet<String>,
    order: VecDeque<String>,
}

impl RequestVerifier {
    pub fn verify(
        &mut self,
        request: &ElevationRequest,
        payload: &[u8],
        now_unix_millis: i64,
    ) -> Result<(), ProtocolError> {
        validate_request_shape(request, now_unix_millis)?;
        if self.seen.contains(&request.request_id) {
            return Err(ProtocolError::Replay);
        }
        if hash_bytes(payload) != request.payload_hash {
            return Err(ProtocolError::PayloadMismatch);
        }
        self.remember(request.request_id.clone());
        Ok(())
    }

    fn remember(&mut self, request_id: String) {
        if self.seen.insert(request_id.clone()) {
            self.order.push_back(request_id);
        }
        while self.order.len() > MAX_REPLAY_ENTRIES {
            if let Some(expired) = self.order.pop_front() {
                self.seen.remove(&expired);
            }
        }
    }
}

pub fn validate_request_shape(
    request: &ElevationRequest,
    now_unix_millis: i64,
) -> Result<(), ProtocolError> {
    if request.protocol_version != ELEVATION_PROTOCOL_VERSION {
        return Err(ProtocolError::UnsupportedVersion);
    }
    if !is_safe_id(&request.request_id) || !is_safe_id(&request.operation_id) {
        return Err(ProtocolError::InvalidIdentifier);
    }
    if !is_sha256(&request.expected_hash) || !is_sha256(&request.payload_hash) {
        return Err(ProtocolError::InvalidHash);
    }
    validate_allowlist(&request.resource_id, request.action)?;
    if request.issued_at_unix_millis > now_unix_millis
        || now_unix_millis.saturating_sub(request.issued_at_unix_millis) >= MAX_REQUEST_AGE_MILLIS
    {
        return Err(ProtocolError::StaleRequest);
    }
    if request.confirmed_at_unix_millis > request.issued_at_unix_millis
        || request
            .issued_at_unix_millis
            .saturating_sub(request.confirmed_at_unix_millis)
            >= MAX_REQUEST_AGE_MILLIS
    {
        return Err(ProtocolError::InvalidConfirmation);
    }
    if request.deadline_unix_millis <= request.issued_at_unix_millis
        || request
            .deadline_unix_millis
            .saturating_sub(request.issued_at_unix_millis)
            > MAX_EXECUTION_MILLIS
        || now_unix_millis >= request.deadline_unix_millis
    {
        return Err(ProtocolError::StaleRequest);
    }
    Ok(())
}

pub fn validate_response(
    request: &ElevationRequest,
    response: &ElevationResponse,
) -> Result<(), ProtocolError> {
    if response.protocol_version != ELEVATION_PROTOCOL_VERSION
        || response.request_id != request.request_id
        || response.operation_id != request.operation_id
        || response.resource_id != request.resource_id
        || response.action != request.action
        || response.expected_hash != request.expected_hash
        || response.payload_hash != request.payload_hash
        || response.audit.operation_id != request.operation_id
        || response.audit.resource_id != request.resource_id
        || response.audit.action != request.action
        || response.audit.request_digest != request_digest(request)
        || !is_safe_id(&response.audit.audit_id)
    {
        return Err(ProtocolError::ResponseMismatch);
    }
    Ok(())
}

pub fn validate_allowlist(resource_id: &str, action: ElevationAction) -> Result<(), ProtocolError> {
    let allowed = matches!(
        (resource_id, action),
        (CADDY_CONFIG_RESOURCE_ID, ElevationAction::WriteConfig)
            | (
                CADDY_SERVICE_RESOURCE_ID,
                ElevationAction::StartService
                    | ElevationAction::StopService
                    | ElevationAction::RestartService
            )
    );
    if allowed {
        Ok(())
    } else if matches!(
        resource_id,
        CADDY_CONFIG_RESOURCE_ID | CADDY_SERVICE_RESOURCE_ID
    ) {
        Err(ProtocolError::ActionNotAllowed)
    } else {
        Err(ProtocolError::UnknownResource)
    }
}

pub fn request_digest(request: &ElevationRequest) -> String {
    let mut digest = Sha256::new();
    for value in [
        request.protocol_version.to_string(),
        request.request_id.clone(),
        request.operation_id.clone(),
        request.resource_id.clone(),
        action_label(request.action).to_owned(),
        request.expected_hash.clone(),
        request.payload_hash.clone(),
        request.issued_at_unix_millis.to_string(),
        request.confirmed_at_unix_millis.to_string(),
        request.deadline_unix_millis.to_string(),
    ] {
        let bytes = value.as_bytes();
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    format!("{:x}", digest.finalize())
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn action_label(action: ElevationAction) -> &'static str {
    match action {
        ElevationAction::WriteConfig => "WRITE_CONFIG",
        ElevationAction::StartService => "START_SERVICE",
        ElevationAction::StopService => "STOP_SERVICE",
        ElevationAction::RestartService => "RESTART_SERVICE",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    fn request() -> ElevationRequest {
        ElevationRequest {
            protocol_version: ELEVATION_PROTOCOL_VERSION,
            request_id: "request-1".to_owned(),
            operation_id: "operation-1".to_owned(),
            resource_id: CADDY_CONFIG_RESOURCE_ID.to_owned(),
            action: ElevationAction::WriteConfig,
            expected_hash: hash_bytes(b"before"),
            payload_hash: hash_bytes(b"after"),
            issued_at_unix_millis: NOW,
            confirmed_at_unix_millis: NOW,
            deadline_unix_millis: NOW + MAX_EXECUTION_MILLIS,
        }
    }

    #[test]
    fn elevation_protocol_rejects_unknown_versions_actions_and_fields() {
        let mut value = serde_json::to_value(request()).expect("serialize");
        value["protocolVersion"] = json!(2);
        let unsupported: ElevationRequest = serde_json::from_value(value).expect("shape");
        assert_eq!(
            validate_request_shape(&unsupported, NOW),
            Err(ProtocolError::UnsupportedVersion)
        );

        let mut wrong_action = request();
        wrong_action.action = ElevationAction::StartService;
        assert_eq!(
            validate_request_shape(&wrong_action, NOW),
            Err(ProtocolError::ActionNotAllowed)
        );

        let mut arbitrary = serde_json::to_value(request()).expect("serialize");
        arbitrary["path"] = json!("/etc/passwd");
        assert!(serde_json::from_value::<ElevationRequest>(arbitrary).is_err());
    }

    #[test]
    fn elevation_protocol_fixture_contains_only_allowlisted_metadata() {
        let serialized = serde_json::to_value(request()).expect("serialize");
        let keys = serialized
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            [
                "action",
                "confirmedAtUnixMillis",
                "deadlineUnixMillis",
                "expectedHash",
                "issuedAtUnixMillis",
                "operationId",
                "payloadHash",
                "protocolVersion",
                "requestId",
                "resourceId",
            ]
        );
        let text = serialized.to_string();
        for forbidden in [
            "path",
            "command",
            "argument",
            "environment",
            "secret",
            "content",
        ] {
            assert!(!text.to_ascii_lowercase().contains(forbidden));
        }
        assert_eq!(
            request_digest(&request()),
            "f7a6cf88a994c871a09aa6618834a4eff4514d59e78616cae2dfb45fdd51f1fe"
        );
    }

    #[test]
    fn elevation_protocol_rejects_stale_tampered_and_replayed_requests() {
        let mut verifier = RequestVerifier::default();
        let request = request();
        assert_eq!(
            verifier.verify(&request, b"after", NOW + MAX_REQUEST_AGE_MILLIS),
            Err(ProtocolError::StaleRequest)
        );
        assert_eq!(
            verifier.verify(&request, b"tampered", NOW),
            Err(ProtocolError::PayloadMismatch)
        );
        verifier
            .verify(&request, b"after", NOW)
            .expect("first request succeeds");
        assert_eq!(
            verifier.verify(&request, b"after", NOW),
            Err(ProtocolError::Replay)
        );
    }
}
