# UserHome Task Checklist

Status: Approved for incremental execution on 2026-09-20

## T01: Scaffold the pinned Tauri workspace

**Status:** Done on 2026-09-20

**Description:** Create the official Tauri 2 React/TypeScript workspace, pin
stable tool versions, and expose the canonical development and verification
scripts. Generated scaffold files are the one sizing exception; manual
customization remains limited to the listed project entry points.

**Acceptance criteria:**
- [x] `pnpm tauri dev` launches the default macOS application.
- [x] Node, pnpm, Rust, Tauri, React, and Vite versions are pinned by manifests
      and lockfiles.
- [x] Canonical lint, typecheck, test, Rust-check, and build scripts exist.

**Verification:**
- [x] `pnpm typecheck`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml`
- [x] Manual: launch and close the scaffolded application.

**Dependencies:** None

**Files likely touched:** `package.json`, `pnpm-lock.yaml`, `src/main.tsx`,
`src/App.tsx`, generated `src-tauri/` scaffold

**Estimated scope:** M, generated scaffold exception

## T02: Establish secure IPC and capability boundaries

**Status:** Done on 2026-09-20

**Description:** Define the shared Rust error model, a minimal typed status
command, the frontend invoke wrapper, and least-privilege Tauri capabilities.

**Acceptance criteria:**
- [x] A frontend status request returns a typed success response or `AppError`.
- [x] Release capabilities expose no shell execution or broad `$HOME` access.
- [x] Error serialization excludes stack traces and sensitive values.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml ipc`
- [x] `pnpm vitest run src/ipc`
- [x] Inspect generated Tauri ACL/capability output.

**Dependencies:** T01

**Files likely touched:** `src-tauri/capabilities/default.json`,
`src-tauri/src/error.rs`, `src-tauri/src/commands/status.rs`,
`src-tauri/src/lib.rs`, `src/ipc/core.ts`

**Estimated scope:** M

## Checkpoint A: Security Contract

- [x] T01-T02 acceptance criteria pass.
- [x] Full TypeScript and Rust checks pass.
- [x] Independent review confirms the initial capability boundary.

## T03: Add operation preview and lifecycle coordination

**Status:** Done on 2026-09-20

**Description:** Implement expiring intent-bound operation previews, operation
state transitions, sanitized progress events, cancellation semantics, and a
single mutation lock.

**Acceptance criteria:**
- [x] An operation ID cannot authorize changed parameters or an expired intent.
- [x] Conflicting mutations return `CONFLICT` instead of running concurrently.
- [x] Progress and final events use bounded, redacted payloads.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml operations`
- [x] `pnpm vitest run src/ipc/operations`
- [x] Manual: inspect a mocked preview-progress-result flow.

**Dependencies:** T02

**Files likely touched:** `src-tauri/src/operations/mod.rs`,
`src-tauri/src/operations/store.rs`, `src-tauri/src/commands/operations.rs`,
`src/ipc/operations.ts`, `src/features/operations/OperationStatus.tsx`

**Estimated scope:** M

## T04: Deliver the desktop window and tray shell

**Status:** Implementation complete on 2026-09-20; manual tray interaction
verification blocked by local Orca Computer Use permission.

**Description:** Implement the main layout, close-to-hide lifecycle, tray menu,
open/focus behavior, refresh trigger, status placeholder, and quit action.

**Acceptance criteria:**
- [x] Closing hides the window without exiting.
- [x] Tray Open restores/focuses, Refresh emits one request, and Quit exits.
- [x] No mutating application action is available from the tray.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml tray`
- [x] `pnpm vitest run src/app`
- [ ] Manual: exercise close, open, refresh, and quit from the tray. `pnpm tauri
      dev` launched the real 800x600 macOS window successfully, but Orca could
      not enumerate the unsigned development window for interaction.

**Evidence:** `pnpm check` and `pnpm build` pass. The tray uses namespaced menu
IDs, a disabled status item, exact event listen/unlisten permissions, and no
mutation actions. T05's embedded WebDriver smoke test also launched the real
macOS window and confirmed the `UserHome` title, main navigation, Dashboard,
and live backend status. It did not exercise tray clicks, so the manual
criterion remains open. Orca Run `run_d0fb24c338ec` has both review tasks
completed from recovered reports and no reclaimable workers; two abandoned
dispatches remain retained because Orca rejected release with
`identity_unproven`.

**Dependencies:** T02, T03

**Files likely touched:** `src-tauri/src/tray/mod.rs`, `src-tauri/src/lib.rs`,
`src/app/AppShell.tsx`, `src/app/routes.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T05: Establish automated verification and CI baseline

**Status:** Implementation and local verification complete on 2026-09-20;
the first GitHub-hosted pull-request run remains pending until the repository is
pushed.

**Description:** Configure Vitest with official Tauri IPC mocks, WebdriverIO
with the embedded Tauri service for macOS, and pull-request CI with an unsigned
build smoke test.

**Acceptance criteria:**
- [x] Frontend IPC tests run without a real backend and clear mocks per test.
- [x] A macOS desktop E2E smoke test launches and inspects the application.
- [x] Pull-request CI is configured for frontend, Rust, E2E smoke, and unsigned
      build checks.

**Verification:**
- [x] `pnpm test`
- [x] `pnpm test:e2e`
- [x] `pnpm check:rust`
- [x] `pnpm build:unsigned`
- [x] Parse `.github/workflows/ci.yml` successfully as YAML.
- [ ] Observe a successful GitHub-hosted pull-request run after the first push.

**Evidence:** Vitest ran 11 tests across 5 files with global
`clearMocks()` teardown. WebdriverIO 9.31 with `@wdio/tauri-service` 1.4 used
the embedded provider, passed all six environment diagnostics, launched the
debug macOS binary, and inspected the title, navigation, Dashboard heading, and
live IPC status. The E2E-only Cargo feature and inline capability keep WDIO
plugins, `withGlobalTauri`, and `wdio:default` out of normal builds. The service
emits a non-fatal upstream teardown warning after WebDriver has already deleted
the session; the smoke test still exits successfully. Local commands ran under
Node 20.20.2 with an engine warning, while CI is pinned to the required Node
24.21.0 from `.node-version`.

**Dependencies:** T01, T02, T04

**Files likely touched:** `vitest.config.ts`, `src/test/setup.ts`,
`wdio.conf.ts`, `e2e/smoke.spec.ts`, `.github/workflows/ci.yml`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.e2e.conf.json`

**Estimated scope:** M

## Checkpoint B: Runnable Shell

- [ ] T03-T05 acceptance criteria pass.
- [ ] Application lifecycle works through the real tray.
- [x] CI and local verification use the same canonical commands.

## T06: Deliver the six-application catalog and Applications list

**Status:** Implementation and automated verification complete on 2026-09-20;
manual visual inspection remains unverified.

**Description:** Implement the versioned catalog schema, six approved
definitions, catalog validation, typed IPC, and a read-only Applications list.

**Acceptance criteria:**
- [x] Catalog validation rejects duplicate IDs, unsafe paths, missing adapters,
      and unbounded documents.
- [x] Copilot, Caddy, Git, OpenSSH, Zsh, and npm definitions load.
- [x] The UI renders definitions without receiving writable paths as authority.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm vitest run src/features/apps`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm test:e2e` launches the macOS app, opens Applications, and verifies
      six cards from the real catalog IPC.
- [ ] Manual: inspect the six applications in the list.

**Evidence:** The backend loads a schema-versioned, 64 KiB-bounded static
catalog and rejects unsupported versions, more than 32 apps, duplicate app or
config IDs, unsafe home/Homebrew path templates, missing or unknown
adapters/validators, unsupported formats/policies, and zero or oversized file
limits. The IPC response exposes only identity, capability, and count summaries;
authoritative paths remain in Rust. Frontend decoding independently bounds and
normalizes the response before the read-only Applications page renders it.

**Dependencies:** T02

**Files likely touched:** `src-tauri/src/catalog/mod.rs`,
`src-tauri/src/catalog/definitions.rs`,
`src-tauri/src/catalog/catalog-v1.json`,
`src-tauri/src/commands/catalog.rs`, `src/ipc/catalog.ts`,
`src/features/apps/ApplicationsPage.tsx`

**Estimated scope:** M

## T07: Deliver local macOS capability discovery and Dashboard summary

**Description:** Discover macOS version, architecture, home location, shell,
catalog path metadata, and executable evidence, then render partial results on
the Dashboard.

**Acceptance criteria:**
- [x] Local metadata appears without reading managed file contents.
- [x] Detection evidence distinguishes config and executable presence.
- [x] Local discovery failure is isolated and represented as partial status.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml discovery::system`
- [x] `pnpm vitest run src/features/dashboard`
- [x] Manual: displayed macOS `26.6.2` and `arm64` matched `sw_vers` and
      `uname -m`.

**Evidence:** Discovery reads only `symlink_metadata` for catalog paths, resolves
executables from fixed system/Homebrew directories, and returns independent
macOS version, architecture, home, shell, application evidence, and bounded
issues. The Dashboard renders local results while Homebrew remains loading, and
the desktop E2E verifies the real summary.

**Dependencies:** T06

**Files likely touched:** `src-tauri/src/discovery/system.rs`,
`src-tauri/src/commands/discovery.rs`, `src/ipc/discovery.ts`,
`src/features/dashboard/DashboardPage.tsx`,
`src/features/dashboard/SystemSummary.tsx`

**Estimated scope:** M

## T08: Deliver read-only Homebrew inventory

**Description:** Resolve a trusted Homebrew installation, parse installed
formula/cask JSON, expose paginated typed results, and render a responsive
inventory page.

**Acceptance criteria:**
- [x] `/opt/homebrew` and `/usr/local` installations are supported.
- [x] Formulae and casks are distinct and malformed output fails explicitly.
- [x] Inventory loading does not block the rest of the UI.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml brew::inventory`
- [x] `pnpm vitest run src/features/brew`
- [x] Manual: `/opt/homebrew` reported Homebrew `7.0.2-11-g92bb882`, 134
      formulae, and 40 casks; the desktop inventory summary matched.

**Evidence:** The backend accepts only canonical Homebrew binaries rooted under
the two approved prefixes, invokes fixed argument arrays without a shell, caps
output, parses JSON v2 defensively, and paginates typed formula/cask results.
Missing Homebrew renders a usable read-only empty state.

**Dependencies:** T03, T07

**Files likely touched:** `src-tauri/src/brew/client.rs`,
`src-tauri/src/brew/inventory.rs`, `src-tauri/src/commands/brew.rs`,
`src/ipc/brew.ts`, `src/features/brew/BrewInventoryPage.tsx`

**Estimated scope:** M

## T09: Deliver coalesced refresh and unmanaged dot-directory candidates

**Description:** Coordinate startup/manual refresh across local and Homebrew
discovery and expose shallow, read-only unknown dot-directory candidates.

**Acceptance criteria:**
- [x] Duplicate refresh requests join one active scan.
- [x] Unknown candidates expose names and metadata only, never file contents.
- [x] Per-module timeout and failure preserve completed partial results.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml discovery::refresh`
- [x] `pnpm vitest run src/features/apps/UnmanagedCandidates`
- [x] Desktop E2E sends concurrent refresh requests and verifies the same
      refresh ID is returned.

**Evidence:** A shared coordinator joins concurrent callers, publishes local
results before the longer Homebrew module settles, applies independent module
deadlines, and retains successful modules when another fails. Candidate
discovery performs one shallow `read_dir`, excludes catalog-owned dot
directories, and exposes only name, entry kind, and modification time.

**Dependencies:** T07, T08

**Files likely touched:** `src-tauri/src/discovery/refresh.rs`,
`src-tauri/src/discovery/candidates.rs`,
`src-tauri/src/commands/discovery.rs`, `src/ipc/discovery.ts`,
`src/features/apps/UnmanagedCandidates.tsx`

**Estimated scope:** M

## Checkpoint C: Read-Only MVP

- [x] T06-T09 acceptance criteria pass.
- [x] Six integrations and Homebrew inventory work on the baseline machine.
- [x] Missing Homebrew fixture produces a usable partial application.

## T10: Deliver authorized configuration reading

**Description:** Implement catalog-owned path resolution, symlink policy,
metadata/hash reading, secret classification, typed IPC, and the read-only
configuration details UI.

**Acceptance criteria:**
- [x] Frontend input cannot select an arbitrary path.
- [x] Safe symlinks are reported and disallowed targets fail closed.
- [x] Excluded Copilot/private-key/runtime files cannot be read.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::read`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml security::paths`
- [x] `pnpm vitest run src/features/apps/ConfigDetails`

**Dependencies:** T03, T06, T07

**Files likely touched:** `src-tauri/src/security/paths.rs`,
`src-tauri/src/config/read.rs`, `src-tauri/src/commands/config.rs`,
`src/ipc/config.ts`, `src/features/apps/ConfigDetails.tsx`

**Estimated scope:** M

## T11: Deliver validated preview, backup, and atomic write

**Description:** Implement size/encoding validation, content hashing, diff
preview, protected backups, atomic replacement, permission preservation, and
rollback on post-write failure.

**Acceptance criteria:**
- [x] Invalid or stale content cannot replace the current file.
- [x] Successful writes create mode-protected backups and preserve permissions.
- [x] Post-write validation failure restores the exact prior bytes.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::write`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::backup`
- [x] Fixture workflow executes only against temporary homes.

**Dependencies:** T03, T10

**Files likely touched:** `src-tauri/src/config/write.rs`,
`src-tauri/src/config/backup.rs`, `src-tauri/src/config/diff.rs`,
`src-tauri/src/commands/config.rs`, `src/features/apps/ConfigWritePreview.tsx`

**Estimated scope:** M

## T12: Deliver backup restore and operation history

**Description:** List protected backups, preview and execute restore, enforce
retention under the app-owned backup root, and expose sanitized history.

**Acceptance criteria:**
- [x] Restore uses the same hash, preview, validation, and confirmation rules.
- [x] Retention deletes only owned backups beyond the newest 20.
- [x] History contains no configuration contents or secret values.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::restore`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::retention`
- [x] `pnpm vitest run src/features/apps/BackupHistory`

**Dependencies:** T11

**Files likely touched:** `src-tauri/src/config/restore.rs`,
`src-tauri/src/config/backup.rs`, `src-tauri/src/commands/config.rs`,
`src/features/apps/BackupHistory.tsx`,
`src/features/operations/OperationHistory.tsx`

**Estimated scope:** M

## Checkpoint D: Safe Editing Core

- [x] T10-T12 acceptance criteria pass.
- [x] Fixture write and restore preserve bytes, permissions, and safe symlinks.
- [x] Security review confirms path and backup containment.

## T13: Deliver the GitHub Copilot configuration adapter

**Status:** Done on 2026-09-20

**Description:** Manage approved Copilot JSON and instruction documents,
validate supported schemas, mask sensitive values, and enforce the exclusion
list.

**Acceptance criteria:**
- [x] Approved JSON/instruction files support structured or raw validated edits.
- [x] Databases, logs, sessions, caches, locks, and runtime tokens are excluded.
- [x] Unknown keys are preserved and unsupported keys are not invented.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::adapters::copilot`
- [x] `pnpm vitest run src/features/apps/editors/CopilotEditor`
- [x] Fixture: approved metadata and redacted JSON are readable without
      cataloging excluded runtime paths.

**Dependencies:** T11

**Files likely touched:** `src-tauri/src/config/adapters/copilot.rs`,
`src-tauri/src/catalog/definitions.rs`, `src-tauri/src/config/validators/json.rs`,
`src/features/apps/editors/CopilotEditor.tsx`,
`src/features/apps/editors/RawConfigEditor.tsx`

**Estimated scope:** M

## T14: Deliver the Caddy configuration adapter

**Status:** Done on 2026-09-20

**Description:** Add common structured Caddy fields, raw Caddyfile editing,
allowlisted `caddy validate`, and symlink-preserving writes.

**Acceptance criteria:**
- [x] Invalid Caddyfile content fails before replacement.
- [x] The baseline symbolic link remains a symbolic link after fixture-proven
      writes.
- [x] Structured edits preserve unsupported Caddyfile sections.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::adapters::caddy`
- [x] `pnpm vitest run src/features/apps/editors/CaddyEditor`
- [x] Fixture: validate and atomically write a temporary symlinked Caddyfile,
      never the live file.

**Dependencies:** T08, T11

**Files likely touched:** `src-tauri/src/config/adapters/caddy.rs`,
`src-tauri/src/config/validators/caddy.rs`,
`src-tauri/src/catalog/definitions.rs`,
`src/features/apps/editors/CaddyEditor.tsx`,
`src/features/apps/editors/RawConfigEditor.tsx`

**Estimated scope:** M

## T15: Deliver the Git configuration adapter

**Status:** Done on 2026-09-20

**Description:** Support selected global Git identity, default-branch, alias,
and safe settings while preserving unrelated configuration and includes.

**Acceptance criteria:**
- [x] Structured updates preserve unrelated keys, comments, and includes.
- [x] Unsupported or sensitive credential settings remain unchanged.
- [x] Raw mode validates syntax before write.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::adapters::git`
- [x] `pnpm vitest run src/features/apps/editors/GitEditor`
- [x] Fixture: compare comments, includes, credentials, and unrelated keys
      before and after structured edits.

**Dependencies:** T11

**Files likely touched:** `src-tauri/src/config/adapters/git.rs`,
`src-tauri/src/config/validators/git.rs`,
`src-tauri/src/catalog/definitions.rs`,
`src/features/apps/editors/GitEditor.tsx`,
`src/features/apps/editors/RawConfigEditor.tsx`

**Estimated scope:** M

## Checkpoint E: First Adapter Set

- [x] T13-T15 acceptance criteria pass.
- [x] Copilot exclusions, Caddy validation, and Git preservation are reviewed.
- [x] Full config-management regression suite passes.

## T16: Deliver the OpenSSH configuration adapter

**Status:** Done on 2026-09-20

**Description:** Support managed Host entries and raw client configuration
without reading private keys or expanding access beyond `~/.ssh/config`.

**Acceptance criteria:**
- [x] Structured Host edits preserve unmanaged blocks and comments.
- [x] Private-key files and arbitrary Include targets are never read.
- [x] Unsafe permissions or syntax produce an actionable validation error.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::adapters::ssh`
- [x] `pnpm vitest run src/features/apps/editors/SshEditor`
- [x] Fixture: edit a managed Host while preserving multiple unmanaged blocks
      and rejecting unsafe permissions/includes.

**Dependencies:** T11

**Files likely touched:** `src-tauri/src/config/adapters/ssh.rs`,
`src-tauri/src/config/validators/ssh.rs`,
`src-tauri/src/catalog/definitions.rs`,
`src/features/apps/editors/SshEditor.tsx`,
`src/features/apps/editors/RawConfigEditor.tsx`

**Estimated scope:** M

## T17: Deliver the Zsh managed-block adapter

**Status:** Done on 2026-09-20

**Description:** Manage aliases, environment entries, and source statements in
a clearly delimited UserHome block while preserving the rest of `.zshrc`.

**Acceptance criteria:**
- [x] Only the UserHome block changes during structured edits.
- [x] Duplicate/corrupt markers fail with `CONFLICT`.
- [x] Raw mode retains preview, backup, size, and validation safeguards.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::adapters::zsh`
- [x] `pnpm vitest run src/features/apps/editors/ZshEditor`
- [x] Fixture: byte-compare content outside managed markers.

**Dependencies:** T11

**Files likely touched:** `src-tauri/src/config/adapters/zsh.rs`,
`src-tauri/src/config/validators/zsh.rs`,
`src-tauri/src/catalog/definitions.rs`,
`src/features/apps/editors/ZshEditor.tsx`,
`src/features/apps/editors/RawConfigEditor.tsx`

**Estimated scope:** M

## T18: Deliver the npm configuration adapter

**Status:** Done on 2026-09-20

**Description:** Manage safe user-level npm settings and replacement-only
secret fields without exposing existing auth tokens.

**Acceptance criteria:**
- [x] Registry, proxy, and strict-SSL fields support structured editing.
- [x] Existing auth values are masked and never returned as plaintext.
- [x] Secret replacement values are absent from logs, diffs, and history.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::adapters::npm`
- [x] `pnpm vitest run src/features/apps/editors/NpmEditor`
- [x] Test and E2E logs contain none of the fixture secret values.

**Dependencies:** T11

**Files likely touched:** `src-tauri/src/config/adapters/npm.rs`,
`src-tauri/src/config/redaction.rs`,
`src-tauri/src/catalog/definitions.rs`,
`src/features/apps/editors/NpmEditor.tsx`,
`src/features/apps/editors/SecretField.tsx`

**Estimated scope:** M

## Checkpoint F: Adapter Complete

- [x] T16-T18 acceptance criteria pass.
- [x] All six adapter fixture suites pass.
- [x] Adapter mutation checks use only temporary homes and fixture files.

## T19: Deliver Homebrew search and package details

**Status:** Done on 2026-09-20

**Description:** Add bounded Homebrew search, JSON-backed details, query
validation, and the package detail user flow.

**Acceptance criteria:**
- [x] Search text cannot become flags or another command.
- [x] Formula/cask details are parsed into one stable typed contract.
- [x] Timeout and malformed output are explicit retryable/non-retryable errors.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml brew::search`
- [x] `pnpm vitest run src/features/brew/BrewSearch`
- [x] Fixture/mock: search and decode formula and cask results without invoking
      a real mutation.

**Evidence:** Search rejects empty, control-character, and flag-shaped input
before process execution. Fixed `brew search <query>` and
`brew info --json=v2 <identifier>` argument arrays feed bounded parsers, while
the TypeScript decoder enforces the same stable formula/cask detail shape.

**Dependencies:** T08

**Files likely touched:** `src-tauri/src/brew/search.rs`,
`src-tauri/src/brew/details.rs`, `src-tauri/src/commands/brew.rs`,
`src/features/brew/BrewSearch.tsx`, `src/features/brew/BrewPackageDetails.tsx`

**Estimated scope:** M

## T20: Deliver confirmed Homebrew installation

