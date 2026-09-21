use std::fs;

use serde::Deserialize;

use crate::{catalog::Catalog, error::AppError, settings::BackupRetention};

use super::{
    ConfigEnvironment,
    backup::{load_backup, read_backup_content},
    diff::build_diff,
    read::{hash_bytes, read_bounded},
    resolve_definition, resolve_path,
    validation::validate_bytes,
    write::{PendingConfigMutation, PreparedWritePreview, execute_write},
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreBackupInput {
    pub app_id: String,
    pub config_id: String,
    pub backup_id: String,
    pub expected_hash: String,
}

pub fn prepare_restore(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    input: RestoreBackupInput,
) -> Result<(PendingConfigMutation, PreparedWritePreview), AppError> {
    let definition = resolve_definition(catalog, &input.app_id, &input.config_id)?;
    let resolved = resolve_path(definition, environment)?;
    if !fs::metadata(&resolved.target_path)
        .map_err(|_| AppError::not_found("Configuration document does not exist."))?
        .is_file()
    {
        return Err(AppError::not_supported(
            "Only regular configuration files can be restored.",
        ));
    }
    let current = read_bounded(&resolved.target_path, definition.max_size_bytes())?;
    let current_hash = hash_bytes(&current);
    if input.expected_hash != current_hash {
        return Err(AppError::conflict(
            "Configuration changed after it was read.",
        ));
    }
    let backup = load_backup(
        environment,
        &input.app_id,
        &input.config_id,
        &input.backup_id,
    )?;
    let content = read_backup_content(&backup, definition.max_size_bytes())?;
    validate_bytes(definition, environment, &content)?;
    let before = std::str::from_utf8(&current)
        .map_err(|_| AppError::validation_failed("Configuration must be valid UTF-8."))?;
    let after = std::str::from_utf8(&content)
        .map_err(|_| AppError::validation_failed("Backup must be valid UTF-8."))?;
    let proposed_hash = hash_bytes(&content);
    let diff = build_diff(before, after, definition.sensitivity());
    let elevation_resource_id =
        super::write::elevation_resource_id(definition, environment, &resolved.target_path);
    Ok((
        PendingConfigMutation {
            app_id: input.app_id,
            config_id: input.config_id,
            expected_hash: current_hash.clone(),
            proposed_hash: proposed_hash.clone(),
            expected_target: resolved.target_path,
            content,
            desired_mode: Some(backup.metadata.mode),
            source_id: Some(backup.metadata.backup_id),
            elevation_resource_id,
        },
        PreparedWritePreview {
            current_hash,
            proposed_hash,
            diff,
        },
    ))
}

pub fn execute_restore(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    mutation: &PendingConfigMutation,
    retention: BackupRetention,
) -> Result<(), AppError> {
    if mutation.source_id.is_none() {
        return Err(AppError::conflict(
            "Restore preview does not reference a backup.",
        ));
    }
    execute_write(catalog, environment, mutation, retention).map(|_| ())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
        path::PathBuf,
    };

    use uuid::Uuid;

    use crate::{catalog::load_builtin_catalog, settings::BackupRetention};

    use super::{
        super::{ConfigEnvironment, backup::create_backup, read::hash_bytes},
        RestoreBackupInput, execute_restore, prepare_restore,
    };

    struct Fixture {
        root: PathBuf,
        home: PathBuf,
        environment: ConfigEnvironment,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-restore-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            fs::create_dir_all(home.join("dotfiles")).expect("create dotfiles");
            fs::create_dir_all(&brew).expect("create brew");
            let environment =
                ConfigEnvironment::new(home.clone(), brew, home.join(".userhome/backups"));
            Self {
                root,
                home,
                environment,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn restores_exact_backup_bytes_mode_and_preserves_symlink() {
        let fixture = Fixture::new();
        let target = fixture.home.join("dotfiles/gitconfig");
        let logical = fixture.home.join(".gitconfig");
        let original = b"[user]\nname = Original\n";
        let current = b"[user]\nname = Current\n";
        fs::write(&target, current).expect("write current");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).expect("set current mode");
        symlink("dotfiles/gitconfig", &logical).expect("create symlink");
        let backup = create_backup(
            &fixture.environment,
            "git",
            "git-global-config",
            original,
            0o600,
            BackupRetention::TWENTY,
        )
        .expect("create backup");
        let catalog = load_builtin_catalog().expect("catalog");
        let (mutation, _) = prepare_restore(
            &catalog,
            &fixture.environment,
            RestoreBackupInput {
                app_id: "git".to_owned(),
                config_id: "git-global-config".to_owned(),
                backup_id: backup.metadata.backup_id,
                expected_hash: hash_bytes(current),
            },
        )
        .expect("prepare restore");

        execute_restore(
            &catalog,
            &fixture.environment,
            &mutation,
            BackupRetention::TWENTY,
        )
        .expect("restore");

        assert!(logical.is_symlink());
        assert_eq!(fs::read(&target).expect("read restored"), original);
        assert_eq!(
            fs::metadata(&target)
                .expect("metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
