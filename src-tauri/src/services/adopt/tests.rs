//! Adoption over fixtures only: hand-built discovery records, plist bytes held in
//! memory, and temporary directories for the record store. Nothing reads a real
//! LaunchAgents directory, runs launchctl or plutil, or touches a real job.

use std::{fs, path::PathBuf};

use uuid::Uuid;

use super::{store::AdoptionRecord, store::AdoptionStore, *};
use crate::{
    config::read::hash_bytes,
    services::{
        launchd::{
            ConfigFile, ConfigPresence, Correlation, FileKind, LabelSource, LaunchdDirectory,
            LaunchdDomain, LaunchdScope, LaunchdService, LoadState, ParseStatus, RunState,
            ServiceIssue,
        },
        ownership::{AdoptionRecords, NoAdoptions, ReadOnlyReason},
    },
};

const UID: u32 = 501;
const OTHER_UID: u32 = 502;
const LABEL: &str = "com.example.agent";
const PATH: &str = "~/Library/LaunchAgents/com.example.agent.plist";

struct Everything;

impl AdoptionRecords for Everything {
    fn is_adopted(&self, _: LaunchdDomain, _: &str, _: &str) -> bool {
        true
    }
}

fn file() -> ConfigFile {
    ConfigFile {
        path: PATH.to_owned(),
        directory: LaunchdDirectory::UserLaunchAgents,
        scope: LaunchdScope::UserAgent,
        is_apple_path: false,
        owner_uid: Some(UID),
        kind: FileKind::Regular,
        link_target: None,
        parse_status: ParseStatus::Parsed,
        details: None,
    }
}

fn service(label: &str) -> LaunchdService {
    LaunchdService {
        id: format!("gui/{UID}/{label}"),
        label: label.to_owned(),
        label_source: LabelSource::Plist,
        domain: LaunchdDomain::Gui,
        domain_target: format!("gui/{UID}"),
        scope: LaunchdScope::UserAgent,
        correlation: Correlation::Matched,
        load_state: LoadState::Loaded,
        run_state: RunState::NotRunning,
        pid: None,
        last_exit: None,
        config_presence: ConfigPresence::Found,
        config_files: vec![file()],
        issues: Vec::new(),
    }
}

fn wrap(body: &str) -> Vec<u8> {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>{body}</dict></plist>\n"
    )
    .into_bytes()
}

fn valid_body() -> String {
    format!(
        "<key>Label</key><string>{LABEL}</string>\
         <key>ProgramArguments</key><array><string>/usr/bin/true</string></array>\
         <key>RunAtLoad</key><true/>"
    )
}

fn admit_bytes(service: &LaunchdService, bytes: &[u8]) -> Result<Admitted, Vec<Refusal>> {
    admit(service, UID, &NoAdoptions, true, bytes)
}

fn refusals_of(service: &LaunchdService, bytes: &[u8]) -> Vec<Refusal> {
    admit_bytes(service, bytes).expect_err("expected refusal")
}

// ---- admission ----------------------------------------------------------------

#[test]
fn a_plain_current_user_agent_is_admitted_with_the_hash_of_the_bytes_it_read() {
    let bytes = wrap(&valid_body());
    let admitted = admit_bytes(&service(LABEL), &bytes).expect("admitted");
    assert_eq!(admitted.sha256, hash_bytes(&bytes));
}

#[test]
fn apple_jobs_are_refused_as_apple_managed() {
    let refusals = refusals_of(&service("com.apple.example"), &wrap(&valid_body()));
    assert!(refusals.contains(&Refusal::ReadOnly(ReadOnlyReason::AppleManaged)));
}

#[test]
fn a_job_already_recorded_as_adopted_is_refused_as_managed() {
    let bytes = wrap(&valid_body());
    let refusals = admit(&service(LABEL), UID, &Everything, true, &bytes).expect_err("refused");
    assert_eq!(refusals, vec![Refusal::AlreadyManaged]);
}

