use std::{
    collections::BTreeMap,
    env, fs,
    os::unix::fs::FileTypeExt,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{
    catalog::{Catalog, CatalogCoverageClass, load_builtin_catalog},
    security::paths::TRUSTED_BREW_PREFIXES,
};

use super::system::{DiscoveryCompleteness, DiscoveryIssue};

const MAX_CANDIDATES: usize = 128;
const MAX_ENTRIES_PER_ROOT: usize = 128;
const MAX_METADATA_ENTRIES: usize = 512;
const MAX_ROOT_DEPTH: usize = 1;
const MAX_ISSUES: usize = 32;
const MAX_OUTCOMES: usize = 32;
const MAX_CANDIDATE_PATH_BYTES: usize = 1024;
const CANDIDATE_SCAN_TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateKind {
    File,
    Directory,
    Symlink,
    Socket,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateRootKind {
    Home,
    XdgConfigHome,
    ApplicationSupport,
    HomebrewPrefix,
    AppSupport,
}

impl CandidateRootKind {
    fn id_component(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::XdgConfigHome => "xdg-config-home",
            Self::ApplicationSupport => "application-support",
            Self::HomebrewPrefix => "homebrew-prefix",
            Self::AppSupport => "app-support",
        }
    }

    fn display_prefix(self) -> &'static str {
        match self {
            Self::Home => "~",
            Self::XdgConfigHome => "XDG_CONFIG_HOME",
            Self::ApplicationSupport => "APPLICATION_SUPPORT",
            Self::HomebrewPrefix => "HOMEBREW_PREFIX",
            Self::AppSupport => "APP_SUPPORT",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateEvidence {
    MetadataPresent,
    CatalogDocument,
    CatalogService,
    BoundedRootEntry,
    SymlinkMetadataOnly,
    ExclusionRule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateSensitivityHint {
    Standard,
    Sensitive,
    Secret,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateScanOutcomeKind {
    Complete,
    CandidateLimitReached,
    EntryLimitReached,
    MetadataLimitReached,
    PermissionDenied,
    SymlinkMetadataOnly,
    Timeout,
    MetadataUnavailable,
    InvalidRoot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateScanOutcome {
    kind: CandidateScanOutcomeKind,
    message: String,
    retryable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateScanLimits {
    max_candidates: usize,
    max_entries_per_root: usize,
    max_metadata_count: usize,
    max_root_depth: usize,
    timeout_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateScanSummary {
    candidate_count: usize,
    metadata_count: usize,
    root_count: usize,
    elapsed_ms: u64,
    limits: CandidateScanLimits,
    outcomes: Vec<CandidateScanOutcome>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmanagedCandidate {
    candidate_id: String,
    display_name: String,
    root_kind: CandidateRootKind,
    relative_path: String,
    entry_type: CandidateKind,
    evidence: Vec<CandidateEvidence>,
    format_hints: Vec<String>,
    sensitivity_hint: CandidateSensitivityHint,
    classification_reason: String,
    catalog_app_id: Option<String>,
    name: String,
    kind: CandidateKind,
    coverage_class: CatalogCoverageClass,
    modified_at_epoch_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationCoverage {
    pub(crate) completeness: DiscoveryCompleteness,
    pub(crate) candidates: Vec<UnmanagedCandidate>,
    pub(crate) summary: CandidateScanSummary,
    pub(crate) issues: Vec<DiscoveryIssue>,
}

pub type BaselineInventory = ConfigurationCoverage;

impl ConfigurationCoverage {
    #[cfg(test)]
    pub(crate) fn empty() -> Self {
        Self {
            completeness: DiscoveryCompleteness::Complete,
            candidates: Vec::new(),
            summary: CandidateScanSummary {
                candidate_count: 0,
                metadata_count: 0,
                root_count: 0,
                elapsed_ms: 0,
                limits: scan_limits(),
                outcomes: vec![CandidateScanOutcome {
                    kind: CandidateScanOutcomeKind::Complete,
                    message: "Candidate metadata scan completed within its limits.".to_owned(),
                    retryable: false,
                }],
            },
            issues: Vec::new(),
        }
    }

    pub(crate) fn timed_out(elapsed: Duration) -> Self {
        let message = "Candidate discovery exceeded its coordinator time limit.";
        Self {
            completeness: DiscoveryCompleteness::Partial,
            candidates: Vec::new(),
            summary: CandidateScanSummary {
                candidate_count: 0,
                metadata_count: 0,
                root_count: 0,
                elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
                limits: scan_limits(),
                outcomes: vec![CandidateScanOutcome {
                    kind: CandidateScanOutcomeKind::Timeout,
                    message: message.to_owned(),
                    retryable: true,
                }],
            },
            issues: vec![DiscoveryIssue::new("candidates", message, true)],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CatalogCandidateSource {
    Document,
    Service,
}

#[derive(Debug, Clone)]
struct CatalogCandidateMetadata {
    coverage_class: CatalogCoverageClass,
    app_id: String,
    format_hints: Vec<String>,
    sensitivity_hint: CandidateSensitivityHint,
    source: CatalogCandidateSource,
}

#[derive(Debug, Default)]
struct CatalogCandidatePaths {
    home: BTreeMap<PathBuf, CatalogCandidateMetadata>,
    homebrew: BTreeMap<PathBuf, CatalogCandidateMetadata>,
    services: BTreeMap<PathBuf, CatalogCandidateMetadata>,
}

#[derive(Debug, Clone)]
struct CandidateLocation {
    root_kind: CandidateRootKind,
    relative_path: String,
    display_name: String,
    legacy_name: String,
}

#[derive(Debug, Default)]
struct ScanState {
    metadata_count: usize,
    root_count: usize,
    outcomes: Vec<CandidateScanOutcome>,
}

pub fn discover_candidates() -> Result<ConfigurationCoverage, DiscoveryIssue> {
    let home = env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            DiscoveryIssue::new("candidates", "Home directory is unavailable.", false)
        })?;
    let xdg_config_home = env::var_os("XDG_CONFIG_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let brew_prefixes = TRUSTED_BREW_PREFIXES
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    discover_candidates_in(&home, xdg_config_home.as_deref(), &brew_prefixes)
}

fn discover_candidates_in(
    home: &Path,
    xdg_config_home: Option<&Path>,
    brew_prefixes: &[PathBuf],
) -> Result<ConfigurationCoverage, DiscoveryIssue> {
    let started_at = Instant::now();
    let catalog = load_builtin_catalog().map_err(|_| {
        DiscoveryIssue::new("candidates", "Application catalog is unavailable.", false)
    })?;
    let catalog_paths = catalog_candidate_metadata(&catalog);
    let mut issues = Vec::new();
    let mut scan_state = ScanState::default();
    let home_root = match fs::canonicalize(home) {
        Ok(path) => path,
        Err(error) => {
            record_outcome(
                &mut scan_state,
                io_outcome_kind(&error),
                "Home directory metadata could not be resolved.",
                true,
            );
            return Ok(ConfigurationCoverage {
                completeness: DiscoveryCompleteness::Partial,
                candidates: Vec::new(),
                summary: scan_summary(0, started_at, scan_state),
                issues: vec![DiscoveryIssue::new(
                    "candidates",
                    "Home directory metadata could not be resolved.",
                    true,
                )],
            });
        }
    };
    let deadline = Instant::now() + CANDIDATE_SCAN_TIMEOUT;
    let mut candidates = BTreeMap::new();

    let xdg_config_home = validate_xdg_root(
        xdg_config_home,
        home,
        &home_root,
        &mut issues,
        &mut scan_state,
    );
    let default_xdg_root = home.join(".config");
    let effective_xdg_root = xdg_config_home.unwrap_or(&default_xdg_root);
    let xdg_home_entry = xdg_config_home
        .and_then(|path| path.strip_prefix(home).ok())
        .and_then(|relative| relative.components().next())
        .map(|component| component.as_os_str().to_string_lossy().into_owned());

    for (relative, metadata) in &catalog_paths.home {
        if !scan_can_continue(deadline, candidates.len(), &mut issues, &mut scan_state) {
            break;
        }
        let Some(location) = home_candidate_location(relative, home, xdg_config_home) else {
            continue;
        };
        scan_catalog_path(
            &home.join(relative),
            location,
            &home_root,
            metadata,
            &mut candidates,
            &mut issues,
            &mut scan_state,
        );

        let Some(xdg_root) = xdg_config_home else {
            continue;
        };
        let Ok(xdg_relative) = relative.strip_prefix(".config") else {
            continue;
        };
        if xdg_relative.as_os_str().is_empty() || xdg_root == home.join(".config") {
            continue;
        }
        if !scan_can_continue(deadline, candidates.len(), &mut issues, &mut scan_state) {
            break;
        }
        let Ok(xdg_root) = fs::canonicalize(xdg_root) else {
            continue;
        };
        let Some(location) = candidate_location(
            CandidateRootKind::XdgConfigHome,
            xdg_relative,
            &Path::new("XDG_CONFIG_HOME").join(xdg_relative),
        ) else {
            continue;
        };
        scan_catalog_path(
            &xdg_root.join(xdg_relative),
            location,
            &xdg_root,
            metadata,
            &mut candidates,
            &mut issues,
            &mut scan_state,
        );
    }

    for brew_prefix in brew_prefixes {
        let Ok(brew_root) = fs::canonicalize(brew_prefix) else {
            continue;
        };
        for (relative, metadata) in &catalog_paths.homebrew {
            if !scan_can_continue(deadline, candidates.len(), &mut issues, &mut scan_state) {
                break;
            }
            let Some(location) = candidate_location(
                CandidateRootKind::HomebrewPrefix,
                relative,
                &Path::new("HOMEBREW_PREFIX").join(relative),
            ) else {
                continue;
            };
            scan_catalog_path(
                &brew_root.join(relative),
                location,
                &brew_root,
                metadata,
                &mut candidates,
                &mut issues,
                &mut scan_state,
            );
        }
    }

    for (relative, metadata) in &catalog_paths.services {
        if !scan_can_continue(deadline, candidates.len(), &mut issues, &mut scan_state) {
            break;
        }
        let Some(location) = candidate_location(CandidateRootKind::Home, relative, relative) else {
            continue;
        };
        scan_catalog_path(
            &home.join(relative),
            location,
            &home_root,
            metadata,
            &mut candidates,
            &mut issues,
            &mut scan_state,
        );
    }

    scan_direct_root(
        DirectScanRoot {
            path: home.to_path_buf(),
            root_kind: CandidateRootKind::Home,
            relative_prefix: PathBuf::new(),
            catalog_prefix: PathBuf::new(),
            legacy_prefix: PathBuf::new(),
            filter: RootEntryFilter::HomeDotDirectories,
            xdg_home_entry: xdg_home_entry.clone(),
        },
        &catalog_paths.home,
        deadline,
        &mut candidates,
        &mut issues,
        &mut scan_state,
    );
    scan_direct_root(
        DirectScanRoot {
            path: effective_xdg_root.to_path_buf(),
            root_kind: CandidateRootKind::XdgConfigHome,
            relative_prefix: PathBuf::new(),
            catalog_prefix: PathBuf::from(".config"),
            legacy_prefix: if effective_xdg_root == default_xdg_root {
                PathBuf::from(".config")
            } else {
                PathBuf::from("XDG_CONFIG_HOME")
            },
            filter: RootEntryFilter::AllSafeEntries,
            xdg_home_entry: None,
        },
        &catalog_paths.home,
        deadline,
        &mut candidates,
        &mut issues,
        &mut scan_state,
    );
    scan_direct_root(
        DirectScanRoot {
            path: home.join("Library/Application Support"),
            root_kind: CandidateRootKind::ApplicationSupport,
            relative_prefix: PathBuf::new(),
            catalog_prefix: PathBuf::from("Library/Application Support"),
            legacy_prefix: PathBuf::from("Library/Application Support"),
            filter: RootEntryFilter::AllSafeEntries,
            xdg_home_entry: None,
        },
        &catalog_paths.home,
        deadline,
        &mut candidates,
        &mut issues,
        &mut scan_state,
    );
    for brew_prefix in brew_prefixes {
        scan_direct_root(
            DirectScanRoot {
                path: brew_prefix.join("etc"),
                root_kind: CandidateRootKind::HomebrewPrefix,
                relative_prefix: PathBuf::from("etc"),
                catalog_prefix: PathBuf::from("etc"),
                legacy_prefix: PathBuf::from("HOMEBREW_PREFIX/etc"),
                filter: RootEntryFilter::AllSafeEntries,
                xdg_home_entry: None,
            },
            &catalog_paths.homebrew,
            deadline,
            &mut candidates,
            &mut issues,
            &mut scan_state,
        );
    }

    if issues.is_empty() {
        record_outcome(
            &mut scan_state,
            CandidateScanOutcomeKind::Complete,
            "Candidate metadata scan completed within its limits.",
            false,
        );
    }
    let candidates: Vec<_> = candidates.into_values().take(MAX_CANDIDATES).collect();
    Ok(ConfigurationCoverage {
        completeness: if issues.is_empty() {
            DiscoveryCompleteness::Complete
        } else {
            DiscoveryCompleteness::Partial
        },
        summary: scan_summary(candidates.len(), started_at, scan_state),
        candidates,
        issues,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RootEntryFilter {
    HomeDotDirectories,
    AllSafeEntries,
}

#[derive(Debug, Clone)]
struct DirectScanRoot {
    path: PathBuf,
    root_kind: CandidateRootKind,
    relative_prefix: PathBuf,
    catalog_prefix: PathBuf,
    legacy_prefix: PathBuf,
    filter: RootEntryFilter,
    xdg_home_entry: Option<String>,
}

fn scan_catalog_path(
    path: &Path,
    location: CandidateLocation,
    authorized_root: &Path,
    catalog_metadata: &CatalogCandidateMetadata,
    candidates: &mut BTreeMap<String, UnmanagedCandidate>,
    issues: &mut Vec<DiscoveryIssue>,
    scan_state: &mut ScanState,
) {
    if !reserve_metadata(issues, scan_state) {
        return;
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            record_issue(
                issues,
                scan_state,
                io_outcome_kind(&error),
                &format!(
                    "Metadata for {} could not be inspected.",
                    location.display_name
                ),
                true,
            );
            return;
        }
    };

    let Some(parent) = path.parent() else {
        return;
    };
    match fs::canonicalize(parent) {
        Ok(path) if path.starts_with(authorized_root) => {}
        Ok(_) => {
            record_issue(
                issues,
                scan_state,
                CandidateScanOutcomeKind::InvalidRoot,
                &format!(
                    "{} resolves outside its approved metadata root.",
                    location.display_name
                ),
                false,
            );
            return;
        }
        Err(error) => {
            record_issue(
                issues,
                scan_state,
                io_outcome_kind(&error),
                &format!(
                    "Metadata for {} could not be resolved.",
                    location.display_name
                ),
                true,
            );
            return;
        }
    };

    insert_candidate(
        location,
        &metadata,
        Some(catalog_metadata),
        candidates,
        issues,
        scan_state,
    );
}

fn scan_direct_root(
    root: DirectScanRoot,
    catalog_paths: &BTreeMap<PathBuf, CatalogCandidateMetadata>,
    deadline: Instant,
    candidates: &mut BTreeMap<String, UnmanagedCandidate>,
    issues: &mut Vec<DiscoveryIssue>,
    scan_state: &mut ScanState,
) {
    if !scan_can_continue(deadline, candidates.len(), issues, scan_state)
        || !reserve_metadata(issues, scan_state)
    {
        return;
    }
    let root_metadata = match fs::symlink_metadata(&root.path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            record_issue(
                issues,
                scan_state,
                io_outcome_kind(&error),
                &format!(
                    "Metadata under {} could not be inspected.",
                    root.root_kind.display_prefix()
                ),
                true,
            );
            return;
        }
    };
    if root_metadata.file_type().is_symlink() {
        record_issue(
            issues,
            scan_state,
            CandidateScanOutcomeKind::SymlinkMetadataOnly,
            &format!(
                "{} is a symlink and was not traversed.",
                root.root_kind.display_prefix()
            ),
            false,
        );
        return;
    }
    if !root_metadata.is_dir() {
        record_issue(
            issues,
            scan_state,
            CandidateScanOutcomeKind::InvalidRoot,
            &format!(
                "{} is not a directory and was not scanned.",
                root.root_kind.display_prefix()
            ),
            false,
        );
        return;
    }
    let canonical_root = match fs::canonicalize(&root.path) {
        Ok(root) => root,
        Err(error) => {
            record_issue(
                issues,
                scan_state,
                io_outcome_kind(&error),
                &format!(
                    "{} could not be resolved for metadata scanning.",
                    root.root_kind.display_prefix()
                ),
                true,
            );
            return;
        }
    };
    let entries = match fs::read_dir(&canonical_root) {
        Ok(entries) => entries,
        Err(error) => {
            record_issue(
                issues,
                scan_state,
                io_outcome_kind(&error),
                &format!(
                    "Metadata under {} could not be listed.",
                    root.root_kind.display_prefix()
                ),
                true,
            );
            return;
        }
    };

    let mut entries_to_scan = Vec::new();
    for entry in entries {
        if !scan_can_continue(deadline, candidates.len(), issues, scan_state) {
            return;
        }
        if entries_to_scan.len() >= MAX_ENTRIES_PER_ROOT {
            record_issue(
                issues,
                scan_state,
                CandidateScanOutcomeKind::EntryLimitReached,
                &format!(
                    "Candidate entry limit was reached for {}.",
                    root.root_kind.display_prefix()
                ),
                false,
            );
            return;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                record_issue(
                    issues,
                    scan_state,
                    CandidateScanOutcomeKind::MetadataUnavailable,
                    "An entry under the home directory could not be inspected.",
                    true,
                );
                continue;
            }
        };
        entries_to_scan.push(entry);
    }
    entries_to_scan.sort_by_key(|entry| entry.file_name());
    scan_state.root_count += 1;

    for entry in entries_to_scan {
        if !scan_can_continue(deadline, candidates.len(), issues, scan_state) {
            return;
        }
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        if !is_safe_name(&entry_name)
            || (root.filter == RootEntryFilter::HomeDotDirectories
                && !is_home_candidate(&entry_name, root.xdg_home_entry.as_deref()))
        {
            continue;
        }
        if !reserve_metadata(issues, scan_state) {
            return;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(error) => {
                record_issue(
                    issues,
                    scan_state,
                    io_outcome_kind(&error),
                    &format!("Metadata for {entry_name} could not be inspected."),
                    true,
                );
                continue;
            }
        };
        let kind = candidate_kind(&metadata);
        if root.filter == RootEntryFilter::HomeDotDirectories
            && !matches!(kind, CandidateKind::Directory | CandidateKind::Symlink)
        {
            continue;
        }
        let relative = root.relative_prefix.join(&entry_name);
        let catalog_path = root.catalog_prefix.join(&entry_name);
        let legacy = root.legacy_prefix.join(&entry_name);
        let Some(location) = candidate_location(root.root_kind, &relative, &legacy) else {
            continue;
        };
        insert_candidate(
            location,
            &metadata,
            catalog_paths.get(&catalog_path),
            candidates,
            issues,
            scan_state,
        );
        if candidates.len() >= MAX_CANDIDATES {
            record_issue(
                issues,
                scan_state,
                CandidateScanOutcomeKind::CandidateLimitReached,
                "Candidate metadata limit was reached.",
                false,
            );
            return;
        }
    }
}

fn is_home_candidate(name: &str, xdg_home_entry: Option<&str>) -> bool {
    is_safe_name(name) && name.starts_with('.') && name != ".config" && xdg_home_entry != Some(name)
}

fn validate_xdg_root<'a>(
    xdg_config_home: Option<&'a Path>,
    home: &Path,
    home_root: &Path,
    issues: &mut Vec<DiscoveryIssue>,
    scan_state: &mut ScanState,
) -> Option<&'a Path> {
    let path = xdg_config_home?;
    let relative = path.strip_prefix(home).ok();
    let lexically_safe = relative.is_some_and(|relative| {
        !relative.as_os_str().is_empty()
            && relative
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
    });
    let contained = match fs::canonicalize(path) {
        Ok(path) => path.starts_with(home_root),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => lexically_safe,
        Err(_) => false,
    };
    if path.is_absolute() && contained {
        return Some(path);
    }
    record_issue(
        issues,
        scan_state,
        CandidateScanOutcomeKind::InvalidRoot,
        "XDG configuration root is outside the supported home directory.",
        false,
    );
    None
}

fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 255
        && !name.contains('/')
        && !name.contains('\0')
}

fn candidate_kind(metadata: &fs::Metadata) -> CandidateKind {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        CandidateKind::Symlink
    } else if file_type.is_file() {
        CandidateKind::File
    } else if file_type.is_dir() {
        CandidateKind::Directory
    } else if file_type.is_socket() {
        CandidateKind::Socket
    } else {
        CandidateKind::Other
    }
}

fn insert_candidate(
    location: CandidateLocation,
    metadata: &fs::Metadata,
    catalog_metadata: Option<&CatalogCandidateMetadata>,
    candidates: &mut BTreeMap<String, UnmanagedCandidate>,
    issues: &mut Vec<DiscoveryIssue>,
    scan_state: &mut ScanState,
) {
    let kind = candidate_kind(metadata);
    let relative = Path::new(
        location
            .relative_path
            .split_once('/')
            .map(|(_, relative)| relative)
            .unwrap_or(&location.relative_path),
    );
    let excluded = is_excluded_path(relative, kind);
    let coverage_class = if excluded {
        CatalogCoverageClass::Excluded
    } else {
        catalog_metadata
            .map(|metadata| metadata.coverage_class)
            .unwrap_or(CatalogCoverageClass::DetectedUnsupported)
    };
    let modified_at_epoch_ms = match metadata.modified() {
        Ok(value) => value
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| u64::try_from(duration.as_millis()).ok()),
        Err(error) => {
            push_issue(
                issues,
                &format!(
                    "Modification metadata for {} could not be read.",
                    location.display_name
                ),
                true,
            );
            record_outcome(
                scan_state,
                io_outcome_kind(&error),
                &format!(
                    "Modification metadata for {} could not be read.",
                    location.display_name
                ),
                true,
            );
            None
        }
    };
    let candidate_id = candidate_id(location.root_kind, &location.relative_path);
    let mut evidence = vec![CandidateEvidence::MetadataPresent];
    evidence.push(match catalog_metadata.map(|metadata| metadata.source) {
        Some(CatalogCandidateSource::Document) => CandidateEvidence::CatalogDocument,
        Some(CatalogCandidateSource::Service) => CandidateEvidence::CatalogService,
        None => CandidateEvidence::BoundedRootEntry,
    });
    if kind == CandidateKind::Symlink {
        evidence.push(CandidateEvidence::SymlinkMetadataOnly);
        record_outcome(
            scan_state,
            CandidateScanOutcomeKind::SymlinkMetadataOnly,
            &format!(
                "{} was classified from link metadata without following its target.",
                location.display_name
            ),
            false,
        );
    }
    if excluded {
        evidence.push(CandidateEvidence::ExclusionRule);
    }
    let format_hints = catalog_metadata
        .map(|metadata| metadata.format_hints.clone())
        .unwrap_or_else(|| infer_format_hints(relative, kind));
    let sensitivity_hint = catalog_metadata
        .map(|metadata| metadata.sensitivity_hint)
        .unwrap_or(CandidateSensitivityHint::Unknown);
    let classification_reason =
        classification_reason(coverage_class, excluded, catalog_metadata).to_owned();
    let catalog_app_id = catalog_metadata.map(|metadata| metadata.app_id.clone());
    candidates
        .entry(location.legacy_name.clone())
        .or_insert(UnmanagedCandidate {
            candidate_id,
            display_name: location.display_name,
            root_kind: location.root_kind,
            relative_path: location.relative_path,
            entry_type: kind,
            evidence,
            format_hints,
            sensitivity_hint,
            classification_reason,
            catalog_app_id,
            name: location.legacy_name,
            kind,
            coverage_class,
            modified_at_epoch_ms,
        });
}

fn catalog_candidate_metadata(catalog: &Catalog) -> CatalogCandidatePaths {
    let mut paths = CatalogCandidatePaths::default();
    for app in catalog.apps() {
        for document in app.config_documents() {
            let (target, relative) =
                if let Some(relative) = document.path_template().strip_prefix("~/") {
                    (&mut paths.home, relative)
                } else if let Some(relative) =
                    document.path_template().strip_prefix("${HOMEBREW_PREFIX}/")
                {
                    (&mut paths.homebrew, relative)
                } else {
                    continue;
                };
            target.insert(
                PathBuf::from(relative),
                CatalogCandidateMetadata {
                    coverage_class: app.coverage_class(),
                    app_id: app.id().to_owned(),
                    format_hints: vec![document.format().to_owned()],
                    sensitivity_hint: match document.sensitivity() {
                        "STANDARD" => CandidateSensitivityHint::Standard,
                        "SENSITIVE" => CandidateSensitivityHint::Sensitive,
                        "SECRET" => CandidateSensitivityHint::Secret,
                        _ => CandidateSensitivityHint::Unknown,
                    },
                    source: CatalogCandidateSource::Document,
                },
            );
        }
        for service in app.services() {
            if !is_safe_name(service) {
                continue;
            }
            paths.services.insert(
                Path::new("Library/LaunchAgents").join(format!("homebrew.mxcl.{service}.plist")),
                CatalogCandidateMetadata {
                    coverage_class: CatalogCoverageClass::DetectedUnsupported,
                    app_id: app.id().to_owned(),
                    format_hints: vec!["PLIST".to_owned()],
                    sensitivity_hint: CandidateSensitivityHint::Standard,
                    source: CatalogCandidateSource::Service,
                },
            );
        }
    }
    paths
}

fn home_candidate_location(
    relative: &Path,
    home: &Path,
    xdg_config_home: Option<&Path>,
) -> Option<CandidateLocation> {
    if let Ok(relative) = relative.strip_prefix("Library/Application Support") {
        return candidate_location(
            CandidateRootKind::ApplicationSupport,
            relative,
            &Path::new("Library/Application Support").join(relative),
        );
    }
    let default_xdg_root = home.join(".config");
    if xdg_config_home.is_none_or(|path| path == default_xdg_root)
        && let Ok(relative) = relative.strip_prefix(".config")
    {
        return candidate_location(
            CandidateRootKind::XdgConfigHome,
            relative,
            &Path::new(".config").join(relative),
        );
    }
    candidate_location(CandidateRootKind::Home, relative, relative)
}

fn candidate_location(
    root_kind: CandidateRootKind,
    relative: &Path,
    legacy_path: &Path,
) -> Option<CandidateLocation> {
    let relative = relative.to_string_lossy();
    let legacy_name = legacy_path.to_string_lossy();
    if relative.is_empty()
        || relative.len() > MAX_CANDIDATE_PATH_BYTES
        || legacy_name.is_empty()
        || legacy_name.len() > MAX_CANDIDATE_PATH_BYTES
    {
        return None;
    }
    let relative_path = format!("{}/{}", root_kind.display_prefix(), relative);
    Some(CandidateLocation {
        root_kind,
        display_name: relative_path.clone(),
        relative_path,
        legacy_name: legacy_name.into_owned(),
    })
}

fn candidate_id(root_kind: CandidateRootKind, relative_path: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in root_kind
        .id_component()
        .bytes()
        .chain([0])
        .chain(relative_path.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("candidate-{hash:016x}")
}

fn infer_format_hints(relative: &Path, kind: CandidateKind) -> Vec<String> {
    if !matches!(kind, CandidateKind::File | CandidateKind::Symlink) {
        return Vec::new();
    }
    relative
        .extension()
        .and_then(|extension| extension.to_str())
        .filter(|extension| {
            !extension.is_empty()
                && extension.len() <= 16
                && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
        .map(|extension| vec![extension.to_ascii_uppercase()])
        .unwrap_or_default()
}

fn classification_reason(
    coverage_class: CatalogCoverageClass,
    excluded: bool,
    catalog_metadata: Option<&CatalogCandidateMetadata>,
) -> &'static str {
    if excluded {
        return "The entry matches a metadata-only exclusion rule.";
    }
    if catalog_metadata.is_some_and(|metadata| metadata.source == CatalogCandidateSource::Service) {
        return "The catalog owns this service location, but configuration access is not authorized.";
    }
    match coverage_class {
        CatalogCoverageClass::ManagedWritable => {
            "The catalog grants managed read and write support for this document."
        }
        CatalogCoverageClass::ManagedReadOnly => {
            "The catalog grants bounded read-only support for this document."
        }
        CatalogCoverageClass::DetectedUnsupported => {
            "The entry was found by bounded metadata discovery without catalog ownership."
        }
        CatalogCoverageClass::Excluded => "The entry is excluded from configuration access.",
    }
}

fn scan_limits() -> CandidateScanLimits {
    CandidateScanLimits {
        max_candidates: MAX_CANDIDATES,
        max_entries_per_root: MAX_ENTRIES_PER_ROOT,
        max_metadata_count: MAX_METADATA_ENTRIES,
        max_root_depth: MAX_ROOT_DEPTH,
        timeout_ms: CANDIDATE_SCAN_TIMEOUT.as_millis() as u64,
    }
}

fn scan_summary(
    candidate_count: usize,
    started_at: Instant,
    scan_state: ScanState,
) -> CandidateScanSummary {
    CandidateScanSummary {
        candidate_count,
        metadata_count: scan_state.metadata_count,
        root_count: scan_state.root_count,
        elapsed_ms: u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX),
        limits: scan_limits(),
        outcomes: scan_state.outcomes,
    }
}

fn scan_can_continue(
    deadline: Instant,
    candidate_count: usize,
    issues: &mut Vec<DiscoveryIssue>,
    scan_state: &mut ScanState,
) -> bool {
    if Instant::now() >= deadline {
        record_issue(
            issues,
            scan_state,
            CandidateScanOutcomeKind::Timeout,
            "Candidate metadata scan reached its time limit.",
            true,
        );
        return false;
    }
    if candidate_count >= MAX_CANDIDATES {
        record_issue(
            issues,
            scan_state,
            CandidateScanOutcomeKind::CandidateLimitReached,
            "Candidate metadata limit was reached.",
            false,
        );
        return false;
    }
    if scan_state.metadata_count >= MAX_METADATA_ENTRIES {
        record_issue(
            issues,
            scan_state,
            CandidateScanOutcomeKind::MetadataLimitReached,
            "Candidate metadata inspection limit was reached.",
            false,
        );
        return false;
    }
    true
}

fn reserve_metadata(issues: &mut Vec<DiscoveryIssue>, scan_state: &mut ScanState) -> bool {
    if scan_state.metadata_count >= MAX_METADATA_ENTRIES {
        record_issue(
            issues,
            scan_state,
            CandidateScanOutcomeKind::MetadataLimitReached,
            "Candidate metadata inspection limit was reached.",
            false,
        );
        return false;
    }
    scan_state.metadata_count += 1;
    true
}

fn io_outcome_kind(error: &std::io::Error) -> CandidateScanOutcomeKind {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        CandidateScanOutcomeKind::PermissionDenied
    } else {
        CandidateScanOutcomeKind::MetadataUnavailable
    }
}

fn record_issue(
    issues: &mut Vec<DiscoveryIssue>,
    scan_state: &mut ScanState,
    kind: CandidateScanOutcomeKind,
    message: &str,
    retryable: bool,
) {
    push_issue(issues, message, retryable);
    record_outcome(scan_state, kind, message, retryable);
}

fn record_outcome(
    scan_state: &mut ScanState,
    kind: CandidateScanOutcomeKind,
    message: &str,
    retryable: bool,
) {
    if scan_state.outcomes.len() < MAX_OUTCOMES
        && !scan_state
            .outcomes
            .iter()
            .any(|outcome| outcome.kind == kind)
    {
        scan_state.outcomes.push(CandidateScanOutcome {
            kind,
            message: message.to_owned(),
            retryable,
        });
    }
}

fn is_excluded_path(path: &Path, kind: CandidateKind) -> bool {
    kind == CandidateKind::Socket
        || path
            .components()
            .any(|component| is_excluded_name(&component.as_os_str().to_string_lossy()))
}

fn is_excluded_name(name: &str) -> bool {
    let normalized = name.trim_start_matches('.').to_ascii_lowercase();
    let normalized_path = Path::new(&normalized);
    let stem = normalized_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(normalized.as_str());
    let extension = normalized_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    is_excluded_stem(stem)
        || matches!(
            normalized.as_str(),
            "git-credentials"
                | "netrc"
                | "pypirc"
                | "id_rsa"
                | "id_dsa"
                | "id_ecdsa"
                | "id_ed25519"
                | "private_key"
                | "private-key"
                | "token-store"
                | "token_store"
                | "access-token"
                | "access_token"
                | "keychain"
                | "keyring"
                | "_cacache"
                | "node_modules"
                | "package-store"
                | "package_store"
                | "pnpm-store"
        )
        || matches!(
            extension,
            "db" | "sqlite"
                | "sqlite3"
                | "log"
                | "lock"
                | "pid"
                | "sock"
                | "socket"
                | "pem"
                | "key"
        )
        || normalized.ends_with(".lock")
        || normalized.ends_with("-lock")
        || normalized.ends_with("_lock")
        || normalized.ends_with("-token")
        || normalized.ends_with("_token")
}

fn is_excluded_stem(stem: &str) -> bool {
    matches!(
        stem,
        "credential"
            | "credentials"
            | "token"
            | "tokens"
            | "auth"
            | "oauth"
            | "cache"
            | "caches"
            | "log"
            | "logs"
            | "database"
            | "databases"
            | "db"
            | "socket"
            | "sockets"
            | "packages"
            | "store"
            | "stores"
            | "registry"
            | "lock"
            | "locks"
            | "runtime"
            | "run"
            | "state"
            | "session"
            | "sessions"
            | "npm"
    )
}

fn push_issue(issues: &mut Vec<DiscoveryIssue>, message: &str, retryable: bool) {
    if issues.len() < MAX_ISSUES && !issues.iter().any(|issue| issue.message == message) {
        issues.push(DiscoveryIssue::new("candidates", message, retryable));
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::symlink;

    use super::*;

    #[test]
    fn scans_approved_roots_without_reading_candidate_contents() {
        let home = env::temp_dir().join(format!("userhome-candidates-{}", std::process::id()));
        let brew = home.join("homebrew");
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join(".unknown/nested"))
            .expect("unknown directory should be created");
        fs::write(home.join(".unknown/nested/secret"), "must not be read")
            .expect("nested fixture should be written");
        fs::create_dir_all(home.join(".copilot")).expect("managed directory should be created");
        fs::write(home.join(".copilot/config.json"), "{}")
            .expect("managed copilot config should be written");
        fs::create_dir_all(home.join(".config/ghostty"))
            .expect("managed XDG directory should be created");
        fs::write(home.join(".config/ghostty/config"), "theme = dark")
            .expect("managed ghostty config should be written");
        fs::create_dir_all(home.join(".config/not-catalog"))
            .expect("non-catalog XDG directory should be created");
        fs::write(home.join(".config/not-catalog/settings.json"), "{}")
            .expect("non-catalog XDG file should be written");
        fs::create_dir_all(home.join(".xdg/ghostty"))
            .expect("managed custom XDG directory should be created");
        fs::write(home.join(".xdg/ghostty/config"), "theme = light")
            .expect("managed custom XDG config should be written");
        fs::create_dir_all(home.join(".xdg/not-catalog"))
            .expect("non-catalog custom XDG directory should be created");
        fs::write(home.join(".xdg/not-catalog/settings.json"), "{}")
            .expect("non-catalog custom XDG file should be written");
        fs::create_dir_all(home.join("Library/Application Support/Code/User"))
            .expect("managed application support directory should be created");
        fs::write(
            home.join("Library/Application Support/Code/User/settings.json"),
            "{}",
        )
        .expect("managed Code settings should be written");
        fs::create_dir_all(home.join("Library/Application Support/Not Catalog"))
            .expect("non-catalog application support directory should be created");
        fs::write(
            home.join("Library/Application Support/Not Catalog/settings.json"),
            "{}",
        )
        .expect("non-catalog application support file should be written");
        fs::create_dir_all(home.join("Library/LaunchAgents"))
            .expect("launch agents directory should be created");
        fs::write(
            home.join("Library/LaunchAgents/homebrew.mxcl.caddy.plist"),
            "must not be read",
        )
        .expect("catalog service metadata should be written");
        fs::create_dir_all(brew.join("etc")).expect("brew etc directory should be created");
        fs::write(brew.join("etc/Caddyfile"), "localhost")
            .expect("managed brew config should be written");
        fs::write(brew.join("etc/tool.conf"), "must not be read")
            .expect("unknown brew config should be written");
        symlink(".unknown", home.join(".linked")).expect("metadata-only symlink should be created");
        fs::write(home.join(".not-a-directory"), "ignored").expect("hidden file should be written");

        let candidates =
            discover_candidates_in(&home, Some(&home.join(".xdg")), std::slice::from_ref(&brew))
                .expect("candidate scan should succeed");
        let candidate = |relative_path: &str| {
            candidates
                .candidates
                .iter()
                .find(|candidate| candidate.relative_path == relative_path)
                .expect("candidate should be present")
        };

        assert_eq!(
            candidate("XDG_CONFIG_HOME/ghostty/config").coverage_class,
            CatalogCoverageClass::ManagedReadOnly
        );
        assert_eq!(
            candidate("~/.copilot/config.json").coverage_class,
            CatalogCoverageClass::ManagedWritable
        );
        assert_eq!(
            candidate("~/.unknown").coverage_class,
            CatalogCoverageClass::DetectedUnsupported
        );
        assert_eq!(
            candidate("APPLICATION_SUPPORT/Code/User/settings.json").coverage_class,
            CatalogCoverageClass::ManagedReadOnly
        );
        assert_eq!(
            candidate("HOMEBREW_PREFIX/etc/Caddyfile")
                .catalog_app_id
                .as_deref(),
            Some("caddy")
        );
        assert_eq!(
            candidate("HOMEBREW_PREFIX/etc/tool.conf").coverage_class,
            CatalogCoverageClass::DetectedUnsupported
        );
        assert_eq!(
            candidate("~/Library/LaunchAgents/homebrew.mxcl.caddy.plist")
                .catalog_app_id
                .as_deref(),
            Some("caddy")
        );
        assert!(
            candidate("~/Library/LaunchAgents/homebrew.mxcl.caddy.plist")
                .evidence
                .contains(&CandidateEvidence::CatalogService)
        );
        assert!(
            candidate("~/.linked")
                .evidence
                .contains(&CandidateEvidence::SymlinkMetadataOnly)
        );
        assert_eq!(
            candidates.summary.candidate_count,
            candidates.candidates.len()
        );
        assert!(candidates.summary.metadata_count >= candidates.candidates.len());
        assert_eq!(candidates.summary.root_count, 4);
        assert!(candidates.summary.elapsed_ms < 2_000);
        assert_eq!(candidates.summary.limits, scan_limits());
        assert!(candidates.candidates.iter().all(|candidate| {
            candidate.candidate_id.starts_with("candidate-")
                && !candidate.relative_path.starts_with('/')
                && !candidate.classification_reason.is_empty()
                && !candidate.evidence.is_empty()
        }));
        assert_eq!(
            candidate("APPLICATION_SUPPORT/Code/User/settings.json").root_kind,
            CandidateRootKind::ApplicationSupport
        );
        assert_eq!(
            candidate("APPLICATION_SUPPORT/Code/User/settings.json").relative_path,
            "APPLICATION_SUPPORT/Code/User/settings.json"
        );
        assert_eq!(
            candidate("APPLICATION_SUPPORT/Code/User/settings.json")
                .catalog_app_id
                .as_deref(),
            Some("visual-studio-code")
        );
        assert_eq!(
            candidate("APPLICATION_SUPPORT/Code/User/settings.json").format_hints,
            ["JSON"]
        );
        assert_eq!(
            candidate("APPLICATION_SUPPORT/Code/User/settings.json").sensitivity_hint,
            CandidateSensitivityHint::Sensitive
        );
        assert!(candidates.candidates.iter().all(|candidate| {
            matches!(
                candidate.coverage_class,
                CatalogCoverageClass::ManagedWritable
                    | CatalogCoverageClass::ManagedReadOnly
                    | CatalogCoverageClass::DetectedUnsupported
                    | CatalogCoverageClass::Excluded
            )
        }));
        let repeated =
            discover_candidates_in(&home, Some(&home.join(".xdg")), std::slice::from_ref(&brew))
                .expect("repeated candidate scan should succeed");
        assert_eq!(
            candidates
                .candidates
                .iter()
                .map(|candidate| (&candidate.candidate_id, candidate.coverage_class))
                .collect::<Vec<_>>(),
            repeated
                .candidates
                .iter()
                .map(|candidate| (&candidate.candidate_id, candidate.coverage_class))
                .collect::<Vec<_>>()
        );
        let serialized = serde_json::to_string(&candidates).expect("candidates should serialize");
        assert!(!serialized.contains("\"name\":\".xdg\""));
        assert!(!serialized.contains("nested"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("settings.json\":\"{}"));
        assert!(!serialized.contains("must not be read"));
        assert!(!serialized.contains(home.to_string_lossy().as_ref()));
        assert!(!serialized.contains(brew.to_string_lossy().as_ref()));

        fs::remove_dir_all(home).expect("fixture home should be removed");
    }
}
