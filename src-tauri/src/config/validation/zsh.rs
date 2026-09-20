use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    time::Duration,
};

use uuid::Uuid;

use crate::{
    error::AppError,
    process::{ProcessError, run_bounded},
};

use super::super::adapters::zsh::managed_range;

pub fn validate(content: &str) -> Result<(), AppError> {
    managed_range(content)?;
    validate_with(Path::new("/bin/zsh"), content)
}

fn validate_with(executable: &Path, content: &str) -> Result<(), AppError> {
    let path = std::env::temp_dir().join(format!("userhome-zsh-{}.zsh", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|_| AppError::permission_denied("Validation file cannot be created."))?;
        file.write_all(content.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| AppError::permission_denied("Validation file cannot be written."))?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|_| AppError::permission_denied("Validation file cannot be protected."))?;
        let path_value = path.to_string_lossy();
        run_bounded(
            executable,
            &["-n", path_value.as_ref()],
            Duration::from_secs(2),
            16 * 1024,
        )
        .map_err(map_process_error)?;
        Ok(())
    })();
    let _ = fs::remove_file(&path);
    result
}

fn map_process_error(error: ProcessError) -> AppError {
    match error {
        ProcessError::Timeout => AppError::timeout("Zsh validation timed out."),
        ProcessError::Spawn | ProcessError::Io | ProcessError::OutputTooLarge => {
            AppError::process_failed("Zsh validation could not run.", false)
        }
        ProcessError::Failed { .. } => {
            AppError::validation_failed("Zsh configuration syntax is invalid.")
        }
    }
}
