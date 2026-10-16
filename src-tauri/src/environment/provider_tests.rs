use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

use crate::{
    error::AppErrorCode,
    grants::{DEFAULT_MAX_READ_BYTES, GrantId, read_built_in},
};

use super::super::{
    dotenv::{is_valid_key, value_looks_secret},
    scan::{FileKind, ScanConfig},
    tests::Fixture,
    zsh::{AppliesTo, StartupFile, ZshRequest},
    zsh_parse::DynamicReason,
};
use super::{
    DirectoryOutcome, DotenvSource, EmptyReason, FileStatus, ProblemKind, ProviderRequest, Scope,
    SourceEntry, SourceRef, SourceSnapshot, UnresolvedReason, collect, reveal_entry,
};

fn write_home(fixture: &Fixture, relative: &str, contents: &str) -> PathBuf {
    let path = fixture.home.join(relative);
    fs::create_dir_all(path.parent().expect("parent")).expect("create parents");
    fs::write(&path, contents).expect("write file");
    path
}

fn source(id: &GrantId) -> DotenvSource {
    DotenvSource {
        grant: id.clone(),
        config: ScanConfig::with_default_patterns(false),
    }
}

fn dotenv_request(sources: Vec<DotenvSource>) -> ProviderRequest {
    ProviderRequest {
        dotenv: sources,
        zsh: None,
    }
}

fn snapshot(fixture: &Fixture, request: &ProviderRequest) -> SourceSnapshot {
    collect(&fixture.coordinator(), Some(&fixture.home), request)
        .unwrap_or_else(|_| panic!("collect should succeed"))
}

fn entry<'a>(snapshot: &'a SourceSnapshot, key: &str) -> &'a SourceEntry {
    let matches: Vec<&SourceEntry> = snapshot
        .entries
        .iter()
        .filter(|entry| entry.key == key)
        .collect();
    assert_eq!(matches.len(), 1, "expected exactly one {key}");
    matches[0]
}

fn dotenv_path(entry: &SourceEntry) -> &str {
    match &entry.source {
        SourceRef::Dotenv { relative_path, .. } => relative_path,
        other => panic!("not a dotenv source: {other:?}"),
    }
}

// ---- empty sets carry a reason ---------------------------------------------------

#[test]
fn nothing_requested_is_an_empty_set_with_reasons_and_no_error() {
    let fixture = Fixture::new();

    let result = snapshot(&fixture, &ProviderRequest::default());

    assert!(result.entries.is_empty());
    assert!(result.failures.is_empty());
    assert_eq!(result.empty_reasons, [EmptyReason::NoDotenvAuthorization]);
    for reason in &result.empty_reasons {
        assert!(!reason.message().is_empty());
    }
}

#[test]
fn authorized_directories_without_files_and_absent_zsh_files_are_reasons_not_errors() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fs::write(fixture.project.join("notes.txt"), "A=1\n").expect("unrelated file");
    let request = ProviderRequest {
        dotenv: vec![source(&id)],
        zsh: Some(ZshRequest::default()),
    };

    let result = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    assert!(result.entries.is_empty());
    assert!(result.failures.is_empty());
    assert_eq!(
        result.empty_reasons,
        [EmptyReason::NoDotenvFiles, EmptyReason::NoZshFiles]
    );
    let absent = result
        .files
        .iter()
        .filter(|file| file.status == FileStatus::Absent)
        .count();
    assert_eq!(absent, 4, "each missing zsh file is reported as absent");
}

#[test]
fn files_that_hold_no_entries_are_reported_as_such() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(".env", "# only a comment\n");

    let result = collect(
        &coordinator,
        Some(&fixture.home),
        &dotenv_request(vec![source(&id)]),
    )
    .unwrap_or_else(|_| panic!("collect should succeed"));

    assert!(result.entries.is_empty());
    assert_eq!(result.empty_reasons, [EmptyReason::NoEntries]);
    assert!(matches!(
        result.files[0].status,
        FileStatus::Read { entry_count: 0, .. }
    ));
}

#[test]
fn an_invalid_scan_configuration_is_a_request_error() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    let request = dotenv_request(vec![DotenvSource {
        grant: id,
        config: ScanConfig {
            patterns: vec!["../x".to_owned()],
            recursive: false,
        },
    }]);

    let error = collect(&coordinator, Some(&fixture.home), &request).expect_err("invalid pattern");

    assert_eq!(error.code(), AppErrorCode::InvalidInput);
}

// ---- entries, scope, identity ------------------------------------------------------

