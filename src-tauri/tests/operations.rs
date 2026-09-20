use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use serde_json::json;
use userhome_lib::{
    error::AppErrorCode,
    operations::{
        Clock, OperationIdSource, OperationIntent, OperationKind, OperationStatus, OperationStore,
    },
};

const BASE_UNIX_SECONDS: i64 = 1_700_000_000;

#[derive(Clone, Default)]
struct FakeClock {
    elapsed_millis: Arc<AtomicU64>,
}

impl FakeClock {
    fn advance(&self, millis: u64) {
        self.elapsed_millis.fetch_add(millis, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn monotonic_millis(&self) -> u64 {
        self.elapsed_millis.load(Ordering::SeqCst)
    }

    fn unix_seconds(&self) -> i64 {
        BASE_UNIX_SECONDS + (self.monotonic_millis() / 1_000) as i64
    }
}

#[derive(Default)]
struct FixedIdSource {
    next: AtomicU64,
}

impl OperationIdSource for FixedIdSource {
    fn next_id(&self) -> String {
        match self.next.fetch_add(1, Ordering::SeqCst) {
            0 => "op-fixed".to_owned(),
            value => format!("op-{value}"),
        }
    }
}

fn intent(parameter: &str) -> OperationIntent {
    OperationIntent::new(
        OperationKind::ConfigurationWrite,
        "copilot",
        BTreeMap::from([("profile".to_owned(), parameter.to_owned())]),
    )
}

fn store(clock: FakeClock) -> OperationStore {
    OperationStore::with_sources(Arc::new(clock), Arc::new(FixedIdSource::default()))
}

#[test]
fn operations_changed_parameters_return_conflict_without_consuming_preview() {
    let clock = FakeClock::default();
    let mut store = store(clock);
    let preview = store
        .preview(
            intent("default"),
            "Update Copilot profile",
            vec!["Write the managed profile".to_owned()],
            false,
        )
        .expect("preview should be created");

    let error = store
        .authorize_mutation(&preview.operation_id, &intent("work"))
        .expect_err("changed parameters must be rejected");

    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert!(!error.retryable());
    assert_eq!(
        store
            .authorize_mutation(&preview.operation_id, &intent("default"))
            .expect("the original intent should remain authorized")
            .status,
        OperationStatus::Running
    );
}

#[test]
fn operations_preview_expires_at_the_five_minute_boundary() {
    let clock = FakeClock::default();
    let mut store = store(clock.clone());
    let operation_intent = intent("default");
    let preview = store
        .preview(
            operation_intent.clone(),
            "Update Copilot profile",
            vec![],
            false,
        )
        .expect("preview should be created");

    clock.advance(5 * 60 * 1_000);
    let error = store
        .authorize_mutation(&preview.operation_id, &operation_intent)
        .expect_err("the expiry boundary must be rejected");

    assert_eq!(error.code(), AppErrorCode::Timeout);
    assert_eq!(
        store
            .get(&preview.operation_id)
            .expect("operation should remain inspectable")
            .status,
        OperationStatus::Expired
    );
}

#[test]
fn operations_second_mutation_conflicts_until_cancellation_is_acknowledged() {
    let clock = FakeClock::default();
    let mut store = store(clock);
    let first_intent = intent("first");
    let first = store
        .preview(first_intent.clone(), "First", vec![], false)
        .expect("first preview should be created");
    store
        .authorize_mutation(&first.operation_id, &first_intent)
        .expect("first mutation should start");

    let second_intent = intent("second");
    let second = store
        .preview(second_intent.clone(), "Second", vec![], false)
        .expect("second preview should be created");

    let conflict = store
        .authorize_mutation(&second.operation_id, &second_intent)
        .expect_err("a second mutation must not start");
    assert_eq!(conflict.code(), AppErrorCode::Conflict);
    assert!(conflict.retryable());

    assert_eq!(
        store
            .cancel(&first.operation_id)
            .expect("running operation should accept cancellation")
            .status,
        OperationStatus::Cancelling
    );
    assert!(
        store
            .authorize_mutation(&second.operation_id, &second_intent)
            .is_err()
    );

    store
        .acknowledge_cancelled(&first.operation_id)
        .expect("runner should acknowledge cancellation");
    assert_eq!(
        store
            .authorize_mutation(&second.operation_id, &second_intent)
            .expect("lock should release only after acknowledgement")
            .status,
        OperationStatus::Running
    );
}

#[test]
fn operations_progress_and_final_events_are_bounded_and_redacted() {
    let clock = FakeClock::default();
    let mut store = store(clock);
    let operation_intent = intent("default");
    let preview = store
        .preview(operation_intent.clone(), "Update", vec![], false)
        .expect("preview should be created");
    store
        .authorize_mutation(&preview.operation_id, &operation_intent)
        .expect("mutation should start");

    let progress = store
        .record_progress(
            &preview.operation_id,
            &format!("token=progress-secret {}", "x".repeat(700)),
        )
        .expect("progress should be recorded");
    let progress_json = serde_json::to_value(progress).expect("progress should serialize");
    let message = progress_json["message"]
        .as_str()
        .expect("progress should contain a message");
    assert!(message.len() <= 512);
    assert!(!message.contains("progress-secret"));

    let finished = store
        .finish_success(
            &preview.operation_id,
            Some(&format!("password=stdout-secret {}", "y".repeat(5_000))),
            Some(&format!("api_key=stderr-secret {}", "z".repeat(5_000))),
        )
        .expect("operation should finish");
    let finished_json = serde_json::to_value(finished).expect("final event should serialize");
    let stdout = finished_json["stdoutSummary"]
        .as_str()
        .expect("stdout summary should exist");
    let stderr = finished_json["stderrSummary"]
        .as_str()
        .expect("stderr summary should exist");

    assert_eq!(finished_json["type"], json!("finished"));
    assert_eq!(finished_json["status"], json!("SUCCEEDED"));
    assert!(stdout.len() <= 4_096);
    assert!(stderr.len() <= 4_096);
    assert!(!stdout.contains("stdout-secret"));
    assert!(!stderr.contains("stderr-secret"));
}

#[test]
fn operations_preview_serializes_the_public_contract() {
    let clock = FakeClock::default();
    let mut store = store(clock);
    let preview = store
        .preview(
            intent("default"),
            "Update Copilot profile",
            vec!["Write the managed profile".to_owned()],
            false,
        )
        .expect("preview should be created");

    assert_eq!(
        serde_json::to_value(preview).expect("preview should serialize"),
        json!({
            "operationId": "op-fixed",
            "summary": "Update Copilot profile",
            "effects": ["Write the managed profile"],
            "requiresElevation": false,
            "expiresAt": "2023-11-14T22:18:20Z",
        })
    );
}
