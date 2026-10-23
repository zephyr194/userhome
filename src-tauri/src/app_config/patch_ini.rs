//! Git-config (INI) line-level lookup, patch and raw check.

use super::patch::{
    Change, Line, Lookup, RawError, Scalar, comment_start, insert_lines, ini_unquote as unquote,
    join_lines, quotes_balanced, render, split_lines,
};
use crate::app_config::registry::Format;

pub struct IniKey<'a> {
    pub name: &'a str,
    pub leading: &'a str,
    /// Byte index of the `=`, or `None` for a bare key (git reads it as true).
    pub eq: Option<usize>,
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

fn section_matches(lines: &[Line], section: &str, key: &str) -> Vec<usize> {
    let mut current: Option<(String, Option<String>)> = None;
    let mut hits = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if let Some(header) = ini_header(&line.text) {
            current = Some(header);
            continue;
        }
        let Some((name, sub)) = &current else {
            continue;
        };
        if sub.is_some() || name != section {
            continue;
        }
        if ini_key(&line.text).is_some_and(|parsed| parsed.name.eq_ignore_ascii_case(key)) {
            hits.push(index);
        }
    }
    hits
}

pub fn ini_lookup(text: &str, section: &str, key: &str) -> Lookup {
    let lines = split_lines(text);
    let Some(&index) = section_matches(&lines, section, key).last() else {
        return Lookup::Absent;
    };
    let line = &lines[index].text;
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

pub fn ini_patch(text: &str, section: &str, key: &str, change: &Change) -> String {
    let mut lines = split_lines(text);
    let hits = section_matches(&lines, section, key);
    match change {
        Change::Delete => {
            for index in hits.into_iter().rev() {
                lines.remove(index);
            }
        }
        Change::Set(value) => {
            let rendered = render(Format::Ini, value);
            match hits.last().copied() {
                Some(index) => replace_value(&mut lines[index], &rendered),
                None => insert_key(&mut lines, section, key, &rendered),
            }
        }
    }
    join_lines(&lines)
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

fn insert_key(lines: &mut Vec<Line>, section: &str, key: &str, rendered: &str) {
    let header = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            matches!(ini_header(&line.text), Some((name, None)) if name == section)
        })
        .map(|(index, _)| index)
        .last();
    match header {
        Some(start) => {
            let end = lines
                .iter()
                .enumerate()
                .skip(start + 1)
                .find(|(_, line)| line.text.trim_start().starts_with('['))
                .map_or(lines.len(), |(index, _)| index);
            let mut position = end;
            while position > start + 1 && lines[position - 1].text.trim().is_empty() {
                position -= 1;
            }
            let indent = lines[start + 1..position]
                .iter()
                .rev()
                .find_map(|line| ini_key(&line.text).map(|parsed| parsed.leading.to_owned()))
                .unwrap_or_else(|| "\t".to_owned());
            insert_lines(lines, position, vec![format!("{indent}{key} = {rendered}")]);
        }
        None => {
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
}

pub fn ini_check(text: &str) -> Result<(), RawError> {
    let mut in_section = false;
    for (index, line) in split_lines(text).iter().enumerate() {
        let number = index + 1;
        let trimmed = line.text.trim();
        if trimmed.is_empty() || trimmed.starts_with(['#', ';']) {
            continue;
        }
        if trimmed.starts_with('[') {
            if ini_header(trimmed).is_none() {
                return Err(line_error(number, "段落标题格式不正确，应为 [名称] 或 [名称 \"子名称\"]。"));
            }
            in_section = true;
            continue;
        }
        let Some(parsed) = ini_key(&line.text) else {
            return Err(line_error(number, "键的写法不正确，应为 键 = 值。"));
        };
        if !in_section {
            return Err(line_error(number, "键必须写在某个段落（[名称]）下面。"));
        }
        if let Some(eq) = parsed.eq {
            let (start, end) = value_span(&line.text, eq);
            if !quotes_balanced(&line.text[start..end]) {
                return Err(line_error(number, "引号没有闭合。"));
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
    split_lines(text)
        .iter()
        .filter_map(|line| {
            let parsed = ini_key(&line.text)?;
            let value = match parsed.eq {
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
