use std::cmp::Ordering;
use std::collections::{BTreeSet, HashSet};

use super::registry::{
    BUILTIN_DEFINITIONS_JSON, CLAUDE_CODE_DEFINITIONS_JSON, CoverageStatus,
    DEFINITION_SCHEMA_VERSION, Definitions, EnvDefinition, FlagDefinition, IssueKind,
    RegistryError, ResourceDefinition, SettingDefinition, SourceRef, ToolDefinition,
    ValidationIssue, ValueType, VerifiedVersions, parse_definitions,
};

pub const UNKNOWN_DOCUMENTED_VERSION: &str = "unknown";
const MAX_ITEM_LENGTH: usize = 128;
const MAX_VERSION_COMPONENTS: usize = 4;

pub fn load_builtin() -> Result<Definitions, RegistryError> {
    load_validated(BUILTIN_DEFINITIONS_JSON)
}

pub fn load_all() -> Result<Definitions, RegistryError> {
    let mut merged = parse_definitions(BUILTIN_DEFINITIONS_JSON)?;
    merged
        .tools
        .extend(parse_definitions(CLAUDE_CODE_DEFINITIONS_JSON)?.tools);
    validate(&merged)?;
    Ok(merged)
}

pub fn load_validated(json: &str) -> Result<Definitions, RegistryError> {
    let definitions = parse_definitions(json)?;
    validate(&definitions)?;
    Ok(definitions)
}

pub fn validate(definitions: &Definitions) -> Result<(), RegistryError> {
    let mut issues = Vec::new();
    if definitions.schema_version != DEFINITION_SCHEMA_VERSION {
        push(
            &mut issues,
            "schemaVersion",
            IssueKind::UnsupportedSchemaVersion,
        );
    }
    unique(
        &mut issues,
        "tools",
        definitions.tools.iter().map(|tool| tool.id.as_str()),
        IssueKind::DuplicateToolId,
    );
    for tool in &definitions.tools {
        validate_tool(&mut issues, tool);
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(RegistryError::Invalid(issues))
    }
}

fn validate_tool(issues: &mut Vec<ValidationIssue>, tool: &ToolDefinition) {
    let base = format!("tools[{}]", tool.id);
    check_id(issues, &base, &tool.id);
    check_text(issues, &format!("{base}.displayName"), &tool.display_name);
    if tool.executable_names.is_empty() {
        push(
            issues,
            format!("{base}.executableNames"),
            IssueKind::InvalidExecutableName,
        );
    }
    for name in &tool.executable_names {
        if !is_valid_executable_name(name) {
            push(
                issues,
                format!("{base}.executableNames[{name}]"),
                IssueKind::InvalidExecutableName,
            );
        }
    }
    validate_source(issues, &format!("{base}.source"), &tool.source);

    unique(
        issues,
        &format!("{base}.resources"),
        tool.resources.iter().map(|resource| resource.id.as_str()),
        IssueKind::DuplicateItemId,
    );
    for resource in &tool.resources {
        validate_resource(
            issues,
            &format!("{base}.resources[{}]", resource.id),
            resource,
        );
    }

    unique(
        issues,
        &format!("{base}.settings"),
        tool.settings.iter().map(|setting| setting.id.as_str()),
        IssueKind::DuplicateItemId,
    );
    for setting in &tool.settings {
        validate_setting(issues, &format!("{base}.settings[{}]", setting.id), setting);
    }

    let flag_ids = unique(
        issues,
        &format!("{base}.flags"),
        tool.flags.iter().map(|flag| flag.id.as_str()),
        IssueKind::DuplicateItemId,
    );
    for flag in &tool.flags {
        validate_flag(
            issues,
            &format!("{base}.flags[{}]", flag.id),
            flag,
            &flag_ids,
        );
    }

    let env_names = unique(
        issues,
        &format!("{base}.env"),
        tool.env.iter().map(|env| env.name.as_str()),
        IssueKind::DuplicateItemId,
    );
    for env in &tool.env {
        validate_env(
            issues,
            &format!("{base}.env[{}]", env.name),
            env,
            &env_names,
        );
    }
}

fn validate_resource(issues: &mut Vec<ValidationIssue>, base: &str, resource: &ResourceDefinition) {
    check_id(issues, base, &resource.id);
    if !is_valid_location(&resource.location) {
        push(
            issues,
            format!("{base}.location"),
            IssueKind::InvalidLocation,
        );
    }
    check_text(
        issues,
        &format!("{base}.description"),
        &resource.description,
    );
    check_versions(issues, base, resource.coverage, resource.versions.as_ref());
    validate_source(issues, &format!("{base}.source"), &resource.source);
}

