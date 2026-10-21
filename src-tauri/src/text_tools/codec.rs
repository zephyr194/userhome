use serde::{Deserialize, Serialize};

pub const MAX_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
pub const UNKNOWN_ENTITY_NOTICE: &str = "未识别的实体已保留。";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CodecAlgorithm {
    Base64,
    Base64UrlSafe,
    UrlComponent,
    HtmlEntities,
    UnicodeEscapes,
    Utf8Hex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CodecDirection {
    Encode,
    Decode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transformed {
    pub text: String,
    pub notices: Vec<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodecError {
    InputTooLarge,
    OutputTooLarge,
    /// `position` is a 1-based character index into the input when known.
    Invalid {
        position: Option<usize>,
        reason: &'static str,
    },
}

/// Performs exactly one conversion; decoded output is never decoded again.
pub fn transform(
    text: &str,
    algorithm: CodecAlgorithm,
    direction: CodecDirection,
) -> Result<Transformed, CodecError> {
    if text.len() > MAX_INPUT_BYTES {
        return Err(CodecError::InputTooLarge);
    }
    let mut notices = Vec::new();
    let output = match (algorithm, direction) {
        (CodecAlgorithm::Base64, CodecDirection::Encode) => {
            base64_encode(text, Base64Flavor::Standard)
        }
        (CodecAlgorithm::Base64, CodecDirection::Decode) => {
            base64_decode(text, Base64Flavor::Standard)?
        }
        (CodecAlgorithm::Base64UrlSafe, CodecDirection::Encode) => {
            base64_encode(text, Base64Flavor::UrlSafe)
        }
        (CodecAlgorithm::Base64UrlSafe, CodecDirection::Decode) => {
            base64_decode(text, Base64Flavor::UrlSafe)?
        }
        (CodecAlgorithm::UrlComponent, CodecDirection::Encode) => url_encode(text),
        (CodecAlgorithm::UrlComponent, CodecDirection::Decode) => url_decode(text)?,
        (CodecAlgorithm::HtmlEntities, CodecDirection::Encode) => html_encode(text),
        (CodecAlgorithm::HtmlEntities, CodecDirection::Decode) => html_decode(text, &mut notices)?,
        (CodecAlgorithm::UnicodeEscapes, CodecDirection::Encode) => unicode_encode(text),
        (CodecAlgorithm::UnicodeEscapes, CodecDirection::Decode) => unicode_decode(text)?,
        (CodecAlgorithm::Utf8Hex, CodecDirection::Encode) => hex_encode(text),
        (CodecAlgorithm::Utf8Hex, CodecDirection::Decode) => hex_decode(text)?,
    };
    if output.len() > MAX_OUTPUT_BYTES {
        return Err(CodecError::OutputTooLarge);
    }
    Ok(Transformed {
        text: output,
        notices,
    })
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_URL_SAFE_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const HEX_LOWER: &[u8; 16] = b"0123456789abcdef";
const HEX_UPPER: &[u8; 16] = b"0123456789ABCDEF";
const MAX_ENTITY_NAME_BYTES: usize = 32;

fn invalid(position: Option<usize>, reason: &'static str) -> CodecError {
    CodecError::Invalid { position, reason }
}

fn char_position(text: &str, byte_index: usize) -> usize {
    text[..byte_index].chars().count() + 1
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Base64Flavor {
    Standard,
    UrlSafe,
}

impl Base64Flavor {
    fn alphabet(self) -> &'static [u8; 64] {
        match self {
            Self::Standard => BASE64_ALPHABET,
            Self::UrlSafe => BASE64_URL_SAFE_ALPHABET,
        }
    }
}

fn base64_encode(text: &str, flavor: Base64Flavor) -> String {
    let alphabet = flavor.alphabet();
    let mut out = String::with_capacity(text.len().div_ceil(3) * 4);
    for chunk in text.as_bytes().chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let block = (u32::from(chunk[0]) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        for index in 0..4 {
            if index <= chunk.len() {
                let sextet = (block >> (18 - 6 * index)) & 0x3f;
                out.push(char::from(alphabet[sextet as usize]));
            } else if flavor == Base64Flavor::Standard {
                out.push('=');
            }
        }
    }
    out
}

fn base64_value(ch: char, alphabet: &[u8; 64]) -> Option<u32> {
    let byte = u8::try_from(ch).ok()?;
    alphabet
        .iter()
        .position(|&candidate| candidate == byte)
        .map(|value| value as u32)
}

fn base64_decode(text: &str, flavor: Base64Flavor) -> Result<String, CodecError> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut group: Vec<(usize, u32)> = Vec::with_capacity(4);
    let mut data_count = 0usize;
    let mut padding = 0usize;
    for (index, ch) in text.chars().enumerate() {
        let position = index + 1;
        if ch == '\r' || ch == '\n' {
            continue;
        }
        if ch == '=' {
            padding += 1;
            if padding > 2 {
                return Err(invalid(Some(position), "Base64 填充字符过多"));
            }
            continue;
        }
        if padding > 0 {
            return Err(invalid(Some(position), "Base64 填充之后不能再有数据"));
        }
        if flavor == Base64Flavor::UrlSafe && (ch == '+' || ch == '/') {
            return Err(invalid(
                Some(position),
                "URL-safe Base64 不使用 + 或 /，如需标准 Base64 请选择对应算法",
            ));
        }
        let value = base64_value(ch, flavor.alphabet())
            .ok_or_else(|| invalid(Some(position), "非法 Base64 字符"))?;
        group.push((position, value));
        data_count += 1;
        if group.len() == 4 {
            push_base64_group(&group, &mut out)?;
            group.clear();
        }
    }
    if padding > 0 && !(data_count + padding).is_multiple_of(4) {
        return Err(invalid(None, "Base64 填充数量与数据长度不匹配"));
    }
    if padding == 0 && data_count % 4 == 1 {
        return Err(invalid(None, "Base64 数据长度不完整"));
    }
    push_base64_group(&group, &mut out)?;
    String::from_utf8(out).map_err(|_| invalid(None, "解码结果不是有效的 UTF-8 文本"))
}

fn push_base64_group(group: &[(usize, u32)], out: &mut Vec<u8>) -> Result<(), CodecError> {
    let Some(&(last_position, _)) = group.last() else {
        return Ok(());
    };
    let block = group
        .iter()
        .fold(0u32, |acc, &(_, value)| (acc << 6) | value);
    let leftover_bits = 6 * group.len() - 8 * (group.len() - 1);
    if block & ((1u32 << leftover_bits) - 1) != 0 {
        return Err(invalid(Some(last_position), "Base64 末尾填充位必须为零"));
    }
    let data = block >> leftover_bits;
    for shift in (0..group.len() - 1).rev() {
        out.push(((data >> (8 * shift)) & 0xff) as u8);
    }
    Ok(())
}

fn url_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for &byte in text.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(char::from(byte));
        } else {
            out.push('%');
            out.push(char::from(HEX_UPPER[usize::from(byte >> 4)]));
            out.push(char::from(HEX_UPPER[usize::from(byte & 0x0f)]));
        }
    }
    out
}

