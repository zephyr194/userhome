# 测试边界（草案）

**用途：**告诉 AI agent 与维护者：每一层测试测什么、文件放哪、本地能跑什么、"已验证"需要什么证据、哪些必须交给人工。
本文是**草案**，文末"待用户决定"未定前，标为 `[待定]` 的条款不作为硬性规则。
历史验收结果与门禁结论见 [release-readiness.md](release-readiness.md)，本文不记录运行结果。

> 证据标记：`file:line` 为 2026-11-03 在 `zephyr19/testing-boundary` 分支读取所得；**[推断]** 表示由代码阅读推出、未实际运行验证。

## 1. 现状速览

- 应用是 Tauri 2 + React 19 + Rust 的 macOS 桌面应用，会读写用户 home 下的真实配置、launchd 与登录会话环境变量。
- Vitest：`src/**/*.test.{ts,tsx}`，267 个文件、3567 个用例（本次 `pnpm test` 全部通过，约 24 秒）。
- Rust：约 1951 个 `#[test]`。85 个 `src-tauri/src` 文件含 `#[cfg(test)]` 内联模块，其中 47 个是独立的 `tests.rs` / `*_tests.rs`；
  另有 5 个集成测试文件在 `src-tauri/tests/`（`catalog`、`ipc_contract`、`operations`、`process_session`、`tray`）。
- E2E：WebdriverIO + `@wdio/tauri-service`，只有一个 spec（`e2e/smoke.spec.ts`，2 个 `it`），驱动 `--features e2e` 的调试构建。
- 语料校验：`scripts/catalog/validate-corpus.mjs`，只读校验 `corpus` 产物（本次通过：624 个应用、26 个 overlay）。
- `pnpm lint`、`pnpm typecheck` 本次在本机通过；vitest 不含 `e2e/`，e2e 由 `tsconfig.node.json` 做类型检查。

## 2. 测试分层

| 层级 | 工具 | 测什么 | 不测什么 | 文件位置与命名 | 运行命令 | CI |
|---|---|---|---|---|---|---|
| L0 静态检查 | ESLint、`tsc` | 代码风格、React hooks 规则、两个 tsconfig 的类型 | 运行时行为 | 全仓；ESLint 忽略 `src/components/ui/forms/**` 和测试文件（`eslint.config.js:11`） | `pnpm lint`、`pnpm typecheck` | `frontend` job（ubuntu） |
| L1 前端单元/组件 | Vitest 5 + jsdom + Testing Library | 组件渲染、交互、i18n 文案、IPC 封装的入参/出参、样式令牌审计、与 Rust 定义的漂移检查 | 真实 Rust 命令、真实文件系统、真实 WebView 布局 | 与源文件同目录，`Foo.test.tsx` / `foo.test.ts`；变体用 `Foo.en.test.tsx`、`Foo.back.test.tsx`；共享 setup 在 `src/test/` | `pnpm test`；单文件 `pnpm test -- src/path/Foo.test.tsx` | `frontend` job |
| L2 Rust 单元 | `cargo test`（内联 `#[cfg(test)]`） | 路径与权限校验、原子写、备份与恢复、授权（grants）、launchd plist 生成、解析、命令构造（用假的 runner） | 真实 `launchctl`/`brew`/`caddy` 调用、真实 `~` | 与被测模块同目录；大型的拆成 `tests.rs` 或 `xxx_tests.rs`；临时目录用 `temp_dir()/userhome-*-<uuid>` | `cargo test --manifest-path src-tauri/Cargo.toml`（**本地禁止**） | `rust` job（macos） |
| L3 Rust 集成 | `cargo test`（`src-tauri/tests/`） | 只通过 `userhome_lib` 公共 API 的契约：IPC 契约、catalog、operations、进程会话 | 内部私有实现 | `src-tauri/tests/<主题>.rs` | 同上，**本地禁止** | `rust` job |
| L4 语料校验 | Node 脚本 | 生成的应用语料与运行时 catalog 一致、检测类应用无越权 | Homebrew 实时数据（`corpus:refresh` 才联网） | `scripts/catalog/` | `pnpm corpus:validate` | 无（**现状缺口**，见 §9） |
| L5 E2E 冒烟 | WebdriverIO + Mocha | 真实 WebView 中外壳可启动、导航、窗口尺寸、主题令牌、设置页键盘焦点 | 写入类流程、提权、真实服务管理 | `e2e/*.spec.ts`（`wdio.conf.ts:64` 的 glob） | `pnpm test:e2e`（构建并启动真实应用；**默认禁止，仅用户明确要求时可运行**，见 §3） | `e2e` job（macos） |
| L6 构建冒烟 | Tauri CLI | 无签名 release 构建可产出二进制 | 签名、公证、打包 | — | `pnpm build:unsigned` | `unsigned-build` job |
| L7 人工验收 | 真机 + 清单 | 真实 GUI、提权、签名、真实服务与配置 | — | `docs/*-acceptance.md`、`docs/release-readiness.md` | 见 §6 | 否 |

