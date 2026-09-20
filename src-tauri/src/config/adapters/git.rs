use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::AppError;

use super::AdapterView;
use crate::config::redaction::REDACTED_VALUE;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GitFields {
    user_name: Option<String>,
    user_email: Option<String>,
    default_branch: Option<String>,
    alias_checkout: Option<String>,
    alias_branch: Option<String>,
    pull_rebase: Option<bool>,
    fetch_prune: Option<bool>,
}

pub fn inspect(content: &str) -> Result<AdapterView, AppError> {
    let entries = parse_entries(content)?;
    let protected = protected_keys(&entries);
    let redacted = redact_protected(content, &protected);
    Ok(AdapterView {
        content: Some(redacted),
        content_redacted: !protected.is_empty(),
        structured: Some(json!({
            "userName": entry(&entries, "user", "name"),
            "userEmail": entry(&entries, "user", "email"),
            "defaultBranch": entry(&entries, "init", "defaultbranch"),
            "aliasCheckout": entry(&entries, "alias", "co"),
            "aliasBranch": entry(&entries, "alias", "br"),
            "pullRebase": parse_bool(entry(&entries, "pull", "rebase")),
            "fetchPrune": parse_bool(entry(&entries, "fetch", "prune"))
        })),
    })
}

pub fn prepare_raw(current: &str, proposed: &str) -> Result<String, AppError> {
    let current_entries = parse_entries(current)?;
    let proposed_entries = parse_entries(proposed)?;
    let protected = protected_keys(&current_entries);
    for key in protected_keys(&proposed_entries).union(&protected) {
        let before = current_entries.get(key);
        let after = proposed_entries.get(key);
        match (before, after) {
            (Some(before), Some(after)) if after == REDACTED_VALUE || after == before => {}
            _ => {
                return Err(AppError::validation_failed(
                    "Credential settings cannot be changed in the raw editor.",
                ));
            }
        }
    }
    restore_protected(proposed, &current_entries, &protected)
}

pub fn prepare_structured(current: &str, fields: Value) -> Result<String, AppError> {
    let fields: GitFields = serde_json::from_value(fields)
        .map_err(|_| AppError::invalid_input("Git settings are invalid."))?;
    let mut content = current.to_owned();
    update(&mut content, "user", "name", fields.user_name)?;
    update(&mut content, "user", "email", fields.user_email)?;
    update(&mut content, "init", "defaultBranch", fields.default_branch)?;
    update(&mut content, "alias", "co", fields.alias_checkout)?;
    update(&mut content, "alias", "br", fields.alias_branch)?;
    update_bool(&mut content, "pull", "rebase", fields.pull_rebase)?;
    update_bool(&mut content, "fetch", "prune", fields.fetch_prune)?;
    Ok(content)
}

fn parse_entries(content: &str) -> Result<BTreeMap<(String, String), String>, AppError> {
    let mut section = String::new();
    let mut entries = BTreeMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(['#', ';']) {
            continue;
        }
        if trimmed.starts_with('[') {
            if !trimmed.ends_with(']') {
                return Err(AppError::validation_failed(
                    "Git configuration has an invalid section header.",
                ));
            }
            section = trimmed[1..trimmed.len() - 1]
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            if section.is_empty() {
                return Err(AppError::validation_failed(
                    "Git configuration has an empty section.",
                ));
            }
            continue;
        }
        let (key, value) = trimmed.split_once('=').ok_or_else(|| {
            AppError::validation_failed("Git configuration entry must use key = value syntax.")
        })?;
        if section.is_empty() || key.trim().is_empty() {
            return Err(AppError::validation_failed(
                "Git configuration entry is outside a section.",
            ));
        }
        entries.insert(
            (section.clone(), key.trim().to_ascii_lowercase()),
            value.trim().to_owned(),
        );
    }
    Ok(entries)
}

fn protected_keys(entries: &BTreeMap<(String, String), String>) -> BTreeSet<(String, String)> {
    entries
        .keys()
        .filter(|(section, key)| {
            section == "credential"
                || section.starts_with("credential ")
                || key.contains("password")
                || key.contains("token")
                || key == "helper"
        })
        .cloned()
        .collect()
}

fn redact_protected(content: &str, protected: &BTreeSet<(String, String)>) -> String {
    rewrite_values(content, protected, |_| REDACTED_VALUE.to_owned())
        .unwrap_or_else(|_| content.to_owned())
}

fn restore_protected(
    content: &str,
    current: &BTreeMap<(String, String), String>,
    protected: &BTreeSet<(String, String)>,
) -> Result<String, AppError> {
    rewrite_values(content, protected, |key| {
        current.get(key).cloned().unwrap_or_default()
    })
}

fn rewrite_values(
    content: &str,
    selected: &BTreeSet<(String, String)>,
    replacement: impl Fn(&(String, String)) -> String,
) -> Result<String, AppError> {
    let mut section = String::new();
    let mut output = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            section = trimmed[1..trimmed.len() - 1]
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            output.push(line.to_owned());
            continue;
        }
        let Some((key, _)) = trimmed.split_once('=') else {
            output.push(line.to_owned());
            continue;
        };
        let identity = (section.clone(), key.trim().to_ascii_lowercase());
        if selected.contains(&identity) {
            let equals = line.find('=').ok_or_else(AppError::internal)?;
            output.push(format!("{}= {}", &line[..equals], replacement(&identity)));
        } else {
            output.push(line.to_owned());
        }
    }
    let mut result = output.join("\n");
    if content.ends_with('\n') {
        result.push('\n');
    }
    Ok(result)
}

