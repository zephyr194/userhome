use crate::error::AppError;

pub fn validate(content: &str) -> Result<(), AppError> {
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(['#', ';']) {
            continue;
        }
        let (key, _) = line.split_once('=').ok_or_else(|| {
            AppError::validation_failed("npm configuration entry must use key=value syntax.")
        })?;
        if key.trim().is_empty() {
            return Err(AppError::validation_failed(
                "npm configuration key is invalid.",
            ));
        }
    }
    Ok(())
}
