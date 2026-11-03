# UserHome 产品收敛：开发者本机的工具配置台

日期：2026-11-03
状态：头脑风暴收敛稿。入口形态已定为 A（2026-11-03）；Open Questions 暂时保留。下一步先写 `docs/intent/`，再写规格；确认前不实现。

## 核心（用户原话，2026-11-03）

> 我期望我电脑应用和配置透明化，在这个基础上可以支持本机安装的 AI 工具能够可视化配置，资源（skill/mcp）可视化。
>
> 更细节说 npm 的配置、maven 配置、rust 配置等等。这些我认为你应该知道，而不是等我去细化。

第二句定下了分工：**用户给方向和验收，工具知识（每个工具的配置在哪、哪些项重要、怎么看有效值、怎么确认生效）由产品和 agent 提供。** 不再等用户逐个工具细化。

## 产品结构：以 `~` 为底座的四层

用户补充（2026-11-03）：“核心还是 `~` 目录，不能少了这个，用户目录，大量各种配置混杂其中。”

| 层 | 范围 | 做到什么程度 |
|---|---|---|
| 0. 家目录地图（底座） | `~` 下的条目：点文件、`~/.config/*`、`~/Library/Application Support/*` 等 | 每个条目归属到哪个工具、属于哪一类（配置 / 凭证 / 缓存 / 工具链与运行时 / 数据）、大小、最近修改时间；**无人认领的条目单独列出** |
| 1. 透明层 | 本机所有开发工具（brew、npm -g、uv tool、cargo install、原生安装器、/Applications 等来源） | 装了什么、版本、安装来源；每个工具按“五个维度”显示有效值与来源层。先只读，可跳转到文件原样编辑 |
| 2. AI 工具配置层 | 本机安装的 AI 工具（Claude Code、Codex、Gemini CLI、Copilot CLI 等） | 包含全部配置项的表单，由官方 schema 生成，改完确认生效 |
| 3. AI 资源层 | Skill 与 MCP | 跨 agent 矩阵：在哪些 agent 可用、来自哪里、版本是否一致，勾选即同步 |

第 0 层与第 1 层共用同一份工具知识：工具描述里写明“它拥有 `~` 下哪些路径、分别是什么类别”。从地图点进条目看到工具卡片，从工具卡片也能反查它在 `~` 里占了哪些地方。仓库已有的 `export_sanitized_baseline`（见 `docs/home-baseline-coverage.md`）做过 `~` 的有界扫描与分类，可作为第 0 层的起点评估是否复用。

### 透明层的五个维度

开发工具的配置项很多，但开发者真正会去查、去改的，几乎都落在这五类。每个工具一张卡片，固定这五行，新增工具就是填一张卡片，而不是做一个新功能：

| 维度 | 回答的问题 | 例子 |
|---|---|---|
| 源 / 镜像 | 包从哪里下载 | npm `registry`、Maven `mirror`、cargo `replace-with`、pip `index-url`、`GOPROXY` |
| 凭证 | 用什么身份访问私有源（只显示是否已配置，值一律遮盖） | npm `_authToken`、Maven `server`、cargo `credentials.toml` |
| 网络 | 代理与证书 | `proxy`/`https-proxy`、`cafile`、`strict-ssl`、Maven `proxies` |
| 位置 | 装到哪、缓存在哪 | npm `prefix`/`cache`、Maven `localRepository`、`CARGO_HOME`、`GOPATH` |
| 版本 / 工具链 | 当前用的哪个版本、由谁决定 | Node 版本管理器、`JAVA_HOME`、`rust-toolchain.toml`、`rustup default` |

每一行都要显示：**有效值、来自哪一层（项目 / 用户 / 全局 / 环境变量 / 默认）、被谁覆盖**，并给出确认生效的方法。工具知识见附录。

## 为什么始终不称心

用户原话要点：

- “产品规划糟糕透了，虽然一点点添加了我需要的功能，但是实际打开的体感很差，不知道怎么用。”
- “agent 原本设计很糟糕，具体功能上含糊不清，反而不管经验的设计页搞得花里胡哨。”
- 使用方式：“真正会主动配置的很少，只有用到想起来，去查询，去配置。”

仓库里的证据（截至 2026-11-03）：

