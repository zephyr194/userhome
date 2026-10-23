//! TOML (alacritty) line-level lookup, patch and raw check. Multi-line strings and
//! arrays are skipped while scanning, and any key whose written form cannot be
//! replaced in place is refused with `UNSAFE_LOCATION`.

use super::patch::{
    Change, Line, Lookup, RawError, Scalar, UNSAFE_LOCATION, comment_start, insert_lines,
    join_lines, render, split_lines,
};
use crate::app_config::registry::Format;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanState {
    Normal,
    Multiline(&'static str),
    Array(i32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TomlEntry {
    Blank,
    Header {
        segments: Vec<String>,
        array: bool,
    },
    Key {
        table: Vec<String>,
        segments: Vec<String>,
        value_start: usize,
        value_end: usize,
        complex: bool,
    },
    Unrecognized,
}

pub fn scan_toml(lines: &[Line]) -> (Vec<TomlEntry>, ScanState) {
    let mut entries = Vec::with_capacity(lines.len());
    let mut table: Vec<String> = Vec::new();
    let mut state = ScanState::Normal;
    for line in lines {
        let text = line.text.as_str();
        match state {
            ScanState::Multiline(delim) => {
                if text.contains(delim) {
                    state = ScanState::Normal;
                }
                entries.push(TomlEntry::Blank);
                continue;
            }
            ScanState::Array(depth) => {
                let depth = scan_brackets(text, depth);
                state = if depth > 0 {
                    ScanState::Array(depth)
                } else {
                    ScanState::Normal
                };
                entries.push(TomlEntry::Blank);
                continue;
            }
            ScanState::Normal => {}
        }
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            entries.push(TomlEntry::Blank);
            continue;
        }
        if trimmed.starts_with('[') {
            match toml_header(trimmed) {
                Some((segments, array)) => {
                    table = segments.clone();
                    entries.push(TomlEntry::Header { segments, array });
                }
                None => entries.push(TomlEntry::Unrecognized),
            }
            continue;
        }
        entries.push(key_entry(text, &table, &mut state));
    }
    (entries, state)
}

fn key_entry(text: &str, table: &[String], state: &mut ScanState) -> TomlEntry {
    let Some(eq) = text.find('=') else {
        return TomlEntry::Unrecognized;
    };
    let Some(segments) = toml_key_segments(text[..eq].trim()) else {
        return TomlEntry::Unrecognized;
    };
    let rest = &text[eq + 1..];
    let start = eq + 1 + (rest.len() - rest.trim_start().len());
    let value = &text[start..];
    if value.is_empty() {
        return TomlEntry::Unrecognized;
    }
    let (complex, next) = open_state(value);
    *state = next;
    let comment = comment_start(value, &['#'], true).unwrap_or(value.len());
    let end = start + value[..comment].trim_end().len();
    if end == start {
        return TomlEntry::Unrecognized;
    }
    TomlEntry::Key {
        table: table.to_vec(),
        segments,
        value_start: start,
        value_end: end,
        complex,
    }
}

/// Whether a value opens a multi-line form, and the scanner state after its first line.
fn open_state(value: &str) -> (bool, ScanState) {
    for delim in ["\"\"\"", "'''"] {
        if let Some(after) = value.strip_prefix(delim) {
            let state = if after.contains(delim) {
                ScanState::Normal
            } else {
                ScanState::Multiline(delim)
            };
            return (true, state);
        }
    }
    if value.starts_with('[') {
        let depth = scan_brackets(value, 0);
        return if depth > 0 {
            (true, ScanState::Array(depth))
        } else {
            (false, ScanState::Normal)
        };
    }
    (value.starts_with('{'), ScanState::Normal)
}

fn scan_brackets(text: &str, start: i32) -> i32 {
    let mut depth = start;
    let mut in_double = false;
    let mut in_single = false;
    let mut escaped = false;
    for c in text.chars() {
        if in_double {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_double = false;
            }
            continue;
        }
        if in_single {
            if c == '\'' {
                in_single = false;
            }
            continue;
        }
        match c {
            '"' => in_double = true,
            '\'' => in_single = true,
            '#' => break,
            '[' => depth += 1,
            ']' => depth -= 1,
            _ => {}
        }
    }
    depth
}

fn toml_header(trimmed: &str) -> Option<(Vec<String>, bool)> {
    let body_len = comment_start(trimmed, &['#'], true).unwrap_or(trimmed.len());
    let body = trimmed[..body_len].trim_end();
    let (inner, array) = match body.strip_prefix("[[") {
        Some(rest) => (rest.strip_suffix("]]")?, true),
        None => (body.strip_prefix('[')?.strip_suffix(']')?, false),
    };
    Some((toml_key_segments(inner.trim())?, array))
}

/// Parses `a`, `"a"`, or dotted forms such as `font."normal"`.
fn toml_key_segments(text: &str) -> Option<Vec<String>> {
    let mut segments = Vec::new();
    let mut rest = text.trim_start();
    loop {
        let (segment, after) = if let Some(quoted) = rest.strip_prefix('"') {
            let end = quoted.find('"')?;
            (quoted[..end].to_owned(), &quoted[end + 1..])
        } else if let Some(quoted) = rest.strip_prefix('\'') {
            let end = quoted.find('\'')?;
            (quoted[..end].to_owned(), &quoted[end + 1..])
        } else {
            let len = rest
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
                .unwrap_or(rest.len());
            if len == 0 {
                return None;
            }
            (rest[..len].to_owned(), &rest[len..])
        };
        if segment.is_empty() {
            return None;
        }
        segments.push(segment);
        let after = after.trim_start();
        if let Some(next) = after.strip_prefix('.') {
            rest = next.trim_start();
        } else if after.is_empty() {
            return Some(segments);
        } else {
            return None;
        }
    }
}

pub fn toml_scalar(raw: &str) -> Option<Scalar> {
    if raw.starts_with("\"\"\"") || raw.starts_with("'''") || raw.starts_with(['[', '{']) {
        return None;
    }
    if let Some(inner) = raw.strip_prefix('"').and_then(|rest| rest.strip_suffix('"')) {
        return Some(Scalar::Text(toml_unescape(inner)));
    }
    if let Some(inner) = raw.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\'')) {
        return Some(Scalar::Text(inner.to_owned()));
    }
    Some(Scalar::Bare(raw.to_owned()))
}

