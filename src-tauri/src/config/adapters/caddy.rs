use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::AppError;

use super::AdapterView;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CaddyFields {
    site_address: Option<String>,
    reverse_proxy: Option<String>,
}

pub fn inspect(content: &str) -> Result<AdapterView, AppError> {
    let (site_address, reverse_proxy) = common_fields(content);
    Ok(AdapterView {
        content: Some(content.to_owned()),
        content_redacted: false,
        structured: Some(json!({
            "siteAddress": site_address,
            "reverseProxy": reverse_proxy
        })),
    })
}

pub fn prepare_structured(current: &str, fields: Value) -> Result<String, AppError> {
    let fields: CaddyFields = serde_json::from_value(fields)
        .map_err(|_| AppError::invalid_input("Caddy settings are invalid."))?;
    let mut lines = current.lines().map(str::to_owned).collect::<Vec<_>>();
    let (start, end) = first_site_range(&lines)
        .ok_or_else(|| AppError::validation_failed("No editable Caddy site block was found."))?;

    if let Some(address) = fields.site_address {
        validate_atom(&address, "Caddy site address")?;
        let indent = lines[start]
            .chars()
            .take_while(|character| character.is_whitespace())
            .collect::<String>();
        lines[start] = format!("{indent}{address} {{");
    }
    if let Some(upstream) = fields.reverse_proxy {
        validate_atom(&upstream, "Caddy reverse proxy")?;
        let existing =
            (start + 1..end).find(|index| lines[*index].trim_start().starts_with("reverse_proxy "));
        if let Some(index) = existing {
            let indent = lines[index]
                .chars()
                .take_while(|character| character.is_whitespace())
                .collect::<String>();
            lines[index] = format!("{indent}reverse_proxy {upstream}");
        } else if !upstream.is_empty() {
            lines.insert(end, format!("\treverse_proxy {upstream}"));
        }
    }
    let mut content = lines.join("\n");
    if current.ends_with('\n') {
        content.push('\n');
    }
    Ok(content)
}

fn common_fields(content: &str) -> (Option<String>, Option<String>) {
    let lines = content.lines().collect::<Vec<_>>();
    let Some((start, end)) = first_site_range_ref(&lines) else {
        return (None, None);
    };
    let address = lines[start]
        .trim()
        .strip_suffix('{')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let reverse_proxy = lines[start + 1..end].iter().find_map(|line| {
        line.trim()
            .strip_prefix("reverse_proxy ")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    });
    (address, reverse_proxy)
}

fn first_site_range(lines: &[String]) -> Option<(usize, usize)> {
    let refs = lines.iter().map(String::as_str).collect::<Vec<_>>();
    first_site_range_ref(&refs)
}

fn first_site_range_ref(lines: &[&str]) -> Option<(usize, usize)> {
    let start = lines.iter().position(|line| {
        let line = line.trim();
        !line.is_empty() && line != "{" && !line.starts_with('#') && line.ends_with('{')
    })?;
    let mut depth = 0_i32;
    for (index, line) in lines.iter().enumerate().skip(start) {
        depth += line.matches('{').count() as i32;
        depth -= line.matches('}').count() as i32;
        if depth == 0 {
            return Some((start, index));
        }
    }
    None
}

