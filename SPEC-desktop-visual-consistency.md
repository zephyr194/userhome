# Spec: desktop-visual-consistency

Status: Approved on 2026-09-22. This is an incremental revision of
`SPEC-native-desktop-shell.md`, `SPEC-desktop-experience.md`, and the visual
requirements in `SPEC-application-settings.md`.

## Assumptions

1. The window remains fixed at 1120 by 720 logical pixels with native macOS
   traffic lights, disabled resize, and disabled maximize.
2. The visual reference is macOS System Settings, not a pixel-for-pixel clone
   and not a responsive website.
3. Existing React 19, TypeScript strict mode, Tailwind CSS 4, Headless UI, and
   semantic tokens remain the implementation stack.
4. Existing feature behavior and safe mutation flows are preserved while the
   presentation hierarchy is normalized.

## Objective

Create one measurable visual and interaction system for all UserHome routes so
the product reads as a compact macOS utility. Replace subjective complaints
such as “too web-like,” “too card-heavy,” “cramped,” “messy,” or “hard to
scan” with objective requirements for geometry, scroll ownership, information
density, contrast, text accommodation, and keyboard reachability.

### Target users

- Developers and advanced macOS users working in a fixed-size utility window.
- Keyboard users who expect persistent selection and predictable focus.
- Users at supported macOS display scales and in System, Light, or Dark
  appearance.
- Users reading long application names, paths, diagnostics, and localized text.

## Core Capabilities

### Window and pane geometry

- The application viewport is exactly 1120 by 720 logical pixels.
- The title bar is 52 logical pixels high.
- The primary sidebar is 200-216 logical pixels wide; the current 204-pixel
  value is valid.
- The main toolbar is 44-52 logical pixels high.
- Primary list rows are 32-44 logical pixels high for one-line content and may
  expand to at most 64 pixels for a second supporting line.
- Inspector panes are 220-280 logical pixels wide when present.
- A route may use sidebar/detail or sidebar/list/detail/inspector composition,
  but it must not introduce a second full-page shell.

### Scroll ownership

- `html`, `body`, `#root`, `.app-shell`, and `.desktop-workspace` remain
  non-scrolling.
- Sidebar, list, detail, editor, inspector, history, and operation-progress
  panes own their vertical scrolling.
- A single wheel/trackpad gesture scrolls only the pane under the pointer until
  that pane reaches its boundary.
- Each scrollable pane uses `overscroll-behavior: contain`; stable scrollbar
  gutters are used where a scrollbar appearing would shift columns.
- No supported route produces horizontal document overflow at 1120 by 720.

### Density and text accommodation

- Primary labels use 13-14 pixel text; metadata and secondary labels use 11-12
  pixel text; route titles use 18-22 pixel text.
- Default control height is 32-36 pixels; destructive confirmation buttons may
  be 36 pixels.
- Repeated row spacing is 6-12 pixels, section spacing is 12-20 pixels, and
  border radius is normally 6-10 pixels.
- One-line identity labels truncate with an accessible full value; paths,
  validation messages, and operation effects wrap with
  `overflow-wrap: anywhere` instead of clipping.
- At 200% text zoom inside the WebView, all primary actions remain reachable
  through pane scrolling and no control overlaps another.

### Color, contrast, and state

- Semantic tokens cover canvas, surface, muted surface, border, foreground,
  muted foreground, primary, success, warning, danger, focus, and selection.
- Normal text and meaningful icons meet WCAG 2.2 AA contrast of at least 4.5:1;
  large text and non-text UI boundaries meet at least 3:1.
- Focus indicators have at least 3:1 contrast against adjacent colors and are
  visible without relying on color alone.
- Selection, validation, warning, and destructive states use text or icons in
  addition to color.
- Appearance changes do not alter layout geometry or hide state distinctions.

### Component consistency

- Shared `Button`, modal, panel, status, row, toolbar, split-view, and empty
  state primitives own common geometry and semantic styling.
- Feature modules provide content and actions through named workspace slots.
- Cards are limited to truly self-contained objects; grouped settings and
  resource collections use rows and separators.
- Marketing eyebrows, oversized hero headings, decorative gradients, repeated
  status pills, and a permanent dashboard status rail are absent from primary
  routes.

## Tech Stack

| Area | Choice |
|---|---|
| Desktop shell | Tauri 2 |
| UI | React 19, TypeScript 6 strict mode |
| Styling | Tailwind CSS 4 semantic tokens plus `src/styles/global.css` |
| Accessible primitives | Native semantic HTML; Headless UI only when needed |
| Appearance | Existing `SYSTEM`, `LIGHT`, and `DARK` preferences |
| Verification | Existing Vitest, WDIO, build checks, and manual macOS review |

No new UI framework, icon library, animation library, or CSS-in-JS dependency
is required.

## Commands

```bash
pnpm tauri dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm build:unsigned
```

The smallest relevant existing Vitest selector should be used during
implementation before escalating to the full suite.

## Project Structure

