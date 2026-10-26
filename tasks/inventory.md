# T-0 基线与清理盘点

盘点日期：2026-10-15（本机时区 UTC+08:00）。基线版本：`bf95a84`，分支 `main`；开始时 `git status --short` 为空。平台：Darwin 27.0.0（macOS），shell：zsh；版本要求来自 `package.json`（Node 24.21.0、pnpm 12.11.2），未将要求版本当作本机实测版本。

**状态：盘点与四项基线均已完成。** worker 与协调器运行 `pnpm check:rust` 均被权限检查拒绝，未绕过；由用户在终端手动运行并回传结果（见 2.2），已补入基线表。本文件不构成 G-3 的删除批准。

## 1. 范围、口径与只读边界

- 依据：`tasks/todo.md` 的 T-0 描述与验收、`tasks/plan.md`、`SPEC.md` 第 9 节。只调用 `/build`（单任务 T-0）；未调用其余技能。
- 唯一主动写入的任务产物为本文件；未修改源码、规格、`.gitignore` 或 `tasks/todo.md`，未暂存、提交或推送。检查工具可能使用自身的忽略缓存；没有执行安装、服务启动或真实配置操作。
- **保留**：保留其职责与现有证据，不表示无需后续回归；**重做**：现有实现与目标契约有差距，替换前保留；**待移除**：候选退出项，仍须 G-3 逐项批准，当前不删除。
- 下列证据为仓库内实际执行的 `rg -n`（ripgrep，grep 等价检索）或 `git grep -nE/-nF`，计数统一为**命中行数**，不是符号引用次数、文件数或调用次数。查询覆盖的内部声明、测试引用与外部引用均按注明范围计入；共享证据 ID 不代表每个文件各有该数量的外部调用。无命中单列为 0，不据此直接删除。
- 命令以仓库根为工作目录。可将证据表的命令原样执行查看位置，后接 `| wc -l` 复核命中行数；表内代表位置是抽查锚点，不是完整引用集。不要把 Markdown 表格中的 `\|` 转义反斜杠带入正则。
- 相关测试栏表示**已有测试位置**，不是本次均已通过：本次基线含前端 Vitest 与（用户回传的）Rust 测试；E2E、真实签名/helper、Caddy 与 launchd 均未执行。没有新增或修改测试。
- 旧页面与其底层依赖的“保留”默认指**替换前过渡保留**，不等于 G-3 最终保留：CORE-1/2 移除主导航入口并不自动授权删除文件；FIN-1/2 必须重查引用并取得逐项裁决。
- 未读取真实 `~/.claude`、`~/.codex`、`~/.copilot`、`~/.gemini` 或其凭据；文中这些名称仅来自仓库代码/文档。未运行 `pnpm test:e2e`、`pnpm build:*`、`pnpm corpus:*`、`pnpm tauri *`，未删除任何候选文件。

## 2. 基线结果（按要求顺序，仅运行一次）

| 命令 | 本地日期／开始—结束 | 结果／退出码 | 通过／失败数量 | 原始异常或说明 |
|---|---|---|---|---|
| `pnpm lint` | 2026-10-15 17:05:25—17:05:36 +0800 | 通过，0 | 检查命令 1 通过／0 失败；ESLint 0 errors、1 warning；不提供测试数 | `src/features/dashboard/DashboardPage.tsx:340:17`，原文见下方 |
| `pnpm typecheck` | 2026-10-15 17:05:46—17:05:53 +0800 | 通过，0 | 2 次 `tsc` 调用通过／0 失败，0 条诊断；不提供测试数 | `tsc --noEmit && tsc --noEmit --project tsconfig.node.json` |
| `pnpm test` | 2026-10-15 17:06:07—17:06:10 +0800 | 通过，0 | 46 个测试文件通过／0 失败；220 项测试通过／0 失败 | Vitest v5.0.1，Duration 2.11s，未报告 skipped |
| `pnpm check:rust` | 2026-10-15，用户在终端手动运行（无起止时间戳；使用 `CARGO_NET_OFFLINE=true USERHOME_HELPER_PREBUILT=1`） | 通过（回传输出末尾无失败；退出码未单独回传） | fmt 检查通过、Clippy（`-D warnings`）通过；cargo test 共 126 项通过／0 失败：lib 103、`tests/catalog.rs` 12、`tests/ipc_contract.rs` 4、`tests/operations.rs` 5、`tests/tray.rs` 2、main 与 doc-tests 均 0 项 | 来源为用户回传的终端输出，非 worker 实测；worker/协调器两次尝试均被权限层拒绝，见 2.2 |

### 2.1 原始 warning 与测试汇总

ESLint 输出（原文；保留已存在的 warning，不修复）：

```text
/Users/archie.zheng/JustDoIt/Community/userhome/src/features/dashboard/DashboardPage.tsx
  340:17  warning  Fast refresh only works when a file only exports components. Use a new file to share constants or functions between components  react-refresh/only-export-components

✖ 1 problem (0 errors, 1 warning)
```

Vitest 汇总（原文）：

```text
 Test Files  46 passed (46)
      Tests  220 passed (220)
   Start at  17:06:08
   Duration  2.11s (import 72%, transform 18%, tests 5%, setup 3%, worker 1%)
```

### 2.2 Rust 基线的取得过程（先被阻塞，后由用户运行）

最终结果：用户于 2026-10-15 在终端运行 `CARGO_NET_OFFLINE=true USERHOME_HELPER_PREBUILT=1 pnpm check:rust`，fmt、Clippy 通过，126 项 cargo test 全部通过（明细见 2 节表格）。以下为此前 worker 尝试被拒绝的原始记录，保留以备追溯，不是测试失败。

