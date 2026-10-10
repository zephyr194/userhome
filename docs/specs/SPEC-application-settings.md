# Spec: application-settings

Status: Approved on 2026-09-21

## Objective

Replace the current Settings placeholder with a complete, persisted local
preferences module appropriate for a macOS desktop utility.

Settings affect UserHome behavior only. They do not silently alter managed
application configuration, delete user-owned files, enable telemetry, or grant
new filesystem authority.

## Settings Groups

### Appearance

- Appearance: System, Light, or Dark.
- Compact density is the default and the only density in this revision.
- Reduced motion follows the operating system.
- Status is never communicated by color alone.

### General

- Open the main window when UserHome launches.
- Closing the window keeps the tray running by default.
- Restore the last selected section and selected item when safe.
- Launch at login is displayed only when a supported, approved Tauri mechanism
  is available; enabling it requires explicit user action.

### Refresh

- Refresh on application launch.
- Refresh when the hidden window is reopened.
- Per-provider timeout controls use bounded presets rather than arbitrary
  values.
- Periodic background scanning remains disabled and outside this revision.

### Configuration and backups

- Default to structured editors when available.
- Show raw/advanced editors only after explicit selection.
- Configure app-owned backup retention from bounded presets.
- Show backup storage size and open the app-owned backup location.
- Clearing backups is a separate destructive action with an exact count,
  location, and confirmation.

### Privacy and discovery

- Explain active scan roots and metadata-only discovery.
- Allow the user to disable optional candidate roots without changing catalog
  authorization.
- Display paths using `~` and root aliases by default.
- No telemetry, cloud sync, account, or remote access setting exists.

### Diagnostics

- Show app version, architecture, macOS version, catalog version, helper state,
  last refresh, and provider health.
- Export a sanitized diagnostic report that contains no configuration content,
  secrets, absolute username, environment dump, or authorization material.
- Copying diagnostic information is an explicit user action.

### Reset

- Reset UserHome preferences to safe defaults.
- Reset does not alter managed application configuration.
- Backup deletion and preference reset are separate operations.

## Persistence Model

Preferences are stored as versioned JSON under UserHome's application support
directory:

```text
schemaVersion
appearance
openWindowOnLaunch
closeBehavior
restoreSelection
refreshOnLaunch
refreshOnReopen
providerTimeoutPreset
preferredEditorMode
backupRetention
optionalDiscoveryRoots
```

- Unknown or invalid values fail to safe defaults with a visible diagnostic.
- Migrations are additive and preserve recognized preferences.
- Writes are atomic and limited to the app-owned preferences file.
- The frontend sends typed values, never a storage path.

## Interfaces and Dependencies

```text
get_preferences() -> UserPreferences
update_preferences(patch) -> UserPreferences
reset_preferences() -> UserPreferences
get_diagnostics() -> DiagnosticsSummary
export_diagnostics() -> SanitizedDiagnostics
preview_clear_backups() -> OperationPreview
clear_backups(operationId) -> OperationResult
```

The module consumes layout and menu slots from `native-desktop-shell` and backup
policy capabilities from `configuration-platform`.

## Tech Stack and Project Structure

```text
src/features/settings/             settings sidebar and grouped detail panes
src/app/                           command shortcuts and preference hydration
src/ipc/settings.ts                typed settings and diagnostics IPC
src-tauri/src/settings/            persistence, migration, and validation
src-tauri/src/commands/settings.rs thin command boundary
src-tauri/src/tray/                lifecycle preference application
```

Use existing Tauri and serialization capabilities where possible. A launch-at-
login plugin or native integration is a new dependency and requires explicit
approval before implementation.

## Code Style

Use explicit typed patches:

```typescript
type UpdatePreferencesRequest = {
  appearance?: "system" | "light" | "dark";
  refreshOnLaunch?: boolean;
  backupRetention?: 5 | 10 | 20;
};
```

Do not persist arbitrary form objects or silently ignore invalid values.

## Commands and Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e
pnpm build:unsigned
```

No test cases are written during this specification phase. Existing suites and
manual application restart checks verify persistence during implementation.

## Acceptance Criteria

- The Settings route contains no placeholder content.
- `Command+,` opens Settings and restores the previously selected settings
  group.
- Appearance changes apply immediately and persist across restart.
- General, refresh, editor, backup, privacy, and diagnostics preferences load
  from a versioned validated store.
- Invalid persisted preferences fall back safely and display a non-secret
  diagnostic.
- Reset returns preferences to documented defaults without touching managed
  application files or backups.
- Backup clearing uses preview and explicit confirmation and cannot target
  outside the app-owned backup root.
- Exported diagnostics contain no configuration content, secrets, username,
  absolute home path, environment dump, or authorization data.
- Settings remain usable at 1120 by 720 without document-level scrolling.

## Boundaries

### Always

- Persist only UserHome preferences under the app-owned support directory.
- Apply safe defaults and validate every IPC update.
- Separate preference reset, backup deletion, and managed-config mutation.

### Ask first

- Add launch-at-login dependencies, background polling, notifications,
  analytics, cloud sync, auto-update, or new destructive settings.

### Never

- Store secrets, configuration contents, arbitrary paths, or environment dumps
  in preferences or diagnostics.
- Make a setting grant filesystem, shell, service, or elevation authority.
- Reset or delete managed user configuration as part of preference reset.

## Open Questions

Launch at login remains visible only if its implementation dependency is
separately approved. All other settings groups are in scope.
