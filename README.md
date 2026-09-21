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
service and inspects the real macOS webview through an isolated temporary
`HOME`/`XDG_CONFIG_HOME`. The E2E preference fixture keeps the native window
hidden, disables optional unknown-root discovery, and is removed with the
temporary home after the run. WDIO plugins and permissions are excluded from
normal development and production builds.

## 桌面韧性与可访问性

主窗口固定为居中的 1120 × 720 逻辑像素，禁止调整大小和最大化，并使用保留
macOS 原生 traffic lights 的 overlay title bar。紧凑导航栏、上下文工具栏、
列表/详情工作区都在固定窗口内布局；Dashboard 使用紧凑分组行展示本机、软件包、
连接、刷新和最近操作状态。长列表、编辑器、详情和检查器在各自区域滚动，不会
推动文档视口。关闭主窗口会按偏好隐藏到托盘或退出，托盘 Open 会恢复并聚焦
原窗口。

主界面在各模块独立加载时保持可用；loading、empty、partial、warning 和
error 状态使用可读文本与 ARIA live region，不以颜色作为唯一状态信号。
主导航、列表、筛选、分页和确认流程使用语义化键盘控件；路由切换不会抢走
当前导航焦点，列表以稳定 ID、方向键和 Home/End 维持选择与可见焦点。
确认对话框捕获焦点、支持 Escape 取消，并在关闭后恢复原焦点。系统启用
`prefers-reduced-motion` 时会禁用非必要动画。自动化检查覆盖这些结构和行为，
但 VoiceOver、完整键盘流程、对比度、显示缩放以及图标/托盘的亮暗模式外观仍需
在真实 macOS 环境中人工验收。

最近一次操作显示在 Dashboard 或相关详情窗格，配置、Homebrew 或服务操作结束
后会刷新；关闭主窗口不会丢失当前路由、Settings 分组或安全的稳定选择。原生
应用菜单提供 Settings、Refresh、Hide/Show 和 Quit，并由一个命令桥处理
`Command+,` 与 `Command+R`。托盘提供 Open、Refresh、Quit，并显示后端观测到
的应用检测数和服务运行数；摘要项不可点击，不能触发变更。

## Local settings

Settings 使用紧凑的七分组列表/详情工作区：Appearance、General、Refresh、
Configuration and Backups、Privacy and Discovery、Diagnostics、Reset。
偏好以版本化、原子替换的 JSON 保存在 UserHome 自有目录，严格拒绝未知字段和
任意路径；System/Light/Dark 会立即应用，生命周期、刷新、provider timeout、
编辑器模式和备份保留均使用有界枚举或预设。

隐私设置只能启用或禁用四个后端定义的 metadata-only discovery root ID，
不会授予或撤销 catalog 读写权限。备份清理需要预览与确认，偏好重置不会删除
备份或修改受管配置。诊断报告由后端白名单 DTO 构造，复制和导出都需要显式
操作，且不包含配置内容、secret、用户名、绝对 home、环境转储或授权材料。

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

The Applications workspace currently exposes 26 catalog definitions: GitHub
Copilot, Caddy, Git, OpenSSH, Zsh, and npm are explicitly managed writable;
Visual Studio Code, Cursor, Ghostty, Starship, tmux, Vim, Zed, Neovim, and
iTerm2, Claude, Codex, Gemini, Antigravity, Trae, Docker, Google Cloud CLI,
Raycast, GitKraken CLI, and Apifox are bounded managed read-only definitions.
OrbStack is explicitly excluded because its group container co-locates
configuration and runtime data without a stable settings-file contract.
`MANAGED_READ_ONLY` entries never expose preview, write, backup, restore,
service, or elevation actions. `DETECTED_UNSUPPORTED` and `EXCLUDED`
candidates expose only safe classification metadata (name, entry type,
coverage class, and modification time); discovery alone never authorizes
opening or reading their contents.

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
