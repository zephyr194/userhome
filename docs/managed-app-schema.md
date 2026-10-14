# Managed application catalog extension

**用途：**旧受管 Catalog、配置 Schema/预设及读写授权的维护契约，供集成与编辑链路维护者使用。
契约随实现变化更新，带日期的来源和批次记录保留为历史证据。新只读入口的独立定义
见 [application-profiles.md](application-profiles.md)，其资源 ID 和排除规则不扩展旧 Catalog 权限。

`src-tauri/src/catalog/catalog-v2.json` is the packaged runtime authorization
source of truth. It is generated deterministically from the reviewed v1
managed definitions and the detection-only offline corpus.
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

## Versioned schema, preset, and source contracts

Structured configuration metadata is packaged in three independent files:

- `schemas-v1.json` declares `formatVersion: 1` and schema definitions.
- `presets-v1.json` declares `formatVersion: 1` and preset definitions.
- `sources-v1.json` declares `formatVersion: 1`, official authorities, and
  normalized provenance.

`load_builtin_catalog` validates the application catalog, sources, schemas,
and presets before returning the existing `Catalog` value. Dedicated loaders
are also available for consumers that need the typed source, schema, or preset
catalog. The files may evolve independently: a supported version in one file
never implies compatibility with another. Unknown fields, file versions,
enum values, merge strategies, field IDs, schema versions, aliases, or
cross-file references fail closed.

Empty versioned collections remain valid and grant no structured editor or
preset capability. The packaged v1 files now contain the reviewed initial-six
migration described below; every definition is still rejected as a unit if
its catalog binding, source, schema, or preset contract becomes invalid.

### Schema v1

Every schema has a stable kebab-case `schemaId`, positive `schemaVersion`, an
existing `appId` and `configId`, the exact required `adapterId` and
`validatorId`, bounded applicability, approved source references, and between
one and 64 ordered fields. A schema cannot add a path, adapter, validator,
service, executable, write policy, or elevation resource.

Fields use stable kebab-case `fieldId` values and a format-semantic
`semanticKey`; the key is never a filesystem path. `order` must equal array
order. Schema v1 supports only these `fieldType.kind` values:

| Kind | Required bounded contract |
|---|---|
| `BOOLEAN` | Optional boolean `default_value` |
| `STRING` | `minimum_length`, `maximum_length`, optional bounded pattern metadata, and optional in-range `default_value` |
| `INTEGER` | Inclusive `minimum` and `maximum`, plus optional in-range `default_value` |
| `ENUM` | One to 64 unique value/label options and an optional listed `default_value` |
| `STRING_LIST` | Bounded `maximum_items` and `maximum_item_length`, plus an optional conforming `default_value` |
| `SECRET` | `replacement_only: true`; no default field exists in the serialized variant |

Non-secret fields use `READ_WRITE`; `SECRET` fields must use sensitivity
`SECRET`, read policy `OMITTED`, write policy `REPLACEMENT_ONLY`, and typed
unchanged-redacted restoration. A secret default is rejected as an unknown
field. Every schema and field source must resolve to an approved source whose
scope includes `FIELD_SCHEMA`.

### Preset v1

At most 32 preset definitions, including retained versions, may target one
catalog document. Each preset has a stable kebab-case `presetId`, positive
`presetVersion`, a bounded compatible schema-version range, applicability,
approved `PRESET` sources, explicit field IDs, typed values, and one exact
kind/target/merge combination:

| Kind | Target | Merge strategy | Values |
|---|---|---|---|
| `COMPLETE_TEMPLATE` | `NEW_FILE_ONLY` | `REPLACE_SCHEMA_PROJECTION` | Exactly every non-secret schema field |
| `FIELD_GROUP` | `EXISTING_OR_NEW` | `NO_VALUES` | None |
| `RECOMMENDED_VALUES` | `EXISTING_OR_NEW` | `MERGE_DECLARED_FIELDS` | Exactly the declared subset |

