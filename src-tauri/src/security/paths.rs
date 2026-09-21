use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};

pub(crate) const TRUSTED_BREW_PREFIXES: &[&str] = &["/opt/homebrew", "/usr/local"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CatalogPathRoot {
    Home,
    XdgConfigHome,
    ApplicationSupport,
    HomebrewPrefix,
    AppSupport,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathPolicyError {
    NotFound,
    PermissionDenied,
    Io,
    OutsideAuthorizedRoot,
    UnsupportedEntry,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedPath {
    pub logical_path: PathBuf,
    pub target_path: PathBuf,
    pub display_path: String,
    pub symlink_target: Option<String>,
}

pub fn resolve_catalog_path(
    path_template: &str,
    home: &Path,
    brew_prefix: &Path,
) -> Result<AuthorizedPath, PathPolicyError> {
    let (root, relative, display_prefix) = if let Some(relative) = path_template.strip_prefix("~/")
    {
        (home, relative, "~")
    } else if let Some(relative) = path_template.strip_prefix("${HOMEBREW_PREFIX}/") {
        (brew_prefix, relative, "${HOMEBREW_PREFIX}")
    } else {
        return Err(PathPolicyError::OutsideAuthorizedRoot);
    };

    resolve_rooted_catalog_path(root, relative, display_prefix)
}

pub fn resolve_rooted_catalog_path(
    root: &Path,
    relative: &str,
    display_root: &str,
) -> Result<AuthorizedPath, PathPolicyError> {
    if !is_safe_catalog_relative_path(relative) {
        return Err(PathPolicyError::OutsideAuthorizedRoot);
    }

    let canonical_root = fs::canonicalize(root).map_err(classify_io_error)?;
    let logical_path = root.join(relative);
    let display_path = format!("{display_root}/{relative}");

    match fs::symlink_metadata(&logical_path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            let target_path = fs::canonicalize(&logical_path).map_err(classify_io_error)?;
            ensure_contained(&target_path, &canonical_root)?;
            let target_metadata = fs::metadata(&target_path).map_err(classify_io_error)?;
            if !target_metadata.is_file() && !target_metadata.is_dir() {
                return Err(PathPolicyError::UnsupportedEntry);
            }
            let target_relative = target_path
                .strip_prefix(&canonical_root)
                .map_err(|_| PathPolicyError::OutsideAuthorizedRoot)?;
            let symlink_target = format!("{display_root}/{}", target_relative.to_string_lossy());
            Ok(AuthorizedPath {
                logical_path,
                target_path,
                display_path,
                symlink_target: Some(symlink_target),
            })
        }
        Ok(metadata) => {
            if !metadata.is_file() && !metadata.is_dir() {
                return Err(PathPolicyError::UnsupportedEntry);
            }
            let target_path = fs::canonicalize(&logical_path).map_err(classify_io_error)?;
            ensure_contained(&target_path, &canonical_root)?;
            Ok(AuthorizedPath {
                logical_path,
                target_path,
                display_path,
                symlink_target: None,
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = logical_path.parent().ok_or(PathPolicyError::NotFound)?;
            let canonical_parent = fs::canonicalize(parent).map_err(classify_io_error)?;
            ensure_contained(&canonical_parent, &canonical_root)?;
            let file_name = logical_path
                .file_name()
                .ok_or(PathPolicyError::NotFound)?
                .to_owned();
            Ok(AuthorizedPath {
                logical_path,
                target_path: canonical_parent.join(file_name),
                display_path,
                symlink_target: None,
            })
        }
        Err(error) => Err(classify_io_error(error)),
    }
}

fn classify_io_error(error: std::io::Error) -> PathPolicyError {
    match error.kind() {
        std::io::ErrorKind::NotFound => PathPolicyError::NotFound,
        std::io::ErrorKind::PermissionDenied => PathPolicyError::PermissionDenied,
        _ => PathPolicyError::Io,
    }
}

fn ensure_contained(path: &Path, root: &Path) -> Result<(), PathPolicyError> {
    if path == root || path.starts_with(root) {
        Ok(())
    } else {
        Err(PathPolicyError::OutsideAuthorizedRoot)
    }
}

pub fn is_safe_catalog_relative_path(value: &str) -> bool {
    !value.is_empty()
        && !value.contains('\0')
        && !value.contains('\\')
        && !value.chars().any(char::is_control)
        && Path::new(value)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        os::unix::fs::symlink,
        path::{Path, PathBuf},
    };

    use uuid::Uuid;

    use super::{PathPolicyError, resolve_catalog_path};

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-paths-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create fixture root");
            Self { root }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn resolves_safe_symlink_without_replacing_its_logical_path() {
        let fixture = Fixture::new();
        let home = fixture.root.join("home");
        let brew = fixture.root.join("brew");
        fs::create_dir_all(home.join("dotfiles")).expect("create dotfiles");
        fs::create_dir_all(&brew).expect("create brew root");
        fs::write(home.join("dotfiles/gitconfig"), b"[user]\n").expect("write target");
        symlink("dotfiles/gitconfig", home.join(".gitconfig")).expect("create symlink");

        let resolved =
            resolve_catalog_path("~/.gitconfig", &home, &brew).expect("resolve safe symlink");

        assert_eq!(resolved.logical_path, home.join(".gitconfig"));
        assert_eq!(
            resolved.target_path,
            fs::canonicalize(home.join("dotfiles/gitconfig")).expect("canonical target")
        );
        assert_eq!(
            resolved.symlink_target.as_deref(),
            Some("~/dotfiles/gitconfig")
        );
        assert!(Path::new(&resolved.logical_path).is_symlink());
    }

    #[test]
    fn rejects_symlink_that_escapes_the_catalog_root() {
        let fixture = Fixture::new();
        let home = fixture.root.join("home");
        let brew = fixture.root.join("brew");
        let outside = fixture.root.join("outside");
        fs::create_dir_all(&home).expect("create home");
        fs::create_dir_all(&brew).expect("create brew root");
        fs::write(&outside, b"secret").expect("write outside file");
        symlink(&outside, home.join(".gitconfig")).expect("create symlink");

        let error = resolve_catalog_path("~/.gitconfig", &home, &brew)
            .expect_err("reject escaping symlink");

        assert_eq!(error, PathPolicyError::OutsideAuthorizedRoot);
    }
}