放置原则：

1. 纯逻辑优先放最低的一层：能用 Rust 单元测的不要靠 E2E；能用 Vitest 测的不要靠 E2E。
2. 前端调用 Tauri 只经 `src/ipc/core.ts:1`（唯一 import `invoke` 的非测试文件），因此 IPC 封装测在 `src/ipc/*.test.ts`（36 个），页面测在对应 `features/*`。
3. 每新增一个 Tauri 命令，Rust 侧要有测试，`src/ipc/` 的封装要有测试，两边的 payload 字段名必须一致（漂移类测试已有先例：`*DefinitionDrift.test.ts`）。

## 3. 本地命令白名单与禁止清单

**本机受管安全软件会拦截 Rust 测试二进制**（见 §5.2 风险 1）。因此 Rust 测试在本地**不能**被当作验证手段，一律记为"未验证"。

| 命令 | 本地 | 理由 |
|---|---|---|
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | 允许 | 只装依赖，不执行脚本 |
| `pnpm test`、`pnpm test -- <文件>` | 允许 | 本次实测 267 文件 / 3567 用例通过；jsdom 内运行，不读写 home（见 §5.1） |
| `pnpm lint`、`pnpm typecheck` | 允许 | 本次实测通过，纯静态 |
| `pnpm corpus:validate` | 允许 | 只读仓库内产物（`validate-corpus.mjs:1-12`），本次实测通过 |
| `pnpm build`（= typecheck + `vite build`） | 允许 | 只产出 `dist/`；**[推断]** 未在本次调查中运行 |
| `cargo fmt --check` | 允许 | 不产生测试二进制 |
| `cargo test`、`cargo clippy`、`cargo build`、`pnpm check:rust`、`pnpm check` | **禁止** | `check:rust` 与 `check` 内含 `cargo test`（`package.json` scripts）；clippy/build 会触发编译 build script 与二进制，同属被拦截风险，**[待用户确认]** 是否放开（见 §10 Q1） |
| `pnpm test:e2e`、`pnpm build:e2e` | **默认禁止；仅在用户于当前对话中明确要求运行 e2e 时才可运行**（Q2 已决定） | 会构建并启动真实 Tauri 应用；见下方分析与授权规则 |
| `pnpm build:unsigned`、`pnpm tauri *` | 禁止 | 全量 release 构建并可能拉起应用，只在 CI 或人工 |
| `pnpm corpus:refresh`、`pnpm corpus:build` | 禁止 | 联网并改写仓库内产物，属发布/语料维护操作 |

**E2E 为何默认禁止本地运行：**

- `wdio.conf.ts:13-14, 74-75` 已把 `HOME` 与 `XDG_CONFIG_HOME` 指向 `mkdtemp` 目录，写入类配置不会落到真实 `~`。
- 但隔离是**不完整**的：`/bin/launchctl`、Homebrew 前缀（`/opt/homebrew`）、`/etc/ssh/ssh_config` 都不是 HOME 派生路径（`config/mod.rs:46`、`environment/launchctl.rs:30`、`app_config/registry.rs:510`），
  应用启动即会读取真实登录会话与真实 Homebrew 清单（`release-readiness.md:97` 记录过一次真实 Homebrew 清单超时导致 e2e 失败）。
- 它会启动真实 GUI 进程与 WebDriver；产物二进制 `src-tauri/target/debug/userhome` 同样会被安全软件拦截。**[推断]** 同 Rust 测试。
- 结论：默认由 CI 的 macOS runner 运行；本地 agent 不得运行，除非满足下列授权规则。

**本地运行 e2e 的授权规则（Q2 已决定）：**

- 只有**用户在当前对话里明确要求运行 e2e**，才可以运行 `pnpm test:e2e` 或 `pnpm build:e2e`。
- agent 不得自行判断"需要跑 e2e"，也不得主动提议后自己执行；想建议跑时只能写进汇报，由用户决定。
- 授权只对用户当次明确要求的那一次运行有效，不得当成以后都可以；下一次要跑需用户再次明确要求。
- worker 只有在协调者转述了用户的明确要求时才能运行；协调者不得替用户做这个决定。
- 运行结果按 §6 如实报告：给出命令与实际输出，首轮失败必须记录。