- 676 次提交，30 多份规格，其中 11 份是主题与 UI（theme、accent、motion、refine、tokens、bay、nav 等）。
- 环境、服务、概览各重做过一轮；“应用与配置”“软件”已退出主导航。
- 旧 Catalog 的 6 个手写适配器（caddy、copilot、git、npm、ssh、zsh）已在 `7ac138d` 整体移除。
- AI 配置中 Claude 的 245 个设置有 216 个类型为 `unknown`，只能展示。
- SKILLHUB 是从网页速查表搬来的 123 条静态数据，与本机实际安装无关。

诊断：

1. **按模块堆功能，没有按任务设计。** 每个页面回答“这里有什么”，没有一个回答“我要做的事怎么做完”。
2. **首页假设用户来浏览，实际用户每次都带着一件具体的事来。** 打开先看到概览、计数和状态，要做的事藏在导航里。
3. **“所有工具可配置”按工具逐个手写适配器，永远做不完。** 用户看到的总是“大部分还不能配”。
4. **视觉投入替代了功能定义。** 功能的完成标准含糊，所以只能在外观上反复打磨。

## Problem Statement

怎样让我带着一件具体的配置事情打开 UserHome 后，3 秒内开始做，做完能确认它真的生效了？

## 用户与使用方式

- 用户只有本人。以后用得顺手，再考虑给同事用；团队分发现在不做。
- 用到才想起来：带着具体的事打开，做完就走，不会浏览。

## Recommended Direction

一句话定位：**开发者本机的工具配置台：找到选项、看清有效值、确认生效。**

1. **入口以意图为先。** 打开后第一屏是焦点在输入框的命令面板（如“caddy 加规则”“mcp 同步到 codex”），回车直接进入该任务，而不是模块首页。模块页退为二级。
2. **每个任务走完一条完整路径**：找到 → 看有效值 → 修改 → 生效 → 确认。缺任何一环都不算完成。
3. **首批任务按使用频率选**：Caddy；Skill 与 MCP 的跨 agent 矩阵（需先完成盘点验证）。Maven 改动频率低，只做有效值只读页。
4. **覆盖范围按“四层结构”和“五个维度”扩展，不按工具逐个手写功能。** 工具知识用数据描述（配置层、关键项、查看与确认命令），由 agent 起草、用户核对；AI 工具的完整表单由官方 schema 生成。

## 首批任务与完成标准

功能必须写清楚“一句话意图、完成标准、确认方式”才进规格。

| 任务 | 一句话意图（示例） | 完成标准 | 确认方式 |
|---|---|---|---|
| Caddy 加反代规则 | “把 foo.test 指向 3000” | 从打开应用到规则生效不超过 3 步 | 请求本地域名得到上游响应 |
| Caddy 查看生效中的规则 | “现在 caddy 跑的是什么” | 并排显示文件里的规则与运行实例实际加载的配置，标出差异 | 运行实例的实际配置（如实例开启 admin 接口） |
| MCP 装到多个 agent | “figma mcp 也给 codex 用” | 矩阵中勾选即写入各 agent 的配置格式，带 diff 与备份 | 各 agent 自己的 `mcp list` 回读 |
| Skill 跨 agent 可见 | “这个 skill codex 能不能用” | 矩阵显示每个 Skill 在各 agent 中是否可用、来自哪里 | 读取各 agent 的 skill 目录 |
| Maven 私服（低频） | “现在用的是哪个私服” | 只读显示有效设置及其来源层 | `mvn help:effective-settings` |

矩阵示意：

```
              Claude   Codex   Gemini   Copilot
mcp: figma      ✓       ✗        ✓       ✗
mcp: fxcli      ✓ v2    ✓ v1     ✗       ✗     ← 版本不一致
skill: tdd      ✓       ✓        —       —
```

## 打开体验的目标

由反向头脑风暴（“怎样把打开体验做到最糟”）反推：

| 现在的问题 | 目标 |
|---|---|
| 打开先转圈等扫描 | 先显示上次的缓存，后台刷新 |
| 首页是没人问的计数和状态 | 第一屏是“你要做什么” |
| 要做的事藏在第二、三层 | 回车一步到达任务 |
| 说明文字、只读标记、安全提示铺满 | 控件本身表达含义 |
| 很多东西点不动或“未检测到” | 做不了的事不占首屏 |
| 打开一次很“重” | 托盘或全局快捷键唤起轻量入口，大窗口只在细看时使用 |