Preset values are typed boolean, string, integer, enum, or string-list
literals and must satisfy every compatible schema version. There is no secret
literal variant, so a complete template omits secret fields and recommended
values cannot carry credentials. Every version named by a compatibility range
must be packaged; missing, ambiguous, or unknown fields and versions reject the
whole preset without partial application.

Aliases retain explicit deprecation metadata. An alias must remain through at
least two subsequent preset versions and declare at least 180 retention days;
it cannot collide with a canonical preset ID or another alias. Complete
templates are data for new files only and do not authorize creation or
replacement by themselves.

### Official source provenance v1

`sources-v1.json` groups official DNS domains and GitHub repository owners
under stable authorities. Every source references one authority and contains:

- a stable kebab-case `sourceId`, typed official source kind, and project;
- a canonical lowercase `https://` URL without credentials, ports, query, or
  fragment;
- either an immutable commit/tag/release revision or a lowercase SHA-256
  content digest;
- strict UTC `verifiedAt` metadata;
- typed license and review status;
- bounded factual scopes.

GitHub URLs must contain both owner and repository, and the owner must appear
in the referenced authority. Other URLs must use the authority's exact domain
or a subdomain. Normalization defaults to and only supports `FACTS_ONLY`.
Approved schema and preset references cannot point to `NEEDS_REVIEW` or
`REJECTED` sources.

A source becomes stale when its verification age reaches 90 days. Staleness is
metadata for maintenance and review; it does not fetch the network, rewrite
the packaged corpus, or convert a source into runtime authority. Source scopes
contain no filesystem path, adapter, validator, command, service, elevation,
access-mode, merge, or write-policy fields. Because every persisted source
structure denies unknown fields, provenance cannot authorize paths or writes.

### Schema and preset runtime flow

`get_config_schema` is the only frontend presentation boundary for packaged
schemas and presets. It returns `READY`, `UNAVAILABLE`, or `DISABLED`:

- `READY` binds one exact schema ID and version to the catalog document's
  existing adapter and validator. The presentation contains at most 64 ordered
  fields and 32 compatible presets.
- `UNAVAILABLE` means no approved packaged schema exists. Only this state may
  use the existing adapter-specific editor as a bounded compatibility
  fallback.
- `DISABLED` covers invalid catalogs, version or capability mismatches,
  incompatible current values, unsafe secret policy, and unavailable
  documents. It never falls back to another structured editor.

Every `READY` presentation is bound to the exact `variantId` returned by the
configuration read. The typed write request carries that variant through the
preview and pending-operation state. Execution resolves the same catalog
variant again and compares its authorized target with the preview target.
Missing documents require an explicit variant; the legacy first-path resolver
is never used as an implicit creation target.

Applicability is evaluated identically for presentation and preview. Variant
constraints must include the selected variant, and platform constraints must
include macOS. Application version and feature-flag constraints fail closed
because the configuration runtime has no trusted source for those values.
Preset applicability is evaluated before any values are presented and again
before a complete template is accepted. Pattern-constrained strings also fail
closed until a reviewed Rust pattern matcher is available; pattern metadata is
never silently ignored.

Secret field presentations contain only the `REPLACEMENT_ONLY` state. They do
not contain a current value, default value, preset literal, or diff literal.
The frontend decoder independently validates field and preset bounds,
discriminated value kinds, field references, and secret invariants before
rendering controls.

The generic editor sends typed field patches to
`preview_schema_config_write`. Preset selection only changes the in-memory
frontend draft:

- `FIELD_GROUP` changes the visible field set and no values.
- `RECOMMENDED_VALUES` merges approved non-secret values into the draft.
- `COMPLETE_TEMPLATE` replaces the draft with the exact approved values and is
  available only when the document is missing. Any later manual change removes
  the complete-template selection.

The backend revalidates the schema ID and version, catalog binding, field
types and complete value constraints, preset compatibility, and exact
complete-template value set before adapter-specific conversion. Current
values, preset literals, and patches share the same bounded validator for
string length, integer range, enum membership, string-list item/count limits,
and replacement-only secrets.

