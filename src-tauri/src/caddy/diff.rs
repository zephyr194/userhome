//! Line-level difference between the saved and the proposed Caddyfile text.
//!
//! Only the changed middle section goes through the longest-common-subsequence
//! table, and that table is capped, so a large saved file cannot force an
//! unbounded allocation.

use serde::Serialize;

use crate::error::AppError;

const MAX_TABLE_CELLS: usize = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LineChange {
    Unchanged,
    Added,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub change: LineChange,
    pub text: String,
}

pub fn line_diff(saved: &str, proposed: &str) -> Result<Vec<DiffLine>, AppError> {
    let before: Vec<&str> = saved.lines().collect();
    let after: Vec<&str> = proposed.lines().collect();
    let prefix = before
        .iter()
        .zip(&after)
        .take_while(|(left, right)| left == right)
        .count();
    let suffix = before[prefix..]
        .iter()
        .rev()
        .zip(after[prefix..].iter().rev())
        .take_while(|(left, right)| left == right)
        .count();
    let middle_before = &before[prefix..before.len() - suffix];
    let middle_after = &after[prefix..after.len() - suffix];
    if middle_before.len().saturating_mul(middle_after.len()) > MAX_TABLE_CELLS {
        return Err(AppError::validation_failed("差异过大，无法预览。"));
    }

    let mut lines: Vec<DiffLine> = before[..prefix]
        .iter()
        .map(|text| unchanged(text))
        .collect();
    lines.extend(diff_middle(middle_before, middle_after));
    lines.extend(
        before[before.len() - suffix..]
            .iter()
            .map(|text| unchanged(text)),
    );
    Ok(lines)
}

fn unchanged(text: &str) -> DiffLine {
    line(LineChange::Unchanged, text)
}

fn line(change: LineChange, text: &str) -> DiffLine {
    DiffLine {
        change,
        text: text.to_owned(),
    }
}

fn diff_middle(before: &[&str], after: &[&str]) -> Vec<DiffLine> {
    let (count_before, count_after) = (before.len(), after.len());
    let width = count_after + 1;
    // `table[i * width + j]` is the common-subsequence length of `before[i..]` and `after[j..]`.
    let mut table = vec![0u32; (count_before + 1) * width];
    for i in (0..count_before).rev() {
        for j in (0..count_after).rev() {
            table[i * width + j] = if before[i] == after[j] {
                table[(i + 1) * width + j + 1] + 1
            } else {
                table[(i + 1) * width + j].max(table[i * width + j + 1])
            };
        }
    }

    let mut lines = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < count_before && j < count_after {
        if before[i] == after[j] {
            lines.push(line(LineChange::Unchanged, before[i]));
            i += 1;
            j += 1;
        } else if table[(i + 1) * width + j] >= table[i * width + j + 1] {
            lines.push(line(LineChange::Removed, before[i]));
            i += 1;
        } else {
            lines.push(line(LineChange::Added, after[j]));
            j += 1;
        }
    }
    lines.extend(
        before[i..]
            .iter()
            .map(|text| line(LineChange::Removed, text)),
    );
    lines.extend(after[j..].iter().map(|text| line(LineChange::Added, text)));
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change_pairs(lines: &[DiffLine]) -> Vec<(LineChange, &str)> {
        lines
            .iter()
            .map(|line| (line.change, line.text.as_str()))
            .collect()
    }

    #[test]
    fn identical_text_is_all_unchanged() {
        let lines = line_diff("a\nb\nc\n", "a\nb\nc\n").expect("diff");

        assert_eq!(
            change_pairs(&lines),
            vec![
                (LineChange::Unchanged, "a"),
                (LineChange::Unchanged, "b"),
                (LineChange::Unchanged, "c"),
            ]
        );
    }

    #[test]
    fn single_replaced_line_lists_removal_before_addition() {
        let lines = line_diff("a\nb\nc", "a\nx\nc").expect("diff");

        assert_eq!(
            change_pairs(&lines),
            vec![
                (LineChange::Unchanged, "a"),
                (LineChange::Removed, "b"),
                (LineChange::Added, "x"),
                (LineChange::Unchanged, "c"),
            ]
        );
    }

    #[test]
    fn interleaved_changes_keep_common_lines_as_unchanged() {
        let lines = line_diff("a\nb\nc\nd", "b\nx\nd\ny").expect("diff");

        assert_eq!(
            change_pairs(&lines),
            vec![
                (LineChange::Removed, "a"),
                (LineChange::Unchanged, "b"),
                (LineChange::Removed, "c"),
                (LineChange::Added, "x"),
                (LineChange::Unchanged, "d"),
                (LineChange::Added, "y"),
            ]
        );
    }

    #[test]
    fn empty_saved_text_is_entirely_added() {
        let lines = line_diff("", "x\ny\n").expect("diff");

        assert_eq!(
            change_pairs(&lines),
            vec![(LineChange::Added, "x"), (LineChange::Added, "y")]
        );
    }

    #[test]
    fn empty_proposed_text_is_entirely_removed() {
        let lines = line_diff("x\ny", "").expect("diff");

        assert_eq!(
            change_pairs(&lines),
            vec![(LineChange::Removed, "x"), (LineChange::Removed, "y")]
        );
    }

    #[test]
    fn appended_line_is_the_only_addition() {
        let lines = line_diff("a", "a\nb").expect("diff");

        assert_eq!(
            change_pairs(&lines),
            vec![(LineChange::Unchanged, "a"), (LineChange::Added, "b")]
        );
    }

    #[test]
    fn large_identical_text_skips_the_table() {
        let text: String = (0..5000).map(|index| format!("line {index}\n")).collect();

        let lines = line_diff(&text, &text).expect("identical text is never too large");

        assert_eq!(lines.len(), 5000);
        assert!(
            lines
                .iter()
                .all(|line| line.change == LineChange::Unchanged)
        );
    }

    #[test]
    fn oversized_changed_middle_is_refused() {
        let before: String = (0..1100).map(|index| format!("a{index}\n")).collect();
        let after: String = (0..1100).map(|index| format!("b{index}\n")).collect();

        let error = line_diff(&before, &after).expect_err("middle exceeds the table cap");

        assert_eq!(error.code(), crate::error::AppErrorCode::ValidationFailed);
    }
}
