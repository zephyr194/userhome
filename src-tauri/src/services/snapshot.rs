//! Read-only snapshot of resident Caddy instances, so the Caddy module can see
//! which launchd jobs it must not stop, reload or take over. It is projected
//! from the same discovery and ownership verdicts as the service list. None of
//! its fields can change anything or carries authorization, and it names no
//! path except the plist and the configuration file a launch argument states.

use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use super::{
    launchd::{
        ConfigFile, Discovery, LaunchdDomain, LaunchdScope, LaunchdService, LoadState, ParseStatus,
        RunState, Source, SourceReason, SourceStatus, discover, with_system,
    },
    ownership::{
        HOMEBREW_CADDY_LABEL, NoAdoptions, OwnedDiscovery, OwnedService, Ownership,
        attach_ownership,
    },
};

pub const CADDY_EXECUTABLE_NAME: &str = "caddy";
const CONFIG_LONG: &str = "--config";
const CONFIG_SHORT: &str = "-c";
const ADAPTER_LONG: &str = "--adapter";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentCaddySnapshot {
    pub observed_at_ms: u64,
    /// Discovery was complete and every instance is complete. Only then may
    /// the absence of a resident Caddy be concluded.
    pub complete: bool,
    pub can_conclude_absence: bool,
    pub sources: Vec<SnapshotSource>,
    pub instances: Vec<ResidentCaddyInstance>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSource {
    pub source: Source,
    pub status: SourceStatus,
    pub reason: Option<SourceReason>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentCaddyInstance {
    pub label: String,
    pub domain: LaunchdDomain,
    pub scope: LaunchdScope,
    pub ownership: Ownership,
    pub plist_path: Option<String>,
    pub executable: Option<String>,
    /// Secret-looking values are already masked by the plist reader.
    pub arguments: Vec<String>,
    pub adapter: Option<String>,
    pub config: ConfigLocation,
    pub load_state: LoadState,
    pub run_state: RunState,
    /// Present only while the job is running.
    pub pid: Option<u32>,
    pub observed_at_ms: u64,
    pub complete: bool,
    pub incomplete_reasons: Vec<IncompleteReason>,
}

/// Where the configuration file is stated in the launch arguments. A path is
/// only given when exactly one usable flag states it; otherwise the reason is
/// recorded and no location is guessed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigLocation {
    pub path: Option<String>,
    pub flag: Option<FlagForm>,
    pub unknown_reason: Option<UnknownReason>,
}

impl ConfigLocation {
    fn unknown(reason: UnknownReason) -> Self {
        Self {
            path: None,
            flag: None,
            unknown_reason: Some(reason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FlagForm {
    Long,
    LongEquals,
    Short,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UnknownReason {
    Missing,
    NoValue,
    Ambiguous,
}

/// Why an instance's facts may be incomplete. Any reason makes it incomplete.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IncompleteReason {
    SourceIncomplete,
    DiscoveryTruncated,
    PlistUnparsed,
    LoadStateUnknown,
    ArgumentsTruncated,
    DefinitionAmbiguous,
}

pub fn is_caddy_executable(path: &str) -> bool {
    Path::new(path).file_name().and_then(|name| name.to_str()) == Some(CADDY_EXECUTABLE_NAME)
}

fn executable_path(file: &ConfigFile) -> Option<String> {
    let details = file.details.as_ref()?;
    details
        .program
        .clone()
        .or_else(|| details.program_arguments.first().cloned())
}

fn is_caddy_file(file: &ConfigFile) -> bool {
    executable_path(file).is_some_and(|path| is_caddy_executable(&path))
}

fn is_caddy_definition(service: &LaunchdService) -> bool {
    service.label == HOMEBREW_CADDY_LABEL || service.config_files.iter().any(is_caddy_file)
}

fn chosen_file(service: &LaunchdService) -> Option<&ConfigFile> {
    service
        .config_files
        .iter()
        .find(|file| is_caddy_file(file))
        .or_else(|| {
            service
                .config_files
                .iter()
                .find(|file| file.details.is_some())
        })
        .or_else(|| service.config_files.first())
}

/// One occurrence of a flag: its form and value, or `None` when it has no
/// usable value. A separate value may not start with `-`.
type Occurrence = Option<(FlagForm, String)>;

fn occurrences(arguments: &[String], long: &str, short: Option<&str>) -> Vec<Occurrence> {
    let mut found = Vec::new();
    let mut index = 0;
    while index < arguments.len() {
        let argument = arguments[index].as_str();
        if let Some(value) = argument
            .strip_prefix(long)
            .and_then(|rest| rest.strip_prefix('='))
        {
            found.push((!value.is_empty()).then(|| (FlagForm::LongEquals, value.to_owned())));
        } else if argument == long || short == Some(argument) {
            let form = if argument == long {
                FlagForm::Long
            } else {
                FlagForm::Short
            };
            match arguments
                .get(index + 1)
                .filter(|value| !value.is_empty() && !value.starts_with('-'))
            {
                Some(value) => {
                    found.push(Some((form, value.clone())));
                    index += 1;
                }
                None => found.push(None),
            }
        }
        index += 1;
    }
    found
}

fn abbreviate(path: &str, home: Option<&Path>) -> String {
    if let Some(home) = home
        && let Ok(relative) = Path::new(path).strip_prefix(home)
        && !relative.as_os_str().is_empty()
    {
        return format!("~/{}", relative.to_string_lossy());
    }
    path.to_owned()
}

pub fn config_location(arguments: &[String], home: Option<&Path>) -> ConfigLocation {
    match occurrences(arguments, CONFIG_LONG, Some(CONFIG_SHORT)).as_slice() {
        [] => ConfigLocation::unknown(UnknownReason::Missing),
        [None] => ConfigLocation::unknown(UnknownReason::NoValue),
        [Some((flag, path))] => ConfigLocation {
            path: Some(abbreviate(path, home)),
            flag: Some(*flag),
            unknown_reason: None,
        },
        _ => ConfigLocation::unknown(UnknownReason::Ambiguous),
    }
}

pub fn adapter_of(arguments: &[String]) -> Option<String> {
    match occurrences(arguments, ADAPTER_LONG, None).as_slice() {
        [Some((_, value))] => Some(value.clone()),
        _ => None,
    }
}

fn instance(
    owned: &OwnedService,
    discovery_complete: bool,
    truncated: bool,
    home: Option<&Path>,
    observed_at_ms: u64,
) -> ResidentCaddyInstance {
    let service = &owned.service;
    let file = chosen_file(service);
    let details = file.and_then(|file| file.details.as_ref());
    let arguments = details
        .map(|details| details.program_arguments.clone())
        .unwrap_or_default();

    let mut incomplete_reasons = Vec::new();
    if !discovery_complete {
        incomplete_reasons.push(IncompleteReason::SourceIncomplete);
    }
    if truncated {
        incomplete_reasons.push(IncompleteReason::DiscoveryTruncated);
    }
    if service
        .config_files
        .iter()
        .any(|file| file.parse_status != ParseStatus::Parsed)
    {
        incomplete_reasons.push(IncompleteReason::PlistUnparsed);
    }
    if !matches!(service.load_state, LoadState::Loaded | LoadState::NotLoaded) {
        incomplete_reasons.push(IncompleteReason::LoadStateUnknown);
    }
    if details.is_some_and(|details| details.arguments_truncated) {
        incomplete_reasons.push(IncompleteReason::ArgumentsTruncated);
    }
    if service.config_files.len() > 1 {
        incomplete_reasons.push(IncompleteReason::DefinitionAmbiguous);
    }

    ResidentCaddyInstance {
        label: service.label.clone(),
        domain: service.domain,
        scope: service.scope,
        ownership: owned.ownership.ownership,
        plist_path: file.map(|file| file.path.clone()),
        executable: file
            .and_then(executable_path)
            .map(|path| abbreviate(&path, home)),
        config: config_location(&arguments, home),
        adapter: adapter_of(&arguments),
        arguments,
        load_state: service.load_state,
        run_state: service.run_state,
        pid: service
            .pid
            .filter(|_| service.run_state == RunState::Running),
        observed_at_ms,
        complete: incomplete_reasons.is_empty(),
        incomplete_reasons,
    }
}

pub fn project(
    discovery: OwnedDiscovery,
    home: Option<&Path>,
    observed_at_ms: u64,
) -> ResidentCaddySnapshot {
    let discovery_complete = discovery.complete;
    let truncated = discovery.truncated;
    let instances: Vec<ResidentCaddyInstance> = discovery
        .services
        .iter()
        .filter(|owned| is_caddy_definition(&owned.service))
        .map(|owned| instance(owned, discovery_complete, truncated, home, observed_at_ms))
        .collect();
    let complete = discovery_complete && instances.iter().all(|instance| instance.complete);
    ResidentCaddySnapshot {
        observed_at_ms,
        complete,
        can_conclude_absence: complete,
        sources: discovery
            .sources
            .iter()
            .map(|report| SnapshotSource {
                source: report.source,
                status: report.status,
                reason: report.reason,
            })
            .collect(),
        instances,
    }
}

pub fn resident_caddy_snapshot(ctx: &Discovery<'_>, observed_at_ms: u64) -> ResidentCaddySnapshot {
    let owned = attach_ownership(discover(ctx), ctx.uid, &NoAdoptions);
    project(owned, ctx.home.as_deref(), observed_at_ms)
}

/// The snapshot of the real system. The caller holds the discovery gate.
pub fn read_system() -> ResidentCaddySnapshot {
    let observed_at_ms = now_ms();
    with_system(|ctx| resident_caddy_snapshot(ctx, observed_at_ms))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
