pub mod adapters;
pub mod backup;
pub mod diff;
pub mod formats;
pub mod read;
pub mod redaction;
pub mod resolution;
pub mod restore;
pub mod retention;
pub mod validation;
pub mod write;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use crate::{
    catalog::{Catalog, CatalogPathRoot, ConfigDocumentDefinition, load_builtin_catalog},
    error::AppError,
    security::paths::{AuthorizedPath, PathPolicyError, resolve_catalog_path},
};

#[derive(Debug, Clone)]
pub struct ConfigEnvironment {
    home: PathBuf,
    xdg_config_home: PathBuf,
    application_support: PathBuf,
    app_support: PathBuf,
    brew_prefix: PathBuf,
    backup_root: PathBuf,
}

impl ConfigEnvironment {
    pub fn new(home: PathBuf, brew_prefix: PathBuf, backup_root: PathBuf) -> Self {
        let xdg_config_home = home.join(".config");
        let application_support = home.join("Library").join("Application Support");
        let app_support = application_support.join("UserHome");
        Self {
            home,
            xdg_config_home,
            application_support,
            app_support,
            brew_prefix,
            backup_root,
        }
    }

    pub fn from_environment() -> Result<Self, AppError> {
        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| AppError::not_found("Home directory is unavailable."))?;
        let brew_prefix = [Path::new("/opt/homebrew"), Path::new("/usr/local")]
            .into_iter()
            .find(|path| path.exists())
            .unwrap_or(Path::new("/opt/homebrew"))
            .to_path_buf();
        let backup_root = home
            .join("Library")
            .join("Application Support")
            .join("UserHome")
            .join("backups");
        let mut environment = Self::new(home, brew_prefix, backup_root);
        environment.xdg_config_home = std::env::var_os("XDG_CONFIG_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| environment.home.join(".config"));
        Ok(environment)
    }

    pub(crate) fn home(&self) -> &Path {
        &self.home
    }

    pub(crate) fn brew_prefix(&self) -> &Path {
        &self.brew_prefix
    }

    pub(crate) fn catalog_root(&self, root: CatalogPathRoot) -> Option<(&Path, &'static str)> {
        match root {
            CatalogPathRoot::Home => Some((&self.home, "~")),
            CatalogPathRoot::XdgConfigHome => Some((&self.xdg_config_home, "XDG_CONFIG_HOME")),
            CatalogPathRoot::ApplicationSupport => {
                Some((&self.application_support, "APPLICATION_SUPPORT"))
            }
            CatalogPathRoot::HomebrewPrefix => Some((&self.brew_prefix, "HOMEBREW_PREFIX")),
            CatalogPathRoot::AppSupport => Some((&self.app_support, "APP_SUPPORT")),
            CatalogPathRoot::Unknown => None,
        }
    }

    pub(crate) fn backup_root(&self) -> &Path {
        &self.backup_root
    }
}

pub(crate) fn resolve_definition<'a>(
    catalog: &'a Catalog,
    app_id: &str,
    config_id: &str,
) -> Result<&'a ConfigDocumentDefinition, AppError> {
    catalog
        .config_document(app_id, config_id)
        .map(|(_, document)| document)
        .ok_or_else(|| AppError::not_found("Configuration document was not found."))
}

pub(crate) fn resolve_path(
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
) -> Result<AuthorizedPath, AppError> {
    resolve_catalog_path(
        definition.path_template(),
        environment.home(),
        environment.brew_prefix(),
    )
    .map_err(|error| match error {
        PathPolicyError::OutsideAuthorizedRoot | PathPolicyError::UnsupportedEntry => {
            AppError::permission_denied("Configuration path is not authorized.")
        }
        PathPolicyError::PermissionDenied => {
            AppError::permission_denied("Configuration path cannot be accessed.")
        }
        PathPolicyError::Io => AppError::internal(),
        PathPolicyError::NotFound => AppError::not_found("Configuration path is unavailable."),
    })
}

pub fn builtin_catalog() -> Result<Catalog, AppError> {
    load_builtin_catalog().map_err(|_| AppError::internal())
}

pub struct ConfigCoordinator {
    environment: Result<ConfigEnvironment, AppError>,
    pending: Mutex<HashMap<String, write::PendingConfigMutation>>,
}

impl Default for ConfigCoordinator {
    fn default() -> Self {
        Self {
            environment: ConfigEnvironment::from_environment(),
            pending: Mutex::new(HashMap::new()),
        }
    }
}

impl ConfigCoordinator {
    pub fn with_environment(environment: ConfigEnvironment) -> Self {
        Self {
            environment: Ok(environment),
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn environment(&self) -> Result<&ConfigEnvironment, AppError> {
        self.environment.as_ref().map_err(Clone::clone)
    }

    pub(crate) fn remember(
        &self,
        operation_id: String,
        mutation: write::PendingConfigMutation,
    ) -> Result<(), AppError> {
        let mut pending = self.pending.lock().map_err(|_| AppError::internal())?;
        if pending.len() >= 64 {
            return Err(AppError::conflict(
                "Too many configuration previews are pending.",
            ));
        }
        pending.insert(operation_id, mutation);
        Ok(())
    }

    pub(crate) fn pending(
        &self,
        operation_id: &str,
    ) -> Result<write::PendingConfigMutation, AppError> {
        self.pending
            .lock()
            .map_err(|_| AppError::internal())?
            .get(operation_id)
            .cloned()
            .ok_or_else(AppError::operation_not_found)
    }

    pub(crate) fn forget(&self, operation_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(operation_id);
        }
    }
}
