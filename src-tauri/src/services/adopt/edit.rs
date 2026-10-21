//! Planning a structured edit of an adopted job's plist. Only the keys the
//! request names change. Every other key, unknown ones included, keeps its value
//! and its place. The result must render and parse back unchanged, or the edit
//! is refused rather than repaired. Paths, arguments and environment entries are
//! checked by the same rules as creation, and no value is ever returned in an
//! error or a change description, only key names.

use std::{collections::BTreeMap, path::Path};

use plist::{Dictionary, Value};
use serde::Deserialize;

use crate::{
    error::AppError,
    services::{
        create::{self, CreateError, Field, HostFacts, MAX_ENVIRONMENT_ENTRIES, Reason},
        launchd::{LaunchdDomain, redact_arguments},
    },
};

use super::{LABEL_KEY, Refusal, UNSUPPORTED_LAUNCH_KEYS, editable_document, render};

/// The fields a structured edit may change. Absent fields are unchanged; an empty
/// string for a path removes that key. Environment changes name keys only; the
/// values are sent once, here, and never come back.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditRequest {
    pub domain: LaunchdDomain,
    pub label: String,
    #[serde(default)]
    pub executable: Option<String>,
    #[serde(default)]
    pub arguments: Option<Vec<String>>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub environment_set: BTreeMap<String, String>,
    #[serde(default)]
    pub environment_remove: Vec<String>,
    #[serde(default)]
    pub stdout_path: Option<String>,
    #[serde(default)]
    pub stderr_path: Option<String>,
    #[serde(default)]
    pub run_at_load: Option<bool>,
    #[serde(default)]
    pub keep_alive: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditError {
    Refused(Refusal),
    LabelMismatch,
    ProgramKeyPresent,
    ProgramArgumentsNotText,
    NotBoolean(&'static str),
    EnvironmentNotDictionary,
    NothingToChange,
    Field(CreateError),
}

/// What an edit will do, with values kept out of everything but `content`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EditPlan {
    /// The rendered plist that replaces the current file.
    pub content: Vec<u8>,
    /// The top-level keys that change, by name.
    pub changes: Vec<String>,
    /// Values that an operation record must never echo.
    pub sensitive: Vec<String>,
    /// Set when the program or its arguments change.
    pub executable: Option<String>,
    /// Set when the program or its arguments change, sensitive values masked.
    pub arguments: Option<Vec<String>>,
    pub environment_set: Vec<String>,
    pub environment_removed: Vec<String>,
}

pub fn refusal_text(refusal: Refusal) -> &'static str {
    match refusal {
        Refusal::AlreadyManaged => "该任务已由 UserHome 管理，无需重复接管。",
        Refusal::ReadOnly(_) => "该任务当前为只读（位置、所有者、链接或来源不满足条件）。",
        Refusal::TooLarge => "plist 超过大小上限，已拒绝。",
        Refusal::BinaryFormat => "plist 为二进制格式，无法保真编辑，已拒绝。",
        Refusal::Malformed => "plist 无法解析，已拒绝。",
        Refusal::NotDictionary => "plist 根元素不是字典，已拒绝。",
        Refusal::DuplicateKey => "plist 含重复键，无法确定生效值，已拒绝。",
        Refusal::LabelMissing => "plist 缺少 Label 字符串，已拒绝。",
        Refusal::LabelMismatch => "plist 中的 Label 与该任务不一致，已拒绝。",
        Refusal::UnsupportedLaunchKey => {
            "plist 使用了 UserHome 无法说明的启动语义（如事件触发或用户切换），已拒绝。"
        }
        Refusal::Comments => "plist 含注释，结构化编辑会丢失注释，已拒绝。",
        Refusal::RoundTripChanged => "plist 无法无损往返，已拒绝结构化编辑，不会通过删字段修复。",
    }
}

