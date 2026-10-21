//! Certificate and private key files for the TLS option of a site.
//!
//! The paths come only from authorizations the user picked. They are written
//! into a whitespace-separated Caddyfile, so each one must pass a closed
//! character set before it reaches the generator.

use std::{
    fs, io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{
    caddy::config::TlsConfig,
    error::AppError,
    grants::{GrantCoordinator, GrantError, GrantId, GrantRecord},
};

pub const MAX_TLS_PATH_BYTES: usize = 1024;
const READABLE_BY_OTHERS: u32 = 0o044;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsPaths {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
}

pub fn caddy_safe_path(path: &Path) -> Result<&str, AppError> {
    let text = path.to_str().ok_or_else(refused)?;
    if text.len() > MAX_TLS_PATH_BYTES
        || !text.starts_with('/')
        || text.chars().any(is_refused_character)
    {
        return Err(refused());
    }
    Ok(text)
}

fn is_refused_character(character: char) -> bool {
    character.is_control()
        || character.is_whitespace()
        || matches!(character, '{' | '}' | '"' | '\'' | '`' | '#' | '\\')
}

fn refused() -> AppError {
    AppError::validation_failed("证书或私钥的路径包含 Caddy 配置不允许的字符，未生成配置。")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TlsWarning {
    PrivateKeyReadableByOthers,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsResolution {
    pub paths: TlsPaths,
    pub certificate_name: String,
    pub private_key_name: String,
    pub warnings: Vec<TlsWarning>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    Regular,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntryFacts {
    pub kind: EntryKind,
    pub mode: u32,
}

/// Metadata only: the content of certificates and keys is never read here.
pub trait FileInspector {
    fn entry(&self, path: &Path) -> io::Result<EntryFacts>;
}

pub struct SystemFileInspector;

impl FileInspector for SystemFileInspector {
    fn entry(&self, path: &Path) -> io::Result<EntryFacts> {
        let metadata = fs::symlink_metadata(path)?;
        let file_type = metadata.file_type();
        let kind = if file_type.is_symlink() {
            EntryKind::Symlink
        } else if file_type.is_file() {
            EntryKind::Regular
        } else {
            EntryKind::Other
        };
        Ok(EntryFacts {
            kind,
            mode: metadata.permissions().mode() & 0o777,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Material {
    Certificate,
    PrivateKey,
}

impl Material {
    fn revoked(self) -> &'static str {
        match self {
            Self::Certificate => "证书授权已撤销，请重新选择证书文件。",
            Self::PrivateKey => "私钥授权已撤销，请重新选择私钥文件。",
        }
    }

    fn missing(self) -> &'static str {
        match self {
            Self::Certificate => "所选证书文件不存在或已被移动，请重新选择。",
            Self::PrivateKey => "所选私钥文件不存在或已被移动，请重新选择。",
        }
    }

    fn symlink(self) -> &'static str {
        match self {
            Self::Certificate => "所选证书是符号链接，请选择实际文件。",
            Self::PrivateKey => "所选私钥是符号链接，请选择实际文件。",
        }
    }

    fn not_regular(self) -> &'static str {
        match self {
            Self::Certificate => "所选证书不是普通文件。",
            Self::PrivateKey => "所选私钥不是普通文件。",
        }
    }
}

pub fn resolve_tls(
    grants: &GrantCoordinator,
    tls: &TlsConfig,
    files: &dyn FileInspector,
) -> Result<TlsResolution, AppError> {
    let certificate = resolve_grant(grants, &tls.certificate_grant_id, Material::Certificate)?;
    let private_key = resolve_grant(grants, &tls.private_key_grant_id, Material::PrivateKey)?;
    let certificate_path = certificate.target_path();
    let private_key_path = private_key.target_path();
    inspect_regular(files, &certificate_path, Material::Certificate)?;
    let warnings = inspect_private_key(files, &private_key_path)?;
    Ok(TlsResolution {
        certificate_name: display_name(&certificate_path),
        private_key_name: display_name(&private_key_path),
        paths: TlsPaths {
            certificate: certificate_path,
            private_key: private_key_path,
        },
        warnings,
    })
}

fn resolve_grant(
    grants: &GrantCoordinator,
    raw: &str,
    material: Material,
) -> Result<GrantRecord, AppError> {
    let id = GrantId::parse(raw).map_err(|_| AppError::invalid_input("授权编号无效。"))?;
    grants
        .resolve_tls_material(&id)
        .map_err(|error| match error {
            GrantError::UnknownGrant => AppError::not_found(material.revoked()),
            other => AppError::from(other),
        })
}

fn inspect_regular(
    files: &dyn FileInspector,
    path: &Path,
    material: Material,
) -> Result<EntryFacts, AppError> {
    let facts = files
        .entry(path)
        .map_err(|error| io_failure(&error, material))?;
    match facts.kind {
        EntryKind::Regular => Ok(facts),
        EntryKind::Symlink => Err(AppError::validation_failed(material.symlink())),
        EntryKind::Other => Err(AppError::validation_failed(material.not_regular())),
    }
}

fn io_failure(error: &io::Error, material: Material) -> AppError {
    match error.kind() {
        io::ErrorKind::NotFound => AppError::not_found(material.missing()),
        io::ErrorKind::PermissionDenied => {
            AppError::permission_denied("UserHome 无权访问所选文件，请检查文件权限。")
        }
        _ => AppError::internal(),
    }
}

/// A private key that other users can read is reported, not refused: the
/// user chose it knowingly and the file itself is left untouched.
pub fn inspect_private_key(
    files: &dyn FileInspector,
    path: &Path,
) -> Result<Vec<TlsWarning>, AppError> {
    let facts = inspect_regular(files, path, Material::PrivateKey)?;
    let mut warnings = Vec::new();
    if (facts.mode & READABLE_BY_OTHERS) != 0 {
        warnings.push(TlsWarning::PrivateKeyReadableByOthers);
    }
    Ok(warnings)
}

fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || "未知文件".to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, ffi::OsStr, os::unix::ffi::OsStrExt, path::PathBuf};

    use uuid::Uuid;

    use super::*;
    use crate::{
        error::AppErrorCode,
        grants::{GrantPurpose, GrantStore},
    };

    #[test]
    fn absolute_paths_without_refused_characters_are_accepted() {
        for raw in [
            "/Users/archie.zheng/certs/app.example.test.pem",
            "/opt/certs/key_v2-final.pem",
            "/a/b/c",
        ] {
            assert_eq!(caddy_safe_path(Path::new(raw)).expect(raw), raw);
        }
    }

    #[test]
    fn paths_that_could_change_the_caddyfile_grammar_are_refused() {
        let long = format!("/{}", "a".repeat(MAX_TLS_PATH_BYTES));
        let max = format!("/{}", "a".repeat(MAX_TLS_PATH_BYTES - 1));
        assert!(caddy_safe_path(Path::new(&max)).is_ok());

        let mut refused_paths = vec![
            "relative/cert.pem".to_owned(),
            "~/cert.pem".to_owned(),
            String::new(),
            "/x/with space.pem".to_owned(),
            "/x/tab\tfile.pem".to_owned(),
            "/x/new\nline.pem".to_owned(),
            "/x/cr\rfile.pem".to_owned(),
            "/x/nul\u{0}.pem".to_owned(),
            "/x/bell\u{7}.pem".to_owned(),
            "/x/{env.HOME}.pem".to_owned(),
            "/x/brace}.pem".to_owned(),
            "/x/quote\".pem".to_owned(),
            "/x/apos'.pem".to_owned(),
            "/x/tick`.pem".to_owned(),
            "/x/hash#.pem".to_owned(),
            "/x/back\\slash.pem".to_owned(),
            long,
        ];
        refused_paths.push(format!("/{}", "a".repeat(MAX_TLS_PATH_BYTES + 1)));

        for raw in refused_paths {
            let error = caddy_safe_path(Path::new(&raw))
                .expect_err(&format!("path {raw:?} must be refused"));
            assert_eq!(error.code(), AppErrorCode::ValidationFailed, "path {raw:?}");
        }
    }

    #[test]
    fn non_utf8_paths_are_refused() {
        let raw = PathBuf::from(OsStr::from_bytes(b"/x/\xff\xfe.pem"));
        let error = caddy_safe_path(&raw).expect_err("non-utf8 path must be refused");

        assert_eq!(error.code(), AppErrorCode::ValidationFailed);
    }

    struct FakeFiles(HashMap<PathBuf, Result<EntryFacts, io::ErrorKind>>);

    impl FileInspector for FakeFiles {
        fn entry(&self, path: &Path) -> io::Result<EntryFacts> {
            match self.0.get(path) {
                Some(Ok(facts)) => Ok(*facts),
                Some(Err(kind)) => Err(io::Error::from(*kind)),
                None => Err(io::Error::from(io::ErrorKind::NotFound)),
            }
        }
    }

    fn files(entries: Vec<(&str, Result<EntryFacts, io::ErrorKind>)>) -> FakeFiles {
        FakeFiles(
            entries
                .into_iter()
                .map(|(path, entry)| (PathBuf::from(path), entry))
                .collect(),
        )
    }

    fn file(mode: u32) -> Result<EntryFacts, io::ErrorKind> {
        Ok(EntryFacts {
            kind: EntryKind::Regular,
            mode,
        })
    }

    fn entry(kind: EntryKind) -> Result<EntryFacts, io::ErrorKind> {
        Ok(EntryFacts { kind, mode: 0o600 })
    }

    fn code_of(error: &AppError) -> AppErrorCode {
        error.code()
    }

    #[test]
    fn certificate_must_be_an_existing_regular_file() {
        let path = "/Users/u/certs/cert.pem";
        let accepted = files(vec![(path, file(0o644))]);
        assert!(inspect_regular(&accepted, Path::new(path), Material::Certificate).is_ok());

        for (outcome, expected) in [
            (entry(EntryKind::Symlink), AppErrorCode::ValidationFailed),
            (entry(EntryKind::Other), AppErrorCode::ValidationFailed),
            (Err(io::ErrorKind::NotFound), AppErrorCode::NotFound),
            (
                Err(io::ErrorKind::PermissionDenied),
                AppErrorCode::PermissionDenied,
            ),
        ] {
            let fake = files(vec![(path, outcome)]);
            let error = inspect_regular(&fake, Path::new(path), Material::Certificate)
                .expect_err("certificate must be refused");
            assert_eq!(code_of(&error), expected);
        }
    }

    #[test]
    fn private_key_readable_by_group_or_others_warns_but_is_never_refused() {
        for mode in [0o600, 0o400] {
            let path = Path::new("/Users/u/certs/key.pem");
            let fake = files(vec![("/Users/u/certs/key.pem", file(mode))]);
            assert_eq!(inspect_private_key(&fake, path).expect("accepted"), vec![]);
        }

        for mode in [0o640, 0o604, 0o644, 0o666] {
            let path = Path::new("/Users/u/certs/key.pem");
            let fake = files(vec![("/Users/u/certs/key.pem", file(mode))]);
            assert_eq!(
                inspect_private_key(&fake, path).expect("accepted with a warning"),
                vec![TlsWarning::PrivateKeyReadableByOthers],
                "mode {mode:o}"
            );
        }
    }

    #[test]
    fn private_key_that_is_a_symlink_directory_or_missing_is_refused_with_its_code() {
        let path = Path::new("/Users/u/certs/key.pem");
        for (outcome, expected) in [
            (entry(EntryKind::Symlink), AppErrorCode::ValidationFailed),
            (entry(EntryKind::Other), AppErrorCode::ValidationFailed),
            (Err(io::ErrorKind::NotFound), AppErrorCode::NotFound),
            (
                Err(io::ErrorKind::PermissionDenied),
                AppErrorCode::PermissionDenied,
            ),
            (Err(io::ErrorKind::Other), AppErrorCode::Internal),
        ] {
            let fake = files(vec![("/Users/u/certs/key.pem", outcome)]);
            let error = inspect_private_key(&fake, path).expect_err("key must be refused");
            assert_eq!(code_of(&error), expected);
        }
    }

    struct TempHome {
        root: PathBuf,
    }

    impl TempHome {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("canonical temp dir")
                .join(format!("userhome-tls-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create temp home");
            Self { root }
        }

        fn coordinator(&self) -> GrantCoordinator {
            GrantCoordinator::new(
                GrantStore::new(self.root.join("support")),
                Some(self.root.clone()),
            )
        }

        fn write(&self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            fs::write(&path, b"material").expect("write material");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("mode 0600");
            path
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn granted_files_resolve_to_paths_and_display_names_only() {
        let home = TempHome::new();
        let coordinator = home.coordinator();
        let cert = home.write("cert.pem");
        let key = home.write("key.pem");
        let cert_grant = coordinator
            .create(GrantPurpose::TlsMaterialFile, &cert)
            .expect("certificate grant");
        let key_grant = coordinator
            .create(GrantPurpose::TlsMaterialFile, &key)
            .expect("key grant");
        let tls = TlsConfig {
            certificate_grant_id: cert_grant.id.as_str().to_owned(),
            private_key_grant_id: key_grant.id.as_str().to_owned(),
        };

        let resolved = resolve_tls(&coordinator, &tls, &SystemFileInspector).expect("resolves");

        assert_eq!(resolved.paths.certificate, cert);
        assert_eq!(resolved.paths.private_key, key);
        assert_eq!(resolved.certificate_name, "cert.pem");
        assert_eq!(resolved.private_key_name, "key.pem");
        assert!(resolved.warnings.is_empty());
    }

    #[test]
    fn revoking_either_authorization_fails_resolution_without_leaking_its_path() {
        let home = TempHome::new();
        let coordinator = home.coordinator();
        let cert_grant = coordinator
            .create(GrantPurpose::TlsMaterialFile, &home.write("cert.pem"))
            .expect("certificate grant");
        let key_grant = coordinator
            .create(GrantPurpose::TlsMaterialFile, &home.write("key.pem"))
            .expect("key grant");
        let tls = TlsConfig {
            certificate_grant_id: cert_grant.id.as_str().to_owned(),
            private_key_grant_id: key_grant.id.as_str().to_owned(),
        };
        coordinator.revoke(&key_grant.id).expect("revoke key");

        let error = resolve_tls(&coordinator, &tls, &SystemFileInspector)
            .expect_err("revoked key must fail");

        assert_eq!(code_of(&error), AppErrorCode::NotFound);
        let message = serde_json::to_value(&error).expect("serialize")["message"]
            .as_str()
            .expect("message")
            .to_owned();
        assert!(message.contains("私钥授权已撤销"), "{message}");
        assert!(!message.contains('/'), "message leaks a path: {message}");
    }

    #[test]
    fn malformed_grant_ids_are_refused_before_any_lookup() {
        let home = TempHome::new();
        let tls = TlsConfig {
            certificate_grant_id: "/Users/u/cert.pem".to_owned(),
            private_key_grant_id: "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f".to_owned(),
        };

        let error = resolve_tls(&home.coordinator(), &tls, &SystemFileInspector)
            .expect_err("path is not a grant id");

        assert_eq!(code_of(&error), AppErrorCode::InvalidInput);
    }
}
