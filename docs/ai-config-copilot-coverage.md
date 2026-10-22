# GitHub Copilot CLI 覆盖报告

本报告人工编写，数字取自 `src-tauri/src/ai_config/definitions/copilot-cli.json`，核对日期 2026-10-22。

## 来源与抓取日期

- 主来源（设置表、配置路径、凭据存放）：https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference，抓取日期 2026-10-22。
- 辅助来源（命令参考、`copilot config`、认证与令牌优先级、agent 定义字段）：https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference，抓取日期 2026-10-22。
- 可执行名 `copilot`：https://github.com/github/copilot-cli 的 README，抓取日期 2026-10-22。
- 抓取方式：WebFetch 摘要在设置表中途截断（`showTipsOnStartup` 行之后不可见），因此以 curl 取完整 HTML 解析表格，关键句子再用纯文本核对。逐条原文见 `definitions/sources/copilot-cli-docs.md`。
- 官方 JSON Schema：未找到。定义只依据上述官方文档页面，未套用其他工具的类型表。
- 适用版本：官方页面未声明，`documentedVersion` 为 `unknown`。

## 收录与可编辑性

- 设置项：收录 90 项。用户级设置表共 91 行，排除 `subagents.agents["rubber-duck"].autoInvoke`（键名含引号与方括号，不符合键路径格式）。仓库级设置表 14 项中，与用户键同名的 13 项写入对应用户项的 `mergeRule`；`contextTier` 不在用户设置表中，未收录。
- 可编辑键：0 个。本任务没有任何键可编辑。所有设置项为 `displayOnly`，`versions` 均为空。
- 资源：收录 9 个（配置文件位置与格式），其中认证与凭据相关的 3 个为仅元数据，能力状态 `unsupported`，不读取内容。
- flags 与 env：本任务未收录，`flags` 为空，`flagsCoverage` 与 `envCoverage` 标注 `snapshotComplete: false`，待后续任务补充。

## 按类型数量（valueType）

| valueType | 数量 |
| --- | --- |
| boolean | 45 |
| stringArray | 15 |
| enum | 12 |
| object | 9 |
| string | 6 |
| number | 3 |
| unknown | 0 |

类型全部来自设置表的“Type”列。没有任何项因文档缺失而标为 `unknown`。

## 冲突与未核实

旧契约与官方文档的冲突逐项裁决（依据 SPEC §6：以官方文档当前内容为准，历史只作线索）：

| 旧说法 / 项 | 官方文档是否出现 | 结论 |
| --- | --- | --- |
| `banner` 为 boolean（旧适配器） | 出现：设置表 `banner`，类型 `"always" \| "once" \| "never"`，默认 `"once"` | 采用官方枚举，收录为 `enum`；boolean 说法作废 |
| `reasoningEffort`（旧适配器） | 未出现在设置表。只出现在命令参考的自定义 agent 字段表：`reasoningEffort string No Default reasoning effort for this agent` | 不收录为设置项，在本报告记录 |
| `effortLevel`（新 profile） | 出现：设置表，类型 `string`，默认 `"medium"`，描述列出 `"low"`、`"medium"`、`"high"`、`"xhigh"` | 收录，类型按官方 `string`，不改写成 enum，取值写在 `description` |
| 旧 `config.json` 可写用户设置 | 官方：用户设置位于 `settings.json`；“Earlier versions of Copilot CLI stored both user settings and application state in config.json. … Settings left in config.json are ignored.” | 作废。`config.json` 仅为内部状态，资源标注 `unsupported`，不作为设置项编辑 |
| 新 profile：认证内部状态仅元数据 | 官方：`config.json` 为 “Automatically managed application state (authentication, installed plugins, and other internal data)”；凭据优先系统凭据库，无则为 `~/.copilot/` 下明文配置文件 | 一致，维持仅元数据 |
| `storeTokenPlaintext` | 出现：设置表，boolean，默认 `false` | 收录，标注秘密，不可编辑 |
| `contextTier` | 出现在仓库设置表，不在用户设置表 | 不收录为用户设置项 |
| `subagents.agents["rubber-duck"].autoInvoke` | 出现在用户设置表 | 键路径不合法，未收录 |
| `showReasoning` 默认值 “None” | 设置表原文 | 类型按 `boolean` 收录，`defaultNote` 保留原文 `None` |
| `mergeStrategy` 默认值 “—” | 设置表原文 | 类型按 `"rebase" \| "merge"` 收录，`defaultNote` 保留原文 `—` |
| `detect.rs` 的 `verification_note`：“独立配置页面未找到，完整字段与格式待核验” | 官方配置页存在（上文来源） | 与事实不符，但 `detect.rs` 不在本任务范围，未修改；建议协调者另起任务更新 |

以下事项未核实，因此未收录为设置项或资源：

- 仓库级自定义指令文件的路径：配置页只写 “repository-level copilot-instructions.md”，未给出路径。未收录。
- 个人级指令 `~/.copilot/copilot-instructions.md` 与 `~/.copilot/instructions/`：官方目录总览表列出，但它们是指令文件而非配置，本任务未收录为资源。
- `~/.copilot/mcp-config.json`、`~/.copilot/lsp-config.json`：官方列出，但格式未在页面写明，未收录。
- 系统凭据库的具体实现（macOS 钥匙串等）：页面只写 “system credential store”，未核实。
- `.github/copilot/settings.json` 的完整可覆盖键列表：以仓库级设置表为准（14 项），表中未说明的键不视为可覆盖。
- 设置表以完整 HTML 解析结果为准；WebFetch 摘要只用于对照，其覆盖的前若干行与解析结果一致。本报告未逐条访问每个链接页面。

