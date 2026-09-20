use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::AppError;

use super::AdapterView;

const MANAGED_PREFIX: &str = "# UserHome managed host: ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SshFields {
    host: String,
    host_name: String,
    user: Option<String>,
    port: Option<u16>,
}

pub fn inspect(content: &str) -> Result<AdapterView, AppError> {
    let managed = parse_managed(content);
    Ok(AdapterView {
        content: Some(content.to_owned()),
        content_redacted: false,
        structured: managed.map(|value| {
            json!({
                "host": value.host,
                "hostName": value.host_name,
                "user": value.user,
                "port": value.port
            })
        }),
    })
}

pub fn prepare_structured(current: &str, fields: Value) -> Result<String, AppError> {
    let fields: SshFields = serde_json::from_value(fields)
        .map_err(|_| AppError::invalid_input("SSH host settings are invalid."))?;
    validate_token(&fields.host)?;
    validate_token(&fields.host_name)?;
    if let Some(user) = &fields.user {
        validate_token(user)?;
    }
    if fields.port == Some(0) {
        return Err(AppError::validation_failed("SSH port is invalid."));
    }

    let replacement = managed_block(&fields);
    let lines = current.lines().collect::<Vec<_>>();
    let marker = format!("{MANAGED_PREFIX}{}", fields.host);
    let start = lines.iter().position(|line| line.trim() == marker);
    let mut output = if let Some(start) = start {
        let end = lines[start + 2..]
            .iter()
            .position(|line| {
                let trimmed = line.trim_start();
                trimmed.starts_with("Host ") || trimmed.starts_with(MANAGED_PREFIX)
            })
            .map_or(lines.len(), |offset| start + 2 + offset);
        let mut values = lines[..start]
            .iter()
            .map(|line| (*line).to_owned())
            .collect::<Vec<_>>();
        values.extend(replacement.lines().map(str::to_owned));
        values.extend(lines[end..].iter().map(|line| (*line).to_owned()));
        values.join("\n")
    } else {
        let mut value = current.trim_end_matches('\n').to_owned();
        if !value.is_empty() {
            value.push_str("\n\n");
        }
        value.push_str(&replacement);
        value
    };
    output.push('\n');
    Ok(output)
}

fn managed_block(fields: &SshFields) -> String {
    let mut lines = vec![
        format!("{MANAGED_PREFIX}{}", fields.host),
        format!("Host {}", fields.host),
        format!("    HostName {}", fields.host_name),
    ];
    if let Some(user) = &fields.user
        && !user.is_empty()
    {
        lines.push(format!("    User {user}"));
    }
    if let Some(port) = fields.port {
        lines.push(format!("    Port {port}"));
    }
    lines.join("\n")
}

fn parse_managed(content: &str) -> Option<SshFields> {
    let lines = content.lines().collect::<Vec<_>>();
    let start = lines
        .iter()
        .position(|line| line.trim_start().starts_with(MANAGED_PREFIX))?;
    let host = lines[start].trim_start()[MANAGED_PREFIX.len()..].to_owned();
    let end = lines[start + 2..]
        .iter()
        .position(|line| {
            let line = line.trim_start();
            line.starts_with("Host ") || line.starts_with(MANAGED_PREFIX)
        })
        .map_or(lines.len(), |offset| start + 2 + offset);
    let mut host_name = String::new();
    let mut user = None;
    let mut port = None;
    for line in &lines[start + 1..end] {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("HostName ") {
            host_name = value.trim().to_owned();
        } else if let Some(value) = trimmed.strip_prefix("User ") {
            user = Some(value.trim().to_owned());
        } else if let Some(value) = trimmed.strip_prefix("Port ") {
            port = value.trim().parse().ok();
        }
    }
    (!host_name.is_empty()).then_some(SshFields {
        host,
        host_name,
        user,
        port,
    })
}

fn validate_token(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.len() > 255
        || value.chars().any(char::is_whitespace)
        || value.contains(['\0', '#'])
    {
        return Err(AppError::validation_failed("SSH host value is invalid."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt};

    use serde_json::json;
    use uuid::Uuid;

    use crate::{
        catalog::load_builtin_catalog,
        config::{
            ConfigEnvironment,
            read::hash_bytes,
            write::{ConfigWriteInput, prepare_write},
        },
    };

    use super::*;

    #[test]
    fn structured_edit_preserves_unmanaged_hosts_and_comments() {
        let current = "# keep\nHost work\n    HostName old.example\n\n# UserHome managed host: dev\nHost dev\n    HostName before.example\n";
        let updated = prepare_structured(
            current,
            json!({"host":"dev","hostName":"after.example","user":"git","port":22}),
        )
        .expect("update");
        assert!(updated.contains("# keep\nHost work\n    HostName old.example"));
        assert!(
            updated.contains("# UserHome managed host: dev\nHost dev\n    HostName after.example")
        );
    }

    #[test]
    fn rejects_unsafe_permissions_and_includes_without_reading_private_keys() {
        let root = std::env::temp_dir().join(format!("userhome-ssh-{}", Uuid::new_v4()));
        let home = root.join("home");
        let brew = root.join("brew");
        fs::create_dir_all(home.join(".ssh")).expect("ssh");
        fs::create_dir_all(&brew).expect("brew");
        let path = home.join(".ssh/config");
        let content = "Include /tmp/unsafe\nHost test\n    HostName example.test\n    IdentityFile ~/.ssh/id_fixture\n";
        fs::write(&path, content).expect("config");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("mode");
        let environment = ConfigEnvironment::new(home.clone(), brew, home.join("backups"));
        let catalog = load_builtin_catalog().expect("catalog");
        let input = || ConfigWriteInput {
            app_id: "openssh".to_owned(),
            config_id: "ssh-client-config".to_owned(),
            expected_hash: hash_bytes(content.as_bytes()),
            content: content.to_owned(),
        };

        let permissions_error =
            prepare_write(&catalog, &environment, input()).expect_err("unsafe permissions");
        assert_eq!(
            permissions_error.code(),
            crate::error::AppErrorCode::PermissionDenied
        );

        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("safe mode");
        let include_error =
            prepare_write(&catalog, &environment, input()).expect_err("unsafe include");
        assert_eq!(
            include_error.code(),
            crate::error::AppErrorCode::ValidationFailed
        );
        assert!(!home.join(".ssh/id_fixture").exists());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
