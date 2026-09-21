# Spec: UserHome

Status: Approved on 2026-09-20; desktop-completeness revision approved on 2026-09-21

## 2026-09-21 Desktop-completeness revision

The original implementation established the secure provider foundation but did
not satisfy the complete desktop-product objective. The remaining gaps are:

- The application still composes routes as web pages with page headings,
  cards, and a persistent dashboard-style status rail.
- The current catalog contains 12 application definitions and does not model
  most configuration roots present on the baseline Mac.
- The Settings route is a placeholder rather than a functional product module.
- Path variants, format handling, diagnostics, and catalog definitions are too
  application-specific to expand reliably.

The approved revision uses the module map in
[`CAPABILITY-MAP.md`](CAPABILITY-MAP.md):

1. [`native-desktop-shell`](SPEC-native-desktop-shell.md)
2. [`home-baseline-inventory`](SPEC-home-baseline-inventory.md)
3. [`configuration-platform`](SPEC-configuration-platform.md)
4. [`catalog-expansion`](SPEC-catalog-expansion.md)
5. [`application-settings`](SPEC-application-settings.md)

The primary UX direction is macOS System Settings rather than a responsive web
dashboard. The completeness contract is not unrestricted recursive access or
write support for every file. It is:

- 100% classification of safely identifiable baseline configuration roots.
- Managed write support only where paths, formats, validation, redaction, and
  rollback are reliable.
- Bounded read-only support for safe text configuration that cannot yet be
  edited safely.
- Explicit exclusion or unsupported rationale for everything else.

The five revision specifications were approved on 2026-09-21. Planning may
proceed against their module IDs and dependency order; implementation still
requires an approved plan.

## Objective

Build a lightweight macOS tray and desktop application for managing the current
user's application configuration, Homebrew-installed software, selected
Homebrew services, and basic machine capabilities.

The primary window must feel like a purpose-built desktop utility rather than a
responsive web dashboard embedded in a native shell.

The primary user is a developer or advanced macOS user who wants one local UI
for answering:

- Which supported applications are present in my home directory?
- Which Homebrew formulae and casks are installed?
- Which configuration files belong to each supported application?
- Can I safely edit and apply those configurations?
- Can I install, upgrade, uninstall, start, stop, or restart an application
  without manually reconstructing the corresponding command?
- What relevant capabilities are available on this Mac?

The application is local-first: configuration files and Homebrew remain the
source of truth. UserHome does not require an account, cloud service, telemetry,
or remote control.

## Approved Scope

### MVP capabilities

- macOS desktop window and menu-bar tray built with Tauri 2.
- Fixed-size, non-resizable main window with a frameless top region and
  platform-appropriate native window controls.
- Tailwind CSS for semantic design tokens and layout, with Headless UI for
  accessible interaction primitives.
- Startup scan plus explicit manual refresh.
- Detection of supported applications from home-directory paths, executables,
  Homebrew formulae/casks, and Homebrew services.
- General inventory for all installed Homebrew formulae and casks.
- Homebrew install, upgrade, uninstall, and service operations with preview and
  explicit confirmation.
- Structured configuration for well-understood fields plus an advanced raw
  editor for supported files.
- Initial deep integrations, retained as the compatibility baseline:
  - GitHub Copilot CLI: `~/.copilot`
  - Caddy: `${HOMEBREW_PREFIX}/etc/Caddyfile`
  - Git: `~/.gitconfig`
  - OpenSSH: `~/.ssh/config`
  - Zsh: `~/.zshrc`
  - npm: `~/.npmrc`
- Controlled elevation for strictly allowlisted operations through a signed
  privileged helper on macOS 13 or newer.
- GitHub Actions builds for Apple Silicon and Intel macOS, with a universal
  signed and notarized release artifact when signing secrets are configured.

### Current-machine baseline

The initial catalog and manual acceptance pass use this machine as the baseline:

- macOS 26.6.2, Apple Silicon (`arm64`)
- Homebrew prefix: `/opt/homebrew`
- Homebrew version observed: 7.0.2 development build
- Installed inventory observed: 134 formulae and 40 casks
- Caddy 2.11.4 and Git 2.55.0 installed
- Caddy and Unbound visible to `brew services`
- All six initial configuration locations exist
- The current Caddyfile is a symbolic link; managed-file logic must preserve
  safe symlinks rather than replacing them blindly

