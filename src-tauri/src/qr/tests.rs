use image::GrayImage;
use qrcode::QrCode;

use super::{ErrorCorrection, MIN_MODULE_PX, PixelSize, QUIET_ZONE_MODULES, QrError, encode_png};

const ALL_LEVELS: [ErrorCorrection; 4] = [
    ErrorCorrection::L,
    ErrorCorrection::M,
    ErrorCorrection::Q,
    ErrorCorrection::H,
];

const ALL_SIZES: [PixelSize; 3] = [PixelSize::Px256, PixelSize::Px512, PixelSize::Px1024];

fn decode_gray(png: &[u8]) -> GrayImage {
    image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .expect("the output is a PNG")
        .to_luma8()
}

fn decode_text(png: &[u8]) -> String {
    let mut prepared = rqrr::PreparedImage::prepare(decode_gray(png));
    let grids = prepared.detect_grids();
    assert_eq!(grids.len(), 1, "exactly one symbol is expected");
    let (_, content) = grids[0].decode().expect("the symbol decodes");
    content
}

fn cjk_emoji_url_mixed() -> [&'static str; 4] {
    [
        "二维码生成：中文内容测试",
        "🙂📦 emoji 🔐✅",
        "https://example.com/path?q=中文&x=1#frag",
        "Mix 混合 ✓ 123 ABC",
    ]
}

#[test]
fn every_text_kind_decodes_back_to_its_input_at_every_level_and_size() {
    for text in cjk_emoji_url_mixed() {
        for level in ALL_LEVELS {
            for size in ALL_SIZES {
                let encoded = encode_png(text, level, size).expect("within capacity");
                assert_eq!(
                    decode_text(&encoded.png),
                    text,
                    "{level:?} {size:?} {text:?}"
                );
            }
        }
    }
}

#[test]
fn byte_limits_follow_the_level_capacity_and_the_product_cap() {
    assert_eq!(ErrorCorrection::L.max_bytes(), 2048);
    assert_eq!(ErrorCorrection::M.max_bytes(), 2048);
    assert_eq!(ErrorCorrection::Q.max_bytes(), 1663);
    assert_eq!(ErrorCorrection::H.max_bytes(), 1273);
}

#[test]
fn exactly_the_maximum_ascii_bytes_decode_and_one_more_byte_is_refused() {
    for level in ALL_LEVELS {
        for size in [PixelSize::Px512, PixelSize::Px1024] {
            let max = level.max_bytes();
            let text = "a".repeat(max);
            let encoded = encode_png(&text, level, size).expect("at the limit");
            assert_eq!(decode_text(&encoded.png), text, "{level:?} {size:?}");

            let too_long = "a".repeat(max + 1);
            assert_eq!(
                encode_png(&too_long, level, size).err(),
                Some(QrError::TooLong { max_bytes: max }),
                "{level:?} {size:?}"
            );
        }
    }
}

#[test]
fn multibyte_text_is_limited_in_bytes_not_characters() {
    for level in ALL_LEVELS {
        for size in [PixelSize::Px512, PixelSize::Px1024] {
            let max = level.max_bytes();
            // 3-byte characters fill the limit exactly, then ASCII tops it up.
            let text = format!("{}{}", "中".repeat(max / 3), "a".repeat(max % 3));
            assert_eq!(text.len(), max);
            let encoded = encode_png(&text, level, size).expect("at the limit");
            assert_eq!(decode_text(&encoded.png), text, "{level:?} {size:?}");

            let over = format!("{text}中");
            assert!(matches!(
                encode_png(&over, level, size),
                Err(QrError::TooLong { .. })
            ));
        }
    }
}

/// Largest input length whose symbol still gets at least `MIN_MODULE_PX` pixels
/// per module at `size`. Module size only shrinks as the length grows, so a
/// binary search finds the edge.
fn largest_length_with_readable_modules(level: ErrorCorrection, size: PixelSize) -> usize {
    let accepted = |len: usize| encode_png(&"a".repeat(len), level, size).is_ok();
    let (mut low, mut high) = (1, level.max_bytes());
    if accepted(high) {
        return high;
    }
    while low + 1 < high {
        let mid = (low + high) / 2;
        if accepted(mid) {
            low = mid;
        } else {
            high = mid;
        }
    }
    low
}

#[test]
fn the_smallest_size_stops_at_the_last_length_with_readable_modules() {
    for level in ALL_LEVELS {
        let edge = largest_length_with_readable_modules(level, PixelSize::Px256);
        let text = "a".repeat(edge);
        let encoded = encode_png(&text, level, PixelSize::Px256).expect("the edge is accepted");
        assert!(encoded.layout.module_px >= MIN_MODULE_PX, "{level:?}");
        assert_eq!(decode_text(&encoded.png), text, "{level:?} edge");

        if edge < level.max_bytes() {
            assert_eq!(
                encode_png(&"a".repeat(edge + 1), level, PixelSize::Px256).err(),
                Some(QrError::ModulesTooSmall {
                    min_module_px: MIN_MODULE_PX
                }),
                "{level:?}"
            );
        }
    }
}

