# Spec: brew-management

Status: Approved on 2026-09-20

## Objective

Provide safe, transparent Homebrew inventory and formula/cask lifecycle
operations without exposing arbitrary process execution.

## Capabilities

- List installed formulae and casks with name, version, status, description, and
  available upgrade state when Homebrew provides it.
- Search Homebrew by a user-entered query.
- Display package information before mutation.
- Install one formula or cask.
- Upgrade one selected formula or cask.
- Uninstall one selected formula or cask.
- Stream bounded progress and retain final stdout/stderr summaries with
  sensitive values redacted.

Bulk upgrade, tap management, cleanup, autoremove, and arbitrary flags are out
of scope for MVP.

## Command Policy

Allowed executable: the resolved Homebrew binary under the detected prefix.

Allowed command shapes:

```text
brew info --json=v2 [identifier]
brew info --json=v2 --installed
brew search [query]
brew outdated --json=v2
brew install [--cask] identifier
brew upgrade [--cask] identifier
brew uninstall [--cask] identifier
```

The exact supported flags are fixed by backend enums. The frontend cannot add
flags or environment variables.

## Interfaces

```text
list_brew_packages(filter, page) -> BrewPackagePage
search_brew_packages(query, page) -> BrewPackagePage
get_brew_package(kind, identifier) -> BrewPackageDetails
preview_brew_action(action) -> OperationPreview
execute_brew_action(operationId) -> OperationDetails
```

## Acceptance Criteria

- The baseline machine reports 134 formulae and 40 casks at the observed
  snapshot, while treating those numbers as data rather than hard-coded values.
- Every mutation shows package kind, identifier, normalized action, and expected
  effects before confirmation.
- Ordinary Homebrew operations never request or use root privileges.
- A package-manager lock or concurrent mutation produces a clear retryable
  conflict.
- Timeout, non-zero exit, partial success, and malformed JSON are distinct
  operation outcomes.
- Search input cannot add flags or execute another program.
- The UI remains usable while a Homebrew command runs.

## Boundaries

- Always: execute argument arrays and parse JSON where supported.
- Ask first: add a command, flag, tap, bulk action, or cleanup behavior.
- Never: use a shell, run Homebrew as root, or accept arbitrary flags.
