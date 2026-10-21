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

pub struct CaddyStore {
    directory: PathBuf,
    write_lock: Mutex<()>,
}

impl CaddyStore {
    pub fn new(app_config_directory: &Path) -> Self {
        Self {
            directory: app_config_directory.join(STORE_DIRECTORY),
            write_lock: Mutex::new(()),
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

    pub fn save(&self, rules: &CaddyRules) -> Result<(), AppError> {
        if rules.validate().is_blocking() {
            return Err(AppError::validation_failed("规则未通过校验，未保存。"));
        }
        let caddyfile = generate_caddyfile(rules)?;
        let mut rules_bytes = serde_json::to_vec_pretty(rules).map_err(|_| AppError::internal())?;
        rules_bytes.push(b'\n');
        if rules_bytes.len() as u64 > MAX_STORE_BYTES {
            return Err(AppError::invalid_input("规则超过大小上限，未保存。"));
        }

        let _guard = self.write_lock.lock().map_err(|_| AppError::internal())?;
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
}
