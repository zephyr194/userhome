use std::collections::HashSet;

use serde::{Deserialize, Serialize};

pub const MAX_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_DEPTH: usize = 256;
pub const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_WARNINGS: usize = 100;
pub const MAX_KEY_CHARS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum JsonFormatMode {
    Indent2,
    Indent4,
    Minify,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonWarning {
    pub key: String,
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormattedJson {
    pub text: String,
    pub warnings: Vec<JsonWarning>,
    pub omitted_warnings: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonError {
    InputTooLarge,
    OutputTooLarge,
    Syntax {
        line: usize,
        column: usize,
        reason: &'static str,
    },
    TooDeep {
        line: usize,
        column: usize,
    },
}

/// Formats strict JSON. Numbers, strings and literals are copied as source
/// text, so only insignificant whitespace changes; duplicate keys are kept and
/// reported as warnings.
pub fn format(text: &str, mode: JsonFormatMode) -> Result<FormattedJson, JsonError> {
    if text.len() > MAX_INPUT_BYTES {
        return Err(JsonError::InputTooLarge);
    }
    let mut parser = Parser::new(text);
    let root = parser.parse_document()?;
    let mut emitter = Emitter {
        out: String::new(),
        indent: match mode {
            JsonFormatMode::Indent2 => Some(2),
            JsonFormatMode::Indent4 => Some(4),
            JsonFormatMode::Minify => None,
        },
    };
    emitter.write(&root, 0)?;
    if emitter.out.len() > MAX_OUTPUT_BYTES {
        return Err(JsonError::OutputTooLarge);
    }
    Ok(FormattedJson {
        text: emitter.out,
        warnings: parser.warnings,
        omitted_warnings: parser.omitted_warnings,
    })
}

enum Node<'a> {
    Object(Vec<Member<'a>>),
    Array(Vec<Node<'a>>),
    Scalar(&'a str),
}

struct Member<'a> {
    key: &'a str,
    value: Node<'a>,
}

struct Parser<'a> {
    src: &'a str,
    pos: usize,
    located_pos: usize,
    located_line: usize,
    located_column: usize,
    warnings: Vec<JsonWarning>,
    omitted_warnings: usize,
}

impl<'a> Parser<'a> {
    fn new(src: &'a str) -> Self {
        Self {
            src,
            pos: 0,
            located_pos: 0,
            located_line: 1,
            located_column: 1,
            warnings: Vec::new(),
            omitted_warnings: 0,
        }
    }

    fn parse_document(&mut self) -> Result<Node<'a>, JsonError> {
        if self.src.starts_with('\u{feff}') {
            return Err(self.error(0, "输入以 UTF-8 BOM 开头，请先去除"));
        }
        self.skip_whitespace();
        if self.peek().is_none() {
            return Err(self.error(self.pos, "输入为空"));
        }
        let root = self.parse_value(0)?;
        self.skip_whitespace();
        if self.pos < self.src.len() {
            return Err(self.error(self.pos, "JSON 值之后存在多余字符"));
        }
        Ok(root)
    }

    fn parse_value(&mut self, depth: usize) -> Result<Node<'a>, JsonError> {
        match self.peek() {
            Some(b'{') => self.parse_object(depth + 1),
            Some(b'[') => self.parse_array(depth + 1),
            Some(b'"') => {
                let start = self.pos;
                self.scan_string(None)?;
                Ok(Node::Scalar(self.slice(start, self.pos)))
            }
            Some(b'-' | b'0'..=b'9') => self.parse_number(),
            Some(b't') => self.parse_literal("true"),
            Some(b'f') => self.parse_literal("false"),
            Some(b'n') => self.parse_literal("null"),
            Some(_) => Err(self.error(self.pos, "此处应为 JSON 值")),
            None => Err(self.error(self.pos, "输入意外结束")),
        }
    }

    fn parse_object(&mut self, depth: usize) -> Result<Node<'a>, JsonError> {
        if depth > MAX_DEPTH {
            return Err(self.too_deep(self.pos));
        }
        self.pos += 1;
        let mut members = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        self.skip_whitespace();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Node::Object(members));
        }
        loop {
            self.skip_whitespace();
            let key_start = self.pos;
            let mut decoded = String::new();
            match self.peek() {
                Some(b'"') => self.scan_string(Some(&mut decoded))?,
                Some(_) => return Err(self.error(self.pos, "此处应为字符串键")),
                None => return Err(self.error(self.pos, "输入意外结束")),
            }
            let raw_key = self.slice(key_start, self.pos);
            if seen.contains(&decoded) {
                self.record_warning(key_start, &decoded);
            } else {
                seen.insert(decoded);
            }
            self.skip_whitespace();
            if self.peek() != Some(b':') {
                return Err(self.error(self.pos, "键后应为冒号"));
            }
            self.pos += 1;
            self.skip_whitespace();
            let value = self.parse_value(depth)?;
            members.push(Member {
                key: raw_key,
                value,
            });
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Node::Object(members));
                }
                Some(_) => return Err(self.error(self.pos, "此处应为逗号或 }")),
                None => return Err(self.error(self.pos, "输入意外结束")),
            }
        }
    }

    fn parse_array(&mut self, depth: usize) -> Result<Node<'a>, JsonError> {
        if depth > MAX_DEPTH {
            return Err(self.too_deep(self.pos));
        }
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_whitespace();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Node::Array(items));
        }
        loop {
            self.skip_whitespace();
            items.push(self.parse_value(depth)?);
            self.skip_whitespace();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Node::Array(items));
                }
                Some(_) => return Err(self.error(self.pos, "此处应为逗号或 ]")),
                None => return Err(self.error(self.pos, "输入意外结束")),
            }
        }
    }

    fn parse_literal(&mut self, word: &'static str) -> Result<Node<'a>, JsonError> {
        let start = self.pos;
        for (offset, expected) in word.bytes().enumerate() {
            if self.src.as_bytes().get(start + offset) != Some(&expected) {
                return Err(self.error(start + offset, "非法字面量"));
            }
        }
        self.pos += word.len();
        Ok(Node::Scalar(self.slice(start, self.pos)))
    }

    fn parse_number(&mut self) -> Result<Node<'a>, JsonError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
            if !self.peek_digit() {
                return Err(self.error(self.pos, "负号后应为数字"));
            }
        }
        if self.peek() == Some(b'0') {
            self.pos += 1;
            if self.peek_digit() {
                return Err(self.error(self.pos, "前导零不允许"));
            }
        } else {
            self.skip_digits();
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !self.peek_digit() {
                return Err(self.error(self.pos, "小数点后应为数字"));
            }
            self.skip_digits();
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if !self.peek_digit() {
                return Err(self.error(self.pos, "指数部分应为数字"));
            }
            self.skip_digits();
        }
        Ok(Node::Scalar(self.slice(start, self.pos)))
    }

    /// Advances past one string literal. Decoded text goes to `out` when the
    /// caller needs it (object keys); values are only validated.
    fn scan_string(&mut self, mut out: Option<&mut String>) -> Result<(), JsonError> {
        self.pos += 1;
        loop {
            let Some(byte) = self.peek() else {
                return Err(self.error(self.pos, "字符串未闭合"));
            };
            match byte {
                b'"' => {
                    self.pos += 1;
                    return Ok(());
                }
                b'\\' => {
                    let escape_start = self.pos;
                    self.pos += 1;
                    let ch = match self.peek() {
                        None => return Err(self.error(self.pos, "字符串未闭合")),
                        Some(b'u') => {
                            self.pos += 1;
                            self.read_unicode_escape(escape_start)?
                        }
                        Some(simple) => match simple_escape(simple) {
                            Some(ch) => {
                                self.pos += 1;
                                ch
                            }
                            None => return Err(self.error(self.pos, "非法转义序列")),
                        },
                    };
                    if let Some(buf) = out.as_mut() {
                        buf.push(ch);
                    }
                }
                0x00..=0x1f => {
                    return Err(self.error(self.pos, "字符串中的控制字符必须转义"));
                }
                _ => {
                    let Some(ch) = self.src[self.pos..].chars().next() else {
                        return Err(self.error(self.pos, "字符串未闭合"));
                    };
                    self.pos += ch.len_utf8();
                    if let Some(buf) = out.as_mut() {
                        buf.push(ch);
                    }
                }
            }
        }
    }

    fn read_unicode_escape(&mut self, escape_start: usize) -> Result<char, JsonError> {
        let unit = self.read_hex4()?;
        let code = match unit {
            0xD800..=0xDBFF => {
                let followed_by_escape = self
                    .src
                    .as_bytes()
                    .get(self.pos..)
                    .is_some_and(|rest| rest.starts_with(b"\\u"));
                if !followed_by_escape {
                    return Err(self.error(escape_start, "代理项不成对"));
                }
                self.pos += 2;
                let low = self.read_hex4()?;
                if !(0xDC00..=0xDFFF).contains(&low) {
                    return Err(self.error(escape_start, "代理项不成对"));
                }
                0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
            }
            0xDC00..=0xDFFF => return Err(self.error(escape_start, "代理项不成对")),
            _ => unit,
        };
        let Some(ch) = char::from_u32(code) else {
            return Err(self.error(escape_start, "代理项不成对"));
        };
        Ok(ch)
    }

    fn read_hex4(&mut self) -> Result<u32, JsonError> {
        let mut value = 0;
        for _ in 0..4 {
            let Some(byte) = self.peek() else {
                return Err(self.error(self.pos, "字符串未闭合"));
            };
            let digit = match byte {
                b'0'..=b'9' => byte - b'0',
                b'a'..=b'f' => byte - b'a' + 10,
                b'A'..=b'F' => byte - b'A' + 10,
                _ => return Err(self.error(self.pos, "\\u 后应为 4 位十六进制数字")),
            };
            value = value * 16 + u32::from(digit);
            self.pos += 1;
        }
        Ok(value)
    }

    fn record_warning(&mut self, at: usize, key: &str) {
        if self.warnings.len() >= MAX_WARNINGS {
            self.omitted_warnings += 1;
            return;
        }
        let (line, column) = self.locate(at);
        self.warnings.push(JsonWarning {
            key: truncate_key(key),
            line,
            column,
        });
    }

    fn skip_whitespace(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn skip_digits(&mut self) {
        while self.peek_digit() {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.src.as_bytes().get(self.pos).copied()
    }

    fn peek_digit(&self) -> bool {
        self.peek().is_some_and(|byte| byte.is_ascii_digit())
    }

    fn slice(&self, start: usize, end: usize) -> &'a str {
        let src: &'a str = self.src;
        &src[start..end]
    }

    fn error(&mut self, at: usize, reason: &'static str) -> JsonError {
        let (line, column) = self.locate(at);
        JsonError::Syntax {
            line,
            column,
            reason,
        }
    }

    fn too_deep(&mut self, at: usize) -> JsonError {
        let (line, column) = self.locate(at);
        JsonError::TooDeep { line, column }
    }

    /// 1-based line and character column of byte offset `at`. Positions are
    /// requested in document order, so the scan resumes from the last one.
    fn locate(&mut self, at: usize) -> (usize, usize) {
        if at < self.located_pos {
            self.located_pos = 0;
            self.located_line = 1;
            self.located_column = 1;
        }
        let src = self.src;
        for ch in src[self.located_pos..at].chars() {
            if ch == '\n' {
                self.located_line += 1;
                self.located_column = 1;
            } else {
                self.located_column += 1;
            }
        }
        self.located_pos = at;
        (self.located_line, self.located_column)
    }
}