`package.json:25` 的原始脚本为：

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml
```

只读检查发现 `src-tauri/build.rs:10-25`：未设置 `USERHOME_HELPER_PREBUILT` 时会调用 `scripts/build-helper.sh`；该脚本会写入 helper 的 `.build/` 与 `dist/`。现有 `src-tauri/helper/dist/UserHomeHelper`（399136 bytes）、`libUserHomeHelperBridge.dylib`（429088 bytes）均存在，仅检查存在与文件大小，未执行或改写。为避免额外 helper 构建与网络解析而附加上述离线/预编译环境变量，但整条 Bash 调用被执行前拒绝，**fmt、Clippy、cargo test 均未开始**。

权限拒绝原文：

```text
Permission for this action was denied by the Claude Code auto mode classifier. Reason: Blocked by fast classifier.
```

已向协调器上报；协调器回复：

> 不要绕过该拒绝，也不要换其他方式运行 Rust 检查。继续完成只读盘点，在基线表里把 pnpm check:rust 记为“未执行（权限被拒绝）”，并在 worker_done 中说明；不要勾选 T-0。Rust 基线由用户另行决定。

未以历史 `docs/release-readiness.md` 结果替代当前 Rust 基线，也未重复执行前三条命令。

## 3. 共享边界候选（明确文件，不扩大实现）

| ID | 文件 | 候选处置与理由／退出条件 | 引用证据 | 相关测试 | 相关文档 |
|---|---|---|---|---|---|
| B01 | `src/app/AppShell.tsx` | 保留壳层，导航由 CORE-1 改造，不整体移除 | EB01：13 行；`src/App.tsx:9,285` | `src/app/AppShell.test.tsx` | `SPEC.md §9`、`tasks/plan.md` |
| B02 | `src/app/routeDefinitions.ts` | 重做平面 applications/homebrew 入口，保留类型安全导航职责与旧 ID 兼容 | EB02：11 行；`src/app/routes.tsx` | `src/app/AppShell.test.tsx`、`src/app/selectionMemory.test.ts` | `SPEC.md §9`、CORE-1/2 |
| B03 | `src/components/NavigationRail.tsx` | 保留并改造分组，不移除键盘与焦点行为 | EB03：2 行；`src/app/AppShell.tsx` | `src/app/AppShell.test.tsx` | `SPEC.md §9`、CORE-1 |
| B04 | `src/components/ui/index.ts` | 保留共享 UI 导出边界，不随旧应用页面删除 | EB04：57 行；`src/features/services/ServiceActionDialog.tsx:2` | `src/components/ui/ui.test.tsx`、`src/components/ui/forms/forms.test.tsx` | `SPEC.md §9`、CORE-11 |
| B05 | `src/ipc/core.ts` | 保留错误解码与 invoke 边界，不随各旧命令封装删除 | EB05：43 行；`src/ipc/config.ts` 等 | `src/ipc/core.test.ts` | `SPEC.md §9`、`docs/threat-model.md` |
| B06 | `src-tauri/src/config/write.rs` | 保留并抽取可复用事务；现实现依赖 Catalog，不直接承诺新授权资源可用 | EB06：16 行（write/backup 共享查询）；`src-tauri/src/config/restore.rs:14`、`commands/config.rs:30` | 文件内 3 项测试（原子权限/链接、stale hash、写后校验恢复，未执行） | `docs/backup-and-restore.md`、CORE-6/7 |
| B07 | `src-tauri/src/config/backup.rs` | 保留备份/保护模式职责，抽离 ConfigEnvironment 耦合后才供新资源复用 | EB06：16 行（write/backup 共享查询）；`commands/config.rs:21`、`config/retention.rs:7` | 文件内保护模式与链接越界测试（未执行） | `docs/backup-and-restore.md`、CORE-6/7 |
| B08 | `src-tauri/src/operations/mod.rs` | 保留事务与预览职责，后续接入真正可终止的进程会话，不沿用“状态即取消”保证 | EB08：10 行；`lib.rs:32,133-135` | `src-tauri/tests/operations.rs`（5 项，未执行） | CORE-9、`SPEC.md §9` |
| B09 | `src-tauri/src/operations/store.rs` | 重做真实取消与总量上限；`store.rs:161-178` 运行中取消只变成 Cancelling，不证明进程终止 | EB07：7 行；`operations/mod.rs:1,15,134,140` 与集成测试 | `src-tauri/tests/operations.rs`（5 项，未执行） | CORE-9、`SPEC.md §9` |

### 3.1 共享边界证据命令

| 证据 | 已执行命令 | 命中行数／范围 |
|---|---|---|
| EB01 | `rg -n 'AppShell' src/App.tsx src/app/AppShell.test.tsx` | 13；入口 2 行与测试 11 行 |
| EB02 | `rg -n 'APP_ROUTES\|routeDefinitions' src/app src/components/NavigationRail.tsx src/features/dashboard` | 11；声明与使用，含测试 |
| EB03 | `rg -n 'NavigationRail' src/app/AppShell.tsx src/app/AppShell.test.tsx` | 2；壳层导入与渲染 |
| EB04 | `rg -n 'from .+ui\|from .+/ui' src/app src/features --glob '!*.test.*'` | 57；共享 UI 导入行，非单个组件调用数 |
| EB05 | `rg -n 'invokeCommand' src/ipc/config.ts src/ipc/services.ts src/ipc/brew.ts src/ipc/catalog.ts src/ipc/discovery.ts src/ipc/settings.ts` | 43；导入与调用均计入 |
| EB06 | `rg -n 'config::(write\|backup)\|write::\|backup::' src-tauri/src --glob '!write.rs' --glob '!backup.rs'` | 16；排除目标文件，包含其他文件内测试 |
| EB07 | `rg -n 'OperationStore\|mod store' src-tauri/src/operations/mod.rs src-tauri/tests/operations.rs` | 7；mod/export/coordinator 与集成测试 |
| EB08 | `rg -n 'operations::\|OperationStore' src-tauri/src/lib.rs src-tauri/src/commands src-tauri/src/brew/actions.rs` | 10；命令与注册依赖 |

## 4. 旧适配器与服务候选

以下服务项不能仅删除 `"caddy"` 条件放开权限：必须先落地归属、授权、只读快照与会话运行器，再按 G-3 批准迁移。

| ID | 文件 | 候选处置与已核事实 | 引用证据 | 相关测试 | 相关文档 |
|---|---|---|---|---|---|
| A01 | `src-tauri/src/config/adapters/copilot.rs` | 重做；`banner: Option<bool>`、`reasoning_effort` 映射 `reasoningEffort`，同时允许 `copilot-config` 结构写入。保留脱敏/未知字段用例，契约由 AI-12 裁决，不自动改真实配置 | EA01：4 行；`adapters/mod.rs:28,55,73` | 文件内 preserves_unknown_keys_and_redacts_secret_values、raw_edit_restores_redacted_unknown_secret、mcp_environment_values_are_never_exposed（未执行） | `docs/application-profiles.md`、`docs/managed-app-schema.md`、AI-12/13 |
| A02 | `src-tauri/src/config/adapters/caddy.rs` | 重做；`first_site_range_ref:89-103` 用首个块与花括号计数，不能视为完整 Caddyfile 解析；复杂未知内容保留原文 | EA02：3 行；`adapters/mod.rs:29,77` | 文件内 4 项测试；`src/features/apps/editors/CaddyEditor.test.tsx`（前端已覆盖） | `SPEC.md §9`、CAD-1/2、`docs/managed-app-schema.md` |
| S01 | `src-tauri/src/services/mod.rs` | 保留模块边界，内部发现/动作实现重做 | ES01：17 行；`lib.rs:14,34,124-127` | inventory/actions.rs 内测试；前端服务测试 | SVC-1…8、`docs/threat-model.md` |
| S02 | `src-tauri/src/services/inventory.rs` | 重做；只从 Brew ServicesList 获取，Caddy 才补 config/package、才 manageable，`service_scope:209` 还将 Caddy 当 User 回退；不能当通用 launchd 发现 | ES02：9 行；`commands/services.rs:21,63` | 文件内 3 项测试（scope、malformed JSON、system Caddy elevation）；`src/features/services/ServicesPage.test.tsx` | SVC-1/3/8、`SPEC.md §9` |
| S03 | `src-tauri/src/services/actions.rs` | 重做；`validate_action:120` 与 `execute_action:130` 只允许 caddy，动作委托 BrewCommand | ES03：40 行；`commands/services.rs`、`lib.rs:34`、`security/elevated_actions.rs:1` | success_requires_the_expected_refreshed_state；ServiceActionDialog.test.tsx | SVC-3/5、`docs/threat-model.md` |
| S04 | `src-tauri/src/commands/services.rs` | 重做；重启前 Caddyfile 校验，user Brew/system helper 分支及 Caddy 文案需替换；不能顺带给系统任务开放动作 | ES04：6 行；`lib.rs:124-127` | `src-tauri/tests/ipc_contract.rs`；前端 ServiceActionDialog.test.tsx | SVC-1/3/5、`SPEC.md §9` |
| S05 | `src/features/services/ServicesPage.tsx` | 重做通用任务列表；保留稳定选择/刷新职责 | ES05：6 行；`src/app/routes.tsx` | ServicesWorkspace.test.tsx | SVC-2、`docs/release-readiness.md`（历史证据） |
| S06 | `src/features/services/ServiceDetails.tsx` | 重做 Caddyfile/可管理详情假设，保留可见错误与只读限制 | ES06：14 行；ServicesPage.tsx 与测试 | ServicesPage.test.tsx、ServicesWorkspace.test.tsx | SVC-2/3、`docs/threat-model.md` |
| S07 | `src/features/services/ServiceActionDialog.tsx` | 重做动作目标/预览与真实取消衔接，保留显式确认 | ES07：8 行；ServiceDetails.tsx 与测试 | ServiceActionDialog.test.tsx、ServicesWorkspace.test.tsx | SVC-5、CORE-9 |
| S08 | `src/ipc/services.ts` | 重做通用服务 DTO 与快照契约，保持运行时解码 | ES08：6 行；前端服务模块与 routes.tsx 导入 | ServicesPage.test.tsx、ServiceActionDialog.test.tsx | SVC-1/8、`SPEC.md §9` |

### 4.1 适配器与服务证据命令

| 证据 | 已执行命令 | 命中行数／范围 |
|---|---|---|
| EA01 | `rg -n 'copilot::\|pub mod copilot' src-tauri/src/config/adapters/mod.rs` | 4；模块声明与 inspect/raw/structured 分发 |
| EA02 | `rg -n 'caddy::\|pub mod caddy' src-tauri/src/config/adapters/mod.rs` | 3；模块声明与 inspect/structured 分发 |
| ES01 | `rg -n 'services::\|pub mod services\|super::inventory' src-tauri/src/lib.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/services.rs src-tauri/src/services/actions.rs src-tauri/src/security/elevated_actions.rs` | 17；声明、注册、类型引用，含 actions.rs 内测试 |
| ES02 | `rg -n 'list_services as load_services\|get_service as load_service\|caddy_config_validity\|services::inventory' src-tauri/src/commands/services.rs src-tauri/src/settings/diagnostics.rs src-tauri/src/services/actions.rs` | 9；消费 inventory 的代码/测试行 |
| ES03 | `rg -n 'ServiceActionCoordinator\|execute_action\|validate_action\|verify_refreshed_state\|ServiceAction' src-tauri/src/commands/services.rs src-tauri/src/lib.rs src-tauri/src/security/elevated_actions.rs` | 40；动作消费者，包括 elevated_actions.rs 内测试 |
| ES04 | `rg -n 'commands::services::\|pub mod services' src-tauri/src/lib.rs src-tauri/src/commands/mod.rs` | 6；模块声明及四个命令注册 |
| ES05 | `rg -n 'ServicesPage' src/app/routes.tsx src/features/services/ServicesWorkspace.test.tsx` | 6；路由与工作区测试 |
| ES06 | `rg -n 'ServiceDetails' src/features/services/ServicesPage.tsx src/features/services/ServicesPage.test.tsx src/features/services/ServicesWorkspace.test.tsx` | 14；页面与详情测试 |
| ES07 | `rg -n 'ServiceActionDialog' src/features/services/ServiceDetails.tsx src/features/services/ServiceActionDialog.test.tsx src/features/services/ServicesWorkspace.test.tsx` | 8；详情与测试 |
| ES08 | `rg -n 'ipc/services' src/features/services src/app/routes.tsx` | 6；导入行，包含测试 |

## 5. 系统 helper 与设置入口候选

**重要现状**：`src/ipc/elevation.ts` 声明了 status/register/unregister 包装，但排除该文件后的前端引用查询为 **0 行**；`DiagnosticsSettings.tsx:155-169` 只是显示 helper 诊断状态。后端仍注册真实 register/unregister 命令，Swift bridge 有 `SMAppService.daemon(...).register()/unregister()`，不能把“没有 UI 调用”误写成“后端不可达”或“已禁用”。新目标不要求系统提权，去留须专门裁决，绝不实际注销本机 helper。

helper 测试简称：**HT** = `src-tauri/src/security/elevation_protocol.rs` 内 3 项协议测试、`elevation_fake.rs` 内 fake 成功/拒绝/超时/篡改测试、`elevated_actions.rs` 内 partial failure 测试、`elevation_macos.rs` 内 unsigned fail-closed 测试；Rust 本次均未执行。**HE** = `e2e/smoke.spec.ts:389-424` fake roundtrip 与 unsigned status，存在但本次未运行。**HD** = `docs/elevation-checklist.md`、`docs/threat-model.md`、`docs/release-readiness.md`；签名/helper 实测仍须另行批准。

| ID | 文件 | 候选处置与理由／退出条件 | 引用证据 | 相关测试 | 相关文档 |
|---|---|---|---|---|---|
| H01 | `src-tauri/helper/.gitignore` | 保留构建产物忽略规则；是否移除 helper 尚未批准，不改规则 | EH01：2 行与 EH18：2 行；实际忽略 dist 与 .build | 无专用测试；构建忽略规则静态核对 | HD、`src-tauri/scripts/build-helper.sh` |
| H02 | `src-tauri/helper/Package.swift` | 待移除候选；仅在 helper 整体退出获批后连同构建接线处理 | EH02：3 行；`build.rs:4`、build-helper.sh:28,37 | 无 Swift 测试 target；HT 不能代替 Swift 实测 | HD、`docs/release.md` |
| H03 | `src-tauri/helper/Bridge/UserHomeHelperBridge.swift` | 待移除候选；SMAppService 注册/XPC bridge，退出需同步 Rust 与 bundle/签名接线 | EH03：9 行；build-helper.sh:56、tauri.conf.json:24、elevation_macos.rs:10 | HT/HE；无直接 Swift 自动测试 | HD、`docs/release.md` |
| H04 | `src-tauri/helper/LaunchDaemons/com.zephyr194.userhome.helper.plist` | 待移除候选；仅随 helper bundle 退出，不执行系统卸载 | EH04：2 行；tauri.conf.json:29、bridge:7 | HE 仅 unsigned，不证明 plist 注册 | HD |
| H05 | `src-tauri/helper/Sources/UserHomeHelper/main.swift` | 待移除候选；Swift 可执行目标隐式 main 入口，XPC/审计仍在，退出需保留历史审计证据 | EH05：4 行目标声明；Package.swift:8,11-12；main.swift:12 XPC 入口 | 无直接 Swift 自动测试；HT/HE 为替代路径非实测 | HD |
| H06 | `src-tauri/helper/Sources/UserHomeHelper/Operations.swift` | 待移除候选；固定 root Caddyfile 与 system/homebrew.mxcl.caddy 操作不属于新按需 Caddy 会话 | EH06：1 行；main.swift:46 调用 perform | 无直接 Swift 自动测试；HT/HE 不执行真实操作 | HD、CAD-3/4 |
| H07 | `src-tauri/helper/Sources/UserHomeHelper/Protocol.swift` | 保留安全协议证据直到 helper 裁决；若整体退出，再批准迁移/移除；不得放宽两项资源 allowlist | EH07：10 行；main.swift:41,43,55；Operations.swift 类型引用 | HT（Rust 协议夹具，不证明 Swift 相容性实测） | HD |
| H08 | `src-tauri/helper/Sources/UserHomeHelper/Signing.swift` | 保留签名/客户端身份拒绝边界直至 helper 裁决，不能先移除校验 | EH08：3 行；main.swift:17、bridge:98,176 | 无独立 Swift 测试；签名关系仅人工清单，未执行 | HD、`docs/release.md` |
| H09 | `src-tauri/src/commands/elevation.rs` | 待移除候选；现有后端状态/注册/注销仍公开，确认标志检查与 e2e fake 分支需随整链裁决 | EH09：5 行；lib.rs:129-132、commands/mod.rs:6 | HT/HE；未见直接 register/unregister 命令单元测试 | HD |
| H10 | `src-tauri/src/security/elevation.rs` | 保留协调器/完整性拒绝边界至裁决，不把其当新通用系统操作接口 | EH10：11 行；commands/config.rs:43、services.rs:12、lib.rs:35 | HT 的 fake coordinator 使用 | HD |
| H11 | `src-tauri/src/security/elevation_fake.rs` | 保留隔离测试证据；测试替代实现不应先删以掩盖实测缺口 | EH11：2 行；commands/elevation.rs:84、elevated_actions.rs:62 | 文件内 fake transport 测试；HE（未执行） | HD |
| H12 | `src-tauri/src/security/elevation_macos.rs` | 待移除候选；真实 bridge transport/status/register 接线随 helper 决策，不能独立删除造成悬空 | EH12：6 行；commands/settings.rs:16、commands/elevation.rs:6、lib.rs:36 | unsigned_build_cannot_claim_helper_availability；诊断 Rust 测试；HE | HD |
| H13 | `src-tauri/src/security/elevation_protocol.rs` | 保留 request/response/replay/allowlist 拒绝测试证据至整链裁决；常量仅两类 Caddy 资源 | EH13：8 行；elevation.rs、elevated_actions.rs、catalog/mod.rs:770 | 文件内 3 项协议测试（未执行） | HD、`docs/managed-app-schema.md` |
| H14 | `src-tauri/src/security/elevated_actions.rs` | 待移除候选；受保护配置写入和系统 Caddy 动作接线将由新只读/自有进程契约替代 | EH14：3 行；commands/config.rs、services.rs、elevation.rs | 文件内 failure/success fake 测试（未执行） | HD、SVC-3、CAD-4 |
| H15 | `src/ipc/elevation.ts` | 待移除候选；存在 3 个封装声明但无其他前端引用，需先确认后端/HE 契约是否仍保留 | EH15：3 行；EH16：0 行 | 无独立前端 elevation.test；HE 使用底层 invoke（未执行） | HD |
| H16 | `src/features/settings/DiagnosticsSettings.tsx` | 重做其中 helper 诊断行，保留其余诊断能力；无注册/注销按钮，不整体删除设置页 | EH17：4 行 report.helper；EH16：0 个封装调用 | `src/features/settings/SettingsPage.test.tsx`（不是注册行为测试）、Rust diagnostics.rs 夹具（未执行） | HD、FIN-3 |

### 5.1 helper 证据命令

| 证据 | 已执行命令 | 命中行数／范围 |
|---|---|---|
| EH01 | `git check-ignore -v src-tauri/helper/dist/UserHomeHelper src-tauri/helper/.build/userhome-helper` | 2；ignore 规则证据（不是源码调用） |
| EH02 | `rg -n 'helper/Package.swift\|--package-path' src-tauri/build.rs src-tauri/scripts/build-helper.sh` | 3；manifest 构建引用 |
| EH03 | `rg -n 'UserHomeHelperBridge.swift\|libUserHomeHelperBridge' src-tauri/scripts/build-helper.sh src-tauri/build.rs src-tauri/tauri.conf.json src-tauri/src/security/elevation_macos.rs` | 9；源码构建、产物打包与动态加载接线 |
| EH04 | `rg -n 'com\.zephyr194\.userhome\.helper\.plist' src-tauri/tauri.conf.json src-tauri/helper/Bridge/UserHomeHelperBridge.swift` | 2；bundle 与 SMAppService plist 名 |
| EH05 | `rg -n 'executableTarget\|name: "UserHomeHelper"' src-tauri/helper/Package.swift` | 4；target 声明证明默认 Sources/UserHomeHelper/main.swift 入口；不是显式 main.swift 导入 |
| EH06 | `rg -n 'perform\(' src-tauri/helper/Sources/UserHomeHelper/main.swift` | 1；实际操作分发调用 |
| EH07 | `rg -n 'ElevationRequest\|ElevationResponse\|validateRequest\|requestDigest\|ReplayStore' src-tauri/helper/Sources/UserHomeHelper/main.swift src-tauri/helper/Sources/UserHomeHelper/Operations.swift src-tauri/helper/Bridge/UserHomeHelperBridge.swift` | 10；Swift 协议消费位置 |
| EH08 | `rg -n 'validateClient\|validateSigningRelationship' src-tauri/helper/Sources/UserHomeHelper/main.swift src-tauri/helper/Bridge/UserHomeHelperBridge.swift` | 3；客户端和签名关系校验 |
| EH09 | `rg -n 'commands::elevation::\|pub mod elevation' src-tauri/src/lib.rs src-tauri/src/commands/mod.rs` | 5；模块与后端命令注册 |
| EH10 | `rg -n 'elevation::' src-tauri/src --glob '!elevation.rs'` | 11；含 commands::elevation 注册（词法范围，不全是协调器调用）及 fake 测试 |
| EH11 | `rg -n 'elevation_fake::' src-tauri/src --glob '!elevation_fake.rs'` | 2；e2e fake 与测试接线 |
| EH12 | `rg -n 'elevation_macos::' src-tauri/src --glob '!elevation_macos.rs'` | 6；真实 transport 和诊断消费者，含测试 |
| EH13 | `rg -n 'elevation_protocol::' src-tauri/src --glob '!elevation_protocol.rs'` | 8；协调器、适配器、catalog 校验与测试 |
| EH14 | `rg -n 'elevated_actions::' src-tauri/src/commands/config.rs src-tauri/src/commands/services.rs src-tauri/src/commands/elevation.rs` | 3；三类命令接线 |
| EH15 | `rg -n 'getHelperStatus\|registerHelper\|unregisterHelper' src/features src/ipc/elevation.ts` | 3；全为 elevation.ts 的函数声明，非调用 |
| EH16 | `rg -n 'getHelperStatus\|registerHelper\|unregisterHelper\|ipc/elevation\|from .+elevation' src --glob '!elevation.ts'` | **0**；排除自身后无前端引用（rg 退出 1 为无匹配，不是测试失败） |
| EH17 | `rg -n 'report\.helper' src/features/settings/DiagnosticsSettings.tsx` | 4；supported/signed/available 诊断显示 |
| EH18 | `rg -n '\.build\|dist/' src-tauri/helper/.gitignore` | 2；构建产物忽略规则的文件内容证据 |

## 6. 旧应用、编辑器、Homebrew 与 Catalog 文件清单

本节覆盖四个指定子树的全部 **72 个 git 跟踪文件**：apps 42（含 editors）、前端 brew 10、Rust brew 6、catalog 14；其中前端测试文件 18、JSON 7。候选为过渡保留 67、重做 5、待移除 0；**保留不代表未来主导航继续保留这些入口**，仅表示替换与 G-3 批准前不能凭引用减少而直接删除。包括前述 35 项，本清单共 **107 个文件级候选：保留 81、重做 17、待移除 9**。

### 6.1 引用证据与计数命令

本节的 `E-*` 与前面 `EA01`、`EB01` 等 ID 不同。所有检索限于本仓库 git 跟踪文件；I/O 为指定子树内/外，不是仓库内/外。`git grep -nE ... | grep -c .` 每输出行计一次；组内共享计数不能解释为每个文件各有该数量外部调用，查询也不声称覆盖非限定符号的所有使用。下列命令与参数均在只读分区盘点中执行过。

```sh
# 在仓库根执行；只读，不运行任何 corpus 脚本。
git ls-files src/features/apps src/features/brew src-tauri/src/brew src-tauri/src/catalog | grep -c .
# 72；分别限定四个路径得到 42 / 10 / 6 / 14。

