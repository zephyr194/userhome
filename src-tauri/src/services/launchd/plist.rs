//! Evidence fields of one launchd property list, read from the JSON that
//! `plutil` produced. Nothing here runs or sources anything a plist names.
//! Environment variable values are never returned, only names; secret-looking
//! argument values are masked.

use std::ops::RangeInclusive;
use std::path::Path;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::environment::dotenv::is_secret_name;

use super::command::Label;

pub const MAX_ARGUMENTS: usize = 128;
pub const MAX_ENVIRONMENT_KEYS: usize = 128;
const MAX_TEXT_BYTES: usize = 1024;
const MAX_CONDITIONS: usize = 16;
const MAX_CALENDAR_SLOTS: usize = 24;
const MAX_SOCKET_NAMES: usize = 16;
pub const REDACTED: &str = "[REDACTED]";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlistError {
    Malformed,
}

/// What the `Label` key says. Never guessed from the file name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlistLabel {
    Present(String),
    Missing,
    /// Present, but not a string or not a safe label.
    Invalid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KeepAliveMode {
    Always,
    Never,
    Conditional,
}

/// `KeepAlive` summarized: a boolean, or the names of the conditions of its
/// dictionary form (never their values, which can be paths).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAlive {
    pub mode: KeepAliveMode,
    pub conditions: Vec<String>,
}

/// One `StartCalendarInterval` entry. A field that is absent, of the wrong type,
/// or out of range is `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSlot {
    pub minute: Option<u8>,
    pub hour: Option<u8>,
    pub day: Option<u8>,
    pub weekday: Option<u8>,
    pub month: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlistDetails {
    #[serde(skip)]
    pub label: PlistLabel,
    pub program: Option<String>,
    /// Secret-looking values are masked.
    pub program_arguments: Vec<String>,
    pub arguments_truncated: bool,
    /// Names only; values are never returned.
    pub environment_keys: Vec<String>,
    pub run_at_load: Option<bool>,
    pub keep_alive: Option<KeepAlive>,
    pub standard_out_path: Option<String>,
    pub standard_error_path: Option<String>,
    /// The declared log paths exactly as written, for the log authorization
    /// check only. Never serialized, and never shown.
    #[serde(skip)]
    pub declared_standard_out: Option<String>,
    #[serde(skip)]
    pub declared_standard_error: Option<String>,
    pub disabled: Option<bool>,
    pub user_name: Option<String>,
    /// Seconds between runs (`StartInterval`).
    pub start_interval: Option<u64>,
    pub start_calendar: Vec<CalendarSlot>,
    pub start_calendar_truncated: bool,
    /// Counts only: the paths themselves are never returned.
    pub watch_paths_count: u32,
    pub queue_directories_count: u32,
    /// Socket names only, never their ports or paths.
    pub socket_names: Vec<String>,
    pub start_on_mount: Option<bool>,
}

pub fn clip(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_owned();
    }
    let mut end = max_bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &text[..end])
}

/// `/Users/me/x` as `~/x` when below `home`.
pub fn display_path(path: &str, home: Option<&Path>) -> String {
    if let Some(home) = home
        && let Ok(relative) = Path::new(path).strip_prefix(home)
        && !relative.as_os_str().is_empty()
    {
        return format!("~/{}", relative.to_string_lossy());
    }
    path.to_owned()
}

fn text_of(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(|text| clip(text, MAX_TEXT_BYTES))
}

