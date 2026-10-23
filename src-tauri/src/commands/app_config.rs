//! Read-only app-config commands. The frontend supplies an entry id and nothing
//! else: no path parameter exists, and an unknown id is refused. Errors are
//! Chinese and never echo file content.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{
    app_config::{
        discover::{ConfigFs, ProbeStatus, StdFs, probe},
        edit::{
            ConfirmInput, EditRead, PreviewInput, PreviewResult, confirm, ensure_writable, preview,
            read_for_edit,
        },
        pending::AppConfigEditState,
        read::{ReadResult, read_entry},
        registry::{Category, Entry, EntrySummary, Registry},
        schema::{EditSchema, schema_for},
    },
    commands::grants::canonical_home,
    config::ConfigCoordinator,
    error::AppError,
    settings::SettingsCoordinator,
};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigListItem {
    pub summary: EntrySummary,
    pub probe: ProbeStatus,
}

#[tauri::command]
pub fn app_config_list() -> Result<Vec<AppConfigListItem>, AppError> {
    let registry = builtin_registry()?;
    let home = home_directory()?;
    Ok(list_entries(&registry, &home, &StdFs))
}

#[tauri::command]
pub fn app_config_read(id: String) -> Result<ReadResult, AppError> {
    let registry = builtin_registry()?;
    let home = home_directory()?;
    read_entry_by_id(&registry, &id, &home, &StdFs)
}

/// Every non-AI entry with its probe. AI client configs are read on the AI tool
/// page, so they stay out of this list. Each probe is independent, so one
/// unreadable location does not change the others.
pub fn list_entries(registry: &Registry, home: &Path, fs: &dyn ConfigFs) -> Vec<AppConfigListItem> {
    registry
        .entries()
        .iter()
        .filter(|entry| entry.category != Category::AiClient)
        .map(|entry| AppConfigListItem {
            summary: EntrySummary::from(entry),
            probe: probe(entry, home, fs),
        })
        .collect()
}

pub fn read_entry_by_id(
    registry: &Registry,
    id: &str,
    home: &Path,
    fs: &dyn ConfigFs,
) -> Result<ReadResult, AppError> {
    let entry = registry
        .get(id)
        .map_err(|_| AppError::not_found("未知的应用配置条目。"))?;
    Ok(read_entry(entry, home, fs))
}

fn builtin_registry() -> Result<Registry, AppError> {
    Registry::builtin().map_err(|_| AppError::validation_failed("应用配置注册表校验失败。"))
}

fn home_directory() -> Result<PathBuf, AppError> {
    canonical_home().ok_or_else(|| AppError::not_found("无法确定主目录，应用配置不可用。"))
}

#[tauri::command]
pub async fn app_config_schema(id: String) -> Result<EditSchema, AppError> {
    run_blocking(move || {
        let registry = builtin_registry()?;
        let entry = entry_by_id(&registry, &id)?;
        ensure_writable(entry)?;
        schema_for(entry.id, entry.format)
            .ok_or_else(|| AppError::not_supported("该应用配置暂不支持在应用内编辑。"))
    })
    .await
}

#[tauri::command]
pub async fn app_config_read_for_edit(id: String) -> Result<EditRead, AppError> {
    run_blocking(move || {
        let registry = builtin_registry()?;
        let entry = entry_by_id(&registry, &id)?;
        let home = home_directory()?;
        read_for_edit(entry, &home, &StdFs)
    })
    .await
}

#[tauri::command]
pub async fn app_config_preview_edit(
    app: AppHandle,
    input: PreviewInput,
) -> Result<PreviewResult, AppError> {
    let context = app.clone();
    run_blocking(move || {
        let registry = builtin_registry()?;
        let entry = entry_by_id(&registry, &input.id)?;
        let home = home_directory()?;
        preview(
            entry,
            &home,
            &StdFs,
            &context.state::<AppConfigEditState>(),
            &input,
        )
    })
    .await
}

#[tauri::command]
pub async fn app_config_confirm_edit(
    app: AppHandle,
    input: ConfirmInput,
) -> Result<ReadResult, AppError> {
    let context = app.clone();
    run_blocking(move || {
        let registry = builtin_registry()?;
        let home = home_directory()?;
        let config = context.state::<ConfigCoordinator>();
        let environment = config.environment()?;
        let retention = context
            .state::<SettingsCoordinator>()
            .get()?
            .preferences()
            .backup_retention();
        confirm(
            &registry,
            &home,
            &StdFs,
            &context.state::<AppConfigEditState>(),
            environment,
            retention,
            &input.preview_token,
        )
    })
    .await
}

async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| AppError::internal())?
}

