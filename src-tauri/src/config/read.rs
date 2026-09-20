use std::{fs, os::unix::fs::PermissionsExt, time::UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    catalog::{Catalog, ConfigDocumentDefinition},
    error::AppError,
};

use super::{ConfigEnvironment, resolve_definition, resolve_path, validation::validate_text_bytes};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConfigEntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSymlink {
    target_display_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSummary {
    app_id: String,
    config_id: String,
    display_path: String,
    format: String,
    sensitivity: String,
    write_policy: String,
    exists: bool,
    entry_kind: Option<ConfigEntryKind>,
    size_bytes: Option<u64>,
    modified_at_epoch_ms: Option<u64>,
    mode: Option<u32>,
    content_hash: Option<String>,
    symlink: Option<ConfigSymlink>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDocument {
    #[serde(flatten)]
    summary: ConfigSummary,
    content: Option<String>,
    content_redacted: bool,
    structured: Option<Value>,
}

impl ConfigDocument {
    pub(crate) fn content(&self) -> Option<&str> {
        self.content.as_deref()
    }
}

pub fn list_configs(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    app_id: &str,
) -> Result<Vec<ConfigSummary>, AppError> {
    let app = catalog
        .apps()
        .iter()
        .find(|app| app.id() == app_id)
        .ok_or_else(|| AppError::not_found("Managed application was not found."))?;
    app.config_documents()
        .iter()
        .map(|definition| summarize(app_id, definition, environment))
        .collect()
}

pub fn read_config(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
) -> Result<ConfigDocument, AppError> {
    let definition = resolve_definition(catalog, app_id, config_id)?;
    let summary = summarize(app_id, definition, environment)?;
    if !summary.exists {
        return Err(AppError::not_found(
            "Configuration document does not exist.",
        ));
    }
    if summary.entry_kind != Some(ConfigEntryKind::File) {
        return Ok(ConfigDocument {
            summary,
            content: None,
            content_redacted: true,
            structured: None,
        });
    }

    let resolved = resolve_path(definition, environment)?;
    let bytes = read_bounded(&resolved.target_path, definition.max_size_bytes())?;
    let text = validate_text_bytes(definition, &bytes)?;
    let view = super::adapters::inspect(definition, text)?;
    Ok(ConfigDocument {
        summary,
        content: view.content,
        content_redacted: view.content_redacted,
        structured: view.structured,
    })
}

pub(crate) fn summarize(
    app_id: &str,
    definition: &ConfigDocumentDefinition,
    environment: &ConfigEnvironment,
) -> Result<ConfigSummary, AppError> {
    let resolved = match resolve_path(definition, environment) {
        Ok(path) => path,
        Err(error) if error.code() == crate::error::AppErrorCode::NotFound => {
            return Ok(ConfigSummary {
                app_id: app_id.to_owned(),
                config_id: definition.config_id().to_owned(),
                display_path: definition.path_template().to_owned(),
                format: definition.format().to_owned(),
                sensitivity: definition.sensitivity().to_owned(),
                write_policy: definition.write_policy().to_owned(),
                exists: false,
                entry_kind: None,
                size_bytes: None,
                modified_at_epoch_ms: None,
                mode: None,
                content_hash: None,
                symlink: None,
            });
        }
        Err(error) => return Err(error),
    };
    let metadata = fs::metadata(&resolved.target_path)
        .map_err(|_| AppError::not_found("Configuration document is unavailable."))?;
    let entry_kind = if metadata.is_file() {
        ConfigEntryKind::File
    } else if metadata.is_dir() {
        ConfigEntryKind::Directory
    } else {
        return Err(AppError::permission_denied(
            "Configuration entry type is not authorized.",
        ));
    };
    let (size_bytes, content_hash) = if entry_kind == ConfigEntryKind::File {
        if metadata.len() > definition.max_size_bytes() as u64 {
            return Err(AppError::validation_failed(
                "Configuration exceeds the catalog size limit.",
            ));
        }
        let bytes = read_bounded(&resolved.target_path, definition.max_size_bytes())?;
        (
            Some(bytes.len() as u64),
            (!definition.is_read_only()).then(|| hash_bytes(&bytes)),
        )
    } else {
        (None, None)
    };
    let modified_at_epoch_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis().min(u128::from(u64::MAX)) as u64);

    Ok(ConfigSummary {
        app_id: app_id.to_owned(),
        config_id: definition.config_id().to_owned(),
        display_path: resolved.display_path,
        format: definition.format().to_owned(),
        sensitivity: definition.sensitivity().to_owned(),
        write_policy: definition.write_policy().to_owned(),
        exists: true,
        entry_kind: Some(entry_kind),
        size_bytes,
        modified_at_epoch_ms,
        mode: Some(metadata.permissions().mode() & 0o777),
        content_hash,
        symlink: resolved
            .symlink_target
            .map(|target_display_path| ConfigSymlink {
                target_display_path,
            }),
    })
}

pub(crate) fn read_bounded(path: &std::path::Path, max_size: usize) -> Result<Vec<u8>, AppError> {
    let metadata = fs::metadata(path)
        .map_err(|_| AppError::not_found("Configuration document is unavailable."))?;
    if metadata.len() > max_size as u64 {
        return Err(AppError::validation_failed(
            "Configuration exceeds the catalog size limit.",
        ));
    }
    let bytes =
        fs::read(path).map_err(|_| AppError::permission_denied("Configuration cannot be read."))?;
    if bytes.len() > max_size {
        return Err(AppError::validation_failed(
            "Configuration exceeds the catalog size limit.",
        ));
    }
    Ok(bytes)
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
        path::PathBuf,
    };

    use serde_json::Value;
    use uuid::Uuid;

    use crate::catalog::{BUILTIN_CATALOG_JSON, load_builtin_catalog, parse_catalog};

    use super::{super::ConfigEnvironment, read_config};

    struct Fixture {
        root: PathBuf,
        home: PathBuf,
        brew: PathBuf,
        backup: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-read-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            let backup = root.join("backups");
            fs::create_dir_all(home.join("dotfiles")).expect("create home");
            fs::create_dir_all(&brew).expect("create brew");
            Self {
                root,
                home,
                brew,
                backup,
            }
        }

        fn environment(&self) -> ConfigEnvironment {
            ConfigEnvironment::new(self.home.clone(), self.brew.clone(), self.backup.clone())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn reads_catalog_owned_file_with_bounded_metadata_and_redaction() {
        let fixture = Fixture::new();
        let target = fixture.home.join("dotfiles/gitconfig");
        fs::write(
            &target,
            b"[user]\nname = Example\npassword = do-not-return\n",
        )
        .expect("write config");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).expect("set permissions");
        symlink("dotfiles/gitconfig", fixture.home.join(".gitconfig")).expect("create symlink");

        let document = read_config(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment(),
            "git",
            "git-global-config",
        )
        .expect("read config");
        let encoded = serde_json::to_string(&document).expect("serialize document");

        assert!(encoded.contains("\"displayPath\":\"~/.gitconfig\""));
        assert!(encoded.contains("\"targetDisplayPath\":\"~/dotfiles/gitconfig\""));
        assert!(encoded.contains("\"mode\":416"));
        assert!(encoded.contains("[user]"));
        assert!(encoded.contains("name = Example"));
        assert!(!encoded.contains("do-not-return"));
    }

    #[test]
    fn never_reads_uncatalogued_or_secret_document_content() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.home.join(".copilot")).expect("create copilot");
        fs::write(
            fixture.home.join(".copilot/mcp-config.json"),
            br#"{"token":"do-not-return"}"#,
        )
        .expect("write secret config");
        fs::write(fixture.home.join(".ssh-private-key"), b"PRIVATE").expect("write excluded file");

        let catalog = load_builtin_catalog().expect("catalog");
        let document = read_config(
            &catalog,
            &fixture.environment(),
            "github-copilot",
            "copilot-mcp-config",
        )
        .expect("read secret metadata");
        let encoded = serde_json::to_string(&document).expect("serialize document");
        assert!(encoded.contains("[REDACTED]"));
        assert!(!encoded.contains("do-not-return"));

        let error = read_config(&catalog, &fixture.environment(), "openssh", "private-key")
            .expect_err("reject arbitrary config identifier");
        assert_eq!(error.code(), crate::error::AppErrorCode::NotFound);
    }

    #[test]
    fn redacts_compact_json_in_generic_sensitive_read_only_config() {
        let fixture = Fixture::new();
        let settings_dir = fixture.home.join("Library/Application Support/Code/User");
        fs::create_dir_all(&settings_dir).expect("create settings directory");
        fs::write(
            settings_dir.join("settings.json"),
            br#"{"editor.fontSize":14,"extension":{"apiToken":"compact-secret"}}"#,
        )
        .expect("write settings");

        let document = read_config(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment(),
            "visual-studio-code",
            "visual-studio-code-settings",
        )
        .expect("read settings");
        let encoded = serde_json::to_string(&document).expect("serialize document");

        assert!(encoded.contains("editor.fontSize"));
        assert!(encoded.contains("[REDACTED]"));
        assert!(!encoded.contains("compact-secret"));

        fs::write(
            settings_dir.join("settings.json"),
            br#"{"apiToken":"unterminated}"#,
        )
        .expect("write invalid settings");
        let error = read_config(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment(),
            "visual-studio-code",
            "visual-studio-code-settings",
        )
        .expect_err("reject invalid settings JSON");
        assert_eq!(error.code(), crate::error::AppErrorCode::ValidationFailed);
    }

    #[test]
    fn hides_command_style_sensitive_read_only_content() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.home.join(".config/ghostty")).expect("create ghostty config");
        fs::write(
            fixture.home.join(".tmux.conf"),
            b"set-environment -g API_TOKEN tmux-secret\n",
        )
        .expect("write tmux config");
        fs::write(
            fixture.home.join(".vimrc"),
            b"let g:api_token = 'vim-secret'\n",
        )
        .expect("write vim config");
        fs::write(
            fixture.home.join(".config/ghostty/config"),
            b"command = env API_TOKEN=ghostty-secret shell\n",
        )
        .expect("write ghostty config");

        let catalog = load_builtin_catalog().expect("catalog");
        for (app_id, config_id, secret) in [
            ("tmux", "tmux-config", "tmux-secret"),
            ("vim", "vimrc", "vim-secret"),
            ("ghostty", "ghostty-xdg-config", "ghostty-secret"),
        ] {
            let document = read_config(&catalog, &fixture.environment(), app_id, config_id)
                .expect("read config");
            let encoded = serde_json::to_string(&document).expect("serialize document");

            assert!(document.content().is_none());
            assert!(!encoded.contains(secret));
        }
    }

    #[test]
    fn preserves_standard_read_only_content() {
        let fixture = Fixture::new();
        fs::write(fixture.home.join(".tmux.conf"), b"set -g mouse on\n")
            .expect("write tmux config");
        let mut value: Value =
            serde_json::from_str(BUILTIN_CATALOG_JSON).expect("built-in catalog");
        let tmux = value["apps"]
            .as_array_mut()
            .expect("apps")
            .iter_mut()
            .find(|app| app["id"] == "tmux")
            .expect("tmux");
        tmux["configDocuments"][0]["sensitivity"] = Value::String("STANDARD".to_owned());
        let catalog = parse_catalog(&serde_json::to_string(&value).expect("serialize catalog"))
            .expect("standard read-only catalog");

        let document = read_config(&catalog, &fixture.environment(), "tmux", "tmux-config")
            .expect("read config");

        assert_eq!(document.content(), Some("set -g mouse on\n"));
    }
}
