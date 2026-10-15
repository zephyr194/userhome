use std::fs;

use serde_json::{Value, json};
use userhome_lib::{commands::status::get_app_status, error::AppError};

#[test]
fn ipc_status_serializes_typed_success() {
    let response = get_app_status().expect("status command should succeed");

    assert_eq!(
        serde_json::to_value(response).expect("status response should serialize"),
        json!({
            "status": "ok",
            "version": env!("CARGO_PKG_VERSION"),
        })
    );
}

#[test]
fn ipc_internal_error_serializes_without_sensitive_diagnostics() {
    let serialized = serde_json::to_value(AppError::internal()).expect("AppError should serialize");

    assert_eq!(
        serialized,
        json!({
            "code": "INTERNAL",
            "message": "An internal error occurred.",
            "retryable": false,
        })
    );
    assert!(!serialized.to_string().contains("stack"));
    assert!(!serialized.to_string().contains("source"));
    assert!(!serialized.to_string().contains("token"));
}

#[test]
fn ipc_capability_only_grants_event_listeners_and_main_window_dragging() {
    let capability_path = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json");
    let capability: Value = serde_json::from_str(
        &fs::read_to_string(capability_path).expect("capability file should be readable"),
    )
    .expect("capability file should contain valid JSON");

    assert_eq!(capability["windows"], json!(["main"]));
    assert_eq!(
        capability["permissions"],
        json!([
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "core:window:allow-start-dragging"
        ])
    );
    assert!(capability.get("remote").is_none());
}

#[test]
fn configuration_inputs_reject_paths_and_unknown_mutation_fields() {
    use userhome_lib::commands::{
        application_config::{ConfigurationAppInput, ConfigurationResourceInput},
        settings::UpdateDiscoveryExclusionsInput,
    };
    assert!(
        serde_json::from_value::<ConfigurationAppInput>(
            json!({"appId":"github-copilot","path":"/tmp"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ConfigurationResourceInput>(
            json!({"appId":"github-copilot","resourceId":"abc","content":"write"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<UpdateDiscoveryExclusionsInput>(
            json!({"userPaths":[],"builtinPaths":[]})
        )
        .is_err()
    );
}

#[test]
fn grant_store_recovery_contract_has_enum_only_status_and_a_pathless_reset_input() {
    use userhome_lib::{
        commands::grants::ResetGrantStoreInput,
        grants::{GrantStoreProblem, GrantStoreReset, GrantStoreStatus},
    };

    assert_eq!(
        serde_json::to_value(GrantStoreStatus::Available).expect("status should serialize"),
        json!({"status":"AVAILABLE"})
    );
    assert_eq!(
        serde_json::to_value(GrantStoreStatus::Unavailable {
            reason: GrantStoreProblem::NewerVersion
        })
        .expect("status should serialize"),
        json!({"status":"UNAVAILABLE","reason":"NEWER_VERSION"})
    );
    assert_eq!(
        serde_json::to_value(GrantStoreReset {
            quarantine_file_name: "grants.json.corrupt-20260102T030405Z".to_owned(),
            previous_reason: GrantStoreProblem::Corrupt,
        })
        .expect("reset result should serialize"),
        json!({
            "quarantineFileName": "grants.json.corrupt-20260102T030405Z",
            "previousReason": "CORRUPT",
        })
    );
    assert!(serde_json::from_value::<ResetGrantStoreInput>(json!({})).is_ok());
    assert!(
        serde_json::from_value::<ResetGrantStoreInput>(json!({"path":"/tmp/grants.json"})).is_err()
    );
}
