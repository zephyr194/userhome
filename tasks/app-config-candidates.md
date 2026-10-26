# APP-0 首批条目候选清单与来源核实

日期：2026-10-21
状态：门禁，待用户逐项答复。本文件中的条目**尚未进入注册表**；只有用户确认后才能进入 APP-1。
依据：SPEC-app-config.md（已批准）、tasks/todo.md 阶段 5c。

## 核实方法与限制

- 路径与格式只依据官方文档（官方仓库原文、官方网站文档、官方 man page）。未读取、未列出、未 stat 本机任何真实配置文件或目录（包括 `~/.ssh`、`~/Library/Application Support`、`~/.config`）。
- WebSearch 在本次会话中不可用，搜索结果均不作为来源；未找到官方来源的条目标为“待核实”，并写明缺什么。
- 规格约束已套用：`home` 路径不得落在 `~/.ssh`、`~/.gnupg`、`~/Library/Keychains` 下；`credentials` 只探测存在；`$HOME` 外固定项与 `Writable` 均单独列出。

## 一、候选条目（共 16 条：已核实 13，待核实 3）

| 序号 | 应用 | 配置文件路径 | 格式 | 建议能力等级 | 是否含秘密及遮盖建议 | 是否在 $HOME 外（fixed） | 核实状态 | 来源 | 核实日期 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Git（全局，传统位置） | `~/.gitconfig` | ini | ReadOnly | 含敏感键：键名匹配 token/password/secret/credential 的值遮盖；URL 中 `user:pass@` 段遮盖 | 否（home） | 已核实 | https://git-scm.com/docs/git-config （FILES 节） | 2026-10-21 |
| 2 | Git（全局，XDG 位置） | `~/.config/git/config`（`XDG_CONFIG_HOME` 未设置时；见裁决 3） | ini | ReadOnly | 同序号 1 | 否（home） | 已核实 | https://git-scm.com/docs/git-config （FILES 节：“If both files exist, both files are read”） | 2026-10-21 |
| 3 | Git 明文凭据库 | `~/.git-credentials` | text（每行一个 URL） | DiscoverOnly（credentials） | credentials：只探测存在，不读内容 | 否（home） | 已核实 | https://git-scm.com/docs/git-credential-store （“The `.git-credentials` file is stored in plaintext.”） | 2026-10-21 |
| 4 | npm 用户配置 | `~/.npmrc` | ini | DiscoverOnly（credentials，建议） | credentials：npm 文档列出 `_authToken` 等认证项，文件常含 token；见用户答复 ① | 否（home） | 已核实 | https://docs.npmjs.com/cli/v10/configuring-npm/npmrc （“$HOME/.npmrc”为默认用户配置） | 2026-10-21 |
| 5 | pnpm 认证文件 | `~/Library/Preferences/pnpm/auth.ini` | ini | DiscoverOnly（credentials） | credentials：认证专用文件，只探测存在 | 否（home） | 已核实 | https://pnpm.io/npmrc （认证文件为 `<pnpm config>/auth.ini`；macOS 目录为 `~/Library/Preferences/pnpm/`）；`XDG_CONFIG_HOME` 设置时路径不同，见裁决 3 | 2026-10-21 |
| 6 | VS Code 用户设置 | `~/Library/Application Support/Code/User/settings.json` | json（是否允许注释/尾逗号：**待核实**） | ReadOnly | 含敏感键：按键名遮盖（扩展类 token 类键） | 否（home） | **待核实** | 路径已核实：https://code.visualstudio.com/docs/getstarted/settings（macOS 路径原文）。缺：该页未说明注释/JSONC 语法，需官方文档或 VS Code 源码确认后才能定解析器 | 2026-10-21 |
| 7 | Cursor 用户设置 | `~/Library/Application Support/Cursor/User/settings.json` | json（待核实） | ReadOnly | 同序号 6 | 否（home） | **待核实** | 缺：未找到 Cursor 官方文档证实路径与格式（https://cursor.com/docs 与 https://cursor.com/docs/configuration/settings 无相关内容，后者返回 404）。该路径为 VS Code 派生推断，不得视为已核实 | 2026-10-21 |
| 8 | Zed 设置 | `~/.config/zed/settings.json` | jsonc（允许 `//` 注释） | ReadOnly | 含敏感键：按键名遮盖 | 否（home） | 已核实 | https://raw.githubusercontent.com/zed-industries/zed/main/docs/src/configuring-zed.md （官方仓库文档原文：macOS `~/.config/zed/settings.json`；“JSON with support for `//` comments”） | 2026-10-21 |
| 9 | Ghostty 配置 | `~/.config/ghostty/config.ghostty`（旧名 `config`；见裁决 4） | text（`key = value`，`#` 注释） | ReadOnly | 通常无秘密；如有按键名遮盖 | 否（home） | 已核实 | https://ghostty.org/docs/config （XDG 路径与格式原文） | 2026-10-21 |
| 10 | Alacritty | `~/.config/alacritty/alacritty.toml` | toml | ReadOnly | 通常无秘密；`env` 等键按键名遮盖 | 否（home） | 已核实 | https://alacritty.org/config-alacritty.html （UNIX 搜索路径列表；“uses the TOML format”） | 2026-10-21 |
| 11 | tmux | `~/.tmux.conf`（另 `~/.config/tmux/tmux.conf`，`XDG_CONFIG_HOME` 未设置时；见裁决 3） | text（tmux 命令语法） | ReadOnly | 无 | 否（home） | 已核实 | https://raw.githubusercontent.com/tmux/tmux/master/tmux.1 （`-f` 选项：`~/.tmux.conf` 或 `$XDG_CONFIG_HOME/tmux/tmux.conf`） | 2026-10-21 |
| 12 | Neovim | `~/.config/nvim/init.lua`（或 `init.vim`，二选一） | text（Lua/Vimscript 源码，只显示不执行） | ReadOnly（建议；秘密风险见裁决 6） | 无键值结构，无法按键名遮盖；文件可能含字面量秘密，首版显示前需确认 | 否（home） | 已核实 | https://raw.githubusercontent.com/neovim/neovim/master/runtime/doc/starting.txt （Initialization 节：`$XDG_CONFIG_HOME/nvim/init.vim (or init.lua)`；“~/.config/nvim/init.vim (or init.lua)”） | 2026-10-21 |
| 13 | Claude Code 用户设置 | `~/.claude/settings.json` | json（严格 JSON，无注释） | ReadOnly | 含敏感键：`env` 块的值遮盖 | 否（home） | 已核实 | https://code.claude.com/docs/en/settings （“Claude Code reads settings from JSON settings files such as `~/.claude/settings.json`”；“Settings files are strict JSON”） | 2026-10-21 |
| 14 | Docker CLI 配置 | `~/.docker/config.json` | json | DiscoverOnly（credentials） | credentials：`auths` 可含凭据；使用 `credsStore` 时凭据在外部 helper 中；只探测存在 | 否（home） | 已核实 | https://docs.docker.com/reference/cli/docker/#configuration-files （“By default, configuration file is stored in `~/.docker/config.json`”；无 `credsStore` 时凭据存于 `auths`。文档未说明 `auths` 为 base64，该细节不作依据） | 2026-10-21 |
| 15 | GitHub CLI 认证文件 | `~/.config/gh/hosts.yml`（文件名待核实） | yaml（不在格式枚举内；仅探测） | DiscoverOnly（credentials） | credentials：凭据库不可用时 token 可能明文落盘 | 否（home） | **待核实** | 已核实部分：https://cli.github.com/manual/gh_help_environment （默认目录 `$HOME/.config/gh`）；https://cli.github.com/manual/gh_auth_login （凭据库不可用时“fall back to writing the token to a plain text file”）。缺：两份官方页面均未给出 `hosts.yml` 文件名；需官方源码或用户授权后的 `gh auth status` 输出确认 | 2026-10-21 |
| 16 | SSH 系统级配置（固定） | `/etc/ssh/ssh_config` | text（ssh_config 关键字） | ReadOnly | 无（系统默认值） | **是**（fixed，见 ③） | 已核实 | https://man.openbsd.org/ssh_config （“Systemwide configuration file”；“This file must be world-readable.”）。注：来源为 OpenSSH 上游文档，macOS 自带版本的路径一致性未经 Apple 文档单独核实 | 2026-10-21 |

