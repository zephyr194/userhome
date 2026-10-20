//! Ownership over fixtures only: hand-built discovery records for the decision
//! matrix, and temporary directories with an injected runner for the paths that
//! rediscover. File owners come from the injected `uid`, so "another user's
//! file" is simulated by claiming a different current uid; no test touches a
//! real LaunchAgents directory or runs launchctl/plutil.

use std::{
    collections::HashMap,
    ffi::CString,
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use uuid::Uuid;

use super::*;
use crate::{
    error::AppErrorCode,
    services::launchd::{
        CommandRunner, ConfigPresence, Correlation, FileKind, LabelSource, LaunchdDirectory,
        LaunchdScope, Limits, LinkState, LinkTarget, LoadState, ParseStatus, ReadOnlyCommand,
        RunError, RunState, ScanLocations, ServiceIssue, Source, SourceStatus,
    },
};

const UID: u32 = 501;
const OTHER_UID: u32 = 502;
const CREATED: &str = "com.zephyr194.userhome.agent.demo";

// ---- decision matrix over hand-built records ----------------------------------

struct Adopted(Vec<(LaunchdDomain, String, String)>);

impl Adopted {
    fn of(domain: LaunchdDomain, label: &str, path: &str) -> Self {
        Self(vec![(domain, label.to_owned(), path.to_owned())])
    }
}

impl AdoptionRecords for Adopted {
    fn is_adopted(&self, domain: LaunchdDomain, label: &str, config_path: &str) -> bool {
        self.0
            .iter()
            .any(|(d, l, p)| *d == domain && l == label && p == config_path)
    }
}

fn file(directory: LaunchdDirectory, name: &str) -> ConfigFile {
    let (prefix, scope) = match directory {
        LaunchdDirectory::UserLaunchAgents => ("~/Library/LaunchAgents", LaunchdScope::UserAgent),
        LaunchdDirectory::GlobalLaunchAgents => {
            ("/Library/LaunchAgents", LaunchdScope::GlobalAgent)
        }
        LaunchdDirectory::GlobalLaunchDaemons => {
            ("/Library/LaunchDaemons", LaunchdScope::SystemDaemon)
        }
        LaunchdDirectory::AppleLaunchAgents => {
            ("/System/Library/LaunchAgents", LaunchdScope::AppleAgent)
        }
        LaunchdDirectory::AppleLaunchDaemons => {
            ("/System/Library/LaunchDaemons", LaunchdScope::AppleDaemon)
        }
    };
    ConfigFile {
        path: format!("{prefix}/{name}.plist"),
        directory,
        scope,
        is_apple_path: matches!(
            directory,
            LaunchdDirectory::AppleLaunchAgents | LaunchdDirectory::AppleLaunchDaemons
        ),
        owner_uid: Some(UID),
        kind: FileKind::Regular,
        link_target: None,
        parse_status: ParseStatus::Parsed,
        details: None,
    }
}

fn service(label: &str, files: Vec<ConfigFile>) -> LaunchdService {
    let domain = match files.first().map(|file| file.directory) {
        Some(LaunchdDirectory::GlobalLaunchDaemons | LaunchdDirectory::AppleLaunchDaemons) => {
            LaunchdDomain::System
        }
        _ => LaunchdDomain::Gui,
    };
    LaunchdService {
        id: format!("gui/{UID}/{label}"),
        label: label.to_owned(),
        label_source: LabelSource::Plist,
        domain,
        domain_target: if domain == LaunchdDomain::System {
            "system".to_owned()
        } else {
            format!("gui/{UID}")
        },
        scope: LaunchdScope::UserAgent,
        correlation: Correlation::Matched,
        load_state: LoadState::Loaded,
        run_state: RunState::NotRunning,
        pid: None,
        last_exit: None,
        config_presence: ConfigPresence::Found,
        config_files: files,
        issues: Vec::new(),
    }
}

fn user_service(label: &str) -> LaunchdService {
    service(label, vec![file(LaunchdDirectory::UserLaunchAgents, label)])
}

fn judge(service: &LaunchdService) -> OwnershipAssessment {
    assess(service, UID, &NoAdoptions, true)
}

fn assert_read_only(
    assessment: &OwnershipAssessment,
    ownership: Ownership,
    reason: ReadOnlyReason,
) {
    assert_eq!(assessment.ownership, ownership, "{assessment:?}");
    assert!(!assessment.modifiable, "{assessment:?}");
    assert!(
        assessment.read_only_reasons.contains(&reason),
        "missing {reason:?} in {assessment:?}"
    );
}

#[test]
fn the_namespace_is_fixed_and_shared() {
    assert_eq!(USERHOME_LABEL_NAMESPACE, "com.zephyr194.userhome.agent.");
    assert_eq!(HOMEBREW_CADDY_LABEL, "homebrew.mxcl.caddy");
}

#[test]
fn apple_labels_and_paths_are_always_read_only() {
    // A forged com.apple. label in the user's own directory, owned by the user.
    let forged = judge(&user_service("com.apple.forged"));
    assert_read_only(
        &forged,
        Ownership::AppleManaged,
        ReadOnlyReason::AppleManaged,
    );
    assert!(forged.evidence.contains(&Evidence::LabelAppleNamespace));

    // An Apple path with a label that does not look like Apple's.
    let path = judge(&service(
        "com.vendor.thing",
        vec![file(
            LaunchdDirectory::AppleLaunchAgents,
            "com.vendor.thing",
        )],
    ));
    assert_read_only(&path, Ownership::AppleManaged, ReadOnlyReason::AppleManaged);
    assert!(path.evidence.contains(&Evidence::ApplePath));

    // A loaded Apple job with no file is Apple too.
    let mut loaded = service("com.apple.metadata.mds", Vec::new());
    loaded.domain = LaunchdDomain::System;
    loaded.correlation = Correlation::LoadedOnly;
    assert_read_only(
        &judge(&loaded),
        Ownership::AppleManaged,
        ReadOnlyReason::AppleManaged,
    );

    // Adoption and the UserHome namespace cannot promote an Apple job.
    let adopted = Adopted::of(
        LaunchdDomain::Gui,
        "com.apple.forged",
        "~/Library/LaunchAgents/com.apple.forged.plist",
    );
    assert_read_only(
        &assess(&user_service("com.apple.forged"), UID, &adopted, true),
        Ownership::AppleManaged,
        ReadOnlyReason::AppleManaged,
    );
    let apple_in_namespace = format!("{USERHOME_LABEL_NAMESPACE}com.apple.x");
    assert!(judge(&user_service(&apple_in_namespace)).modifiable);
}

#[test]
fn system_daemons_and_global_agents_are_read_only() {
    let daemon = judge(&service(
        "com.vendor.daemon",
        vec![{
            let mut file = file(LaunchdDirectory::GlobalLaunchDaemons, "com.vendor.daemon");
            file.owner_uid = Some(0);
            file
        }],
    ));
    assert_read_only(
        &daemon,
        Ownership::SystemDaemon,
        ReadOnlyReason::SystemDaemonLocation,
    );
    assert!(daemon.evidence.contains(&Evidence::InGlobalLaunchDaemons));
    assert!(daemon.evidence.contains(&Evidence::DomainSystem));

    let mut loaded = service("com.vendor.unfiled", Vec::new());
    loaded.domain = LaunchdDomain::System;
    loaded.correlation = Correlation::LoadedOnly;
    assert_read_only(
        &judge(&loaded),
        Ownership::SystemDaemon,
        ReadOnlyReason::SystemDaemonLocation,
    );

    let agent = judge(&service(
        "com.vendor.agent",
        vec![file(
            LaunchdDirectory::GlobalLaunchAgents,
            "com.vendor.agent",
        )],
    ));
    assert_read_only(
        &agent,
        Ownership::GlobalAgent,
        ReadOnlyReason::GlobalAgentLocation,
    );
    assert!(agent.evidence.contains(&Evidence::InGlobalLaunchAgents));
}

#[test]
fn a_forged_namespace_outside_the_user_directory_never_makes_a_job_modifiable() {
    let label = CREATED;
    let in_global_agents = judge(&service(
        label,
        vec![file(LaunchdDirectory::GlobalLaunchAgents, label)],
    ));
    assert_read_only(
        &in_global_agents,
        Ownership::GlobalAgent,
        ReadOnlyReason::GlobalAgentLocation,
    );

    let in_daemons = judge(&service(
        label,
        vec![file(LaunchdDirectory::GlobalLaunchDaemons, label)],
    ));
    assert_read_only(
        &in_daemons,
        Ownership::SystemDaemon,
        ReadOnlyReason::SystemDaemonLocation,
    );

    for owner in [Some(0), Some(OTHER_UID), None] {
        let mut owned = user_service(label);
        owned.config_files[0].owner_uid = owner;
        let assessment = judge(&owned);
        assert_eq!(assessment.ownership, Ownership::ThirdParty, "{owner:?}");
        assert!(!assessment.modifiable);
        assert!(assessment.read_only_reasons.contains(&if owner.is_some() {
            ReadOnlyReason::OwnerNotCurrentUser
        } else {
            ReadOnlyReason::OwnerUnknown
        }));
        assert!(
            assessment
                .evidence
                .contains(&Evidence::LabelUserhomeNamespace)
        );
    }

    // Similar-looking prefixes and the bare namespace are not the namespace.
    for lookalike in [
        "com.zephyr194.userhome.agent.",
        "com.zephyr194.userhome.agentx.demo",
        "com.zephyr194.userhome.demo",
        "COM.ZEPHYR194.USERHOME.AGENT.demo",
        "x.com.zephyr194.userhome.agent.demo",
    ] {
        let assessment = judge(&user_service(lookalike));
        assert_eq!(
            assessment.ownership,
            Ownership::CurrentUserAgent,
            "{lookalike}"
        );
        assert!(!assessment.modifiable, "{lookalike}");
    }
}

#[test]
fn userhome_created_needs_namespace_location_owner_and_a_regular_file() {
    let created = judge(&user_service(CREATED));
    assert_eq!(created.ownership, Ownership::UserhomeCreated);
    assert!(created.modifiable);
    assert!(created.read_only_reasons.is_empty());
    assert!(created.evidence.contains(&Evidence::LabelUserhomeNamespace));
    assert!(created.evidence.contains(&Evidence::InUserLaunchAgents));
    assert!(created.evidence.contains(&Evidence::OwnerCurrentUser));
    assert!(created.evidence.contains(&Evidence::RegularFile));
}

#[test]
fn a_current_users_own_agent_is_read_only_until_adopted() {
    let agent = judge(&user_service("com.example.agent"));
    assert_read_only(
        &agent,
        Ownership::CurrentUserAgent,
        ReadOnlyReason::NotAdopted,
    );
    assert!(agent.evidence.contains(&Evidence::OwnerCurrentUser));
    assert!(agent.evidence.contains(&Evidence::InUserLaunchAgents));
}

#[test]
fn symbolic_links_and_other_owners_are_third_party_and_read_only() {
    for label in ["com.example.agent", CREATED] {
        let mut link = user_service(label);
        link.config_files[0].kind = FileKind::Link;
        link.config_files[0].parse_status = ParseStatus::LinkNotRead;
        link.config_files[0].link_target = Some(LinkTarget {
            state: LinkState::Inside,
            display: Some("~/Library/LaunchAgents/other.plist".to_owned()),
        });
        let inside = judge(&link);
        assert_read_only(&inside, Ownership::ThirdParty, ReadOnlyReason::SymbolicLink);
        assert!(inside.evidence.contains(&Evidence::SymbolicLink));

        link.config_files[0].link_target = Some(LinkTarget {
            state: LinkState::Outside,
            display: Some("~/dev/x.plist".to_owned()),
        });
        let outside = judge(&link);
        assert_read_only(
            &outside,
            Ownership::ThirdParty,
            ReadOnlyReason::SymbolicLink,
        );
        assert!(
            outside
                .read_only_reasons
                .contains(&ReadOnlyReason::LinkTargetOutside)
        );

        let mut other = user_service(label);
        other.config_files[0].owner_uid = Some(OTHER_UID);
        assert_read_only(
            &judge(&other),
            Ownership::ThirdParty,
            ReadOnlyReason::OwnerNotCurrentUser,
        );
        let mut root = user_service(label);
        root.config_files[0].owner_uid = Some(0);
        let root = judge(&root);
        assert_read_only(
            &root,
            Ownership::ThirdParty,
            ReadOnlyReason::OwnerNotCurrentUser,
        );
        assert!(root.evidence.contains(&Evidence::OwnerOtherUser));
    }
}

#[test]
fn unparsed_unmatched_or_inconsistent_definitions_are_read_only() {
    let mut failed = user_service(CREATED);
    failed.config_files[0].parse_status = ParseStatus::ConvertFailed;
    failed.label_source = LabelSource::FileName;
    failed.correlation = Correlation::UnmatchedFile;
    assert_read_only(
        &judge(&failed),
        Ownership::ThirdParty,
        ReadOnlyReason::PlistNotParsed,
    );

    let mut mismatch = user_service(CREATED);
    mismatch.issues = vec![ServiceIssue::LabelFilenameMismatch];
    assert_read_only(
        &judge(&mismatch),
        Ownership::ThirdParty,
        ReadOnlyReason::LabelFilenameMismatch,
    );

    let mut named_by_file = user_service(CREATED);
    named_by_file.label_source = LabelSource::FileName;
    assert_read_only(
        &judge(&named_by_file),
        Ownership::ThirdParty,
        ReadOnlyReason::LabelNotFromPlist,
    );

    let mut twice = user_service(CREATED);
    twice
        .config_files
        .push(file(LaunchdDirectory::UserLaunchAgents, "another"));
    assert_read_only(
        &judge(&twice),
        Ownership::ThirdParty,
        ReadOnlyReason::DuplicateDefinition,
    );

    // The same label also defined in a global directory: the stricter location wins.
    let mut also_global = user_service(CREATED);
    also_global
        .config_files
        .push(file(LaunchdDirectory::GlobalLaunchAgents, CREATED));
    assert_read_only(
        &judge(&also_global),
        Ownership::GlobalAgent,
        ReadOnlyReason::GlobalAgentLocation,
    );

    // A loaded job with no file in the user session cannot be attributed.
    let mut loaded = service("com.example.loaded", Vec::new());
    loaded.correlation = Correlation::LoadedOnly;
    assert_read_only(
        &judge(&loaded),
        Ownership::ThirdParty,
        ReadOnlyReason::NoConfigFile,
    );
}

#[test]
fn an_adoption_record_makes_only_a_verified_user_agent_modifiable() {
    let path = "~/Library/LaunchAgents/com.example.agent.plist";
    let record = Adopted::of(LaunchdDomain::Gui, "com.example.agent", path);

    let adopted = assess(&user_service("com.example.agent"), UID, &record, true);
    assert_eq!(adopted.ownership, Ownership::UserhomeAdopted);
    assert!(adopted.modifiable);
    assert!(adopted.evidence.contains(&Evidence::AdoptionRecord));

    // A record does not outlive a failed check of the file itself.
    let mut other = user_service("com.example.agent");
    other.config_files[0].owner_uid = Some(OTHER_UID);
    assert_read_only(
        &assess(&other, UID, &record, true),
        Ownership::ThirdParty,
        ReadOnlyReason::OwnerNotCurrentUser,
    );
    let mut link = user_service("com.example.agent");
    link.config_files[0].kind = FileKind::Link;
    assert_read_only(
        &assess(&link, UID, &record, true),
        Ownership::ThirdParty,
        ReadOnlyReason::SymbolicLink,
    );

    // A record for another path or another domain does not match.
    let elsewhere = Adopted::of(
        LaunchdDomain::Gui,
        "com.example.agent",
        "~/Library/LaunchAgents/x.plist",
    );
    assert_read_only(
        &assess(&user_service("com.example.agent"), UID, &elsewhere, true),
        Ownership::CurrentUserAgent,
        ReadOnlyReason::NotAdopted,
    );
    let system_record = Adopted::of(LaunchdDomain::System, "com.example.agent", path);
    assert!(
        !assess(
            &user_service("com.example.agent"),
            UID,
            &system_record,
            true
        )
        .modifiable
    );

    // Records never promote a global agent or a system daemon.
    let global = service(
        "com.example.agent",
        vec![file(
            LaunchdDirectory::GlobalLaunchAgents,
            "com.example.agent",
        )],
    );
    let global_record = Adopted::of(
        LaunchdDomain::Gui,
        "com.example.agent",
        "/Library/LaunchAgents/com.example.agent.plist",
    );
    assert_read_only(
        &assess(&global, UID, &global_record, true),
        Ownership::GlobalAgent,
        ReadOnlyReason::GlobalAgentLocation,
    );
}

#[test]
fn an_untrusted_discovery_keeps_the_class_but_denies_modification() {
    let created = assess(&user_service(CREATED), UID, &NoAdoptions, false);
    assert_eq!(created.ownership, Ownership::UserhomeCreated);
    assert!(!created.modifiable);
    assert_eq!(
        created.read_only_reasons,
        vec![ReadOnlyReason::DiscoveryIncomplete]
    );
}

#[test]
fn modifiable_is_exactly_the_absence_of_reasons() {
    let mut cases = vec![
        user_service(CREATED),
        user_service("com.example.agent"),
        user_service("com.apple.x"),
        service("g", vec![file(LaunchdDirectory::GlobalLaunchAgents, "g")]),
        service("d", vec![file(LaunchdDirectory::GlobalLaunchDaemons, "d")]),
        service("a", vec![file(LaunchdDirectory::AppleLaunchDaemons, "a")]),
        service("none", Vec::new()),
    ];
    let mut odd = user_service(CREATED);
    odd.config_files[0].owner_uid = None;
    cases.push(odd);
    for case in &cases {
        for trusted in [true, false] {
            let assessment = assess(case, UID, &NoAdoptions, trusted);
            assert_eq!(
                assessment.modifiable,
                assessment.read_only_reasons.is_empty(),
                "{case:?}"
            );
            assert!(!assessment.evidence.is_empty(), "{case:?}");
        }
    }
}

#[test]
fn attaching_ownership_keeps_the_discovery_and_judges_every_service() {
    let discovery = LaunchdDiscovery {
        services: vec![user_service(CREATED), user_service("com.apple.x")],
        sources: Vec::new(),
        complete: true,
        truncated: false,
    };
    // No sources reported: nothing proves the directories were read, so nothing is modifiable.
    let owned = attach_ownership(discovery.clone(), UID, &NoAdoptions);
    assert_eq!(owned.services.len(), 2);
    assert!(
        owned
            .services
            .iter()
            .all(|owned| !owned.ownership.modifiable)
    );
    assert_eq!(owned.complete, discovery.complete);

    let json = serde_json::to_value(&owned).expect("serialize");
    let first = &json["services"][0];
    assert_eq!(first["label"], CREATED, "service fields stay flat");
    assert_eq!(first["ownership"]["ownership"], "USERHOME_CREATED");
    assert_eq!(first["ownership"]["modifiable"], false);
    assert!(first["ownership"]["readOnlyReasons"].is_array());
    assert!(first["ownership"]["evidence"].is_array());
}

// ---- rediscovering paths over temporary directories ---------------------------

struct Fixture {
    root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-ownership-{}", Uuid::new_v4()));
        for name in [
            "home/Library/LaunchAgents",
            "Library/LaunchAgents",
            "Library/LaunchDaemons",
            "System/Library/LaunchAgents",
            "System/Library/LaunchDaemons",
        ] {
            fs::create_dir_all(root.join(name)).expect("create directory");
        }
        Self { root }
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn locations(&self) -> ScanLocations {
        ScanLocations {
            user_agents: Some(self.root.join("home/Library/LaunchAgents")),
            global_agents: self.root.join("Library/LaunchAgents"),
            global_daemons: self.root.join("Library/LaunchDaemons"),
            apple_agents: self.root.join("System/Library/LaunchAgents"),
            apple_daemons: self.root.join("System/Library/LaunchDaemons"),
        }
    }

    fn user(&self, name: &str) -> PathBuf {
        self.root.join("home/Library/LaunchAgents").join(name)
    }

    fn global_agent(&self, name: &str) -> PathBuf {
        self.root.join("Library/LaunchAgents").join(name)
    }

    fn daemon(&self, name: &str) -> PathBuf {
        self.root.join("Library/LaunchDaemons").join(name)
    }

    fn apple_agent(&self, name: &str) -> PathBuf {
        self.root.join("System/Library/LaunchAgents").join(name)
    }

    fn write(path: &Path) {
        fs::write(path, b"bplist00 placeholder").expect("write plist");
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::set_permissions(
            self.root.join("Library/LaunchAgents"),
            fs::Permissions::from_mode(0o755),
        );
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct Runner {
    list: String,
    system: String,
    plists: HashMap<String, String>,
}

impl Runner {
    fn new() -> Self {
        Self {
            list: "PID\tStatus\tLabel\n".to_owned(),
            system: "system = {\n\tservices = {\n\t}\n}\n".to_owned(),
            plists: HashMap::new(),
        }
    }

    fn loaded(mut self, label: &str) -> Self {
        self.list.push_str(&format!("-\t0\t{label}\n"));
        self
    }

    fn system_loaded(mut self, label: &str) -> Self {
        self.system = format!(
            "system = {{\n\tservices = {{\n\t\tPID\tStatus\tLabel\n\t\t-\t0\t{label}\n\t}}\n}}\n"
        );
        self
    }

    fn labelled(mut self, file_name: &str, label: &str) -> Self {
        self.plists.insert(
            file_name.to_owned(),
            format!(r#"{{"Label":"{label}","ProgramArguments":["/usr/bin/true"]}}"#),
        );
        self
    }
}

impl CommandRunner for Runner {
    fn tool_available(&self, _: &str) -> bool {
        true
    }

    fn run(&self, command: &ReadOnlyCommand) -> Result<String, RunError> {
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        match (command.executable(), args.as_slice()) {
            ("/bin/launchctl", ["list"]) => Ok(self.list.clone()),
            ("/bin/launchctl", ["print", "system"]) => Ok(self.system.clone()),
            ("/usr/bin/plutil", [.., path]) => {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .expect("file name");
                self.plists.get(name).cloned().ok_or(RunError::Failed)
            }
            other => panic!("unexpected command {other:?}"),
        }
    }
}

/// The uid the fixture files really have: the owner of everything created here.
fn real_uid() -> u32 {
    // SAFETY: getuid takes no arguments and cannot fail.
    unsafe { libc::getuid() }
}

fn context<'a>(fixture: &Fixture, runner: &'a Runner, uid: u32) -> Discovery<'a> {
    Discovery {
        uid,
        home: Some(fixture.home()),
        locations: fixture.locations(),
        runner,
        limits: Limits::default(),
    }
}

fn request(domain: LaunchdDomain, label: &str) -> ServiceRequest {
    ServiceRequest {
        domain,
        label: label.to_owned(),
    }
}

fn gui(label: &str) -> ServiceRequest {
    request(LaunchdDomain::Gui, label)
}

fn created_fixture() -> (Fixture, Runner) {
    let fixture = Fixture::new();
    let name = format!("{CREATED}.plist");
    Fixture::write(&fixture.user(&name));
    let runner = Runner::new().labelled(&name, CREATED);
    (fixture, runner)
}

fn expect_read_only(result: Result<ModifiableTarget, OwnershipError>) -> OwnershipAssessment {
    match result {
        Err(OwnershipError::ReadOnly(assessment)) => assessment,
        other => panic!("expected ReadOnly, got {other:?}"),
    }
}

#[test]
fn a_created_job_resolves_to_a_path_found_by_the_backend() {
    let (fixture, runner) = created_fixture();
    let ctx = context(&fixture, &runner, real_uid());

    let target = ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)).expect("modifiable");

    assert_eq!(target.label, CREATED);
    assert_eq!(target.domain, LaunchdDomain::Gui);
    assert_eq!(target.domain_target, format!("gui/{}", real_uid()));
    assert_eq!(target.ownership, Ownership::UserhomeCreated);
    assert_eq!(
        target.config_path,
        fixture.user(&format!("{CREATED}.plist"))
    );
}