**Status:** Done on 2026-09-20

**Description:** Implement allowlisted formula/cask install previews,
confirmation, serialized execution, bounded progress, and inventory refresh.

**Acceptance criteria:**
- [x] Preview identifies package kind, identifier, command effect, and no
      elevation.
- [x] Install executes only a backend enum-defined argument shape.
- [x] Success and failure refresh inventory and preserve full operation state.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml brew::install`
- [x] `pnpm vitest run src/features/brew/BrewInstall`
- [x] Mocked Homebrew preview-confirm-result flow; no real package was changed.

**Evidence:** The global operation coordinator serializes installation with all
other mutations. Progress and output use existing bounded redaction, and the
backend refreshes inventory after both successful and failed commands.

**Dependencies:** T03, T19

**Files likely touched:** `src-tauri/src/brew/actions.rs`,
`src-tauri/src/commands/brew.rs`, `src/ipc/brew.ts`,
`src/features/brew/BrewActionDialog.tsx`,
`src/features/operations/OperationStatus.tsx`

**Estimated scope:** M

## T21: Deliver confirmed Homebrew upgrade and uninstall

**Status:** Done on 2026-09-20

**Description:** Extend the verified mutation path with single-package upgrade
and uninstall, explicit destructive copy, and partial-failure handling.

**Acceptance criteria:**
- [x] Upgrade and uninstall require separate intent-bound previews.
- [x] Uninstall labels the exact package and destructive effect.
- [x] Package-manager conflicts and partial success are distinct outcomes.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml brew::upgrade`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml brew::uninstall`
- [x] `pnpm vitest run src/features/brew/BrewActionDialog`

**Evidence:** Install, upgrade, and uninstall each receive a unique operation ID
in mocked flows. Homebrew lock diagnostics map to retryable `CONFLICT`, while a
completed command whose inventory cannot be refreshed maps to
`PARTIAL_FAILURE`.

**Dependencies:** T20

**Files likely touched:** `src-tauri/src/brew/actions.rs`,
`src-tauri/src/commands/brew.rs`, `src/ipc/brew.ts`,
`src/features/brew/BrewActionDialog.tsx`,
`src/features/brew/BrewPackageDetails.tsx`

**Estimated scope:** M

## Checkpoint G: Homebrew Management

- [x] T19-T21 acceptance criteria pass.
- [x] No process path uses a shell or root.
- [x] E2E mocked install, upgrade, and uninstall flows pass.

## T22: Deliver service inventory and Caddy service details

**Status:** Done on 2026-09-20

**Description:** Parse `brew services list`, expose user/system scope and
status, enrich Caddy with config validity, and keep unknown services read-only.

**Acceptance criteria:**
- [x] Caddy and baseline Unbound entries are recognized from CLI output.
- [x] Caddy details show config validity independently from service state.
- [x] Unknown services expose no mutation controls.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml services::inventory`
- [x] `pnpm vitest run src/features/services`
- [x] Fixture/mock: compare Caddy, Unbound, and unknown-service rendering with
      bounded `brew services list --json` fixtures.

**Evidence:** The parser exposes `USER`, `SYSTEM`, and `UNKNOWN` scope and
normalizes service state without trusting command output as authority. Only
user-level Caddy is marked manageable; Caddy package version and Caddyfile
validity remain separate detail fields.

**Dependencies:** T08, T14

**Files likely touched:** `src-tauri/src/services/inventory.rs`,
`src-tauri/src/commands/services.rs`, `src/ipc/services.ts`,
`src/features/services/ServicesPage.tsx`,
`src/features/services/ServiceDetails.tsx`

**Estimated scope:** M

## T23: Deliver user-level service actions

**Status:** Done on 2026-09-20

**Description:** Implement separate preview/confirmation flows for user-level
Caddy start, stop, and restart, followed by verified state refresh.

**Acceptance criteria:**
- [x] Start, stop, and restart have distinct previews and operation IDs.
- [x] User-level actions never invoke elevation.
- [x] Reported success requires refreshed service state, not exit code alone.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml services::actions`
- [x] `pnpm vitest run src/features/services/ServiceActionDialog`
- [x] Mocked user-level start, stop, and restart flows; no real service state
      was changed.

**Evidence:** Each action is separately previewed and bound to `caddy` plus
`USER` scope. Restart requires independently valid Caddy configuration, and a
zero exit code is insufficient: refreshed state must be `STARTED` for
start/restart or `STOPPED` for stop.

**Dependencies:** T03, T22

**Files likely touched:** `src-tauri/src/services/actions.rs`,
`src-tauri/src/commands/services.rs`, `src/ipc/services.ts`,
`src/features/services/ServiceActionDialog.tsx`,
`src/features/operations/OperationStatus.tsx`

**Estimated scope:** M

## Checkpoint H: User-Level Services

- [x] T22-T23 acceptance criteria pass.
- [x] Caddy config write remains separate from restart.
- [x] Unknown services remain read-only.

## T24: Define and test the privileged-helper protocol

**Description:** Define the versioned allowlisted elevation request/response
contract, signing identity expectations, fake transport, replay protection, and
audit metadata before introducing a real helper.

**Acceptance criteria:**
- [x] Protocol accepts resource/action IDs but no arbitrary path or command.
- [x] Unknown versions/actions, stale operations, and changed hashes fail closed.
- [x] Fake transport exercises success, denial, timeout, and tampering.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml security::elevation`
- [x] Review serialized protocol fixtures for secret/path leakage.
- [x] Threat-model review of the helper trust boundary.

**Dependencies:** T02, T03

**Files likely touched:** `src-tauri/src/security/elevation.rs`,
`src-tauri/src/security/elevation_protocol.rs`,
`src-tauri/src/security/elevation_fake.rs`,
`src-tauri/src/commands/elevation.rs`, `docs/threat-model.md`

**Estimated scope:** M

## T25: Register the signed macOS helper with SMAppService

**Description:** Add the bundled helper target, launch-daemon metadata,
application registration bridge, code-signing requirement checks, and
availability status.

**Acceptance criteria:**
- [ ] Signed development builds can register and report helper status on
      macOS 13+.
- [x] Main app and helper validate the expected signing relationship.
- [x] Missing signing or user authorization reports unavailable and fails closed.

**Verification:**
- [ ] Build the helper and main app with development signing.
- [ ] Manual: register, inspect status, deny authorization, and unregister.
- [x] Confirm unsigned CI uses the fake transport and cannot claim availability.

**Blocked evidence (2026-09-20):** `security find-identity -v -p codesigning`
reported `0 valid identities found`; signed registration checks cannot run on
this machine.

**Dependencies:** T24; Apple signing prerequisite for real-path verification

**Files likely touched:** `src-tauri/helper/Package.swift`,
`src-tauri/helper/Sources/UserHomeHelper/main.swift`,
`src-tauri/helper/LaunchDaemons/com.zephyr194.userhome.helper.plist`,
`src-tauri/src/security/elevation_macos.rs`, `src-tauri/tauri.conf.json`

**Estimated scope:** M

## T26: Integrate elevated configuration and service operations

**Description:** Route catalog-declared protected writes and system-level Caddy
service actions through the real helper while preserving preview, hash,
confirmation, and audit rules.

**Acceptance criteria:**
- [x] Only catalog-declared protected resources can request elevation.
- [x] Helper and application independently validate operation ID, resource,
      action, and expected hash.
- [x] Denial, disconnect, timeout, and partial failure are explicit and safe.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml security::elevated_actions`
- [x] E2E fake-transport elevated action flow.
- [ ] Manual signed-helper check against a disposable protected fixture.

**Blocked evidence (2026-09-20):** the disposable real-helper mutation check
requires the same unavailable Apple development signing identity.

**Dependencies:** T11, T23, T25

**Files likely touched:** `src-tauri/src/security/elevation_macos.rs`,
`src-tauri/src/config/write.rs`, `src-tauri/src/services/actions.rs`,
`src/features/services/ServiceActionDialog.tsx`,
`src/features/apps/ConfigWritePreview.tsx`

**Estimated scope:** M

## Checkpoint I: Elevation Boundary

- [ ] T24-T26 acceptance criteria pass.
- [x] Security review finds no arbitrary command/path capability.
- [x] Unsigned and unauthorized states fail closed.

## T27: Complete desktop resilience, accessibility, and tray summaries

**Description:** Finish loading/empty/partial/error states, keyboard and focus
behavior, accessible status semantics, persistent operation visibility, and
read-only tray summaries.

**Acceptance criteria:**
- [x] All primary flows use native keyboard controls, visible focus, and
      route/dialog focus management.
- [x] Partial module failure does not collapse unrelated features.
- [x] Tray summaries are read-only and reflect the latest backend-observed
      app/service state.

**Verification:**
- [x] `pnpm vitest run src/features src/components` (22 files, 36 tests)
- [x] `pnpm test:e2e` (1 desktop smoke test)
- [ ] Manual keyboard, VoiceOver, contrast, and reduced-motion pass; blocked
      pending interactive accessibility review.

**Dependencies:** T12, T13-T23, T26

**Files likely touched:** `src/app/AppShell.tsx`,
`src/components/AsyncState.tsx`, `src/components/ConfirmDialog.tsx`,
`src-tauri/src/tray/mod.rs`, `src/styles/global.css`

**Estimated scope:** M

## T28: Add signed universal GitHub release workflow

**Description:** Add tagged universal macOS builds, protected signing and
notarization inputs, helper bundling, draft GitHub Release creation, and
fail-closed publishing.

**Acceptance criteria:**
- [x] Pull requests produce only short-lived GitHub Actions unsigned artifacts.
- [x] Tagged releases require signing/notarization secrets before building or
      creating a draft.
- [ ] Universal DMG/archive includes the correctly signed helper; universal
      bundling and nested architecture checks pass locally, but signed output
      requires external credentials.

**Verification:**
- [x] Validate workflow syntax and permissions locally.
- [x] Run an unsigned branch build.
- [ ] Run a protected signed/notarized draft release when credentials exist.

**Dependencies:** T05, T25, T27; release credentials for production verification

**Files likely touched:** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `src-tauri/tauri.conf.json`,
`docs/release.md`, `README.md`

**Estimated scope:** M

## T29: Run release-readiness verification and finalize documentation

**Description:** Trace every specification criterion, complete E2E and manual
baseline checks, document security and managed-app extension rules, and prepare
the change for review without publishing.

**Acceptance criteria:**
- [x] Every initiative and module acceptance criterion maps to evidence in
      `docs/release-readiness.md`.
- [x] Full checks and universal build pass; signed path is verified or clearly
      blocked by missing external credentials.
- [x] README, threat model, catalog extension, backup, and release docs match
      implemented behavior.
- [x] The approved UserHome application mark and monochrome tray template are
      generated, wired into the tray, and included in the macOS bundle.

**Verification:**
- [x] Run every command in `tasks/plan.md` Checkpoint J; the universal build
      passed in CI mode because this IDE lacks Finder automation permission.
- [x] `pnpm tauri build --target aarch64-apple-darwin`; the generated app
      bundle contains the approved `icon.icns`.
- [x] Run code-quality review, security review, and ship readiness review.
- [ ] Manual: complete the baseline-machine acceptance checklist without
      mutating live configuration unless separately approved; automated checks
      did not mutate live configuration.

**Dependencies:** T27, T28

**Files likely touched:** `README.md`, `docs/threat-model.md`,
`docs/managed-app-schema.md`, `docs/release.md`, `tasks/todo.md`

**Estimated scope:** M

## Checkpoint J: Complete

- [ ] T27-T29 acceptance criteria pass; signed/manual criteria remain blocked.
- [ ] All approved specs are satisfied or explicitly amended and re-approved;
      signed helper/release and manual baseline criteria remain external gates.
- [x] No real user configuration was mutated by automated tests.
- [x] Ready for code review and production-readiness review; production ship
      decision is NO-GO until documented external gates pass.

# Desktop Experience Optimization

Status: Approved for autonomous execution on 2026-09-20

## T30: Reconcile and pin the frontend design foundation

**Description:** Complete the already-started Tailwind CSS and Headless UI
foundation, pin exact dependency versions, and retain compatibility styling
until feature migrations remove it.

**Acceptance criteria:**
- [x] `@headlessui/react`, `tailwindcss`, and `@tailwindcss/vite` use exact
      stable versions in `package.json`.
- [x] Tailwind is connected through the Vite plugin and exposes semantic
      light/dark tokens.
- [x] Shared Button, Panel, StatusBadge, and Modal primitives compile.

**Verification:**
- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm lint && pnpm test && pnpm build`

**Dependencies:** None

**Files likely touched:** `package.json`, `pnpm-lock.yaml`, `vite.config.ts`,
`src/styles/global.css`, `src/components/ui/`

**Estimated scope:** M

## T31: Enforce the fixed frameless window contract

**Status:** Implementation and automated verification complete on 2026-09-20;
manual drag, minimize, close, reopen, and display-scaling review pending.

**Description:** Configure the main Tauri window as a centered, fixed 1120 by
720 logical-pixel window with platform-aware frameless chrome while preserving
close-to-tray behavior.

**Acceptance criteria:**
- [x] Resize and maximize are disabled and reopen preserves the intended size.
- [x] macOS native traffic lights coexist with the frameless top region.
- [x] Close still hides the window; tray Open restores and focuses it.

**Verification:**
- [x] `pnpm build:unsigned`
- [x] `pnpm test:e2e`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml tray`
- [ ] Manual: verify drag, minimize, close, reopen, and display scaling.

**Evidence:** The main Tauri window is centered at 1120 by 720 logical pixels,
cannot be resized or maximized, and uses the macOS overlay title bar with native
decorations and a hidden title. The existing desktop smoke test launches the
real app and confirms the logical size plus disabled resize/maximize state;
existing close-to-hide and tray action tests remain green.

**Dependencies:** None

**Files likely touched:** `src-tauri/tauri.conf.json`,
`src-tauri/tauri.e2e.conf.json`, `src-tauri/src/lib.rs`, `e2e/smoke.spec.ts`

**Estimated scope:** M

## T32: Replace the application and tray icon system

**Status:** Implementation and bundle verification complete on 2026-09-20;
manual app, Dock, Finder, and light/dark tray review pending.

**Description:** Replace the house-only symbol with a configuration-oriented
master SVG and matching monochrome tray artwork, then regenerate platform
assets.

**Acceptance criteria:**
- [x] The symbol remains recognizable at all shipped app and tray sizes.
- [ ] The macOS tray asset works as a template icon in light and dark modes.
- [x] Bundled PNG, ICNS, and ICO assets are generated from the approved source.

**Verification:**
- [x] Run the Tauri icon-generation command against the master SVG.
- [x] `pnpm tauri build --bundles app`
- [ ] Manual: inspect app, Dock, Finder, and tray rendering.

**Evidence:** Commit `00b2b2e` replaces both SVG sources and regenerates the
complete Tauri desktop/mobile icon matrix. The tray PNG is monochrome with
transparency and `icon_as_template` remains enabled on macOS.

**Dependencies:** None

**Files likely touched:** `src-tauri/icons/userhome-icon.svg`,
`src-tauri/icons/tray-template.svg`, `src-tauri/icons/`,
`src-tauri/tauri.conf.json`, `src-tauri/src/tray/mod.rs`

**Estimated scope:** M

## Checkpoint K: Desktop Foundation

- [ ] T30-T32 acceptance criteria pass.
- [x] Existing routes still render after the visual migration.
- [x] No stale house-only generated asset remains.

## T33: Rebuild the desktop application shell

**Description:** Replace the web-dashboard shell with an integrated title bar,
compact icon navigation, contextual toolbar, and bounded workspace.

**Acceptance criteria:**
- [x] The shell fits 1120 by 720 without document-level overflow.
- [x] Navigation, refresh, focus transfer, and status visibility are preserved.
- [x] Drag regions never overlap interactive elements.

**Verification:**
- [x] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: keyboard navigation and title-bar interaction.

**Evidence:** Commit `b6a3ea7` replaces the web-dashboard frame with a compact
desktop shell, drag-safe title region, icon navigation rail, contextual toolbar,
and internally scrolling workspace. Lint, 50 Vitest checks, type checking, and
the production frontend build pass.

**Dependencies:** T30, T31, T32

**Files likely touched:** `src/app/AppShell.tsx`,
`src/app/routeDefinitions.ts`, `src/app/routes.tsx`,
`src/components/NavigationRail.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T34: Migrate shared dialogs and asynchronous states

**Description:** Move shared modal, loading, error, empty, and disabled-state
presentation onto the Tailwind and Headless UI primitives.

**Acceptance criteria:**
- [x] Dialog focus trapping, Escape handling, focus restoration, and busy-state
      protection remain correct.
- [x] Loading, empty, partial, and error states use consistent semantics.
- [x] Legacy dialog-backdrop classes are no longer required; shared button
      classes remain only where feature pages have not yet migrated.

**Verification:**
- [x] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: keyboard-only dialog flow.

**Evidence:** Commit `8c2c7b0` moves ConfirmDialog, Modal, AsyncState, and Button
onto Headless UI and Tailwind primitives while preserving busy-state closure
protection. Lint, all 50 Vitest checks, and the production build pass.

**Dependencies:** T30, T33

**Files likely touched:** `src/components/ConfirmDialog.tsx`,
`src/components/AsyncState.tsx`, `src/components/ui/Modal.tsx`,
`src/components/ui/Button.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T35: Migrate the Dashboard and status rail

**Description:** Deliver a dense desktop summary workspace for machine,
application, Homebrew, connection, refresh, and operation state.

**Acceptance criteria:**
- [x] Information priority is clear without a uniform card grid.
- [x] Partial and failed modules remain independently understandable.
- [x] Status is communicated with text or icons as well as color.

**Verification:**
- [x] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: verify normal, loading, partial, and error states.

**Evidence:** Commit `0781a19` delivers the dense Dashboard and status rail with
independent module states and text/icon status cues. Lint, all 50 Vitest checks,
and the production build pass after integration.

**Dependencies:** T33, T34

**Files likely touched:** `src/features/dashboard/DashboardPage.tsx`,
`src/features/dashboard/SystemSummary.tsx`,
`src/features/operations/OperationStatus.tsx`, `src/app/AppShell.tsx`,
`src/styles/global.css`

**Estimated scope:** M

## T36: Migrate Homebrew inventory and actions

**Description:** Convert Homebrew inventory, search, details, pagination, and
confirmed mutations into the desktop design system.

**Acceptance criteria:**
- [x] Search and filtering fit the fixed workspace without clipped controls.
- [x] Package type, state, and available action remain explicit.
- [x] Mutation preview, progress, result, and error states remain intact.

**Verification:**
- [x] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: inventory, search, details, and confirmation flows.

**Evidence:** Commit `b6b9476` migrates Homebrew inventory, search, details,
pagination, and confirmed actions to the desktop design system while preserving
all mutation states. The integrated frontend checks pass.

**Dependencies:** T33, T34

**Files likely touched:** `src/features/brew/BrewInventoryPage.tsx`,
`src/features/brew/BrewSearch.tsx`,
`src/features/brew/BrewPackageDetails.tsx`,
`src/features/brew/BrewActionDialog.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T37: Migrate services and operation history

**Description:** Convert service inventory, details, confirmed service actions,
and operation history to the shared desktop interaction patterns.

**Acceptance criteria:**
- [x] User/system scope and read-only services remain distinguishable.
- [x] Start, stop, restart, progress, and failure states remain explicit.
- [x] Long histories scroll inside the workspace without moving the window.

**Verification:**
- [x] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: service details and operation-history navigation.

**Evidence:** Commit `21844c9` migrates service inventory, detail and confirmed
actions plus operation history to shared desktop primitives with bounded
history scrolling. The integrated frontend checks pass.

**Dependencies:** T33, T34

**Files likely touched:** `src/features/services/ServicesPage.tsx`,
`src/features/services/ServiceDetails.tsx`,
`src/features/services/ServiceActionDialog.tsx`,
`src/features/operations/OperationHistory.tsx`, `src/styles/global.css`

**Estimated scope:** M

## Checkpoint L: Desktop Interface

- [ ] T33-T37 acceptance criteria pass.
- [ ] All primary routes fit the fixed window and support keyboard navigation.
- [ ] The interface no longer presents as a generic responsive web dashboard.

## T38: Extend the catalog coverage contract

**Description:** Add explicit coverage classes and data-first rendering metadata
while preserving the current six application IDs and authorization rules.

**Acceptance criteria:**
- [x] Catalog and IPC distinguish writable, read-only, unsupported, and excluded.
- [x] Existing schema data remains compatible or migrates deterministically.
- [x] A data-only application definition requires no frontend `appId` branch.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Rust formatting, Clippy, catalog tests, and the complete Rust test suite

**Evidence:** Commit `5404400` adds coverage classes, application presentation
categories, and document-level editor keys with deterministic schema-v1
fallbacks while preserving the six existing IDs and path authorization.

**Dependencies:** None

**Files likely touched:** `src-tauri/src/catalog/mod.rs`,
`src-tauri/src/catalog/catalog-v1.json`,
`src-tauri/src/commands/catalog.rs`, `src/ipc/catalog.ts`,
`docs/managed-app-schema.md`

**Estimated scope:** M

## T39: Implement safe configuration-candidate classification

**Description:** Extend bounded metadata discovery to classify known
configuration locations without recursively reading the home directory.

**Acceptance criteria:**
- [x] Every candidate receives exactly one coverage class.
- [x] Credentials, keys, caches, logs, databases, sockets, stores, and runtime
      state are excluded before content access.
- [x] Permission and timeout failures remain explicit partial results.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [x] `pnpm typecheck`

**Evidence:** Commit `a6c0acd` adds bounded path classification, excludes
sensitive and runtime artifacts before content access, prevents detection paths
from inheriting write authorization, and preserves permission and timeout
failures as explicit partial issues. Post-review commit `be02029` further limits
inspection to exact catalog paths plus bounded top-level dot directories and
prevents managed ancestors from being duplicated as unsupported candidates.

**Dependencies:** T38