注：`~/.ssh/config`（用户级 SSH 配置）不在本表中，见“被排除的候选”E1 与裁决 1。

## 二、需用户逐项答复

### ① credentials 条目（5 项：只探测存在，不读内容）

| 序号 | 条目 | 建议 | 理由 | 用户答复 |
|---|---|---|---|---|
| 3 | `~/.git-credentials` | DiscoverOnly | 官方明确为明文存储密码与令牌，无需讨论 | |
| 4 | `~/.npmrc` | DiscoverOnly | npm 文档列出 `_authToken` 等认证项，常见 token。判断题：文件也可能主要是 registry 等非秘密配置。若用户认为主要是非秘密配置，可改为 ReadOnly＋键名遮盖，但需先改规格中 credentials 的定义口径 | |
| 5 | `~/Library/Preferences/pnpm/auth.ini` | DiscoverOnly | 文件名即认证专用，pnpm 文档将其列为认证文件 | |
| 14 | `~/.docker/config.json` | DiscoverOnly | `auths` 可直接含凭据；使用 `credsStore` 时凭据在外部 helper 中，但同一文件仍可能含 `auths` 凭据，统一按 credentials 处理 | |
| 15 | `~/.config/gh/hosts.yml` | 暂不收录 | 文件名未核实，且格式 YAML 不在规格枚举内；建议核实文件名后再以 DiscoverOnly 加入 | |