#[test]
fn forged_domains_labels_and_paths_are_rejected() {
    let (fixture, runner) = created_fixture();
    let ctx = context(&fixture, &runner, real_uid());

    // Wrong domain for a real label; unknown label; labels that cannot be labels.
    assert_eq!(
        ensure_modifiable(&ctx, &NoAdoptions, &request(LaunchdDomain::System, CREATED)),
        Err(OwnershipError::NotFound)
    );
    assert_eq!(
        ensure_modifiable(&ctx, &NoAdoptions, &gui(&format!("{CREATED}2"))),
        Err(OwnershipError::NotFound)
    );
    for bad in [
        "",
        "-x",
        "../x",
        "a/b",
        "a b",
        "a\nb",
        &format!("../../etc/{CREATED}"),
        &"x".repeat(300),
    ] {
        assert_eq!(
            ensure_modifiable(&ctx, &NoAdoptions, &gui(bad)),
            Err(OwnershipError::InvalidLabel),
            "{bad:?}"
        );
    }

    // The request has no field for a path, an ownership claim or a file kind.
    for forged in [
        r#"{"domain":"GUI","label":"x","path":"/etc/passwd"}"#,
        r#"{"domain":"GUI","label":"x","ownership":"USERHOME_CREATED"}"#,
        r#"{"domain":"GUI","label":"x","modifiable":true}"#,
        r#"{"domain":"gui/501","label":"x"}"#,
        r#"{"domain":"GUI"}"#,
    ] {
        assert!(
            serde_json::from_str::<ServiceRequest>(forged).is_err(),
            "{forged}"
        );
    }
    assert!(
        serde_json::from_str::<ServiceRequest>(&format!(
            r#"{{"domain":"GUI","label":"{CREATED}"}}"#
        ))
        .is_ok()
    );
}

