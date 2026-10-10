# Spec: configuration-platform

Status: Approved on 2026-09-21

## Objective

Replace application-by-application configuration handling with a reusable,
typed platform that can represent common macOS, XDG, shell, editor, CLI, and
developer-tool configuration patterns without weakening filesystem safety.

The platform must explain configuration errors precisely and fail closed when a
format, path, sensitivity rule, or write policy is not reliable.

## Path Model

Supported root aliases:

```text
HOME
XDG_CONFIG_HOME
APPLICATION_SUPPORT
HOMEBREW_PREFIX
APP_SUPPORT
```

A document may declare ordered path variants for product channel, version, or
platform convention. Variants include an existence rule and precedence but do
not grant broader access.

Examples:

```text
Visual Studio Code:
  APPLICATION_SUPPORT/Code/User/settings.json
  APPLICATION_SUPPORT/Code - Insiders/User/settings.json

Ghostty:
  APPLICATION_SUPPORT/com.mitchellh.ghostty/config
  XDG_CONFIG_HOME/ghostty/config
```

Absolute user-specific paths and frontend-supplied paths remain prohibited.

## Format Families

The platform recognizes these families:

- JSON and JSONC.
- TOML.
- YAML.
- INI and Git-config-style sections.
- properties and dotenv-style key/value text.
- plist where safe platform APIs can parse it.
- shell, Vimscript, and command-oriented text.
- plain UTF-8 text.

Recognition is not write authority:

- Structured write requires a format-specific parser, round-trip strategy,
  validator, sensitivity policy, and fixture evidence.
- Bounded read-only may use a safe parser or format-specific redactor.
- Sensitive command-oriented or unparseable text returns metadata only.
- Binary, database, encrypted, credential, cache, log, socket, and runtime
  formats are excluded.

## Document State and Diagnostics

Every configured document returns one explicit state:

```text
MISSING
READY
INVALID
REDACTED
TOO_LARGE
PERMISSION_DENIED
UNSAFE_SYMLINK
UNSUPPORTED_FORMAT
IO_ERROR
```

Diagnostics identify the document, safe display path, state, retryability, and
next action. They never expose secret values, raw content, stack traces, or
absolute private paths.

## Adapter Architecture

- Adapter selection is driven by `adapterId`, `validatorId`, `editorKey`, and
  format capabilities.
- Generic adapters serve reusable format families; application-specific
  adapters exist only for semantic behavior that cannot be represented by the
  generic contract.
- Frontend renderers dispatch by capability and `editorKey`, never by `appId`.
- Unknown adapter, validator, root alias, format, or policy fails catalog
  loading rather than falling back to unsafe behavior.

## Read, Write, Backup, and Restore

- Reads enforce canonical path policy, finite size, encoding, sensitivity, and
  redaction before returning content.
- Writes require a current content hash, preview, validation, explicit
  confirmation, backup, permission preservation, flush, and atomic replacement.
- Symlink writes preserve the link and validate its resolved target.
- Backup retention is controlled by `application-settings` and applies only
  under the app-owned backup root.
- Restore uses the same preview, validation, path, and confirmation rules as a
  normal write.
- One malformed document does not prevent other documents or applications from
  loading.

## Interfaces and Dependencies

```text
resolve_config_variants(appId, configId) -> ResolvedConfigDocument[]
read_config(appId, configId, variantId?) -> ConfigDocument
diagnose_config(appId, configId, variantId?) -> ConfigDiagnostic
preview_config_write(...) -> OperationPreview
apply_config_write(operationId) -> OperationResult
list_backups(appId, configId) -> BackupSummary[]
preview_restore(...) -> OperationPreview
```

The module consumes the baseline path and format requirements from
`home-baseline-inventory`. It provides the capabilities used by
`catalog-expansion` and `application-settings`.

## Tech Stack and Project Structure

```text
src-tauri/src/config/             document service and adapters
src-tauri/src/config/formats/     reusable format-family handling
src-tauri/src/security/           path and redaction policy
src-tauri/src/catalog/            schema and capability validation
src/features/apps/editors/        capability-driven editors and viewers
src/ipc/config.ts                 typed configuration IPC
```

Prefer existing Rust crates already in the lockfile. Adding a parser dependency
requires explicit approval and supply-chain review.

## Code Style

Use typed outcomes rather than boolean support checks:

```rust
enum DocumentAccess {
    Writable(ValidatedDocument),
    ReadOnly(RedactedDocument),
    MetadataOnly(ConfigDiagnostic),
    Excluded(ExclusionReason),
}
```

Do not catch parse or I/O failures and return an empty or apparently successful
document.

## Commands and Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e
```

No new test files are created without explicit approval. Existing fixture and
integration suites are extended only when separately approved.

## Acceptance Criteria

- A catalog document can declare multiple bounded path variants without custom
  discovery or frontend branches.
- Common JSON/JSONC, TOML, YAML, INI, key/value, and plain-text documents can be
  classified through shared format capabilities.
- Every failed read has one explicit diagnostic state and a safe next action.
- Invalid or partially parsed data never appears as a successful empty config.
- Sensitive unparseable text never returns content.
- One broken application config does not block catalog loading or unrelated
  documents.
- Every write and restore remains previewed, validated, backed up, confirmed,
  and atomic.
- Adding a data-only read-only definition requires no Rust or React branch when
  its root alias, format, redactor, and viewer already exist.

## Boundaries

### Always

- Fail closed on unknown formats, roots, adapters, validators, sensitivity, and
  write policies.
- Preserve unknown keys and unmanaged sections when structured writes are
  supported.
- Return typed diagnostics instead of silent defaults.

### Ask first

- Add parser dependencies, writable format families, root aliases, backup
  deletion behavior, or privileged targets.

### Never

- Use a generic write adapter for command-oriented configuration.
- Return sensitive raw text when reliable redaction is unavailable.
- Accept arbitrary paths or adapter identifiers from the frontend.

## Open Questions

None. Format support expands only after its safety contract is implemented.
