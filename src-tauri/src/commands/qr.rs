use std::{
    path::PathBuf,
    sync::{Mutex, atomic::AtomicBool},
};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use crate::{
    config::{ConfigCoordinator, read::hash_bytes},
    error::AppError,
    grants::{
        ConfirmRequest, GrantCoordinator, GrantId, GrantPurpose, ReadError, RecoveryPoint,
        ResourceWriteContext, ResourceWriteCoordinator, WriteKind, WriteOutcome,
    },
    operations::OperationCoordinator,
    qr::{
        ErrorCorrection, IconError, IconFormat, MAX_ICON_BYTES, PixelSize, QrError, QrImage,
        decode_icon, encode_png, encode_png_with_icon, thumbnail_png,
    },
    settings::SettingsCoordinator,
};

use super::grants::{
    NativePicker, PICKER_OPEN, PickMode, SelectGrantOutcome, canonical_home, native_picker,
    select_grant,
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
    icon_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportQrInput {
    text: String,
    level: ErrorCorrection,
    size: PixelSize,
    expected_sha256: String,
    icon_id: Option<String>,
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
    pub level: ErrorCorrection,
    pub icon_applied: bool,
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

/// The icon is read once when chosen. Its bytes stay in backend memory under an
/// opaque id, so the frontend never sees a path or the bytes, and the grant that
/// allowed the read is revoked before anything else happens.
#[derive(Default)]
pub struct QrIconStore {
    selected: Mutex<Option<SelectedIcon>>,
}

struct SelectedIcon {
    id: String,
    bytes: Vec<u8>,
}

impl QrIconStore {
    fn replace(&self, icon: SelectedIcon) -> Result<(), AppError> {
        *self.selected.lock().map_err(|_| AppError::internal())? = Some(icon);
        Ok(())
    }

    fn clear(&self) -> Result<(), AppError> {
        *self.selected.lock().map_err(|_| AppError::internal())? = None;
        Ok(())
    }

    fn resolve(&self, icon_id: Option<&str>) -> Result<Option<Vec<u8>>, AppError> {
        let Some(icon_id) = icon_id else {
            return Ok(None);
        };
        let selected = self.selected.lock().map_err(|_| AppError::internal())?;
        match selected.as_ref() {
            Some(icon) if icon.id == icon_id => Ok(Some(icon.bytes.clone())),
            _ => Err(AppError::conflict("图标已更换或失效，请重新选择。")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrIconSummary {
    pub icon_id: String,
    pub format: &'static str,
    pub width: u32,
    pub height: u32,
    pub thumbnail_png_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SelectQrIconOutcome {
    Cancelled,
    Selected(QrIconSummary),
}

#[tauri::command]
pub async fn preview_qr(
    input: QrInput,
    icons: State<'_, QrIconStore>,
) -> Result<QrPreview, AppError> {
    let icon = icons.resolve(input.icon_id.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || encode_preview(&input, icon.as_deref()))
        .await
        .map_err(|_| AppError::internal())?
}

#[tauri::command]
pub async fn select_qr_icon(
    app: tauri::AppHandle,
    grants: State<'_, GrantCoordinator>,
    icons: State<'_, QrIconStore>,
) -> Result<SelectQrIconOutcome, AppError> {
    let Some(bytes) =
        read_selected_icon(&grants, &PICKER_OPEN, native_picker(app), canonical_home()).await?
    else {
        return Ok(SelectQrIconOutcome::Cancelled);
    };
    let icon_id = uuid::Uuid::new_v4().to_string();
    let (summary, selected) =
        tauri::async_runtime::spawn_blocking(move || prepare_icon(icon_id, bytes))
            .await
            .map_err(|_| AppError::internal())??;
    icons.replace(selected)?;
    Ok(SelectQrIconOutcome::Selected(summary))
}

#[tauri::command]
pub fn clear_qr_icon(icons: State<'_, QrIconStore>) -> Result<(), AppError> {
    icons.clear()
}

/// Opens the picker and reads the chosen file with the size limit. The grant is
/// revoked whether or not the read succeeded: it is never left behind, since a
/// file grant also authorizes writes to that file.
pub(crate) async fn read_selected_icon<P: NativePicker>(
    coordinator: &GrantCoordinator,
    picker_open: &AtomicBool,
    picker: P,
    home: Option<PathBuf>,
) -> Result<Option<Vec<u8>>, AppError> {
    let SelectGrantOutcome::Selected(summary) = select_grant(
        coordinator,
        picker_open,
        picker,
        PickMode::File,
        GrantPurpose::ConfigFile,
        home,
    )
    .await?
    else {
        return Ok(None);
    };
    let read = coordinator.read_resource_with_limit(&summary.id, None, MAX_ICON_BYTES);
    coordinator.revoke(&summary.id).map_err(AppError::from)?;
    let granted = read.map_err(map_read_error)?;
    Ok(Some(granted.content))
}

fn prepare_icon(
    icon_id: String,
    bytes: Vec<u8>,
) -> Result<(QrIconSummary, SelectedIcon), AppError> {
    let decoded = decode_icon(&bytes).map_err(map_icon_error)?;
    let format = match decoded.format {
        IconFormat::Png => "PNG",
        IconFormat::Jpeg => "JPEG",
        IconFormat::WebP => "WEBP",
    };
    let summary = QrIconSummary {
        icon_id: icon_id.clone(),
        format,
        width: decoded.rgba.width(),
        height: decoded.rgba.height(),
        thumbnail_png_base64: base64_encode(&thumbnail_png(&decoded.rgba)),
    };
    Ok((summary, SelectedIcon { id: icon_id, bytes }))
}

fn map_read_error(error: ReadError) -> AppError {
    let message = match error {
        ReadError::TooLarge => "图标文件超过 5 MiB 上限。",
        ReadError::NotFound => "所选图标文件不存在。",
        ReadError::PermissionDenied => "没有权限读取所选图标文件。",
        ReadError::Unsupported => "所选位置不是普通文件。",
        ReadError::Excluded => "所选图标已不在授权范围内。",
        ReadError::Malformed | ReadError::Io => "无法读取所选图标文件。",
    };
    AppError::invalid_input(message)
}

fn map_icon_error(error: IconError) -> AppError {
    AppError::invalid_input(&error.to_string())
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
    let icon = app
        .state::<QrIconStore>()
        .resolve(input.icon_id.as_deref())?;
    let png = tauri::async_runtime::spawn_blocking(move || {
        let encoded = render(&input.text, input.level, input.size, icon.as_deref())?;
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

fn encode_preview(input: &QrInput, icon: Option<&[u8]>) -> Result<QrPreview, AppError> {
    let image = render(&input.text, input.level, input.size, icon)?;
    Ok(QrPreview {
        png_base64: base64_encode(&image.png),
        sha256: hash_bytes(&image.png),
        image_px: image.layout.image_px,
        module_px: image.layout.module_px,
        module_count: image.layout.core_modules,
        level: image.level,
        icon_applied: image.icon_applied,
    })
}

// The one place that turns input into symbol bytes, so the preview and the
// export always agree. With an icon the level is always H.
fn render(
    text: &str,
    level: ErrorCorrection,
    size: PixelSize,
    icon: Option<&[u8]>,
) -> Result<QrImage, AppError> {
    let Some(bytes) = icon else {
        return encode_png(text, level, size).map_err(map_qr_error);
    };
    let decoded = decode_icon(bytes).map_err(map_icon_error)?;
    encode_png_with_icon(text, size, &decoded.rgba).map_err(map_qr_error)
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
            icon_id: None,
        };
        let first = encode_preview(&input, None).expect("preview");
        let second = encode_preview(&input, None).expect("preview again");
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
            icon_id: None,
        };
        let preview = encode_preview(&input, None).expect("preview");
        let other = encode_preview(
            &QrInput {
                text: "two".to_owned(),
                ..input
            },
            None,
        )
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

#[cfg(test)]
mod icon_selection_tests {
    use std::{
        fs,
        os::unix::fs::symlink,
        path::{Path, PathBuf},
        sync::atomic::AtomicBool,
    };

    use image::{ExtendedColorType, ImageEncoder, Rgba, RgbaImage, codecs::png::PngEncoder};
    use uuid::Uuid;

    use crate::{
        commands::grants::{NativePicker, PickMode},
        error::{AppError, AppErrorCode},
        grants::{GrantCoordinator, GrantStore},
        qr::{ErrorCorrection, MAX_ICON_BYTES, PixelSize},
    };

    use super::{
        QrIconStore, QrInput, SelectedIcon, encode_preview, prepare_icon, read_selected_icon,
    };

    struct FixedPicker(Option<PathBuf>);

    impl NativePicker for FixedPicker {
        fn pick(&self, _mode: PickMode) -> Result<Option<PathBuf>, AppError> {
            Ok(self.0.clone())
        }
    }

    struct Sandbox {
        root: PathBuf,
    }

    impl Sandbox {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("temp dir")
                .join(format!("userhome-qr-icon-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create sandbox");
            Self { root }
        }

        fn coordinator(&self) -> GrantCoordinator {
            GrantCoordinator::new(
                GrantStore::new(self.root.join("support")),
                Some(self.root.clone()),
            )
        }

        fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.root.join(name);
            fs::write(&path, bytes).expect("write fixture");
            path
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = RgbaImage::from_pixel(width, height, Rgba([30, 60, 200, 255]));
        let mut out = Vec::new();
        PngEncoder::new(&mut out)
            .write_image(image.as_raw(), width, height, ExtendedColorType::Rgba8)
            .expect("png fixture");
        out
    }

    fn select(
        coordinator: &GrantCoordinator,
        picked: Option<PathBuf>,
        home: &Path,
    ) -> Result<Option<Vec<u8>>, AppError> {
        tauri::async_runtime::block_on(read_selected_icon(
            coordinator,
            &AtomicBool::new(false),
            FixedPicker(picked),
            Some(home.to_path_buf()),
        ))
    }

    #[test]
    fn a_picked_icon_is_read_and_its_grant_is_revoked() {
        let sandbox = Sandbox::new();
        let bytes = png(40, 40);
        let path = sandbox.file("logo.png", &bytes);
        let coordinator = sandbox.coordinator();
        let read = select(&coordinator, Some(path), &sandbox.root).expect("read");
        assert_eq!(read, Some(bytes));
        assert!(coordinator.list().expect("list").is_empty());
    }

    #[test]
    fn cancelling_the_picker_creates_no_grant() {
        let sandbox = Sandbox::new();
        let coordinator = sandbox.coordinator();
        assert_eq!(
            select(&coordinator, None, &sandbox.root).expect("cancel"),
            None
        );
        assert!(coordinator.list().expect("list").is_empty());
    }

    #[test]
    fn an_icon_over_the_limit_is_refused_and_its_grant_is_still_revoked() {
        let sandbox = Sandbox::new();
        let path = sandbox.file("huge.png", &vec![0u8; MAX_ICON_BYTES + 1]);
        let coordinator = sandbox.coordinator();
        let error = select(&coordinator, Some(path), &sandbox.root).expect_err("too large");
        assert_eq!(error.code(), AppErrorCode::InvalidInput);
        assert!(coordinator.list().expect("list").is_empty());
    }

    #[test]
    fn a_link_that_leaves_the_authorized_area_is_refused() {
        let sandbox = Sandbox::new();
        let outside = Sandbox::new();
        let target = outside.file("logo.png", &png(16, 16));
        let link = sandbox.root.join("link.png");
        symlink(&target, &link).expect("symlink");
        let coordinator = sandbox.coordinator();
        assert!(select(&coordinator, Some(link), &sandbox.root).is_err());
        assert!(coordinator.list().expect("list").is_empty());
    }

    #[test]
    fn an_svg_is_refused_before_anything_is_stored() {
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#.to_vec();
        let error = prepare_icon("id-1".to_owned(), svg)
            .err()
            .expect("svg refused");
        assert_eq!(error.code(), AppErrorCode::InvalidInput);
    }

    #[test]
    fn the_summary_describes_the_decoded_icon_and_carries_a_png_thumbnail() {
        let (summary, selected) = prepare_icon("id-2".to_owned(), png(64, 32)).expect("valid icon");
        assert_eq!(summary.format, "PNG");
        assert_eq!((summary.width, summary.height), (64, 32));
        assert!(summary.thumbnail_png_base64.starts_with("iVBORw0KGgo"));
        assert_eq!(selected.id, "id-2");
    }

    #[test]
    fn the_store_serves_only_the_icon_it_holds() {
        let store = QrIconStore::default();
        store
            .replace(SelectedIcon {
                id: "a".to_owned(),
                bytes: vec![1, 2, 3],
            })
            .expect("store");
        assert_eq!(store.resolve(None).expect("none"), None);
        assert_eq!(store.resolve(Some("a")).expect("held"), Some(vec![1, 2, 3]));
        assert!(store.resolve(Some("b")).is_err());
        store.clear().expect("clear");
        assert!(store.resolve(Some("a")).is_err());
    }

    #[test]
    fn a_preview_with_the_icon_is_forced_to_level_h_and_says_so() {
        let icon = png(64, 64);
        let input = QrInput {
            text: "x".repeat(40),
            level: ErrorCorrection::M,
            size: PixelSize::Px512,
            icon_id: None,
        };
        let plain = encode_preview(&input, None).expect("plain");
        let marked = encode_preview(&input, Some(&icon)).expect("with icon");
        assert_eq!(plain.level, ErrorCorrection::M);
        assert!(!plain.icon_applied);
        assert_eq!(marked.level, ErrorCorrection::H);
        assert!(marked.icon_applied);
        assert_ne!(plain.sha256, marked.sha256);
    }
}
