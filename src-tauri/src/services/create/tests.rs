use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::Mutex,
};

use uuid::Uuid;

use crate::{
    config::ConfigEnvironment,
    error::AppErrorCode,
    grants::{
        GrantCoordinator, GrantPurpose, GrantStore, ResourceWriteContext, ResourceWriteCoordinator,
    },
    operations::OperationCoordinator,
    settings::BackupRetention,
};

use super::*;

// ------------------------------------------------------------ test plist reader

/// A reader for exactly the subset of the property list format the generator
/// writes. Anything else (CDATA, comments, unknown elements, stray markup) is an
/// error, so a successful read proves the document has the expected shape.
#[derive(Debug, Clone, PartialEq)]
enum Value {
    Str(String),
    Bool(bool),
    Array(Vec<Value>),
    Dict(Vec<(String, Value)>),
}

struct Reader<'a> {
    rest: &'a str,
}

impl<'a> Reader<'a> {
    fn skip_space(&mut self) {
        self.rest = self.rest.trim_start_matches([' ', '\t', '\n']);
    }

    fn eat(&mut self, token: &str) -> Result<(), String> {
        self.skip_space();
        self.rest = self.rest.strip_prefix(token).ok_or_else(|| {
            format!(
                "expected {token:?} at {:?}",
                &self.rest[..self.rest.len().min(40)]
            )
        })?;
        Ok(())
    }

    fn text_until(&mut self, close: &str) -> Result<String, String> {
        let end = self
            .rest
            .find(close)
            .ok_or_else(|| format!("missing {close}"))?;
        let raw = &self.rest[..end];
        if raw.contains('<') || raw.contains('>') || raw.contains('"') || raw.contains('\'') {
            return Err(format!("unescaped markup in {raw:?}"));
        }
        self.rest = &self.rest[end + close.len()..];
        unescape(raw)
    }

    fn value(&mut self) -> Result<Value, String> {
        self.skip_space();
        if self.rest.starts_with("<true/>") {
            self.eat("<true/>")?;
            return Ok(Value::Bool(true));
        }
        if self.rest.starts_with("<false/>") {
            self.eat("<false/>")?;
            return Ok(Value::Bool(false));
        }
        if self.rest.starts_with("<string>") {
            self.eat("<string>")?;
            return self.text_until("</string>").map(Value::Str);
        }
        if self.rest.starts_with("<array>") {
            self.eat("<array>")?;
            let mut items = Vec::new();
            loop {
                self.skip_space();
                if self.rest.starts_with("</array>") {
                    self.eat("</array>")?;
                    return Ok(Value::Array(items));
                }
                items.push(self.value()?);
            }
        }
        if self.rest.starts_with("<dict>") {
            self.eat("<dict>")?;
            let mut pairs = Vec::new();
            loop {
                self.skip_space();
                if self.rest.starts_with("</dict>") {
                    self.eat("</dict>")?;
                    return Ok(Value::Dict(pairs));
                }
                self.eat("<key>")?;
                let key = self.text_until("</key>")?;
                pairs.push((key, self.value()?));
            }
        }
        Err(format!(
            "unexpected {:?}",
            &self.rest[..self.rest.len().min(40)]
        ))
    }
}

fn unescape(raw: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let end = rest.find(';').ok_or("unterminated entity")?;
        out.push(match &rest[..=end] {
            "&amp;" => '&',
            "&lt;" => '<',
            "&gt;" => '>',
            "&quot;" => '"',
            "&apos;" => '\'',
            other => return Err(format!("unknown entity {other}")),
        });
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn read_plist(xml: &str) -> Value {
    let body = xml
        .strip_prefix("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        .and_then(|rest| {
            rest.strip_prefix(
                "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n",
            )
        })
        .expect("xml and doctype header");
    let mut reader = Reader { rest: body };
    reader.eat("<plist version=\"1.0\">").expect("plist open");
    let value = reader.value().expect("plist value");
    reader.eat("</plist>").expect("plist close");
    reader.skip_space();
    assert!(
        reader.rest.is_empty(),
        "trailing content: {:?}",
        reader.rest
    );
    value
}

fn dict(value: &Value) -> &[(String, Value)] {
    match value {
        Value::Dict(pairs) => pairs,
        other => panic!("not a dict: {other:?}"),
    }
}

fn keys(value: &Value) -> Vec<&str> {
    dict(value).iter().map(|(key, _)| key.as_str()).collect()
}

fn get<'a>(value: &'a Value, key: &str) -> &'a Value {
    &dict(value)
        .iter()
        .find(|(name, _)| name == key)
        .unwrap_or_else(|| panic!("missing key {key}"))
        .1
}

fn string(value: &Value) -> &str {
    match value {
        Value::Str(text) => text,
        other => panic!("not a string: {other:?}"),
    }
}

fn strings(value: &Value) -> Vec<&str> {
    match value {
        Value::Array(items) => items.iter().map(string).collect(),
        other => panic!("not an array: {other:?}"),
    }
}

// -------------------------------------------------------------- host fixtures

const HOME: &str = "/Users/tester";

#[derive(Default)]
struct FakeFacts {
    executables: HashMap<PathBuf, ExecutableFacts>,
    directories: HashMap<PathBuf, PathBuf>,
}

impl FakeFacts {
    fn new() -> Self {
        let mut facts = Self::default();
        facts.exe("/usr/local/bin/tool");
        facts.dir("/Users/tester/work");
        facts.dir("/Users/tester/logs");
        facts.dir("/Users/tester");
        facts.dir("/usr/local/var");
        facts
    }

