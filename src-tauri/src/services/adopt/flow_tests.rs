//! Adoption and structured edit over fixtures only: temporary directories for
//! the job files, the record store and the backups, a fake read-only runner for
//! discovery, and a fake host for executable and log facts. Nothing touches a
//! real LaunchAgents directory, runs launchctl or plutil, or starts a job.

use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

use uuid::Uuid;

use super::{
    edit::EditRequest,
    flow::{AdoptCoordinator, EditPreview},
    store::{AdoptionRecord, AdoptionStore},
};
use crate::{
    config::ConfigEnvironment,
    error::AppErrorCode,
    grants::{
        GrantCoordinator, GrantPurpose, GrantStore, ResourceWriteContext, ResourceWriteCoordinator,
    },
    operations::OperationCoordinator,
    services::{
        create::{ExecutableFacts, FactsError, HostFacts},
        launchd::{
            CommandRunner, Discovery, LaunchdDomain, Limits, ReadOnlyCommand, RunError,
            ScanLocations,
        },
        ownership::{AdoptionRecords, Ownership, ServiceRequest, ensure_modifiable},
    },
    settings::BackupRetention,
};

const LABEL: &str = "com.example.adopted";
const SECRET: &str = "s3cret-value-123";

struct Facts;

impl HostFacts for Facts {
    fn inspect_executable(&self, path: &Path) -> Result<ExecutableFacts, FactsError> {
        Ok(ExecutableFacts {
            resolved: path.to_path_buf(),
            regular_file: true,
            user_executable: true,
            others_writable: false,
        })
    }

    fn resolve_directory(&self, path: &Path) -> Option<PathBuf> {
        Some(path.to_path_buf())
    }
}

struct Runner {
    plists: HashMap<String, String>,
}

impl Runner {
    fn for_plists(labels: &[&str]) -> Self {
        let plists = labels
            .iter()
            .map(|label| {
                (
                    file_name(label),
                    format!(r#"{{"Label":"{label}","ProgramArguments":["/usr/bin/true"]}}"#),
                )
            })
            .collect();
        Self { plists }
    }

    fn for_plist(label: &str) -> Self {
        Self::for_plists(&[label])
    }
}

impl CommandRunner for Runner {
    fn tool_available(&self, _: &str) -> bool {
        true
    }

