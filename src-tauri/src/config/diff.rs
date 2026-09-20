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
