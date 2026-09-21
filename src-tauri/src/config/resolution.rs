use std::{borrow::Cow, fs, os::unix::fs::PermissionsExt, path::PathBuf, time::UNIX_EPOCH};

use serde::Serialize;

use crate::{
    catalog::{
        Catalog, CatalogPathRoot, ConfigDocumentDefinition, ConfigPathExistenceRule,
        ConfigPathVariant,
    },
    error::AppError,
    security::paths::{AuthorizedPath, PathPolicyError, resolve_rooted_catalog_path},
};

use super::{ConfigEnvironment, resolve_definition};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigDocumentState {
    Missing,
    Ready,
    Invalid,
    Redacted,
    TooLarge,
    PermissionDenied,
    UnsafeSymlink,
    UnsupportedFormat,
    IoError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigNextAction {
    None,
    CreateFile,
    FixContent,
    ViewRedacted,
    ReduceSize,
    ReviewPermissions,
    RepairSymlink,
    UpdateCatalog,
    Retry,
}

impl ConfigDocumentState {
    fn next_action(self) -> ConfigNextAction {
        match self {
            Self::Missing => ConfigNextAction::CreateFile,
            Self::Ready => ConfigNextAction::None,
            Self::Invalid => ConfigNextAction::FixContent,
            Self::Redacted => ConfigNextAction::ViewRedacted,
            Self::TooLarge => ConfigNextAction::ReduceSize,
            Self::PermissionDenied => ConfigNextAction::ReviewPermissions,
            Self::UnsafeSymlink => ConfigNextAction::RepairSymlink,
            Self::UnsupportedFormat => ConfigNextAction::UpdateCatalog,
            Self::IoError => ConfigNextAction::Retry,
        }
    }

    pub(crate) fn retryable(self) -> bool {
        self == Self::IoError
    }

    pub(crate) fn is_readable(self) -> bool {
        matches!(self, Self::Ready | Self::Redacted)
    }

    pub(crate) fn from_io_kind(kind: std::io::ErrorKind) -> Self {
        match kind {
            std::io::ErrorKind::NotFound => Self::Missing,
            std::io::ErrorKind::PermissionDenied => Self::PermissionDenied,
            _ => Self::IoError,
        }
    }

    pub(crate) fn from_app_error(error: &AppError) -> Self {
        match error.code() {
            crate::error::AppErrorCode::NotFound => Self::Missing,
            crate::error::AppErrorCode::NotSupported => Self::UnsupportedFormat,
            crate::error::AppErrorCode::PermissionDenied => Self::PermissionDenied,
            crate::error::AppErrorCode::ValidationFailed => Self::Invalid,
            _ => Self::IoError,
        }
    }

    pub(crate) fn as_app_error(self) -> AppError {
        match self {
            Self::Missing => AppError::not_found("Configuration document does not exist."),
            Self::Invalid => AppError::validation_failed("Configuration document is invalid."),
            Self::TooLarge => {
                AppError::validation_failed("Configuration exceeds the catalog size limit.")
            }
            Self::PermissionDenied => {
                AppError::permission_denied("Configuration document cannot be read.")
            }
            Self::UnsafeSymlink => {
                AppError::permission_denied("Configuration path is not authorized.")
            }
            Self::UnsupportedFormat => {
                AppError::not_supported("Configuration format is not supported.")
            }
            Self::IoError => {
                AppError::partial_failure("Configuration document is unavailable.", true)
            }
            Self::Ready | Self::Redacted => AppError::internal(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSymlink {
    target_display_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDiagnostic {
    app_id: String,
    config_id: String,
    variant_id: String,
    display_path: String,
    pub(crate) state: ConfigDocumentState,
    retryable: bool,
    next_action: ConfigNextAction,
}

impl ConfigDiagnostic {
    pub fn state(&self) -> ConfigDocumentState {
        self.state
    }

    pub fn retryable(&self) -> bool {
        self.retryable
    }

    pub fn next_action(&self) -> ConfigNextAction {
        self.next_action
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSummary {
    #[serde(flatten)]
    pub(crate) diagnostic: ConfigDiagnostic,
    format: String,
    sensitivity: String,
    write_policy: String,
    pub(crate) exists: bool,
    pub(crate) entry_kind: Option<ConfigEntryKind>,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) modified_at_epoch_ms: Option<u64>,
    pub(crate) mode: Option<u32>,
    pub(crate) content_hash: Option<String>,
    pub(crate) symlink: Option<ConfigSymlink>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigVariantResolution {
    #[serde(flatten)]
    summary: ConfigSummary,
    selected: bool,
}

impl ConfigVariantResolution {
    pub fn summary(&self) -> &ConfigSummary {
        &self.summary
    }

    pub fn selected(&self) -> bool {
        self.selected
    }
}

pub(crate) struct ResolvedVariant {
    pub(crate) summary: ConfigSummary,
    pub(crate) target_path: Option<PathBuf>,
}

struct VariantSpec<'a> {
    variant_id: Cow<'a, str>,
    root: CatalogPathRoot,
    relative_path: Cow<'a, str>,
    existence_rule: ConfigPathExistenceRule,
}

pub fn resolve_config_variants(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
) -> Result<Vec<ConfigVariantResolution>, AppError> {
    let definition = resolve_definition(catalog, app_id, config_id)?;
    let variants = resolve_variants(app_id, definition, environment);
    let selected = selected_variant_index(&variants, None)?;
    Ok(variants
        .into_iter()
        .enumerate()
        .map(|(index, variant)| ConfigVariantResolution {
            summary: variant.summary,
            selected: index == selected,
        })
        .collect())
}

pub(crate) fn resolve_variants(
    app_id: &str,
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
) -> Vec<ResolvedVariant> {
    variant_specs(definition)
        .into_iter()
        .map(|variant| resolve_variant(app_id, definition, environment, variant))
        .collect()
}

pub(crate) fn selected_variant_index(
    variants: &[ResolvedVariant],
    variant_id: Option<&str>,
) -> Result<usize, AppError> {
    if let Some(variant_id) = variant_id {
        return variants
            .iter()
            .position(|variant| variant.summary.diagnostic.variant_id == variant_id)
            .ok_or_else(|| AppError::not_found("Configuration variant was not found."));
    }
    variants
        .iter()
        .position(|variant| variant.summary.diagnostic.state != ConfigDocumentState::Missing)
        .or((!variants.is_empty()).then_some(0))
        .ok_or_else(|| AppError::not_found("Configuration variant was not found."))
}

pub(crate) fn set_summary_state(summary: &mut ConfigSummary, state: ConfigDocumentState) {
    summary.diagnostic.state = state;
    summary.diagnostic.retryable = state.retryable();
    summary.diagnostic.next_action = state.next_action();
    if !state.is_readable() {
        summary.content_hash = None;
    }
    if state == ConfigDocumentState::Missing {
        summary.exists = false;
        summary.entry_kind = None;
        summary.size_bytes = None;
        summary.modified_at_epoch_ms = None;
        summary.mode = None;
        summary.symlink = None;
    }
}

pub(crate) fn diagnostic(
    app_id: &str,
    definition: &ConfigDocumentDefinition,
    variant_id: &str,
    display_path: String,
    state: ConfigDocumentState,
) -> ConfigDiagnostic {
    ConfigDiagnostic {
        app_id: app_id.to_owned(),
        config_id: definition.config_id().to_owned(),
        variant_id: variant_id.to_owned(),
        display_path,
        state,
        retryable: state.retryable(),
        next_action: state.next_action(),
    }
}

fn resolve_variant(
    app_id: &str,
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
    variant: VariantSpec<'_>,
) -> ResolvedVariant {
    let display_path = safe_display_path(variant.root, &variant.relative_path);
    let Some((root, display_root)) = environment.catalog_root(variant.root) else {
        return unavailable_variant(
            app_id,
            definition,
            &variant.variant_id,
            &display_path,
            ConfigDocumentState::UnsupportedFormat,
        );
    };
    let resolved = match resolve_rooted_catalog_path(root, &variant.relative_path, display_root) {
        Ok(path) => path,
        Err(error) => {
            return unavailable_variant(
                app_id,
                definition,
                &variant.variant_id,
                &display_path,
                state_from_path_error(error),
            );
        }
    };
    summarize_resolved_path(app_id, definition, variant, resolved)
}

fn summarize_resolved_path(
    app_id: &str,
    definition: &ConfigDocumentDefinition,
    variant: VariantSpec<'_>,
    resolved: AuthorizedPath,
) -> ResolvedVariant {
    let metadata = match fs::metadata(&resolved.target_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            return unavailable_variant(
                app_id,
                definition,
                &variant.variant_id,
                &resolved.display_path,
                ConfigDocumentState::from_io_kind(error.kind()),
            );
        }
    };
    let entry_kind = if metadata.is_file() {
        ConfigEntryKind::File
    } else if metadata.is_dir() {
        ConfigEntryKind::Directory
    } else {
        return unavailable_variant(
            app_id,
            definition,
            &variant.variant_id,
            &resolved.display_path,
            ConfigDocumentState::Invalid,
        );
    };
    let expected_kind = match variant.existence_rule {
        ConfigPathExistenceRule::File => Some(ConfigEntryKind::File),
        ConfigPathExistenceRule::Directory => Some(ConfigEntryKind::Directory),
        ConfigPathExistenceRule::FileOrDirectory => None,
        ConfigPathExistenceRule::Unknown => {
            return unavailable_variant(
                app_id,
                definition,
                &variant.variant_id,
                &resolved.display_path,
                ConfigDocumentState::UnsupportedFormat,
            );
        }
    };
    let state = if expected_kind.is_some_and(|expected| expected != entry_kind) {
        ConfigDocumentState::Invalid
    } else if entry_kind == ConfigEntryKind::File
        && metadata.len() > definition.max_size_bytes() as u64
    {
        ConfigDocumentState::TooLarge
    } else {
        ConfigDocumentState::Ready
    };
    let modified_at_epoch_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(u128::from(u64::MAX)) as u64);

    ResolvedVariant {
        summary: ConfigSummary {
            diagnostic: diagnostic(
                app_id,
                definition,
                &variant.variant_id,
                resolved.display_path,
                state,
            ),
            format: definition.format().to_owned(),
            sensitivity: definition.sensitivity().to_owned(),
            write_policy: definition.write_policy().to_owned(),
            exists: true,
            entry_kind: Some(entry_kind),
            size_bytes: (entry_kind == ConfigEntryKind::File).then_some(metadata.len()),
            modified_at_epoch_ms,
            mode: Some(metadata.permissions().mode() & 0o777),
            content_hash: None,
            symlink: resolved
                .symlink_target
                .map(|target_display_path| ConfigSymlink {
                    target_display_path,
                }),
        },
        target_path: Some(resolved.target_path),
    }
}

fn unavailable_variant(
    app_id: &str,
    definition: &ConfigDocumentDefinition,
    variant_id: &str,
    display_path: &str,
    state: ConfigDocumentState,
) -> ResolvedVariant {
    ResolvedVariant {
        summary: unavailable_summary(app_id, definition, variant_id, display_path, state),
        target_path: None,
    }
}

fn unavailable_summary(
    app_id: &str,
    definition: &ConfigDocumentDefinition,
    variant_id: &str,
    display_path: &str,
    state: ConfigDocumentState,
) -> ConfigSummary {
    ConfigSummary {
        diagnostic: diagnostic(
            app_id,
            definition,
            variant_id,
            display_path.to_owned(),
            state,
        ),
        format: definition.format().to_owned(),
        sensitivity: definition.sensitivity().to_owned(),
        write_policy: definition.write_policy().to_owned(),
        exists: false,
        entry_kind: None,
        size_bytes: None,
        modified_at_epoch_ms: None,
        mode: None,
        content_hash: None,
        symlink: None,
    }
}

fn variant_specs(definition: &ConfigDocumentDefinition) -> Vec<VariantSpec<'_>> {
    if !definition.path_variants().is_empty() {
        return definition
            .path_variants()
            .iter()
            .map(variant_spec)
            .collect();
    }
    legacy_variant_spec(definition).into_iter().collect()
}

fn variant_spec(variant: &ConfigPathVariant) -> VariantSpec<'_> {
    VariantSpec {
        variant_id: Cow::Borrowed(variant.variant_id()),
        root: variant.root(),
        relative_path: Cow::Borrowed(variant.relative_path()),
        existence_rule: variant.existence_rule(),
    }
}

fn legacy_variant_spec(definition: &ConfigDocumentDefinition) -> Option<VariantSpec<'_>> {
    let template = definition.path_template();
    let (root, relative_path) =
        if let Some(relative) = template.strip_prefix("~/Library/Application Support/UserHome/") {
            (CatalogPathRoot::AppSupport, relative)
        } else if let Some(relative) = template.strip_prefix("~/Library/Application Support/") {
            (CatalogPathRoot::ApplicationSupport, relative)
        } else if let Some(relative) = template.strip_prefix("~/.config/") {
            (CatalogPathRoot::XdgConfigHome, relative)
        } else if let Some(relative) = template.strip_prefix("~/") {
            (CatalogPathRoot::Home, relative)
        } else if let Some(relative) = template.strip_prefix("${HOMEBREW_PREFIX}/") {
            (CatalogPathRoot::HomebrewPrefix, relative)
        } else {
            return None;
        };
    Some(VariantSpec {
        variant_id: Cow::Borrowed("legacy"),
        root,
        relative_path: Cow::Borrowed(relative_path),
        existence_rule: if definition.format() == "MARKDOWN_DIRECTORY" {
            ConfigPathExistenceRule::Directory
        } else {
            ConfigPathExistenceRule::File
        },
    })
}

fn safe_display_path(root: CatalogPathRoot, relative_path: &str) -> String {
    let prefix = match root {
        CatalogPathRoot::Home => "~",
        CatalogPathRoot::XdgConfigHome => "XDG_CONFIG_HOME",
        CatalogPathRoot::ApplicationSupport => "APPLICATION_SUPPORT",
        CatalogPathRoot::HomebrewPrefix => "HOMEBREW_PREFIX",
        CatalogPathRoot::AppSupport => "APP_SUPPORT",
        CatalogPathRoot::Unknown => "UNSUPPORTED_ROOT",
    };
    format!("{prefix}/{relative_path}")
}

fn state_from_path_error(error: PathPolicyError) -> ConfigDocumentState {
    match error {
        PathPolicyError::NotFound => ConfigDocumentState::Missing,
        PathPolicyError::PermissionDenied => ConfigDocumentState::PermissionDenied,
        PathPolicyError::Io => ConfigDocumentState::IoError,
        PathPolicyError::OutsideAuthorizedRoot => ConfigDocumentState::UnsafeSymlink,
        PathPolicyError::UnsupportedEntry => ConfigDocumentState::Invalid,
    }
}