## 入口形态：A 与 B

| | A：UserHome 内置命令面板 | B：做成 Raycast 扩展 |
|---|---|---|
| 是什么 | 在现有 Tauri 应用里加快捷键唤起的面板，作为主入口 | 核心任务写成 Raycast 命令，面板、搜索、快捷键由 Raycast 提供 |
| 要自己做的 | 面板、搜索、全局快捷键 | 只写命令；但 Rust 后端逻辑要用 Node 重写，或包装成 CLI 供调用 |
| 界面能力 | 不受限：矩阵、完整配置表单都能做 | 受限于 Raycast 的列表、表单、详情组件，做不了宽矩阵和大表单 |
| 依赖 | 无 | 本机须装 Raycast |
| 已有投入 | 复用现有后端和页面 | 现有应用大部分退居二线 |

**已定：A**（用户确认，2026-11-03）。理由：用户心里的可视化是“包含所有配置项的表单”，矩阵也需要宽屏，这两样 Raycast 都承载不好；现有 Caddy、环境变量等 Rust 后端也能直接复用。B 不做。

## Not Doing (and Why)

- **“所有工具”全覆盖**：先把首批任务走通。按工具逐个手写适配器已经被证明做不完。
- **团队分发与配置包**：用户只有本人。
- **Maven 作为主打**：一次改完很久不动，频率低。
- **新的主题与视觉规格**：冻结，等首批任务的完整路径通过后再议。
- **变更时间线作为主产品**：降为以后可能加在“工具→配置”结构上的一层视图。
- **跨工具配方（代理、镜像、遥测等）**：用户表示不一定需要。

## Key Assumptions to Validate

- [ ] **打开不称心主要是结构问题（入口、首页），而不是视觉问题。** 验证：下次真的需要 Caddy 时，从打开到加完一条规则，记下每一步、耗时和最烦的那一步。
- [ ] **跨 agent 的 MCP 与 Skill 不一致真实存在且频繁。** 验证：花 10 分钟手工盘点四个 agent 的 MCP 和 Skill，数出不一致项。几乎一致就放弃矩阵，改把 Caddy 做深。
- [ ] **“用到才想起来”的需求能用一句话表达，并对应到具体任务。** 验证：两周内每次想配置某个工具时记下那句话，攒 10 句后归类。
- [ ] **命令面板比导航更顺手。** 验证：先只为 Caddy 的两个任务做面板入口，用一周后对比。

## 对 agent 协作的约束建议

- 规格先写“任务 + 完成标准 + 确认方式”，再写页面；没有完成标准的功能不进规格。
- 视觉类规格冻结，直到首批任务路径通过。

## Open Questions

- 概览页的去留：删除，降为二级，还是改成“最近做过的任务”？
- 文本与二维码工具是否移出主导航？
- 环境变量与服务作为独立入口保留，还是只作为工具配置的载体出现在任务中？
- 命令面板的形态：主窗口里的输入框，还是全局快捷键唤起的独立小窗？

## 下一步

1. 用户确认四层结构与五个维度。
2. 完成两项验证：Caddy 任务的步骤与耗时记录、MCP/Skill 盘点。
3. agent 按本机实际安装清单补全附录中的工具知识，用户只核对。
4. 根据验证结果写 `docs/intent/`，再写规格。

## 附录：本机安装实测（2026-11-03，用户授权只读运行）

- `brew list --formula`：66 个，其中大半是依赖库（ffmpeg 的编解码库、llvm、openssl 等）。透明层应默认只显示用户主动安装的顶层包（`brew leaves`），依赖折叠。
- 与“五个维度”相关的开发工具：git、gh、glab、go、rust（brew 安装，rustup 是否另装未检查）、uv、pyenv、nvm、sdkman-cli、caddy、mkcert。
- 终端与编辑环境：neovim、starship、zoxide、eza、bat、zsh-autosuggestions、zsh-syntax-highlighting。
- `npm ls -g --depth=0`（当前 shell 的 nvm Node v22.23.4）：@google/gemini-cli、@langfuse/cli、corepack、npm。
- `pipx`：未安装。
- Claude Code、Codex、Copilot CLI 不在 brew formula 和 npm 全局包中，说明 AI 工具的安装渠道分散（npm、原生安装器、cask 等），只看包管理器会漏。透明层需要按“可执行文件在哪、谁安装的”来识别。
- 版本管理器有四个：nvm（Node）、sdkman（JDK 等）、pyenv（Python）、uv（Python）。“当前目录用的是哪个版本、由谁决定”是“版本 / 工具链”维度的重点。例：本项目要求 Node 24.21.0，而当前 shell 的默认 Node 是 v22.23.4。