apps_refs() {
  P="$1"
  git grep -nE "from .*\"[^\"]*/($P)\"" -- src/features/apps
  git grep -nE "from .*\"[^\"]*/($P)\"" -- . ':!src/features/apps'
}
apps_counts() {
  P="$1"
  printf 'I='
  git grep -nE "from .*\"[^\"]*/($P)\"" -- src/features/apps | grep -c .
  printf 'O='
  git grep -nE "from .*\"[^\"]*/($P)\"" -- . ':!src/features/apps' | grep -c .
}
# E-A：I=12 O=1
P='ApplicationIcon|ApplicationsPage|CatalogCoverageSummary|RecognizedItems|candidateCatalogMatch|catalogCoverage'
apps_refs "$P"; apps_counts "$P"
# E-C：I=15 O=0
P='ConfigWorkspace|ConfigDetails|ConfigDiagnosticDetails|ConfigVariantSelector|configPresentation'
apps_refs "$P"; apps_counts "$P"
# E-B：I=4 O=0
P='BackupHistory|ConfigWritePreview'
apps_refs "$P"; apps_counts "$P"
# E-G：I=3 O=0
P='SchemaEditor|SchemaField|PresetPicker'
apps_refs "$P"; apps_counts "$P"
# E-F：I=23 O=0（包含 CopilotEditor 对共享 types 的导入）
P='CaddyEditor|GitEditor|NpmEditor|SshEditor|ZshEditor|SecretField|ConfigAdapterEditor|types'
apps_refs "$P"; apps_counts "$P"
# E-X：I=4 O=0
P='CopilotEditor|configEditorCapabilities'
apps_refs "$P"; apps_counts "$P"
# E-R：I=1 O=0
P='RawTextEditor'
apps_refs "$P"; apps_counts "$P"
# E-S：I=1 O=0
P='ApplicationSupportSummary'
apps_refs "$P"; apps_counts "$P"

