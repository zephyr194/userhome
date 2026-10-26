# 可视化配置（ai-config 的控件层）

日期：2026-10-22
状态：方向已由用户确认（2026-10-22）；对应规格条款见 SPEC-ai-config.md §2.1、§3.1、§4.1，SPEC-caddy-manager.md「工作目录」。

## Problem Statement

我们怎样让用户不读文档、不手改 JSON/TOML，就能看懂并修改 CLI 的配置，且写回的仍是 CLI 自己认的配置文件（例如 Claude Code 的 `.claude/settings.json`）？

## 用户期望的模型

以 Claude 的配置文件里有 A、B、C、D 四项为例：

| 配置项 | 值类型 | 界面控件 | 每个控件必须有 |
|---|---|---|---|
| 开启 A、开启 B | boolean | 开关 | 字段含义（官方描述）、默认值、写回的键路径 |
| C | string | 输入框 | 同上，加格式限制（如非空） |
| D | enum | 选择器 | 同上，选项即官方枚举值 |

保存后只改动被用户修改的键，其余键、注释、顺序保持不变，并给出差异预览、备份和写后校验。

## 现状核对（2026-10-22）

- 控件层已有（AI-4）：`editControl()` 支持 boolean / enum / string。
- 但 Claude 定义的 245 个设置里，216 个类型是 `unknown`，全部只展示；8 个候选键因版本门禁（已验证版本区间为空）实际都不能写。所以用户今天看到的几乎都是“只读列表”，不是“可视化配置”。
- 类型来源缺口可由官方 JSON Schema 补上：

| 工具 | 官方 schema | 顶层键数 | 类型覆盖 |
|---|---|---|---|
| Claude Code | SchemaStore `claude-code-settings.json`（官方文档 `$schema` 所指向，第三方托管） | 142 | boolean 57、string 21、array 20、object 20、enum 16、number/integer 4；全部带 description |
| Codex | `developers.openai.com/codex/config-schema.json`（OpenAI 官方） | 103 | 标量（string 20、boolean 14、integer 9）+ allOf 43、$ref 6、object 8 等复杂结构；94 项带 description |
| Gemini CLI | 官方仓库 `schemas/settings.schema.json` | 27 | 22 项是对象（嵌套），顶层标量很少，需要按嵌套键展开 |
| Copilot CLI | **未找到官方 schema**（SchemaStore 里的 Copilot 是 AWS 的） | — | 只能靠官方文档，保持 fail-closed |

- Claude 与本地定义的交集 138 键里，121 个本地为 `unknown`，其中 83 个是标量（开关 49、选择器 14、输入框 16、数字 4），这是最直接的收益。

## Recommended Direction

把“类型”交给官方 schema，把“能不能写”交给已有的版本门禁与写入引擎：

1. 定义生成：从官方 schema 生成/校对 `valueType`、`allowedValues`、默认值、描述，并记录来源 URL、抓取日期、快照哈希；schema 缺失或与快照不符的键保持 `displayOnly`。
2. 控件映射：boolean→开关，enum→选择器，string→输入框，integer/number→数字输入（带范围），stringArray→列表编辑；object 与 `unknown` 只展示，不给通用 JSON 文本框绕过。
3. 字段含义：显示 schema 的官方英文描述（用户决定本轮不写中文含义），并附来源与适用版本；中文标签与说明列为后续可选项。
4. 写回：复用 AI-4 的保真写入、diff、备份、版本门禁；门禁区间用真实 `--version` 的结果填写。
5. 四个工具逐个验证“模板是否适用”（CP6a 的实质内容）：Claude 与 Codex 直接用 schema；Gemini 先做嵌套键展开；Copilot 无 schema，沿用文档快照且默认只读，不能套用 Claude 的类型表。

## 命令：生成后在终端打开

用户决定：保留命令生成，新增“在终端打开”。应用自己不执行、不捕获输出：

- 命令仍由已有的 quote 逻辑生成，秘密只出现占位符，不含 shell 片段。
- “在终端打开”只在用户点击后触发，展示完整命令和工作目录，由用户在 Terminal 里自己看到并确认；应用不替用户按回车。
- 机制待实现任务定稿并给出理由：方案 A 为临时 `.command` 文件（先打印命令并等待用户回车确认，再运行）；方案 B 为 AppleScript `do script`（需要 macOS 自动化授权弹窗，且会直接执行）。倾向 A，不引入自动化权限。
- 版本探测（`--version`）沿用 detect 中的受控固定参数，和“在终端打开”是两件事，不能合并成通用执行器。

## Caddy 工作目录

用户决定：Caddy 选择一个目录作为工作目录，默认建议 `~/.caddy`。

- 放入该目录：规则、生成的 Caddyfile、原文、检查副本、运行目录、日志。
- 通过目录选择器授权（新增保留用途，与既有的 TLS/LaunchAgent 同模式），默认值仅作预填，用户确认后才创建，权限 0700。
- admin Unix socket 必须留在该目录下的私有子目录，并保持 0700、非符号链接、归属当前用户；路径过长（Unix socket 约 104 字节上限）时拒绝并提示换目录，不退回默认 2019。
- 目录在受保护路径、云同步目录、他人可写目录时拒绝。
- 从现有应用私有目录迁移：只提示并由用户确认，不自动搬运。

## Key Assumptions to Validate

- [ ] 官方 schema 的类型与描述足以驱动控件，且与本机 CLI 实际行为一致 —— 用真实 `claude --version` 确定区间，再抽样对比 schema 与文档。
- [ ] SchemaStore 的 Claude schema 不落后于官方文档 —— 对比本地 245 项与 schema 142 项的差异（schema 缺 107 项，本地缺 4 项），逐项归类。
- [ ] 保真写入对 schema 里的 array/object 键不失真 —— 先只开放标量，数组/对象保持只读。
- [ ] 选定目录下 admin socket 路径不超长 —— 在实现任务里加路径长度的单元测试，并在真实验收时确认。
- [ ] “在终端打开”方案 A 在用户的 Terminal 设置下可用 —— 待人工确认。

## MVP Scope

- Claude：把 schema 里 83 个标量键提升为可见控件（开关/选择器/输入框/数字），在版本门禁通过后可写；其余保持展示。
- 每个控件有官方英文描述、默认值、键路径、来源。
- 命令生成后“在终端打开”（方案 A）。
- Caddy 工作目录选择与迁移提示。
- Codex 沿用同一框架（schema → 控件）；Gemini、Copilot 只在各自来源核验后逐步放开。

## Not Doing (and Why)

- 应用内执行任意命令或捕获终端输出 —— 超出用户选定范围，会引入新的授权模型。
- 通用 JSON/TOML 文本框来编辑 object/array —— 绕过类型与权限，原文模式已是独立能力。
- 中文字段含义 —— 用户决定本轮只用官方英文描述。
- 自动迁移旧 Caddy 数据、自动改用户 shell 或 CLI 的信任设置 —— 与既有规格“不做自动迁移”一致。
- 把 Claude 的类型表套给 Copilot —— Copilot 没有官方 schema，不能猜。

## Open Questions

- 真实 `claude --version` 何时由用户批准在本机执行（版本门禁要用）。
- “在终端打开”的最终机制（A 或 B）。
- Caddy 目录：已有旧私有目录里的数据是否要迁移，还是由用户重新配置。
- Gemini 嵌套键的控件展开粒度（只展开一层，还是展开到叶子键）。
