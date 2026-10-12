# Implementation Plan: UserHome

Status: Approved for incremental execution on 2026-09-20

## Overview

Implement the approved UserHome specifications as a macOS 13+ Tauri 2
application. Delivery proceeds from a secure runnable shell to read-only
discovery, safe configuration management, Homebrew mutations, service control,
controlled elevation, and signed distribution. Each feature slice includes its
Rust boundary, typed frontend contract, user-visible behavior, and focused
verification.

Specifications:

- [`../SPEC.md`](../docs/specs/SPEC.md)
- [`../CAPABILITY-MAP.md`](../CAPABILITY-MAP.md)
- [`../SPEC-platform-foundation.md`](../docs/specs/SPEC-platform-foundation.md)
- [`../SPEC-app-catalog.md`](../docs/specs/SPEC-app-catalog.md)
- [`../SPEC-system-discovery.md`](../docs/specs/SPEC-system-discovery.md)
- [`../SPEC-config-management.md`](../docs/specs/SPEC-config-management.md)
- [`../SPEC-brew-management.md`](../docs/specs/SPEC-brew-management.md)
- [`../SPEC-service-management.md`](../docs/specs/SPEC-service-management.md)
- [`../SPEC-desktop-experience.md`](../docs/specs/SPEC-desktop-experience.md)

Tasks are tracked in [`todo.md`](todo.md).

## Planning Decisions

- Use the official Tauri 2 React/TypeScript scaffold and pin exact stable
  versions in `pnpm-lock.yaml`, `Cargo.lock`, and `packageManager`.
- Use custom Rust commands for filesystem and process access. Do not expose
  frontend shell execution or broad filesystem permissions.
- Keep the application catalog in Rust as the authorization source of truth.
- Use Vitest with official `@tauri-apps/api/mocks` for frontend IPC tests.
- Use WebdriverIO with `@wdio/tauri-service` in embedded-driver mode for macOS
  desktop E2E. Do not rely on standalone `tauri-driver`, whose native macOS
  support remains limited.
- Use temporary home/Homebrew fixtures for automated tests. Automated checks
  must never mutate the real user configuration.
- Implement ordinary Homebrew and user-level service actions before controlled
  elevation.
- Model elevation as a versioned allowlisted protocol, test it through a fake
  transport first, then add the signed `SMAppService` helper.
- Build unsigned private CI artifacts on pull requests. Publish only signed and
  notarized tagged releases.

Official testing references:

- https://v2.tauri.app/develop/tests/mocking/
- https://v2.tauri.app/develop/tests/webdriver/
- https://v2.tauri.app/develop/tests/webdriver/manual-setup/

## Dependency Graph

```text
T01 scaffold
  -> T02 secure IPC
      -> T03 operations
      -> T04 desktop shell
      -> T06 catalog
      -> T24 elevation protocol
  -> T05 verification baseline

T06 catalog
  -> T07 local discovery
      -> T08 Homebrew inventory
      -> T09 refresh + candidates
      -> T10 config read

T10 config read
  -> T11 safe write
      -> T12 restore
      -> T13 Copilot adapter
      -> T14 Caddy adapter
      -> T15 Git adapter
      -> T16 SSH adapter
      -> T17 Zsh adapter
      -> T18 npm adapter

T08 Homebrew inventory
  -> T19 search/details
      -> T20 install
          -> T21 upgrade/uninstall

T14 Caddy adapter + T08 Homebrew inventory
  -> T22 service inventory
      -> T23 user-level actions

T24 elevation protocol
  -> T25 signed helper registration
      -> T26 elevated actions

T12 + T13-T23 + T26
  -> T27 desktop resilience/accessibility
      -> T28 release pipeline
          -> T29 release-readiness verification
```

## Task List

### Phase 1: Secure Runnable Foundation

- [x] T01 Scaffold the pinned Tauri workspace
- [x] T02 Establish secure IPC and capability boundaries

### Checkpoint A: Security Contract

- [x] Frontend has no shell execution or broad home-directory permission
- [x] Shared success/error IPC contract is exercised end to end
- [x] Rust and TypeScript checks pass

- [x] T03 Add operation preview and lifecycle coordination
- [ ] T04 Deliver the desktop window and tray shell — implementation complete;
      manual tray interaction remains blocked by local Computer Use permission
- [ ] T05 Establish automated verification and CI baseline — implementation and
      local verification complete; first GitHub-hosted PR run pending

### Checkpoint B: Runnable Shell

- [ ] Application launches, hides, reopens, refreshes, and quits correctly
- [x] Vitest IPC mocks and macOS WebdriverIO smoke test run
- [ ] Pull-request CI completes an unsigned build smoke test

### Phase 2: Catalog and Read-Only Discovery

- [ ] T06 Deliver the six-application catalog and Applications list —
      implementation and automated verification complete; manual visual
      inspection pending
- [x] T07 Deliver local macOS capability discovery and Dashboard summary
- [x] T08 Deliver read-only Homebrew inventory
- [x] T09 Deliver coalesced refresh and unmanaged dot-directory candidates

### Checkpoint C: Read-Only MVP

- [x] All six baseline integrations are identified by explicit evidence
- [x] Homebrew inventory loads without blocking the UI
- [x] Missing Homebrew and partial scan failures remain usable

### Phase 3: Safe Configuration Core

- [x] T10 Deliver authorized configuration reading
- [x] T11 Deliver validated preview, backup, and atomic write
- [x] T12 Deliver backup restore and operation history

### Checkpoint D: Safe Editing Core

- [x] Fixture configuration can be read, diffed, written, and restored
- [x] Invalid or concurrently changed files are never overwritten
- [x] Secrets and configuration contents are absent from logs and errors

### Phase 4: Initial Application Adapters

- [x] T13 Deliver the GitHub Copilot configuration adapter
- [x] T14 Deliver the Caddy configuration adapter
- [x] T15 Deliver the Git configuration adapter

### Checkpoint E: First Adapter Set

- [x] Copilot JSON/instruction files respect the exclusion list
- [x] Invalid Caddy configuration is rejected before write
- [x] Git structured edits preserve unrelated settings

