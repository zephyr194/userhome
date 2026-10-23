//! Git-config (INI) line-level lookup, patch and raw check. A line whose value ends
//! in an unescaped backslash continues on the next line, and those continuation
//! lines are never read as keys or headers. Keys whose value continues cannot be
//! patched in place, so they are refused.

use super::patch::{
    Change, Line, Lookup, RawError, Scalar, UNSAFE_LOCATION, comment_start, insert_lines,
    ini_unquote as unquote, join_lines, quotes_balanced, render, split_lines,
};
use crate::app_config::registry::Format;

const APPEND_UNSAFE: &str = "这个段落的最后一行是续行，无法安全添加新键，请使用高级模式。";

pub struct IniKey<'a> {
    pub name: &'a str,
    pub leading: &'a str,
    /// Byte index of the `=`, or `None` for a bare key (git reads it as true).
    pub eq: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    /// Blank, comment, or a continuation of the value above.
    Text,
    Header,
    Key,
    Invalid,
}

/// Returns the lowercased section name and an optional subsection.
pub fn ini_header(text: &str) -> Option<(String, Option<String>)> {
    let trimmed = text.trim();
    let inner = trimmed.strip_prefix('[')?.strip_suffix(']')?;
    let name_len = inner
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '.'))
        .unwrap_or(inner.len());
    let (name, rest) = inner.split_at(name_len);
    if name.is_empty() {
        return None;
    }
    let rest = rest.trim();
    if rest.is_empty() {
        return Some((name.to_ascii_lowercase(), None));
    }
    let sub = rest.strip_prefix('"')?.strip_suffix('"')?;
    if sub.contains('"') || sub.ends_with('\\') {
        return None;
    }
    Some((name.to_ascii_lowercase(), Some(sub.to_owned())))
}

pub fn ini_key(text: &str) -> Option<IniKey<'_>> {
    let leading_len = text.len() - text.trim_start().len();
    let body = &text[leading_len..];
    if body.is_empty() || body.starts_with(['#', ';', '[']) {
        return None;
    }
    let name_len = body
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .unwrap_or(body.len());
    let name = &body[..name_len];
    if !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    let tail = body[name_len..].trim_start();
    if !(tail.is_empty() || tail.starts_with(['=', '#', ';'])) {
        return None;
    }
    let eq = tail
        .starts_with('=')
        .then(|| text.len() - tail.len());
    Some(IniKey {
        name,
        leading: &text[..leading_len],
        eq,
    })
}

/// Byte range of the value after `=`, excluding surrounding spaces and any comment.
fn value_span(text: &str, eq: usize) -> (usize, usize) {
    let after = eq + 1;
    let rest = &text[after..];
    let start = after + (rest.len() - rest.trim_start().len());
    let end = comment_start(&text[start..], &['#', ';'], false)
        .map_or(text.len(), |offset| start + offset);
    let end = start + text[start..end].trim_end().len();
    (start, end)
}

/// True when the line ends in an odd number of backslashes, so the value goes on.
fn continues(text: &str) -> bool {
    text.bytes().rev().take_while(|&byte| byte == b'\\').count() % 2 == 1
}

fn roles(lines: &[Line]) -> Vec<Role> {
    let mut roles = Vec::with_capacity(lines.len());
    let mut continued = false;
    for line in lines {
        if continued {
            continued = continues(&line.text);
            roles.push(Role::Text);
            continue;
        }
        let trimmed = line.text.trim();
        let role = if trimmed.is_empty() || trimmed.starts_with(['#', ';']) {
            Role::Text
        } else if trimmed.starts_with('[') {
            if ini_header(trimmed).is_some() {
                Role::Header
            } else {
                Role::Invalid
            }
        } else if ini_key(&line.text).is_some() {
            Role::Key
        } else {
            Role::Invalid
        };
        continued = role == Role::Key && continues(&line.text);
        roles.push(role);
    }
    roles
}

/// A key's line and its continuation lines, joined without the continuation backslashes.
fn chain_text(lines: &[Line], index: usize) -> String {
    let mut text = String::new();
    let mut current = index;
    loop {
        let line = &lines[current].text;
        match line.strip_suffix('\\') {
            Some(body) if continues(line) && current + 1 < lines.len() => {
                text.push_str(body);
                current += 1;
            }
            _ => {
                text.push_str(line);
                return text;
            }
        }
    }
}

fn section_matches(lines: &[Line], roles: &[Role], section: &str, key: &str) -> Vec<usize> {
    let mut current: Option<(String, Option<String>)> = None;
    let mut hits = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        match roles[index] {
            Role::Header => current = ini_header(&line.text),
            Role::Invalid if line.text.trim_start().starts_with('[') => current = None,
            Role::Key => {
                let Some((name, sub)) = &current else {
                    continue;
                };
                if sub.is_none()
                    && name == section
                    && ini_key(&line.text).is_some_and(|parsed| parsed.name.eq_ignore_ascii_case(key))
                {
                    hits.push(index);
                }
            }
            Role::Text | Role::Invalid => {}
        }
    }
    hits
}

pub fn ini_lookup(text: &str, section: &str, key: &str) -> Lookup {
    let lines = split_lines(text);
    let roles = roles(&lines);
    let Some(&index) = section_matches(&lines, &roles, section, key).last() else {
        return Lookup::Absent;
    };
    let line = &lines[index].text;
    if continues(line) {
        return Lookup::Present(None);
    }
    let Some(parsed) = ini_key(line) else {
        return Lookup::Absent;
    };
    match parsed.eq {
        None => Lookup::Present(Some(Scalar::Text("true".to_owned()))),
        Some(eq) => {
            let (start, end) = value_span(line, eq);
            Lookup::Present(Some(Scalar::Text(unquote(&line[start..end]))))
        }
    }
}