    fn exe(&mut self, path: &str) -> &mut Self {
        self.link(path, path)
    }

    fn link(&mut self, path: &str, resolved: &str) -> &mut Self {
        self.executables.insert(
            PathBuf::from(path),
            ExecutableFacts {
                resolved: PathBuf::from(resolved),
                regular_file: true,
                user_executable: true,
                others_writable: false,
            },
        );
        self
    }

    fn facts_of(&mut self, path: &str) -> &mut ExecutableFacts {
        self.executables
            .get_mut(Path::new(path))
            .expect("known executable")
    }

    fn dir(&mut self, path: &str) -> &mut Self {
        self.directories
            .insert(PathBuf::from(path), PathBuf::from(path));
        self
    }

    fn dir_link(&mut self, path: &str, resolved: &str) -> &mut Self {
        self.directories
            .insert(PathBuf::from(path), PathBuf::from(resolved));
        self
    }
}

impl HostFacts for FakeFacts {
    fn inspect_executable(&self, path: &Path) -> Result<ExecutableFacts, FactsError> {
        self.executables.get(path).cloned().ok_or(FactsError)
    }

    fn resolve_directory(&self, path: &Path) -> Option<PathBuf> {
        self.directories.get(path).cloned()
    }
}

fn request() -> CreateServiceRequest {
    CreateServiceRequest {
        label: "backup".to_owned(),
        executable: "/usr/local/bin/tool".to_owned(),
        arguments: Vec::new(),
        working_directory: None,
        environment: BTreeMap::new(),
        stdout_path: None,
        stderr_path: None,
        run_at_load: false,
        keep_alive: false,
    }
}

fn validate_with(
    facts: &FakeFacts,
    request: &CreateServiceRequest,
) -> Result<ValidatedService, CreateError> {
    validate(request, Some(Path::new(HOME)), facts)
}

fn validated(request: &CreateServiceRequest) -> ValidatedService {
    validate_with(&FakeFacts::new(), request).expect("valid request")
}

fn invalid(request: &CreateServiceRequest) -> CreateError {
    validate_with(&FakeFacts::new(), request).expect_err("rejected")
}

const FULL: &str = "com.zephyr194.userhome.agent.backup";

// -------------------------------------------------------------------- plist

#[test]
fn a_minimal_request_renders_exactly_the_expected_keys() {
    let xml = validated(&request()).plist_xml();
    let plist = read_plist(&xml);

    assert_eq!(
        keys(&plist),
        ["Label", "ProgramArguments", "RunAtLoad", "KeepAlive"]
    );
    assert_eq!(string(get(&plist, "Label")), FULL);
    assert_eq!(
        strings(get(&plist, "ProgramArguments")),
        ["/usr/local/bin/tool"]
    );
    assert_eq!(get(&plist, "RunAtLoad"), &Value::Bool(false));
    assert_eq!(get(&plist, "KeepAlive"), &Value::Bool(false));
}

#[test]
fn a_full_request_renders_every_optional_key_in_a_fixed_order() {
    let mut full = request();
    full.arguments = vec!["--once".to_owned(), "a b".to_owned()];
    full.working_directory = Some("/Users/tester/work".to_owned());
    full.environment = BTreeMap::from([
        ("ZED".to_owned(), "last".to_owned()),
        ("ALPHA".to_owned(), "first value".to_owned()),
    ]);
    full.stdout_path = Some("/Users/tester/logs/out.log".to_owned());
    full.stderr_path = Some("/Users/tester/logs/err.log".to_owned());
    full.run_at_load = true;
    full.keep_alive = true;
    let xml = validated(&full).plist_xml();
    let plist = read_plist(&xml);

    assert_eq!(
        keys(&plist),
        [
            "Label",
            "ProgramArguments",
            "WorkingDirectory",
            "EnvironmentVariables",
            "StandardOutPath",
            "StandardErrorPath",
            "RunAtLoad",
            "KeepAlive"
        ]
    );
    assert_eq!(
        strings(get(&plist, "ProgramArguments")),
        ["/usr/local/bin/tool", "--once", "a b"]
    );
    assert_eq!(
        string(get(&plist, "WorkingDirectory")),
        "/Users/tester/work"
    );
    let environment: Vec<(&str, &str)> = dict(get(&plist, "EnvironmentVariables"))
        .iter()
        .map(|(key, value)| (key.as_str(), string(value)))
        .collect();
    assert_eq!(environment, [("ALPHA", "first value"), ("ZED", "last")]);
    assert_eq!(get(&plist, "RunAtLoad"), &Value::Bool(true));
    assert_eq!(get(&plist, "KeepAlive"), &Value::Bool(true));
    assert_eq!(validated(&full).plist_xml(), xml, "deterministic output");
}

#[test]
fn the_document_never_carries_a_user_switch_or_wrapper_key() {
    let mut full = request();
    full.arguments = vec!["x".to_owned()];
    full.working_directory = Some("/Users/tester/work".to_owned());
    full.environment = BTreeMap::from([("A".to_owned(), "b".to_owned())]);
    full.stdout_path = Some("/Users/tester/logs/out.log".to_owned());
    full.run_at_load = true;
    full.keep_alive = true;
    let xml = validated(&full).plist_xml();
    let allowed: BTreeSet<&str> = [
        "Label",
        "ProgramArguments",
        "WorkingDirectory",
        "EnvironmentVariables",
        "StandardOutPath",
        "StandardErrorPath",
        "RunAtLoad",
        "KeepAlive",
    ]
    .into();
    let plist = read_plist(&xml);
    assert!(keys(&plist).iter().all(|key| allowed.contains(key)));
    for forbidden in [
        "UserName",
        "GroupName",
        "SessionCreate",
        "Disabled",
        "Program",
        "LaunchOnlyOnce",
        "RootDirectory",
        "inetdCompatibility",
        "Sockets",
        "WatchPaths",
        "StartInterval",
    ] {
        assert!(
            !xml.contains(&format!("<key>{forbidden}</key>")),
            "{forbidden} leaked into\n{xml}"
        );
    }
    for shell in ["/bin/sh", "/bin/zsh", "/bin/bash"] {
        assert!(!xml.contains(shell), "{shell} leaked into\n{xml}");
    }
}