#[test]
fn a_forged_apple_label_in_the_user_directory_is_rejected() {
    let fixture = Fixture::new();
    Fixture::write(&fixture.user("com.apple.forged.plist"));
    let runner = Runner::new().labelled("com.apple.forged.plist", "com.apple.forged");
    let ctx = context(&fixture, &runner, real_uid());

    let assessment = expect_read_only(ensure_modifiable(
        &ctx,
        &NoAdoptions,
        &gui("com.apple.forged"),
    ));
    assert_eq!(assessment.ownership, Ownership::AppleManaged);
}

#[test]
fn loaded_system_and_apple_jobs_are_rejected_in_the_system_domain() {
    let fixture = Fixture::new();
    Fixture::write(&fixture.daemon("com.vendor.daemon.plist"));
    let runner = Runner::new()
        .labelled("com.vendor.daemon.plist", "com.vendor.daemon")
        .system_loaded("com.apple.metadata.mds");
    let ctx = context(&fixture, &runner, real_uid());

    let daemon = expect_read_only(ensure_modifiable(
        &ctx,
        &NoAdoptions,
        &request(LaunchdDomain::System, "com.vendor.daemon"),
    ));
    assert_eq!(daemon.ownership, Ownership::SystemDaemon);
    let apple = expect_read_only(ensure_modifiable(
        &ctx,
        &NoAdoptions,
        &request(LaunchdDomain::System, "com.apple.metadata.mds"),
    ));
    assert_eq!(apple.ownership, Ownership::AppleManaged);
}

