use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;

use crate::{
    error::AppError,
    grants::{GrantCoordinator, GrantId, GrantSummary},
};

// Grants are created only by backend code after a native picker; there is
// deliberately no command that accepts a path and returns an authorization.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeGrantInput {
    pub grant_id: String,
}

#[tauri::command]
pub fn list_grants(
    coordinator: State<'_, GrantCoordinator>,
) -> Result<Vec<GrantSummary>, AppError> {
    list_summaries(&coordinator, std::env::var_os("HOME").map(PathBuf::from))
}

#[tauri::command]
pub fn revoke_grant(
    coordinator: State<'_, GrantCoordinator>,
    input: RevokeGrantInput,
) -> Result<(), AppError> {
    revoke_by_id(&coordinator, &input)
}

fn list_summaries(
    coordinator: &GrantCoordinator,
    home: Option<PathBuf>,
) -> Result<Vec<GrantSummary>, AppError> {
    Ok(coordinator
        .list()?
        .iter()
        .map(|record| record.summary(home.as_deref()))
        .collect())
}

fn revoke_by_id(coordinator: &GrantCoordinator, input: &RevokeGrantInput) -> Result<(), AppError> {
    let id = GrantId::parse(&input.grant_id)?;
    Ok(coordinator.revoke(&id)?)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use uuid::Uuid;

    use crate::{
        error::AppErrorCode,
        grants::{GrantCoordinator, GrantPurpose, GrantStore},
    };

    use super::{RevokeGrantInput, list_summaries, revoke_by_id};

    #[test]
    fn revoke_input_rejects_unknown_fields_and_paths() {
        let valid: RevokeGrantInput =
            serde_json::from_str(r#"{"grantId":"abc"}"#).expect("known field");
        assert_eq!(valid.grant_id, "abc");
        assert!(serde_json::from_str::<RevokeGrantInput>(r#"{"grantId":"a","path":"/"}"#).is_err());
        assert!(serde_json::from_str::<RevokeGrantInput>(r#"{"path":"/etc"}"#).is_err());
    }

    #[test]
    fn list_and_revoke_work_through_the_command_helpers() {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("temp dir")
            .join(format!("userhome-grant-commands-{}", Uuid::new_v4()));
        let target = root.join("project");
        fs::create_dir_all(&target).expect("create target");
        let coordinator = GrantCoordinator::new(GrantStore::new(root.join("support")));
        let record = coordinator
            .create(GrantPurpose::ConfigDirectory, &target)
            .expect("create grant");

        let summaries = list_summaries(&coordinator, Some(root.clone())).expect("list");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].display_path, "~/project");
        let json = serde_json::to_string(&summaries).expect("serialize");
        assert!(!json.contains(root.to_str().expect("utf8 root")));

        let malformed = revoke_by_id(
            &coordinator,
            &RevokeGrantInput {
                grant_id: "../etc".to_owned(),
            },
        )
        .expect_err("malformed id");
        assert_eq!(malformed.code(), AppErrorCode::NotFound);

        revoke_by_id(
            &coordinator,
            &RevokeGrantInput {
                grant_id: record.id.as_str().to_owned(),
            },
        )
        .expect("revoke");
        assert!(
            list_summaries(&coordinator, None)
                .expect("list again")
                .is_empty()
        );
        let _ = fs::remove_dir_all(PathBuf::from(&root));
    }
}
