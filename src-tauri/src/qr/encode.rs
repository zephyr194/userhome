use image::{ExtendedColorType, GrayImage, ImageEncoder, codecs::png::PngEncoder};
use qrcode::{EcLevel, QrCode};
use serde::Deserialize;

/// Quiet zone on each side of the symbol, in modules.
pub const QUIET_ZONE_MODULES: u32 = 4;

/// Smallest module size, in pixels, that is accepted. Below it the probe found
/// the independent decoder failing on dense symbols, so such output is refused.
pub const MIN_MODULE_PX: u32 = 2;

/// Product cap on the UTF-8 byte length, applied on top of the level capacity.
const MAX_INPUT_BYTES: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum ErrorCorrection {
    L,
    M,
    Q,
    H,
}

impl ErrorCorrection {
    /// Byte-mode capacity of a version 40 symbol at this level.
    pub fn byte_capacity(self) -> usize {
        match self {
            Self::L => 2953,
            Self::M => 2331,
            Self::Q => 1663,
            Self::H => 1273,
        }
    }

    pub fn max_bytes(self) -> usize {
        self.byte_capacity().min(MAX_INPUT_BYTES)
    }

    pub(super) fn to_qrcode(self) -> EcLevel {
        match self {
            Self::L => EcLevel::L,
            Self::M => EcLevel::M,
            Self::Q => EcLevel::Q,
            Self::H => EcLevel::H,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(try_from = "u32")]
pub enum PixelSize {
    Px256,
    Px512,
    Px1024,
}

impl PixelSize {
    pub fn pixels(self) -> u32 {
        match self {
            Self::Px256 => 256,
            Self::Px512 => 512,
            Self::Px1024 => 1024,
        }
    }
}

impl TryFrom<u32> for PixelSize {
    type Error = QrError;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            256 => Ok(Self::Px256),
            512 => Ok(Self::Px512),
            1024 => Ok(Self::Px1024),
            _ => Err(QrError::UnsupportedSize),
        }
    }
}

/// Where the symbol sits in the image. `origin_px` is the white margin before
/// the quiet zone, so the first module starts at `origin_px + 4 * module_px`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Layout {
    pub image_px: u32,
    pub module_px: u32,
    pub core_modules: u32,
    pub origin_px: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QrImage {
    pub png: Vec<u8>,
    pub layout: Layout,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QrError {
    Empty,
    TooLong { max_bytes: usize },
    ModulesTooSmall { min_module_px: u32 },
    UnsupportedSize,
    Encode,
}

impl std::fmt::Display for QrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => f.write_str("输入为空，未生成二维码。"),
            Self::TooLong { max_bytes } => write!(f, "输入超过 {max_bytes} 字节上限，未生成。"),
            Self::ModulesTooSmall { min_module_px } => write!(
                f,
                "所选尺寸下每个模块不足 {min_module_px} 像素，无法可靠识别；请选择更大尺寸或缩短内容。"
            ),
            Self::UnsupportedSize => f.write_str("不支持的尺寸。"),
            Self::Encode => f.write_str("二维码编码失败。"),
        }
    }
}

/// Refuses empty and over-capacity input (never truncates). The symbol is drawn
/// at the largest whole-pixel module size that fits with its quiet zone, and
/// centred in a white square of the requested size.
pub fn encode_png(text: &str, level: ErrorCorrection, size: PixelSize) -> Result<QrImage, QrError> {
    if text.is_empty() {
        return Err(QrError::Empty);
    }
    if text.len() > level.max_bytes() {
        return Err(QrError::TooLong {
            max_bytes: level.max_bytes(),
        });
    }
    let code =
        QrCode::with_error_correction_level(text.as_bytes(), level.to_qrcode()).map_err(|_| {
            QrError::TooLong {
                max_bytes: level.max_bytes(),
            }
        })?;
    let core = code.width() as u32;
    let colors = code.to_colors();

    let image_px = size.pixels();
    let total_modules = core + 2 * QUIET_ZONE_MODULES;
    let module_px = image_px / total_modules;
    if module_px < MIN_MODULE_PX {
        return Err(QrError::ModulesTooSmall {
            min_module_px: MIN_MODULE_PX,
        });
    }
    let symbol_px = total_modules * module_px;
    let origin_px = (image_px - symbol_px) / 2;
    let core_start = origin_px + QUIET_ZONE_MODULES * module_px;

    let mut gray = GrayImage::from_pixel(image_px, image_px, image::Luma([255u8]));
    for (index, color) in colors.iter().enumerate() {
        if !matches!(color, qrcode::Color::Dark) {
            continue;
        }
        let cx = index as u32 % core;
        let cy = index as u32 / core;
        let left = core_start + cx * module_px;
        let top = core_start + cy * module_px;
        for y in top..top + module_px {
            for x in left..left + module_px {
                gray.put_pixel(x, y, image::Luma([0u8]));
            }
        }
    }

    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(gray.as_raw(), image_px, image_px, ExtendedColorType::L8)
        .map_err(|_| QrError::Encode)?;

    Ok(QrImage {
        png,
        layout: Layout {
            image_px,
            module_px,
            core_modules: core,
            origin_px,
        },
    })
}