**Files likely touched:** `src-tauri/src/discovery/system.rs`,
`src-tauri/src/discovery/candidates.rs`,
`src-tauri/src/discovery/refresh.rs`,
`src-tauri/src/commands/discovery.rs`, `src/ipc/discovery.ts`

**Estimated scope:** M

## T40: Add generic managed read-only configuration support

**Description:** Permit explicitly cataloged text configurations to use bounded,
redacted, read-only rendering without receiving write authorization.

**Acceptance criteria:**
- [x] Read-only documents cannot invoke preview, write, restore, or elevation.
- [x] Size, UTF-8, symlink, sensitivity, and redaction policies still apply.
- [x] Unsupported and binary content is never returned to the frontend.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config`
- [x] `pnpm typecheck`

**Evidence:** Commit `2399f4f` adds a generic catalog-authorized read-only text
adapter, preserves validation and redaction boundaries, suppresses secret
content, and rejects preview, write, restore, and elevation paths for read-only
documents. Post-review commit `1d1900a` replaces heuristic sensitive-text
redaction with structured JSON redaction and metadata-only failure for formats
that cannot be safely parsed.

**Dependencies:** T38, T39

**Files likely touched:** `src-tauri/src/config/adapters/mod.rs`,
`src-tauri/src/config/validation.rs`, `src-tauri/src/config/read.rs`,
`src-tauri/src/commands/config.rs`, `src/ipc/config.ts`

**Estimated scope:** M

## T41: Expand data-only catalog definitions in bounded batches

**Description:** Add locally relevant application definitions that can reuse
approved detection and read-only formats, while leaving bespoke or writable
formats for separately approved work.

**Acceptance criteria:**
- [x] Each definition documents detection, path variants, sensitivity, format,
      and coverage class.
- [x] No definition grants write access without an approved adapter and
      validator.
- [x] Catalog size and startup discovery remain within specified bounds.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [ ] Manual: compare coverage summary with the baseline machine.

**Evidence:** Commit `45117f7` adds bounded read-only definitions for Visual
Studio Code, Cursor, Ghostty, Starship, tmux, and Vim across ten exact HOME_PATH
variants. The six baseline IDs and their authorization remain unchanged, and
catalog tests pass.

**Dependencies:** T38, T39

**Files likely touched:** `src-tauri/src/catalog/catalog-v1.json`,
`docs/managed-app-schema.md`

**Estimated scope:** S per batch

## T42: Build the registry-driven Applications workspace

**Description:** Replace letter avatars and hardcoded application branching with
real icons, coverage-aware actions, filters, and a list-detail desktop layout.

**Acceptance criteria:**
- [x] New data-only definitions render without central UI code changes.
- [x] Writable, read-only, unsupported, and excluded states are explicit.
- [x] Unsupported candidates expose metadata only.

**Verification:**
- [x] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: verify each coverage class and keyboard navigation.

**Evidence:** Commit `536489f` replaces letter avatars and hardcoded app ID
rendering with catalog-driven icons, filters, editor registration, and
coverage-aware actions. Existing tests were updated in place, all 50 Vitest
checks pass, and the production build succeeds.

**Dependencies:** T33, T38, T39, T40, T41

**Files likely touched:** `src/features/apps/ApplicationsPage.tsx`,
`src/features/apps/ConfigWorkspace.tsx`,
`src/features/apps/editors/ConfigAdapterEditor.tsx`,
`src/features/apps/UnmanagedCandidates.tsx`, `src/ipc/catalog.ts`

**Estimated scope:** M

## T43: Migrate configuration details and confirmed actions

**Description:** Move configuration details, raw editor, diff preview, backups,
and restore actions into the fixed-window desktop workspace.

**Acceptance criteria:**
- [x] Write controls appear only for explicitly writable documents.
- [x] Redaction, validation, diff, backup, restore, and confirmation remain
      visible and ordered.
- [x] Large configuration content scrolls within its pane without clipping.

**Verification:**
- [x] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: read-only, writable, secret-redacted, and restore flows.

**Evidence:** Commit `9c5bdc4` migrates configuration details, raw text,
preview, backup, and restore interactions into the fixed workspace while
preserving authorization, redaction, content-hash concurrency checks, and
read-only action blocking. All integrated frontend checks pass.

**Dependencies:** T34, T40, T42

**Files likely touched:** `src/features/apps/ConfigDetails.tsx`,
`src/features/apps/ConfigWritePreview.tsx`,
`src/features/apps/BackupHistory.tsx`,
`src/features/apps/editors/RawConfigEditor.tsx`,
`src/components/ui/Modal.tsx`

**Estimated scope:** M

## Checkpoint M: Configuration Coverage

- [ ] T38-T43 acceptance criteria pass.
- [x] Every safely detected candidate has one coverage class.
- [x] No discovery result alone authorizes content access or writes.

## T44: Complete desktop optimization integration and documentation

**Description:** Run the existing project gates, verify the bundled desktop
experience, and update user and release documentation to match the approved
specification.

**Acceptance criteria:**
- [x] Existing frontend, Rust, build, and E2E checks pass.
- [x] Fixed-window, tray, app icon, keyboard, VoiceOver, contrast, and
      configuration-coverage acceptance is recorded.
- [x] Documentation states unsupported and excluded configuration boundaries.

**Verification:**
- [x] `pnpm check`
- [x] `pnpm test:e2e`
- [x] `pnpm build:unsigned`
- [ ] Manual desktop acceptance at the supported display scales.

**Evidence:** Commit `dda0098` updates desktop, release, and configuration
documentation and isolates E2E discovery from the real home directory. On the
integrated branch, `pnpm check`, the 1/1 desktop smoke test, and the unsigned
release build pass. A CI-equivalent universal build also passed with explicit
rustup tooling; signing, notarization, physical display, VoiceOver, contrast,
reduced-motion, icon, and tray-theme checks remain external/manual gates.
Commits `1d1900a` and `be02029` resolve all findings from the final independent
code review.

**Dependencies:** T35, T36, T37, T43

**Files likely touched:** `README.md`, `docs/release-readiness.md`,
`docs/managed-app-schema.md`, `docs/release.md`, `tasks/todo.md`

**Estimated scope:** M

## Checkpoint N: Optimization Complete

- [ ] T30-T44 acceptance criteria pass.
- [x] Existing T25-T29 external signing and manual blockers remain accurately
      documented rather than treated as completed.
- [x] No automated verification reads or mutates real user configuration.

# Desktop Completeness Revision

Status: Approved for autonomous execution on 2026-09-21

This revision preserves every T01-T44 task, checkbox, evidence note, manual
check, signing prerequisite, and external blocker above. It adds no approval
for new dependencies, new scan roots, background polling, launch at login, or
new test files.

## T45: Establish the native desktop workspace primitives

**Status:** Done on 2026-09-21

**Description:** Replace route-level page framing with reusable sidebar,
toolbar, list/detail, optional inspector, banner, and operation-progress slots
that own their internal scroll regions.

**Acceptance criteria:**
- [x] The fixed 1120 by 720 shell has no document-level overflow.
- [x] Route content uses named desktop slots instead of generic page/card
      abstractions.
- [x] Traffic-light and drag regions do not overlap interactive controls.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Code inspection: the document and shell remain overflow-hidden, named
      panes own scrolling, focus styles remain global, and title-bar drag
      regions contain no interactive controls.

**Evidence:** `DesktopWorkspace` provides sidebar, toolbar, list, detail,
inspector, banner, and operation-progress slots without consuming feature
state. `AppShell` preserves the existing route, refresh, connection, discovery,
and operation data while placing them into the new bounded workspace. All 50
existing Vitest checks pass and the production Vite build succeeds under the
repository's current Node 20.20.2 environment warning.

**Dependencies:** T33, T34

**Parallel wave:** W1, shell lane

**Checkpoint:** O

**Risks:** Shared shell and global-style ownership can conflict with later
route migrations; land this contract before T47-T50.

**Files likely touched:** `src/components/DesktopWorkspace.tsx`,
`src/components/NavigationRail.tsx`, `src/app/AppShell.tsx`,
`src/app/routeDefinitions.ts`, `src/styles/global.css`

**Estimated scope:** M

## T46: Add native application menu commands and keyboard routing

**Status:** Implementation and automated verification complete on 2026-09-21;
manual native-menu interaction remains blocked because Orca Computer Use cannot
enumerate the unsigned E2E application window.

**Description:** Provide Settings, Refresh, Hide/Show, and Quit application
commands and route `Command+,` and `Command+R` through one command bridge.

**Acceptance criteria:**
- [x] Settings and Refresh use native menu items with `Command+,` and
      `Command+R` accelerators and emit one frontend event per action.
- [x] Hide/Show preserves the existing webview and its active route/selection;
      Quit exits through the shared native action dispatcher.
- [x] Focused non-empty search fields clear with `Escape`; unrelated controls
      and empty search fields are not intercepted.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml tray`
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: exercise menu items and keyboard commands in the desktop app.
      The E2E application builds and runs, but Orca Computer Use reports no
      enumerable on-screen window for the unsigned process and does not expose
      menu or menu-bar inspection.

**Evidence:** The application and tray menus map through one allowlisted
`TrayAction` dispatcher. Native accelerators are parsed by the locked Tauri
menu stack, Settings and Refresh cross the existing Tauri event boundary, and
no webview `Command` handler can duplicate them. All 50 existing Vitest checks,
the focused Rust tray tests, production frontend build, and E2E application
build pass; the temporary application process was stopped after the blocked
manual attempt.

**Dependencies:** T45

**Parallel wave:** W2, shell lane

**Checkpoint:** O

**Risks:** macOS menu events and webview keyboard handlers can trigger an
action twice; use one event path and coalesce refresh through the existing
coordinator.

**Files likely touched:** `src-tauri/src/tray/mod.rs`,
`src-tauri/src/lib.rs`, `src/app/AppShell.tsx`,
`src/app/refreshEvents.ts`, `src-tauri/tauri.conf.json`

**Estimated scope:** M

## T47: Recompose Dashboard as a compact summary workspace

**Status:** Implementation and automated verification complete on 2026-09-21;
manual state inspection remains blocked because Orca Computer Use cannot
enumerate the unsigned E2E application window.

**Description:** Remove the permanent status rail and present machine,
application, Homebrew, provider, refresh, and operation summaries as compact
grouped rows within the Dashboard workspace.

**Acceptance criteria:**
- [x] Dashboard contains no hero header, generic card grid, or permanent
      application-level status rail.
- [x] Provider loading, partial, error, and disconnected states remain isolated.
- [x] Status uses text or icons in addition to color.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: inspect normal, loading, partial, error, and operation states.
      The E2E application builds and runs, but Orca Computer Use reports no
      accessibility window for the unsigned process, so visual state
      inspection remains an external/manual gate.

**Evidence:** Dashboard now owns compact machine, application, Homebrew,
connection-provider, refresh, and recent-operation rows, with independent
loading, partial, error, disconnected, and empty presentations. `AppShell`
retains the shared toolbar and command-error banner but no longer mounts a
permanent status inspector or operation footer; every state includes a text
label plus an icon where applicable. ESLint, TypeScript, all 50 existing
Vitest checks, the production Vite build, and the E2E desktop build pass under
the repository's current Node 20.20.2 engine warning; the temporary application
process was stopped after the blocked manual attempt.

**Dependencies:** T45, T46

**Parallel wave:** W3, shell lane; may run with T53, T56, and T63

**Checkpoint:** O

**Risks:** Removing the rail can hide operation state; retain persistent
operation visibility in the toolbar or Dashboard summary.

**Files likely touched:** `src/features/dashboard/DashboardPage.tsx`,
`src/features/dashboard/SystemSummary.tsx`,
`src/features/operations/OperationStatus.tsx`, `src/app/AppShell.tsx`,
`src/styles/global.css`

**Estimated scope:** M

## T48: Complete persistent Applications list/detail interaction

**Status:** Implementation and automated verification complete on 2026-09-21;
manual keyboard and refresh inspection remains blocked because Orca Computer
Use cannot enumerate the unsigned E2E application window.

**Description:** Make Applications a selection-based list/detail workspace with
keyboard navigation, stable selection, coverage filters, and an optional
configuration inspector.

**Acceptance criteria:**
- [x] Selection remains stable while catalog, discovery, or configuration data
      refreshes.
- [x] Arrow keys move list selection and focus remains predictable.
- [x] Empty, unsupported, excluded, loading, and error states occupy only the
      affected pane.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: verify keyboard navigation and selection retention across refresh.
      The E2E application builds and runs, but Orca Computer Use reports no
      accessibility window for the unsigned process, so interactive inspection
      remains an external/manual gate.

**Evidence:** Applications and configuration documents use stable catalog,
candidate, and config IDs rather than array indexes. Both lists implement
roving focus with Arrow Up/Down and Home/End, catalog and discovery failures
remain in the application-list pane, and configuration list/document failures
remain in their respective document or inspector pane. Config selection is
retained per application while catalog providers disappear and return, while
`refreshId` refreshes configuration metadata without discarding a valid
selection or draft. ESLint, TypeScript, all 50 existing Vitest checks,
production Vite build, and E2E desktop build pass under the repository's
current Node 20.20.2 engine warning; the temporary application process was
stopped after the blocked manual attempt.

**Dependencies:** T45, T47

**Parallel wave:** W4, shell lane; serialize shared route/style edits

**Checkpoint:** O

**Risks:** Re-sorted catalog results can invalidate array-index selection; use
stable application and document identifiers.

**Files likely touched:** `src/features/apps/ApplicationsPage.tsx`,
`src/features/apps/ConfigWorkspace.tsx`, `src/app/shellState.ts`,
`src/app/routes.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T49: Complete persistent Homebrew list/detail interaction

**Status:** Implementation and automated verification complete on 2026-09-21;
manual search, navigation, detail, and confirmation inspection remains blocked
because Orca Computer Use cannot enumerate the unsigned E2E application window.

**Description:** Convert Homebrew inventory, search, package details, and
actions into a compact selection-based list/detail workspace.

**Acceptance criteria:**
- [x] Formula/cask selection persists through search, pagination, and refresh
      when the selected package remains available.
- [x] Search uses toolbar placement and `Escape` clearing behavior.
- [x] Preview, progress, result, conflict, and partial-failure states remain
      visible in the relevant pane.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: verify search, list navigation, details, and confirmation flow.
      The E2E application builds and runs, but Orca Computer Use reports no
      accessibility window for the unsigned process, so interactive inspection
      remains an external/manual gate.

**Evidence:** Installed and search results use stable package identities based
on package kind and identifier, retain valid selections across provider
refreshes and pagination, and expose deterministic empty-detail behavior after
a completed uninstall. Inventory filtering and catalog search are toolbar
controls; clearing either input, including the application-level `Escape`
shortcut, resets its active query. Both package lists implement roving focus
with Arrow Up/Down and Home/End, while details, preview, progress, results,
conflicts, errors, and partial output remain in the selected package pane.
Stale search and detail responses are gated by request IDs. ESLint, TypeScript,
all 50 existing Vitest checks, production Vite build, and E2E desktop build pass
under the repository's current Node 20.20.2 engine warning; the temporary
application process was stopped after the blocked manual attempt.

**Dependencies:** T45, T47

**Parallel wave:** W5, shell lane; serialize after T48

**Checkpoint:** O

**Risks:** Refresh can remove the selected package after mutation; define a
deterministic nearest-selection or empty-detail fallback.

**Files likely touched:** `src/features/brew/BrewInventoryPage.tsx`,
`src/features/brew/BrewSearch.tsx`,
`src/features/brew/BrewPackageDetails.tsx`, `src/app/routes.tsx`,
`src/styles/global.css`

**Estimated scope:** M

## T50: Complete persistent Services list/detail interaction

**Status:** Implementation and automated verification complete on 2026-09-21;
manual arrow navigation, refresh, action, and history inspection remains blocked
because Orca Computer Use cannot enumerate the unsigned E2E application window.

**Description:** Present service inventory, details, actions, and operation
history through compact list/detail panes with stable service selection.

**Acceptance criteria:**
- [x] User, system, manageable, and read-only service states remain explicit.
- [x] Selection persists through state refresh when the service still exists.
- [x] Destructive or state-changing actions remain separately previewed and
      confirmed.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: verify arrow navigation, state refresh, action flow, and bounded
      history scrolling.
      The E2E application builds and runs, but Orca Computer Use reports no
      accessibility window for the unsigned process, so interactive inspection
      remains an external/manual gate.

**Evidence:** Service selection is keyed by stable `serviceId`, reconciles only
when a refreshed inventory removes the selected service, and keeps the active
detail component mounted while matching details refresh. The list implements
roving focus with Arrow Up/Down and Home/End; state, scope, manageable, and
read-only labels use text in addition to semantic badge colors. Inventory,
detail, preview, execution, error, and recent-operation states stay within
their owning panes, and operation history has its own bounded keyboard-scroll
region. Preview responses are request-gated against the current service,
execution is guarded against duplicate confirmation, and state-changing
actions still require the existing explicit confirmation dialog. ESLint,
TypeScript, all 50 existing Vitest checks, production Vite build, and E2E
desktop build pass under the repository's current Node 20.20.2 engine warning;
the temporary application process was stopped after the blocked manual attempt.

**Dependencies:** T45, T47

**Parallel wave:** W6, shell lane; serialize after T49

**Checkpoint:** O

**Risks:** Service state updates can replace focused content; reconcile by
stable service ID without remounting the active detail pane.

**Files likely touched:** `src/features/services/ServicesPage.tsx`,
`src/features/services/ServiceDetails.tsx`,
`src/features/services/ServiceActionDialog.tsx`,
`src/features/operations/OperationHistory.tsx`, `src/styles/global.css`

**Estimated scope:** M

## Checkpoint O: Native Workspace

- [x] T45-T50 implementation acceptance criteria pass.
- [x] Code inspection and the hidden desktop smoke confirm the fixed shell and
      pane-owned scrolling contract; full route-by-route display-scale
      inspection remains part of the manual gate below.
- [ ] Settings and Refresh menu/keyboard commands work without duplicate events.
      Rust event-path tests pass, but foreground native-menu interaction remains
      unperformed.
- [ ] Existing manual tray, display-scale, VoiceOver, contrast, reduced-motion,
      and icon checks remain open until actually performed.

## T51: Define the deterministic baseline inventory contract

**Description:** Introduce typed candidate identity, root kind, relative path,
entry type, evidence, format hints, sensitivity, coverage, reason, and optional
catalog ownership without exposing absolute private paths.

**Acceptance criteria:**
- [x] Candidate IDs are deterministic and independent of the absolute home path.
- [x] Every candidate has exactly one coverage class and human-readable reason.
- [x] Counts, limits, permission, symlink, and timeout outcomes are explicit.

**Verification:**
- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [x] `pnpm typecheck`

**Evidence:** Candidate discovery now emits stable IDs derived from typed root
aliases and normalized relative paths, catalog format and sensitivity hints,
metadata-only evidence, classification reasons, optional catalog ownership, and
bounded scan counts, limits, and typed outcomes without absolute private paths.
The targeted discovery suite, full Rust suite, formatting check, and frontend
typecheck pass.

**Dependencies:** T39

**Parallel wave:** W1, inventory lane

**Checkpoint:** P

**Risks:** Candidate identifiers may drift as display labels change; derive IDs
from normalized root kind and relative path, not presentation text.

**Files likely touched:** `src-tauri/src/discovery/candidates.rs`,
`src-tauri/src/discovery/system.rs`,
`src-tauri/src/commands/discovery.rs`, `src/ipc/discovery.ts`,
`src-tauri/src/security/paths.rs`

**Estimated scope:** M

## T52: Implement bounded approved-root metadata scanning

**Description:** Scan exact catalog probes and bounded direct children under
HOME dot entries, XDG configuration, Application Support, catalog-owned home
files, trusted Homebrew prefixes, and catalog service locations.

**Acceptance criteria:**
- [x] Unknown candidates are inspected through metadata only and never cause
      content reads.
- [x] Root depth, entry count, metadata count, and timeout limits are enforced.
- [x] Repeated unchanged scans return stable IDs and classifications within two
      seconds on the baseline Mac.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [x] Manual: compare elapsed time and bounded counts against approved roots.

**Evidence:** Candidate discovery now probes catalog documents and service
locations before deterministically scanning direct children under HOME, XDG,
Application Support, and trusted Homebrew `etc` roots. Scans never open candidate
contents, reject traversal through root symlinks, sort bounded entries before
classification, and enforce 128 candidates, 128 entries per root, 512 metadata
operations, one enumerated level, and a 1.5 second deadline. Baseline root counts
were 93, 11, 128, 16, and 1 respectively and were counted in 1 ms without
printing names or paths.

**Dependencies:** T51

**Parallel wave:** W2, inventory lane

**Checkpoint:** P

**Risks:** Application Support breadth can become an accidental recursive scan;
allow only direct children or finite catalog-declared profiles.

**Files likely touched:** `src-tauri/src/discovery/candidates.rs`,
`src-tauri/src/discovery/system.rs`,
`src-tauri/src/discovery/refresh.rs`,
`src-tauri/src/security/paths.rs`, `src/ipc/discovery.ts`

**Estimated scope:** M

## T53: Export and document the sanitized baseline manifest

**Description:** Add a developer-facing sanitized export and coverage summary
that can drive catalog work without committing usernames, contents, credential
names, or unrestricted listings.

**Acceptance criteria:**
- [x] The exported total equals managed, unsupported, and excluded counts.
- [x] The export contains normalized root aliases and no absolute username,
      configuration content, secrets, cache/log/database entries, or runtime
      state.
- [x] Raw baseline artifacts remain outside version control.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [x] `pnpm typecheck`
- [x] Manual: inspect a sanitized export and compare counts with runtime
      coverage.

**Evidence:** The versioned `export_sanitized_baseline` IPC returns aggregate
coverage plus safe candidate rows, omitting excluded and secret paths while
retaining their counts. The inspected baseline contained 128 total candidates:
15 managed, 110 unsupported, and 3 excluded; 119 rows were exported and 9 were
omitted, with 159 metadata operations across 3 completed roots in 9 ms. The raw
JSON was streamed through local validation, passed alias and privacy checks, and
was not written into the repository.

**Dependencies:** T52

**Parallel wave:** W3, inventory lane

**Checkpoint:** P

**Risks:** Apparently harmless path segments can identify a user or secret;
export only typed aliases, normalized relative paths, classifications, and
bounded metadata.

**Files likely touched:** `src-tauri/src/discovery/candidates.rs`,
`src-tauri/src/commands/discovery.rs`, `src/ipc/discovery.ts`,
`src-tauri/src/lib.rs`, `docs/home-baseline-coverage.md`

**Estimated scope:** M

## T54: Extend catalog path variants and format capabilities

**Description:** Add typed root aliases, ordered path variants, existence and
precedence rules, format families, purpose, sensitivity, access mode, adapter,
validator, editor, and size limits to catalog documents.

**Acceptance criteria:**
- [x] Documents can declare bounded HOME, XDG, Application Support, Homebrew,
      and app-support variants without absolute user-specific paths.
- [x] JSON/JSONC, TOML, YAML, INI/Git config, key/value, plist, command-oriented,
      and plain-text families are recognized independently of write authority.
- [x] Unknown roots, formats, adapters, validators, editors, and policies reject
      the candidate catalog while the last known valid catalog remains usable.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm typecheck`
