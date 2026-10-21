use std::io::Cursor;

use image::{
    ExtendedColorType, GrayImage, ImageEncoder, ImageFormat, ImageReader, Limits, Luma, RgbaImage,
    codecs::png::PngEncoder,
    imageops::{self, FilterType},
};

/// Largest accepted icon file, in bytes. Enforced while reading the grant.
pub const MAX_ICON_BYTES: usize = 5 * 1024 * 1024;
/// Largest accepted icon side, in pixels, read from the header before decoding.
pub const MAX_ICON_SIDE: u32 = 4096;
/// The icon box, padding included, may not exceed this share of the symbol width
/// (quiet zone excluded) on either side.
pub const MAX_BOX_PERCENT: u32 = 15;
/// The shorter side of the icon itself must be at least this many modules.
pub const MIN_ICON_MODULES: u32 = 3;
const PADDING_MODULES: u32 = 1;
const THUMBNAIL_SIDE: u32 = 128;
const MAX_DECODE_ALLOC: u64 = 256 * 1024 * 1024;
const MODULE_ZONE_MARGIN: u32 = 9;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IconFormat {
    Png,
    Jpeg,
    WebP,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IconError {
    TooLarge,
    UnsupportedFormat,
    Malformed,
    DimensionsTooLarge,
}

impl std::fmt::Display for IconError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge => f.write_str("图标文件超过 5 MiB 上限。"),
            Self::UnsupportedFormat => f.write_str("仅支持 PNG、JPEG 或 WebP 图标。"),
            Self::Malformed => f.write_str("图标文件已损坏或无法解码。"),
            Self::DimensionsTooLarge => f.write_str("图标尺寸超过 4096×4096 上限。"),
        }
    }
}

pub struct DecodedIcon {
    pub format: IconFormat,
    pub rgba: RgbaImage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IconBox {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub inner_width: u32,
    pub inner_height: u32,
}

/// The format comes from the content's magic bytes, never from a file name or a
/// declared type. The size is checked before any pixel is decoded, and the
/// decoder is capped, so a small file that claims a huge canvas is refused.
pub fn decode_icon(bytes: &[u8]) -> Result<DecodedIcon, IconError> {
    if bytes.len() > MAX_ICON_BYTES {
        return Err(IconError::TooLarge);
    }
    let (format, image_format) = match image::guess_format(bytes) {
        Ok(ImageFormat::Png) => (IconFormat::Png, ImageFormat::Png),
        Ok(ImageFormat::Jpeg) => (IconFormat::Jpeg, ImageFormat::Jpeg),
        Ok(ImageFormat::WebP) => (IconFormat::WebP, ImageFormat::WebP),
        _ => return Err(IconError::UnsupportedFormat),
    };
    let (width, height) = ImageReader::with_format(Cursor::new(bytes), image_format)
        .into_dimensions()
        .map_err(|_| IconError::Malformed)?;
    if width == 0 || height == 0 {
        return Err(IconError::Malformed);
    }
    if width > MAX_ICON_SIDE || height > MAX_ICON_SIDE {
        return Err(IconError::DimensionsTooLarge);
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), image_format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_ICON_SIDE);
    limits.max_image_height = Some(MAX_ICON_SIDE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    reader.limits(limits);
    let rgba = reader
        .decode()
        .map_err(|_| IconError::Malformed)?
        .to_rgba8();
    Ok(DecodedIcon { format, rgba })
}

/// Preview of the icon on white, as a grayscale PNG no larger than the
/// thumbnail side. Only this derived image ever reaches the frontend.
pub fn thumbnail_png(icon: &RgbaImage) -> Vec<u8> {
    let (width, height) = fit_dimensions(icon.width(), icon.height(), THUMBNAIL_SIDE);
    let flat = flatten_on_white(icon);
    let scaled = imageops::resize(&flat, width, height, FilterType::Triangle);
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(scaled.as_raw(), width, height, ExtendedColorType::L8)
        .expect("writing a grayscale png to memory cannot fail");
    png
}

/// Alignment pattern centres (ISO/IEC 18004, annex E). The first and last
/// positions form the finder-adjacent corners, which are never drawn.
pub fn alignment_positions(version: u32) -> &'static [u32] {
    const TABLE: [&[u32]; 41] = [
        &[],
        &[],
        &[6, 18],
        &[6, 22],
        &[6, 26],
        &[6, 30],
        &[6, 34],
        &[6, 22, 38],
        &[6, 24, 42],
        &[6, 26, 46],
        &[6, 28, 50],
        &[6, 30, 54],
        &[6, 32, 58],
        &[6, 34, 62],
        &[6, 26, 46, 66],
        &[6, 26, 48, 70],
        &[6, 26, 50, 74],
        &[6, 30, 54, 78],
        &[6, 30, 56, 82],
        &[6, 30, 58, 86],
        &[6, 34, 62, 90],
        &[6, 28, 50, 72, 94],
        &[6, 26, 50, 74, 98],
        &[6, 30, 54, 78, 102],
        &[6, 28, 54, 80, 106],
        &[6, 32, 58, 84, 110],
        &[6, 30, 58, 86, 114],
        &[6, 34, 62, 90, 118],
        &[6, 26, 50, 74, 98, 122],
        &[6, 30, 54, 78, 102, 126],
        &[6, 26, 52, 78, 104, 130],
        &[6, 30, 56, 82, 108, 134],
        &[6, 34, 60, 86, 112, 138],
        &[6, 30, 58, 86, 114, 142],
        &[6, 34, 62, 90, 118, 146],
        &[6, 30, 54, 78, 102, 126, 150],
        &[6, 24, 50, 76, 102, 128, 154],
        &[6, 28, 54, 80, 106, 132, 158],
        &[6, 32, 58, 84, 110, 136, 162],
        &[6, 26, 54, 82, 110, 138, 166],
        &[6, 30, 58, 86, 114, 142, 170],
    ];
    TABLE.get(version as usize).copied().unwrap_or(&[])
}

