use crate::error::AppError;

pub fn validate(content: &str) -> Result<(), AppError> {
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (keyword, value) = line.split_once(char::is_whitespace).ok_or_else(|| {
            AppError::validation_failed("SSH configuration directive requires a value.")
        })?;
        if value.trim().is_empty() {
            return Err(AppError::validation_failed(
                "SSH configuration directive requires a value.",
            ));
        }
        if keyword.eq_ignore_ascii_case("include") {
            for path in value.split_whitespace() {
                let safe = path
                    .strip_prefix("~/.ssh/")
                    .or_else(|| (!path.starts_with(['/', '~'])).then_some(path))
                    .is_some_and(|relative| {
                        !relative.is_empty()
                            && !relative.contains("..")
                            && !relative.contains(['*', '?', '[', ']', '\\'])
                    });
                if !safe {
                    return Err(AppError::validation_failed(
                        "SSH Include is outside the approved ~/.ssh scope.",
                    ));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_includes_without_opening_them() {
        assert!(validate("Include /tmp/other\nHost test\n  HostName example.test\n").is_err());
        assert!(validate("Include ~/.ssh/conf.d/work\n").is_ok());
    }
}
