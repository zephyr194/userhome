use std::{fs, path::Path};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    catalog::{Catalog, ConfigFormatFamily},
    error::AppError,
};

pub use super::resolution::{
    ConfigDiagnostic, ConfigDocumentState, ConfigEntryKind, ConfigNextAction, ConfigSummary,
    ConfigVariantResolution, resolve_config_variants,
};
use super::{
    ConfigEnvironment,
    resolution::{resolve_variants, selected_variant_index, set_summary_state},
    resolve_definition,
    validation::validate_text_bytes,
};

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

    pub fn diagnostic(&self) -> &ConfigDiagnostic {
        &self.summary.diagnostic
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
        .map(|definition| {
            read_config_result(catalog, environment, app_id, definition.config_id(), None)
                .map(|document| document.summary)
        })
        .collect()
}

pub fn read_config(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
) -> Result<ConfigDocument, AppError> {
    let document = read_config_result(catalog, environment, app_id, config_id, None)?;
    if document.diagnostic().state.is_readable() {
        return Ok(document);
    }
    Err(document.diagnostic().state.as_app_error())
}

pub fn read_config_result(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
    variant_id: Option<&str>,
) -> Result<ConfigDocument, AppError> {
    let definition = resolve_definition(catalog, app_id, config_id)?;
    let mut variants = resolve_variants(app_id, definition, environment);
    let index = selected_variant_index(&variants, variant_id)?;
    let mut resolved = variants.swap_remove(index);
    if resolved.summary.diagnostic.state != ConfigDocumentState::Ready {
        return Ok(ConfigDocument {
            summary: resolved.summary,
            content: None,
            content_redacted: false,
            structured: None,
        });
    }
    if resolved.summary.entry_kind != Some(ConfigEntryKind::File) {
        set_summary_state(
            &mut resolved.summary,
            ConfigDocumentState::UnsupportedFormat,
        );
        return Ok(ConfigDocument {
            summary: resolved.summary,
            content: None,
            content_redacted: false,
            structured: None,
        });
    }
    if definition.is_read_only() && definition.format_family() == ConfigFormatFamily::Plist {
        let state = if resolved
            .summary
            .size_bytes
            .is_some_and(|size| size > definition.max_size_bytes() as u64)
        {
            ConfigDocumentState::TooLarge
        } else {
            ConfigDocumentState::Redacted
        };
        set_summary_state(&mut resolved.summary, state);
        return Ok(ConfigDocument {
            summary: resolved.summary,
            content: None,
            content_redacted: state == ConfigDocumentState::Redacted,
            structured: None,
        });
    }

    let Some(target_path) = resolved.target_path else {
        set_summary_state(&mut resolved.summary, ConfigDocumentState::IoError);
        return Ok(ConfigDocument {
            summary: resolved.summary,
            content: None,
            content_redacted: false,
            structured: None,
        });
    };
    let bytes = match read_bounded_for_diagnostic(&target_path, definition.max_size_bytes()) {
        Ok(bytes) => bytes,
        Err(state) => {
            set_summary_state(&mut resolved.summary, state);
            return Ok(ConfigDocument {
                summary: resolved.summary,
                content: None,
                content_redacted: false,
                structured: None,
            });
        }
    };
    resolved.summary.content_hash = (!definition.is_read_only()).then(|| hash_bytes(&bytes));
    let text = match validate_text_bytes(definition, &bytes) {
        Ok(text) => text,
        Err(error) => {
            set_summary_state(
                &mut resolved.summary,
                ConfigDocumentState::from_app_error(&error),
            );
            return Ok(ConfigDocument {
                summary: resolved.summary,
                content: None,
                content_redacted: false,
                structured: None,
            });
        }
    };
    let view = match super::adapters::inspect(definition, text) {
        Ok(view) => view,
        Err(error) => {
            set_summary_state(
                &mut resolved.summary,
                ConfigDocumentState::from_app_error(&error),
            );
            return Ok(ConfigDocument {
                summary: resolved.summary,
                content: None,
                content_redacted: false,
                structured: None,
            });
        }
    };
    let state = if view.content_redacted {
        ConfigDocumentState::Redacted
    } else {
        ConfigDocumentState::Ready
    };
    set_summary_state(&mut resolved.summary, state);

    Ok(ConfigDocument {
        summary: resolved.summary,
        content: view.content,
        content_redacted: view.content_redacted,
        structured: view.structured,
    })
}

pub fn diagnose_config(
    catalog: &Catalog,
    environment: &ConfigEnvironment,
    app_id: &str,
    config_id: &str,
    variant_id: Option<&str>,
) -> Result<ConfigDiagnostic, AppError> {
    read_config_result(catalog, environment, app_id, config_id, variant_id)
        .map(|document| document.summary.diagnostic)
}