- [x] T16 Deliver the OpenSSH configuration adapter
- [x] T17 Deliver the Zsh managed-block adapter
- [x] T18 Deliver the npm configuration adapter

### Checkpoint F: Adapter Complete

- [x] All six application adapters pass fixture-based verification
- [x] Private keys, runtime tokens, and npm auth values remain protected
- [x] Structured edits preserve unmanaged content

### Phase 5: Homebrew Lifecycle Management

- [x] T19 Deliver Homebrew search and package details
- [x] T20 Deliver confirmed Homebrew installation
- [x] T21 Deliver confirmed Homebrew upgrade and uninstall

### Checkpoint G: Homebrew Management

- [x] Every mutation follows preview-confirm-progress-result
- [x] No Homebrew mutation uses root or a shell
- [x] Concurrent mutations and partial failures are explicit

### Phase 6: Services and Controlled Elevation

- [x] T22 Deliver service inventory and Caddy service details
- [x] T23 Deliver user-level service actions

### Checkpoint H: User-Level Services

- [x] Caddy start, stop, and restart are independently confirmed
- [x] Service state is refreshed after each operation
- [x] Unknown services remain read-only

- [x] T24 Define and test the privileged-helper protocol
- [ ] T25 Register the signed macOS helper with `SMAppService` — implementation
      and unsigned fail-closed checks pass; signed/manual verification is blocked
      because no code-signing identity is installed.
- [ ] T26 Integrate elevated configuration and service operations — automated
      fake-transport coverage passes; the disposable signed-helper fixture check
      remains blocked by the same signing prerequisite.

### Checkpoint I: Elevation Boundary

- [x] Fake and real transports enforce the same request allowlist
- [x] Missing signing, registration, or authorization fails closed
- [x] Arbitrary commands, paths, arguments, and environments are rejected

### Phase 7: Product Completion and Distribution

- [ ] T27 Complete desktop resilience, accessibility, and tray summaries —
      implementation and automated checks pass; interactive VoiceOver,
      keyboard, contrast, reduced-motion, and tray review remain pending.
- [ ] T28 Add signed universal GitHub release workflow — workflow, fail-closed
      secret gate, unsigned build, universal app/DMG, and helper bundling pass
      locally; protected signed/notarized run remains blocked by credentials.
- [ ] T29 Run release-readiness verification and finalize documentation —
      evidence trace and reviews are complete; external/manual gates remain.

### Checkpoint J: Complete

- [x] All approved specification success criteria are traced to tasks and
      evidence in `docs/release-readiness.md`
- [x] Full frontend, Rust, E2E, security, and unsigned universal-build checks pass
- [ ] Signed/notarized release path is verified when credentials are available
- [x] Change completed code-quality, security, and ship readiness reviews; ship
      verdict is NO-GO until external gates pass

## Parallelization Opportunities

After T11 establishes the configuration contract:

- T13, T14, and T15 can run in parallel.
- T16, T17, and T18 can run in parallel.

After T08 establishes Homebrew inventory contracts:

- T19-T21 can progress independently of T13, T15-T18.
- T24-T25 can progress independently of application adapters.

Coordination rules:

- Only one task may modify shared catalog contracts at a time.
- Tauri capability changes require review against T02.
- Operation protocol changes require review against T03.
- Configuration write-path changes require review against T11.

## Verification Checkpoints

Every task runs its focused checks. Every checkpoint runs:

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Checkpoints B, C, D, G, I, and J additionally run:

```bash
pnpm test:e2e
```

Checkpoint B additionally runs:

```bash
pnpm build:unsigned
```

Checkpoint J additionally runs:

```bash
pnpm tauri build --target universal-apple-darwin
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| macOS privileged helper integration is signing-sensitive | High | Define and test protocol first; isolate helper registration; fail closed without credentials |
| Configuration parsers may rewrite comments or ordering | High | Prefer managed blocks or parser-preserving adapters; byte-compare unmanaged sections |
| Symlink replacement can damage dotfile workflows | High | Resolve and authorize targets, write through safe target handling, verify symlink preservation |
| Homebrew output or behavior changes across versions | High | Prefer JSON output, validate shapes, isolate parser fixtures, expose partial failure |
| Desktop E2E on macOS depends on embedded WebDriver support | Medium | Establish the harness in T05 before feature work; retain manual signed-app smoke checklist |
| Copilot configuration schemas may evolve | Medium | Manage only verified keys; retain raw validated mode; exclude runtime databases/tokens |
| CI signing secrets may be unavailable during development | Medium | Separate unsigned PR builds from protected release workflow; never publish unsigned artifacts |
| Frontend and Rust IPC types may drift | Medium | Centralize invoke wrappers and add serialization contract tests |
| Scope expands to arbitrary applications | Medium | Require catalog definitions and explicit approval for every writable path and executable |

## External Prerequisites

Needed only before T25/T28 production verification:

- Apple Developer Team membership.
- Developer ID Application certificate.
- Notarization credentials or App Store Connect API key.
- Final bundle identifier.
- GitHub encrypted secrets for signing and notarization.

Implementation must continue in read-only/non-elevated mode when these are
unavailable; no task may simulate a successful production signature.

## Open Questions

Resolve before the named task:

- Before T25: confirm final bundle identifier, proposed
  `com.zephyr194.userhome`.
- Before T28: confirm the target GitHub repository and whether tagged workflows
  may create draft releases automatically.
- Before T29: final application and tray icon assets are provided in
  `src-tauri/icons/`; product approval is recorded with the implementation.

## Desktop Experience Optimization Extension

Status: Approved for autonomous execution on 2026-09-20

This extension preserves T01-T29 and implements the approved desktop-experience,
window, icon, and configuration-coverage revisions. Existing external signing
and manual-review blockers remain separate from this work.

### Extension Decisions

- Keep the six current integrations fully compatible while treating them as a
  baseline rather than a catalog ceiling.
- Classify all safely detected configuration candidates; do not promise write
  support for arbitrary files.
- Use Tailwind CSS 4 and Headless UI 2 through semantic shared primitives.
- Use a fixed 1120 by 720 logical-pixel window with platform-aware frameless
  chrome and bounded internal scrolling.
- Maintain one editable application SVG and one dedicated monochrome tray SVG;
  generated assets remain checked in because Tauri packaging consumes them.
- Do not add new test cases unless separately requested. Verification uses the
  repository's existing checks and manual desktop acceptance.

### Extension Dependency Graph

```text
T30 frontend foundation
  -> T33 desktop shell
  -> T34 shared interaction states
  -> T35 dashboard
  -> T36 Homebrew UI
  -> T37 services and operations UI

