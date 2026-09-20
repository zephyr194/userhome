use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    time::Duration,
};

use uuid::Uuid;

use crate::{
    config::ConfigEnvironment,
    error::AppError,
    process::{ProcessError, run_bounded},
};

pub fn validate(environment: &ConfigEnvironment, content: &str) -> Result<(), AppError> {
    let executable = environment.brew_prefix().join("bin/caddy");
    validate_with(&executable, content)
}

fn validate_with(executable: &Path, content: &str) -> Result<(), AppError> {
    let path = std::env::temp_dir().join(format!("userhome-caddy-{}.Caddyfile", Uuid::new_v4()));
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
            &[
                "validate",
                "--config",
                path_value.as_ref(),
                "--adapter",
                "caddyfile",
            ],
            Duration::from_secs(5),
            64 * 1024,
        )
        .map_err(map_process_error)?;
        Ok(())
    })();
    let _ = fs::remove_file(&path);
    result
}

fn map_process_error(error: ProcessError) -> AppError {
    match error {
        ProcessError::Timeout => AppError::timeout("Caddy validation timed out."),
        ProcessError::Spawn | ProcessError::Io | ProcessError::OutputTooLarge => {
            AppError::process_failed("Caddy validation could not run.", false)
        }
        ProcessError::Failed { .. } => AppError::validation_failed("Caddyfile validation failed."),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt};

    use uuid::Uuid;

    use super::*;

    #[test]
    fn invokes_only_fixed_validate_arguments() {
        let root =
            std::env::temp_dir().join(format!("userhome-caddy-validator-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("root");
        let executable = root.join("caddy");
        fs::write(
            &executable,
            "#!/bin/sh\n[ \"$1\" = validate ] && [ \"$2\" = --config ] && [ \"$4\" = --adapter ] && [ \"$5\" = caddyfile ]\n",
        )
        .expect("script");
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).expect("mode");
        validate_with(&executable, "example.test {\n respond \"ok\"\n}\n").expect("validate");
        fs::remove_dir_all(root).expect("cleanup");
    }
}
