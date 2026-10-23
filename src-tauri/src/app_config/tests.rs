use std::path::{Path, PathBuf};

use serde_json::Value;

use super::registry::{
    Capability, Entry, EntrySummary, Format, LintErrorKind, Location, Registry, RegistryError,
    Sensitivity, Source, display_path, fixture, lint, resolve_path,
};

const HOME: &str = "/Users/example";

#[test]
fn registry_get_returns_the_entry_for_a_known_id() {
    let registry = Registry::new(vec![fixture("alpha-tool"), fixture("beta-tool")]);

    let entry = registry.get("beta-tool").expect("known id resolves");

    assert_eq!(entry.id, "beta-tool");
}

#[test]
fn registry_get_rejects_an_unknown_id_with_a_typed_error() {
    let registry = Registry::new(vec![fixture("alpha-tool")]);

    assert_eq!(
        registry.get("missing-tool"),
        Err(RegistryError::UnknownEntry("missing-tool".to_owned()))
    );
}

#[test]
fn registry_get_matches_ids_exactly() {
    let registry = Registry::new(vec![fixture("alpha-tool")]);

    assert!(matches!(
        registry.get("Alpha-Tool"),
        Err(RegistryError::UnknownEntry(_))
    ));
    assert!(matches!(
        registry.get("alpha-tool "),
        Err(RegistryError::UnknownEntry(_))
    ));
    assert!(matches!(
        registry.get(""),
        Err(RegistryError::UnknownEntry(_))
    ));
}

#[test]
fn registry_entries_returns_every_entry_in_order() {
    let registry = Registry::new(vec![fixture("alpha-tool"), fixture("beta-tool")]);

    let ids: Vec<&str> = registry.entries().iter().map(|entry| entry.id).collect();

    assert_eq!(ids, ["alpha-tool", "beta-tool"]);
}

#[test]
fn resolve_home_entry_joins_the_relative_path_under_home() {
    let entry = with_location(Location::Home(".config/tool/config.toml"));

    assert_eq!(
        resolve_path(&entry, Path::new(HOME)),
        PathBuf::from("/Users/example/.config/tool/config.toml")
    );
}

#[test]
fn resolve_fixed_entry_ignores_the_home_directory() {
    let entry = with_location(Location::Fixed("/etc/example.conf"));

    assert_eq!(
        resolve_path(&entry, Path::new(HOME)),
        PathBuf::from("/etc/example.conf")
    );
}

#[test]
fn display_path_shows_home_entries_with_a_tilde_prefix() {
    let entry = with_location(Location::Home("Library/Preferences/tool/auth.ini"));

    assert_eq!(display_path(&entry), "~/Library/Preferences/tool/auth.ini");
}

#[test]
fn display_path_keeps_fixed_entries_absolute() {
    let entry = with_location(Location::Fixed("/etc/example.conf"));

    assert_eq!(display_path(&entry), "/etc/example.conf");
}

#[test]
fn summary_shows_the_tilde_path_and_never_the_resolved_home() {
    let entry = with_location(Location::Home(".gitconfig"));

    let json = serde_json::to_string(&EntrySummary::from(&entry)).expect("summary serializes");

    assert!(json.contains("\"displayPath\":\"~/.gitconfig\""));
    assert!(!json.contains("/Users/"));
}

#[test]
fn summary_serializes_exactly_the_frontend_fields_in_camel_case() {
    let entry = fixture("git");

    let value: Value =
        serde_json::to_value(EntrySummary::from(&entry)).expect("summary serializes");
    let object = value.as_object().expect("summary is an object");

    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "capability",
            "category",
            "displayPath",
            "format",
            "id",
            "metadataOnly",
            "name",
            "sensitivity",
            "sourceUrl",
            "verifiedOn",
        ]
    );
}

#[test]
fn capability_and_sensitivity_serialize_as_camel_case_names() {
    assert_eq!(
        serde_json::to_value(Capability::DiscoverOnly).expect("serializes"),
        "discoverOnly"
    );
    assert_eq!(
        serde_json::to_value(Capability::ReadOnly).expect("serializes"),
        "readOnly"
    );
    assert_eq!(
        serde_json::to_value(Sensitivity::SensitiveKeys).expect("serializes"),
        "sensitiveKeys"
    );
}

