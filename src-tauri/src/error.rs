use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    InvalidInput,
    NotFound,
    NotSupported,
    PermissionDenied,
    ValidationFailed,
    Conflict,
    ProcessFailed,
    PartialFailure,
    Timeout,
    ElevationRequired,
    ElevationUnavailable,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum AppErrorDetail {
    String(String),
    Number(serde_json::Number),
    Boolean(bool),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    code: AppErrorCode,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<BTreeMap<String, AppErrorDetail>>,
    retryable: bool,
}

impl AppError {
    pub fn internal() -> Self {
        Self {
            code: AppErrorCode::Internal,
            message: "An internal error occurred.".to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub fn code(&self) -> AppErrorCode {
        self.code
    }

    pub fn retryable(&self) -> bool {
        self.retryable
    }

    pub(crate) fn invalid_input(message: &str) -> Self {
        Self {
            code: AppErrorCode::InvalidInput,
            message: message.to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn not_found(message: &str) -> Self {
        Self {
            code: AppErrorCode::NotFound,
            message: message.to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn not_supported(message: &str) -> Self {
        Self {
            code: AppErrorCode::NotSupported,
            message: message.to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn permission_denied(message: &str) -> Self {
        Self {
            code: AppErrorCode::PermissionDenied,
            message: message.to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn validation_failed(message: &str) -> Self {
        Self {
            code: AppErrorCode::ValidationFailed,
            message: message.to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn conflict(message: &str) -> Self {
        Self {
            code: AppErrorCode::Conflict,
            message: message.to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn process_failed(message: &str, retryable: bool) -> Self {
        Self {
            code: AppErrorCode::ProcessFailed,
            message: message.to_owned(),
            details: None,
            retryable,
        }
    }

    pub(crate) fn partial_failure(message: &str, retryable: bool) -> Self {
        Self {
            code: AppErrorCode::PartialFailure,
            message: message.to_owned(),
            details: None,
            retryable,
        }
    }

    pub(crate) fn timeout(message: &str) -> Self {
        Self {
            code: AppErrorCode::Timeout,
            message: message.to_owned(),
            details: None,
            retryable: true,
        }
    }

    pub(crate) fn elevation_unavailable(message: &str) -> Self {
        Self {
            code: AppErrorCode::ElevationUnavailable,
            message: message.to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn operation_not_found() -> Self {
        Self {
            code: AppErrorCode::NotFound,
            message: "Operation not found.".to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn operation_mismatch() -> Self {
        Self {
            code: AppErrorCode::Conflict,
            message: "Operation preview does not match the requested action.".to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn operation_expired() -> Self {
        Self {
            code: AppErrorCode::Timeout,
            message: "Operation preview has expired.".to_owned(),
            details: None,
            retryable: false,
        }
    }

    pub(crate) fn operation_busy() -> Self {
        Self {
            code: AppErrorCode::Conflict,
            message: "Another mutation is already running.".to_owned(),
            details: None,
            retryable: true,
        }
    }

    pub(crate) fn invalid_operation_state() -> Self {
        Self {
            code: AppErrorCode::Conflict,
            message: "Operation is not valid in its current state.".to_owned(),
            details: None,
            retryable: false,
        }
    }
}