Existing files continue through fresh hash validation, preview, explicit
confirmation, protected backup, atomic replacement, post-validation, and
rollback. The bytes used for the backup are hashed against `expectedHash`, and
the target is hashed again immediately before rename. A directory-sync failure
after rename is treated as a committed failure and restores the protected
backup; restoration failure is a partial failure rather than an ordinary
error.

Missing files use the `"MISSING"` state hash, require an approved complete
template, recheck absence immediately before execution, install a temporary
file with an atomic no-clobber link, apply restrictive permissions, and delete
the new file if post-validation or post-link directory synchronization fails.
There are no prior bytes to back up for a missing file; the rollback snapshot
is the verified absent state.

For partial schema patches, preview reads the same explicit variant and seeds
the adapter request with its current approved projection before applying typed
field changes. This preserves the hidden OpenSSH marker host and unchanged Zsh
managed block lists without exposing them through IPC. `REDACTED` non-secret
fields are validated in Rust but presented as `UNSET`; unchanged backend
values are retained unless the user explicitly supplies a replacement.

Schema patch values do not have a null/delete state. Omitting a field means
keep its current value, while a typed literal means replace it. The generic UI
does not display a clear action, and the Rust request decoder rejects explicit
null values rather than pretending that an adapter's `Option::None` deletes a
setting. Editable string fields require at least one byte, and clearing a text
control only removes its draft change; it does not submit an empty-string
surrogate for deletion.

### Initial six schema migration

The normal path for every schema-backed document is the generic
`SchemaEditor`; selection is based on `READY` schema state, not `appId`.
Adapter-specific editors remain registered only for the bounded
`UNAVAILABLE + NO_SCHEMA` compatibility path. `DISABLED` documents never
fall back.

| App / config | Schema fields | Presets |
|---|---|---|
| Git / `git-global-config` | `user-name`, `user-email`, `default-branch`, `alias-checkout`, `alias-branch`, `pull-rebase`, `fetch-prune` | Identity and workflow field groups; safe workflow recommended values |
| npm / `npm-user-config` | redacted `registry`, `strict-ssl`, replacement-only `auth-token` | Registry security field group; public-registry recommended values; new-file complete template |
| Caddy / `caddyfile` | `site-address`, `reverse-proxy` | Site and reverse-proxy field group |
| OpenSSH / `ssh-client-config` | required `host-name`, optional `user` and bounded `port`; marker `host` is internal and immutable | Managed-host field group |
| GitHub Copilot CLI / `copilot-settings` | `model`, bounded `theme` enum | Model/theme field group; new-file complete template |
| Zsh / `zshrc` | redacted replacement lists for `aliases` and `environment`; readable `sources` | Managed-fields group; new-file empty managed-block template |

The npm authentication token has no current/default/preset literal and is
accepted only as a replacement. Registry URLs are redacted because a URL may
embed credentials. Zsh alias and environment projections are also redacted;
the backend preserves their current adapter values across unrelated changes,
and the document-level `SENSITIVE` diff remains redacted.

Zsh may return no structured projection when an existing file has no UserHome
managed block; its all-optional schema can safely start an empty draft and the
adapter still owns managed-boundary insertion. OpenSSH requires an existing,
uniquely identified managed host block because its marker host is not writable
through the generic schema. Existing files without that projection are
`DISABLED`, and missing files have no complete template.

npm token replacement accepts only an unambiguous `http://` or `https://`
registry without userinfo, query, fragment, malformed authority, or malformed
path encoding. The token key is derived only as
`//host[:port]/path/:_authToken`. Unsafe registry values fail with a fixed
message that never includes the registry or credential.

