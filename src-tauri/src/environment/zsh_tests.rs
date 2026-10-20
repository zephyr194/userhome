use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use serde_json::Value;

use crate::{
    error::AppErrorCode,
    grants::{GrantCoordinator, GrantPurpose},
};

use super::super::{
    FailureKind,
    tests::Fixture,
    zsh_parse::{DynamicReason, ValueState},
};
use super::{
    AppliesTo, RowView, SOURCE_CONSULTED_ON, SOURCE_URL, StartupFile, StepScope,
    UndeterminedReason, ZdotdirView, ZshFileDetail, ZshFileOutcome, ZshFileView, ZshOverview,
    ZshRequest, ZshRevealRequest, read_overview, reveal_value,
};

fn write_home(fixture: &Fixture, relative: &str, contents: &str) -> PathBuf {
    let path = fixture.home.join(relative);
    fs::create_dir_all(path.parent().expect("parent")).expect("create parents");
    fs::write(&path, contents).expect("write file");
    path
}

fn overview(fixture: &Fixture) -> ZshOverview {
    read_overview(
        &fixture.coordinator(),
        Some(&fixture.home),
        &ZshRequest::default(),
    )
}

fn file(overview: &ZshOverview, which: StartupFile) -> &ZshFileView {
    overview
        .files
        .iter()
        .find(|view| view.file == which)
        .expect("file view")
}

fn ready(view: &ZshFileView) -> &ZshFileDetail {
    match &view.outcome {
        ZshFileOutcome::Ready(detail) => detail,
        other => panic!("{:?} is not ready: {other:?}", view.file),
    }
}

fn entries(view: &ZshFileView) -> Vec<&RowView> {
    ready(view)
        .rows
        .iter()
        .filter(|row| matches!(row, RowView::Entry { .. }))
        .collect()
}

fn entry_names(view: &ZshFileView) -> Vec<String> {
    entries(view)
        .into_iter()
        .map(|row| match row {
            RowView::Entry { name, .. } => name.clone(),
            _ => unreachable!(),
        })
        .collect()
}

fn unavailable(view: &ZshFileView) -> FailureKind {
    match &view.outcome {
        ZshFileOutcome::Unavailable { reason, .. } => *reason,
        other => panic!("{:?} is not unavailable: {other:?}", view.file),
    }
}

fn is_outside(view: &ZshFileView) -> bool {
    matches!(view.outcome, ZshFileOutcome::OutsideHome { .. })
}

fn is_not_located(view: &ZshFileView) -> bool {
    matches!(view.outcome, ZshFileOutcome::NotLocated { .. })
}

const ALL: [StartupFile; 4] = [
    StartupFile::Zshenv,
    StartupFile::Zprofile,
    StartupFile::Zshrc,
    StartupFile::Zlogin,
];

// ---- applicability and order ------------------------------------------------

#[test]
fn the_documented_order_and_shell_types_are_listed_with_their_source() {
    let fixture = Fixture::new();
    let overview = overview(&fixture);

    assert_eq!(overview.source.url, SOURCE_URL);
    assert_eq!(overview.source.consulted_on, SOURCE_CONSULTED_ON);
    assert_eq!(SOURCE_CONSULTED_ON, "2026-10-15");
    assert!(SOURCE_URL.starts_with("https://zsh.sourceforge.io/Doc/Release/Files.html"));

    let steps: Vec<_> = overview
        .order
        .iter()
        .map(|step| {
            (
                step.position,
                step.scope,
                step.path_label,
                step.applies_to,
                step.file,
                step.read_by_user_home,
            )
        })
        .collect();
    assert_eq!(
        steps,
        [
            (
                1,
                StepScope::System,
                "/etc/zshenv",
                AppliesTo::All,
                None,
                false
            ),
            (
                2,
                StepScope::User,
                "~/.zshenv",
                AppliesTo::All,
                Some(StartupFile::Zshenv),
                true
            ),
            (
                3,
                StepScope::System,
                "/etc/zprofile",
                AppliesTo::Login,
                None,
                false
            ),
            (
                4,
                StepScope::User,
                "~/.zprofile",
                AppliesTo::Login,
                Some(StartupFile::Zprofile),
                true
            ),
            (
                5,
                StepScope::System,
                "/etc/zshrc",
                AppliesTo::Interactive,
                None,
                false
            ),
            (
                6,
                StepScope::User,
                "~/.zshrc",
                AppliesTo::Interactive,
                Some(StartupFile::Zshrc),
                true
            ),
            (
                7,
                StepScope::System,
                "/etc/zlogin",
                AppliesTo::Login,
                None,
                false
            ),
            (
                8,
                StepScope::User,
                "~/.zlogin",
                AppliesTo::Login,
                Some(StartupFile::Zlogin),
                true
            ),
        ]
    );

    let files: Vec<_> = overview
        .files
        .iter()
        .map(|view| (view.file, view.name, view.applies_to, view.position))
        .collect();
    assert_eq!(
        files,
        [
            (StartupFile::Zshenv, ".zshenv", AppliesTo::All, 2),
            (StartupFile::Zprofile, ".zprofile", AppliesTo::Login, 4),
            (StartupFile::Zshrc, ".zshrc", AppliesTo::Interactive, 6),
            (StartupFile::Zlogin, ".zlogin", AppliesTo::Login, 8),
        ]
    );
}

