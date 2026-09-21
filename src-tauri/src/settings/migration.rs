use serde::Deserialize;

use super::{
    Appearance, BackupRetention, CloseBehavior, OptionalDiscoveryRoot, PreferredEditorMode,
    ProviderTimeoutPreset, SETTINGS_SCHEMA_VERSION, UserPreferences,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MigrationError {
    InvalidDocument,
    UnsupportedVersion,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionEnvelope {
    schema_version: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UserPreferencesV0 {
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
}

pub(crate) fn decode_and_migrate(bytes: &[u8]) -> Result<UserPreferences, MigrationError> {
    let envelope: VersionEnvelope =
        serde_json::from_slice(bytes).map_err(|_| MigrationError::InvalidDocument)?;
    let preferences = match envelope.schema_version {
        version if version == u64::from(SETTINGS_SCHEMA_VERSION) => {
            serde_json::from_slice(bytes).map_err(|_| MigrationError::InvalidDocument)?
        }
        0 => {
            migrate_v0(serde_json::from_slice(bytes).map_err(|_| MigrationError::InvalidDocument)?)?
        }
        _ => return Err(MigrationError::UnsupportedVersion),
    };
    preferences
        .validate()
        .then_some(preferences)
        .ok_or(MigrationError::InvalidDocument)
}

fn migrate_v0(legacy: UserPreferencesV0) -> Result<UserPreferences, MigrationError> {
    if legacy.schema_version != 0 {
        return Err(MigrationError::InvalidDocument);
    }
    Ok(UserPreferences {
        schema_version: SETTINGS_SCHEMA_VERSION,
        appearance: legacy.appearance,
        open_window_on_launch: legacy.open_window_on_launch,
        close_behavior: legacy.close_behavior,
        restore_selection: legacy.restore_selection,
        refresh_on_launch: legacy.refresh_on_launch,
        refresh_on_reopen: legacy.refresh_on_reopen,
        provider_timeout_preset: legacy.provider_timeout_preset,
        preferred_editor_mode: legacy.preferred_editor_mode,
        backup_retention: legacy.backup_retention,
        optional_discovery_roots: OptionalDiscoveryRoot::ALL.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn settings_migration_preserves_recognized_values_and_adds_new_defaults() {
        let legacy = serde_json::to_vec(&json!({
            "schemaVersion": 0,
            "appearance": "DARK",
            "openWindowOnLaunch": false,
            "closeBehavior": "QUIT_APPLICATION",
            "restoreSelection": false,
            "refreshOnLaunch": false,
            "refreshOnReopen": false,
            "providerTimeoutPreset": "EXTENDED",
            "preferredEditorMode": "RAW",
            "backupRetention": 5
        }))
        .expect("serialize legacy preferences");

        let migrated = decode_and_migrate(&legacy).expect("migrate legacy preferences");

        assert_eq!(migrated.schema_version(), SETTINGS_SCHEMA_VERSION);
        assert_eq!(migrated.appearance(), Appearance::Dark);
        assert!(!migrated.open_window_on_launch());
        assert_eq!(migrated.close_behavior(), CloseBehavior::QuitApplication);
        assert!(!migrated.restore_selection());
        assert!(!migrated.refresh_on_launch());
        assert!(!migrated.refresh_on_reopen());
        assert_eq!(
            migrated.provider_timeout_preset(),
            ProviderTimeoutPreset::Extended
        );
        assert_eq!(migrated.preferred_editor_mode(), PreferredEditorMode::Raw);
        assert_eq!(migrated.backup_retention(), BackupRetention::FIVE);
        assert_eq!(
            migrated.optional_discovery_roots(),
            UserPreferences::default().optional_discovery_roots()
        );
    }

    #[test]
    fn settings_migration_rejects_unknown_fields_values_and_versions() {
        let unknown_field = serde_json::to_vec(&json!({
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
            "optionalDiscoveryRoots": [],
            "arbitraryPath": "/tmp"
        }))
        .expect("serialize invalid preferences");
        assert_eq!(
            decode_and_migrate(&unknown_field),
            Err(MigrationError::InvalidDocument)
        );

        let invalid_preset = String::from_utf8(
            serde_json::to_vec(&UserPreferences::default()).expect("serialize defaults"),
        )
        .expect("utf-8")
        .replace("\"backupRetention\":20", "\"backupRetention\":100");
        assert_eq!(
            decode_and_migrate(invalid_preset.as_bytes()),
            Err(MigrationError::InvalidDocument)
        );

        assert_eq!(
            decode_and_migrate(br#"{"schemaVersion":99}"#),
            Err(MigrationError::UnsupportedVersion)
        );
    }
}
