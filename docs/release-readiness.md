# Release readiness evidence

Assessment date: 2026-09-22

Decision: **NO-GO for production publication** until the external signing,
notarization, GitHub-hosted workflow, and manual accessibility/baseline-machine
gates below have real evidence. The codebase may proceed to review as an
unsigned release candidate.

T97 automated integration and documentation are complete. Manual desktop
acceptance and protected release evidence remain open and are not implied by
the successful local checks.

## 2026-10-14：T04 托盘生命周期人工验收完成

用户在 `0e5c74a` 的隔离 HOME 实例中确认：界面可操作、关闭仅隐藏、托盘 Open
恢复窗口并保留页面、单次 Refresh 正常结束、托盘没有配置或软件/服务变更动作，
以及 Quit 正常退出。验收进程退出码为 0，未更改真实用户配置。
既有 Rust 托盘回归 3 项、前端外壳回归 52 项及前端构建通过。

此证据只关闭 T04，不关闭 T05 的 GitHub 托管 CI、T140 的完整人工矩阵、
托盘主题外观和摘要准确性、签名/公证、安全审查及其他发布门禁；生产结论仍为
**NO-GO**。人工验收的证据范围以本节记录为准。

## 历史实施证据追溯

需求规格、能力图、实施计划和任务清单已于 2026-10-14 清理。以下 T 编号仅作为
历史证据标识保留，不再指向任务文件；文档清理不关闭任何人工或外部门禁，
也不改变生产发布的 **NO-GO** 结论。

### 基础能力（T01-T44）

| 能力 | 证据 |
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

平台基础、应用目录、系统发现、配置管理、Homebrew 管理、服务管理和桌面体验的
历史验收对应 T01-T44 及其定向 Rust/Vitest/E2E 测试。T30-T43 中可自动化的
实施条件已有证据；需要人工验证的显示、辅助技术和交互条件仍未关闭。

### 桌面完整性修订（T45-T68）

| 能力 | 历史任务编号 | 实施证据 | 尚缺的人工或外部证据 |
|---|---|---|---|
| 原生桌面外壳 | T45-T50 | `DesktopWorkspace` 管理有界侧栏、工具栏、列表、详情、检查器、横幅和操作区域；Dashboard 使用分组而非卡片；Applications、Homebrew 和 Services 使用稳定 ID 的列表/详情选择；原生菜单通过白名单分发器处理 Settings、Refresh、Hide/Show 和 Quit。该阶段隐藏窗口的 WDIO 冒烟验证了固定 1120 × 720 逻辑尺寸、禁止缩放/最大化、紧凑 Dashboard、稳定导航焦点、应用目录列表、Homebrew 加载结束及刷新合并。 | 原生菜单快捷键、完整键盘遍历、托盘交互、窗口拖动/最小化/关闭/重开、显示缩放、VoiceOver、对比度、减少动态效果及图标外观尚未完成验收。 |
| 用户目录基线清单 | T51-T53 | 发现流程采用类型化根别名、确定性 ID、仅元数据的精确探测与有界直接子项扫描、显式限制/结果和脱敏导出。T53 快照分类了全部 128 个候选项，未保存原始路径或内容。 | 尚未在一次性基线机器上重新比对；T69 未重新扫描真实用户配置。 |
| 配置平台 | T54-T57 | 目录文档声明类型化有界变体和格式能力；配置读取返回九种显式诊断状态之一及安全路径；共享只读处理器拒绝不安全情况；React 按能力和 `editorKey` 分发，而非 `appId`；既有预览、验证、备份、恢复、脱敏和原子写入顺序保持不变。 | 尚未在一次性真实配置上完成可写/只读/脱敏/恢复的端到端验收。 |
| 应用目录扩展 | T58-T60 | T60 验证的目录包含 26 个定义：6 个可写、19 个只读、1 个排除。最终基线分类了 128/128 个候选项，管理 25/25 个符合条件的文本根（100%），Priority A 保持 6/6，Priority B 达到 20/20，未新增 React `appId` 分支或权限。 | 尚未在一次性基线机器上重新完成视觉比对。 |
| 应用设置 | T61-T68 | 版本化原子偏好存储驱动七个紧凑 Settings 分组、即时 System/Light/Dark 外观、有界生命周期/刷新/编辑器预设、自有备份保留与确认清理、类型化可选发现根、白名单诊断导出/复制，以及保留备份和受管文件的偏好重置。侧栏与 `Command+,` 共享 Settings 选择；早期隔离环境的 1120 × 720 键盘验收覆盖全部分组，T68 验证了脱敏导出及重置后重启。 | 完整对比度/减少动态效果验收，以及原生启动/关闭/重开/托盘生命周期场景尚未完成。 |