No absolute username or `/Users/archie.zheng` path may be embedded in product
code. All user paths derive from the operating system at runtime.

### Explicit non-goals for MVP

- Windows or Linux support.
- Mac App Store distribution.
- Cloud sync, remote administration, accounts, analytics, or telemetry.
- Arbitrary shell execution, arbitrary root commands, or a general-purpose file
  manager.
- Automatic background file watching or periodic scans.
- Automatic application updates.
- Editing Copilot databases, logs, session state, runtime tokens, caches, or
  lock files.
- Recursively reading or editing every file below the home directory.
- Promising write support for every detected application configuration.

## Tech Stack

Versions are pinned to exact stable releases in lockfiles during scaffolding.
No prerelease dependency is permitted without explicit approval.

| Area | Choice |
|---|---|
| Desktop runtime | Tauri 2.x |
| Native backend | Rust stable, edition 2024 |
| Frontend | React stable + TypeScript strict mode |
| Frontend build | Vite stable |
| Frontend styling | Tailwind CSS 4.x + Headless UI 2.x |
| Package manager | pnpm, exact version pinned in `packageManager` |
| Native serialization | `serde` / `serde_json` |
| Frontend validation | Zod for user-entered structured values and IPC decoding |
| Unit/integration tests | Rust built-in test framework and Vitest |
| Desktop E2E | Webdriver-based Tauri-compatible harness selected during planning |
| CI/CD | GitHub Actions and `tauri-apps/tauri-action` |
| macOS elevation | Signed helper registered with `SMAppService`; narrow request protocol |

Minimum supported operating system: macOS 13. This aligns the controlled
elevation design with Apple's modern `SMAppService` API.

## Architecture

```text
React UI
  |
  | typed Tauri invoke commands and events
  v
Rust command boundary
  |
  +-- application catalog
  +-- discovery service
  +-- configuration adapters
  +-- Homebrew adapter
  +-- service adapter
  +-- operation coordinator
  |
  +-- normal user process operations
  |
  `-- signed privileged helper (allowlisted operations only)
