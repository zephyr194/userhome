# Release readiness evidence

Assessment date: 2026-09-22

Decision: **NO-GO for production publication** until the external signing,
notarization, GitHub-hosted workflow, and manual accessibility/baseline-machine
gates below have real evidence. The codebase may proceed to review as an
unsigned release candidate.

T97 automated integration and documentation are complete. Manual desktop
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
| `SPEC-catalog-expansion.md` | T58-T60 | At the T60 revision, the validated catalog contained 26 definitions: six writable, nineteen read-only, and one excluded. The final recorded baseline classified 128/128 candidates, managed 25/25 eligible text roots (100%), retained Priority A at 6/6, and satisfied Priority B at 20/20 without adding React `appId` branches or new authority. | A fresh visual reconciliation on a disposable baseline machine remains unchecked. |
| `SPEC-application-settings.md` | T61-T68 | A versioned atomic preference store drives seven compact Settings groups, immediate System/Light/Dark appearance, bounded lifecycle/refresh/editor presets, owned-backup retention and confirmed clearing, typed optional discovery roots, allowlisted diagnostics export/copy, and preference reset that preserves backups and managed files. Settings selection is shared by the sidebar and `Command+,`; the earlier isolated 1120 × 720 keyboard pass covered all groups, and T68 verified sanitized export plus restart after reset. | Full contrast/reduced-motion inspection and native launch/close/reopen/tray lifecycle scenarios remain unchecked. |

Every T45-T68 acceptance criterion is therefore linked to implementation
evidence in `tasks/todo.md`; where verification requires a foreground macOS
interaction, protected credentials, or a disposable baseline machine, the
corresponding checkbox remains open below.

### Configuration discovery and editing revision (T70-T97)

| Specification | Tasks | Implementation evidence | Remaining manual/external evidence |
|---|---|---|---|
| `SPEC-desktop-visual-consistency.md` | T70, T92-T95 | Shared semantic geometry, surface, state, focus, row, and control tokens now drive the shell and primary workspaces. Applications use compact two-line rows, a five-control filter grid, pane-local scrolling, long-text wrapping, and narrow logical-viewport adaptations. Homebrew, Services, Settings, Dashboard, dialogs, and shared controls use the same hierarchy. | System/Light/Dark inspection at 100% and 200% text zoom, full keyboard traversal, contrast, reduced motion, and longest-label inspection remain manual. |
| `SPEC-native-window-dragging.md` | T96 | The overlay title bar and approved blank/title regions are explicit drag regions. Buttons, links, inputs, selects, textareas, dialogs, tabs, menu items, options, contenteditable regions, and descendants are no-drag. React suppresses title-bar double-click default handling without changing fixed window configuration. | The real macOS pointer/trackpad matrix remains open: drag 10/10 on approved regions, 0/10 on interactive regions, double-click 0/10 across appearance and display scales. |
| `SPEC-application-browsing.md` | T74-T75, T81-T84 | Rust owns validated search, filters, facets, detail lookup, and exact 50-item pages for 624 offline applications. Request generations prevent stale replacement; selection memory retains query, filters, page, scroll, app, and config selection. The native E2E verifies page 1 contains exactly 50 rows across 13 pages and Rust search finds GitHub Copilot. | First/middle/final/empty manual page inspection and the full keyboard navigation/refresh matrix remain open. |
| `SPEC-open-source-config-sourcing.md` | T73, T76-T80, T83 | Maintainer-only scripts validate official HTTPS authorities, digests, freshness, licensing, review state, and deterministic output. The packaged corpus contains 300 formulae, 300 casks, 26 managed overlays, and 624 unique applications. Runtime remains offline and source evidence grants no authority. | A fresh real-network maintenance refresh and monthly maintainer approval workflow remain operational/manual activities. |
| `SPEC-config-schema-presets.md` | T71-T72, T85-T87 | Independently versioned schemas, presets, and sources fail closed on unknown data, enforce 64 fields/32 presets, omit secret current values, apply presets to drafts only, and restrict complete templates to missing files. Typed IPC and backend validation recheck applicability, values, variant, schema, and preset identity. | Manual interaction across every field kind, warning, field group, recommended preset, and complete-template flow remains open. |
| `SPEC-schema-driven-config-editing.md` | T88-T91 | Git, npm, Caddy, OpenSSH, Copilot settings, and Zsh use `SchemaEditor` by default without `appId` dispatch. Final independent review confirmed schema-backed reads omit sensitive projections, null patches are rejected, OpenSSH host markers are immutable, and npm registry token scope rejects unsafe authorities without echoing credentials. | Manual specialized-versus-schema preview comparison on disposable fixtures and a six-app visual inspection remain open. |

