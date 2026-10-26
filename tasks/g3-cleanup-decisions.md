# G-3 清理清单（待你逐项答复）

日期：2026-10-21。**用户已答复：全部 12 项按建议执行（2026-10-21）；G3-9 按“CAD-4 确认 Caddy 不需要 root 后整体移除”执行。** 执行进度见文末。依据：`tasks/inventory.md`（T-0，2026-10-15 盘点，107 个文件级候选：保留 81、重做 17、待移除 9）与 2026-10-21 对当前代码的只读核对。**本文件不删除任何东西**；每项答复为 删除 / 保留 / 改造，未答复项视为保留。

时序说明：G-3 在计划里排在 CP2、CP3、CP4、CP6 之后（旧能力要等新能力替换完才能删）。你可以现在就答复，答复会被记录，但**实际删除要等对应替换落地**（每项的“何时执行”列）。执行时按提交分批，每批先重查引用、`pnpm check` 通过，历史发布证据与用户配置/备份不动。

## 当前状态摘要

- 主导航已不含“应用目录”“Homebrew”，但路由 ID `applications`/`homebrew` 仍在 `routeDefinitions.ts`，用于旧 ID 回退概览；`routes.tsx`、`selectionMemory.ts` 仍引用旧页面。
- 旧服务命令（`list_services`、`get_service`、`preview_service_action`、`execute_service_action`）仍在 `lib.rs` 注册；新服务页走 launchd 发现。Homebrew Caddy 的旧动作路径仍保留（已加归属门限制）。
- helper：前端 `src/ipc/elevation.ts` 无任何引用；后端仍注册真实 register/unregister 命令。**不会**执行任何 helper 卸载或注销。

## 逐项清单

| # | 候选 | 规模（当前） | 我的建议 | 何时执行 | 你的答复 |
|---|---|---|---|---|---|
| G3-1 | 通用应用目录：前端 `src/features/apps/`（含各编辑器） | 42 个文件 | **删除** 页面、编辑器及其测试；保留旧路由 ID 的回退兼容 | FIN-1（CP6 之后） |  按建议（用户 2026-10-21 批准） |
| G3-2 | Homebrew 独立页面：`src/features/brew/`、`src/ipc/brew.ts` | 10 个文件 + IPC 封装 | **删除** | FIN-1 |  按建议（用户 2026-10-21 批准） |
| G3-3 | Homebrew 底层：`src-tauri/src/brew/` | 6 个文件 | **保留** 到 Caddy 阶段（CAD-3/4）把启停迁到自有进程之后，再复核是否仍被引用，再决定删除 | CP4 之后 |  按建议（用户 2026-10-21 批准） |
| G3-4 | 旧服务 Homebrew 路径：`services/inventory.rs`、`services/actions.rs`、`commands/services.rs` 的 4 个旧命令、前端 `ServiceDetails`/`ServiceActionDialog` | 3 个后端文件 + 4 个命令 + 2 个组件及测试 | **改造后删除**：Caddy 迁移完成后移除旧命令与旧组件 | CP4 之后（FIN-2） |  按建议（用户 2026-10-21 批准） |
| G3-5 | 旧 Catalog（通用应用配置写入路径）：`src-tauri/src/catalog/`、`config/adapters/*` 的通用部分 | 14 个文件 + 适配器 | **改造**：保留其中被 AI 配置/CORE-7 复用的解析、脱敏与事务，移除应用目录专用写入路径。逐文件清单待 AI 阶段确认实际复用面 | CP6 之后 |  按建议（用户 2026-10-21 批准） |
| G3-6 | Copilot 旧适配器 `config/adapters/copilot.rs`（含旧错误字段 `banner`、`reasoningEffort` 的结构写入） | 1 个文件 | **重做**（由 AI-12 按官方来源裁决），重做前**保留**，不放开旧字段的编辑入口 | AI-12 |  按建议（用户 2026-10-21 批准） |
| G3-7 | Caddy 首站点适配：`config/adapters/caddy.rs`（`first_site_range_ref` 首块花括号计数）、前端 `CaddyEditor` | 1 个文件 + 1 个编辑器 | **重做**（CAD-1/2 按完整 Caddyfile 解析），完成后删除旧实现 | CP4 |  按建议（用户 2026-10-21 批准） |
| G3-8 | helper 前端封装 `src/ipc/elevation.ts` | 1 个文件，**0 处引用** | **删除** | FIN-1 |  按建议（用户 2026-10-21 批准） |
| G3-9 | helper 整链：Swift `src-tauri/helper/`（8 文件）、`security/elevation*.rs`、`elevated_actions.rs`、`commands/elevation.rs`、打包与签名接线 | Swift 8 + Rust 约 7 + 配置 | **需要你决定**。新目标不再需要系统提权。建议：CAD-4 确认 Caddy 全程不需要 root 后**整体移除**；在此之前保留，保持 fail-closed，不放宽两项资源 allowlist；**绝不**在本机执行 helper 卸载/注销 | CP4 之后 |  按建议（用户 2026-10-21 批准） |
| G3-10 | 设置页里的 helper 诊断行 `DiagnosticsSettings.tsx` | 1 个文件内的 4 行 | **改造**：随 G3-9 去掉或改为说明文字，保留其余诊断 | 随 G3-9 |  按建议（用户 2026-10-21 批准） |
| G3-11 | 被替换的既有测试覆盖（如 CORE-2 把“Homebrew 刷新失败保留旧清单”用例换成旧路由回退概览） | 若干用例 | **随对应代码一并删除**，不单独保留 | 随 G3-2/4 |  按建议（用户 2026-10-21 批准） |
| G3-12 | 共享边界（`AppShell`、`NavigationRail`、`ipc/core.ts`、`config/write.rs`、`config/backup.rs`、`operations/*` 等 9 项） | 9 个文件 | **保留**（已被新能力复用，不是清理对象） | — |  按建议（用户 2026-10-21 批准） |

## 不在清理范围（确认不动）

- 用户配置、备份、`docs/release-readiness.md` 与其他历史发布证据、原有 `.gitignore` 改动。
- 文档对齐（README、威胁模型、备份文档等）属 FIN-3，不在本清单。
- pnpm 版本一致（FIN-4）需单独批准 CI 与发布配置。

## 如何答复

直接回复形如“G3-1 删除，G3-9 整体移除，其余按建议”即可；对不同意的项写明改为 删除/保留/改造。未提及的项我按“保留”处理。

## 执行进度

- FIN-1a（G3-1、G3-2、G3-8、G3-11 的前端部分）：已派发，见 todo。
- 其余项按“何时执行”列等待对应替换落地：G3-3/4/7/9/10 在 CP4（Caddy）之后；G3-5 在 CP6 之后；G3-6 在 AI-12。
