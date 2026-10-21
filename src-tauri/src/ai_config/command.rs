//! Copyable zsh command text for Claude Code flags and environment variables.
//! Nothing is executed or read from disk. Every value becomes one single-quoted
//! literal, and secret variables only ever produce a visible placeholder.

use std::cmp::Ordering;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::registry::{
    EnvDefinition, FlagDefinition, RiskFlag, ToolDefinition, ValueType, VerifiedVersions,
};
use super::validate::parse_version;
use crate::environment::zsh_block::{ValueProblem, check_value, quote};

pub const CLAUDE_CODE_TOOL_ID: &str = "claude-code";
pub const SECRET_PLACEHOLDER: &str = "<在此填入，勿提交>";
pub const COVERAGE_NOTE: &str = "收录范围：flags 与环境变量为已核实的子集。环境变量页面抓取被截断，未收录的官方项目不在此列表中。";
const MAX_CHOICES: usize = 64;
const MAX_COMMAND_CHARS: usize = 16_384;
const MAX_VERSION_CHARS: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ItemChoice {
    pub id: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandRequest {
    pub flags: Vec<ItemChoice>,
    pub env: Vec<ItemChoice>,
    pub acknowledged_risks: Vec<String>,
    pub detected_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueReason {
    NotInAllowedValues,
    NotANumber,
    ControlCharacter,
    TooLong,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError {
    TooManyChoices,
    UnknownItem,
    DuplicateItem,
    NotGeneratable(String),
    MissingValue(String),
    UnexpectedValue(String),
    InvalidValue { item: String, reason: ValueReason },
    Excluded { item: String, other: String },
    RequiresMissing { item: String, required: String },
    RiskNotAcknowledged(String),
    InvalidDetectedVersion,
    CommandTooLong,
}

impl CommandError {
    pub fn message(&self) -> String {
        match self {
            Self::TooManyChoices => "选择项过多。".to_owned(),
            Self::UnknownItem => "包含未收录的 flag 或环境变量。".to_owned(),
            Self::DuplicateItem => "同一 flag 或环境变量不能重复选择。".to_owned(),
            Self::NotGeneratable(item) => {
                format!("{item} 的取值类型未经官方确认，仅供查看，不能生成命令。")
            }
            Self::MissingValue(item) => format!("{item} 需要填写取值。"),
            Self::UnexpectedValue(item) => format!("{item} 不接受取值；敏感项只生成占位符。"),
            Self::InvalidValue { item, reason } => match reason {
                ValueReason::NotInAllowedValues => format!("{item} 的取值不在官方允许范围内。"),
                ValueReason::NotANumber => format!("{item} 需要数字取值。"),
                ValueReason::ControlCharacter => {
                    format!("{item} 含有控制字符或不可见字符，已拒绝。")
                }
                ValueReason::TooLong => format!("{item} 取值超过长度上限。"),
            },
            Self::Excluded { item, other } => format!("{item} 与 {other} 互斥，请只保留一项。"),
            Self::RequiresMissing { item, required } => {
                format!("{item} 需要同时选择 {required}。")
            }
            Self::RiskNotAcknowledged(item) => {
                format!("{item} 可能放宽权限或执行命令，需先逐项确认风险。")
            }
            Self::InvalidDetectedVersion => "本机版本格式无效。".to_owned(),
            Self::CommandTooLong => "生成的命令超过长度上限。".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionStatus {
    Compatible,
    Unconfirmed,
    Incompatible,
    NotStated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemNotice {
    pub id: String,
    pub status: VersionStatus,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltCommand {
    pub text: String,
    pub notices: Vec<ItemNotice>,
    pub placeholders: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Slot {
    Env,
    Flag,
}

struct Chosen<'a> {
    id: &'a str,
    slot: Slot,
    secret: bool,
    excludes: &'a [String],
    requires: &'a [String],
    risks: &'a [RiskFlag],
    versions: Option<&'a VerifiedVersions>,
    piece: String,
}

pub fn build_claude_command(
    tool: &ToolDefinition,
    request: &CommandRequest,
) -> Result<BuiltCommand, CommandError> {
    if request.flags.len() + request.env.len() > MAX_CHOICES {
        return Err(CommandError::TooManyChoices);
    }
    let detected = detected_version(request.detected_version.as_deref())?;
    let chosen = choose(tool, request)?;
    check_relations(&chosen)?;
    check_risks(&chosen, &request.acknowledged_risks)?;
    let notices = chosen
        .iter()
        .map(|item| {
            notice(
                item,
                detected.as_deref(),
                request.detected_version.as_deref(),
            )
        })
        .collect();
    let text = render(&chosen);
    if text.chars().count() > MAX_COMMAND_CHARS {
        return Err(CommandError::CommandTooLong);
    }
    let placeholders = chosen
        .iter()
        .filter(|item| item.secret)
        .map(|item| item.id.to_owned())
        .collect();
    Ok(BuiltCommand {
        text,
        notices,
        placeholders,
    })
}

fn detected_version(text: Option<&str>) -> Result<Option<Vec<u64>>, CommandError> {
    match text {
        None => Ok(None),
        Some(text) if text.is_empty() || text.chars().count() > MAX_VERSION_CHARS => {
            Err(CommandError::InvalidDetectedVersion)
        }
        Some(text) => parse_version(text)
            .map(Some)
            .ok_or(CommandError::InvalidDetectedVersion),
    }
}

fn choose<'a>(
    tool: &'a ToolDefinition,
    request: &CommandRequest,
) -> Result<Vec<Chosen<'a>>, CommandError> {
    let mut seen = HashSet::new();
    let mut chosen = Vec::new();
    for choice in &request.flags {
        if !seen.insert(choice.id.as_str()) {
            return Err(CommandError::DuplicateItem);
        }
        let definition = tool
            .flags
            .iter()
            .find(|flag| flag.id == choice.id)
            .ok_or(CommandError::UnknownItem)?;
        chosen.push(flag_choice(definition, choice.value.as_deref())?);
    }
    for choice in &request.env {
        if !seen.insert(choice.id.as_str()) {
            return Err(CommandError::DuplicateItem);
        }
        let definition = tool
            .env
            .iter()
            .find(|env| env.name == choice.id)
            .ok_or(CommandError::UnknownItem)?;
        chosen.push(env_choice(definition, choice.value.as_deref())?);
    }
    Ok(chosen)
}

fn flag_choice<'a>(
    definition: &'a FlagDefinition,
    value: Option<&str>,
) -> Result<Chosen<'a>, CommandError> {
    let piece = match definition.value_type {
        ValueType::Unknown | ValueType::StringArray | ValueType::Object => {
            return Err(CommandError::NotGeneratable(definition.id.clone()));
        }
        ValueType::Boolean => {
            if value.is_some() {
                return Err(CommandError::UnexpectedValue(definition.id.clone()));
            }
            definition.id.clone()
        }
        ValueType::String | ValueType::Enum | ValueType::Number => {
            let text = required_value(&definition.id, value)?;
            check_value_text(
                &definition.id,
                text,
                definition.value_type,
                &definition.allowed_values,
            )?;
            format!("{}={}", definition.id, quote(text))
        }
    };
    Ok(Chosen {
        id: &definition.id,
        slot: Slot::Flag,
        secret: false,
        excludes: &definition.excludes,
        requires: &definition.requires,
        risks: &definition.risks,
        versions: definition.versions.as_ref(),
        piece,
    })
}

fn env_choice<'a>(
    definition: &'a EnvDefinition,
    value: Option<&str>,
) -> Result<Chosen<'a>, CommandError> {
    if definition.value_type == ValueType::Unknown {
        return Err(CommandError::NotGeneratable(definition.name.clone()));
    }
    let piece = if definition.secret {
        if value.is_some_and(|text| !text.is_empty()) {
            return Err(CommandError::UnexpectedValue(definition.name.clone()));
        }
        format!("{}={}", definition.name, quote(SECRET_PLACEHOLDER))
    } else if definition.value_type == ValueType::Boolean {
        if value.is_some() {
            return Err(CommandError::UnexpectedValue(definition.name.clone()));
        }
        format!("{}=1", definition.name)
    } else {
        let text = required_value(&definition.name, value)?;
        check_value_text(
            &definition.name,
            text,
            definition.value_type,
            &definition.allowed_values,
        )?;
        format!("{}={}", definition.name, quote(text))
    };
    Ok(Chosen {
        id: &definition.name,
        slot: Slot::Env,
        secret: definition.secret,
        excludes: &definition.excludes,
        requires: &definition.requires,
        risks: &definition.risks,
        versions: definition.versions.as_ref(),
        piece,
    })
}

fn required_value<'a>(id: &str, value: Option<&'a str>) -> Result<&'a str, CommandError> {
    value
        .filter(|text| !text.is_empty())
        .ok_or_else(|| CommandError::MissingValue(id.to_owned()))
}

