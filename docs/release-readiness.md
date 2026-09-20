# Release readiness evidence

Assessment date: 2026-09-20

Decision: **NO-GO for production publication** until the external signing,
notarization, GitHub-hosted workflow, and manual accessibility/baseline-machine
gates below have real evidence. The codebase may proceed to review as an
unsigned release candidate.

T44 automated integration is complete. Manual desktop acceptance and protected
release evidence remain open and are not implied by the successful local
checks.

## Specification trace

| Specification | Evidence |
|---|---|
| Initiative 1: signed macOS app and persistent tray | Fixed-window state, close-to-tray policy, tray action mapping, and read-only summaries have automated evidence; manual tray/window interaction and signed launch remain blocked or pending. |
| Initiative 2: six integrations and evidence | Catalog tests plus dashboard/application E2E assertions cover all six definitions and typed evidence. |
| Initiative 3: non-blocking Homebrew inventory | Discovery coordinator tests cover independent timeouts/coalescing; UI tests cover loading, unavailable, and populated states. |
| Initiative 4-5: safe edit, validation, backup, atomic write, restore | Config adapter/write/restore Rust tests and frontend preview tests provide automated evidence; live files are never used. |
| Initiative 6: previewed package/service mutations and progress | Brew/service command tests cover distinct actions, intent-bound previews, conflicts, refresh proof, and operation history. |
| Initiative 7: no arbitrary command/path capability | Typed command enums, catalog-only path resolution, bounded process execution, and security review are the evidence. |
| Initiative 8: signed allowlisted helper | Protocol/fake-transport/unsigned fail-closed checks pass; signed registration and protected mutation remain externally blocked. |
| Initiative 9: tagged signed universal release | Tag-only draft workflow, fail-closed secret gate, universal app/helper/bridge architecture checks, and local unsigned universal build provide implementation evidence; GitHub-hosted signed/notarized execution remains blocked. |
| Initiative 10: no telemetry and bounded local persistence | No telemetry/network capability is configured; only protected backups and sanitized bounded operation metadata are stored. |

The module-level criteria in `SPEC-platform-foundation.md`,
`SPEC-app-catalog.md`, `SPEC-system-discovery.md`,
`SPEC-config-management.md`, `SPEC-brew-management.md`,
`SPEC-service-management.md`, and `SPEC-desktop-experience.md` map to the
corresponding T01-T44 tasks and their focused Rust/Vitest/E2E tests. T30-T43
implementation criteria are automated where possible; their explicitly manual
display, assistive-technology, and interaction criteria remain open.

## Automated evidence

Final T44 local verification:

| Check | Result |
|---|---|
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 28 files, 50 tests |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | Passed |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | Passed |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Passed: 84 unit/integration tests, 0 doc tests |
| `pnpm test:e2e` | Passed: 1 macOS WebKit desktop smoke after updating stale pre-T33/T42 selectors; verifies the fixed logical size, disabled resize/maximize, route focus transfer, 12 catalog definitions, Homebrew settling, refresh coalescing, and unsigned-helper fail-closed behavior |
| `pnpm build:unsigned` | Passed; produced `src-tauri/target/release/userhome` |
| `pnpm tauri build --target universal-apple-darwin` | Initial unmodified attempt failed because the Homebrew Rust toolchain could not locate the rustup-installed `x86_64-apple-darwin` standard library. The same command passed with `CI=true` and explicit rustup `CARGO`/`RUSTC`, producing `UserHome.app` and `UserHome_0.1.0_universal.dmg`. |
| Universal app, helper, and bridge architecture | Passed: local `lipo` reports `x86_64 arm64` for all three binaries |
| Local signing identity | Externally blocked: `security find-identity` reports `0 valid identities found`; the local app reports `Signature=adhoc`, `TeamIdentifier=not set` |