#[test]
fn lint_rejects_home_paths_inside_protected_credential_directories() {
    assert_rejected(at_home(".ssh/config"), LintErrorKind::ProtectedLocation);
    assert_rejected(at_home(".ssh"), LintErrorKind::ProtectedLocation);
    assert_rejected(
        at_home(".gnupg/pubring.kbx"),
        LintErrorKind::ProtectedLocation,
    );
    assert_rejected(
        at_home("Library/Keychains/login.keychain-db"),
        LintErrorKind::ProtectedLocation,
    );
    assert_rejected(
        at_home("Library/Keychains"),
        LintErrorKind::ProtectedLocation,
    );
}

#[test]
fn lint_rejects_fixed_paths_inside_protected_credential_directories() {
    assert_rejected(
        at_fixed("/Users/example/.ssh/config"),
        LintErrorKind::ProtectedLocation,
    );
    assert_rejected(
        at_fixed("/Library/Keychains/System.keychain"),
        LintErrorKind::ProtectedLocation,
    );
}

#[test]
fn lint_accepts_names_that_only_resemble_protected_directories() {
    assert_accepted(at_home(".ssh-tools/config.toml"));
    assert_accepted(at_home(".gnupgtools/settings.json"));
    assert_accepted(at_home("Library/Keychain-tools/settings.json"));
    assert_accepted(at_home("Library/KeychainsArchive/settings.json"));
    assert_accepted(at_fixed("/etc/ssh/ssh_config"));
}

#[test]
fn lint_rejects_recursive_globs_in_any_location() {
    assert_rejected(
        at_home(".config/**/settings.json"),
        LintErrorKind::RecursiveGlob,
    );
    assert_rejected(at_home("**/settings.json"), LintErrorKind::RecursiveGlob);
    assert_rejected(at_fixed("/etc/**/ssh_config"), LintErrorKind::RecursiveGlob);
}

#[test]
fn lint_rejects_glob_characters_in_directory_components() {
    assert_rejected(
        at_home(".config/*/settings.json"),
        LintErrorKind::GlobPattern,
    );
    assert_rejected(
        at_home(".config/tool?/settings.json"),
        LintErrorKind::GlobPattern,
    );
    assert_rejected(
        at_home(".config/[ab]/settings.json"),
        LintErrorKind::GlobPattern,
    );
    assert_rejected(
        at_home("Library/Application Support/*/settings.json"),
        LintErrorKind::GlobPattern,
    );
}

#[test]
fn lint_rejects_a_filename_glob_outside_application_support() {
    assert_rejected(at_home(".config/tool/*.json"), LintErrorKind::GlobPattern);
}

#[test]
fn lint_rejects_a_filename_glob_directly_under_application_support() {
    assert_rejected(
        at_home("Library/Application Support/*.json"),
        LintErrorKind::GlobPattern,
    );
}

#[test]
fn lint_rejects_glob_characters_in_fixed_paths() {
    assert_rejected(at_fixed("/etc/*.conf"), LintErrorKind::GlobPattern);
}

#[test]
fn lint_accepts_a_single_level_filename_pattern_inside_an_application_folder() {
    assert_accepted(at_home("Library/Application Support/Tool/*.json"));
}

#[test]
fn lint_rejects_absolute_home_paths() {
    assert_rejected(at_home("/etc/passwd"), LintErrorKind::UnsafePath);
}

#[test]
fn lint_rejects_parent_traversal_in_home_paths() {
    assert_rejected(at_home("../escape.json"), LintErrorKind::UnsafePath);
    assert_rejected(
        at_home(".config/../../escape.json"),
        LintErrorKind::UnsafePath,
    );
}

#[test]
fn lint_rejects_empty_dot_tilde_and_trailing_slash_components_in_home_paths() {
    assert_rejected(at_home(""), LintErrorKind::UnsafePath);
    assert_rejected(at_home("./settings.json"), LintErrorKind::UnsafePath);
    assert_rejected(at_home(".config//tool.json"), LintErrorKind::UnsafePath);
    assert_rejected(at_home(".config/tool/"), LintErrorKind::UnsafePath);
    assert_rejected(at_home("~/settings.json"), LintErrorKind::UnsafePath);
}

#[test]
fn lint_rejects_relative_and_unnormalized_fixed_paths() {
    assert_rejected(at_fixed("etc/ssh/ssh_config"), LintErrorKind::UnsafePath);
    assert_rejected(
        at_fixed("/etc/../etc/ssh_config"),
        LintErrorKind::UnsafePath,
    );
    assert_rejected(at_fixed("/etc//ssh_config"), LintErrorKind::UnsafePath);
    assert_rejected(at_fixed("/etc/ssh/"), LintErrorKind::UnsafePath);
}