T31 window contract + T32 icon system
  -> T33 desktop shell

T38 catalog coverage contract
  -> T39 safe discovery classification
  -> T41 bounded catalog expansion

T38 + T39
  -> T40 generic read-only configuration support

T33 + T40 + T41
  -> T42 registry-driven Applications workspace
  -> T43 configuration details and actions

T35-T37 + T43
  -> T44 integration and documentation
```

### Phase 8: Desktop Foundation

- [x] T30 Reconcile and pin the frontend design foundation
- [ ] T31 Enforce the fixed frameless window contract — implementation and
      automated verification complete; manual drag and display-scaling review
      pending
- [ ] T32 Replace the application and tray icon system — implementation and
      bundle verification complete; manual light/dark appearance review pending

### Checkpoint K: Desktop Foundation

- [ ] Exact dependency versions, production frontend build, fixed window, and
      generated icon assets are verified; automated checks pass, while physical
      display scaling and tray-theme appearance remain pending.

### Phase 9: Native Desktop Interface

- [x] T33 Rebuild the desktop application shell
- [x] T34 Migrate shared dialogs and asynchronous states
- [x] T35 Migrate the Dashboard and status rail
- [x] T36 Migrate Homebrew inventory and actions
- [x] T37 Migrate services and operation history

### Checkpoint L: Desktop Interface

- [ ] Every primary route fits the fixed window, remains keyboard accessible,
      and no longer depends on generic web-dashboard presentation.

### Phase 10: Configuration Coverage

- [x] T38 Extend the catalog coverage contract
- [x] T39 Implement safe configuration-candidate classification
- [x] T40 Add generic managed read-only configuration support
- [x] T41 Expand data-only catalog definitions in bounded batches
- [x] T42 Build the registry-driven Applications workspace
- [x] T43 Migrate configuration details and confirmed actions

### Checkpoint M: Configuration Coverage

- [x] Every safely detected candidate is classified and only explicitly
      authorized definitions expose content or write actions.

### Phase 11: Integration

- [ ] T44 Complete desktop optimization integration and documentation —
      automated integration and documentation are complete; manual desktop and
      external release gates remain pending.

### Checkpoint N: Optimization Complete

- [x] Existing frontend, Rust, build, and E2E checks pass.
- [ ] Manual fixed-window, keyboard, VoiceOver, contrast, tray, and icon review
      is complete.
- [x] No automated verification reads or mutates real user configuration.

### Extension Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Fixed window clips dense configuration screens | High | Define internal scroll ownership before page migration and verify every route at 1120 by 720 |
| Broad configuration discovery exposes private data | High | Metadata-only bounded detection, explicit exclusions, and catalog authorization before reads |
| Frameless drag regions intercept controls | High | Mark drag zones explicitly and manually verify every title-bar control |
| App definitions require bespoke adapters | Medium | Land data-only and read-only definitions first; require separate approval for new writable adapters |
| Generated icon assets drift from source SVG | Medium | Regenerate through the Tauri icon command and verify bundle resources |

## Desktop Completeness Extension

Status: Approved for autonomous execution on 2026-09-21

This extension preserves T01-T44 and all of their existing completion state,
manual checks, signing prerequisites, external blockers, and recorded evidence.
It schedules the approved native shell, baseline inventory, configuration
platform, catalog expansion, and application settings specifications without
authorizing new dependencies, new scan roots, background polling, launch at
login, or new test files.

Specifications:

- [`../SPEC-native-desktop-shell.md`](../docs/specs/SPEC-native-desktop-shell.md)
- [`../SPEC-home-baseline-inventory.md`](../docs/specs/SPEC-home-baseline-inventory.md)
- [`../SPEC-configuration-platform.md`](../docs/specs/SPEC-configuration-platform.md)
- [`../SPEC-catalog-expansion.md`](../docs/specs/SPEC-catalog-expansion.md)
- [`../SPEC-application-settings.md`](../docs/specs/SPEC-application-settings.md)

### Extension Decisions

- Retain the fixed 1120 by 720 Tauri window and native traffic lights while
  replacing route-level web composition with one sidebar, toolbar, and bounded
  list/detail workspace.
- Keep provider and mutation logic outside shared React layout primitives.
- Treat discovery as metadata-only evidence. Catalog definitions remain the
  sole authority for configuration reads, writes, restores, and elevation.
- Introduce typed root aliases, path variants, format capabilities, document
  states, and diagnostics before adding further catalog definitions.
- Expand the catalog in bounded data-only batches; unsupported or excluded
  candidates remain explicit instead of receiving speculative access.
- Persist only versioned UserHome preferences under the app-owned application
  support directory, using atomic writes and safe-default migration.
- Use the current dependency set. A parser, launch-at-login plugin, background
  watcher, notification integration, or other new dependency remains an
  ask-first boundary and must not be silently introduced during execution.
- Do not add test files. Verification uses existing suites, existing fixtures,
  focused commands, and the documented manual desktop checks.

### Extension Dependency Graph

```text
T45 desktop workspace
  -> T46 native menus and shortcuts
  -> T47 dashboard workspace
  -> T48 applications workspace
  -> T49 Homebrew workspace
  -> T50 services workspace

T51 baseline inventory contract
  -> T52 bounded approved-root scanning
      -> T53 sanitized baseline export

T51 + T38
  -> T54 catalog path and format contract
      -> T55 document resolution and diagnostics
          -> T56 reusable read-only format handling
              -> T57 configuration workspace dispatch
              -> T58 catalog expansion: editors and terminals
              -> T59 catalog expansion: AI and developer tools
                  -> T60 coverage metrics and explanations

T61 preference persistence
  -> T62 settings IPC and hydration
      -> T63 settings workspace
      -> T64 appearance behavior
      -> T65 lifecycle, refresh, and selection preferences
      -> T66 backup retention and clearing
      -> T67 privacy and discovery controls
      -> T68 diagnostics export and reset

