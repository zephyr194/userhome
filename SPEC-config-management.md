# Spec: config-management

Status: Approved on 2026-09-20

## Objective

Safely read, display, validate, diff, back up, write, and restore catalog-owned
configuration without losing comments, unrelated settings, permissions, or
safe symlinks.

## Editing Modes

- `structured`: form fields for explicitly supported settings.
- `raw`: advanced text editor for a catalog-owned document.
- `managed-block`: UserHome owns a marked section while preserving surrounding
  content.
- `read-only`: sensitive or unsupported documents shown as metadata only.

## Initial Adapter Behavior

| App | Structured behavior | Raw behavior |
|---|---|---|
| GitHub Copilot | Schema-backed safe fields in supported JSON files; secret-looking fields masked | JSON/instruction files only; databases, logs, sessions, runtime tokens, caches, and lock files excluded |
| Caddy | Common site/listener/reverse-proxy fields | Full Caddyfile with `caddy validate` before replacement |
| Git | Name, email, default branch, selected aliases and safe global settings | Advanced `.gitconfig` view with parser-preserving write |
| OpenSSH | Managed Host entries excluding private-key material | `~/.ssh/config` with syntax and permission checks |
| Zsh | UserHome-managed aliases, environment entries, and sourced snippets | `.zshrc` with managed-block preservation |
| npm | Registry, proxy, strict SSL, and selected user settings; auth values masked | `.npmrc` with secret redaction and replacement-only secret inputs |

Schema fields must be confirmed against the installed application's supported
configuration before implementation. Unsupported keys stay raw and are not
invented.

The approved Copilot user documents are `config.json`, `settings.json`,
`mcp-config.json`, `permissions-config.json`, and
`copilot-instructions.md`. Runtime databases, logs, sessions, caches, lock
files, and token stores are not catalog entries.

Sensitive raw editors use `[REDACTED]` placeholders. Rust restores unchanged
placeholder values from the current file immediately before validation;
plaintext npm authentication changes are accepted only through the write-only
replacement field and are never returned in document, diff, or operation
payloads.

Caddy validation executes only `caddy validate --config <temporary-file>
--adapter caddyfile` using the catalog environment's Homebrew executable.
OpenSSH validation parses only `~/.ssh/config`, checks restrictive target
permissions, and validates safe in-scope `Include` syntax without opening
included files or private keys. Zsh syntax validation runs `/bin/zsh -n` on a
temporary copy and structured edits replace only the uniquely delimited
UserHome block.

## Write Workflow

1. Resolve app ID and config ID through the catalog.
2. Resolve and authorize the canonical target.
3. Read metadata and calculate the current content hash.
4. Parse user input and validate size, encoding, schema, and application syntax.
5. Generate a diff and `OperationPreview`.
6. On confirmation, verify the target hash has not changed.
7. Create a protected backup.
8. Write to a temporary file, preserve permissions, flush, and replace
   atomically.
9. Re-read and revalidate.
10. If post-write validation fails, restore the backup and report failure.

## Interfaces

```text
list_configs(appId) -> ConfigSummary[]
read_config(appId, configId) -> ConfigDocument
validate_config(input) -> ValidationResult
preview_config_write(input) -> OperationPreview
execute_config_write(operationId) -> OperationDetails
list_config_backups(appId, configId) -> BackupSummary[]
preview_restore_backup(input) -> OperationPreview
execute_restore_backup(operationId) -> OperationDetails
```

## Acceptance Criteria

- Editing one structured field preserves all unrelated settings.
- Raw edits show a diff and cannot bypass validation or path policy.
- A concurrent external edit causes `CONFLICT`; UserHome does not overwrite it.
- Invalid Caddy, JSON, Git, SSH, Zsh managed-block, or npm configuration is
  rejected before replacement.
- Backups can restore the exact previous bytes and permissions.
- Secret values are masked and absent from logs, events, previews, and errors.
- The baseline Caddyfile symlink remains a symlink after a successful update.

## Boundaries

- Always: hash before preview and recheck before write.
- Ask first: introduce a new parser or editable document.
- Never: expose private keys, runtime tokens, databases, or arbitrary paths.
