use serde::Serialize;

const MAX_DIFF_LINES: usize = 200;
const MAX_DIFF_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiffLineKind {
    Removed,
    Added,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    kind: DiffLineKind,
    text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDiff {
    lines: Vec<DiffLine>,
    redacted: bool,
    truncated: bool,
}

impl ConfigDiff {
    pub fn changed_line_count(&self) -> usize {
        self.lines.len()
    }
}

/// Minimal unified diff: only the changed block between the common first and
/// last lines, with no context lines. A one-line edit yields one `-` and one `+`.
pub fn unified_text(before: &str, after: &str) -> String {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();
    if old == new {
        return String::new();
    }
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let shared = old.len().min(new.len()) - prefix;
    let suffix = old
        .iter()
        .rev()
        .zip(new.iter().rev())
        .take(shared)
        .take_while(|(a, b)| a == b)
        .count();
    let removed = &old[prefix..old.len() - suffix];
    let added = &new[prefix..new.len() - suffix];
    let mut output = String::from("--- 当前\n+++ 保存后\n");
    output.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        prefix + 1,
        removed.len(),
        prefix + 1,
        added.len()
    ));
    for line in removed {
        output.push_str(&format!("-{line}\n"));
    }
    for line in added {
        output.push_str(&format!("+{line}\n"));
    }
    output
}

pub fn build_diff(before: &str, after: &str, sensitivity: &str) -> ConfigDiff {
    if sensitivity != "STANDARD" {
        return ConfigDiff {
            lines: Vec::new(),
            redacted: true,
            truncated: false,
        };
    }
    if before == after {
        return ConfigDiff {
            lines: Vec::new(),
            redacted: false,
            truncated: false,
        };
    }

    let mut lines = Vec::new();
    let mut bytes: usize = 0;
    let mut truncated = false;
    for (kind, text) in before
        .lines()
        .map(|line| (DiffLineKind::Removed, line))
        .chain(after.lines().map(|line| (DiffLineKind::Added, line)))
    {
        if lines.len() >= MAX_DIFF_LINES || bytes.saturating_add(text.len()) > MAX_DIFF_BYTES {
            truncated = true;
            break;
        }
        bytes += text.len();
        lines.push(DiffLine {
            kind,
            text: text.to_owned(),
        });
    }
    ConfigDiff {
        lines,
        redacted: false,
        truncated,
    }
}