    fn run(&self, command: &ReadOnlyCommand) -> Result<String, RunError> {
        let args: Vec<&str> = command.args().iter().map(String::as_str).collect();
        match (command.executable(), args.as_slice()) {
            ("/bin/launchctl", ["list"]) => Ok("PID\tStatus\tLabel\n".to_owned()),
            ("/bin/launchctl", ["print", "system"]) => {
                Ok("system = {\n\tservices = {\n\t}\n}\n".to_owned())
            }
            ("/usr/bin/plutil", [.., path]) => {
                let name = Path::new(path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or_default();
                self.plists.get(name).cloned().ok_or(RunError::Failed)
            }
            _ => Err(RunError::Failed),
        }
    }
}

fn file_name(label: &str) -> String {
    format!("{label}.plist")
}

fn real_uid() -> u32 {
    // SAFETY: getuid takes no arguments and cannot fail.
    unsafe { libc::getuid() }
}

fn plist_xml(label: &str, extra: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\
         <key>Label</key><string>{label}</string>\
         <key>ProgramArguments</key><array><string>/usr/bin/true</string></array>\
         <key>RunAtLoad</key><true/>{extra}</dict></plist>\n"
    )
}

fn gui(label: &str) -> ServiceRequest {
    ServiceRequest {
        domain: LaunchdDomain::Gui,
        label: label.to_owned(),
    }
}

fn edit(label: &str) -> EditRequest {
    EditRequest {
        domain: LaunchdDomain::Gui,
        label: label.to_owned(),
        executable: None,
        arguments: None,
        working_directory: None,
        environment_set: BTreeMap::new(),
        environment_remove: Vec::new(),
        stdout_path: None,
        stderr_path: None,
        run_at_load: None,
        keep_alive: None,
    }
}

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    agents: PathBuf,
    environment: ConfigEnvironment,
    grants: GrantCoordinator,
    operations: OperationCoordinator,
    writes: ResourceWriteCoordinator,
    adoption: AdoptCoordinator,
    store: AdoptionStore,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-adopt-flow-{}", Uuid::new_v4()));
        let home = root.join("home");
        let agents = home.join("Library").join("LaunchAgents");
        for directory in [
            agents.clone(),
            root.join("Library").join("LaunchAgents"),
            root.join("Library").join("LaunchDaemons"),
            root.join("System").join("Library").join("LaunchAgents"),
            root.join("System").join("Library").join("LaunchDaemons"),
            root.join("logs"),
        ] {
            fs::create_dir_all(directory).expect("create directory");
        }
        let environment =
            ConfigEnvironment::new(home.clone(), root.join("brew"), home.join("backups"));
        let grants =
            GrantCoordinator::new(GrantStore::new(root.join("support")), Some(home.clone()));
        let store = AdoptionStore::new(&root.join("app"));
        Self {
            root,
            home,
            agents,
            environment,
            grants,
            operations: OperationCoordinator::default(),
            writes: ResourceWriteCoordinator::default(),
            adoption: AdoptCoordinator::default(),
            store,
        }
    }

    fn locations(&self) -> ScanLocations {
        ScanLocations {
            user_agents: Some(self.agents.clone()),
            global_agents: self.root.join("Library").join("LaunchAgents"),
            global_daemons: self.root.join("Library").join("LaunchDaemons"),
            apple_agents: self
                .root
                .join("System")
                .join("Library")
                .join("LaunchAgents"),
            apple_daemons: self
                .root
                .join("System")
                .join("Library")
                .join("LaunchDaemons"),
        }
    }

    fn discovery<'a>(&self, runner: &'a Runner) -> Discovery<'a> {
        Discovery {
            uid: real_uid(),
            home: Some(self.home.clone()),
            locations: self.locations(),
            runner,
            limits: Limits::default(),
        }
    }

    fn ctx(&self) -> ResourceWriteContext<'_> {
        ResourceWriteContext {
            grants: &self.grants,
            operations: &self.operations,
            environment: &self.environment,
            retention: BackupRetention::FIVE,
        }
    }

    fn plist_path(&self, label: &str) -> PathBuf {
        self.agents.join(file_name(label))
    }

    fn seed(&self, label: &str, extra: &str) -> Vec<u8> {
        let body = plist_xml(label, extra);
        fs::write(self.plist_path(label), &body).expect("seed plist");
        body.into_bytes()
    }

    fn record(&self, label: &str) {
        self.store
            .add(AdoptionRecord {
                domain: LaunchdDomain::Gui,
                label: label.to_owned(),
                path: format!("~/Library/LaunchAgents/{}", file_name(label)),
                sha256: "0".repeat(64),
                adopted_at_epoch_ms: 1,
            })
            .expect("record");
    }

    fn keys(&self, label: &str) -> Vec<String> {
        read_dictionary(&fs::read(self.plist_path(label)).expect("read plist"))
            .keys()
            .cloned()
            .collect()
    }

    fn live_plist_grants(&self) -> usize {
        self.grants
            .list()
            .expect("list")
            .iter()
            .filter(|grant| grant.purpose == GrantPurpose::LaunchAgentFile)
            .count()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn read_dictionary(bytes: &[u8]) -> plist::Dictionary {
    match plist::Value::from_reader_xml(Cursor::new(bytes)).expect("parse") {
        plist::Value::Dictionary(dictionary) => dictionary,
        other => panic!("not a dictionary: {other:?}"),
    }
}

fn edit_now(
    fixture: &Fixture,
    runner: &Runner,
    request: &EditRequest,
) -> Result<super::flow::EditExecution, crate::error::AppError> {
    let discovery = fixture.discovery(runner);
    let preview = fixture.adoption.preview_edit(
        &discovery,
        &fixture.store,
        &fixture.ctx(),
        &fixture.writes,
        &Facts,
        request,
    )?;
    fixture.adoption.execute_edit(
        &discovery,
        &fixture.store,
        &fixture.ctx(),
        &fixture.writes,
        &preview.write.operation.operation_id,
    )
}

// ---- adoption ----------------------------------------------------------------

#[test]
fn adopting_backs_up_then_records_and_leaves_the_plist_unchanged() {
    let fixture = Fixture::new();
    let original = fixture.seed(LABEL, "");
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);

    let preview = fixture
        .adoption
        .preview_adoption(&discovery, &fixture.store, &fixture.operations, &gui(LABEL))
        .expect("previewed");
    assert!(preview.changed_fields.is_empty());
    assert_eq!(
        preview.file_path,
        format!("~/Library/LaunchAgents/{}", file_name(LABEL))
    );

    let execution = fixture
        .adoption
        .execute_adoption(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &preview.operation.operation_id,
        )
        .expect("adopted");
    assert!(!execution.backup_id.is_empty());
    assert!(!execution.plist_changed);
    assert_eq!(fs::read(fixture.plist_path(LABEL)).expect("read"), original);
    assert!(fixture.store.is_adopted(
        LaunchdDomain::Gui,
        LABEL,
        &format!("~/Library/LaunchAgents/{}", file_name(LABEL)),
    ));
    let target = ensure_modifiable(&discovery, &fixture.store, &gui(LABEL))
        .expect("modifiable once adopted");
    assert_eq!(target.ownership, Ownership::UserhomeAdopted);
}