#[test]
fn a_global_copy_of_a_created_label_is_rejected() {
    let (fixture, runner) = created_fixture();
    let name = format!("{CREATED}.plist");
    Fixture::write(&fixture.global_agent(&name));
    let ctx = context(&fixture, &runner, real_uid());

    let assessment = expect_read_only(ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)));
    assert_eq!(assessment.ownership, Ownership::GlobalAgent);
}

#[test]
fn a_symbolic_link_with_a_created_label_is_rejected_even_if_it_points_inside() {
    let fixture = Fixture::new();
    let name = format!("{CREATED}.plist");
    let target = fixture.user("real.plist");
    Fixture::write(&target);
    symlink(&target, fixture.user(&name)).expect("symlink");
    let runner = Runner::new()
        .loaded(CREATED)
        .labelled("real.plist", CREATED);
    let ctx = context(&fixture, &runner, real_uid());

    let assessment = expect_read_only(ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)));
    assert!(
        assessment
            .read_only_reasons
            .contains(&ReadOnlyReason::SymbolicLink)
    );
    assert!(!assessment.modifiable);
}

#[test]
fn a_link_leaving_the_home_directory_is_rejected() {
    let fixture = Fixture::new();
    let name = format!("{CREATED}.plist");
    let outside = fixture.root.join("elsewhere.plist");
    Fixture::write(&outside);
    symlink(&outside, fixture.user(&name)).expect("symlink");
    let runner = Runner::new();
    let ctx = context(&fixture, &runner, real_uid());

    let assessment = expect_read_only(ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)));
    assert!(
        assessment
            .read_only_reasons
            .contains(&ReadOnlyReason::LinkTargetOutside)
    );
}