The successful frontend, E2E, and build commands ran on Node.js 20.20.2 rather
than the repository-pinned 24.21.0 and emitted an engine warning. The first
GitHub-hosted run on the pinned version remains required evidence.

The existing release workflow and security evidence remain unchanged: pull
request CI has `contents: read`; the tag workflow has `contents: write`, requires
all six Apple secrets before certificate import, signs nested binaries before
the app, and creates only a draft Release. The prior dependency audit remains
blocked because the configured registry `https://npmmirror.nioint.com` does not
implement the npm audit endpoint.

## Security review

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| - | - | - | - | No security vulnerabilities found | - |

## Ship Decision: NO-GO

### Blockers (must fix before ship)

- Install a valid Developer ID Application identity and configure all six Apple
  secrets in the protected GitHub `release` environment.
- Complete one GitHub-hosted pull request run and one protected tagged draft
  release run, including notarization and stapling evidence.
- Complete fixed-window drag/minimize/close/reopen, supported display-scaling,
  VoiceOver, keyboard-only, contrast, reduced-motion, app/Dock/Finder icon,
  light/dark tray interaction, configuration-coverage, signed-helper, Intel
  macOS, and Apple Silicon macOS manual checks.
- Run the dependency audit against a registry that implements the npm audit API.

### Recommended fixes (should fix before ship)

- Pin third-party GitHub Actions to reviewed commit SHAs if repository policy
  requires immutable action provenance.
### Acknowledged risks

- Local unsigned builds are ad-hoc signed by macOS tooling and cannot prove the
  production Team ID or notarization path.
- The default Homebrew Rust toolchain on this host cannot use the rustup-managed
  x86_64 target; the CI-equivalent build passed only with explicit rustup
  `CARGO`/`RUSTC`.
- `CI=true` was used for the successful local universal package so the result
  does not provide evidence for Finder-driven local DMG styling.

### Rollback plan

- **Trigger conditions:** signature, notarization, Gatekeeper, helper
  registration, architecture, or smoke verification fails.
- **Procedure:** keep the release as draft or delete its assets, do not publish
  or move the tag, fix the defect, create a new tag, and rerun every gate.
- **Recovery objective:** no published artifact is exposed while a draft fails
  verification; a corrected draft is produced only after all gates pass.

## Manual and external gates

- [ ] VoiceOver announces navigation, async states, dialogs, progress, and
  errors on a real app build.
- [ ] Keyboard-only traversal, Escape cancellation, focus containment/restoration,
  visible focus, contrast, and reduced-motion behavior pass manual inspection.
- [ ] Window dragging, minimize, close-to-tray, reopen/focus, fixed sizing, and
  internal scrolling pass at supported display scales.
- [ ] App, Dock, Finder, and smallest-size icons remain recognizable; the tray
  template renders correctly in light and dark system appearances.
- [ ] Tray Open/Refresh/Quit and read-only application/service summaries pass
  manual macOS interaction.
- [ ] Writable, read-only, unsupported, excluded, redacted, and restore flows
  match the documented configuration coverage on a disposable baseline machine.
- [ ] A GitHub-hosted pull request run proves the unsigned artifact remains an
  Actions artifact and no Release is created.
- [ ] A protected tag run with all Apple secrets proves nested signing,
  notarization, stapling, and draft Release creation.
- [ ] The signed-helper checklist passes on a disposable protected fixture.
- [x] Approved source artwork and generated bundle assets are present at
  `src-tauri/icons/userhome-icon.svg`, `src-tauri/icons/tray-template.svg`, and
  the configured Tauri icon paths; appearance remains subject to the manual gate
  above.

Automated configuration, backup, restore, Homebrew mutation, service mutation,
and elevation tests use mocks, fake transports, or temporary fixture roots. The
desktop smoke injects and removes an isolated temporary `HOME`/`XDG_CONFIG_HOME`,
does not open configuration documents or invoke mutation commands, and verifies
the unsigned helper fails closed.