## Automated evidence

### Native redesign integration (T98-T108; 2026-09-24)

The redesigned workspaces reuse the existing typed IPC and safety boundaries.
The evidence below distinguishes implementation and automated checks from
foreground human acceptance:

| Scope | Implementation evidence | Still open |
|---|---|---|
| Visual foundation and shell (T98-T101) | Semantic light/dark/system tokens, shared controls, fixed workspace geometry, and pane-local scrolling are implemented; T98 recorded computed contrast samples and T101 checked empty-pane geometry in an isolated browser. | Real Tauri traffic lights, drag regions, populated panes, and 200% zoom need foreground inspection. |
| Applications (T102) | Compact selectable rows and support boundaries retain Rust-side 50-item pages; the native smoke checks 50 rows, 13 pages, and a GitHub Copilot search against 624 entries. | Full pagination, long-name, keyboard, and selected-detail visual matrices remain manual. |
| Configuration (T103) | Schema fields, presets, document selection, and preview/confirmation retain the existing typed authority boundary. The 2026-10-10 follow-ups below verify the camelCase DTO fix, five schema/preview flows, fixed 1120x720 native geometry, and string-list typing with canceled redacted previews. | Caddy lacks an authorized disposable native target; genuine 200% zoom remains unresolved. Embedded native WebView evidence does not constitute completed foreground acceptance. |
| Homebrew and Services (T104-T105) | Compact inventory/service rows, selected details, read-only restrictions, and target-specific preview/confirmation are implemented; existing unit and Rust checks pass without invoking real mutations. | Dialog reachability, action feedback, and 200% zoom remain manual. |
| Dashboard and Settings (T106-T107) | Grouped machine/attention/activity rows and seven settings groups preserve localized state, preference feedback, keyboard selection, and distinct danger confirmations; existing checks pass. | Populated states, persistence across real restarts, and 200% control reachability remain manual. |

| T108 gate | Observed result |
|---|---|
| `pnpm check` | Passed in a temporary `HOME` after selecting one rustup toolchain consistently for Cargo, rustc, and rustdoc: ESLint, both TypeScript projects, 29 Vitest files / 72 tests, Rust formatting, strict Clippy, 92 library tests, 22 integration tests, and 0 failed doc tests. The first attempt with Homebrew `rustdoc` and cached rustup-built dependencies failed its doc-test with 238 `serde`/E0463 errors; this was a toolchain mismatch, not a clean first pass. |
| `pnpm test:e2e` | Passed on the second fresh isolated `HOME`: one macOS WebKit smoke. The first run failed at `e2e/smoke.spec.ts:117` when Homebrew inventory returned `Homebrew inventory timed out.` instead of a count or unavailable state. The retry passed without changes to the test or product code. The WDIO mock-store teardown warning remained non-fatal. The smoke does not prove Git Schema or other unvisited routes. |
| `pnpm build:unsigned` | Passed with a temporary `HOME`, offline Rust dependencies, and a copy of the already cached pnpm 10.33.1 Corepack package; produced `src-tauri/target/release/userhome`. The first attempt in an empty temporary `HOME` tried to download pnpm and failed with `UND_ERR_SOCKET` (`TypeError: terminated`); the successful attempt disabled Corepack network access. |

The WDIO configuration additionally creates its own temporary `HOME` and
`XDG_CONFIG_HOME`, a `0700` settings directory, and a `0600` preferences file
with optional discovery roots disabled. No real user configuration or backup
was intentionally accessed, and no package or service mutation was performed;
installed Rust and package-manager caches were reused for build tools. The
local Node.js version is 20.20.2, not the pinned 24.21.0. None of these checks
is evidence of human visual acceptance, a signed artifact, notarization, or
GitHub-hosted CI. The existing manual and external blockers remain NO-GO.