#[test]
fn files_are_read_below_home_and_system_files_are_never_read() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshenv", "export A=1\n");
    write_home(&fixture, ".zshrc", "export B=2\n");
    let overview = overview(&fixture);

    assert_eq!(overview.zdotdir, ZdotdirView::Default);
    assert_eq!(
        file(&overview, StartupFile::Zshenv).display_path.as_deref(),
        Some("~/.zshenv")
    );
    assert_eq!(entry_names(file(&overview, StartupFile::Zshenv)), ["A"]);
    assert_eq!(entry_names(file(&overview, StartupFile::Zshrc)), ["B"]);
    for step in overview
        .order
        .iter()
        .filter(|step| step.scope == StepScope::System)
    {
        assert!(!step.read_by_user_home);
        assert_eq!(step.file, None);
    }
    let detail = ready(file(&overview, StartupFile::Zshrc));
    assert_eq!(detail.size_bytes, 11);
    assert_eq!(detail.line_count, 1);
    assert_eq!(detail.content_hash.len(), 64);
    assert_eq!((detail.entry_count, detail.secret_count), (1, 0));
}

// ---- read failures ------------------------------------------------------------

#[test]
fn missing_files_are_not_found_rather_than_empty() {
    let fixture = Fixture::new();
    let overview = overview(&fixture);
    for which in ALL {
        assert_eq!(
            unavailable(file(&overview, which)),
            FailureKind::NotFound,
            "{which:?}"
        );
    }
    assert_eq!(overview.zdotdir, ZdotdirView::Default);
}

#[test]
fn read_failures_keep_their_own_kind() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshenv", "# fine\n");
    fs::write(fixture.home.join(".zprofile"), vec![b'#'; 1024 * 1024 + 1]).expect("big file");
    fs::write(fixture.home.join(".zlogin"), [0xff, 0xfe, 0x00]).expect("binary file");
    fs::create_dir(fixture.home.join(".zshrc")).expect("directory instead of file");

    let overview = overview(&fixture);

    assert_eq!(
        unavailable(file(&overview, StartupFile::Zprofile)),
        FailureKind::TooLarge
    );
    assert_eq!(
        unavailable(file(&overview, StartupFile::Zlogin)),
        FailureKind::Malformed
    );
    assert_eq!(
        unavailable(file(&overview, StartupFile::Zshrc)),
        FailureKind::Unsupported
    );
    assert!(matches!(
        file(&overview, StartupFile::Zshenv).outcome,
        ZshFileOutcome::Ready(_)
    ));
}

#[test]
fn a_file_at_the_limit_is_read() {
    let fixture = Fixture::new();
    fs::write(fixture.home.join(".zshrc"), vec![b'#'; 1024 * 1024]).expect("file at limit");
    let overview = overview(&fixture);
    // One long comment line: a single row.
    assert_eq!(
        ready(file(&overview, StartupFile::Zshrc)).size_bytes,
        1024 * 1024
    );
}

#[test]
fn an_unreadable_file_is_permission_denied() {
    let fixture = Fixture::new();
    let path = write_home(&fixture, ".zprofile", "export A=1\n");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).expect("lock file");
    if fs::File::open(&path).is_ok() {
        return; // running as a user that bypasses file modes
    }
    let overview = overview(&fixture);
    assert_eq!(
        unavailable(file(&overview, StartupFile::Zprofile)),
        FailureKind::PermissionDenied
    );
}

#[test]
fn links_leaving_home_or_pointing_at_credentials_are_not_read_or_followed() {
    let fixture = Fixture::new();
    fs::write(fixture.outside.join("rc"), "export LEAKED=outside-value\n").expect("outside file");
    symlink(fixture.outside.join("rc"), fixture.home.join(".zshrc")).expect("outside link");
    fs::create_dir_all(fixture.home.join(".ssh")).expect("ssh dir");
    fs::write(
        fixture.home.join(".ssh/config"),
        "export LEAKED=ssh-value\n",
    )
    .expect("ssh file");
    symlink(
        fixture.home.join(".ssh/config"),
        fixture.home.join(".zlogin"),
    )
    .expect("ssh link");
    write_home(&fixture, "dotfiles/zprofile", "export KEPT=1\n");
    symlink(
        fixture.home.join("dotfiles/zprofile"),
        fixture.home.join(".zprofile"),
    )
    .expect("inside link");

    let overview = overview(&fixture);

    for which in [StartupFile::Zshrc, StartupFile::Zlogin] {
        assert!(
            is_outside(file(&overview, which)),
            "{which:?}: {:?}",
            file(&overview, which).outcome
        );
    }
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zprofile)),
        ["KEPT"]
    );
    let json = serde_json::to_string(&overview).expect("serialize");
    assert!(
        !json.contains("LEAKED") && !json.contains("outside-value") && !json.contains("ssh-value")
    );
}

