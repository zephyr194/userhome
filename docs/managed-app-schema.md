# Managed application catalog extension

`src-tauri/src/catalog/catalog-v1.json` is the authorization source of truth.
Discovery evidence never grants write or execution authority by itself.

## Adding an application

1. Add a unique, stable `id`, `displayName`, description, and `iconKey`.
   Declare exactly one `coverageClass`:
   - `MANAGED_WRITABLE` for catalog-authorized readable and writable documents.
   - `MANAGED_READ_ONLY` for catalog-authorized bounded, redacted reads only.
   - `DETECTED_UNSUPPORTED` for metadata-only detection without content access.
   - `EXCLUDED` for credentials, keys, caches, logs, databases, sockets, stores,
     lock files, and runtime state.
2. Add `presentation.category` as bounded display text. Reuse `iconKey` for
   icons; do not add application-specific frontend branches for presentation.
3. Add only bounded detection rules:
   - `HOME_PATH` must remain below the current user's home.
   - `HOMEBREW_PATH` must remain below `/opt/homebrew` or `/usr/local`.
   - `EXECUTABLE`, `BREW_FORMULA`, and `SERVICE` values are identifiers, not
     paths or command fragments.
4. Declare only executable/package/service identifiers already implemented by
   typed Rust enums. A catalog entry must not introduce arbitrary commands,
   arguments, environments, launchd labels, or paths.
5. For every `configDocument`, define a unique `configId`, bounded `purpose`,
   approved ordered `pathVariants`, known `format` and `formatFamily`,
   `sensitivity`, least-privilege `accessMode`, approved `adapterId`,
   `validatorId`, `editorKey`, finite `maxSizeBytes`, and `writePolicy`.
   `editorKey` is document-level rendering metadata and must not be inferred
   from `appId`; reuse an existing generic or adapter-backed renderer where
   possible.
6. Mark credentials, tokens, endpoints containing credentials, and similar
   content as `SECRET`; mark identity and host configuration as `SENSITIVE`.
7. Add or reuse a parser and validator before enabling writes. A new parser,
   validator, writable path, executable mapping, service mutation, or
   `elevationResourceId` requires explicit security review and approval.
8. Add fixture-based catalog, discovery, read, validation, diff, backup, write,
   restore, and redaction coverage as applicable. Fixtures must use temporary
   homes and must not read live user files.

## Configuration document contract

Each path variant has a stable kebab-case `variantId`, one typed `root`, a
root-relative `relativePath`, an `existenceRule`, and a zero-based
`precedence`. Array order and precedence must agree, at most eight variants are
accepted, and every path component must be normal: absolute paths, `.`/`..`,
backslashes, NUL bytes, and empty segments fail validation.

| Root | Meaning | Safe display form |
|---|---|---|
| `HOME` | Current user's home | `~/relative/path` |
| `XDG_CONFIG_HOME` | Effective XDG config root | `XDG_CONFIG_HOME/relative/path` |
| `APPLICATION_SUPPORT` | `~/Library/Application Support` | `APPLICATION_SUPPORT/relative/path` |
| `HOMEBREW_PREFIX` | Trusted Apple Silicon or Intel Homebrew prefix | `HOMEBREW_PREFIX/relative/path` |
| `APP_SUPPORT` | UserHome-owned Application Support root | `APP_SUPPORT/relative/path` |

`existenceRule` is one of `FILE`, `DIRECTORY`, or `FILE_OR_DIRECTORY`. It
controls variant selection only; it never expands the authorized root or grants
content access. Schema version 1 retains `pathTemplate` as a compatibility
anchor for existing readers. The first variant must resolve to the same legacy
template, so a migration cannot silently change an existing authorized path.

`format` identifies the concrete syntax used by an adapter. `formatFamily`
provides reusable capability classification and must agree with that concrete
format:

| Format family | Recognized concrete formats |
|---|---|
| `JSON` / `JSONC` | `JSON`, `JSONC` |
| `TOML` | `TOML` |
| `YAML` | `YAML` |
| `INI` / `GIT_CONFIG` | `INI`, `GIT_CONFIG` |
| `KEY_VALUE` | `KEY_VALUE` |
| `PLIST` | `PLIST` |
| `COMMAND` | `CADDYFILE`, `SHELL`, `SSH_CONFIG` |
| `PLAIN_TEXT` | `TEXT`, `MARKDOWN`, `MARKDOWN_DIRECTORY` |

Recognizing a format does not authorize writes. `accessMode` and `writePolicy`
must agree: current managed documents use `READ_WRITE` with an approved
writable policy or `READ_ONLY` with `READ_ONLY`. `METADATA_ONLY` and `EXCLUDED`
are reserved typed modes and fail closed until a runtime document contract
supports them. Writable adapters accept only their compiled concrete formats;
the generic `read-only-text` adapter may classify any recognized family without
gaining write authority. Command-oriented formats never gain generic write
authority.

The validated catalog is immutable. An unknown root, existence rule, format,
format family, sensitivity, access mode, adapter, validator, editor, or write
policy rejects only the candidate parse; an already loaded valid `Catalog`
value remains usable.

## Current bounded read-only batch

The T41 batch adds six locally relevant definitions. Every detection rule is an
exact `HOME_PATH`; discovery performs ten bounded metadata checks and does
not scan the home directory. These definitions declare no executable,
Homebrew, service, elevation, or write authority. Every document uses the
generic `read-only-text` adapter, `text` validator, a finite size limit, and
`READ_ONLY`.