#[test]
fn lint_accepts_names_that_begin_with_dots_but_are_not_traversal() {
    assert_accepted(at_home(".config/..cache/settings.json"));
    assert_accepted(at_home(".config/tool/config.json"));
}

#[test]
fn lint_rejects_entries_without_a_https_source_url() {
    for url in ["", "http://docs.example.com/config", "https://"] {
        assert_rejected(
            with_source(Source {
                url,
                verified_on: "2026-10-21",
            }),
            LintErrorKind::MissingSource,
        );
    }
}

#[test]
fn lint_rejects_entries_without_a_valid_verification_date() {
    for verified_on in [
        "",
        "2026-10",
        "2026-13-01",
        "2026-00-10",
        "2026-10-32",
        "20261021",
        "2026-1O-21",
    ] {
        assert_rejected(
            with_source(Source {
                url: "https://docs.example.com/config",
                verified_on,
            }),
            LintErrorKind::InvalidVerifiedDate,
        );
    }
}

#[test]
fn lint_accepts_complete_sources_with_boundary_dates() {
    for verified_on in ["2026-01-01", "2026-10-21", "2026-12-31"] {
        assert_accepted(with_source(Source {
            url: "https://docs.example.com/config",
            verified_on,
        }));
    }
}

#[test]
fn lint_rejects_readable_credentials_entries() {
    assert_rejected(
        Entry {
            capability: Capability::ReadOnly,
            sensitivity: Sensitivity::Credentials,
            ..fixture("probe")
        },
        LintErrorKind::CredentialsReadable,
    );
}

#[test]
fn lint_rejects_writable_credentials_entries() {
    assert_rejected(
        Entry {
            capability: Capability::Writable,
            sensitivity: Sensitivity::Credentials,
            ..fixture("probe")
        },
        LintErrorKind::CredentialsWritable,
    );
}

#[test]
fn lint_accepts_discover_only_credentials_entries() {
    assert_accepted(Entry {
        capability: Capability::DiscoverOnly,
        sensitivity: Sensitivity::Credentials,
        ..fixture("probe")
    });
}

#[test]
fn lint_rejects_writable_fixed_entries() {
    assert_rejected(
        Entry {
            location: Location::Fixed("/etc/ssh/ssh_config"),
            capability: Capability::Writable,
            ..fixture("probe")
        },
        LintErrorKind::FixedWritable,
    );
}

#[test]
fn lint_accepts_read_only_fixed_entries_and_writable_home_entries() {
    assert_accepted(Entry {
        location: Location::Fixed("/etc/ssh/ssh_config"),
        capability: Capability::ReadOnly,
        ..fixture("probe")
    });
    assert_accepted(Entry {
        capability: Capability::Writable,
        ..fixture("probe")
    });
}

#[test]
fn lint_rejects_duplicate_ids_on_the_later_entry() {
    let errors = lint(&[fixture("duplicate"), fixture("duplicate")]);

    let duplicates: Vec<&str> = errors
        .iter()
        .filter(|error| error.kind == LintErrorKind::DuplicateId)
        .map(|error| error.entry_id.as_str())
        .collect();
    assert_eq!(duplicates, ["duplicate"]);
}

#[test]
fn lint_accepts_distinct_ids_that_share_a_prefix() {
    assert!(lint(&[fixture("git-config"), fixture("git-config-xdg")]).is_empty());
}

#[test]
fn lint_rejects_ids_that_are_not_kebab_case() {
    for id in [
        "Alpha",
        "alpha_tool",
        "-alpha",
        "alpha-",
        "alpha--tool",
        "alpha tool",
        "",
    ] {
        assert_rejected(
            Entry {
                id,
                ..fixture("probe")
            },
            LintErrorKind::InvalidId,
        );
    }
}

#[test]
fn lint_accepts_kebab_case_ids_with_digits() {
    assert_accepted(Entry {
        id: "tool-2-config",
        ..fixture("probe")
    });
}

#[test]
fn lint_rejects_blank_names() {
    for name in ["", "   "] {
        assert_rejected(
            Entry {
                name,
                ..fixture("probe")
            },
            LintErrorKind::EmptyName,
        );
    }
}