# E-U：前端 Homebrew，I=12 O=1。
P='from .*"[^"]*/(BrewActionDialog|BrewInventoryList|BrewInventoryPage|BrewPackageDetails|BrewSearch|packageKey)"'
git grep -nE "$P" -- src/features/brew
git grep -nE "$P" -- . ':!src/features/brew'
# 分别追加 | grep -c . 复核 12 / 1。

# E-H：Rust Homebrew，I=5 O=13（模块注册也计入，不全是调用）。
git grep -nE '(^pub mod (actions|client|details|inventory|search);|brew::)' -- src-tauri/src/brew
git grep -nE '(^pub mod brew;|brew::)' -- . ':!src-tauri/src/brew'

# E-K：Catalog 运行时包与 loader，I=14 O=53；O 包含测试和 docs 文本。
P='include_str!.*(catalog-v2|presets-v1|schemas-v1|sources-v1)|^mod definitions;|^pub mod (preset|schema|source);|(schema::parse_schema_catalog|preset::parse_preset_catalog|source::parse_source_catalog)\('
git grep -nE "$P" -- src-tauri/src/catalog ':!src-tauri/src/catalog/profiles'
P='load_builtin_(catalog|sources|schemas|presets)|(schema::parse_schema_catalog|preset::parse_preset_catalog|source::parse_source_catalog)\('
git grep -nE "$P" -- . ':!src-tauri/src/catalog'

