# Spec: native-window-dragging

Status: Approved on 2026-09-22. This is an incremental revision of the window
behavior in `SPEC.md`, `SPEC-desktop-experience.md`, and
`SPEC-native-desktop-shell.md`.

2026-10-10 geometry revision: the user approved native border resizing with
an initial and minimum size of 1120 by 720 and no maximum-size constraint.
This supersedes assumption 2's disabled-resize policy only; maximize,
fullscreen, and title-bar double-click behavior remain disabled.

## Assumptions

1. The macOS window keeps native traffic lights and the current 52-pixel
   overlay title bar.
2. Window resize and maximize remain disabled.
3. Blank title-bar space and title text are draggable.
4. All interactive controls are no-drag.
5. Double-clicking a draggable region is an explicit no-op: no zoom, maximize,
   minimize, restore, or custom action.

## Objective

Make window movement behave predictably like a native macOS utility while
ensuring drag affordances never steal pointer, text selection, focus, menu,
button, link, or form interactions.

### Target users

- Pointer and trackpad users who move a fixed-size utility frequently.
- Keyboard users who require unaffected focus and activation semantics.
- Users who double-click title bars by habit and must not trigger an
  unsupported resize/maximize behavior.
- Developers maintaining shared title-bar and toolbar components.

## Core Capabilities

### Draggable regions

- The non-interactive title-bar background is draggable.
- Product name, current section title, and decorative brand mark are draggable
  when they have no separate activation behavior.
- Empty space within an explicitly designated toolbar/title region may be
  draggable only when it contains no interactive descendant under the pointer.
- Drag regions remain outside the native traffic-light exclusion area.

### No-drag regions

- `button`, `a`, `input`, `textarea`, `select`, `[role="button"]`,
  `[role="menuitem"]`, `[contenteditable]`, tabs, sliders, labels associated
  with controls, and their descendants are no-drag.
- Search fields, refresh controls, menus, dialogs, popovers, editors, list
  rows, scrollbars, and resize-like splitters are no-drag.
- Text intended for selection or copying is no-drag unless it is specifically
  the static title text.
- Adding a new interactive control inside a drag-capable container requires no
  per-control exception if the shared no-drag selector applies.

### Gesture behavior

- Primary-button press-and-drag from an approved region moves the window.
- A click without meaningful pointer movement does not navigate, focus an
  unrelated control, or alter selection state.
- Double-click on an approved drag region is consumed as no-op.
- Secondary click preserves native/context-menu behavior and does not begin a
  drag.
- Dragging does not begin from a scroll gesture, control activation, text
  selection, or pointer event inside a no-drag region.

### Geometry and accessibility

- The drag surface starts to the right of the native traffic lights and leaves
  at least the current 78-pixel leading inset.
- At least one continuous 120 by 28 logical-pixel drag target exists in the
  title bar at 1120 by 720 after contextual actions are rendered.
- Drag behavior does not change keyboard tab order, accessible names, focus
  rings, or control hit targets.
- Interactive controls retain a minimum 32-pixel logical height where required
  by `desktop-visual-consistency`.

## Tech Stack

| Area | Choice |
|---|---|
| Window runtime | Tauri 2 |
| Markup | React 19 semantic components |
| Drag declaration | Tauri `data-tauri-drag-region` plus CSS app-region rules |
| Event handling | Narrow React/Tauri handler only where double-click no-op requires it |
| Verification | Existing Vitest/WDIO plus manual macOS pointer acceptance |

No custom traffic-light implementation or new window-management dependency is
required.

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

## Project Structure

```text
src/app/AppShell.tsx              title bar markup and drag attributes
src/components/ui/                shared interactive-control no-drag behavior
src/styles/global.css             drag/no-drag CSS and title-bar geometry
src-tauri/tauri.conf.json         fixed-window configuration
e2e/                              existing desktop interaction coverage
```

The module must not move drag policy into individual feature pages.

## Code Style

Keep drag regions explicit and controls semantically interactive:

