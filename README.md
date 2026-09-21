# UserHome

A local-first macOS desktop and tray application for managing user application
configuration, Homebrew software, services, and basic machine capabilities.

The approved product specification is in [`SPEC.md`](SPEC.md), and implementation
tasks are tracked in [`tasks/todo.md`](tasks/todo.md).

## Requirements

- macOS 13 or newer
- Node.js 24.21.0
- pnpm 10.33.1
- Rust 1.95.0 with `rustfmt`, `clippy`, and Apple Silicon/Intel macOS targets

## Commands

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm tauri dev
pnpm lint
pnpm typecheck
pnpm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e
pnpm build:unsigned
pnpm tauri build --target universal-apple-darwin
```

`pnpm test:e2e` builds a dedicated debug binary with the embedded WebdriverIO
service and inspects the real macOS application window with an isolated
temporary `HOME`/`XDG_CONFIG_HOME`. The temporary home is removed after the
run, and the WDIO plugins and permissions are excluded from normal development
and production builds.

## 桌面韧性与可访问性

主窗口固定为居中的 1120 × 720 逻辑像素，禁止调整大小和最大化，并使用保留
macOS 原生 traffic lights 的 overlay title bar。紧凑导航栏、上下文工具栏、
主工作区和状态轨都在固定窗口内布局；长列表、编辑器和详情面板在各自区域滚动，
不会推动文档视口。关闭主窗口会隐藏到托盘，托盘 Open 会恢复并聚焦原窗口。

主界面在各模块独立加载时保持可用；loading、empty、partial、warning 和
error 状态使用可读文本与 ARIA live region，不以颜色作为唯一状态信号。
主导航、筛选、分页和确认流程使用原生键盘控件，路由切换后焦点移到主内容；
确认对话框捕获焦点、支持 Escape 取消，并在关闭后恢复原焦点。系统启用
`prefers-reduced-motion` 时会禁用非必要动画。自动化检查覆盖这些结构和行为，
但 VoiceOver、完整键盘流程、对比度、显示缩放以及图标/托盘的亮暗模式外观仍需
在真实 macOS 环境中人工验收。

最近一次操作始终显示在右侧状态轨，配置、Homebrew 或服务操作结束后会刷新；
关闭主窗口不会丢失当前路由或操作状态。托盘仅提供 Open、Refresh、Quit，
并显示后端观测到的应用检测数和服务运行数；摘要项不可点击，不能触发变更。

## Read-only discovery

UserHome discovers macOS metadata, approved catalog evidence, Homebrew
formulae/casks, and shallow unmanaged dot-directory candidates without reading
managed or candidate file contents. Homebrew is resolved only from
`/opt/homebrew/bin/brew` or `/usr/local/bin/brew`, commands use fixed argument
arrays with bounded output and timeouts, and module failures remain visible as
partial results.

Startup, the in-window Refresh button, and the tray Refresh action share one
coalesced backend scan. Homebrew inventory is paginated, while search and
package details use separately bounded commands and stable typed responses.

## Confirmed Homebrew and service operations

Formula and cask install, upgrade, and uninstall operations require an
expiring, intent-bound preview that identifies the action, package kind, and
validated identifier. Rust enums produce every argument array; UserHome does
not invoke a shell, accept arbitrary flags, request root privileges, or expose
environment-variable overrides. Operations are serialized, progress and final
output are bounded and redacted, and the inventory refreshes after success or
failure. A successful command followed by a failed refresh is reported as a
partial failure rather than success.

The Services page parses bounded `brew services list --json` output into
user/system/unknown scope. Caddy exposes start, stop, and restart with a
separate preview for each action. User-level actions remain unprivileged;
system-level actions require the signed, approved privileged helper. Unknown
services remain read-only. Caddyfile validity is displayed independently from
runtime state, restart is blocked unless validation succeeds, and operation
success requires the refreshed service state to match the requested outcome.

## Safe configuration management

Configuration access is authorized by the built-in Rust catalog. The frontend
can submit only `appId`, `configId`, and app-owned `backupId` values; it cannot
submit filesystem paths. Targets and symlinks are resolved under the configured
home or trusted Homebrew prefix and fail closed if resolution escapes that
root. `SENSITIVE` and `SECRET` documents expose metadata and hashes only until a
document-specific adapter can safely classify their fields.

Writes require a fresh content hash and an expiring operation preview. UserHome
validates bounded UTF-8 content, hides sensitive diffs, creates a mode `0600`
backup under a mode `0700` app-owned directory, preserves the target mode and
safe symlink, and atomically replaces the resolved file. Failed post-write
validation restores the exact previous bytes and permissions. Restore follows
the same preview, hash, validation, backup, and atomic replacement safeguards;
only the newest 20 recognized backups per catalog document are retained.

The Applications workspace currently exposes 15 catalog definitions: GitHub
Copilot, Caddy, Git, OpenSSH, Zsh, and npm are explicitly managed writable;
Visual Studio Code, Cursor, Ghostty, Starship, tmux, Vim, Zed, Neovim, and
iTerm2 are bounded managed read-only definitions. `MANAGED_READ_ONLY` entries
never expose preview, write, backup, restore, service, or elevation actions.
`DETECTED_UNSUPPORTED` and `EXCLUDED` candidates expose only safe classification
metadata (name, entry type, coverage class, and modification time); discovery
alone never authorizes opening or reading their contents.

All automated configuration tests use temporary fixture homes and never read or
modify live user configuration.

详细的备份位置、权限、保留与恢复规则见
[`docs/backup-and-restore.md`](docs/backup-and-restore.md)。新增受管应用必须遵循
[`docs/managed-app-schema.md`](docs/managed-app-schema.md) 的 schema、路径和审查约束。

## Controlled elevation

The macOS 13+ elevation boundary uses `SMAppService` with a bundled
LaunchDaemon. Requests contain only a protocol version, request/operation IDs,
catalog resource and enum action IDs, SHA-256 hashes, confirmation/issuance
times, and a bounded deadline. Paths, executable names, arguments, environments,
and configuration content are not part of the request contract; payload bytes
travel separately over authenticated XPC and are bound by `payloadHash`.

The daemon verifies the calling main app from its XPC audit token, checks the
app/helper Team ID and bundle identifiers, rejects replayed or stale requests,
maps resources and actions to a compiled allowlist, and writes sanitized audit
metadata. It never executes a Homebrew-managed binary as root. Unsigned builds,
unregistered helpers, denied approval, invalid signatures, and unavailable
bridges all report unavailable and fail closed. Automated tests use only the
fake transport and temporary fixtures; see
[`docs/elevation-checklist.md`](docs/elevation-checklist.md) for the signed
manual verification gate.

## 发布

Pull request 与手动 CI 均运行前端和 Rust 检查、macOS E2E 及 unsigned 构建；
只有 pull request 构建会把 unsigned 可执行文件作为保留 7 天的 GitHub Actions
artifact 上传。CI 不会创建 Release，也不会读取发布 secrets。只有匹配 `v*`
的 tag 会进入 `release` environment，且所有 Apple 签名/公证 secrets 必须存在，
否则工作流在导入证书或构建前失败。

标签工作流构建 `arm64`/`x86_64` universal helper 与 bridge，先签名嵌套二进制，
再由 Tauri 构建、签名并公证 universal app/DMG，校验签名、架构和 stapled ticket
后创建 **draft** GitHub Release。它不会自动发布正式 Release。完整步骤、secrets
与人工门禁见 [`docs/release.md`](docs/release.md)，当前证据和剩余阻塞见
[`docs/release-readiness.md`](docs/release-readiness.md)。
