//! Hard-coded field schemas for the writable application configs. Nothing here
//! is loaded or fetched at runtime; every field is a reviewed constant.

use serde::Serialize;
use serde_json::Value;

use super::registry::Format;

const MAX_TEXT_CHARS: usize = 256;
const BRANCH_CHARSET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._/-";

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    String,
    Bool,
    Integer,
    Number,
    Enum,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FieldPattern {
    /// Exactly one `separator`, with text on both sides and no whitespace.
    ContainsSeparator { separator: char },
    /// Every character must appear in `allowed`.
    Charset { allowed: &'static str },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSpec {
    pub path: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub kind: FieldKind,
    pub enum_values: &'static [&'static str],
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub pattern: Option<FieldPattern>,
    pub default: Option<&'static str>,
    pub sensitive: bool,
}

const fn field(
    path: &'static str,
    label: &'static str,
    description: &'static str,
    kind: FieldKind,
) -> FieldSpec {
    FieldSpec {
        path,
        label,
        description,
        kind,
        enum_values: &[],
        min: None,
        max: None,
        pattern: None,
        default: None,
        sensitive: false,
    }
}

const GIT_FIELDS: &[FieldSpec] = &[
    field(
        "user.name",
        "提交作者名",
        "每次提交时记录的作者名称。",
        FieldKind::String,
    ),
    FieldSpec {
        pattern: Some(FieldPattern::ContainsSeparator { separator: '@' }),
        ..field(
            "user.email",
            "提交作者邮箱",
            "每次提交时记录的作者邮箱地址。",
            FieldKind::String,
        )
    },
    FieldSpec {
        pattern: Some(FieldPattern::Charset {
            allowed: BRANCH_CHARSET,
        }),
        default: Some("未设置时 Git 使用 master"),
        ..field(
            "init.defaultBranch",
            "新仓库默认分支",
            "执行 git init 时创建的初始分支名。",
            FieldKind::String,
        )
    },
    field(
        "core.editor",
        "默认编辑器命令",
        "Git 需要编辑文本时调用的命令，例如 code --wait。",
        FieldKind::String,
    ),
    FieldSpec {
        enum_values: &["true", "false", "input"],
        default: Some("未设置时为 false"),
        ..field(
            "core.autocrlf",
            "换行符转换",
            "提交与检出时如何转换换行符。",
            FieldKind::Enum,
        )
    },
    FieldSpec {
        default: Some("未设置时为 false"),
        ..field(
            "pull.rebase",
            "拉取时变基",
            "git pull 默认使用变基而不是合并。",
            FieldKind::Bool,
        )
    },
    FieldSpec {
        default: Some("未设置时为 false"),
        ..field(
            "push.autoSetupRemote",
            "推送时自动设置上游",
            "首次推送新分支时自动建立远程跟踪关系。",
            FieldKind::Bool,
        )
    },
    FieldSpec {
        default: Some("未设置时为 false"),
        ..field(
            "fetch.prune",
            "拉取时清理远程分支",
            "拉取时删除本地已不存在于远程的跟踪分支。",
            FieldKind::Bool,
        )
    },
    FieldSpec {
        default: Some("未设置时为 false"),
        ..field(
            "commit.gpgsign",
            "提交时签名",
            "默认对每次提交做 GPG 签名。",
            FieldKind::Bool,
        )
    },
    FieldSpec {
        enum_values: &["auto", "always", "false"],
        default: Some("未设置时为 auto"),
        ..field(
            "color.ui",
            "终端颜色输出",
            "Git 命令输出是否使用颜色。",
            FieldKind::Enum,
        )
    },
];