上表保留 T45-T68 的实施证据。需要前台 macOS 交互、受保护凭据或一次性基线机器
才能验证的条件，仍在下方保留为未关闭的门禁。

### 配置发现与编辑修订（T70-T97）

| 能力 | 历史任务编号 | 实施证据 | 尚缺的人工或外部证据 |
|---|---|---|---|
| 桌面视觉一致性 | T70, T92-T95 | 共享语义几何、表面、状态、焦点、行和控件令牌驱动外壳与主要工作区。Applications 使用紧凑双行、五控件筛选网格、窗格内滚动、长文本换行和窄逻辑视口适配。Homebrew、Services、Settings、Dashboard、对话框和共享控件使用同一层级。 | System/Light/Dark 在 100%/200% 文本缩放下的验收、完整键盘遍历、对比度、减少动态效果和最长标签检查仍需人工完成。 |
| 原生窗口拖动 | T96 | overlay 标题栏及已批准的空白/标题区域显式允许拖动。按钮、链接、输入框、选择框、文本区域、对话框、标签页、菜单项、选项、可编辑区域及其后代均禁止拖动。React 抑制标题栏双击默认行为，不改变该阶段固定窗口配置。 | 真实 macOS 指针/触控板矩阵仍未完成：跨外观与显示缩放，允许区域拖动 10/10、交互区域拖动 0/10、双击改变窗口 0/10。 |
| 应用浏览 | T74-T75, T81-T84 | Rust 为 624 个离线应用提供经验证的搜索、筛选、分面、详情查询及每页恰好 50 项的分页。请求代次防止旧结果覆盖；选择记忆保留查询、筛选、页码、滚动、应用和配置选择。原生 E2E 验证共 13 页且第一页恰好 50 行，并通过 Rust 搜索找到 GitHub Copilot。 | 首/中/末/空页人工验收，以及完整键盘导航/刷新矩阵仍未完成。 |
| 开源配置来源 | T73, T76-T80, T83 | 仅维护者使用的脚本验证官方 HTTPS 授权域、摘要、新鲜度、许可、审查状态和确定性输出。打包语料包含 300 个 formulae、300 个 casks、26 个受管 overlays 和 624 个唯一应用。运行时保持离线，来源证据不授予权限。 | 真实网络维护刷新和每月维护者审批仍属于运维/人工活动。 |
| 配置 Schema 与预设 | T71-T72, T85-T87 | 独立版本化的 Schema、预设和来源拒绝未知数据，限制 64 个字段/32 个预设，省略 secret 当前值，预设只应用于草稿，完整模板仅用于缺失文件。类型化 IPC 和后端验证重新检查适用性、值、变体、Schema 和预设身份。 | 各字段类型、警告、字段组、推荐预设及完整模板流程的人工交互验收仍未完成。 |
| Schema 驱动配置编辑 | T88-T91 | Git、npm、Caddy、OpenSSH、Copilot settings 和 Zsh 默认使用 `SchemaEditor`，不按 `appId` 分发。最终独立审查确认 Schema 读取省略敏感投影、拒绝 null 补丁、OpenSSH host 标记不可变，且 npm registry token 范围拒绝不安全授权域而不回显凭据。 | 一次性夹具上的专用编辑器与 Schema 预览人工比对，以及六个应用的视觉验收仍未完成。 |

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

### Native dragging permission correction (2026-10-10)