#[test]
fn hostile_text_only_ever_becomes_literal_strings() {
    let injection = "</string><key>UserName</key><string>root";
    let hostile = [
        injection,
        "a & b <c> \"d\" 'e'",
        "<![CDATA[</string><key>GroupName</key><string>wheel]]>",
        "&amp; &lt;already escaped&gt;",
        "]]>--><!-- <?xml ?>",
        "日本語 é 🚀 \u{202f}\u{a0}",
    ];
    for text in hostile {
        let mut hostile_request = request();
        hostile_request.arguments = vec![text.to_owned()];
        hostile_request.environment = BTreeMap::from([("KEY".to_owned(), text.to_owned())]);
        hostile_request.working_directory = None;
        hostile_request.executable = "/usr/local/bin/tool".to_owned();
        let mut facts = FakeFacts::new();
        facts.dir("/Users/tester/logs");
        let service = validate_with(&facts, &hostile_request).expect("valid");
        let xml = service.plist_xml();
        let plist = read_plist(&xml);

        assert_eq!(
            keys(&plist),
            [
                "Label",
                "ProgramArguments",
                "EnvironmentVariables",
                "RunAtLoad",
                "KeepAlive"
            ],
            "{text:?}"
        );
        assert_eq!(
            strings(get(&plist, "ProgramArguments")),
            ["/usr/local/bin/tool", text]
        );
        let environment = dict(get(&plist, "EnvironmentVariables"));
        assert_eq!(environment.len(), 1);
        assert_eq!(string(&environment[0].1), text);
        assert!(!xml.contains("<![CDATA["), "{xml}");
        assert!(!xml.contains("<key>UserName</key>"), "{xml}");
    }
}

#[test]
fn a_malicious_label_or_path_cannot_break_out_either() {
    for label in [
        "x</string><key>UserName</key><string>root",
        "a b",
        "a/b",
        "x\"y",
        "x'y",
        "x&y",
        "x<y",
        "x>y",
    ] {
        let mut bad = request();
        bad.label = label.to_owned();
        assert!(
            matches!(
                invalid(&bad),
                CreateError::Invalid {
                    field: Field::Label,
                    ..
                }
            ),
            "{label:?}"
        );
    }
}

// -------------------------------------------------------------------- label

#[test]
fn a_suffix_or_a_full_label_ends_up_inside_the_namespace() {
    for (input, label) in [
        ("backup", FULL),
        (FULL, FULL),
        ("a.b-c_d", "com.zephyr194.userhome.agent.a.b-c_d"),
        // Not recognized as a full label, so it is only a (long) suffix.
        (
            "com.apple.foo",
            "com.zephyr194.userhome.agent.com.apple.foo",
        ),
    ] {
        let mut req = request();
        req.label = input.to_owned();
        let service = validated(&req);
        assert_eq!(service.label(), label);
        assert_eq!(service.file_name(), format!("{label}.plist"));
        assert!(service.label().starts_with(USERHOME_LABEL_NAMESPACE));
    }
}

#[test]
fn bad_label_suffixes_are_refused() {
    let too_long = "a".repeat(MAX_LABEL_SUFFIX_BYTES + 1);
    for label in [
        "",
        "com.zephyr194.userhome.agent.",
        ".hidden",
        "-flag",
        "a..b",
        "a.",
        "..",
        "a b",
        "a\tb",
        "a\nb",
        "é",
        too_long.as_str(),
    ] {
        let mut req = request();
        req.label = label.to_owned();
        assert!(
            matches!(
                invalid(&req),
                CreateError::Invalid {
                    field: Field::Label,
                    ..
                }
            ),
            "{label:?}"
        );
    }
    let mut longest = request();
    longest.label = "a".repeat(MAX_LABEL_SUFFIX_BYTES);
    validated(&longest);
}

// --------------------------------------------------------------- executable

#[test]
fn the_executable_must_be_an_absolute_normal_path() {
    for path in [
        "",
        "tool",
        "./tool",
        "../tool",
        "~/bin/tool",
        "/usr/local/../local/bin/tool",
        "/usr/local/./bin/tool",
        "/usr/local//bin/tool",
        "/usr/local/bin/tool/",
        "/",
        "/usr/local/bin/tool\n",
        "/usr/local/bin/to\0ol",
    ] {
        let mut req = request();
        req.executable = path.to_owned();
        let error = invalid(&req);
        assert!(
            matches!(
                error,
                CreateError::Invalid {
                    field: Field::Executable,
                    ..
                }
            ),
            "{path:?} -> {error:?}"
        );
    }
}

