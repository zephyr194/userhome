use image::{
    ExtendedColorType, ImageEncoder, Rgba, RgbaImage,
    codecs::{jpeg::JpegEncoder, png::PngEncoder, webp::WebPEncoder},
};
use qrcode::{EcLevel, QrCode, Version};

use super::{
    IconError, IconFormat, MAX_ICON_BYTES, MIN_ICON_MODULES, alignment_positions, decode_icon,
    place, thumbnail_png,
};
use crate::qr::{ErrorCorrection, PixelSize, QrError, encode_png, encode_png_with_icon};

fn logo_square() -> RgbaImage {
    RgbaImage::from_fn(64, 64, |x, y| {
        if (x / 8 + y / 8) % 2 == 0 {
            Rgba([0, 0, 0, 255])
        } else {
            Rgba([200, 40, 40, 255])
        }
    })
}

fn logo_transparent() -> RgbaImage {
    RgbaImage::from_fn(80, 80, |x, y| {
        let dx = x as i32 - 40;
        let dy = y as i32 - 40;
        if dx * dx + dy * dy <= 30 * 30 {
            Rgba([20, 90, 200, 255])
        } else {
            Rgba([0, 0, 0, 0])
        }
    })
}

fn logo_wide() -> RgbaImage {
    RgbaImage::from_fn(300, 100, |x, y| {
        Rgba([(x % 256) as u8, (y * 2 % 256) as u8, 128, 255])
    })
}

fn logo_tiny() -> RgbaImage {
    RgbaImage::from_pixel(8, 8, Rgba([10, 10, 10, 255]))
}

fn png_bytes(image: &RgbaImage) -> Vec<u8> {
    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .expect("png fixture");
    out
}

fn jpeg_bytes(image: &RgbaImage) -> Vec<u8> {
    let rgb = image::DynamicImage::ImageRgba8(image.clone()).to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 92)
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )
        .expect("jpeg fixture");
    out
}

fn webp_bytes(image: &RgbaImage) -> Vec<u8> {
    let mut out = Vec::new();
    WebPEncoder::new_lossless(&mut out)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            ExtendedColorType::Rgba8,
        )
        .expect("webp fixture");
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                0xedb8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn push_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend((data.len() as u32).to_be_bytes());
    let mut body = kind.to_vec();
    body.extend(data);
    out.extend(&body);
    out.extend(crc32(&body).to_be_bytes());
}

/// A PNG whose header claims `width`×`height` but carries no pixel data.
fn png_claiming(width: u32, height: u32) -> Vec<u8> {
    let mut header = Vec::new();
    header.extend(width.to_be_bytes());
    header.extend(height.to_be_bytes());
    header.extend([8u8, 6, 0, 0, 0]);
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    push_chunk(&mut out, b"IHDR", &header);
    push_chunk(
        &mut out,
        b"IDAT",
        &[0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01],
    );
    push_chunk(&mut out, b"IEND", &[]);
    out
}

fn decode_text(png: &[u8]) -> String {
    let gray = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .expect("png output")
        .to_luma8();
    let mut prepared = rqrr::PreparedImage::prepare(gray);
    let grids = prepared.detect_grids();
    assert_eq!(grids.len(), 1, "exactly one symbol");
    grids[0].decode().expect("symbol decodes").1
}

fn version_of(text: &str) -> u32 {
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::H).expect("fits");
    match code.version() {
        Version::Normal(version) => version as u32,
        Version::Micro(_) => panic!("micro symbols are not produced"),
    }
}

fn text_of_length(length: usize) -> String {
    "https://example.com/"
        .chars()
        .cycle()
        .take(length)
        .collect()
}

#[test]
fn accepts_png_jpeg_and_webp_by_content() {
    let square = logo_square();
    let cases = [
        (png_bytes(&square), IconFormat::Png),
        (jpeg_bytes(&square), IconFormat::Jpeg),
        (webp_bytes(&square), IconFormat::WebP),
    ];
    for (bytes, format) in cases {
        let decoded = decode_icon(&bytes).expect("supported format");
        assert_eq!(decoded.format, format);
        assert_eq!((decoded.rgba.width(), decoded.rgba.height()), (64, 64));
    }
}

#[test]
fn svg_html_gif_and_remote_references_are_refused_as_unsupported() {
    let inputs: [&[u8]; 4] = [
        br#"<svg xmlns="http://www.w3.org/2000/svg"></svg>"#,
        b"<!doctype html><html><script>alert(1)</script></html>",
        b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;",
        b"https://example.com/logo.png",
    ];
    for input in inputs {
        assert_eq!(
            decode_icon(input).err(),
            Some(IconError::UnsupportedFormat),
            "{:?}",
            String::from_utf8_lossy(input)
        );
    }
}