fn toml_unescape(inner: &str) -> String {
    let mut output = String::new();
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            output.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => output.push('\n'),
            Some('t') => output.push('\t'),
            Some('r') => output.push('\r'),
            Some(other) => output.push(other),
            None => {}
        }
    }
    output
}

fn full_equals(table: &[String], segments: &[String], target: &[&str], key: &str) -> bool {
    let full: Vec<&str> = table.iter().chain(segments).map(String::as_str).collect();
    let mut wanted: Vec<&str> = target.to_vec();
    wanted.push(key);
    full == wanted
}

fn path_is(segments: &[String], target: &[&str]) -> bool {
    segments.len() == target.len() && segments.iter().zip(target).all(|(a, b)| a.as_str() == *b)
}

/// True when the key's full path is an ancestor of, or equal to, the table path.
/// Such a key already defines the table some other way (dotted key or inline table).
fn defines_ancestor(table: &[String], segments: &[String], target: &[&str]) -> bool {
    let full: Vec<&str> = table.iter().chain(segments).map(String::as_str).collect();
    full.len() <= target.len() && target[..full.len()] == full[..]
}

pub fn toml_lookup(text: &str, table: &[&str], key: &str) -> Lookup {
    let lines = split_lines(text);
    let (entries, _) = scan_toml(&lines);
    let found = entries.iter().position(|entry| {
        matches!(entry, TomlEntry::Key { table: key_table, segments, .. }
            if full_equals(key_table, segments, table, key))
    });
    let Some(index) = found else {
        return Lookup::Absent;
    };
    match &entries[index] {
        TomlEntry::Key {
            value_start,
            value_end,
            complex: false,
            ..
        } => Lookup::Present(toml_scalar(&lines[index].text[*value_start..*value_end])),
        _ => Lookup::Present(None),
    }
}