```text
src/app/AppShell.tsx                 application-level title bar and slots
src/components/DesktopWorkspace.tsx pane ownership and layout composition
src/components/NavigationRail.tsx    primary navigation
src/components/ui/                   shared semantic controls
src/features/*/                      feature-owned list/detail content
src/styles/global.css                semantic tokens and measurable geometry
src/app/appearance.ts                system/light/dark application
```

Business logic remains in feature state and IPC modules; shared visual
primitives do not fetch data or perform mutations.

## Code Style

Use named slots and explicit semantic labels:

```tsx
<DesktopWorkspace
  sidebar={<NavigationRail routes={APP_ROUTES} />}
  list={<ApplicationList />}
  listLabel="应用目录"
  detail={<ApplicationDetail />}
  detailLabel="应用详情"
  inspector={selectedDocument ? <ConfigInspector /> : undefined}
/>
```

Use semantic tokens and bounded geometry rather than feature-specific color
literals:

```css
.resource-row {
  min-height: 36px;
  padding: 6px 10px;
  color: var(--app-foreground);
  background: var(--app-surface);
  border-bottom: 1px solid var(--app-border);
}
```

Conventions:

- Components and types use `PascalCase`; variables and functions use
  `camelCase`.
- Prefer semantic elements and accessible names over ARIA reconstruction.
- Keep class composition readable; reuse existing `classNames`.
- Comments explain only non-obvious accessibility or layout invariants.

## Testing/Verification Strategy

- Reuse existing Vitest component tests for shell, route state, dialogs, and
  asynchronous pane states.
- Reuse WDIO for window-size, route navigation, keyboard reachability, and
  fixed-viewport checks.
- Reuse `pnpm lint`, `pnpm typecheck`, and `pnpm build` for static validation.
- Manual acceptance covers all primary routes at 1120 by 720 in System, Light,
  and Dark appearance, plus 100%, 125%, and 200% text zoom.
- Inspect the DOM during manual acceptance: document scroll height must equal
  client height, while designated panes may have larger scroll height.
- New test files are not created by default. If existing files cannot express
  a required regression check, adding a test file is an **Ask first** action.

## Boundaries

### Always

- Preserve native traffic-light clearance and the fixed viewport contract.
- Keep document-level overflow hidden and assign scrolling to explicit panes.
- Preserve semantic controls, accessible names, visible focus, reduced-motion
  behavior, and status text independent of color.
- Use shared tokens and primitives for repeated visual patterns.

### Ask first

- Change window dimensions, enable resizing, add a new dependency, add a new
  test file, introduce custom window controls, or add motion not covered by
  reduced-motion behavior.
- Change a shared token in a way that materially alters danger, warning, focus,
  or selection meaning.

### Never

- Reintroduce responsive website breakpoints, page-level hero headers, generic
  card grids, or document-level scrolling.
- Hide focus outlines, use color alone for status, or clip required validation
  and operation text.
- Move provider logic, config parsing, or mutations into layout components.

## Dependency Interfaces

### Provides

```typescript
interface DesktopLayoutMetrics {
  titlebarHeight: 52;
  sidebarWidth: number;
  toolbarHeight: number;
  compactRowMinHeight: number;
  inspectorWidth: number;
}

interface DesktopWorkspaceSlots {
  sidebar: React.ReactNode;
  toolbar: React.ReactNode;
  list?: React.ReactNode;
  detail: React.ReactNode;
  inspector?: React.ReactNode;
  banner?: React.ReactNode;
  operationProgress?: React.ReactNode;
}
```

- Semantic token names and contrast obligations.
- Shared row, selection, toolbar, split-view, empty/error, and focus behavior.
- Drag-region geometry constraints consumed by `native-window-dragging`.
- Form and inspector layout constraints consumed by
  `schema-driven-config-editing`.
- List viewport and row metrics consumed by `application-browsing`.

### Consumes

- Existing appearance preference and route/selection state only.
- No provider, catalog, config, filesystem, or mutation authority.

## Success Criteria

1. Every primary route is usable at 1120 by 720 with zero document-level
   vertical or horizontal overflow; only declared panes scroll.
2. Across System, Light, and Dark appearances, all normal text meets 4.5:1
   contrast and all focus/non-text UI boundaries meet 3:1.
3. At 200% text zoom, every primary action and validation message remains
   reachable without overlap or horizontal document scrolling.
4. At least 90% of repeated resource rows use shared row/control primitives;
   no primary resource collection defaults to an independent card grid.
5. Keyboard-only traversal reaches every primary route and action, with a
   visible focus indicator and no focus reset caused by unrelated async data.
6. Primary one-line rows fit within 32-44 pixels; expanded two-line rows do not
   exceed 64 pixels unless a documented diagnostic requires a separate detail
   view.

## Open Questions

- Whether implementation should codify geometry as exported TypeScript
  constants in addition to CSS custom properties is a planning decision.
- A dedicated automated contrast checker would add tooling; manual/token review
  remains the default unless that dependency is approved.