#[test]
fn corrupt_and_truncated_images_are_malformed() {
    let mut broken_png = png_bytes(&logo_square());
    broken_png.truncate(broken_png.len() / 2);
    assert_eq!(decode_icon(&broken_png).err(), Some(IconError::Malformed));

    let mut broken_jpeg = jpeg_bytes(&logo_square());
    broken_jpeg.truncate(40);
    assert_eq!(decode_icon(&broken_jpeg).err(), Some(IconError::Malformed));

    let mut garbage = b"\x89PNG\r\n\x1a\n".to_vec();
    garbage.extend([0xffu8; 64]);
    assert_eq!(decode_icon(&garbage).err(), Some(IconError::Malformed));
}

#[test]
fn a_header_claiming_an_oversized_image_is_refused_before_decoding() {
    for (width, height) in [(4097, 16), (16, 4097), (5000, 5000), (20_000, 1)] {
        assert_eq!(
            decode_icon(&png_claiming(width, height)).err(),
            Some(IconError::DimensionsTooLarge),
            "{width}x{height}"
        );
    }
}

#[test]
fn an_icon_over_five_mebibytes_is_refused_by_size_alone() {
    let mut oversized = png_bytes(&logo_square());
    oversized.resize(MAX_ICON_BYTES + 1, 0);
    assert_eq!(decode_icon(&oversized).err(), Some(IconError::TooLarge));
}

#[test]
fn icon_errors_never_echo_the_path_or_content() {
    let secret = "/Users/someone/secret-folder/logo.png";
    for error in [
        IconError::TooLarge,
        IconError::UnsupportedFormat,
        IconError::Malformed,
        IconError::DimensionsTooLarge,
    ] {
        let message = error.to_string();
        assert!(!message.contains("/Users"), "{message}");
        assert!(!message.contains(secret), "{message}");
    }
}

#[test]
fn thumbnail_is_a_small_grayscale_png_composited_on_white() {
    let thumb = thumbnail_png(&logo_transparent());
    assert!(thumb.starts_with(b"\x89PNG\r\n\x1a\n"));
    let decoded = image::load_from_memory_with_format(&thumb, image::ImageFormat::Png)
        .expect("thumbnail is a png")
        .to_luma8();
    assert!(decoded.width() <= 128 && decoded.height() <= 128);
    assert_eq!(
        decoded.get_pixel(0, 0).0[0],
        255,
        "transparent corner is white"
    );
}