Only `github-copilot/copilot-settings` is migrated. `copilot-config`,
`copilot-mcp-config`, `copilot-permissions-config`, and
`copilot-instructions` remain `NO_SCHEMA`. The current adapter's `banner`
boolean does not match the official `"always" | "once" | "never"` contract,
and its `reasoningEffort` key does not match the documented `effortLevel`
key, so neither field is exposed until adapter semantics are updated and
reviewed.

The matching corpus fragments are:

- `catalog-corpus/schemas/git-npm.json` and
  `catalog-corpus/presets/git-npm.json`
- `catalog-corpus/schemas/caddy-ssh.json` and
  `catalog-corpus/presets/caddy-ssh.json`
- `catalog-corpus/schemas/copilot-zsh.json` and
  `catalog-corpus/presets/copilot-zsh.json`

### Initial six provenance

All entries below were fetched as HTTPS response bytes and hashed with
SHA-256. The initial eight were verified at `2026-09-22T09:15:06Z`; the npmrc
token source added during the same review was verified at
`2026-09-22T09:17:26Z`. They normalize facts only. License status is
`NOT_APPLICABLE`, not an assertion that upstream documentation or schemas may
be redistributed; repository-maintainer review status is `APPROVED` for this
packaged factual mapping.

| Source | SHA-256 |
|---|---|
| `https://git-scm.com/docs/git-config` | `512529b2e6cfc50a9f424968f68e90a86715f13c748090ef2b4ef3aa01d0716b` |
| `https://docs.npmjs.com/cli/v11/using-npm/config` | `877584cbe6cd3e5351078971059bf225b34e0832a4bfef3fda16237e75073410` |
| `https://docs.npmjs.com/cli/v11/configuring-npm/npmrc` | `8b3020282f707aa0f10135d8dbe855c944c1f6d8452578d15ef91cf23d965ce6` |
| `https://caddyserver.com/docs/caddyfile/concepts` | `7003b77ccbe6189c8fa27f366c46a4eab69e43572e49a4794360379651ac3386` |
| `https://caddyserver.com/docs/caddyfile/directives/reverse_proxy` | `38ae35afcb4802a1f63de4a2e5ee753fec355b51506225bf16db992cdd090c4f` |
| `https://man.openbsd.org/ssh_config` | `3d8e498373fc78cf844ce3317848867fb80624f0b981a92a6440bc9890b4980f` |
| `https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli` | `a14f427f6b04720139f86c08c14434c2ca544b27b2593eda9c6ef0fda9818cd9` |
| `https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference` | `a036a17c8a163ce6d0abbc69b9e4fcb6e9b7f0160de69c120c715957f1c45afb` |
| `https://zsh.sourceforge.io/Doc/Release/Shell-Builtin-Commands.html` | `19f7a047abe520cd4db0dea2f68285e354980786980a42475ebbb191e4b60b4e` |

### Generic read-only format capabilities

The generic `read-only-text` adapter delegates inspection to a typed format
registry. The registry never participates in `prepare_raw` or
`prepare_structured`, so recognizing a readable syntax cannot grant write
authority.

| Family | `STANDARD` | `SENSITIVE` / `SECRET` |
|---|---|---|
| `JSON` / `JSONC` | Parse and return normalized UTF-8 JSON | Parse and recursively redact known secret fields; comments are discarded; `SECRET` is metadata-only |
| `INI` / `GIT_CONFIG` / `KEY_VALUE` | Return declared non-sensitive UTF-8 text | Redact every assignment value, comment, and section; any unrecognized line makes the whole document metadata-only; `SECRET` is metadata-only |
| `PLAIN_TEXT` | Return declared non-sensitive UTF-8 text | Metadata-only |
| `TOML` / `YAML` / `PLIST` / `COMMAND` | Metadata-only | Metadata-only |

JSONC support is deliberately bounded to JSON values with line comments, block
comments, and trailing commas. Malformed JSON/JSONC returns an invalid
diagnostic rather than raw text. Binary input fails UTF-8 validation before
format handling; unsupported, database, credential, cache, log, socket, and
runtime-state documents have no generic raw-content capability.

## Current bounded read-only catalog