fn url_decode(text: &str) -> Result<String, CodecError> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            out.push(bytes[index]);
            index += 1;
            continue;
        }
        let high = bytes.get(index + 1).and_then(|&byte| hex_digit(byte));
        let low = bytes.get(index + 2).and_then(|&byte| hex_digit(byte));
        let (Some(high), Some(low)) = (high, low) else {
            return Err(invalid(
                Some(char_position(text, index)),
                "百分号编码需要两位十六进制数字",
            ));
        };
        out.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(out).map_err(|_| invalid(None, "解码结果不是有效的 UTF-8 文本"))
}

fn html_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

fn html_decode(text: &str, notices: &mut Vec<&'static str>) -> Result<String, CodecError> {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(offset) = text[cursor..].find('&') {
        let amp = cursor + offset;
        out.push_str(&text[cursor..amp]);
        let after = &text[amp + 1..];
        if let Some(body) = after.strip_prefix('#') {
            let (ch, consumed) = parse_numeric_reference(body)
                .map_err(|reason| invalid(Some(char_position(text, amp)), reason))?;
            out.push(ch);
            cursor = amp + 2 + consumed;
            continue;
        }
        let name_len = after.bytes().take_while(u8::is_ascii_alphanumeric).count();
        let terminated = after.as_bytes().get(name_len) == Some(&b';');
        if !terminated || name_len == 0 || name_len > MAX_ENTITY_NAME_BYTES {
            out.push('&');
            cursor = amp + 1;
            continue;
        }
        match named_entity(&after[..name_len]) {
            Some(ch) => out.push(ch),
            None => {
                out.push_str(&text[amp..amp + name_len + 2]);
                if !notices.contains(&UNKNOWN_ENTITY_NOTICE) {
                    notices.push(UNKNOWN_ENTITY_NOTICE);
                }
            }
        }
        cursor = amp + name_len + 2;
    }
    out.push_str(&text[cursor..]);
    Ok(out)
}