| App ID | Detection and path variants | Sensitivity | Format | Presentation | Coverage |
|---|---|---|---|---|---|
| `visual-studio-code` | `~/Library/Application Support/Code/User/settings.json`; `~/Library/Application Support/Code - Insiders/User/settings.json` | `SENSITIVE` | `JSON` | `visual-studio-code`, 编辑器 | `MANAGED_READ_ONLY` |
| `cursor` | `~/Library/Application Support/Cursor/User/settings.json` | `SENSITIVE` | `JSON` | `cursor`, 编辑器 | `MANAGED_READ_ONLY` |
| `ghostty` | `~/Library/Application Support/com.mitchellh.ghostty/config`; `~/.config/ghostty/config` | `SENSITIVE` | `TEXT` | `ghostty`, 终端 | `MANAGED_READ_ONLY` |
| `starship` | `~/.config/starship.toml` | `SENSITIVE` | `TEXT` | `starship`, Shell | `MANAGED_READ_ONLY` |
| `tmux` | `~/.tmux.conf`; `~/.config/tmux/tmux.conf` | `SENSITIVE` | `TEXT` | `tmux`, 终端 | `MANAGED_READ_ONLY` |
| `vim` | `~/.vimrc`; `~/.vim/vimrc` | `SENSITIVE` | `TEXT` | `vim`, 编辑器 | `MANAGED_READ_ONLY` |

`TEXT` describes a generic UTF-8 text document; it does not imply a
format-specific parser or validator. `SENSITIVE` content is returned only
through the generic line-oriented secret redaction path. Known credential,
token, key, history, cache, log, database, socket, and runtime-state paths
remain outside this batch.

## Runtime presentation and authorization

The Applications workspace renders catalog entries from `iconKey`,
`presentation.category`, `coverageClass`, and sanitized document metadata. The
catalog IPC may expose typed root aliases and normalized relative paths, but it
does not expose absolute filesystem paths. The current catalog contains 12
definitions: six `MANAGED_WRITABLE` baseline applications and the six
`MANAGED_READ_ONLY` definitions above. Search, category, and coverage filters
do not change authorization.

Runtime behavior is fail-closed:

- `MANAGED_WRITABLE` shows mutation controls only when the application also has
  `WRITE_CONFIG`, the selected document is not `READ_ONLY`, and a current
  content hash is available. Every mutation still requires a preview and
  explicit confirmation.
- `MANAGED_READ_ONLY` may return only bounded, validated, redacted text through
  its approved adapter. It never exposes preview, write, backup, restore,
  service, or elevation actions.
- `DETECTED_UNSUPPORTED` exposes detection/classification metadata only. It does
  not authorize `listConfigs`, content reads, or management actions.
- `EXCLUDED` is assigned before content access for credentials, keys, caches,
  logs, databases, sockets, stores, and runtime state. The UI may show only the
  safe candidate name, entry type, coverage class, and modification time; it
  provides no open, read, edit, backup, restore, service, or elevation action.

Discovery evidence and UI selection never promote an entry to a broader
coverage class. Authorization continues to come only from the validated
built-in Rust catalog.

## Compatibility rules

- Increment `schemaVersion` only for additive schema changes.
- Schema version 1 definitions that omit the additive coverage fields migrate
  deterministically: `WRITE_CONFIG` implies `MANAGED_WRITABLE`, otherwise
  `READ_CONFIG` implies `MANAGED_READ_ONLY`, and other definitions imply
  `DETECTED_UNSUPPORTED`. Missing `presentation.category` becomes `Other`, and
  missing document `editorKey` uses `adapterId`. Missing `purpose`,
  `formatFamily`, or `accessMode` is inferred from the stable legacy fields.
  Missing `pathVariants` keeps the validated legacy `pathTemplate`.
- Never repurpose an existing app, config, adapter, validator, service, or
  elevation resource ID.
- Unknown fields and unsafe definitions must fail catalog validation.
- Unknown dot-directories remain metadata-only and read-only.
- Apple Silicon and Intel Homebrew prefixes must remain explicit and bounded.
- Frontend IPC never sends absolute filesystem or executable paths.
- Catalog summaries may expose `coverageClass`, `presentation.category`,
  normalized root-relative variants, format capability, sensitivity,
  `accessMode`, size limits, and per-document `configId`/`editorKey`; they must
  not expose legacy path templates, executable mappings, validators, adapters,
  or write policies.

## Review checklist

- [ ] IDs are unique and stable.
- [ ] Coverage class agrees with read/write capabilities and does not grant
      authority by itself.
- [ ] Category and editor keys are sufficient for data-first rendering without
      an `appId` branch.
- [ ] Paths resolve under an approved root and symlink escape is rejected.
- [ ] Variant order and precedence agree and no relative path contains unsafe
      components.
- [ ] Concrete format and format family agree without implying write access.
- [ ] File size and output limits are finite.
- [ ] Sensitivity and redaction behavior are documented.
- [ ] Write policy is no broader than required.
- [ ] Parser and validator reject malformed input before replacement.
- [ ] Any service or elevated action maps to a compiled allowlist.
- [ ] Tests use temporary fixtures and leave live configuration untouched.
- [ ] `DETECTED_UNSUPPORTED` and `EXCLUDED` entries remain metadata-only in the
      UI and IPC responses.
