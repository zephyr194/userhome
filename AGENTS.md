# AGENTS.md

本文件是 Claude、Codex 等所有 agent 的项目约定主文档（不使用 `@` 导入）。开发模式：用户只做引导，agent 完成变更与分发。
测试、错题、发布的细则以链接文档为准，此处只写结论。

## 1. 项目简介与技术栈

UserHome：本地优先的 macOS 桌面与托盘应用，在当前用户权限下查看和维护本机的环境变量、Caddy、launchd 用户服务、应用与 AI 工具配置，附带文本与二维码工具。
无提权 helper，不请求 root。完整功能与页面见 [README.md](README.md)。

- 前端：React 19 + TypeScript + Vite 8 + Tailwind 4 + Headless UI；测试用 Vitest 5 + jsdom + Testing Library。
- 后端：Tauri 2 + Rust 1.95（`rust-toolchain.toml`）。前端调用 Rust 只经 `src/ipc/core.ts`（唯一 import `invoke` 的非测试文件）。
- 版本固定：Node 24.21.0、pnpm 12.11.2（`package.json` 的 `engines`）。
- 表单控件的唯一入口是 `src/components/ui/forms`，业务代码不得直接用原生 `input/select/textarea/option`（ESLint 与审计测试会拦）。

## 2. 目录地图

| 路径 | 放什么 |
|---|---|
| `src/` | 前端。`app/` 外壳与数据中枢，`features/<模块>/` 各页面，`components/ui/` 通用组件，`ipc/` Tauri 命令封装，`i18n/` 文案，`styles/` 样式令牌，`test/` 测试公共 setup，`e2e/` e2e 专用探针 |
| `src-tauri/` | Rust 后端。`src/` 按模块（`commands/`、`config/`、`grants/`、`services/`、`caddy/`、`catalog/` 等），`tests/` 集成测试，`capabilities/` Tauri 权限，`tauri.conf.json` |
| `e2e/` | WebdriverIO 冒烟用例（`smoke.spec.ts`），配置在根目录 `wdio.conf.ts` |
| `scripts/` | Node 脚本：`check-doc-layout.mjs`（文档放置 lint）、`catalog/`（语料构建/校验）、`merge-*-schema.mjs` |
| `docs/` | 技术契约、操作指南、发布台账，以及 `specs/`、`ideas/`、`intent/`、`agent-incidents/` 子目录 |
| `tasks/` | 本地计划与任务清单 `plan.md`、`todo.md`（gitignore），另有已跟踪的验收/盘点记录 |
| `catalog-corpus/` | 应用语料产物，只由 `scripts/catalog/` 生成 |
| `.github/workflows/` | CI（`ci.yml`）与发布（`release.yml`） |

注意：`.claude/` 与 `.agents/` 已纳入 git 跟踪，只有个人权限文件 `.claude/settings.local.json` 被忽略；`.claude/skills`、`.claude/references` 是指向 `../.agents/...` 的符号链接，新 worktree 里同样可用；`.github/` 虽在 `.gitignore` 中，但 `workflows/` 已被强制跟踪。

## 3. 常用命令

测试边界以 [docs/testing.md](docs/testing.md) 为准（§3 白名单与禁止清单），此处只写结论。

**本地允许：**