#[test]
fn the_executable_must_exist_be_a_regular_user_executable_file() {
    let mut req = request();
    req.executable = "/usr/local/bin/missing".to_owned();
    assert_eq!(
        invalid(&req),
        CreateError::Executable(ExecutableProblem::Missing)
    );

    let mut facts = FakeFacts::new();
    facts.facts_of("/usr/local/bin/tool").regular_file = false;
    assert_eq!(
        validate_with(&facts, &request()),
        Err(CreateError::Executable(ExecutableProblem::NotRegularFile))
    );
    let mut facts = FakeFacts::new();
    facts.facts_of("/usr/local/bin/tool").user_executable = false;
    assert_eq!(
        validate_with(&facts, &request()),
        Err(CreateError::Executable(ExecutableProblem::NotExecutable))
    );
    let mut facts = FakeFacts::new();
    facts.facts_of("/usr/local/bin/tool").others_writable = true;
    assert_eq!(
        validate_with(&facts, &request()),
        Err(CreateError::Executable(ExecutableProblem::WritableByOthers))
    );
}

#[test]
fn a_link_must_resolve_to_a_file_that_stays_where_the_rule_allows() {
    // A link outside $HOME to another system location is fine (Homebrew).
    let mut facts = FakeFacts::new();
    facts.link(
        "/opt/homebrew/bin/tool",
        "/opt/homebrew/Cellar/tool/1.0/bin/tool",
    );
    let mut req = request();
    req.executable = "/opt/homebrew/bin/tool".to_owned();
    validate_with(&facts, &req).expect("homebrew style link");

    // A link below $HOME may not leave $HOME.
    let mut facts = FakeFacts::new();
    facts.link("/Users/tester/bin/tool", "/tmp/elsewhere/tool");
    req.executable = "/Users/tester/bin/tool".to_owned();
    assert_eq!(
        validate_with(&facts, &req),
        Err(CreateError::Executable(ExecutableProblem::EscapesHome))
    );

    // Neither a path nor its target may be a protected credential location.
    let mut facts = FakeFacts::new();
    facts.link("/usr/local/bin/tool", "/Users/tester/.ssh/tool");
    assert_eq!(
        validate_with(&facts, &request()),
        Err(CreateError::Executable(
            ExecutableProblem::ProtectedLocation
        ))
    );
    let mut facts = FakeFacts::new();
    facts.exe("/Users/tester/.ssh/tool");
    req.executable = "/Users/tester/.ssh/tool".to_owned();
    assert_eq!(
        validate_with(&facts, &req),
        Err(CreateError::Executable(
            ExecutableProblem::ProtectedLocation
        ))
    );

    // Inside $HOME is fine when it stays inside.
    let mut facts = FakeFacts::new();
    facts.link("/Users/tester/bin/tool", "/Users/tester/tools/tool");
    req.executable = "/Users/tester/bin/tool".to_owned();
    validate_with(&facts, &req).expect("inside home");
}

#[test]
fn shells_and_wrappers_are_refused_by_name_and_through_links() {
    for path in [
        "/bin/sh",
        "/bin/bash",
        "/bin/zsh",
        "/bin/dash",
        "/bin/ksh",
        "/bin/csh",
        "/bin/tcsh",
        "/usr/bin/env",
        "/usr/bin/xargs",
        "/usr/bin/nohup",
        "/usr/bin/sudo",
        "/usr/bin/su",
        "/opt/homebrew/bin/fish",
        "/opt/homebrew/bin/bash",
    ] {
        let mut facts = FakeFacts::new();
        facts.exe(path);
        let mut req = request();
        req.executable = path.to_owned();
        assert_eq!(
            validate_with(&facts, &req),
            Err(CreateError::ShellWrapper(ShellUse::Executable)),
            "{path}"
        );
    }
    // A harmless name that resolves to a shell is a shell.
    let mut facts = FakeFacts::new();
    facts.link("/usr/local/bin/tool", "/bin/zsh");
    assert_eq!(
        validate_with(&facts, &request()),
        Err(CreateError::ShellWrapper(ShellUse::Executable))
    );
}

#[test]
fn a_shell_named_in_the_arguments_with_a_command_flag_is_refused() {
    for arguments in [
        vec!["bash", "-c", "rm -rf ~"],
        vec!["/bin/sh", "-c", "x"],
        vec!["zsh", "-lc", "x"],
        vec!["-c", "bash"],
        vec!["/usr/bin/env", "tool"],
        vec!["sh"],
    ] {
        let mut req = request();
        req.arguments = arguments.iter().map(|item| (*item).to_owned()).collect();
        assert!(
            matches!(
                invalid(&req),
                CreateError::ShellWrapper(ShellUse::Arguments)
            ),
            "{arguments:?}"
        );
    }
    // `-c` alone for a program that is not a shell is an ordinary option.
    let mut req = request();
    req.arguments = vec!["-c".to_owned(), "config.toml".to_owned()];
    validated(&req);
}

// ---------------------------------------------------------------- arguments

#[test]
fn arguments_are_kept_as_separate_items_with_bounded_size() {
    let mut req = request();
    req.arguments = vec!["a".repeat(MAX_ARGUMENT_BYTES); MAX_ARGUMENTS];
    let service = validated(&req);
    let plist = read_plist(&service.plist_xml());
    assert_eq!(
        strings(get(&plist, "ProgramArguments")).len(),
        MAX_ARGUMENTS + 1
    );

    req.arguments = vec!["a".to_owned(); MAX_ARGUMENTS + 1];
    assert!(matches!(
        invalid(&req),
        CreateError::Invalid {
            field: Field::Arguments,
            reason: Reason::TooMany
        }
    ));
    req.arguments = vec!["a".repeat(MAX_ARGUMENT_BYTES + 1)];
    assert!(matches!(
        invalid(&req),
        CreateError::Invalid {
            field: Field::Arguments,
            reason: Reason::TooLong
        }
    ));
    // An empty item is a real, separate argument.
    req.arguments = vec![String::new(), "x y".to_owned()];
    let plist = read_plist(&validated(&req).plist_xml());
    assert_eq!(
        strings(get(&plist, "ProgramArguments")),
        ["/usr/local/bin/tool", "", "x y"]
    );
}

