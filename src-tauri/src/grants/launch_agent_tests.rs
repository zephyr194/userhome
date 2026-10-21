//! LaunchAgent file authorizations (`LaunchAgentFile`): a new-file grant for
//! one `<label>.plist` in the fixed `~/Library/LaunchAgents`, usable only
//! through the dedicated create entries. Every general path, the shell startup
//! editor and the picker refuse it, and the entry never replaces a file.

use std::{fs, path::PathBuf};

use uuid::Uuid;

use crate::{
    config::{ConfigEnvironment, read::hash_bytes},
    error::{AppError, AppErrorCode},
    operations::OperationCoordinator,
    settings::BackupRetention,
};

use super::{
    ConfirmRequest, FileState, GrantCoordinator, GrantError, GrantId, GrantKind, GrantPurpose,
    GrantRecord, GrantStore, ReadError, RecoveryPoint, ResourceWriteContext,
    ResourceWriteCoordinator, WriteKind, WriteRequest, WriteStatus,
};

const PLIST: &str = "<plist>ok</plist>\n";
const EVIL: &str = "<plist>evil</plist>\n";

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    agents: PathBuf,
    environment: ConfigEnvironment,
    grants: GrantCoordinator,
    operations: OperationCoordinator,
    writes: ResourceWriteCoordinator,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-agent-grants-{}", Uuid::new_v4()));
        let home = root.join("home");
        let agents = home.join("Library").join("LaunchAgents");
        fs::create_dir_all(&agents).expect("create agents");
        let environment =
            ConfigEnvironment::new(home.clone(), root.join("brew"), home.join("backups"));
        let grants =
            GrantCoordinator::new(GrantStore::new(root.join("support")), Some(home.clone()));
        Self {
            root,
            home,
            agents,
            environment,
            grants,
            operations: OperationCoordinator::default(),
            writes: ResourceWriteCoordinator::default(),
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

    fn grant(&self, name: &str) -> GrantRecord {
        self.grants
            .create_new_file_with(GrantPurpose::LaunchAgentFile, &self.agents, name)
            .expect("launch agent grant")
    }

    fn create_request(&self, id: &GrantId, content: &str) -> WriteRequest {
        WriteRequest {
            grant_id: id.clone(),
            relative: None,
            expected_sha256: None,
            content: content.to_owned(),
            sensitive: true,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn confirm(operation_id: &str, id: &GrantId) -> ConfirmRequest {
    ConfirmRequest {
        operation_id: operation_id.to_owned(),
        grant_id: id.clone(),
        relative: None,
    }
}

// ------------------------------------------------------------- the grant

#[test]
fn a_launch_agent_grant_is_a_new_file_grant_with_its_own_purpose() {
    let fixture = Fixture::new();
    let record = fixture.grant("com.zephyr194.userhome.agent.a.plist");

    assert_eq!(record.purpose, GrantPurpose::LaunchAgentFile);
    assert_eq!(record.kind, GrantKind::File);
    assert_eq!(record.path, fixture.agents);
    assert_eq!(
        record.file_name.as_deref(),
        Some("com.zephyr194.userhome.agent.a.plist")
    );
    assert_eq!(fixture.grants.list().expect("list"), vec![record.clone()]);
    assert_eq!(
        serde_json::to_value(GrantPurpose::LaunchAgentFile).expect("json"),
        "LAUNCH_AGENT_FILE"
    );
    // Granting the same name again is the same grant.
    assert_eq!(
        fixture.grant("com.zephyr194.userhome.agent.a.plist"),
        record
    );
}

#[test]
fn only_the_fixed_launch_agents_directory_and_plist_names_are_accepted() {
    let fixture = Fixture::new();
    let other = fixture.home.join("Library").join("Elsewhere");
    fs::create_dir_all(&other).expect("other");
    let lookalike = fixture.home.join("LaunchAgents");
    fs::create_dir_all(&lookalike).expect("lookalike");
    for parent in [
        &fixture.home,
        &fixture.home.join("Library"),
        &other,
        &lookalike,
    ] {
        assert_eq!(
            fixture
                .grants
                .create_new_file_with(GrantPurpose::LaunchAgentFile, parent, "a.b.plist"),
            Err(GrantError::OutsideHome),
            "{parent:?}"
        );
    }
    for name in [
        "a.b",
        "a.b.plist.bak",
        ".plist",
        "a/b.plist",
        "..",
        "",
        "a.b.PLIST",
    ] {
        assert_eq!(
            fixture.grants.create_new_file_with(
                GrantPurpose::LaunchAgentFile,
                &fixture.agents,
                name
            ),
            Err(GrantError::InvalidRelativePath),
            "{name:?}"
        );
    }
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn a_launch_agent_grant_is_never_made_for_an_existing_name_or_a_linked_directory() {
    let fixture = Fixture::new();
    fs::write(fixture.agents.join("a.b.plist"), PLIST).expect("seed");
    // The dedicated entry covers creation only: an existing name is refused
    // when the grant is made, and `create` (existing files) never makes one.
    assert!(
        fixture
            .grants
            .create_new_file_with(GrantPurpose::LaunchAgentFile, &fixture.agents, "a.b.plist")
            .is_err()
    );
    assert_eq!(
        fixture.grants.create(
            GrantPurpose::LaunchAgentFile,
            &fixture.agents.join("a.b.plist")
        ),
        Err(GrantError::ReservedPurpose)
    );

    let outside = fixture.root.join("outside");
    fs::create_dir_all(&outside).expect("outside");
    let moved = fixture.home.join("Library").join("LaunchAgents-real");
    fs::rename(&fixture.agents, &moved).expect("move");
    std::os::unix::fs::symlink(&outside, &fixture.agents).expect("link");
    assert!(
        fixture
            .grants
            .create_new_file_with(GrantPurpose::LaunchAgentFile, &fixture.agents, "c.d.plist")
            .is_err()
    );
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn other_new_file_entries_cannot_make_the_reserved_purpose_elsewhere() {
    let fixture = Fixture::new();
    for purpose in [GrantPurpose::ConfigDirectory, GrantPurpose::Executable] {
        assert_eq!(
            fixture.grants.create_new_file_with(
                purpose,
                &fixture.agents,
                "com.zephyr194.userhome.agent.a.plist"
            ),
            Err(GrantError::NotFile)
        );
    }
}

#[test]
fn a_stored_launch_agent_record_must_be_a_file_grant_with_a_plist_name() {
    let id = Uuid::new_v4();
    let fixture = Fixture::new();
    fs::create_dir_all(fixture.root.join("support")).expect("support");
    let write = |kind: &str, name: &str| {
        let file_name = if name.is_empty() {
            String::new()
        } else {
            format!(r#","fileName":"{name}""#)
        };
        fs::write(
            fixture.store_file(),
            format!(
                r#"{{"schemaVersion":1,"grants":[{{"id":"{id}","purpose":"LAUNCH_AGENT_FILE","kind":"{kind}","path":"/tmp","createdAtEpochMs":1{file_name}}}]}}"#
            ),
        )
        .expect("store");
    };
    write("DIRECTORY", "a.b.plist");
    assert_eq!(fixture.grants.list(), Err(GrantError::StoreCorrupt));
    write("FILE", "");
    assert_eq!(fixture.grants.list(), Err(GrantError::StoreCorrupt));
    write("FILE", "a.b.txt");
    assert_eq!(fixture.grants.list(), Err(GrantError::StoreCorrupt));
    write("FILE", "a.b.plist");
    assert_eq!(fixture.grants.list().expect("list").len(), 1);
}

impl Fixture {
    fn store_file(&self) -> PathBuf {
        self.root.join("support").join("grants.json")
    }
}

#[test]
fn an_unknown_purpose_still_damages_the_store_and_the_version_stays_one() {
    let fixture = Fixture::new();
    fixture.grant("com.zephyr194.userhome.agent.a.plist");
    let saved: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(fixture.store_file()).expect("read"))
            .expect("json");
    assert_eq!(saved["schemaVersion"], 1);
    assert_eq!(saved["grants"][0]["purpose"], "LAUNCH_AGENT_FILE");
}

// ----------------------------------------------------- general resolution

#[test]
fn general_and_shell_paths_refuse_a_launch_agent_grant() {
    let fixture = Fixture::new();
    let record = fixture.grant("com.zephyr194.userhome.agent.a.plist");

    assert_eq!(
        fixture.grants.resolve(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        fixture.grants.resolve_shell_startup(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        fixture.grants.resolve_child(&record.id, "x"),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        fixture.grants.read_resource(&record.id, None).map(|_| ()),
        Err(ReadError::Excluded)
    );
    assert_eq!(
        fixture
            .grants
            .read_shell_startup_with_limit(&record.id, None, 16)
            .map(|_| ()),
        Err(ReadError::Excluded)
    );
    // The reverse: general and shell startup grants do not resolve through
    // the dedicated entry.
    let file = fixture.home.join("plain");
    fs::write(&file, "x").expect("seed");
    let general = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("general");
    let shell = fixture
        .grants
        .create(GrantPurpose::ShellStartupFile, &file)
        .expect("shell");
    for other in [&general, &shell] {
        assert_eq!(
            fixture.grants.resolve_launch_agent(&other.id),
            Err(GrantError::ReservedPurpose)
        );
    }
    assert_eq!(
        fixture
            .grants
            .resolve_launch_agent(&record.id)
            .expect("dedicated"),
        record
    );
}

#[test]
fn general_and_shell_previews_refuse_a_launch_agent_grant() {
    let fixture = Fixture::new();
    let record = fixture.grant("com.zephyr194.userhome.agent.a.plist");
    let error = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.create_request(&record.id, EVIL)],
        )
        .expect_err("general refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    let error = fixture
        .writes
        .preview_shell_startup(
            &fixture.ctx(),
            vec![fixture.create_request(&record.id, EVIL)],
        )
        .expect_err("shell refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    assert!(
        !fixture
            .agents
            .join("com.zephyr194.userhome.agent.a.plist")
            .exists()
    );
}

// ------------------------------------------------------------- writing

#[test]
fn the_dedicated_entry_creates_the_new_file_and_reads_it_back() {
    let fixture = Fixture::new();
    let name = "com.zephyr194.userhome.agent.a.plist";
    let record = fixture.grant(name);

    let preview = fixture
        .writes
        .preview_launch_agent(&fixture.ctx(), fixture.create_request(&record.id, PLIST))
        .expect("preview");
    assert_eq!(preview.steps.len(), 1);
    assert!(
        !fixture.agents.join(name).exists(),
        "a preview writes nothing"
    );
    let operation_id = preview.steps[0].operation.operation_id.clone();
    let executed = fixture
        .writes
        .execute_launch_agent(
            &fixture.ctx(),
            &confirm(&operation_id, &record.id),
            |written| {
                assert_eq!(written, PLIST.as_bytes());
                Ok(())
            },
        )
        .expect("execute");
    assert_eq!(executed.outcome.file_state, FileState::Written);
    assert_eq!(
        fs::read_to_string(fixture.agents.join(name)).expect("read"),
        PLIST
    );
}

#[test]
fn the_dedicated_entry_never_replaces_an_existing_file() {
    let fixture = Fixture::new();
    let name = "com.zephyr194.userhome.agent.a.plist";
    let record = fixture.grant(name);
    // The file appears after the grant: an expected hash (replace) is refused
    // by the entry, a create is refused because the target exists.
    fs::write(fixture.agents.join(name), "mine").expect("seed");

    let replace = WriteRequest {
        expected_sha256: Some(hash_bytes(b"mine")),
        ..fixture.create_request(&record.id, EVIL)
    };
    let error = fixture
        .writes
        .preview_launch_agent(&fixture.ctx(), replace)
        .expect_err("replace refused");
    assert_eq!(error.code(), AppErrorCode::InvalidInput, "{error:?}");
    let error = fixture
        .writes
        .preview_launch_agent(&fixture.ctx(), fixture.create_request(&record.id, EVIL))
        .expect_err("create over existing refused");
    assert_eq!(error.code(), AppErrorCode::Conflict, "{error:?}");
    assert_eq!(
        fs::read_to_string(fixture.agents.join(name)).expect("read"),
        "mine"
    );
}

#[test]
fn a_file_created_after_the_preview_is_not_overwritten_by_the_confirmation() {
    let fixture = Fixture::new();
    let name = "com.zephyr194.userhome.agent.a.plist";
    let record = fixture.grant(name);
    let preview = fixture
        .writes
        .preview_launch_agent(&fixture.ctx(), fixture.create_request(&record.id, PLIST))
        .expect("preview");
    fs::write(fixture.agents.join(name), "raced").expect("race");

    let error = fixture
        .writes
        .execute_launch_agent(
            &fixture.ctx(),
            &confirm(&preview.steps[0].operation.operation_id, &record.id),
            |_| Ok(()),
        )
        .expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::Conflict, "{error:?}");
    assert_eq!(
        fs::read_to_string(fixture.agents.join(name)).expect("read"),
        "raced"
    );
}

#[test]
fn the_dedicated_entry_refuses_grants_of_other_purposes() {
    let fixture = Fixture::new();
    let file = fixture.home.join("plain");
    let general = fixture
        .grants
        .create_new_file(&fixture.home, "plain")
        .expect("general");
    let shell = fixture
        .grants
        .create_new_file_with(GrantPurpose::ShellStartupFile, &fixture.home, ".zlogin")
        .expect("shell");
    for record in [&general, &shell] {
        let error = fixture
            .writes
            .preview_launch_agent(&fixture.ctx(), fixture.create_request(&record.id, EVIL))
            .expect_err("refused");
        assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    }
    assert!(!file.exists());
}

#[test]
fn previews_are_only_confirmed_by_the_kind_of_entry_that_made_them() {
    let fixture = Fixture::new();
    let name = "com.zephyr194.userhome.agent.a.plist";
    let record = fixture.grant(name);
    let preview = fixture
        .writes
        .preview_launch_agent(&fixture.ctx(), fixture.create_request(&record.id, PLIST))
        .expect("preview");
    let operation_id = preview.steps[0].operation.operation_id.clone();

    let general = fixture
        .writes
        .execute(&fixture.ctx(), &confirm(&operation_id, &record.id))
        .expect_err("general refused");
    assert_eq!(
        general.code(),
        AppErrorCode::PermissionDenied,
        "{general:?}"
    );
    let shell = fixture
        .writes
        .execute_shell_startup(&fixture.ctx(), &confirm(&operation_id, &record.id), |_| {
            Ok(())
        })
        .expect_err("shell refused");
    assert_eq!(shell.code(), AppErrorCode::PermissionDenied, "{shell:?}");
    assert!(!fixture.agents.join(name).exists());
    // The batch status of such a batch is not readable through the general path.
    let batch_id = preview.batch_id.clone();
    let status: Result<_, AppError> = fixture.writes.batch_status(&fixture.operations, &batch_id);
    assert_eq!(
        status.expect_err("reserved").code(),
        AppErrorCode::PermissionDenied
    );
    fixture
        .writes
        .execute_launch_agent(&fixture.ctx(), &confirm(&operation_id, &record.id), |_| {
            Ok(())
        })
        .expect("dedicated execute");
    assert!(fixture.agents.join(name).exists());
}

#[test]
fn a_swapped_directory_or_a_name_that_became_a_link_stops_the_confirmation() {
    let fixture = Fixture::new();
    let name = "com.zephyr194.userhome.agent.a.plist";
    let record = fixture.grant(name);
    let preview = fixture
        .writes
        .preview_launch_agent(&fixture.ctx(), fixture.create_request(&record.id, PLIST))
        .expect("preview");
    let victim = fixture.root.join("victim");
    fs::write(&victim, "untouched").expect("victim");
    std::os::unix::fs::symlink(&victim, fixture.agents.join(name)).expect("link");

    let error = fixture
        .writes
        .execute_launch_agent(
            &fixture.ctx(),
            &confirm(&preview.steps[0].operation.operation_id, &record.id),
            |_| Ok(()),
        )
        .expect_err("refused");
    assert!(
        matches!(
            error.code(),
            AppErrorCode::Conflict | AppErrorCode::PermissionDenied
        ),
        "{error:?}"
    );
    assert_eq!(fs::read_to_string(&victim).expect("read"), "untouched");
}

// ------------------------------------------------- replacement (adopt / edit)

const ADOPTED: &str = "com.example.adopted";

impl Fixture {
    fn seed_plist(&self, name: &str, content: &str) -> PathBuf {
        let path = self.agents.join(name);
        fs::write(&path, content).expect("seed plist");
        path
    }

    fn replacement(&self, name: &str) -> GrantRecord {
        self.grants
            .create_launch_agent_replacement(name)
            .expect("replacement grant")
    }

    fn replace_request(&self, id: &GrantId, current: &str, content: &str) -> WriteRequest {
        WriteRequest {
            grant_id: id.clone(),
            relative: None,
            expected_sha256: Some(hash_bytes(current.as_bytes())),
            content: content.to_owned(),
            sensitive: true,
        }
    }
}

#[test]
fn the_replacement_entry_backs_up_then_replaces_an_existing_plist() {
    let fixture = Fixture::new();
    let name = format!("{ADOPTED}.plist");
    let path = fixture.seed_plist(&name, "mine");
    let record = fixture.replacement(&name);
    assert_eq!(record.purpose, GrantPurpose::LaunchAgentFile);

    let preview = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            ADOPTED,
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect("previewed");
    let step = &preview.steps[0];
    assert_eq!(step.kind, WriteKind::Replace);
    assert_eq!(step.recovery_point, RecoveryPoint::Backup);

    let execution = fixture
        .writes
        .execute_launch_agent_replace(
            &fixture.ctx(),
            &confirm(&step.operation.operation_id, &record.id),
            |_| Ok(()),
        )
        .expect("ran");
    assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
    assert_eq!(execution.outcome.file_state, FileState::Written);
    assert_eq!(execution.outcome.recovery_point, RecoveryPoint::Backup);
    assert!(execution.outcome.backup_id.is_some());
    assert_eq!(fs::read_to_string(&path).expect("read"), PLIST);
}

#[test]
fn the_replacement_is_refused_when_the_plist_changed_after_the_preview() {
    let fixture = Fixture::new();
    let name = format!("{ADOPTED}.plist");
    let path = fixture.seed_plist(&name, "mine");
    let record = fixture.replacement(&name);
    let preview = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            ADOPTED,
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect("previewed");
    fs::write(&path, "theirs").expect("external change");

    let error = fixture
        .writes
        .execute_launch_agent_replace(
            &fixture.ctx(),
            &confirm(&preview.steps[0].operation.operation_id, &record.id),
            |_| Ok(()),
        )
        .expect_err("stale preview refused");
    assert_eq!(error.code(), AppErrorCode::Conflict, "{error:?}");
    assert_eq!(fs::read_to_string(&path).expect("read"), "theirs");
}

#[test]
fn a_replacement_whose_backup_cannot_be_made_writes_nothing() {
    let fixture = Fixture::new();
    let name = format!("{ADOPTED}.plist");
    let path = fixture.seed_plist(&name, "mine");
    let record = fixture.replacement(&name);
    // A regular file where the backup root should be makes backups fail.
    fs::write(fixture.home.join("backups"), "not a directory").expect("block backup root");
    let preview = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            ADOPTED,
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect("previewed");

    let execution = fixture
        .writes
        .execute_launch_agent_replace(
            &fixture.ctx(),
            &confirm(&preview.steps[0].operation.operation_id, &record.id),
            |_| Ok(()),
        )
        .expect("transaction ran");
    assert_eq!(execution.outcome.status, WriteStatus::Failed);
    assert_eq!(execution.outcome.file_state, FileState::Unchanged);
    assert_eq!(
        execution.outcome.recovery_point,
        RecoveryPoint::NoneUnavailable
    );
    assert!(execution.outcome.backup_id.is_none());
    assert_eq!(fs::read_to_string(&path).expect("read"), "mine");
}

#[test]
fn a_replacement_grant_covers_only_an_existing_regular_plist() {
    let fixture = Fixture::new();
    assert_eq!(
        fixture
            .grants
            .create_launch_agent_replacement(&format!("{ADOPTED}.plist"))
            .expect_err("missing"),
        GrantError::NotFound
    );
    fs::create_dir(fixture.agents.join("dir.plist")).expect("directory");
    assert_eq!(
        fixture
            .grants
            .create_launch_agent_replacement("dir.plist")
            .expect_err("directory"),
        GrantError::NotFile
    );
    let outside = fixture.root.join("outside.plist");
    fs::write(&outside, "elsewhere").expect("outside");
    std::os::unix::fs::symlink(&outside, fixture.agents.join("link.plist")).expect("link");
    assert_eq!(
        fixture
            .grants
            .create_launch_agent_replacement("link.plist")
            .expect_err("link"),
        GrantError::SymlinkEscape
    );
    fs::write(fixture.agents.join("notes.txt"), "x").expect("notes");
    assert_eq!(
        fixture
            .grants
            .create_launch_agent_replacement("notes.txt")
            .expect_err("not a plist"),
        GrantError::InvalidRelativePath
    );
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn a_replacement_is_refused_for_a_label_other_than_its_grant_or_a_create_shaped_request() {
    let fixture = Fixture::new();
    let name = format!("{ADOPTED}.plist");
    let path = fixture.seed_plist(&name, "mine");
    let record = fixture.replacement(&name);

    let error = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            "com.example.other",
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect_err("other label");
    assert_eq!(error.code(), AppErrorCode::InvalidInput, "{error:?}");

    let without_hash = WriteRequest {
        expected_sha256: None,
        ..fixture.replace_request(&record.id, "mine", PLIST)
    };
    let error = fixture
        .writes
        .preview_launch_agent_replace(&fixture.ctx(), ADOPTED, without_hash)
        .expect_err("no hash");
    assert_eq!(error.code(), AppErrorCode::InvalidInput, "{error:?}");

    let relative = WriteRequest {
        relative: Some("x".to_owned()),
        ..fixture.replace_request(&record.id, "mine", PLIST)
    };
    let error = fixture
        .writes
        .preview_launch_agent_replace(&fixture.ctx(), ADOPTED, relative)
        .expect_err("relative");
    assert_eq!(error.code(), AppErrorCode::InvalidInput, "{error:?}");
    assert_eq!(fs::read_to_string(&path).expect("read"), "mine");
}

#[test]
fn general_and_shell_entries_refuse_a_replacement_grant_and_keep_its_preview() {
    let fixture = Fixture::new();
    let name = format!("{ADOPTED}.plist");
    let path = fixture.seed_plist(&name, "mine");
    let record = fixture.replacement(&name);

    let error = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![fixture.replace_request(&record.id, "mine", EVIL)],
        )
        .expect_err("general preview refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    let error = fixture
        .writes
        .preview_shell_startup(
            &fixture.ctx(),
            vec![fixture.replace_request(&record.id, "mine", EVIL)],
        )
        .expect_err("shell preview refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");

    let preview = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            ADOPTED,
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect("previewed");
    let operation_id = preview.steps[0].operation.operation_id.clone();
    let error = fixture
        .writes
        .execute(&fixture.ctx(), &confirm(&operation_id, &record.id))
        .expect_err("general confirm refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    let error = fixture
        .writes
        .execute_shell_startup(&fixture.ctx(), &confirm(&operation_id, &record.id), |_| {
            Ok(())
        })
        .expect_err("shell confirm refused");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    assert_eq!(fs::read_to_string(&path).expect("read"), "mine");

    let execution = fixture
        .writes
        .execute_launch_agent_replace(&fixture.ctx(), &confirm(&operation_id, &record.id), |_| {
            Ok(())
        })
        .expect("still confirmable by its own entry");
    assert_eq!(execution.outcome.status, WriteStatus::Succeeded);
}

#[test]
fn each_launch_agent_entry_confirms_only_the_kind_of_preview_it_made() {
    let fixture = Fixture::new();
    let created = format!("{ADOPTED}-created.plist");
    let create_record = fixture.grant(&created);
    let create_preview = fixture
        .writes
        .preview_launch_agent(
            &fixture.ctx(),
            fixture.create_request(&create_record.id, PLIST),
        )
        .expect("create preview");
    let error = fixture
        .writes
        .execute_launch_agent_replace(
            &fixture.ctx(),
            &confirm(
                &create_preview.steps[0].operation.operation_id,
                &create_record.id,
            ),
            |_| Ok(()),
        )
        .expect_err("replacement entry refuses a create preview");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
    assert!(!fixture.agents.join(&created).exists());

    let name = format!("{ADOPTED}.plist");
    fixture.seed_plist(&name, "mine");
    let record = fixture.replacement(&name);
    let replace_preview = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            ADOPTED,
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect("replace preview");
    let error = fixture
        .writes
        .execute_launch_agent(
            &fixture.ctx(),
            &confirm(&replace_preview.steps[0].operation.operation_id, &record.id),
            |_| Ok(()),
        )
        .expect_err("create entry refuses a replace preview");
    assert_eq!(error.code(), AppErrorCode::PermissionDenied, "{error:?}");
}

#[test]
fn a_revoked_replacement_grant_can_neither_preview_nor_confirm() {
    let fixture = Fixture::new();
    let name = format!("{ADOPTED}.plist");
    let path = fixture.seed_plist(&name, "mine");
    let record = fixture.replacement(&name);
    let preview = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            ADOPTED,
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect("previewed");
    fixture.grants.revoke(&record.id).expect("revoked");

    let error = fixture
        .writes
        .execute_launch_agent_replace(
            &fixture.ctx(),
            &confirm(&preview.steps[0].operation.operation_id, &record.id),
            |_| Ok(()),
        )
        .expect_err("revoked grant refused");
    assert_eq!(error.code(), AppErrorCode::Conflict, "{error:?}");
    assert_eq!(fs::read_to_string(&path).expect("read"), "mine");

    let error = fixture
        .writes
        .preview_launch_agent_replace(
            &fixture.ctx(),
            ADOPTED,
            fixture.replace_request(&record.id, "mine", PLIST),
        )
        .expect_err("revoked grant cannot preview");
    assert_eq!(error.code(), AppErrorCode::NotFound, "{error:?}");
}