### T103 isolated native follow-up (2026-10-10)

The user approved default `/build`: T103 only, with no commits, new tests,
dependency changes, or real configuration access. Orca Run
`run_309bec7341e6`, Task `task_20f5a3b30e5d`, Dispatch `ctx_0c468dcf6c71`
settled **failed / acceptance incomplete**. No implementation file changed.

| Evidence | Actual result |
|---|---|
| Existing frontend gates | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passed under installed Node 24.21.0 / pnpm 12.11.2: 29 files, 72 existing tests. The existing large-chunk warning remains. |
| Existing Rust adapters / native build | Consistent Homebrew Cargo/rustc/rustdoc 1.99 passed 19 existing adapter tests and the E2E-enabled native build. The native build reused the successful frontend output via a command-line `beforeBuildCommand` override; no repository build configuration changed. |
| Git / `git-global-config` | Actual native schema fields, preset draft, redacted preview, and confirmation were observed through AX, DOM, and a retained OS screenshot. The AX action's unasserted metadata was independently checked against the resulting dialog. No write executed. |
| npm, OpenSSH, Copilot settings, Zsh | Existing rendered controls in the real Tauri WebView decoded schemas, changed drafts, opened safe previews/confirmation, and canceled successfully through the embedded driver. This is automated native evidence, not a completed four-page foreground/manual pass. |
| Read-only / secret boundaries | Two VS Code documents showed no write/preview/restore buttons. Invented token/private-key sentinels were absent from rendered content and previews. Extra Copilot documents retained their actual no-schema/fallback states; no unsupported schema or additional preview pass is claimed. |
| Caddy | Native schema/preview **blocked**: its authorized Homebrew `etc/Caddyfile` target cannot be relocated under disposable HOME with current policy. No real Caddyfile was read; existing Rust Caddy fixtures do not prove native acceptance. |
| Genuine 200% zoom | **Blocked**: foreground shortcut returned `window_not_focused` even after restore; native zoom IPC was denied by existing `core:webview:allow-set-webview-zoom`. Body/control fonts stayed 13px. No capabilities were broadened and no CSS/viewport simulation is counted. |
| Exact geometry / existing smoke | Native inner size was 2242x1442 physical at scale factor 2, or **1121x721 logical**. The unchanged `pnpm exec wdio run ./wdio.conf.ts` failed at `e2e/smoke.spec.ts:50`, expected width 1120, received 1121. Root cause remains undetermined; no passing `pnpm test:e2e` or exact-size acceptance is claimed for this follow-up. |

At the observed 100% geometry, root scroll dimensions equaled the
1121x721 viewport. Each populated inspector scrolled locally to its preview;
confirmation controls were within the viewport. This narrows the native
schema/preview gap but does not satisfy exact 1120x720 or 200% requirements.
Current UserHome AX/screenshots became readable after the permissions-helper
retry; the historical blanket AX blocker below is not a claim about the
current five-app evidence. Focus/zoom and the remaining foreground matrix
remain unresolved.

All launches used disposable `HOME` and `XDG_CONFIG_HOME`, `0700` settings
directories, `0600` preference files, and `optionalDiscoveryRoots=[]`.
Five schema fixture files retained their original hashes. No confirmation
executed a write, and no real package/service mutation occurred. Temporary
HOME directories and owned app processes were cleaned up; installed caches
and build output were preserved. The coordinator independently confirmed
that the pre-existing `package.json`, `pnpm-lock.yaml`, and `.nvmrc` hashes
were unchanged.

The full report, per-document native responses, harness corrections,
before/after hashes, logs, and `git-preview-native-action.png` are retained at
`/Users/archie.zheng/.copilot/session-state/f5f14f69-e087-4cc1-8cde-9684d01d6bb1/files/t103/`.
The worker terminal was already user-owned; post-settlement cleanup returned
`retained / user_takeover` with no process action. T103 remains unchecked;
T108's historical results, T109's independent matrix, and all signing,
notarization, GitHub CI, hardware, and earlier manual gates are unchanged.

### Local unsigned-candidate integration follow-up (2026-10-10)

The user explicitly approved integrating this implementation into local
`main` as an **unsigned review candidate**, retaining the incomplete T103/T109
criteria. This is not production acceptance, publication, or authorization to
push. The unrelated working-tree `package.json`, `pnpm-lock.yaml`, and `.nvmrc`
changes are preserved without inclusion in the candidate commits.