#[test]
fn control_characters_are_refused_in_every_field() {
    let bad_texts = [
        "a\0b",
        "a\nb",
        "a\rb",
        "a\tb",
        "a\u{7f}b",
        "a\u{85}b",
        "a\u{1b}[31mb",
        "a\u{2028}b",
        "a\u{2029}b",
        "a\u{202e}b",
        "a\u{2066}b",
    ];
    for text in bad_texts {
        let mut req = request();
        req.arguments = vec![text.to_owned()];
        assert!(
            matches!(
                invalid(&req),
                CreateError::Invalid {
                    field: Field::Arguments,
                    reason: Reason::ControlCharacter
                }
            ),
            "argument {text:?}"
        );
        let mut req = request();
        req.environment = BTreeMap::from([("KEY".to_owned(), text.to_owned())]);
        assert!(
            matches!(
                invalid(&req),
                CreateError::Invalid {
                    field: Field::EnvironmentValue,
                    reason: Reason::ControlCharacter
                }
            ),
            "env value {text:?}"
        );
        let mut req = request();
        req.working_directory = Some(format!("/Users/tester/{text}"));
        assert!(
            matches!(
                invalid(&req),
                CreateError::Invalid {
                    field: Field::WorkingDirectory,
                    ..
                }
            ),
            "cwd {text:?}"
        );
        let mut req = request();
        req.stdout_path = Some(format!("/Users/tester/logs/{text}"));
        assert!(matches!(
            invalid(&req),
            CreateError::Invalid {
                field: Field::StdoutPath,
                ..
            }
        ));
        let mut req = request();
        req.stderr_path = Some(format!("/Users/tester/logs/{text}"));
        assert!(matches!(
            invalid(&req),
            CreateError::Invalid {
                field: Field::StderrPath,
                ..
            }
        ));
    }
}

// -------------------------------------------------------------- environment

#[test]
fn environment_entries_have_valid_names_and_bounded_sizes() {
    let mut req = request();
    req.environment = (0..MAX_ENVIRONMENT_ENTRIES)
        .map(|index| (format!("KEY_{index}"), "v".repeat(MAX_ENV_VALUE_BYTES)))
        .collect();
    validated(&req);

    req.environment
        .insert("ONE_MORE".to_owned(), "v".to_owned());
    assert!(matches!(
        invalid(&req),
        CreateError::Invalid {
            field: Field::EnvironmentKey,
            reason: Reason::TooMany
        }
    ));

    for key in ["", "1A", "A-B", "A B", "A=B", "a.b", "é", "A\0", "_OK_"] {
        let mut req = request();
        req.environment = BTreeMap::from([(key.to_owned(), "v".to_owned())]);
        let result = validate_with(&FakeFacts::new(), &req);
        if key == "_OK_" {
            result.expect("underscore names are valid");
        } else {
            assert!(
                matches!(
                    result,
                    Err(CreateError::Invalid {
                        field: Field::EnvironmentKey,
                        ..
                    })
                ),
                "{key:?}"
            );
        }
    }
    let mut req = request();
    req.environment = BTreeMap::from([("K".repeat(MAX_ENV_KEY_BYTES + 1), "v".to_owned())]);
    assert!(matches!(
        invalid(&req),
        CreateError::Invalid {
            field: Field::EnvironmentKey,
            reason: Reason::TooLong
        }
    ));
    let mut req = request();
    req.environment = BTreeMap::from([("K".to_owned(), "v".repeat(MAX_ENV_VALUE_BYTES + 1))]);
    assert!(matches!(
        invalid(&req),
        CreateError::Invalid {
            field: Field::EnvironmentValue,
            reason: Reason::TooLong
        }
    ));
}

#[test]
fn environment_values_may_contain_spaces_and_markup_but_loader_variables_are_refused() {
    let mut req = request();
    req.environment = BTreeMap::from([("GREETING".to_owned(), "hello big world".to_owned())]);
    validated(&req);
    for key in ["DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "LD_PRELOAD"] {
        let mut req = request();
        req.environment = BTreeMap::from([(key.to_owned(), "/tmp/x.dylib".to_owned())]);
        assert!(
            matches!(
                invalid(&req),
                CreateError::Invalid {
                    field: Field::EnvironmentKey,
                    reason: Reason::Reserved
                }
            ),
            "{key}"
        );
    }
}

// -------------------------------------------------------------------- paths

