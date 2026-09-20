# Spec: system-discovery

Status: Approved on 2026-09-20; configuration-coverage revision approved on 2026-09-20

## Objective

Produce a non-blocking, refreshable snapshot of supported home-directory
applications, macOS capabilities, Homebrew installation, installed formulae and
casks, executables, services, and safely identifiable application-configuration
candidates.

## Discovery Sources

- macOS version, architecture, home directory, shell, and relevant permissions.
- Catalog-defined paths, checked for existence and safe target resolution.
- Executables resolved from trusted system paths and the detected Homebrew
  prefix.
- `brew --prefix`, `brew --version`, and machine-readable Homebrew queries.
- `brew services list` for service state.
- Shallow names of unknown dot-directories for optional read-only candidates.
- Catalog-owned path variants for XDG, macOS Application Support, and
  application-specific home-directory locations.
- Bounded metadata-only inspection for known configuration filenames and
  directories. Unknown contents are not opened.

Discovery reads metadata only unless a module explicitly requests a managed
document.

The scanner must exclude credentials, private keys, token stores, caches, logs,
databases, sockets, package stores, lock files, and runtime state before any
content access is considered.

## Interfaces

```text
get_system_snapshot() -> SystemSnapshot
refresh_system_snapshot() -> OperationId
list_managed_apps() -> ManagedAppSummary[]
get_managed_app(appId) -> ManagedAppDetails
list_unmanaged_candidates() -> UnmanagedCandidate[]
get_configuration_coverage() -> ConfigurationCoverage
```

Evidence is explicit:

```text
CONFIG_PRESENT
EXECUTABLE_PRESENT
BREW_FORMULA_INSTALLED
BREW_CASK_INSTALLED
SERVICE_REGISTERED
```

## Performance Requirements

- Local metadata appears within two seconds on the baseline machine.
- Homebrew inventory completes within ten seconds under normal local
  conditions, without blocking rendering.
- Module timeouts produce partial results and a retryable error.
- Startup and manual refresh are the only automatic scans in MVP.
- Coverage discovery must remain bounded by configured roots, entry limits,
  metadata limits, and module timeouts.

## Acceptance Criteria

- The baseline machine identifies all six initial integrations.
- Homebrew discovery supports `/opt/homebrew` and `/usr/local`.
- The UI receives partial local results before Homebrew discovery completes.
- A missing or broken Homebrew installation does not prevent config discovery.
- Discovery never reads private keys, Copilot runtime tokens, logs, databases,
  session state, or cache contents.
- Symlink metadata and resolved target policy are reported without replacing the
  symlink.
- Every safely detected candidate receives one catalog coverage class.
- Permission failures and unreadable metadata produce explicit partial results
  rather than silently disappearing.
- No recursive scan of the complete home directory is performed.

## Boundaries

- Always: parse process output defensively and cap output size.
- Ask first: recursively scan a new directory class.
- Never: execute a discovered file or read unknown file contents.