#[test]
fn an_untrusted_discovery_is_refused_as_read_only() {
    let bytes = wrap(&valid_body());
    let refusals = admit(&service(LABEL), UID, &NoAdoptions, false, &bytes).expect_err("refused");
    assert!(refusals.contains(&Refusal::ReadOnly(ReadOnlyReason::DiscoveryIncomplete)));
}

#[test]
fn symbolic_links_other_owners_and_unparsed_files_are_refused_by_their_reason() {
    let bytes = wrap(&valid_body());

    let mut link = service(LABEL);
    link.config_files[0].kind = FileKind::Link;
    let refusals = refusals_of(&link, &bytes);
    assert!(refusals.contains(&Refusal::ReadOnly(ReadOnlyReason::SymbolicLink)));

    let mut other = service(LABEL);
    other.config_files[0].owner_uid = Some(OTHER_UID);
    let refusals = refusals_of(&other, &bytes);
    assert!(refusals.contains(&Refusal::ReadOnly(ReadOnlyReason::OwnerNotCurrentUser)));

    let mut unparsed = service(LABEL);
    unparsed.config_files[0].parse_status = ParseStatus::ConvertFailed;
    let refusals = refusals_of(&unparsed, &bytes);
    assert!(refusals.contains(&Refusal::ReadOnly(ReadOnlyReason::PlistNotParsed)));
}

#[test]
fn a_label_not_read_from_the_plist_or_not_matching_its_file_name_is_refused() {
    let bytes = wrap(&valid_body());

    let mut not_from_plist = service(LABEL);
    not_from_plist.label_source = LabelSource::FileName;
    let refusals = refusals_of(&not_from_plist, &bytes);
    assert!(refusals.contains(&Refusal::ReadOnly(ReadOnlyReason::LabelNotFromPlist)));

    let mut mismatch = service(LABEL);
    mismatch.issues.push(ServiceIssue::LabelFilenameMismatch);
    let refusals = refusals_of(&mismatch, &bytes);
    assert!(refusals.contains(&Refusal::ReadOnly(ReadOnlyReason::LabelFilenameMismatch)));
}

#[test]
fn a_binary_plist_is_refused_because_it_cannot_be_edited_faithfully() {
    let mut bytes = b"bplist00".to_vec();
    bytes.extend_from_slice(&[0u8; 32]);
    assert_eq!(
        refusals_of(&service(LABEL), &bytes),
        vec![Refusal::BinaryFormat]
    );
}

#[test]
fn an_oversized_plist_is_refused_before_it_is_parsed() {
    let bytes = vec![b' '; MAX_PLIST_BYTES + 1];
    assert_eq!(
        refusals_of(&service(LABEL), &bytes),
        vec![Refusal::TooLarge]
    );
}

#[test]
fn malformed_xml_and_a_non_dictionary_root_are_refused_separately() {
    assert_eq!(
        refusals_of(&service(LABEL), b"<plist><dict><key>Label"),
        vec![Refusal::Malformed]
    );
    let array = b"<?xml version=\"1.0\"?><plist version=\"1.0\"><array/></plist>";
    assert_eq!(
        refusals_of(&service(LABEL), array),
        vec![Refusal::NotDictionary]
    );
}

#[test]
fn a_missing_or_non_string_label_is_refused_as_missing() {
    let without = wrap("<key>RunAtLoad</key><true/>");
    assert_eq!(
        refusals_of(&service(LABEL), &without),
        vec![Refusal::LabelMissing]
    );
    let numeric = wrap("<key>Label</key><integer>1</integer>");
    assert_eq!(
        refusals_of(&service(LABEL), &numeric),
        vec![Refusal::LabelMissing]
    );
}

#[test]
fn a_label_inside_the_plist_that_differs_from_the_discovered_one_is_refused() {
    let bytes = wrap("<key>Label</key><string>com.example.other</string>");
    assert_eq!(
        refusals_of(&service(LABEL), &bytes),
        vec![Refusal::LabelMismatch]
    );
}