#[test]
fn directories_and_log_files_follow_the_path_rules() {
    let mut req = request();
    req.working_directory = Some("/Users/tester/work".to_owned());
    req.stdout_path = Some("/Users/tester/logs/out.log".to_owned());
    req.stderr_path = Some("/Users/tester/logs/out.log".to_owned());
    validated(&req);

    for (field, set) in [
        (
            Field::WorkingDirectory,
            (|r: &mut CreateServiceRequest, p: &str| r.working_directory = Some(p.to_owned()))
                as fn(&mut CreateServiceRequest, &str),
        ),
        (Field::StdoutPath, |r, p| r.stdout_path = Some(p.to_owned())),
        (Field::StderrPath, |r, p| r.stderr_path = Some(p.to_owned())),
    ] {
        for path in [
            "",
            "relative/dir",
            "~/x",
            "/Users/tester/../x",
            "/Users/tester/work/",
        ] {
            let mut req = request();
            set(&mut req, path);
            let error = invalid(&req);
            assert!(
                matches!(error, CreateError::Invalid { field: f, .. } if f == field),
                "{field:?} {path:?} -> {error:?}"
            );
        }
        let mut req = request();
        set(&mut req, &format!("/{}", "a".repeat(MAX_PATH_BYTES)));
        assert!(matches!(
            invalid(&req),
            CreateError::Invalid {
                reason: Reason::TooLong,
                ..
            }
        ));
    }

    let mut req = request();
    req.working_directory = Some("/Users/tester/missing".to_owned());
    assert_eq!(
        invalid(&req),
        CreateError::Directory(Field::WorkingDirectory)
    );
    let mut req = request();
    req.stdout_path = Some("/Users/tester/nowhere/out.log".to_owned());
    assert_eq!(invalid(&req), CreateError::Directory(Field::StdoutPath));
}

#[test]
fn log_files_cannot_land_in_protected_places_or_among_launch_agents() {
    let mut facts = FakeFacts::new();
    facts.dir("/Users/tester/.ssh");
    facts.dir("/Users/tester/Library/LaunchAgents");
    facts.dir_link("/Users/tester/linked", "/Users/tester/.ssh");
    for path in [
        "/Users/tester/.ssh/authorized_keys",
        "/Users/tester/linked/authorized_keys",
        "/Users/tester/Library/LaunchAgents/evil.plist",
    ] {
        let mut req = request();
        req.stdout_path = Some(path.to_owned());
        assert_eq!(
            validate_with(&facts, &req),
            Err(CreateError::LogLocation(Field::StdoutPath)),
            "{path}"
        );
        req.stdout_path = None;
        req.stderr_path = Some(path.to_owned());
        assert_eq!(
            validate_with(&facts, &req),
            Err(CreateError::LogLocation(Field::StderrPath)),
            "{path}"
        );
    }
    // A file directly in $HOME is allowed; $HOME itself is not a file.
    let mut req = request();
    req.stdout_path = Some("/Users/tester/out.log".to_owned());
    validate_with(&facts, &req).expect("file in home");
}

// -------------------------------------------------------------- wire format

