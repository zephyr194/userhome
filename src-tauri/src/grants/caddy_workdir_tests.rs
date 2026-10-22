//! Caddy work directory authorizations (`CaddyWorkDir`): created and resolved
//! only through their dedicated entries, and refused by every general path.

use std::{fs, os::unix::fs::symlink, path::PathBuf};

use uuid::Uuid;

use super::{GrantCoordinator, GrantError, GrantKind, GrantPurpose, GrantStore};

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    grants: GrantCoordinator,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-caddy-workdir-{}", Uuid::new_v4()));
        let home = root.join("home");
        fs::create_dir_all(&home).expect("create home");
        let grants =
            GrantCoordinator::new(GrantStore::new(root.join("support")), Some(home.clone()));
        Self { root, home, grants }
    }

    fn workdir(&self) -> PathBuf {
        let directory = self.home.join(".caddy");
        fs::create_dir_all(&directory).expect("work directory");
        fs::canonicalize(directory).expect("canonical work directory")
    }

    fn store_file(&self) -> PathBuf {
        self.root.join("support").join("grants.json")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn the_general_create_refuses_the_caddy_workdir_purpose_and_stores_nothing() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();

    assert_eq!(
        fixture
            .grants
            .create(GrantPurpose::CaddyWorkDir, &directory),
        Err(GrantError::ReservedPurpose)
    );
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn a_caddy_workdir_is_never_a_new_file_grant() {
    let fixture = Fixture::new();

    assert_eq!(
        fixture.grants.create_new_file_with(
            GrantPurpose::CaddyWorkDir,
            &fixture.home,
            "rules.json"
        ),
        Err(GrantError::NotFile)
    );
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn the_dedicated_entry_grants_a_directory_below_home_with_its_canonical_path() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();

    let record = fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("granted");

    assert_eq!(record.purpose, GrantPurpose::CaddyWorkDir);
    assert_eq!(record.kind, GrantKind::Directory);
    assert_eq!(record.path, directory);
    assert_eq!(record.file_name, None);
    assert_eq!(fixture.grants.list().expect("list"), vec![record]);
}

#[test]
fn granting_the_same_directory_again_returns_the_existing_grant() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();
    let first = fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("first");

    let second = fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("second");

    assert_eq!(second.id, first.id);
    assert_eq!(fixture.grants.list().expect("list").len(), 1);
}

#[test]
fn a_new_choice_replaces_the_previous_work_directory_and_keeps_other_grants() {
    let fixture = Fixture::new();
    let first = fixture.workdir();
    fixture.grants.create_caddy_workdir(&first).expect("first");
    let other = fixture.home.join("projects");
    fs::create_dir_all(&other).expect("other directory");
    let config = fixture
        .grants
        .create(GrantPurpose::ConfigDirectory, &other)
        .expect("config grant");
    let second = fixture.home.join("caddy-next");
    fs::create_dir_all(&second).expect("second directory");
    let second = fixture
        .grants
        .create_caddy_workdir(&second)
        .expect("second");

    let stored = fixture.grants.list().expect("list");

    assert_eq!(stored.len(), 2);
    assert!(stored.contains(&config));
    assert!(stored.contains(&second));
    assert_eq!(
        fixture.grants.active_caddy_workdir().expect("active"),
        Some(second)
    );
}

#[test]
fn the_dedicated_entry_refuses_outside_home_protected_and_non_directory_targets() {
    let fixture = Fixture::new();
    let outside = fixture.root.join("elsewhere");
    fs::create_dir_all(&outside).expect("outside");
    let protected = fixture.home.join(".ssh");
    fs::create_dir_all(&protected).expect("protected");
    let file = fixture.home.join("notes.txt");
    fs::write(&file, "x").expect("file");

    assert_eq!(
        fixture.grants.create_caddy_workdir(&outside),
        Err(GrantError::OutsideHome)
    );
    assert_eq!(
        fixture.grants.create_caddy_workdir(&protected),
        Err(GrantError::ProtectedLocation)
    );
    assert_eq!(
        fixture.grants.create_caddy_workdir(&file),
        Err(GrantError::NotDirectory)
    );
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn every_general_resolve_refuses_the_caddy_workdir_grant() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();
    let record = fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("granted");

    assert_eq!(
        fixture.grants.resolve(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        fixture.grants.resolve_child(&record.id, "rules.json"),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        fixture.grants.resolve_tls_material(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        fixture.grants.resolve_shell_startup(&record.id),
        Err(GrantError::ReservedPurpose)
    );
    assert_eq!(
        fixture.grants.resolve_launch_agent(&record.id),
        Err(GrantError::ReservedPurpose)
    );
}

#[test]
fn the_caddy_workdir_resolves_only_through_its_own_entry() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();
    let record = fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("granted");

    assert_eq!(fixture.grants.resolve_caddy_workdir(), Ok(record));
}

#[test]
fn without_a_grant_the_caddy_workdir_is_unknown() {
    let fixture = Fixture::new();

    assert_eq!(fixture.grants.active_caddy_workdir(), Ok(None));
    assert_eq!(
        fixture.grants.resolve_caddy_workdir(),
        Err(GrantError::UnknownGrant)
    );
    assert_eq!(
        fixture.grants.revoke_caddy_workdir(),
        Err(GrantError::UnknownGrant)
    );
}

#[test]
fn revoking_the_caddy_workdir_refuses_every_later_resolution() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();
    let record = fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("granted");

    fixture.grants.revoke_caddy_workdir().expect("revoked");

    assert_eq!(
        fixture.grants.resolve_caddy_workdir(),
        Err(GrantError::UnknownGrant)
    );
    assert_eq!(
        fixture.grants.resolve(&record.id),
        Err(GrantError::UnknownGrant)
    );
    assert!(directory.is_dir(), "revoking never deletes the directory");
}

#[test]
fn a_work_directory_replaced_by_a_symbolic_link_is_an_escape() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();
    fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("granted");
    let elsewhere = fixture.home.join("elsewhere");
    fs::create_dir_all(&elsewhere).expect("elsewhere");
    fs::remove_dir_all(&directory).expect("remove");
    symlink(&elsewhere, &directory).expect("symlink");

    assert_eq!(
        fixture.grants.resolve_caddy_workdir(),
        Err(GrantError::SymlinkEscape)
    );
}

#[test]
fn a_missing_work_directory_is_reported_as_not_found() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();
    fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("granted");
    fs::remove_dir_all(&directory).expect("remove");

    assert_eq!(
        fixture.grants.resolve_caddy_workdir(),
        Err(GrantError::NotFound)
    );
}

#[test]
fn the_purpose_is_stored_and_serialized_under_its_reserved_name() {
    let fixture = Fixture::new();
    let directory = fixture.workdir();
    fixture
        .grants
        .create_caddy_workdir(&directory)
        .expect("granted");

    let saved: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.store_file()).expect("store")).expect("json");

    assert_eq!(saved["grants"][0]["purpose"], "CADDY_WORK_DIR");
    assert_eq!(saved["grants"][0]["kind"], "DIRECTORY");
    assert_eq!(
        serde_json::to_value(GrantPurpose::CaddyWorkDir).expect("json"),
        "CADDY_WORK_DIR"
    );
}