#[test]
fn dotenv_entries_carry_key_scope_source_line_and_the_core5_fingerprint() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(".env", "# head\nPORT=8080\nexport MODE=dev\n");
    fixture.write(".env.example", "PORT=1\n");

    let result = collect(
        &coordinator,
        Some(&fixture.home),
        &dotenv_request(vec![source(&id)]),
    )
    .unwrap_or_else(|_| panic!("collect should succeed"));

    let mode = entry(&result, "MODE");
    assert_eq!(
        mode.scope,
        Scope::Dotenv {
            kind: FileKind::Environment
        }
    );
    assert_eq!(dotenv_path(mode), ".env");
    assert_eq!((mode.line, mode.end_line), (3, 3));
    assert!(mode.exported);
    assert!(mode.unresolved.is_empty());
    assert_eq!(mode.value.as_deref(), Some("dev"));
    assert_eq!((mode.has_value, mode.value_length), (true, 3));
    match &mode.source {
        SourceRef::Dotenv { grant_id, root, .. } => {
            assert_eq!(grant_id, id.as_str());
            assert_eq!(root, "~/proj");
        }
        other => panic!("{other:?}"),
    }
    // The identity is exactly what CORE-5 reports for the same file.
    let read = coordinator
        .read_resource(&id, Some(".env"))
        .expect("read the same file");
    assert_eq!(mode.fingerprint, read.fingerprint);

    // Templates are listed but marked, never presented as runtime values.
    let template = result
        .entries
        .iter()
        .find(|entry| dotenv_path(entry) == ".env.example")
        .expect("template entry");
    assert_eq!(
        template.scope,
        Scope::Dotenv {
            kind: FileKind::Template
        }
    );
}

#[test]
fn zsh_entries_carry_the_file_its_shell_types_and_the_fingerprint() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshenv", "export EDITOR=vim\n");
    write_home(&fixture, ".zshrc", "\nALIAS_DIR=/tmp/x\n");
    let request = ProviderRequest {
        dotenv: Vec::new(),
        zsh: Some(ZshRequest::default()),
    };

    let result = snapshot(&fixture, &request);

    let editor = entry(&result, "EDITOR");
    assert_eq!(
        editor.scope,
        Scope::Zsh {
            file: StartupFile::Zshenv,
            applies_to: AppliesTo::All
        }
    );
    assert_eq!(
        editor.source,
        SourceRef::Zsh {
            file: StartupFile::Zshenv
        }
    );
    assert!(editor.exported);
    let dir = entry(&result, "ALIAS_DIR");
    assert_eq!(
        dir.scope,
        Scope::Zsh {
            file: StartupFile::Zshrc,
            applies_to: AppliesTo::Interactive
        }
    );
    assert_eq!(dir.line, 2);
    assert!(!dir.exported);
    let read = read_built_in(
        &fixture.home.join(".zshrc"),
        Some(&fixture.home),
        DEFAULT_MAX_READ_BYTES,
    )
    .expect("read the same file");
    assert_eq!(dir.fingerprint, read.fingerprint);
}

// ---- secrets stay out ----------------------------------------------------------------

#[test]
fn secret_values_are_not_returned_and_not_printed() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(".env", "API_TOKEN=s3cr3t-dotenv\nPLAIN=visible-value\n");
    write_home(&fixture, ".zshrc", "export DB_PASSWORD=s3cr3t-zsh\n");
    let request = ProviderRequest {
        dotenv: vec![source(&id)],
        zsh: Some(ZshRequest::default()),
    };

    let result = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    let token = entry(&result, "API_TOKEN");
    assert!(token.secret);
    assert_eq!(token.value, None);
    assert_eq!((token.has_value, token.value_length), (true, 13));
    let password = entry(&result, "DB_PASSWORD");
    assert!(password.secret);
    assert_eq!(password.value, None);
    assert_eq!(password.value_length, 10);
    let plain = entry(&result, "PLAIN");
    assert!(!plain.secret);
    assert_eq!(plain.value.as_deref(), Some("visible-value"));
    // Sanity: the heuristic is the existing one, not a new one.
    assert!(value_looks_secret("API_TOKEN", "x") && is_valid_key("API_TOKEN"));

    let printed = format!("{result:?} {:?} {:?}", token, plain);
    for value in ["s3cr3t-dotenv", "s3cr3t-zsh", "visible-value"] {
        assert!(!printed.contains(value), "Debug output leaked {value}");
    }
    assert!(printed.contains("API_TOKEN"), "keys remain visible");
}