/// True when `path` starts with `prefix`; equal paths count.
fn has_prefix<A: AsRef<str>, B: AsRef<str>>(path: &[A], prefix: &[B]) -> bool {
    path.len() >= prefix.len()
        && path
            .iter()
            .zip(prefix)
            .all(|(segment, wanted)| segment.as_ref() == wanted.as_ref())
}

pub fn toml_patch(text: &str, table: &[&str], key: &str, change: &Change) -> Result<String, String> {
    let mut lines = split_lines(text);
    let (entries, _) = scan_toml(&lines);
    let mut wanted_full: Vec<&str> = table.to_vec();
    wanted_full.push(key);

    let mut direct: Option<usize> = None;
    let mut dotted: Vec<(usize, Vec<String>)> = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        match entry {
            TomlEntry::Key {
                table: key_table,
                segments,
                ..
            } => {
                let full: Vec<String> = key_table.iter().chain(segments).cloned().collect();
                if path_is(key_table, table) && segments.len() == 1 && segments[0] == key {
                    direct = Some(index);
                } else if full_equals(key_table, segments, table, key)
                    || defines_ancestor(key_table, segments, table)
                    || has_prefix(&full, &wanted_full)
                {
                    return Err(UNSAFE_LOCATION.to_owned());
                } else if key_table.len() < table.len() && has_prefix(&full, table) {
                    dotted.push((index, key_table.clone()));
                }
            }
            TomlEntry::Header { segments, array } => {
                if has_prefix(segments, &wanted_full)
                    || (*array && has_prefix(table, segments))
                {
                    return Err(UNSAFE_LOCATION.to_owned());
                }
            }
            TomlEntry::Blank | TomlEntry::Unrecognized => {}
        }
    }

    match change {
        Change::Delete => {
            if let Some(index) = direct {
                if is_complex(&entries[index]) {
                    return Err(UNSAFE_LOCATION.to_owned());
                }
                lines.remove(index);
            }
        }
        Change::Set(value) => {
            let rendered = render(Format::Toml, value);
            match direct {
                Some(index) => {
                    if is_complex(&entries[index]) {
                        return Err(UNSAFE_LOCATION.to_owned());
                    }
                    replace_value(&mut lines[index], &entries[index], &rendered);
                }
                None => insert_key(&mut lines, &entries, table, key, &rendered, &dotted)?,
            }
        }
    }
    Ok(join_lines(&lines))
}

fn is_complex(entry: &TomlEntry) -> bool {
    matches!(entry, TomlEntry::Key { complex: true, .. })
}

fn replace_value(line: &mut Line, entry: &TomlEntry, rendered: &str) {
    if let TomlEntry::Key {
        value_start,
        value_end,
        ..
    } = entry
    {
        line.text = format!(
            "{}{}{}",
            &line.text[..*value_start],
            rendered,
            &line.text[*value_end..]
        );
    }
}

