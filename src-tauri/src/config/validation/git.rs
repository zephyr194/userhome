use crate::error::AppError;

pub fn validate(content: &str) -> Result<(), AppError> {
    let mut has_section = false;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(['#', ';']) {
            continue;
        }
        if line.starts_with('[') {
            if !line.ends_with(']') || line.len() <= 2 {
                return Err(AppError::validation_failed(
                    "Git configuration has an invalid section header.",
                ));
            }
            has_section = true;
        } else if !has_section || !line.contains('=') {
            return Err(AppError::validation_failed(
                "Git configuration entry is invalid.",
            ));
        }
    }
    Ok(())
}
