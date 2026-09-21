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

**Description:** Convert Homebrew inventory, search, package details, and
actions into a compact selection-based list/detail workspace.

**Acceptance criteria:**
- [ ] Formula/cask selection persists through search, pagination, and refresh
      when the selected package remains available.
- [ ] Search uses toolbar placement and `Escape` clearing behavior.
- [ ] Preview, progress, result, conflict, and partial-failure states remain
      visible in the relevant pane.

**Verification:**
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: verify search, list navigation, details, and confirmation flow.

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

**Description:** Present service inventory, details, actions, and operation
history through compact list/detail panes with stable service selection.

**Acceptance criteria:**
- [ ] User, system, manageable, and read-only service states remain explicit.
- [ ] Selection persists through state refresh when the service still exists.
- [ ] Destructive or state-changing actions remain separately previewed and
      confirmed.

**Verification:**
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: verify arrow navigation, state refresh, action flow, and bounded
      history scrolling.

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

- [ ] T45-T50 acceptance criteria pass.
- [ ] Every primary route fits 1120 by 720 with pane-owned scrolling.
- [ ] Settings and Refresh menu/keyboard commands work without duplicate events.
- [ ] Existing manual tray, display-scale, VoiceOver, contrast, reduced-motion,
      and icon checks remain open until actually performed.

## T51: Define the deterministic baseline inventory contract

**Description:** Introduce typed candidate identity, root kind, relative path,
entry type, evidence, format hints, sensitivity, coverage, reason, and optional
catalog ownership without exposing absolute private paths.

**Acceptance criteria:**
- [ ] Candidate IDs are deterministic and independent of the absolute home path.
- [ ] Every candidate has exactly one coverage class and human-readable reason.
- [ ] Counts, limits, permission, symlink, and timeout outcomes are explicit.

**Verification:**
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [ ] `pnpm typecheck`

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
- [ ] Unknown candidates are inspected through metadata only and never cause
      content reads.
- [ ] Root depth, entry count, metadata count, and timeout limits are enforced.
- [ ] Repeated unchanged scans return stable IDs and classifications within two
      seconds on the baseline Mac.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] Manual: compare elapsed time and bounded counts against approved roots.

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
- [ ] The exported total equals managed, unsupported, and excluded counts.
- [ ] The export contains normalized root aliases and no absolute username,
      configuration content, secrets, cache/log/database entries, or runtime
      state.
- [ ] Raw baseline artifacts remain outside version control.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [ ] `pnpm typecheck`
- [ ] Manual: inspect a sanitized export and compare counts with runtime
      coverage.

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
- [ ] Documents can declare bounded HOME, XDG, Application Support, Homebrew,
      and app-support variants without absolute user-specific paths.
- [ ] JSON/JSONC, TOML, YAML, INI/Git config, key/value, plist, command-oriented,
      and plain-text families are recognized independently of write authority.
- [ ] Unknown roots, formats, adapters, validators, editors, and policies reject
      the candidate catalog while the last known valid catalog remains usable.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [ ] `pnpm typecheck`
- [ ] Inspect catalog validation errors for every unknown capability class.

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
- [ ] `resolve_config_variants`, `read_config`, and `diagnose_config` expose
      stable typed contracts.
- [ ] Failed reads never appear as empty successful documents.
- [ ] One malformed document does not block unrelated documents or applications.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml config`
- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] Manual: inspect every diagnostic state without exposing a private path.

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
- [ ] Safe JSON/JSONC, INI/key-value, and declared non-sensitive text documents
      reuse shared handlers.
- [ ] Sensitive command-oriented, unsupported, binary, database, credential,
      cache, log, socket, and runtime formats never return raw content.
- [ ] Structured writes remain limited to an approved parser, round-trip
      strategy, validator, sensitivity policy, and editor capability.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml config`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
- [ ] Confirm no parser dependency was added without separate approval.

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
- [ ] Read-only, writable, metadata-only, excluded, and diagnostic states have
      distinct actions.
- [ ] Variant selection and large content remain inside bounded panes.
- [ ] Existing write, preview, backup, restore, validation, and redaction order
      remains unchanged.

**Verification:**
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: inspect writable, read-only, redacted, invalid, and unsupported
      documents.

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