#[test]
fn a_special_file_is_never_discovered_so_it_cannot_be_modified() {
    let fixture = Fixture::new();
    let name = format!("{CREATED}.plist");
    let path = CString::new(fixture.user(&name).to_string_lossy().as_bytes()).expect("path");
    // SAFETY: path is a valid NUL-terminated string.
    assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    let runner = Runner::new();
    let ctx = context(&fixture, &runner, real_uid());

    assert_eq!(
        ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)),
        Err(OwnershipError::NotFound)
    );
}

#[test]
fn a_file_owned_by_someone_else_is_rejected() {
    let (fixture, runner) = created_fixture();
    // The files belong to the real uid; the current user is claimed to be another.
    let ctx = context(&fixture, &runner, real_uid().wrapping_add(1));

    let assessment = expect_read_only(ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)));
    assert_eq!(assessment.ownership, Ownership::ThirdParty);
    assert!(
        assessment
            .read_only_reasons
            .contains(&ReadOnlyReason::OwnerNotCurrentUser)
    );
}

#[test]
fn an_unparsed_plist_is_rejected() {
    let fixture = Fixture::new();
    let name = format!("{CREATED}.plist");
    Fixture::write(&fixture.user(&name));
    let runner = Runner::new(); // plutil fails for every file
    let ctx = context(&fixture, &runner, real_uid());

    let assessment = expect_read_only(ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)));
    assert!(
        assessment
            .read_only_reasons
            .contains(&ReadOnlyReason::PlistNotParsed)
    );
}