The main-window capability omitted `core:window:allow-start-dragging`, so the
existing titlebar drag regions could not invoke Tauri's drag command. Only this
permission was added; resize, maximize, filesystem, and shell authority remain
unchanged. The existing IPC allowlist test reproduced the omission before the
fix, and existing shell tests now check static regions and interactive exclusions.
The isolated native WebView accepted the drag IPC and consumed primary presses
on title/blank regions, but not refresh, navigation, or secondary presses.
Synthetic OS drag attempts did not yield repeatable pointer-to-window movement;
they are not a completed manual drag matrix. Frontend/Rust contract checks,
the unchanged fixed-size native smoke, and the final unsigned build passed.
No real configuration was accessed, and T109's manual gates remain open.

### Native border resizing revision (2026-10-10)

The user approved native border resizing, with both the initial and minimum
size at 1120x720 logical pixels. The maximum-size constraint is removed;
maximize/fullscreen, title-bar double-click behavior, and production IPC
permissions remain unchanged. No size-settings UI or size persistence is added.

The revised existing smoke first failed because the native window was not
resizable. Removing the maximum bound exposed the earlier 1121x721 startup
geometry again. Explicitly setting the logical content size after native
creation restores exactly 1120x720 without imposing a maximum.
The isolated native smoke then verified actual growth to 1360x960 and
restoration to 1120x720, matching WebView dimensions and no document-level
overflow at both sizes; maximize remained disabled and startup remained hidden.

WebDriver uses Tauri's programmatic size setter, which can bypass AppKit's
minimum-size restriction. An attempted below-minimum driver resize therefore
does not prove native border clamping; the final smoke tests growth and
restoration instead. Native pointer/trackpad resizing and minimum-bound
interaction still require foreground acceptance.

The exact staged candidate was also exported into a separate checkout,
excluding all unrelated ongoing UI, settings, and dependency edits. Its native
smoke, existing shell and IPC tests, scoped ESLint, both TypeScript projects,
Rust formatting, strict all-target/all-feature Clippy, and unsigned production
build passed with Node 24.21.0, cached pnpm 10.33.1, and one consistent
Homebrew Rust 1.99 toolchain. Shared installed dependencies/build caches were
reused; no dependency installation or production capability expansion occurred.
The known large-chunk and WDIO teardown warnings remain.

Runtime checks used disposable private HOME/preferences and no real
configuration or package/service mutations. User-owned working-tree changes
are not included in this revision. T103/T109 and all signing, notarization,
GitHub-hosted CI, hardware, and other manual gates remain open under NO-GO.

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

### UI correction v3 automated completion and manual blocker (2026-10-10)

T110–T123 implemented the approved UI correction sequence on
`chore/ui-correction-v3-t110`: functional System/Light/Dark; complete discovery
coverage and stale-snapshot retention; all catalog path-variant probes; shared
visual tokens and shell scroll ownership; Dashboard-first home-configuration
recognition; validated local Applications context; local/catalog Applications;
and completed Settings, Homebrew, Services and Applications/configuration
workspaces.

Automated evidence passed: 42 Vitest files / 196 tests; both TypeScript
projects; ESLint with one non-failing Dashboard Fast Refresh warning; Rust fmt,
strict Clippy, 93 library tests and 22 integration tests; one isolated-HOME
macOS WebView E2E; unsigned release build; 624-entry corpus validation; and
`git diff --check`. The E2E verified 1120×720 and 1360×960, no document-level
overflow on all five routes, Dashboard-first user-directory recognition,
local-to-catalog Applications navigation, exact 50-item catalog page, refresh
coalescing and unsigned-helper fail-closed behavior. No real configuration,
package or service mutation occurred.

T124 was attempted but remains **blocked, not passed**. This environment cannot
perform true foreground 200% text zoom, human visual inspection, VoiceOver,
composited contrast measurement or pointer/trackpad drag checks. It does not
substitute hidden E2E, viewport resizing or static token checks for those gates.
The full blocked matrix is in [`ui-correction-acceptance-v3.md`](ui-correction-acceptance-v3.md).
T103/T109 and every signing, notarization, hosted-CI, hardware and manual gate
remain open under the existing production NO-GO decision.