impl From<EditError> for AppError {
    fn from(error: EditError) -> Self {
        match error {
            EditError::Refused(refusal) => AppError::validation_failed(refusal_text(refusal)),
            EditError::LabelMismatch => {
                AppError::validation_failed("plist 中的 Label 与该任务不一致，已拒绝编辑。")
            }
            EditError::ProgramKeyPresent => {
                AppError::not_supported("该任务使用 Program 键指定程序，不支持结构化修改参数。")
            }
            EditError::ProgramArgumentsNotText => {
                AppError::not_supported("ProgramArguments 不是字符串数组，不支持结构化修改。")
            }
            EditError::NotBoolean(key) => {
                AppError::not_supported(&format!("{key} 不是布尔值，不会以覆盖方式修改。"))
            }
            EditError::EnvironmentNotDictionary => {
                AppError::not_supported("EnvironmentVariables 不是字典，不支持结构化修改。")
            }
            EditError::NothingToChange => AppError::invalid_input("没有需要修改的字段。"),
            EditError::Field(error) => AppError::from(error),
        }
    }
}

/// Plans the edit of `bytes`, the current content of the job's plist. `label` is
/// the job's label as rediscovered; the plist must agree with it.
pub fn plan_edit(
    bytes: &[u8],
    label: &str,
    request: &EditRequest,
    home: &Path,
    facts: &dyn HostFacts,
) -> Result<EditPlan, EditError> {
    let mut dictionary = editable_document(bytes).map_err(EditError::Refused)?;
    if dictionary.get(LABEL_KEY) != Some(&Value::String(label.to_owned())) {
        return Err(EditError::LabelMismatch);
    }
    if UNSUPPORTED_LAUNCH_KEYS
        .iter()
        .any(|key| dictionary.contains_key(key))
    {
        return Err(EditError::Refused(Refusal::UnsupportedLaunchKey));
    }
    let mut plan = EditPlan::default();

    if request.executable.is_some() || request.arguments.is_some() {
        apply_program(&mut dictionary, request, home, facts, &mut plan)?;
    }
    match request.working_directory.as_deref() {
        None => {}
        Some("") => remove_key(&mut dictionary, "WorkingDirectory", &mut plan),
        Some(directory) => {
            create::check_working_directory(directory, facts).map_err(EditError::Field)?;
            set_string(&mut dictionary, "WorkingDirectory", directory, &mut plan);
        }
    }
    for (key, field, value) in [
        (
            "StandardOutPath",
            Field::StdoutPath,
            request.stdout_path.as_deref(),
        ),
        (
            "StandardErrorPath",
            Field::StderrPath,
            request.stderr_path.as_deref(),
        ),
    ] {
        match value {
            None => {}
            Some("") => remove_key(&mut dictionary, key, &mut plan),
            Some(path) => {
                create::check_log_path(path, field, home, facts).map_err(EditError::Field)?;
                set_string(&mut dictionary, key, path, &mut plan);
            }
        }
    }
    if !request.environment_set.is_empty() || !request.environment_remove.is_empty() {
        apply_environment(&mut dictionary, request, &mut plan)?;
    }
    set_boolean(&mut dictionary, "RunAtLoad", request.run_at_load, &mut plan)?;
    set_boolean(&mut dictionary, "KeepAlive", request.keep_alive, &mut plan)?;

    if plan.changes.is_empty() {
        return Err(EditError::NothingToChange);
    }
    plan.content = render(&dictionary).map_err(EditError::Refused)?;
    Ok(plan)
}