#[test]
fn lint_reports_every_violation_of_a_single_entry() {
    let kinds = kinds_for(Entry {
        id: "Bad Id",
        name: "",
        location: Location::Home("/etc/passwd"),
        capability: Capability::Writable,
        sensitivity: Sensitivity::Credentials,
        source: Source {
            url: "",
            verified_on: "",
        },
        ..fixture("probe")
    });

    for expected in [
        LintErrorKind::InvalidId,
        LintErrorKind::EmptyName,
        LintErrorKind::UnsafePath,
        LintErrorKind::MissingSource,
        LintErrorKind::InvalidVerifiedDate,
        LintErrorKind::CredentialsWritable,
    ] {
        assert!(
            kinds.contains(&expected),
            "expected {expected:?} in {kinds:?}"
        );
    }
}

#[test]
fn registry_validated_rejects_entries_that_fail_lint() {
    let result = Registry::validated(vec![fixture("Bad Id")]);

    assert!(matches!(result, Err(RegistryError::Invalid(_))));
}

#[test]
fn registry_validated_accepts_clean_entries() {
    let registry = Registry::validated(vec![fixture("alpha-tool")]).expect("clean entries load");

    assert_eq!(
        registry.get("alpha-tool").map(|entry| entry.id),
        Ok("alpha-tool")
    );
}

#[test]
fn registry_builtin_loads_and_passes_lint() {
    assert!(Registry::builtin().is_ok());
    assert!(lint(super::registry::BUILTIN_ENTRIES).is_empty());
}

#[test]
fn registry_builtin_lists_the_reviewed_entries_with_their_locations_and_rules() {
    let registry = Registry::builtin().expect("builtin registry is valid");
    let expected = [
        (
            "git-config-home",
            "~/.gitconfig",
            Format::Ini,
            Capability::ReadOnly,
            Sensitivity::SensitiveKeys,
            false,
            GIT_CONFIG_URL,
        ),
        (
            "git-config-xdg",
            "~/.config/git/config",
            Format::Ini,
            Capability::ReadOnly,
            Sensitivity::SensitiveKeys,
            false,
            GIT_CONFIG_URL,
        ),
        (
            "git-credentials",
            "~/.git-credentials",
            Format::Text,
            Capability::DiscoverOnly,
            Sensitivity::Credentials,
            false,
            "https://git-scm.com/docs/git-credential-store",
        ),
        (
            "npmrc",
            "~/.npmrc",
            Format::Ini,
            Capability::DiscoverOnly,
            Sensitivity::Credentials,
            false,
            "https://docs.npmjs.com/cli/v10/configuring-npm/npmrc",
        ),
        (
            "pnpm-auth-ini",
            "~/Library/Preferences/pnpm/auth.ini",
            Format::Ini,
            Capability::DiscoverOnly,
            Sensitivity::Credentials,
            false,
            "https://pnpm.io/npmrc",
        ),
        (
            "zed-settings",
            "~/.config/zed/settings.json",
            Format::Jsonc,
            Capability::ReadOnly,
            Sensitivity::SensitiveKeys,
            false,
            "https://raw.githubusercontent.com/zed-industries/zed/main/docs/src/configuring-zed.md",
        ),
        (
            "ghostty-config",
            "~/.config/ghostty/config.ghostty",
            Format::Text,
            Capability::ReadOnly,
            Sensitivity::SensitiveKeys,
            true,
            "https://ghostty.org/docs/config",
        ),
        (
            "alacritty-config",
            "~/.config/alacritty/alacritty.toml",
            Format::Toml,
            Capability::ReadOnly,
            Sensitivity::SensitiveKeys,
            false,
            "https://alacritty.org/config-alacritty.html",
        ),
        (
            "tmux-conf",
            "~/.tmux.conf",
            Format::Text,
            Capability::ReadOnly,
            Sensitivity::None,
            true,
            TMUX_URL,
        ),
        (
            "tmux-config-xdg",
            "~/.config/tmux/tmux.conf",
            Format::Text,
            Capability::ReadOnly,
            Sensitivity::None,
            true,
            TMUX_URL,
        ),
        (
            "neovim-init",
            "~/.config/nvim/init.lua",
            Format::Text,
            Capability::ReadOnly,
            Sensitivity::None,
            true,
            "https://raw.githubusercontent.com/neovim/neovim/master/runtime/doc/starting.txt",
        ),
        (
            "claude-code-settings",
            "~/.claude/settings.json",
            Format::Json,
            Capability::ReadOnly,
            Sensitivity::SensitiveKeys,
            false,
            "https://code.claude.com/docs/en/settings",
        ),
        (
            "gemini-user-settings",
            "~/.gemini/settings.json",
            Format::Json,
            Capability::ReadOnly,
            Sensitivity::SensitiveKeys,
            false,
            "https://geminicli.com/docs/reference/configuration",
        ),
        (
            "docker-config",
            "~/.docker/config.json",
            Format::Json,
            Capability::DiscoverOnly,
            Sensitivity::Credentials,
            false,
            "https://docs.docker.com/reference/cli/docker/#configuration-files",
        ),
        (
            "ssh-system-config",
            "/etc/ssh/ssh_config",
            Format::Text,
            Capability::ReadOnly,
            Sensitivity::None,
            false,
            "https://man.openbsd.org/ssh_config",
        ),
    ];

    assert_eq!(registry.entries().len(), expected.len());
    for (id, display, format, capability, sensitivity, metadata_only, url) in expected {
        let summary = EntrySummary::from(registry.get(id).expect("reviewed id is registered"));
        assert_eq!(summary.display_path, display, "{id}");
        assert_eq!(
            registry.get(id).map(|entry| entry.format),
            Ok(format),
            "{id}"
        );
        assert_eq!(summary.capability, capability, "{id}");
        assert_eq!(summary.sensitivity, sensitivity, "{id}");
        assert_eq!(summary.metadata_only, metadata_only, "{id}");
        assert_eq!(summary.source_url, url, "{id}");
        let verified_on = if id == "gemini-user-settings" {
            "2026-10-23"
        } else {
            "2026-10-21"
        };
        assert_eq!(summary.verified_on, verified_on, "{id}");
    }
}