## 命令行 flags 与环境变量（仅记录发现，未收录）

- 环境变量：`COPILOT_HOME`（替换整个 `~/.copilot`）、`COPILOT_CACHE_HOME`、`COPILOT_PROVIDERS_CONFIG`、`COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`（认证令牌，按此顺序优先）、`HTTP_PROXY` / `HTTPS_PROXY`（覆盖 `proxyUrl`）、`XDG_CACHE_HOME`、`LOCALAPPDATA`、`COPILOT_ENABLE_INTERRUPTED_SESSION_RESTORE`。
- 命令行：`copilot config [--global|--repo|--local]`、`copilot help config`、`copilot login --web-flow|--device-code|--with-token`、`copilot instruction list`、`copilot lsp list`。`--config-dir` 已弃用，文档建议改用 `COPILOT_HOME`。
- 设置覆盖顺序（官方原文）：内置默认值、MDM 托管设置、用户设置、仓库设置、本地设置、环境变量、命令行参数。

## 风险与秘密标注

标注规则：风险与秘密由本仓库依据键语义判断，**不是官方结论**，协调者需复核。`executesCommand` 表示会执行外部命令或脚本；`relaxesPermissions` 表示放宽审批或沙箱限制；`externalServer` 表示连接外部服务或服务器；秘密表示涉及凭据。所有风险与秘密键均为 `displayOnly`，不可编辑。

| 键 | 风险 | 秘密 |
| --- | --- | --- |
| `allowedUrls` | relaxesPermissions | 否 |
| `askUser` | relaxesPermissions | 否 |
| `autoUpdate` | executesCommand | 否 |
| `bashEnv` | executesCommand | 否 |
| `connectors` | externalServer | 否 |
| `continueOnAutoMode` | relaxesPermissions | 否 |
| `disableAllHooks` | relaxesPermissions | 否 |
| `enabledMcpServers` | externalServer | 否 |
| `enabledPlugins` | executesCommand | 否 |
| `extraKnownMarketplaces` | executesCommand, externalServer | 否 |
| `hooks` | executesCommand | 否 |
| `powershellFlags` | executesCommand | 否 |
| `proxyUrl` | externalServer | 否 |
| `remote` | externalServer | 否 |
| `remoteExport` | externalServer | 否 |
| `sandbox.allowBypass` | relaxesPermissions | 否 |
| `sandbox.auth.git` | relaxesPermissions | 是 |
| `sandbox.auth.gh` | relaxesPermissions | 是 |
| `sandbox.credentials` | — | 是 |
| `sandbox.userPolicy.network.allowLocalNetwork` | relaxesPermissions | 否 |
| `sandbox.userPolicy.network.proxy` | externalServer | 是 |
| `sandbox.userPolicy.network.allowedHosts` | relaxesPermissions | 否 |
| `sandbox.userPolicy.seatbelt.keychainAccess` | relaxesPermissions | 是 |
| `statusLine` | executesCommand | 否 |
| `stayInAutopilot` | relaxesPermissions | 否 |
| `storeTokenPlaintext` | relaxesPermissions | 是 |

## 资源与核实情况

| 资源 id | 层级 | 位置 | 能力状态 |
| --- | --- | --- | --- |
| `copilot-user-settings` | userLevel | `{home}/.copilot/settings.json` | versionUnknown |
| `copilot-repo-settings` | projectShared | `{project}/.github/copilot/settings.json` | versionUnknown |
| `copilot-local-settings` | projectLocal | `{project}/.github/copilot/settings.local.json` | versionUnknown |
| `copilot-managed-settings` | managed | `{managed}/managed-settings.json` | versionUnknown |
| `copilot-claude-compatible-settings` | projectShared | `{project}/.claude/settings.json` | versionUnknown |
| `copilot-permissions-config` | userLevel | `{home}/.copilot/permissions-config.json` | unsupported |
| `copilot-config-state` | userLevel | `{home}/.copilot/config.json` | unsupported |
| `copilot-mcp-oauth-fallback` | userLevel | `{home}/.copilot/mcp-oauth-config` | unsupported |
| `copilot-mcp-secrets-fallback` | userLevel | `{home}/.copilot/mcp-secrets` | unsupported |

- 用户设置、仓库设置、本地设置、托管设置、`.claude/settings.json` 的路径与用途均来自官方表格；适用版本未核实，因此为 `versionUnknown`。
- `COPILOT_HOME` 替换整个 `~/.copilot`，资源位置仍写 `{home}`，此规则记录在资源描述中，未建模为独立资源。
- `copilot-permissions-config` 为审批记录，不是设置项，不读取。

## 需要用户在真机核实的事项

- 本机 `~/.copilot` 实际存在哪些文件（只看文件名，不读取内容，尤其是认证文件）。
- `COPILOT_HOME` 对 `settings.json` 与 `config.json` 的实际重定位效果。
- 认证令牌实际落在系统凭据库还是 `~/.copilot` 明文文件。
- `copilot` 可执行名与版本，以及 `copilot config` 输出是否与设置表一致。

以上事项需要在真机核实，本任务未运行任何应用或桌面操作，未验证。Rust 测试未运行（未验证）。