- [ ] T51-T57 acceptance criteria pass.
- [ ] Baseline scanning remains bounded, deterministic, and metadata-only.
- [ ] Every document state and next action is explicit and safely displayed.
- [ ] Existing write, restore, backup, symlink, and elevation suites pass.
- [ ] No new dependency, scan root, writable format, or privileged target was
      introduced without separate approval.

## T58: Expand editor and terminal catalog coverage

**Description:** Add bounded data-only definitions and path variants for VS
Code channels, Cursor, Zed, Vim, Neovim, Ghostty, iTerm2, tmux, and Starship.

**Acceptance criteria:**
- [ ] Each application has detection evidence and at least one managed document
      or a precise safe exclusion.
- [ ] Product channels share identities only when configuration semantics match.
- [ ] Existing six writable and six read-only definitions remain unchanged in
      authorization and behavior.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] Manual: compare this batch with the sanitized baseline manifest.

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
- [ ] Every definition separates settings from credentials, sessions, logs,
      caches, databases, telemetry, and runtime state.
- [ ] Unsupported entries name the missing parser, redactor, path contract, or
      product knowledge required.
- [ ] No definition grants write, executable, service, privileged, or broad
      filesystem authority.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] Manual: compare this batch with sanitized baseline evidence.

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
- [ ] All candidates are classified, Priority A remains usable, and Priority B
      meets the approved managed-or-excluded rule.
- [ ] At least 90% of eligible text roots are managed read-only or writable.
- [ ] Application detail explains evidence, limitations, exclusions, and the
      concrete requirement for increased support.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml catalog`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: reconcile displayed totals with the sanitized manifest.

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

## Checkpoint Q: Catalog Coverage

- [ ] T58-T60 acceptance criteria pass.
- [ ] Every sanitized candidate maps to one coverage class and all counts agree.
- [ ] Priority A behavior remains compatible and Priority B coverage is
      evidence-based.
- [ ] No catalog-only addition requires an `appId` branch or grants new write
      authority.

## T61: Add versioned atomic preference persistence

**Description:** Store validated UserHome preferences as versioned JSON under
the app-owned application support directory with additive migration,
safe-default recovery, and atomic replacement.

**Acceptance criteria:**
- [ ] The persisted schema contains only approved appearance, lifecycle,
      refresh, editor, backup, and optional discovery-root values.
- [ ] Invalid or unknown values fall back safely and produce a non-secret
      diagnostic.
- [ ] Preference writes preserve the previous valid file on failure.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [ ] Inspect the stored JSON contract for paths, content, secrets, or authority.

**Dependencies:** None

**Parallel wave:** W1, settings lane

**Checkpoint:** R

**Risks:** A permissive patch model can persist unrecognized fields; deserialize
through explicit typed fields and reject invalid updates.

**Files likely touched:** `src-tauri/src/settings/mod.rs`,
`src-tauri/src/settings/store.rs`,
`src-tauri/src/settings/migration.rs`, `src-tauri/src/lib.rs`

**Estimated scope:** M

## T62: Expose typed settings IPC and application hydration

**Description:** Add typed get, update, and reset preference commands and load
preferences before applying route, appearance, refresh, or lifecycle behavior.

**Acceptance criteria:**
- [ ] The frontend sends typed values and never a storage path or arbitrary form.
- [ ] Startup exposes loading, ready, and safe-default diagnostic states.
- [ ] Concurrent patches serialize without silently losing recognized values.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

**Dependencies:** T61

**Parallel wave:** W2, settings lane

**Checkpoint:** R

**Risks:** UI can briefly apply incorrect defaults before hydration; gate
preference-dependent behavior while retaining a responsive shell.

**Files likely touched:** `src-tauri/src/commands/settings.rs`,
`src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`,
`src/ipc/settings.ts`, `src/App.tsx`

**Estimated scope:** M

## T63: Replace the Settings placeholder with grouped detail panes

**Description:** Build a compact Settings list/detail workspace for Appearance,
General, Refresh, Configuration and Backups, Privacy and Discovery,
Diagnostics, and Reset.

**Acceptance criteria:**
- [ ] Settings contains no placeholder, hero, or document-level scrolling.
- [ ] `Command+,` and the sidebar open Settings and restore its selected group.
- [ ] Keyboard navigation and focus remain visible and predictable.

**Verification:**
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: navigate every group at 1120 by 720 using keyboard only.

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

**Description:** Apply System, Light, or Dark appearance immediately through
semantic tokens while following operating-system reduced motion and retaining
compact density.

**Acceptance criteria:**
- [ ] Appearance changes apply without restart and persist across restart.
- [ ] System appearance follows the current OS preference.
- [ ] Status never relies on color alone and focus remains visible in all modes.

**Verification:**
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: verify System, Light, Dark, contrast, focus, and reduced motion.

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

**Description:** Apply open-on-launch, close-to-tray, restore-selection,
refresh-on-launch, refresh-on-reopen, bounded provider timeout, and preferred
editor-mode preferences without enabling background scans.

**Acceptance criteria:**
- [ ] Launch, close, reopen, and refresh behavior follows validated preferences.
- [ ] Last route and safe stable item IDs restore without selecting absent data.
- [ ] Timeout values come only from bounded presets and periodic scanning
      remains disabled.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml tray`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: restart, close/reopen, selection restore, and refresh preference
      scenarios.

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