#[test]
fn a_failed_backup_writes_no_record() {
    let fixture = Fixture::new();
    let original = fixture.seed(LABEL, "");
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);
    let preview = fixture
        .adoption
        .preview_adoption(&discovery, &fixture.store, &fixture.operations, &gui(LABEL))
        .expect("previewed");
    // A regular file where the backup root should be makes backups fail.
    fs::write(fixture.home.join("backups"), "not a directory").expect("block backups");

    fixture
        .adoption
        .execute_adoption(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &preview.operation.operation_id,
        )
        .expect_err("backup failure stops the adoption");
    assert!(fixture.store.load().expect("load").is_empty());
    assert_eq!(fs::read(fixture.plist_path(LABEL)).expect("read"), original);
}

#[test]
fn a_plist_changed_after_the_adoption_preview_is_not_adopted() {
    let fixture = Fixture::new();
    fixture.seed(LABEL, "");
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);
    let preview = fixture
        .adoption
        .preview_adoption(&discovery, &fixture.store, &fixture.operations, &gui(LABEL))
        .expect("previewed");
    fs::write(
        fixture.plist_path(LABEL),
        plist_xml(LABEL, "<key>Note</key><string>changed</string>"),
    )
    .expect("external change");

    let error = fixture
        .adoption
        .execute_adoption(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &preview.operation.operation_id,
        )
        .expect_err("stale preview refused");
    assert_eq!(error.code(), AppErrorCode::Conflict, "{error:?}");
    assert!(fixture.store.load().expect("load").is_empty());
}

#[test]
fn jobs_that_cannot_be_adopted_are_refused_at_preview() {
    let fixture = Fixture::new();
    let created = "com.zephyr194.userhome.agent.demo";
    fixture.seed(created, "");
    fixture.seed(
        LABEL,
        "<key>WatchPaths</key><array><string>/tmp</string></array>",
    );
    let runner = Runner::for_plists(&[created, LABEL]);
    let discovery = fixture.discovery(&runner);

    let error = fixture
        .adoption
        .preview_adoption(
            &discovery,
            &fixture.store,
            &fixture.operations,
            &gui(created),
        )
        .expect_err("UserHome-created job refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    let error = fixture
        .adoption
        .preview_adoption(&discovery, &fixture.store, &fixture.operations, &gui(LABEL))
        .expect_err("unsupported launch key refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
}

#[test]
fn release_removes_only_the_record_and_keeps_the_plist() {
    let fixture = Fixture::new();
    let original = fixture.seed(LABEL, "");
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);

    let error = super::flow::release_record(&discovery, &fixture.store, &gui(LABEL))
        .expect_err("a job that is not adopted cannot be released");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");

    fixture.record(LABEL);
    let outcome =
        super::flow::release_record(&discovery, &fixture.store, &gui(LABEL)).expect("released");
    assert!(outcome.released);
    assert!(!outcome.plist_changed);
    assert!(!fixture.store.is_adopted(
        LaunchdDomain::Gui,
        LABEL,
        &format!("~/Library/LaunchAgents/{}", file_name(LABEL)),
    ));
    assert_eq!(fs::read(fixture.plist_path(LABEL)).expect("read"), original);
}

// ---- structured edit ---------------------------------------------------------

#[test]
fn an_edit_keeps_unknown_keys_their_values_and_their_order() {
    let fixture = Fixture::new();
    fixture.seed(
        LABEL,
        "<key>WorkingDirectory</key><string>/tmp</string>\
         <key>com.example.Future</key><dict><key>Mode</key><string>x</string></dict>\
         <key>Zeta</key><string>kept</string>",
    );
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    let request = EditRequest {
        run_at_load: Some(false),
        stdout_path: Some(fixture.root.join("logs/out.log").display().to_string()),
        ..edit(LABEL)
    };

    let execution = edit_now(&fixture, &runner, &request).expect("edited");
    assert_eq!(
        execution.execution.outcome.status,
        crate::grants::WriteStatus::Succeeded
    );
    assert!(execution.reload_required);
    assert!(execution.grant_release_error.is_none());

    assert_eq!(
        fixture.keys(LABEL),
        vec![
            "Label",
            "ProgramArguments",
            "RunAtLoad",
            "WorkingDirectory",
            "com.example.Future",
            "Zeta",
            "StandardOutPath",
        ]
    );
    let dictionary = read_dictionary(&fs::read(fixture.plist_path(LABEL)).expect("read"));
    assert_eq!(
        dictionary.get("RunAtLoad"),
        Some(&plist::Value::Boolean(false))
    );
    assert_eq!(
        dictionary.get("Zeta"),
        Some(&plist::Value::String("kept".to_owned()))
    );
    assert_eq!(fixture.live_plist_grants(), 0);
}

#[test]
fn removing_a_key_keeps_the_others_in_their_places() {
    let fixture = Fixture::new();
    fixture.seed(
        LABEL,
        "<key>WorkingDirectory</key><string>/tmp</string>\
         <key>Alpha</key><string>a</string><key>Beta</key><string>b</string>",
    );
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    let request = EditRequest {
        working_directory: Some(String::new()),
        ..edit(LABEL)
    };

    edit_now(&fixture, &runner, &request).expect("edited");
    assert_eq!(
        fixture.keys(LABEL),
        vec!["Label", "ProgramArguments", "RunAtLoad", "Alpha", "Beta"]
    );
}

#[test]
fn a_plist_that_cannot_round_trip_is_refused_and_nothing_is_granted() {
    let fixture = Fixture::new();
    let original = fixture.seed(LABEL, "<key>Ratio</key><real>nan</real>");
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);

    let error = fixture
        .adoption
        .preview_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &Facts,
            &EditRequest {
                run_at_load: Some(false),
                ..edit(LABEL)
            },
        )
        .expect_err("lossy round trip refused");
    assert_eq!(error.code(), AppErrorCode::ValidationFailed, "{error:?}");
    assert_eq!(fs::read(fixture.plist_path(LABEL)).expect("read"), original);
    assert_eq!(fixture.live_plist_grants(), 0);
}