## 4. 前端如何 mock Tauri `invoke`

两种方式并存，按需选择：

1. **命令级**：`mockIPC((command, payload) => ...)`，来自 `@tauri-apps/api/mocks`（如 `src/features/ai-config/AiConfigPage.test.tsx:48`）。
   `src/test/setup.ts` 在每个用例后统一 `clearMocks()`、`vi.unstubAllGlobals()`，并把 `navigator.language` 固定为 `zh-CN`。
   优点：走完整的 `src/ipc/*` 封装，能暴露命令名或 payload 字段写错。
2. **模块级**：`vi.mock("../ipc/xxx", ...)`，多用 `importOriginal` 只替换个别导出（如 `src/features/app-config/AppConfigPage.test.tsx:12`）。
   用于页面测试里隔离 IPC；**会绕过封装本身**，所以封装必须另有 `src/ipc/*.test.ts` 覆盖。

要求：`mockIPC` 的未知命令必须显式报错或断言，不得 `return undefined` 吞掉；mock 返回值的字段名取自 Rust 的 serde 定义，不得凭记忆编造。

## 5. HOME 隔离

### 5.1 现状（按层）

| 层 | 是否支持重定向 | 机制与证据 | 会不会碰真实 `~` |
|---|---|---|---|
| Vitest | 不涉及 | 全部在 jsdom 内；读 `node:fs` 的测试只读仓库源码（样式审计、漂移检查，如 `AiConfigStyleAudit.test.ts`）；`homedir`/`process.env.HOME` 在测试中 0 处出现 | 否（grep 实测） |
| Rust 单元 | **是，靠依赖注入** | `ConfigEnvironment::new(home, brew_prefix, backup_root)`（`config/mod.rs:27`）；测试一律传入 `temp_dir()/userhome-*-<uuid>` 下的路径，例如 `grants/launch_agent_tests.rs:38-45`、`services/create/tests.rs:1067`、`config/backup.rs:430-436`；`SettingsStore`、`GrantStore` 同样接收目录参数（`settings/store.rs:233`、`grants/tests.rs:22-37`） | 构造路径上否。`ConfigEnvironment::from_environment()` 只在 `ConfigCoordinator::default()`（`config/mod.rs:102`）调用，后者只在 `lib.rs:43` 的应用入口使用；全仓无 `set_var`/`remove_var`（grep 实测） |
| Rust 外部命令 | **部分** | 命令执行经可替换的 runner trait：`services/launchd/command.rs:217`（`CommandRunner`）、`caddy/validate.rs:204`（`CaddyRunner`）、`caddy/detect.rs:141`（`VersionRunner`）、`services/lifecycle/command.rs:192`（`MutatingRunner`），测试用 fake（如 `services/snapshot/tests.rs:242`） | 这些路径不碰。**例外：`environment/launchctl.rs` 直接经 `process` 模块调 `/bin/launchctl`（`:30`、`:244`、`:456`、`:471`），无 runner trait 抽象，且文件内 0 个 `#[test]`**（grep 实测）：无法在不改真实登录会话的前提下测试 `set_value`/`unset_value` |
| Rust 集成 | 不涉及 | `src-tauri/tests/*.rs` 只含 fake 时钟、fake ID、进程会话，不读 HOME | 否（grep 实测：无 `HOME` 命中） |
| 应用本体（e2e / 真机） | **是，靠环境变量** | `config/mod.rs:42` 读 `HOME`、`:57` 读 `XDG_CONFIG_HOME`；`commands/grants.rs:256` 的 `canonical_home()` 读 `HOME`；Tauri `app_config_dir()`（`lib.rs:50`）在 macOS 上由 `HOME` 派生 **[推断]**，`wdio.conf.ts:25-30` 预置的 `Library/Application Support/com.zephyr194.userhome/preferences.json` 依赖此点 | 见下 |
| E2E | **部分** | `wdio.conf.ts:13-14` `mkdtempSync`，`:74-75` 注入 `HOME`/`XDG_CONFIG_HOME`，`:16-23` 进程退出时清理；预置偏好 `optionalDiscoveryRoots: []`（`:47`）；文件选择器在 `e2e` feature 下换成 `FixturePicker`（`commands/grants.rs:76-90`，环境变量 `USERHOME_E2E_PICKER_DIR`） | 配置文件不会；**launchctl 读、Homebrew 前缀读、`/etc/ssh/ssh_config` 读仍是真实的**（见 §3）。当前 spec 未调用任何写类命令（`e2e/smoke.spec.ts` 无 `launchctl`/`Library` 命中） |