# E-V：v1 不是运行时 include，但仍是生成输入，I=0 O=1。
git grep -nF 'catalog-v1.json' -- src-tauri/src/catalog
git grep -nF 'catalog-v1.json' -- . ':!src-tauri/src/catalog'

# E-P：新只读 profiles，I=4 O=5；外部包括 docs 文本及模块声明。
P='include_str!.*(app-profile[.]schema|github-copilot)|^pub mod read;|catalog::profiles'
git grep -nE "$P" -- src-tauri/src/catalog/profiles
P='catalog::profiles|app-profile[.]schema[.]json|github-copilot[.]json|^pub mod profiles;'
git grep -nE "$P" -- . ':!src-tauri/src/catalog/profiles'

# E-T：18 个前端测试由 runner glob 发现，不需要业务 import。
git ls-files src/features/apps src/features/brew | grep -E '[.]test[.]tsx?$' | grep -c .
# 18
git grep -nF 'include: ["src/**/*.test.{ts,tsx}"]' -- vitest.config.ts
# 1 行；vitest.config.ts:5
# 下列只统计静态声明行，不是本次运行测试数。
git grep -nE '^[[:space:]]*it(\.each)?\(' -- 'src/features/apps/*.test.ts*' 'src/features/apps/editors/*.test.tsx' 'src/features/brew/*.test.tsx' | grep -c .
# 71 行，不能把参数化声明数换算成测试用例数。