| Scope | Actual result |
|---|---|
| Native fixed size | The unchanged smoke reproduced 1121x721. Disabling resize/maximize did not enforce the content-size invariant; adding equal minimum/maximum 1120x720 bounds produced exactly 1120x720 while preserving hidden startup and disabled resize/maximize. The full unchanged smoke passed, including a final run after the string-list fix. |
| String-list drafts | Pre-merge review reproduced per-keystroke normalization corrupting `ll=ls -la` and joining two source paths. The control now retains raw lines, spaces, and trailing newlines; only preview patch construction trims entries and filters empty lines. One-off in-memory execution verified exact patch shapes, unchanged non-list values, empty-list clearing, and unmodified drafts. |
| Native configuration follow-up | A disposable `.zshrc` in the real Tauri WebView retained character-by-character alias/source input, reached a redacted preview, and preserved both drafts after cancellation. Fixture bytes remained unchanged; no write was confirmed. The first harness incorrectly expected sensitive diff text and had a cleanup race; its expectations and bounded cleanup were corrected, without changing product assertions or redaction. |
| Frontend and corpus | Node 24.21.0 / pnpm 12.11.2 passed lint, both TypeScript projects, all 29 Vitest files / 72 existing tests, and frontend builds. Corpus validation confirmed 300 formulae, 300 casks, 26 overlays, and 624 unique applications. |
| Rust | Consistent Homebrew Cargo/rustc/rustdoc 1.99 passed formatting, strict all-target/all-feature Clippy, 92 library tests, 22 integration tests, and doc tests after the window change. |
| Unsigned artifact | The final `pnpm build:unsigned` completed after both fixes and produced `src-tauri/target/release/userhome`. The existing large-chunk warning and non-fatal WDIO mock-store teardown warning remain. |

Runtime launches used disposable `HOME`/`XDG_CONFIG_HOME`, private preferences,
and disabled optional discovery roots. No repository tests, dependencies,
capabilities, or real configuration/package/service mutations were added.
One-off harnesses and logs are retained in Copilot session
`792f83b9-56c8-4359-8314-b6d0113e343f` under `files/`.
**T103/T109 remain open** for Caddy, genuine 200% zoom, and the foreground
visual/interaction matrix; signing, notarization, GitHub-hosted CI, and
hardware gates retain their existing NO-GO status.

### T109 foreground acceptance attempt (2026-09-24)

The current `src-tauri/target/release/userhome` binary was launched with
`HOME=/tmp/userhome-t109-ctx6c00` and
`XDG_CONFIG_HOME=/tmp/userhome-t109-ctx6c00/.config`. Its isolated
`Library/Application Support/com.zephyr194.userhome/preferences.json` was
created with mode `0600`, `appearance=SYSTEM`,
`openWindowOnLaunch=true`, and `optionalDiscoveryRoots=[]`; the isolated
settings directory had mode `0700`. No real user configuration, package,
service, or configuration write was requested. To give the current unsigned
binary its application identity, a copy of the older `UserHome.app` wrapper
was staged under that temporary HOME and its executable replaced with this
binary; this was not a signed release artifact.

`orca computer list-apps` identified the isolated UserHome process (PID
3947, bundle ID `com.zephyr194.userhome`); `list-windows` identified its
visible, non-minimized `UserHome` window (ID 4032, 1009 x 650 screen
pixels on this host). This proves only that a native window existed, not its
logical WebView size, contents, or accessibility. Both permissions reported
`granted`, but `orca computer get-app-state --app
com.zephyr194.userhome --window-id 4032 --restore-window --json` failed
with `permission_denied`: "visible windows but no accessibility window (AX
reads stayed blocked for 1500ms after retries)." The same error occurred
for System Settings and Orca itself, so the failure is not evidence of a
UserHome-specific accessibility defect. A window-specific `screencapture`
attempt also returned `could not create image from window`. Refreshing
permissions, removing screenshot capture, and trying both the direct binary
and a bundle-identified copy did not restore observation.

In the matrix below, **blocked** means not inspected; the rows are not a
visual pass. System appearance in the isolated preference file is an initial
setting, not a verified rendering. Zoom percentage was not measured or
changed because no WebView or visible application control was reachable.

