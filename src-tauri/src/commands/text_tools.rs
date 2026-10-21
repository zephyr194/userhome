use serde::Deserialize;

use crate::{
    error::AppError,
    text_tools::{
        codec::{self, CodecAlgorithm, CodecDirection, CodecError, Transformed},
        json::{self, FormattedJson, JsonError, JsonFormatMode},
        xml::{self, FormattedXml, XmlError, XmlFormatMode},
    },
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormatJsonInput {
    text: String,
    mode: JsonFormatMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormatXmlInput {
    text: String,
    mode: XmlFormatMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransformTextInput {
    text: String,
    algorithm: CodecAlgorithm,
    direction: CodecDirection,
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

/// Same execution and privacy rules as `format_json`.
#[tauri::command]
pub async fn format_xml(input: FormatXmlInput) -> Result<FormattedXml, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        xml::format(&input.text, input.mode).map_err(map_xml_error)
    })
    .await
    .map_err(|_| AppError::internal())?
}

/// Same execution and privacy rules as `format_json`.
#[tauri::command]
pub async fn transform_text(input: TransformTextInput) -> Result<Transformed, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        codec::transform(&input.text, input.algorithm, input.direction).map_err(map_codec_error)
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

fn map_xml_error(error: XmlError) -> AppError {
    match error {
        XmlError::InputTooLarge => AppError::invalid_input("输入超过 1 MiB 上限，未格式化。"),
        XmlError::OutputTooLarge => {
            AppError::validation_failed("格式化结果超过 8 MiB 上限，未输出。")
        }
        XmlError::Invalid {
            line,
            column,
            reason,
        } => AppError::invalid_input_at(reason, line, column),
    }
}

fn map_codec_error(error: CodecError) -> AppError {
    match error {
        CodecError::InputTooLarge => AppError::invalid_input("输入超过 1 MiB 上限，未转换。"),
        CodecError::OutputTooLarge => {
            AppError::validation_failed("转换结果超过 8 MiB 上限，未输出。")
        }
        CodecError::Invalid {
            position: Some(position),
            reason,
        } => AppError::invalid_input(&format!("第 {position} 个字符：{reason}")),
        CodecError::Invalid {
            position: None,
            reason,
        } => AppError::invalid_input(reason),
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

    #[test]
    fn transform_request_rejects_unknown_fields_and_algorithms() {
        assert!(
            serde_json::from_str::<TransformTextInput>(
                r#"{"text":"a","algorithm":"BASE64","direction":"ENCODE","extra":true}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<TransformTextInput>(
                r#"{"text":"a","algorithm":"MD5","direction":"ENCODE"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn transform_request_accepts_every_algorithm_and_direction() {
        for algorithm in [
            "BASE64",
            "URL_COMPONENT",
            "HTML_ENTITIES",
            "UNICODE_ESCAPES",
            "UTF8_HEX",
        ] {
            for direction in ["ENCODE", "DECODE"] {
                let raw = format!(
                    r#"{{"text":"a","algorithm":"{algorithm}","direction":"{direction}"}}"#
                );
                serde_json::from_str::<TransformTextInput>(&raw)
                    .unwrap_or_else(|error| panic!("{raw}: {error}"));
            }
        }
    }

    #[test]
    fn transform_request_accepts_url_safe_base64_as_its_own_algorithm() {
        let parsed = serde_json::from_str::<TransformTextInput>(
            r#"{"text":"a","algorithm":"BASE64_URL_SAFE","direction":"DECODE"}"#,
        );
        assert!(matches!(
            parsed.map(|input| input.algorithm),
            Ok(CodecAlgorithm::Base64UrlSafe)
        ));
    }

    #[test]
    fn codec_invalid_input_names_the_character_position() {
        let error = map_codec_error(CodecError::Invalid {
            position: Some(5),
            reason: "非法 Base64 字符",
        });
        assert_eq!(error.code(), crate::error::AppErrorCode::InvalidInput);
        let value = serde_json::to_value(&error).unwrap_or_default();
        assert_eq!(value["message"], "第 5 个字符：非法 Base64 字符");
    }

    #[test]
    fn codec_size_limits_map_to_their_own_errors() {
        assert_eq!(
            map_codec_error(CodecError::InputTooLarge).code(),
            crate::error::AppErrorCode::InvalidInput
        );
        assert_eq!(
            map_codec_error(CodecError::OutputTooLarge).code(),
            crate::error::AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn xml_request_rejects_unknown_fields_and_non_indent_modes() {
        assert!(
            serde_json::from_str::<FormatXmlInput>(
                r#"{"text":"<a/>","mode":"INDENT2","extra":true}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<FormatXmlInput>(r#"{"text":"<a/>","mode":"MINIFY"}"#).is_err()
        );
    }

    #[test]
    fn xml_request_accepts_both_indent_modes() {
        for (raw, expected) in [
            ("INDENT2", XmlFormatMode::Indent2),
            ("INDENT4", XmlFormatMode::Indent4),
        ] {
            let parsed = serde_json::from_str::<FormatXmlInput>(&format!(
                r#"{{"text":"<a/>","mode":"{raw}"}}"#
            ))
            .unwrap_or_else(|error| panic!("{raw}: {error}"));
            assert_eq!(parsed.mode, expected);
        }
    }

    #[test]
    fn xml_invalid_input_maps_to_invalid_input_with_line_and_column() {
        let error = map_xml_error(XmlError::Invalid {
            line: 3,
            column: 4,
            reason: "结束标签与开始标签不匹配。",
        });
        assert_eq!(error.code(), crate::error::AppErrorCode::InvalidInput);
        let value = serde_json::to_value(&error).unwrap_or_default();
        assert_eq!(value["details"]["line"], 3);
        assert_eq!(value["details"]["column"], 4);
        assert_eq!(value["message"], "结束标签与开始标签不匹配。");
    }

    #[test]
    fn xml_size_limits_map_to_their_own_errors() {
        assert_eq!(
            map_xml_error(XmlError::InputTooLarge).code(),
            crate::error::AppErrorCode::InvalidInput
        );
        assert_eq!(
            map_xml_error(XmlError::OutputTooLarge).code(),
            crate::error::AppErrorCode::ValidationFailed
        );
    }
}