# Rust 测试位置统计；本次没有执行这些 Rust 测试。
git grep -nF '#[test]' -- src-tauri/src/brew | grep -c .
# 16
git grep -nF '#[test]' -- src-tauri/src/catalog ':!src-tauri/src/catalog/profiles' | grep -c .
# 0；Catalog 集成测试在 src-tauri/tests/catalog.rs，不表示无覆盖。
git grep -nF '#[test]' -- src-tauri/src/catalog/profiles | grep -c .
# 8
git grep -nF '#[test]' -- src-tauri/tests/catalog.rs | grep -c .
# 12
```

### 6.2 各证据组的代表引用、处置条件、测试与文档

此表为下方每个文件的共享附件，每个逐文件条目的 E-* 均同时链接实际引用、命令/计数、相关测试和文档。测试覆盖形态如实标注，不把 SSR/IPC mock 当真实表单交互或系统变更。

| 证据组 | 命中 I/O 与代表引用、处置条件 | 相关测试 | 相关文档 |
|---|---|---|---|
| E-A | 12/1；`src/app/routes.tsx:1`、`ApplicationsPage.tsx:32-40`、`RecognizedItems.tsx:19,23`。过渡保留应用列表、候选唯一路径匹配、图标 fallback 与覆盖说明；移除主导航不代表清空其仍被 workspace 引用的职责 | `src/features/apps/ApplicationsPage.test.tsx:130,181,200,217`、`RecognizedItems.test.tsx:134,149,169,187`、`candidateCatalogMatch.test.ts:88,140,163`、`catalog.test.ts:40,72` | `docs/home-baseline-coverage.md:138-150`、`docs/managed-app-schema.md:14-45`、`docs/release-readiness.md:73,89`、CORE-1/2 |
| E-C | 15/0；`ApplicationsPage.tsx:34`、`RecognizedItems.tsx:24`、`ConfigWorkspace.tsx:49-50,61`。过渡保留受管 workspace/诊断/变体；metadata 分支不读正文，NO_SCHEMA 才走 adapter；旧 appId/configId/hash 不自动适配新 profile resourceId | `ConfigWorkspace.test.tsx:86-142`（主要静态约束）、`ConfigDetails.test.tsx:161-257`、`ConfigWritePreview.test.tsx:7`，均在 `src/features/apps/` | `docs/managed-app-schema.md:47-96,285-291`、`docs/application-profiles.md:5-7,80` |
| E-B | 4/0；`ConfigWorkspace.tsx:48,51` 与两项测试导入。保留备份列表、脱敏 diff 与显式确认职责，UI 不代替后端授权 | `src/features/apps/BackupHistory.test.tsx:6`、`ConfigWritePreview.test.tsx:7,16` | `docs/backup-and-restore.md`、`docs/managed-app-schema.md:84-95` |
| E-G | 3/0；`ConfigWorkspace.tsx:55`、`editors/SchemaEditor.tsx:10-11`。保留 schema/preset 机制；只提交 draft，complete template 仅适用 missing；不作为新只读 profile 的写入器 | 无三个组件的独立测试文件；`ConfigWorkspace.test.tsx` 为间接结构测试，`src/components/ui/forms/forms.test.tsx:84,95` 为共享秘密控件，`src/ipc/config.test.ts` 为 IPC 而非组件交互 | `docs/managed-app-schema.md:120-139,285-327`、`docs/release-readiness.md:75-76,90` |
| E-F | 23/0；`ConfigWorkspace.tsx:52`、`editors/configEditorCapabilities.ts:2,4-8`、`editors/NpmEditor.tsx:2-4`。保留非 Copilot 兼容编辑器、types 与控件，仍由 NO_SCHEMA fallback 调用，不能据 schema 默认路径宣布死代码；Caddy 首站点契约另见 A02 | `src/features/apps/editors/{Caddy,Git,Npm,Ssh,Zsh}Editor.test.tsx:6`（主要 SSR markup）、`ConfigDetails.test.tsx:243`；无完整提交交互保证 | `docs/managed-app-schema.md:285-327`、`docs/release-readiness.md:76,122` |
| E-X | 4/0；`ConfigWorkspace.tsx:53`、`ConfigAdapterEditor.tsx:3`、`configEditorCapabilities.ts:3`、`CopilotEditor.test.tsx:3`。重做 Copilot 旧字段/授权及注册中的 Copilot 语义，不整体推倒其他编辑器注册；冲突详见 §6.4 | `src/features/apps/editors/CopilotEditor.test.tsx:6,27-29` 仅标题/model/futureKey，不覆盖 banner/effortLevel/JSONC 契约；`src-tauri/src/catalog/profiles/read.rs:727-741` 是相关 Rust 回归但未执行 | `docs/managed-app-schema.md:321-327`、`docs/application-profiles.md:33-44` |
| E-R | 1/0；`ConfigWorkspace.tsx:54`。保留旧 raw 路径，受 canWriteDocument/capability/content 门禁；不是新 profiles 写入授权 | 无独立 RawTextEditor.test；`src/features/apps/ConfigDetails.test.tsx`、`ConfigWorkspace.test.tsx:142` 间接验证 | `docs/managed-app-schema.md:84-95`、`docs/application-profiles.md:7` |
| E-S | 1/0；`ConfigWorkspace.tsx:47`。保留支持/来源展示，与真实权限分开；展示文案不是授权判定 | 无独立 ApplicationSupportSummary.test；`src/features/apps/ConfigWorkspace.test.tsx:100` 检查证据不默认折叠 | `docs/managed-app-schema.md:7-10,338-344` |
| E-U | 12/1；`src/app/routes.tsx:2`、`BrewInventoryPage.tsx:15-18`、`BrewPackageDetails.tsx:18`、`BrewSearch.tsx:11-12`。过渡保留已装/搜索/稳定 kind+identifier key/详情/确认，FIN-1 前仍有路由与组内职责 | `src/features/brew/BrewInventoryPage.test.tsx:45,84,115,131,153`、`BrewSearch.test.tsx:11,18`、`BrewActionDialog.test.tsx:21,46,91`、`BrewInstall.test.tsx:6`；mock IPC 不证明实际软件变更 | `docs/release-readiness.md:42,44,91`、`docs/ui-correction-acceptance-v3.md:80,90`、CORE-1/2、FIN-1 |
| E-H | 5/13；`src-tauri/src/lib.rs:5,33,119-123`、`commands/brew.rs:6,59`、`discovery/refresh.rs:13`、`services/actions.rs:6`、`services/inventory.rs:5`。保留固定 prefix、typed command、有界 process、库存/搜索/详情/协调器；服务与发现仍共享 client，不能随页面整体删除。client 的 ServiceAction Caddy 硬编码须 SVC-5 连同替换 | 六文件内共 16 个 `#[test]`：mod 4、actions 1、client 3、inventory 3、details 2、search 3（未执行）；前端 E-U | `docs/release-readiness.md:42,44,91,97`、`docs/threat-model.md:54`、SVC-5、G-3 |
| E-K | 14/53；`catalog/definitions.rs:1-4`、`catalog/mod.rs:580-604`、`commands/config.rs:305-306,330,341,352,658-662`、`commands/catalog.rs:161,179,251`、`config/mod.rs:133`。保留实际 include 和 schema/preset/source 校验机制；v2 的 Copilot 授权需重做，非删全部运行时包 | `src-tauri/tests/catalog.rs` 共 12 项，侧重 parse_catalog，非三个 validator 完整独立覆盖；validator 文件内测试声明为 0；`src/features/apps/catalog.test.ts`、`src/ipc/config.test.ts` | `docs/managed-app-schema.md:7-9,98-139,285-344`、`docs/release-readiness.md:73,75-76` |
| E-V | 0/1；`scripts/catalog/build-corpus.mjs:18`，实际在 `:262-263` 读取、`:280` 生成 runtime catalog（仅阅读，未运行）。v1 保留生成输入职责，Copilot 授权与 v2 一并重做；非运行时 include 不能当无引用 | 无 v1 独立专用测试；`src-tauri/tests/catalog.rs:18,383` 验证内置运行时数据（未执行） | `docs/managed-app-schema.md:7-9`（v2 从 reviewed v1 + corpus 生成） |
| E-P | 4/5；内部 `profiles/mod.rs:8,15,16`、`read.rs:645`；外部 `docs/application-profiles.md:13,15`、`catalog/mod.rs:3`、`commands/application_config.rs:5`、`settings/discovery_exclusions.rs:5`。生产 discover/list/read 在 application_config.rs:40,67,96。保留新独立只读契约、严格校验与有界读取；METADATA 不打开正文，不继承旧写入能力 | `profiles/mod.rs:267,297`、`profiles/read.rs:690,727,745,784,850,887` 共 8 项；`src-tauri/tests/ipc_contract.rs:57`（未执行） | `docs/application-profiles.md:7-31,33-64,78-80,110-112` |
| E-T | 18 测试文件、runner 1 行（`vitest.config.ts:5`）、静态 it 声明 71 行。测试由 glob 发现，不需要业务导入；全量 Vitest 本次 46 文件/220 测试通过，但 71 声明数不可当成运行数 | 下表列出全部 18 文件；仅 CopilotEditor.test 候选重做陈旧契约断言，其余在旧路径仍有效时保留 | 各所测组文档；`docs/release-readiness.md` 只作为历史台账，不代替本次结果 |