fn validate_setting(issues: &mut Vec<ValidationIssue>, base: &str, setting: &SettingDefinition) {
    check_id(issues, base, &setting.id);
    if !is_valid_key_path(&setting.key_path) {
        push(issues, format!("{base}.keyPath"), IssueKind::InvalidId);
    }
    check_text(issues, &format!("{base}.description"), &setting.description);
    check_text(
        issues,
        &format!("{base}.defaultNote"),
        &setting.default_note,
    );
    check_text(issues, &format!("{base}.mergeRule"), &setting.merge_rule);
    check_allowed_values(issues, base, setting.value_type, &setting.allowed_values);
    check_value_type_coverage(issues, base, setting.value_type, setting.coverage);
    check_versions(issues, base, setting.coverage, setting.versions.as_ref());
    validate_source(issues, &format!("{base}.source"), &setting.source);
}

fn validate_flag(
    issues: &mut Vec<ValidationIssue>,
    base: &str,
    flag: &FlagDefinition,
    known: &HashSet<&str>,
) {
    check_id(issues, base, &flag.id);
    check_text(issues, &format!("{base}.description"), &flag.description);
    check_allowed_values(issues, base, flag.value_type, &flag.allowed_values);
    check_value_type_coverage(issues, base, flag.value_type, flag.coverage);
    check_references(issues, base, "excludes", &flag.id, &flag.excludes, known);
    check_references(issues, base, "requires", &flag.id, &flag.requires, known);
    check_versions(issues, base, flag.coverage, flag.versions.as_ref());
    validate_source(issues, &format!("{base}.source"), &flag.source);
}

fn validate_env(
    issues: &mut Vec<ValidationIssue>,
    base: &str,
    env: &EnvDefinition,
    known: &HashSet<&str>,
) {
    if !is_valid_env_name(&env.name) {
        push(issues, format!("{base}.name"), IssueKind::InvalidEnvName);
    }
    check_text(issues, &format!("{base}.description"), &env.description);
    check_allowed_values(issues, base, env.value_type, &env.allowed_values);
    check_value_type_coverage(issues, base, env.value_type, env.coverage);
    if let Some(alternative) = &env.config_alternative {
        check_text(issues, &format!("{base}.configAlternative"), alternative);
    }
    check_references(issues, base, "excludes", &env.name, &env.excludes, known);
    check_references(issues, base, "requires", &env.name, &env.requires, known);
    check_versions(issues, base, env.coverage, env.versions.as_ref());
    validate_source(issues, &format!("{base}.source"), &env.source);
}

fn validate_source(issues: &mut Vec<ValidationIssue>, base: &str, source: &SourceRef) {
    if !is_https_url(&source.url) {
        push(issues, format!("{base}.url"), IssueKind::InvalidSourceUrl);
    }
    if !is_valid_date(&source.retrieved_on) {
        push(
            issues,
            format!("{base}.retrievedOn"),
            IssueKind::InvalidRetrievedOn,
        );
    }
    if source.documented_version != UNKNOWN_DOCUMENTED_VERSION
        && parse_version(&source.documented_version).is_none()
    {
        push(
            issues,
            format!("{base}.documentedVersion"),
            IssueKind::InvalidDocumentedVersion,
        );
    }
}

fn check_versions(
    issues: &mut Vec<ValidationIssue>,
    base: &str,
    coverage: CoverageStatus,
    versions: Option<&VerifiedVersions>,
) {
    if coverage == CoverageStatus::Editable && versions.is_none() {
        push(
            issues,
            format!("{base}.versions"),
            IssueKind::MissingVersions,
        );
    }
}

fn check_value_type_coverage(
    issues: &mut Vec<ValidationIssue>,
    base: &str,
    value_type: ValueType,
    coverage: CoverageStatus,
) {
    if value_type == ValueType::Unknown
        && !matches!(
            coverage,
            CoverageStatus::DisplayOnly | CoverageStatus::VersionUnknown
        )
    {
        push(
            issues,
            format!("{base}.coverage"),
            IssueKind::UnverifiedValueType,
        );
    }
}

fn check_allowed_values(
    issues: &mut Vec<ValidationIssue>,
    base: &str,
    value_type: ValueType,
    values: &[String],
) {
    if value_type == ValueType::Enum && values.is_empty() {
        push(
            issues,
            format!("{base}.allowedValues"),
            IssueKind::EnumWithoutValues,
        );
    }
}

fn check_references(
    issues: &mut Vec<ValidationIssue>,
    base: &str,
    field: &str,
    own: &str,
    references: &[String],
    known: &HashSet<&str>,
) {
    for reference in references {
        let path = format!("{base}.{field}[{reference}]");
        if reference == own {
            push(issues, path, IssueKind::SelfReference);
        } else if !known.contains(reference.as_str()) {
            push(issues, path, IssueKind::UnknownReference);
        }
    }
}

fn check_id(issues: &mut Vec<ValidationIssue>, base: &str, id: &str) {
    if !is_valid_id(id) {
        push(issues, format!("{base}.id"), IssueKind::InvalidId);
    }
}

fn check_text(issues: &mut Vec<ValidationIssue>, path: &str, text: &str) {
    if text.trim().is_empty() {
        push(issues, path, IssueKind::EmptyText);
    }
}

