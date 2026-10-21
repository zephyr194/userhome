use serde::Deserialize;

use crate::{
    error::AppError,
    text_tools::json::{self, FormattedJson, JsonError, JsonFormatMode},
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormatJsonInput {
    text: String,
    mode: JsonFormatMode,
}

/// Runs off the command thread. The input and output are neither logged nor
/// recorded in operation history or preferences.
#[tauri::command]
pub async fn format_json(input: FormatJsonInput) -> Result<FormattedJson, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        json::format(&input.text, input.mode).map_err(map_json_error)
    })
    .await
    .map_err(|_| AppError::internal())?
}

fn map_json_error(error: JsonError) -> AppError {
    match error {
        JsonError::InputTooLarge => AppError::invalid_input("输入超过 1 MiB 上限，未格式化。"),
        JsonError::OutputTooLarge => {
            AppError::validation_failed("格式化结果超过 8 MiB 上限，未输出。")
        }
        JsonError::Syntax {
            line,
            column,
            reason,
        } => AppError::invalid_input_at(reason, line, column),
        JsonError::TooDeep { line, column } => {
            AppError::invalid_input_at("嵌套深度超过 256 层上限。", line, column)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_rejects_unknown_fields() {
        let parsed = serde_json::from_str::<FormatJsonInput>(
            r#"{"text":"{}","mode":"MINIFY","extra":true}"#,
        );
        assert!(parsed.is_err());
    }

    #[test]
    fn request_accepts_the_three_modes() {
        for (raw, expected) in [
            ("INDENT2", JsonFormatMode::Indent2),
            ("INDENT4", JsonFormatMode::Indent4),
            ("MINIFY", JsonFormatMode::Minify),
        ] {
            let parsed = serde_json::from_str::<FormatJsonInput>(&format!(
                r#"{{"text":"{{}}","mode":"{raw}"}}"#
            ))
            .unwrap_or_else(|error| panic!("{raw}: {error}"));
            assert_eq!(parsed.mode, expected);
        }
    }

    #[test]
    fn syntax_error_maps_to_invalid_input_with_line_and_column() {
        let error = map_json_error(JsonError::Syntax {
            line: 2,
            column: 3,
            reason: "此处应为 JSON 值",
        });
        assert_eq!(error.code(), crate::error::AppErrorCode::InvalidInput);
        let value = serde_json::to_value(&error).unwrap_or_default();
        assert_eq!(value["details"]["line"], 2);
        assert_eq!(value["details"]["column"], 3);
        assert_eq!(value["message"], "此处应为 JSON 值");
    }
}
