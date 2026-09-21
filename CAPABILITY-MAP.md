# Capability Map: UserHome

Status: Initial map approved on 2026-09-20; desktop-completeness revision approved on 2026-09-21

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

- [`SPEC-native-desktop-shell.md`](SPEC-native-desktop-shell.md)
- [`SPEC-home-baseline-inventory.md`](SPEC-home-baseline-inventory.md)
- [`SPEC-configuration-platform.md`](SPEC-configuration-platform.md)
- [`SPEC-catalog-expansion.md`](SPEC-catalog-expansion.md)
- [`SPEC-application-settings.md`](SPEC-application-settings.md)

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

- [`SPEC-platform-foundation.md`](SPEC-platform-foundation.md)
- [`SPEC-app-catalog.md`](SPEC-app-catalog.md)
- [`SPEC-system-discovery.md`](SPEC-system-discovery.md)
- [`SPEC-config-management.md`](SPEC-config-management.md)
- [`SPEC-brew-management.md`](SPEC-brew-management.md)
- [`SPEC-service-management.md`](SPEC-service-management.md)
- [`SPEC-desktop-experience.md`](SPEC-desktop-experience.md)