#[test]
fn alignment_table_matches_the_patterns_in_encoded_symbols() {
    for version in 2..=40u32 {
        let positions = alignment_positions(version);
        let last = *positions.last().expect("v2 and above have alignment");
        let code = QrCode::with_version(
            text_of_length(16).as_bytes(),
            Version::Normal(version as i16),
            EcLevel::L,
        )
        .expect("version fits");
        let width = code.width() as u32;
        assert_eq!(width, 17 + 4 * version, "v{version}");
        let colors = code.to_colors();
        let dark = |x: u32, y: u32| matches!(colors[(y * width + x) as usize], qrcode::Color::Dark);
        for &x in positions {
            for &y in positions {
                let first = positions[0];
                let overlaps_finder = (x == first && y == first)
                    || (x == first && y == last)
                    || (x == last && y == first);
                if overlaps_finder {
                    continue;
                }
                assert!(dark(x, y), "v{version} centre ({x},{y})");
                for offset in 1..=2u32 {
                    let ring_dark = offset == 2;
                    for dx in -(offset as i32)..=(offset as i32) {
                        for dy in -(offset as i32)..=(offset as i32) {
                            let on_ring = dx.abs() == offset as i32 || dy.abs() == offset as i32;
                            if !on_ring {
                                continue;
                            }
                            let px = (x as i32 + dx) as u32;
                            let py = (y as i32 + dy) as u32;
                            assert_eq!(
                                dark(px, py),
                                ring_dark,
                                "v{version} ({x},{y}) ring {offset}"
                            );
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn the_box_stays_within_fifteen_percent_and_inside_the_module_zone() {
    for version in [5u32, 6, 14, 20, 40] {
        let core = 17 + 4 * version;
        for module_px in [2u32, 3, 5, 9] {
            let symbol = core * module_px;
            for (width, height) in [(64u32, 64u32), (300, 100), (100, 300), (8, 8)] {
                let Some(placed) = place(core, module_px, 40, width, height) else {
                    continue;
                };
                assert!(placed.width * 100 <= 15 * symbol, "v{version} m{module_px}");
                assert!(
                    placed.height * 100 <= 15 * symbol,
                    "v{version} m{module_px}"
                );
                assert_eq!(placed.width, placed.inner_width + 2 * module_px);
                assert_eq!(placed.height, placed.inner_height + 2 * module_px);
                assert!(placed.x >= 40 + 9 * module_px);
                assert!(placed.x + placed.width <= 40 + (core - 9) * module_px);
                assert!(placed.y >= 40 + 9 * module_px);
                assert!(placed.y + placed.height <= 40 + (core - 9) * module_px);
                assert!(
                    placed.inner_width.min(placed.inner_height) >= MIN_ICON_MODULES * module_px
                );
            }
        }
    }
}

#[test]
fn the_box_never_overlaps_an_alignment_pattern() {
    for version in 5..=40u32 {
        let core = 17 + 4 * version;
        let module_px = 4u32;
        let Some(placed) = place(core, module_px, 0, 64, 64) else {
            continue;
        };
        let positions = alignment_positions(version);
        let first = positions[0];
        let last = *positions.last().expect("alignment");
        for &ax in positions {
            for &ay in positions {
                if (ax == first && ay == first)
                    || (ax == first && ay == last)
                    || (ax == last && ay == first)
                {
                    continue;
                }
                let left = (ax - 2) * module_px;
                let right = (ax + 3) * module_px;
                let top = (ay - 2) * module_px;
                let bottom = (ay + 3) * module_px;
                let overlaps = placed.x < right
                    && placed.x + placed.width > left
                    && placed.y < bottom
                    && placed.y + placed.height > top;
                assert!(!overlaps, "v{version} alignment ({ax},{ay}) overlapped");
            }
        }
    }
}

#[test]
fn centred_icons_are_refused_for_versions_whose_centre_is_an_alignment_pattern() {
    for version in 7..=13u32 {
        let core = 17 + 4 * version;
        assert_eq!(place(core, 4, 0, 64, 64), None, "v{version}");
    }
}

#[test]
fn a_very_thin_icon_is_refused_because_its_short_side_is_unrecognisable() {
    let core = 17 + 4 * 40;
    assert_eq!(place(core, 4, 0, 1000, 10), None);
}

#[test]
fn icon_output_decodes_to_its_input_across_sizes_icons_and_lengths() {
    let icons: Vec<RgbaImage> = vec![logo_square(), logo_transparent(), logo_wide(), logo_tiny()];
    let inputs = [
        text_of_length(40),
        text_of_length(180),
        text_of_length(1000),
    ];
    let mut accepted = 0;
    for text in &inputs {
        for icon in &icons {
            for size in [PixelSize::Px256, PixelSize::Px512, PixelSize::Px1024] {
                match encode_png_with_icon(text, size, icon) {
                    Ok(encoded) => {
                        accepted += 1;
                        assert_eq!(decode_text(&encoded.png), *text, "{size:?} {}", text.len());
                        assert_eq!(encoded.level, ErrorCorrection::H);
                        assert!(encoded.icon_applied);
                    }
                    Err(error) => assert!(
                        matches!(
                            error,
                            QrError::IconDoesNotFit | QrError::ModulesTooSmall { .. }
                        ),
                        "{size:?} {}: {error:?}",
                        text.len()
                    ),
                }
            }
        }
    }
    assert!(
        accepted >= 9,
        "enough combinations must be scannable, got {accepted}"
    );
}

#[test]
fn known_good_combinations_are_always_produced() {
    let text = text_of_length(180);
    for size in [PixelSize::Px256, PixelSize::Px512, PixelSize::Px1024] {
        let encoded =
            encode_png_with_icon(&text, size, &logo_square()).expect("v14 accepts a square");
        assert_eq!(decode_text(&encoded.png), text);
    }
    let long = text_of_length(330);
    assert_eq!(version_of(&long), 19);
    let encoded = encode_png_with_icon(&long, PixelSize::Px1024, &logo_transparent()).expect("v19");
    assert_eq!(decode_text(&encoded.png), long);
}

#[test]
fn symbols_whose_centre_is_an_alignment_pattern_refuse_the_icon() {
    let text = text_of_length(60);
    assert_eq!(version_of(&text), 7);
    assert_eq!(
        encode_png_with_icon(&text, PixelSize::Px1024, &logo_square()).err(),
        Some(QrError::IconDoesNotFit)
    );
}

#[test]
fn a_symbol_too_small_for_the_icon_is_refused_not_broken() {
    assert_eq!(
        encode_png_with_icon("https://a.b", PixelSize::Px1024, &logo_square()).err(),
        Some(QrError::IconDoesNotFit)
    );
}

#[test]
fn text_beyond_the_level_h_capacity_is_refused_with_icon() {
    let text = text_of_length(1274);
    assert_eq!(
        encode_png_with_icon(&text, PixelSize::Px1024, &logo_square()).err(),
        Some(QrError::TooLong { max_bytes: 1273 })
    );
}

#[test]
fn removing_the_icon_leaves_no_trace_in_the_plain_output() {
    let text = text_of_length(180);
    let before = encode_png(&text, ErrorCorrection::M, PixelSize::Px512).expect("plain");
    let with_icon = encode_png_with_icon(&text, PixelSize::Px512, &logo_square()).expect("icon");
    assert_ne!(with_icon.png, before.png);
    let after = encode_png(&text, ErrorCorrection::M, PixelSize::Px512).expect("plain again");
    assert_eq!(before.png, after.png);
    assert!(!after.icon_applied);
}