fn check_value_text(
    id: &str,
    text: &str,
    value_type: ValueType,
    allowed: &[String],
) -> Result<(), CommandError> {
    let invalid = |reason| CommandError::InvalidValue {
        item: id.to_owned(),
        reason,
    };
    check_value(text).map_err(|problem| {
        invalid(match problem {
            ValueProblem::ControlCharacter => ValueReason::ControlCharacter,
            ValueProblem::TooLong => ValueReason::TooLong,
        })
    })?;
    match value_type {
        ValueType::Enum if !allowed.iter().any(|value| value.as_str() == text) => {
            Err(invalid(ValueReason::NotInAllowedValues))
        }
        ValueType::Number if !text.parse::<f64>().is_ok_and(f64::is_finite) => {
            Err(invalid(ValueReason::NotANumber))
        }
        _ => Ok(()),
    }
}

fn check_relations(chosen: &[Chosen<'_>]) -> Result<(), CommandError> {
    for item in chosen {
        for other in chosen {
            if item.id == other.id {
                continue;
            }
            let excluded = item.excludes.iter().any(|name| name.as_str() == other.id)
                || other.excludes.iter().any(|name| name.as_str() == item.id);
            if excluded {
                return Err(CommandError::Excluded {
                    item: item.id.to_owned(),
                    other: other.id.to_owned(),
                });
            }
        }
        for required in item.requires {
            if !chosen.iter().any(|other| other.id == required.as_str()) {
                return Err(CommandError::RequiresMissing {
                    item: item.id.to_owned(),
                    required: required.clone(),
                });
            }
        }
    }
    Ok(())
}

fn check_risks(chosen: &[Chosen<'_>], acknowledged: &[String]) -> Result<(), CommandError> {
    for item in chosen {
        let confirmed = acknowledged.iter().any(|name| name.as_str() == item.id);
        if !item.risks.is_empty() && !confirmed {
            return Err(CommandError::RiskNotAcknowledged(item.id.to_owned()));
        }
    }
    Ok(())
}

fn notice(item: &Chosen<'_>, detected: Option<&[u64]>, detected_text: Option<&str>) -> ItemNotice {
    let (status, message) = match item.versions {
        None => (VersionStatus::NotStated, "文档未给出版本要求。".to_owned()),
        Some(range) => match parse_version(&range.min) {
            None => (
                VersionStatus::Unconfirmed,
                "版本要求无法解析，未确认。".to_owned(),
            ),
            Some(minimum) => match detected {
                None => (
                    VersionStatus::Unconfirmed,
                    format!(
                        "需要 Claude Code {} 或更高版本；本机版本未确认。",
                        range.min
                    ),
                ),
                Some(found) => {
                    let below = compare_versions(found, &minimum) == Ordering::Less;
                    let above = parse_version(&range.max).is_some_and(|maximum| {
                        compare_versions(found, &maximum) == Ordering::Greater
                    });
                    if below || above {
                        (
                            VersionStatus::Incompatible,
                            format!(
                                "本机版本 {} 不满足该项要求（需要 {} 或更高版本）。",
                                detected_text.unwrap_or_default(),
                                range.min
                            ),
                        )
                    } else {
                        (
                            VersionStatus::Compatible,
                            "本机版本满足该项要求。".to_owned(),
                        )
                    }
                }
            },
        },
    };
    ItemNotice {
        id: item.id.to_owned(),
        status,
        message,
    }
}

fn compare_versions(left: &[u64], right: &[u64]) -> Ordering {
    let width = left.len().max(right.len());
    for index in 0..width {
        let order = left
            .get(index)
            .copied()
            .unwrap_or(0)
            .cmp(&right.get(index).copied().unwrap_or(0));
        if order != Ordering::Equal {
            return order;
        }
    }
    Ordering::Equal
}

fn render(chosen: &[Chosen<'_>]) -> String {
    let mut parts: Vec<&str> = chosen
        .iter()
        .filter(|item| item.slot == Slot::Env)
        .map(|item| item.piece.as_str())
        .collect();
    parts.push("claude");
    parts.extend(
        chosen
            .iter()
            .filter(|item| item.slot == Slot::Flag)
            .map(|item| item.piece.as_str()),
    );
    parts.join(" ")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRange {
    pub min: String,
    pub max: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionItem {
    pub id: String,
    pub kind: &'static str,
    pub value_type: &'static str,
    pub allowed_values: Vec<String>,
    pub description: String,
    pub generatable: bool,
    pub secret: bool,
    pub single_invocation: Option<bool>,
    pub excludes: Vec<String>,
    pub requires: Vec<String>,
    pub risks: Vec<&'static str>,
    pub versions: Option<VersionRange>,
    pub config_alternative: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionSummary {
    pub items: Vec<OptionItem>,
    pub coverage_note: &'static str,
}

pub fn option_summary(tool: &ToolDefinition) -> OptionSummary {
    let flags = tool.flags.iter().map(|flag| OptionItem {
        id: flag.id.clone(),
        kind: "flag",
        value_type: value_type_key(flag.value_type),
        allowed_values: flag.allowed_values.clone(),
        description: flag.description.clone(),
        generatable: flag.value_type != ValueType::Unknown,
        secret: false,
        single_invocation: Some(flag.single_invocation),
        excludes: flag.excludes.clone(),
        requires: flag.requires.clone(),
        risks: flag.risks.iter().map(|risk| risk_key(*risk)).collect(),
        versions: version_range(flag.versions.as_ref()),
        config_alternative: None,
    });
    let env = tool.env.iter().map(|env| OptionItem {
        id: env.name.clone(),
        kind: "env",
        value_type: value_type_key(env.value_type),
        allowed_values: env.allowed_values.clone(),
        description: env.description.clone(),
        generatable: env.value_type != ValueType::Unknown,
        secret: env.secret,
        single_invocation: None,
        excludes: env.excludes.clone(),
        requires: env.requires.clone(),
        risks: env.risks.iter().map(|risk| risk_key(*risk)).collect(),
        versions: version_range(env.versions.as_ref()),
        config_alternative: env.config_alternative.clone(),
    });
    OptionSummary {
        items: flags.chain(env).collect(),
        coverage_note: COVERAGE_NOTE,
    }
}

fn version_range(versions: Option<&VerifiedVersions>) -> Option<VersionRange> {
    versions.map(|range| VersionRange {
        min: range.min.clone(),
        max: range.max.clone(),
    })
}

fn value_type_key(value_type: ValueType) -> &'static str {
    match value_type {
        ValueType::String => "string",
        ValueType::Boolean => "boolean",
        ValueType::Number => "number",
        ValueType::StringArray => "stringArray",
        ValueType::Object => "object",
        ValueType::Enum => "enum",
        ValueType::Unknown => "unknown",
    }
}

fn risk_key(risk: RiskFlag) -> &'static str {
    match risk {
        RiskFlag::ExecutesCommand => "executesCommand",
        RiskFlag::RelaxesPermissions => "relaxesPermissions",
        RiskFlag::ExternalServer => "externalServer",
    }
}

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;