#[test]
fn an_explicit_request_returns_one_value_and_a_changed_file_is_a_conflict() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(".env", "API_TOKEN=s3cr3t-dotenv\n");
    write_home(&fixture, ".zshrc", "export DB_PASSWORD=s3cr3t-zsh\n");
    let request = ProviderRequest {
        dotenv: vec![source(&id)],
        zsh: Some(ZshRequest::default()),
    };
    let result = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    let from_dotenv = reveal_entry(
        &coordinator,
        Some(&fixture.home),
        &request,
        entry(&result, "API_TOKEN"),
    )
    .unwrap_or_else(|_| panic!("reveal dotenv"));
    let from_zsh = reveal_entry(
        &coordinator,
        Some(&fixture.home),
        &request,
        entry(&result, "DB_PASSWORD"),
    )
    .unwrap_or_else(|_| panic!("reveal zsh"));

    assert_eq!(from_dotenv.value, "s3cr3t-dotenv");
    assert_eq!(from_zsh.value, "s3cr3t-zsh");
    assert!(!format!("{from_dotenv:?}").contains("s3cr3t"));

    fixture.write(".env", "OTHER=1\n");
    let error = reveal_entry(
        &coordinator,
        Some(&fixture.home),
        &request,
        entry(&result, "API_TOKEN"),
    )
    .expect_err("file changed");
    assert_eq!(error.code(), AppErrorCode::Conflict);
}

#[test]
fn revealing_through_a_source_the_request_does_not_name_is_refused() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(".env", "API_TOKEN=s3cr3t-dotenv\n");
    let request = dotenv_request(vec![source(&id)]);
    let result = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    let error = reveal_entry(
        &coordinator,
        Some(&fixture.home),
        &ProviderRequest::default(),
        entry(&result, "API_TOKEN"),
    )
    .expect_err("source not requested");

    assert_eq!(error.code(), AppErrorCode::PermissionDenied);
}

// ---- unresolved reasons are kept ------------------------------------------------------

#[test]
fn unresolved_reasons_survive_for_dotenv_entries() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(
        ".env",
        "PLAIN=1\nREF=$HOME/x\nCMD=$(date)\nTWICE=1\nTWICE=2\nMULTI=\"a\nb\"\n",
    );

    let result = collect(
        &coordinator,
        Some(&fixture.home),
        &dotenv_request(vec![source(&id)]),
    )
    .unwrap_or_else(|_| panic!("collect should succeed"));

    assert!(entry(&result, "PLAIN").unresolved.is_empty());
    assert_eq!(
        entry(&result, "REF").unresolved,
        [UnresolvedReason::Interpolation]
    );
    assert_eq!(
        entry(&result, "CMD").unresolved,
        [UnresolvedReason::CommandSubstitution]
    );
    let twice: Vec<_> = result
        .entries
        .iter()
        .filter(|entry| entry.key == "TWICE")
        .collect();
    assert_eq!(twice.len(), 2, "duplicates are not collapsed");
    assert!(
        twice
            .iter()
            .all(|entry| entry.unresolved == [UnresolvedReason::DuplicateKey])
    );
    assert_eq!(
        entry(&result, "MULTI").unresolved,
        [UnresolvedReason::MultilineValue]
    );
    assert_eq!(entry(&result, "MULTI").end_line, 7);
    assert!(entry(&result, "REF").is_unresolved());
    assert!(!entry(&result, "PLAIN").is_unresolved());
}