T46-T50 + T53 + T57 + T60 + T63-T68
  -> T69 desktop completeness integration
```

### Phase 12: Native Workspace Foundation

- [ ] T45 Establish the native desktop workspace primitives
- [ ] T46 Add native application menu commands and keyboard routing
- [ ] T47 Recompose Dashboard as a compact summary workspace
- [ ] T48 Complete persistent Applications list/detail interaction
- [ ] T49 Complete persistent Homebrew list/detail interaction
- [ ] T50 Complete persistent Services list/detail interaction

### Checkpoint O: Native Workspace

- [ ] Every primary route uses the fixed sidebar/toolbar/workspace hierarchy.
- [ ] `Command+,`, `Command+R`, arrow navigation, focus rings, and pane-local
      loading/error behavior are verified.
- [ ] The document body does not scroll at 1120 by 720.

### Phase 13: Baseline Inventory and Configuration Platform

- [ ] T51 Define the deterministic baseline inventory contract
- [ ] T52 Implement bounded approved-root metadata scanning
- [ ] T53 Export and document the sanitized baseline manifest
- [ ] T54 Extend catalog path variants and format capabilities
- [ ] T55 Return typed configuration resolution and diagnostics
- [ ] T56 Add reusable fail-closed read-only format handling
- [ ] T57 Drive configuration viewers and editors by capability

### Checkpoint P: Safe Configuration Platform

- [ ] Approved roots are bounded, deterministic, metadata-only, and complete
      within the documented limits.
- [ ] Every document returns one explicit state and one safe next action.
- [ ] Unknown roots, formats, adapters, validators, and policies fail closed.
- [ ] Existing write, backup, restore, symlink, and elevation safeguards pass
      without broadening authority.

### Phase 14: Catalog Completeness

- [ ] T58 Expand editor and terminal catalog coverage
- [ ] T59 Expand AI and developer-tool catalog coverage
- [ ] T60 Enforce coverage metrics and render support explanations

### Checkpoint Q: Catalog Coverage

- [ ] Every sanitized baseline candidate has exactly one coverage class.
- [ ] Priority A behavior is unchanged and Priority B has managed coverage or a
      precise exclusion reason.
- [ ] At least 90% of eligible text roots are managed read-only or writable.
- [ ] No data-only application introduces an `appId` branch in React.

### Phase 15: Application Settings

- [ ] T61 Add versioned atomic preference persistence
- [ ] T62 Expose typed settings IPC and application hydration
- [ ] T63 Replace the Settings placeholder with grouped detail panes
- [ ] T64 Apply and persist semantic appearance
- [ ] T65 Apply lifecycle, refresh, and selection preferences
- [ ] T66 Integrate backup retention and confirmed clearing
- [ ] T67 Apply privacy and optional discovery-root preferences
- [ ] T68 Export sanitized diagnostics and reset preferences

### Checkpoint R: Settings Complete

- [ ] Settings opens from the sidebar and `Command+,`, restores its selected
      group, and remains usable at 1120 by 720.
- [ ] Appearance, lifecycle, refresh, editor, backup, privacy, and diagnostics
      preferences persist with safe validation and migration.
- [ ] Reset, backup clearing, and managed-configuration mutation remain separate.
- [ ] Diagnostics contain no configuration content, secrets, username, absolute
      home path, environment dump, or authorization material.

### Phase 16: Integration

- [ ] T69 Complete desktop completeness verification and documentation

### Checkpoint S: Desktop Completeness Complete

- [ ] T45-T69 acceptance criteria pass or retain an explicit approved external
      or manual blocker.
- [ ] Existing T04, T05, T25-T29, T31, T32, and T34-T44 manual/external
      blockers remain documented and are not converted to completed results.
- [ ] `pnpm check`, `pnpm test:e2e`, and `pnpm build:unsigned` pass.
- [ ] No automated check reads or mutates real user configuration.

### Parallel Waves

| Wave | Parallel lanes | Coordination boundary |
|---|---|---|
| W1 | T45 shell, T51 inventory model, T54 catalog contract, T61 preferences | These foundations own separate modules and may start together. |
| W2 | T46 menu bridge, T52 scanner, T55 diagnostics, T62 settings IPC | Each lane follows its W1 dependency; shared `lib.rs` edits require serialization. |
| W3 | T47 dashboard, T53 export, T56 format handling, T63 settings workspace | Dashboard and Settings route edits must be serialized around shared route files. |
| W4 | T48 Applications, T58 catalog batch, T64 appearance, T67 privacy | Catalog JSON changes are serialized; UI lanes may proceed against stable contracts. |
| W5 | T49 Homebrew, T57 config UI, T59 catalog batch, T65 lifecycle | Shell route changes are serialized; T59 follows T58 in the catalog lane. |
| W6 | T50 Services, T60 coverage, T66 backups, T68 diagnostics | Provider work remains independent; shared Settings files require coordination. |
| W7 | T69 integration | Runs only after every preceding dependency is complete or explicitly blocked. |

Within a wave, tasks sharing `src/app/routes.tsx`, `src/app/AppShell.tsx`,
`src/styles/global.css`, `src-tauri/src/lib.rs`, or
`src-tauri/src/catalog/catalog-v1.json` execute sequentially or after an
explicit ownership handoff.

### Verification Checkpoints

Every task runs its focused verification from `todo.md`. Checkpoints O-R run:

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Checkpoints O, Q, R, and S additionally run:

```bash
pnpm test:e2e
```

Checkpoint S additionally runs:

```bash
pnpm build:unsigned
```

### Extension Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Shared shell files create parallel merge conflicts | Medium | Serialize tasks that own route, shell, or global-style files within each wave. |
| Fixed-window panes clip dense content | High | Assign explicit scroll ownership and verify each route at 1120 by 720 before integration. |
| Broader baseline discovery exposes private metadata | High | Probe exact catalog paths first, enumerate only approved direct children, cap depth/count/time, and sanitize exports. |
| Format support is mistaken for write authority | High | Separate format recognition, redaction, validation, editor capability, and write policy; fail closed on missing capability. |
| New catalog entries regress existing integrations | High | Keep Priority A identifiers and authorization stable and validate the last-known-good catalog on load failure. |
| Preferences weaken filesystem or mutation boundaries | High | Store only typed UserHome behavior values; never persist paths, content, credentials, or authority. |
| Diagnostic export leaks private data | High | Build from typed sanitized summaries and reject raw environment, paths, content, and authorization fields. |
| Parser or launch-at-login work pressures dependency scope | Medium | Keep unsupported capability explicit and request separate approval before adding any dependency. |

# Configuration Discovery and Editing Revision

## Approved Decisions

- Catalog search, filtering, and pagination run in Rust.
- Application pages contain exactly 50 entries.
- The packaged catalog supports at least 500 and at most 1,000 applications.
- Schemas and presets remain independently versioned packaged data.
- Each configuration document supports at most 64 fields and 32 presets.
- Initial schema-driven migrations are Git, Caddy, GitHub Copilot CLI, npm,
  OpenSSH, and Zsh.
- Complete templates are write-enabled only for missing/new files in the first
  release; existing files may preview them but cannot execute replacement.
- Schema/preset aliases remain for at least two versions and 180 days.
- The official-source corpus is reviewed monthly, becomes stale after 90 days,
  and is approved by repository maintainers.
- Corpus data stores normalized facts by default. Upstream schema files may be
  bundled only when redistribution is explicitly permitted and SPDX/NOTICE
  metadata is recorded.
- Geometry is defined by semantic CSS custom properties and shared React
  primitives; TypeScript does not duplicate CSS pixel constants.
- No new test files or test cases are planned. Existing checks and bounded
  manual acceptance are reused.

## Dependency Graph

```text
T70 visual primitives
  -> T92-T96 visual and window integration