#[test]
fn without_a_usable_home_nothing_is_read() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshrc", "export A=1\n");
    for home in [None, Some(Path::new("relative")), Some(Path::new("/"))] {
        let overview = read_overview(&fixture.coordinator(), home, &ZshRequest::default());
        assert_eq!(
            unavailable(file(&overview, StartupFile::Zshenv)),
            FailureKind::Excluded,
            "{home:?}"
        );
        for which in [
            StartupFile::Zprofile,
            StartupFile::Zshrc,
            StartupFile::Zlogin,
        ] {
            assert!(is_not_located(file(&overview, which)), "{home:?}");
        }
        assert!(matches!(
            overview.zdotdir,
            ZdotdirView::Undetermined {
                reason: UndeterminedReason::ZshenvNotRead,
                ..
            }
        ));
    }
}

// ---- ZDOTDIR -------------------------------------------------------------------

fn zdotdir_fixture(zshenv: &str) -> Fixture {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshenv", zshenv);
    write_home(&fixture, ".zshrc", "export FROM_HOME=1\n");
    write_home(&fixture, ".config/zsh/.zshrc", "export FROM_ZDOTDIR=1\n");
    write_home(
        &fixture,
        ".config/zsh/.zprofile",
        "export PROFILE_FROM_ZDOTDIR=1\n",
    );
    fixture
}

#[test]
fn a_literal_zdotdir_is_followed_for_the_other_three_files_only() {
    let spellings: [fn(&Fixture) -> String; 4] = [
        |_| "export ZDOTDIR=\"$HOME/.config/zsh\"\n".to_owned(),
        |_| "ZDOTDIR=~/.config/zsh\n".to_owned(),
        |_| "typeset -x ZDOTDIR=${HOME}/.config/zsh # moved\n".to_owned(),
        |fixture| format!("export ZDOTDIR={}/.config/zsh\n", fixture.home.display()),
    ];
    for spelling in spellings {
        let fixture = Fixture::new();
        write_home(&fixture, ".config/zsh/.zshrc", "export FROM_ZDOTDIR=1\n");
        write_home(
            &fixture,
            ".config/zsh/.zprofile",
            "export PROFILE_FROM_ZDOTDIR=1\n",
        );
        write_home(&fixture, ".zshrc", "export FROM_HOME=1\n");
        write_home(&fixture, ".zshenv", &spelling(&fixture));

        let overview = overview(&fixture);

        assert!(
            matches!(&overview.zdotdir, ZdotdirView::Static { display_path, line: 1 } if display_path == "~/.config/zsh"),
            "{:?}",
            overview.zdotdir
        );
        // `.zshenv` itself is always read from `$HOME`.
        assert_eq!(
            file(&overview, StartupFile::Zshenv).display_path.as_deref(),
            Some("~/.zshenv")
        );
        assert_eq!(
            entry_names(file(&overview, StartupFile::Zshrc)),
            ["FROM_ZDOTDIR"]
        );
        assert_eq!(
            file(&overview, StartupFile::Zshrc).display_path.as_deref(),
            Some("~/.config/zsh/.zshrc")
        );
        assert_eq!(
            entry_names(file(&overview, StartupFile::Zprofile)),
            ["PROFILE_FROM_ZDOTDIR"]
        );
        assert_eq!(
            unavailable(file(&overview, StartupFile::Zlogin)),
            FailureKind::NotFound
        );
    }
}

#[test]
fn no_assignment_means_home_and_comments_naming_zdotdir_do_not_count() {
    let fixture = zdotdir_fixture("# ZDOTDIR=~/elsewhere is not set here\nexport A=1\n");
    let overview = overview(&fixture);
    assert_eq!(overview.zdotdir, ZdotdirView::Default);
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zshrc)),
        ["FROM_HOME"]
    );
}

#[test]
fn zdotdir_equal_to_home_is_the_default_location() {
    let fixture = zdotdir_fixture("export ZDOTDIR=$HOME\n");
    let overview = overview(&fixture);
    assert!(
        matches!(&overview.zdotdir, ZdotdirView::Static { display_path, .. } if display_path == "~")
    );
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zshrc)),
        ["FROM_HOME"]
    );
}

#[test]
fn a_literal_zdotdir_outside_home_is_reported_and_not_read() {
    let fixture = Fixture::new();
    fs::write(
        fixture.outside.join(".zshrc"),
        "export LEAKED=outside-value\n",
    )
    .expect("outside rc");
    write_home(
        &fixture,
        ".zshenv",
        &format!("export ZDOTDIR={}\n", fixture.outside.display()),
    );
    let overview = overview(&fixture);

    assert!(
        matches!(&overview.zdotdir, ZdotdirView::Outside { line: 1, .. }),
        "{:?}",
        overview.zdotdir
    );
    for which in [
        StartupFile::Zprofile,
        StartupFile::Zshrc,
        StartupFile::Zlogin,
    ] {
        assert!(is_outside(file(&overview, which)));
    }
    assert!(matches!(
        file(&overview, StartupFile::Zshenv).outcome,
        ZshFileOutcome::Ready(_)
    ));
    assert!(
        !serde_json::to_string(&overview)
            .expect("serialize")
            .contains("outside-value")
    );

    // A `..` that climbs out of `$HOME` is not decided lexically any more: the
    // literal is undetermined (`ParentSegment`), so nothing is located or read.
    let climbing = Fixture::new();
    fs::write(
        climbing.outside.join(".zshrc"),
        "export LEAKED=outside-value\n",
    )
    .expect("rc");
    write_home(&climbing, ".zshenv", "export ZDOTDIR=$HOME/../outside\n");
    let overview = self::overview(&climbing);
    assert!(is_not_located(file(&overview, StartupFile::Zshrc)));
}