### 6.3 完整逐文件候选（72 项）

每行 E-* 回指 §6.1 命令/计数与 §6.2 测试/文档。处置是过渡候选，不是源码修改指令。

| ID | 文件 | 候选处置 | 引用／测试／文档证据组 |
|---|---|---|---|
| L01 | `src/features/apps/ApplicationIcon.tsx` | 保留 | E-A |
| L02 | `src/features/apps/ApplicationSupportSummary.tsx` | 保留 | E-S |
| L03 | `src/features/apps/ApplicationsPage.test.tsx` | 保留 | E-T、E-A |
| L04 | `src/features/apps/ApplicationsPage.tsx` | 保留 | E-A |
| L05 | `src/features/apps/BackupHistory.test.tsx` | 保留 | E-T、E-B |
| L06 | `src/features/apps/BackupHistory.tsx` | 保留 | E-B |
| L07 | `src/features/apps/CatalogCoverageSummary.tsx` | 保留 | E-A |
| L08 | `src/features/apps/ConfigDetails.test.tsx` | 保留 | E-T、E-C、E-F |
| L09 | `src/features/apps/ConfigDetails.tsx` | 保留 | E-C |
| L10 | `src/features/apps/ConfigDiagnosticDetails.tsx` | 保留 | E-C |
| L11 | `src/features/apps/ConfigVariantSelector.tsx` | 保留 | E-C |
| L12 | `src/features/apps/ConfigWorkspace.test.tsx` | 保留 | E-T、E-C、E-S |
| L13 | `src/features/apps/ConfigWorkspace.tsx` | 保留 | E-C |
| L14 | `src/features/apps/ConfigWritePreview.test.tsx` | 保留 | E-T、E-B、E-C |
| L15 | `src/features/apps/ConfigWritePreview.tsx` | 保留 | E-B |
| L16 | `src/features/apps/RecognizedItems.test.tsx` | 保留 | E-T、E-A |
| L17 | `src/features/apps/RecognizedItems.tsx` | 保留 | E-A |
| L18 | `src/features/apps/candidateCatalogMatch.test.ts` | 保留 | E-T、E-A |
| L19 | `src/features/apps/candidateCatalogMatch.ts` | 保留 | E-A |
| L20 | `src/features/apps/catalog.test.ts` | 保留 | E-T、E-A、E-K；实际测 `../../ipc/catalog`，不要求同名 catalog.ts |
| L21 | `src/features/apps/catalogCoverage.ts` | 保留 | E-A |
| L22 | `src/features/apps/configPresentation.ts` | 保留 | E-C |
| L23 | `src/features/apps/editors/CaddyEditor.test.tsx` | 保留 | E-T、E-F |
| L24 | `src/features/apps/editors/CaddyEditor.tsx` | 保留（兼容） | E-F；首站点契约替换见 A02/CAD-1 |
| L25 | `src/features/apps/editors/ConfigAdapterEditor.tsx` | 保留（兼容） | E-F、E-X |
| L26 | `src/features/apps/editors/CopilotEditor.test.tsx` | 重做契约/提交断言 | E-T、E-X、E-P |
| L27 | `src/features/apps/editors/CopilotEditor.tsx` | 重做字段及授权契约 | E-X、E-P |
| L28 | `src/features/apps/editors/GitEditor.test.tsx` | 保留 | E-T、E-F |
| L29 | `src/features/apps/editors/GitEditor.tsx` | 保留（兼容） | E-F |
| L30 | `src/features/apps/editors/NpmEditor.test.tsx` | 保留 | E-T、E-F |
| L31 | `src/features/apps/editors/NpmEditor.tsx` | 保留（兼容） | E-F |
| L32 | `src/features/apps/editors/PresetPicker.tsx` | 保留 | E-G |
| L33 | `src/features/apps/editors/RawTextEditor.tsx` | 保留（旧受管） | E-R |
| L34 | `src/features/apps/editors/SchemaEditor.tsx` | 保留 | E-G |
| L35 | `src/features/apps/editors/SchemaField.tsx` | 保留 | E-G |
| L36 | `src/features/apps/editors/SecretField.tsx` | 保留（兼容） | E-F |
| L37 | `src/features/apps/editors/SshEditor.test.tsx` | 保留 | E-T、E-F |
| L38 | `src/features/apps/editors/SshEditor.tsx` | 保留（兼容） | E-F |
| L39 | `src/features/apps/editors/ZshEditor.test.tsx` | 保留 | E-T、E-F |
| L40 | `src/features/apps/editors/ZshEditor.tsx` | 保留（兼容） | E-F |
| L41 | `src/features/apps/editors/configEditorCapabilities.ts` | 重做 Copilot 注册/契约边界，其他注册保留 | E-X、E-F、E-P |
| L42 | `src/features/apps/editors/types.ts` | 保留（兼容） | E-F |
| L43 | `src/features/brew/BrewActionDialog.test.tsx` | 保留 | E-T、E-U |
| L44 | `src/features/brew/BrewActionDialog.tsx` | 保留 | E-U |
| L45 | `src/features/brew/BrewInstall.test.tsx` | 保留 | E-T、E-U；测试 IPC 安装意图，不要求同名组件 |
| L46 | `src/features/brew/BrewInventoryList.tsx` | 保留 | E-U |
| L47 | `src/features/brew/BrewInventoryPage.test.tsx` | 保留 | E-T、E-U |
| L48 | `src/features/brew/BrewInventoryPage.tsx` | 保留 | E-U |
| L49 | `src/features/brew/BrewPackageDetails.tsx` | 保留 | E-U |
| L50 | `src/features/brew/BrewSearch.test.tsx` | 保留 | E-T、E-U |
| L51 | `src/features/brew/BrewSearch.tsx` | 保留 | E-U |
| L52 | `src/features/brew/packageKey.ts` | 保留 | E-U |
| L53 | `src-tauri/src/brew/actions.rs` | 保留 | E-H |
| L54 | `src-tauri/src/brew/client.rs` | 保留共享 client；Caddy 专用分支待 SVC-5 替换 | E-H |
| L55 | `src-tauri/src/brew/details.rs` | 保留 | E-H |
| L56 | `src-tauri/src/brew/inventory.rs` | 保留 | E-H |
| L57 | `src-tauri/src/brew/mod.rs` | 保留 | E-H |
| L58 | `src-tauri/src/brew/search.rs` | 保留 | E-H |
| L59 | `src-tauri/src/catalog/catalog-v1.json` | 重做 Copilot 授权，保留生成输入 | E-V、E-X、E-P |
| L60 | `src-tauri/src/catalog/catalog-v2.json` | 重做 Copilot 授权，保留运行时目录职责 | E-K、E-X、E-P |
| L61 | `src-tauri/src/catalog/definitions.rs` | 保留 | E-K |
| L62 | `src-tauri/src/catalog/mod.rs` | 保留 | E-K、E-P |
| L63 | `src-tauri/src/catalog/preset.rs` | 保留 | E-K |
| L64 | `src-tauri/src/catalog/presets-v1.json` | 保留 | E-K |
| L65 | `src-tauri/src/catalog/profiles/app-profile.schema.json` | 保留 | E-P |
| L66 | `src-tauri/src/catalog/profiles/github-copilot.json` | 保留（新只读契约依据） | E-P、E-X |
| L67 | `src-tauri/src/catalog/profiles/mod.rs` | 保留 | E-P |
| L68 | `src-tauri/src/catalog/profiles/read.rs` | 保留 | E-P |
| L69 | `src-tauri/src/catalog/schema.rs` | 保留 | E-K |
| L70 | `src-tauri/src/catalog/schemas-v1.json` | 保留 | E-K |
| L71 | `src-tauri/src/catalog/source.rs` | 保留 | E-K |
| L72 | `src-tauri/src/catalog/sources-v1.json` | 保留 | E-K |

