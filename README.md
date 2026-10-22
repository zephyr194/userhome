# UserHome

UserHome 是一款本地优先的 macOS 桌面与托盘应用（Tauri 2 + React/TypeScript + Rust），
用于在当前用户权限下查看和维护本机的环境变量、Caddy 反向代理、launchd 用户服务、
应用与 AI 工具配置，并提供常用文本与二维码工具。应用不包含提权 helper，也不请求 root 权限。

界面导航分为三组：

| 分组 | 页面（路由） | 说明 |
|---|---|---|
| 系统工具 | 环境变量（`environment`） | 在指定目录中只读查看 dotenv 文件，秘密值默认遮盖；可编辑 zsh 环境块。 |
| 系统工具 | Caddy（`caddy`） | 检测 Caddy，编辑本机反向代理规则，并以自有实例运行；保存不会启动或重载 Caddy。 |
| 系统工具 | 应用配置（`appConfig`） | 按内置白名单只读查看应用配置，秘密值默认遮盖。 |
| 系统工具 | AI 配置（`aiConfig`） | 只读检测 Claude Code、Codex、Gemini 与 Copilot CLI 的安装状态、版本与配置位置；Claude Code 支持可视化编辑。 |
| 工具集 | 工具集（`tools`） | JSON 格式化、XML 校验与缩进、编解码、二维码生成；输入只保存在本次页面中。 |
| 支撑 | 概览（`dashboard`） | 掌握系统、配置、软件与服务的实时状态。 |
| 支撑 | 服务（`services`） | 发现并查看本机 launchd 用户域常驻任务，管理自建任务。 |
| 支撑 | 设置（`settings`） | 外观、通用、刷新、配置与备份、隐私与发现、诊断与重置。 |

“应用与配置”（`applications`）和“软件”（`homebrew`）已退出主导航，页面与代码保留但不再作为当前功能入口。

历史需求规格、能力图、实施计划和任务清单已清理。发布证据与未关闭的门禁保留在
[`docs/release-readiness.md`](docs/release-readiness.md)，清理文档不代表已通过生产发布验收。

## 文档导航

`docs/` 保留可维护的技术契约、操作指南和有日期的证据，不作为需求规格或任务清单。
需求规格、能力图、实施计划及 `skills-lock.json` 仅供本地使用，不纳入 Git 跟踪。

| 分类 | 文档 | 用途与维护边界 |
|---|---|---|
| 技术契约 | [application-profiles.md](docs/application-profiles.md) | 新只读应用定义、资源发现/读取 IPC 与排除规则；随只读入口变化维护，不授予旧 Catalog 的写入权限。 |
| 技术契约 | [managed-app-schema.md](docs/managed-app-schema.md) | 旧受管 Catalog 的扩展、Schema/预设、读写授权与兼容约束；随 Catalog 或编辑链路变化维护，与新只读定义分开。 |
| 技术契约 | [threat-model.md](docs/threat-model.md) | 只读入口、提权和分发的信任边界、失败行为及残余风险；权限或信任边界变化时更新，不代替安全验收。 |
| 操作指南 | [backup-and-restore.md](docs/backup-and-restore.md) | 配置备份位置、权限、保留与清理，以及无应用内恢复时的手动取回步骤；随备份/清理行为变化维护。 |
| 操作指南 | [release.md](docs/release.md) | CI、标签构建、签名、公证、草稿发布和回滚流程；随工作流变化维护，不代表门禁已通过。 |
| 操作指南 | [elevation-checklist.md](docs/elevation-checklist.md) | 已作废：提权 helper 已移除（G3-9），仅保留历史验证记录，不再执行。 |
| 发布台账 | [release-readiness.md](docs/release-readiness.md) | 带日期的实测证据、发布决定、剩余阻塞与门禁；追加新证据，不把历史通过结果视为当前版本已通过。 |
| 历史证据 | [home-baseline-coverage.md](docs/home-baseline-coverage.md) | 基线导出统计口径及 T53–T60 分类/覆盖率快照；不代表当前机器状态，也不授权扩大扫描或读写范围。 |
| 历史证据 | [ui-correction-acceptance-v3.md](docs/ui-correction-acceptance-v3.md) | UI v3 自动化证据和未完成的人工矩阵；保留当时结论，不作为当前 UI 规格。 |

操作步骤与验收结果分开维护：流程变更更新指南，实际执行结果记录日期、版本和环境。
历史记录中的应用数量、窗口条件和 T 编号只用于追溯，不覆盖当前实现契约；
需要实测的签名、前台交互及辅助技术门禁不能由文档或自动化结果代替。

