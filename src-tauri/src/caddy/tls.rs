//! Certificate and private key files for the TLS option of a site.
//!
//! The paths come only from authorizations the user picked. They are written
//! into a whitespace-separated Caddyfile, so each one must pass a closed
//! character set before it reaches the generator.

use std::path::{Path, PathBuf};

use crate::error::AppError;

pub const MAX_TLS_PATH_BYTES: usize = 1024;

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

#[cfg(test)]
mod tests {
    use std::{ffi::OsStr, os::unix::ffi::OsStrExt, path::PathBuf};

    use super::*;
    use crate::error::AppErrorCode;

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
}