#[test]
fn unresolved_reasons_survive_for_zsh_entries_and_dynamic_statements_are_counted() {
    let fixture = Fixture::new();
    write_home(
        &fixture,
        ".zshrc",
        "export PLAIN=1\nexport STAMP=$(date)\nexport BIN=$HOME/bin\nTWICE=1\nTWICE=2\nPATH+=:/x\nif true; then\n  IN_IF=1\nfi\nsource ./other\nthis is nothing\n",
    );
    let request = ProviderRequest {
        dotenv: Vec::new(),
        zsh: Some(ZshRequest::default()),
    };

    let result = snapshot(&fixture, &request);

    assert!(entry(&result, "PLAIN").unresolved.is_empty());
    assert_eq!(
        entry(&result, "STAMP").unresolved,
        [UnresolvedReason::CommandSubstitution]
    );
    assert_eq!(
        entry(&result, "BIN").unresolved,
        [UnresolvedReason::Reference]
    );
    assert_eq!(
        entry(&result, "PATH").unresolved,
        [UnresolvedReason::Append]
    );
    let twice = result
        .entries
        .iter()
        .filter(|entry| entry.key == "TWICE")
        .count();
    assert_eq!(twice, 2);
    assert!(
        result
            .entries
            .iter()
            .filter(|entry| entry.key == "TWICE")
            .all(|entry| entry.unresolved == [UnresolvedReason::DuplicateKey])
    );
    // Statements inside a block or a `source` are not guessed into entries,
    // but the file says they exist.
    assert!(result.entries.iter().all(|entry| entry.key != "IN_IF"));
    let zshrc = result
        .files
        .iter()
        .find(|file| {
            file.source
                == SourceRef::Zsh {
                    file: StartupFile::Zshrc,
                }
        })
        .expect("zshrc report");
    match &zshrc.status {
        FileStatus::Read {
            dynamic_statements,
            unrecognized_lines,
            ..
        } => {
            assert!(*dynamic_statements >= 2, "if block and source");
            assert!(*unrecognized_lines >= 1);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_dynamic_zsh_value_keeps_its_parser_reason() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshrc", "export CALC=$((1+2))\n");
    let request = ProviderRequest {
        dotenv: Vec::new(),
        zsh: Some(ZshRequest::default()),
    };

    let result = snapshot(&fixture, &request);

    assert_eq!(
        entry(&result, "CALC").unresolved,
        [UnresolvedReason::Dynamic(Some(DynamicReason::Arithmetic))]
    );
}

// ---- side by side, never merged ---------------------------------------------------------

#[test]
fn the_same_key_in_several_sources_is_listed_side_by_side() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let other = fixture.home.join("other");
    fs::create_dir_all(&other).expect("second directory");
    fs::write(other.join(".env"), "SHARED=from-other\n").expect("other env");
    let first = fixture.grant(&coordinator, &fixture.project);
    let second = fixture.grant(&coordinator, &other);
    fixture.write(".env", "SHARED=from-project\n");
    fixture.write(".env.local", "SHARED=from-local\n");
    write_home(&fixture, ".zshenv", "export SHARED=from-zsh\n");
    let request = ProviderRequest {
        dotenv: vec![source(&first), source(&second)],
        zsh: Some(ZshRequest::default()),
    };

    let result = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    let shared: Vec<&SourceEntry> = result
        .entries
        .iter()
        .filter(|entry| entry.key == "SHARED")
        .collect();
    assert_eq!(shared.len(), 4);
    let mut values: Vec<&str> = shared
        .iter()
        .map(|entry| entry.value.as_deref().expect("plain value"))
        .collect();
    values.sort_unstable();
    assert_eq!(
        values,
        ["from-local", "from-other", "from-project", "from-zsh"]
    );
    // No cross-source duplicate verdict: each stays resolved on its own.
    assert!(shared.iter().all(|entry| entry.unresolved.is_empty()));
}

// ---- partial failure is not an empty configuration -----------------------------------------

#[test]
fn a_failing_source_is_reported_next_to_the_entries_that_were_read() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(".env", "GOOD=1\n");
    fixture.write(
        ".env.big",
        &format!("BIG={}\n", "x".repeat(1024 * 1024 + 1)),
    );
    fs::write(fixture.project.join(".env.bin"), [0xff, 0xfe, 0x00]).expect("binary file");
    write_home(&fixture, ".zshenv", "export FROM_ENV=1\n");
    let locked = write_home(&fixture, ".zshrc", "export HIDDEN=1\n");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).expect("lock");
    let request = ProviderRequest {
        dotenv: vec![source(&id)],
        zsh: Some(ZshRequest::default()),
    };

    let result = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    let keys: Vec<&str> = result
        .entries
        .iter()
        .map(|entry| entry.key.as_str())
        .collect();
    assert_eq!(keys, ["GOOD", "FROM_ENV"]);
    assert!(
        result.empty_reasons.is_empty(),
        "not empty, not 'no config'"
    );
    let problem = |path: &SourceRef| {
        result
            .failures
            .iter()
            .find(|failure| &failure.source == path)
            .unwrap_or_else(|| panic!("no failure for {path:?}"))
            .kind
    };
    let dotenv_ref = |name: &str| SourceRef::Dotenv {
        grant_id: id.as_str().to_owned(),
        root: "~/proj".to_owned(),
        relative_path: name.to_owned(),
    };
    assert_eq!(problem(&dotenv_ref(".env.big")), ProblemKind::TooLarge);
    assert_eq!(problem(&dotenv_ref(".env.bin")), ProblemKind::Malformed);
    assert_eq!(
        problem(&SourceRef::Zsh {
            file: StartupFile::Zshrc
        }),
        ProblemKind::PermissionDenied
    );
    assert!(
        result
            .failures
            .iter()
            .all(|failure| !failure.message.is_empty())
    );
}