```tsx
<header
  className="titlebar"
  data-tauri-drag-region
  onDoubleClick={preventTitlebarZoom}
>
  <div className="titlebar__identity" data-tauri-drag-region>
    <span aria-hidden="true" data-tauri-drag-region>
      UH
    </span>
    <h1 data-tauri-drag-region>{activeRoute.label}</h1>
  </div>
  <Button onClick={onRefresh}>刷新</Button>
</header>
```

```typescript
function preventTitlebarZoom(event: React.MouseEvent<HTMLElement>) {
  if (event.detail === 2 && event.target === event.currentTarget) {
    event.preventDefault();
  }
}
```

The implementation may need a more precise composed-path guard than this
illustrative handler. It must not depend on string matching class names or
blanket event suppression.

## Testing/Verification Strategy

- Reuse existing AppShell/component tests to verify drag attributes remain on
  static regions and absent from controls.
- Reuse WDIO to exercise click, double-click, focus, and toolbar activation in
  the packaged Tauri window when the existing driver exposes the required
  pointer actions.
- Manual macOS acceptance verifies actual window movement from title text and
  blank space, no movement from each control class, traffic-light access, and
  double-click no-op.
- Verify at 100%, 125%, and 200% text zoom because title/action crowding changes
  available blank drag geometry.
- New test files are not created by default; a new WDIO or Vitest file requires
  explicit approval.

## Boundaries

### Always

- Keep interactive descendants no-drag and preserve semantic activation.
- Keep native traffic lights unobstructed.
- Treat double-click as no-op only in approved drag regions.
- Keep drag behavior independent of provider, catalog, and mutation state.

### Ask first

- Add custom window controls, change title-bar height or traffic-light inset,
  add a new dependency, add a new test file, or call lower-level native window
  APIs beyond Tauri's supported contract.
- Make toolbar blank space draggable if contextual controls leave less than the
  minimum continuous drag target.

### Never

- Mark the whole WebView, sidebar, list, editor, or toolbar controls as
  draggable.
- Suppress pointer events globally or make controls clickable only by keyboard.
- Enable maximize/zoom/resize as a side effect of double-click handling.
- Put filesystem, command, or mutation behavior in a drag handler.

## Dependency Interfaces

### Consumes from `desktop-visual-consistency`

```typescript
interface DragGeometryContract {
  titlebarHeight: 52;
  trafficLightLeadingInset: number;
  minimumContinuousDragWidth: 120;
  minimumContinuousDragHeight: 28;
}
```

- Shared title-bar, toolbar, and interactive-control primitives.
- Fixed 1120 by 720 geometry and text accommodation rules.

### Provides

```typescript
interface WindowDragPolicy {
  dragSelectors: readonly string[];
  noDragSelectors: readonly string[];
  doubleClickBehavior: "NO_OP";
}
```

- A reusable markup/CSS policy for shell and future contextual title content.
- No catalog, config, filesystem, or IPC authority.

## Success Criteria

1. Manual acceptance can move the window from title text and blank title-bar
   space in 10 of 10 attempts, with no missed drag caused by nested static
   elements.
2. Buttons, links, search fields, selects, textareas, menus, list rows, editors,
   scrollbars, and dialog controls move the window in 0 of 10 drag attempts per
   control class and retain normal activation.
3. Double-clicking any approved drag region 10 times changes window size and
   position zero times except for user-initiated dragging between clicks.
4. Native traffic lights remain clickable across System, Light, and Dark
   appearance and supported display scales.
5. A continuous drag target of at least 120 by 28 logical pixels remains
   available at 1120 by 720 and at 200% text zoom.
6. Keyboard tab order, visible focus, and control accessible names are
   unchanged by drag-region implementation.

## Open Questions

- Planning must confirm whether Tauri/WebKit alone can guarantee double-click
  no-op on the selected title-bar style or whether a narrow native/Tauri window
  event hook is required.
- The exact composed-path rule for nested static title elements should be
  finalized with runtime inspection before implementation.
