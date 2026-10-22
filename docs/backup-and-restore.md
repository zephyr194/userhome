# Backup and restore

**用途：**说明受管配置的备份位置、保护、保留和清理，以及当前没有应用内恢复入口时的手动取回步骤，供使用者及配置链路维护者查阅。
随备份/恢复实现变化更新；只读应用定义不因此获得备份或写入权限，测试仍须使用临时夹具。

UserHome keeps a copy of a file's previous bytes before an authorized write
replaces that file, and before a launchd plist is adopted as a UserHome service.
Backups are stored beneath `~/Library/Application Support/UserHome/backups`
(`ConfigEnvironment::from_environment` in `src-tauri/src/config/mod.rs`) as
`<appId>/<configId>/<backupId>/`, each holding a `content` file and a
`metadata.json` file. The IDs are app-owned, never user-supplied paths.

## Producers

- Authorized resource writes create a backup of the current file before the
  atomic replacement (`replace` in `src-tauri/src/grants/write.rs`, `appId`
  `grants`). This covers the write entry points that use `ResourceWriteContext`
  (resources, services, Caddy, and AI configuration). If the backup cannot be
  created, the file is not changed. Creating a new file has no prior content and
  creates no backup.
- Service adoption stores the plist bytes before recording ownership
  (`src-tauri/src/services/adopt/flow.rs`, `appId` `services-adoption`). Adoption
  does not change the plist content and does not load or restart the job.

## Protection and retention

- The backup root and every created child directory are mode `0700`; the
  content and metadata files are mode `0600`.
- A symlinked or non-directory backup root is rejected. Every created child
  directory is canonicalized and must sit directly beneath its approved parent.
- `metadata.json` stores `backupId`, `appId`, `configId`, `createdAtEpochMs`,
  `contentHash` (SHA-256, lowercase hex), `sizeBytes`, and `mode` (decimal). It
  does not store the original path. Configuration contents are not copied into
  operation logs.
- Retention keeps the newest N recognized backups per configuration document
  (`configId`). N is a user preference with the presets 5, 10, or 20; the default
  is 20. Retention runs after each new backup and immediately when the preset is
  lowered. Unknown sibling data is ignored and never removed by retention.

## Settings page

The backup section of Settings → Configuration (`src/features/settings/BackupSettings.tsx`)
can:

- show the number and total size of UserHome backups and where they are stored
  (`get_backup_storage`);
- change the per-document retention preset (saved through `update_preferences`);
- clear backups: "清理所有备份…" opens a preview (`preview_clear_backups`), and
  confirming runs `execute_clear_backups` for that preview only. Only
  UserHome-owned backups are removed; managed configurations and preferences are
  unchanged.

Resetting preferences does not delete backups.

## Restore behavior

There is **no in-app restore**. The commands `preview_restore_backup`,
`execute_restore_backup`, and `list_config_backups` were removed together with
the generic configuration write entry point (FIN-2b, 2026-10-22). The only backup
commands registered in `src-tauri/src/lib.rs` are `get_backup_storage`,
`preview_clear_backups`, and `execute_clear_backups`. Nothing in the UI accepts a
`backupId` to restore a file.

The only automatic restore is internal. If a write is committed but post-write
validation fails, the write path puts back the exact previous bytes and
permissions from the backup it just took (`restore_backup_after_commit_failure`
in `src-tauri/src/config/atomic.rs`, called from `src-tauri/src/grants/write.rs`).
Users cannot trigger it.

## Manual recovery

Manual recovery bypasses UserHome's hash check, target policy, and validation.
Use it only when you know which file must be restored.

1. Stop whatever may write the target file (its editor or owning tool) first.
2. Locate the candidate backup at
   `~/Library/Application Support/UserHome/backups/<appId>/<configId>/<backupId>/`
   and read its `metadata.json`. Convert `createdAtEpochMs` to a date with
   `date -r $(( <ms> / 1000 ))` to match it against what you expect.
   The metadata does not name the target. The `configId` is a hash, so you must
   confirm the target from other evidence:
   - `services-adoption`: the ID is derived from the launchd domain and label, so
     the target is the plist of the service you adopted; confirm it before use.
   - `grants`: the ID is a one-way hash of the grant and relative path, so the
     path cannot be recovered from the ID.
3. Verify the content: `shasum -a 256 "<backupDir>/content"` must equal
   `contentHash`. If it does not match, stop and do not restore.
4. Keep the current file: `cp -p "<target>" "<target>.before-manual-restore-$(date +%Y%m%d%H%M%S)"`.
5. Confirm with `ls -l "<target>"` that the target is a regular file. If it is a
   symlink, stop and resolve it manually, because `cp` would write through the link.
6. Restore the bytes and mode: `cp "<backupDir>/content" "<target>"`, then
   `chmod $(printf '%o' <mode>) "<target>"` (for example, mode 384 becomes 600).
7. Validate with the tool that owns the file (for a launchd plist,
   `plutil -lint "<target>"`). UserHome does not re-scan or reload automatically.
   Reloading a LaunchAgent has its own effects, so do it as a separate, deliberate step.

Cautions:

- Retention keeps only the newest N backups per document, so the backup you need
  may already be gone. Check the backup listing in the Settings page first.
- "清理所有备份" deletes every UserHome backup and cannot be undone.
- Do not copy untrusted files into the backup tree, and do not point tests at a
  real home directory. Backup, rollback, and retention tests use temporary fixture homes.
