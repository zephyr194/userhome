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