#[test]
fn a_zsh_file_that_resolves_outside_home_and_an_undetermined_zdotdir_are_failures() {
    let fixture = Fixture::new();
    let secret_dir = fixture.outside.join("dots");
    fs::create_dir_all(&secret_dir).expect("outside dir");
    fs::write(secret_dir.join(".zshrc"), "export OUT=1\n").expect("outside file");
    std::os::unix::fs::symlink(secret_dir.join(".zshrc"), fixture.home.join(".zshrc"))
        .expect("link out of home");
    let request = ProviderRequest {
        dotenv: Vec::new(),
        zsh: Some(ZshRequest::default()),
    };

    let linked = snapshot(&fixture, &request);

    assert!(linked.entries.is_empty());
    let kinds: Vec<ProblemKind> = linked.failures.iter().map(|failure| failure.kind).collect();
    assert_eq!(kinds, [ProblemKind::OutsideHome]);

    fs::remove_file(fixture.home.join(".zshrc")).expect("remove link");
    write_home(
        &fixture,
        ".zshenv",
        "export ZDOTDIR=$(pwd)\nexport KEPT=1\n",
    );

    let undetermined = snapshot(&fixture, &request);

    assert_eq!(entry(&undetermined, "KEPT").key, "KEPT");
    let kinds: Vec<ProblemKind> = undetermined
        .failures
        .iter()
        .map(|failure| failure.kind)
        .collect();
    assert_eq!(
        kinds,
        [
            ProblemKind::NotLocated,
            ProblemKind::NotLocated,
            ProblemKind::NotLocated
        ]
    );
}

#[test]
fn partial_scans_are_visible_per_directory() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    fixture.write(".env", "A=1\n");
    std::os::unix::fs::symlink(
        fixture.outside.join("x.env"),
        fixture.project.join("link.env"),
    )
    .expect("dangling link");

    let result = collect(
        &coordinator,
        Some(&fixture.home),
        &dotenv_request(vec![source(&id)]),
    )
    .unwrap_or_else(|_| panic!("collect should succeed"));

    assert_eq!(result.directories.len(), 1);
    match &result.directories[0].outcome {
        DirectoryOutcome::Scanned {
            file_count,
            skipped_total,
            ..
        } => {
            assert_eq!(*file_count, 1);
            assert_eq!(*skipped_total, 1);
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_revoked_authorization_returns_nothing_and_says_why_while_others_still_read() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let other = fixture.home.join("other");
    fs::create_dir_all(&other).expect("second directory");
    fs::write(other.join(".env"), "KEPT=1\n").expect("other env");
    let first = fixture.grant(&coordinator, &fixture.project);
    let second = fixture.grant(&coordinator, &other);
    fixture.write(".env", "GONE=1\n");
    let request = dotenv_request(vec![source(&first), source(&second)]);
    let before = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));
    assert_eq!(before.entries.len(), 2);

    coordinator.revoke(&first).expect("revoke");
    let after = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    let keys: Vec<&str> = after
        .entries
        .iter()
        .map(|entry| entry.key.as_str())
        .collect();
    assert_eq!(keys, ["KEPT"]);
    assert_eq!(after.failures.len(), 1);
    assert_eq!(after.failures[0].kind, ProblemKind::Excluded);
    assert_eq!(
        after.failures[0].source,
        SourceRef::DotenvDirectory {
            grant_id: first.as_str().to_owned()
        }
    );
    assert!(matches!(
        after.directories[0].outcome,
        DirectoryOutcome::Failed {
            kind: ProblemKind::Excluded
        }
    ));

    // And a value can no longer be fetched through the revoked authorization.
    let error = reveal_entry(
        &coordinator,
        Some(&fixture.home),
        &request,
        &before.entries[0],
    )
    .expect_err("revoked");
    assert!(matches!(
        error.code(),
        AppErrorCode::PermissionDenied | AppErrorCode::NotFound
    ));
}

// ---- nothing is executed -----------------------------------------------------------------------

#[test]
fn collecting_does_not_execute_or_source_anything() {
    let fixture = Fixture::new();
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, &fixture.project);
    let marker = fixture.root.join("marker");
    let command = format!("touch {}", marker.display());
    fixture.write(".env", &format!("A=$({command})\nB=`{command}`\n"));
    write_home(
        &fixture,
        ".zshrc",
        &format!("export C=$({command})\nsource ./sourced\n{command}\n"),
    );
    write_home(&fixture, "sourced", &format!("{command}\n"));
    let request = ProviderRequest {
        dotenv: vec![source(&id)],
        zsh: Some(ZshRequest::default()),
    };

    let result = collect(&coordinator, Some(&fixture.home), &request)
        .unwrap_or_else(|_| panic!("collect should succeed"));

    assert!(!result.entries.is_empty());
    assert!(!marker.exists(), "no file was executed or sourced");
}