#[test]
fn a_duplicated_top_level_key_is_refused_as_ambiguous() {
    let bytes = wrap(&format!("{}<key>RunAtLoad</key><false/>", valid_body()));
    assert_eq!(
        refusals_of(&service(LABEL), &bytes),
        vec![Refusal::DuplicateKey]
    );
}

#[test]
fn a_launch_key_that_needs_semantics_outside_the_model_is_refused() {
    let bytes = wrap(&format!(
        "{}<key>WatchPaths</key><array><string>/tmp/x</string></array>",
        valid_body()
    ));
    assert_eq!(
        refusals_of(&service(LABEL), &bytes),
        vec![Refusal::UnsupportedLaunchKey]
    );
}

#[test]
fn keys_the_model_does_not_know_do_not_block_adoption() {
    let bytes = wrap(&format!(
        "{}<key>com.example.Future</key><dict><key>Mode</key><string>x</string></dict>",
        valid_body()
    ));
    assert!(admit_bytes(&service(LABEL), &bytes).is_ok());
}

// ---- editing fidelity ----------------------------------------------------------

fn key_order(dictionary: &plist::Dictionary) -> Vec<String> {
    dictionary.keys().cloned().collect()
}

#[test]
fn a_plain_plist_is_editable_and_keeps_its_keys_in_their_order() {
    let bytes = wrap(&format!(
        "{}<key>com.example.Future</key><string>kept</string>",
        valid_body()
    ));
    let dictionary = editable_document(&bytes).expect("editable");
    assert_eq!(
        key_order(&dictionary),
        vec![
            "Label",
            "ProgramArguments",
            "RunAtLoad",
            "com.example.Future"
        ]
    );
}

#[test]
fn comments_block_structured_edits_because_a_rewrite_would_drop_them() {
    let bytes = wrap(&format!("<!-- kept by the owner -->{}", valid_body()));
    assert!(matches!(editable_document(&bytes), Err(Refusal::Comments)));
}

#[test]
fn duplicate_keys_block_edits_at_any_depth() {
    let top = wrap(&format!("{}<key>RunAtLoad</key><false/>", valid_body()));
    assert!(matches!(
        editable_document(&top),
        Err(Refusal::DuplicateKey)
    ));

    let nested = wrap(&format!(
        "{}<key>Nested</key><dict><key>A</key><true/><key>A</key><false/></dict>",
        valid_body()
    ));
    assert!(matches!(
        editable_document(&nested),
        Err(Refusal::DuplicateKey)
    ));
}

#[test]
fn escaped_spellings_of_the_same_key_count_as_duplicates() {
    let bytes = wrap(&format!(
        "{}<key>Lab&#101;l</key><string>again</string>",
        valid_body()
    ));
    assert!(matches!(
        editable_document(&bytes),
        Err(Refusal::DuplicateKey)
    ));
}

#[test]
fn a_binary_plist_is_not_editable() {
    let mut bytes = b"bplist00".to_vec();
    bytes.extend_from_slice(&[0u8; 32]);
    assert!(matches!(
        editable_document(&bytes),
        Err(Refusal::BinaryFormat)
    ));
}

#[test]
fn rendered_bytes_parse_back_to_the_same_dictionary() {
    let dictionary = editable_document(&wrap(&valid_body())).expect("editable");
    let rendered = render(&dictionary).expect("rendered");
    let reparsed = plist::Value::from_reader_xml(std::io::Cursor::new(&rendered)).expect("parse");
    assert_eq!(reparsed, plist::Value::Dictionary(dictionary));
}

#[test]
fn a_value_that_does_not_survive_a_rewrite_is_refused_rather_than_repaired() {
    let bytes = wrap("<key>Label</key><string>x</string><key>Ratio</key><real>nan</real>");
    assert!(matches!(
        editable_document(&bytes),
        Err(Refusal::RoundTripChanged)
    ));
}

