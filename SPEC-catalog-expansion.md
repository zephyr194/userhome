# Spec: catalog-expansion

Status: Approved on 2026-09-21

## Objective

Expand the managed catalog from the current 12 applications to meaningful
coverage of the baseline developer Mac. The catalog must be data-driven,
explain partial support, and avoid claiming edit support when only detection or
safe read-only access is available.

## Coverage Tiers

### Priority A: existing compatibility and writable integrations

- GitHub Copilot CLI.
- Caddy.
- Git.
- OpenSSH.
- Zsh.
- npm.

These retain current behavior and must not regress.

### Priority B: baseline developer applications

The first expansion targets safely identifiable configuration for:

- Visual Studio Code and Code Insiders.
- Cursor.
- Zed.
- Vim and Neovim.
- Ghostty and iTerm2.
- tmux and Starship.
- Claude, Codex, Gemini, Antigravity, and Trae where configuration can be
  separated from credentials, sessions, logs, and runtime state.
- Docker, OrbStack, gcloud, Raycast, GitKraken CLI, and Apifox where safe
  configuration documents are known.

Product channels may share one app identity with multiple document variants
when the configuration semantics are equivalent.

### Priority C: remaining baseline candidates

Every remaining safe candidate receives:

- `MANAGED_READ_ONLY` when a bounded, safely redacted text document is known.
- `DETECTED_UNSUPPORTED` when only metadata is safe or the format contract is
  not implemented.
- `EXCLUDED` for credentials, databases, caches, logs, package stores, sockets,
  lock files, indexes, telemetry, and runtime state.

## Catalog Requirements

- Definitions are data-only when they use existing roots, formats, validators,
  redactors, viewers, and capabilities.
- An application may contain multiple profiles or path variants.
- Each document declares purpose, format family, sensitivity, access mode,
  precedence, maximum size, adapter, validator, and editor.
- Detection evidence, managed documents, unsupported areas, and exclusions are
  visible in the application detail UI.
- Unsupported means a real limitation with a reason and proposed requirement,
  not a generic error.

## Completeness Metrics

- 100% of candidates in the sanitized baseline manifest are classified.
- 100% of Priority A applications remain managed and usable.
- 100% of Priority B applications have at least one managed read-only or
  writable configuration document, unless the baseline confirms that all
  available data is secret, binary, runtime-only, or otherwise excluded.
- At least 90% of non-excluded, text-based baseline configuration roots are
  `MANAGED_READ_ONLY` or `MANAGED_WRITABLE`.
- Every remaining `DETECTED_UNSUPPORTED` item names the missing parser,
  redactor, path contract, or product knowledge needed for support.

## Interfaces and Dependencies

The module consumes:

- Sanitized candidate and coverage evidence from `home-baseline-inventory`.
- Root aliases, path variants, formats, diagnostics, and adapters from
  `configuration-platform`.

It continues to provide the existing catalog and presentation IPC without
exposing raw authorization details to the frontend.

## Tech Stack and Project Structure

```text
src-tauri/src/catalog/catalog-v1.json   application definitions
src-tauri/src/catalog/                  schema and validation
src-tauri/src/config/                   semantic adapters when required
src/features/apps/                      capability-driven presentation
docs/managed-app-schema.md              extension rules and support matrix
docs/home-baseline-coverage.md          sanitized coverage evidence
```

## Code Style

Prefer a data-only definition:

```json
{
  "id": "zed",
  "coverageClass": "MANAGED_READ_ONLY",
  "configDocuments": [
    {
      "configId": "zed-settings",
      "root": "XDG_CONFIG_HOME",
      "relativePath": "zed/settings.json",
      "format": "JSONC",
      "writePolicy": "READ_ONLY"
    }
  ]
}
```

Do not add `if (appId === "zed")` UI behavior when existing capabilities can
render the definition.

## Commands and Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e
pnpm build:unsigned
```

Baseline verification compares the sanitized manifest with runtime coverage.
It does not inspect or modify real configuration contents.

## Acceptance Criteria

- The catalog coverage summary satisfies all completeness metrics.
- Applications are grouped and searchable by stable category, coverage, and
  detection state.
- Each app detail distinguishes managed documents, unsupported areas, and
  excluded sensitive/runtime data.
- No new data-only application requires an `appId` branch in React.
- A bad new definition fails catalog validation without breaking the last known
  valid catalog.
- Existing six writable applications and six read-only applications retain
  their paths, capabilities, security behavior, and UI access.

## Boundaries

### Always

- Use least-privilege coverage and explicit reasons.
- Separate settings from credentials, sessions, histories, logs, and caches.
- Review each new writable document as a security-sensitive change.

### Ask first

- Add executable control, service control, write access, privileged access, or a
  new dependency for an application.

### Never

- Claim complete support because an application directory exists.
- Read broad application-support directories to discover undocumented files.
- Treat proprietary binary state as editable configuration.

## Open Questions

The exact final count depends on the sanitized baseline manifest. The metric is
coverage of eligible roots, not an arbitrary application count.