#[test]
fn zdotdir_values_that_cannot_be_read_statically_are_undetermined() {
    let cases = [
        (
            "[[ -n $XDG_CONFIG_HOME ]] && export ZDOTDIR=~/.config/zsh\n",
            UndeterminedReason::Dynamic,
        ),
        (
            "export ZDOTDIR=$XDG_CONFIG_HOME/zsh\n",
            UndeterminedReason::Dynamic,
        ),
        (
            "ZDOTDIR=$(echo ~/.config/zsh)\n",
            UndeterminedReason::Dynamic,
        ),
        (
            "if true; then\n  ZDOTDIR=~/.config/zsh\nfi\n",
            UndeterminedReason::Dynamic,
        ),
        ("unset ZDOTDIR\n", UndeterminedReason::Dynamic),
        (
            "setup() { ZDOTDIR=~/.config/zsh; }\n",
            UndeterminedReason::Dynamic,
        ),
        (
            "export ZDOTDIR=~/a\nexport ZDOTDIR=~/b\n",
            UndeterminedReason::Multiple,
        ),
        ("export ZDOTDIR=zsh\n", UndeterminedReason::UnsupportedForm),
        ("export ZDOTDIR=\n", UndeterminedReason::UnsupportedForm),
        ("ZDOTDIR+=/more\n", UndeterminedReason::UnsupportedForm),
        (
            "export ZDOTDIR=~other/zsh\n",
            UndeterminedReason::UnsupportedForm,
        ),
    ];
    for (zshenv, expected) in cases {
        let fixture = zdotdir_fixture(zshenv);
        let overview = overview(&fixture);
        assert!(
            matches!(&overview.zdotdir, ZdotdirView::Undetermined { reason, selection_problem: None } if *reason == expected),
            "{zshenv:?} -> {:?}",
            overview.zdotdir
        );
        // Nothing is guessed: the other three files are not located or read.
        for which in [
            StartupFile::Zprofile,
            StartupFile::Zshrc,
            StartupFile::Zlogin,
        ] {
            assert!(is_not_located(file(&overview, which)), "{zshenv:?}");
            assert_eq!(file(&overview, which).display_path, None);
        }
        assert!(matches!(
            file(&overview, StartupFile::Zshenv).outcome,
            ZshFileOutcome::Ready(_)
        ));
    }
}

#[test]
fn a_zdotdir_literal_with_parent_segments_is_undetermined_and_never_guessed() {
    // `..` is not folded away lexically: neither the escape nor the "still
    // inside" reading is trusted, so nothing below the literal is located.
    let cases = [
        "export ZDOTDIR=$HOME/../outside\n",
        "export ZDOTDIR=~/../outside\n",
        "export ZDOTDIR=$HOME/.config/zsh/..\n",
        "export ZDOTDIR=$HOME/a/../.config/zsh\n",
        "export ZDOTDIR=\"$HOME/.config/../.config/zsh\"\n",
        "export ZDOTDIR=/somewhere/../else\n",
        "export ZDOTDIR=/..\n",
        "export ZDOTDIR=$HOME/..\n",
    ];
    for zshenv in cases {
        let fixture = zdotdir_fixture(zshenv);
        fs::write(
            fixture.outside.join(".zshrc"),
            "export LEAKED=outside-value\n",
        )
        .expect("outside rc");
        let overview = overview(&fixture);
        assert!(
            matches!(
                &overview.zdotdir,
                ZdotdirView::Undetermined {
                    reason: UndeterminedReason::ParentSegment,
                    selection_problem: None
                }
            ),
            "{zshenv:?} -> {:?}",
            overview.zdotdir
        );
        for which in [
            StartupFile::Zprofile,
            StartupFile::Zshrc,
            StartupFile::Zlogin,
        ] {
            assert!(is_not_located(file(&overview, which)), "{zshenv:?}");
        }
        assert!(
            !serde_json::to_string(&overview)
                .expect("serialize")
                .contains("outside-value")
        );
    }
}

#[test]
fn dots_inside_a_name_are_not_parent_segments() {
    for zshenv in [
        "export ZDOTDIR=$HOME/.config/zsh\n",
        "export ZDOTDIR=$HOME/..config\n",
        "export ZDOTDIR=$HOME/a..b\n",
        "export ZDOTDIR=$HOME/.config/zsh/.\n",
    ] {
        let fixture = zdotdir_fixture(zshenv);
        let overview = overview(&fixture);
        assert!(
            !matches!(
                &overview.zdotdir,
                ZdotdirView::Undetermined {
                    reason: UndeterminedReason::ParentSegment,
                    ..
                }
            ),
            "{zshenv:?} -> {:?}",
            overview.zdotdir
        );
    }
}

