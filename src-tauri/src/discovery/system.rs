use std::{
    collections::BTreeSet,
    env, fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{
    catalog::{Catalog, DetectionRule, load_builtin_catalog},
    process::run_bounded,
};

const LOCAL_COMMAND_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_LOCAL_OUTPUT_BYTES: usize = 4 * 1024;
const TRUSTED_EXECUTABLE_DIRS: &[&str] = &["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const TRUSTED_BREW_PREFIXES: &[&str] = &["/opt/homebrew", "/usr/local"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiscoveryCompleteness {
    Complete,
    Partial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DetectionStatus {
    Detected,
    Partial,
    Absent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceKind {
    ConfigPresent,
    ExecutablePresent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PathEntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryIssue {
    pub(crate) module: String,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

impl DiscoveryIssue {
    pub(crate) fn new(module: &str, message: &str, retryable: bool) -> Self {
        Self {
            module: module.to_owned(),
            message: message.to_owned(),
            retryable,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathMetadata {
    display_path: String,
    kind: PathEntryKind,
    modified_at_epoch_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionEvidence {
    kind: EvidenceKind,
    present: bool,
    label: String,
    path: Option<PathMetadata>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppDetection {
    app_id: String,
    display_name: String,
    status: DetectionStatus,
    evidence: Vec<DetectionEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSummary {
    pub(crate) completeness: DiscoveryCompleteness,
    pub(crate) os_version: Option<String>,
    pub(crate) architecture: Option<String>,
    pub(crate) home_directory: String,
    pub(crate) shell: Option<String>,
    pub(crate) applications: Vec<ManagedAppDetection>,
    pub(crate) issues: Vec<DiscoveryIssue>,
}

impl SystemSummary {
    pub fn detected_app_count(&self) -> usize {
        self.applications
            .iter()
            .filter(|application| application.status != DetectionStatus::Absent)
            .count()
    }

    pub fn has_partial_application_detection(&self) -> bool {
        self.applications
            .iter()
            .any(|application| application.status == DetectionStatus::Partial)
    }
}

pub fn discover_system() -> Result<SystemSummary, DiscoveryIssue> {
    let home = env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| DiscoveryIssue::new("system", "Home directory is unavailable.", false))?;
    let catalog = load_builtin_catalog().map_err(|_| {
        DiscoveryIssue::new("catalog", "Application catalog is unavailable.", false)
    })?;

    Ok(discover_with(
        &home,
        env::var("SHELL").ok(),
        command_value("/usr/bin/sw_vers", &["-productVersion"]),
        command_value("/usr/bin/uname", &["-m"]),
        &catalog,
        &trusted_executable_dirs(),
    ))
}

fn command_value(executable: &str, args: &[&str]) -> Result<String, ()> {
    let output = run_bounded(
        Path::new(executable),
        args,
        LOCAL_COMMAND_TIMEOUT,
        MAX_LOCAL_OUTPUT_BYTES,
    )
    .map_err(|_| ())?;
    let value = output.stdout.trim();
    if value.is_empty() || value.len() > 256 {
        return Err(());
    }
    Ok(value.to_owned())
}

fn discover_with(
    home: &Path,
    shell: Option<String>,
    os_version: Result<String, ()>,
    architecture: Result<String, ()>,
    catalog: &Catalog,
    executable_directories: &[PathBuf],
) -> SystemSummary {
    let mut issues = Vec::new();
    let os_version = os_version.map(Some).unwrap_or_else(|_| {
        issues.push(DiscoveryIssue::new(
            "macos-version",
            "macOS version could not be detected.",
            true,
        ));
        None
    });
    let architecture = architecture.map(Some).unwrap_or_else(|_| {
        issues.push(DiscoveryIssue::new(
            "architecture",
            "System architecture could not be detected.",
            true,
        ));
        None
    });
    let shell = shell.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty() && trimmed.len() <= 512).then(|| trimmed.to_owned())
    });
    if shell.is_none() {
        issues.push(DiscoveryIssue::new(
            "shell",
            "Login shell is unavailable.",
            false,
        ));
    }

    let applications = catalog
        .apps()
        .iter()
        .map(|app| {
            let evidence = app
                .detection_rules()
                .iter()
                .filter_map(|rule| discover_local_evidence(home, rule, executable_directories))
                .collect::<Vec<_>>();
            let present_count = evidence.iter().filter(|item| item.present).count();
            let status = if present_count == 0 {
                DetectionStatus::Absent
            } else if present_count == evidence.len() {
                DetectionStatus::Detected
            } else {
                DetectionStatus::Partial
            };

            ManagedAppDetection {
                app_id: app.id().to_owned(),
                display_name: app.display_name().to_owned(),
                status,
                evidence,
            }
        })
        .collect();

    SystemSummary {
        completeness: if issues.is_empty() {
            DiscoveryCompleteness::Complete
        } else {
            DiscoveryCompleteness::Partial
        },
        os_version,
        architecture,
        home_directory: home.to_string_lossy().into_owned(),
        shell,
        applications,
        issues,
    }
}

fn discover_local_evidence(
    home: &Path,
    rule: &DetectionRule,
    executable_directories: &[PathBuf],
) -> Option<DetectionEvidence> {
    match rule.kind() {
        "HOME_PATH" => {
            let relative = rule.value().strip_prefix("~/")?;
            let path = home.join(relative);
            Some(path_evidence(rule.value(), &path))
        }
        "HOMEBREW_PATH" => TRUSTED_BREW_PREFIXES
            .iter()
            .map(|prefix| {
                let relative = rule
                    .value()
                    .strip_prefix("${HOMEBREW_PREFIX}/")
                    .unwrap_or_default();
                let path = Path::new(prefix).join(relative);
                path_evidence(&format!("{prefix}/{}", relative), &path)
            })
            .find(|evidence| evidence.present)
            .or_else(|| {
                Some(DetectionEvidence {
                    kind: EvidenceKind::ConfigPresent,
                    present: false,
                    label: rule.value().to_owned(),
                    path: None,
                })
            }),
        "EXECUTABLE" => Some(executable_evidence(rule.value(), executable_directories)),
        _ => None,
    }
}

fn path_evidence(label: &str, path: &Path) -> DetectionEvidence {
    let metadata = fs::symlink_metadata(path).ok();
    DetectionEvidence {
        kind: EvidenceKind::ConfigPresent,
        present: metadata.is_some(),
        label: label.to_owned(),
        path: metadata.map(|metadata| PathMetadata {
            display_path: label.to_owned(),
            kind: entry_kind(&metadata),
            modified_at_epoch_ms: modified_at_epoch_ms(&metadata),
        }),
    }
}

fn executable_evidence(name: &str, executable_directories: &[PathBuf]) -> DetectionEvidence {
    let path = executable_directories
        .iter()
        .map(|directory| directory.join(name))
        .find(|candidate| {
            fs::metadata(candidate)
                .map(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        });

    DetectionEvidence {
        kind: EvidenceKind::ExecutablePresent,
        present: path.is_some(),
        label: name.to_owned(),
        path: path.map(|path| PathMetadata {
            display_path: path.to_string_lossy().into_owned(),
            kind: PathEntryKind::File,
            modified_at_epoch_ms: fs::metadata(&path)
                .ok()
                .as_ref()
                .and_then(modified_at_epoch_ms),
        }),
    }
}

fn trusted_executable_dirs() -> Vec<PathBuf> {
    let mut directories = TRUSTED_EXECUTABLE_DIRS
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    for prefix in TRUSTED_BREW_PREFIXES {
        directories.push(Path::new(prefix).join("bin"));
        directories.push(Path::new(prefix).join("sbin"));
    }
    directories
}

fn entry_kind(metadata: &fs::Metadata) -> PathEntryKind {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        PathEntryKind::Symlink
    } else if file_type.is_file() {
        PathEntryKind::File
    } else if file_type.is_dir() {
        PathEntryKind::Directory
    } else {
        PathEntryKind::Other
    }
}

fn modified_at_epoch_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

pub(crate) fn managed_dot_directories(catalog: &Catalog) -> BTreeSet<String> {
    catalog
        .apps()
        .iter()
        .flat_map(|app| app.detection_rules())
        .filter(|rule| rule.kind() == "HOME_PATH")
        .filter_map(|rule| rule.value().strip_prefix("~/"))
        .filter_map(|relative| relative.split('/').next())
        .filter(|name| name.starts_with('.'))
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{
        fs::{self, File},
        os::unix::fs::PermissionsExt,
    };

    use super::*;

    fn fixture_home(name: &str) -> PathBuf {
        let path = env::temp_dir().join(format!("userhome-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("fixture home should be created");
        path
    }

    #[test]
    fn discovers_metadata_without_reading_managed_contents() {
        let home = fixture_home("system-metadata");
        fs::create_dir(home.join(".copilot")).expect("copilot directory should be created");
        fs::write(home.join(".gitconfig"), [0xff, 0xfe, 0xfd])
            .expect("non-text fixture should be written");
        let catalog = load_builtin_catalog().expect("catalog should load");

        let summary = discover_with(
            &home,
            Some("/bin/zsh".to_owned()),
            Ok("15.0".to_owned()),
            Ok("arm64".to_owned()),
            &catalog,
            &[],
        );

        assert_eq!(summary.completeness, DiscoveryCompleteness::Complete);
        assert_eq!(summary.os_version.as_deref(), Some("15.0"));
        assert_eq!(summary.architecture.as_deref(), Some("arm64"));
        let git = summary
            .applications
            .iter()
            .find(|app| app.app_id == "git")
            .expect("git should be present");
        assert!(
            git.evidence.iter().any(|evidence| {
                evidence.kind == EvidenceKind::ConfigPresent && evidence.present
            })
        );

        fs::remove_dir_all(home).expect("fixture home should be removed");
    }

    #[test]
    fn distinguishes_configuration_and_executable_evidence() {
        let home = fixture_home("system-evidence");
        fs::write(home.join(".npmrc"), "ignored=contents").expect("fixture metadata should exist");
        let executable = home.join("npm");
        File::create(&executable).expect("fixture executable should be created");
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
            .expect("fixture executable should be executable");
        let catalog = load_builtin_catalog().expect("catalog should load");

        let summary = discover_with(
            &home,
            Some("/bin/zsh".to_owned()),
            Ok("15.0".to_owned()),
            Ok("arm64".to_owned()),
            &catalog,
            std::slice::from_ref(&home),
        );
        let npm = summary
            .applications
            .iter()
            .find(|app| app.app_id == "npm")
            .expect("npm should be present");

        assert!(
            npm.evidence.iter().any(|evidence| {
                evidence.kind == EvidenceKind::ConfigPresent && evidence.present
            })
        );
        assert!(npm.evidence.iter().any(|evidence| {
            evidence.kind == EvidenceKind::ExecutablePresent && evidence.present
        }));

        fs::remove_dir_all(home).expect("fixture home should be removed");
    }

    #[test]
    fn records_local_command_failures_as_partial_results() {
        let home = fixture_home("system-partial");
        let catalog = load_builtin_catalog().expect("catalog should load");

        let summary = discover_with(&home, None, Err(()), Ok("arm64".to_owned()), &catalog, &[]);

        assert_eq!(summary.completeness, DiscoveryCompleteness::Partial);
        assert_eq!(summary.architecture.as_deref(), Some("arm64"));
        assert_eq!(summary.issues.len(), 2);
        assert!(!summary.applications.is_empty());

        fs::remove_dir_all(home).expect("fixture home should be removed");
    }
}
