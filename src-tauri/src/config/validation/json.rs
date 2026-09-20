use serde_json::Value;

use crate::error::AppError;

pub fn validate(content: &str) -> Result<(), AppError> {
    let value = serde_json::from_str::<Value>(content)
        .map_err(|_| AppError::validation_failed("Configuration JSON is invalid."))?;
    if !value.is_object() {
        return Err(AppError::validation_failed(
            "Configuration JSON must be an object.",
        ));
    }
    Ok(())
}