### 5.2 风险

1. **Rust 本地测试被拦截**：HOME 注入再好也验证不了，只能靠 CI（见 §3）。
2. `environment/launchctl.rs` 无注入点：任何调用 `set_value`/`unset_value`/`read_environment` 的测试都会改动或读取运行者的真实登录会话。目前无这样的测试；未来 agent 容易为了"补覆盖"直接加。
3. 非 HOME 派生的真实路径：`/opt/homebrew`、`/usr/local`、`/etc/ssh/ssh_config`、系统域 launchd 目录 `/Library/LaunchDaemons` 都不受 `HOME` 重定向影响。
4. `from_environment()` 的默认回退：`HOME` 为空或缺失时报错而非回退到真实用户目录，这是好的（`config/mod.rs:42-45`）；但若有人在测试里手动设置 `HOME` 为真实路径就失效。
5. 磁盘上残留：e2e 异常终止时 `userhome-e2e-home-*` 临时目录可能遗留（清理依赖 `process.once("exit")`，`wdio.conf.ts:16`，SIGKILL 不触发）。

### 5.3 要求

- **任何会写 home 的测试必须使用临时目录**，路径形如 `temp_dir()/userhome-<主题>-<uuid>`，并经 `ConfigEnvironment::new(...)` 或各 Store 的目录参数注入；禁止在测试里读 `$HOME`、`dirs::home_dir()`、`~`。
- 禁止在测试中 `std::env::set_var("HOME", ...)`（进程内全局、并发不安全，Rust 2024 中为 `unsafe`）。
- 新增读写文件的 Rust 代码，必须接收 base dir 参数（或 `ConfigEnvironment`），不得在函数内部自行解析 `HOME`；解析只允许在 `from_environment` / `canonical_home` 两处。
- 测试内禁止调用真实的 `launchctl`、`brew`、`caddy`、`osascript`、`sudo`；一律走 runner trait + fake。
- 写 home 的 e2e 流程必须同时满足：注入临时 `HOME`、`USERHOME_E2E_PICKER_DIR` 指向临时目录、断言前后真实 `~` 未变化 `[待定]`。

### 5.4 待办（现状做不到的部分）

| # | 待办 | 建议实现 |
|---|---|---|
| T1 | `environment/launchctl.rs` 缺注入点和测试 | 引入与 `services/launchd/command.rs:217` 一致的 runner trait，生产用 `/bin/launchctl`，测试用 fake；先补 `preview_set`/`set_value`/`unset_value` 的 fake 测试 |
| T2 | Homebrew 前缀不可重定向 | `ConfigEnvironment::new` 已接受 `brew_prefix`；`from_environment` 增加 `USERHOME_BREW_PREFIX` 覆盖，仅在 `e2e` feature 下生效，避免生产被环境变量劫持 |
| T3 | e2e 仍读真实 launchctl | `e2e` feature 下把 launchctl runner 换成 fixture（同 `FixturePicker` 的做法，`commands/grants.rs:81-90`） |
| T4 | 缺少"真实 `~` 未被修改"的守卫 | 在 `wdio.conf.ts` 的 `onPrepare`/`onComplete` 对真实 `~/Library/LaunchAgents`、`~/.zshrc`、`~/.config` 做文件名+mtime 快照比对，变化即失败 `[待定]` |
| T5 | e2e 临时目录遗留 | 临时目录前缀已固定，增加启动时清理超过 1 天的 `userhome-e2e-home-*` |

## 6. "已验证"的证据等级

agent 在报告中**必须写明等级**，不得只写"已验证"。等级从高到低：

| 等级 | 含义 | 本机可达 | 示例写法 |
|---|---|---|---|
| A 自动测试通过 | 对应层的测试**实际运行**且通过，并给出命令、通过/失败数 | 仅 L1（Vitest）、L4 | "A：`pnpm test` 267 文件 3567 用例通过" |
| A-CI 自动测试在 CI 通过 | PR 或 `main` 上对应 job 为绿，给出 job 名与运行链接 | 否（需 CI） | "A-CI：`rust` job 通过，见 run #…" |
| B 类型/静态检查通过 | `pnpm typecheck`、`pnpm lint`、`cargo fmt --check` 通过，但无行为测试 | 是 | "B：typecheck + lint 通过，行为未测" |
| C 仅人工推断 | 读代码得出结论，未运行任何东西 | 是 | "C：读 `config/mod.rs:42` 推断，未运行" |
| D 未验证 | 未运行或被禁止运行 | 是 | "D：Rust 测试，本地禁止，待 CI" |