/// Places the icon box centred on the symbol, shrinking it step by step until it
/// is within the module zone and clear of every alignment pattern. Returns
/// `None` when no size satisfies the rules, so the caller refuses to export.
pub fn place(
    core_modules: u32,
    module_px: u32,
    core_start_px: u32,
    icon_width: u32,
    icon_height: u32,
) -> Option<IconBox> {
    let version = core_modules.checked_sub(17)? / 4;
    if module_px == 0 || icon_width == 0 || icon_height == 0 || !(1..=40).contains(&version) {
        return None;
    }
    let core_px = core_modules * module_px;
    let pad = PADDING_MODULES * module_px;
    let min_inner = MIN_ICON_MODULES * module_px;
    let largest_box = core_px * MAX_BOX_PERCENT / 100;
    if largest_box < min_inner + 2 * pad {
        return None;
    }
    for limit in (min_inner + 2 * pad..=largest_box).rev() {
        let (inner_width, inner_height) = fit_dimensions(icon_width, icon_height, limit - 2 * pad);
        if inner_width.min(inner_height) < min_inner {
            return None;
        }
        let width = inner_width + 2 * pad;
        let height = inner_height + 2 * pad;
        let x = core_start_px + (core_px - width) / 2;
        let y = core_start_px + (core_px - height) / 2;
        let placement = IconBox {
            x,
            y,
            width,
            height,
            inner_width,
            inner_height,
        };
        if clears_function_patterns(&placement, version, core_modules, module_px, core_start_px) {
            return Some(placement);
        }
    }
    None
}

fn clears_function_patterns(
    placement: &IconBox,
    version: u32,
    core_modules: u32,
    module_px: u32,
    core_start_px: u32,
) -> bool {
    let zone_start = core_start_px + MODULE_ZONE_MARGIN * module_px;
    let zone_end = core_start_px + (core_modules - MODULE_ZONE_MARGIN) * module_px;
    let inside_zone = placement.x >= zone_start
        && placement.x + placement.width <= zone_end
        && placement.y >= zone_start
        && placement.y + placement.height <= zone_end;
    if !inside_zone {
        return false;
    }
    let positions = alignment_positions(version);
    let (Some(&first), Some(&last)) = (positions.first(), positions.last()) else {
        return true;
    };
    positions.iter().all(|&ax| {
        positions.iter().all(|&ay| {
            let finder_corner = (ax == first && ay == first)
                || (ax == first && ay == last)
                || (ax == last && ay == first);
            if finder_corner {
                return true;
            }
            let left = core_start_px + (ax - 2) * module_px;
            let right = core_start_px + (ax + 3) * module_px;
            let top = core_start_px + (ay - 2) * module_px;
            let bottom = core_start_px + (ay + 3) * module_px;
            !(placement.x < right
                && placement.x + placement.width > left
                && placement.y < bottom
                && placement.y + placement.height > top)
        })
    })
}

/// Paints the white underlay, then the icon scaled to the inner size. Alpha is
/// blended onto white, so the output stays a pure grayscale symbol.
pub fn draw(gray: &mut GrayImage, icon: &RgbaImage, placement: IconBox) {
    for y in placement.y..placement.y + placement.height {
        for x in placement.x..placement.x + placement.width {
            gray.put_pixel(x, y, Luma([255]));
        }
    }
    let flat = flatten_on_white(icon);
    let scaled = imageops::resize(
        &flat,
        placement.inner_width,
        placement.inner_height,
        FilterType::Lanczos3,
    );
    let pad = (placement.width - placement.inner_width) / 2;
    for (x, y, pixel) in scaled.enumerate_pixels() {
        gray.put_pixel(placement.x + pad + x, placement.y + pad + y, *pixel);
    }
}

fn flatten_on_white(icon: &RgbaImage) -> GrayImage {
    GrayImage::from_fn(icon.width(), icon.height(), |x, y| {
        let [r, g, b, a] = icon.get_pixel(x, y).0;
        let luma = (299 * u32::from(r) + 587 * u32::from(g) + 114 * u32::from(b)) / 1000;
        let alpha = u32::from(a);
        Luma([((luma * alpha + 255 * (255 - alpha) + 127) / 255) as u8])
    })
}

/// Largest size with the same aspect ratio whose longer side is `max`, rounded to
/// whole pixels and never below one pixel.
fn fit_dimensions(width: u32, height: u32, max: u32) -> (u32, u32) {
    let (w, h, m) = (u64::from(width), u64::from(height), u64::from(max));
    if width >= height {
        let scaled = (2 * h * m + w) / (2 * w);
        (max, scaled.max(1) as u32)
    } else {
        let scaled = (2 * w * m + h) / (2 * h);
        (scaled.max(1) as u32, max)
    }
}

#[cfg(test)]
mod tests;