```

### Trust boundaries

1. The WebView is untrusted input. It cannot receive direct filesystem or shell
   access.
2. Paths, configuration text, package names, and operation IDs are validated at
   the Rust command boundary.
3. Homebrew output is external process data and is parsed as untrusted input.
4. The privileged helper accepts only a versioned, typed, allowlisted request;
   it never accepts a command line, executable path, or arbitrary file path.
5. Configuration files may contain secrets. Their contents are never logged,
   included in crash reports, or emitted in operation events.

### Tauri permissions

- The main window receives only the core permissions required for window,
  event, tray, and invoke behavior.
- The frontend does not receive `shell:allow-execute`.
- The frontend does not receive broad `$HOME/**` filesystem scope.
- Filesystem and process operations are implemented as Rust commands, where
  catalog IDs are resolved to server-owned path and command definitions.
- Development-only permissions must not appear in release capabilities.

This follows Tauri 2's capability and permission model:

- https://v2.tauri.app/security/capabilities/
- https://v2.tauri.app/security/permissions/
- https://v2.tauri.app/security/scope/
- https://v2.tauri.app/develop/calling-rust/

## Shared IPC Contract

Rust commands return typed data or a single error shape:

```typescript
type AppErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "NOT_SUPPORTED"
  | "PERMISSION_DENIED"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "PROCESS_FAILED"
  | "TIMEOUT"
  | "ELEVATION_REQUIRED"
  | "ELEVATION_UNAVAILABLE"
  | "INTERNAL";

interface AppError {
  code: AppErrorCode;
  message: string;
  details?: Record<string, string | number | boolean>;
  retryable: boolean;
}

interface OperationPreview {
  operationId: string;
  summary: string;
  effects: string[];
  requiresElevation: boolean;
  expiresAt: string;
}
```

Rules:

- Inputs and outputs use `camelCase`; Rust internal fields use `snake_case` with
  explicit serde renames.
- Errors never contain stack traces, raw configuration contents, tokens, or full
  environment variables.
- State-changing operations require a preview-generated `operationId` bound to
  the normalized intent and expiring after five minutes.
- Reusing an operation ID with different parameters fails with `CONFLICT`.
- Homebrew and service mutations are serialized to avoid package-manager and
  launchd races.
- Long-running operations emit bounded progress events and retain their final
  status for the current application session.

## Commands

These are the expected project commands after scaffolding:

```bash
# Install
corepack enable
pnpm install --frozen-lockfile

# Develop
pnpm tauri dev

# Frontend verification
pnpm lint
pnpm typecheck
pnpm test

# Rust verification
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml

# Production build
pnpm tauri build --target universal-apple-darwin
```

The implementation plan may adjust exact script names after the official Tauri
scaffold creates the manifests, but CI and documentation must use one canonical
set.

## Project Structure

```text
src/
  app/                    React application shell and routing
  components/             Reusable visual components
    ui/                   Tailwind and Headless UI primitives
  features/
    dashboard/
    apps/
    brew/
    services/
    settings/
  ipc/                    Typed invoke wrappers and event decoding
  styles/                 Global tokens and component styles

src-tauri/
  capabilities/           Tauri 2 capability definitions
  src/
    catalog/              Managed application definitions
    commands/             Thin validated Tauri command handlers
    config/               Configuration adapters and safe file writes
    discovery/            macOS, home-directory, and Homebrew discovery
    brew/                 Homebrew process adapter
    services/             Caddy and brew-services behavior
    operations/           Preview, confirmation, progress, and serialization
    security/             Path policy, redaction, and privilege boundary
    tray/                 Menu-bar state and actions
    error.rs               Shared error contract
    lib.rs
  helper/                 macOS privileged helper target and protocol

.github/workflows/
  ci.yml                  Lint, typecheck, native checks, and build smoke test
  release.yml             Tagged universal macOS release

docs/
  threat-model.md
  managed-app-schema.md

CAPABILITY-MAP.md
SPEC.md
SPEC-*.md
```

## Code Style

Prefer narrow typed commands and catalog-owned identifiers over strings supplied
by the UI:

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadConfigRequest {
    app_id: AppId,
    config_id: ConfigId,
}

#[tauri::command]
async fn read_config(
    state: tauri::State<'_, AppState>,
    request: ReadConfigRequest,
) -> Result<ConfigDocument, AppError> {
    state.config_service.read(request).await
}
```

Conventions:

- Rust modules and functions: `snake_case`; types: `PascalCase`.
- TypeScript variables and functions: `camelCase`; components and types:
  `PascalCase`.
- No `any`, unchecked casts, `unwrap()` in user-facing paths, `sh -c`, or string
  concatenation for command execution.
- Tauri handlers validate then delegate; business logic does not live in
  command handlers or React components.
- Comments explain security invariants or non-obvious behavior only.

## Configuration Safety

- Catalog definitions own every writable path.
- User input cannot select an arbitrary path.
- Before reading or writing, canonicalize the target and validate it against an
  allowlisted root and exact catalog entry.
- Symlinks are preserved. Their resolved targets must remain under `$HOME`,
  the detected Homebrew prefix, or an exact user-approved path.
- Writes use a temporary file in the target filesystem, preserve permissions,
  flush, and atomically replace where supported.
- Every successful write creates a backup under the app support directory
  before replacement.
- Backup directories use mode `0700`; backup files use mode `0600`.
- Keep the newest 20 backups per managed file and remove older backups only
  inside the application-owned backup root.
- Structured edits preserve comments, ordering, and unmanaged sections where
  the file format permits.
- Raw editing has size limits, UTF-8 validation where applicable, a diff
  preview, format validation, and explicit confirmation.
- Secret-valued keys are masked and never returned to the UI unless the user
  explicitly enters a replacement value.

## Homebrew Safety

- Resolve the Homebrew executable once from an approved installation prefix.
- Support both `/opt/homebrew` and `/usr/local`; do not assume either exists.
- Execute Homebrew directly with argument arrays. Never invoke a shell.
- Parse machine-readable output such as `brew info --json=v2` where available.
- Validate formula/cask identifiers against Homebrew discovery results and a
  conservative identifier grammar.
- Display the exact normalized action before confirmation.
- Apply timeouts and output-size limits.
- Treat partial success as an explicit operation state, not success.
- Never run ordinary Homebrew package operations as root.

Official Homebrew references:

- https://docs.brew.sh/Manpage
- https://docs.brew.sh/Querying-Brew

## Controlled Elevation

Elevated operations are unavailable until the application and helper are signed
and the helper is successfully registered.

- Use Apple's `SMAppService` for a bundled launch daemon on macOS 13+.
- The helper and application must share the expected signing team and designated
  requirement.
- Communication uses an authenticated local IPC channel with a versioned
  request enum.
- Allowed operations are limited to predefined service actions and writes to
  predefined protected configuration targets.
- Each request includes an operation ID, exact catalog resource ID, expected
  current file hash when writing, and user confirmation timestamp.
- The helper rejects arbitrary executables, arguments, paths, environment
  values, scripts, or shell fragments.
- Elevated operations produce sanitized local audit records.
- If registration or authorization fails, the action fails closed and the UI
  explains how to proceed.

Official Apple references:

- https://developer.apple.com/documentation/servicemanagement/smappservice
- https://developer.apple.com/documentation/security/authorization-services
- https://developer.apple.com/documentation/servicemanagement/updating-your-app-package-installer-to-use-the-new-service-management-api

## Desktop and Tray Behavior

- Closing the main window hides it and leaves the tray running.
- The main window opens centered at 1120 by 720 logical pixels.
- The main window is not resizable or maximizable.
- The top region is frameless. macOS retains native traffic-light controls;
  other platforms may use accessible custom controls if platform support is
  added later.
- Only designated non-interactive regions may initiate window dragging.
- Navigation and content use bounded internal scroll regions; the document body
  does not grow beyond the fixed window.
- The tray menu provides: Open UserHome, Refresh, concise health summary, and
  Quit.
- No install, uninstall, configuration write, or service mutation is triggered
  directly from the tray.
- Startup scan is asynchronous; the window remains responsive and shows module
  progress independently.
- Manual refresh coalesces duplicate requests.
- The tray is implemented with Tauri's official tray APIs:
  https://v2.tauri.app/learn/system-tray/

## Distribution

- Pull requests run frontend and Rust verification plus an unsigned macOS build
  smoke test.
- Tags matching `v*` trigger a macOS release workflow.
- The release workflow builds a universal Apple binary and publishes a DMG and
  update-neutral archive to GitHub Releases.
- Public releases require Apple Developer ID signing and notarization.
- Signing certificates, passwords, API keys, issuer IDs, and team IDs are
  GitHub encrypted secrets and are never committed.
- If signing secrets are missing, the release job fails before publishing;
  unsigned artifacts may exist only as private CI artifacts for development.
- The privileged helper is signed and notarized with the main application.

Official Tauri references:

- https://v2.tauri.app/distribute/pipelines/github/
- https://v2.tauri.app/distribute/sign/macos/
- https://github.com/tauri-apps/tauri-action

## Testing Strategy

No test cases are created as part of this specification phase.

During implementation:

- Rust unit tests cover path policy, catalog matching, command construction,
  redaction, backup retention, parsers, and operation state transitions.
- Adapter integration tests use temporary home and Homebrew fixtures; they do
  not mutate the developer's real home directory.
- Frontend unit tests cover state rendering, validation, confirmation, and
  secret masking.
- IPC contract tests verify input/output and error serialization.
- Desktop E2E covers startup discovery, config preview/write/restore, a mocked
  Homebrew operation, tray open/hide behavior, and permission failure.
- Privileged helper tests run against a fake transport in normal CI. A signed
  helper acceptance check runs only in the protected release environment.
- Manual release verification runs on Apple Silicon and Intel macOS.

Required quality bar:

- All checks pass on every pull request.
- No unmitigated reachable critical/high dependency vulnerabilities.
- No test may read or write the real initial-user configuration.
- No release workflow prints secrets or configuration contents.

## Boundaries

### Always do

- Validate every IPC input and external process response.
- Use catalog IDs instead of frontend-supplied paths or commands.
- Show a diff or operation preview before state-changing actions.
- Back up and validate configuration before replacement.
- Preserve file permissions and safe symlinks.
- Mask secrets in UI, logs, events, and errors.
- Keep Homebrew and service mutations serialized.
- Run release signing and notarization for public builds.

### Ask first

- Add a new writable path, executable, privileged-helper operation, or managed
  application.
- Change the minimum macOS version.
- Add telemetry, networking, auto-update, cloud sync, or remote control.
- Add a dependency with install scripts or native code.
- Change backup retention or delete user-owned data.
- Publish a release or rotate signing credentials.

### Never do

- Execute arbitrary shell text or use `sh -c`.
- Accept executable paths, filesystem paths, or privileged commands from the
  frontend.
- Run Homebrew install, upgrade, or uninstall as root.
- Read or edit Copilot databases, logs, runtime token files, session state, or
  caches.
- Log configuration contents, secrets, full environment variables, or
  authorization material.
- Follow a symlink outside approved roots without exact user approval.
- Replace or delete a configuration file after failed validation.
- Publish an unsigned public release as though it were production-ready.

## Initiative Success Criteria

1. The signed application launches on macOS 13+ and remains available through
   the menu-bar tray after its main window is hidden.
2. On the baseline machine, it retains all six configured integrations and
   classifies every safely detected configuration candidate as managed
   writable, managed read-only, detected unsupported, or explicitly excluded.
3. It lists all installed Homebrew formulae and casks without blocking the UI.
4. A supported configuration can be edited through a structured form or raw
   editor, validated, diffed, backed up, written atomically, and restored.
5. Invalid configuration never replaces the current file.
6. Homebrew install, upgrade, uninstall, and service actions require a preview
   and explicit confirmation and expose accurate progress and failure output.
7. No frontend input can cause execution of an arbitrary command or access to
   an arbitrary path.
8. Elevated operations work only through the signed allowlisted helper and fail
   closed when signing, registration, authorization, or request validation is
   missing.
9. A tagged GitHub Actions workflow produces a signed and notarized universal
   macOS release when the required secrets are configured.
10. The application sends no telemetry and stores no copy of user configuration
    except protected local backups and sanitized operation metadata.

## Module Index

- [`SPEC-native-desktop-shell.md`](SPEC-native-desktop-shell.md)
- [`SPEC-home-baseline-inventory.md`](SPEC-home-baseline-inventory.md)
- [`SPEC-configuration-platform.md`](SPEC-configuration-platform.md)
- [`SPEC-catalog-expansion.md`](SPEC-catalog-expansion.md)
- [`SPEC-application-settings.md`](SPEC-application-settings.md)
- [`SPEC-platform-foundation.md`](SPEC-platform-foundation.md)
- [`SPEC-app-catalog.md`](SPEC-app-catalog.md)
- [`SPEC-system-discovery.md`](SPEC-system-discovery.md)
- [`SPEC-config-management.md`](SPEC-config-management.md)
- [`SPEC-brew-management.md`](SPEC-brew-management.md)
- [`SPEC-service-management.md`](SPEC-service-management.md)
- [`SPEC-desktop-experience.md`](SPEC-desktop-experience.md)

## Visual Identity

- The application mark combines user-home context with configuration or control
  semantics; a literal house silhouette must not be the only identifying idea.
- The mark uses simple geometry that remains recognizable at 16, 18, 22, and
  32 pixels without embedded text or fine detail.
- The source asset is `src-tauri/icons/userhome-icon.svg`; Tauri-generated
  platform assets live beside it.
- The macOS tray uses a matching single-color configuration-oriented symbol from
  `src-tauri/icons/tray-template.svg`, rendered as a template icon so it
  follows the menu bar appearance.

## Open Questions

These do not block planning but must be resolved before the first signed
release:

- Final display name: `UserHome` is the working name.
- Final bundle identifier: proposed `com.zephyr194.userhome`.
- Apple Developer Team and GitHub release repository secrets.