#[test]
fn an_unreadable_zshenv_leaves_zdotdir_undetermined() {
    let fixture = Fixture::new();
    fs::write(fixture.home.join(".zshenv"), vec![b'#'; 1024 * 1024 + 1]).expect("big zshenv");
    write_home(&fixture, ".zshrc", "export A=1\n");
    let overview = overview(&fixture);
    assert!(matches!(
        overview.zdotdir,
        ZdotdirView::Undetermined {
            reason: UndeterminedReason::ZshenvNotRead,
            ..
        }
    ));
    assert!(is_not_located(file(&overview, StartupFile::Zshrc)));

    let linked = Fixture::new();
    fs::write(linked.outside.join("env"), "export ZDOTDIR=~/z\n").expect("outside env");
    symlink(linked.outside.join("env"), linked.home.join(".zshenv")).expect("link");
    let overview = self::overview(&linked);
    assert!(is_outside(file(&overview, StartupFile::Zshenv)));
    assert!(matches!(
        overview.zdotdir,
        ZdotdirView::Undetermined {
            reason: UndeterminedReason::ZshenvNotRead,
            ..
        }
    ));
}

// ---- the user's choice for an undetermined ZDOTDIR ------------------------------

fn with_grant(fixture: &Fixture, directory: &Path) -> (GrantCoordinator, ZshRequest) {
    let coordinator = fixture.coordinator();
    let id = fixture.grant(&coordinator, directory);
    (
        coordinator,
        ZshRequest {
            zdotdir_grant: Some(id),
        },
    )
}

#[test]
fn a_chosen_directory_locates_the_files_when_zdotdir_is_undetermined() {
    let fixture = zdotdir_fixture("[[ -d ~/.config/zsh ]] && export ZDOTDIR=~/.config/zsh\n");
    let directory = fixture.home.join(".config/zsh");
    let (coordinator, request) = with_grant(&fixture, &directory);

    let overview = read_overview(&coordinator, Some(&fixture.home), &request);

    assert!(
        matches!(&overview.zdotdir, ZdotdirView::Selected { display_path } if display_path == "~/.config/zsh"),
        "{:?}",
        overview.zdotdir
    );
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zshrc)),
        ["FROM_ZDOTDIR"]
    );
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zprofile)),
        ["PROFILE_FROM_ZDOTDIR"]
    );
    assert_eq!(
        unavailable(file(&overview, StartupFile::Zlogin)),
        FailureKind::NotFound
    );
}

#[test]
fn a_chosen_directory_never_overrides_a_determined_zdotdir() {
    let fixture = zdotdir_fixture("export ZDOTDIR=~/.config/zsh\n");
    write_home(&fixture, "other/.zshrc", "export FROM_OTHER=1\n");
    let (coordinator, request) = with_grant(&fixture, &fixture.home.join("other"));
    let overview = read_overview(&coordinator, Some(&fixture.home), &request);
    assert!(matches!(overview.zdotdir, ZdotdirView::Static { .. }));
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zshrc)),
        ["FROM_ZDOTDIR"]
    );

    let default = Fixture::new();
    write_home(&default, ".zshrc", "export FROM_HOME=1\n");
    write_home(&default, "other/.zshrc", "export FROM_OTHER=1\n");
    let (coordinator, request) = with_grant(&default, &default.home.join("other"));
    let overview = read_overview(&coordinator, Some(&default.home), &request);
    assert_eq!(overview.zdotdir, ZdotdirView::Default);
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zshrc)),
        ["FROM_HOME"]
    );
}

#[test]
fn an_unusable_choice_is_reported_and_leaves_the_files_unlocated() {
    let fixture = zdotdir_fixture("export ZDOTDIR=$DYNAMIC\n");
    let coordinator = fixture.coordinator();
    let directory = fixture.home.join(".config/zsh");

    let revoked = fixture.grant(&coordinator, &directory);
    coordinator.revoke(&revoked).expect("revoke");
    let file_path = write_home(&fixture, "a-file", "x");
    let file_grant = coordinator
        .create(GrantPurpose::ConfigFile, &file_path)
        .expect("file grant")
        .id;

    for grant in [revoked, file_grant] {
        let request = ZshRequest {
            zdotdir_grant: Some(grant),
        };
        let overview = read_overview(&coordinator, Some(&fixture.home), &request);
        assert!(
            matches!(
                &overview.zdotdir,
                ZdotdirView::Undetermined {
                    reason: UndeterminedReason::Dynamic,
                    selection_problem: Some(_)
                }
            ),
            "{:?}",
            overview.zdotdir
        );
        assert!(is_not_located(file(&overview, StartupFile::Zshrc)));
    }
}

// ---- static recognition in the files ---------------------------------------------