// ---- record store ----------------------------------------------------------------

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("userhome-adopt-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("scratch");
        Self(path)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn record(label: &str) -> AdoptionRecord {
    AdoptionRecord {
        domain: LaunchdDomain::Gui,
        label: label.to_owned(),
        path: PATH.to_owned(),
        sha256: "00".repeat(32),
        adopted_at_epoch_ms: 1_700_000_000_000,
    }
}

#[test]
fn a_missing_store_holds_nothing_and_adopts_nothing() {
    let scratch = Scratch::new();
    let store = AdoptionStore::new(&scratch.0);
    assert_eq!(store.load(), Ok(Vec::new()));
    assert!(!store.is_adopted(LaunchdDomain::Gui, LABEL, PATH));
}

#[test]
fn a_record_is_found_only_for_its_own_domain_label_and_path() {
    let scratch = Scratch::new();
    let store = AdoptionStore::new(&scratch.0);
    store.add(record(LABEL)).expect("added");
    assert!(store.is_adopted(LaunchdDomain::Gui, LABEL, PATH));
    assert!(!store.is_adopted(LaunchdDomain::System, LABEL, PATH));
    assert!(!store.is_adopted(LaunchdDomain::Gui, "com.example.other", PATH));
    assert!(!store.is_adopted(LaunchdDomain::Gui, LABEL, "~/elsewhere.plist"));
}

#[test]
fn a_second_record_for_the_same_job_is_refused() {
    let scratch = Scratch::new();
    let store = AdoptionStore::new(&scratch.0);
    store.add(record(LABEL)).expect("added");
    let error = store.add(record(LABEL)).expect_err("conflict");
    assert_eq!(error.code(), crate::error::AppErrorCode::Conflict);
    assert_eq!(store.load().map(|records| records.len()), Ok(1));
}

#[test]
fn corrupt_unknown_or_newer_documents_fail_closed() {
    let scratch = Scratch::new();
    let store = AdoptionStore::new(&scratch.0);
    let file = scratch.0.join("adoptions.json");
    let cases = [
        "not json",
        "{\"schemaVersion\":2,\"records\":[]}",
        "{\"schemaVersion\":1,\"records\":[],\"extra\":true}",
    ];
    for document in cases {
        fs::write(&file, document).expect("write");
        assert!(store.load().is_err(), "{document}");
        assert!(
            !store.is_adopted(LaunchdDomain::Gui, LABEL, PATH),
            "{document}"
        );
    }
}

#[test]
fn a_document_naming_the_same_job_twice_fails_closed() {
    let scratch = Scratch::new();
    let store = AdoptionStore::new(&scratch.0);
    let one = serde_json::to_string(&record(LABEL)).expect("json");
    let document = format!("{{\"schemaVersion\":1,\"records\":[{one},{one}]}}");
    fs::write(scratch.0.join("adoptions.json"), document).expect("write");
    assert!(store.load().is_err());
}

#[test]
fn removing_a_record_drops_only_that_job_and_reports_whether_it_existed() {
    let scratch = Scratch::new();
    let store = AdoptionStore::new(&scratch.0);
    store.add(record(LABEL)).expect("added");
    store.add(record("com.example.second")).expect("added");
    assert_eq!(store.remove(LaunchdDomain::Gui, LABEL), Ok(true));
    assert_eq!(store.remove(LaunchdDomain::Gui, LABEL), Ok(false));
    let remaining = store.load().expect("loads");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].label, "com.example.second");
}

#[test]
fn a_record_stores_only_identity_and_hash_never_environment_or_arguments() {
    let value = serde_json::to_value(record(LABEL)).expect("json");
    let mut keys: Vec<&str> = value
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["adoptedAtEpochMs", "domain", "label", "path", "sha256"]
    );
}
