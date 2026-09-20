# Backup and restore

UserHome creates a backup immediately before each authorized configuration
replacement. Backups live under `~/.userhome/backups/<appId>/<configId>/` and
are scoped to catalog-owned application and configuration IDs.

## Protection and retention

- Backup directories are created with mode `0700`; content and metadata files
  are mode `0600`.
- Symlinked or non-directory backup roots are rejected, and every created child
  directory is canonicalized beneath the approved backup root.
- Each record stores exact bytes, SHA-256 hash, original mode, size, IDs, and
  creation time. Configuration contents are not copied into operation logs.
- Only the newest 20 recognized backups per document are retained. Unknown
  sibling data is ignored and never removed by retention cleanup.

## Restore behavior

Restore accepts only an app-owned `backupId`, never a path. Before preview,
UserHome verifies the current document hash, backup metadata, size limit, file
type, content hash, UTF-8 requirement, catalog validator, target policy, and
elevation requirement.

Execution rechecks the preview intent and current hash, creates a fresh backup
of the current file, performs an atomic replacement, preserves the approved
target mode and logical symlink, and validates the result. A failed
post-write validation restores the exact previous bytes and permissions.

Automated backup and restore tests use temporary fixture homes. Operators should
not point tests at a real home directory or manually copy untrusted files into
the backup tree.
