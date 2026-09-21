use serde_json::{Value, json};
use userhome_lib::{
    catalog::{
        BUILTIN_CATALOG_JSON, CATALOG_SCHEMA_VERSION, CatalogCoverageClass, CatalogValidationError,
        MAX_CATALOG_BYTES, MAX_CONFIG_DOCUMENT_BYTES, parse_catalog,
    },
    commands::catalog::list_managed_apps,
};

fn mutate_catalog(mutator: impl FnOnce(&mut Value)) -> String {
    let mut document: Value =
        serde_json::from_str(BUILTIN_CATALOG_JSON).expect("built-in catalog should be valid JSON");
    mutator(&mut document);
    serde_json::to_string(&document).expect("mutated catalog should serialize")
}

fn stable_hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}

#[test]
fn catalog_preserves_existing_definitions_and_adds_the_editor_terminal_batch() {
    let catalog = parse_catalog(BUILTIN_CATALOG_JSON).expect("built-in catalog should validate");
    let t58_start = BUILTIN_CATALOG_JSON
        .find(",\n    {\n      \"id\": \"zed\"")
        .expect("T58 catalog batch");
    let ids = catalog
        .apps()
        .iter()
        .map(|app| app.id())
        .collect::<Vec<_>>();

    assert_eq!(
        stable_hash(BUILTIN_CATALOG_JSON[..t58_start].as_bytes()),
        0x2bde398b0bddd10f
    );
    assert_eq!(catalog.schema_version(), CATALOG_SCHEMA_VERSION);
    assert_eq!(
        ids[..6],
        ["github-copilot", "caddy", "git", "openssh", "zsh", "npm",]
    );
    assert_eq!(
        ids[6..12],
        [
            "visual-studio-code",
            "cursor",
            "ghostty",
            "starship",
            "tmux",
            "vim",
        ]
    );
    assert_eq!(ids[12..], ["zed", "neovim", "iterm2"]);
    for app in &catalog.apps()[..6] {
        assert_eq!(app.coverage_class(), CatalogCoverageClass::ManagedWritable);
        assert!(
            app.capabilities()
                .iter()
                .any(|value| value == "WRITE_CONFIG")
        );
    }
    for app in &catalog.apps()[6..] {
        assert_eq!(app.coverage_class(), CatalogCoverageClass::ManagedReadOnly);
        assert!(
            !app.capabilities()
                .iter()
                .any(|value| value == "WRITE_CONFIG")
        );
        assert!(
            app.config_documents()
                .iter()
                .all(|document| document.is_read_only())
        );
    }

    let existing_read_only_documents = [
        (
            "visual-studio-code",
            vec![
                (
                    "visual-studio-code-settings",
                    "~/Library/Application Support/Code/User/settings.json",
                ),
                (
                    "visual-studio-code-insiders-settings",
                    "~/Library/Application Support/Code - Insiders/User/settings.json",
                ),
            ],
        ),
        (
            "cursor",
            vec![(
                "cursor-settings",
                "~/Library/Application Support/Cursor/User/settings.json",
            )],
        ),
        (
            "ghostty",
            vec![
                (
                    "ghostty-macos-config",
                    "~/Library/Application Support/com.mitchellh.ghostty/config",
                ),
                ("ghostty-xdg-config", "~/.config/ghostty/config"),
            ],
        ),
        (
            "starship",
            vec![("starship-config", "~/.config/starship.toml")],
        ),
        (
            "tmux",
            vec![
                ("tmux-config", "~/.tmux.conf"),
                ("tmux-xdg-config", "~/.config/tmux/tmux.conf"),
            ],
        ),
        (
            "vim",
            vec![
                ("vimrc", "~/.vimrc"),
                ("vim-runtime-config", "~/.vim/vimrc"),
            ],
        ),
    ];
    for (app_id, expected_documents) in existing_read_only_documents {
        let app = catalog
            .apps()
            .iter()
            .find(|app| app.id() == app_id)
            .expect("existing read-only application");
        let actual_documents = app
            .config_documents()
            .iter()
            .map(|document| (document.config_id(), document.path_template()))
            .collect::<Vec<_>>();
        assert_eq!(actual_documents, expected_documents);
    }

    let expected_new_documents = [
        (
            "zed",
            vec![("zed-settings", "zed/settings.json", "JSONC")],
            "SECRET",
        ),
        (
            "neovim",
            vec![
                ("neovim-init-lua", "nvim/init.lua", "TEXT"),
                ("neovim-init-vim", "nvim/init.vim", "TEXT"),
            ],
            "SENSITIVE",
        ),
        (
            "iterm2",
            vec![(
                "iterm2-preferences",
                "Library/Preferences/com.googlecode.iterm2.plist",
                "PLIST",
            )],
            "SENSITIVE",
        ),
    ];
    for (app_id, expected_documents, expected_sensitivity) in expected_new_documents {
        let app = catalog
            .apps()
            .iter()
            .find(|app| app.id() == app_id)
            .expect("new read-only application");
        assert!(
            app.detection_rules()
                .iter()
                .any(|rule| rule.kind() == "HOME_PATH")
        );
        let actual_documents = app
            .config_documents()
            .iter()
            .map(|document| {
                (
                    document.config_id(),
                    document.path_variants()[0].relative_path(),
                    document.format(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(actual_documents, expected_documents);
        assert!(
            app.config_documents()
                .iter()
                .all(|document| document.sensitivity() == expected_sensitivity)
        );
    }
    assert!(
        catalog
            .apps()
            .iter()
            .flat_map(|app| app.config_documents())
            .any(|document| document.path_template() == "${HOMEBREW_PREFIX}/etc/Caddyfile")
    );
    let copilot_paths = catalog
        .apps()
        .iter()
        .find(|app| app.id() == "github-copilot")
        .expect("copilot")
        .config_documents()
        .iter()
        .map(|document| document.path_template())
        .collect::<Vec<_>>();
    assert_eq!(
        copilot_paths,
        [
            "~/.copilot/config.json",
            "~/.copilot/settings.json",
            "~/.copilot/mcp-config.json",
            "~/.copilot/permissions-config.json",
            "~/.copilot/copilot-instructions.md",
        ]
    );
    for excluded in ["logs", "sessions", "cache", "state.db", "token", "lock"] {
        assert!(
            copilot_paths.iter().all(|path| !path.contains(excluded)),
            "excluded Copilot runtime path appeared in catalog: {excluded}"
        );
    }
}

#[test]
fn catalog_ipc_summary_exposes_only_sanitized_path_variants() {
    let response = list_managed_apps().expect("catalog command should succeed");
    let serialized = serde_json::to_value(response).expect("catalog response should serialize");
    let encoded = serialized.to_string();

    assert_eq!(serialized["schemaVersion"], json!(CATALOG_SCHEMA_VERSION));
    assert_eq!(
        serialized["applications"]
            .as_array()
            .expect("applications should be an array")
            .len(),
        15
    );
    assert!(encoded.contains("pathVariants"));
    assert!(encoded.contains("HOMEBREW_PREFIX"));
    assert!(!encoded.contains("pathTemplate"));
    assert!(!encoded.contains("~/."));
    assert!(!encoded.contains("/Users/"));
}

#[test]
fn catalog_rejects_duplicate_application_and_config_ids() {
    let duplicate_app = mutate_catalog(|document| {
        document["apps"][1]["id"] = json!("github-copilot");
    });
    assert_eq!(
        parse_catalog(&duplicate_app),
        Err(CatalogValidationError::DuplicateAppId)
    );

    let duplicate_config = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][1]["configId"] = json!("copilot-config");
    });
    assert_eq!(
        parse_catalog(&duplicate_config),
        Err(CatalogValidationError::DuplicateConfigId)
    );
}

#[test]
fn catalog_rejects_unsafe_paths_and_missing_adapters() {
    let unsafe_path = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["pathTemplate"] =
            json!("~/.copilot/../../.ssh/id_rsa");
    });
    assert_eq!(
        parse_catalog(&unsafe_path),
        Err(CatalogValidationError::UnsafePath)
    );

    let absolute_variant = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["pathVariants"][0]["relativePath"] =
            json!("/Users/example/.copilot/config.json");
    });
    assert_eq!(
        parse_catalog(&absolute_variant),
        Err(CatalogValidationError::UnsafePath)
    );

    let missing_adapter = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["adapterId"] = json!("");
    });
    assert_eq!(
        parse_catalog(&missing_adapter),
        Err(CatalogValidationError::MissingAdapter)
    );
}