T71 schema contract
  -> T72 preset contract
  -> T85 schema/preset runtime presentation
  -> T86 generic schema editor
  -> T87 preset workflow
  -> T88-T90 six-app migration
  -> T91 schema-driven cutover

T73 source provenance
  -> T76 corpus tooling
  -> T77-T79 corpus inputs
  -> T80 packaged 500+ corpus

T74 Rust catalog paging
  -> T75 frontend catalog contracts
  -> T81 catalog provider integration
  -> T82-T84 browsing experience

T80 + T84 + T91 + T92-T96
  -> T97 integrated acceptance
```

### Phase 17: Shared Contracts

- [x] T70 Consolidate semantic visual tokens and desktop primitives
- [x] T71 Add the versioned configuration schema contract
- [x] T72 Add the versioned preset contract and compatibility policy
- [x] T73 Add official-source provenance and license contracts
- [x] T74 Replace whole-catalog IPC with bounded Rust paging
- [x] T75 Add strict frontend catalog, source, schema, and preset decoders

### Checkpoint T: Contracts Stable

- [x] Rust and TypeScript use the same version, count, enum, and identifier
      bounds.
- [x] Existing catalog/config behavior remains available for the original 26
      managed apps.
- [x] No new runtime network, dependency, writable path, or test case is added.

### Phase 18: Curated Offline Corpus

- [x] T76 Build maintainer-only corpus refresh and validation tooling
- [x] T77 Import a pinned Homebrew formula application set
- [x] T78 Import a pinned Homebrew cask application set
- [x] T79 Curate official configuration overlays for existing managed tools
- [x] T80 Package and validate the 500+ application corpus

### Checkpoint U: Offline Corpus Ready

- [x] At least 500 and at most 1,000 applications validate deterministically.
- [x] Every packaged entry has official provenance and an explicit support
      class.
- [x] The client remains fully functional with network access disabled.
- [x] The refresh workflow is monthly, maintainer-approved, and flags records
      older than 90 days.

### Phase 19: Paged Application Browsing

- [x] T81 Integrate the paged catalog provider into shell state
- [x] T82 Implement search, filters, and exact 50-item pagination
- [x] T83 Present source provenance and support boundaries in application detail
- [x] T84 Preserve selection, focus, page, and editor context

### Checkpoint V: Application Browsing Complete

- [x] At least 500 applications are searchable through Rust-side 50-item pages.
- [x] Query p95 is below 100 ms on the baseline Apple Silicon Mac.
- [x] Keyboard, selection, page, scroll, and config-document state remain
      stable.
- [x] Unsupported and excluded applications expose no write controls.

### Phase 20: Schema-Driven Configuration Editing

- [x] T85 Expose schema and preset presentation through typed IPC
- [x] T86 Build the generic schema field renderer
- [x] T87 Add safe preset selection and draft application
- [x] T88 Migrate Git and npm to schema-driven editing
- [x] T89 Migrate Caddy and OpenSSH to schema-driven editing
- [x] T90 Migrate Copilot and Zsh to schema-driven editing
- [x] T91 Make schema-driven editing the default for the initial six apps

### Checkpoint W: Schema Editing Complete

- [x] The initial six apps use schema-driven fields and presets by default.
- [x] Invalid schemas, unknown field kinds, and expired aliases fail closed.
- [x] Secret values are absent from reads, diffs, IPC, errors, logs, and
      history.
- [x] Every executed write still uses fresh hash, preview, explicit
      confirmation, backup, atomic replacement, post-write validation, and
      rollback.

### Phase 21: Visual Consistency and Native Window Interaction

- [x] T92 Normalize Applications and configuration workspace density
- [x] T93 Normalize shell, navigation, toolbar, and Dashboard
- [x] T94 Normalize Homebrew and Services workspaces
- [x] T95 Normalize Settings workspace and form controls
- [x] T96 Enforce reliable title-bar drag and double-click no-op behavior

### Phase 22: Integration and Evidence

- [x] T97 Complete integrated automated verification and documentation;
      retained manual/external blockers are tracked in `tasks/todo.md` and
      `docs/release-readiness.md`.

### Checkpoint X: Revision Complete

- [x] T70-T97 acceptance criteria pass or retain explicit approved blockers.
- [x] The catalog contains 500-1,000 offline applications and returns exact
      50-entry Rust-side pages.
- [x] The six writable apps use schema-driven editing with safe presets.
- [ ] Every primary route is usable at 1120 x 720 and 200% text zoom.
- [ ] Window dragging and interactive no-drag behavior match the approved
      matrix.
- [x] Runtime browsing/editing uses no network and exposes no arbitrary path,
      command, source-fetch, or privilege authority.

### Parallel Waves

| Wave | Parallel work | Coordination boundary |
|---|---|---|
| W8 | T70 visual tokens, T71 schema, T73 provenance, T74 paging | Serialize edits to `catalog/mod.rs`; visual work is independent. |
| W9 | T72 presets, T75 frontend contracts, T76 tooling | T72 follows T71; frontend contracts follow Rust shapes. |
| W10 | T77 formulae, T78 casks, T79 managed overlays | Independent corpus input files; do not edit packaged output. |
| W11 | T80 packaging | Single owner for generated catalog/source/schema/preset outputs. |
| W12 | T81 provider, T85 schema IPC, T93 shell visual pass | Shared `App.tsx`/shell files require explicit ownership. |
| W13 | T82 paging UI, T83 provenance detail, T86 schema renderer, T94 routes | Shared Applications/global CSS edits are serialized. |
| W14 | T84 state retention, T87 presets, T95 Settings | Separate state/editor/settings lanes. |
| W15 | T88 Git/npm, T89 Caddy/SSH, T90 Copilot/Zsh | Independent source fragments; generated packaged files have one merge owner. |
| W16 | T91 cutover, T92 Apps visual pass, T96 dragging | Serialize `ConfigWorkspace`, `AppShell`, and global CSS ownership. |
| W17 | T97 integration | Runs after all implementation dependencies settle. |

### Verification Commands

Focused tasks use the smallest applicable existing command. Major checkpoints
run:

```bash
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Checkpoints V, W, and X additionally run:

```bash
pnpm test:e2e
```

Checkpoint X additionally runs:

```bash
pnpm build:unsigned
```

No new test files or test cases are added. Existing suites must continue to
pass; new behavior is verified with contract validators, builds, existing E2E,
and explicit manual matrices.

### Revision Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A 500-entry corpus becomes unverifiable or stale | High | Official-only manifest, immutable revision/digest, monthly maintainer review, 90-day stale state, deterministic generation. |
| Catalog paging breaks refresh/selection behavior | High | Stable IDs, request generations, page-aware selection memory, explicit removed-item fallback. |
| Source evidence is mistaken for write authority | Critical | Keep provenance, catalog authorization, adapter, validator, editor, and write policy as separate required gates. |
| Generic fields cannot preserve specialized adapter semantics | High | Migrate app pairs, compare disposable previews, retain compatibility editors until parity. |
| Presets overwrite existing user configuration | Critical | Draft-only selection; complete templates execute only for missing/new files; existing safe mutation chain remains mandatory. |
| Secret values leak through generic schemas | Critical | Replacement-only secret kind, no corpus default, no read payload, redacted preview/history, fail closed. |
| Visual consolidation causes regressions across shared CSS | Medium | Land tokens first, serialize global CSS ownership, verify each route at fixed window and 200% zoom. |
| Double-click behavior differs across WebKit/macOS | Medium | Runtime inspection first; add only a narrow native/Tauri guard if CSS cannot enforce no-op. |
| Generated output causes parallel merge conflicts | Medium | Parallelize source fragments only; assign one owner to package generated artifacts. |
| Existing manual/signing blockers are accidentally marked done | Medium | Append T70-T97, preserve T01-T69 verbatim, carry blockers into T97 evidence. |

## 2026-09-23 Native Visual Redesign

Status: Approved for execution on 2026-09-23. The capability map
and five visual redesign specifications are approved. This extension preserves
T01-T97 evidence, unfinished manual acceptance, external CI, signing,
notarization, and hardware prerequisites without claiming their completion.
Implementation tasks will be recorded in `tasks/todo.md` after plan approval.

Specifications: [`../SPEC.md`](../docs/specs/SPEC.md),
[`../SPEC-visual-system-v2.md`](../docs/specs/SPEC-visual-system-v2.md),
[`../SPEC-desktop-shell-v2.md`](../docs/specs/SPEC-desktop-shell-v2.md),
[`../SPEC-resource-workspaces-v2.md`](../docs/specs/SPEC-resource-workspaces-v2.md),
[`../SPEC-utility-workspaces-v2.md`](../docs/specs/SPEC-utility-workspaces-v2.md), and
[`../SPEC-visual-acceptance-v2.md`](../docs/specs/SPEC-visual-acceptance-v2.md).

### Scope and Architectural Decisions

- Keep the fixed 1120 x 720 macOS window, native traffic lights, typed IPC,
  catalog authority, configuration safeguards, and all existing interactions.
- Replace the green-leaning colors and accumulated inconsistent page styling
  with gray/graphite surfaces, a restrained blue action accent, shared semantic
  state tokens, and compact readable typography. Preserve distinct warning,
  danger, success, selection, and focus meanings.
- Use the existing CSS/Tailwind and shared React controls. Do not add packages,
  tests, runtime polling, new privileges, or configuration behavior.
- Implement small visible slices; each task runs focused checks, and no phase
  passes without its actual evidence. The last phase records a cross-route
  manual appearance, keyboard, drag, contrast, and 200% zoom matrix separately
  from automation and existing release blockers.
- Preserve all pre-existing uncommitted changes. Orca workers use the current
  workspace only after the detailed tasks are approved. Assign exclusive
  ownership of `src/styles/global.css`, `src/app/AppShell.tsx`, and shared
  UI primitives; parallel work must own disjoint files or wait for a handoff.

### Dependency Graph and Phase Order

```text
T98 semantic light/dark tokens
  -> T99 shared controls and statuses
    -> T100 title bar, navigation, and toolbar
      -> T101 pane geometry and scroll ownership
        -> T102 applications browse
          -> T103 configuration detail and editor
        -> T104 Homebrew list and detail
        -> T105 services list and detail
        -> T106 Dashboard summary
        -> T107 Settings seven-group workspace

T103-T107 -> T108 cross-route automated checks
  -> T109 foreground/manual visual and interaction acceptance
```

### Phase 23: Visual Foundation (`visual-system-v2`)