fn entry_by_id<'a>(registry: &'a Registry, id: &str) -> Result<&'a Entry, AppError> {
    registry
        .get(id)
        .map_err(|_| AppError::not_found("未知的应用配置条目。"))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use serde_json::Value;

    use crate::{
        app_config::{
            discover::ProbeStatus,
            read::ReadResult,
            registry::{Category, Registry},
            test_support::FakeFs,
        },
        error::AppErrorCode,
    };

    use super::{list_entries, read_entry_by_id};

    const HOME: &str = "/Users/example";

    #[test]
    fn list_returns_every_non_ai_entry_in_registry_order() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new().dir(HOME);

        let items = list_entries(&registry, Path::new(HOME), &fs);

        let ids: Vec<&str> = items.iter().map(|item| item.summary.id.as_str()).collect();
        let expected: Vec<&str> = registry
            .entries()
            .iter()
            .filter(|entry| entry.category != Category::AiClient)
            .map(|entry| entry.id)
            .collect();
        assert_eq!(ids, expected);
        assert!(items.iter().all(|item| item.probe == ProbeStatus::NotFound));
    }

    #[test]
    fn list_never_contains_ai_client_entries() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new().dir(HOME);

        let items = list_entries(&registry, Path::new(HOME), &fs);

        assert!(items.iter().all(|item| item.summary.category != Category::AiClient));
        for id in ["claude-code-settings", "gemini-user-settings"] {
            assert!(items.iter().all(|item| item.summary.id != id), "{id}");
        }
    }

    #[test]
    fn ai_client_entries_stay_readable_by_id_for_the_ai_tool_page() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new()
            .dir(HOME)
            .file("/Users/example/.gemini/settings.json", "{\"theme\":\"dark\"}");

        let result = read_entry_by_id(&registry, "gemini-user-settings", Path::new(HOME), &fs)
            .expect("registered AI entry reads");

        assert!(matches!(result, ReadResult::Content { .. }));
    }

    #[test]
    fn one_unreadable_location_does_not_change_the_other_entries() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new()
            .dir(HOME)
            .file("/Users/example/.gitconfig", "[user]\nname = Ada\n")
            .dir("/Users/example/.config/zed")
            .denied("/Users/example/.config/zed");

        let items = list_entries(&registry, Path::new(HOME), &fs);

        let status = |id: &str| {
            items
                .iter()
                .find(|item| item.summary.id == id)
                .map(|item| item.probe)
                .expect("registered")
        };
        assert_eq!(status("zed-settings"), ProbeStatus::Inaccessible);
        assert!(matches!(status("git-config-home"), ProbeStatus::Found(_)));
    }

    #[test]
    fn list_output_never_contains_the_resolved_home_directory() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new()
            .dir(HOME)
            .file("/Users/example/.gitconfig", "[user]\n");

        let json = serde_json::to_string(&list_entries(&registry, Path::new(HOME), &fs))
            .expect("list serializes");

        assert!(json.contains("\"displayPath\":\"~/.gitconfig\""));
        assert!(!json.contains("/Users/example"));
    }

    #[test]
    fn read_refuses_unknown_ids_and_path_like_ids_with_a_typed_not_found_error() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new().dir(HOME).forbid_reads();

        for id in [
            "",
            "git-config-homeX",
            "Git-Config-Home",
            "/Users/example/.gitconfig",
            "~/.gitconfig",
            "../etc/passwd",
        ] {
            let error = read_entry_by_id(&registry, id, Path::new(HOME), &fs)
                .expect_err("unknown id must be refused");
            assert!(matches!(error.code(), AppErrorCode::NotFound), "id {id:?}");
        }
    }

    #[test]
    fn read_by_known_id_returns_the_masked_view() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new().dir(HOME).file(
            "/Users/example/.gitconfig",
            "[user]\nname = Ada\n[remote \"origin\"]\nurl = https://ada:hunter2@example.com/r.git\n",
        );

        let result = read_entry_by_id(&registry, "git-config-home", Path::new(HOME), &fs)
            .expect("known id reads");

        let ReadResult::Content { view } = result else {
            panic!("expected content");
        };
        assert!(view.text.contains("Ada"));
        assert!(!view.text.contains("hunter2"));
    }

    #[test]
    fn read_by_credential_id_returns_metadata_and_never_opens_the_file() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new()
            .dir(HOME)
            .file(
                "/Users/example/.git-credentials",
                "https://ada:hunter2@github.com\n",
            )
            .forbid_reads();

        let result = read_entry_by_id(&registry, "git-credentials", Path::new(HOME), &fs)
            .expect("known id resolves");

        assert!(matches!(result, ReadResult::MetadataOnly { .. }));
        let json = serde_json::to_value(&result).expect("result serializes");
        assert_eq!(json["outcome"], Value::String("metadataOnly".to_owned()));
        assert!(!json.to_string().contains("hunter2"));
    }

    #[test]
    fn fixed_ssh_config_is_readable_through_the_command_path() {
        let registry = Registry::builtin().expect("built-in registry is valid");
        let fs = FakeFs::new().file("/etc/ssh/ssh_config", "Host *\n");

        let result = read_entry_by_id(&registry, "ssh-system-config", Path::new(HOME), &fs)
            .expect("known id reads");

        assert!(matches!(result, ReadResult::Content { .. }));
    }
}