fn apply_program(
    dictionary: &mut Dictionary,
    request: &EditRequest,
    home: &Path,
    facts: &dyn HostFacts,
    plan: &mut EditPlan,
) -> Result<(), EditError> {
    if dictionary.contains_key("Program") {
        return Err(EditError::ProgramKeyPresent);
    }
    let current = program_arguments(dictionary)?;
    let (current_executable, current_arguments) = match current.split_first() {
        Some((first, rest)) => (first.clone(), rest.to_vec()),
        None => (String::new(), Vec::new()),
    };
    let executable = match &request.executable {
        Some(executable) => {
            create::check_executable(executable, home, facts).map_err(EditError::Field)?;
            executable.clone()
        }
        None => current_executable,
    };
    if executable.is_empty() {
        return Err(EditError::Field(CreateError::Invalid {
            field: Field::Executable,
            reason: Reason::Empty,
        }));
    }
    let arguments = match &request.arguments {
        Some(arguments) => {
            create::check_arguments(arguments).map_err(EditError::Field)?;
            arguments.clone()
        }
        None => current_arguments,
    };
    let mut argv = vec![executable.clone()];
    argv.extend(arguments.iter().cloned());
    if argv != current {
        dictionary.insert(
            "ProgramArguments".to_owned(),
            Value::Array(argv.into_iter().map(Value::String).collect()),
        );
        plan.changes.push("ProgramArguments".to_owned());
        plan.sensitive
            .extend(create::sensitive_values_of(&arguments, Vec::new()));
        plan.arguments = Some(redact_arguments(&arguments));
        plan.executable = Some(executable);
    }
    Ok(())
}

fn program_arguments(dictionary: &Dictionary) -> Result<Vec<String>, EditError> {
    match dictionary.get("ProgramArguments") {
        None => Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::String(text) => Ok(text.clone()),
                _ => Err(EditError::ProgramArgumentsNotText),
            })
            .collect(),
        Some(_) => Err(EditError::ProgramArgumentsNotText),
    }
}

fn apply_environment(
    dictionary: &mut Dictionary,
    request: &EditRequest,
    plan: &mut EditPlan,
) -> Result<(), EditError> {
    create::check_environment(&request.environment_set).map_err(EditError::Field)?;
    let mut environment = match dictionary.get("EnvironmentVariables") {
        None => Dictionary::new(),
        Some(Value::Dictionary(existing)) => existing.clone(),
        Some(_) => return Err(EditError::EnvironmentNotDictionary),
    };
    let before = environment.clone();
    environment.retain(|key, _| !request.environment_remove.contains(key));
    for (key, value) in &request.environment_set {
        environment.insert(key.clone(), Value::String(value.clone()));
    }
    if environment.len() > MAX_ENVIRONMENT_ENTRIES {
        return Err(EditError::Field(CreateError::Invalid {
            field: Field::EnvironmentKey,
            reason: Reason::TooMany,
        }));
    }
    if environment == before {
        return Ok(());
    }
    if environment.is_empty() {
        dictionary.retain(|key, _| key.as_str() != "EnvironmentVariables");
    } else {
        dictionary.insert(
            "EnvironmentVariables".to_owned(),
            Value::Dictionary(environment),
        );
    }
    plan.changes.push("EnvironmentVariables".to_owned());
    plan.sensitive
        .extend(request.environment_set.values().cloned());
    plan.environment_set = request.environment_set.keys().cloned().collect();
    plan.environment_removed = request.environment_remove.clone();
    Ok(())
}

fn set_string(dictionary: &mut Dictionary, key: &str, value: &str, plan: &mut EditPlan) {
    if dictionary.get(key) == Some(&Value::String(value.to_owned())) {
        return;
    }
    dictionary.insert(key.to_owned(), Value::String(value.to_owned()));
    plan.changes.push(key.to_owned());
}

/// Removes a key without disturbing the order of the others: `Dictionary::remove`
/// would move the last key into the gap.
fn remove_key(dictionary: &mut Dictionary, key: &str, plan: &mut EditPlan) {
    if !dictionary.contains_key(key) {
        return;
    }
    dictionary.retain(|candidate, _| candidate.as_str() != key);
    plan.changes.push(key.to_owned());
}

fn set_boolean(
    dictionary: &mut Dictionary,
    key: &'static str,
    value: Option<bool>,
    plan: &mut EditPlan,
) -> Result<(), EditError> {
    let Some(value) = value else {
        return Ok(());
    };
    match dictionary.get(key) {
        None => {}
        Some(Value::Boolean(current)) if *current == value => return Ok(()),
        Some(Value::Boolean(_)) => {}
        Some(_) => return Err(EditError::NotBoolean(key)),
    }
    dictionary.insert(key.to_owned(), Value::Boolean(value));
    plan.changes.push(key.to_owned());
    Ok(())
}
