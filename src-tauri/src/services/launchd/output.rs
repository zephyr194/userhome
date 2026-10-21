//! Parsers for launchctl output.
//!
//! Formats follow `man launchctl` (`list`: three columns PID, last exit status,
//! label; a negative status is the negated signal) and the usual shape of a
//! `print <domain>` dump (a `services = { ... }` block with the same three
//! columns). The `print` output is documented as not being API; none of these
//! parsers has been checked against real launchd output. Every unparsable line
//! is counted, and output with no recognizable job is `Unparsed`, never an
//! empty success.

use serde::Serialize;

/// Why a job last stopped, as launchctl reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LastExit {
    Code(i32),
    Signal(i32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedJob {
    pub label: String,
    pub pid: Option<u32>,
    pub last_exit: Option<LastExit>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedJobs {
    pub jobs: Vec<LoadedJob>,
    pub skipped_lines: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputError {
    Unparsed,
}

fn split_token(text: &str) -> Option<(&str, &str)> {
    let text = text.trim_start();
    let end = text.find(char::is_whitespace)?;
    Some((&text[..end], text[end..].trim_start()))
}

fn is_header(line: &str) -> bool {
    line.split_whitespace().eq(["PID", "Status", "Label"])
}

fn parse_job(line: &str) -> Option<LoadedJob> {
    let (pid, rest) = split_token(line)?;
    let (status, label) = split_token(rest)?;
    let label = label.trim_end();
    if label.is_empty() {
        return None;
    }
    let pid = match pid {
        "-" => None,
        digits if digits.bytes().all(|byte| byte.is_ascii_digit()) => Some(digits.parse().ok()?),
        _ => return None,
    };
    let last_exit = match status {
        "-" => None,
        text => {
            let value: i32 = text.parse().ok()?;
            Some(if value < 0 {
                LastExit::Signal(value.checked_neg()?)
            } else {
                LastExit::Code(value)
            })
        }
    };
    Some(LoadedJob {
        label: label.to_owned(),
        pid,
        last_exit,
    })
}

fn collect<'a>(lines: impl Iterator<Item = &'a str>) -> ParsedJobs {
    let mut jobs = Vec::new();
    let mut skipped_lines = 0;
    for line in lines {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() || is_header(line) {
            continue;
        }
        match parse_job(line) {
            Some(job) => jobs.push(job),
            None => skipped_lines += 1,
        }
    }
    ParsedJobs {
        jobs,
        skipped_lines,
    }
}

/// `launchctl list` with no arguments.
pub fn parse_launchctl_list(output: &str) -> Result<ParsedJobs, OutputError> {
    let has_header = output.lines().any(is_header);
    let parsed = collect(output.lines());
    if parsed.jobs.is_empty() && !has_header {
        return Err(OutputError::Unparsed);
    }
    Ok(parsed)
}

/// The `services = { ... }` block of `launchctl print <domain>`.
pub fn parse_domain_services(output: &str) -> Result<ParsedJobs, OutputError> {
    let mut lines = output.lines();
    if !lines.any(|line| line.trim() == "services = {") {
        return Err(OutputError::Unparsed);
    }
    Ok(collect(lines.take_while(|line| line.trim() != "}")))
}

/// The overrides of `launchctl print-disabled <domain>`: one `"label" => state`
/// line per job that has an override. A job with no line has no override and is
/// enabled. Both the `enabled`/`disabled` and the older `true`/`false` spellings
/// are accepted; a line in neither shape is counted, never guessed at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisabledOverrides {
    /// `(label, disabled)` in output order.
    pub entries: Vec<(String, bool)>,
    pub skipped_lines: usize,
}

pub fn parse_print_disabled(output: &str) -> Result<DisabledOverrides, OutputError> {
    let mut lines = output.lines();
    if !lines.any(|line| line.trim() == "disabled services = {") {
        return Err(OutputError::Unparsed);
    }
    let mut entries = Vec::new();
    let mut skipped_lines = 0;
    for line in lines.take_while(|line| line.trim() != "}") {
        if line.trim().is_empty() {
            continue;
        }
        let parsed = line.split_once("=>").and_then(|(label, state)| {
            let label = label.trim().strip_prefix('"')?.strip_suffix('"')?;
            let disabled = match state.trim() {
                "disabled" | "true" => true,
                "enabled" | "false" => false,
                _ => return None,
            };
            (!label.is_empty()).then(|| (label.to_owned(), disabled))
        });
        match parsed {
            Some(entry) => entries.push(entry),
            None => skipped_lines += 1,
        }
    }
    Ok(DisabledOverrides {
        entries,
        skipped_lines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_three_column_list_output() {
        let output = "PID\tStatus\tLabel\n\
                      -\t0\tcom.example.idle\n\
                      412\t0\tcom.example.running\n\
                      -\t78\tcom.example.failed\n\
                      -\t-15\tcom.example.terminated\n\
                      0\t0\tapplication.com.example.App.1.2\n";
        let parsed = parse_launchctl_list(output).expect("parsed");
        assert_eq!(parsed.skipped_lines, 0);
        let jobs: Vec<_> = parsed
            .jobs
            .iter()
            .map(|job| (job.label.as_str(), job.pid, job.last_exit))
            .collect();
        assert_eq!(
            jobs,
            [
                ("com.example.idle", None, Some(LastExit::Code(0))),
                ("com.example.running", Some(412), Some(LastExit::Code(0))),
                ("com.example.failed", None, Some(LastExit::Code(78))),
                ("com.example.terminated", None, Some(LastExit::Signal(15))),
                (
                    "application.com.example.App.1.2",
                    Some(0),
                    Some(LastExit::Code(0))
                ),
            ]
        );
    }

    #[test]
    fn counts_lines_that_do_not_parse_instead_of_dropping_them_silently() {
        let output = "PID\tStatus\tLabel\n\
                      -\t0\tcom.example.good\n\
                      garbage line\n\
                      x\t0\tcom.example.bad-pid\n\
                      12\ty\tcom.example.bad-status\n\
                      -\t0\n\
                      \n";
        let parsed = parse_launchctl_list(output).expect("parsed");
        assert_eq!(parsed.jobs.len(), 1);
        assert_eq!(parsed.skipped_lines, 4);
    }

    #[test]
    fn output_with_no_job_is_unparsed_not_an_empty_success() {
        assert_eq!(
            parse_launchctl_list("completely unexpected output\nmore\n"),
            Err(OutputError::Unparsed)
        );
        assert_eq!(parse_launchctl_list(""), Err(OutputError::Unparsed));
        // A header alone is a valid, empty job list.
        assert_eq!(
            parse_launchctl_list("PID\tStatus\tLabel\n").map(|parsed| parsed.jobs.len()),
            Ok(0)
        );
    }

    #[test]
    fn parses_the_services_block_of_a_domain_dump() {
        let output = "system = {\n\
                      \ttype = system\n\
                      \tservices = {\n\
                      \t\tPID\tStatus\tLabel\n\
                      \t\t-\t0\tcom.example.daemon\n\
                      \t\t88\t0\tcom.example.running-daemon\n\
                      \t\t-\t-9\tcom.example.killed\n\
                      \t}\n\
                      \n\
                      \tendpoints = {\n\
                      \t\t\"com.example.endpoint\" = {\n\
                      \t\t}\n\
                      \t}\n\
                      }\n";
        let parsed = parse_domain_services(output).expect("parsed");
        let jobs: Vec<_> = parsed
            .jobs
            .iter()
            .map(|job| (job.label.as_str(), job.pid, job.last_exit))
            .collect();
        assert_eq!(
            jobs,
            [
                ("com.example.daemon", None, Some(LastExit::Code(0))),
                (
                    "com.example.running-daemon",
                    Some(88),
                    Some(LastExit::Code(0))
                ),
                ("com.example.killed", None, Some(LastExit::Signal(9))),
            ]
        );
        assert_eq!(parsed.skipped_lines, 0);
    }

    #[test]
    fn a_domain_dump_without_a_services_block_is_unparsed() {
        assert_eq!(
            parse_domain_services("system = {\n\ttype = system\n}\n"),
            Err(OutputError::Unparsed)
        );
        assert_eq!(parse_domain_services(""), Err(OutputError::Unparsed));
    }

    #[test]
    fn unparsable_lines_inside_the_services_block_are_counted() {
        let output = "services = {\n\
                      \t-\t0\tcom.example.ok\n\
                      \tsomething odd here\n\
                      }\n";
        let parsed = parse_domain_services(output).expect("parsed");
        assert_eq!(parsed.jobs.len(), 1);
        assert_eq!(parsed.skipped_lines, 1);
    }

    #[test]
    fn parses_print_disabled_in_both_spellings() {
        let output = "disabled services = {\n\
                      \t\"com.example.off\" => disabled\n\
                      \t\"com.example.on\" => enabled\n\
                      \t\"com.example.old-off\" => true\n\
                      \t\"com.example.old-on\" => false\n\
                      }\n";
        let parsed = parse_print_disabled(output).expect("parsed");
        assert_eq!(
            parsed.entries,
            [
                ("com.example.off".to_owned(), true),
                ("com.example.on".to_owned(), false),
                ("com.example.old-off".to_owned(), true),
                ("com.example.old-on".to_owned(), false),
            ]
        );
        assert_eq!(parsed.skipped_lines, 0);
    }

    #[test]
    fn print_disabled_counts_odd_lines_and_rejects_other_output() {
        let output = "disabled services = {\n\
                      \t\"com.example.ok\" => disabled\n\
                      \tcom.example.unquoted => disabled\n\
                      \t\"com.example.odd\" => maybe\n\
                      \t\"\" => disabled\n\
                      }\n";
        let parsed = parse_print_disabled(output).expect("parsed");
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.skipped_lines, 3);
        // An empty block is a valid answer: nothing is overridden.
        assert_eq!(
            parse_print_disabled("disabled services = {\n}\n").map(|parsed| parsed.entries.len()),
            Ok(0)
        );
        assert_eq!(parse_print_disabled(""), Err(OutputError::Unparsed));
        assert_eq!(
            parse_print_disabled("unexpected\n"),
            Err(OutputError::Unparsed)
        );
    }
}