The original T41 batch adds six locally relevant definitions with exact
`HOME_PATH` evidence. T58 preserves those application identities, document
IDs, paths, and authorization while adding Zed, Neovim, and iTerm2. New
executable and Homebrew identifiers are detection evidence only; they do not
grant execution, package-management, service, elevation, or write authority.
Every document uses the generic `read-only-text` adapter, `text` validator, a
finite size limit, and `READ_ONLY`.

| App ID | Detection and path variants | Sensitivity | Format | Presentation | Coverage |
|---|---|---|---|---|---|
| `visual-studio-code` | `~/Library/Application Support/Code/User/settings.json`; `~/Library/Application Support/Code - Insiders/User/settings.json` | `SENSITIVE` | `JSON` | `visual-studio-code`, 编辑器 | `MANAGED_READ_ONLY` |
| `cursor` | `~/Library/Application Support/Cursor/User/settings.json` | `SENSITIVE` | `JSON` | `cursor`, 编辑器 | `MANAGED_READ_ONLY` |
| `ghostty` | `~/Library/Application Support/com.mitchellh.ghostty/config`; `~/.config/ghostty/config` | `SENSITIVE` | `TEXT` | `ghostty`, 终端 | `MANAGED_READ_ONLY` |
| `starship` | `~/.config/starship.toml` | `SENSITIVE` | `TEXT` | `starship`, Shell | `MANAGED_READ_ONLY` |
| `tmux` | `~/.tmux.conf`; `~/.config/tmux/tmux.conf` | `SENSITIVE` | `TEXT` | `tmux`, 终端 | `MANAGED_READ_ONLY` |
| `vim` | `~/.vimrc`; `~/.vim/vimrc` | `SENSITIVE` | `TEXT` | `vim`, 编辑器 | `MANAGED_READ_ONLY` |
| `zed` | `XDG_CONFIG_HOME/zed/settings.json` | `SECRET` | `JSONC` | `zed`, 编辑器 | `MANAGED_READ_ONLY` |
| `neovim` | `XDG_CONFIG_HOME/nvim/init.lua`; `XDG_CONFIG_HOME/nvim/init.vim` | `SENSITIVE` | `TEXT` | `neovim`, 编辑器 | `MANAGED_READ_ONLY` |
| `iterm2` | `~/Library/Preferences/com.googlecode.iterm2.plist` | `SENSITIVE` | `PLIST` | `iterm2`, 终端 | `MANAGED_READ_ONLY` |

`TEXT` describes a generic UTF-8 text document; it does not imply a
format-specific parser or validator. The current `SENSITIVE` plain-text
documents are metadata-only because no reliable parser and redactor has been
approved. Neovim's Lua and Vimscript entry points therefore remain separate
documents instead of being presented as interchangeable variants. Zed settings
can embed command environment values, so the document is `SECRET` and remains
metadata-only even though its JSONC syntax is recognized. iTerm2's plist
remains metadata-only when UTF-8 and returns an invalid diagnostic for binary
input, so neither representation exposes raw preferences. Custom iTerm2
preference folders and known credential, token, key, history, cache, log,
database, socket, and runtime-state paths remain outside this batch.

## T59 AI and developer-tool batch

T59 adds ten bounded `MANAGED_READ_ONLY` definitions and one `EXCLUDED`
definition. Detection uses exact `HOME_PATH` evidence
only. Every executable, Homebrew formula, Homebrew cask, service, elevation,
and write list remains empty; recognizing an installed product does not grant
an action.

