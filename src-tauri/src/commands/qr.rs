use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    config::{ConfigCoordinator, read::hash_bytes},
    error::AppError,
    grants::{
        ConfirmRequest, GrantCoordinator, GrantId, GrantPurpose, RecoveryPoint,
        ResourceWriteContext, ResourceWriteCoordinator, WriteKind, WriteOutcome,
    },
    operations::OperationCoordinator,
    qr::{ErrorCorrection, PixelSize, QrError, encode_png},
    settings::SettingsCoordinator,
};

use super::grants::{
    PICKER_OPEN, PickMode, SelectGrantOutcome, canonical_home, native_picker, select_grant,
};

// The QR bytes are always produced here from the text and the options. The
// preview and the export share one encoder, and the export also checks the
// hash of the preview the user saw, so a stale preview cannot export a
// different symbol. Text is never logged, recorded in history or persisted.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QrInput {
    text: String,
    level: ErrorCorrection,
    size: PixelSize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportQrInput {
    text: String,
    level: ErrorCorrection,
    size: PixelSize,
    expected_sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmQrExportInput {
    operation_id: String,
    grant_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPreview {
    pub png_base64: String,
    pub sha256: String,
    pub image_px: u32,
    pub module_px: u32,
    pub module_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedQrExport {
    pub grant_id: String,
    pub operation_id: String,
    pub kind: WriteKind,
    pub recovery_point: RecoveryPoint,
    pub target: String,
    pub current_hash: Option<String>,
    pub proposed_hash: String,
}

/// `Cancelled` is not a success: the user closed the save panel and nothing was
/// authorized or written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrepareQrExportOutcome {
    Cancelled,
    Previewed(PreparedQrExport),
}

#[tauri::command]
pub async fn preview_qr(input: QrInput) -> Result<QrPreview, AppError> {
    tauri::async_runtime::spawn_blocking(move || encode_preview(&input))
        .await
        .map_err(|_| AppError::internal())?
}

/// Opens the native save panel, authorizes the chosen file and previews the
/// PNG write. Nothing is written until `confirm_qr_export`.
#[tauri::command]
pub async fn prepare_qr_export(
    app: tauri::AppHandle,
    grants: State<'_, GrantCoordinator>,
    operations: State<'_, OperationCoordinator>,
    writes: State<'_, ResourceWriteCoordinator>,
    config: State<'_, ConfigCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    input: ExportQrInput,
) -> Result<PrepareQrExportOutcome, AppError> {
    let expected = input.expected_sha256.clone();
    let png = tauri::async_runtime::spawn_blocking(move || {
        let encoded = encode_png(&input.text, input.level, input.size).map_err(map_qr_error)?;
        check_expected_hash(&encoded.png, &expected)?;
        Ok::<_, AppError>(encoded.png)
    })
    .await
    .map_err(|_| AppError::internal())??;

    let selection = select_grant(
        &grants,
        &PICKER_OPEN,
        native_picker(app),
        PickMode::SaveLocation,
        GrantPurpose::ConfigFile,
        canonical_home(),
    )
    .await?;
    let SelectGrantOutcome::Selected(summary) = selection else {
        return Ok(PrepareQrExportOutcome::Cancelled);
    };

    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    let batch = writes.preview_png_export(&ctx, &summary.id, png)?;
    let step = batch
        .steps
        .into_iter()
        .next()
        .ok_or_else(AppError::internal)?;
    Ok(PrepareQrExportOutcome::Previewed(PreparedQrExport {
        grant_id: summary.id.as_str().to_owned(),
        operation_id: step.operation.operation_id,
        kind: step.kind,
        recovery_point: step.recovery_point,
        target: step.target,
        current_hash: step.current_hash,
        proposed_hash: step.proposed_hash,
    }))
}

#[tauri::command]
pub fn confirm_qr_export(
    grants: State<'_, GrantCoordinator>,
    operations: State<'_, OperationCoordinator>,
    writes: State<'_, ResourceWriteCoordinator>,
    config: State<'_, ConfigCoordinator>,
    settings: State<'_, SettingsCoordinator>,
    input: ConfirmQrExportInput,
) -> Result<WriteOutcome, AppError> {
    let request = ConfirmRequest {
        operation_id: input.operation_id,
        grant_id: GrantId::parse(&input.grant_id)?,
        relative: None,
    };
    let ctx = ResourceWriteContext {
        grants: &grants,
        operations: &operations,
        environment: config.environment()?,
        retention: settings.get()?.preferences().backup_retention(),
    };
    let execution = writes.execute_png_export(&ctx, &request, |_| Ok(()))?;
    Ok(execution.outcome)
}

fn encode_preview(input: &QrInput) -> Result<QrPreview, AppError> {
    let image = encode_png(&input.text, input.level, input.size).map_err(map_qr_error)?;
    Ok(QrPreview {
        png_base64: base64_encode(&image.png),
        sha256: hash_bytes(&image.png),
        image_px: image.layout.image_px,
        module_px: image.layout.module_px,
        module_count: image.layout.core_modules,
    })
}

fn check_expected_hash(png: &[u8], expected: &str) -> Result<(), AppError> {
    if hash_bytes(png) == expected {
        Ok(())
    } else {
        Err(AppError::conflict(
            "The preview is out of date; generate it again before exporting.",
        ))
    }
}

fn map_qr_error(error: QrError) -> AppError {
    match error {
        QrError::Encode => AppError::internal(),
        other => AppError::invalid_input(&other.to_string()),
    }
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = (u32::from(chunk[0]) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        for index in 0..4 {
            if index <= chunk.len() {
                let sextet = (n >> (18 - 6 * index)) & 0x3f;
                out.push(char::from(BASE64_ALPHABET[sextet as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use crate::{
        error::AppErrorCode,
        grants::GrantId,
        qr::{ErrorCorrection, PixelSize, QrError},
    };

    use super::{
        ConfirmQrExportInput, ExportQrInput, QrInput, base64_encode, check_expected_hash,
        encode_preview, map_qr_error,
    };

    #[test]
    fn base64_matches_the_rfc_4648_vectors() {
        for (raw, encoded) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64_encode(raw.as_bytes()), encoded, "{raw:?}");
        }
    }

    #[test]
    fn preview_request_rejects_unknown_fields_levels_and_sizes() {
        let valid = r#"{"text":"https://example.com","level":"M","size":512}"#;
        assert!(serde_json::from_str::<QrInput>(valid).is_ok());
        assert!(
            serde_json::from_str::<QrInput>(r#"{"text":"a","level":"M","size":512,"path":"/x"}"#)
                .is_err()
        );
        assert!(serde_json::from_str::<QrInput>(r#"{"text":"a","level":"X","size":512}"#).is_err());
        assert!(serde_json::from_str::<QrInput>(r#"{"text":"a","level":"M","size":300}"#).is_err());
    }

    #[test]
    fn export_request_needs_the_previewed_hash_and_no_path() {
        let raw = r#"{"text":"a","level":"H","size":1024,"expectedSha256":"00"}"#;
        assert!(serde_json::from_str::<ExportQrInput>(raw).is_ok());
        assert!(
            serde_json::from_str::<ExportQrInput>(
                r#"{"text":"a","level":"H","size":1024,"expectedSha256":"00","filePath":"/x"}"#
            )
            .is_err()
        );
    }

    #[test]
    fn confirm_request_names_only_the_operation_and_grant() {
        let grant = "6f1c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";
        let raw = format!(r#"{{"operationId":"op-1","grantId":"{grant}"}}"#);
        assert!(serde_json::from_str::<ConfirmQrExportInput>(&raw).is_ok());
        assert!(
            serde_json::from_str::<ConfirmQrExportInput>(&format!(
                r#"{{"operationId":"op-1","grantId":"{grant}","relative":"x"}}"#
            ))
            .is_err()
        );
        assert!(GrantId::parse("not-a-grant").is_err());
    }

    #[test]
    fn preview_and_export_share_one_encoding() {
        let input = QrInput {
            text: "https://example.com/one".to_owned(),
            level: ErrorCorrection::M,
            size: PixelSize::Px512,
        };
        let first = encode_preview(&input).expect("preview");
        let second = encode_preview(&input).expect("preview again");
        assert_eq!(first, second);
        assert!(first.png_base64.starts_with("iVBORw0KGgo"));
        assert!(
            check_expected_hash(
                &crate::qr::encode_png(&input.text, input.level, input.size)
                    .unwrap()
                    .png,
                &first.sha256
            )
            .is_ok()
        );
    }

    #[test]
    fn a_stale_preview_hash_is_refused_before_any_dialog() {
        let input = QrInput {
            text: "one".to_owned(),
            level: ErrorCorrection::L,
            size: PixelSize::Px256,
        };
        let preview = encode_preview(&input).expect("preview");
        let other = encode_preview(&QrInput {
            text: "two".to_owned(),
            ..input
        })
        .expect("other");
        let png = crate::qr::encode_png("two", ErrorCorrection::L, PixelSize::Px256)
            .unwrap()
            .png;
        let error = check_expected_hash(&png, &preview.sha256).expect_err("stale");
        assert_eq!(error.code(), AppErrorCode::Conflict);
        assert_ne!(other.sha256, preview.sha256);
    }

    #[test]
    fn qr_errors_map_to_invalid_input_without_echoing_text() {
        let empty = map_qr_error(QrError::Empty);
        assert_eq!(empty.code(), AppErrorCode::InvalidInput);
        let long = map_qr_error(QrError::TooLong { max_bytes: 2048 });
        assert_eq!(long.code(), AppErrorCode::InvalidInput);
        let value = serde_json::to_value(&long).expect("serialize");
        assert!(
            value["message"]
                .as_str()
                .unwrap_or_default()
                .contains("2048")
        );
    }
}
