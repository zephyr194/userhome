# UI Correction v3 Acceptance Evidence

Status: automated gate complete on 2026-10-10; foreground/manual matrix pending or blocked as recorded below.

Specifications:

- [`specs/SPEC-ui-visual-system-v3.md`](specs/SPEC-ui-visual-system-v3.md)
- [`specs/SPEC-ui-layout-completion-v3.md`](specs/SPEC-ui-layout-completion-v3.md)
- [`specs/SPEC-home-config-recognition-v3.md`](specs/SPEC-home-config-recognition-v3.md)
- [`specs/SPEC-ui-correction-acceptance-v3.md`](specs/SPEC-ui-correction-acceptance-v3.md)

## Automated gate

Environment actually used:

- macOS Darwin 27.0.0
- Node.js 20.20.2 (project declares 24.21.0; retained as an environment warning)
- pnpm 12.11.2
- Rust/Cargo 1.99.0 (Homebrew)
- branch `chore/ui-correction-v3-t110`

Results:

| Gate | Result | Evidence |
|---|---|---|
| `pnpm lint` | Pass with one warning | No errors; one `react-refresh/only-export-components` warning for the Dashboard test seam. |
| `pnpm typecheck` | Pass | Browser and Node TypeScript projects clean. |
| `pnpm test` | Pass | 42 files, 196 tests. |
| `pnpm build` | Pass | 307 modules; retained existing >500 kB chunk warning. |
| `pnpm check` | Pass | Frontend gates plus Rust fmt, strict Clippy, 93 library tests and 22 integration tests. |
| `pnpm test:e2e` | Pass | One isolated-HOME macOS WebView smoke, 6.9 seconds. |
| `pnpm build:unsigned` | Pass | Release binary built at `src-tauri/target/release/userhome`. |
| `pnpm corpus:validate` | Pass | 300 formulae, 300 casks, 26 overlays, 624 unique applications. |
| `git diff --check` | Pass | No whitespace errors. |

The E2E uses a generated temporary HOME/XDG_CONFIG_HOME and verifies:

- native 1120×720 minimum and a 1360×960 enlarged window;
- no document-level horizontal or vertical overflow at both sizes;
- Dashboard first group is “用户目录配置” with a conserved local count;
- Applications initially shows “本机识别”, then explicitly switches to the 624-entry catalog and observes exactly 50 items on page 1 of 13;
- Homebrew, Services and Settings route workspaces remain visible and document-bounded;
- refresh coalescing retains one refresh ID;
- fake elevation works only in the E2E transport and the unsigned real helper remains unavailable.

No real configuration, package or service mutation was executed. The WDIO service emitted its pre-existing teardown warning after deleting the session (`Failed to clear mock store: A sessionId is required`); the test itself passed 1/1.

## Static visual-system evidence

- Light, explicit Dark and System-following-Dark define matching semantic token sets.
- Shared type levels are 11/12/13/14/20px and shared controls use 32/36px minimum heights.
- Route compatibility CSS is bounded by `control-lab-compat:start/end` and contains no literal colors.
- Production TSX contains no meaningful `truncate`, `line-clamp`, `text-ellipsis` or `whitespace-nowrap` classes; CSS contains no `text-overflow: ellipsis` or line clamp.
- The only remaining gradient is the functional System appearance preview that shows the light/dark split using semantic preview tokens.
- Media-query rules do not hide help, descriptions, section labels or toolbar descriptions.

## Foreground/manual matrix

See the T124 section below. Automated and static evidence does not count as true 200% text zoom, VoiceOver, rendered contrast or human visual acceptance.
