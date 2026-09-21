use crate::{
    catalog::ConfigSensitivity, config::redaction::redact_assignment_document, error::AppError,
};

use super::ReadOnlyFormatView;

pub(super) fn plain(content: &str) -> ReadOnlyFormatView {
    ReadOnlyFormatView {
        content: Some(content.to_owned()),
        redacted: false,
    }
}

pub(super) fn inspect_assignments(
    sensitivity: ConfigSensitivity,
    content: &str,
) -> Result<ReadOnlyFormatView, AppError> {
    if sensitivity == ConfigSensitivity::Standard {
        return Ok(plain(content));
    }

    Ok(match redact_assignment_document(content) {
        Some(content) => ReadOnlyFormatView {
            content: Some(content),
            redacted: true,
        },
        None => ReadOnlyFormatView::metadata_only(),
    })
}

#[cfg(test)]
mod tests {
    use super::inspect_assignments;
    use crate::catalog::ConfigSensitivity;

    #[test]
    fn ambiguous_sensitive_assignments_fall_back_to_metadata_only() {
        let view = inspect_assignments(ConfigSensitivity::Sensitive, "export TOKEN=secret\n")
            .expect("inspect assignments");

        assert!(view.content.is_none());
        assert!(view.redacted);
    }
}
