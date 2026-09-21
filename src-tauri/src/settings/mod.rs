use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

mod migration;
mod store;

pub use store::SettingsStore;

pub const SETTINGS_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Appearance {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CloseBehavior {
    KeepRunningInTray,
    QuitApplication,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderTimeoutPreset {
    Short,
    Standard,
    Extended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreferredEditorMode {
    Structured,
    Raw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackupRetention(u8);

impl BackupRetention {
    pub const FIVE: Self = Self(5);
    pub const TEN: Self = Self(10);
    pub const TWENTY: Self = Self(20);

    pub fn count(self) -> u8 {
        self.0
    }
}

impl Serialize for BackupRetention {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u8(self.0)
    }
}

impl<'de> Deserialize<'de> for BackupRetention {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        match u8::deserialize(deserializer)? {
            5 => Ok(Self::FIVE),
            10 => Ok(Self::TEN),
            20 => Ok(Self::TWENTY),
            _ => Err(serde::de::Error::custom(
                "backup retention must be an approved preset",
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OptionalDiscoveryRoot {
    Home,
    XdgConfigHome,
    ApplicationSupport,
    HomebrewPrefix,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserPreferences {
    schema_version: u16,
    appearance: Appearance,
    open_window_on_launch: bool,
    close_behavior: CloseBehavior,
    restore_selection: bool,
    refresh_on_launch: bool,
    refresh_on_reopen: bool,
    provider_timeout_preset: ProviderTimeoutPreset,
    preferred_editor_mode: PreferredEditorMode,
    backup_retention: BackupRetention,
    optional_discovery_roots: Vec<OptionalDiscoveryRoot>,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            appearance: Appearance::System,
            open_window_on_launch: true,
            close_behavior: CloseBehavior::KeepRunningInTray,
            restore_selection: true,
            refresh_on_launch: true,
            refresh_on_reopen: true,
            provider_timeout_preset: ProviderTimeoutPreset::Standard,
            preferred_editor_mode: PreferredEditorMode::Structured,
            backup_retention: BackupRetention::TWENTY,
            optional_discovery_roots: vec![
                OptionalDiscoveryRoot::Home,
                OptionalDiscoveryRoot::XdgConfigHome,
                OptionalDiscoveryRoot::ApplicationSupport,
                OptionalDiscoveryRoot::HomebrewPrefix,
            ],
        }
    }
}

impl UserPreferences {
    pub fn schema_version(&self) -> u16 {
        self.schema_version
    }

    pub fn appearance(&self) -> Appearance {
        self.appearance
    }

    pub fn open_window_on_launch(&self) -> bool {
        self.open_window_on_launch
    }

    pub fn close_behavior(&self) -> CloseBehavior {
        self.close_behavior
    }

    pub fn restore_selection(&self) -> bool {
        self.restore_selection
    }

    pub fn refresh_on_launch(&self) -> bool {
        self.refresh_on_launch
    }

    pub fn refresh_on_reopen(&self) -> bool {
        self.refresh_on_reopen
    }

    pub fn provider_timeout_preset(&self) -> ProviderTimeoutPreset {
        self.provider_timeout_preset
    }

    pub fn preferred_editor_mode(&self) -> PreferredEditorMode {
        self.preferred_editor_mode
    }

    pub fn backup_retention(&self) -> BackupRetention {
        self.backup_retention
    }

    pub fn optional_discovery_roots(&self) -> &[OptionalDiscoveryRoot] {
        &self.optional_discovery_roots
    }

    pub(crate) fn validate(&self) -> bool {
        self.schema_version == SETTINGS_SCHEMA_VERSION
            && self.optional_discovery_roots.len()
                == self
                    .optional_discovery_roots
                    .iter()
                    .collect::<BTreeSet<_>>()
                    .len()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SettingsDiagnosticCode {
    ReadFailed,
    InvalidDocument,
    UnsupportedVersion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDiagnostic {
    code: SettingsDiagnosticCode,
    message: &'static str,
}

impl SettingsDiagnostic {
    pub fn code(&self) -> SettingsDiagnosticCode {
        self.code
    }

    pub fn message(&self) -> &'static str {
        self.message
    }

    pub(crate) fn read_failed() -> Self {
        Self {
            code: SettingsDiagnosticCode::ReadFailed,
            message: "Preferences could not be read; safe defaults are active.",
        }
    }

    pub(crate) fn invalid_document() -> Self {
        Self {
            code: SettingsDiagnosticCode::InvalidDocument,
            message: "Preferences are invalid; safe defaults are active.",
        }
    }

    pub(crate) fn unsupported_version() -> Self {
        Self {
            code: SettingsDiagnosticCode::UnsupportedVersion,
            message: "Preferences use an unsupported version; safe defaults are active.",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPreferences {
    preferences: UserPreferences,
    diagnostic: Option<SettingsDiagnostic>,
}

impl LoadedPreferences {
    pub fn preferences(&self) -> &UserPreferences {
        &self.preferences
    }

    pub fn diagnostic(&self) -> Option<&SettingsDiagnostic> {
        self.diagnostic.as_ref()
    }

    pub(crate) fn ready(preferences: UserPreferences) -> Self {
        Self {
            preferences,
            diagnostic: None,
        }
    }

    pub(crate) fn recovered(diagnostic: SettingsDiagnostic) -> Self {
        Self {
            preferences: UserPreferences::default(),
            diagnostic: Some(diagnostic),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn settings_defaults_serialize_only_the_approved_contract() {
        let serialized = serde_json::to_value(UserPreferences::default()).expect("serialize");

        assert_eq!(
            serialized,
            json!({
                "schemaVersion": 1,
                "appearance": "SYSTEM",
                "openWindowOnLaunch": true,
                "closeBehavior": "KEEP_RUNNING_IN_TRAY",
                "restoreSelection": true,
                "refreshOnLaunch": true,
                "refreshOnReopen": true,
                "providerTimeoutPreset": "STANDARD",
                "preferredEditorMode": "STRUCTURED",
                "backupRetention": 20,
                "optionalDiscoveryRoots": [
                    "HOME",
                    "XDG_CONFIG_HOME",
                    "APPLICATION_SUPPORT",
                    "HOMEBREW_PREFIX"
                ]
            })
        );
    }
}
