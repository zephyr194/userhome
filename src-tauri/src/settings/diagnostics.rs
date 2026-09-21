use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{
    catalog::Catalog,
    discovery::refresh::{
        DiagnosticProviderState as DiscoveryProviderState,
        DiagnosticRefreshState as DiscoveryRefreshState, DiscoveryDiagnostics,
    },
    error::AppError,
    security::elevation_macos::{HelperAvailability, HelperRegistrationState},
};

use super::{LoadedPreferences, ProviderTimeoutPreset, SettingsDiagnosticCode};

pub const DIAGNOSTICS_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RefreshState {
    NotStarted,
    Refreshing,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderState {
    Loading,
    Healthy,
    Partial,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreferenceState {
    Validated,
    SafeDefault,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationDiagnostics {
    name: &'static str,
    version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiagnostics {
    architecture: String,
    macos_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDiagnostics {
    schema_version: u16,
    application_count: usize,
    managed_document_count: usize,
    service_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperDiagnostics {
    supported: bool,
    signed: bool,
    available: bool,
    state: HelperRegistrationState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshDiagnostics {
    state: RefreshState,
    completed_at_epoch_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDiagnostics {
    id: &'static str,
    state: ProviderState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceDiagnostics {
    state: PreferenceState,
    schema_version: u16,
    diagnostic_code: Option<SettingsDiagnosticCode>,
    provider_timeout_preset: ProviderTimeoutPreset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    schema_version: u16,
    generated_at_epoch_ms: u64,
    application: ApplicationDiagnostics,
    system: SystemDiagnostics,
    catalog: CatalogDiagnostics,
    helper: HelperDiagnostics,
    refresh: RefreshDiagnostics,
    providers: [ProviderDiagnostics; 3],
    preferences: PreferenceDiagnostics,
    report_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExport {
    display_location: String,
}

impl DiagnosticsReport {
    pub(crate) fn collect(
        catalog: &Catalog,
        discovery: DiscoveryDiagnostics,
        helper: &HelperAvailability,
        preferences: &LoadedPreferences,
    ) -> Self {
        let application = ApplicationDiagnostics {
            name: "UserHome",
            version: env!("CARGO_PKG_VERSION").to_owned(),
        };
        let system = SystemDiagnostics {
            architecture: sanitize_system_value(discovery.architecture)
                .unwrap_or_else(|| std::env::consts::ARCH.to_owned()),
            macos_version: sanitize_system_value(discovery.macos_version),
        };
        let catalog = CatalogDiagnostics {
            schema_version: catalog.schema_version(),
            application_count: catalog.apps().len(),
            managed_document_count: catalog
                .apps()
                .iter()
                .map(|application| application.config_documents().len())
                .sum(),
            service_count: catalog
                .apps()
                .iter()
                .map(|application| application.services().len())
                .sum(),
        };
        let helper = HelperDiagnostics {
            supported: helper.supported,
            signed: helper.signed,
            available: helper.available,
            state: helper.state.clone(),
        };
        let refresh = RefreshDiagnostics {
            state: map_refresh_state(discovery.refresh_state),
            completed_at_epoch_ms: discovery.completed_at_epoch_ms,
        };
        let providers = [
            ProviderDiagnostics {
                id: "system",
                state: map_provider_state(discovery.system),
            },
            ProviderDiagnostics {
                id: "homebrew",
                state: map_provider_state(discovery.homebrew),
            },
            ProviderDiagnostics {
                id: "candidates",
                state: map_provider_state(discovery.candidates),
            },
        ];
        let preferences = PreferenceDiagnostics {
            state: if preferences.diagnostic().is_some() {
                PreferenceState::SafeDefault
            } else {
                PreferenceState::Validated
            },
            schema_version: preferences.preferences().schema_version(),
            diagnostic_code: preferences.diagnostic().map(|diagnostic| diagnostic.code()),
            provider_timeout_preset: preferences.preferences().provider_timeout_preset(),
        };
        let generated_at_epoch_ms = now_epoch_ms();
        let mut report = Self {
            schema_version: DIAGNOSTICS_SCHEMA_VERSION,
            generated_at_epoch_ms,
            application,
            system,
            catalog,
            helper,
            refresh,
            providers,
            preferences,
            report_text: String::new(),
        };
        report.report_text = render_report(&report);
        report
    }

    pub(crate) fn export_to(&self, directory: &Path) -> Result<DiagnosticsExport, AppError> {
        let file_name = format!("userhome-diagnostics-{}.txt", self.generated_at_epoch_ms);
        let path = directory.join(&file_name);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|_| AppError::permission_denied("Diagnostics report could not be created."))?;
        if file
            .write_all(self.report_text.as_bytes())
            .and_then(|()| file.sync_all())
            .is_err()
        {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(AppError::permission_denied(
                "Diagnostics report could not be written.",
            ));
        }
        Ok(DiagnosticsExport {
            display_location: format!("~/Downloads/{file_name}"),
        })
    }
}

fn sanitize_system_value(value: Option<String>) -> Option<String> {
    value.filter(|value| {
        !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._+-".contains(&byte))
    })
}

fn map_refresh_state(state: DiscoveryRefreshState) -> RefreshState {
    match state {
        DiscoveryRefreshState::NotStarted => RefreshState::NotStarted,
        DiscoveryRefreshState::Refreshing => RefreshState::Refreshing,
        DiscoveryRefreshState::Complete => RefreshState::Complete,
    }
}

fn map_provider_state(state: DiscoveryProviderState) -> ProviderState {
    match state {
        DiscoveryProviderState::Loading => ProviderState::Loading,
        DiscoveryProviderState::Healthy => ProviderState::Healthy,
        DiscoveryProviderState::Partial => ProviderState::Partial,
        DiscoveryProviderState::Unavailable => ProviderState::Unavailable,
        DiscoveryProviderState::Error => ProviderState::Error,
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn render_report(report: &DiagnosticsReport) -> String {
    format!(
        concat!(
            "UserHome Diagnostics\n",
            "Schema: {schema}\n",
            "Generated (epoch ms): {generated}\n",
            "\nApplication\n",
            "Version: {app_version}\n",
            "\nSystem\n",
            "Architecture: {architecture}\n",
            "macOS: {macos}\n",
            "\nCatalog\n",
            "Schema: {catalog_schema}\n",
            "Applications: {application_count}\n",
            "Managed documents: {document_count}\n",
            "Services: {service_count}\n",
            "\nHelper\n",
            "State: {helper_state}\n",
            "Supported: {helper_supported}\n",
            "Signed: {helper_signed}\n",
            "Available: {helper_available}\n",
            "\nRefresh\n",
            "State: {refresh_state}\n",
            "Completed (epoch ms): {completed}\n",
            "\nProviders\n",
            "System: {system_provider}\n",
            "Homebrew: {homebrew_provider}\n",
            "Candidates: {candidates_provider}\n",
            "\nPreferences\n",
            "State: {preference_state}\n",
            "Schema: {preference_schema}\n",
            "Diagnostic: {diagnostic}\n",
            "Provider timeout: {timeout}\n",
            "\nPrivacy\n",
            "Configuration contents: not included\n",
            "Credentials and authorization material: not included\n",
            "Usernames, absolute home paths, and environment variables: not included\n"
        ),
        schema = DIAGNOSTICS_SCHEMA_VERSION,
        generated = report.generated_at_epoch_ms,
        app_version = report.application.version,
        architecture = report.system.architecture,
        macos = report.system.macos_version.as_deref().unwrap_or("UNKNOWN"),
        catalog_schema = report.catalog.schema_version,
        application_count = report.catalog.application_count,
        document_count = report.catalog.managed_document_count,
        service_count = report.catalog.service_count,
        helper_state = helper_state_label(&report.helper.state),
        helper_supported = report.helper.supported,
        helper_signed = report.helper.signed,
        helper_available = report.helper.available,
        refresh_state = refresh_state_label(report.refresh.state),
        completed = report
            .refresh
            .completed_at_epoch_ms
            .map(|value| value.to_string())
            .unwrap_or_else(|| "NOT_AVAILABLE".to_owned()),
        system_provider = provider_state_label(report.providers[0].state),
        homebrew_provider = provider_state_label(report.providers[1].state),
        candidates_provider = provider_state_label(report.providers[2].state),
        preference_state = preference_state_label(report.preferences.state),
        preference_schema = report.preferences.schema_version,
        diagnostic = diagnostic_code_label(report.preferences.diagnostic_code),
        timeout = timeout_label(report.preferences.provider_timeout_preset),
    )
}

fn helper_state_label(state: &HelperRegistrationState) -> &'static str {
    match state {
        HelperRegistrationState::Enabled => "ENABLED",
        HelperRegistrationState::RequiresApproval => "REQUIRES_APPROVAL",
        HelperRegistrationState::NotRegistered => "NOT_REGISTERED",
        HelperRegistrationState::NotFound => "NOT_FOUND",
        HelperRegistrationState::Unsupported => "UNSUPPORTED",
        HelperRegistrationState::Unsigned => "UNSIGNED",
    }
}

fn refresh_state_label(state: RefreshState) -> &'static str {
    match state {
        RefreshState::NotStarted => "NOT_STARTED",
        RefreshState::Refreshing => "REFRESHING",
        RefreshState::Complete => "COMPLETE",
    }
}

fn provider_state_label(state: ProviderState) -> &'static str {
    match state {
        ProviderState::Loading => "LOADING",
        ProviderState::Healthy => "HEALTHY",
        ProviderState::Partial => "PARTIAL",
        ProviderState::Unavailable => "UNAVAILABLE",
        ProviderState::Error => "ERROR",
    }
}

fn preference_state_label(state: PreferenceState) -> &'static str {
    match state {
        PreferenceState::Validated => "VALIDATED",
        PreferenceState::SafeDefault => "SAFE_DEFAULT",
    }
}

fn diagnostic_code_label(code: Option<SettingsDiagnosticCode>) -> &'static str {
    match code {
        Some(SettingsDiagnosticCode::ReadFailed) => "READ_FAILED",
        Some(SettingsDiagnosticCode::InvalidDocument) => "INVALID_DOCUMENT",
        Some(SettingsDiagnosticCode::UnsupportedVersion) => "UNSUPPORTED_VERSION",
        None => "NONE",
    }
}

fn timeout_label(preset: ProviderTimeoutPreset) -> &'static str {
    match preset {
        ProviderTimeoutPreset::Short => "SHORT",
        ProviderTimeoutPreset::Standard => "STANDARD",
        ProviderTimeoutPreset::Extended => "EXTENDED",
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        catalog::load_builtin_catalog,
        discovery::refresh::{
            DiagnosticProviderState, DiagnosticRefreshState, DiscoveryDiagnostics,
        },
        security::elevation_macos::{HelperAvailability, HelperRegistrationState},
    };

    use super::*;

    #[test]
    fn report_serializes_only_allowlisted_diagnostics() {
        let catalog = load_builtin_catalog().expect("load catalog");
        let discovery = DiscoveryDiagnostics {
            macos_version: Some("15.0.1".to_owned()),
            architecture: Some("/Users/example/.private".to_owned()),
            refresh_state: DiagnosticRefreshState::Complete,
            completed_at_epoch_ms: Some(1234),
            system: DiagnosticProviderState::Healthy,
            homebrew: DiagnosticProviderState::Unavailable,
            candidates: DiagnosticProviderState::Partial,
        };
        let helper = HelperAvailability {
            supported: true,
            signed: false,
            state: HelperRegistrationState::RequiresApproval,
            available: false,
            reason: "apiToken=secret /Users/example".to_owned(),
        };
        let preferences = LoadedPreferences::ready(super::super::UserPreferences::default());

        let report = DiagnosticsReport::collect(&catalog, discovery, &helper, &preferences);
        let serialized = serde_json::to_string(&report).expect("serialize diagnostics");

        assert!(serialized.contains("\"architecture\":\""));
        assert!(serialized.contains("\"state\":\"UNAVAILABLE\""));
        assert!(serialized.contains("Configuration contents: not included"));
        assert!(!serialized.contains("/Users/"));
        assert!(!serialized.contains("apiToken"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("\"reason\""));
        assert!(!serialized.contains("\"optionalDiscoveryRoots\""));
        assert!(report.report_text.len() < 4 * 1024);
    }
}