#[test]
fn catalog_accepts_bounded_variants_for_every_approved_root() {
    let source = mutate_catalog(|catalog| {
        catalog["apps"][9]["configDocuments"][0]["pathVariants"] = json!([
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
            },
            {
                "variantId": "application-support",
                "root": "APPLICATION_SUPPORT",
                "relativePath": "Starship/config.toml",
                "existenceRule": "FILE",
                "precedence": 2
            },
            {
                "variantId": "homebrew",
                "root": "HOMEBREW_PREFIX",
                "relativePath": "etc/starship.toml",
                "existenceRule": "FILE",
                "precedence": 3
            },
            {
                "variantId": "app-support",
                "root": "APP_SUPPORT",
                "relativePath": "catalog/starship.toml",
                "existenceRule": "FILE",
                "precedence": 4
            }
        ]);
    });

    let catalog = parse_catalog(&source).expect("approved roots should validate");
    let variants = catalog.apps()[9].config_documents()[0].path_variants();
    assert_eq!(variants.len(), 5);
    assert_eq!(variants[0].precedence(), 0);
    assert_eq!(variants[4].precedence(), 4);
}

#[test]
fn catalog_rejects_unbounded_documents_and_unknown_write_policies() {
    let zero_size = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["maxSizeBytes"] = json!(0);
    });
    assert_eq!(
        parse_catalog(&zero_size),
        Err(CatalogValidationError::UnboundedDocument)
    );

    let oversized_config = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["maxSizeBytes"] =
            json!(MAX_CONFIG_DOCUMENT_BYTES + 1);
    });
    assert_eq!(
        parse_catalog(&oversized_config),
        Err(CatalogValidationError::UnboundedDocument)
    );

    let unknown_policy = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["writePolicy"] = json!("ARBITRARY_WRITE");
    });
    assert_eq!(
        parse_catalog(&unknown_policy),
        Err(CatalogValidationError::UnsupportedWritePolicy)
    );
}

