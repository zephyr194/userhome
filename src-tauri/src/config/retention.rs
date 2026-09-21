use serde::Serialize;

use crate::{catalog::Catalog, error::AppError, settings::BackupRetention};

use super::{
    ConfigEnvironment,
    backup::{BackupRecord, backup_storage_bytes, list_records, remove_backup},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStorageSummary {
    pub display_location: String,
    pub backup_count: u64,
    pub size_bytes: u64,
}

pub fn summarize(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
) -> Result<BackupStorageSummary, AppError> {
    let records = owned_records(catalog, environment)?;
    let size_bytes = records.iter().try_fold(0_u64, |total, record| {
        backup_storage_bytes(record).map(|size| total.saturating_add(size))
    })?;
    Ok(BackupStorageSummary {
        display_location: display_location(environment)?,
        backup_count: records.len() as u64,
        size_bytes,
    })
}

pub fn enforce_all(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    retention: BackupRetention,
) -> Result<(), AppError> {
    for app in catalog.apps() {
        for document in app.config_documents() {
            if !document.is_read_only() {
                enforce_document(environment, app.id(), document.config_id(), retention)?;
            }
        }
    }
    Ok(())
}

pub(super) fn enforce_document(
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
    retention: BackupRetention,
) -> Result<(), AppError> {
    for record in list_records(environment, app_id, config_id)?
        .into_iter()
        .skip(usize::from(retention.count()))
    {
        remove_backup(environment, &record)?;
    }
    Ok(())
}

pub fn clear_owned(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
) -> Result<BackupStorageSummary, AppError> {
    let before = summarize(catalog, environment)?;
    for record in owned_records(catalog, environment)? {
        remove_backup(environment, &record)?;
    }
    if summarize(catalog, environment)?.backup_count != 0 {
        return Err(AppError::conflict(
            "Owned backups changed while they were being cleared.",
        ));
    }
    Ok(before)
}

fn owned_records(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
) -> Result<Vec<BackupRecord>, AppError> {
    let mut records = Vec::new();
    for app in catalog.apps() {
        for document in app.config_documents() {
            if !document.is_read_only() {
                records.extend(list_records(environment, app.id(), document.config_id())?);
            }
        }
    }
    Ok(records)
}

fn display_location(environment: &ConfigEnvironment) -> Result<String, AppError> {
    let (root, label) = environment
        .catalog_root(crate::catalog::CatalogPathRoot::AppSupport)
        .ok_or_else(AppError::internal)?;
    let relative = environment
        .backup_root()
        .strip_prefix(root)
        .map_err(|_| AppError::permission_denied("Backup root is not authorized."))?;
    let segments = relative
        .components()
        .map(|component| match component {
            std::path::Component::Normal(value) => value
                .to_str()
                .filter(|value| !value.is_empty() && !value.chars().any(char::is_control))
                .map(str::to_owned)
                .ok_or_else(|| {
                    AppError::permission_denied("Backup location cannot be displayed safely.")
                }),
            _ => Err(AppError::permission_denied(
                "Backup location cannot be displayed safely.",
            )),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if segments.is_empty() {
        return Err(AppError::permission_denied(
            "Backup location cannot be displayed safely.",
        ));
    }
    Ok(format!("{label}/{}", segments.join("/")))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use uuid::Uuid;

    use crate::{
        config::{
            ConfigEnvironment,
            backup::{create_backup, list_backups},
        },
        settings::BackupRetention,
    };

    use super::{clear_owned, enforce_document, summarize};

    struct Fixture {
        root: PathBuf,
        environment: ConfigEnvironment,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-retention-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            fs::create_dir_all(&home).expect("create home");
            fs::create_dir_all(&brew).expect("create brew");
            let environment = ConfigEnvironment::new(
                home.clone(),
                brew,
                home.join("Library/Application Support/UserHome/backups"),
            );
            Self { root, environment }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn retention_keeps_only_the_selected_number_of_owned_backups() {
        let fixture = Fixture::new();
        let foreign = fixture.environment.backup_root().join("foreign-data");
        fs::create_dir_all(&foreign).expect("create foreign data");
        fs::write(foreign.join("keep"), b"not owned").expect("write foreign data");

        for index in 0..23 {
            create_backup(
                &fixture.environment,
                "git",
                "git-global-config",
                format!("version-{index}").as_bytes(),
                0o600,
                BackupRetention::TWENTY,
            )
            .expect("create backup");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        enforce_document(
            &fixture.environment,
            "git",
            "git-global-config",
            BackupRetention::FIVE,
        )
        .expect("apply selected retention");
        let backups =
            list_backups(&fixture.environment, "git", "git-global-config").expect("list backups");
        assert_eq!(backups.len(), 5);
        assert!(foreign.join("keep").exists());
    }

    #[test]
    fn clearing_removes_only_catalog_owned_backups_and_preserves_configuration() {
        let fixture = Fixture::new();
        let config = fixture.environment.home().join(".gitconfig");
        fs::write(&config, b"keep configuration").expect("write managed config");
        let foreign = fixture.environment.backup_root().join("foreign-data");
        fs::create_dir_all(&foreign).expect("create foreign data");
        fs::write(foreign.join("keep"), b"not owned").expect("write foreign data");
        create_backup(
            &fixture.environment,
            "git",
            "git-global-config",
            b"owned backup",
            0o600,
            BackupRetention::TWENTY,
        )
        .expect("create backup");
        let catalog = crate::config::builtin_catalog().expect("catalog");

        let preview = summarize(&catalog, &fixture.environment).expect("summarize backups");
        let cleared = clear_owned(&catalog, &fixture.environment).expect("clear backups");

        assert_eq!(preview.display_location, "APP_SUPPORT/backups");
        assert_eq!(preview.backup_count, 1);
        assert_eq!(cleared, preview);
        assert!(
            list_backups(&fixture.environment, "git", "git-global-config")
                .expect("list cleared backups")
                .is_empty()
        );
        assert_eq!(
            fs::read(&config).expect("read managed config"),
            b"keep configuration"
        );
        assert!(foreign.join("keep").exists());
    }
}
