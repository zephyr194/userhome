# Spec: desktop-experience

Status: Approved on 2026-09-20; visual-system revision approved on 2026-09-20

## Objective

Provide a compact, polished desktop and tray experience that makes system state,
configuration changes, Homebrew operations, and privilege requirements
understandable before the user acts. The interface must read as a native desktop
utility rather than a conventional responsive administration website.

## Window and Shell

- Main window: centered, 1120 by 720 logical pixels.
- Resizing and maximizing are disabled.
- The top region is frameless and integrated with application identity,
  refresh state, contextual actions, and platform window controls.
- macOS keeps native traffic-light controls; drag regions must not overlap
  buttons, links, fields, menus, or other interactive content.
- The document viewport remains fixed. Navigation, lists, editors, and detail
  panes use intentional internal scrolling.
- The primary composition is a compact navigation rail plus a contextual
  workspace, not a generic page header followed by a card grid.

## Visual System

- Tailwind CSS supplies semantic tokens and layout utilities.
- Headless UI supplies accessible dialogs, menus, listboxes, popovers, and
  transitions where those interaction patterns are required.
- Color tokens cover canvas, surface, muted surface, border, foreground,
  muted foreground, primary, success, warning, and danger roles.
- Avoid excessive gradients, large decorative shadows, pill-shaped controls,
  oversized page headings, and uniform stock-card grids.
- Application and tray icons use the approved configuration-oriented brand
  symbol rather than a house-only mark.

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
- The window cannot be resized or maximized and opens at 1120 by 720 logical
  pixels.
- Content remains usable without document-level overflow at the configured
  window size.
- Tailwind semantic tokens and shared primitives replace feature-specific
  button, panel, badge, field, and dialog styling.
- The app and tray icons remain recognizable at their smallest shipped sizes
  and work in light and dark system appearances.

## Boundaries

- Always: show source, effect, confirmation, progress, and result.
- Ask first: add a tray mutation or background watcher.
- Never: hide elevation, destructive effects, or validation failures behind a
  generic confirmation.