| App ID | Managed settings or diagnostic boundary | Sensitivity | Format | Coverage |
|---|---|---|---|---|
| `claude` | `HOME/.claude/settings.json`; `APPLICATION_SUPPORT/Claude/claude_desktop_config.json` | `SECRET` | `JSON` | `MANAGED_READ_ONLY` |
| `codex` | `HOME/.codex/config.toml` | `SECRET` | `TOML` | `MANAGED_READ_ONLY` |
| `gemini` | `HOME/.gemini/settings.json` | `SECRET` | `JSON` | `MANAGED_READ_ONLY` |
| `antigravity` | `APPLICATION_SUPPORT/Antigravity/User/settings.json` | `SECRET` | `JSONC` | `MANAGED_READ_ONLY` |
| `trae` | `APPLICATION_SUPPORT/Trae/User/settings.json`; `APPLICATION_SUPPORT/Trae CN/User/settings.json` | `SECRET` | `JSONC` | `MANAGED_READ_ONLY` |
| `docker` | `HOME/Library/Group Containers/group.com.docker/settings-store.json`; legacy `settings.json` variant | `SECRET` | `JSON` | `MANAGED_READ_ONLY` |
| `orbstack` | Exact group-container detection only; settings share a container with machines, containers, images, credentials, databases, and runtime state, and no stable bounded settings-file contract is approved | N/A | N/A | `EXCLUDED` |
| `gcloud` | `XDG_CONFIG_HOME/gcloud/configurations/config_default` | `SENSITIVE` | `INI` | `MANAGED_READ_ONLY` |
| `raycast` | `HOME/Library/Preferences/com.raycast.macos.plist` | `SENSITIVE` | `PLIST` | `MANAGED_READ_ONLY` |
| `gitkraken-cli` | `APPLICATION_SUPPORT/GitKrakenCLI/settings.json` | `SECRET` | `JSON` | `MANAGED_READ_ONLY` |
| `apifox` | `HOME/Library/Preferences/cn.apifox.app.plist` | `SENSITIVE` | `PLIST` | `MANAGED_READ_ONLY` |

AI settings that may embed MCP commands, environment values, account fields,
or provider configuration are `SECRET`, so JSON/JSONC parsing never returns
their content. TOML and plist handlers are metadata-only, while gcloud's
strict INI handler redacts every assignment value and falls back to metadata
only on any unrecognized line. Docker CLI `config.json`, Claude/Codex/Gemini
credentials and sessions, Antigravity/Trae global storage and agent state,
Docker and OrbStack runtime stores, gcloud credential databases and logs,
Raycast extension data, GitKraken provider state, and Apifox projects and
environments are deliberately not managed.

## Runtime presentation and authorization

The Applications workspace renders catalog entries from `iconKey`,
`presentation.category`, `coverageClass`, and sanitized document metadata. The
catalog IPC may expose typed root aliases and normalized relative paths, but it
does not expose absolute filesystem paths. Search, category, coverage,
detection, and capability filters do not change authorization.

The runtime catalog contains 624 unique applications: six
`MANAGED_WRITABLE`, nineteen `MANAGED_READ_ONLY`, one `EXCLUDED`, and 598
`DETECTED_UNSUPPORTED`. Rust performs search, filtering, facets, detail
lookup, and exact 50-item pagination. The compatibility list command is also
bounded to the first 50 items and is not used by the current application
browser.

The catalog IPC exposes a validated priority policy, safe detection evidence,
source evidence, and support explanations. Priority A remains fixed at six
usable writable integrations. Priority B remains fixed at twenty applications
that must be managed or have a specific exclusion requirement. The other
Homebrew-derived entries are detection-only and gain no configuration,
command, service, elevation, or write authority. Detection paths are converted
to root aliases before IPC; absolute private paths and raw authorization
templates remain unavailable.

Runtime behavior is fail-closed:

- `MANAGED_WRITABLE` shows mutation controls only when the application also has
  `WRITE_CONFIG`, the document declares `READ_WRITE`, its `editorKey` maps to a
  compiled editor capability, the selected path is the resolver's current
  priority variant, and a current content hash is available. Every mutation
  still requires the existing validator, preview, explicit confirmation,
  backup, atomic write, and post-write validation order.
- `MANAGED_READ_ONLY` may return only bounded, validated, redacted text through
  its approved adapter. It never exposes preview, write, backup, restore,
  service, or elevation actions.