### ② 建议 Writable 的条目

首批**不建议开放任何 Writable 条目**；其余条目建议 ReadOnly 或 DiscoverOnly，不建议写入。以下仅为可选项，供用户决定是否开放：

| 序号 | 条目 | 建议 | 理由 | 用户答复 |
|---|---|---|---|---|
| 9 | Ghostty 配置 | 可选；我建议首批暂不开放 | 文本按行编辑，可逐行保留注释与未改动行，技术上可满足“无损保留”；但开放意味着新增“启用编辑”流程，超出首批范围 | |

不建议开放的理由（供参考，不列入答复）：Claude Code 的 `settings.json`（序号 13）与 Alacritty 的 `alacritty.toml`（序号 10）需要结构化的无损往返写入。TOML 有已批准的 toml_edit（G-2），JSON 的无损写入方案未经核实，首批不宜开放。

### ③ $HOME 外 fixed 条目（1 项）

| 序号 | 条目 | 建议 | 理由 | 用户答复 |
|---|---|---|---|---|
| 16 | `/etc/ssh/ssh_config` | 只读，fixed，可纳入 | 官方说明为系统级默认配置、必须全局可读，无秘密；规格允许 `$HOME` 外的固定只读项，但新增 fixed 项属“先询问”事项，需用户确认才能纳入 | |

## 三、需用户裁决（官方文档与规格冲突，或规格未覆盖）

以下不由我自行裁决。每条给出建议，请用户选择。

1. **`~/.ssh/config`（与规格冲突）**：官方 ssh_config 文档规定用户配置位于 `~/.ssh/config`，但 SPEC-app-config 规定 `home` 条目不得落在 `~/.ssh` 下，且 `~/.ssh` 属受保护目录（与 FIX-1 同一规则）。建议：维持规格，排除该条目。请确认。
2. **WezTerm（格式超出规格枚举）**：路径已核实（https://wezterm.org/config/files.html：`~/.config/wezterm/wezterm.lua`、`~/.wezterm.lua` 等），但文件为 Lua 脚本，而规格的格式枚举只有 json/jsonc/toml/plist/ini/dotenv/text。建议：首批排除；如要纳入，需先扩展格式枚举，或降为 DiscoverOnly（只显示存在与大小）。
3. **环境变量改变路径（与规格的“精确路径”冲突）**：Git、tmux、pnpm、Docker（`DOCKER_CONFIG`）、Claude Code（`CLAUDE_CONFIG_DIR`）以及多数 XDG 工具都允许环境变量改变配置位置。建议：一律只探测固定的 `$HOME` 默认路径，忽略这些环境变量，并在界面注明“仅显示默认位置”。如需尊重环境变量，需修改规格。
4. **Ghostty 文件名与多路径**：官方说明当前文件名为 `config.ghostty`（1.2.3 之前为 `config`），另有 `~/Library/Application Support/com.mitchellh.ghostty/` 路径。建议：首版只纳入 `~/.config/ghostty/config.ghostty` 一条。请确认。
5. **Claude Code 条目与 ai-config 的依赖**：序号 13 是 ai-config 的用户级候选，CAPABILITY-MAP 已注明其将改为复用本注册表（待批准）。建议：本次作为 ReadOnly 候选列入，并在 ai-config 计划阶段同步更新。请确认是否在 APP-0 一并纳入。
6. **无键值结构的文本文件（序号 9、11、12）的秘密遮盖**：规格的遮盖依据是键名规则，而 Neovim 的 `init.lua`、tmux 的命令行配置没有键值结构，可能含字面量秘密（例如 `export TOKEN=` 之类的写法在 Lua 中同样可出现）。建议：这类 text 条目首版只显示“已发现/大小/修改时间”，内容预览需用户逐项确认后再开放；或直接降为 DiscoverOnly。请确认。

## 四、被排除的候选及原因

