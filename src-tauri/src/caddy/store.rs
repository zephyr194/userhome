//! Private storage for the Caddy site rules and the Caddyfile derived from them.
//!
//! The rules JSON is the source of truth, so it is committed first. The
//! Caddyfile is a derived copy; if its replacement fails the rules are still
//! saved and the failure is reported as partial. Nothing here starts, reloads
//! or calls Caddy.

use std::{
    fs::{self, DirBuilder, File},
    io::{self, Read},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;

use crate::{
    caddy::{config::CaddyRules, generate::generate_caddyfile},
    config::atomic::{AtomicReplaceError, atomic_replace},
    error::AppError,
};

pub const STORE_DIRECTORY: &str = "caddy";
pub const RULES_FILE: &str = "rules.json";
pub const CADDYFILE: &str = "Caddyfile";
pub const RAW_FILE: &str = "original.caddyfile";
pub const CHECKS_DIRECTORY: &str = "checks";
pub const RUNS_DIRECTORY: &str = "runs";
pub const MAX_STORE_BYTES: u64 = 256 * 1024;
const FILE_MODE: u32 = 0o600;
const DIRECTORY_MODE: u32 = 0o700;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RulesSource {
    Saved,
    Default,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedRules {
    pub rules: CaddyRules,
    pub source: RulesSource,
}

// Shared by every store: the work directory store is built per command, so a
// lock owned by one instance would not serialize anything.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug)]
pub struct CaddyStore {
    directory: PathBuf,
}

impl CaddyStore {
    /// The app's former private store. Nothing is written here any more; the
    /// Caddy commands use `in_directory` with the authorized work directory.
    pub fn new(app_config_directory: &Path) -> Self {
        Self {
            directory: app_config_directory.join(STORE_DIRECTORY),
        }
    }

    pub fn in_directory(directory: &Path) -> Self {
        Self {
            directory: directory.to_path_buf(),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// Whether anything is in the directory. Only the entries are listed; no
    /// file is opened.
    pub fn has_content(&self) -> bool {
        match fs::symlink_metadata(&self.directory) {
            Ok(metadata) if metadata.is_dir() => {
                fs::read_dir(&self.directory).is_ok_and(|mut entries| entries.next().is_some())
            }
            _ => false,
        }
    }

    pub fn load_rules(&self) -> Result<LoadedRules, AppError> {
        match self.read_store_file(RULES_FILE)? {
            Some(bytes) => Ok(LoadedRules {
                rules: decode_rules(&bytes)?,
                source: RulesSource::Saved,
            }),
            None => Ok(LoadedRules {
                rules: CaddyRules::example(),
                source: RulesSource::Default,
            }),
        }
    }

    pub fn saved_caddyfile(&self) -> Result<Option<String>, AppError> {
        self.read_store_file(CADDYFILE)?
            .map(|bytes| {
                String::from_utf8(bytes).map_err(|_| {
                    AppError::validation_failed("已保存的 Caddyfile 不是有效文本，已停止读取。")
                })
            })
            .transpose()
    }

    pub fn load_raw(&self) -> Result<Option<String>, AppError> {
        self.read_store_file(RAW_FILE)?
            .map(|bytes| String::from_utf8(bytes).map_err(|_| raw_not_text()))
            .transpose()
    }

    /// Saves the original text verbatim. It is never parsed or rewritten, and
    /// it is independent of the form rules and of the generated Caddyfile.
    pub fn save_raw(&self, text: &str) -> Result<(), AppError> {
        if text.len() as u64 > MAX_STORE_BYTES {
            return Err(AppError::invalid_input("原文超过 256 KiB 上限，未保存。"));
        }
        if text.contains('\0') {
            return Err(AppError::invalid_input("原文包含不允许的字符，未保存。"));
        }
        let _guard = WRITE_LOCK.lock().map_err(|_| AppError::internal())?;
        self.ensure_directory()?;
        if let Some(existing) = self.read_store_file(RAW_FILE)? {
            String::from_utf8(existing).map_err(|_| raw_not_text())?;
        }
        atomic_replace(&self.path(RAW_FILE), text.as_bytes(), FILE_MODE, None)
            .map_err(into_app_error)
    }

    /// Private, owner-only directory for scratch copies made during checks.
    pub fn checks_root(&self) -> Result<PathBuf, AppError> {
        self.private_directory(CHECKS_DIRECTORY)
    }

    /// Private, owner-only parent for the working directories of own runs.
    pub fn runs_root(&self) -> Result<PathBuf, AppError> {
        self.private_directory(RUNS_DIRECTORY)
    }

    fn private_directory(&self, name: &str) -> Result<PathBuf, AppError> {
        self.ensure_directory()?;
        let path = self.path(name);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_dir() => Ok(path),
            Ok(_) => Err(AppError::permission_denied(
                "Caddy 私有子目录不是普通目录，已停止。",
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => DirBuilder::new()
                .mode(DIRECTORY_MODE)
                .create(&path)
                .map(|()| path)
                .map_err(|_| AppError::permission_denied("Caddy 私有子目录无法创建。")),
            Err(_) => Err(AppError::permission_denied("Caddy 私有子目录无法访问。")),
        }
    }

    pub fn save(&self, rules: &CaddyRules) -> Result<(), AppError> {
        if rules.validate().is_blocking() {
            return Err(AppError::validation_failed("规则未通过校验，未保存。"));
        }
        let caddyfile = generate_caddyfile(rules)?;
        self.save_generated(rules, &caddyfile)
    }

    /// Saves the rules together with a Caddyfile the caller generated, which is
    /// how a TLS site carries its resolved certificate and key paths.
    pub fn save_generated(&self, rules: &CaddyRules, caddyfile: &str) -> Result<(), AppError> {
        if rules.validate().is_blocking() {
            return Err(AppError::validation_failed("规则未通过校验，未保存。"));
        }
        let mut rules_bytes = serde_json::to_vec_pretty(rules).map_err(|_| AppError::internal())?;
        rules_bytes.push(b'\n');
        if rules_bytes.len() as u64 > MAX_STORE_BYTES {
            return Err(AppError::invalid_input("规则超过大小上限，未保存。"));
        }

        let _guard = WRITE_LOCK.lock().map_err(|_| AppError::internal())?;
        self.ensure_directory()?;
        if let Some(existing) = self.read_store_file(RULES_FILE)? {
            decode_rules(&existing)?;
        }
        atomic_replace(&self.path(RULES_FILE), &rules_bytes, FILE_MODE, None)
            .map_err(into_app_error)?;
        atomic_replace(&self.path(CADDYFILE), caddyfile.as_bytes(), FILE_MODE, None).map_err(|_| {
            AppError::partial_failure(
                "规则已保存，但 Caddyfile 未能更新；下次读取以规则文件为准。",
                false,
            )
        })
    }

    fn path(&self, name: &str) -> PathBuf {
        self.directory.join(name)
    }

    fn ensure_directory(&self) -> Result<(), AppError> {
        match fs::symlink_metadata(&self.directory) {
            Ok(metadata) if metadata.is_dir() => Ok(()),
            Ok(_) => Err(AppError::permission_denied(
                "Caddy 私有目录不是普通目录，未保存。",
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => DirBuilder::new()
                .recursive(true)
                .mode(DIRECTORY_MODE)
                .create(&self.directory)
                .map_err(|_| AppError::permission_denied("Caddy 私有目录无法创建。")),
            Err(_) => Err(AppError::permission_denied("Caddy 私有目录无法访问。")),
        }
    }

    fn read_store_file(&self, name: &str) -> Result<Option<Vec<u8>>, AppError> {
        match fs::symlink_metadata(&self.directory) {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => {
                return Err(AppError::permission_denied(
                    "Caddy 私有目录不是普通目录，已停止读取。",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AppError::permission_denied("Caddy 私有目录无法访问。")),
        }
        let path = self.path(name);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                if metadata.len() > MAX_STORE_BYTES {
                    return Err(size_limit_error());
                }
            }
            Ok(_) => {
                return Err(AppError::permission_denied(
                    "Caddy 私有存储不是普通文件，已停止读取。",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(AppError::permission_denied("Caddy 私有存储无法访问。")),
        }
        let mut bytes = Vec::new();
        File::options()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)
            .and_then(|file| file.take(MAX_STORE_BYTES + 1).read_to_end(&mut bytes))
            .map_err(|_| AppError::permission_denied("Caddy 私有存储无法读取。"))?;
        if bytes.len() as u64 > MAX_STORE_BYTES {
            return Err(size_limit_error());
        }
        Ok(Some(bytes))
    }
}

fn decode_rules(bytes: &[u8]) -> Result<CaddyRules, AppError> {
    let rules: CaddyRules = serde_json::from_slice(bytes).map_err(|_| unreadable_rules())?;
    if rules.validate().is_blocking() {
        return Err(unreadable_rules());
    }
    Ok(rules)
}

fn unreadable_rules() -> AppError {
    AppError::validation_failed("规则文件损坏或版本不受支持，已停止读取，原文件未被覆盖。")
}

fn raw_not_text() -> AppError {
    AppError::validation_failed("已保存的原文不是有效文本，已停止读取，原文件未被覆盖。")
}

fn size_limit_error() -> AppError {
    AppError::validation_failed("Caddy 存储文件超过大小上限，已停止读取。")
}

fn into_app_error(error: AtomicReplaceError) -> AppError {
    match error {
        AtomicReplaceError::BeforeCommit(error) | AtomicReplaceError::AfterCommit(error) => error,
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt, symlink};

    use uuid::Uuid;

    use super::*;
    use crate::{
        caddy::config::{Listen, RULES_VERSION, SiteRule, Upstream, UpstreamScheme},
        error::AppErrorCode,
    };

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("canonical temp dir")
                .join(format!("userhome-caddy-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("temp root");
            Self(root)
        }

        fn store(&self) -> CaddyStore {
            CaddyStore::new(&self.0)
        }

        fn caddy_dir(&self) -> PathBuf {
            self.0.join(STORE_DIRECTORY)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn site(host: &str, port: u16, upstream_port: u16) -> SiteRule {
        SiteRule {
            tls: None,
            access_log: false,
            enabled: true,
            listen: Listen {
                host: host.to_owned(),
                port,
            },
            upstreams: vec![Upstream {
                scheme: UpstreamScheme::Http,
                host: "127.0.0.1".to_owned(),
                port: upstream_port,
            }],
        }
    }

    fn two_sites() -> CaddyRules {
        CaddyRules {
            version: RULES_VERSION,
            sites: vec![site("127.0.0.1", 8080, 3000), site("::1", 8081, 3001)],
        }
    }

    fn one_site(port: u16) -> CaddyRules {
        CaddyRules {
            version: RULES_VERSION,
            sites: vec![site("127.0.0.1", port, 3000)],
        }
    }

    fn file_names(directory: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(directory)
            .expect("read store directory")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    fn write_store_file(directory: &Path, name: &str, bytes: &[u8]) {
        fs::create_dir_all(directory).expect("store directory");
        fs::write(directory.join(name), bytes).expect("store file");
    }

    #[test]
    fn load_returns_the_default_example_when_nothing_is_saved() {
        let root = TempRoot::new();

        let loaded = root.store().load_rules().expect("default load");

        assert_eq!(loaded.source, RulesSource::Default);
        assert_eq!(loaded.rules, CaddyRules::example());
        assert!(!root.caddy_dir().exists());
    }

    #[test]
    fn save_then_load_round_trips_rules_and_stores_the_derived_caddyfile() {
        let root = TempRoot::new();
        let store = root.store();
        let rules = two_sites();

        store.save(&rules).expect("save");

        let loaded = store.load_rules().expect("load");
        assert_eq!(loaded.source, RulesSource::Saved);
        assert_eq!(loaded.rules, rules);
        assert_eq!(
            store.saved_caddyfile().expect("saved text"),
            Some(generate_caddyfile(&rules).expect("generate"))
        );
    }

    #[test]
    fn saved_files_and_directory_are_owner_only() {
        let root = TempRoot::new();

        root.store().save(&two_sites()).expect("save");

        let directory_mode = fs::metadata(root.caddy_dir())
            .expect("directory")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(directory_mode, DIRECTORY_MODE);
        for name in [RULES_FILE, CADDYFILE] {
            let mode = fs::metadata(root.caddy_dir().join(name))
                .expect("file")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, FILE_MODE, "{name}");
        }
    }

    #[test]
    fn save_leaves_exactly_the_two_store_files_and_no_temporary_files() {
        let root = TempRoot::new();
        let store = root.store();

        store.save(&two_sites()).expect("first save");
        store.save(&one_site(9000)).expect("second save");

        assert_eq!(
            file_names(&root.caddy_dir()),
            vec![CADDYFILE.to_owned(), RULES_FILE.to_owned()]
        );
    }

    #[test]
    fn second_save_replaces_the_previous_version() {
        let root = TempRoot::new();
        let store = root.store();
        store.save(&two_sites()).expect("first save");
        let next = one_site(9000);

        store.save(&next).expect("second save");

        assert_eq!(store.load_rules().expect("load").rules, next);
        assert_eq!(
            store.saved_caddyfile().expect("saved text"),
            Some(generate_caddyfile(&next).expect("generate"))
        );
    }

    #[test]
    fn invalid_rules_are_refused_before_any_file_is_created() {
        let root = TempRoot::new();
        let injected = CaddyRules {
            version: RULES_VERSION,
            sites: vec![site("127.0.0.1 {", 8080, 3000)],
        };

        let error = root.store().save(&injected).expect_err("refused");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
        assert!(!root.caddy_dir().exists());
    }

    #[test]
    fn enabled_conflict_is_refused_and_writes_nothing() {
        let root = TempRoot::new();
        let conflicting = CaddyRules {
            version: RULES_VERSION,
            sites: vec![site("127.0.0.1", 8080, 3000), site("127.0.0.1", 8080, 3001)],
        };

        let error = root.store().save(&conflicting).expect_err("refused");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
        assert!(!root.caddy_dir().exists());
    }

    #[test]
    fn malformed_existing_rules_block_save_and_are_not_overwritten() {
        let root = TempRoot::new();
        write_store_file(&root.caddy_dir(), RULES_FILE, b"not json at all");

        let error = root.store().save(&one_site(9000)).expect_err("refused");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
        assert_eq!(
            fs::read(root.caddy_dir().join(RULES_FILE)).expect("original"),
            b"not json at all"
        );
        assert!(!root.caddy_dir().join(CADDYFILE).exists());
    }

    #[test]
    fn load_fails_closed_on_malformed_json_and_leaves_the_file_alone() {
        let root = TempRoot::new();
        write_store_file(&root.caddy_dir(), RULES_FILE, b"{\"version\":1,");

        let error = root.store().load_rules().expect_err("fails closed");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
        assert_eq!(
            fs::read(root.caddy_dir().join(RULES_FILE)).expect("original"),
            b"{\"version\":1,"
        );
    }

    #[test]
    fn load_fails_closed_on_unknown_fields() {
        let root = TempRoot::new();
        write_store_file(
            &root.caddy_dir(),
            RULES_FILE,
            br#"{"version":1,"sites":[],"caddyfile":"evil"}"#,
        );

        assert_eq!(
            root.store().load_rules().expect_err("fails closed").code(),
            AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn load_fails_closed_on_a_stored_rule_that_no_longer_validates() {
        let root = TempRoot::new();
        write_store_file(
            &root.caddy_dir(),
            RULES_FILE,
            br#"{"version":1,"sites":[{"enabled":true,"listen":{"host":"127.0.0.1 {","port":8080},"upstreams":[{"scheme":"http","host":"127.0.0.1","port":3000}]}]}"#,
        );

        assert_eq!(
            root.store().load_rules().expect_err("fails closed").code(),
            AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn load_fails_closed_on_an_unsupported_version() {
        let root = TempRoot::new();
        write_store_file(
            &root.caddy_dir(),
            RULES_FILE,
            br#"{"version":2,"sites":[]}"#,
        );

        assert_eq!(
            root.store().load_rules().expect_err("fails closed").code(),
            AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn oversized_rules_file_is_refused_without_parsing() {
        let root = TempRoot::new();
        let oversized = vec![b' '; MAX_STORE_BYTES as usize + 1];
        write_store_file(&root.caddy_dir(), RULES_FILE, &oversized);

        assert_eq!(
            root.store().load_rules().expect_err("size limit").code(),
            AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn symlinked_rules_file_is_never_followed_for_load_or_save() {
        let root = TempRoot::new();
        let outside = root.0.join("outside.json");
        fs::write(
            &outside,
            serde_json::to_vec(&CaddyRules::example()).expect("json"),
        )
        .expect("outside file");
        fs::create_dir_all(root.caddy_dir()).expect("store directory");
        symlink(&outside, root.caddy_dir().join(RULES_FILE)).expect("symlink");
        let store = root.store();

        assert_eq!(
            store.load_rules().expect_err("symlink refused").code(),
            AppErrorCode::PermissionDenied
        );
        assert_eq!(
            store
                .save(&one_site(9000))
                .expect_err("symlink refused")
                .code(),
            AppErrorCode::PermissionDenied
        );
        assert_eq!(
            fs::read(&outside).expect("outside still readable"),
            serde_json::to_vec(&CaddyRules::example()).expect("json")
        );
    }

    #[test]
    fn symlinked_store_directory_is_refused() {
        let root = TempRoot::new();
        let elsewhere = root.0.join("elsewhere");
        write_store_file(&elsewhere, RULES_FILE, br#"{"version":1,"sites":[]}"#);
        symlink(&elsewhere, root.caddy_dir()).expect("symlink directory");
        let store = root.store();

        assert_eq!(
            store.load_rules().expect_err("refused").code(),
            AppErrorCode::PermissionDenied
        );
        assert_eq!(
            store.save(&one_site(9000)).expect_err("refused").code(),
            AppErrorCode::PermissionDenied
        );
    }

    #[test]
    fn symlinked_caddyfile_is_refused_when_reading_saved_text() {
        let root = TempRoot::new();
        let outside = root.0.join("outside.txt");
        fs::write(&outside, b"secret").expect("outside file");
        fs::create_dir_all(root.caddy_dir()).expect("store directory");
        symlink(&outside, root.caddy_dir().join(CADDYFILE)).expect("symlink");

        assert_eq!(
            root.store().saved_caddyfile().expect_err("refused").code(),
            AppErrorCode::PermissionDenied
        );
    }

    #[test]
    fn saved_caddyfile_that_is_not_text_is_refused() {
        let root = TempRoot::new();
        write_store_file(&root.caddy_dir(), CADDYFILE, &[0xff, 0xfe, 0x00]);

        assert_eq!(
            root.store().saved_caddyfile().expect_err("refused").code(),
            AppErrorCode::ValidationFailed
        );
    }

    #[test]
    fn missing_saved_caddyfile_is_none() {
        let root = TempRoot::new();

        assert_eq!(root.store().saved_caddyfile().expect("no error"), None);
    }

    #[test]
    fn caddyfile_failure_after_rules_commit_is_reported_as_partial() {
        let root = TempRoot::new();
        fs::create_dir_all(root.caddy_dir().join(CADDYFILE)).expect("blocking directory");
        let store = root.store();

        let error = store.save(&two_sites()).expect_err("partial");

        assert_eq!(error.code(), AppErrorCode::PartialFailure);
        assert_eq!(
            store.load_rules().expect("rules were committed").rules,
            two_sites()
        );
    }

    const ORIGINAL: &str = "# note\nexample.com {\n\tfrobnicate on\n\treverse_proxy 127.0.0.1:3000 {\n\t\tunknown_option x\n\t}\n}\r\n";

    #[test]
    fn raw_text_round_trips_verbatim_including_comments_and_unknown_directives() {
        let root = TempRoot::new();
        let store = root.store();

        store.save_raw(ORIGINAL).expect("save");

        assert_eq!(store.load_raw().expect("load"), Some(ORIGINAL.to_owned()));
        assert_eq!(
            fs::read(root.caddy_dir().join(RAW_FILE)).expect("file"),
            ORIGINAL.as_bytes()
        );
    }

    #[test]
    fn missing_raw_text_is_none_and_loading_creates_nothing() {
        let root = TempRoot::new();

        assert_eq!(root.store().load_raw().expect("no error"), None);
        assert!(!root.caddy_dir().exists());
    }

    #[test]
    fn saving_raw_text_leaves_rules_and_generated_text_untouched() {
        let root = TempRoot::new();
        let store = root.store();
        store.save(&two_sites()).expect("rules");
        let before = (
            store.load_rules().expect("rules before"),
            store.saved_caddyfile().expect("generated before"),
        );

        store.save_raw(ORIGINAL).expect("raw");

        assert_eq!(store.load_rules().expect("rules after"), before.0);
        assert_eq!(store.saved_caddyfile().expect("generated after"), before.1);
        assert_eq!(
            store.load_raw().expect("raw after"),
            Some(ORIGINAL.to_owned())
        );
    }

    #[test]
    fn saving_raw_text_alone_does_not_create_rules() {
        let root = TempRoot::new();
        let store = root.store();

        store.save_raw(ORIGINAL).expect("raw");

        assert_eq!(
            store.load_rules().expect("defaults").source,
            RulesSource::Default
        );
        assert_eq!(store.saved_caddyfile().expect("no generated text"), None);
    }

    #[test]
    fn raw_file_is_owner_only_and_the_store_keeps_only_expected_files() {
        let root = TempRoot::new();
        let store = root.store();

        store.save_raw("one").expect("first");
        store.save_raw("two").expect("second");

        let mode = fs::metadata(root.caddy_dir().join(RAW_FILE))
            .expect("file")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, FILE_MODE);
        assert_eq!(file_names(&root.caddy_dir()), vec![RAW_FILE.to_owned()]);
        assert_eq!(store.load_raw().expect("load"), Some("two".to_owned()));
    }

    #[test]
    fn raw_text_over_the_limit_is_refused_before_any_file_is_created() {
        let root = TempRoot::new();
        let oversized = "a".repeat(MAX_STORE_BYTES as usize + 1);

        assert_eq!(
            root.store()
                .save_raw(&oversized)
                .expect_err("refused")
                .code(),
            AppErrorCode::InvalidInput
        );
        assert!(!root.caddy_dir().exists());
    }

    #[test]
    fn raw_text_exactly_at_the_limit_is_accepted() {
        let root = TempRoot::new();
        let exact = "a".repeat(MAX_STORE_BYTES as usize);

        root.store().save_raw(&exact).expect("accepted");

        assert_eq!(root.store().load_raw().expect("load"), Some(exact));
    }

    #[test]
    fn raw_text_with_a_nul_byte_is_refused() {
        let root = TempRoot::new();

        assert_eq!(
            root.store().save_raw("a\0b").expect_err("refused").code(),
            AppErrorCode::InvalidInput
        );
        assert!(!root.caddy_dir().exists());
    }

    #[test]
    fn malformed_raw_file_fails_closed_on_load_and_is_not_overwritten() {
        let root = TempRoot::new();
        write_store_file(&root.caddy_dir(), RAW_FILE, &[0xff, 0xfe, 0x00]);
        let store = root.store();

        assert_eq!(
            store.load_raw().expect_err("fails closed").code(),
            AppErrorCode::ValidationFailed
        );
        assert_eq!(
            store.save_raw("new").expect_err("refused").code(),
            AppErrorCode::ValidationFailed
        );
        assert_eq!(
            fs::read(root.caddy_dir().join(RAW_FILE)).expect("original"),
            vec![0xff, 0xfe, 0x00]
        );
    }

    #[test]
    fn oversized_raw_file_fails_closed_on_load_and_save() {
        let root = TempRoot::new();
        let oversized = vec![b'a'; MAX_STORE_BYTES as usize + 1];
        write_store_file(&root.caddy_dir(), RAW_FILE, &oversized);
        let store = root.store();

        assert_eq!(
            store.load_raw().expect_err("size limit").code(),
            AppErrorCode::ValidationFailed
        );
        assert_eq!(
            store.save_raw("new").expect_err("size limit").code(),
            AppErrorCode::ValidationFailed
        );
        assert_eq!(
            fs::read(root.caddy_dir().join(RAW_FILE))
                .expect("original")
                .len(),
            oversized.len()
        );
    }

    #[test]
    fn symlinked_raw_file_is_never_followed_for_load_or_save() {
        let root = TempRoot::new();
        let outside = root.0.join("outside.txt");
        fs::write(&outside, b"keep").expect("outside");
        fs::create_dir_all(root.caddy_dir()).expect("store directory");
        symlink(&outside, root.caddy_dir().join(RAW_FILE)).expect("symlink");
        let store = root.store();

        assert_eq!(
            store.load_raw().expect_err("refused").code(),
            AppErrorCode::PermissionDenied
        );
        assert_eq!(
            store.save_raw("new").expect_err("refused").code(),
            AppErrorCode::PermissionDenied
        );
        assert_eq!(fs::read(&outside).expect("outside"), b"keep");
    }

    #[test]
    fn checks_root_is_owner_only_inside_the_store_and_idempotent() {
        let root = TempRoot::new();
        let store = root.store();

        let first = store.checks_root().expect("created");
        let second = store.checks_root().expect("reused");

        assert_eq!(first, root.caddy_dir().join(CHECKS_DIRECTORY));
        assert_eq!(first, second);
        let mode = fs::metadata(&first).expect("dir").permissions().mode() & 0o777;
        assert_eq!(mode, DIRECTORY_MODE);
    }

    #[test]
    fn a_symlinked_checks_root_is_refused() {
        let root = TempRoot::new();
        let elsewhere = root.0.join("elsewhere");
        fs::create_dir_all(&elsewhere).expect("elsewhere");
        fs::create_dir_all(root.caddy_dir()).expect("store directory");
        symlink(&elsewhere, root.caddy_dir().join(CHECKS_DIRECTORY)).expect("symlink");

        assert_eq!(
            root.store().checks_root().expect_err("refused").code(),
            AppErrorCode::PermissionDenied
        );
    }

    #[test]
    fn a_store_in_a_directory_keeps_its_files_directly_inside_it() {
        let root = TempRoot::new();
        let workdir = root.0.join("workdir");
        fs::create_dir_all(&workdir).expect("work directory");
        let store = CaddyStore::in_directory(&workdir);

        store.save(&two_sites()).expect("save");

        assert_eq!(
            file_names(&workdir),
            vec![CADDYFILE.to_owned(), RULES_FILE.to_owned()]
        );
        assert!(!root.caddy_dir().exists());
        assert_eq!(store.load_rules().expect("load").rules, two_sites());
    }

    #[test]
    fn has_content_reports_entries_without_opening_them() {
        let root = TempRoot::new();
        let store = root.store();
        assert!(!store.has_content());

        write_store_file(&root.caddy_dir(), RULES_FILE, b"{\"version\":1,");

        assert!(store.has_content());
        assert_eq!(
            fs::read(root.caddy_dir().join(RULES_FILE)).expect("untouched"),
            b"{\"version\":1,"
        );
    }
}