## T66: Integrate backup retention and confirmed clearing

**Description:** Apply bounded backup-retention presets, report app-owned backup
size/location, and clear only app-owned backups through preview and explicit
confirmation.

**Acceptance criteria:**
- [ ] Retention accepts only approved presets and deletes only owned backups
      beyond the selected limit.
- [ ] Clear preview names the exact safe display location and backup count.
- [ ] Preference reset does not clear backups, and backup clearing does not
      alter managed configuration.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml config::retention`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

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
- [ ] Users can disable only predefined optional roots; no arbitrary path input
      is accepted.
- [ ] Disabling discovery evidence does not grant or revoke catalog read/write
      authority.
- [ ] Displayed paths use `~` or root aliases and reveal no absolute username.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml discovery`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: toggle optional roots and compare bounded coverage results.

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
- [ ] Diagnostics contain no configuration content, secrets, username, absolute
      home path, environment dump, or authorization material.
- [ ] Export and copy require explicit user actions and expose failures.
- [ ] Reset restores documented safe defaults while preserving backups and all
      managed application files.

**Verification:**
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml settings`
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- [ ] Manual: inspect exported diagnostics and restart after reset.

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

- [ ] T61-T68 acceptance criteria pass.
- [ ] Settings opens from the sidebar and `Command+,` and restores its group.
- [ ] Appearance, lifecycle, refresh, editor, backup, privacy, and diagnostics
      behavior persists through restart.
- [ ] Reset, backup deletion, and managed-configuration mutation remain separate.
- [ ] Launch at login remains unavailable unless separately approved.

## T69: Complete desktop completeness verification and documentation

**Description:** Run the approved project gates, trace all five revision specs
to evidence, record manual/external gates accurately, and update user-facing
documentation without publishing.

**Acceptance criteria:**
- [ ] Every T45-T68 criterion maps to implementation evidence or an explicit
      approved blocker.
- [ ] Native shell, baseline inventory, configuration platform, catalog
      coverage, and Settings behavior match the approved specifications.
- [ ] Existing T01-T44 manual/signing/external blockers remain intact and no
      automated check reads or mutates real user configuration.

**Verification:**
- [ ] `pnpm check`
- [ ] `pnpm test:e2e`
- [ ] `pnpm build:unsigned`
- [ ] Manual: complete fixed-window, keyboard, VoiceOver, contrast,
      reduced-motion, tray, icon, settings persistence, and baseline coverage
      review where local permissions and credentials allow.

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

## Checkpoint S: Desktop Completeness Complete

- [ ] T45-T69 acceptance criteria pass or retain an explicit approved blocker.
- [ ] `pnpm check`, `pnpm test:e2e`, and `pnpm build:unsigned` pass.
- [ ] All five approved revision specifications are traced to evidence.
- [ ] Existing manual, signing, notarization, GitHub-hosted CI, and local
      Computer Use blockers remain accurately documented.
- [ ] No automated verification reads or mutates real user configuration.
