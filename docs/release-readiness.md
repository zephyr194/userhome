# Release readiness evidence

Assessment date: 2026-09-20

Decision: **NO-GO for production publication** until the external signing,
notarization, GitHub-hosted workflow, and manual accessibility/baseline-machine
gates below have real evidence. The codebase may proceed to review as an
unsigned release candidate.

## Specification trace

| Specification | Evidence |
|---|---|
| Initiative 1: signed macOS app and persistent tray | Window/tray behavior is implemented and covered by Rust/E2E checks; signed launch remains blocked by the absent Developer ID identity. |
| Initiative 2: six integrations and evidence | Catalog tests plus dashboard/application E2E assertions cover all six definitions and typed evidence. |
| Initiative 3: non-blocking Homebrew inventory | Discovery coordinator tests cover independent timeouts/coalescing; UI tests cover loading, unavailable, and populated states. |
| Initiative 4-5: safe edit, validation, backup, atomic write, restore | Config adapter/write/restore Rust tests and frontend preview tests provide automated evidence; live files are never used. |
| Initiative 6: previewed package/service mutations and progress | Brew/service command tests cover distinct actions, intent-bound previews, conflicts, refresh proof, and operation history. |
| Initiative 7: no arbitrary command/path capability | Typed command enums, catalog-only path resolution, bounded process execution, and security review are the evidence. |
| Initiative 8: signed allowlisted helper | Protocol/fake-transport/unsigned fail-closed checks pass; signed registration and protected mutation remain externally blocked. |
| Initiative 9: tagged signed universal release | Tag-only draft workflow, fail-closed secret gate, universal helper build, and local unsigned universal build provide implementation evidence; GitHub-hosted signed/notarized execution remains blocked. |
| Initiative 10: no telemetry and bounded local persistence | No telemetry/network capability is configured; only protected backups and sanitized bounded operation metadata are stored. |

The module-level criteria in `SPEC-platform-foundation.md`,
`SPEC-app-catalog.md`, `SPEC-system-discovery.md`,
`SPEC-config-management.md`, `SPEC-brew-management.md`,
`SPEC-service-management.md`, and `SPEC-desktop-experience.md` map to the
corresponding completed T01-T29 tasks and their focused Rust/Vitest/E2E tests.

## Automated evidence

Populate this table from the final local verification run:

| Check | Result |
|---|---|
| `pnpm vitest run src/features src/components` | Passed: 22 files, 36 tests |
| `pnpm check` | Passed: lint, typecheck, 50 frontend tests, 84 Rust/unit/integration tests |
| `pnpm test:e2e` | Passed: 1 macOS WebKit desktop smoke test, including focus transfer |
| `pnpm build:unsigned` | Passed; produced `src-tauri/target/release/userhome` |
| `pnpm tauri build --target universal-apple-darwin` | Passed with CI-equivalent `CI=true` and explicit rustup `CARGO`/`RUSTC`; produced universal `.app` and DMG. The unmodified local shell command reached the DMG step but Finder automation failed in this IDE environment. |
| Workflow YAML parse and permission inspection | Passed local YAML parsing; PR workflow is `contents: read`, tag workflow is `contents: write`, and the empty-secret simulation failed closed |
| Universal helper and bridge architecture | Local `lipo` reports `x86_64 arm64` |
| Security review | No vulnerabilities found; review covered workflow permissions/secrets, helper signing order, shell/path boundaries, tray actions, and confirmation handling |
| Code quality review | Two findings fixed: destructive-dialog initial focus now prefers Cancel, and tray partial state includes partial app detections |
| Dependency audit | Blocked: configured registry `https://npmmirror.nioint.com` does not implement the npm audit endpoint |
| Local signing identity | Blocked: `security find-identity` reports `0 valid identities found`; local app reports `Signature=adhoc`, `TeamIdentifier=not set` |

The validation host used Node.js 20.20.2 while the repository pins 24.21.0.
All commands passed with an engine warning; the GitHub workflows install the
pinned version from `.node-version`, so the first hosted run remains required
evidence.

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
- Complete VoiceOver, keyboard-only, contrast, reduced-motion, tray interaction,
  signed-helper, Intel macOS, and Apple Silicon macOS manual checks.
- Run the dependency audit against a registry that implements the npm audit API.

### Recommended fixes (should fix before ship)

- Pin third-party GitHub Actions to reviewed commit SHAs if repository policy
  requires immutable action provenance.
### Acknowledged risks

- Local unsigned builds are ad-hoc signed by macOS tooling and cannot prove the
  production Team ID or notarization path.
- The IDE host blocks Finder automation used for styled DMG creation unless
  `CI=true`; the CI-equivalent packaging path passed.

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
- [ ] Tray Open/Refresh/Quit and read-only application/service summaries pass
  manual macOS interaction.
- [ ] A GitHub-hosted pull request run proves the unsigned artifact remains an
  Actions artifact and no Release is created.
- [ ] A protected tag run with all Apple secrets proves nested signing,
  notarization, stapling, and draft Release creation.
- [ ] The signed-helper checklist passes on a disposable protected fixture.
- [x] The final icon and visual identity receive explicit product approval; the
  source assets are `src-tauri/icons/userhome-icon.svg` and
  `src-tauri/icons/tray-template.svg`.

Automated checks do not mutate real user configuration: configuration, backup,
restore, Homebrew mutation, service mutation, and elevation tests use mocks,
fake transports, or temporary fixture roots.