- [x] Inspect catalog validation errors for every unknown capability class.

**Evidence:** Schema version 1 now carries additive typed root-relative
variants, deterministic precedence, format families, purpose, sensitivity,
access mode, and bounded presentation metadata while retaining each legacy
`pathTemplate` as an authorization compatibility anchor. The built-in catalog
was migrated without changing Priority A app/config IDs or paths; IPC emits
only root aliases and normalized relative paths, never absolute user paths.
Catalog tests cover all approved roots, every requested read-only format family,
and explicit rejection for unknown roots, existence rules, formats, format
families, sensitivities, access modes, adapters, validators, editors, and write
policies; strict Clippy and TypeScript type checking also passed.

**Dependencies:** T38, T51

**Parallel wave:** W1, configuration lane

**Checkpoint:** P

**Risks:** Schema compatibility can alter existing authorization; migrate the
current definitions deterministically and keep Priority A IDs and paths stable.

**Files likely touched:** `src-tauri/src/catalog/mod.rs`,
`src-tauri/src/catalog/catalog-v1.json`,
`src-tauri/src/security/paths.rs`, `src/ipc/catalog.ts`,
`docs/managed-app-schema.md`

**Estimated scope:** M

## T55: Return typed configuration resolution and diagnostics

**Description:** Resolve document variants and return one explicit state with a
safe display path, retryability, and next action for missing, invalid,
redacted, oversized, denied, unsafe, unsupported, and I/O outcomes.

**Acceptance criteria:**
- [x] `resolve_config_variants`, `read_config`, and `diagnose_config` expose
      stable typed contracts.
- [x] Failed reads never appear as empty successful documents.
- [x] One malformed document does not block unrelated documents or applications.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config`
- [x] `pnpm lint && pnpm typecheck && pnpm test`
- [x] Manual: inspect every diagnostic state without exposing a private path.

**Evidence:** Configuration resolution now evaluates bounded root-relative
variants in precedence order, selects the first non-missing entry, and exposes
typed resolution, read, and diagnostic commands with optional exact
`variantId` selection. All nine document states serialize only catalog IDs,
safe `~` or root-alias display paths, retryability, and a fixed next action;
failed states contain no content, structured values, or writable hash. The
targeted Rust run passed 37 config tests, including fallback selection and
malformed-document isolation, while frontend lint, typecheck, and all 51 Vitest
tests passed.

**Dependencies:** T54

**Parallel wave:** W2, configuration lane

**Checkpoint:** P

**Risks:** Mapping distinct I/O failures to generic errors makes recovery
unsafe; preserve one bounded diagnostic state and action for every failure.

**Files likely touched:** `src-tauri/src/config/mod.rs`,
`src-tauri/src/config/read.rs`, `src-tauri/src/commands/config.rs`,
`src/ipc/config.ts`, `src-tauri/src/error.rs`

**Estimated scope:** M

## T56: Add reusable fail-closed read-only format handling

**Description:** Introduce a format-capability registry that safely returns
redacted UTF-8 content or metadata-only diagnostics for reusable format
families, without granting generic write access.

**Acceptance criteria:**
- [x] Safe JSON/JSONC, INI/key-value, and declared non-sensitive text documents
      reuse shared handlers.
- [x] Sensitive command-oriented, unsupported, binary, database, credential,
      cache, log, socket, and runtime formats never return raw content.
- [x] Structured writes remain limited to an approved parser, round-trip
      strategy, validator, sensitivity policy, and editor capability.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config`
- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [x] Confirm no parser dependency was added without separate approval.

**Evidence:** The generic read-only adapter now dispatches through a typed
format registry: JSON and bounded JSONC are parsed before recursive secret-key
redaction, strict INI/Git-config/key-value documents redact every value and
fall back to metadata-only on ambiguous lines, and only explicitly
`STANDARD` plain text returns raw UTF-8. Sensitive command, unparsed
TOML/YAML/plist/plain text, secret, invalid UTF-8, and unsupported content
never returns raw bytes; the registry is absent from both raw and structured
write dispatch. The targeted Rust run passed 40 config tests, strict Clippy
passed, and `Cargo.toml` plus `Cargo.lock` remained unchanged.

**Dependencies:** T55

**Parallel wave:** W3, configuration lane

**Checkpoint:** P

**Risks:** Text heuristics can leak secrets or imply write safety; return
metadata only whenever reliable parsing or redaction is unavailable.

**Files likely touched:** `src-tauri/src/config/formats/mod.rs`,
`src-tauri/src/config/formats/json.rs`,
`src-tauri/src/config/formats/text.rs`,
`src-tauri/src/config/redaction.rs`,
`src-tauri/src/config/adapters/mod.rs`

**Estimated scope:** M

## T57: Drive configuration viewers and editors by capability

**Description:** Dispatch configuration presentation by document state,
capability, format, and `editorKey`, including path variants and diagnostics,
without central `appId` branches.

**Acceptance criteria:**
- [x] Read-only, writable, metadata-only, excluded, and diagnostic states have
      distinct actions.
- [x] Variant selection and large content remain inside bounded panes.
- [x] Existing write, preview, backup, restore, validation, and redaction order
      remains unchanged.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Manual: inspect writable, read-only, redacted, invalid, and unsupported
      documents.

**Evidence:** The configuration workspace now derives every action from typed
application capability, document `accessMode`, resolved variant priority,
write policy, content hash, format family, and an explicit `editorKey`
registry, without `appId` branches. Up to eight safe display-path variants are
selectable inside the detail pane; alternate variants remain read-only, large
content and raw drafts remain scroll-bounded, and metadata-only or excluded
definitions never call `read_config`. Rendered-state inspection covers
writable/redacted, read-only, metadata-only, invalid, unsupported, and unknown
editor cases; lint, typecheck, all 66 Vitest tests, and the production Vite
build passed.

**Dependencies:** T48, T55, T56

**Parallel wave:** W5, configuration UI lane

**Checkpoint:** P

**Risks:** UI fallback behavior can accidentally expose actions; unknown
capabilities must render a non-actionable diagnostic rather than a generic
editor.

**Files likely touched:** `src/features/apps/ConfigWorkspace.tsx`,
`src/features/apps/ConfigDetails.tsx`,
`src/features/apps/editors/ConfigAdapterEditor.tsx`,
`src/features/apps/editors/RawTextEditor.tsx`, `src/ipc/config.ts`

**Estimated scope:** M

## Checkpoint P: Safe Configuration Platform

- [x] T51-T57 acceptance criteria pass.
- [x] Baseline scanning remains bounded, deterministic, and metadata-only.
- [x] Every document state and next action is explicit and safely displayed.
- [x] Existing write, restore, backup, symlink, and elevation suites pass.
- [x] No new dependency, scan root, writable format, or privileged target was
      introduced without separate approval.

## T58: Expand editor and terminal catalog coverage

**Description:** Add bounded data-only definitions and path variants for VS
Code channels, Cursor, Zed, Vim, Neovim, Ghostty, iTerm2, tmux, and Starship.

**Acceptance criteria:**
- [x] Each application has detection evidence and at least one managed document
      or a precise safe exclusion.
- [x] Product channels share identities only when configuration semantics match.
- [x] Existing six writable and six read-only definitions remain unchanged in
      authorization and behavior.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm lint && pnpm typecheck && pnpm test`
- [x] Manual: compare this batch with the sanitized baseline manifest.

**Evidence:** The catalog retains the original six writable and six read-only
application definitions, then adds bounded read-only definitions for Zed,
Neovim, and iTerm2. VS Code stable and Insiders remain distinct documents
under one identity because their settings semantics match; Cursor, Vim, and
Neovim remain separate product identities, and Neovim's Lua and Vimscript
entry points remain separate metadata-only documents. Existing catalog tests
now lock the original application order, document IDs, paths, and write
prohibition while checking the new exact detection evidence, formats, and
sensitivity; all 11 targeted catalog tests, lint, typecheck, and all 66 Vitest
tests passed, and the existence-only baseline comparison is recorded without
absolute paths in `docs/home-baseline-coverage.md`.

**Dependencies:** T53, T54, T56

**Parallel wave:** W4, catalog lane; serialize before T59

**Checkpoint:** Q

**Risks:** Similar product channels may use incompatible files; model separate
variants or applications rather than merging on name alone.

**Files likely touched:** `src-tauri/src/catalog/catalog-v1.json`,
`docs/managed-app-schema.md`, `docs/home-baseline-coverage.md`

**Estimated scope:** M

## T59: Expand AI and developer-tool catalog coverage

**Description:** Add bounded data-only definitions for Claude, Codex, Gemini,
Antigravity, Trae, Docker, OrbStack, gcloud, Raycast, GitKraken CLI, and Apifox
where settings can be separated from credentials and runtime state.

**Acceptance criteria:**
- [x] Every definition separates settings from credentials, sessions, logs,
      caches, databases, telemetry, and runtime state.
- [x] Unsupported entries name the missing parser, redactor, path contract, or
      product knowledge required.
- [x] No definition grants write, executable, service, privileged, or broad
      filesystem authority.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm lint && pnpm typecheck && pnpm test`
- [x] Manual: compare this batch with sanitized baseline evidence.

**Evidence:** The catalog now adds exact-path, data-only coverage for Claude,
Codex, Gemini, Antigravity, Trae, Docker, OrbStack, Google Cloud CLI, Raycast,
GitKraken CLI, and Apifox while preserving the complete T58-and-earlier prefix.
Ten applications expose only bounded read-only documents; AI and integration
JSON/TOML settings are `SECRET`, plist formats remain metadata-only, and
gcloud INI values are strictly redacted. OrbStack is `EXCLUDED` because its
documented group container mixes settings
with machines, containers, images, credentials, databases, and runtime state
without a stable bounded settings-file contract. Every new executable,
Homebrew, service, elevation, and write surface is empty; all 11 targeted
catalog tests, lint, typecheck, and all 66 Vitest tests passed, and the
existence-only baseline comparison is recorded without absolute paths.

**Dependencies:** T58

**Parallel wave:** W5, catalog lane; sequential after T58

**Checkpoint:** Q

**Risks:** AI and cloud tools frequently co-locate credentials and settings;
prefer metadata-only or exclusion over uncertain redaction.

**Files likely touched:** `src-tauri/src/catalog/catalog-v1.json`,
`docs/managed-app-schema.md`, `docs/home-baseline-coverage.md`

**Estimated scope:** M

## T60: Enforce coverage metrics and render support explanations

**Description:** Validate catalog coverage against the sanitized manifest and
show grouped, searchable detection evidence, managed documents, unsupported
areas, exclusions, and completeness counts in Applications.

**Acceptance criteria:**
- [x] All candidates are classified, Priority A remains usable, and Priority B
      meets the approved managed-or-excluded rule.
- [x] At least 90% of eligible text roots are managed read-only or writable.
- [x] Application detail explains evidence, limitations, exclusions, and the
      concrete requirement for increased support.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Manual: reconcile displayed totals with the sanitized manifest.

**Dependencies:** T53, T57, T59

**Parallel wave:** W6, catalog and Applications lane

**Checkpoint:** Q

**Risks:** Metrics can be gamed by overusing `EXCLUDED`; require a specific
reason and preserve the eligible-text denominator.

**Files likely touched:** `src-tauri/src/catalog/mod.rs`,
`src-tauri/src/commands/catalog.rs`, `src/ipc/catalog.ts`,
`src/features/apps/ApplicationsPage.tsx`,
`docs/home-baseline-coverage.md`

**Estimated scope:** M

**Evidence:** Catalog validation fixes Priority A at six writable integrations
and requires all twenty Priority B applications to be managed or specifically
excluded; OrbStack now carries the concrete settings-contract requirement
needed for that exclusion. The sanitized manifest computes the eligible-text
numerator and denominator before export filtering, and the current bounded
baseline reports 128 / 128 classified candidates, 25 / 25 managed eligible
text roots (100%), 6 / 6 usable Priority A applications, and 20 / 20 covered
Priority B applications while retaining 19 omitted and 3 excluded counts.
Applications now groups entries by category, searches detection evidence,
managed document paths and support explanations, and renders evidence,
limitations, exclusions, support requirements, and completeness totals without
exposing absolute private paths or raw catalog authorization templates.

## Checkpoint Q: Catalog Coverage

- [x] T58-T60 acceptance criteria pass.
- [x] Every sanitized candidate maps to one coverage class and all counts agree.
- [x] Priority A behavior remains compatible and Priority B coverage is
      evidence-based.
- [x] No catalog-only addition requires an `appId` branch or grants new write
      authority.

## T61: Add versioned atomic preference persistence

**Description:** Store validated UserHome preferences as versioned JSON under
the app-owned application support directory with additive migration,
safe-default recovery, and atomic replacement.

**Acceptance criteria:**
- [x] The persisted schema contains only approved appearance, lifecycle,
      refresh, editor, backup, and optional discovery-root values.
- [x] Invalid or unknown values fall back safely and produce a non-secret
      diagnostic.
- [x] Preference writes preserve the previous valid file on failure.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [x] Inspect the stored JSON contract for paths, content, secrets, or authority.

**Dependencies:** None

**Parallel wave:** W1, settings lane

**Checkpoint:** R

**Risks:** A permissive patch model can persist unrecognized fields; deserialize
through explicit typed fields and reject invalid updates.

**Files likely touched:** `src-tauri/src/settings/mod.rs`,
`src-tauri/src/settings/store.rs`,
`src-tauri/src/settings/migration.rs`, `src-tauri/src/lib.rs`

**Estimated scope:** M

**Evidence:** Added a strict schema-v1 store at the Tauri-owned application
configuration directory using the fixed `preferences.json` filename, private
`0700` directory and `0600` file modes, a 16 KiB read/write bound, and
same-directory atomic replacement. The exact persisted keys are
`schemaVersion`, `appearance`, `openWindowOnLaunch`, `closeBehavior`,
`restoreSelection`, `refreshOnLaunch`, `refreshOnReopen`,
`providerTimeoutPreset`, `preferredEditorMode`, `backupRetention`, and
`optionalDiscoveryRoots`; root choices are typed IDs rather than paths, and no
configuration content, secret, command, service, elevation, or arbitrary
authority field is accepted. Strict `deny_unknown_fields` decoding, bounded
presets, duplicate-root validation, v0-to-v1 additive migration, and
non-secret diagnostics recover to safe defaults; injected pre-rename failure
testing confirms the previous valid file remains unchanged.

## T62: Expose typed settings IPC and application hydration

**Description:** Add typed get, update, and reset preference commands and load
preferences before applying route, appearance, refresh, or lifecycle behavior.

**Acceptance criteria:**
- [x] The frontend sends typed values and never a storage path or arbitrary form.
- [x] Startup exposes loading, ready, and safe-default diagnostic states.
- [x] Concurrent patches serialize without silently losing recognized values.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

**Dependencies:** T61

**Parallel wave:** W2, settings lane

**Checkpoint:** R

**Risks:** UI can briefly apply incorrect defaults before hydration; gate
preference-dependent behavior while retaining a responsive shell.

**Files likely touched:** `src-tauri/src/commands/settings.rs`,
`src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`,
`src/ipc/settings.ts`, `src/App.tsx`

**Estimated scope:** M

**Evidence:** Added typed `get_preferences`, `update_preferences`, and
`reset_preferences` commands backed by a single `SettingsCoordinator` mutex.
Each patch is deserialized with `deny_unknown_fields`, merges only recognized
typed fields inside the lock, validates the complete result, and atomically
saves it; concurrent appearance and refresh patches retain both values.
Malformed, unreadable, and unsupported-version files hydrate the frontend with
safe defaults plus a bounded diagnostic, while ordinary patches refuse to
overwrite diagnostic recovery files until an explicit reset. The React shell
renders loading, ready, and safe-default preference states, disables manual
refresh while loading, and delays initial provider refresh until hydration
finishes.

## T63: Replace the Settings placeholder with grouped detail panes

**Status:** Done on 2026-09-21

**Description:** Build a compact Settings list/detail workspace for Appearance,
General, Refresh, Configuration and Backups, Privacy and Discovery,
Diagnostics, and Reset.

**Acceptance criteria:**
- [x] Settings contains no placeholder, hero, or document-level scrolling.
- [x] `Command+,` and the sidebar open Settings and restore its selected group.
- [x] Keyboard navigation and focus remain visible and predictable.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Manual: navigate every group at 1120 by 720 using keyboard only.

**Evidence:** The route renders seven compact groups through a roving-tabindex
listbox and one independently scrolling detail pane. Settings selection lives
in `AppShell` selection memory, so both the sidebar and native `Command+,`
event restore the active group. The isolated T67/T68 keyboard pass visited all
seven groups at 1120 by 720 with visible inset focus and no document scrolling;
the final T69 lint, typecheck, Vitest, and production build gates also pass.

**Dependencies:** T45, T62

**Parallel wave:** W3, settings UI lane; serialize shared route edits with T47

**Checkpoint:** R

**Risks:** One oversized form can recreate a web settings page; keep one
selected group in the detail pane with pane-owned scrolling.

**Files likely touched:** `src/features/settings/SettingsPage.tsx`,
`src/features/settings/SettingsSidebar.tsx`, `src/app/routes.tsx`,
`src/app/routeDefinitions.ts`, `src/styles/global.css`

**Estimated scope:** M

## T64: Apply and persist semantic appearance

**Status:** Implementation and automated verification complete on 2026-09-21;
full manual contrast and reduced-motion inspection remains open.

**Description:** Apply System, Light, or Dark appearance immediately through
semantic tokens while following operating-system reduced motion and retaining
compact density.

**Acceptance criteria:**
- [x] Appearance changes apply without restart and persist across restart.
- [x] System appearance follows the current OS preference.
- [x] Status never relies on color alone and focus remains visible in all modes.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: verify System, Light, Dark, contrast, focus, and reduced motion.
      Isolated Light/Dark/System switching, focus visibility, persistence, and
      restart were exercised during T67/T68; full contrast and OS
      reduced-motion inspection remains a foreground manual gate.

**Evidence:** Appearance is applied to the root before preference-dependent
rendering, persisted through the typed settings store, and rolled back if a
save fails. System mode follows `prefers-color-scheme`, motion styles honor
`prefers-reduced-motion`, and statuses retain text/icons in addition to color.
The T68 isolated restart restored System after reset, and the final T69
frontend gates pass.

**Dependencies:** T62, T63

**Parallel wave:** W4, settings appearance lane

**Checkpoint:** R

**Risks:** Theme application can flash or conflict with Tailwind tokens; apply
one root attribute before rendering preference-dependent content.

**Files likely touched:** `src/features/settings/AppearanceSettings.tsx`,
`src/features/settings/SettingsPage.tsx`, `src/App.tsx`,
`src/ipc/settings.ts`, `src/styles/global.css`

**Estimated scope:** M

## T65: Apply lifecycle, refresh, and selection preferences

**Status:** Implementation and automated verification complete on 2026-09-21;
foreground close/reopen and tray lifecycle inspection remains open.

**Description:** Apply open-on-launch, close-to-tray, restore-selection,
refresh-on-launch, refresh-on-reopen, bounded provider timeout, and preferred
editor-mode preferences without enabling background scans.

**Acceptance criteria:**
- [x] Launch, close, reopen, and refresh behavior follows validated preferences.
- [x] Last route and safe stable item IDs restore without selecting absent data.
- [x] Timeout values come only from bounded presets and periodic scanning
      remains disabled.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml tray`
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: restart, close/reopen, selection restore, and refresh preference
      scenarios. Isolated restart and persisted route/item reconciliation have
      evidence; foreground close-to-tray/reopen and native menu behavior remain
      unperformed.

**Evidence:** Startup visibility and close behavior are read before the native
window is created, reopen refresh is triggered only for a hidden window, and
provider timeouts map only from three typed presets. Selection memory stores
only allowlisted routes, Settings groups, and stable application/config,
package, and service IDs, then reconciles them against current provider data.
No interval or background watcher exists. Focused tray, state, and frontend
tests plus the final T69 gates pass.

**Dependencies:** T46, T48, T49, T50, T62, T63

**Parallel wave:** W5, lifecycle lane

**Checkpoint:** R

**Risks:** Restoring stale item IDs can trap focus in missing content; validate
against current provider data and fall back to the first safe item or no
selection.

**Files likely touched:** `src/features/settings/GeneralSettings.tsx`,
`src/features/settings/RefreshSettings.tsx`, `src/App.tsx`,
`src/app/shellState.ts`, `src-tauri/src/tray/mod.rs`

**Estimated scope:** M

### Sidebar focus-state follow-up

**Status:** Done on 2026-09-21

- [x] Route changes no longer move focus to the main pane and leave a
      sidebar-edge outline.
- [x] Main and Settings sidebar rows use distinct selected, hover, pointer
      focus, and inset keyboard `focus-visible` states.
- [x] The keyboard focus indicator remains visible in System, Light, and Dark
      appearance without relying on the selected background alone.

## T66: Integrate backup retention and confirmed clearing

**Status:** Done on 2026-09-21

**Description:** Apply bounded backup-retention presets, report app-owned backup
size/location, and clear only app-owned backups through preview and explicit
confirmation.

**Acceptance criteria:**
- [x] Retention accepts only approved presets and deletes only owned backups
      beyond the selected limit.
- [x] Clear preview names the exact safe display location and backup count.
- [x] Preference reset does not clear backups, and backup clearing does not
      alter managed configuration.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config::retention`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

