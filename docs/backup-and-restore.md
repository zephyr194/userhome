# Backup and restore

**用途：**说明受管配置的备份位置、保护、保留和恢复行为，供使用者及配置链路维护者查阅。
随备份/恢复实现变化更新；只读应用定义不因此获得备份或写入权限，测试仍须使用临时夹具。

UserHome creates a backup immediately before each authorized configuration
replacement. The backup root is `~/Library/Application Support/UserHome/backups`
(`ConfigEnvironment::from_environment` in `src-tauri/src/config/mod.rs`). Each
backup is stored as `<appId>/<configId>/<backupId>/` beneath that root, with a
content file and a `metadata.json` file. The IDs are catalog-owned, never
user-supplied paths.

## Protection and retention

- The backup root and every created child directory are mode `0700`; the
  content and metadata files are mode `0600`.
- A symlinked or non-directory backup root is rejected. Every created child
  directory is canonicalized and must sit directly beneath its approved parent.
- Each record stores exact bytes, SHA-256 hash, original mode, size, IDs, and
  creation time. Configuration contents are not copied into operation logs.
- Retention keeps the newest N recognized backups per configuration document.
  N is a user preference with the presets 5, 10, or 20; the default is 20.
  Unknown sibling data is ignored and never removed by retention cleanup.

## Restore behavior

Restore accepts only an app-owned `backupId`, never a path. Before preview,
UserHome verifies the current document hash, backup metadata, size limit, file
type, content hash, UTF-8 requirement, catalog validator, and target policy.

Execution rechecks the preview intent and current hash, creates a fresh backup
of the current file, performs an atomic replacement, preserves the approved
target mode and logical symlink, and validates the result. A failed
post-write validation restores the exact previous bytes and permissions.

Automated backup and restore tests use temporary fixture homes. Operators should
not point tests at a real home directory or manually copy untrusted files into
the backup tree.
