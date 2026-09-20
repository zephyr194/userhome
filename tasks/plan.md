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

- [`../SPEC.md`](../SPEC.md)
- [`../CAPABILITY-MAP.md`](../CAPABILITY-MAP.md)
- [`../SPEC-platform-foundation.md`](../SPEC-platform-foundation.md)
- [`../SPEC-app-catalog.md`](../SPEC-app-catalog.md)
- [`../SPEC-system-discovery.md`](../SPEC-system-discovery.md)
- [`../SPEC-config-management.md`](../SPEC-config-management.md)
- [`../SPEC-brew-management.md`](../SPEC-brew-management.md)
- [`../SPEC-service-management.md`](../SPEC-service-management.md)
- [`../SPEC-desktop-experience.md`](../SPEC-desktop-experience.md)

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
      generated icon assets are verified.

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

- [ ] Every safely detected candidate is classified and only explicitly
      authorized definitions expose content or write actions.

### Phase 11: Integration

- [ ] T44 Complete desktop optimization integration and documentation

### Checkpoint N: Optimization Complete

- [ ] Existing frontend, Rust, build, and E2E checks pass.
- [ ] Manual fixed-window, keyboard, VoiceOver, contrast, tray, and icon review
      is complete.
- [ ] No automated verification reads or mutates real user configuration.

### Extension Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Fixed window clips dense configuration screens | High | Define internal scroll ownership before page migration and verify every route at 1120 by 720 |
| Broad configuration discovery exposes private data | High | Metadata-only bounded detection, explicit exclusions, and catalog authorization before reads |
| Frameless drag regions intercept controls | High | Mark drag zones explicitly and manually verify every title-bar control |
| App definitions require bespoke adapters | Medium | Land data-only and read-only definitions first; require separate approval for new writable adapters |
| Generated icon assets drift from source SVG | Medium | Regenerate through the Tauri icon command and verify bundle resources |