#[test]
fn empty_input_is_refused_with_its_own_error() {
    for level in ALL_LEVELS {
        assert_eq!(
            encode_png("", level, PixelSize::Px256).err(),
            Some(QrError::Empty)
        );
    }
}

#[test]
fn error_messages_never_echo_the_input_text() {
    let secret = "secret-token-值";
    let too_long = format!("{secret}{}", "x".repeat(2048));
    let message = encode_png(&too_long, ErrorCorrection::M, PixelSize::Px256)
        .expect_err("too long")
        .to_string();
    assert!(!message.contains("secret-token"));
    assert!(message.contains("2048"));
}

#[test]
fn pixel_sizes_accept_only_the_three_targets() {
    assert_eq!(PixelSize::try_from(256), Ok(PixelSize::Px256));
    assert_eq!(PixelSize::try_from(512), Ok(PixelSize::Px512));
    assert_eq!(PixelSize::try_from(1024), Ok(PixelSize::Px1024));
    for invalid in [0, 255, 257, 300, 2048] {
        assert!(PixelSize::try_from(invalid).is_err(), "{invalid}");
    }
}

#[test]
fn output_is_a_square_of_the_requested_size() {
    for size in ALL_SIZES {
        let encoded = encode_png("https://example.com", ErrorCorrection::M, size).unwrap();
        let image = decode_gray(&encoded.png);
        assert_eq!(image.width(), size.pixels());
        assert_eq!(image.height(), size.pixels());
        assert_eq!(encoded.layout.image_px, size.pixels());
    }
}

#[test]
fn encoding_is_deterministic() {
    let first = encode_png("同一输入", ErrorCorrection::Q, PixelSize::Px512).unwrap();
    let second = encode_png("同一输入", ErrorCorrection::Q, PixelSize::Px512).unwrap();
    assert_eq!(first.png, second.png);
}

/// Every pixel must equal the reference module at its position: quiet zone and
/// the area around the symbol are white, and each module is one uniform block of
/// `module_px` pixels, so the output is pure black and white and aligned.
fn assert_exact_module_grid(text: &str, level: ErrorCorrection, size: PixelSize) {
    let encoded = encode_png(text, level, size).expect("within capacity");
    let layout = encoded.layout;
    let image = decode_gray(&encoded.png);
    let reference = QrCode::with_error_correction_level(text.as_bytes(), level.to_qrcode())
        .expect("reference encodes");
    let core = reference.width() as u32;
    let colors = reference.to_colors();
    assert_eq!(layout.core_modules, core, "{level:?} {size:?}");
    let m = layout.module_px;
    let quiet = QUIET_ZONE_MODULES * m;
    let core_start = layout.origin_px + quiet;
    assert!(
        (core + 2 * QUIET_ZONE_MODULES) * m <= size.pixels(),
        "symbol with quiet zone fits the target"
    );
    assert!(
        (core + 2 * QUIET_ZONE_MODULES) * (m + 1) > size.pixels(),
        "module size is the largest whole pixel count that fits"
    );

    for (x, y, pixel) in image.enumerate_pixels() {
        let in_core = |v: u32| v >= core_start && v < core_start + core * m;
        let expected = if in_core(x) && in_core(y) {
            let cx = ((x - core_start) / m) as usize;
            let cy = ((y - core_start) / m) as usize;
            let dark = matches!(colors[cy * core as usize + cx], qrcode::Color::Dark);
            if dark { 0 } else { 255 }
        } else {
            255
        };
        assert_eq!(pixel.0[0], expected, "pixel ({x},{y}) {level:?} {size:?}");
    }
}

#[test]
fn quiet_zone_is_complete_and_modules_are_whole_pixels_at_every_size() {
    for level in ALL_LEVELS {
        for size in ALL_SIZES {
            assert_exact_module_grid("https://example.com/alignment", level, size);
        }
    }
}

#[test]
fn the_densest_symbol_keeps_its_quiet_zone_at_512_px() {
    let text = "a".repeat(ErrorCorrection::L.max_bytes());
    assert_exact_module_grid(&text, ErrorCorrection::L, PixelSize::Px512);
    let text = "中".repeat(ErrorCorrection::H.max_bytes() / 3);
    assert_exact_module_grid(&text, ErrorCorrection::H, PixelSize::Px512);
}

#[test]
fn layout_reports_the_pixel_scale_it_used() {
    let encoded = encode_png("https://example.com", ErrorCorrection::M, PixelSize::Px1024).unwrap();
    let layout = encoded.layout;
    assert_eq!(layout.image_px, 1024);
    assert!(layout.module_px >= 1);
    assert!(layout.origin_px * 2 + (layout.core_modules + 8) * layout.module_px <= 1024);
}