#[test]
fn comments_block_a_structured_edit() {
    let fixture = Fixture::new();
    let original = plist_xml(LABEL, "").replacen("<dict>", "<dict><!-- kept -->", 1);
    fs::write(fixture.plist_path(LABEL), &original).expect("seed");
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);

    fixture
        .adoption
        .preview_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &Facts,
            &EditRequest {
                run_at_load: Some(false),
                ..edit(LABEL)
            },
        )
        .expect_err("comments refused");
    assert_eq!(
        fs::read_to_string(fixture.plist_path(LABEL)).expect("read"),
        original
    );
}

#[test]
fn an_external_change_after_the_edit_preview_is_a_conflict_and_nothing_is_written() {
    let fixture = Fixture::new();
    fixture.seed(LABEL, "");
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);
    let preview: EditPreview = fixture
        .adoption
        .preview_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &Facts,
            &EditRequest {
                run_at_load: Some(false),
                ..edit(LABEL)
            },
        )
        .expect("previewed");
    let external = plist_xml(LABEL, "<key>Note</key><string>edited elsewhere</string>");
    fs::write(fixture.plist_path(LABEL), &external).expect("external change");

    let error = fixture
        .adoption
        .execute_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &preview.write.operation.operation_id,
        )
        .expect_err("conflict");
    assert_eq!(error.code(), AppErrorCode::Conflict, "{error:?}");
    assert_eq!(
        fs::read_to_string(fixture.plist_path(LABEL)).expect("read"),
        external
    );
    assert_eq!(fixture.live_plist_grants(), 0);
}

#[test]
fn a_discarded_edit_releases_its_grant_and_cannot_be_confirmed() {
    let fixture = Fixture::new();
    fixture.seed(LABEL, "");
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);
    let preview = fixture
        .adoption
        .preview_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &Facts,
            &EditRequest {
                run_at_load: Some(false),
                ..edit(LABEL)
            },
        )
        .expect("previewed");
    assert_eq!(fixture.live_plist_grants(), 1);

    let operation_id = preview.write.operation.operation_id.clone();
    fixture
        .adoption
        .discard_edit(&fixture.ctx(), &operation_id)
        .expect("discarded");
    assert_eq!(fixture.live_plist_grants(), 0);
    assert!(
        fixture
            .adoption
            .execute_edit(
                &discovery,
                &fixture.store,
                &fixture.ctx(),
                &fixture.writes,
                &operation_id,
            )
            .is_err()
    );
    // Discarding again is harmless.
    fixture
        .adoption
        .discard_edit(&fixture.ctx(), &operation_id)
        .expect("idempotent");
}