#[test]
fn an_incomplete_discovery_denies_modification() {
    if real_uid() == 0 {
        return; // root can read a directory with no permissions
    }
    let (fixture, runner) = created_fixture();
    let ctx = context(&fixture, &runner, real_uid());
    assert!(ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)).is_ok());

    // A global directory that cannot be read could hold a second definition of
    // the label, so the user's file is no longer provably the only one.
    fs::set_permissions(
        fixture.root.join("Library/LaunchAgents"),
        fs::Permissions::from_mode(0o000),
    )
    .expect("restrict directory");
    let discovery = crate::services::launchd::discover(&ctx);
    let report = discovery
        .sources
        .iter()
        .find(|report| report.source == Source::GlobalLaunchAgents)
        .expect("source");
    assert_eq!(report.status, SourceStatus::Inaccessible);

    let assessment = expect_read_only(ensure_modifiable(&ctx, &NoAdoptions, &gui(CREATED)));
    assert_eq!(assessment.ownership, Ownership::UserhomeCreated);
    assert_eq!(
        assessment.read_only_reasons,
        vec![ReadOnlyReason::DiscoveryIncomplete]
    );
}

#[test]
fn an_adopted_fixture_record_is_honoured_only_after_the_file_is_verified() {
    let fixture = Fixture::new();
    Fixture::write(&fixture.user("com.example.agent.plist"));
    let runner = Runner::new().labelled("com.example.agent.plist", "com.example.agent");
    let record = Adopted::of(
        LaunchdDomain::Gui,
        "com.example.agent",
        "~/Library/LaunchAgents/com.example.agent.plist",
    );

    // Without a record the user's own agent is read-only.
    let ctx = context(&fixture, &runner, real_uid());
    let plain = expect_read_only(ensure_modifiable(
        &ctx,
        &NoAdoptions,
        &gui("com.example.agent"),
    ));
    assert_eq!(plain.ownership, Ownership::CurrentUserAgent);

    let target =
        ensure_modifiable(&ctx, &record, &gui("com.example.agent")).expect("adopted is modifiable");
    assert_eq!(target.ownership, Ownership::UserhomeAdopted);

    // The record is no help when the owner is someone else.
    let foreign = context(&fixture, &runner, real_uid().wrapping_add(1));
    let rejected = expect_read_only(ensure_modifiable(
        &foreign,
        &record,
        &gui("com.example.agent"),
    ));
    assert_eq!(rejected.ownership, Ownership::ThirdParty);
}