fn named_entity(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some('\u{a0}'),
        _ => None,
    }
}

/// `body` starts just after `&#`; returns the character and how many bytes of
/// `body` the reference used, including the terminating `;`.
fn parse_numeric_reference(body: &str) -> Result<(char, usize), &'static str> {
    let (radix, start): (u32, usize) = match body.as_bytes().first() {
        Some(b'x' | b'X') => (16, 1),
        _ => (10, 0),
    };
    let digits = body.as_bytes()[start..]
        .iter()
        .take_while(|&&byte| hex_digit(byte).is_some_and(|digit| u32::from(digit) < radix))
        .count();
    if digits == 0 || body.as_bytes().get(start + digits) != Some(&b';') {
        return Err("数字实体格式不完整");
    }
    let mut value: u32 = 0;
    for &byte in &body.as_bytes()[start..start + digits] {
        let digit = u32::from(hex_digit(byte).unwrap_or_default());
        value = value
            .checked_mul(radix)
            .and_then(|scaled| scaled.checked_add(digit))
            .ok_or("数字实体码点非法")?;
    }
    match char::from_u32(value) {
        Some(ch) if value != 0 => Ok((ch, start + digits + 1)),
        _ => Err("数字实体码点非法"),
    }
}

fn unicode_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ' '..='~' => out.push(ch),
            _ => push_unicode_escape(&mut out, ch),
        }
    }
    out
}

fn push_unicode_escape(out: &mut String, ch: char) {
    let mut units = [0u16; 2];
    for &unit in ch.encode_utf16(&mut units).iter() {
        out.push_str("\\u");
        for shift in [12, 8, 4, 0] {
            out.push(char::from(HEX_LOWER[usize::from((unit >> shift) & 0x0f)]));
        }
    }
}

fn unicode_decode(text: &str) -> Result<String, CodecError> {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'\\' {
            let next = text[index..]
                .find('\\')
                .map_or(bytes.len(), |offset| index + offset);
            out.push_str(&text[index..next]);
            index = next;
            continue;
        }
        let escape_start = index;
        let fail = |reason: &'static str| invalid(Some(char_position(text, escape_start)), reason);
        let &escape = bytes.get(index + 1).ok_or_else(|| fail("转义序列不完整"))?;
        index += 2;
        let ch = match escape {
            b'"' => '"',
            b'\\' => '\\',
            b'/' => '/',
            b'b' => '\u{8}',
            b'f' => '\u{c}',
            b'n' => '\n',
            b'r' => '\r',
            b't' => '\t',
            b'u' => {
                let unit = hex4(bytes, index).ok_or_else(|| fail("\\u 后需要四位十六进制数字"))?;
                index += 4;
                match unit {
                    0xDC00..=0xDFFF => return Err(fail("孤立的 UTF-16 代理项")),
                    0xD800..=0xDBFF => {
                        let low = if bytes.get(index) == Some(&b'\\')
                            && bytes.get(index + 1) == Some(&b'u')
                        {
                            hex4(bytes, index + 2)
                        } else {
                            None
                        };
                        let low = low
                            .filter(|low| (0xDC00..=0xDFFF).contains(low))
                            .ok_or_else(|| fail("孤立的 UTF-16 代理项"))?;
                        index += 6;
                        let code = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
                        char::from_u32(code).ok_or_else(|| fail("非法的 Unicode 码点"))?
                    }
                    _ => char::from_u32(unit).ok_or_else(|| fail("非法的 Unicode 码点"))?,
                }
            }
            _ => return Err(fail("非法转义字符")),
        };
        out.push(ch);
    }
    Ok(out)
}

