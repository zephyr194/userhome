# UI Correction v3 Acceptance Evidence

**用途：**保存 UI v3 阶段的自动化结果与前台人工矩阵，供历史验收追溯，不作为当前 UI 规格。
保留当时通过、待验收和阻塞的区别；后续版本的验收结果应带日期记录在
[release-readiness.md](release-readiness.md)，不能回写为本阶段已通过。

Status: automated gate complete on 2026-10-10; foreground/manual matrix pending or blocked as recorded below.

本记录覆盖全局视觉系统、五个主路由布局、用户目录配置识别及跨路由验收矩阵。
历史需求规格已清理；以下自动化证据和人工验收阻塞状态继续保留。

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

## T124 foreground/manual acceptance attempt

Result: **BLOCKED — not a visual pass**.

The current execution environment has no attached foreground screen/VoiceOver
control. The same host's prior T109 attempt already established that macOS AX
and window screenshot reads fail even when the permission query reports granted:
`visible windows but no accessibility window`, and window-specific capture
returns `could not create image from window`. This run did not broaden Tauri or
macOS permissions and did not substitute viewport resizing, media-query
simulation, static token checks, or hidden WebDriver automation for true 200%
text zoom or human visual inspection.

Automated E2E evidence is available only for the following subset:

| Route | System preference | 1120×720 | 1360×960 | Document overflow | Main structure |
|---|---|---:|---:|---:|---|
| Dashboard | Protocol verified; rendered appearance not human-inspected | Pass | Pass | Pass | “用户目录配置” first group and conserved count |
| Applications/configuration | Protocol verified; rendered appearance not human-inspected | Pass | Pass | Pass | Local-recognition and 50-item catalog contexts |
| Homebrew | Protocol verified; rendered appearance not human-inspected | Pass | Pass | Pass | Workbench settled or explicit missing state |
| Services | Protocol verified; rendered appearance not human-inspected | Pass | Pass | Pass | List and detail/operation panes present |
| Settings | Protocol verified; rendered appearance not human-inspected | Pass | Pass | Pass | Seven-group list/detail workspace present |

The required foreground cells remain blocked rather than passed:

| Workspace | System→Light 100/200% | System→Dark 100/200% | Explicit Light 100/200% | Explicit Dark 100/200% |
|---|---|---|---|---|
| Dashboard | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom |
| Applications/configuration | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom |
| Homebrew | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom |
| Services | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom |
| Settings | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom | Blocked: no foreground/true zoom |

Also blocked: human contrast measurement from composited rendered colors,
VoiceOver announcements, full keyboard traversal and focus restoration,
pointer/trackpad title-bar drag/no-drag, reduced-motion observation, and
human review of longest-label/readability aesthetics. Dashboard's
loading/ready/empty/partial/error/restricted states are covered by 16 unit
cases, but these are not foreground visual evidence.

No real configuration, package or service was changed. T103 and T109 remain
open. Signing, notarization, protected GitHub CI, Intel/Apple Silicon hardware,
display-scale and all other release gates retain the existing NO-GO decision.