fn entry<'a>(
    entries: &'a BTreeMap<(String, String), String>,
    section: &str,
    key: &str,
) -> Option<&'a str> {
    entries
        .get(&(section.to_owned(), key.to_owned()))
        .map(String::as_str)
}

fn parse_bool(value: Option<&str>) -> Option<bool> {
    value.and_then(|value| match value.to_ascii_lowercase().as_str() {
        "true" | "yes" | "on" | "1" => Some(true),
        "false" | "no" | "off" | "0" => Some(false),
        _ => None,
    })
}

fn update(
    content: &mut String,
    section: &str,
    key: &str,
    value: Option<String>,
) -> Result<(), AppError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.len() > 512 || value.contains(['\n', '\r', '\0']) {
        return Err(AppError::validation_failed("Git setting value is invalid."));
    }
    *content = update_entry(
        content,
        section,
        key,
        (!value.is_empty()).then_some(value.as_str()),
    );
    Ok(())
}

fn update_bool(
    content: &mut String,
    section: &str,
    key: &str,
    value: Option<bool>,
) -> Result<(), AppError> {
    if let Some(value) = value {
        *content = update_entry(
            content,
            section,
            key,
            Some(if value { "true" } else { "false" }),
        );
    }
    Ok(())
}

fn update_entry(
    content: &str,
    target_section: &str,
    target_key: &str,
    value: Option<&str>,
) -> String {
    let mut lines = content.lines().map(str::to_owned).collect::<Vec<_>>();
    let mut section = String::new();
    let mut section_start = None;
    let mut section_end = lines.len();
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if section_start.is_some() && section_end == lines.len() {
                section_end = index;
            }
            section = trimmed[1..trimmed.len() - 1]
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            if section == target_section.to_ascii_lowercase() {
                section_start = Some(index);
            }
            continue;
        }
        if section == target_section.to_ascii_lowercase()
            && let Some((key, _)) = trimmed.split_once('=')
            && key.trim().eq_ignore_ascii_case(target_key)
        {
            let indent = line
                .chars()
                .take_while(|character| character.is_whitespace())
                .collect::<String>();
            if let Some(value) = value {
                lines[index] = format!("{indent}{target_key} = {value}");
            } else {
                lines.remove(index);
            }
            return finish_lines(lines, content.ends_with('\n'));
        }
    }
    let Some(value) = value else {
        return content.to_owned();
    };
    if let Some(start) = section_start {
        let insert_at = if section_end == lines.len() {
            lines.len()
        } else {
            section_end
        };
        lines.insert(
            insert_at.max(start + 1),
            format!("\t{target_key} = {value}"),
        );
    } else {
        if !lines.is_empty() && !lines.last().is_some_and(String::is_empty) {
            lines.push(String::new());
        }
        lines.push(format!("[{target_section}]"));
        lines.push(format!("\t{target_key} = {value}"));
    }
    finish_lines(lines, content.ends_with('\n'))
}

fn finish_lines(lines: Vec<String>, trailing_newline: bool) -> String {
    let mut result = lines.join("\n");
    if trailing_newline || !result.is_empty() {
        result.push('\n');
    }
    result
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn structured_updates_preserve_comments_includes_and_credentials() {
        let current = "# keep\n[include]\n\tpath = ~/.config/git/work\n[user]\n\tname = Before\n[credential]\n\thelper = osxkeychain\n";
        let updated = prepare_structured(
            current,
            json!({"userName":"After","userEmail":"a@example.test","defaultBranch":"main","aliasCheckout":null,"aliasBranch":null,"pullRebase":null,"fetchPrune":null}),
        )
        .expect("update");
        assert!(updated.contains("# keep"));
        assert!(updated.contains("path = ~/.config/git/work"));
        assert!(updated.contains("helper = osxkeychain"));
        assert!(updated.contains("name = After"));
        assert!(updated.contains("email = a@example.test"));
    }

    #[test]
    fn raw_edit_cannot_change_credential_settings() {
        let current = "[credential]\n\thelper = osxkeychain\n";
        let proposed = "[credential]\n\thelper = malicious\n";
        assert!(prepare_raw(current, proposed).is_err());
        let view = inspect(current).expect("inspect");
        assert!(
            !serde_json::to_string(&view)
                .expect("serialize")
                .contains("osxkeychain")
        );
    }

    #[test]
    fn clearing_a_supported_field_removes_only_that_entry() {
        let current = "[user]\n\tname = Example\n\temail = keep@example.test\n";
        let updated = prepare_structured(
            current,
            json!({"userName":"","userEmail":"keep@example.test","defaultBranch":null,"aliasCheckout":null,"aliasBranch":null,"pullRebase":null,"fetchPrune":null}),
        )
        .expect("clear");
        assert!(!updated.contains("name ="));
        assert!(updated.contains("email = keep@example.test"));
    }
}
