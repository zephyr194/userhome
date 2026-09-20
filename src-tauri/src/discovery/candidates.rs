use std::{
    env, fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use crate::catalog::load_builtin_catalog;

use super::system::{DiscoveryIssue, managed_dot_directories};

const MAX_CANDIDATES: usize = 128;
const MAX_CANDIDATE_NAME_BYTES: usize = 255;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateKind {
    Directory,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmanagedCandidate {
    name: String,
    kind: CandidateKind,
    modified_at_epoch_ms: Option<u64>,
}

pub fn discover_candidates() -> Result<Vec<UnmanagedCandidate>, DiscoveryIssue> {
    let home = env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            DiscoveryIssue::new("candidates", "Home directory is unavailable.", false)
        })?;
    discover_candidates_in(&home)
}

fn discover_candidates_in(home: &Path) -> Result<Vec<UnmanagedCandidate>, DiscoveryIssue> {
    let catalog = load_builtin_catalog().map_err(|_| {
        DiscoveryIssue::new("candidates", "Application catalog is unavailable.", false)
    })?;
    let managed = managed_dot_directories(&catalog);
    let entries = fs::read_dir(home).map_err(|_| {
        DiscoveryIssue::new(
            "candidates",
            "Home directory metadata could not be listed.",
            true,
        )
    })?;
    let mut candidates = Vec::new();

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_candidate_name(&name) || managed.contains(&name) {
            continue;
        }
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        let kind = if metadata.file_type().is_symlink() {
            CandidateKind::Symlink
        } else if metadata.is_dir() {
            CandidateKind::Directory
        } else {
            continue;
        };
        let modified_at_epoch_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| u64::try_from(duration.as_millis()).ok());
        candidates.push(UnmanagedCandidate {
            name,
            kind,
            modified_at_epoch_ms,
        });
    }

    candidates.sort_by(|left, right| left.name.cmp(&right.name));
    candidates.truncate(MAX_CANDIDATES);
    Ok(candidates)
}

fn is_candidate_name(name: &str) -> bool {
    name.starts_with('.')
        && name.len() > 1
        && name.len() <= MAX_CANDIDATE_NAME_BYTES
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\0')
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

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].name, ".unknown");
        let serialized = serde_json::to_string(&candidates).expect("candidates should serialize");
        assert!(!serialized.contains("nested"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains(home.to_string_lossy().as_ref()));

        fs::remove_dir_all(home).expect("fixture home should be removed");
    }
}
