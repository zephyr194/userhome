# Spec: native-desktop-shell

Status: Approved on 2026-09-21

## Objective

Make UserHome read and behave as a compact macOS utility rather than a website
inside a native window. The primary user is a developer or advanced macOS user
who expects dense information, persistent selection, predictable keyboard
commands, and native-feeling window behavior.

This module replaces the current page-heading, card-grid, and persistent
dashboard-status-rail composition with a macOS System Settings-style workspace.

## Core Capabilities

### Window composition

- Keep the fixed 1120 by 720 logical-pixel window, native traffic lights,
  overlay title bar, disabled resize, and disabled maximize behavior.
- Use one application-level sidebar and one detail workspace. A contextual
  inspector may appear only when the selected resource needs it.
- The title bar contains the current section title, contextual actions, search
  when relevant, and refresh state. It does not repeat marketing text,
  eyebrows, route descriptions, or a web-style hero heading.
- The document body never scrolls. Sidebar, list, detail, editor, history, and
  inspector panes own their scroll regions.

### Desktop interaction model

- Sidebar selection remains visible and persists for the application session.
- Applications, packages, and services use selection-based list/detail views,
  not independent card grids.
- Primary actions live in the toolbar or selected-item detail area.
- Secondary actions use menus, context menus, or an inspector.
- Destructive actions remain explicit and confirmed.
- Empty, loading, partial, error, and disconnected states occupy the affected
  pane rather than replacing the entire application.

### Menus and keyboard behavior

- Provide application menu commands for Settings, Refresh, Hide/Show, and Quit.
- Support `Command+,` for Settings and `Command+R` for Refresh.
- List navigation supports arrow keys; focus does not jump unexpectedly when
  asynchronous data arrives.
- Search fields use macOS-appropriate placement and `Escape` clearing behavior.
- Focus rings remain visible for keyboard users.

### Visual language

- Prefer flat grouped rows, separators, selection backgrounds, compact controls,
  and restrained corner radii.
- Cards are reserved for a self-contained object that genuinely needs a border;
  they are not the default layout primitive.
- Avoid page eyebrows, large page descriptions, decorative gradients, repeated
  status pills, oversized headings, and a permanent right-side status rail.
- Use system font sizing and density comparable to macOS Settings: compact
  labels, 28-32 pixel list rows, and 13-14 pixel primary text where practical.
- System, light, and dark appearances use the semantic Tailwind tokens defined
  by `application-settings`.

## Interfaces and Dependencies

- Provides the navigation and workspace host consumed by all feature modules.
- Consumes existing typed feature state; it does not move business logic into
  React layout components.
- Provides stable slots for toolbar actions, list/detail content, inspector
  content, banners, and operation progress.
- Depends on no provider module and may be implemented in parallel with
  `home-baseline-inventory`.

## Tech Stack and Project Structure

- Tauri 2 window and menu APIs.
- React 19 and strict TypeScript.
- Tailwind CSS 4 semantic tokens.
- Headless UI only for accessible menu, dialog, popover, listbox, and transition
  behavior that cannot be expressed with native semantic elements.

Expected ownership:

```text
src/app/                         shell, routing, menu command state
src/components/                  sidebar, toolbar, split view, inspector
src/components/ui/               shared compact controls and primitives
src/features/*/                  module-specific list and detail workspaces
src/styles/                      semantic appearance and density tokens
src-tauri/src/tray/              open, refresh, summary, quit
src-tauri/tauri.conf.json        fixed-window contract
```

## Code Style

Use named, capability-oriented slots instead of route-specific conditionals:

```tsx
<DesktopWorkspace
  sidebar={<ApplicationSidebar />}
  toolbar={<ApplicationToolbar />}
  detail={<ApplicationDetail />}
  inspector={selectedDocument ? <ConfigInspector /> : null}
/>
```

Do not introduce a generic page, card, or dashboard abstraction that erases the
desktop information hierarchy.

## Commands and Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm build:unsigned
```

No test cases are created during the specification phase. Implementation uses
the existing suites and manual desktop acceptance; new test files require
explicit approval.

## Acceptance Criteria

- No primary route renders a web-style hero header, generic card grid, or
  persistent dashboard status rail.
- Every primary route uses a coherent sidebar/list/detail/inspector desktop
  pattern at 1120 by 720 without document-level overflow.
- Dashboard becomes a compact summary workspace rather than a tiled website
  landing page.
- Applications, Homebrew, and Services retain selection while details or
  operations update.
- Settings opens through both the sidebar and `Command+,`.
- Refresh works through both the toolbar and `Command+R`.
- Loading or failure in one provider does not replace unrelated panes.
- Keyboard-only navigation reaches every primary command with visible focus.
- Manual review confirms the app resembles a macOS utility at supported light,
  dark, and display-scale settings.

## Boundaries

### Always

- Preserve semantic controls, accessible names, focus behavior, and explicit
  operation confirmation.
- Keep business logic outside shell and presentation primitives.
- Keep native traffic-light controls unobstructed.

### Ask first

- Change the fixed window size or allow resizing.
- Add a new dependency, custom title-bar window control, or background watcher.
- Replace Tauri/React with another UI runtime.

### Never

- Reintroduce document-level page scrolling, responsive website breakpoints, or
  route-level marketing headers.
- Hide destructive effects, elevation, or validation failures behind a generic
  menu item.

## Open Questions

None. The approved direction is macOS System Settings-style navigation and
detail composition.