- [x] T98 Establish native Light/Dark/System semantic palette, typography, and
      density without replacing existing state semantics.
- [x] T99 Unify shared button, status, form, modal, and pane-local asynchronous
      states against those tokens.

Checkpoint Y: `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass; shared
component states remain keyboard accessible and color contrast targets are
checked against rendered colors. No product route is marked redesigned yet.

### Phase 24: Fixed Desktop Shell (`desktop-shell-v2`)

- [x] T100 Clarify one title bar, sidebar, and contextual toolbar hierarchy
      without losing menu events, traffic-light clearance, or navigation.
- [x] T101 Fix pane geometry, list/detail readability, and scroll ownership at
      1120 x 720 and 200% zoom.

Checkpoint Z: no document-level overflow; title-bar interactions and focused
navigation remain reachable. Shared shell files and CSS edits are serialized.

### Phase 25: Resource Workspaces (`resource-workspaces-v2`)

- [x] T102 Recompose application browsing and pagination presentation.
- [ ] T103 Recompose configuration detail, schema editor, and preview flow —
      2026-10-10 isolated native verification confirms five apps at 100%;
      fixed 1120x720 native geometry and string-list draft editing are now
      verified; Caddy's disposable target and genuine 200% zoom remain open.
- [x] T104 Recompose Homebrew inventory, search, detail, and action surfaces;
      native 200% action reachability remains a T109 acceptance gate.
- [x] T105 Recompose Services list, detail, and confirmed action surfaces;
      native 200% confirmation reachability remains a T109 acceptance gate.

Checkpoint AA: each resource route shows a coherent selected item and primary
action without losing 50-item paging, draft state, read-only boundaries,
preview/confirmation, or local-first provider errors.

### Phase 26: Utility Workspaces (`utility-workspaces-v2`)

- [x] T106 Recompose Dashboard into scan-friendly machine, attention, and
      recent-operation groups; native 200% reachability remains a T109 gate.
- [x] T107 Recompose all seven Settings groups with aligned controls and
      isolated dangerous actions; native 200% reachability remains a T109 gate.

Checkpoint AB: Dashboard states remain distinct; Settings preference changes,
safe defaults, reset and confirmed cleanup stay visible, keyboard reachable,
and persistent.

### Phase 27: Cross-Route Acceptance (`visual-acceptance-v2`)

- [x] T108 Run existing focused checks and full frontend/Rust/macOS E2E and
      unsigned-build gates; 2026-10-10 follow-up confirms the fixed-window
      smoke and final frontend/Rust/unsigned-build results. This does not
      close T103 or T109.
- [ ] T109 Complete the manual five-workspace x three-appearance x
      100%/200%-zoom matrix, keyboard/drag/contrast review, and evidence
      updates. If permissions or external prerequisites block any item,
      record it as blocked, not complete.

Checkpoint AC: every new task has implementation and actual acceptance
evidence; unverified manual cases and earlier Apple/GitHub release gates remain
visible. Do not ship or declare every old task complete without their
independent prerequisites and evidence.

On 2026-10-10, the user explicitly approved integrating the unsigned review
candidate into local `main` while retaining the open T103/T109 acceptance
criteria. This is not Checkpoint AC approval or authorization to push, publish,
or include the unrelated package-manager changes.

### Orca Dispatch and Ownership

After human approval of this plan and the detailed checklist, create one
supervised Orca Run. Dispatch Phase 23 before Phase 24. Within Phase 25,
Applications/Config run in order; Homebrew and Services may run alongside
disjoint feature-owned TSX work only after T101. Phase 26 may overlap with
Phase 25 on disjoint feature-owned files. Each task names an exact file
ownership set and prohibits shared CSS/AppShell edits without an explicit
handoff. The coordinator validates the worker report and focused verification
before the next dependent wave; it does not release unverified workers or
overwrite another worker's uncommitted changes.

### Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Concurrent editors clobber dirty shared files | High | Single owner for global CSS, shell, and shared controls; sequential handoffs; inspect the diff before dispatch |
| A palette looks polished but fails real contrast | High | Test rendered foreground/background combinations in both appearances, including translucent selection and focus |
| Fixed panes clip long data at 200% zoom | High | Prioritize list/detail width and pane-local scrolling; inspect five routes and all primary actions |
| Visual changes hide a dangerous or read-only boundary | High | Keep existing typed capability conditions, destructive copy, preview, confirmation, and status text |
| Desktop automation cannot assert human-facing appearance | High | Keep the foreground manual matrix independent of `pnpm check` and WDIO |
| Old signing or CI gates are incorrectly closed | High | Carry T01-T97 checkboxes and release-readiness blockers unchanged until real credentials/hosted runs exist |

### Decisions Required Before Dispatch

- Approve this plan, then review the detailed per-task checklist before any
  Orca implementation Dispatch starts.
- External signing credentials, a protected GitHub release run, and device /
  accessibility review remain independently necessary to close the earlier
  release tasks. Their absence must not be treated as an agent failure.

## 2026-10-10 General UI Correction v3

Status: Approved for incremental execution on 2026-10-10. The four v3
specifications and this T110-T124 sequence are approved. The extension preserves
all T01-T109 evidence and open blockers; it does not claim completion of T103,
T109, signing, notarization, hosted CI, or hardware/accessibility gates.

Specifications:

- [`../docs/specs/SPEC-ui-visual-system-v3.md`](../docs/specs/SPEC-ui-visual-system-v3.md)
- [`../docs/specs/SPEC-ui-layout-completion-v3.md`](../docs/specs/SPEC-ui-layout-completion-v3.md)
- [`../docs/specs/SPEC-home-config-recognition-v3.md`](../docs/specs/SPEC-home-config-recognition-v3.md)
- [`../docs/specs/SPEC-ui-correction-acceptance-v3.md`](../docs/specs/SPEC-ui-correction-acceptance-v3.md)

### Scope and decisions

- Preserve the dirty working tree and make surgical changes; never reset,
  checkout, clean, or overwrite unrelated work.
- Exclude the pnpm 12 migration in `package.json`, `pnpm-lock.yaml`, and `.nvmrc`
  from this extension. Record their hashes and do not regenerate them.
- Preserve the existing Rust discovery wire schema. The frontend retains the
  complete `ConfigurationCoverage`; Rust only expands exact probes across
  already-approved catalog path variants.
- Add no dependency, scan root, traversal depth, arbitrary path authority,
  configuration-content read, write authority, or elevation permission.
- Focused unit tests for discovery DTO fidelity, coverage-count conservation,
  and stale snapshot retention are approved without new dependencies.
- Use temporary HOME/XDG fixtures. Do not mutate real configuration, packages,
  or services during automated or manual verification.

### Dependency graph

```text
T110 -> T111 -> T114 -> T115
T110 -> T112
T110 -> T113
T112 + T115 -> T116
T112 + T115 + T116 -> T117
T112 + T113 + T116 -> T118
T114 + T115 -> T119 / T120 / T121
T118 + T119 -> T122
T117 + T119 + T120 + T121 + T122 -> T123 -> T124
```

### Phase 28: Protected executable baseline

- [x] T110 Register the approved v3 extension, record protected-file hashes,
      and establish a typechecking baseline without absorbing unrelated work.

Checkpoint AD: the v3 specifications, capability map, plan, and detailed tasks
agree; local Markdown links and whitespace pass; the frontend typechecks; the
excluded package-manager files remain byte-identical.

### Phase 29: Appearance and discovery contracts

- [x] T111 Restore functional System/Light/Dark behavior and persisted defaults.
- [x] T112 Preserve complete configuration coverage and retain the previous
      snapshot when a refresh fails.
- [x] T113 Probe every existing catalog path variant without expanding roots,
      traversal, content reads, or the wire schema.

Checkpoint AE: appearance and discovery contracts are independently tested;
classification totals conserve candidate count; partial/error states retain
usable local data.

### Phase 30: Shared visual system and shell

- [x] T114 Consolidate semantic tokens, typography, dimensions, and shared
      controls while retaining compatibility selectors.
- [x] T115 Establish one shell hierarchy and one scroll owner per route pane.

Checkpoint AF: System/Light/Dark share one semantic component system; the shell
has no document scroll or duplicate brand/page hierarchy at 1120 x 720.

### Phase 31: Home-configuration recognition loop

- [x] T116 Add validated, session-only Dashboard-to-Applications local context.
- [x] T117 Make home-directory configuration recognition the first Dashboard
      group with truthful counts, safe paths, evidence, and scan outcomes.
- [x] T118 Add distinct local-recognition/catalog views and route managed
      candidates only through existing catalog-authorized configuration flows.

Checkpoint AG: one discovery snapshot supplies Dashboard and Applications;
local counts never reuse catalog totals; unsupported/excluded candidates expose
no content or mutation action.

### Phase 32: Complete all route layouts

- [x] T119 Use Settings as the reference list/detail layout and keep all seven
      groups and dangerous-action boundaries reachable.
- [x] T120 Complete the Homebrew list/detail layout and persistent operation
      feedback without executing real package operations.
- [x] T121 Complete the Services list/detail layout and preserve read-only and
      confirmation boundaries without executing real service operations.
- [x] T122 Complete the Applications/configuration three-pane layout while
      preserving pagination, drafts, presets, redaction, and safe preview.

Checkpoint AH: all five routes use the same hierarchy and shared control
semantics; long content wraps or scrolls inside its pane rather than being
silently clipped.

### Phase 33: Cleanup and acceptance

- [x] T123 Remove verified-unused compatibility CSS and run focused, full,
      macOS E2E, unsigned-build, corpus, and whitespace gates.
- [ ] T124 Execute and record the foreground appearance, true 200% text zoom,
      window-size, state, keyboard, contrast, drag, VoiceOver, and privacy
      matrix; retain genuine blockers as blockers. The 2026-10-10 attempt is blocked by unavailable
      foreground AX/screenshot/true-zoom/VoiceOver access; automated evidence
      is recorded but does not close this task.

Checkpoint AI: v3 closes only when every required route/state has evidence and
no blocking preview, recognition, or primary-action defect remains. T103/T109
and external release gates change only when equivalent independent evidence
exists.

### Ownership and verification

- `src/styles/global.css`, `src/app/AppShell.tsx`, `src/app/routes.tsx`,
  `src/app/routeDefinitions.ts`, `e2e/smoke.spec.ts`, and task/evidence docs
  always have one serial owner.
- T111/T112/T113 may proceed on disjoint files. T120/T121 may overlap only for
  feature-owned TSX; shared CSS changes are serialized.
- Every task runs focused tests, then lint/typecheck/build. T123 runs the full
  gates; T124 remains a separate foreground/manual gate.

## 2026-10-12 UI Visual and Interaction v4

Status: Approved for incremental execution on 2026-10-12. This extension records
T125–T140 and preserves all T01–T124 evidence and blockers.

- [x] T125 v4 spec/baseline
- T126 Applications Tabs and local selection keyboard contract
- T127 refresh feedback and Brew discovery error mapping
- T128 route focus, regions, live regions and pane tab stops
- T129 shared Headless UI form/action primitives
- T130 warm-gray amber tokens, zero-outline focus and low-border shared UI
- T131 unified Modal/ConfirmDialog and selection adapters
- T132 Settings Headless UI migration
- T133 Applications Headless UI migration
- T134 Schema/specialized editor Headless UI migration
- T135 Homebrew/Services Headless UI migration
- T136 business-layer native-control gate
- T137 low-border Shell/Dashboard migration
- T138 resource-route migration and compat removal
- T139 interaction, visual and full automated gates
- T140 foreground/manual acceptance

Dependency order:

```text
T125 -> T126 / T127 / T128 / T129 / T130
T129 + T130 -> T131
T126 + T129 + T131 -> T133 / T135
T129 + T131 -> T132
T129 -> T134
T132 + T133 + T134 + T135 -> T136
T130 + T136 -> T137 -> T138
T127 + T128 + T131 + T138 -> T139 -> T140
```

Shared CSS, UI adapters, AppShell/routes, E2E and documentation have one serial
owner. Business-level `<form>` remains allowed; direct field/button elements do
not. No dependency, filesystem/process authority, catalog/configuration safety,
or release permission changes are authorized.
