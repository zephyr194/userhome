# Release readiness evidence

Assessment date: 2026-09-21

Decision: **NO-GO for production publication** until the external signing,
notarization, GitHub-hosted workflow, and manual accessibility/baseline-machine
gates below have real evidence. The codebase may proceed to review as an
unsigned release candidate.

T69 automated integration and documentation are complete. Manual desktop
acceptance and protected release evidence remain open and are not implied by
the successful local checks.

## Specification trace

### Foundation specifications (T01-T44)

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

### Desktop Completeness revision (T45-T68)

| Specification | Tasks | Implementation evidence | Remaining manual/external evidence |
|---|---|---|---|
| `SPEC-native-desktop-shell.md` | T45-T50 | `DesktopWorkspace` owns bounded sidebar, toolbar, list, detail, inspector, banner, and operation regions; Dashboard is grouped rather than card-based; Applications, Homebrew, and Services use stable-ID list/detail selection; the native menu routes Settings, Refresh, Hide/Show, and Quit through one allowlisted dispatcher. The hidden WDIO smoke verifies the fixed 1120 × 720 logical window, disabled resize/maximize, compact Dashboard, stable navigation focus, catalog list, Homebrew settlement, and refresh coalescing. | Native menu accelerators, full keyboard traversal, tray interaction, window drag/minimize/close/reopen, display scaling, VoiceOver, contrast, reduced motion, and icon appearance remain unchecked. |
| `SPEC-home-baseline-inventory.md` | T51-T53 | Discovery uses typed root aliases, deterministic IDs, metadata-only exact probes plus bounded direct-child scans, explicit limits/outcomes, and a sanitized export. The recorded T53 snapshot classified all 128 emitted candidates without storing raw paths or content. | A fresh comparison on a disposable baseline machine remains unchecked; T69 did not rescan real user configuration. |
| `SPEC-configuration-platform.md` | T54-T57 | Catalog documents declare typed bounded variants and format capabilities; configuration reads return one of nine explicit diagnostic states with safe paths; shared read-only handlers fail closed; React dispatches by capability and `editorKey`, not `appId`; existing preview, validation, backup, restore, redaction, and atomic-write order remains intact. | End-to-end writable/read-only/redacted/restore inspection on disposable real configuration remains unchecked. |
| `SPEC-catalog-expansion.md` | T58-T60 | The validated catalog contains 26 definitions: six writable, nineteen read-only, and one excluded. The final recorded baseline classified 128/128 candidates, managed 25/25 eligible text roots (100%), retained Priority A at 6/6, and satisfied Priority B at 20/20 without adding React `appId` branches or new authority. | A fresh visual reconciliation on a disposable baseline machine remains unchecked. |
| `SPEC-application-settings.md` | T61-T68 | A versioned atomic preference store drives seven compact Settings groups, immediate System/Light/Dark appearance, bounded lifecycle/refresh/editor presets, owned-backup retention and confirmed clearing, typed optional discovery roots, allowlisted diagnostics export/copy, and preference reset that preserves backups and managed files. Settings selection is shared by the sidebar and `Command+,`; the earlier isolated 1120 × 720 keyboard pass covered all groups, and T68 verified sanitized export plus restart after reset. | Full contrast/reduced-motion inspection and native launch/close/reopen/tray lifecycle scenarios remain unchecked. |

Every T45-T68 acceptance criterion is therefore linked to implementation
evidence in `tasks/todo.md`; where verification requires a foreground macOS
interaction, protected credentials, or a disposable baseline machine, the
corresponding checkbox remains open below.

## Automated evidence

Final T69 local verification:

| Check | Result |
|---|---|
| `pnpm check` | Passed: ESLint, both TypeScript projects, 28 Vitest files / 70 tests, Rust formatting, strict Clippy, 90 library tests plus 22 integration tests, and 0 doc-test failures |
| `pnpm test:e2e` | Passed: 1 macOS WebKit desktop smoke. WDIO creates an isolated temporary `HOME`/`XDG_CONFIG_HOME`, writes only a schema-valid E2E preference file there, starts the native window hidden, and asserts it remains hidden. The smoke verifies the fixed logical size, disabled resize/maximize, compact Dashboard, stable navigation focus, 26 catalog definitions, Homebrew settling, refresh coalescing, the fake elevation boundary, and unsigned-helper fail-closed behavior. |
| `pnpm build:unsigned` | Passed; produced `src-tauri/target/release/userhome` |
| `pnpm tauri build --target universal-apple-darwin` | Initial unmodified attempt failed because the Homebrew Rust toolchain could not locate the rustup-installed `x86_64-apple-darwin` standard library. The same command passed with `CI=true` and explicit rustup `CARGO`/`RUSTC`, producing `UserHome.app` and `UserHome_0.1.0_universal.dmg`. |
| Universal app, helper, and bridge architecture | Passed: local `lipo` reports `x86_64 arm64` for all three binaries |
| Local signing identity | Externally blocked: `security find-identity` reports `0 valid identities found`; the local app reports `Signature=adhoc`, `TeamIdentifier=not set` |

The T69 commands ran on Node.js 20.20.2 rather than the repository-pinned
24.21.0 and emitted an engine warning. A GitHub-hosted run on the pinned
version remains required evidence.

The existing release workflow and security evidence remain unchanged: pull
request CI has `contents: read`; the tag workflow has `contents: write`, requires
all six Apple secrets before certificate import, signs nested binaries before
the app, and creates only a draft Release. The prior dependency audit remains
blocked because the configured registry `https://npmmirror.nioint.com` does not
implement the npm audit endpoint.

## Security review

The prior T44 security review found three issues, all resolved before handoff:

| Severity | Area | Resolution |
|---|---|---|
| High | Generic read-only sensitive content could bypass line-based redaction | Commit `1d1900a` uses structured JSON redaction and fails closed to metadata-only output for sensitive formats that cannot be reliably parsed. |
| Medium | Candidate discovery enumerated arbitrary entries below configuration roots | Commit `be02029` limits discovery to exact catalog paths plus the original bounded top-level dot-directory scan. |
| Medium | Managed ancestor directories could be duplicated as unsupported candidates | Commit `be02029` suppresses managed ancestors and extends existing discovery regressions. |

Targeted configuration and discovery tests, strict Clippy, and frontend type
checking pass after these fixes. The T69 five-axis review found no additional
required correctness, architecture, security, or performance changes after
the isolated E2E path was made non-overridable and its fixture permissions were
fixed at `0700`/`0600`.

## Ship Decision: NO-GO

### Blockers (must fix before ship)

- Install a valid Developer ID Application identity and configure all six Apple
  secrets in the protected GitHub `release` environment.
- Complete one GitHub-hosted pull request run and one protected tagged draft
  release run, including notarization and stapling evidence.
- Complete fixed-window drag/minimize/close/reopen, supported display-scaling,
  VoiceOver, keyboard-only, contrast, reduced-motion, app/Dock/Finder icon,
  light/dark tray interaction, native menu commands, Settings lifecycle and
  persistence scenarios, configuration coverage, signed-helper, Intel macOS,
  and Apple Silicon macOS manual checks.
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
- [ ] Native Settings/Refresh/Hide/Show/Quit menu commands and their keyboard
  accelerators execute once and preserve route, group, item, and focus state.
- [ ] Settings appearance, launch, close/reopen, refresh, timeout, editor,
  selection-restoration, backup, privacy, diagnostics, and reset preferences
  persist across real application restarts without changing managed files.
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
desktop smoke creates and removes an isolated temporary
`HOME`/`XDG_CONFIG_HOME`, starts the native window hidden, disables optional
unknown-root discovery, does not open configuration documents or invoke
mutation commands, and verifies the unsigned helper fails closed. No T69
automated command read or mutated real user configuration.