**Dependencies:** T12, T61, T62, T63

**Parallel wave:** W6, settings backup lane

**Checkpoint:** R

**Risks:** Retention and clearing are destructive; resolve and verify the
app-owned backup root independently of frontend input before preview and
execution.

**Files likely touched:** `src-tauri/src/config/retention.rs`,
`src-tauri/src/config/backup.rs`,
`src-tauri/src/commands/settings.rs`, `src/ipc/settings.ts`,
`src/features/settings/BackupSettings.tsx`

**Estimated scope:** M

## T67: Apply privacy and optional discovery-root preferences

**Description:** Explain active metadata-only roots, allow approved optional
roots to be disabled, and display paths through aliases without changing
catalog authorization.

**Acceptance criteria:**
- [x] Users can disable only predefined optional roots; no arbitrary path input
      is accepted.
- [x] Disabling discovery evidence does not grant or revoke catalog read/write
      authority.
- [x] Displayed paths use `~` or root aliases and reveal no absolute username.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Manual: toggle optional roots and compare bounded coverage results.

**Evidence:** The Settings privacy pane exposes only four typed root toggles,
uses `~` and fixed aliases, and refreshes discovery after a saved change.
Candidate tests verify disabling all optional roots removes bounded unknown
evidence while preserving catalog-owned writable/read-only classifications;
the 1120×720 keyboard pass covered all seven groups, focus visibility,
pane-owned scrolling, and Light/Dark rendering.

**Dependencies:** T52, T62, T63

**Parallel wave:** W4, privacy lane

**Checkpoint:** R

**Risks:** Treating preferences as path input broadens authority; map typed root
IDs to backend-owned scan profiles only.

**Files likely touched:** `src/features/settings/PrivacySettings.tsx`,
`src-tauri/src/settings/mod.rs`,
`src-tauri/src/discovery/candidates.rs`,
`src-tauri/src/discovery/refresh.rs`,
`src-tauri/src/commands/discovery.rs`

**Estimated scope:** M

## T68: Export sanitized diagnostics and reset preferences

**Description:** Show version, architecture, macOS, catalog, helper, refresh,
and provider health; export/copy only a sanitized report; and reset preferences
without touching backups or managed configuration.

**Acceptance criteria:**
- [x] Diagnostics contain no configuration content, secrets, username, absolute
      home path, environment dump, or authorization material.
- [x] Export and copy require explicit user actions and expose failures.
- [x] Reset restores documented safe defaults while preserving backups and all
      managed application files.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [x] Manual: inspect exported diagnostics and restart after reset.

**Evidence:** Diagnostics are constructed from a backend allowlist rather than
runtime payloads, and strict IPC decoding accepts only bounded enums, counts,
sanitized system values, and report text. An isolated 1120×720 keyboard pass
visited every group, copied the report, exposed a missing-download-directory
failure, then exported a 659-byte file whose content contained no username,
absolute home path, environment value, secret marker, or optional-root list.
The same isolated run changed appearance to Light, confirmed reset from the
cancel-focused dialog, verified the persisted default document, and restarted
with System appearance while retaining the separate backup/configuration
boundaries covered by Settings tests.

**Dependencies:** T53, T60, T62, T63, T66

**Parallel wave:** W6, diagnostics lane; coordinate shared Settings files

**Checkpoint:** R

**Risks:** Combining existing provider payloads can reintroduce private fields;
construct diagnostics from an allowlisted summary type rather than serializing
runtime objects.

**Files likely touched:** `src-tauri/src/settings/diagnostics.rs`,
`src-tauri/src/commands/settings.rs`, `src/ipc/settings.ts`,
`src/features/settings/DiagnosticsSettings.tsx`,
`src/features/settings/SettingsPage.tsx`

**Estimated scope:** M

## Checkpoint R: Settings Complete

- [x] T61-T68 acceptance criteria pass.
- [x] Settings opens from the sidebar and `Command+,` and restores its group.
- [x] Appearance, lifecycle, refresh, editor, backup, privacy, and diagnostics
      behavior persists through restart.
- [x] Reset, backup deletion, and managed-configuration mutation remain separate.
- [x] Launch at login remains unavailable unless separately approved.

## T69: Complete desktop completeness verification and documentation

**Status:** Automated verification and documentation complete on 2026-09-21;
production publication remains blocked on the retained manual, signing,
notarization, and external CI gates.

**Description:** Run the approved project gates, trace all five revision specs
to evidence, record manual/external gates accurately, and update user-facing
documentation without publishing.

**Acceptance criteria:**
- [x] Every T45-T68 criterion maps to implementation evidence or an explicit
      approved blocker.
- [x] Native shell, baseline inventory, configuration platform, catalog
      coverage, and Settings behavior match the approved specifications.
- [x] Existing T01-T44 manual/signing/external blockers remain intact and no
      automated check reads or mutates real user configuration.

**Verification:**
- [x] `pnpm check`
- [x] `pnpm test:e2e`
- [x] `pnpm build:unsigned`
- [ ] Manual: complete fixed-window, keyboard, VoiceOver, contrast,
      reduced-motion, tray, icon, settings persistence, and baseline coverage
      review where local permissions and credentials allow. Foreground desktop
      interaction was intentionally not run during T69 so verification would
      not steal focus or interfere with other applications.

**Evidence:** `pnpm check` passed ESLint, both TypeScript projects, 29 Vitest
files / 71 tests, Rust formatting, strict Clippy, 92 library tests, and 22
integration tests. `pnpm test:e2e` passed its single macOS WebKit smoke using a
WDIO-created temporary `HOME`/`XDG_CONFIG_HOME`, a schema-valid hidden-window
preference fixture, and disabled optional unknown-root discovery; it did not
open or mutate real configuration. `pnpm build:unsigned` produced
`src-tauri/target/release/userhome`. `docs/release-readiness.md` maps all five
Desktop Completeness specifications to T45-T68 evidence and retains every
unperformed human, signing, notarization, GitHub-hosted, registry, and
hardware gate as open.

**Dependencies:** T46, T47, T48, T49, T50, T53, T57, T60, T63, T64, T65, T66,
T67, T68

**Parallel wave:** W7, integration only

**Checkpoint:** S

**Risks:** Passing automation can conceal unavailable signing or human-interface
evidence; retain every unperformed manual/external item as unchecked.

**Files likely touched:** `README.md`, `docs/release-readiness.md`,
`docs/managed-app-schema.md`, `docs/home-baseline-coverage.md`,
`tasks/todo.md`

**Estimated scope:** M

## Final review corrections

**Status:** Done on 2026-09-21

- [x] Backup retention preferences are atomically persisted before retryable
      cleanup. Cleanup failure returns `PARTIAL_FAILURE` while the saved policy
      remains active and visible.
- [x] Forced provider refreshes received during an active refresh are queued,
      and Privacy waits for the follow-up refresh that uses the new optional
      discovery roots.
- [x] Read-only PLIST documents are classified as metadata-only before body
      reads or UTF-8 validation. Binary plist content remains absent, the
      document remains read-only, and XML plist metadata stays redacted.

**Regression evidence:** `settings_coordinator_persists_before_retryable_follow_up_work`,
`createRefreshCoordinator > queues a forced refresh received during an active
refresh`, and `returns_only_metadata_for_binary_plists` each failed before its
fix and pass after it. The corrections are recorded in `a83a828`, `f77424d`,
`050bfac`, and `eb8035c`.

**Verification:** `pnpm check`, the hidden isolated-`HOME` `pnpm test:e2e`, and
`pnpm build:unsigned` pass. The first E2E attempt encountered a transient
Homebrew inventory timeout; the unchanged retry passed without opening the
native window or reading real user configuration. Orca Computer Use then
launched the built app with a separate temporary `HOME`: `Command+,` opened
Settings, keyboard navigation selected all seven groups in order, the sidebar
restored the selected Reset group, and a Privacy root change made during an
active refresh kept every root control disabled until the queued refresh
completed. The isolated preference file recorded only the selected `HOME`
root, and the test app plus temporary directory were removed afterward.

## Checkpoint S: Desktop Completeness Complete

- [x] T45-T69 acceptance criteria pass or retain an explicit approved blocker.
- [x] `pnpm check`, `pnpm test:e2e`, and `pnpm build:unsigned` pass.
- [x] All five approved revision specifications are traced to evidence.
- [x] Existing manual, signing, notarization, GitHub-hosted CI, and local
      Computer Use blockers remain accurately documented.
- [x] No automated verification reads or mutates real user configuration.

## T70: Consolidate semantic visual tokens and desktop primitives

**Status:** Implementation and automated verification complete on 2026-09-22;
manual appearance and 200% text-zoom inspection remains open.

**Description:** Define one geometry, spacing, radius, control-height, row,
surface, focus, and state-color contract and make shared primitives consume it.

**Acceptance criteria:**
- [x] Shared buttons, panels, badges, toolbar slots, and workspace panes use
      the same semantic CSS variables for equivalent states.
- [x] Fixed shell geometry remains 1120 x 720 with title bar 52 px, sidebar
      200-216 px, toolbar 44-52 px, and compact rows 32-44 px.
- [x] No provider, catalog, or mutation behavior moves into layout primitives.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Manual: inspect System, Light, and Dark appearances at 100% and 200% text
      zoom.

**Dependencies:** T45

**Parallel wave:** W8, visual foundation lane

**Checkpoint:** T

**Risks:** Shared CSS changes can regress every route; land semantic tokens
before route-specific visual work and serialize ownership of global styles.

**Files likely touched:** `src/styles/global.css`,
`src/components/DesktopWorkspace.tsx`, `src/components/ui/Button.tsx`,
`src/components/ui/Panel.tsx`, `src/components/ui/StatusBadge.tsx`

**Estimated scope:** M

## T71: Add the versioned configuration schema contract

**Status:** Done on 2026-09-22

**Description:** Add strict Rust schema types and a separately packaged
`schemas-v1.json` with the approved field kinds, 64-field bound, sensitivity,
constraints, applicability, adapter, validator, and source references.

**Acceptance criteria:**
- [x] Unknown versions, field kinds, constraints, references, and duplicate IDs
      fail closed.
- [x] `SECRET` fields are replacement-only and cannot contain defaults or
      readable corpus values.
- [x] Existing catalog path/write authority remains the only source of
      filesystem authorization.

**Verification:**
- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm typecheck`

**Dependencies:** T54

**Parallel wave:** W8, schema contract lane

**Checkpoint:** T

**Risks:** Schema metadata could be mistaken for filesystem authority; keep
schema presentation separate from catalog path, adapter, validator, and write
policy gates.

**Files likely touched:** `src-tauri/src/catalog/schema.rs`,
`src-tauri/src/catalog/mod.rs`, `src-tauri/src/catalog/definitions.rs`,
`src-tauri/src/catalog/schemas-v1.json`, `docs/managed-app-schema.md`

**Estimated scope:** M

## T72: Add the versioned preset contract and compatibility policy

**Status:** Done on 2026-09-22

**Description:** Add strict preset types for complete templates, field groups,
and recommended values with a 32-preset bound and two-version/180-day aliases.

**Acceptance criteria:**
- [x] Presets may reference only fields in their declared schema.
- [x] Field groups change no values; recommended presets change only declared
      fields; complete templates are marked new-file-only.
- [x] Unknown merge strategies, expired aliases, and secret literals fail
      closed.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm typecheck`
- [x] Inspect deterministic decoding of the independently versioned preset
      file.

**Dependencies:** T71

**Parallel wave:** W9, preset contract lane

**Checkpoint:** T

**Risks:** Presets could overwrite user-owned configuration or expose secrets;
enforce draft-only application, new-file-only complete templates, and
replacement-only secret fields.

**Files likely touched:** `src-tauri/src/catalog/preset.rs`,
`src-tauri/src/catalog/mod.rs`, `src-tauri/src/catalog/definitions.rs`,
`src-tauri/src/catalog/presets-v1.json`, `docs/managed-app-schema.md`

**Estimated scope:** M

## T73: Add official-source provenance and license contracts

**Status:** Done on 2026-09-22

**Description:** Define source IDs, canonical HTTPS URLs, official owners,
immutable revisions/digests, verification dates, staleness, license status,
and normalized-fact references.

**Acceptance criteria:**
- [x] Only approved official domains and repository owners are accepted.
- [x] Mutable-only sources require a content digest; unofficial or credentialed
      sources are rejected.
- [x] Source evidence never grants read, write, service, command, or elevation
      authority.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] Review source records for HTTPS, immutable revision/digest, license state,
      and 90-day staleness behavior.

**Dependencies:** T71

**Parallel wave:** W8, provenance lane

**Checkpoint:** T

**Risks:** Provenance may be treated as an authorization signal; require
separate catalog authorization and runtime capability checks for every action.

**Files likely touched:** `src-tauri/src/catalog/source.rs`,
`src-tauri/src/catalog/mod.rs`, `src-tauri/src/catalog/definitions.rs`,
`src-tauri/src/catalog/sources-v1.json`, `docs/managed-app-schema.md`

**Estimated scope:** M

## T74: Replace whole-catalog IPC with bounded Rust paging

**Status:** Done on 2026-09-22

**Description:** Raise reviewed bounds to 1,000 applications and expose typed
Rust commands for 50-item search/filter pages, counts/facets, and application
detail while retaining a temporary compatibility path.

**Acceptance criteria:**
- [x] No list response contains more than 50 applications.
- [x] Query text, category, coverage, detection, and capability filters are
      validated and applied in Rust.
- [x] Missing or invalid catalog data returns explicit failure, never empty
      success.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [x] Inspect serialized page and detail payloads for paths, secrets, and
      bounds.

**Dependencies:** T54, T73

**Parallel wave:** W8, catalog paging lane

**Checkpoint:** T

**Risks:** Paging can break selection and refresh semantics or leak oversized
payloads; enforce stable IDs, exact bounds, typed errors, and deterministic
ordering in Rust.

**Files likely touched:** `src-tauri/src/catalog/mod.rs`,
`src-tauri/src/commands/catalog.rs`, `src-tauri/src/commands/mod.rs`,
`src-tauri/src/lib.rs`

**Estimated scope:** L

## T75: Add strict frontend catalog, source, schema, and preset decoders

**Status:** Done on 2026-09-22

**Description:** Replace the monolithic catalog decoder with bounded page,
facet, detail, provenance, schema, and preset contracts.

**Acceptance criteria:**
- [x] Frontend decoding rejects oversized pages, unknown enums, malformed
      source references, and schema/preset counts above approved bounds.
- [x] WebView inputs contain IDs and typed values only.
- [x] Compatibility types remain only until T91 and are not used by new flows.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [x] Inspect every decoder bound against the Rust contract.

**Dependencies:** T71, T72, T73, T74

**Parallel wave:** W9, frontend contract lane

**Checkpoint:** T

**Risks:** Rust and TypeScript bounds can drift; mirror every version, enum,
count, and identifier limit and fail closed on unknown payloads.

**Files likely touched:** `src/ipc/catalog.ts`, `src/ipc/config.ts`,
`src/app/shellState.ts`, `src/App.tsx`

**Estimated scope:** M

## T76: Build maintainer-only corpus refresh and validation tooling

**Status:** Implementation and offline validation complete on 2026-09-22;
a fresh real-network refresh remains open.

**Description:** Add dependency-free Node 24 scripts that fetch only approved
official sources during explicit maintenance, normalize facts, calculate
digests, validate staleness/licenses, and never run in the client.

**Acceptance criteria:**
- [x] Refresh requires an approved manifest and writes to a staging output
      before replacing packaged data.
- [x] Validation runs offline against packaged artifacts.
- [x] A failed fetch or validation preserves the last approved corpus.

**Verification:**
- [x] Run the offline validation command with networking disabled.
- [ ] Run refresh against a disposable output and confirm production corpus
      bytes remain unchanged on failure.

**Dependencies:** T72, T73

**Parallel wave:** W9, corpus tooling lane

**Checkpoint:** U

**Risks:** Maintenance tooling could introduce runtime networking or corrupt
approved artifacts; keep scripts maintainer-only, dependency-free, staged, and
atomic.

**Files likely touched:** `package.json`,
`scripts/catalog/refresh-corpus.mjs`,
`scripts/catalog/validate-corpus.mjs`,
`catalog-corpus/source-manifest.json`, `docs/managed-app-schema.md`

**Estimated scope:** L

## T77: Import a pinned Homebrew formula application set

**Status:** Done on 2026-09-22

**Description:** Curate at least 250 stable application identities from the
official Homebrew formula API/repository with official project links and
support classifications.

**Acceptance criteria:**
- [x] Every entry has a stable ID, official source record, category, detection
      evidence, and explicit support class.
- [x] Entries without a verified config contract remain read-only, unsupported,
      or excluded and gain no write capability.
- [x] Duplicate formula/cask/project identities are resolved deterministically.

**Verification:**
- [x] Run the corpus validator.
- [x] Review generated counts, duplicate report, source domains, and
      write-capable count.

**Dependencies:** T76

**Parallel wave:** W10, formula corpus lane

**Checkpoint:** U

**Risks:** Bulk imports can create unverifiable identities or accidental write
authority; use pinned official facts and keep unverified entries non-writable.

**Files likely touched:** `catalog-corpus/apps/formulae.json`,
`catalog-corpus/sources/formulae.json`,
`catalog-corpus/reports/formulae-summary.json`

**Estimated scope:** L

## T78: Import a pinned Homebrew cask application set

**Status:** Done on 2026-09-22

**Description:** Curate at least 250 stable desktop application identities from
the official Homebrew cask API/repository with official vendor/project links.

**Acceptance criteria:**
- [x] Every entry satisfies the same provenance and authority separation as
      T77.
- [x] Cask/formula duplicates merge without changing existing Priority A IDs.
- [x] Apps with credentials, databases, logs, caches, or runtime-only state
      remain metadata-only or excluded.

**Verification:**
- [x] Run the corpus validator.
- [x] Review duplicate resolution and sensitive-data classifications.

**Dependencies:** T76

**Parallel wave:** W10, cask corpus lane

**Checkpoint:** U

**Risks:** Cask metadata can identify sensitive runtime data or collide with
formula identities; apply deterministic merging and explicit exclusion rules.

**Files likely touched:** `catalog-corpus/apps/casks.json`,
`catalog-corpus/sources/casks.json`,
`catalog-corpus/reports/casks-summary.json`

**Estimated scope:** L

## T79: Curate official configuration overlays for existing managed tools

**Status:** Done on 2026-09-22

**Description:** Add official config documentation/repository evidence for the
existing 26 catalog apps and map verified paths/fields to source IDs without
broadening write authority.

**Acceptance criteria:**
- [x] All current managed documents have official source references or an
      explicit unsupported rationale.
- [x] The six writable apps preserve current paths, adapters, validators, and
      write policies.
- [x] License metadata follows the normalized-facts/default and
      permitted-schema policy.

**Verification:**
- [x] Run the corpus and catalog validators.
- [x] Compare all existing app/config IDs and authorization fields before and
      after.

**Dependencies:** T76

**Parallel wave:** W10, managed overlay lane

**Checkpoint:** U

**Risks:** Overlay data can silently broaden established authorization; compare
all IDs and authority fields and treat source evidence as descriptive only.

**Files likely touched:** `catalog-corpus/apps/managed-overlays.json`,
`catalog-corpus/sources/managed-overlays.json`,
`docs/managed-app-schema.md`, `docs/home-baseline-coverage.md`

**Estimated scope:** M

## T80: Package and validate the 500+ application corpus

**Status:** Done on 2026-09-22

**Description:** Deterministically merge formula, cask, and managed overlays
into the runtime catalog while preserving current IDs and enforcing the 1,000
application ceiling.

**Acceptance criteria:**
- [x] Packaged output contains at least 500 unique applications and no more
      than 1,000.
- [x] Rebuilding unchanged inputs produces byte-identical catalog/source/
      schema/preset outputs.
- [x] Runtime catalog loading remains fully offline and fail closed.

**Verification:**
- [x] Run the corpus validator twice and compare digests.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [x] `pnpm typecheck`

**Evidence:** 624 unique applications. Runtime SHA-256
`3aeb04f2a1ee4293ae02926d0c64d9f6eb60972ab1eaafe33977d33870105afd`;
packaged corpus SHA-256
`11bc74cafe58d3259341733af10ce15baad471fdb742d7cd2cc2c30a17b3e501`.

**Dependencies:** T77, T78, T79

**Parallel wave:** W11, single-owner packaging lane

**Checkpoint:** U

**Risks:** Generated artifacts can be nondeterministic or conflict across
parallel branches; assign one packaging owner and compare byte-level digests.

**Files likely touched:** `scripts/catalog/build-corpus.mjs`,
`src-tauri/src/catalog/catalog-v2.json`,
`src-tauri/src/catalog/definitions.rs`,
`src-tauri/src/catalog/mod.rs`, `docs/managed-app-schema.md`

**Estimated scope:** L

## T81: Integrate the paged catalog provider into shell state

**Status:** Done on 2026-09-22

**Description:** Load facets and the first page rather than the whole catalog,
and expose cancellable query/page/detail requests with explicit loading/error
states.

**Acceptance criteria:**
- [x] Initial application load transfers at most one 50-item page plus bounded
      facets.
- [x] Stale search, page, detail, and refresh responses cannot overwrite newer
      state.
- [x] Provider failure remains visible and does not become an empty list.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [x] Inspect IPC calls during rapid query and refresh changes.

**Dependencies:** T75, T80

**Parallel wave:** W12, catalog provider lane

**Checkpoint:** V

**Risks:** Concurrent responses can replace newer state; use request
generations/cancellation and keep provider failures explicit.

