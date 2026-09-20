# Capability Map: UserHome

Status: Approved on 2026-09-20

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