## 附录：家目录地图实测发现（2026-11-03，用户授权只读列名）

只列了 `~`、`~/.config`、`~/Library/Application Support` 的条目名称，以及 `brew leaves`、`brew list --cask`、`uv tool list`、`which`，没有读取任何文件内容。逐条归属的草稿只在对话中给出，不进仓库（含个人应用信息）。对产品设计有用的规律：

1. **一个工具散落在多处。** 例如 Claude 有 `~/.claude`、`~/.claude.json`、`Application Support/Claude`、`Application Support/Claude-3p` 四处；Codex 有 `~/.codex` 与 `Application Support` 下三个目录；git 同时有 `~/.gitconfig` 和 `~/.config/git`；有的应用在 `~` 顶层、`~/.config`、`Application Support` 共占四处。**地图默认要按工具聚合，而不是按路径罗列。**
2. **配置位置没有统一约定。** gh、starship 用 `~/.config`；glab、poetry、zoxide、Go 的 `go env -w` 用 `Application Support`；Maven、cargo、nvm、pyenv 用 `~` 下的点目录。用户找不到配置在哪，正是工具知识要解决的问题。
3. **同类东西有多份。** 本地 HTTPS 证书相关目录有三处（mkcert、vite-plugin-mkcert、devcert）；版本管理器有四个；AI agent 类工具至少八个（Claude Code、Codex、Gemini CLI、Copilot CLI、OpenCode、Orca、multica、browser-use 等）。
4. **有效值和直觉不一致。** 本机没有 rustup（`which rustup` 无结果），rust 来自 brew（`rustc 1.99.0 (Homebrew)`），所以 `rust-toolchain.toml` 这类由 rustup 读取的文件在本机不起作用；当前 shell 的 Node 是 v22，项目要求 24。这类发现正是“五个维度”的价值。
5. **存在无人认领的条目。** 如 `~` 顶层的零散文本文件、`Application Support` 顶层的 `default.store` 系列文件（看起来像某个应用没放进自己子目录的 SwiftData 默认存储）、安装来源不明的工具配置目录。地图要单独列出这些。
6. **有公司受管软件的目录。** 应归为“受管软件”类，只显示、不提供任何修改或清理入口。

由此，地图的分类建议为：配置、凭证、缓存（可清理）、工具链与运行时、应用数据、受管软件、个人文件、未认领。

用户核对结果（2026-11-03）：未认领条目中，用户只认出一个是公司内部应用的构建配置，其余（零散文本文件、`default.store` 系列、两个来源不明的工具配置目录等）都不认识。“透明化”在第一次盘点里就发现了用户不知道的东西。

用户补充的两条原则：

- **位置无所谓，关键是可识别。** 不追求规范配置放在哪里，而是让每个条目都能认出归属。识别不了的，用户可以**手动认领**：给条目指定归属工具和类别，记录在 UserHome 自己的偏好里，下次盘点沿用。
- **发现版本不一致时，要能识别安装来源并调用对应的升级命令。** 例：rust 由 brew 安装（本机无 rustup，`rustc 1.99.0 (Homebrew)`），升级走 `brew upgrade rust`；Node 由 nvm 管理，切换或安装走 `nvm`。透明层的每个工具卡片都要显示安装来源（brew formula、brew cask、npm -g、nvm、pyenv、sdkman、uv tool、原生安装器、App Store 等），并给出该来源对应的升级命令。执行方式沿用 `docs/ideas/visual-config.md` 的“生成命令后在终端打开”，由用户在终端里确认；是否由应用直接执行，在规格阶段再定。

## 附录：首批工具知识草稿

由 agent 起草，进入规格前逐条用官方文档核对。“层”从高优先级到低优先级排列。

