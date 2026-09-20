# Spec: app-catalog

Status: Approved on 2026-09-20

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

## Boundaries

- Always: classify sensitivity and write policy for every document.
- Ask first: add or expand writable paths and executable mappings.
- Never: treat discovery alone as authorization to edit.