**Files likely touched:** `src/App.tsx`, `src/app/shellState.ts`,
`src/ipc/catalog.ts`, `src/app/refreshCoordinator.ts`

**Estimated scope:** M

## T82: Implement search, filters, and exact 50-item pagination

**Status:** Implementation and automated performance verification complete on
2026-09-22; the full manual page matrix remains open.

**Description:** Rework Applications to request Rust pages and present result
counts, direct page selection, previous/next navigation, and bounded rows.

**Acceptance criteria:**
- [x] Query/category/coverage/detection/capability changes reset to page 1 and
      return within the 100 ms p95 target on the baseline Mac.
- [x] No page or DOM result list contains more than 50 application rows.
- [x] Empty, loading, partial, and error states remain confined to the list
      pane.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [x] Measure at least 50 representative 500-entry queries.
- [ ] Manual: inspect first, middle, final, and empty pages.

**Evidence:** 100 representative 624-entry Rust queries measured p95 at
22.470 ms. The isolated native E2E verifies 50 rows on page 1 of 13 and a
Rust-side search for GitHub Copilot.

**Dependencies:** T81

**Parallel wave:** W13, paging UI lane

**Checkpoint:** V

**Risks:** Frontend filtering could bypass Rust bounds or page state could
drift; make Rust results authoritative and reset page state on every filter
change.

**Files likely touched:** `src/features/apps/ApplicationsPage.tsx`,
`src/features/apps/CatalogCoverageSummary.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T83: Present source provenance and support boundaries in application detail

**Status:** Done on 2026-09-22

**Description:** Show official source titles, immutable revisions/digests,
verification freshness, license state, supported documents, exclusions, and
requirements without exposing unsafe values.

**Acceptance criteria:**
- [x] Each app detail shows its support class and source evidence state.
- [x] Stale or invalid source evidence is visible but never grants actions.
- [x] Unsupported/excluded apps expose zero mutation controls.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [x] Inspect writable, read-only, unsupported, excluded, fresh, and stale
      records.

**Dependencies:** T81

**Parallel wave:** W13, provenance detail lane

**Checkpoint:** V

**Risks:** UI presentation may imply stale evidence grants capability; render
support, provenance, and mutation authority as separate states.

**Files likely touched:** `src/features/apps/ApplicationSupportSummary.tsx`,
`src/features/apps/ApplicationsPage.tsx`,
`src/features/apps/SourceEvidence.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T84: Preserve selection, focus, page, and editor context

**Status:** Implementation and automated verification complete on 2026-09-22;
the full keyboard-only matrix remains open.

**Description:** Persist logical selection and return position across page
changes, detail/editor transitions, refreshes, and unrelated provider updates.

**Acceptance criteria:**
- [x] Arrow, Home, End, PageUp, PageDown, previous/next page, and direct page
      controls preserve predictable focus.
- [x] Returning from a config document restores query, filters, page, list
      scroll, app selection, and selected config document when still valid.
- [x] Removed results use a deterministic nearest-selection or empty-detail
      state.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Complete a keyboard-only navigation and refresh matrix.

**Dependencies:** T82, T83

**Parallel wave:** W14, application state lane

**Checkpoint:** V

**Risks:** Refreshes and paging can trap focus on removed rows; reconcile by
stable IDs and use a deterministic nearest-selection or empty-detail fallback.

**Files likely touched:** `src/features/apps/ApplicationsPage.tsx`,
`src/app/selectionMemory.ts`, `src/app/shellState.ts`,
`src/features/apps/ConfigWorkspace.tsx`

**Estimated scope:** M

## T85: Expose schema and preset presentation through typed IPC

**Status:** Done on 2026-09-22

**Description:** Return the selected config document's schema, presets,
applicability, source references, sensitivity, and disabled diagnostics without
returning secret values.

**Acceptance criteria:**
- [x] Unknown or mismatched schema/preset versions return typed disabled states.
- [x] Responses contain at most 64 fields and 32 presets.
- [x] Current `SECRET` values appear in zero IPC payloads.

**Verification:**
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config`
- [x] `pnpm typecheck`
- [x] Inspect serialized values for secret, path, and authority leakage.

**Dependencies:** T72, T75, T80

**Parallel wave:** W12, schema IPC lane

**Checkpoint:** W

**Risks:** Typed presentation payloads can leak current secrets or imply
authority; return only bounded metadata and replacement state, never secret
values or new authorization.

**Files likely touched:** `src-tauri/src/commands/config.rs`,
`src-tauri/src/config/read.rs`, `src-tauri/src/lib.rs`,
`src/ipc/config.ts`

**Estimated scope:** M

## T86: Build the generic schema field renderer

**Status:** Implementation and automated verification complete on 2026-09-22;
manual 200% text-zoom and field-kind interaction remain open.

**Description:** Render boolean, bounded integer, string, enum, string-list,
and replacement-only secret fields from schema data with shared grouping,
help, validation, and accessibility behavior.

**Acceptance criteria:**
- [x] Rendering dispatches by field kind, never `appId`.
- [x] Unknown fields are visibly disabled rather than routed to a generic
      writable fallback.
- [ ] At 1120 x 720 and 200% text zoom, every field and validation message
      remains reachable within the editor pane.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Manual: exercise every approved field kind, invalid state, and secret
      replacement behavior.

**Dependencies:** T70, T85

**Parallel wave:** W13, schema renderer lane

**Checkpoint:** W

**Risks:** A generic fallback could make unknown fields writable; require
explicit field-kind dispatch and a disabled presentation for unsupported data.

**Files likely touched:** `src/features/apps/editors/SchemaEditor.tsx`,
`src/features/apps/editors/SchemaField.tsx`,
`src/features/apps/editors/types.ts`,
`src/features/apps/editors/ConfigAdapterEditor.tsx`,
`src/styles/global.css`

**Estimated scope:** L

## T87: Add safe preset selection and draft application

**Status:** Implementation and automated verification complete on 2026-09-22;
manual preset interaction remains open.

**Description:** Add source-aware preset browsing, applicability warnings,
changed-field counts, draft-only application, and new-file-only complete
template execution.

**Acceptance criteria:**
- [x] Selecting a preset changes zero filesystem bytes.
- [x] Preview shows exact changed fields, source, warnings, and redacted diff
      before confirmation.
- [x] Complete templates cannot execute against an existing file in the first
      release.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml config`
- [ ] Manual: inspect field-group, recommended-value, and complete-template
      flows.

**Dependencies:** T72, T85, T86

**Parallel wave:** W14, preset workflow lane

**Checkpoint:** W

**Risks:** Preset selection could mutate files or replace existing
configuration; keep selection draft-only and enforce new-file-only complete
templates in the backend.

**Files likely touched:** `src/features/apps/editors/PresetPicker.tsx`,
`src/features/apps/editors/SchemaEditor.tsx`,
`src/features/apps/ConfigWorkspace.tsx`, `src/ipc/config.ts`,
`src-tauri/src/config/write.rs`

**Estimated scope:** M

## T88: Migrate Git and npm to schema-driven editing

**Status:** Implementation, review, and automated verification complete on
2026-09-22; manual preview comparison remains open.

**Description:** Define official-source-backed schemas/presets for Git and npm,
prove adapter parity, and select the generic editor while retaining the
specialized editors as compatibility fallback.

**Acceptance criteria:**
- [x] Existing structured values round-trip without changing unmanaged keys,
      comments, credentials, or file permissions.
- [x] npm auth token remains replacement-only and never appears in reads or
      diffs.
- [x] Existing preview, confirmation, backup, and rollback behavior is
      unchanged.

**Verification:**
- [x] Run existing Git/npm Rust and frontend checks through `pnpm check`.
- [ ] Manual: compare specialized and schema-driven previews on disposable
      files.

**Dependencies:** T87

**Parallel wave:** W15, Git/npm migration lane

**Checkpoint:** W

**Risks:** Generic fields may alter adapter-specific formatting or expose npm
credentials; compare disposable previews and retain compatibility editors
until parity is proven.

**Files likely touched:** `catalog-corpus/schemas/git-npm.json`,
`catalog-corpus/presets/git-npm.json`,
`src-tauri/src/catalog/schemas-v1.json`,
`src-tauri/src/catalog/presets-v1.json`,
`src/features/apps/editors/configEditorCapabilities.ts`

**Estimated scope:** M

## T89: Migrate Caddy and OpenSSH to schema-driven editing

**Status:** Implementation, review, and automated verification complete on
2026-09-22; manual disposable preview comparison remains open.

**Description:** Define schemas/presets for Caddy and OpenSSH while preserving
unsupported sections, managed blocks, validation, safe symlinks, and service/
elevation separation.

**Acceptance criteria:**
- [x] Caddy unsupported directives and OpenSSH unmanaged hosts remain
      unchanged.
- [x] Symlink and permission behavior matches the existing safe write pipeline.
- [x] Presets cannot trigger validation, service, or elevated execution
      directly.

**Verification:**
- [x] Run existing Caddy/SSH Rust and frontend checks through `pnpm check`.
- [ ] Compare old/new previews on disposable fixtures.

**Dependencies:** T87

**Parallel wave:** W15, Caddy/OpenSSH migration lane

**Checkpoint:** W

**Risks:** Migration could rewrite unmanaged sections or conflate file writes
with service/elevation actions; preserve managed boundaries and keep execution
capabilities separate.

**Files likely touched:** `catalog-corpus/schemas/caddy-ssh.json`,
`catalog-corpus/presets/caddy-ssh.json`,
`src-tauri/src/catalog/schemas-v1.json`,
`src-tauri/src/catalog/presets-v1.json`,
`src/features/apps/editors/configEditorCapabilities.ts`

**Estimated scope:** M

## T90: Migrate Copilot and Zsh to schema-driven editing

**Status:** Implementation, review, and automated verification complete on
2026-09-22; manual disposable preview comparison remains open.

**Description:** Define schemas/presets for approved Copilot settings and Zsh
managed blocks while excluding sessions, databases, logs, caches, tokens, and
unmanaged shell content.

**Acceptance criteria:**
- [x] Only approved Copilot settings documents receive fields or presets.
- [x] Zsh aliases, environment variables, and sources remain inside the
      managed block and preserve external shell content.
- [x] Sensitive and secret values remain redacted or replacement-only.

**Verification:**
- [x] Run existing Copilot/Zsh Rust and frontend checks through `pnpm check`.
- [ ] Compare old/new previews on disposable fixtures.

**Dependencies:** T87

**Parallel wave:** W15, Copilot/Zsh migration lane

**Checkpoint:** W

**Risks:** Broad Copilot discovery or Zsh rewrites could expose sensitive state
or alter unmanaged shell content; restrict approved documents and managed
blocks explicitly.

**Files likely touched:** `catalog-corpus/schemas/copilot-zsh.json`,
`catalog-corpus/presets/copilot-zsh.json`,
`src-tauri/src/catalog/schemas-v1.json`,
`src-tauri/src/catalog/presets-v1.json`,
`src/features/apps/editors/configEditorCapabilities.ts`

**Estimated scope:** M

## T91: Make schema-driven editing the default for the initial six apps

**Status:** Implementation, final independent review, and automated verification
complete on 2026-09-22; manual six-app inspection remains open.

**Description:** Route supported documents to the generic renderer and keep the
specialized editor only as a bounded compatibility fallback when schema parity
cannot be proven.

**Acceptance criteria:**
- [x] The normal path for all six apps renders without an `appId` branch.
- [x] Unknown or invalid schema/preset data disables structured editing.
- [x] Raw editing remains available only where the existing catalog policy
      already authorizes it.

**Verification:**
- [x] `pnpm check`
- [x] `pnpm test:e2e` without reading or writing real user configuration.
- [ ] Inspect all six apps in a disposable environment.

**Dependencies:** T88, T89, T90

**Parallel wave:** W16, schema cutover lane

**Checkpoint:** W

**Risks:** Premature cutover could remove safe specialized behavior; retain a
bounded fallback until parity evidence exists and fail closed on invalid
schemas.

**Files likely touched:** `src/features/apps/editors/ConfigAdapterEditor.tsx`,
`src/features/apps/editors/configEditorCapabilities.ts`,
`src/features/apps/ConfigWorkspace.tsx`,
`src-tauri/src/config/adapters/mod.rs`

**Estimated scope:** M

## T92: Normalize Applications and configuration workspace density

**Status:** Implementation and automated verification complete on 2026-09-22;
manual 200% text-zoom and appearance inspection remains open.

**Description:** Apply the shared geometry to application filters, pagination,
rows, details, provenance, config documents, fields, presets, previews, and
operation history.

**Acceptance criteria:**
- [x] One-line rows fit 32-44 px and required two-line rows fit within 64 px.
- [x] Long names, paths, diagnostics, and localized text wrap or move to
      details without hiding required actions.
- [ ] Applications/config content has no document-level scroll at 1120 x 720
      or 200% text zoom.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Inspect representative shortest and longest labels in System, Light, and
      Dark.

**Dependencies:** T70, T84, T91

**Parallel wave:** W16, Applications visual lane

**Checkpoint:** X

**Risks:** Shared density changes can hide actions or create document-level
scroll; keep pane-owned scrolling and verify long content at fixed geometry.

**Files likely touched:** `src/features/apps/ApplicationsPage.tsx`,
`src/features/apps/ConfigWorkspace.tsx`,
`src/features/apps/ApplicationSupportSummary.tsx`,
`src/features/apps/editors/SchemaEditor.tsx`,
`src/styles/global.css`

**Estimated scope:** M

## T93: Normalize shell, navigation, toolbar, and Dashboard

**Status:** Implementation and automated verification complete on 2026-09-22;
manual Dashboard keyboard and 200% text-zoom inspection remains open.

**Description:** Remove remaining route-level header/card drift and apply one
sidebar/toolbar/row/status hierarchy.

**Acceptance criteria:**
- [x] Shell, navigation, toolbar, Dashboard summaries, loading, partial, error,
      and empty states use shared primitives and semantic tokens.
- [x] Focus remains visible and unrelated async updates do not reset it.
- [x] No title, status, or primary action is clipped at supported scales.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Complete keyboard and 200% text-zoom checks on Dashboard.

**Dependencies:** T70

**Parallel wave:** W12, shell visual lane

**Checkpoint:** X

**Risks:** Shell-level changes affect every route and title-bar interaction;
keep provider behavior unchanged and coordinate ownership with T81 and T96.

**Files likely touched:** `src/app/AppShell.tsx`,
`src/components/NavigationRail.tsx`,
`src/components/DesktopWorkspace.tsx`,
`src/features/dashboard/DashboardPage.tsx`,
`src/styles/global.css`

**Estimated scope:** M

## T94: Normalize Homebrew and Services workspaces

**Status:** Implementation and automated verification complete on 2026-09-22;
manual keyboard and long-content inspection remains open.

**Description:** Apply the shared list/detail, compact row, control, dialog,
status, and scroll contract to package and service flows.

**Acceptance criteria:**
- [x] Search, rows, details, actions, previews, progress, errors, and history
      fit the fixed window with pane-local scrolling.
- [x] Equivalent controls match the application/configuration workspace.
- [x] Destructive actions remain separately previewed and confirmed.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Complete keyboard and long-content checks for package and service flows.

**Dependencies:** T70

**Parallel wave:** W13, Homebrew/Services visual lane

**Checkpoint:** X

**Risks:** Visual consolidation could weaken action confirmation or overflow
dense history panes; preserve the existing preview/confirm flow and explicit
scroll ownership.

**Files likely touched:** `src/features/brew/BrewInventoryPage.tsx`,
`src/features/brew/BrewPackageDetails.tsx`,
`src/features/services/ServicesPage.tsx`,
`src/features/services/ServiceDetails.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T95: Normalize Settings workspace and form controls

**Status:** Implementation and automated verification complete on 2026-09-22;
manual restart, appearance, keyboard, and long-label checks remain open.

**Description:** Apply shared group-row, field, help, validation, dialog, and
button geometry to all Settings panes without changing preference authority.

**Acceptance criteria:**
- [ ] Every Settings group and action remains reachable at 200% text zoom.
- [x] Appearance, lifecycle, refresh, backup, privacy, diagnostics, and reset
      controls use consistent sizing and state presentation.
- [x] Reset, backup clearing, and managed configuration mutation remain
      separate.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [ ] Complete keyboard, restart, Light/Dark/System, and long-label checks.

**Dependencies:** T70

**Parallel wave:** W14, Settings visual lane

**Checkpoint:** X

**Risks:** Shared form styling could blur destructive boundaries or clip long
labels; preserve separate confirmations and verify every group at 200% zoom.

**Files likely touched:** `src/features/settings/SettingsPage.tsx`,
`src/features/settings/SettingsSidebar.tsx`,
`src/features/settings/ConfigurationSettings.tsx`,
`src/components/ui/Button.tsx`, `src/styles/global.css`

**Estimated scope:** M

## T96: Enforce reliable title-bar drag and double-click no-op behavior

**Status:** Implementation and automated verification complete on 2026-09-22;
the real macOS 10/10 drag and 0/10 no-drag matrix remains open.

**Description:** Define explicit drag and no-drag primitives, inspect composed
pointer paths, and add a narrow Tauri/macOS event guard only if WebKit/CSS
cannot guarantee the approved double-click no-op.

**Acceptance criteria:**
- [ ] Title text and approved blank space move the window in 10/10 attempts.
- [ ] Buttons, links, fields, menus, list rows, editors, scrollbars, and dialogs
      move the window in 0/10 attempts and retain normal activation.
- [ ] Double-click changes size/position in 0/10 attempts and leaves a
      continuous 120 x 28 logical-pixel drag target.

**Verification:**
- [x] `pnpm lint && pnpm typecheck && pnpm build`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Complete the macOS pointer/trackpad matrix in System, Light, Dark, and
      supported display scales.

**Dependencies:** T70, T93

**Parallel wave:** W16, native drag lane

**Checkpoint:** X

**Risks:** WebKit/macOS double-click behavior may bypass CSS no-drag regions;
inspect runtime behavior first and add only a narrow native guard if required.

**Files likely touched:** `src/app/AppShell.tsx`, `src/styles/global.css`,
`src-tauri/src/lib.rs`

**Estimated scope:** M

## T97: Complete integrated verification and documentation

**Status:** Automated verification and documentation complete on 2026-09-22;
manual desktop, accessibility, signing, notarization, and external CI gates
remain open.

**Description:** Run existing project gates, perform the fixed-window/manual
matrix, document corpus maintenance and module evidence, and preserve every
external signing/notarization blocker accurately.

**Acceptance criteria:**
- [x] All six 2026-09-22 module specs trace to implementation evidence or an
      explicit approved external/manual blocker.
- [x] Existing T01-T69 blockers remain intact and are not falsely completed.
- [x] No verification reads or mutates real user configuration.

**Verification:**
- [x] `pnpm check`
- [x] `pnpm test:e2e`
- [x] `pnpm build:unsigned`
- [ ] Complete fixed-window, 200% zoom, keyboard, contrast, drag, pagination,
      provenance, schema/preset, disposable-write, and offline-runtime checks.

**Dependencies:** T80, T84, T91, T92, T93, T94, T95, T96

**Parallel wave:** W17, integration only

**Checkpoint:** X

**Risks:** Passing automation can conceal unperformed manual, signing, or
notarization gates; preserve every blocker accurately and use only disposable
configuration during verification.

**Files likely touched:** `README.md`, `docs/release-readiness.md`,
`docs/managed-app-schema.md`, `docs/home-baseline-coverage.md`,
`tasks/todo.md`

**Estimated scope:** L

## 2026-09-23 原生视觉重设计任务

状态：Phase 23–27 计划及 T98–T109 实施任务均于 2026-09-23 获用户审批。
所有任务沿用已批准规格，不新增依赖或测试用例，不接触真实 HOME
配置。每项只修改列明的文件；共享样式须由唯一编辑者串行接手，
保留其他会话的未提交修改。旧 T01–T97 未完成项仍保持原状态。

### Phase 23：视觉基础

## T98：建立原生语义颜色与排版令牌

**状态：**2026-09-23 已完成语义令牌及构建/计算样式核验；
真实 Tauri 逐页人工检查仍归 T109。

**目标：**将 Light/Dark/System 的画布、内容面、侧栏、蓝色强调、
危险/警告/成功、选中、焦点和字体层级归并为一套语义令牌。

**验收：**
- [x] 三种外观均按新规格渲染；状态不只靠蓝色表示。
- [x] 正文对比度至少 4.5:1，边界/焦点至少 3:1；有记录可复核。
- [x] 不更改窗口、业务行为、IPC 或现有配置安全边界。

**验证：**`pnpm lint && pnpm typecheck && pnpm build`；人工核对
Light/Dark/System 的基色和状态。依赖：无。

**文件归属：**`src/styles/global.css`（唯一编辑者）。
**规模：**S。

**证据：**Orca T98 `ctx_4db506d8d52a` 报告仅修改
`src/styles/global.css`。隔离 Chrome 的最终构建计算样式：
Light 最低文字 4.63:1、边界 3.05:1、焦点 5.20:1；
Dark/System 最低文字 7.01:1、边界 3.03:1、焦点 6.25:1。
`pnpm lint && pnpm typecheck && pnpm build` 通过；Node 20 对项目要求的
Node 24 有 engine 警告，Vite 保留既有约 500 kB chunk 警告。
无新测试、依赖、提交或真实 HOME 访问。

## T99：统一共用控件与异步状态

**状态：**2026-09-23 已完成共用控件与现有检查；T109 负责真实
Tauri 运行时的跨页人工验收。

**目标：**使按钮、状态标识、表单与弹窗、局部加载/空/错误沿用
T98 语义令牌及一致的尺寸、文字、焦点与禁用反馈。

**验收：**
- [x] 主/次/危险/幽灵按钮和状态标识在两种外观下清楚区分。
- [x] 加载、空、错误等局部反馈保留现有文案、语义角色和可见焦点。
- [x] 不通过增大阴影、渐变或大量胶囊装饰掩盖信息。

**验证：**`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；
人工检查组件状态。依赖：T98。

