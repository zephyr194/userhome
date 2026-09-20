use std::{
    collections::BTreeMap,
    env, fs,
    os::unix::fs::FileTypeExt,
    path::{Path, PathBuf},
    time::{Duration, Instant, UNIX_EPOCH},
};

use serde::Serialize;

use crate::catalog::{CatalogCoverageClass, load_builtin_catalog};

use super::system::{DiscoveryCompleteness, DiscoveryIssue, catalog_home_document_coverage};

const MAX_CANDIDATES: usize = 128;
const MAX_ENTRIES_PER_ROOT: usize = 128;
const MAX_ISSUES: usize = 32;
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmanagedCandidate {
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
    pub(crate) issues: Vec<DiscoveryIssue>,
}

impl ConfigurationCoverage {
    #[cfg(test)]
    pub(crate) fn empty() -> Self {
        Self {
            completeness: DiscoveryCompleteness::Complete,
            candidates: Vec::new(),
            issues: Vec::new(),
        }
    }
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
    discover_candidates_in(&home, xdg_config_home.as_deref())
}

fn discover_candidates_in(
    home: &Path,
    xdg_config_home: Option<&Path>,
) -> Result<ConfigurationCoverage, DiscoveryIssue> {
    let catalog = load_builtin_catalog().map_err(|_| {
        DiscoveryIssue::new("candidates", "Application catalog is unavailable.", false)
    })?;
    let managed_paths = catalog_home_document_coverage(&catalog);
    let mut issues = Vec::new();
    let home_root = match fs::canonicalize(home) {
        Ok(path) => path,
        Err(_) => {
            return Ok(ConfigurationCoverage {
                completeness: DiscoveryCompleteness::Partial,
                candidates: Vec::new(),
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

    let xdg_config_home = match xdg_config_home {
        Some(path) if path.is_absolute() => Some(path),
        Some(_) => {
            push_issue(
                &mut issues,
                "XDG configuration root is not an absolute path.",
                false,
            );
            None
        }
        None => None,
    };
    let xdg_home_entry = xdg_config_home
        .and_then(|path| path.strip_prefix(home).ok())
        .and_then(|relative| relative.components().next())
        .map(|component| component.as_os_str().to_string_lossy().into_owned());

    for (relative, coverage_class) in &managed_paths {
        if Instant::now() >= deadline {
            push_issue(
                &mut issues,
                "Candidate metadata scan reached its time limit.",
                true,
            );
            break;
        }
        scan_catalog_path(
            &home.join(relative),
            relative,
            &home_root,
            *coverage_class,
            &mut candidates,
            &mut issues,
        );
        if candidates.len() >= MAX_CANDIDATES {
            push_issue(&mut issues, "Candidate metadata limit was reached.", false);
            break;
        }

        let Some(xdg_root) = xdg_config_home else {
            continue;
        };
        let Ok(xdg_relative) = relative.strip_prefix(".config") else {
            continue;
        };
        if xdg_relative.as_os_str().is_empty() || xdg_root == home.join(".config") {
            continue;
        }
        if Instant::now() >= deadline {
            push_issue(
                &mut issues,
                "Candidate metadata scan reached its time limit.",
                true,
            );
            break;
        }
        scan_catalog_path(
            &xdg_root.join(xdg_relative),
            &Path::new("XDG_CONFIG_HOME").join(xdg_relative),
            &home_root,
            *coverage_class,
            &mut candidates,
            &mut issues,
        );
    }

    if candidates.len() < MAX_CANDIDATES && Instant::now() < deadline {
        scan_home_root(
            &home_root,
            &managed_paths,
            xdg_home_entry.as_deref(),
            deadline,
            &mut candidates,
            &mut issues,
        );
        if candidates.len() >= MAX_CANDIDATES {
            push_issue(&mut issues, "Candidate metadata limit was reached.", false);
        }
    } else if Instant::now() >= deadline {
        push_issue(
            &mut issues,
            "Candidate metadata scan reached its time limit.",
            true,
        );
    }

    Ok(ConfigurationCoverage {
        completeness: if issues.is_empty() {
            DiscoveryCompleteness::Complete
        } else {
            DiscoveryCompleteness::Partial
        },
        candidates: candidates.into_values().take(MAX_CANDIDATES).collect(),
        issues,
    })
}

fn scan_catalog_path(
    path: &Path,
    display_path: &Path,
    home_root: &Path,
    coverage_class: CatalogCoverageClass,
    candidates: &mut BTreeMap<String, UnmanagedCandidate>,
    issues: &mut Vec<DiscoveryIssue>,
) {
    let display_name = display_path.to_string_lossy().into_owned();
    if display_name.is_empty() || display_name.len() > MAX_CANDIDATE_PATH_BYTES {
        return;
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            push_issue(
                issues,
                &format!("Metadata for {display_name} could not be inspected."),
                true,
            );
            return;
        }
    };

    let Some(parent) = path.parent() else {
        return;
    };
    match fs::canonicalize(parent) {
        Ok(path) if path.starts_with(home_root) => {}
        Ok(_) => {
            push_issue(
                issues,
                &format!("{display_name} resolves outside the supported home directory."),
                false,
            );
            return;
        }
        Err(_) => {
            push_issue(
                issues,
                &format!("Metadata for {display_name} could not be resolved."),
                true,
            );
            return;
        }
    };

    insert_candidate(
        display_name,
        display_path,
        &metadata,
        coverage_class,
        candidates,
        issues,
    );
}

fn scan_home_root(
    home_root: &Path,
    managed_paths: &BTreeMap<PathBuf, CatalogCoverageClass>,
    xdg_home_entry: Option<&str>,
    deadline: Instant,
    candidates: &mut BTreeMap<String, UnmanagedCandidate>,
    issues: &mut Vec<DiscoveryIssue>,
) {
    let entries = match fs::read_dir(home_root) {
        Ok(entries) => entries,
        Err(_) => {
            push_issue(
                issues,
                "Metadata under the home directory could not be listed.",
                true,
            );
            return;
        }
    };

    for (index, entry) in entries.enumerate() {
        if Instant::now() >= deadline {
            push_issue(
                issues,
                "Candidate metadata scan reached its time limit.",
                true,
            );
            return;
        }
        if index >= MAX_ENTRIES_PER_ROOT {
            push_issue(
                issues,
                "Candidate metadata limit was reached for the home directory.",
                false,
            );
            return;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                push_issue(
                    issues,
                    "An entry under the home directory could not be inspected.",
                    true,
                );
                continue;
            }
        };
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        if !is_home_candidate(&entry_name, managed_paths, xdg_home_entry) {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => {
                push_issue(
                    issues,
                    &format!("Metadata for {entry_name} could not be inspected."),
                    true,
                );
                continue;
            }
        };
        let kind = candidate_kind(&metadata);
        if !matches!(kind, CandidateKind::Directory | CandidateKind::Symlink) {
            continue;
        }
        let relative = PathBuf::from(&entry_name);
        let coverage_class = if is_excluded_path(&relative, kind) {
            CatalogCoverageClass::Excluded
        } else {
            managed_paths
                .get(&relative)
                .copied()
                .unwrap_or(CatalogCoverageClass::DetectedUnsupported)
        };
        insert_candidate(
            entry_name,
            &relative,
            &metadata,
            coverage_class,
            candidates,
            issues,
        );
        if candidates.len() >= MAX_CANDIDATES {
            return;
        }
    }
}

fn is_home_candidate(
    name: &str,
    managed_paths: &BTreeMap<PathBuf, CatalogCoverageClass>,
    xdg_home_entry: Option<&str>,
) -> bool {
    is_safe_name(name)
        && name.starts_with('.')
        && xdg_home_entry != Some(name)
        && !managed_paths
            .keys()
            .any(|path| path != Path::new(name) && path.starts_with(name))
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
    display_name: String,
    relative: &Path,
    metadata: &fs::Metadata,
    coverage_class: CatalogCoverageClass,
    candidates: &mut BTreeMap<String, UnmanagedCandidate>,
    issues: &mut Vec<DiscoveryIssue>,
) {
    let kind = candidate_kind(metadata);
    let coverage_class = if is_excluded_path(relative, kind) {
        CatalogCoverageClass::Excluded
    } else {
        coverage_class
    };
    let modified_at_epoch_ms = match metadata.modified() {
        Ok(value) => value
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| u64::try_from(duration.as_millis()).ok()),
        Err(_) => {
            push_issue(
                issues,
                &format!("Modification metadata for {display_name} could not be read."),
                true,
            );
            None
        }
    };
    candidates
        .entry(display_name.clone())
        .or_insert(UnmanagedCandidate {
            name: display_name,
            kind,
            coverage_class,
            modified_at_epoch_ms,
        });
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
    use super::*;

    #[test]
    fn exposes_only_shallow_unknown_directory_metadata() {
        let home = env::temp_dir().join(format!("userhome-candidates-{}", std::process::id()));
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
        fs::write(home.join(".not-a-directory"), "ignored").expect("hidden file should be written");

        let candidates = discover_candidates_in(&home, Some(&home.join(".xdg")))
            .expect("candidate scan should succeed");

        assert_eq!(candidates.candidates.len(), 5);
        assert_eq!(candidates.candidates[0].name, ".config/ghostty/config");
        assert_eq!(
            candidates.candidates[0].coverage_class,
            CatalogCoverageClass::ManagedReadOnly
        );
        assert_eq!(candidates.candidates[1].name, ".copilot/config.json");
        assert_eq!(
            candidates.candidates[1].coverage_class,
            CatalogCoverageClass::ManagedWritable
        );
        assert_eq!(candidates.candidates[2].name, ".unknown");
        assert_eq!(
            candidates.candidates[2].coverage_class,
            CatalogCoverageClass::DetectedUnsupported
        );
        assert_eq!(
            candidates.candidates[3].name,
            "Library/Application Support/Code/User/settings.json"
        );
        assert_eq!(
            candidates.candidates[3].coverage_class,
            CatalogCoverageClass::ManagedReadOnly
        );
        assert_eq!(
            candidates.candidates[4].name,
            "XDG_CONFIG_HOME/ghostty/config"
        );
        assert_eq!(
            candidates.candidates[4].coverage_class,
            CatalogCoverageClass::ManagedReadOnly
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
        let serialized = serde_json::to_string(&candidates).expect("candidates should serialize");
        assert!(!serialized.contains("\"name\":\".config\""));
        assert!(!serialized.contains("\"name\":\".config/ghostty\""));
        assert!(!serialized.contains("\"name\":\".copilot\""));
        assert!(!serialized.contains("\"name\":\".xdg\""));
        assert!(!serialized.contains("\"name\":\"XDG_CONFIG_HOME/ghostty\""));
        assert!(!serialized.contains("\"name\":\"Library/Application Support/Code\""));
        assert!(!serialized.contains("not-catalog"));
        assert!(!serialized.contains("Not Catalog"));
        assert!(!serialized.contains("nested"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains(home.to_string_lossy().as_ref()));

        fs::remove_dir_all(home).expect("fixture home should be removed");
    }
}