| 工具 | 配置层（高 → 低） | 五个维度的关键项 | 看有效值 | 确认生效 |
|---|---|---|---|---|
| npm | 命令行参数 → 环境变量 `npm_config_*` → 项目 `.npmrc` → 用户 `~/.npmrc` → 全局 `$PREFIX/etc/npmrc` → 内置 | `registry`、`@scope:registry`、`//host/:_authToken`、`proxy`/`https-proxy`、`cafile`/`strict-ssl`、`prefix`、`cache` | `npm config list`（分来源列出）、`npm config ls -l`（含默认值） | `npm ping`、`npm view <包> version` |
| pnpm | 同样读取 `.npmrc`，另有 `pnpm config` 与工作区设置 | 同 npm，另有 `store-dir` | `pnpm config list` | `pnpm view <包> version` |
| Maven | 命令行 `-s`/`-D` 与 `.mvn/maven.config` → 用户 `~/.m2/settings.xml` → 全局 `${maven.home}/conf/settings.xml`；另有 `MAVEN_OPTS`、`~/.mavenrc`、`settings-security.xml`、`toolchains.xml` | `mirrors`（`mirrorOf`）、`servers`（凭证）、`profiles`/`activeProfiles`、`proxies`、`localRepository`、`offline` | `mvn help:effective-settings`、`mvn help:active-profiles`、`mvn -v` | `mvn dependency:get -Dartifact=<坐标>` |
| JDK | `JAVA_HOME` → 版本管理器（SDKMAN、jenv、mise 等）→ 系统默认 | 当前 JDK 版本与路径 | `/usr/libexec/java_home -V`、`java -version` | `mvn -v` 显示的 Java 版本 |
| rustup | 环境变量 `RUSTUP_TOOLCHAIN` → 目录 override → 项目 `rust-toolchain.toml` → `~/.rustup/settings.toml` 默认 | 默认与生效工具链、`RUSTUP_DIST_SERVER`/`RUSTUP_UPDATE_ROOT`（镜像） | `rustup show` | `rustc -V` |
| cargo | 环境变量 `CARGO_*` → 当前目录逐级向上的 `.cargo/config.toml` → `$CARGO_HOME/config.toml`；凭证在 `$CARGO_HOME/credentials.toml` | `[source.crates-io] replace-with` 与镜像源、`[registries]`、`[http] proxy`、`[net] git-fetch-with-cli`、`[build] target-dir` | 稳定版无官方合并视图（`cargo config get` 仅 nightly），需由 UserHome 按层合并 | `cargo search <包> --limit 1` |
| pip | 环境变量 `PIP_*` → 站点 → 用户 `~/.config/pip/pip.conf` 等 → 全局 | `index-url`、`extra-index-url`、`trusted-host`、`proxy`、`cert` | `pip config list`、`pip config debug` | `pip download <包> --no-deps -d <临时目录>` |
| uv | 环境变量 `UV_*` → 项目 `uv.toml`/`pyproject.toml [tool.uv]` → 用户 `~/.config/uv/uv.toml` | `index`/`UV_DEFAULT_INDEX`、`native-tls`、`cache-dir`、Python 版本 | `uv python find`、读取各层文件 | `uv pip compile` 解析一个包 |
| Go | 环境变量 → `go env -w` 写入的 `~/Library/Application Support/go/env` → 默认 | `GOPROXY`、`GOPRIVATE`/`GONOSUMDB`、`GOPATH`、`GOTOOLCHAIN` | `go env` | `go list -m <模块>@latest` |
| Gradle | 命令行 `-P` → 项目 `gradle.properties` → `~/.gradle/gradle.properties` → `~/.gradle/init.d/*` | 仓库镜像（init 脚本）、代理 `systemProp.https.proxyHost`、`org.gradle.java.home` | `gradle properties` | 构建时解析依赖 |
| git | 仓库 local → 用户 global（`~/.gitconfig`、`~/.config/git/config`）→ system | `user.*`、`http.proxy`、`url.<base>.insteadOf`、`credential.helper`、`core.editor` | `git config --list --show-origin --show-scope` | `git ls-remote <内部仓库>` |
| Homebrew | 环境变量 `HOMEBREW_*`（通常写在 shell 启动文件） | `HOMEBREW_BOTTLE_DOMAIN`、`HOMEBREW_API_DOMAIN`、`HOMEBREW_NO_AUTO_UPDATE`、安装前缀 | `brew config` | `brew fetch <包>` |