**文件归属：**`src/components/ui/Button.tsx`、
`src/components/ui/StatusBadge.tsx`、`src/components/ui/Modal.tsx`、
`src/components/AsyncState.tsx`（不编辑全局 CSS）。**规模：**M。

**证据：**Orca T99 `ctx_4ee2826c6c84` 报告仅修改上述四文件，
补足按钮按下态、长状态文案、轻量弹窗和错误/注意文字标识；
隔离 Chrome 实际 Tab 焦点显示 3px 描边，Light/Dark 代表性
文字组合满足对比度要求。`pnpm lint && pnpm typecheck && pnpm test
&& pnpm build` 通过（29 文件、72 个既有用例）；无新测试或依赖。

### Checkpoint Y：视觉基础

- [x] T98–T99 验收成立；色彩对比记录对应实际渲染状态。
- [x] 现有静态检查及构建通过；未宣称页面已完成重设计。

### Phase 24：固定桌面骨架

## T100：整理标题栏、导航与上下文工具栏

**状态：**2026-09-23 实现和静态核验完成；原生交通灯、拖拽和
快捷键前台验收留在 T109，不视为已人工验证。

**目标：**去掉重复的品牌/标题信息，将路线选择、搜索、刷新和状态
放到清楚的原生桌面层级，并保留 macOS 交通灯及菜单操作。

**验收：**
- [x] 一级导航的图标、文字与选中态清楚；工具栏仅显示当前页动作。
- [x] `Command+,`、`Command+R`、搜索清空及跳到主要内容仍可用。
- [ ] 标题栏交互不可拖拽，空白拖拽区域和交通灯不被覆盖；
      CSS/no-drag 静态核对通过，原生前台实际测试待 T109。

**验证：**`pnpm lint && pnpm typecheck && pnpm build`；
人工检查标题栏与键盘。依赖：T99。

**文件归属：**`src/app/AppShell.tsx`、
`src/components/NavigationRail.tsx`、`src/styles/global.css`。
**规模：**M。

**证据：**Orca T100 `ctx_64748c7677e9` 报告仅修改
`AppShell.tsx` 与 `global.css`：去掉 `UH` 徽标及重复路由标题，
标题栏保留 `UserHome`，工具栏展示当前页与刷新；复用原生菜单
单通路、搜索 Escape 和跳转主内容；`pnpm lint && pnpm typecheck
&& pnpm build` 通过。未触及 `NavigationRail.tsx` 的已有未提交修改。

## T101：修正分栏宽度和容器滚动归属

**状态：**2026-09-23 实现、静态检查及隔离浏览器几何验证完成；
真实 Tauri 有数据页面的可达性与交通灯交互待 T109。

**目标：**让列表/详情/检查器留出主操作和长文本空间，
且滚动只发生在侧栏、列表、详情或操作容器内。

**验收：**
- [x] 1120×720 没有文档级水平或垂直滚动；有后端数据时
      的按钮遮挡仍需 T109 前台验收。
- [ ] 200% 文本缩放时主操作可在指定 pane 内滚动到达；
      空态面板已验证，真实操作按钮待 T109。
- [x] 现有布局槽位和可访问名称继续工作。

**验证：**`pnpm lint && pnpm typecheck && pnpm build`；
人工查看面板边界与缩放。依赖：T100。

**文件归属：**`src/components/DesktopWorkspace.tsx`、
`src/styles/global.css`。**规模：**S。

**证据：**Orca T101 `ctx_87429efee503` 仅修改上述两文件；
补足键盘可聚焦滚动面板、详情最小宽度、稳定 gutter 与窄视口下
列表/详情纵向布局。隔离 Chrome 在 1120×720 和 560×360
（模拟 200%）对五个路由逐一核对：文档宽高等于视口，应用列表/
详情及设置面板可滚动。`pnpm lint && pnpm typecheck && pnpm build`
通过；真实 Tauri/有数据条件留给 T109。

### Checkpoint Z：桌面骨架

- [ ] T100–T101 静态及隔离浏览器验证完成；真实交通灯、拖拽、
      200% 下有后端数据的操作仍待 T109。
- [x] 共享 `AppShell.tsx`/`global.css` 串行完成，后续页面只读此契约。

### Phase 25：资源工作台

## T102：重排应用目录与分页操作

**状态：**2026-09-23 实现与隔离 HOME 的真实 Tauri E2E 已通过；
完整外观及 200% 前台人工验收仍归 T109。

**目标：**以应用名称和支持状态为主、次级来源信息为辅，
清晰呈现搜索、筛选、每页 50 项、选择与详情入口。

**验收：**
- [x] Rust 分页 50 项、筛选、选中/滚动记忆和键盘浏览行为不变。
- [x] 详情明确区分可写、只读、排除项；长名称不撑破窗口。
- [x] 加载、空、错误都在受影响 pane 内显示。

**验证：**`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；
隔离 HOME 的 `pnpm test:e2e` 复用已有分页断言。依赖：T101。

**文件归属：**`src/features/apps/ApplicationsPage.tsx`、
`src/features/apps/ApplicationSupportSummary.tsx`、
`src/styles/global.css`。**规模：**M。

**证据：**Orca T102 `ctx_834fc31b5c5c` 仅修改上述三文件，
补足默认页选择同步、紧凑截断列表、可访问的分页提示和支持边界；
`pnpm lint && pnpm typecheck && pnpm test && pnpm build` 通过
（72 个既有用例）。隔离 HOME 的 `pnpm test:e2e` 初次因 T100
移除 `.brand` 而遇到旧选择器；协调者仅在现有
`e2e/smoke.spec.ts` 更新两处已过期选择器（没有新增用例），
复跑 1 项 E2E 通过。未操作真实 HOME。

## T103：重排配置详情、表单与预览

**状态：**2026-10-10 隔离 HOME 的真实 Tauri 复验已确认 Git、
npm、OpenSSH、Copilot settings、Zsh 的 Schema、草稿与安全预览，
既有 camelCase 修复有效；后续已修复并验证精确窗口尺寸与列表
草稿输入。Caddy 一次性目标、真实 200% 缩放仍受阻，本任务
保持未完成。

**目标：**将身份/能力、文档选择、schema 字段/预设、diff/确认
按从查看到执行的顺序组织，保留警告与隐藏敏感信息。

**验收：**
- [ ] 六款既有可写应用的字段、预设与安全预览仍可达。
- [ ] 只读无写入按钮；敏感值、错误和危险动作仍明确受限。
- [ ] 200% 文本缩放下预览与确认可通过局部滚动抵达。

**验证：**`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；
人工查看一次性配置的预览/确认，不操作真实文件。依赖：T102。

**文件归属：**`src/features/apps/ConfigWorkspace.tsx`、
`src/features/apps/editors/SchemaEditor.tsx`、
`src/features/apps/editors/PresetPicker.tsx`、
`src/styles/global.css`。**规模：**M。

**证据：**Orca T103 `ctx_09c15c4afa2c` 修改上述四文件；
`pnpm lint`、`pnpm typecheck`、`pnpm test`（72 项）、
`pnpm build` 及六适配器定向测试（27 项）通过。隔离 HOME
的 Git 文档可读，但 Schema 校验报错；协调者定位到
`src-tauri/src/commands/config.rs` 的 `FieldTypePresentation`
枚举字段序列化未按前端协议使用 camelCase，并添加
`rename_all_fields = "camelCase"`；Rust 格式检查和 Clippy 通过。
当时该修复尚待真实 Tauri 复验，后续结果如下。

**2026-10-10 复验证据：**Orca Run `run_309bec7341e6`、
Task `task_20f5a3b30e5d`、Dispatch `ctx_0c468dcf6c71` 以
`failed` 如实结算（验收未闭环），未修改实现、权限或测试。
Node 24.21.0 / pnpm 12.11.2 下四项前端门禁通过（29 文件、
72 项），一致的 Homebrew Rust 1.99 工具链下 19 项既有适配器
测试通过，E2E-enabled 原生构建通过。

Git 的实际原生 AX 操作、对话框与截图确认字段/预设草稿可到达
预览及确认；npm、OpenSSH、Copilot settings、Zsh 通过已有
embedded WebDriver 驱动真实 WebView 控件取得同类 100% 证据，
不是四页完整前台人工验收。两份 VS Code 只读文档未出现写入、
预览或恢复按钮；一次性令牌/私钥哨兵未进入可见内容或预览。
五份配置字节未变，没有确认执行写入或真实包/服务操作。

Caddy 授权目标固定为 Homebrew 的 `etc/Caddyfile`，无隔离
HOME 目标，故未读取真实文件，Rust fixture 通过不替代原生
Caddy 预览。前台缩放快捷键在 restore 后仍返回
`window_not_focused`；native zoom IPC 被现有权限拒绝，
字体仍为 13px，未扩大 capability 或用模拟缩放代替验收。
原生实际尺寸为 1121×721（2242×1442 physical / scale 2），
非规格 1120×720；不改动的 smoke 在 `e2e/smoke.spec.ts:50`
因宽度预期 1120、实际 1121 失败，根因未确定。

完整报告及截图保留在工作者 session 的
`files/t103/T103-verification-report.md`，摘要与复测边界见
`docs/release-readiness.md` 的 T103 小节。一次性 HOME/应用进程
已清理；协调者复核三份用户依赖改动 SHA256 均未变，无提交或
发布。Orca cleanup 返回 `retained / user_takeover`，终端归用户，
没有关闭用户接管的会话。T108/T109 与全部旧阻塞保持原状态。

**2026-10-10 候选合并复测：**既有 smoke 再次稳定复现
1121×721；主窗口新增相同的最小/最大 1120×720 内容尺寸约束，
未放宽既有断言。原生结果变为 1120×720，禁止 resize/maximize
与隐藏启动仍成立，完整既有 smoke 通过。

合并前审查另复现 `SchemaField` 列表控件逐键 trim/filter 的回归：
`ll=ls -la` 会变成 `ll=ls-la`，多行 source 路径会被拼接。
现保留原始空格、空行和末尾换行，仅在 `SchemaEditor` 构建预览
patch 时 trim/filter；非列表 patch 与草稿本身保持不变。
一次性内存复现由失败转为通过，并核验完整 patch 形状；真实
Tauri WebView 逐字符输入别名与两行路径、打开屏蔽差异的预览、
取消并返回草稿均通过，`.zshrc` 原字节不变。最初验证脚本误把
屏蔽差异当作可见内容，纠正验证预期后通过，没有降低产品断言。
没有新增仓库测试、依赖、权限或真实配置操作。

用户明确选择把当前实现作为无签名审查候选合并到本地 `main`，
不是关闭 T103/T109 或批准发布；既有依赖改动原样保留且不混入
本次提交。最终门禁及剩余边界见 release-readiness 的候选合并
小节。

## T104：重排 Homebrew 库存、搜索及操作

**状态：**2026-09-23 实现与现有自动化通过；原生 Tauri
WebView 200% 缩放下操作可达性待 T109 前台验证。

**目标：**用统一列表/详情与动作层级呈现库存、搜索、安装/升级/卸载，
使无 Homebrew 和失败状态只影响本区。

**验收：**
- [ ] 列表/详情选择、搜索与分页保留；操作目标和破坏性清楚。
- [ ] 无 Homebrew、部分加载、搜索无结果和错误状态有专属提示。
- [ ] 预览→确认→结果流程仍可用且不会默认执行命令。

**验证：**`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；
人工检查操作弹窗，不对真实包进行更改。依赖：T101。

**文件归属：**`src/features/brew/BrewInventoryPage.tsx`、
`src/features/brew/BrewPackageDetails.tsx`、
`src/features/brew/BrewActionDialog.tsx`、
`src/styles/global.css`。**规模：**M。

**证据：**Orca T104 `ctx_57357569cf15` 仅修改上述四文件，
以紧凑库存行呈现状态，详情在分页/筛选后保持选中，预览防止
旧响应覆写，并在确认框明示目标和动作。`pnpm lint`、
`pnpm typecheck`、`pnpm test`（72 项，其中 Homebrew 定向
7 项）、`pnpm build` 及 `git diff --check` 通过。未对真实
软件包执行安装、升级或卸载；未为模拟 200% 缩放放宽 WebView
权限，真实缩放验收仍未完成。

## T105：重排服务状态与确认式操作

**状态：**2026-09-23 页面实现与既有自动化通过；原生 Tauri
200% 缩放下确认框可达性待 T109 实测。

**目标：**使服务列表、选中详情和开始/停止/重启的状态、反馈、
确认清楚且与 Homebrew 工作台一致。

**验收：**
- [ ] 未授权或未知服务不出现可执行的操作。
- [ ] 选中项、状态文字、预览确认和进度保持对应且不只靠颜色。
- [ ] 空、错误、刷新状态不清空无关面板。

**验证：**`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；
人工检查确认弹窗而不触发真实服务更改。依赖：T101。

**文件归属：**`src/features/services/ServicesPage.tsx`、
`src/features/services/ServiceDetails.tsx`、
`src/features/services/ServiceActionDialog.tsx`、
`src/styles/global.css`。**规模：**M。

**证据：**Orca T105 `ctx_823d14a3dd16` 仅修改上述四文件；
保留服务选择/焦点、未知作用域只读限制和绑定服务 ID/动作的
预览确认结果。`pnpm lint`、`pnpm typecheck`、`pnpm test`
（29 文件/72 项）、`pnpm build` 及 `git diff --check` 通过。
未触发真实服务操作，未扩张 WebView 缩放权限；原生 200%
检查尚未完成。

### Checkpoint AA：资源工作台

- [ ] T102–T105 验收成立；应用及配置顺序执行，所有全局 CSS
      编辑串行；Homebrew/Services 仅在 TSX 文件独占时并行。
- [ ] 既有分页、草稿、授权、预览与确认行为未回退。

### Phase 26：工具工作台

## T106：重排仪表盘摘要

**状态：**2026-09-23 页面实现与静态/现有测试通过；
200% 原生缩放下主操作可达性待 T109 验证。

**目标：**按本机概况、需要关注、最近操作组织文本/数据分组，
不以花哨卡片代替可辨识的真实状态。

**验收：**
- [ ] 连接、发现、Homebrew、操作的正常/部分/失败仍各自清楚。
- [ ] 不引入永久状态侧栏、营销 hero 或通用卡片网格。
- [ ] 主操作在 100% 和 200% 缩放均可达。

**验证：**`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；
人工检查正常/加载/错误状态。依赖：T101。

**文件归属：**`src/features/dashboard/DashboardPage.tsx`、
`src/features/dashboard/SystemSummary.tsx`、
`src/styles/global.css`。**规模：**M。

**证据：**Orca T106 `ctx_d41cda8b5656` 仅修改上述三文件；
本机概况、需要关注与最近活动采用紧凑纵向分组，保留连接、
发现、Homebrew、刷新和操作状态及局部错误。`pnpm lint`、
`pnpm typecheck`、`pnpm test`（29 文件/72 项）、`pnpm build`
及 `git diff --check` 通过。当前没有可供该工作者检查的
UserHome 原生窗口；真正 200% 缩放结果仍未验证。

## T107：重排七组设置与危险操作

**状态：**2026-09-23 实现与既有自动化通过；
原生窗口及 200% 缩放下七组操作的实际可达性待 T109 验收。

**目标：**使分组导航、标题说明、表单对齐、保存反馈、
重置与清理危险区具有清晰的原生设置层级。

**验收：**
- [ ] 七组设置、分组选择恢复与 `Command+,` 保持可用。
- [ ] 外观切换、保存错误、安全默认值、清理/重置确认有明确反馈。
- [ ] 200% 缩放和所有外观下操作完整可达。

**验证：**`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；
隔离 HOME 查看设置恢复，不清理真实备份。依赖：T101。

**文件归属：**`src/features/settings/SettingsPage.tsx`、
`src/features/settings/SettingsSidebar.tsx`、
`src/features/settings/SettingsPrimitives.tsx`、
`src/styles/global.css`。**规模：**M。

**证据：**Orca T107 `ctx_bbbb31e11296` 仅修改上述四文件；
七组设置窄视口导航可横向滚动且支持方向键，安全默认值
诊断可见，重置与清理确认均以取消为默认路径。`pnpm lint`、
`pnpm typecheck`、`pnpm test`（29 文件/72 项）、`pnpm build`
及 `git diff --check` 通过。未清理真实备份；原生 UserHome
窗口及 200% 检查尚未实测。

### Checkpoint AB：工具工作台

- [ ] T106–T107 验收成立；设置已保存值及重置语义不变。
- [ ] 仪表盘真实状态、危险操作文案及键盘导航未回退。

### Phase 27：跨路由验收

## T108：执行既有自动化与无签名集成关口

**状态：**2026-09-24 三项本地门禁在隔离 HOME 下最终通过；首次
失败及复跑原因保留在下方。Git Schema 原生入口与 200% 前台
验收未覆盖，仍归 T109；不代表可发布。

2026-10-10 候选复测补充：Node 24.21.0 / pnpm 12.11.2 下
前端 lint/typecheck、29 文件/72 项既有测试通过；一致的
Homebrew Rust 1.99 下格式、严格 Clippy、92 项库测试与
22 项集成测试通过。修复窗口约束后完整既有 macOS smoke
通过，修复列表输入后再跑同一 smoke 亦通过；最终无签名
生产构建通过，624 项目录校验通过。保留既有大 chunk 及
WDIO teardown 警告，不将这些自动化结果算作 T109 人工验收。

**目标：**汇总五个模块实现证据及本地静态、前端、Rust、隔离
HOME 的 macOS E2E、无签名构建结果，不以通过测试代替视觉验收。

**验收：**
- [x] `pnpm check`、`pnpm test:e2e`、`pnpm build:unsigned`
      实际运行结果如实记录；失败被修复或明确留作阻塞。
- [x] 既有 T01–T97 人工/外部阻塞仍原样追踪。
- [x] 自动化没有读取或修改真实用户配置。

**验证：**上述三个命令；复核隔离 HOME 设置。依赖：T103–T107。

**文件归属：**`docs/release-readiness.md`、`tasks/todo.md`
（只更新新阶段证据）。**规模：**S。

**证据：**Orca T108 `ctx_71df4a76e36a` 使用临时 HOME 执行：
`pnpm check` 最终通过（29 文件/72 项 Vitest、92 项 Rust 库测试、
22 项集成测试及 0 项失败的 doc-test）；首轮因 Homebrew
`rustdoc` 与 rustup 缓存产物混用，doc-test 报 238 个
`serde`/E0463 错误，固定 rustup Cargo/rustc/rustdoc 后通过。
`pnpm test:e2e` 首轮在 `e2e/smoke.spec.ts:117` 因
`Homebrew inventory timed out.` 未满足计数/未安装断言而失败；
换新的隔离 HOME 复跑 1/1 通过，未改产品或测试代码。
`pnpm build:unsigned` 首轮在空 HOME 中因 Corepack 下载
pnpm 10.33.1 遇 `UND_ERR_SOCKET` 失败；复制本机现有 pnpm 缓存
到临时 HOME、禁用网络后成功生成
`src-tauri/target/release/userhome`。WDIO 额外隔离
`HOME`/`XDG_CONFIG_HOME`，未调用真实包/服务写入。现有 smoke
不进入 Git Schema 页，Rust 序列化修复及安全预览在原生 UI
仍未复验；Node 20.20.2 与要求的 24.21.0 不同。真正的
Light/Dark/System、1120×720、200% 可达性、签名、公证及 CI
证据仍由 T109 或原阻塞任务追踪，不能因本轮自动化关口勾选。

## T109：完成前台桌面视觉与交互验收

**状态：**2026-09-24 已在隔离 HOME 启动真实原生窗口，
但本机 Orca Computer Use 的全局 AX 读取不可用，窗口截图亦失败；
五组 × 三种外观 × 两种缩放均为阻塞，未完成视觉验收。

**目标：**逐页记录 Light/Dark/System 与 100%/200% 缩放、
键盘、焦点、拖拽、对比度及状态实际表现。

**验收：**
- [ ] 五组工作台每组分别有三种外观及两种缩放的人工证据。
- [ ] 文档滚动量为零，pane 可达操作；对比度阈值实际核验。
- [ ] 无法完成的签名、CI、硬件、权限或人工项标记为“待验证/
      阻塞”，不伪称所有旧任务已完成。

**验证：**按 `../docs/specs/SPEC-visual-acceptance-v2.md` 的矩阵实际检查，
隔离 HOME，记录复测及未完成理由。依赖：T108。

**文件归属：**`docs/release-readiness.md`、`tasks/todo.md`
（只更新验收证据）。**规模：**S。

**证据：**使用隔离 `/tmp/userhome-t109-ctx6c00` 的 `HOME`/
`XDG_CONFIG_HOME`，`preferences.json` 权限 `0600`、设置目录
`0700`、`optionalDiscoveryRoots=[]`；本次 release 二进制在
临时 `.app` 外壳内运行。`orca computer list-windows` 看到
UserHome PID 3947 的窗口 ID 4032（屏幕像素 1009 × 650），
但 `get-app-state --restore-window` 返回 `permission_denied`/
`no accessibility window`；System Settings、Orca 自身相同，
尽管 accessibility/screenshots 均报 `granted`。窗口专用
`screencapture` 也无法生成图像。可复现命令、5×3×2
逐格阻塞及各阈值/交互未验证项详见
`docs/release-readiness.md` 的 T109 小节；Git Schema
原生预览仍须复验。未操作真实用户配置，也未执行包、服务
或配置写入；签名、公证、GitHub CI、硬件和旧人工关口继续
保持 NO-GO，不能据此勾选本任务验收项。

### Checkpoint AC：重设计验收

- [ ] T98–T109 均以证据关闭，或注明不可跨越的外部/人工阻塞。
- [ ] 不把已批准新设计误称为已签名/公证/发布。
- [ ] 旧计划所有未完成项继续真实存在，直至取得相应证据。

## Phase 28：UI 纠偏 v3 受保护基线

## T110：登记 v3 阶段并稳定当前工作树

**状态：**2026-10-10 已完成；仅登记已批准规格、任务和基线证据，
未改变产品行为。