### 6.4 Copilot 并存契约冲突与替换边界

1. **字段类型与名称**：`CopilotEditor.tsx:13-14,20-21` 与旧 `config/adapters/copilot.rs:11-15,37-41,83-87` 读写布尔 `banner`、`reasoningEffort`；新 `catalog/profiles/github-copilot.json:31-32` 为 `banner: always|once|never`、`effortLevel: low|medium|high|xhigh`。`docs/managed-app-schema.md:321-327` 已记不兼容；不能只换 UI 标签。
2. **权限**：新 profile 的 `github-copilot.json:61-68` 把可能含认证的 `config.json` 定义为 METADATA；旧 `catalog-v2.json:13-33` 仍为 `.copilot/config.json` 的 READ_WRITE / copilot-json / STRUCTURED_AND_RAW，v1:30-50 同样授权。`configEditorCapabilities.ts:17-18` 与 `ConfigWorkspace.tsx:626-664` 的 NO_SCHEMA fallback 仍存在。`docs/application-profiles.md:7,80` 明确新入口不自动取消旧授权，因此是**并存契约待裁决**，不是新只读 reader 自行开放了写入。
3. **格式/资源**：新 profile settings 为 JSONC、九字段；旧 catalog settings 为 JSON、旧 adapter 的 `parse_object:94-99` 用 `serde_json::from_str`。新 `.instructions.md` 资源与旧 appId/configId 写入模型不同，不能把 profile resourceId 直接喂旧编辑器。Rust `profiles/read.rs:727-741` 将 `banner:true` 判 INVALID，旧 CopilotEditor.test 只验 markup，不能保证新契约。
4. **生成输入**：`catalog-v1.json` 仍由 `scripts/catalog/build-corpus.mjs:18,262-263` 读取，后续必须同步 v1 与生成结果的授权，而不是只改 v2 或直接删 v1。本次未运行任何 corpus 命令、未读取真实配置、未裁决新契约；留给 AI-12/13 与 G-3。

额外内部字段证据（不是外部调用数）：

```sh
git grep -nE 'reasoningEffort|banner:|CheckboxField.*banner' -- src/features/apps/editors/CopilotEditor.tsx
# 4 行
git grep -nE 'JSONC|banner|effortLevel|METADATA' -- src-tauri/src/catalog/profiles/github-copilot.json
# 6 行（22,24,31,32,65,66）
```

本节不将 0 外部引用的子组件、glob 发现的测试或仍有生成职责的 JSON 判为删除候选。待移除候选集中在 §5 的系统 helper 旧链路，全部仍待用户批准。

## 7. 待办与审计结论

- 最终静态核验（2026-10-15 17:23 +0800）：107 个候选文件均存在、路径无重复；指定 apps/brew/catalog 四子树的 72 个跟踪文件无遗漏；候选处置数量为保留 81、重做 17、待移除 9；四条基线表完整，无待合并占位。全部“待移除”仅候选，当前未删除任何文件。
- 引用人工抽查：EA02 的 `adapters/mod.rs` 3 行（模块声明、inspect、prepare_structured），ES02 的 9 行（inventory 消费位置），EH15 的 3 行（均为封装声明）与 EH16 的 0 行（无其他前端调用）已核对原始命中内容。
- `git status --short --untracked-files=all` 只显示 `?? tasks/inventory.md`；普通 `git status --short` 会把未跟踪目录折叠为 `?? tasks/`，不是多出其他文件。`git diff --exit-code` 为空，`.gitignore` 无差异，暂存区为空。
- `tasks/todo.md` 的 T-0 仍为 `- [ ]`；`git check-ignore -v` 确认 todo 与 SPEC 继续被既有规则忽略，inventory 未被忽略。
- 当前 Rust 基线缺失；不得将 T-0 标为完成，不得把 G-3 清理批准视为已获得。
- 四条门禁没有修复或重跑；未改断言、skip、类型/Clippy 压制或配置以换取通过。
- lint 现有 warning 与 Rust 权限拒绝分别记录，均未隐藏。只读探索时曾遇到不存在的 `tests/`、`src/app/App.tsx` 查询路径，以及 Python 子进程无法直接定位 shell 注入的 `rg`；这些是探索命令错误，不是产品/基线失败，后续证据仅采用存在路径的独立查询结果，未替代或重跑任何基线。
- 后续须用户另行决定 Rust 权限与运行；G-3 后才决定候选的删除／保留／改造。此处不执行 FIN、其他 CORE 或任何服务动作。