- `METADATA_ONLY` and document-level `EXCLUDED` presentation never calls
  `read_config`; the workspace uses only bounded summary and variant metadata.
- `DETECTED_UNSUPPORTED` exposes detection/classification metadata only. It does
  not authorize `listConfigs`, content reads, or management actions.
- `EXCLUDED` is assigned before content access for credentials, keys, caches,
  logs, databases, sockets, stores, and runtime state. The UI may show only the
  safe candidate name, entry type, coverage class, and modification time; it
  provides no open, read, edit, backup, restore, service, or elevation action.

Discovery evidence and UI selection never promote an entry to a broader
coverage class. Authorization continues to come only from the validated
built-in Rust catalog.

Settings also remain outside the authorization boundary. The four optional
discovery-root preference IDs (`HOME`, `XDG_CONFIG_HOME`,
`APPLICATION_SUPPORT`, and `HOMEBREW_PREFIX`) only enable or suppress bounded
metadata evidence for unknown candidates; they do not add, remove, or rewrite
catalog documents, paths, capabilities, write policies, services, or elevation
resources. Backup-retention preferences affect only the app-owned backup root,
and preference reset does not delete backups or managed application files.

The diagnostics surface does not serialize catalog definitions or runtime
configuration objects. Its backend allowlist exports only schema/application
counts and fixed health enums, so legacy path templates, resolved absolute
paths, configuration content, helper reasons, operation intents, and
authorization material cannot cross the diagnostics IPC.

Document presentation is dispatched by typed state, `accessMode`,
`formatFamily`, and `editorKey`, never by `appId`. JSON-like, assignment,
command, and plain-text families share a bounded scrollable viewer while
plain-text snapshots may wrap long lines. Path selection uses at most eight
resolved root-alias variants; alternate variants are inspectable but remain
read-only because mutation commands do not accept a variant path. Unknown
editor capabilities and variant-resolution failures render non-actionable
diagnostics instead of falling back to a generic editor.

## Typed resolution and diagnostics

Configuration reads resolve catalog variants in ascending `precedence`. The
first non-`MISSING` variant is selected; an unsafe, denied, invalid, or
unsupported higher-precedence entry fails closed instead of silently falling
through to a lower-precedence file. Callers may request an exact `variantId`,
but they never submit a path.

The configuration IPC exposes three contracts:

- `resolve_config_variants` returns every bounded variant with one selected
  entry, safe display metadata, and no content.
- `read_config` returns the selected or requested variant with an explicit
  state. For documents without a packaged schema, content and structured data
  retain the legacy `READY`/`REDACTED` behavior required by compatibility
  editors. For every schema-backed document, the Rust command strips both
  fields before serialization; internal Rust reads retain the projection for
  schema validation and adapter merge.
- `diagnose_config` returns only the selected or requested diagnostic.

Every result contains `appId`, `configId`, `variantId`, a root-alias
`displayPath`, `state`, `retryable`, and `nextAction`. Diagnostic states and
actions are fixed:

| State | Next action | Retryable |
|---|---|---|
| `MISSING` | `CREATE_FILE` | No |
| `READY` | `NONE` | No |
| `INVALID` | `FIX_CONTENT` | No |
| `REDACTED` | `VIEW_REDACTED` | No |
| `TOO_LARGE` | `REDUCE_SIZE` | No |
| `PERMISSION_DENIED` | `REVIEW_PERMISSIONS` | No |
| `UNSAFE_SYMLINK` | `REPAIR_SYMLINK` | No |
| `UNSUPPORTED_FORMAT` | `UPDATE_CATALOG` | No |
| `IO_ERROR` | `RETRY` | Yes |

Failed reads never serialize content, structured values, or a writable content
hash. Listing an application's documents isolates each read result, so one
invalid document remains visible as `INVALID` without preventing other
documents from loading. Display and symlink paths use `~` or typed root aliases;
absolute private paths and low-level I/O details never cross IPC.

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