fn insert_key(
    lines: &mut Vec<Line>,
    entries: &[TomlEntry],
    table: &[&str],
    key: &str,
    rendered: &str,
    dotted: &[(usize, Vec<String>)],
) -> Result<(), String> {
    let assignment = format!("{key} = {rendered}");
    if table.is_empty() {
        let first_header = entries
            .iter()
            .position(|entry| matches!(entry, TomlEntry::Header { .. }))
            .unwrap_or(lines.len());
        let position = back_over_blanks(lines, first_header, 0);
        insert_lines(lines, position, vec![assignment]);
        return Ok(());
    }
    let header = entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            matches!(entry, TomlEntry::Header { segments, array: false } if path_is(segments, table))
        })
        .map(|(index, _)| index)
        .last();
    match header {
        Some(start) => {
            if !dotted.is_empty() {
                return Err(UNSAFE_LOCATION.to_owned());
            }
            let end = entries
                .iter()
                .enumerate()
                .skip(start + 1)
                .find(|(_, entry)| matches!(entry, TomlEntry::Header { .. }))
                .map_or(lines.len(), |(index, _)| index);
            let position = back_over_blanks(lines, end, start + 1);
            let indent = (start + 1..position)
                .rev()
                .find(|&index| matches!(entries[index], TomlEntry::Key { .. }))
                .map(|index| leading_whitespace(&lines[index].text).to_owned())
                .unwrap_or_default();
            insert_lines(lines, position, vec![format!("{indent}{assignment}")]);
            Ok(())
        }
        None if !dotted.is_empty() => insert_dotted(lines, entries, table, key, rendered, dotted),
        None => {
            if lines.last().is_some_and(|line| !line.text.trim().is_empty()) {
                let end = lines.len();
                insert_lines(lines, end, vec![String::new()]);
            }
            let end = lines.len();
            insert_lines(
                lines,
                end,
                vec![format!("[{}]", table.join(".")), assignment],
            );
            Ok(())
        }
    }
}

/// Adds the key as a dotted sibling right after the dotted keys that already create the table.
fn insert_dotted(
    lines: &mut Vec<Line>,
    entries: &[TomlEntry],
    table: &[&str],
    key: &str,
    rendered: &str,
    dotted: &[(usize, Vec<String>)],
) -> Result<(), String> {
    let (Some((last, _)), Some((_, parent))) = (dotted.last(), dotted.first()) else {
        return Err(UNSAFE_LOCATION.to_owned());
    };
    let same_parent = dotted.iter().all(|(_, owner)| owner == parent);
    let all_single_line = dotted.iter().all(|(index, _)| !is_complex(&entries[*index]));
    if !same_parent || !all_single_line {
        return Err(UNSAFE_LOCATION.to_owned());
    }
    let relative = table[parent.len()..].join(".");
    let indent = leading_whitespace(&lines[*last].text).to_owned();
    insert_lines(
        lines,
        last + 1,
        vec![format!("{indent}{relative}.{key} = {rendered}")],
    );
    Ok(())
}


fn back_over_blanks(lines: &[Line], mut position: usize, floor: usize) -> usize {
    while position > floor && lines[position - 1].text.trim().is_empty() {
        position -= 1;
    }
    position
}

fn leading_whitespace(text: &str) -> &str {
    &text[..text.len() - text.trim_start().len()]
}

pub fn toml_check(text: &str) -> Result<(), RawError> {
    let lines = split_lines(text);
    let (entries, state) = scan_toml(&lines);
    if let Some(index) = entries
        .iter()
        .position(|entry| *entry == TomlEntry::Unrecognized)
    {
        return Err(RawError {
            line: Some(index + 1),
            message: "这一行格式不正确，应为 [表名]、键 = 值 或注释。",
        });
    }
    if state != ScanState::Normal {
        return Err(RawError {
            line: None,
            message: "多行字符串或数组没有闭合。",
        });
    }
    Ok(())
}

/// Full dotted key paths with their raw values, for secret screening.
pub fn toml_pairs(text: &str) -> Vec<(String, String)> {
    let lines = split_lines(text);
    let (entries, _) = scan_toml(&lines);
    entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| match entry {
            TomlEntry::Key {
                table,
                segments,
                value_start,
                value_end,
                ..
            } => {
                let path = table.iter().chain(segments).cloned().collect::<Vec<_>>().join(".");
                Some((path, lines[index].text[*value_start..*value_end].to_owned()))
            }
            _ => None,
        })
        .collect()
}
