pub mod actions;
pub mod client;
pub mod details;
pub mod inventory;
pub mod search;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrewPackageKind {
    Formula,
    Cask,
}

pub fn validate_package_identifier(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 || value.starts_with('-') {
        return false;
    }

    let segments = value.split('/').collect::<Vec<_>>();
    segments.len() <= 3
        && segments.iter().all(|segment| {
            !segment.is_empty()
                && segment.bytes().all(|byte| {
                    matches!(
                        byte,
                        b'a'..=b'z'
                            | b'A'..=b'Z'
                            | b'0'..=b'9'
                            | b'@'
                            | b'+'
                            | b'.'
                            | b'_'
                            | b'-'
                    )
                })
        })
}

#[cfg(test)]
mod tests {
    use super::validate_package_identifier;

    #[test]
    fn package_identifier_rejects_flags_and_shell_text() {
        assert!(validate_package_identifier("caddy"));
        assert!(validate_package_identifier("user/tap/tool@2"));
        assert!(!validate_package_identifier("--formula"));
        assert!(!validate_package_identifier("caddy;whoami"));
        assert!(!validate_package_identifier("caddy $(whoami)"));
        assert!(!validate_package_identifier("user//caddy"));
    }
}

#[cfg(test)]
mod install {
    use super::{BrewPackageKind, actions::BrewAction, client::BrewCommand};

    #[test]
    fn uses_only_the_fixed_formula_install_shape() {
        assert_eq!(
            BrewCommand::Action {
                action: BrewAction::Install,
                kind: BrewPackageKind::Formula,
                identifier: "caddy".to_owned(),
            }
            .args(),
            ["install", "caddy"]
        );
    }
}

#[cfg(test)]
mod upgrade {
    use super::{BrewPackageKind, actions::BrewAction, client::BrewCommand};

    #[test]
    fn uses_only_the_fixed_cask_upgrade_shape() {
        assert_eq!(
            BrewCommand::Action {
                action: BrewAction::Upgrade,
                kind: BrewPackageKind::Cask,
                identifier: "firefox".to_owned(),
            }
            .args(),
            ["upgrade", "--cask", "firefox"]
        );
    }
}

#[cfg(test)]
mod uninstall {
    use super::{BrewPackageKind, actions::BrewAction, client::BrewCommand};

    #[test]
    fn uses_only_the_fixed_formula_uninstall_shape() {
        assert_eq!(
            BrewCommand::Action {
                action: BrewAction::Uninstall,
                kind: BrewPackageKind::Formula,
                identifier: "caddy".to_owned(),
            }
            .args(),
            ["uninstall", "caddy"]
        );
    }
}
