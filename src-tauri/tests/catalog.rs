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

#[test]
fn catalog_preserves_the_six_baseline_definitions_and_adds_the_read_only_batch() {
    let catalog = parse_catalog(BUILTIN_CATALOG_JSON).expect("built-in catalog should validate");
    let ids = catalog
        .apps()
        .iter()
        .map(|app| app.id())
        .collect::<Vec<_>>();

    assert_eq!(catalog.schema_version(), CATALOG_SCHEMA_VERSION);
    assert_eq!(
        ids[..6],
        ["github-copilot", "caddy", "git", "openssh", "zsh", "npm",]
    );
    assert_eq!(
        ids[6..],
        [
            "visual-studio-code",
            "cursor",
            "ghostty",
            "starship",
            "tmux",
            "vim",
        ]
    );
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
fn catalog_ipc_summary_omits_authoritative_paths() {
    let response = list_managed_apps().expect("catalog command should succeed");
    let serialized = serde_json::to_value(response).expect("catalog response should serialize");

    assert_eq!(serialized["schemaVersion"], json!(CATALOG_SCHEMA_VERSION));
    assert_eq!(
        serialized["applications"]
            .as_array()
            .expect("applications should be an array")
            .len(),
        12
    );
    assert!(!serialized.to_string().contains("pathTemplate"));
    assert!(!serialized.to_string().contains("HOMEBREW_PREFIX"));
    assert!(!serialized.to_string().contains("~/."));
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

    let missing_adapter = mutate_catalog(|document| {
        document["apps"][0]["configDocuments"][0]["adapterId"] = json!("");
    });
    assert_eq!(
        parse_catalog(&missing_adapter),
        Err(CatalogValidationError::MissingAdapter)
    );
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
        let template = document["apps"][0].clone();
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
