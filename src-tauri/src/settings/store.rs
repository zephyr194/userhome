use std::{
    fs::{self, DirBuilder, File, OpenOptions},
    io::{self, Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::error::AppError;

use super::{
    LoadedPreferences, SettingsDiagnostic, UserPreferences,
    migration::{MigrationError, decode_and_migrate},
};

const SETTINGS_FILE_NAME: &str = "preferences.json";
const MAX_SETTINGS_BYTES: u64 = 16 * 1024;
const SETTINGS_DIRECTORY_MODE: u32 = 0o700;
const SETTINGS_FILE_MODE: u32 = 0o600;

#[derive(Clone)]
pub struct SettingsStore {
    directory: PathBuf,
}

impl SettingsStore {
    pub(crate) fn new(application_support_directory: PathBuf) -> Self {
        Self {
            directory: application_support_directory,
        }
    }

    pub fn load(&self) -> LoadedPreferences {
        let path = self.preferences_path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => metadata,
            Ok(_) => {
                return LoadedPreferences::recovered(SettingsDiagnostic::read_failed());
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return LoadedPreferences::ready(UserPreferences::default());
            }
            Err(_) => {
                return LoadedPreferences::recovered(SettingsDiagnostic::read_failed());
            }
        };
        if metadata.len() > MAX_SETTINGS_BYTES {
            return LoadedPreferences::recovered(SettingsDiagnostic::invalid_document());
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        let read_result = File::open(path)
            .and_then(|file| file.take(MAX_SETTINGS_BYTES + 1).read_to_end(&mut bytes));
        match read_result {
            Ok(_) if bytes.len() as u64 <= MAX_SETTINGS_BYTES => {}
            Ok(_) => return LoadedPreferences::recovered(SettingsDiagnostic::invalid_document()),
            Err(_) => {
                return LoadedPreferences::recovered(SettingsDiagnostic::read_failed());
            }
        }
        match decode_and_migrate(&bytes) {
            Ok(preferences) => LoadedPreferences::ready(preferences),
            Err(MigrationError::InvalidDocument) => {
                LoadedPreferences::recovered(SettingsDiagnostic::invalid_document())
            }
            Err(MigrationError::UnsupportedVersion) => {
                LoadedPreferences::recovered(SettingsDiagnostic::unsupported_version())
            }
        }
    }

    pub fn save(&self, preferences: &UserPreferences) -> Result<(), AppError> {
        if !preferences.validate() {
            return Err(AppError::invalid_input("Preferences are invalid."));
        }
        self.ensure_directory()?;
        let path = self.preferences_path();
        if fs::symlink_metadata(&path).is_ok_and(|metadata| !metadata.file_type().is_file()) {
            return Err(AppError::permission_denied(
                "Preferences storage is not a regular file.",
            ));
        }
        let mut bytes = serde_json::to_vec_pretty(preferences).map_err(|_| AppError::internal())?;
        bytes.push(b'\n');
        if bytes.len() as u64 > MAX_SETTINGS_BYTES {
            return Err(AppError::invalid_input("Preferences are too large."));
        }
        write_atomically(&path, &bytes)
            .map_err(|_| AppError::permission_denied("Preferences could not be saved."))
    }

    fn preferences_path(&self) -> PathBuf {
        self.directory.join(SETTINGS_FILE_NAME)
    }

    fn ensure_directory(&self) -> Result<(), AppError> {
        match fs::symlink_metadata(&self.directory) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => {
                return Err(AppError::permission_denied(
                    "Preferences directory is unavailable.",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let mut builder = DirBuilder::new();
                builder.recursive(true).mode(SETTINGS_DIRECTORY_MODE);
                builder.create(&self.directory).map_err(|_| {
                    AppError::permission_denied("Preferences directory could not be created.")
                })?;
            }
            Err(_) => {
                return Err(AppError::permission_denied(
                    "Preferences directory is unavailable.",
                ));
            }
        }
        fs::set_permissions(
            &self.directory,
            fs::Permissions::from_mode(SETTINGS_DIRECTORY_MODE),
        )
        .map_err(|_| {
            AppError::permission_denied("Preferences directory permissions could not be secured.")
        })
    }
}

fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomically_with(path, bytes, |_| Ok(()))
}

fn write_atomically_with<F>(path: &Path, bytes: &[u8], before_replace: F) -> io::Result<()>
where
    F: FnOnce(&Path) -> io::Result<()>,
{
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "preferences parent is unavailable",
        )
    })?;
    let temp_path = parent.join(format!(".preferences-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(SETTINGS_FILE_MODE)
            .open(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(SETTINGS_FILE_MODE))?;
        before_replace(&temp_path)?;
        fs::rename(&temp_path, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use serde_json::json;

    use super::*;
    use crate::{
        error::AppErrorCode,
        settings::{Appearance, SettingsDiagnosticCode},
    };

    struct Fixture {
        root: PathBuf,
        store: SettingsStore,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-settings-{}", Uuid::new_v4()));
            Self {
                store: SettingsStore::new(root.join("Application Support/UserHome")),
                root,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn settings_store_round_trips_the_bounded_contract_with_private_permissions() {
        let fixture = Fixture::new();
        let preferences = UserPreferences::default();

        fixture.store.save(&preferences).expect("save preferences");
        let loaded = fixture.store.load();
        let bytes = fs::read(fixture.store.preferences_path()).expect("read stored preferences");
        let stored: serde_json::Value = serde_json::from_slice(&bytes).expect("parse stored JSON");
        let keys = stored
            .as_object()
            .expect("preferences object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();

        assert_eq!(loaded.preferences(), &preferences);
        assert!(loaded.diagnostic().is_none());
        assert_eq!(
            keys,
            [
                "appearance",
                "backupRetention",
                "closeBehavior",
                "openWindowOnLaunch",
                "optionalDiscoveryRoots",
                "preferredEditorMode",
                "providerTimeoutPreset",
                "refreshOnLaunch",
                "refreshOnReopen",
                "restoreSelection",
                "schemaVersion",
            ]
        );
        assert_eq!(
            fs::metadata(fixture.store.preferences_path())
                .expect("preferences metadata")
                .permissions()
                .mode()
                & 0o777,
            SETTINGS_FILE_MODE
        );
        assert_eq!(
            fs::metadata(&fixture.store.directory)
                .expect("preferences directory metadata")
                .permissions()
                .mode()
                & 0o777,
            SETTINGS_DIRECTORY_MODE
        );
    }

    #[test]
    fn settings_store_recovers_without_exposing_invalid_content() {
        let fixture = Fixture::new();
        fixture.store.ensure_directory().expect("create directory");
        fs::write(
            fixture.store.preferences_path(),
            br#"{"schemaVersion":1,"apiToken":"do-not-expose"}"#,
        )
        .expect("write invalid preferences");

        let loaded = fixture.store.load();
        let diagnostic = loaded.diagnostic().expect("recovery diagnostic");
        let serialized = serde_json::to_string(&loaded).expect("serialize recovery result");

        assert_eq!(loaded.preferences(), &UserPreferences::default());
        assert_eq!(diagnostic.code(), SettingsDiagnosticCode::InvalidDocument);
        assert!(!diagnostic.message().contains("apiToken"));
        assert!(!serialized.contains("do-not-expose"));
        assert!(!serialized.contains(fixture.root.to_string_lossy().as_ref()));

        fs::write(fixture.store.preferences_path(), br#"{"schemaVersion":99}"#)
            .expect("write unsupported preferences");
        let unsupported = fixture.store.load();
        assert_eq!(
            unsupported
                .diagnostic()
                .expect("unsupported version diagnostic")
                .code(),
            SettingsDiagnosticCode::UnsupportedVersion
        );
    }

    #[test]
    fn settings_store_preserves_the_previous_file_when_replacement_fails() {
        let fixture = Fixture::new();
        fixture
            .store
            .save(&UserPreferences::default())
            .expect("save initial preferences");
        let path = fixture.store.preferences_path();
        let previous = fs::read(&path).expect("read initial preferences");
        let updated = decode_and_migrate(
            &serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "appearance": "DARK",
                "openWindowOnLaunch": true,
                "closeBehavior": "KEEP_RUNNING_IN_TRAY",
                "restoreSelection": true,
                "refreshOnLaunch": true,
                "refreshOnReopen": true,
                "providerTimeoutPreset": "STANDARD",
                "preferredEditorMode": "STRUCTURED",
                "backupRetention": 20,
                "optionalDiscoveryRoots": []
            }))
            .expect("serialize updated preferences"),
        )
        .expect("decode updated preferences");
        let updated_bytes = serde_json::to_vec_pretty(&updated).expect("serialize update");

        let result = write_atomically_with(&path, &updated_bytes, |_| {
            Err(io::Error::other("injected replacement failure"))
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read(&path).expect("read preserved preferences"),
            previous
        );
        assert_eq!(
            fixture.store.load().preferences().appearance(),
            Appearance::System
        );
    }

    #[test]
    fn settings_store_rejects_non_regular_storage_targets() {
        let fixture = Fixture::new();
        fixture.store.ensure_directory().expect("create directory");
        fs::create_dir(fixture.store.preferences_path()).expect("create invalid target");

        let error = fixture
            .store
            .save(&UserPreferences::default())
            .expect_err("directory target must be rejected");

        assert_eq!(error.code(), AppErrorCode::PermissionDenied);
    }
}
