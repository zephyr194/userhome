//! Lossless edits of a Claude Code settings file.
//!
//! The text is scanned with the strict JSON grammar while recording where each
//! object member sits. An edit is one splice of the byte range it changes, so
//! every other byte survives: unknown keys, nested objects, key order and the
//! exact text of untouched numbers. Input that cannot be edited that way
//! (comments, trailing commas, duplicate keys, invalid JSON, over the size
//! limit) is refused; the file is never rewritten to repair it.

use std::collections::HashSet;

use serde_json::{Map, Value};

use super::read::MAX_SETTINGS_BYTES;
use super::registry::{
    CoverageStatus, SettingDefinition, ToolDefinition, ValueType, VerifiedVersions,
};
use super::validate::effective_status;

const MAX_DEPTH: usize = 128;
const MAX_STRING_CHARS: usize = 256;

#[derive(Debug, Clone, PartialEq)]
pub enum EditAction {
    SetValue(Value),
    RestoreDefault,
    SetNull,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EditRequest {
    pub key_path: String,
    pub action: EditAction,
}

/// Why an edit was refused. Carries key names and positions only, never values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditRefusal {
    TooLarge,
    Empty,
    ByteOrderMark,
    NotAnObject,
    Syntax { line: usize, column: usize },
    Comment,
    TrailingComma,
    DuplicateKey(String),
    UnknownKey,
    NotEditable(&'static str),
    InvalidValue(&'static str),
    PathConflict,
    NoChange,
    Verification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditGate {
    Open,
    RangeUnverified,
    VersionUnknown,
    OutOfRange,
}

/// The version gate of SPEC §2: an edit is only allowed when the local CLI
/// version is detected and lies inside the verified range of the definition.
pub fn edit_gate(versions: Option<&VerifiedVersions>, detected: Option<&str>) -> EditGate {
    if versions.is_none() {
        return EditGate::RangeUnverified;
    }
    match effective_status(CoverageStatus::Editable, versions, detected) {
        CoverageStatus::Editable => EditGate::Open,
        CoverageStatus::VersionUnknown => EditGate::VersionUnknown,
        _ => EditGate::OutOfRange,
    }
}

/// Applies one edit to the settings text and returns the new text. The result
/// is re-scanned and must equal the old document with the same change applied.
pub fn apply_edit(
    text: &str,
    tool: &ToolDefinition,
    request: &EditRequest,
) -> Result<String, EditRefusal> {
    validate_request(tool, request)?;
    let change = match &request.action {
        EditAction::SetValue(value) => Change::Put(value.clone()),
        EditAction::SetNull => Change::Put(Value::Null),
        EditAction::RestoreDefault => Change::Remove,
    };
    let root = parse_document(text)?;
    let segments: Vec<&str> = request.key_path.split('.').collect();
    let Some((start, end, replacement)) = plan(text, &root, &segments, &change)? else {
        return Err(EditRefusal::NoChange);
    };
    let edited = format!("{}{}{}", &text[..start], replacement, &text[end..]);

    parse_document(&edited).map_err(|_| EditRefusal::Verification)?;
    let mut expected: Value = serde_json::from_str(text).map_err(|_| EditRefusal::Verification)?;
    apply_change(&mut expected, &segments, &change);
    let actual: Value = serde_json::from_str(&edited).map_err(|_| EditRefusal::Verification)?;
    if actual != expected {
        return Err(EditRefusal::Verification);
    }
    Ok(edited)
}

#[derive(Debug, Clone, PartialEq)]
enum Change {
    Put(Value),
    Remove,
}

fn validate_request<'a>(
    tool: &'a ToolDefinition,
    request: &EditRequest,
) -> Result<&'a SettingDefinition, EditRefusal> {
    let setting = tool
        .settings
        .iter()
        .find(|setting| setting.key_path == request.key_path)
        .ok_or(EditRefusal::UnknownKey)?;
    if setting.secret {
        return Err(EditRefusal::NotEditable("敏感键本批不开放编辑"));
    }
    if !setting.risks.is_empty() {
        return Err(EditRefusal::NotEditable("风险设置本批不开放编辑"));
    }
    match setting.coverage {
        CoverageStatus::Editable => {}
        CoverageStatus::DisplayOnly => {
            return Err(EditRefusal::NotEditable("该键仅展示，未开放编辑"));
        }
        _ => return Err(EditRefusal::NotEditable("该键当前不可编辑")),
    }
    if let EditAction::SetValue(value) = &request.action {
        check_value(setting, value)?;
    }
    Ok(setting)
}

fn check_value(setting: &SettingDefinition, value: &Value) -> Result<(), EditRefusal> {
    match setting.value_type {
        ValueType::Boolean => value
            .is_boolean()
            .then_some(())
            .ok_or(EditRefusal::InvalidValue("应为布尔值（true 或 false）")),
        ValueType::String => match value.as_str() {
            Some(text) if valid_text(text) => Ok(()),
            _ => Err(EditRefusal::InvalidValue(
                "应为非空文本，最长 256 字符，且不含控制字符",
            )),
        },
        ValueType::Enum => match value.as_str() {
            Some(text) if setting.allowed_values.iter().any(|allowed| allowed == text) => Ok(()),
            _ => Err(EditRefusal::InvalidValue("取值不在官方允许列表内")),
        },
        _ => Err(EditRefusal::NotEditable("该类型本批不开放编辑")),
    }
}

fn valid_text(text: &str) -> bool {
    !text.trim().is_empty()
        && text.chars().count() <= MAX_STRING_CHARS
        && !text.chars().any(char::is_control)
}

fn apply_change(root: &mut Value, segments: &[&str], change: &Change) {
    if let Some(object) = root.as_object_mut() {
        apply_in(object, segments, change);
    }
}

fn apply_in(object: &mut Map<String, Value>, segments: &[&str], change: &Change) {
    let Some((first, rest)) = segments.split_first() else {
        return;
    };
    if rest.is_empty() {
        match change {
            Change::Put(value) => {
                object.insert((*first).to_owned(), value.clone());
            }
            Change::Remove => {
                object.remove(*first);
            }
        }
        return;
    }
    match change {
        Change::Put(_) => {
            let entry = object
                .entry((*first).to_owned())
                .or_insert_with(|| Value::Object(Map::new()));
            if let Some(child) = entry.as_object_mut() {
                apply_in(child, rest, change);
            }
        }
        Change::Remove => {
            if let Some(child) = object.get_mut(*first).and_then(Value::as_object_mut) {
                apply_in(child, rest, change);
            }
        }
    }
}

type Splice = (usize, usize, String);

fn plan(
    text: &str,
    root: &Node,
    segments: &[&str],
    change: &Change,
) -> Result<Option<Splice>, EditRefusal> {
    let Some((leaf, parents)) = segments.split_last() else {
        return Err(EditRefusal::UnknownKey);
    };
    let mut object = root;
    for (depth, segment) in parents.iter().enumerate() {
        match find(object.members(), segment) {
            Some(index) => {
                let member = &object.members()[index];
                if !matches!(member.value.kind, Kind::Object(_)) {
                    return match change {
                        Change::Put(_) => Err(EditRefusal::PathConflict),
                        Change::Remove => Ok(None),
                    };
                }
                object = &member.value;
            }
            None => {
                return match change {
                    Change::Remove => Ok(None),
                    Change::Put(value) => {
                        let member = nested_member(&segments[depth..], value)?;
                        Ok(Some(insert_into(text, object, &member)))
                    }
                };
            }
        }
    }
    let members = object.members();
    match (find(members, leaf), change) {
        (Some(index), Change::Put(value)) => Ok(Some((
            members[index].value.start,
            members[index].value.end,
            json_text(value)?,
        ))),
        (Some(index), Change::Remove) => Ok(Some(remove_member(members, index))),
        (None, Change::Put(value)) => {
            let member = format!("{}: {}", json_string(leaf)?, json_text(value)?);
            Ok(Some(insert_into(text, object, &member)))
        }
        (None, Change::Remove) => Ok(None),
    }
}

fn nested_member(segments: &[&str], value: &Value) -> Result<String, EditRefusal> {
    match segments.split_first() {
        Some((first, [])) => Ok(format!("{}: {}", json_string(first)?, json_text(value)?)),
        Some((first, rest)) => Ok(format!(
            "{}: {{{}}}",
            json_string(first)?,
            nested_member(rest, value)?
        )),
        None => Err(EditRefusal::Verification),
    }
}

fn insert_into(text: &str, object: &Node, member: &str) -> Splice {
    match object.members().last() {
        None => (object.start + 1, object.start + 1, member.to_owned()),
        Some(last) => (
            last.value.end,
            last.value.end,
            format!(",{}{}", &text[last.sep_start..last.key_start], member),
        ),
    }
}

fn remove_member(members: &[Member], index: usize) -> Splice {
    let count = members.len();
    let (start, end) = if count == 1 {
        (members[0].sep_start, members[0].value.end)
    } else if index + 1 < count {
        (members[index].key_start, members[index + 1].key_start)
    } else {
        (members[index - 1].value.end, members[index].value.end)
    };
    (start, end, String::new())
}

fn find(members: &[Member], key: &str) -> Option<usize> {
    members.iter().position(|member| member.key == key)
}

fn json_text(value: &Value) -> Result<String, EditRefusal> {
    serde_json::to_string(value).map_err(|_| EditRefusal::Verification)
}

fn json_string(key: &str) -> Result<String, EditRefusal> {
    json_text(&Value::String(key.to_owned()))
}

#[derive(Debug)]
struct Node {
    start: usize,
    end: usize,
    kind: Kind,
}

#[derive(Debug)]
enum Kind {
    Object(Vec<Member>),
    Other,
}

#[derive(Debug)]
struct Member {
    key: String,
    sep_start: usize,
    key_start: usize,
    value: Node,
}

impl Node {
    fn members(&self) -> &[Member] {
        match &self.kind {
            Kind::Object(members) => members,
            Kind::Other => &[],
        }
    }
}

fn parse_document(text: &str) -> Result<Node, EditRefusal> {
    if text.len() > MAX_SETTINGS_BYTES {
        return Err(EditRefusal::TooLarge);
    }
    if text.starts_with('\u{feff}') {
        return Err(EditRefusal::ByteOrderMark);
    }
    let mut scanner = Scanner {
        text,
        bytes: text.as_bytes(),
        pos: 0,
    };
    scanner.skip_ws()?;
    match scanner.peek() {
        None => return Err(EditRefusal::Empty),
        Some(b'{') => {}
        Some(_) => return Err(EditRefusal::NotAnObject),
    }
    let root = scanner.object(1)?;
    scanner.skip_ws()?;
    if scanner.pos != text.len() {
        return Err(scanner.syntax());
    }
    Ok(root)
}

struct Scanner<'a> {
    text: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl Scanner<'_> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn syntax(&self) -> EditRefusal {
        self.syntax_at(self.pos)
    }

    fn syntax_at(&self, position: usize) -> EditRefusal {
        let (line, column) = line_column(self.text, position);
        EditRefusal::Syntax { line, column }
    }

    fn skip_ws(&mut self) -> Result<(), EditRefusal> {
        while let Some(byte) = self.peek() {
            match byte {
                b' ' | b'\t' | b'\r' | b'\n' => self.pos += 1,
                b'/' => return Err(EditRefusal::Comment),
                _ => break,
            }
        }
        Ok(())
    }

    fn value(&mut self, depth: usize) -> Result<Node, EditRefusal> {
        let start = self.pos;
        let kind = match self.peek() {
            Some(b'{') => return self.object(depth + 1),
            Some(b'[') => return self.array(depth + 1),
            Some(b'"') => {
                self.string()?;
                Kind::Other
            }
            Some(b't') => {
                self.literal("true")?;
                Kind::Other
            }
            Some(b'f') => {
                self.literal("false")?;
                Kind::Other
            }
            Some(b'n') => {
                self.literal("null")?;
                Kind::Other
            }
            Some(b'-' | b'0'..=b'9') => {
                self.number()?;
                Kind::Other
            }
            _ => return Err(self.syntax()),
        };
        Ok(Node {
            start,
            end: self.pos,
            kind,
        })
    }

    fn object(&mut self, depth: usize) -> Result<Node, EditRefusal> {
        if depth > MAX_DEPTH {
            return Err(self.syntax());
        }
        let start = self.pos;
        self.pos += 1;
        let mut members = Vec::new();
        let mut keys = HashSet::new();
        let mut sep_start = self.pos;
        self.skip_ws()?;
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(Node {
                start,
                end: self.pos,
                kind: Kind::Object(members),
            });
        }
        loop {
            self.skip_ws()?;
            if self.peek() == Some(b'}') {
                return Err(EditRefusal::TrailingComma);
            }
            let key_start = self.pos;
            let key = self.string()?;
            if !keys.insert(key.clone()) {
                return Err(EditRefusal::DuplicateKey(key));
            }
            self.skip_ws()?;
            if self.peek() != Some(b':') {
                return Err(self.syntax());
            }
            self.pos += 1;
            self.skip_ws()?;
            let value = self.value(depth)?;
            members.push(Member {
                key,
                sep_start,
                key_start,
                value,
            });
            self.skip_ws()?;
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                    sep_start = self.pos;
                }
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(Node {
                        start,
                        end: self.pos,
                        kind: Kind::Object(members),
                    });
                }
                _ => return Err(self.syntax()),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Node, EditRefusal> {
        if depth > MAX_DEPTH {
            return Err(self.syntax());
        }
        let start = self.pos;
        self.pos += 1;
        self.skip_ws()?;
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(Node {
                start,
                end: self.pos,
                kind: Kind::Other,
            });
        }
        loop {
            self.skip_ws()?;
            self.value(depth)?;
            self.skip_ws()?;
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                    self.skip_ws()?;
                    if self.peek() == Some(b']') {
                        return Err(EditRefusal::TrailingComma);
                    }
                }
                Some(b']') => {
                    self.pos += 1;
                    return Ok(Node {
                        start,
                        end: self.pos,
                        kind: Kind::Other,
                    });
                }
                _ => return Err(self.syntax()),
            }
        }
    }

    fn string(&mut self) -> Result<String, EditRefusal> {
        if self.peek() != Some(b'"') {
            return Err(self.syntax());
        }
        let start = self.pos;
        self.pos += 1;
        loop {
            match self.peek() {
                None => return Err(self.syntax()),
                Some(b'"') => {
                    self.pos += 1;
                    break;
                }
                Some(b'\\') => self.pos += 2,
                Some(0x00..=0x1f) => return Err(self.syntax()),
                Some(_) => self.pos += 1,
            }
        }
        serde_json::from_str::<String>(&self.text[start..self.pos])
            .map_err(|_| self.syntax_at(start))
    }

    fn literal(&mut self, word: &str) -> Result<(), EditRefusal> {
        if self.text[self.pos..].starts_with(word) {
            self.pos += word.len();
            Ok(())
        } else {
            Err(self.syntax())
        }
    }

    fn number(&mut self) -> Result<(), EditRefusal> {
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => {
                self.skip_digits();
            }
            _ => return Err(self.syntax()),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if self.skip_digits() == 0 {
                return Err(self.syntax());
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            if self.skip_digits() == 0 {
                return Err(self.syntax());
            }
        }
        Ok(())
    }

    fn skip_digits(&mut self) -> usize {
        let start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        self.pos - start
    }
}

fn line_column(text: &str, position: usize) -> (usize, usize) {
    let before = &text.as_bytes()[..position.min(text.len())];
    let line = before.iter().filter(|&&byte| byte == b'\n').count() + 1;
    let column = before
        .iter()
        .rev()
        .take_while(|&&byte| byte != b'\n')
        .filter(|&&byte| (byte & 0xC0) != 0x80)
        .count()
        + 1;
    (line, column)
}

#[cfg(test)]
#[path = "write_tests.rs"]
mod tests;
