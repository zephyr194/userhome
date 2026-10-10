# Capability Map: UserHome

Status: Initial map approved on 2026-09-20; desktop-completeness revision approved on 2026-09-21; configuration-discovery-and-editing revision approved on 2026-09-22

## General UI correction (approved on 2026-10-10)

This correction restores home-configuration recognition as the primary product task, completes the layout migration across every primary route, and defines one visual system without forcing a single appearance.

| Module id | Responsibility | Depends on |
|---|---|---|
| `ui-visual-system-v3` | Shared typography, dimensions, spacing, semantic colors, and functional System/Light/Dark appearance | — |
| `ui-layout-completion-v3` | Complete Dashboard, Applications, Homebrew, Services, and Settings migration with explicit pane scroll ownership | `ui-visual-system-v3` |
| `home-config-recognition-v3` | Present bounded home/configuration discovery as the primary Dashboard result and a direct local-results Applications view | existing `home-baseline-inventory`, `configuration-platform`, `application-browsing`; `ui-layout-completion-v3` |
| `ui-correction-acceptance-v3` | Cross-route, appearance, zoom, state, overflow, accessibility, and security evidence | all three modules above |

Build order:

```text
ui-visual-system-v3 + audit existing home discovery contracts
  -> ui-layout-completion-v3
  -> home-config-recognition-v3
  -> ui-correction-acceptance-v3
```

The discovery-contract audit may run beside visual-system work, but it does not authorize implementation changes. This revision reuses existing approved roots and typed discovery data by default. It does not add filesystem authority, scan depth, arbitrary paths, catalog write access, or dependencies. Approval includes only focused discovery DTO, count-selector, and stale-snapshot unit tests; other new tests still require separate approval.

Approved specifications:

- [`SPEC-ui-visual-system-v3.md`](docs/specs/SPEC-ui-visual-system-v3.md)
- [`SPEC-ui-layout-completion-v3.md`](docs/specs/SPEC-ui-layout-completion-v3.md)
- [`SPEC-home-config-recognition-v3.md`](docs/specs/SPEC-home-config-recognition-v3.md)
- [`SPEC-ui-correction-acceptance-v3.md`](docs/specs/SPEC-ui-correction-acceptance-v3.md)

## Native visual redesign (approved on 2026-09-23)

This presentation-only revision covers all primary routes. The module boundaries
and build order, as well as the five detailed specifications, were approved
on 2026-09-23.

| Module id | Responsibility | Depends on |
|---|---|---|
| `visual-system-v2` | Native macOS light/dark palette, typography, density, semantic states, and shared controls | — |
| `desktop-shell-v2` | Fixed-window title bar, sidebar, toolbar, pane hierarchy, navigation, and scroll ownership | `visual-system-v2` |
| `resource-workspaces-v2` | Applications/configuration, Homebrew, and Services list/detail workspaces | `desktop-shell-v2` |
| `utility-workspaces-v2` | Dashboard and Settings workspaces | `desktop-shell-v2` |
| `visual-acceptance-v2` | Cross-route visual, accessibility, interaction, and zoom acceptance evidence | `resource-workspaces-v2`, `utility-workspaces-v2` |

Build order: `visual-system-v2` → `desktop-shell-v2` →
`resource-workspaces-v2` and `utility-workspaces-v2` →
`visual-acceptance-v2`. The resource and utility workspaces may proceed in
parallel after the shared shell stabilizes, with exclusive ownership of shared
styles. This revision does not broaden catalog, filesystem, process, or
privileged-helper authority.

## Configuration-discovery-and-editing revision

This approved revision extends the existing provider and desktop-completeness
maps without replacing them.

| Module id | Responsibility | Depends on |
|---|---|---|
| `desktop-visual-consistency` | Define measurable macOS System Settings-style geometry, density, typography, color, scrolling, focus, and reusable workspace primitives | — |
| `config-schema-presets` | Define independently versioned typed configuration schemas and three preset kinds: complete templates, field groups, and recommended-value sets | — |
| `native-window-dragging` | Define title-bar and blank-space drag behavior, interactive no-drag zones, and double-click no-op behavior | `desktop-visual-consistency` |
| `open-source-config-sourcing` | Build and validate a maintenance/CI-time curated offline corpus sourced only from official documentation and official repositories | `config-schema-presets` |
| `schema-driven-config-editing` | Render schema-driven forms for Git, Caddy, GitHub Copilot CLI, npm, OpenSSH, and Zsh first, and apply presets through the existing safe mutation chain | `desktop-visual-consistency`, `config-schema-presets` |
| `application-browsing` | Search, filter, group, select, and inspect a catalog of at least 500 applications using pages of exactly 50 entries | `desktop-visual-consistency`, `open-source-config-sourcing`, `schema-driven-config-editing` |

Dependency direction:

```text
desktop-visual-consistency
  -> native-window-dragging
  -> schema-driven-config-editing
  -> application-browsing

config-schema-presets
  -> open-source-config-sourcing
  -> schema-driven-config-editing

open-source-config-sourcing
  -> application-browsing

schema-driven-config-editing
  -> application-browsing
```

The graph is acyclic. Build order:

```text
desktop-visual-consistency + config-schema-presets
  -> native-window-dragging + open-source-config-sourcing
  -> schema-driven-config-editing
  -> application-browsing
  -> integrated desktop acceptance at 1120 x 720
```

Revision module specifications:

- [`SPEC-desktop-visual-consistency.md`](docs/specs/SPEC-desktop-visual-consistency.md)
- [`SPEC-config-schema-presets.md`](docs/specs/SPEC-config-schema-presets.md)
- [`SPEC-native-window-dragging.md`](docs/specs/SPEC-native-window-dragging.md)
- [`SPEC-open-source-config-sourcing.md`](docs/specs/SPEC-open-source-config-sourcing.md)
- [`SPEC-schema-driven-config-editing.md`](docs/specs/SPEC-schema-driven-config-editing.md)
- [`SPEC-application-browsing.md`](docs/specs/SPEC-application-browsing.md)

Schemas and presets use two independently versioned packaged files.
Application browsing uses dependency-free pagination with exactly 50 entries
per page. Corpus refresh cadence, staleness threshold, and approval owner
remain explicit implementation-plan questions.

These modules preserve the existing local-first, fail-closed, typed IPC,
sensitive-data shielding, catalog-owned authorization, and
preview/confirm/backup/atomic write/post-validate/rollback boundaries. The
specifications authorize planning only; implementation still requires an
approved plan.

## Desktop-completeness revision

The initial architecture remains the provider foundation. The following
capabilities define the next revision and address the remaining desktop UX,
home-directory coverage, configuration-platform, catalog, and settings gaps.

| Module id | Responsibility | Depends on |
|---|---|---|
| `native-desktop-shell` | Replace web-dashboard composition with a macOS System Settings-style sidebar, toolbar, selection workspace, inspector, menus, and keyboard commands | — |
| `home-baseline-inventory` | Produce a bounded, metadata-first inventory of configuration roots on the baseline Mac and classify every eligible result | — |
| `configuration-platform` | Support reusable path variants, configuration format families, validation, diagnostics, backup, restore, and fail-closed redaction | `home-baseline-inventory` |
| `catalog-expansion` | Expand managed application coverage from the approved baseline without adding application-specific UI branches | `home-baseline-inventory`, `configuration-platform` |
| `application-settings` | Provide persisted appearance, lifecycle, refresh, backup, privacy, diagnostics, and reset preferences | `native-desktop-shell`, `configuration-platform` |

Build order:

```text
native-desktop-shell + home-baseline-inventory
  -> configuration-platform
  -> catalog-expansion + application-settings
  -> integrated desktop acceptance
```

Revision module specifications:

- [`SPEC-native-desktop-shell.md`](docs/specs/SPEC-native-desktop-shell.md)
- [`SPEC-home-baseline-inventory.md`](docs/specs/SPEC-home-baseline-inventory.md)
- [`SPEC-configuration-platform.md`](docs/specs/SPEC-configuration-platform.md)
- [`SPEC-catalog-expansion.md`](docs/specs/SPEC-catalog-expansion.md)
- [`SPEC-application-settings.md`](docs/specs/SPEC-application-settings.md)

The approved coverage rule is: classify every safely identifiable configuration
root, provide write support only for stable and validated formats, provide
bounded read-only support for other safe text formats, and exclude credentials,
databases, caches, logs, runtime state, and other unsafe content.

| Module id | Responsibility | Depends on |
|---|---|---|
| `platform-foundation` | Tauri desktop shell, tray, window lifecycle, secure IPC, permissions, local state, and controlled elevation boundary | — |
| `app-catalog` | Application identity, home-directory detection rules, Homebrew mappings, configuration schemas, and service definitions | — |
| `system-discovery` | Home directory, macOS capability, Homebrew installation, package, cask, and service discovery | `platform-foundation`, `app-catalog` |
| `config-management` | Read, render, validate, back up, and write managed application configuration | `platform-foundation`, `app-catalog`, `system-discovery` |
| `brew-management` | List, search, install, upgrade, and uninstall Homebrew formulae and casks | `platform-foundation`, `app-catalog`, `system-discovery` |
| `service-management` | Configure, validate, start, stop, and restart Caddy and other allowlisted Homebrew services | `config-management`, `brew-management` |
| `desktop-experience` | Dashboard, application details, configuration editor, Homebrew management, service controls, tray actions, and user feedback | All provider modules |

Build order:

```text
platform-foundation + app-catalog
  -> system-discovery
  -> config-management + brew-management
  -> service-management
  -> desktop-experience
```

Module specifications:

- [`SPEC-platform-foundation.md`](docs/specs/SPEC-platform-foundation.md)
- [`SPEC-app-catalog.md`](docs/specs/SPEC-app-catalog.md)
- [`SPEC-system-discovery.md`](docs/specs/SPEC-system-discovery.md)
- [`SPEC-config-management.md`](docs/specs/SPEC-config-management.md)
- [`SPEC-brew-management.md`](docs/specs/SPEC-brew-management.md)
- [`SPEC-service-management.md`](docs/specs/SPEC-service-management.md)
- [`SPEC-desktop-experience.md`](docs/specs/SPEC-desktop-experience.md)