- `pnpm install --offline --frozen-lockfile --ignore-scripts`
- `pnpm test`、`pnpm test -- <文件>`（Vitest，单文件运行）
- `pnpm lint`（= `check-doc-layout.mjs` + ESLint）、`pnpm typecheck`、`pnpm build`
- `pnpm corpus:validate`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`

**本地禁止：**

- 本机受管安全软件会拦截 Rust 测试二进制：`cargo test`、`pnpm check:rust`、`pnpm check` 本地禁止运行（`check:rust`、`check` 内含 `cargo test`）。
  Rust 改动一律记为"未验证"（等级 D），待 CI 的 `rust` job；不得换名、换目录、签名等方式绕过拦截。
- `pnpm test:e2e`、`pnpm build:e2e` 默认禁止（会启动真实应用，隔离不完整），由 CI 的 `e2e` job 运行。**只有用户在当前对话里明确要求运行 e2e 时才可以运行**：agent 不得自行判断需要跑，不得主动提议后自己执行，也不得把一次授权当成以后都可以；worker 只有在协调者转述了用户的明确要求时才能运行。
- `cargo clippy`、`cargo build` 暂按禁止处理；`pnpm build:unsigned`、`pnpm tauri *`、`pnpm corpus:refresh`、`pnpm corpus:build` 同样禁止（理由见 testing.md §3）。

提交前本地至少运行：`pnpm lint && pnpm typecheck && pnpm test`。涉及 Rust 的改动，在汇报中写"Rust：D，待 CI"。

## 4. 文档放置规则

| 内容 | 位置 |
|---|---|
| 规格 `SPEC*.md`、`CAPABILITY-MAP.md` | **只能**放 `docs/specs/` |
| 想法 | `docs/ideas/` |
| 意图 | `docs/intent/` |
| 计划与任务清单 | `tasks/plan.md`、`tasks/todo.md` |
| 错题 | `docs/agent-incidents/` |
| 一般文档（契约、指南、证据） | `docs/` |
| 根目录 | 只放 `README.md`、`AGENTS.md`、`CLAUDE.md` 这类入口文件 |

- `docs/specs/`、`tasks/plan.md`、`tasks/todo.md` 被 gitignore，**只存在本地，新 worktree 里没有**。需要读规格时从主工作区取，不要为此提交它们。
- 规则：`SPEC*.md`、`CAPABILITY-MAP.md` 不得写在 `docs/specs/` 之外；写规格前先确认目标路径。违反时由 `scripts/check-doc-layout.mjs`（`pnpm lint` 的一部分）拦下，编辑时没有自动拦截，要靠自觉遵守。

## 5. 工作流

规格（**用户确认**）→ 计划 → 分发 → 协调者验收 → 合并 → 收敛清理。

- 分支命名 `zephyr19/<name>`。合并不需要用户确认：协调者复核通过后用 `--no-ff` 合并到 main，不 push。
- worktree 生命周期：
  - 复核通过：合并，然后执行 `orca worktree rm --worktree branch:<branch> --delete-branch`，移除 worktree 和已合并的分支。
  - 复核不通过：用 `orca orchestration send` 打回给同一个 worker，worktree 保留。
  - 放弃任务：须用户确认后才能移除；未合并的分支不删。
- 提交遵循 Conventional Commits：`type(scope): 中文描述`，例如 `fix(services): 详情读取失败时指向左侧清单的重试入口`。
  常见 type：`feat`、`fix`、`refactor`、`docs`、`test`、`chore`；scope 取模块名（`services`、`app-config`、`ai-config`、`ui` 等）。以 `git log` 实际风格为准。
- agent 不得 `push`，不得改写 main 历史（`reset`、`rebase`、`amend` 已合并提交），不得 force（含 `--force`、`reset --hard` 覆盖他人提交）。
- 一个提交只做一件事，不混入顺带改动。

## 6. 完成的定义

- 每条验收标准都要附证据，并标注 [docs/testing.md](docs/testing.md) §6 规定的证据等级（A / A-CI / B / C / D）。不得只写"已验证"；一份报告里每个声明单独标注，整体说法取最低等级。
- worker 自报完成不算数，由协调者复核。
- 测试未运行或失败时如实贴出输出，不写"应该通过"。
- 最低测试要求见 testing.md §8.1。

## 7. 硬性禁止

- 跳过测试、删除或弱化断言、降低阈值、放宽超时；新增 `@ts-ignore`、`eslint-disable`、`as any`（见 testing.md §8.2）。
- 改动超出任务允许的路径。
- 写 worktree 以外的路径，或读写真实 `~`；测试一律用临时目录并通过注入的 base dir（testing.md §5.3）。
- 在真机桌面使用 computer-use 或任何 GUI 自动化；这类验收记为"待人工"。
- worker 修改规则类文件，以下文件只有经用户批准才能改：
  `.claude/` 下的配置文件、`scripts/check-*.mjs`、`docs/agent-incidents/README.md`、`docs/testing.md`、`AGENTS.md`、`CLAUDE.md`。
  发现规则本身有问题时，写进汇报，不要自己改规则让检查变绿（见 agent-incidents/README.md §6）。

## 8. 必须停下来问用户

- 意图有歧义。
- 改公共契约（IPC 命令、serde 字段、`ipc_contract`）或数据迁移。
- 删除数据。
- 变更规格范围。
- 修改规则类文件（见上）。
- 连续两次被拒（拒收、驳回或用户纠正）。

## 9. 错题流程

由**协调者**在验收时按 [docs/agent-incidents/README.md](docs/agent-incidents/README.md) §7 的记录条件（R1–R4 / N1–N5）判断是否记错题，拒收时在汇报里写明“记 / 不记”及依据。schema、升级与维护流程以该文件为准，此处不重复。

## 10. 模型路由

简单的局部任务（已定位的小缺陷、文案、内部重命名）派 Haiku；跨模块、Rust/Tauri、安全或脱敏相关的任务派 Sonnet 或更强的模型。
详细依据见 [docs/agent-incidents/batch-1-proposals.md](docs/agent-incidents/batch-1-proposals.md) 第三节。