fn validate_atom(value: &str, label: &str) -> Result<(), AppError> {
    if value.len() > 512 || value.contains(['\n', '\r', '\0', '{', '}']) || value.trim() != value {
        return Err(AppError::validation_failed(&format!("{label} is invalid.")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
        path::PathBuf,
    };

    use serde_json::json;
    use uuid::Uuid;

    use crate::{
        catalog::load_builtin_catalog,
        config::{
            ConfigEnvironment,
            read::hash_bytes,
            write::{ConfigWriteInput, execute_write, prepare_write},
        },
        settings::BackupRetention,
    };

    use super::*;

    struct Fixture {
        root: PathBuf,
        environment: ConfigEnvironment,
        logical: PathBuf,
        target: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-caddy-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            let target = brew.join("managed/Caddyfile");
            let logical = brew.join("etc/Caddyfile");
            fs::create_dir_all(&home).expect("home");
            fs::create_dir_all(brew.join("bin")).expect("bin");
            fs::create_dir_all(brew.join("etc")).expect("etc");
            fs::create_dir_all(brew.join("managed")).expect("managed");
            fs::write(&target, "example.test {\n\trespond \"before\"\n}\n").expect("target");
            symlink("../managed/Caddyfile", &logical).expect("symlink");
            let executable = brew.join("bin/caddy");
            fs::write(
                &executable,
                "#!/bin/sh\n[ \"$1\" = validate ] || exit 9\n[ \"$2\" = --config ] || exit 9\n[ \"$4\" = --adapter ] || exit 9\n[ \"$5\" = caddyfile ] || exit 9\ngrep -q INVALID \"$3\" && exit 1\nexit 0\n",
            )
            .expect("validator");
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o700))
                .expect("validator mode");
            let environment =
                ConfigEnvironment::new(home.clone(), brew, home.join(".userhome/backups"));
            Self {
                root,
                environment,
                logical,
                target,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn structured_edit_preserves_unsupported_sections() {
        let current = "# global\n{\n\tadmin off\n}\n\nexample.test {\n\tencode gzip\n\treverse_proxy localhost:3000\n}\n";
        let updated = prepare_structured(
            current,
            json!({"siteAddress":"new.test","reverseProxy":"localhost:4000"}),
        )
        .expect("update");
        assert!(updated.contains("# global\n{\n\tadmin off\n}"));
        assert!(updated.contains("new.test {"));
        assert!(updated.contains("\tencode gzip"));
        assert!(updated.contains("reverse_proxy localhost:4000"));
    }

    #[test]
    fn invalid_raw_content_is_rejected_before_replacement() {
        let fixture = Fixture::new();
        let current = fs::read(&fixture.target).expect("current");
        let error = prepare_write(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment,
            ConfigWriteInput {
                app_id: "caddy".to_owned(),
                config_id: "caddyfile".to_owned(),
                expected_hash: hash_bytes(&current),
                content: "INVALID".to_owned(),
            },
        )
        .expect_err("invalid content");
        assert_eq!(error.code(), crate::error::AppErrorCode::ValidationFailed);
        assert_eq!(fs::read(&fixture.target).expect("target"), current);
        assert!(!fixture.environment.backup_root().exists());
    }

    #[test]
    fn validated_write_preserves_caddyfile_symlink() {
        let fixture = Fixture::new();
        let current = fs::read(&fixture.target).expect("current");
        let catalog = load_builtin_catalog().expect("catalog");
        let (mutation, _) = prepare_write(
            &catalog,
            &fixture.environment,
            ConfigWriteInput {
                app_id: "caddy".to_owned(),
                config_id: "caddyfile".to_owned(),
                expected_hash: hash_bytes(&current),
                content: "example.test {\n\trespond \"after\"\n}\n".to_owned(),
            },
        )
        .expect("prepare");
        execute_write(
            &catalog,
            &fixture.environment,
            &mutation,
            BackupRetention::TWENTY,
        )
        .expect("write");
        assert!(fixture.logical.is_symlink());
        assert_eq!(
            fs::read_to_string(&fixture.target).expect("target"),
            "example.test {\n\trespond \"after\"\n}\n"
        );
    }

    #[test]
    fn protected_caddyfile_is_marked_for_the_allowlisted_helper() {
        let fixture = Fixture::new();
        fs::set_permissions(&fixture.target, fs::Permissions::from_mode(0o444))
            .expect("protected mode");
        let current = fs::read(&fixture.target).expect("current");
        let (mutation, _) = prepare_write(
            &load_builtin_catalog().expect("catalog"),
            &fixture.environment,
            ConfigWriteInput {
                app_id: "caddy".to_owned(),
                config_id: "caddyfile".to_owned(),
                expected_hash: hash_bytes(&current),
                content: "example.test {\n\trespond \"after\"\n}\n".to_owned(),
            },
        )
        .expect("prepare");
        assert_eq!(
            mutation.elevation_resource_id.as_deref(),
            Some(crate::security::elevation_protocol::CADDY_CONFIG_RESOURCE_ID)
        );
        assert_eq!(fs::read(&fixture.target).expect("unchanged"), current);
    }
}