规则：

1. **Rust 改动在本地永远是 D**，直到 CI 的 `rust` job 通过后升为 A-CI。不得因 `cargo check` 之类的间接信号提升等级。
2. E2E 在本地默认是 D（默认禁止运行），只有 CI 的 `e2e` job 通过才是 A-CI；用户明确要求并实际在本地运行时，如实报告命令与输出，不因此升为 A-CI。
3. 一个报告里每个声明单独标注等级；只有最低等级决定"整体已验证"的说法。
4. 测试未运行或失败时必须如实写出输出，禁止写"应该通过"。
5. e2e 的非确定性（见 `release-readiness.md:97` 的首轮失败后重跑通过）必须记录首轮结果，不得只报重跑成绩。

## 7. 必须人工验收

agent **不得**在真机桌面上使用 `computer-use` 或任何 GUI 自动化操作（会干扰用户实际工作）；这类验收记为"待人工"，由用户在真机执行。

| 事项 | 为什么不能自动化 | 清单位置 |
|---|---|---|
| 真机 GUI 验收（窗口、托盘、关闭仅隐藏、深色/浅色、拖拽、多屏） | e2e 只覆盖冒烟，且 WebDriver 不等价于真实使用 | `ui-correction-acceptance-v3.md` |
| 提权操作（写 `/Library/LaunchDaemons`、系统域 launchd 动作） | 需要管理员授权对话框；helper 整链已移除（`elevation-checklist.md` 顶部），不得据历史清单执行 | `elevation-checklist.md`（已作废，仅历史） |
| 真实 Caddy 启停与反代验证 | 要求用户批准后才启动 Caddy（`caddy-acceptance.md:3-8`） | `caddy-acceptance.md` |
| 真实 `launchctl setenv/unsetenv`、真实 launchd 服务创建与采纳 | 修改登录会话/系统状态，T1 完成前无法安全自动化 | 在隔离 HOME 的一次性账户中手动验收 |
| 签名、公证、打包、更新分发 | 需要开发者证书与受保护 runner；PR 构建是无签名的 | `release.md`、`release-readiness.md` |
| 真实用户配置的迁移与备份恢复（有数据的 home） | 只能在用户同意的一次性环境进行 | `backup-and-restore.md` |

人工验收的报告格式：做了什么、在哪台机器/哪个 HOME、结果；未做的写"待人工"，**不预填结果**。

## 8. 新增/修改功能的最低测试要求与禁止做法

### 8.1 最低要求

| 改动 | 最低要求 |
|---|---|
| 新增/修改 React 组件 | 对应 `*.test.tsx`：渲染、关键交互、中文文案；有英文分支时加英文用例；异常/空态至少各一个 |
| 新增/修改 `src/ipc/*` 封装 | `src/ipc/*.test.ts`，用 `mockIPC` 断言命令名与 payload 字段 |
| 新增/修改 Tauri 命令 | Rust 单元测试（成功、参数非法、权限/越界各一）；命令注册进 `lib.rs`；前端封装测试；IPC 契约有变更时同步 `src-tauri/tests/ipc_contract.rs` |
| 触碰文件写入、备份、授权、launchd、环境变量 | 必须有临时目录或 fake runner 的测试，含失败路径与回滚；不得只测 happy path |
| Bug 修复 | 先写能复现的失败用例，再修；报告中说明用例修复前失败 |
| 调整 catalog/语料 | `pnpm corpus:validate` 通过；Rust `catalog` 集成测试（CI） |
| 仅文案/样式 | 现有样式审计测试仍通过；新增令牌需被审计测试覆盖 |
| 仅文档 | 无测试要求，但不得声称影响行为 |

提交前（本地）：`pnpm lint && pnpm typecheck && pnpm test`。涉及 Rust 的 PR，在说明里写"Rust：D，待 CI"。

### 8.2 禁止做法