#[test]
fn catalog_rejects_unknown_document_capability_classes() {
    let cases = [
        (
            "pathVariants",
            "root",
            json!("ARBITRARY_ROOT"),
            CatalogValidationError::UnsupportedRoot,
        ),
        (
            "pathVariants",
            "existenceRule",
            json!("MAYBE"),
            CatalogValidationError::UnsupportedExistenceRule,
        ),
        (
            "document",
            "format",
            json!("ARBITRARY"),
            CatalogValidationError::UnsupportedFormat,
        ),
        (
            "document",
            "formatFamily",
            json!("ARBITRARY"),
            CatalogValidationError::UnsupportedFormatFamily,
        ),
        (
            "document",
            "sensitivity",
            json!("ARBITRARY"),
            CatalogValidationError::UnsupportedSensitivity,
        ),
        (
            "document",
            "accessMode",
            json!("ARBITRARY"),
            CatalogValidationError::UnsupportedAccessMode,
        ),
        (
            "document",
            "adapterId",
            json!("arbitrary"),
            CatalogValidationError::UnsupportedAdapter,
        ),
        (
            "document",
            "validatorId",
            json!("arbitrary"),
            CatalogValidationError::UnsupportedValidator,
        ),
        (
            "document",
            "editorKey",
            json!("arbitrary"),
            CatalogValidationError::UnsupportedEditor,
        ),
        (
            "document",
            "writePolicy",
            json!("ARBITRARY"),
            CatalogValidationError::UnsupportedWritePolicy,
        ),
    ];
    let known_valid = parse_catalog(BUILTIN_CATALOG_JSON).expect("known valid catalog");

    for (scope, field, value, expected) in cases {
        let source = mutate_catalog(|catalog| {
            let document = &mut catalog["apps"][0]["configDocuments"][0];
            if scope == "pathVariants" {
                document["pathVariants"][0][field] = value;
            } else {
                document[field] = value;
            }
        });
        assert_eq!(parse_catalog(&source), Err(expected));
    }

    assert_eq!(known_valid.apps()[0].id(), "github-copilot");
}

#[test]
fn catalog_recognizes_read_only_format_families_without_write_authority() {
    for (format, family) in [
        ("JSON", "JSON"),
        ("JSONC", "JSONC"),
        ("TOML", "TOML"),
        ("YAML", "YAML"),
        ("INI", "INI"),
        ("GIT_CONFIG", "GIT_CONFIG"),
        ("KEY_VALUE", "KEY_VALUE"),
        ("PLIST", "PLIST"),
        ("SSH_CONFIG", "COMMAND"),
        ("TEXT", "PLAIN_TEXT"),
    ] {
        let source = mutate_catalog(|catalog| {
            let document = &mut catalog["apps"][9]["configDocuments"][0];
            document["format"] = json!(format);
            document["formatFamily"] = json!(family);
        });
        let catalog = parse_catalog(&source).expect("read-only format should validate");
        let document = &catalog.apps()[9].config_documents()[0];
        assert!(document.is_read_only());
        assert_eq!(document.format(), format);
    }

    let writable_mismatch = mutate_catalog(|catalog| {
        let document = &mut catalog["apps"][0]["configDocuments"][0];
        document["format"] = json!("TOML");
        document["formatFamily"] = json!("TOML");
    });
    assert_eq!(
        parse_catalog(&writable_mismatch),
        Err(CatalogValidationError::UnsupportedAdapterFormat)
    );
}

#[test]
fn catalog_rejects_unapproved_elevation_resources() {
    let arbitrary_resource = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["elevationResourceId"] =
            json!("arbitrary:root-file");
    });
    assert_eq!(
        parse_catalog(&arbitrary_resource),
        Err(CatalogValidationError::UnsupportedValue)
    );
}

#[test]
fn catalog_rejects_oversized_serialized_documents() {
    let oversized = " ".repeat(MAX_CATALOG_BYTES + 1);

    assert_eq!(
        parse_catalog(&oversized),
        Err(CatalogValidationError::DocumentTooLarge)
    );
}

#[test]
fn catalog_rejects_unsupported_versions_and_excessive_app_counts() {
    let unsupported_version = mutate_catalog(|document| {
        document["schemaVersion"] = json!(CATALOG_SCHEMA_VERSION + 1);
    });
    assert_eq!(
        parse_catalog(&unsupported_version),
        Err(CatalogValidationError::UnsupportedSchemaVersion)
    );

    let too_many_apps = mutate_catalog(|document| {
        let template = document["apps"][1].clone();
        document["apps"] = Value::Array(
            (0..33)
                .map(|index| {
                    let mut app = template.clone();
                    app["id"] = json!(format!("app-{index}"));
                    app
                })
                .collect(),
        );
    });
    assert_eq!(
        parse_catalog(&too_many_apps),
        Err(CatalogValidationError::TooManyEntries)
    );
}
