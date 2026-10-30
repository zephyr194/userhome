//! `key = value` line-level readouts, patches and raw checks (Ghostty-style). Only
//! the value of the one line that holds a key changes; comments, blank lines,
//! repeated keys and unrelated lines survive byte for byte. Values are literal:
//! there are no inline comments and no quoting rules, because `#` is part of a value.

use serde::Serialize;

use super::{
    patch::{Line, RawError, join_lines, split_lines},
    read::is_secret_key,
};
use crate::environment::dotenv::value_looks_secret;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValueReadout {
    pub key: String,
    pub value: Option<String>,
    pub sensitive: bool,
    pub repeated: bool,
}

struct Assignment<'a> {
    key: &'a str,
    value: &'a str,
    /// Byte index where the value starts, after the `=` and any spaces that follow it.
    value_start: usize,
}

fn assignment(line: &str) -> Option<Assignment<'_>> {
    let leading = line.len() - line.trim_start().len();
    let body = &line[leading..];
    if body.is_empty() || body.starts_with('#') {
        return None;
    }
    let eq = body.find('=')?;
    let key = body[..eq].trim_end();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return None;
    }
    let after = &body[eq + 1..];
    let spaces = after.len() - after.trim_start().len();
    let value_start = leading + eq + 1 + spaces;
    Some(Assignment {
        key,
        value: line[value_start..].trim_end(),
        value_start,
    })
}

/// One entry per distinct key, in file order. A repeated key has no visual value.
pub fn readouts(text: &str) -> Vec<KeyValueReadout> {
    let mut found: Vec<(String, String, usize)> = Vec::new();
    for (key, value) in assignments(text) {
        match found.iter_mut().find(|entry| entry.0 == key) {
            Some(entry) => entry.2 += 1,
            None => found.push((key, value, 1)),
        }
    }
    found
        .into_iter()
        .map(|(key, value, count)| {
            let sensitive = is_secret_key(&key) || value_looks_secret(&key, &value);
            let repeated = count > 1;
            KeyValueReadout {
                value: (!repeated && !sensitive).then_some(value),
                key,
                sensitive,
                repeated,
            }
        })
        .collect()
}

fn assignments(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(assignment)
        .map(|item| (item.key.to_owned(), item.value.to_owned()))
        .collect()
}

pub fn secret_present(text: &str) -> bool {
    assignments(text)
        .iter()
        .any(|(key, value)| is_secret_key(key) || value_looks_secret(key, value))
}

pub fn check_value(value: &str) -> Result<(), &'static str> {
    if value.is_empty() {
        Err("值不能为空；要移除这一项，请使用删除。")
    } else if value.trim() != value {
        Err("值的前后不能有空格。")
    } else if value.chars().any(char::is_control) {
        Err("值不能包含换行或控制字符。")
    } else {
        Ok(())
    }
}

/// Returns the index of the only line that assigns `key`.
fn only_line(lines: &[Line], key: &str) -> Result<usize, String> {
    let matches: Vec<usize> = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| assignment(&line.text).is_some_and(|item| item.key == key))
        .map(|(index, _)| index)
        .collect();
    match matches.as_slice() {
        [index] => Ok(*index),
        [] => Err("这个键不存在，无法修改。".to_owned()),
        _ => Err("这个键出现了多次，只能在高级模式中修改。".to_owned()),
    }
}

pub fn set_value(text: &str, key: &str, value: &str) -> Result<String, String> {
    let mut lines = split_lines(text);
    let index = only_line(&lines, key)?;
    let current = &lines[index].text;
    let item = assignment(current)
        .ok_or_else(|| "这个键的写法无法安全修改，请使用高级模式。".to_owned())?;
    let next = format!("{}{value}", &current[..item.value_start]);
    lines[index].text = next;
    Ok(join_lines(&lines))
}

pub fn remove_key(text: &str, key: &str) -> Result<String, String> {
    let mut lines = split_lines(text);
    let index = only_line(&lines, key)?;
    if index > 0 && index + 1 == lines.len() {
        lines[index - 1].eol = lines[index].eol;
    }
    lines.remove(index);
    Ok(join_lines(&lines))
}

pub fn check_raw(text: &str) -> Result<(), RawError> {
    for (index, line) in text.lines().enumerate() {
        let body = line.trim();
        if body.is_empty() || body.starts_with('#') {
            continue;
        }
        if assignment(line).is_none() {
            return Err(RawError {
                line: Some(index + 1),
                message: "这一行缺少“键 = 值”的格式。",
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_value_keeps_comments_blank_lines_and_unknown_lines() {
        let text = "# theme\nfont-size = 12\n\nkeybind = a\nkeybind = b\n";
        let next = set_value(text, "font-size", "14").expect("single key");
        assert_eq!(
            next,
            "# theme\nfont-size = 14\n\nkeybind = a\nkeybind = b\n"
        );
    }

    #[test]
    fn set_value_keeps_spacing_around_equals() {
        assert_eq!(
            set_value("title=old\n", "title", "new").expect("single"),
            "title=new\n"
        );
        assert_eq!(
            set_value("title =   old\n", "title", "new").expect("single"),
            "title =   new\n"
        );
    }

    #[test]
    fn set_value_refuses_repeated_or_missing_keys() {
        let repeated = "keybind = a\nkeybind = b\n";
        assert!(set_value(repeated, "keybind", "c").is_err());
        assert!(set_value("theme = dark\n", "font-size", "14").is_err());
    }

    #[test]
    fn value_keeps_hash_as_literal_text() {
        let readouts = readouts("color = #ff00aa\n");
        assert_eq!(readouts[0].value.as_deref(), Some("#ff00aa"));
    }

    #[test]
    fn remove_last_line_without_final_newline_keeps_previous_line_unterminated() {
        assert_eq!(remove_key("a = 1\nb = 2", "b").expect("single"), "a = 1");
        assert_eq!(
            remove_key("a = 1\nb = 2\n", "a").expect("single"),
            "b = 2\n"
        );
    }

    #[test]
    fn readouts_report_order_repeats_and_masks_secrets() {
        let text = "# c\nfont-size = 12\nkeybind = a\nkeybind = b\napi-token = abc\n";
        let readouts = readouts(text);
        let keys: Vec<&str> = readouts.iter().map(|item| item.key.as_str()).collect();
        assert_eq!(keys, ["font-size", "keybind", "api-token"]);
        assert_eq!(readouts[0].value.as_deref(), Some("12"));
        assert!(readouts[1].repeated);
        assert_eq!(readouts[1].value, None);
        assert!(readouts[2].sensitive);
        assert_eq!(readouts[2].value, None);
    }

    #[test]
    fn check_raw_names_the_line_without_equals() {
        let error = check_raw("a = 1\nnot a pair\n").expect_err("invalid line");
        assert_eq!(error.line, Some(2));
        assert!(check_raw("# ok\n\nkey =\n").is_ok());
    }
}