#[test]
fn literal_assignments_exports_and_path_items_are_listed_with_their_state() {
    let fixture = Fixture::new();
    write_home(
        &fixture,
        ".zshrc",
        "# my setup\n\
         export EDITOR=\"vim\"\n\
         LANG=en_US.UTF-8\n\
         export PATH=/opt/bin:$HOME/bin:$PATH\n\
         path+=(~/go/bin)\n\
         export GOPATH=$(go env GOPATH)\n",
    );
    let overview = overview(&fixture);
    let rows = &ready(file(&overview, StartupFile::Zshrc)).rows;

    let RowView::Entry {
        name,
        value,
        state,
        exported,
        ..
    } = &rows[1]
    else {
        panic!("{rows:?}");
    };
    assert_eq!(
        (name.as_str(), value.as_deref(), *state, *exported),
        ("EDITOR", Some("vim"), ValueState::Static, true)
    );
    let RowView::Entry {
        path_segments: Some(segments),
        state,
        ..
    } = &rows[3]
    else {
        panic!("{rows:?}");
    };
    assert_eq!(*state, ValueState::Reference);
    let texts: Vec<_> = segments
        .iter()
        .map(|segment| (segment.text.as_str(), segment.state))
        .collect();
    assert_eq!(
        texts,
        [
            ("/opt/bin", ValueState::Static),
            ("$HOME/bin", ValueState::Reference),
            ("$PATH", ValueState::Reference),
        ]
    );
    assert!(matches!(&rows[4], RowView::Entry { name, .. } if name == "path"));
    // A dynamic value is marked with its reason and keeps the text as written.
    let RowView::Entry {
        state,
        reason,
        value,
        ..
    } = &rows[5]
    else {
        panic!("{rows:?}")
    };
    assert_eq!(*state, ValueState::Dynamic);
    assert_eq!(*reason, Some(DynamicReason::CommandSubstitution));
    assert_eq!(value.as_deref(), Some("$(go env GOPATH)"));
}

#[test]
fn dynamic_constructs_are_marked_and_unknown_lines_are_kept_not_dropped() {
    let fixture = Fixture::new();
    write_home(
        &fixture,
        ".zshrc",
        "source ~/.zsh_extra\n\
         eval \"$(brew shellenv)\"\n\
         alias ll='ls -l'\n\
         if [[ -f ~/.x ]]; then\n\
         \x20 export INSIDE=1\n\
         fi\n\
         setopt autocd\n\
         export OUTSIDE=1\n",
    );
    let overview = overview(&fixture);
    let detail = ready(file(&overview, StartupFile::Zshrc));

    let reasons: Vec<_> = detail
        .rows
        .iter()
        .filter_map(|row| match row {
            RowView::Dynamic { reason, .. } => Some(*reason),
            _ => None,
        })
        .collect();
    assert_eq!(
        reasons,
        [
            DynamicReason::Source,
            DynamicReason::Eval,
            DynamicReason::Alias,
            DynamicReason::Conditional,
            DynamicReason::Block,
            DynamicReason::Block,
        ]
    );
    assert_eq!(
        entry_names(file(&overview, StartupFile::Zshrc)),
        ["OUTSIDE"]
    );
    assert_eq!(detail.dynamic_count, 6);
    assert_eq!(detail.unrecognized_count, 1);
    assert!(detail.rows.iter().any(|row| matches!(
        row,
        RowView::Unrecognized { line: 7, text: Some(text), .. } if text == "setopt autocd"
    )));
    assert_eq!(detail.rows.len(), 8);
}

#[test]
fn the_same_name_in_different_files_is_listed_per_file_without_a_global_value() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshenv", "export EDITOR=vim\n");
    write_home(&fixture, ".zshrc", "export EDITOR=nano\n");
    write_home(&fixture, ".zprofile", "export EDITOR=$VISUAL\n");
    let overview = overview(&fixture);

    let values: Vec<_> = ALL
        .iter()
        .filter(|which| matches!(file(&overview, **which).outcome, ZshFileOutcome::Ready(_)))
        .filter_map(|which| {
            entries(file(&overview, *which))
                .into_iter()
                .find_map(|row| match row {
                    RowView::Entry {
                        name, value, state, ..
                    } if name == "EDITOR" => Some((*which, value.clone(), *state)),
                    _ => None,
                })
        })
        .collect();
    assert_eq!(
        values,
        [
            (
                StartupFile::Zshenv,
                Some("vim".to_owned()),
                ValueState::Static
            ),
            (
                StartupFile::Zprofile,
                Some("$VISUAL".to_owned()),
                ValueState::Dynamic
            ),
            (
                StartupFile::Zshrc,
                Some("nano".to_owned()),
                ValueState::Static
            ),
        ]
    );
    // The overview has no merged or "effective" value anywhere.
    let json = serde_json::to_string(&overview)
        .expect("serialize")
        .to_lowercase();
    assert!(!json.contains("effective") && !json.contains("winner") && !json.contains("merged"));
}

#[test]
fn rows_are_capped_and_the_cut_is_reported() {
    let fixture = Fixture::new();
    let text: String = (0..5001)
        .map(|index| format!("export V{index}=1\n"))
        .collect();
    write_home(&fixture, ".zshrc", &text);
    let overview = overview(&fixture);
    let detail = ready(file(&overview, StartupFile::Zshrc));
    assert!(detail.rows_truncated);
    assert_eq!(detail.rows.len(), 5000);
    assert_eq!(detail.line_count, 5001);
    assert_eq!(detail.entry_count, 5001);
}

// ---- no execution --------------------------------------------------------------