#[test]
fn a_confirmed_edit_releases_its_grant_whatever_the_write_did() {
    let fixture = Fixture::new();
    fixture.seed(LABEL, "");
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    edit_now(
        &fixture,
        &runner,
        &EditRequest {
            run_at_load: Some(false),
            ..edit(LABEL)
        },
    )
    .expect("edited");
    assert_eq!(fixture.live_plist_grants(), 0);
}

#[test]
fn argument_and_environment_values_become_literal_strings_and_stay_out_of_records() {
    let fixture = Fixture::new();
    fixture.seed(LABEL, "");
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);
    let request = EditRequest {
        arguments: Some(vec![
            "$(touch /tmp/pwned)".to_owned(),
            "--name=a;b".to_owned(),
        ]),
        environment_set: BTreeMap::from([("MY_VAR".to_owned(), SECRET.to_owned())]),
        ..edit(LABEL)
    };
    let preview = fixture
        .adoption
        .preview_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &Facts,
            &request,
        )
        .expect("previewed");
    assert_eq!(preview.environment_set, vec!["MY_VAR".to_owned()]);
    assert!(
        !serde_json::to_string(&preview)
            .expect("json")
            .contains(SECRET)
    );

    let execution = fixture
        .adoption
        .execute_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &preview.write.operation.operation_id,
        )
        .expect("edited");
    assert!(
        !serde_json::to_string(&execution)
            .expect("json")
            .contains(SECRET)
    );

    let dictionary = read_dictionary(&fs::read(fixture.plist_path(LABEL)).expect("read"));
    assert_eq!(
        dictionary.get("ProgramArguments"),
        Some(&plist::Value::Array(vec![
            plist::Value::String("/usr/bin/true".to_owned()),
            plist::Value::String("$(touch /tmp/pwned)".to_owned()),
            plist::Value::String("--name=a;b".to_owned()),
        ]))
    );
    let Some(plist::Value::Dictionary(environment)) = dictionary.get("EnvironmentVariables") else {
        panic!("environment missing");
    };
    assert_eq!(
        environment.get("MY_VAR"),
        Some(&plist::Value::String(SECRET.to_owned()))
    );
}

#[test]
fn a_shell_program_or_an_empty_edit_is_refused() {
    let fixture = Fixture::new();
    let original = fixture.seed(LABEL, "");
    fixture.record(LABEL);
    let runner = Runner::for_plist(LABEL);

    let error = edit_now(
        &fixture,
        &runner,
        &EditRequest {
            executable: Some("/bin/sh".to_owned()),
            ..edit(LABEL)
        },
    )
    .expect_err("shell program refused");
    assert_eq!(error.code(), AppErrorCode::ValidationFailed, "{error:?}");

    let error = edit_now(&fixture, &runner, &edit(LABEL)).expect_err("nothing to change");
    assert_eq!(error.code(), AppErrorCode::InvalidInput, "{error:?}");
    assert_eq!(fs::read(fixture.plist_path(LABEL)).expect("read"), original);
}

#[test]
fn an_edit_is_only_for_an_adopted_job() {
    let fixture = Fixture::new();
    fixture.seed(LABEL, "");
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);
    let error = fixture
        .adoption
        .preview_edit(
            &discovery,
            &fixture.store,
            &fixture.ctx(),
            &fixture.writes,
            &Facts,
            &EditRequest {
                run_at_load: Some(false),
                ..edit(LABEL)
            },
        )
        .expect_err("not adopted");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    assert_eq!(fixture.live_plist_grants(), 0);
}

#[test]
fn a_store_that_names_the_adopted_job_is_what_makes_it_modifiable() {
    let fixture = Fixture::new();
    fixture.seed(LABEL, "");
    let runner = Runner::for_plist(LABEL);
    let discovery = fixture.discovery(&runner);
    let before = ensure_modifiable(&discovery, &fixture.store, &gui(LABEL));
    assert!(before.is_err());
    fixture.record(LABEL);
    let after = ensure_modifiable(&discovery, &fixture.store, &gui(LABEL)).expect("modifiable");
    assert_eq!(after.ownership, Ownership::UserhomeAdopted);
}
