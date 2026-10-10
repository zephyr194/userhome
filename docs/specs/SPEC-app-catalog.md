# Spec: app-catalog

Status: Approved on 2026-09-20; coverage revision approved on 2026-09-20

## Objective

Define a stable, extensible catalog that maps human application identities to
home-directory evidence, executables, Homebrew resources, configuration
documents, validators, and services.

## Catalog Model

Each `ManagedAppDefinition` contains:

```text
id
displayName
description
iconKey
detectionRules[]
executables[]
brewFormulae[]
brewCasks[]
configDocuments[]
services[]
capabilities[]
```

Each configuration definition has an immutable `configId`, path template,
format, sensitivity classification, adapter ID, validator ID, maximum size, and
write policy.

Catalog IDs are kebab-case and never derived from user-controlled filenames.

## Initial Definitions

| App id | Detection | Managed configuration |
|---|---|---|
| `github-copilot` | `~/.copilot`, Copilot executable | `config.json`, `settings.json`, `mcp-config.json`, `permissions-config.json`, `copilot-instructions.md`; databases, logs, runtime, cache, lock, token, and session files excluded |
| `caddy` | Homebrew formula, executable, service, Caddyfile | `${HOMEBREW_PREFIX}/etc/Caddyfile` |
| `git` | executable, Homebrew formula, `~/.gitconfig` | selected global settings plus raw advanced view |
| `openssh` | system executable, `~/.ssh/config` | SSH client configuration only; private keys excluded |
| `zsh` | system executable, `~/.zshrc` | managed aliases/environment block plus raw advanced view |
| `npm` | executable or `~/.npmrc` | user-level npm settings; auth values classified as secret |

Unknown dot-directories may appear as read-only candidates by name, but they are
not editable until a catalog definition is added and approved.

The six definitions above are a compatibility baseline, not the maximum
supported catalog size.

## Coverage Classes

Every safely detected configuration candidate is classified as exactly one of:

1. `MANAGED_WRITABLE`: catalog-owned path, sensitivity, adapter, validator,
   backup, and write policy are all defined.
2. `MANAGED_READ_ONLY`: content may be safely displayed with redaction and size
   limits, but no write policy is available.
3. `DETECTED_UNSUPPORTED`: metadata identifies a likely application
   configuration, but content is not read.
4. `EXCLUDED`: credentials, private keys, token stores, caches, logs, databases,
   sockets, package stores, lock files, and runtime state.

Discovery is not authorization. A candidate may move into a managed class only
through an approved catalog definition.

## Extension Rules

- New definitions are data-first where possible.
- A new executable, writable path, secret classification, parser, validator, or
  privileged action requires code review and explicit approval.
- Catalog schema versions are additive. Existing IDs are not repurposed.
- App detection can combine evidence but cannot execute discovered files.

## Acceptance Criteria

- The six initial definitions load with unique IDs and configuration IDs.
- Catalog validation rejects duplicate IDs, unsafe paths, missing adapters,
  unbounded file sizes, and unsupported write policies.
- A definition can support both Apple Silicon and Intel Homebrew prefixes.
- Unknown dot-directories remain read-only and expose no file contents.
- The catalog can add a future application without changing discovery or UI
  contracts.
- The UI can render a new data-only definition without adding an `appId`
  branch.
- Coverage reporting distinguishes supported, read-only, unsupported, and
  excluded candidates.

## Boundaries

- Always: classify sensitivity and write policy for every document.
- Ask first: add or expand writable paths and executable mappings.
- Never: treat discovery alone as authorization to edit.