fn simple_escape(byte: u8) -> Option<char> {
    Some(match byte {
        b'"' => '"',
        b'\\' => '\\',
        b'/' => '/',
        b'b' => '\u{8}',
        b'f' => '\u{c}',
        b'n' => '\n',
        b'r' => '\r',
        b't' => '\t',
        _ => return None,
    })
}

fn truncate_key(key: &str) -> String {
    if key.chars().count() <= MAX_KEY_CHARS {
        return key.to_owned();
    }
    let mut truncated: String = key.chars().take(MAX_KEY_CHARS).collect();
    truncated.push('…');
    truncated
}

struct Emitter {
    out: String,
    indent: Option<usize>,
}

impl Emitter {
    fn write(&mut self, node: &Node<'_>, level: usize) -> Result<(), JsonError> {
        if self.out.len() > MAX_OUTPUT_BYTES {
            return Err(JsonError::OutputTooLarge);
        }
        match node {
            Node::Scalar(text) => self.out.push_str(text),
            Node::Array(items) => {
                self.out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        self.out.push(',');
                    }
                    self.newline(level + 1);
                    self.write(item, level + 1)?;
                }
                if !items.is_empty() {
                    self.newline(level);
                }
                self.out.push(']');
            }
            Node::Object(members) => {
                self.out.push('{');
                for (index, member) in members.iter().enumerate() {
                    if index > 0 {
                        self.out.push(',');
                    }
                    self.newline(level + 1);
                    self.out.push_str(member.key);
                    self.out.push(':');
                    if self.indent.is_some() {
                        self.out.push(' ');
                    }
                    self.write(&member.value, level + 1)?;
                }
                if !members.is_empty() {
                    self.newline(level);
                }
                self.out.push('}');
            }
        }
        Ok(())
    }

    fn newline(&mut self, level: usize) {
        if let Some(width) = self.indent {
            self.out.push('\n');
            for _ in 0..width * level {
                self.out.push(' ');
            }
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
