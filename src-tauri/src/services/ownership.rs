//! Ownership and modifiability of launchd jobs, decided only from facts the
//! backend discovered (plist directory, file owner, file type, domain, label).
//!
//! Nothing here trusts the frontend: a mutating command receives at most a
//! (domain, label) pair, and [`ensure_modifiable`] rediscovers and reassesses
//! before it hands back a [`ModifiableTarget`]. A label prefix alone never makes
//! a job modifiable, and everything that cannot be proven stays read-only.

use std::{
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::error::AppError;

use super::launchd::{
    ConfigFile, DIRECTORIES, Discovery, DiscoveryGate, FileKind, Label, LaunchdDirectory,
    LaunchdDiscovery, LaunchdDomain, LaunchdService, LinkState, ParseStatus, ServiceIssue,
    SourceReport, SourceStatus, discover, with_system,
};

/// Labels of jobs UserHome creates start with this. Shared with job creation.
pub const USERHOME_LABEL_NAMESPACE: &str = "com.zephyr194.userhome.agent.";

/// The only Homebrew job the legacy service-action path may act on.
pub const HOMEBREW_CADDY_LABEL: &str = "homebrew.mxcl.caddy";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Ownership {
    CurrentUserAgent,
    GlobalAgent,
    SystemDaemon,
    AppleManaged,
    ThirdParty,
    UserhomeCreated,
    UserhomeAdopted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReadOnlyReason {
    AppleManaged,
    SystemDaemonLocation,
    GlobalAgentLocation,
    NotAdopted,
    NoConfigFile,
    SymbolicLink,
    LinkTargetOutside,
    OwnerNotCurrentUser,
    OwnerUnknown,
    PlistNotParsed,
    LabelNotFromPlist,
    LabelFilenameMismatch,
    DuplicateDefinition,
    UnapprovedLocation,
    DiscoveryIncomplete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Evidence {
    LabelAppleNamespace,
    ApplePath,
    LabelUserhomeNamespace,
    AdoptionRecord,
    DomainGui,
    DomainSystem,
    InUserLaunchAgents,
    InGlobalLaunchAgents,
    InGlobalLaunchDaemons,
    OwnerCurrentUser,
    OwnerOtherUser,
    OwnerUnknown,
    RegularFile,
    SymbolicLink,
    NoConfigFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnershipAssessment {
    pub ownership: Ownership,
    pub modifiable: bool,
    /// Empty exactly when `modifiable`.
    pub read_only_reasons: Vec<ReadOnlyReason>,
    pub evidence: Vec<Evidence>,
}

/// Where UserHome keeps its record of adopted jobs. SVC-6 provides the real
/// source; until then nothing is adopted.
pub trait AdoptionRecords: Sync {
    fn is_adopted(&self, domain: LaunchdDomain, label: &str, config_path: &str) -> bool;
}

pub struct NoAdoptions;

impl AdoptionRecords for NoAdoptions {
    fn is_adopted(&self, _: LaunchdDomain, _: &str, _: &str) -> bool {
        false
    }
}

fn push_unique<T: PartialEq>(items: &mut Vec<T>, item: T) {
    if !items.contains(&item) {
        items.push(item);
    }
}

fn in_namespace(label: &str) -> bool {
    label
        .strip_prefix(USERHOME_LABEL_NAMESPACE)
        .is_some_and(|rest| !rest.is_empty())
}

fn is_apple_directory(directory: LaunchdDirectory) -> bool {
    matches!(
        directory,
        LaunchdDirectory::AppleLaunchAgents | LaunchdDirectory::AppleLaunchDaemons
    )
}

fn is_apple(service: &LaunchdService) -> bool {
    service.label.starts_with("com.apple.")
        || service
            .config_files
            .iter()
            .any(|file| file.is_apple_path || is_apple_directory(file.directory))
}

fn collect_evidence(
    service: &LaunchdService,
    uid: u32,
    adoptions: &dyn AdoptionRecords,
) -> Vec<Evidence> {
    let mut evidence = vec![match service.domain {
        LaunchdDomain::Gui => Evidence::DomainGui,
        LaunchdDomain::System => Evidence::DomainSystem,
    }];
    if service.label.starts_with("com.apple.") {
        evidence.push(Evidence::LabelAppleNamespace);
    }
    if in_namespace(&service.label) {
        evidence.push(Evidence::LabelUserhomeNamespace);
    }
    if service.config_files.is_empty() {
        evidence.push(Evidence::NoConfigFile);
    }
    for file in &service.config_files {
        if file.is_apple_path || is_apple_directory(file.directory) {
            push_unique(&mut evidence, Evidence::ApplePath);
        }
        match file.directory {
            LaunchdDirectory::UserLaunchAgents => {
                push_unique(&mut evidence, Evidence::InUserLaunchAgents)
            }
            LaunchdDirectory::GlobalLaunchAgents => {
                push_unique(&mut evidence, Evidence::InGlobalLaunchAgents)
            }
            LaunchdDirectory::GlobalLaunchDaemons => {
                push_unique(&mut evidence, Evidence::InGlobalLaunchDaemons)
            }
            LaunchdDirectory::AppleLaunchAgents | LaunchdDirectory::AppleLaunchDaemons => {}
        }
        push_unique(
            &mut evidence,
            match file.owner_uid {
                None => Evidence::OwnerUnknown,
                Some(owner) if owner == uid => Evidence::OwnerCurrentUser,
                Some(_) => Evidence::OwnerOtherUser,
            },
        );
        push_unique(
            &mut evidence,
            match file.kind {
                FileKind::Regular => Evidence::RegularFile,
                FileKind::Link => Evidence::SymbolicLink,
            },
        );
        if adoptions.is_adopted(service.domain, &service.label, &file.path) {
            push_unique(&mut evidence, Evidence::AdoptionRecord);
        }
    }
    evidence
}

/// Problems with one file as a place to modify a job from: a link (whose target
/// is never read), an owner other than `expected_owner`, or an unreadable plist.
fn file_problems(file: &ConfigFile, expected_owner: u32, reasons: &mut Vec<ReadOnlyReason>) {
    match file.kind {
        FileKind::Link => {
            push_unique(reasons, ReadOnlyReason::SymbolicLink);
            if file
                .link_target
                .as_ref()
                .is_none_or(|target| target.state != LinkState::Inside)
            {
                push_unique(reasons, ReadOnlyReason::LinkTargetOutside);
            }
        }
        FileKind::Regular => {}
    }
    match file.owner_uid {
        None => push_unique(reasons, ReadOnlyReason::OwnerUnknown),
        Some(owner) if owner != expected_owner => {
            push_unique(reasons, ReadOnlyReason::OwnerNotCurrentUser);
        }
        Some(_) => {}
    }
    if file.kind == FileKind::Regular && file.parse_status != ParseStatus::Parsed {
        push_unique(reasons, ReadOnlyReason::PlistNotParsed);
    }
}

/// Decides ownership and modifiability from the discovered facts alone.
/// `discovery_trusted` says the directories of the job's domain were read
/// completely, so no other definition of the label can be hiding.
pub fn assess(
    service: &LaunchdService,
    uid: u32,
    adoptions: &dyn AdoptionRecords,
    discovery_trusted: bool,
) -> OwnershipAssessment {
    let evidence = collect_evidence(service, uid, adoptions);
    let read_only = |ownership, reasons: Vec<ReadOnlyReason>| OwnershipAssessment {
        ownership,
        modifiable: false,
        read_only_reasons: reasons,
        evidence: evidence.clone(),
    };
    let files = &service.config_files;
    let in_directory = |directory| files.iter().any(|file| file.directory == directory);

    if is_apple(service) {
        return read_only(Ownership::AppleManaged, vec![ReadOnlyReason::AppleManaged]);
    }
    if files.is_empty() {
        return if service.domain == LaunchdDomain::System {
            read_only(
                Ownership::SystemDaemon,
                vec![
                    ReadOnlyReason::SystemDaemonLocation,
                    ReadOnlyReason::NoConfigFile,
                ],
            )
        } else {
            read_only(Ownership::ThirdParty, vec![ReadOnlyReason::NoConfigFile])
        };
    }
    if in_directory(LaunchdDirectory::GlobalLaunchDaemons) {
        return read_only(
            Ownership::SystemDaemon,
            vec![ReadOnlyReason::SystemDaemonLocation],
        );
    }
    if in_directory(LaunchdDirectory::GlobalLaunchAgents) {
        return read_only(
            Ownership::GlobalAgent,
            vec![ReadOnlyReason::GlobalAgentLocation],
        );
    }

    // Only the current user's own LaunchAgents directory is left.
    let mut problems = Vec::new();
    if service.domain != LaunchdDomain::Gui || !in_directory(LaunchdDirectory::UserLaunchAgents) {
        push_unique(&mut problems, ReadOnlyReason::UnapprovedLocation);
    }
    if files.len() > 1 {
        push_unique(&mut problems, ReadOnlyReason::DuplicateDefinition);
    }
    for file in files {
        file_problems(file, uid, &mut problems);
    }
    if service.label_source != super::launchd::LabelSource::Plist {
        push_unique(&mut problems, ReadOnlyReason::LabelNotFromPlist);
    }
    if service
        .issues
        .contains(&ServiceIssue::LabelFilenameMismatch)
    {
        push_unique(&mut problems, ReadOnlyReason::LabelFilenameMismatch);
    }
    if !problems.is_empty() {
        return read_only(Ownership::ThirdParty, problems);
    }

    let adopted = files
        .iter()
        .any(|file| adoptions.is_adopted(service.domain, &service.label, &file.path));
    let ownership = if in_namespace(&service.label) {
        Ownership::UserhomeCreated
    } else if adopted {
        Ownership::UserhomeAdopted
    } else {
        Ownership::CurrentUserAgent
    };
    let mut reasons = Vec::new();
    if ownership == Ownership::CurrentUserAgent {
        reasons.push(ReadOnlyReason::NotAdopted);
    }
    if !discovery_trusted {
        reasons.push(ReadOnlyReason::DiscoveryIncomplete);
    }
    OwnershipAssessment {
        ownership,
        modifiable: reasons.is_empty(),
        read_only_reasons: reasons,
        evidence,
    }
}

/// True when every directory of `domain` was listed completely and nothing was
/// cut off, so no unseen file can define the same label.
fn domain_trusted(discovery: &LaunchdDiscovery, domain: LaunchdDomain) -> bool {
    !discovery.truncated
        && DIRECTORIES
            .iter()
            .filter(|directory| directory.domain() == domain)
            .all(|directory| {
                discovery
                    .sources
                    .iter()
                    .find(|report| report.source == directory.source())
                    .is_some_and(|report| report.status == SourceStatus::Complete)
            })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedService {
    #[serde(flatten)]
    pub service: LaunchdService,
    pub ownership: OwnershipAssessment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedDiscovery {
    pub services: Vec<OwnedService>,
    pub sources: Vec<SourceReport>,
    pub complete: bool,
    pub truncated: bool,
}

pub fn attach_ownership(
    discovery: LaunchdDiscovery,
    uid: u32,
    adoptions: &dyn AdoptionRecords,
) -> OwnedDiscovery {
    let trusted = [LaunchdDomain::Gui, LaunchdDomain::System]
        .map(|domain| (domain, domain_trusted(&discovery, domain)));
    let services = discovery
        .services
        .into_iter()
        .map(|service| {
            let trusted = trusted
                .iter()
                .any(|(domain, trusted)| *domain == service.domain && *trusted);
            let ownership = assess(&service, uid, adoptions, trusted);
            OwnedService { service, ownership }
        })
        .collect();
    OwnedDiscovery {
        services,
        sources: discovery.sources,
        complete: discovery.complete,
        truncated: discovery.truncated,
    }
}

/// Discovery of the real system with ownership attached. The caller holds the
/// discovery gate.
pub fn discover_owned_system() -> OwnedDiscovery {
    with_system(|ctx| attach_ownership(discover(ctx), ctx.uid, &NoAdoptions))
}

/// What a mutating command may send: a domain and a label, never a path.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceRequest {
    pub domain: LaunchdDomain,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModifiableTarget {
    pub domain: LaunchdDomain,
    pub domain_target: String,
    pub label: String,
    pub ownership: Ownership,
    pub config_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnershipError {
    InvalidLabel,
    NotFound,
    ReadOnly(OwnershipAssessment),
    LegacyHomebrewBlocked(Vec<ReadOnlyReason>),
    DiscoveryBusy,
}

fn code_of(value: &impl Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

impl From<OwnershipError> for AppError {
    fn from(error: OwnershipError) -> Self {
        match error {
            OwnershipError::InvalidLabel => AppError::invalid_input("Service label is not valid."),
            OwnershipError::NotFound => AppError::not_found("launchd service was not found."),
            OwnershipError::ReadOnly(assessment) => AppError::permission_denied(&format!(
                "This launchd service is read-only ({}: {}).",
                code_of(&assessment.ownership),
                assessment
                    .read_only_reasons
                    .first()
                    .map(code_of)
                    .unwrap_or_default()
            )),
            OwnershipError::LegacyHomebrewBlocked(reasons) => {
                AppError::permission_denied(&format!(
                    "Homebrew service action refused: the launchd definition failed a safety check ({}).",
                    reasons.first().map(code_of).unwrap_or_default()
                ))
            }
            OwnershipError::DiscoveryBusy => {
                AppError::conflict("launchd discovery is already running. Retry when it finishes.")
            }
        }
    }
}

fn expand_home(path: &str, home: Option<&std::path::Path>) -> Option<PathBuf> {
    match path.strip_prefix("~/") {
        Some(rest) => home.map(|home| home.join(rest)),
        None => Some(PathBuf::from(path)),
    }
}

/// The single entry point for changing a launchd job. It trusts nothing but the
/// (domain, label) pair: it rediscovers, reassesses, and only then names the
/// file, which it found itself. Every mutating command goes through it.
pub fn ensure_modifiable(
    ctx: &Discovery<'_>,
    adoptions: &dyn AdoptionRecords,
    request: &ServiceRequest,
) -> Result<ModifiableTarget, OwnershipError> {
    Label::parse(&request.label).map_err(|_| OwnershipError::InvalidLabel)?;
    let discovery = discover(ctx);
    let trusted = domain_trusted(&discovery, request.domain);
    // Every entry with this label counts, including a file that could not be
    // tied to a label (such as a link) but is named after it.
    let matches: Vec<&LaunchdService> = discovery
        .services
        .iter()
        .filter(|service| service.domain == request.domain && service.label == request.label)
        .collect();
    let assessments: Vec<OwnershipAssessment> = matches
        .iter()
        .map(|service| assess(service, ctx.uid, adoptions, trusted))
        .collect();
    if let Some(denied) = assessments.iter().find(|assessment| !assessment.modifiable) {
        return Err(OwnershipError::ReadOnly(denied.clone()));
    }
    let (Some(service), Some(assessment)) = (matches.first(), assessments.first()) else {
        return Err(OwnershipError::NotFound);
    };
    if matches.len() > 1 {
        return Err(OwnershipError::ReadOnly(OwnershipAssessment {
            ownership: Ownership::ThirdParty,
            modifiable: false,
            read_only_reasons: vec![ReadOnlyReason::DuplicateDefinition],
            evidence: assessment.evidence.clone(),
        }));
    }
    let config_path = service
        .config_files
        .first()
        .and_then(|file| expand_home(&file.path, ctx.home.as_deref()))
        .ok_or(OwnershipError::NotFound)?;
    Ok(ModifiableTarget {
        domain: service.domain,
        domain_target: service.domain_target.clone(),
        label: service.label.clone(),
        ownership: assessment.ownership,
        config_path,
    })
}

fn acquire_gate() -> Result<DiscoveryGate, OwnershipError> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(gate) = DiscoveryGate::try_acquire() {
            return Ok(gate);
        }
        if Instant::now() >= deadline {
            return Err(OwnershipError::DiscoveryBusy);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

/// [`ensure_modifiable`] against the real system; waits briefly for a running
/// discovery instead of failing at once.
pub fn ensure_modifiable_system(
    adoptions: &dyn AdoptionRecords,
    request: &ServiceRequest,
) -> Result<ModifiableTarget, OwnershipError> {
    let _gate = acquire_gate()?;
    with_system(|ctx| ensure_modifiable(ctx, adoptions, request))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HomebrewScope {
    User,
    System,
}

/// Why the legacy Homebrew path must not act on this definition of
/// `homebrew.mxcl.caddy`. It is a narrow exception for the one job that path has
/// always managed, not a verdict of modifiability: it names the places that job
/// may live (the user's LaunchAgents, or root's LaunchDaemons for the helper)
/// and refuses an Apple path, another owner, a link or anything else.
pub fn homebrew_violations(
    service: &LaunchdService,
    scope: HomebrewScope,
    uid: u32,
) -> Vec<ReadOnlyReason> {
    let (domain, directory, owner) = match scope {
        HomebrewScope::User => (LaunchdDomain::Gui, LaunchdDirectory::UserLaunchAgents, uid),
        HomebrewScope::System => (
            LaunchdDomain::System,
            LaunchdDirectory::GlobalLaunchDaemons,
            0,
        ),
    };
    let mut reasons = Vec::new();
    if is_apple(service) {
        reasons.push(ReadOnlyReason::AppleManaged);
    }
    if service.domain != domain {
        push_unique(&mut reasons, ReadOnlyReason::UnapprovedLocation);
    }
    if service.config_files.len() > 1 {
        push_unique(&mut reasons, ReadOnlyReason::DuplicateDefinition);
    }
    for file in &service.config_files {
        if file.directory != directory && !is_apple_directory(file.directory) {
            push_unique(&mut reasons, ReadOnlyReason::UnapprovedLocation);
        }
        file_problems_for_brew(file, owner, &mut reasons);
    }
    reasons
}

/// Like [`file_problems`], but an unreadable plist is not a reason here: the
/// legacy path never reads it.
fn file_problems_for_brew(file: &ConfigFile, owner: u32, reasons: &mut Vec<ReadOnlyReason>) {
    let mut found = Vec::new();
    file_problems(file, owner, &mut found);
    for reason in found {
        if reason != ReadOnlyReason::PlistNotParsed {
            push_unique(reasons, reason);
        }
    }
}

/// Refuses the legacy Homebrew Caddy action when launchd's own definition of
/// `homebrew.mxcl.caddy` fails [`homebrew_violations`]. It takes no label, so it
/// cannot be pointed at another job. With no launchd evidence at all, or only a
/// loaded job without a file, the existing Homebrew behaviour is unchanged.
pub fn check_homebrew_caddy(
    ctx: &Discovery<'_>,
    scope: HomebrewScope,
) -> Result<(), OwnershipError> {
    let domain = match scope {
        HomebrewScope::User => LaunchdDomain::Gui,
        HomebrewScope::System => LaunchdDomain::System,
    };
    let discovery = discover(ctx);
    let mut reasons = Vec::new();
    for service in discovery
        .services
        .iter()
        .filter(|service| service.domain == domain && service.label == HOMEBREW_CADDY_LABEL)
    {
        for reason in homebrew_violations(service, scope, ctx.uid) {
            push_unique(&mut reasons, reason);
        }
    }
    if reasons.is_empty() {
        Ok(())
    } else {
        Err(OwnershipError::LegacyHomebrewBlocked(reasons))
    }
}

/// [`check_homebrew_caddy`] against the real system.
pub fn check_homebrew_caddy_system(scope: HomebrewScope) -> Result<(), OwnershipError> {
    let _gate = acquire_gate()?;
    with_system(|ctx| check_homebrew_caddy(ctx, scope))
}

#[cfg(test)]
mod tests;