## Requirements

- macOS 13 或更新版本（`minimumSystemVersion` 为 13.0）
- Node.js 24.21.0（`package.json` 的 `engines`）
- pnpm 12.11.2（`packageManager` 与 `engines` 固定；使用 `corepack enable` 获取）
- Rust 1.95.0（`rust-toolchain.toml`），需包含 `rustfmt`、`clippy` 以及 Apple Silicon/Intel macOS 目标

## Commands

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm tauri dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:rust
pnpm test:e2e
pnpm build:unsigned
pnpm tauri build --target universal-apple-darwin
```

- `pnpm lint`、`pnpm typecheck`、`pnpm test`（Vitest）和 `pnpm build` 是前端的日常检查；
  `pnpm build` 先执行类型检查再构建 Vite 产物。
- `pnpm check:rust` 依次执行 `cargo fmt --check`、`cargo clippy --all-targets --all-features -D warnings`
  与 `cargo test`，即 `src-tauri/` 的完整 Rust 门禁。`pnpm check` 汇总前端与 Rust 检查。
- `pnpm test:e2e` 构建带嵌入式 WebdriverIO 服务的调试二进制，并在隔离的临时
  `HOME`/`XDG_CONFIG_HOME` 中检查真实 macOS WebView。E2E 偏好夹具会隐藏原生窗口、
  关闭可选的未知根发现，并在运行结束后随临时目录删除。WDIO 插件与权限不进入日常开发或正式构建。

### Rust 测试的已知限制

部分受管 Mac 上，本机安全软件可能终止并移入废纸篓 Rust 测试二进制，导致 `cargo test` 与
`pnpm check:rust` 的测试步骤无法得出有效结果。此类环境应在 CI 或其他机器上运行 Rust 测试；
本机仍可运行 `cargo fmt --check` 与 `clippy` 编译检查。

## 前端约定

表单元素的唯一入口是 `src/components/ui/forms`，业务代码不得直接使用原生 `input`、`select`、`textarea`、`option`；ESLint 与 `nativeControlAudit` 测试会拦截这类用法。

## 桌面韧性与可访问性

主窗口以居中的 1120 × 720 逻辑像素启动，最小尺寸同为 1120 × 720；
允许通过原生边框放大和缩回最小尺寸，仍禁止最大化和全屏，并使用保留
macOS 原生 traffic lights 的 overlay title bar。紧凑导航栏、上下文工具栏、
列表/详情工作区随窗口尺寸布局；概览页以面板展示服务、关注事项、软件与服务（Homebrew 计数与
后台进程）以及最近活动。长列表、编辑器、详情和检查器在各自区域滚动，不会
推动文档视口。标题文字和空白标题栏区域可拖动窗口；按钮、字段、菜单、列表行、
编辑器、滚动区域和对话框显式为 no-drag，双击标题栏不会改变窗口尺寸或位置。
关闭主窗口会按偏好隐藏到托盘或退出，托盘 Open 会恢复并聚焦原窗口。

主界面在各模块独立加载时保持可用；loading、empty、partial、warning 和
error 状态使用可读文本与 ARIA live region，不以颜色作为唯一状态信号。
主导航、列表、筛选、分页和确认流程使用语义化键盘控件；路由切换不会抢走
当前导航焦点，列表以稳定 ID、方向键和 Home/End 维持选择与可见焦点。
确认对话框捕获焦点、支持 Escape 取消，并在关闭后恢复原焦点。系统启用
`prefers-reduced-motion` 时会禁用非必要动画。自动化检查覆盖这些结构和行为，
但 VoiceOver、完整键盘流程、对比度、显示缩放以及图标/托盘的亮暗模式外观仍需
在真实 macOS 环境中人工验收。

最近一次操作显示在概览或相关详情窗格，服务操作结束后会刷新；关闭主窗口不会
丢失当前路由、Settings 分组或安全的稳定选择。原生应用菜单提供 Settings、Refresh、Hide/Show 和 Quit，并由一个命令桥处理
`Command+,` 与 `Command+R`。托盘提供 Open、Refresh、Quit，并显示后端观测到
的应用检测数和服务运行数；摘要项不可点击，不能触发变更。

## Local settings

Settings 使用紧凑的七分组列表/详情工作区：外观、通用、刷新、配置与备份、隐私与发现、
诊断、重置。偏好以版本化、原子替换的 JSON 保存在应用自有目录，严格拒绝未知字段和
任意路径。备份保留数量可选 5、10 或 20 个（默认 20）。

隐私设置只能启用或禁用后端定义的 metadata-only discovery root ID，
不会授予或撤销读写权限。备份清理需要预览与确认，偏好重置不会删除
备份或修改受管配置。诊断报告由后端白名单 DTO 构造，复制和导出都需要显式
操作，且不包含配置内容、secret、用户名、绝对 home、环境转储或授权材料。

## 只读发现

概览与应用配置只读取已登记的元数据和资源，不读取未授权的候选文件正文。Homebrew 只从
`/opt/homebrew/bin/brew` 或 `/usr/local/bin/brew` 解析，命令使用固定参数数组、有界输出和超时；
模块失败会作为部分结果保留可见。启动、窗口内刷新和托盘刷新共享一次合并的后端扫描。

## Caddy 与服务

Caddy 页面运行的是 UserHome 自有实例：使用 `caddy run`，通过私有 Unix admin socket 管理，
不占用默认的 `localhost:2019`。停止只通过应用持有的会话句柄完成（先 SIGTERM，超时后
SIGKILL），不调用 `caddy stop`。Caddy 工作目录由用户在界面中选择，默认建议 `~/.caddy`。

服务页面解析 launchd 用户域（`~/Library/LaunchAgents`）中的常驻任务，支持启动、停止、
创建、编辑、接管与查看日志；只管理 UserHome 自建任务的生命周期。

## 授权与写入

涉及用户文件的入口都先由用户在系统对话框中选择路径，选择动作由后端发起。授权记录保存在
应用自有目录的 `grants.json` 中（目录 0700、文件 0600），前端只提交授权 ID，不提交任意路径。
授权按用途隔离：Shell 启动文件、LaunchAgent 新建文件、TLS 材料与 Caddy 工作目录各自只能
由对应入口使用。写入类操作先生成带期限的预览，确认后执行。

受管配置的备份位于 `~/Library/Application Support/UserHome/backups`，权限、保留与清理规则，以及手动取回说明见
[`docs/backup-and-restore.md`](docs/backup-and-restore.md)。授权根与信任边界见
[`docs/threat-model.md`](docs/threat-model.md)。

旧的受管 Catalog 写入链路仍保留在后端，但其页面（“应用与配置”）已退出主导航。新增受管应用
必须遵循 [`docs/managed-app-schema.md`](docs/managed-app-schema.md) 的 schema、路径和审查约束。

## 已退出主导航的旧功能

“软件”（Homebrew）页面已退出主导航，其代码与测试保留。概览中的 Homebrew 计数仍随
只读发现展示。旧的 Homebrew 安装、升级与卸载流程不再是当前入口。

## 提权边界（已移除）

提权 helper、LaunchDaemon 与 Swift bridge 已于 G3-9 从应用中移除。应用不再请求
root 权限，不包含 `SMAppService` 注册或 XPC 通信，Homebrew、配置与服务操作均以
当前用户权限执行。历史设计与人工验证记录仅作证据保留，见
[`docs/elevation-checklist.md`](docs/elevation-checklist.md)。

## 已知限制

- Rust 测试的限制见上文 [Rust 测试的已知限制](#rust-测试的已知限制)。
- 真机验收尚未完成：Caddy 真实运行、launchd 真实操作、VoiceOver、完整键盘流程、对比度、
  显示缩放，以及托盘和图标的亮暗外观。[`docs/caddy-acceptance.md`](docs/caddy-acceptance.md)
  中的步骤均为“未执行”，结论见 [`docs/release-readiness.md`](docs/release-readiness.md)。
- `e2e/smoke.spec.ts` 仍通过 `a[href='#homebrew']` 等已退出主导航的入口断言，本文档任务未在当前导航下运行该冒烟。

## 发布

Pull request 与手动 CI 均运行前端和 Rust 检查、macOS E2E 及 unsigned 构建；
只有 pull request 构建会把 unsigned 可执行文件作为保留 7 天的 GitHub Actions
artifact 上传。CI 不会创建 Release，也不会读取发布 secrets。只有匹配 `v*`
的 tag 会进入 `release` environment，且所有 Apple 签名/公证 secrets 必须存在，
否则工作流在导入证书或构建前失败。

标签工作流由 Tauri 构建、签名并公证 `arm64`/`x86_64` universal app/DMG，校验 app 签名与 stapled ticket，
后创建 **draft** GitHub Release。它不会自动发布正式 Release。完整步骤、secrets
与人工门禁见 [`docs/release.md`](docs/release.md)，当前证据和剩余阻塞见
[`docs/release-readiness.md`](docs/release-readiness.md)。