#[test]
fn startup_files_are_never_executed_sourced_or_modified() {
    let fixture = Fixture::new();
    let marker = |name: &str| fixture.root.join(name);
    write_home(
        &fixture,
        "script.zsh",
        &format!("touch {}\n", marker("sourced").display()),
    );
    let script = fixture.home.join("script.zsh");
    let zshenv = [
        format!("export A=$(touch {})", marker("m1").display()),
        format!("export B=`touch {}`", marker("m2").display()),
        format!("source {}", script.display()),
        format!(". {}", script.display()),
        format!("eval 'touch {}'", marker("m3").display()),
        format!(
            "export ZDOTDIR=$(touch {}; echo ~/z)",
            marker("m4").display()
        ),
        format!("alias boom='touch {}'", marker("m5").display()),
        format!("f() {{ touch {}; }}", marker("m6").display()),
        "f".to_owned(),
        "cat <<END".to_owned(),
        format!("$(touch {})", marker("m7").display()),
        "END".to_owned(),
        String::new(),
    ]
    .join("\n");
    let path = write_home(&fixture, ".zshenv", &zshenv);
    write_home(&fixture, ".zshrc", &zshenv);

    let before = fs::read(&path).expect("read before");
    let coordinator = fixture.coordinator();
    let overview = read_overview(&coordinator, Some(&fixture.home), &ZshRequest::default());
    let _ = reveal_value(
        &coordinator,
        Some(&fixture.home),
        &reveal_request(StartupFile::Zshenv, 1, "A"),
    );

    for name in ["sourced", "m1", "m2", "m3", "m4", "m5", "m6", "m7"] {
        assert!(!marker(name).exists(), "{name} was executed");
    }
    assert_eq!(
        fs::read(&path).expect("read after"),
        before,
        "file was modified"
    );
    assert!(matches!(
        overview.zdotdir,
        ZdotdirView::Undetermined {
            reason: UndeterminedReason::Dynamic,
            ..
        }
    ));
}

// ---- secrets ---------------------------------------------------------------------

fn reveal_request(file: StartupFile, line: usize, name: &str) -> ZshRevealRequest {
    ZshRevealRequest {
        zsh: ZshRequest::default(),
        file,
        line,
        name: name.to_owned(),
    }
}

fn reveal(fixture: &Fixture, request: &ZshRevealRequest) -> Result<String, AppErrorCode> {
    reveal_value(&fixture.coordinator(), Some(&fixture.home), request)
        .map(|revealed| revealed.value)
        .map_err(|error| error.code())
}

#[test]
fn secret_values_never_travel_with_the_list_and_are_revealed_on_request() {
    let fixture = Fixture::new();
    write_home(
        &fixture,
        ".zshrc",
        "# export OLD_TOKEN=comment-secret-1\n\
         export GITHUB_TOKEN=ghp-secret-2\n\
         export DB=postgres://user:pw-secret-3@host/db\n\
         export PLAIN=visible\n\
         [[ -n $X ]] && export API_KEY=cond-secret-4\n",
    );
    let coordinator = fixture.coordinator();
    let overview = read_overview(&coordinator, Some(&fixture.home), &ZshRequest::default());

    let json = serde_json::to_string(&overview).expect("serialize");
    for secret in [
        "comment-secret-1",
        "ghp-secret-2",
        "pw-secret-3",
        "cond-secret-4",
    ] {
        assert!(!json.contains(secret), "{secret} leaked into the list");
    }
    assert!(json.contains("visible") && json.contains("GITHUB_TOKEN"));
    let detail = ready(file(&overview, StartupFile::Zshrc));
    assert_eq!(detail.secret_count, 2);
    let RowView::Entry {
        secret,
        has_value,
        value_length,
        value,
        ..
    } = &detail.rows[1]
    else {
        panic!("{:?}", detail.rows);
    };
    assert!(*secret && *has_value && value.is_none());
    assert_eq!(*value_length, "ghp-secret-2".len());
    assert!(matches!(
        &detail.rows[0],
        RowView::Comment {
            text: None,
            withheld: true,
            ..
        }
    ));
    assert!(matches!(
        &detail.rows[4],
        RowView::Dynamic {
            text: None,
            withheld: true,
            ..
        }
    ));

    let revealed = reveal_value(
        &coordinator,
        Some(&fixture.home),
        &reveal_request(StartupFile::Zshrc, 2, "GITHUB_TOKEN"),
    )
    .expect("reveal");
    assert_eq!(revealed.value, "ghp-secret-2");
    assert!(!format!("{revealed:?}").contains("ghp-secret-2"));
}

#[test]
fn revealing_requires_the_same_entry_to_still_be_there() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshrc", "export A_TOKEN=one\nexport B=2\n");

    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zshrc, 1, "A_TOKEN")),
        Ok("one".to_owned())
    );
    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zshrc, 2, "B")),
        Ok("2".to_owned())
    );
    for wrong in [
        reveal_request(StartupFile::Zshrc, 2, "A_TOKEN"),
        reveal_request(StartupFile::Zshrc, 1, "B"),
        reveal_request(StartupFile::Zshrc, 9, "A_TOKEN"),
    ] {
        assert_eq!(
            reveal(&fixture, &wrong),
            Err(AppErrorCode::Conflict),
            "{wrong:?}"
        );
    }
    // The file changed after it was listed.
    write_home(&fixture, ".zshrc", "# moved\nexport A_TOKEN=two\n");
    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zshrc, 1, "A_TOKEN")),
        Err(AppErrorCode::Conflict)
    );
    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zshrc, 2, "A_TOKEN")),
        Ok("two".to_owned())
    );
}