**目标：**在不覆盖 dirty working tree 的前提下建立 T110–T124 的可执行
基线，并把批准状态、依赖和排除项写入项目记录。

**验收：**
- [x] 四份 v3 规格、总规格及能力图记录 2026-10-10 审批状态。
- [x] `tasks/plan.md` 与 `tasks/todo.md` 登记 T110–T124，T01–T109
      原状态和证据不变。
- [x] `package.json`、`pnpm-lock.yaml`、`.nvmrc` 的 pnpm 12 迁移明确
      排除本轮并记录校验值。
- [x] 当前前端基线可通过 TypeScript 编译；未发现需要修改的阻断性
      `AppShell` 结构错误。

**验证：**审批登记断言先因规格仍为草案而失败；更新后复跑该断言、
本地 Markdown 链接、`git diff --check`、`pnpm typecheck`、完整
`pnpm test` 与 `pnpm build`。

**依赖：**T109 后的新阶段；不关闭 T103/T109。
**文件归属：**`docs/specs/SPEC*.md`、`CAPABILITY-MAP.md`、
`tasks/plan.md`、`tasks/todo.md`。
**规模：**S。

**证据：**实施前受保护文件 SHA-256：`package.json`
`b7fae9a917d23bbbc3f5685aebb0e6969be73860496606b808ab57e9f86a5b77`；
`pnpm-lock.yaml`
`15e323cdf52a35f28168ff56874df6f369bf63969f7c17f1db055683553afe25`；
`.nvmrc`
`73fb1b615e2043a933be1c0895cde4358036acc28d785692509b822aa53c761f`。
分支 `chore/ui-correction-v3-t110` 上的 RED 审批断言按预期失败；
实施前 `pnpm typecheck` 已通过，证明规划期看到的重复 `</header>` 已不
存在，故未重复修改 `AppShell.tsx`。GREEN 后审批/任务登记断言通过，
96 个本地 Markdown 链接全部可解析，`git diff --check` 通过；完整
`pnpm test` 通过（29 文件、73 项），`pnpm build` 通过（含 typecheck，
Vite 302 modules transformed）。构建保留既有单一 chunk 超过 500 kB
警告，不属于 T110 阻断。保护文件复核与实施前 SHA-256 完全一致。

## Phase 29：外观与发现契约

## T111：恢复 System/Light/Dark 协议

**状态：**2026-10-10 已完成。

**目标：**恢复默认 System、显式 Light/Dark、即时应用、持久化和失败
回滚，不改变 settings schema 或当前 UI 状态。

**验收：**
- [x] 三个持久化值均正确渲染，System 可跟随系统明/暗。
- [x] 切换不丢失路由、选择、筛选、分页或编辑草稿。
- [x] 移除 fixed-dark 实现、文案和冲突测试契约。

**验证：**定向 appearance/settings tests；`pnpm lint && pnpm typecheck && pnpm test && pnpm build`。
**依赖：**T110。
**文件归属：**appearance、前后端 settings、Appearance Settings、相邻测试。
**规模：**M。

**T111 实施证据（2026-10-10，未提交）：**

- 净提交文件：`src/app/appearance.ts`、`src/app/AppShell.test.tsx`、
  `e2e/smoke.spec.ts`、本证据段。`src/App.tsx`、前后端 settings 默认值、
  `AppearanceSettings` 三选一及显式 prop wiring 恢复后与已提交基线一致，
  因而没有净提交差异。既有导航、品牌、Dashboard 与视觉布局改动继续留在
  工作树，未纳入 T111；`src/styles/global.css`、`package.json`、
  `pnpm-lock.yaml`、`.nvmrc` 也未纳入。
- 实现：`applyAppearance` 将 SYSTEM/LIGHT/DARK 映射为
  `data-appearance=system|light|dark` 且 `colorScheme='light dark'|'light'|'dark'`；
  默认持久化值恢复 SYSTEM（前端 `DEFAULT_USER_PREFERENCES` 与 Rust
  `UserPreferences::default`），schema 不变。因 `routes.tsx`/`SettingsPage.tsx`
  不在 T111 归属内，AppShell 通过 `AppearanceControlContext`（定义于
  `appearance.ts`）向下提供 `onAppearanceChange`，`AppearanceSettings` 消费该
  上下文恢复三选一、即时 apply、持久化与失败回滚；App 层 `changeAppearance`
  先 apply 再持久化，失败时回滚。
- RED：
  - `pnpm exec vitest run src/app/AppShell.test.tsx` → 2 failed（映射返回
    `'dark'`；`AppearanceControlContext` 未定义）。
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib settings_` → 2 failed
    （默认快照 DARK≠SYSTEM；保留文件 appearance Dark≠System）。
- GREEN / 完整验证：
  - `pnpm exec vitest run src/app/AppShell.test.tsx` → 5 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib settings_` → 10 passed。
  - `pnpm lint` → 通过（无输出）。
  - `pnpm typecheck` → 通过。
  - `pnpm test` → 29 files / 74 tests passed。
  - `pnpm build` → 成功（仅既有 >500 kB chunk 警告）。
  - `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` → 通过。
- E2E 未运行（按要求仅更新断言）：`e2e/smoke.spec.ts` 移除硬断言
  `appearance === "dark"`，改为校验持久化值为 system/light/dark 之一、
  对应 colorScheme 映射，并在 System 时确认 `colorScheme='light dark'`
  与 `prefers-color-scheme` 媒体查询可解析一致。
- 剩余：无 T111 阻塞项；固定深色文案与冲突测试契约已移除。

## T112：保留完整 configuration coverage 与旧 snapshot

**状态：**2026-10-10 已完成。

**目标：**停止丢弃 scan summary/outcomes，从同一 snapshot 计算四类计数，
并在刷新失败时保留上一份可用数据。

**验收：**
- [x] `DiscoverySnapshot.candidates` 保留完整 `ConfigurationCoverage`。
- [x] 四类计数之和等于 candidateCount，安全路径和 limits/outcomes 保真。
- [x] partial/error 显示已取得结果；refresh error 可携带 previous snapshot。
- [x] 新增已批准的 DTO、selector、stale snapshot 定向测试。

**验证：**定向 Vitest；`pnpm lint && pnpm typecheck && pnpm test && pnpm build`。
**依赖：**T110。
**文件归属：**`src/ipc/discovery.ts`、shell state/App、共享 selector 及测试。
**规模：**M。

**T112 实施证据（2026-10-10）：**

- `DiscoverySnapshot.candidates` 保留完整 `ConfigurationCoverage`；legacy array
  仍合成兼容 summary。decoder 保真并校验 candidateCount/limits、安全路径与
  permission/timeout/limit/symlink outcomes。
- 新增 `discoverySelectors`，统一四类计数、守恒标记、complete/empty/partial、
  restricted、issues/outcomes，并提供旧列表消费者的最小适配。
- `DiscoveryState` error 可携带 `previousSnapshot`；reducer 在首次成功后的刷新
  失败及重复失败中保留旧数据，在从未成功时不虚构 snapshot。
- RED：3 个测试文件、4 项失败（summary 被压扁、selector 缺失、旧 snapshot
  未保留）。GREEN：定向 28 项通过；完整 `pnpm test` 34 文件/101 项通过，
  `pnpm lint`、`pnpm typecheck`、`pnpm build` 均通过。
- 未修改 Rust wire schema、扫描权限、`AppShell`、global CSS 或包管理器文件；
  Dashboard/Applications 只做维持编译所需的数据适配，未提前实现 T117/T118。

## T113：补齐既有 catalog path variant exact probes

**状态：**2026-10-10 已完成。

**目标：**让 discovery exact probe 遍历既有 document path variants，并保持
批准根、上限、metadata-only 和 wire schema 不变。

**验收：**
- [x] secondary variant 可被识别且 ID/安全路径/分类稳定。
- [x] 不新增根、深度、内容读取、权限或 IPC 字段。
- [x] 现有 Rust fixture 覆盖 variant 去重和 Docker 类路径。

**验证：**Rust discovery 定向测试、fmt、Clippy、cargo test。
**依赖：**T110。
**文件归属：**Rust catalog/discovery candidates 及现有测试。
**规模：**S/M。

**T113 实施证据（2026-10-10）：**

- `catalog_candidate_metadata()` 复用 catalog 的 `path_variants()`、`root()`、
  `relative_path()` 与 legacy `path_template()`，将全部既有 variant 去重映射到
  原有 HOME/Homebrew exact-probe map；扫描循环、containment、上限和 wire DTO
  未改变。自定义合法 XDG 根继续由既有 `.config/...` exact-probe 重映射逻辑
  覆盖，Application Support 继续受 HOME containment 检查。
- RED：新增 `recognizes_every_declared_catalog_path_variant`，只创建 Docker
  secondary `Library/Group Containers/group.com.docker/settings.json`；修复前因
  无 candidate 失败。
- GREEN：该 fixture 识别为安全相对路径、`docker`、`MANAGED_READ_ONLY`、
  `SECRET` 与 `CATALOG_DOCUMENT`；`cargo test --lib discovery::` 8 项通过。
- 完整验证：`cargo fmt --check`、严格 Clippy、完整 `cargo test` 均通过；
  93 项 lib 与 22 项 integration 测试零失败。仅修改
  `src-tauri/src/discovery/candidates.rs` 与本证据段，无新 root、遍历、内容读取、
  权限、IPC 字段或 catalog model 变更。

## Phase 30：共享视觉系统与 Shell

## T114：收敛全局 token 与共享控件

**状态：**2026-10-10 已完成。

**目标：**统一三主题语义颜色、13/12/11/14/20px 文字层级、32–36px
控件、间距和可自然增高的资源行。

**验收：**
- [x] 共享视觉基线不再发放私有色板、装饰渐变或不可核验正文叠色；路由兼容债务留 T115–T123。
- [x] 相同语义控件的尺寸、边界、状态和焦点一致。
- [x] 共享组件允许 200% 自然增高，不使用 9/10px、ellipsis、clamp 或固定高度隐藏内容。
- [x] 兼容 CSS 暂留至全部路由完成。

**验证：**共享组件测试；lint、typecheck、test、build。
**依赖：**T111。
**文件归属：**global CSS、shared UI、AsyncState、Settings primitives。
**规模：**L。

**T114 实施证据（2026-10-10）：**

- `--app-*` 增加 light/dark/system 一致的 raised surface、control border、
  tertiary text、backdrop、scrollbar、11/12/13/14/20px 字体及行高 token；
  controls 为 32/36px，resource rows 为 36/40/52px 且使用 min-height。
- Button、StatusBadge、Modal、AsyncState 与 Settings primitives 改用语义字体、
  backdrop、focus 和 wrapping；共享组件无 truncate/line-clamp/ellipsis/fixed height。
- RED：共享测试缺少 `text-body/aux/meta/group`、`bg-backdrop`、focus token 与
  三主题断言，共 10 项失败。GREEN：共享定向 13 项通过，`pnpm lint`、
  `pnpm typecheck`、完整测试和 build 通过；主题 token 集静态对比通过。
- `global.css` 的既有路由兼容/Control Lab 工作树改动未纳入本任务提交，继续由
  T115–T123 串行处理；当前工作树仍有 12 处 ellipsis、5 处渐变和路由私有
  硬编码颜色，不能据此宣称五路由已完成。

## T115：统一 Shell、route host 与滚动所有权

**状态：**2026-10-10 已完成。

**目标：**只保留原生标题栏、主导航、单一上下文工具栏和明确 pane
滚动所有权。

**验收：**
- [x] 移除标题栏副品牌与 shell hero，建立单一工具栏和无滚动 route host；页面内部重复标题留各路由任务。
- [x] document 无滚动；list/inspector/operation 各自滚动，detail 作为无滚动 route host。
- [x] traffic lights、drag/no-drag、快捷键、导航焦点和窗口约束保留。

**验证：**AppShell 定向测试；lint、typecheck、test、build。
**依赖：**T114。
**文件归属：**AppShell、routes、DesktopWorkspace、NavigationRail、global CSS。
**规模：**L。

**T115 实施证据（2026-10-10）：**

- 标题栏仅保留可拖拽 UserHome；Control Lab 品牌只在 NavigationRail 一处，连接状态保留。单一 20px 上下文标题与一个刷新动作。
- `DesktopWorkspace` 所有 pane 增加 `min-w-0/min-h-0`；detail 为无 padding、`overflow:hidden` 的 route host，list/inspector/operation 各自滚动。
- RED：3 项结构断言失败（副品牌重复、pane 缺少收缩边界）；GREEN：定向 10 项通过，lint/typecheck、完整 34 文件/106 项测试和 build 通过。
- 保留 traffic lights clearance、drag/no-drag、skip link、快捷键、selection memory、导航焦点；路由内部页头和兼容 CSS 明确留 T117–T123，未宣称真实 200% 人工通过。

## Phase 31：用户目录配置识别闭环

## T116：建立 Dashboard→Applications 本机上下文

**状态：**2026-10-10 已完成。

**目标：**增加 local/catalog scope 及经当前 snapshot 验证的会话级候选导航。

**验收：**
- [x] Dashboard 可携带 candidateId/sourceRefreshId 进入本机识别。
- [x] stale/removed candidate 安全回退并提供下游可显示的 stale reason。
- [x] candidateId/refreshId 不写入 localStorage；现有导航不回退。

**验证：**route/selection/AppShell 定向测试；前端完整门禁。
**依赖：**T112、T115。
**文件归属：**routeDefinitions、selectionMemory、AppShell、routes。
**规模：**M。

**T116 实施证据（2026-10-10）：**

- 新增 LOCAL_RECOGNIZED/CATALOG scope、严格 decode/encode 与会话级 transient candidate context。scope 默认本机识别并可持久化；candidateId/sourceRefreshId 经白名单编码器剔除。
- local intent 以 ready 或 error.previousSnapshot 校验 refreshId/candidate；catalog intent 清除 transient context。有效候选绑定实际 snapshot refreshId，后续 refresh 即使同 ID 仍存在也标记 stale，阻止幽灵选择复活。
- RED：selection encode/decode 与 navigation helper 缺失；GREEN：17 项纯函数测试及 AppShell 定向合计 23 项通过，lint/typecheck、完整测试/build 通过。
- Applications 仅接收 scope/context/stale 的最小 props，正式 UI 留 T118；Dashboard 调用点留 T117。

## T117：实现 Dashboard 首要“用户目录配置”分组

**状态：**待执行。

**目标：**让第一主要分组回答识别了什么、在哪里、支持到什么程度和下一步。

**验收：**
- [ ] 首组显示同一 snapshot 的总数、四类计数、safe path、证据和 outcomes。
- [ ] loading/empty/disabled/partial/restricted/error 可区分且不清空旧结果。
- [ ] catalog 总量不冒充本机识别数；导航与 refreshId 一致。

**验证：**Dashboard/selector 定向测试；前端完整门禁。
**依赖：**T112、T115、T116。
**文件归属：**Dashboard、SystemSummary、共享 selector/UI、global CSS。
**规模：**L。

## T118：实现 Applications 本机识别与授权详情

**状态：**待执行。

**目标：**提供“本机识别”和“全部目录”两种明确上下文，并按四类能力展示
下一步。

**验收：**
- [ ] local/catalog 计数、筛选、选择和草稿不混用。
- [ ] 固定显示安全路径、证据、理由、敏感性和扫描状态。
- [ ] managed 项仅经 catalog/path variant 唯一匹配进入 ConfigWorkspace；
      unsupported/excluded 无内容或 mutation action。

**验证：**Applications/config/path-match 定向测试；前端完整门禁。
**依赖：**T112、T113、T116。
**文件归属：**Applications、candidate details、ConfigWorkspace、matching helper。
**规模：**L。

## Phase 32：完成五路由布局

## T119：以 Settings 完成参考布局

**状态：**2026-10-10 已完成。

**目标：**保留七组设置和危险边界，建立无重复标题的 list/detail 参考布局。

**验收：**
- [x] 七组、选择恢复、外观、隐私、备份、诊断和重置行为保留。
- [x] list/detail 具备各自滚动与收缩边界，不以组件类隐藏帮助文案；真实 200% 最后操作可达性留 T124。

**验证：**现有 settings/shell tests；前端完整门禁；人工滚动检查。
**依赖：**T114、T115。
**文件归属：**Settings page/sidebar/primitives/groups、global CSS。
**规模：**M。

**T119 实施证据（2026-10-10）：**

- 移除重复“设置”页面标题、品牌 kicker 与整页卡片语义；左侧仅保留分组 label，右侧仅保留当前设置组 h2 与摘要。
- `settings-pane__groups/tabs/detail/detail-content` 均具备 min-width/min-height 与明确滚动语义；七组、appearance 三选一、reset 危险区、help 文案保持。
- RED：结构测试中 root/list 收缩边界及单一 h2 断言失败；GREEN：Settings 定向 9 项与 scoped lint 通过，独立快照 typecheck 通过。三主题文案恢复“外观/主题”中性表述。
- 窄逻辑 viewport 的旧 CSS 隐藏规则仍由 T123 清理；真实 200% 与末尾危险操作键盘可达性留 T124。

## T120：完成 Homebrew 工作台迁移

**状态：**2026-10-10 已完成。

**目标：**完成单一工具栏、固定 list footer 和持续 detail operation 反馈。

**验收：**
- [x] 搜索、分页、selection、preview/confirm 和错误状态保留。
- [x] 长名称/版本/结果不裁切；不执行真实包操作。

**验证：**现有 Homebrew tests；前端完整门禁；人工取消确认。
**依赖：**T115。
**文件归属：**Homebrew feature TSX；shared CSS 由单一所有者修改。
**规模：**M。

**T120 实施证据（2026-10-10）：**

- 移除重复页面 hero/h2，建立单一 Homebrew toolbar、installed/search list、固定 list footer 与持续 detail；列表 loading/error/empty 不卸载已选详情。
- 新增 `BrewInventoryList` 与共享 package key/keyboard helper；长名称、描述、版本、结果与错误使用 wrap/anywhere，元数据使用 11px `text-meta`，无 truncate。
- 操作仍经现有 preview/confirm Modal；测试 mock IPC，未运行真实安装、升级或卸载。RED 后 GREEN：Homebrew 定向 13 项、scoped lint 通过；独立快照 typecheck/test 通过。真实 200% 与前台取消确认留 T124。

## T121：完成 Services 工作台迁移

**状态：**2026-10-10 已完成。

**目标：**保持 list/detail、配置有效性、授权和操作结果持续可见。

**验收：**
- [x] unknown/system 未授权服务只读，preview/confirm/history 保留。
- [x] 长内容在详情 pane 滚动；不执行真实服务操作。

**验证：**现有 Services tests；前端完整门禁；人工取消确认。
**依赖：**T115。
**文件归属：**Services feature TSX；shared CSS 由单一所有者修改。
**规模：**M。

**T121 实施证据（2026-10-10）：**

- 移除重复页面 hero 与整页卡片 shell，建立单一服务 list/detail；筛选、统计与列表头固定在列表 pane，详情及 OperationHistory 持续可见。
- 运行状态、配置有效性、scope/manageability 分开呈现；unknown/system 未授权项保持只读。长名称、元数据、结果与错误换行，不使用 truncate。
- ServiceActionDialog 保持取消为默认，busy 时禁止关闭；测试全为 mock，未执行真实服务操作。RED 后 GREEN：Services/Operations 定向 16 项通过；services 独立快照 typecheck/lint 通过。真实 200% 与原生确认仍留 T124。

## T122：完成 Applications/Configuration 三 pane 迁移

**状态：**待执行。

**目标：**统一目录/结果、文档和详情/检查器层级，并保留配置安全流程。

**验收：**
- [ ] 识别证据和安全状态持续可辨，路径/名称可换行。
- [ ] editor/inspector 独立滚动，预览/确认在 100%/200% 可达。
- [ ] 50 项分页、generation、selection、草稿、预设、redaction 不回退。

**验证：**Applications/config/editor tests；前端完整门禁；隔离 HOME 人工取消预览。
**依赖：**T118、T119。
**文件归属：**Applications、ConfigWorkspace、schema editors/presets、CSS。
**规模：**L。

## Phase 33：清理与验收

## T123：删除兼容样式并完成自动化门禁

**状态：**待执行。

**目标：**在五路由迁移后删除确认无引用的兼容 CSS，并运行完整自动化。

**验收：**
- [ ] 删除旧 workspace/appearance/button/card 私有规则，不盲删动态类。
- [ ] 现有 E2E 覆盖五路由、两窗口、root 无溢出、local scope 和只读边界。
- [ ] 全门禁通过或如实记录；无 skipped tests、降级断言或权限扩张。

**验证：**`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm check`、
`pnpm test:e2e`、`pnpm build:unsigned`、`pnpm corpus:validate`、
`git diff --check`。
**依赖：**T117、T119–T122。
**文件归属：**global CSS、相关 tests/E2E、v3 acceptance evidence。
**规模：**M。

## T124：执行人工矩阵并结算 v3

**状态：**待执行。

**目标：**用前台证据完成五路由、四外观条件、两缩放、两窗口和状态矩阵。

**验收：**
- [ ] 五路由覆盖 System→Light/System→Dark/Light/Dark、100%/真实 200%、
      1120×720/放大、正常与至少一个异常状态。
- [ ] Dashboard 额外覆盖 loading/ready/empty/partial/error/restricted。
- [ ] 记录 root/pane overflow、键盘、焦点、对比度、drag、VoiceOver、隐私。
- [ ] 不用模拟缩放或自动化替代真实 200%；阻塞保持阻塞。
- [ ] 仅在证据等价时更新 T103/T109；发布外部门禁保持独立。

**验证：**按 `SPEC-ui-correction-acceptance-v3.md` 在隔离 HOME 上记录矩阵、
缺陷和复测。
**依赖：**T123。
**文件归属：**v3 acceptance evidence、release readiness、todo、capability map。
**规模：**M。

### Checkpoint AI：UI 纠偏 v3

- [ ] T110–T124 具有实际实现与验证证据。
- [ ] 五路由和用户目录配置状态矩阵无阻断性缺陷。
- [ ] T103/T109 与签名、公证、CI、硬件门禁未被错误关闭。