#[test]
fn errors_map_to_distinguishable_app_errors() {
    let read_only = AppError::from(OwnershipError::ReadOnly(OwnershipAssessment {
        ownership: Ownership::AppleManaged,
        modifiable: false,
        read_only_reasons: vec![ReadOnlyReason::AppleManaged],
        evidence: vec![Evidence::LabelAppleNamespace],
    }));
    assert_eq!(read_only.code(), AppErrorCode::PermissionDenied);
    assert!(!read_only.retryable());
    assert_eq!(
        AppError::from(OwnershipError::NotFound).code(),
        AppErrorCode::NotFound
    );
    assert_eq!(
        AppError::from(OwnershipError::InvalidLabel).code(),
        AppErrorCode::InvalidInput
    );
    assert_eq!(
        AppError::from(OwnershipError::DiscoveryBusy).code(),
        AppErrorCode::Conflict
    );
    let legacy = AppError::from(OwnershipError::LegacyHomebrewBlocked(vec![
        ReadOnlyReason::SymbolicLink,
    ]));
    assert_eq!(legacy.code(), AppErrorCode::PermissionDenied);
    assert_ne!(legacy, read_only);
}

// ---- the legacy Homebrew Caddy path --------------------------------------------

fn brew(directory: LaunchdDirectory) -> LaunchdService {
    let mut service = service(
        HOMEBREW_CADDY_LABEL,
        vec![file(directory, HOMEBREW_CADDY_LABEL)],
    );
    if matches!(
        directory,
        LaunchdDirectory::GlobalLaunchDaemons | LaunchdDirectory::AppleLaunchDaemons
    ) {
        service.domain = LaunchdDomain::System;
        service.config_files[0].owner_uid = Some(0);
    }
    service
}

#[test]
fn homebrew_caddy_keeps_its_existing_paths() {
    assert!(
        homebrew_violations(
            &brew(LaunchdDirectory::UserLaunchAgents),
            HomebrewScope::User,
            UID
        )
        .is_empty()
    );
    assert!(
        homebrew_violations(
            &brew(LaunchdDirectory::GlobalLaunchDaemons),
            HomebrewScope::System,
            UID
        )
        .is_empty()
    );
    // Loaded without any file: nothing contradicts the legacy path.
    let mut loaded = service(HOMEBREW_CADDY_LABEL, Vec::new());
    loaded.correlation = Correlation::LoadedOnly;
    assert!(homebrew_violations(&loaded, HomebrewScope::User, UID).is_empty());
}

#[test]
fn homebrew_caddy_is_refused_on_apple_foreign_link_and_unapproved_evidence() {
    let reasons = |service: &LaunchdService, scope| homebrew_violations(service, scope, UID);

    let apple = brew(LaunchdDirectory::AppleLaunchAgents);
    assert!(reasons(&apple, HomebrewScope::User).contains(&ReadOnlyReason::AppleManaged));

    let mut other = brew(LaunchdDirectory::UserLaunchAgents);
    other.config_files[0].owner_uid = Some(OTHER_UID);
    assert!(reasons(&other, HomebrewScope::User).contains(&ReadOnlyReason::OwnerNotCurrentUser));
    other.config_files[0].owner_uid = None;
    assert!(reasons(&other, HomebrewScope::User).contains(&ReadOnlyReason::OwnerUnknown));

    let mut link = brew(LaunchdDirectory::UserLaunchAgents);
    link.config_files[0].kind = FileKind::Link;
    link.config_files[0].link_target = Some(LinkTarget {
        state: LinkState::Outside,
        display: None,
    });
    let found = reasons(&link, HomebrewScope::User);
    assert!(found.contains(&ReadOnlyReason::SymbolicLink));
    assert!(found.contains(&ReadOnlyReason::LinkTargetOutside));

    // A user-level request cannot ride on a system-level file, or the reverse.
    let global_agent = brew(LaunchdDirectory::GlobalLaunchAgents);
    assert!(
        reasons(&global_agent, HomebrewScope::User).contains(&ReadOnlyReason::UnapprovedLocation)
    );
    let user_file = brew(LaunchdDirectory::UserLaunchAgents);
    assert!(
        reasons(&user_file, HomebrewScope::System).contains(&ReadOnlyReason::UnapprovedLocation)
    );

    // A system daemon file must be root's; a user's file there is refused.
    let mut daemon = brew(LaunchdDirectory::GlobalLaunchDaemons);
    daemon.config_files[0].owner_uid = Some(UID);
    assert!(reasons(&daemon, HomebrewScope::System).contains(&ReadOnlyReason::OwnerNotCurrentUser));

    let mut twice = brew(LaunchdDirectory::UserLaunchAgents);
    twice.config_files.push(file(
        LaunchdDirectory::UserLaunchAgents,
        "homebrew.mxcl.caddy-copy",
    ));
    assert!(reasons(&twice, HomebrewScope::User).contains(&ReadOnlyReason::DuplicateDefinition));
}