fn raw_text_of(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

fn bool_of(object: &Map<String, Value>, key: &str) -> Option<bool> {
    object.get(key).and_then(Value::as_bool)
}

fn label_of(object: &Map<String, Value>) -> PlistLabel {
    match object.get("Label") {
        None => PlistLabel::Missing,
        Some(Value::String(text)) if Label::parse(text).is_ok() => {
            PlistLabel::Present(text.clone())
        }
        Some(_) => PlistLabel::Invalid,
    }
}

/// Intervals longer than ten years are treated as unset.
const MAX_START_INTERVAL_SECONDS: u64 = 10 * 365 * 24 * 60 * 60;

fn start_interval_of(object: &Map<String, Value>) -> Option<u64> {
    object
        .get("StartInterval")
        .and_then(Value::as_u64)
        .filter(|seconds| (1..=MAX_START_INTERVAL_SECONDS).contains(seconds))
}

fn calendar_field(slot: &Map<String, Value>, key: &str, range: RangeInclusive<u64>) -> Option<u8> {
    slot.get(key)
        .and_then(Value::as_u64)
        .filter(|value| range.contains(value))
        .and_then(|value| u8::try_from(value).ok())
}

fn calendar_slot_of(slot: &Map<String, Value>) -> CalendarSlot {
    CalendarSlot {
        minute: calendar_field(slot, "Minute", 0..=59),
        hour: calendar_field(slot, "Hour", 0..=23),
        day: calendar_field(slot, "Day", 1..=31),
        weekday: calendar_field(slot, "Weekday", 0..=7),
        month: calendar_field(slot, "Month", 1..=12),
    }
}

fn start_calendar_of(object: &Map<String, Value>) -> (Vec<CalendarSlot>, bool) {
    match object.get("StartCalendarInterval") {
        Some(Value::Object(slot)) => (vec![calendar_slot_of(slot)], false),
        Some(Value::Array(items)) => {
            let slots = items
                .iter()
                .take(MAX_CALENDAR_SLOTS)
                .filter_map(Value::as_object)
                .map(calendar_slot_of)
                .collect();
            (slots, items.len() > MAX_CALENDAR_SLOTS)
        }
        _ => (Vec::new(), false),
    }
}

fn entry_count_of(object: &Map<String, Value>, key: &str) -> u32 {
    object
        .get(key)
        .and_then(Value::as_array)
        .map_or(0, |items| u32::try_from(items.len()).unwrap_or(u32::MAX))
}

fn socket_names_of(object: &Map<String, Value>) -> Vec<String> {
    let mut names: Vec<String> = object
        .get("Sockets")
        .and_then(Value::as_object)
        .map(|sockets| sockets.keys().map(|name| clip(name, 128)).collect())
        .unwrap_or_default();
    names.sort();
    names.truncate(MAX_SOCKET_NAMES);
    names
}

fn keep_alive_of(object: &Map<String, Value>) -> Option<KeepAlive> {
    match object.get("KeepAlive")? {
        Value::Bool(true) => Some(KeepAlive {
            mode: KeepAliveMode::Always,
            conditions: Vec::new(),
        }),
        Value::Bool(false) => Some(KeepAlive {
            mode: KeepAliveMode::Never,
            conditions: Vec::new(),
        }),
        Value::Object(conditions) => {
            let mut names: Vec<String> = conditions
                .iter()
                .map(|(name, value)| match value {
                    Value::Bool(flag) => format!("{}={flag}", clip(name, 64)),
                    _ => clip(name, 64),
                })
                .collect();
            names.sort();
            names.truncate(MAX_CONDITIONS);
            Some(KeepAlive {
                mode: KeepAliveMode::Conditional,
                conditions: names,
            })
        }
        _ => None,
    }
}

pub fn parse_plist_json(json: &str, home: Option<&Path>) -> Result<PlistDetails, PlistError> {
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(json) else {
        return Err(PlistError::Malformed);
    };

    let raw_arguments: Vec<String> = object
        .get("ProgramArguments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .take(MAX_ARGUMENTS)
                .map(|item| {
                    item.as_str()
                        .map_or("<non-string>".to_owned(), str::to_owned)
                })
                .collect()
        })
        .unwrap_or_default();
    let arguments_truncated = object
        .get("ProgramArguments")
        .and_then(Value::as_array)
        .is_some_and(|items| items.len() > MAX_ARGUMENTS);
    let program_arguments = redact_arguments(&raw_arguments)
        .iter()
        .map(|argument| clip(argument, MAX_TEXT_BYTES))
        .collect();

    let mut environment_keys: Vec<String> = object
        .get("EnvironmentVariables")
        .and_then(Value::as_object)
        .map(|variables| variables.keys().map(|key| clip(key, 128)).collect())
        .unwrap_or_default();
    environment_keys.sort();
    environment_keys.truncate(MAX_ENVIRONMENT_KEYS);

    let (start_calendar, start_calendar_truncated) = start_calendar_of(&object);

    Ok(PlistDetails {
        start_interval: start_interval_of(&object),
        start_calendar,
        start_calendar_truncated,
        watch_paths_count: entry_count_of(&object, "WatchPaths"),
        queue_directories_count: entry_count_of(&object, "QueueDirectories"),
        socket_names: socket_names_of(&object),
        start_on_mount: bool_of(&object, "StartOnMount"),
        label: label_of(&object),
        program: text_of(&object, "Program"),
        program_arguments,
        arguments_truncated,
        environment_keys,
        run_at_load: bool_of(&object, "RunAtLoad"),
        keep_alive: keep_alive_of(&object),
        standard_out_path: text_of(&object, "StandardOutPath")
            .map(|path| display_path(&path, home)),
        standard_error_path: text_of(&object, "StandardErrorPath")
            .map(|path| display_path(&path, home)),
        declared_standard_out: raw_text_of(&object, "StandardOutPath"),
        declared_standard_error: raw_text_of(&object, "StandardErrorPath"),
        disabled: bool_of(&object, "Disabled"),
        user_name: text_of(&object, "UserName"),
    })
}