pub fn ini_patch(text: &str, section: &str, key: &str, change: &Change) -> Result<String, String> {
    let mut lines = split_lines(text);
    let roles = roles(&lines);
    let hits = section_matches(&lines, &roles, section, key);
    match change {
        Change::Delete => {
            if hits.iter().any(|&index| continues(&lines[index].text)) {
                return Err(UNSAFE_LOCATION.to_owned());
            }
            for index in hits.into_iter().rev() {
                lines.remove(index);
            }
        }
        Change::Set(value) => {
            let rendered = render(Format::Ini, value);
            match hits.last().copied() {
                Some(index) => {
                    if continues(&lines[index].text) {
                        return Err(UNSAFE_LOCATION.to_owned());
                    }
                    replace_value(&mut lines[index], &rendered);
                }
                None => insert_key(&mut lines, &roles, section, key, &rendered)?,
            }
        }
    }
    Ok(join_lines(&lines))
}

fn replace_value(line: &mut Line, rendered: &str) {
    let Some(parsed) = ini_key(&line.text) else {
        return;
    };
    line.text = match parsed.eq {
        Some(eq) => {
            let (start, end) = value_span(&line.text, eq);
            format!("{}{}{}", &line.text[..start], rendered, &line.text[end..])
        }
        None => format!("{}{} = {}", parsed.leading, parsed.name, rendered),
    };
}

fn insert_key(
    lines: &mut Vec<Line>,
    roles: &[Role],
    section: &str,
    key: &str,
    rendered: &str,
) -> Result<(), String> {
    let header = (0..lines.len())
        .filter(|&index| {
            roles[index] == Role::Header
                && matches!(ini_header(&lines[index].text), Some((name, None)) if name == section)
        })
        .last();
    match header {
        Some(start) => {
            let end = (start + 1..lines.len())
                .find(|&index| roles[index] == Role::Header)
                .unwrap_or(lines.len());
            let mut position = end;
            while position > start + 1 && lines[position - 1].text.trim().is_empty() {
                position -= 1;
            }
            if position > start + 1 && continues(&lines[position - 1].text) {
                return Err(APPEND_UNSAFE.to_owned());
            }
            let indent = (start + 1..position)
                .rev()
                .filter(|&index| roles[index] == Role::Key)
                .find_map(|index| ini_key(&lines[index].text).map(|parsed| parsed.leading.to_owned()))
                .unwrap_or_else(|| "\t".to_owned());
            insert_lines(lines, position, vec![format!("{indent}{key} = {rendered}")]);
        }
        None => {
            if lines.last().is_some_and(|line| continues(&line.text)) {
                return Err(APPEND_UNSAFE.to_owned());
            }
            if lines.last().is_some_and(|line| !line.text.trim().is_empty()) {
                let end = lines.len();
                insert_lines(lines, end, vec![String::new()]);
            }
            let end = lines.len();
            insert_lines(
                lines,
                end,
                vec![format!("[{section}]"), format!("\t{key} = {rendered}")],
            );
        }
    }
    Ok(())
}

pub fn ini_check(text: &str) -> Result<(), RawError> {
    let lines = split_lines(text);
    let roles = roles(&lines);
    let mut in_section = false;
    for (index, line) in lines.iter().enumerate() {
        let number = index + 1;
        match roles[index] {
            Role::Text => {}
            Role::Header => in_section = true,
            Role::Invalid if line.text.trim_start().starts_with('[') => {
                return Err(line_error(number, "段落标题格式不正确，应为 [名称] 或 [名称 \"子名称\"]。"));
            }
            Role::Invalid => return Err(line_error(number, "键的写法不正确，应为 键 = 值。")),
            Role::Key => {
                let Some(parsed) = ini_key(&line.text) else {
                    return Err(line_error(number, "键的写法不正确，应为 键 = 值。"));
                };
                if !in_section {
                    return Err(line_error(number, "键必须写在某个段落（[名称]）下面。"));
                }
                if let Some(eq) = parsed.eq {
                    let balanced = if continues(&line.text) {
                        quotes_balanced(&chain_text(&lines, index))
                    } else {
                        let (start, end) = value_span(&line.text, eq);
                        quotes_balanced(&line.text[start..end])
                    };
                    if !balanced {
                        return Err(line_error(number, "引号没有闭合。"));
                    }
                }
            }
        }
    }
    Ok(())
}

fn line_error(number: usize, message: &'static str) -> RawError {
    RawError {
        line: Some(number),
        message,
    }
}

/// Key/value pairs for secret screening. Values are unquoted, comments removed.
pub fn ini_pairs(text: &str) -> Vec<(String, String)> {
    let lines = split_lines(text);
    let roles = roles(&lines);
    lines
        .iter()
        .enumerate()
        .filter(|(index, _)| roles[*index] == Role::Key)
        .filter_map(|(index, line)| {
            let parsed = ini_key(&line.text)?;
            let value = match parsed.eq {
                Some(eq) if continues(&line.text) => {
                    let joined = chain_text(&lines, index);
                    unquote(joined[eq + 1..].trim())
                }
                Some(eq) => {
                    let (start, end) = value_span(&line.text, eq);
                    unquote(&line.text[start..end])
                }
                None => String::new(),
            };
            Some((parsed.name.to_owned(), value))
        })
        .collect()
}