const ALACRITTY_FIELDS: &[FieldSpec] = &[
    FieldSpec {
        min: Some(0.0),
        max: Some(1.0),
        default: Some("未设置时为 1.0"),
        ..field(
            "window.opacity",
            "窗口不透明度",
            "0 为完全透明，1 为不透明。",
            FieldKind::Number,
        )
    },
    FieldSpec {
        enum_values: &["Full", "None", "Transparent", "Buttonless"],
        ..field(
            "window.decorations",
            "窗口边框样式",
            "窗口标题栏与边框的显示方式。",
            FieldKind::Enum,
        )
    },
    FieldSpec {
        min: Some(4.0),
        max: Some(72.0),
        ..field(
            "font.size",
            "字号",
            "终端文字的字号，单位为点。",
            FieldKind::Number,
        )
    },
    field(
        "font.normal.family",
        "普通字体",
        "终端普通文字使用的字体族名称。",
        FieldKind::String,
    ),
    FieldSpec {
        min: Some(0.0),
        max: Some(100000.0),
        ..field(
            "scrolling.history",
            "回滚行数",
            "保留在屏幕上方的历史行数。",
            FieldKind::Integer,
        )
    },
    FieldSpec {
        enum_values: &["Block", "Underline", "Beam"],
        default: Some("未设置时为 Block"),
        ..field(
            "cursor.style.shape",
            "光标形状",
            "终端光标的显示形状。",
            FieldKind::Enum,
        )
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSchema {
    pub visual_supported: bool,
    pub advanced_supported: bool,
    pub format_label: &'static str,
    pub fields: &'static [FieldSpec],
}

/// Schemas exist only for writable entries. The Zed entry is advanced-only:
/// JSONC comments do not survive a structured rewrite.
pub fn schema_for(entry_id: &str, format: Format) -> Option<EditSchema> {
    let fields: &'static [FieldSpec] = match entry_id {
        "git-config-home" | "git-config-xdg" => GIT_FIELDS,
        "alacritty-config" => ALACRITTY_FIELDS,
        "zed-settings" => &[],
        _ => return None,
    };
    Some(EditSchema {
        visual_supported: entry_id != "zed-settings",
        advanced_supported: true,
        format_label: format_label(format),
        fields,
    })
}

pub fn format_label(format: Format) -> &'static str {
    match format {
        Format::Ini => "INI（Git 配置格式）",
        Format::Toml => "TOML",
        Format::Jsonc => "JSONC（允许注释的 JSON）",
        Format::Json => "JSON",
        Format::Plist => "属性列表",
        Format::Dotenv => "环境变量文件",
        Format::Text => "纯文本",
    }
}

/// A validated, typed value ready to render into a file.
#[derive(Debug, Clone, PartialEq)]
pub enum TypedValue {
    Text(String),
    Bool(bool),
    Integer(i64),
    Number(f64),
}

/// Checks one proposed JSON value against its field. A `null` is a deletion and
/// is handled by the caller before this runs. Messages never echo the value.
pub fn typed_value(field: &FieldSpec, value: &Value) -> Result<TypedValue, String> {
    match field.kind {
        FieldKind::String => text_value(field, value).map(TypedValue::Text),
        FieldKind::Enum => {
            let text = value
                .as_str()
                .ok_or_else(|| "应为文本，请从可选项中选择。".to_owned())?;
            if field.enum_values.contains(&text) {
                Ok(TypedValue::Text(text.to_owned()))
            } else {
                Err("取值不在可选列表中，请从可选项中选择。".to_owned())
            }
        }
        FieldKind::Bool => value
            .as_bool()
            .map(TypedValue::Bool)
            .ok_or_else(|| "应为 true 或 false。".to_owned()),
        FieldKind::Integer => {
            let number = finite_number(value)?;
            if number.fract() != 0.0 {
                return Err("应为整数，不能包含小数。".to_owned());
            }
            check_range(field, number)?;
            Ok(TypedValue::Integer(number as i64))
        }
        FieldKind::Number => {
            let number = finite_number(value)?;
            check_range(field, number)?;
            Ok(TypedValue::Number(number))
        }
    }
}

fn text_value(field: &FieldSpec, value: &Value) -> Result<String, String> {
    let text = value
        .as_str()
        .ok_or_else(|| "应为文本。".to_owned())?;
    if text.trim().is_empty()
        || text.chars().count() > MAX_TEXT_CHARS
        || text.chars().any(char::is_control)
    {
        return Err(format!(
            "应为非空文本，不超过 {MAX_TEXT_CHARS} 个字符，且不含控制字符。"
        ));
    }
    match field.pattern {
        Some(FieldPattern::ContainsSeparator { separator }) => {
            let mut parts = text.splitn(2, separator);
            let before = parts.next().unwrap_or_default();
            let after = parts.next();
            let valid = after.is_some_and(|after| {
                !before.is_empty()
                    && !after.is_empty()
                    && !after.contains(separator)
                    && !text.chars().any(char::is_whitespace)
            });
            if !valid {
                return Err(format!(
                    "格式不正确，需要包含一个 {separator}，前后都有内容，且中间不能有空格。"
                ));
            }
        }
        Some(FieldPattern::Charset { allowed }) => {
            if !text.chars().all(|c| allowed.contains(c)) {
                return Err("包含不允许的字符，请只使用字母、数字和 . _ / - 。".to_owned());
            }
        }
        None => {}
    }
    Ok(text.to_owned())
}

fn finite_number(value: &Value) -> Result<f64, String> {
    value
        .as_f64()
        .filter(|number| number.is_finite())
        .ok_or_else(|| "应为数字。".to_owned())
}

fn check_range(field: &FieldSpec, number: f64) -> Result<(), String> {
    let below = field.min.is_some_and(|min| number < min);
    let above = field.max.is_some_and(|max| number > max);
    if below || above {
        let min = field.min.map_or_else(|| "无下限".to_owned(), |min| min.to_string());
        let max = field.max.map_or_else(|| "无上限".to_owned(), |max| max.to_string());
        return Err(format!("超出允许范围（{min} 到 {max}）。"));
    }
    Ok(())
}