#[test]
fn homebrew_gate_rediscovers_and_stays_silent_without_launchd_evidence() {
    let fixture = Fixture::new();
    let runner = Runner::new();
    let ctx = context(&fixture, &runner, real_uid());
    assert_eq!(check_homebrew_caddy(&ctx, HomebrewScope::User), Ok(()));
    assert_eq!(check_homebrew_caddy(&ctx, HomebrewScope::System), Ok(()));

    let name = "homebrew.mxcl.caddy.plist";
    Fixture::write(&fixture.user(name));
    let runner = Runner::new().labelled(name, HOMEBREW_CADDY_LABEL);
    let ctx = context(&fixture, &runner, real_uid());
    assert_eq!(check_homebrew_caddy(&ctx, HomebrewScope::User), Ok(()));
    // The exception does not leak: the same job is read-only for modification.
    let assessment = expect_read_only(ensure_modifiable(
        &ctx,
        &NoAdoptions,
        &gui(HOMEBREW_CADDY_LABEL),
    ));
    assert_eq!(assessment.ownership, Ownership::CurrentUserAgent);
}

#[test]
fn homebrew_gate_refuses_links_foreign_owners_and_apple_paths() {
    // Another owner.
    let fixture = Fixture::new();
    let name = "homebrew.mxcl.caddy.plist";
    Fixture::write(&fixture.user(name));
    let runner = Runner::new().labelled(name, HOMEBREW_CADDY_LABEL);
    let foreign = context(&fixture, &runner, real_uid().wrapping_add(1));
    assert!(matches!(
        check_homebrew_caddy(&foreign, HomebrewScope::User),
        Err(OwnershipError::LegacyHomebrewBlocked(reasons))
            if reasons.contains(&ReadOnlyReason::OwnerNotCurrentUser)
    ));

    // A link, whose content is never read, still counts as a definition of the label.
    let linked = Fixture::new();
    let outside = linked.root.join("elsewhere.plist");
    Fixture::write(&outside);
    symlink(&outside, linked.user(name)).expect("symlink");
    let runner = Runner::new();
    let ctx = context(&linked, &runner, real_uid());
    assert!(matches!(
        check_homebrew_caddy(&ctx, HomebrewScope::User),
        Err(OwnershipError::LegacyHomebrewBlocked(reasons))
            if reasons.contains(&ReadOnlyReason::SymbolicLink)
    ));

    // An Apple path claiming the label.
    let apple = Fixture::new();
    Fixture::write(&apple.apple_agent(name));
    let runner = Runner::new().labelled(name, HOMEBREW_CADDY_LABEL);
    let ctx = context(&apple, &runner, real_uid());
    assert!(matches!(
        check_homebrew_caddy(&ctx, HomebrewScope::User),
        Err(OwnershipError::LegacyHomebrewBlocked(reasons))
            if reasons.contains(&ReadOnlyReason::AppleManaged)
    ));
}

#[test]
fn the_homebrew_exception_cannot_be_used_for_any_other_job() {
    // Hostile evidence about other labels never changes the Caddy verdict, and
    // the gate accepts no label, so it cannot be pointed at another job.
    let fixture = Fixture::new();
    let name = "homebrew.mxcl.caddy.plist";
    Fixture::write(&fixture.user(name));
    Fixture::write(&fixture.user("homebrew.mxcl.other.plist"));
    Fixture::write(&fixture.apple_agent("com.apple.x.plist"));
    symlink(
        fixture.user("homebrew.mxcl.other.plist"),
        fixture.user("homebrew.mxcl.linked.plist"),
    )
    .expect("symlink");
    let runner = Runner::new()
        .labelled(name, HOMEBREW_CADDY_LABEL)
        .labelled("homebrew.mxcl.other.plist", "homebrew.mxcl.other")
        .labelled("com.apple.x.plist", "com.apple.x");
    let ctx = context(&fixture, &runner, real_uid());
    assert_eq!(check_homebrew_caddy(&ctx, HomebrewScope::User), Ok(()));

    // Other Homebrew jobs and forged requests get no exception from modification.
    for label in ["homebrew.mxcl.other", "homebrew.mxcl.linked", "com.apple.x"] {
        assert!(
            ensure_modifiable(&ctx, &NoAdoptions, &gui(label)).is_err(),
            "{label}"
        );
    }
}

#[test]
fn the_legacy_homebrew_commands_are_gated_and_no_command_mutates_launchd() {
    let commands = include_str!("../../commands/services.rs");
    let preview = commands
        .split("pub async fn preview_service_action")
        .nth(1)
        .and_then(|rest| rest.split("pub async fn execute_service_action").next())
        .expect("preview command");
    let execute = commands
        .split("pub async fn execute_service_action")
        .nth(1)
        .and_then(|rest| rest.split("fn homebrew_scope").next())
        .expect("execute command");
    // The gate runs before anything is recorded or executed.
    let gate = "ensure_launchd_definition_allows(";
    assert!(preview.find(gate) < preview.find("operations.preview("));
    assert!(preview.contains(gate));
    assert!(execute.find(gate) < execute.find("authorize_mutation"));
    assert!(execute.contains(gate));

    // The launchd list command takes no argument and returns the judged result.
    assert!(commands.contains("pub async fn list_launchd_services() -> Result<OwnedDiscovery"));
    // The gate itself accepts only a scope, never a label or a path.
    assert!(commands.contains("async fn ensure_launchd_definition_allows(scope: HomebrewScope)"));
}