/// `--api-key` and `API_KEY` both normalize to the environment-style name the
/// shared secret heuristic understands.
fn name_is_secret(name: &str) -> bool {
    let name = name.trim_start_matches('-').replace('-', "_");
    !name.is_empty() && is_secret_name(&name)
}

fn is_assignment_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

/// Masks the password of `scheme://user:password@host`.
fn redact_url_credentials(argument: &str) -> Option<String> {
    let (scheme, rest) = argument.split_once("://")?;
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    let (userinfo, host) = authority.rsplit_once('@')?;
    let (user, _) = userinfo.split_once(':')?;
    Some(format!("{scheme}://{user}:{REDACTED}@{host}{tail}"))
}

/// Masks values that look secret: `KEY=value` and `--flag=value` when the name
/// matches the secret heuristic, the value after a bare secret-named `--flag`,
/// and URL passwords. Other arguments are kept. This is a heuristic; a secret
/// passed positionally or after a short flag cannot be recognized.
pub fn redact_arguments(arguments: &[String]) -> Vec<String> {
    let mut result = Vec::with_capacity(arguments.len());
    let mut mask_next = false;
    for argument in arguments {
        if std::mem::take(&mut mask_next) && !argument.starts_with('-') {
            result.push(REDACTED.to_owned());
            continue;
        }
        if let Some((key, _)) = argument.split_once('=')
            && is_assignment_key(key)
            && name_is_secret(key)
        {
            result.push(format!("{key}={REDACTED}"));
            continue;
        }
        if argument.starts_with('-') && !argument.contains('=') && name_is_secret(argument) {
            mask_next = true;
        }
        result.push(redact_url_credentials(argument).unwrap_or_else(|| argument.clone()));
    }
    result
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn parse(json: &str) -> PlistDetails {
        parse_plist_json(json, Some(Path::new("/Users/me"))).expect("details")
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn the_declared_log_paths_are_kept_raw_and_never_serialized() {
        let details = parse(
            r#"{
              "Label": "com.example.job",
              "StandardOutPath": "/Users/me/Library/Logs/job.log",
              "StandardErrorPath": ""
            }"#,
        );
        assert_eq!(
            details.declared_standard_out.as_deref(),
            Some("/Users/me/Library/Logs/job.log")
        );
        assert_eq!(details.declared_standard_error, None);
        assert_eq!(
            details.standard_out_path.as_deref(),
            Some("~/Library/Logs/job.log")
        );
        let json = serde_json::to_string(&details).expect("serialize details");
        assert!(!json.contains("declared"));
        assert!(!json.contains("/Users/me/Library"));
    }

    #[test]
    fn extracts_the_evidence_fields() {
        let details = parse(
            r#"{
              "Label": "com.example.job",
              "Program": "/usr/local/bin/job",
              "ProgramArguments": ["/usr/local/bin/job", "--serve", "--port", "8080"],
              "RunAtLoad": true,
              "KeepAlive": true,
              "StandardOutPath": "/Users/me/Library/Logs/job.log",
              "StandardErrorPath": "/var/log/job.err",
              "Disabled": false,
              "UserName": "me"
            }"#,
        );
        assert_eq!(details.label, PlistLabel::Present("com.example.job".into()));
        assert_eq!(details.program.as_deref(), Some("/usr/local/bin/job"));
        assert_eq!(
            details.program_arguments,
            strings(&["/usr/local/bin/job", "--serve", "--port", "8080"])
        );
        assert_eq!(details.run_at_load, Some(true));
        assert_eq!(
            details.keep_alive,
            Some(KeepAlive {
                mode: KeepAliveMode::Always,
                conditions: vec![]
            })
        );
        assert_eq!(
            details.standard_out_path.as_deref(),
            Some("~/Library/Logs/job.log")
        );
        assert_eq!(
            details.standard_error_path.as_deref(),
            Some("/var/log/job.err")
        );
        assert_eq!(details.disabled, Some(false));
        assert_eq!(details.user_name.as_deref(), Some("me"));
    }

    #[test]
    fn keep_alive_dictionaries_are_summarized_by_condition_name() {
        let never = parse(r#"{"Label":"a","KeepAlive":false}"#);
        assert_eq!(
            never.keep_alive,
            Some(KeepAlive {
                mode: KeepAliveMode::Never,
                conditions: vec![]
            })
        );
        let conditional = parse(
            r#"{"Label":"a","KeepAlive":{"SuccessfulExit":false,"PathState":{"/secret/path":true},"NetworkState":true}}"#,
        );
        assert_eq!(
            conditional.keep_alive,
            Some(KeepAlive {
                mode: KeepAliveMode::Conditional,
                conditions: strings(&["NetworkState=true", "PathState", "SuccessfulExit=false"])
            })
        );
        assert_eq!(parse(r#"{"Label":"a"}"#).keep_alive, None);
    }

    #[test]
    fn environment_values_are_never_returned_only_key_names() {
        let details = parse(
            r#"{"Label":"a","EnvironmentVariables":{"API_TOKEN":"s3cret","PATH":"/usr/bin","HOME":"/Users/me"}}"#,
        );
        assert_eq!(
            details.environment_keys,
            strings(&["API_TOKEN", "HOME", "PATH"])
        );
        let debug = format!("{details:?}");
        for value in ["s3cret", "/usr/bin"] {
            assert!(!debug.contains(value), "{value} leaked");
        }
    }

    #[test]
    fn label_problems_are_distinguished() {
        assert_eq!(
            parse(r#"{"Program":"/bin/true"}"#).label,
            PlistLabel::Missing
        );
        assert_eq!(parse(r#"{"Label":""}"#).label, PlistLabel::Invalid);
        assert_eq!(parse(r#"{"Label":5}"#).label, PlistLabel::Invalid);
        assert_eq!(parse(r#"{"Label":"has space"}"#).label, PlistLabel::Invalid);
        assert_eq!(parse(r#"{"Label":"a\nb"}"#).label, PlistLabel::Invalid);
        assert_eq!(
            parse(r#"{"Label":"com.ok"}"#).label,
            PlistLabel::Present("com.ok".into())
        );
    }

    #[test]
    fn json_that_is_not_a_dictionary_is_malformed() {
        for json in ["", "not json", "[]", "\"text\"", "5", "null", "{"] {
            assert_eq!(
                parse_plist_json(json, None),
                Err(PlistError::Malformed),
                "{json:?}"
            );
        }
    }

    #[test]
    fn wrongly_typed_optional_keys_are_treated_as_absent() {
        let details = parse(
            r#"{"Label":"a","Program":5,"ProgramArguments":"x","RunAtLoad":"yes","StandardOutPath":[1],"EnvironmentVariables":["a"]}"#,
        );
        assert_eq!(details.program, None);
        assert!(details.program_arguments.is_empty());
        assert_eq!(details.run_at_load, None);
        assert_eq!(details.standard_out_path, None);
        assert!(details.environment_keys.is_empty());
    }

    #[test]
    fn arguments_and_keys_are_bounded() {
        let many: Vec<String> = (0..400).map(|index| format!("\"arg{index}\"")).collect();
        let long = "x".repeat(10_000);
        let json = format!(
            r#"{{"Label":"a","Program":"{long}","ProgramArguments":[{}]}}"#,
            many.join(",")
        );
        let details = parse(&json);
        assert_eq!(details.program_arguments.len(), MAX_ARGUMENTS);
        assert!(details.arguments_truncated);
        assert!(
            details
                .program
                .as_deref()
                .is_some_and(|value| value.len() <= 1_100)
        );
        let keys: Vec<String> = (0..300)
            .map(|index| format!("\"K{index:03}\":\"v\""))
            .collect();
        let json = format!(
            r#"{{"Label":"a","EnvironmentVariables":{{{}}}}}"#,
            keys.join(",")
        );
        assert_eq!(parse(&json).environment_keys.len(), MAX_ENVIRONMENT_KEYS);
    }

    #[test]
    fn non_string_arguments_are_marked_not_dropped() {
        let details = parse(r#"{"Label":"a","ProgramArguments":["/bin/x", 5, null]}"#);
        assert_eq!(
            details.program_arguments,
            strings(&["/bin/x", "<non-string>", "<non-string>"])
        );
    }

    #[test]
    fn redacts_secret_valued_arguments() {
        let redacted = |args: &[&str]| redact_arguments(&strings(args));
        assert_eq!(
            redacted(&["/bin/x", "--token", "abc123", "--verbose"]),
            strings(&["/bin/x", "--token", "[REDACTED]", "--verbose"])
        );
        assert_eq!(
            redacted(&["--api-key=abc", "--password=hunter2", "--name=ok"]),
            strings(&["--api-key=[REDACTED]", "--password=[REDACTED]", "--name=ok"])
        );
        assert_eq!(
            redacted(&[
                "DB_PASSWORD=hunter2",
                "MODE=fast",
                "AWS_SECRET_ACCESS_KEY=zzz"
            ]),
            strings(&[
                "DB_PASSWORD=[REDACTED]",
                "MODE=fast",
                "AWS_SECRET_ACCESS_KEY=[REDACTED]"
            ])
        );
        assert_eq!(
            redacted(&["--client_secret", "abc", "--auth-token", "def"]),
            strings(&[
                "--client_secret",
                "[REDACTED]",
                "--auth-token",
                "[REDACTED]"
            ])
        );
        assert_eq!(
            redacted(&["https://user:pw@example.com/path", "https://example.com/x"]),
            strings(&[
                "https://user:[REDACTED]@example.com/path",
                "https://example.com/x"
            ])
        );
    }

    #[test]
    fn redaction_keeps_ordinary_arguments_and_a_flag_followed_by_a_flag() {
        let redacted = |args: &[&str]| redact_arguments(&strings(args));
        assert_eq!(
            redacted(&["/usr/bin/tool", "--config", "/etc/tool.conf", "-v"]),
            strings(&["/usr/bin/tool", "--config", "/etc/tool.conf", "-v"])
        );
        // A secret-named flag with no value must not swallow the next flag.
        assert_eq!(
            redacted(&["--token", "--other", "value"]),
            strings(&["--token", "--other", "value"])
        );
        // A trailing secret-named flag has nothing to redact.
        assert_eq!(redacted(&["--token"]), strings(&["--token"]));
        // `=` inside a plain argument whose key is not secret stays.
        assert_eq!(
            redacted(&["--define=A=B", "path=/tmp/x"]),
            strings(&["--define=A=B", "path=/tmp/x"])
        );
    }

    #[test]
    fn redaction_is_applied_to_parsed_program_arguments() {
        let details =
            parse(r#"{"Label":"a","ProgramArguments":["/bin/x","--token","abc","API_KEY=zzz"]}"#);
        let debug = format!("{details:?}");
        assert!(!debug.contains("abc") && !debug.contains("zzz"), "{debug}");
        assert_eq!(
            details.program_arguments,
            strings(&["/bin/x", "--token", "[REDACTED]", "API_KEY=[REDACTED]"])
        );
    }

    #[test]
    fn start_interval_is_a_positive_number_of_seconds() {
        assert_eq!(
            parse(r#"{"Label":"a","StartInterval":300}"#).start_interval,
            Some(300)
        );
        for json in [
            r#"{"Label":"a","StartInterval":0}"#,
            r#"{"Label":"a","StartInterval":-5}"#,
            r#"{"Label":"a","StartInterval":1.5}"#,
            r#"{"Label":"a","StartInterval":"300"}"#,
        ] {
            assert_eq!(parse(json).start_interval, None, "{json}");
        }
    }

    #[test]
    fn start_interval_longer_than_ten_years_is_treated_as_unset() {
        let at_limit = format!(r#"{{"Label":"a","StartInterval":{MAX_START_INTERVAL_SECONDS}}}"#);
        assert_eq!(
            parse(&at_limit).start_interval,
            Some(MAX_START_INTERVAL_SECONDS)
        );
        let over = format!(
            r#"{{"Label":"a","StartInterval":{}}}"#,
            MAX_START_INTERVAL_SECONDS + 1
        );
        assert_eq!(parse(&over).start_interval, None);
        assert_eq!(
            parse(r#"{"Label":"a","StartInterval":18446744073709551615}"#).start_interval,
            None
        );
    }

    #[test]
    fn start_calendar_reads_a_dictionary_or_an_array_of_dictionaries() {
        let single = parse(r#"{"Label":"a","StartCalendarInterval":{"Hour":3,"Minute":0}}"#);
        assert_eq!(
            single.start_calendar,
            vec![CalendarSlot {
                minute: Some(0),
                hour: Some(3),
                day: None,
                weekday: None,
                month: None,
            }]
        );
        assert!(!single.start_calendar_truncated);

        let many = parse(
            r#"{"Label":"a","StartCalendarInterval":[{"Weekday":1,"Hour":9,"Minute":0},{"Day":15,"Month":12}]}"#,
        );
        assert_eq!(
            many.start_calendar,
            vec![
                CalendarSlot {
                    minute: Some(0),
                    hour: Some(9),
                    day: None,
                    weekday: Some(1),
                    month: None,
                },
                CalendarSlot {
                    minute: None,
                    hour: None,
                    day: Some(15),
                    weekday: None,
                    month: Some(12),
                },
            ]
        );
    }

    #[test]
    fn start_calendar_drops_out_of_range_and_wrongly_typed_fields() {
        let details = parse(
            r#"{"Label":"a","StartCalendarInterval":[{"Hour":24,"Minute":"5","Day":0,"Month":13,"Weekday":8},5,{"Hour":9}]}"#,
        );
        assert_eq!(
            details.start_calendar,
            vec![
                CalendarSlot {
                    minute: None,
                    hour: None,
                    day: None,
                    weekday: None,
                    month: None,
                },
                CalendarSlot {
                    minute: None,
                    hour: Some(9),
                    day: None,
                    weekday: None,
                    month: None,
                },
            ]
        );
    }

    #[test]
    fn start_calendar_is_capped_and_says_so() {
        let slot = r#"{"Hour":1}"#;
        let exact: Vec<&str> = vec![slot; MAX_CALENDAR_SLOTS];
        let at_limit = parse(&format!(
            r#"{{"Label":"a","StartCalendarInterval":[{}]}}"#,
            exact.join(",")
        ));
        assert_eq!(at_limit.start_calendar.len(), MAX_CALENDAR_SLOTS);
        assert!(!at_limit.start_calendar_truncated);

        let over: Vec<&str> = vec![slot; MAX_CALENDAR_SLOTS + 6];
        let capped = parse(&format!(
            r#"{{"Label":"a","StartCalendarInterval":[{}]}}"#,
            over.join(",")
        ));
        assert_eq!(capped.start_calendar.len(), MAX_CALENDAR_SLOTS);
        assert!(capped.start_calendar_truncated);
    }

    #[test]
    fn watch_queue_and_socket_fields_expose_counts_and_names_never_paths() {
        let details = parse(
            r#"{
              "Label": "a",
              "WatchPaths": ["/Users/me/secret-a", "/tmp/b"],
              "QueueDirectories": ["/var/spool/jobs"],
              "Sockets": {
                "Listeners": {"SockServiceName": "8080"},
                "Admin": {"SockPathName": "/var/run/admin.sock"}
              }
            }"#,
        );
        assert_eq!(details.watch_paths_count, 2);
        assert_eq!(details.queue_directories_count, 1);
        assert_eq!(details.socket_names, strings(&["Admin", "Listeners"]));
        let debug = format!("{details:?}");
        let json = serde_json::to_string(&details).expect("serialize details");
        for secret in [
            "/Users/me",
            "secret-a",
            "/tmp/b",
            "/var/spool",
            "8080",
            "/var/run",
        ] {
            assert!(
                !debug.contains(secret) && !json.contains(secret),
                "{secret} leaked"
            );
        }
    }

    #[test]
    fn socket_names_are_sorted_and_capped() {
        let sockets: Vec<String> = (0..20)
            .map(|index| format!("\"S{index:02}\":{{}}"))
            .collect();
        let details = parse(&format!(
            r#"{{"Label":"a","Sockets":{{{}}}}}"#,
            sockets.join(",")
        ));
        assert_eq!(details.socket_names.len(), MAX_SOCKET_NAMES);
        assert_eq!(
            details.socket_names.first().map(String::as_str),
            Some("S00")
        );
    }

    #[test]
    fn scheduling_fields_are_unset_when_absent_or_wrongly_typed() {
        let wrong = parse(
            r#"{"Label":"a","StartInterval":"x","StartCalendarInterval":"daily","WatchPaths":"/x","QueueDirectories":5,"Sockets":["Listeners"],"StartOnMount":"yes"}"#,
        );
        assert_eq!(wrong, parse(r#"{"Label":"a"}"#));
        assert_eq!(wrong.start_on_mount, None);
        assert_eq!(wrong.watch_paths_count, 0);
    }

    #[test]
    fn start_on_mount_is_a_boolean_flag() {
        assert_eq!(
            parse(r#"{"Label":"a","StartOnMount":true}"#).start_on_mount,
            Some(true)
        );
        assert_eq!(
            parse(r#"{"Label":"a","StartOnMount":false}"#).start_on_mount,
            Some(false)
        );
    }

    #[test]
    fn scheduling_fields_serialize_under_the_names_the_frontend_decodes() {
        let json = serde_json::to_string(&parse(
            r#"{"Label":"a","StartInterval":60,"StartCalendarInterval":{"Hour":3}}"#,
        ))
        .expect("serialize details");
        for fragment in [
            r#""startInterval":60"#,
            r#""startCalendar":[{"minute":null,"hour":3,"day":null,"weekday":null,"month":null}]"#,
            r#""startCalendarTruncated":false"#,
            r#""watchPathsCount":0"#,
            r#""queueDirectoriesCount":0"#,
            r#""socketNames":[]"#,
            r#""startOnMount":null"#,
        ] {
            assert!(json.contains(fragment), "{fragment} missing from {json}");
        }
    }
}