fn read_bounded_for_diagnostic(
    path: &Path,
    max_size: usize,
) -> Result<Vec<u8>, ConfigDocumentState> {
    let metadata =
        fs::metadata(path).map_err(|error| ConfigDocumentState::from_io_kind(error.kind()))?;
    if metadata.len() > max_size as u64 {
        return Err(ConfigDocumentState::TooLarge);
    }
    let bytes = fs::read(path).map_err(|error| ConfigDocumentState::from_io_kind(error.kind()))?;
    if bytes.len() > max_size {
        return Err(ConfigDocumentState::TooLarge);
    }
    Ok(bytes)
}

pub(crate) fn read_bounded(path: &Path, max_size: usize) -> Result<Vec<u8>, AppError> {
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

    use super::{
        super::{ConfigEnvironment, resolution::diagnostic},
        ConfigDocumentState, ConfigNextAction, list_configs, read_config, read_config_result,
        resolve_config_variants,
    };

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

        let diagnostic = read_config_result(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment(),
            "visual-studio-code",
            "visual-studio-code-settings",
            None,
        )
        .expect("typed invalid result");
        assert_eq!(diagnostic.diagnostic().state, ConfigDocumentState::Invalid);
        assert!(diagnostic.content().is_none());
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

    #[test]
    fn returns_only_metadata_for_binary_plists() {
        let fixture = Fixture::new();
        let preferences = fixture.home.join("Library/Preferences");
        fs::create_dir_all(&preferences).expect("create preferences directory");
        fs::write(
            preferences.join("com.googlecode.iterm2.plist"),
            [
                0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30, 0xd2, 0x01, 0x02, 0x03, 0x04, 0x55,
                0x54, 0x68, 0x65, 0x6d, 0x65, 0x55, 0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x54, 0x44, 0x61,
                0x72, 0x6b, 0x5f, 0x10, 0x0f, 0x6d, 0x75, 0x73, 0x74, 0x2d, 0x6e, 0x6f, 0x74, 0x2d,
                0x72, 0x65, 0x74, 0x75, 0x72, 0x6e, 0x08, 0x0d, 0x13, 0x19, 0x1e, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x05, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x30,
            ],
        )
        .expect("write binary plist");

        let document = read_config(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment(),
            "iterm2",
            "iterm2-preferences",
        )
        .expect("read plist metadata");
        let encoded = serde_json::to_string(&document).expect("serialize document");

        assert_eq!(document.diagnostic().state(), ConfigDocumentState::Redacted);
        assert!(document.content().is_none());
        assert!(encoded.contains("\"writePolicy\":\"READ_ONLY\""));
        assert!(encoded.contains("\"contentHash\":null"));
        assert!(!encoded.contains("must-not-return"));
    }

    #[test]
    fn resolves_the_first_existing_variant_without_exposing_absolute_paths() {
        let fixture = Fixture::new();
        fs::write(fixture.home.join(".starship.toml"), b"format = '$all'\n")
            .expect("write fallback config");
        let mut value: Value =
            serde_json::from_str(BUILTIN_CATALOG_JSON).expect("built-in catalog");
        let document = &mut value["apps"][9]["configDocuments"][0];
        document["pathVariants"] = serde_json::json!([
            {
                "variantId": "xdg",
                "root": "XDG_CONFIG_HOME",
                "relativePath": "starship.toml",
                "existenceRule": "FILE",
                "precedence": 0
            },
            {
                "variantId": "home",
                "root": "HOME",
                "relativePath": ".starship.toml",
                "existenceRule": "FILE",
                "precedence": 1
            }
        ]);
        let catalog = parse_catalog(&serde_json::to_string(&value).expect("serialize catalog"))
            .expect("variant catalog");

        let variants = resolve_config_variants(
            &catalog,
            &fixture.environment(),
            "starship",
            "starship-config",
        )
        .expect("resolve variants");
        let encoded = serde_json::to_string(&variants).expect("serialize variants");

        assert_eq!(variants.len(), 2);
        assert_eq!(
            variants[0].summary().diagnostic.state,
            ConfigDocumentState::Missing
        );
        assert!(!variants[0].selected());
        assert_eq!(
            variants[1].summary().diagnostic.state,
            ConfigDocumentState::Ready
        );
        assert!(variants[1].selected());
        assert!(encoded.contains("XDG_CONFIG_HOME/starship.toml"));
        assert!(encoded.contains("~/.starship.toml"));
        assert!(!encoded.contains(&fixture.home.to_string_lossy().to_string()));
    }

    #[test]
    fn malformed_document_does_not_block_other_config_summaries() {
        let fixture = Fixture::new();
        for channel in ["Code", "Code - Insiders"] {
            fs::create_dir_all(
                fixture
                    .home
                    .join(format!("Library/Application Support/{channel}/User")),
            )
            .expect("create settings directory");
        }
        fs::write(
            fixture
                .home
                .join("Library/Application Support/Code/User/settings.json"),
            br#"{"editor.fontSize":14}"#,
        )
        .expect("write valid settings");
        fs::write(
            fixture
                .home
                .join("Library/Application Support/Code - Insiders/User/settings.json"),
            br#"{"apiToken":"unterminated}"#,
        )
        .expect("write invalid settings");

        let summaries = list_configs(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment(),
            "visual-studio-code",
        )
        .expect("list configs");

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].diagnostic.state, ConfigDocumentState::Ready);
        assert_eq!(summaries[1].diagnostic.state, ConfigDocumentState::Invalid);
    }

    #[test]
    fn classifies_oversized_unsafe_and_unsupported_entries() {
        let fixture = Fixture::new();
        fs::write(fixture.home.join(".gitconfig"), b"[user]\nname = Example\n")
            .expect("write oversized config");
        let mut value: Value =
            serde_json::from_str(BUILTIN_CATALOG_JSON).expect("built-in catalog");
        value["apps"][2]["configDocuments"][0]["maxSizeBytes"] = Value::from(1);
        let small_limit_catalog =
            parse_catalog(&serde_json::to_string(&value).expect("serialize catalog"))
                .expect("small-limit catalog");
        let oversized = read_config_result(
            &small_limit_catalog,
            &fixture.environment(),
            "git",
            "git-global-config",
            None,
        )
        .expect("oversized result");
        assert_eq!(
            oversized.diagnostic().state(),
            ConfigDocumentState::TooLarge
        );

        fs::remove_file(fixture.home.join(".gitconfig")).expect("remove config");
        let outside = fixture.root.join("outside-gitconfig");
        fs::write(&outside, b"[user]\n").expect("write outside config");
        symlink(&outside, fixture.home.join(".gitconfig")).expect("create unsafe symlink");
        let unsafe_link = read_config_result(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment(),
            "git",
            "git-global-config",
            None,
        )
        .expect("unsafe result");
        assert_eq!(
            unsafe_link.diagnostic().state(),
            ConfigDocumentState::UnsafeSymlink
        );

        fs::create_dir_all(fixture.home.join(".config/starship.toml"))
            .expect("create unsupported directory");
        let mut value: Value =
            serde_json::from_str(BUILTIN_CATALOG_JSON).expect("built-in catalog");
        let starship = &mut value["apps"][9]["configDocuments"][0];
        starship["format"] = Value::String("MARKDOWN_DIRECTORY".to_owned());
        starship["formatFamily"] = Value::String("PLAIN_TEXT".to_owned());
        starship["pathVariants"][0]["existenceRule"] = Value::String("DIRECTORY".to_owned());
        let directory_catalog =
            parse_catalog(&serde_json::to_string(&value).expect("serialize catalog"))
                .expect("directory catalog");
        let unsupported = read_config_result(
            &directory_catalog,
            &fixture.environment(),
            "starship",
            "starship-config",
            None,
        )
        .expect("unsupported result");
        assert_eq!(
            unsupported.diagnostic().state(),
            ConfigDocumentState::UnsupportedFormat
        );
    }

    #[test]
    fn every_diagnostic_state_has_a_safe_action_and_retry_policy() {
        let catalog = load_builtin_catalog().expect("catalog");
        let definition = catalog
            .config_document("git", "git-global-config")
            .expect("definition")
            .1;
        let cases = [
            (
                ConfigDocumentState::Missing,
                ConfigNextAction::CreateFile,
                false,
            ),
            (ConfigDocumentState::Ready, ConfigNextAction::None, false),
            (
                ConfigDocumentState::Invalid,
                ConfigNextAction::FixContent,
                false,
            ),
            (
                ConfigDocumentState::Redacted,
                ConfigNextAction::ViewRedacted,
                false,
            ),
            (
                ConfigDocumentState::TooLarge,
                ConfigNextAction::ReduceSize,
                false,
            ),
            (
                ConfigDocumentState::PermissionDenied,
                ConfigNextAction::ReviewPermissions,
                false,
            ),
            (
                ConfigDocumentState::UnsafeSymlink,
                ConfigNextAction::RepairSymlink,
                false,
            ),
            (
                ConfigDocumentState::UnsupportedFormat,
                ConfigNextAction::UpdateCatalog,
                false,
            ),
            (ConfigDocumentState::IoError, ConfigNextAction::Retry, true),
        ];

        for (state, next_action, retryable) in cases {
            let diagnostic = diagnostic(
                "git",
                definition,
                "primary",
                "~/.gitconfig".to_owned(),
                state,
            );
            let encoded = serde_json::to_string(&diagnostic).expect("serialize diagnostic");
            assert_eq!(diagnostic.next_action(), next_action);
            assert_eq!(diagnostic.retryable(), retryable);
            assert!(!encoded.contains("/Users/"));
            assert!(!encoded.contains("content"));
        }
    }
}
