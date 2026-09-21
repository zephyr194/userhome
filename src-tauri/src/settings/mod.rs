use std::{
    collections::BTreeSet,
    sync::{Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

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

    fn apply_patch(&mut self, patch: UpdatePreferencesRequest) -> Result<(), AppError> {
        if let Some(value) = patch.appearance {
            self.appearance = value;
        }
        if let Some(value) = patch.open_window_on_launch {
            self.open_window_on_launch = value;
        }
        if let Some(value) = patch.close_behavior {
            self.close_behavior = value;
        }
        if let Some(value) = patch.restore_selection {
            self.restore_selection = value;
        }
        if let Some(value) = patch.refresh_on_launch {
            self.refresh_on_launch = value;
        }
        if let Some(value) = patch.refresh_on_reopen {
            self.refresh_on_reopen = value;
        }
        if let Some(value) = patch.provider_timeout_preset {
            self.provider_timeout_preset = value;
        }
        if let Some(value) = patch.preferred_editor_mode {
            self.preferred_editor_mode = value;
        }
        if let Some(value) = patch.backup_retention {
            self.backup_retention = value;
        }
        if let Some(value) = patch.optional_discovery_roots {
            self.optional_discovery_roots = value;
        }
        self.validate()
            .then_some(())
            .ok_or_else(|| AppError::invalid_input("Preference update is invalid."))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePreferencesRequest {
    appearance: Option<Appearance>,
    open_window_on_launch: Option<bool>,
    close_behavior: Option<CloseBehavior>,
    restore_selection: Option<bool>,
    refresh_on_launch: Option<bool>,
    refresh_on_reopen: Option<bool>,
    provider_timeout_preset: Option<ProviderTimeoutPreset>,
    preferred_editor_mode: Option<PreferredEditorMode>,
    backup_retention: Option<BackupRetention>,
    optional_discovery_roots: Option<Vec<OptionalDiscoveryRoot>>,
}

impl UpdatePreferencesRequest {
    pub fn backup_retention(&self) -> Option<BackupRetention> {
        self.backup_retention
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

pub struct SettingsCoordinator {
    store: Mutex<SettingsStore>,
}

impl SettingsCoordinator {
    pub(crate) fn new(store: SettingsStore) -> Self {
        Self {
            store: Mutex::new(store),
        }
    }

    pub fn get(&self) -> Result<LoadedPreferences, AppError> {
        Ok(self.lock_store()?.load())
    }

    pub fn update(&self, patch: UpdatePreferencesRequest) -> Result<LoadedPreferences, AppError> {
        self.update_with(patch, |_| Ok(()))
    }

    pub(crate) fn update_with<F>(
        &self,
        patch: UpdatePreferencesRequest,
        before_save: F,
    ) -> Result<LoadedPreferences, AppError>
    where
        F: FnOnce(&UserPreferences) -> Result<(), AppError>,
    {
        let store = self.lock_store()?;
        let loaded = store.load();
        if loaded.diagnostic().is_some() {
            return Err(AppError::conflict(
                "Preferences must be reset before they can be updated.",
            ));
        }
        let mut preferences = loaded.preferences().clone();
        preferences.apply_patch(patch)?;
        before_save(&preferences)?;
        store.save(&preferences)?;
        Ok(LoadedPreferences::ready(preferences))
    }

    pub fn reset(&self) -> Result<LoadedPreferences, AppError> {
        let store = self.lock_store()?;
        let preferences = UserPreferences::default();
        store.save(&preferences)?;
        Ok(LoadedPreferences::ready(preferences))
    }

    fn lock_store(&self) -> Result<MutexGuard<'_, SettingsStore>, AppError> {
        self.store.lock().map_err(|_| AppError::internal())
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use serde_json::{Value, json};
    use uuid::Uuid;

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

    #[test]
    fn settings_patch_rejects_unknown_fields_and_duplicate_roots() {
        let unknown = serde_json::from_value::<UpdatePreferencesRequest>(json!({
            "appearance": "DARK",
            "storagePath": "/tmp/preferences.json"
        }));
        assert!(unknown.is_err());
        assert!(
            serde_json::from_value::<UpdatePreferencesRequest>(json!({
                "backupRetention": 7
            }))
            .is_err()
        );

        let root = std::env::temp_dir().join(format!("userhome-settings-patch-{}", Uuid::new_v4()));
        let coordinator = SettingsCoordinator::new(SettingsStore::new(root.clone()));
        let duplicate_roots = serde_json::from_value(json!({
            "optionalDiscoveryRoots": ["HOME", "HOME"]
        }))
        .expect("decode typed duplicate roots");
        let error = coordinator
            .update(duplicate_roots)
            .expect_err("duplicate roots must be rejected");

        assert_eq!(error.code(), crate::error::AppErrorCode::InvalidInput);
        assert!(!root.join("preferences.json").exists());

        fs::create_dir_all(&root).expect("create preferences directory");
        let future_preferences = br#"{"schemaVersion":99,"recognized":"future"}"#;
        fs::write(root.join("preferences.json"), future_preferences)
            .expect("write future preferences");
        let error = coordinator
            .update(UpdatePreferencesRequest {
                appearance: Some(Appearance::Dark),
                ..UpdatePreferencesRequest::default()
            })
            .expect_err("future preferences must not be overwritten by a patch");
        assert_eq!(error.code(), crate::error::AppErrorCode::Conflict);
        assert_eq!(
            fs::read(root.join("preferences.json")).expect("read preserved future preferences"),
            future_preferences
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn settings_coordinator_serializes_concurrent_patches_without_lost_values() {
        let root = std::env::temp_dir().join(format!("userhome-settings-race-{}", Uuid::new_v4()));
        let coordinator = Arc::new(SettingsCoordinator::new(SettingsStore::new(root.clone())));
        let appearance = Arc::clone(&coordinator);
        let refresh = Arc::clone(&coordinator);

        let appearance_update = std::thread::spawn(move || {
            appearance.update(UpdatePreferencesRequest {
                appearance: Some(Appearance::Dark),
                ..UpdatePreferencesRequest::default()
            })
        });
        let refresh_update = std::thread::spawn(move || {
            refresh.update(UpdatePreferencesRequest {
                refresh_on_launch: Some(false),
                ..UpdatePreferencesRequest::default()
            })
        });
        appearance_update
            .join()
            .expect("appearance thread")
            .expect("appearance update");
        refresh_update
            .join()
            .expect("refresh thread")
            .expect("refresh update");

        let loaded = coordinator.get().expect("load merged preferences");
        assert_eq!(loaded.preferences().appearance(), Appearance::Dark);
        assert!(!loaded.preferences().refresh_on_launch());
        assert_eq!(
            serde_json::to_value(loaded.preferences())
                .expect("serialize merged preferences")
                .get("schemaVersion"),
            Some(&Value::from(SETTINGS_SCHEMA_VERSION))
        );

        assert_eq!(
            coordinator
                .reset()
                .expect("reset preferences")
                .preferences(),
            &UserPreferences::default()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resetting_preferences_preserves_owned_backups() {
        let root = std::env::temp_dir().join(format!("userhome-settings-reset-{}", Uuid::new_v4()));
        let home = root.join("home");
        let app_support = home.join("Library/Application Support/UserHome");
        fs::create_dir_all(&home).expect("create home");
        let environment = crate::config::ConfigEnvironment::new(
            home,
            root.join("brew"),
            app_support.join("backups"),
        );
        fs::create_dir_all(environment.brew_prefix()).expect("create brew");
        crate::config::backup::create_backup(
            &environment,
            "git",
            "git-global-config",
            b"owned backup",
            0o600,
            BackupRetention::TWENTY,
        )
        .expect("create backup");
        let coordinator = SettingsCoordinator::new(SettingsStore::new(app_support));

        coordinator.reset().expect("reset preferences");

        assert_eq!(
            crate::config::backup::list_backups(&environment, "git", "git-global-config",)
                .expect("list backups")
                .len(),
            1
        );
        let _ = fs::remove_dir_all(root);
    }
}