#[test]
fn revealing_keeps_read_failures_and_never_leaves_home() {
    let fixture = Fixture::new();
    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zlogin, 1, "A")),
        Err(AppErrorCode::NotFound)
    );

    fs::write(fixture.outside.join("rc"), "export A=outside\n").expect("outside");
    symlink(fixture.outside.join("rc"), fixture.home.join(".zprofile")).expect("link");
    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zprofile, 1, "A")),
        Err(AppErrorCode::PermissionDenied)
    );

    // With an undetermined ZDOTDIR only `.zshenv` can be revealed.
    write_home(&fixture, ".zshenv", "export ZDOTDIR=$X\nexport K_TOKEN=k\n");
    write_home(&fixture, ".zshrc", "export K_TOKEN=home\n");
    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zshenv, 2, "K_TOKEN")),
        Ok("k".to_owned())
    );
    assert_eq!(
        reveal(&fixture, &reveal_request(StartupFile::Zshrc, 1, "K_TOKEN")),
        Err(AppErrorCode::Conflict)
    );
}

#[test]
fn revealing_follows_a_chosen_directory() {
    let fixture = zdotdir_fixture("export ZDOTDIR=$X\n");
    write_home(&fixture, ".config/zsh/.zshrc", "export S_TOKEN=chosen\n");
    let (coordinator, request) = with_grant(&fixture, &fixture.home.join(".config/zsh"));
    let revealed = reveal_value(
        &coordinator,
        Some(&fixture.home),
        &ZshRevealRequest {
            zsh: request,
            file: StartupFile::Zshrc,
            line: 1,
            name: "S_TOKEN".to_owned(),
        },
    )
    .expect("reveal");
    assert_eq!(revealed.value, "chosen");
}

// ---- wire format --------------------------------------------------------------------

#[test]
fn the_overview_serializes_with_the_documented_field_names() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshenv", "export ZDOTDIR=$X\n");
    let json: Value = serde_json::to_value(overview(&fixture)).expect("serialize");

    assert_eq!(json["source"]["consultedOn"], "2026-10-15");
    assert_eq!(json["order"][1]["appliesTo"], "ALL");
    assert_eq!(json["order"][1]["readByUserHome"], true);
    assert_eq!(json["order"][1]["file"], "ZSHENV");
    assert_eq!(json["order"][0]["file"], Value::Null);
    assert_eq!(json["order"][0]["scope"], "SYSTEM");
    assert_eq!(json["zdotdir"]["status"], "UNDETERMINED");
    assert_eq!(json["zdotdir"]["reason"], "DYNAMIC");
    assert_eq!(json["zdotdir"]["selectionProblem"], Value::Null);
    assert_eq!(json["files"][0]["file"], "ZSHENV");
    assert_eq!(json["files"][0]["outcome"]["status"], "READY");
    assert_eq!(json["files"][0]["outcome"]["rows"][0]["kind"], "ENTRY");
    assert_eq!(json["files"][0]["outcome"]["rows"][0]["state"], "DYNAMIC");
    assert_eq!(
        json["files"][0]["outcome"]["rows"][0]["reason"],
        "UNRESOLVED_REFERENCE"
    );
    assert_eq!(json["files"][1]["outcome"]["status"], "NOT_LOCATED");
    assert_eq!(json["files"][3]["outcome"]["status"], "NOT_LOCATED");
}

#[test]
fn the_wire_format_covers_every_row_and_outcome_shape() {
    let fixture = Fixture::new();
    write_home(&fixture, ".zshenv", "export ZDOTDIR=~/z\n");
    write_home(
        &fixture,
        "z/.zshrc",
        "export PATH=/a:$PATH\nsource x\n# note\n\nfoo bar\n",
    );
    fs::create_dir_all(fixture.home.join("z/.zlogin")).expect("directory as file");
    let json: Value = serde_json::to_value(overview(&fixture)).expect("serialize");

    assert_eq!(json["zdotdir"]["status"], "STATIC");
    assert_eq!(json["zdotdir"]["displayPath"], "~/z");
    let rows = &json["files"][2]["outcome"]["rows"];
    let kinds: Vec<_> = rows
        .as_array()
        .expect("rows")
        .iter()
        .map(|row| row["kind"].clone())
        .collect();
    assert_eq!(
        kinds,
        ["ENTRY", "DYNAMIC", "COMMENT", "BLANK", "UNRECOGNIZED"]
    );
    assert_eq!(rows[0]["pathSegments"][0]["text"], "/a");
    assert_eq!(rows[0]["pathSegments"][1]["state"], "REFERENCE");
    assert_eq!(rows[0]["operation"], "SET");
    assert_eq!(rows[1]["reason"], "SOURCE");
    assert_eq!(json["files"][3]["outcome"]["status"], "UNAVAILABLE");
    assert_eq!(json["files"][3]["outcome"]["reason"], "UNSUPPORTED");
    assert_eq!(json["files"][1]["outcome"]["reason"], "NOT_FOUND");
}
