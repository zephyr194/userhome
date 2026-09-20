# Spec: platform-foundation

Status: Approved on 2026-09-20; window-contract revision approved on 2026-09-20

## Objective

Provide the secure Tauri 2 application shell, lifecycle, typed IPC boundary,
operation coordinator, local storage, release capabilities, and controlled
elevation foundation required by every other module.

## Responsibilities

- Create and restore the main desktop window.
- Enforce a centered 1120 by 720 logical-pixel main window that cannot be
  resized or maximized.
- Provide a frameless top region with safe drag zones and platform-appropriate
  window controls.
- Create the tray and implement open, refresh, status, and quit actions.
- Define release and development Tauri capabilities.
- Register typed Rust commands and sanitized events.
- Store non-sensitive preferences and sanitized operation history in the Tauri
  app-data directory.
- Coordinate long-running operations and prevent conflicting mutations.
- Register and communicate with the signed macOS privileged helper.
- Provide shared errors, redaction, timeouts, cancellation, and audit metadata.

## Interfaces

```text
get_app_status() -> AppStatus
get_preferences() -> Preferences
update_preferences(input) -> Preferences
list_operations() -> OperationSummary[]
get_operation(operationId) -> OperationDetails
cancel_operation(operationId) -> OperationDetails
refresh_all() -> RefreshSummary
get_elevation_status() -> ElevationStatus
register_elevation_helper(previewOperationId) -> ElevationStatus
```

`update_preferences` may change only application-owned settings. It cannot
change managed application configuration.

## Security Requirements

- No broad filesystem or shell plugin permission is exposed to the WebView.
- The privileged helper protocol is an enum, not a command string.
- Audit events include action type, resource ID, timestamp, result, and
  redacted diagnostics; they exclude configuration contents and secrets.
- Operation IDs are random, single-intent, expiring, and cannot authorize a
  different action.
- Release capabilities are reviewed independently from development
  capabilities.

## Acceptance Criteria

- Closing the window hides it; tray Open restores and focuses it; Quit exits.
- The main window remains fixed at its configured logical size across reopen
  and supported display scale factors.
- Interactive controls never become part of a window drag region.
- A duplicate refresh request joins the active refresh rather than starting a
  second scan.
- Conflicting Homebrew or service mutations cannot run concurrently.
- Every command failure serializes to the shared `AppError` shape.
- The application starts and shows partial module availability when Homebrew or
  the privileged helper is absent.
- The helper rejects unknown protocol versions, unknown actions, arbitrary
  paths, and arbitrary command arguments.
- The application can build as a universal macOS target in GitHub Actions.

## Boundaries

- Always: keep command handlers thin, validate at IPC boundaries, redact logs.
- Ask first: add a capability, helper request variant, or persistent data field.
- Never: grant frontend shell execution or accept an elevation request as raw
  text.