- `it.skip` / `describe.skip` / `it.todo` 代替失败测试；Rust 的 `#[ignore]` 同理（需用户批准）。
- 删除或弱化断言（改成 `toBeTruthy`、删掉 `expect`、把精确值改成 `any`）。
- 降低阈值、放宽超时、扩大白名单让检查通过（包括校验脚本中的 `minimumFormulaRecords` 之类，`validate-corpus.mjs:19-22`）。
- 用 mock 掩盖真实行为：mock 返回值与 Rust serde 定义不一致；mock 掉被测对象本身；把真实错误路径 mock 成永远成功。
- 用 `@ts-ignore` / `eslint-disable` / `as any` 压制报错；或修改 ESLint 忽略列表以绕过检查。
- 为让测试通过而修改测试期望值，却不说明产品行为为何应当改变。
- 在测试中调用真实 `launchctl`/`brew`/`caddy`/`sudo`，或读写真实 `~`（见 §5.3）。
- 绕过本机安全软件的拦截（改名、签名、换目录运行 Rust 测试二进制）：原因未定，不得绕过，记为 D。
- 以"重跑通过"掩盖不稳定用例，而不记录首轮失败。

## 9. CI 现状与缺口

`.github/workflows/ci.yml`：`frontend`（ubuntu：lint、typecheck、test、build）、`rust`（macos：`pnpm check:rust`）、`e2e`（macos：`pnpm test:e2e`）、`unsigned-build`（macos）。

- 缺口：`pnpm corpus:validate` 未在 CI 运行 → 建议加入 `frontend` job（只读、秒级）。
- 已决定（Q5）：CI 在 `pull_request`、push 到 `main` 与 `workflow_dispatch` 时触发，合并到 `main` 后也会运行。`unsigned-build` 的 artifact 上传步骤仍只在 `pull_request` 事件执行。
- 注意：CI 的 `e2e` 同样使用 `wdio.conf.ts` 的临时 HOME，但 runner 上的 launchctl/Homebrew 是真实的，与 §5.1 同。
- `Cargo.toml` 的 `e2e` feature 只引入 wdio 插件（`Cargo.toml:20`），并在 `commands/grants.rs:76-90` 替换文件选择器；它**不**提供 HOME 重定向，重定向全部来自 `wdio.conf.ts` 注入的环境变量。

## 10. 待用户决定

| # | 问题 | 我的建议 |
|---|---|---|
| Q1 | `cargo clippy` / `cargo build` / `cargo fmt --check` 本地是否放开？拦截是否只针对测试二进制？ | 放开 `fmt --check`；clippy/build 先请用户实测一次再定，在此之前按禁止处理。原因未定，不绕过 |
| Q2 | `pnpm test:e2e` 本地：完全禁止，还是允许在用户明确批准后由 agent 运行？ | **已决定：默认禁止；只有用户在当前对话里明确要求运行 e2e 时才可运行。** agent 不得自行判断需要跑、不得主动提议后自己执行、不得把一次授权当成以后都可以；worker 只有在协调者转述了用户的明确要求时才能运行（见 §3）。T3 完成后再重新评估 |
| Q3 | 是否立即做 T1（`launchctl.rs` 的 runner 注入）？ | 做，且列为优先级最高：它是唯一无法在不改真实登录会话下测试的写类路径 |
| Q4 | 是否做 T2/T3（e2e feature 下重定向 Homebrew 前缀与 launchctl）？ | 做 T3；T2 仅 `e2e` feature 内生效，避免生产被环境变量改写 |
| Q5 | CI 是否增加 `push` 到 `main` 的触发？ | **已决定：push 到 main 时触发 CI**（`ci.yml` 已加 `push: branches: [main]`）。Rust 测试只能在 CI 验证，合并后更需要兜底 |
| Q6 | `pnpm corpus:validate` 是否加入 CI？ | 加入 `frontend` job |
| Q7 | 是否要求每个 PR 说明用 §6 的证据等级格式（A/A-CI/B/C/D）？ | 要求，写进 PR 模板 |
| Q8 | 是否加入 vitest 覆盖率阈值，还是继续以"每个功能最低测试要求"为准？ | 暂不加阈值（3567 用例已多，数字阈值易被刷）；按 §8.1 执行并用 review 把关 |
| Q9 | T4（真实 `~` 快照守卫）是否做、放在 wdio 里还是 CI 里？ | 放在 `wdio.conf.ts`，仅 CI 运行 |
| Q10 | `docs/elevation-checklist.md` 已作废，是否归档，避免 agent 误执行？ | 归档到 `docs/archive/` 或在文件名加 `-deprecated` |
