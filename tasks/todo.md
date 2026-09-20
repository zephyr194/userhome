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
- [ ] Existing routes still render before the visual migration begins.
- [ ] No stale house-only generated asset remains.

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
failures as explicit partial issues.

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
documents.

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
- [ ] New data-only definitions render without central UI code changes.
- [ ] Writable, read-only, unsupported, and excluded states are explicit.
- [ ] Unsupported candidates expose metadata only.

**Verification:**
- [ ] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: verify each coverage class and keyboard navigation.

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
- [ ] Write controls appear only for explicitly writable documents.
- [ ] Redaction, validation, diff, backup, restore, and confirmation remain
      visible and ordered.
- [ ] Large configuration content scrolls within its pane without clipping.

**Verification:**
- [ ] `pnpm lint && pnpm test && pnpm build`
- [ ] Manual: read-only, writable, secret-redacted, and restore flows.

**Dependencies:** T34, T40, T42

**Files likely touched:** `src/features/apps/ConfigDetails.tsx`,
`src/features/apps/ConfigWritePreview.tsx`,
`src/features/apps/BackupHistory.tsx`,
`src/features/apps/editors/RawConfigEditor.tsx`,
`src/components/ui/Modal.tsx`

**Estimated scope:** M

## Checkpoint M: Configuration Coverage

- [ ] T38-T43 acceptance criteria pass.
- [ ] Every safely detected candidate has one coverage class.
- [ ] No discovery result alone authorizes content access or writes.

## T44: Complete desktop optimization integration and documentation

**Description:** Run the existing project gates, verify the bundled desktop
experience, and update user and release documentation to match the approved
specification.

**Acceptance criteria:**
- [ ] Existing frontend, Rust, build, and E2E checks pass.
- [ ] Fixed-window, tray, app icon, keyboard, VoiceOver, contrast, and
      configuration-coverage acceptance is recorded.
- [ ] Documentation states unsupported and excluded configuration boundaries.

**Verification:**
- [ ] `pnpm check`
- [ ] `pnpm test:e2e`
- [ ] `pnpm build:unsigned`
- [ ] Manual desktop acceptance at the supported display scales.

**Dependencies:** T35, T36, T37, T43

**Files likely touched:** `README.md`, `docs/release-readiness.md`,
`docs/managed-app-schema.md`, `docs/release.md`, `tasks/todo.md`

**Estimated scope:** M

## Checkpoint N: Optimization Complete

- [ ] T30-T44 acceptance criteria pass.
- [ ] Existing T25-T29 external signing and manual blockers remain accurately
      documented rather than treated as completed.
- [ ] No automated verification reads or mutates real user configuration.