fn hex4(bytes: &[u8], start: usize) -> Option<u32> {
    let digits = bytes.get(start..start + 4)?;
    digits.iter().try_fold(0u32, |acc, &byte| {
        Some((acc << 4) | u32::from(hex_digit(byte)?))
    })
}

fn hex_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for &byte in text.as_bytes() {
        out.push(char::from(HEX_LOWER[usize::from(byte >> 4)]));
        out.push(char::from(HEX_LOWER[usize::from(byte & 0x0f)]));
    }
    out
}

fn hex_decode(text: &str) -> Result<String, CodecError> {
    let mut bytes = Vec::with_capacity(text.len() / 2);
    let mut high: Option<(usize, u8)> = None;
    for (index, ch) in text.chars().enumerate() {
        let position = index + 1;
        if ch.is_ascii_whitespace() {
            if high.is_some() {
                return Err(invalid(Some(position), "同一字节内不允许空白"));
            }
            continue;
        }
        let digit = u8::try_from(ch)
            .ok()
            .and_then(hex_digit)
            .ok_or_else(|| invalid(Some(position), "非十六进制字符"))?;
        match high.take() {
            None => high = Some((position, digit)),
            Some((_, value)) => bytes.push((value << 4) | digit),
        }
    }
    if let Some((position, _)) = high {
        return Err(invalid(Some(position), "十六进制位数为奇数"));
    }
    String::from_utf8(bytes).map_err(|_| invalid(None, "解码结果不是有效的 UTF-8 文本"))
}

#[cfg(test)]
mod tests {
    use super::CodecAlgorithm::*;
    use super::CodecDirection::*;
    use super::*;

    const SAMPLES: &[&str] = &[
        "",
        "中文字符",
        "emoji 😀👍🏽 mixed",
        "line one\nline two\r\nend",
        "tab\tquote\"back\\slash&<>'",
        "control \u{1}\u{7f} and nbsp\u{a0}",
    ];

    fn ok(text: &str, algorithm: CodecAlgorithm, direction: CodecDirection) -> String {
        transform(text, algorithm, direction)
            .unwrap_or_else(|error| panic!("{algorithm:?} {direction:?} {text:?}: {error:?}"))
            .text
    }

    fn err(text: &str, algorithm: CodecAlgorithm, direction: CodecDirection) -> CodecError {
        match transform(text, algorithm, direction) {
            Err(error) => error,
            Ok(output) => panic!("expected error for {text:?}, got {output:?}"),
        }
    }

    fn position(text: &str, algorithm: CodecAlgorithm, direction: CodecDirection) -> Option<usize> {
        match err(text, algorithm, direction) {
            CodecError::Invalid { position, .. } => position,
            other => panic!("expected invalid input for {text:?}, got {other:?}"),
        }
    }

    #[test]
    fn limits_are_the_documented_values() {
        assert_eq!(MAX_INPUT_BYTES, 1_048_576);
        assert_eq!(MAX_OUTPUT_BYTES, 8_388_608);
    }

    #[test]
    fn every_algorithm_round_trips_chinese_emoji_newlines_and_empty() {
        for algorithm in [Base64, UrlComponent, HtmlEntities, UnicodeEscapes, Utf8Hex] {
            for sample in SAMPLES {
                let encoded = ok(sample, algorithm, Encode);
                let decoded = ok(&encoded, algorithm, Decode);
                assert_eq!(&decoded, sample, "{algorithm:?} round trip");
            }
        }
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(ok("", Base64, Encode), "");
        assert_eq!(ok("f", Base64, Encode), "Zg==");
        assert_eq!(ok("fo", Base64, Encode), "Zm8=");
        assert_eq!(ok("foo", Base64, Encode), "Zm9v");
        assert_eq!(ok("中", Base64, Encode), "5Lit");
    }