fn unique<'a>(
    issues: &mut Vec<ValidationIssue>,
    base: &str,
    ids: impl Iterator<Item = &'a str>,
    duplicate: IssueKind,
) -> HashSet<&'a str> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            push(issues, format!("{base}[{id}]"), duplicate);
        }
    }
    seen
}

fn push(issues: &mut Vec<ValidationIssue>, path: impl Into<String>, kind: IssueKind) {
    issues.push(ValidationIssue {
        path: path.into(),
        kind,
    });
}

fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ITEM_LENGTH
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn is_valid_key_path(key_path: &str) -> bool {
    key_path.len() <= MAX_ITEM_LENGTH && key_path.split('.').all(is_valid_id)
}

fn is_valid_executable_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_ITEM_LENGTH
        && !name.contains('/')
        && !name.chars().any(char::is_whitespace)
}

fn is_valid_env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_ITEM_LENGTH
        && name.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_uppercase() || byte == b'_' || (index > 0 && byte.is_ascii_digit())
        })
}

fn is_https_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or("");
    !host.is_empty() && !url.chars().any(char::is_whitespace)
}

fn is_valid_location(location: &str) -> bool {
    if !location.starts_with('{')
        || location.starts_with('/')
        || location.starts_with('~')
        || location.contains("..")
    {
        return false;
    }
    let mut rest = location;
    while let Some(start) = rest.find('{') {
        let Some(length) = rest[start..].find('}') else {
            return false;
        };
        let name = &rest[start + 1..start + length];
        if !matches!(name, "home" | "project" | "managed") {
            return false;
        }
        rest = &rest[start + length + 1..];
    }
    !rest.contains('}')
}

fn all_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_valid_date(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    let [year, month, day] = parts.as_slice() else {
        return false;
    };
    if year.len() != 4 || month.len() != 2 || day.len() != 2 {
        return false;
    }
    if ![year, month, day].iter().all(|part| all_digits(part)) {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        year.parse::<u32>(),
        month.parse::<u32>(),
        day.parse::<u32>(),
    ) else {
        return false;
    };
    (1..=12).contains(&month) && (1..=days_in_month(year, month)).contains(&day)
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if is_leap_year(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

pub fn parse_version(text: &str) -> Option<Vec<u64>> {
    let components: Vec<&str> = text.split('.').collect();
    if components.len() > MAX_VERSION_COMPONENTS {
        return None;
    }
    components
        .iter()
        .map(|component| {
            if all_digits(component) {
                component.parse::<u64>().ok()
            } else {
                None
            }
        })
        .collect()
}

fn compare_versions(left: &[u64], right: &[u64]) -> Ordering {
    let width = left.len().max(right.len());
    for index in 0..width {
        let ordering = component(left, index).cmp(&component(right, index));
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    Ordering::Equal
}

fn component(version: &[u64], index: usize) -> u64 {
    version.get(index).copied().unwrap_or(0)
}

pub fn effective_status(
    status: CoverageStatus,
    versions: Option<&VerifiedVersions>,
    detected: Option<&str>,
) -> CoverageStatus {
    if status != CoverageStatus::Editable {
        return status;
    }
    let Some(range) = versions else {
        return CoverageStatus::DisplayOnly;
    };
    let (Some(min), Some(max)) = (parse_version(&range.min), parse_version(&range.max)) else {
        return CoverageStatus::DisplayOnly;
    };
    if compare_versions(&min, &max) == Ordering::Greater {
        return CoverageStatus::DisplayOnly;
    }
    let Some(current) = detected.and_then(parse_version) else {
        return CoverageStatus::VersionUnknown;
    };
    if compare_versions(&current, &min) != Ordering::Less
        && compare_versions(&current, &max) != Ordering::Greater
    {
        CoverageStatus::Editable
    } else {
        CoverageStatus::DisplayOnly
    }
}

pub fn coverage_key(tool_id: &str, kind: &str, item_id: &str) -> String {
    format!("{tool_id}/{kind}/{item_id}")
}

pub fn covered_ids(definitions: &Definitions) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for tool in &definitions.tools {
        for resource in &tool.resources {
            ids.insert(coverage_key(&tool.id, "resource", &resource.id));
        }
        for setting in &tool.settings {
            ids.insert(coverage_key(&tool.id, "setting", &setting.id));
        }
        for flag in &tool.flags {
            ids.insert(coverage_key(&tool.id, "flag", &flag.id));
        }
        for env in &tool.env {
            ids.insert(coverage_key(&tool.id, "env", &env.name));
        }
    }
    ids
}

pub fn check_coverage(snapshot_ids: &[&str], definitions: &Definitions) -> Vec<String> {
    let covered = covered_ids(definitions);
    let missing: BTreeSet<String> = snapshot_ids
        .iter()
        .filter(|id| !covered.contains(**id))
        .map(|id| (*id).to_owned())
        .collect();
    missing.into_iter().collect()
}

#[cfg(test)]
#[path = "validate_tests.rs"]
mod tests;