#[test]
fn registry_builtin_has_no_writable_entries() {
    let registry = Registry::builtin().expect("builtin registry is valid");

    assert!(
        registry
            .entries()
            .iter()
            .all(|entry| entry.capability != Capability::Writable)
    );
}

#[test]
fn registry_builtin_only_fixed_entry_is_the_read_only_ssh_system_config() {
    let registry = Registry::builtin().expect("builtin registry is valid");

    let fixed: Vec<&str> = registry
        .entries()
        .iter()
        .filter(|entry| matches!(entry.location, Location::Fixed(_)))
        .map(|entry| entry.id)
        .collect();

    assert_eq!(fixed, ["ssh-system-config"]);
}

#[test]
fn registry_builtin_limits_metadata_only_to_ghostty_tmux_and_neovim() {
    let registry = Registry::builtin().expect("builtin registry is valid");

    let metadata_only: Vec<&str> = registry
        .entries()
        .iter()
        .filter(|entry| entry.metadata_only)
        .map(|entry| entry.id)
        .collect();

    assert_eq!(
        metadata_only,
        [
            "ghostty-config",
            "tmux-conf",
            "tmux-config-xdg",
            "neovim-init"
        ]
    );
}

#[test]
fn registry_builtin_credentials_entries_are_discover_only() {
    let registry = Registry::builtin().expect("builtin registry is valid");

    let credentials: Vec<&str> = registry
        .entries()
        .iter()
        .filter(|entry| entry.sensitivity == Sensitivity::Credentials)
        .map(|entry| entry.id)
        .collect();

    assert_eq!(
        credentials,
        ["git-credentials", "npmrc", "pnpm-auth-ini", "docker-config"]
    );
    assert!(
        registry
            .entries()
            .iter()
            .filter(|entry| entry.sensitivity == Sensitivity::Credentials)
            .all(|entry| entry.capability == Capability::DiscoverOnly)
    );
}

const GIT_CONFIG_URL: &str = "https://git-scm.com/docs/git-config";
const TMUX_URL: &str = "https://raw.githubusercontent.com/tmux/tmux/master/tmux.1";

fn with_location(location: Location) -> Entry {
    Entry {
        location,
        ..fixture("location-probe")
    }
}

fn at_home(relative: &'static str) -> Entry {
    with_location(Location::Home(relative))
}

fn at_fixed(absolute: &'static str) -> Entry {
    with_location(Location::Fixed(absolute))
}

fn with_source(source: Source) -> Entry {
    Entry {
        source,
        ..fixture("probe")
    }
}

fn kinds_for(entry: Entry) -> Vec<LintErrorKind> {
    lint(&[entry]).into_iter().map(|error| error.kind).collect()
}

fn assert_rejected(entry: Entry, expected: LintErrorKind) {
    let kinds = kinds_for(entry);
    assert!(
        kinds.contains(&expected),
        "expected {expected:?} in {kinds:?}"
    );
}

fn assert_accepted(entry: Entry) {
    assert_eq!(kinds_for(entry), Vec::<LintErrorKind>::new());
}
