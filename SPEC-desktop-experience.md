# Spec: desktop-experience

Status: Approved on 2026-09-20

## Objective

Provide a simple, responsive desktop and tray experience that makes system
state, configuration changes, Homebrew operations, and privilege requirements
understandable before the user acts.

## Navigation

```text
Dashboard
Applications
  -> Application details
  -> Configuration editor
Homebrew
Services
Settings
```

## Dashboard

- macOS version and architecture.
- Homebrew availability, prefix, and version.
- Supported applications detected.
- Installed formula/cask counts.
- Service health summary.
- Last refresh time and per-module refresh state.
- Warnings for unavailable elevation, invalid configuration, or failed scans.

## Applications

- Separate detected, partially detected, absent, and unmanaged candidates.
- Explain each detection signal.
- Show managed documents, sensitivity, mode, path using `~` where possible, and
  last modification metadata.
- Structured editor is the default when available.
- Raw editor is explicitly marked Advanced.
- Diff, validation result, backup creation, and confirmation appear before Save.

## Homebrew

- Searchable and filterable installed inventory.
- Formula/cask distinction.
- Details and upgrade status.
- Install, upgrade, and uninstall actions use preview-confirm-progress-result.
- Destructive actions use explicit labels such as `Uninstall caddy`, never a
  generic `Continue`.

## Services

- Show registration, running state, user/system scope, config validity, and last
  action.
- Start, stop, and restart are separate controls.
- Elevated actions display a macOS authorization explanation before invoking
  the helper.

## Tray

- Open UserHome.
- Refresh.
- Read-only summary of detected apps, pending upgrades, and service warnings.
- Quit.

No mutation is available directly from the tray.

## Accessibility and UX

- Full keyboard navigation and visible focus.
- Native semantic controls and accessible names.
- Status is never communicated by color alone.
- Confirmation dialogs state resource, action, elevation, and rollback.
- Long-running operations remain visible after navigation.
- Errors provide a safe message, retryability, and next action without exposing
  internals.
- Empty, loading, partial, success, warning, and failure states are designed for
  every module.

## Acceptance Criteria

- Startup renders a usable shell before Homebrew discovery finishes.
- A user can identify why an application is considered installed or configured.
- No state-changing action executes before a complete preview and explicit
  confirmation.
- Secret values are masked in structured forms, raw previews, diffs, errors, and
  operation history.
- Keyboard-only users can complete configuration and Homebrew flows.
- Closing and reopening from the tray preserves current navigation and active
  operation state.
- Partial discovery failures do not collapse the whole UI into a generic error.

## Boundaries

- Always: show source, effect, confirmation, progress, and result.
- Ask first: add a tray mutation or background watcher.
- Never: hide elevation, destructive effects, or validation failures behind a
  generic confirmation.