| Workspace | System 100% | System 200% | Light 100% | Light 200% | Dark 100% | Dark 200% |
|---|---|---|---|---|---|---|
| Dashboard | Blocked: AX/screenshot | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom |
| Applications/configuration | Blocked: AX/screenshot | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom |
| Homebrew | Blocked: AX/screenshot | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom |
| Services | Blocked: AX/screenshot | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom |
| Settings | Blocked: AX/screenshot | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom | Blocked: AX | Blocked: AX/zoom |

No route, pane action, real selected detail, Git Schema page/preview, or
status copy was observable. No `documentElement` scroll dimensions, pane
reachability, rendered text/icon/nontext/focus contrast ratios, Tab/focus
order, `Command+,`/`Command+R`, traffic-light drag/no-drag, or real 200%
text zoom could be verified. The T103 camelCase Schema DTO fix remains
unverified in the native UI. After macOS AX and screen capture can actually
read this process, repeat all 30 cells with explicit per-route measurements
and interaction traces; do not treat the existing isolated E2E or computed
CSS samples as replacements. Signing identity, notarization, protected
GitHub-hosted CI, baseline-machine, display-scale, and assistive-technology
gates remain open under the existing NO-GO decision.

### T97 local revision verification

| Check | Result |
|---|---|
| `pnpm corpus:validate` | Passed offline: 300 formulae, 300 casks, 26 overlays, and 624 unique packaged applications. Packaged corpus SHA-256: `11bc74cafe58d3259341733af10ce15baad471fdb742d7cd2cc2c30a17b3e501`. Runtime catalog SHA-256 from deterministic rebuild comparison: `3aeb04f2a1ee4293ae02926d0c64d9f6eb60972ab1eaafe33977d33870105afd`. |
| Catalog performance | Passed: 100 representative Rust queries over the 624-entry catalog measured p95 at 22.470 ms, below the 100 ms target. |
| `pnpm check` | Passed: ESLint, both TypeScript projects, 29 Vitest files / 71 tests, Rust formatting, strict Clippy, 92 library tests plus 22 integration tests, and 0 doc-test failures. |
| `pnpm test:e2e` | Passed: 1 macOS WebKit desktop smoke using an isolated temporary `HOME` and `XDG_CONFIG_HOME`. It verifies fixed 1120 × 720 logical size, disabled resize/maximize, hidden launch preference, Dashboard availability, navigation focus, exactly 50 application rows on page 1 of 13, 624 total applications, Rust-side GitHub Copilot search, Homebrew settlement, refresh coalescing, fake elevation isolation, and unsigned-helper fail-closed behavior. |
| `pnpm build:unsigned` | Passed; produced `src-tauri/target/release/userhome`. |
| Focused Schema/Catalog gates | Passed: `cargo check --all-targets --all-features`, strict Clippy, 43 filtered config tests, 12 filtered catalog tests, frontend lint/typecheck/build, and final independent review with no Critical or Required findings. |

The T97 commands ran on Node.js 20.20.2 rather than the repository-pinned
24.21.0 and emitted an engine warning. Vite also retained the existing
approximately 500 kB chunk-size warning. The E2E runner emitted a non-fatal
mock-store cleanup warning after its session had already ended. A
GitHub-hosted run on the pinned Node version remains required evidence.

Final T69 local verification:

| Check | Result |
|---|---|
| `pnpm check` | Passed: ESLint, both TypeScript projects, 28 Vitest files / 70 tests, Rust formatting, strict Clippy, 90 library tests plus 22 integration tests, and 0 doc-test failures |
| `pnpm test:e2e` | Passed at the T69 revision: 1 macOS WebKit desktop smoke. WDIO created an isolated temporary `HOME`/`XDG_CONFIG_HOME`, wrote only a schema-valid E2E preference file there, started the native window hidden, and asserted it remained hidden. The smoke verified the fixed logical size, disabled resize/maximize, compact Dashboard, stable navigation focus, the then-current 26 catalog definitions, Homebrew settlement, refresh coalescing, the fake elevation boundary, and unsigned-helper fail-closed behavior. |
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
or T97 automated command read or mutated real user configuration.