| 编号 | 候选 | 排除原因 |
|---|---|---|
| E1 | `~/.ssh/config`（SSH 客户端） | 受保护目录 `~/.ssh`：规格禁止 `home` 条目落在其下，与官方文档冲突，见裁决 1 |
| E2 | WezTerm（`~/.config/wezterm/wezterm.lua`、`~/.wezterm.lua`） | 格式为 Lua，不在规格格式枚举内，见裁决 2 |
| E3 | GitHub CLI `~/.config/gh/config.yml` | YAML 不在格式枚举内；内容为偏好设置，首批不值得扩展格式 |
| E4 | pnpm 全局 `config.yaml`（`~/Library/Preferences/pnpm/` 下） | YAML 不在格式枚举内；官方文档只给出目录，未给出完整文件路径，无法精确登记 |
| E5 | `~/.claude.json` | 官方文档说明该文件保存登录会话、MCP 配置与项目状态，属工具运行状态与凭据载体，不是设置文件；规格不应把它当作设置条目展示 |

## 五、核实统计

- 候选总数：16
- 已核实：13（序号 1、2、3、4、5、8、9、10、11、12、13、14、16）
- 待核实：3（序号 6、7、15）
- credentials 条目：5（序号 3、4、5、14、15）
- 建议 Writable：0（序号 9 为可选，待用户决定）
- $HOME 外 fixed：1（序号 16）
- 需用户逐项答复：7（credentials 5 + 可选 Writable 1 + fixed 1）
- 需用户裁决：6
- 被排除：5（E1–E5）

## 六、待核实项缺什么

- 序号 6（VS Code）：需官方确认 `settings.json` 是否允许注释与尾逗号（JSONC），否则无法选定解析器。
- 序号 7（Cursor）：需找到 Cursor 官方文档页面，证实用户 `settings.json` 的路径与格式。
- 序号 15（gh hosts.yml）：需官方文档或源码确认 `hosts.yml` 文件名；或在用户授权的前提下，用 `gh auth status` 的输出核实（本任务不运行此命令）。

## 七、用户答复（2026-10-21：全部按推荐）

**可进入注册表的条目（APP-1 起按此登记）**

| 序号 | 条目 | 能力等级 | 备注 |
|---|---|---|---|
| 1、2 | Git 全局配置（`~/.gitconfig`、`~/.config/git/config`） | ReadOnly | 键名匹配 token/password/secret/credential 的值遮盖，URL 中 `user:pass@` 遮盖 |
| 3 | `~/.git-credentials` | credentials（只探测存在） | |
| 4 | `~/.npmrc` | credentials（只探测存在） | 按推荐不读内容 |
| 5 | `~/Library/Preferences/pnpm/auth.ini` | credentials（只探测存在） | |
| 8 | Zed `~/.config/zed/settings.json` | ReadOnly（jsonc） | 按键名遮盖 |
| 9 | Ghostty `~/.config/ghostty/config.ghostty` | ReadOnly，**首版只显示已发现/大小/修改时间**（裁决 6） | 不开放 Writable |
| 10 | Alacritty `~/.config/alacritty/alacritty.toml` | ReadOnly | |
| 11 | tmux `~/.tmux.conf`、`~/.config/tmux/tmux.conf` | ReadOnly，**首版只显示已发现/大小/修改时间**（裁决 6） | |
| 12 | Neovim `~/.config/nvim/init.lua`（或 `init.vim`） | ReadOnly，**首版只显示已发现/大小/修改时间**（裁决 6） | |
| 13 | Claude Code `~/.claude/settings.json` | ReadOnly（严格 JSON） | `env` 块值遮盖；ai-config 阶段改为复用本注册表（裁决 5） |
| 14 | Docker `~/.docker/config.json` | credentials（只探测存在） | |
| 16 | `/etc/ssh/ssh_config` | ReadOnly，fixed（$HOME 外，不经授权库、永不可写） | 已纳入 |

**不进入注册表**

- 序号 6（VS Code）、7（Cursor）、15（gh `hosts.yml`）：**待核实**，未核实条目不得进入（规格要求）；缺什么见第六节，核实后可追加。
- E1–E5 保持排除：`~/.ssh/config`（裁决 1：维持规格）、WezTerm（裁决 2）、gh `config.yml`、pnpm `config.yaml`、`~/.claude.json`。

**全局裁决**：Writable 条目首批为 0（Ghostty 暂不开放），因此 APP-4 在首批不执行；一律只探测固定 `$HOME` 默认路径、忽略环境变量，界面注明“仅显示默认位置”（裁决 3）；Ghostty 只收 `config.ghostty` 一条（裁决 4）。
