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
const MAX_ROOTS: usize = 32;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScanMode {
    Home,
    ConfigurationRoot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ScanRoot {
    path: PathBuf,
    display_prefix: PathBuf,
    mode: ScanMode,
}

pub fn discover_candidates() -> Result<ConfigurationCoverage, DiscoveryIssue> {
    let home = env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            DiscoveryIssue::new("candidates", "Home directory is unavailable.", false)
        })?;
    discover_candidates_in(&home)
}

fn discover_candidates_in(home: &Path) -> Result<ConfigurationCoverage, DiscoveryIssue> {
    let catalog = load_builtin_catalog().map_err(|_| {
        DiscoveryIssue::new("candidates", "Application catalog is unavailable.", false)
    })?;
    let managed_paths = catalog_home_document_coverage(&catalog);
    let mut issues = Vec::new();
    let roots = discovery_roots(home, managed_paths.keys(), &mut issues);
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

    for root in roots.into_iter().take(MAX_ROOTS) {
        if Instant::now() >= deadline {
            push_issue(
                &mut issues,
                "Candidate metadata scan reached its time limit.",
                true,
            );
            break;
        }
        scan_root(
            &root,
            &home_root,
            &managed_paths,
            deadline,
            &mut candidates,
            &mut issues,
        );
        if candidates.len() >= MAX_CANDIDATES {
            push_issue(&mut issues, "Candidate metadata limit was reached.", false);
            break;
        }
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

fn discovery_roots<'a>(
    home: &Path,
    managed_paths: impl Iterator<Item = &'a PathBuf>,
    issues: &mut Vec<DiscoveryIssue>,
) -> Vec<ScanRoot> {
    let mut roots = BTreeMap::new();
    add_root(
        &mut roots,
        home.to_path_buf(),
        PathBuf::new(),
        ScanMode::Home,
    );

    let default_xdg = home.join(".config");
    match env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        Some(value) => {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                add_root(
                    &mut roots,
                    path,
                    PathBuf::from("XDG_CONFIG_HOME"),
                    ScanMode::ConfigurationRoot,
                );
            } else {
                push_issue(
                    issues,
                    "XDG configuration root is not an absolute path.",
                    false,
                );
            }
        }
        None => add_root(
            &mut roots,
            default_xdg,
            PathBuf::from(".config"),
            ScanMode::ConfigurationRoot,
        ),
    }

    add_root(
        &mut roots,
        home.join("Library/Application Support"),
        PathBuf::from("Library/Application Support"),
        ScanMode::ConfigurationRoot,
    );

    for relative in managed_paths {
        if let Some(parent) = relative
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            add_root(
                &mut roots,
                home.join(parent),
                parent.to_path_buf(),
                ScanMode::ConfigurationRoot,
            );
        }
    }

    if roots.len() > MAX_ROOTS {
        push_issue(issues, "Candidate root limit was reached.", false);
    }
    roots.into_values().collect()
}

fn add_root(
    roots: &mut BTreeMap<PathBuf, ScanRoot>,
    path: PathBuf,
    display_prefix: PathBuf,
    mode: ScanMode,
) {
    roots.entry(path.clone()).or_insert(ScanRoot {
        path,
        display_prefix,
        mode,
    });
}

fn scan_root(
    root: &ScanRoot,
    home_root: &Path,
    managed_paths: &BTreeMap<PathBuf, CatalogCoverageClass>,
    deadline: Instant,
    candidates: &mut BTreeMap<String, UnmanagedCandidate>,
    issues: &mut Vec<DiscoveryIssue>,
) {
    let metadata = match fs::symlink_metadata(&root.path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            push_issue(
                issues,
                &format!(
                    "Metadata for {} could not be inspected.",
                    display_root(&root.display_prefix)
                ),
                true,
            );
            return;
        }
    };
    if !metadata.is_dir() && !metadata.file_type().is_symlink() {
        return;
    }

    let resolved = match fs::canonicalize(&root.path) {
        Ok(path) if path.starts_with(home_root) => path,
        Ok(_) => {
            push_issue(
                issues,
                &format!(
                    "{} resolves outside the supported home directory.",
                    display_root(&root.display_prefix)
                ),
                false,
            );
            return;
        }
        Err(_) => {
            push_issue(
                issues,
                &format!(
                    "Metadata for {} could not be resolved.",
                    display_root(&root.display_prefix)
                ),
                true,
            );
            return;
        }
    };
    let entries = match fs::read_dir(resolved) {
        Ok(entries) => entries,
        Err(_) => {
            push_issue(
                issues,
                &format!(
                    "Metadata under {} could not be listed.",
                    display_root(&root.display_prefix)
                ),
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
                &format!(
                    "Candidate metadata limit was reached for {}.",
                    display_root(&root.display_prefix)
                ),
                false,
            );
            return;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                push_issue(
                    issues,
                    &format!(
                        "An entry under {} could not be inspected.",
                        display_root(&root.display_prefix)
                    ),
                    true,
                );
                continue;
            }
        };
        let entry_name = entry.file_name().to_string_lossy().into_owned();
        if !is_safe_name(&entry_name)
            || (root.mode == ScanMode::Home && !is_home_candidate(&entry_name, managed_paths))
        {
            continue;
        }
        let relative = root.display_prefix.join(&entry_name);
        let display_name = relative.to_string_lossy().into_owned();
        if display_name.is_empty() || display_name.len() > MAX_CANDIDATE_PATH_BYTES {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => {
                push_issue(
                    issues,
                    &format!("Metadata for {display_name} could not be inspected."),
                    true,
                );
                continue;
            }
        };
        let kind = candidate_kind(&metadata);
        let coverage_class = if is_excluded_path(&relative, kind) {
            CatalogCoverageClass::Excluded
        } else {
            managed_paths
                .get(&relative)
                .copied()
                .unwrap_or(CatalogCoverageClass::DetectedUnsupported)
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
        if candidates.len() >= MAX_CANDIDATES {
            return;
        }
    }
}

fn is_home_candidate(name: &str, managed_paths: &BTreeMap<PathBuf, CatalogCoverageClass>) -> bool {
    name.starts_with('.')
        || is_excluded_name(name)
        || managed_paths.keys().any(|path| {
            path.components()
                .next()
                .is_some_and(|component| component.as_os_str() == name)
        })
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

fn display_root(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        "the home directory".to_owned()
    } else {
        path.to_string_lossy().into_owned()
    }
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
        fs::write(home.join(".not-a-directory"), "ignored").expect("hidden file should be written");

        let candidates = discover_candidates_in(&home).expect("candidate scan should succeed");

        assert_eq!(candidates.candidates.len(), 3);
        assert_eq!(candidates.candidates[0].name, ".copilot");
        assert_eq!(
            candidates.candidates[0].coverage_class,
            CatalogCoverageClass::DetectedUnsupported
        );
        assert_eq!(candidates.candidates[1].name, ".not-a-directory");
        assert_eq!(candidates.candidates[2].name, ".unknown");
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
        assert!(!serialized.contains("nested"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains(home.to_string_lossy().as_ref()));

        fs::remove_dir_all(home).expect("fixture home should be removed");
    }
}
