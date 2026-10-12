use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    time::{Duration, Instant, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    config::formats::parse_json_document,
    error::AppError,
    security::paths::{PathPolicyError, resolve_rooted_catalog_path},
    settings::discovery_exclusions::DiscoveryExclusions,
};

use super::{
    ApplicationProfile, DocumentFormat, DocumentPath, DocumentRule, FieldDefinition, ProfileSource,
    ViewKind,
};

pub const MAX_DEPTH: usize = 8;
pub const MAX_ENTRIES: usize = 1024;
pub const MAX_FILES: usize = 256;
const SCAN_BUDGET: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResourceState {
    Missing,
    Excluded,
    Present,
    Ready,
    Invalid,
    TooLarge,
    PermissionDenied,
    UnsafeSymlink,
    IoError,
    DepthLimit,
    EntryLimit,
    FileLimit,
    Timeout,
}

impl ResourceState {
    fn from_io(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::Missing,
            io::ErrorKind::PermissionDenied => Self::PermissionDenied,
            _ => Self::IoError,
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Missing => "配置文件或目录不存在。",
            Self::Excluded => "部分配置已按排除规则隐藏。",
            Self::Present => "文件存在，尚未读取正文。",
            Self::Ready => "已读取配置。",
            Self::Invalid => "配置内容或文件类型无效。",
            Self::TooLarge => "配置超过 256 KiB 读取上限。",
            Self::PermissionDenied => "没有读取配置的权限。",
            Self::UnsafeSymlink => "符号链接不在允许的配置范围内，未读取。",
            Self::IoError => "配置读取失败，请重试。",
            Self::DepthLimit => "指令扫描达到 8 层深度上限，结果不完整。",
            Self::EntryLimit => "指令扫描达到 1024 个目录项上限，结果不完整。",
            Self::FileLimit => "指令扫描达到 256 个文件上限，结果不完整。",
            Self::Timeout => "指令扫描超时，结果不完整。",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceIssue {
    pub code: ResourceState,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationApp {
    pub app_id: String,
    pub display_name: String,
    pub display_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationAppsResult {
    pub applications: Vec<ConfigurationApp>,
    pub searched_paths: Vec<String>,
    pub issues: Vec<ResourceIssue>,
    pub empty_reason: Option<ResourceState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationResourceSummary {
    pub app_id: String,
    pub resource_id: String,
    pub rule_id: String,
    pub label: String,
    pub description: String,
    pub display_path: String,
    pub view_kind: ViewKind,
    pub format: DocumentFormat,
    pub state: ResourceState,
    pub size_bytes: Option<u64>,
    pub modified_at_epoch_ms: Option<u64>,
    pub source: ProfileSource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationResourcesResult {
    pub resources: Vec<ConfigurationResourceSummary>,
    pub issues: Vec<ResourceIssue>,
    pub partial: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CurrentFieldValue {
    Unset,
    Value { value: Value },
    Invalid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationField {
    #[serde(flatten)]
    pub definition: FieldDefinition,
    pub current: CurrentFieldValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationResourceView {
    pub summary: ConfigurationResourceSummary,
    pub fields: Vec<ConfigurationField>,
    pub content: Option<String>,
    pub unknown_field_count: usize,
}

fn issue(code: ResourceState) -> ResourceIssue {
    ResourceIssue {
        code,
        message: code.message().to_owned(),
    }
}

fn path_state(error: PathPolicyError) -> ResourceState {
    match error {
        PathPolicyError::NotFound => ResourceState::Missing,
        PathPolicyError::PermissionDenied => ResourceState::PermissionDenied,
        PathPolicyError::Io => ResourceState::IoError,
        PathPolicyError::OutsideAuthorizedRoot | PathPolicyError::UnsupportedEntry => {
            ResourceState::UnsafeSymlink
        }
    }
}

fn checked_home(home: &Path) -> Result<PathBuf, AppError> {
    fs::canonicalize(home)
        .map_err(|_| AppError::permission_denied("用户目录无法解析，未读取配置。"))
}

fn app_root(
    profile: &ApplicationProfile,
    home: &Path,
    rules: &DiscoveryExclusions,
) -> Result<PathBuf, ResourceState> {
    if rules.excludes(Path::new(&profile.root)) {
        return Err(ResourceState::Excluded);
    }
    let resolved = resolve_rooted_catalog_path(home, &profile.root, "~").map_err(path_state)?;
    let metadata = fs::metadata(&resolved.target_path).map_err(ResourceState::from_io)?;
    if !metadata.is_dir() {
        return Err(ResourceState::Invalid);
    }
    if resolved
        .target_path
        .strip_prefix(home)
        .is_ok_and(|relative| rules.excludes(relative))
    {
        return Err(ResourceState::Excluded);
    }
    Ok(resolved.target_path)
}

pub fn discover_applications(
    profiles: &[ApplicationProfile],
    home: &Path,
    rules: &DiscoveryExclusions,
) -> Result<ConfigurationAppsResult, AppError> {
    rules.validate()?;
    let home = checked_home(home)?;
    let mut result = ConfigurationAppsResult {
        applications: Vec::new(),
        searched_paths: profiles
            .iter()
            .map(|profile| format!("~/{}", profile.root))
            .collect(),
        issues: Vec::new(),
        empty_reason: Some(ResourceState::Missing),
    };
    for profile in profiles {
        match app_root(profile, &home, rules) {
            Ok(_) => result.applications.push(ConfigurationApp {
                app_id: profile.app_id.clone(),
                display_name: profile.display_name.clone(),
                display_path: format!("~/{}", profile.root),
            }),
            Err(ResourceState::Missing) => {}
            Err(ResourceState::Excluded) => result.empty_reason = Some(ResourceState::Excluded),
            Err(state) => result.issues.push(issue(state)),
        }
    }
    if !result.applications.is_empty() || !result.issues.is_empty() {
        result.empty_reason = None;
    }
    Ok(result)
}

struct Candidate {
    summary: ConfigurationResourceSummary,
    relative_path: String,
}

struct ResourceScan<'a> {
    profile: &'a ApplicationProfile,
    home: &'a Path,
    root: &'a Path,
    exclusions: &'a DiscoveryExclusions,
    candidates: Vec<Candidate>,
    issues: Vec<ResourceIssue>,
    started: Instant,
    entries: usize,
    files: usize,
}

impl ResourceScan<'_> {
    fn record(&mut self, code: ResourceState) {
        if !self.issues.iter().any(|item| item.code == code) {
            self.issues.push(issue(code));
        }
    }

    fn excluded(&self, relative: &str) -> bool {
        self.exclusions
            .excludes(&Path::new(&self.profile.root).join(relative))
    }

    fn target(&self, relative: &str) -> Result<PathBuf, ResourceState> {
        if self.excluded(relative) {
            return Err(ResourceState::Excluded);
        }
        let resolved =
            resolve_rooted_catalog_path(self.root, relative, &format!("~/{}", self.profile.root))
                .map_err(path_state)?;
        if resolved
            .target_path
            .strip_prefix(self.home)
            .is_ok_and(|relative| self.exclusions.excludes(relative))
        {
            return Err(ResourceState::Excluded);
        }
        Ok(resolved.target_path)
    }

    fn add(&mut self, rule: &DocumentRule, relative: String) {
        let mut hash = Sha256::new();
        for part in [
            &self.profile.app_id,
            &rule.id,
            &format!("{}/{}", self.profile.root, relative),
        ] {
            hash.update(part.as_bytes());
            hash.update(b"\0");
        }
        let source = self
            .profile
            .sources
            .iter()
            .find(|source| source.id == rule.source_id)
            .expect("validated profile source")
            .clone();
        let mut summary = ConfigurationResourceSummary {
            app_id: self.profile.app_id.clone(),
            resource_id: format!("{:x}", hash.finalize()),
            rule_id: rule.id.clone(),
            label: if matches!(rule.path, DocumentPath::Collection { .. }) {
                relative.clone()
            } else {
                rule.label.clone()
            },
            description: rule.description.clone(),
            display_path: format!("~/{}/{}", self.profile.root, relative),
            view_kind: rule.view_kind,
            format: rule.format,
            state: ResourceState::Present,
            size_bytes: None,
            modified_at_epoch_ms: None,
            source,
        };
        match self.target(&relative) {
            Ok(path) => match fs::metadata(path) {
                Ok(metadata) if metadata.is_file() => {
                    summary.size_bytes = Some(metadata.len());
                    summary.modified_at_epoch_ms = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .and_then(|duration| u64::try_from(duration.as_millis()).ok());
                    if rule.view_kind != ViewKind::Metadata
                        && metadata.len() > rule.max_size_bytes as u64
                    {
                        summary.state = ResourceState::TooLarge;
                    }
                }
                Ok(_) => summary.state = ResourceState::Invalid,
                Err(error) => summary.state = ResourceState::from_io(error),
            },
            Err(state) => summary.state = state,
        }
        if summary.state == ResourceState::Excluded {
            self.record(ResourceState::Excluded);
        } else {
            self.candidates.push(Candidate {
                summary,
                relative_path: relative,
            });
        }
    }

    fn within_budget(&mut self) -> bool {
        let limit = if self.started.elapsed() >= SCAN_BUDGET {
            Some(ResourceState::Timeout)
        } else if self.entries >= MAX_ENTRIES {
            Some(ResourceState::EntryLimit)
        } else if self.files >= MAX_FILES {
            Some(ResourceState::FileLimit)
        } else {
            None
        };
        if let Some(code) = limit {
            self.record(code);
            false
        } else {
            true
        }
    }

    fn walk(&mut self, rule: &DocumentRule, relative: &str, suffix: &str, depth: usize) {
        if self.excluded(relative) {
            self.record(ResourceState::Excluded);
            return;
        }
        if !self.within_budget() {
            return;
        }
        if depth > MAX_DEPTH {
            self.record(ResourceState::DepthLimit);
            return;
        }
        let path = self.root.join(relative);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                self.record(ResourceState::UnsafeSymlink);
                return;
            }
            Ok(metadata) if !metadata.is_dir() => {
                self.record(ResourceState::Invalid);
                return;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return,
            Err(error) => {
                self.record(ResourceState::from_io(error));
                return;
            }
            Ok(_) => {}
        }
        if let Err(state) = self.target(relative) {
            self.record(state);
            return;
        }
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(error) => {
                self.record(ResourceState::from_io(error));
                return;
            }
        };
        let mut children = Vec::new();
        for entry in entries {
            if !self.within_budget() {
                break;
            }
            self.entries += 1;
            match entry {
                Ok(entry) => children.push(entry),
                Err(error) => self.record(ResourceState::from_io(error)),
            }
        }
        children.sort_by_key(|entry| entry.file_name());
        for entry in children {
            if self.started.elapsed() >= SCAN_BUDGET || self.files >= MAX_FILES {
                self.within_budget();
                break;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                self.record(ResourceState::Invalid);
                continue;
            };
            let child = format!("{relative}/{name}");
            if !super::safe_relative_path(&child) {
                self.record(ResourceState::Invalid);
                continue;
            }
            if self.excluded(&child) {
                self.record(ResourceState::Excluded);
                continue;
            }
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => self.walk(rule, &child, suffix, depth + 1),
                Ok(kind) if kind.is_symlink() => {
                    if name.ends_with(suffix) {
                        self.files += 1;
                        self.add(rule, child);
                    } else {
                        self.record(ResourceState::UnsafeSymlink);
                    }
                }
                Ok(kind) if kind.is_file() && name.ends_with(suffix) => {
                    self.files += 1;
                    self.add(rule, child);
                }
                Ok(_) => {}
                Err(error) => self.record(ResourceState::from_io(error)),
            }
        }
    }
}

fn scan_resources<'a>(
    profile: &'a ApplicationProfile,
    home: &'a Path,
    root: &'a Path,
    rules: &'a DiscoveryExclusions,
) -> ResourceScan<'a> {
    let mut scan = ResourceScan {
        profile,
        home,
        root,
        exclusions: rules,
        candidates: Vec::new(),
        issues: Vec::new(),
        started: Instant::now(),
        entries: 0,
        files: 0,
    };
    for rule in &profile.documents {
        match &rule.path {
            DocumentPath::File { relative_path } => scan.add(rule, relative_path.clone()),
            DocumentPath::Collection {
                relative_path,
                suffix,
            } => {
                let start = scan.candidates.len();
                scan.walk(rule, relative_path, suffix, 0);
                scan.candidates[start..]
                    .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
            }
        }
    }
    scan
}

pub fn list_resources(
    profile: &ApplicationProfile,
    home: &Path,
    rules: &DiscoveryExclusions,
) -> Result<ConfigurationResourcesResult, AppError> {
    rules.validate()?;
    let home = checked_home(home)?;
    let root = match app_root(profile, &home, rules) {
        Ok(root) => root,
        Err(code) => {
            return Ok(ConfigurationResourcesResult {
                resources: Vec::new(),
                issues: vec![issue(code)],
                partial: code != ResourceState::Excluded && code != ResourceState::Missing,
            });
        }
    };
    let scan = scan_resources(profile, &home, &root, rules);
    Ok(ConfigurationResourcesResult {
        partial: scan
            .issues
            .iter()
            .any(|item| item.code != ResourceState::Excluded),
        resources: scan
            .candidates
            .into_iter()
            .map(|candidate| candidate.summary)
            .collect(),
        issues: scan.issues,
    })
}

pub fn read_resource(
    profile: &ApplicationProfile,
    home: &Path,
    rules: &DiscoveryExclusions,
    resource_id: &str,
) -> Result<ConfigurationResourceView, AppError> {
    rules.validate()?;
    let home = checked_home(home)?;
    let root = app_root(profile, &home, rules)
        .map_err(|_| AppError::permission_denied("应用配置不可访问或已被排除。"))?;
    let scan = scan_resources(profile, &home, &root, rules);
    let candidate = scan
        .candidates
        .iter()
        .find(|candidate| candidate.summary.resource_id == resource_id)
        .ok_or_else(|| AppError::not_found("配置资源不存在或已被排除。"))?;
    let mut view = ConfigurationResourceView {
        summary: candidate.summary.clone(),
        fields: Vec::new(),
        content: None,
        unknown_field_count: 0,
    };
    if view.summary.view_kind == ViewKind::Metadata || view.summary.state != ResourceState::Present
    {
        return Ok(view);
    }
    let rule = profile
        .documents
        .iter()
        .find(|rule| rule.id == view.summary.rule_id)
        .ok_or_else(AppError::internal)?;
    let bytes = match read_bytes(&scan, &candidate.relative_path, rule.max_size_bytes) {
        Ok(bytes) => bytes,
        Err(state) => {
            view.summary.state = state;
            return Ok(view);
        }
    };
    let content = match std::str::from_utf8(&bytes) {
        Ok(content) => content,
        Err(_) => {
            view.summary.state = ResourceState::Invalid;
            return Ok(view);
        }
    };
    if rule.view_kind == ViewKind::Text {
        view.content = Some(content.to_owned());
        view.summary.state = ResourceState::Ready;
        return Ok(view);
    }
    let format = match rule.format {
        DocumentFormat::Json => "JSON",
        DocumentFormat::Jsonc => "JSONC",
        _ => return Err(AppError::internal()),
    };
    let parsed = match parse_json_document(format, content) {
        Ok(Value::Object(object)) => object,
        _ => {
            view.summary.state = ResourceState::Invalid;
            return Ok(view);
        }
    };
    view.unknown_field_count = parsed
        .keys()
        .filter(|key| {
            key.as_str() != "$schema" && !rule.fields.iter().any(|field| &field.key == *key)
        })
        .count();
    view.fields = rule
        .fields
        .iter()
        .map(|definition| {
            let current = match parsed.get(&definition.key) {
                None => CurrentFieldValue::Unset,
                Some(value) if definition.accepts(value) => CurrentFieldValue::Value {
                    value: value.clone(),
                },
                Some(_) => CurrentFieldValue::Invalid,
            };
            ConfigurationField {
                definition: definition.clone(),
                current,
            }
        })
        .collect();
    view.summary.state = if view
        .fields
        .iter()
        .any(|field| matches!(field.current, CurrentFieldValue::Invalid))
    {
        ResourceState::Invalid
    } else {
        ResourceState::Ready
    };
    Ok(view)
}

fn read_bytes(
    scan: &ResourceScan<'_>,
    relative: &str,
    max_size: usize,
) -> Result<Vec<u8>, ResourceState> {
    let path = scan.target(relative)?;
    let canonical = fs::canonicalize(&path).map_err(ResourceState::from_io)?;
    if !canonical.starts_with(scan.root) {
        return Err(ResourceState::UnsafeSymlink);
    }
    let file = File::open(canonical).map_err(ResourceState::from_io)?;
    let metadata = file.metadata().map_err(ResourceState::from_io)?;
    if !metadata.is_file() {
        return Err(ResourceState::Invalid);
    }
    if metadata.len() > max_size as u64 {
        return Err(ResourceState::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(max_size as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(ResourceState::from_io)?;
    if bytes.len() > max_size {
        Err(ResourceState::TooLarge)
    } else {
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::profiles::{MAX_CONTENT_BYTES, builtin_profiles};
    use std::os::unix::fs::{PermissionsExt, symlink};
    use uuid::Uuid;

    struct Fixture {
        home: PathBuf,
        profile: ApplicationProfile,
    }
    impl Fixture {
        fn new() -> Self {
            let home = std::env::temp_dir().join(format!("userhome-profile-{}", Uuid::new_v4()));
            fs::create_dir_all(home.join(".copilot/instructions/nested")).expect("fixture");
            Self {
                home,
                profile: builtin_profiles().expect("profile").remove(0),
            }
        }
        fn write(&self, relative: &str, bytes: impl AsRef<[u8]>) {
            fs::write(self.home.join(".copilot").join(relative), bytes).expect("fixture file");
        }
        fn resource(&self, rule: &str) -> ConfigurationResourceSummary {
            list_resources(&self.profile, &self.home, &DiscoveryExclusions::default())
                .expect("resources")
                .resources
                .into_iter()
                .find(|item| item.rule_id == rule)
                .expect("resource")
        }
        fn read(&self, rule: &str) -> ConfigurationResourceView {
            read_resource(
                &self.profile,
                &self.home,
                &DiscoveryExclusions::default(),
                &self.resource(rule).resource_id,
            )
            .expect("read")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.home);
        }
    }

    #[test]
    fn only_supported_app_and_core_files_are_discovered_without_content_reads() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.home.join(".Trash")).expect("trash");
        fs::create_dir_all(fixture.home.join(".claude")).expect("other app");
        fixture.write("settings.json", b"invalid JSON");
        fixture.write("config.json", [0xff]);
        fixture.write("instructions/ordinary.md", "ignored");
        fixture.write("instructions/a.instructions.md", "first");
        fixture.write("instructions/nested/b.instructions.md", "nested");
        let apps = discover_applications(
            std::slice::from_ref(&fixture.profile),
            &fixture.home,
            &DiscoveryExclusions::default(),
        )
        .expect("apps");
        assert_eq!(apps.applications.len(), 1);
        assert_eq!(apps.applications[0].app_id, "github-copilot");
        let list = list_resources(
            &fixture.profile,
            &fixture.home,
            &DiscoveryExclusions::default(),
        )
        .expect("list");
        assert_eq!(list.resources.len(), 5);
        assert_eq!(fixture.resource("settings").state, ResourceState::Present);
        assert_eq!(
            fixture.read("application-state").summary.state,
            ResourceState::Present
        );
        assert!(fixture.read("application-state").content.is_none());
        assert_eq!(
            fixture.read("modular-instructions").content.as_deref(),
            Some("first")
        );
    }

    #[test]
    fn jsonc_projection_preserves_unset_and_invalid_states_without_unknown_secrets() {
        let fixture = Fixture::new();
        fixture.write("settings.json", "{// private-secret-sentinel\n\"model\":\"fixture-model\", \"banner\":true,\"apiToken\":\"private-secret-sentinel\", \"$schema\":\"https://invalid.example\",}\n");
        let view = fixture.read("settings");
        assert_eq!(view.fields.len(), 9);
        assert_eq!(view.unknown_field_count, 1);
        assert_eq!(view.summary.state, ResourceState::Invalid);
        assert!(matches!(view.fields[1].current, CurrentFieldValue::Unset));
        assert!(matches!(view.fields[2].current, CurrentFieldValue::Invalid));
        assert!(
            !serde_json::to_string(&view)
                .expect("dto")
                .contains("private-secret-sentinel")
        );
        assert!(view.content.is_none());
    }

    #[test]
    fn excludes_recheck_existing_resource_ids_and_canonical_targets() {
        let fixture = Fixture::new();
        fixture.write("settings.json", "{}");
        let resource = fixture.resource("settings");
        let rules = DiscoveryExclusions {
            user_paths: vec![".copilot/settings.json".into()],
            ..Default::default()
        };
        let list = list_resources(&fixture.profile, &fixture.home, &rules).expect("list");
        assert!(
            !list
                .resources
                .iter()
                .any(|item| item.resource_id == resource.resource_id)
        );
        assert!(
            read_resource(
                &fixture.profile,
                &fixture.home,
                &rules,
                &resource.resource_id
            )
            .is_err()
        );
        let rules = DiscoveryExclusions {
            user_paths: vec![".copilot".into()],
            ..Default::default()
        };
        let apps = discover_applications(
            std::slice::from_ref(&fixture.profile),
            &fixture.home,
            &rules,
        )
        .expect("apps");
        assert!(apps.applications.is_empty());
        assert_eq!(apps.empty_reason, Some(ResourceState::Excluded));
    }

    #[test]
    fn missing_invalid_oversized_permissions_and_symlink_states_are_explicit() {
        let fixture = Fixture::new();
        assert_eq!(
            fixture.read("global-instructions").summary.state,
            ResourceState::Missing
        );
        fixture.write("settings.json", "[]");
        assert_eq!(
            fixture.read("settings").summary.state,
            ResourceState::Invalid
        );
        fixture.write("settings.json", vec![b' '; MAX_CONTENT_BYTES + 1]);
        assert_eq!(
            fixture.read("settings").summary.state,
            ResourceState::TooLarge
        );
        fixture.write("settings.json", "{}");
        fs::set_permissions(
            fixture.home.join(".copilot/settings.json"),
            fs::Permissions::from_mode(0o000),
        )
        .expect("permissions");
        assert_eq!(
            fixture.read("settings").summary.state,
            ResourceState::PermissionDenied
        );
        fixture.write("config.json", "authentication-secret-sentinel");
        fs::set_permissions(
            fixture.home.join(".copilot/config.json"),
            fs::Permissions::from_mode(0o000),
        )
        .expect("permissions");
        assert_eq!(
            fixture.read("application-state").summary.state,
            ResourceState::Present
        );
        fs::write(fixture.home.join("outside"), "private").expect("outside");
        symlink(
            fixture.home.join("outside"),
            fixture.home.join(".copilot/copilot-instructions.md"),
        )
        .expect("link");
        assert_eq!(
            fixture.read("global-instructions").summary.state,
            ResourceState::UnsafeSymlink
        );
        symlink(
            fixture.home.clone(),
            fixture.home.join(".copilot/instructions/linked"),
        )
        .expect("directory link");
        let list = list_resources(
            &fixture.profile,
            &fixture.home,
            &DiscoveryExclusions::default(),
        )
        .expect("list");
        assert!(list.partial);
        assert!(
            list.issues
                .iter()
                .any(|item| item.code == ResourceState::UnsafeSymlink)
        );
    }

    #[test]
    fn collection_limits_and_timeout_are_visible() {
        let fixture = Fixture::new();
        for index in 0..MAX_FILES + 1 {
            fixture.write(&format!("instructions/{index:04}.instructions.md"), "text");
        }
        let list = list_resources(
            &fixture.profile,
            &fixture.home,
            &DiscoveryExclusions::default(),
        )
        .expect("list");
        assert!(list.partial);
        assert_eq!(
            list.resources
                .iter()
                .filter(|item| item.rule_id == "modular-instructions")
                .count(),
            MAX_FILES
        );
        assert!(
            list.issues
                .iter()
                .any(|item| item.code == ResourceState::FileLimit)
        );
        let root = fixture.home.join(".copilot");
        let rules = DiscoveryExclusions::default();
        let mut scan = scan_resources(&fixture.profile, &fixture.home, &root, &rules);
        scan.started = Instant::now() - SCAN_BUDGET;
        assert!(!scan.within_budget());
        assert!(
            scan.issues
                .iter()
                .any(|item| item.code == ResourceState::Timeout)
        );
    }

    #[test]
    fn depth_entry_limits_and_missing_or_invalid_app_roots_are_not_silent() {
        let fixture = Fixture::new();
        let deep = fixture
            .home
            .join(".copilot/instructions")
            .join("a/".repeat(MAX_DEPTH + 1));
        fs::create_dir_all(&deep).expect("deep fixture");
        fs::write(deep.join("deep.instructions.md"), "too deep").expect("deep file");
        for index in 0..MAX_ENTRIES + 1 {
            fixture.write(
                &format!("instructions/nested/ignored-{index:04}.txt"),
                "ignored",
            );
        }
        let result = list_resources(
            &fixture.profile,
            &fixture.home,
            &DiscoveryExclusions::default(),
        )
        .expect("scan");
        assert!(result.partial);
        assert!(
            result
                .issues
                .iter()
                .any(|item| item.code == ResourceState::EntryLimit)
        );
        let root = fixture.home.join(".copilot");
        let rules = DiscoveryExclusions::default();
        let mut scan = scan_resources(&fixture.profile, &fixture.home, &root, &rules);
        let rule = &fixture.profile.documents[2];
        scan.entries = 0;
        scan.walk(rule, "instructions", ".instructions.md", MAX_DEPTH + 1);
        assert!(
            scan.issues
                .iter()
                .any(|item| item.code == ResourceState::DepthLimit)
        );
        fs::rename(&root, fixture.home.join("saved")).expect("move root");
        let apps = discover_applications(
            std::slice::from_ref(&fixture.profile),
            &fixture.home,
            &rules,
        )
        .expect("missing");
        assert_eq!(apps.empty_reason, Some(ResourceState::Missing));
        fs::write(&root, "not a directory").expect("invalid root");
        let apps = discover_applications(
            std::slice::from_ref(&fixture.profile),
            &fixture.home,
            &rules,
        )
        .expect("invalid");
        assert!(apps.empty_reason.is_none());
        assert_eq!(apps.issues[0].code, ResourceState::Invalid);
    }
}