#[test]
fn the_wire_request_rejects_unknown_fields_and_defaults_both_options_off() {
    let minimal: CreateServiceRequest =
        serde_json::from_str(r#"{"label":"a","executable":"/usr/local/bin/tool"}"#)
            .expect("minimal");
    assert!(!minimal.run_at_load && !minimal.keep_alive);
    assert!(minimal.arguments.is_empty() && minimal.environment.is_empty());

    for json in [
        r#"{"label":"a","executable":"/x","userName":"root"}"#,
        r#"{"label":"a","executable":"/x","program":"/bin/sh"}"#,
        r#"{"label":"a","executable":"/x","environment":{"A":1}}"#,
        r#"{"label":"a","executable":"/x","arguments":"-c x"}"#,
        r#"{"label":"a","executable":"/x","runAtLoad":"yes"}"#,
        r#"{"label":"a"}"#,
        r#"{"executable":"/x"}"#,
    ] {
        assert!(
            serde_json::from_str::<CreateServiceRequest>(json).is_err(),
            "{json}"
        );
    }
}

// -------------------------------------------------- the save transaction

struct FakeRegistry {
    taken: Mutex<BTreeSet<String>>,
    failure: Mutex<Option<RegistryError>>,
}

impl FakeRegistry {
    fn new() -> Self {
        Self {
            taken: Mutex::new(BTreeSet::new()),
            failure: Mutex::new(None),
        }
    }

    fn take(&self, label: &str) {
        self.taken.lock().expect("lock").insert(label.to_owned());
    }

    fn fail_with(&self, error: RegistryError) {
        *self.failure.lock().expect("lock") = Some(error);
    }
}

impl LabelRegistry for FakeRegistry {
    fn is_taken(&self, label: &str) -> Result<bool, RegistryError> {
        if let Some(error) = *self.failure.lock().expect("lock") {
            return Err(error);
        }
        Ok(self.taken.lock().expect("lock").contains(label))
    }
}

struct Fixture {
    root: PathBuf,
    home: PathBuf,
    agents: PathBuf,
    environment: ConfigEnvironment,
    grants: GrantCoordinator,
    operations: OperationCoordinator,
    writes: ResourceWriteCoordinator,
    creator: ServiceCreateCoordinator,
    registry: FakeRegistry,
    facts: FakeFacts,
}

impl Fixture {
    fn new() -> Self {
        let root = fs::canonicalize(std::env::temp_dir())
            .expect("canonical temp dir")
            .join(format!("userhome-create-{}", Uuid::new_v4()));
        let home = root.join("home");
        let agents = home.join("Library").join("LaunchAgents");
        fs::create_dir_all(&agents).expect("agents");
        let environment =
            ConfigEnvironment::new(home.clone(), root.join("brew"), home.join("backups"));
        let grants =
            GrantCoordinator::new(GrantStore::new(root.join("support")), Some(home.clone()));
        let mut facts = FakeFacts::default();
        facts.exe("/usr/local/bin/tool");
        facts.dir(home.join("logs").to_str().expect("utf8"));
        Self {
            root,
            home,
            agents,
            environment,
            grants,
            operations: OperationCoordinator::default(),
            writes: ResourceWriteCoordinator::default(),
            creator: ServiceCreateCoordinator::default(),
            registry: FakeRegistry::new(),
            facts,
        }
    }

    fn ctx(&self) -> ResourceWriteContext<'_> {
        ResourceWriteContext {
            grants: &self.grants,
            operations: &self.operations,
            environment: &self.environment,
            retention: BackupRetention::FIVE,
        }
    }

    fn preview(&self, request: &CreateServiceRequest) -> Result<CreatePreview, AppError> {
        self.creator.preview(
            &self.ctx(),
            &self.writes,
            Some(&self.home),
            &self.registry,
            &self.facts,
            request,
        )
    }

    fn execute(&self, operation_id: &str) -> Result<CreateExecution, AppError> {
        self.creator
            .execute(&self.ctx(), &self.writes, &self.registry, operation_id)
    }

    fn target(&self) -> PathBuf {
        self.agents.join(format!("{FULL}.plist"))
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn message(error: &AppError) -> String {
    serde_json::to_string(error).expect("error json")
}

fn history_text(fixture: &Fixture) -> String {
    fixture
        .operations
        .list()
        .expect("list")
        .iter()
        .map(|summary| {
            let id = serde_json::to_value(summary).expect("summary json")["operationId"]
                .as_str()
                .expect("operation id")
                .to_owned();
            serde_json::to_string(&fixture.operations.get(&id).expect("details")).expect("json")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn secret_request() -> CreateServiceRequest {
    let mut req = request();
    req.arguments = vec![
        "--token=sk-live-123456".to_owned(),
        "--name".to_owned(),
        "visible".to_owned(),
        "--password".to_owned(),
        "hunter2hunter2".to_owned(),
    ];
    req.environment = BTreeMap::from([
        ("API_KEY".to_owned(), "env-secret-value-777".to_owned()),
        ("MODE".to_owned(), "production-mode-x".to_owned()),
    ]);
    req
}

#[test]
fn a_preview_shows_what_will_run_and_writes_nothing() {
    let fixture = Fixture::new();
    let mut req = secret_request();
    req.working_directory = None;
    req.stdout_path = Some(
        fixture
            .home
            .join("logs")
            .join("out.log")
            .to_string_lossy()
            .into_owned(),
    );
    req.run_at_load = true;
    req.keep_alive = true;
    let preview = fixture.preview(&req).expect("preview");

    assert!(!fixture.target().exists(), "a preview writes nothing");
    assert_eq!(preview.label, FULL);
    assert_eq!(
        preview.file_path,
        format!("~/Library/LaunchAgents/{FULL}.plist")
    );
    assert_eq!(preview.write.kind, crate::grants::WriteKind::Create);
    assert_eq!(preview.executable, "/usr/local/bin/tool");
    assert_eq!(
        preview.arguments,
        [
            "--token=[REDACTED]",
            "--name",
            "visible",
            "--password",
            "[REDACTED]"
        ]
    );
    assert!(preview.arguments_redacted);
    assert_eq!(preview.environment_keys, ["API_KEY", "MODE"]);
    assert_eq!(preview.stdout_path.as_deref(), Some("~/logs/out.log"));
    assert!(preview.run_at_load && preview.keep_alive);
    assert!(preview.effect_note.contains("本步不加载") && preview.effect_note.contains("不启动"));
    let notes = preview.persistence_notes.join("\n");
    assert!(notes.contains("登录后自动启动"), "{notes}");
    assert!(notes.contains("退出后自动重启"), "{notes}");

    // No secret reaches the preview or the operation history.
    let json = serde_json::to_string(&preview).expect("json");
    let history = history_text(&fixture);
    for secret in [
        "sk-live-123456",
        "hunter2hunter2",
        "env-secret-value-777",
        "production-mode-x",
    ] {
        assert!(!json.contains(secret), "{secret} in preview: {json}");
        assert!(!history.contains(secret), "{secret} in history: {history}");
    }
}

#[test]
fn the_options_are_off_by_default_and_the_preview_says_so() {
    let fixture = Fixture::new();
    let preview = fixture.preview(&request()).expect("preview");
    assert!(!preview.run_at_load && !preview.keep_alive);
    let notes = preview.persistence_notes.join("\n");
    assert!(
        !notes.contains("登录后自动启动会") && notes.contains("不会自动启动"),
        "{notes}"
    );
    assert!(notes.contains("不会自动重启"), "{notes}");
}

#[test]
fn confirming_creates_the_file_reads_it_back_and_leaves_no_authorization() {
    let fixture = Fixture::new();
    let req = secret_request();
    let preview = fixture.preview(&req).expect("preview");
    assert_eq!(
        fixture.grants.list().expect("list").len(),
        1,
        "one pending authorization"
    );

    let executed = fixture
        .execute(&preview.write.operation.operation_id)
        .expect("execute");

    let written = fs::read_to_string(fixture.target()).expect("file");
    assert_eq!(written, validated_for(&fixture, &req).plist_xml());
    let plist = read_plist(&written);
    assert_eq!(string(get(&plist, "Label")), FULL);
    assert_eq!(
        fs::metadata(fixture.target())
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(executed.label, FULL);
    assert!(!executed.loaded);
    assert!(executed.effect_note.contains("尚未加载"));
    assert_eq!(
        executed.execution.outcome.file_state,
        crate::grants::FileState::Written
    );
    assert!(
        fixture.grants.list().expect("list").is_empty(),
        "the one-file authorization is revoked"
    );
    let json = serde_json::to_string(&executed).expect("json");
    for secret in ["sk-live-123456", "hunter2hunter2", "env-secret-value-777"] {
        assert!(!json.contains(secret), "{secret} in {json}");
    }
    // Nothing else changed in the directory.
    assert_eq!(fs::read_dir(&fixture.agents).expect("dir").count(), 1);
}

fn validated_for(fixture: &Fixture, request: &CreateServiceRequest) -> ValidatedService {
    validate(request, Some(&fixture.home), &fixture.facts).expect("valid")
}

#[test]
fn an_existing_file_is_never_overwritten_and_has_its_own_error() {
    let fixture = Fixture::new();
    fs::write(fixture.target(), "mine").expect("seed");

    let error = fixture.preview(&request()).expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert!(message(&error).contains("已存在同名配置文件"), "{error:?}");
    assert_eq!(fs::read_to_string(fixture.target()).expect("read"), "mine");
    assert!(fixture.grants.list().expect("list").is_empty());

    // The same for a dangling or valid link under the name.
    fs::remove_file(fixture.target()).expect("rm");
    std::os::unix::fs::symlink(fixture.root.join("nowhere"), fixture.target()).expect("link");
    let error = fixture.preview(&request()).expect_err("refused");
    assert!(message(&error).contains("已存在同名配置文件"), "{error:?}");
}

#[test]
fn a_label_already_used_by_a_discovered_job_is_refused_with_its_own_error() {
    let fixture = Fixture::new();
    fixture.registry.take(FULL);
    let error = fixture.preview(&request()).expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::Conflict);
    assert!(message(&error).contains("已被其他"), "{error:?}");
    assert!(!fixture.target().exists());
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn an_unusable_discovery_stops_the_preview_instead_of_guessing() {
    for (failure, text) in [
        (RegistryError::Busy, "正在进行"),
        (RegistryError::Incomplete, "无法确认"),
    ] {
        let fixture = Fixture::new();
        fixture.registry.fail_with(failure);
        let error = fixture.preview(&request()).expect_err("refused");
        assert!(message(&error).contains(text), "{error:?}");
        assert!(fixture.grants.list().expect("list").is_empty());
    }
}

#[test]
fn a_missing_launch_agents_directory_is_not_created() {
    let fixture = Fixture::new();
    fs::remove_dir_all(&fixture.agents).expect("rm");
    let error = fixture.preview(&request()).expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::NotFound);
    assert!(message(&error).contains("LaunchAgents"), "{error:?}");
    assert!(!fixture.agents.exists());
}

#[test]
fn an_invalid_request_is_refused_before_any_authorization_exists() {
    let fixture = Fixture::new();
    let mut req = request();
    req.executable = "/bin/sh".to_owned();
    let error = fixture.preview(&req).expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::ValidationFailed);
    assert!(fixture.grants.list().expect("list").is_empty());
    let mut req = request();
    req.label = "a b".to_owned();
    assert!(fixture.preview(&req).is_err());
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn a_label_taken_between_preview_and_confirmation_cancels_without_writing() {
    let fixture = Fixture::new();
    let preview = fixture.preview(&request()).expect("preview");
    fixture.registry.take(FULL);

    let error = fixture
        .execute(&preview.write.operation.operation_id)
        .expect_err("refused");
    assert!(message(&error).contains("已被其他"), "{error:?}");
    assert!(!fixture.target().exists());
    assert!(fixture.grants.list().expect("list").is_empty());
    // The preview is gone.
    assert!(
        fixture
            .execute(&preview.write.operation.operation_id)
            .is_err()
    );
}

#[test]
fn a_file_that_appears_after_the_preview_is_left_untouched() {
    let fixture = Fixture::new();
    let preview = fixture.preview(&request()).expect("preview");
    fs::write(fixture.target(), "raced").expect("race");

    let error = fixture
        .execute(&preview.write.operation.operation_id)
        .expect_err("refused");
    assert_eq!(error.code(), AppErrorCode::Conflict, "{error:?}");
    assert_eq!(fs::read_to_string(fixture.target()).expect("read"), "raced");
    assert!(fixture.grants.list().expect("list").is_empty());
}

#[test]
fn a_confirmation_works_once_and_only_for_a_preview_of_this_creator() {
    let fixture = Fixture::new();
    assert!(fixture.execute("op-does-not-exist").is_err());
    let preview = fixture.preview(&request()).expect("preview");
    fixture
        .execute(&preview.write.operation.operation_id)
        .expect("first");
    assert!(
        fixture
            .execute(&preview.write.operation.operation_id)
            .is_err(),
        "a preview is consumed"
    );

    // A preview of another kind of write cannot be confirmed here.
    let file = fixture.home.join("plain.txt");
    fs::write(&file, "x").expect("seed");
    let general = fixture
        .grants
        .create(GrantPurpose::ConfigFile, &file)
        .expect("grant");
    let other = fixture
        .writes
        .preview(
            &fixture.ctx(),
            vec![crate::grants::WriteRequest {
                grant_id: general.id,
                relative: None,
                expected_sha256: Some(crate::config::read::hash_bytes(b"x")),
                content: "y".to_owned(),
                sensitive: false,
            }],
        )
        .expect("general preview");
    assert!(
        fixture
            .execute(&other.steps[0].operation.operation_id)
            .is_err()
    );
}

#[test]
fn the_pending_previews_are_bounded() {
    let fixture = Fixture::new();
    let mut accepted = 0;
    for index in 0..(MAX_PENDING_CREATES + 4) {
        let mut req = request();
        req.label = format!("job{index}");
        if fixture.preview(&req).is_ok() {
            accepted += 1;
        }
    }
    assert_eq!(accepted, MAX_PENDING_CREATES);
}