    #[test]
    fn base64_decode_accepts_padded_and_unpadded_input() {
        assert_eq!(ok("Zg==", Base64, Decode), "f");
        assert_eq!(ok("Zg", Base64, Decode), "f");
        assert_eq!(ok("Zm8", Base64, Decode), "fo");
        assert_eq!(ok("", Base64, Decode), "");
    }

    #[test]
    fn base64_decode_tolerates_line_breaks_but_not_spaces_or_tabs() {
        assert_eq!(ok("Zm9v\nYmFy", Base64, Decode), "foobar");
        assert_eq!(ok("Zm9v\r\nYmFy", Base64, Decode), "foobar");
        assert_eq!(position("Zm9v YmFy", Base64, Decode), Some(5));
        assert_eq!(position("Zm9v\tYmFy", Base64, Decode), Some(5));
    }

    #[test]
    fn base64_decode_rejects_illegal_characters_and_reports_position() {
        assert_eq!(position("Zm9v!", Base64, Decode), Some(5));
        assert_eq!(position("Zm9v-_", Base64, Decode), Some(5));
        assert_eq!(position("Zm9v中", Base64, Decode), Some(5));
    }

    #[test]
    fn base64_decode_rejects_bad_padding_and_lengths() {
        assert!(matches!(
            err("Z", Base64, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("Zg=", Base64, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("===", Base64, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("Zg===", Base64, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("Zg==Zg==", Base64, Decode),
            CodecError::Invalid { .. }
        ));
        assert_eq!(ok("Zg==\n", Base64, Decode), "f");
    }

    #[test]
    fn base64_decode_rejects_non_canonical_trailing_bits() {
        assert!(matches!(
            err("Zh==", Base64, Decode),
            CodecError::Invalid { .. }
        ));
    }

    #[test]
    fn base64_decode_rejects_non_utf8_bytes_without_replacement() {
        assert!(matches!(
            err("/w==", Base64, Decode),
            CodecError::Invalid { position: None, .. }
        ));
    }

    #[test]
    fn url_safe_base64_round_trips_chinese_emoji_newlines_and_empty() {
        for sample in SAMPLES {
            let encoded = ok(sample, Base64UrlSafe, Encode);
            assert!(
                !encoded.contains(['+', '/', '=']),
                "{sample:?} -> {encoded}"
            );
            assert_eq!(&ok(&encoded, Base64UrlSafe, Decode), sample);
        }
    }

    #[test]
    fn url_safe_base64_encodes_without_padding_and_known_vectors() {
        assert_eq!(ok("", Base64UrlSafe, Encode), "");
        assert_eq!(ok("f", Base64UrlSafe, Encode), "Zg");
        assert_eq!(ok("fo", Base64UrlSafe, Encode), "Zm8");
        assert_eq!(ok("foo", Base64UrlSafe, Encode), "Zm9v");
        assert_eq!(ok("中", Base64UrlSafe, Encode), "5Lit");
        assert_eq!(ok("中文字符", Base64UrlSafe, Encode), "5Lit5paH5a2X56ym");
    }

    #[test]
    fn url_safe_base64_uses_dash_and_underscore_where_standard_uses_plus_and_slash() {
        assert_eq!(ok("😀", Base64UrlSafe, Encode), "8J-YgA");
        assert_eq!(ok("\u{83f}", Base64UrlSafe, Encode), "4KC_");
        assert_eq!(ok("😀", Base64, Encode), "8J+YgA==");
        assert_eq!(ok("\u{83f}", Base64, Encode), "4KC/");
    }

    #[test]
    fn url_safe_base64_decode_accepts_unpadded_and_correctly_padded_input() {
        assert_eq!(ok("", Base64UrlSafe, Decode), "");
        assert_eq!(ok("Zg", Base64UrlSafe, Decode), "f");
        assert_eq!(ok("Zg==", Base64UrlSafe, Decode), "f");
        assert_eq!(ok("Zm8", Base64UrlSafe, Decode), "fo");
        assert_eq!(ok("Zm8=", Base64UrlSafe, Decode), "fo");
        assert_eq!(ok("Zm9v", Base64UrlSafe, Decode), "foo");
        assert_eq!(ok("8J-YgA", Base64UrlSafe, Decode), "😀");
        assert_eq!(ok("8J-YgA==", Base64UrlSafe, Decode), "😀");
        assert_eq!(ok("Zm8=\r\n", Base64UrlSafe, Decode), "fo");
    }

    #[test]
    fn url_safe_base64_decode_rejects_wrong_padding() {
        for raw in ["Zg=", "Zg===", "===", "Zm9v=", "Zg==Zg==", "Zg=Zg"] {
            assert!(
                matches!(err(raw, Base64UrlSafe, Decode), CodecError::Invalid { .. }),
                "{raw}"
            );
        }
    }

    #[test]
    fn url_safe_base64_decode_rejects_standard_alphabet_with_guidance() {
        assert_eq!(position("8J+YgA", Base64UrlSafe, Decode), Some(3));
        assert_eq!(position("4KC/", Base64UrlSafe, Decode), Some(4));
        assert!(matches!(
            err("8J+YgA", Base64UrlSafe, Decode),
            CodecError::Invalid { reason, .. } if reason.contains("标准 Base64")
        ));
    }

    #[test]
    fn url_safe_base64_decode_tolerates_line_breaks_but_not_spaces() {
        assert_eq!(ok("Zm9v\nYmFy", Base64UrlSafe, Decode), "foobar");
        assert_eq!(position("Zm9v YmFy", Base64UrlSafe, Decode), Some(5));
        assert_eq!(position("Zm9v!", Base64UrlSafe, Decode), Some(5));
    }

    #[test]
    fn url_safe_base64_decode_rejects_non_canonical_trailing_bits() {
        assert!(matches!(
            err("Zh", Base64UrlSafe, Decode),
            CodecError::Invalid { .. }
        ));
    }

    #[test]
    fn url_safe_base64_decode_rejects_non_utf8_bytes_without_replacement() {
        assert!(matches!(
            err("_w", Base64UrlSafe, Decode),
            CodecError::Invalid { position: None, .. }
        ));
        assert!(matches!(
            err("-_8", Base64UrlSafe, Decode),
            CodecError::Invalid { position: None, .. }
        ));
    }

    #[test]
    fn url_safe_base64_shares_the_input_limit() {
        let over = "a".repeat(MAX_INPUT_BYTES + 1);
        assert_eq!(
            transform(&over, Base64UrlSafe, Decode),
            Err(CodecError::InputTooLarge)
        );
    }

    #[test]
    fn decoding_is_single_layer_for_every_algorithm() {
        assert_eq!(ok("YUdrPQ==", Base64, Decode), "aGk=");
        assert_eq!(ok("%2520", UrlComponent, Decode), "%20");
        assert_eq!(ok("&amp;lt;", HtmlEntities, Decode), "&lt;");
        assert_eq!(ok("\\\\u0041", UnicodeEscapes, Decode), "\\u0041");
        assert_eq!(ok("3635", Utf8Hex, Decode), "65");
    }

    #[test]
    fn url_encode_follows_encode_uri_component() {
        assert_eq!(ok("中 +&", UrlComponent, Encode), "%E4%B8%AD%20%2B%26");
        assert_eq!(ok("a b", UrlComponent, Encode), "a%20b");
        assert_eq!(ok("-_.!~*'()", UrlComponent, Encode), "-_.!~*'()");
        assert_eq!(ok("😀", UrlComponent, Encode), "%F0%9F%98%80");
    }

    #[test]
    fn url_decode_never_turns_plus_into_space() {
        assert_eq!(ok("a+b", UrlComponent, Decode), "a+b");
        assert_eq!(ok("a%2Bb", UrlComponent, Decode), "a+b");
    }

    #[test]
    fn url_decode_accepts_lowercase_hex_and_utf8_sequences() {
        assert_eq!(ok("%E4%B8%AD", UrlComponent, Decode), "中");
        assert_eq!(ok("%e4%b8%ad", UrlComponent, Decode), "中");
    }

    #[test]
    fn url_decode_rejects_malformed_percent_escapes_with_position() {
        assert_eq!(position("%", UrlComponent, Decode), Some(1));
        assert_eq!(position("ab%2", UrlComponent, Decode), Some(3));
        assert_eq!(position("%zz", UrlComponent, Decode), Some(1));
        assert_eq!(position("中%", UrlComponent, Decode), Some(2));
    }

    #[test]
    fn url_decode_rejects_non_utf8_byte_sequences() {
        assert!(matches!(
            err("%FF", UrlComponent, Decode),
            CodecError::Invalid { position: None, .. }
        ));
        assert!(matches!(
            err("%E4%B8", UrlComponent, Decode),
            CodecError::Invalid { position: None, .. }
        ));
    }

    #[test]
    fn html_encode_escapes_the_five_special_characters() {
        assert_eq!(
            ok("<a href=\"x\">'&'</a>", HtmlEntities, Encode),
            "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;"
        );
        assert_eq!(ok("中😀", HtmlEntities, Encode), "中😀");
    }

    #[test]
    fn html_decode_handles_named_and_numeric_references() {
        assert_eq!(
            ok("&lt;&gt;&amp;&quot;&apos;", HtmlEntities, Decode),
            "<>&\"'"
        );
        assert_eq!(ok("&nbsp;", HtmlEntities, Decode), "\u{a0}");
        assert_eq!(ok("&#20013;", HtmlEntities, Decode), "中");
        assert_eq!(ok("&#x4E2D;", HtmlEntities, Decode), "中");
        assert_eq!(ok("&#X4e2d;", HtmlEntities, Decode), "中");
        assert_eq!(ok("&#128512;", HtmlEntities, Decode), "😀");
        assert_eq!(ok("&#0065;", HtmlEntities, Decode), "A");
    }

    #[test]
    fn html_decode_keeps_unknown_named_entities_and_notices_once() {
        let first = transform("&copy; 2024 &reg;", HtmlEntities, Decode).unwrap();
        assert_eq!(first.text, "&copy; 2024 &reg;");
        assert_eq!(first.notices, vec![UNKNOWN_ENTITY_NOTICE]);
    }

    #[test]
    fn html_decode_keeps_bare_ampersands_without_notice() {
        let bare = transform("AT&T & a&b", HtmlEntities, Decode).unwrap();
        assert_eq!(bare.text, "AT&T & a&b");
        assert!(bare.notices.is_empty());
    }

    #[test]
    fn html_decode_rejects_invalid_numeric_references() {
        assert!(matches!(
            err("&#xD800;", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("&#xDFFF;", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("&#0;", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("&#x110000;", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("&#99999999999999;", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("&#;", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("&#x;", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
        assert!(matches!(
            err("&#65", HtmlEntities, Decode),
            CodecError::Invalid { .. }
        ));
    }

    #[test]
    fn html_decode_reports_the_position_of_a_bad_reference() {
        assert_eq!(position("ab &#xD800;", HtmlEntities, Decode), Some(4));
    }

    #[test]
    fn unicode_encode_uses_surrogate_pairs_for_supplementary_planes() {
        assert_eq!(ok("中😀", UnicodeEscapes, Encode), "\\u4e2d\\ud83d\\ude00");
        assert_eq!(ok("é", UnicodeEscapes, Encode), "\\u00e9");
    }

    #[test]
    fn unicode_encode_escapes_quotes_backslashes_and_controls() {
        assert_eq!(
            ok("a\"b\\c\n\t\u{1}", UnicodeEscapes, Encode),
            "a\\\"b\\\\c\\n\\t\\u0001"
        );
    }

    #[test]
    fn unicode_decode_merges_surrogate_pairs_and_simple_escapes() {
        assert_eq!(ok("\\u4e2d\\ud83d\\ude00", UnicodeEscapes, Decode), "中😀");
        assert_eq!(ok("\\u00E9", UnicodeEscapes, Decode), "é");
        assert_eq!(
            ok("\\n\\t\\\"\\\\\\/\\b\\f\\r", UnicodeEscapes, Decode),
            "\n\t\"\\/\u{8}\u{c}\r"
        );
        assert_eq!(ok("\\u0000", UnicodeEscapes, Decode), "\u{0}");
    }

    #[test]
    fn unicode_decode_rejects_isolated_surrogates() {
        assert_eq!(position("\\ud83d", UnicodeEscapes, Decode), Some(1));
        assert_eq!(position("x\\ude00", UnicodeEscapes, Decode), Some(2));
        assert_eq!(position("\\ud83d\\u0041", UnicodeEscapes, Decode), Some(1));
        assert_eq!(position("\\ud83dX", UnicodeEscapes, Decode), Some(1));
        assert_eq!(position("\\ud83d\\ud83d", UnicodeEscapes, Decode), Some(1));
    }

    #[test]
    fn unicode_decode_rejects_invalid_escapes() {
        assert_eq!(position("\\x41", UnicodeEscapes, Decode), Some(1));
        assert_eq!(position("abc\\", UnicodeEscapes, Decode), Some(4));
        assert_eq!(position("\\u12", UnicodeEscapes, Decode), Some(1));
        assert_eq!(position("\\u12G4", UnicodeEscapes, Decode), Some(1));
    }

    #[test]
    fn hex_encode_is_lowercase_pairs_without_separators() {
        assert_eq!(ok("中", Utf8Hex, Encode), "e4b8ad");
        assert_eq!(ok("A", Utf8Hex, Encode), "41");
        assert_eq!(ok("", Utf8Hex, Encode), "");
    }

    #[test]
    fn hex_decode_tolerates_whitespace_between_bytes_only() {
        assert_eq!(ok("e4 b8\nad", Utf8Hex, Decode), "中");
        assert_eq!(ok("E4B8AD", Utf8Hex, Decode), "中");
        assert_eq!(position("4 1", Utf8Hex, Decode), Some(2));
    }

    #[test]
    fn hex_decode_rejects_odd_length_with_the_dangling_digit_position() {
        assert_eq!(position("abc", Utf8Hex, Decode), Some(3));
        assert_eq!(position("41 2", Utf8Hex, Decode), Some(4));
    }

    #[test]
    fn hex_decode_rejects_non_hex_characters_and_invalid_utf8() {
        assert_eq!(position("zz", Utf8Hex, Decode), Some(1));
        assert_eq!(position("4中", Utf8Hex, Decode), Some(2));
        assert!(matches!(
            err("ff", Utf8Hex, Decode),
            CodecError::Invalid { position: None, .. }
        ));
    }

    #[test]
    fn input_limit_is_exactly_one_mebibyte_in_bytes() {
        let at_limit = "a".repeat(MAX_INPUT_BYTES);
        assert!(transform(&at_limit, UrlComponent, Encode).is_ok());
        let over = "a".repeat(MAX_INPUT_BYTES + 1);
        assert_eq!(
            transform(&over, UrlComponent, Encode),
            Err(CodecError::InputTooLarge)
        );
        assert_eq!(
            transform(&over, Base64, Decode),
            Err(CodecError::InputTooLarge)
        );
    }

    #[test]
    fn input_limit_counts_bytes_not_characters() {
        let at_limit = "中".repeat(349_525) + "a";
        assert_eq!(at_limit.len(), MAX_INPUT_BYTES);
        assert!(transform(&at_limit, HtmlEntities, Encode).is_ok());
        let over = at_limit + "a";
        assert_eq!(
            transform(&over, HtmlEntities, Encode),
            Err(CodecError::InputTooLarge)
        );
    }

    #[test]
    fn notices_are_produced_only_for_unknown_html_entities() {
        assert!(
            transform("a < b", HtmlEntities, Encode)
                .unwrap()
                .notices
                .is_empty()
        );
        assert!(transform("中", Base64, Encode).unwrap().notices.is_empty());
    }
}
