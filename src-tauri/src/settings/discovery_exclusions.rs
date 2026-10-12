use std::{collections::HashSet, path::Path};

use serde::{Deserialize, Serialize};

use crate::{catalog::profiles::safe_relative_path, error::AppError};

pub const BUILTIN_EXCLUSIONS: &[&str] = &[
    ".Trash",
    ".cache",
    ".copilot/logs",
    ".copilot/session-state",
    ".copilot/command-history-state",
    ".copilot/mcp-oauth-config",
    ".copilot/mcp-secrets",
];
pub const MAX_USER_EXCLUSIONS: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscoveryExclusions {
    pub schema_version: u16,
    pub user_paths: Vec<String>,
}

impl Default for DiscoveryExclusions {
    fn default() -> Self {
        Self {
            schema_version: 1,
            user_paths: Vec::new(),
        }
    }
}

impl DiscoveryExclusions {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != 1
            || self.user_paths.len() > MAX_USER_EXCLUSIONS
            || self.user_paths.iter().any(|path| {
                !safe_relative_path(path) || BUILTIN_EXCLUSIONS.contains(&path.as_str())
            })
            || self.user_paths.iter().collect::<HashSet<_>>().len() != self.user_paths.len()
        {
            return Err(AppError::invalid_input(
                "排除规则必须是唯一的 HOME 相对路径，且不能包含通配符或上级路径。",
            ));
        }
        Ok(())
    }

    pub fn excludes(&self, relative: &Path) -> bool {
        BUILTIN_EXCLUSIONS
            .iter()
            .copied()
            .chain(self.user_paths.iter().map(String::as_str))
            .any(|path| relative.starts_with(Path::new(path)))
    }

    pub fn presentation(&self) -> DiscoveryExclusionsPresentation {
        DiscoveryExclusionsPresentation {
            schema_version: self.schema_version,
            builtin_paths: BUILTIN_EXCLUSIONS
                .iter()
                .map(|path| (*path).to_owned())
                .collect(),
            user_paths: self.user_paths.clone(),
            max_user_paths: MAX_USER_EXCLUSIONS,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryExclusionsPresentation {
    pub schema_version: u16,
    pub builtin_paths: Vec<String>,
    pub user_paths: Vec<String>,
    pub max_user_paths: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_rules_do_not_match_similar_names_or_remove_builtin_rules() {
        let rules = DiscoveryExclusions {
            user_paths: vec![".copilot".into()],
            ..Default::default()
        };
        rules.validate().expect("rules");
        assert!(rules.excludes(Path::new(".Trash/item")));
        assert!(rules.excludes(Path::new(".copilot/instructions/a.instructions.md")));
        assert!(!rules.excludes(Path::new(".copilot-backup")));
        for path in [
            "",
            "/tmp",
            "..",
            ".copilot/./settings.json",
            ".copilot//instructions",
            ".copilot/*",
            ".Trash",
        ] {
            assert!(
                DiscoveryExclusions {
                    user_paths: vec![path.into()],
                    ..Default::default()
                }
                .validate()
                .is_err()
            );
        }
        let duplicate = DiscoveryExclusions {
            user_paths: vec![".copilot".into(), ".copilot".into()],
            ..Default::default()
        };
        assert!(duplicate.validate().is_err());
    }
}
