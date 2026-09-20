#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use uuid::Uuid;

    use crate::config::{
        ConfigEnvironment,
        backup::{create_backup, list_backups},
    };

    struct Fixture {
        root: PathBuf,
        environment: ConfigEnvironment,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("userhome-retention-{}", Uuid::new_v4()));
            let home = root.join("home");
            let brew = root.join("brew");
            fs::create_dir_all(&home).expect("create home");
            fs::create_dir_all(&brew).expect("create brew");
            let environment =
                ConfigEnvironment::new(home.clone(), brew, home.join(".userhome/backups"));
            Self { root, environment }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn retention_keeps_only_the_newest_twenty_owned_backups() {
        let fixture = Fixture::new();
        let foreign = fixture.environment.backup_root().join("foreign-data");
        fs::create_dir_all(&foreign).expect("create foreign data");
        fs::write(foreign.join("keep"), b"not owned").expect("write foreign data");

        for index in 0..23 {
            create_backup(
                &fixture.environment,
                "git",
                "git-global-config",
                format!("version-{index}").as_bytes(),
                0o600,
            )
            .expect("create backup");
            std::thread::sleep(std::time::Duration::from_millis(2));
        }

        let backups =
            list_backups(&fixture.environment, "git", "git-global-config").expect("list backups");
        assert_eq!(backups.len(), 20);
        assert!(foreign.join("keep").exists());
    }
}
