mod json;

use crate::error::AppError;

pub(crate) fn parse_json_document(
    format: &str,
    content: &str,
) -> Result<serde_json::Value, AppError> {
    json::parse_document(format, content)
}
