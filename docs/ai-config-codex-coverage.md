# Codex CLI 覆盖报告

本报告由 `scripts/merge-codex-schema.mjs` 生成，请勿手动编辑。

## 快照

- 原始 URL：https://developers.openai.com/codex/config-schema.json
- 抓取日期：2026-10-22
- sha256：`e9dd16b9d1710e57b020e42da4af6d6606e8f44cb028a2e94196dee3890d9170`
- 托管方：OpenAI 官方托管；schema 不声明适用的 Codex 版本。

## 收录与可编辑性

- 顶层键：快照 103 个，定义收录 103 个，一一对应。
- 可编辑键：0 个。本任务没有任何键可编辑（所有设置项为 displayOnly，本工具没有已验证版本区间）。
- flags / env：本任务未收录，`flagsCoverage` 与 `envCoverage` 标注 `snapshotComplete: false`，待 AI-8 补充。

## 按类型数量

| valueType | 数量 |
| --- | --- |
| boolean | 14 |
| enum | 11 |
| number | 9 |
| object | 9 |
| string | 27 |
| stringArray | 3 |
| unknown | 30 |

## 解析不了的键（valueType = unknown）

| 键 | 原因 |
| --- | --- |
| agents | 结构化对象（带 properties 或 additionalProperties 的定义） |
| analytics | 结构化对象（带 properties 或 additionalProperties 的定义） |
| approval_policy | oneOf 含非字符串枚举分支 |
| apps | 结构化对象（带 properties 或 additionalProperties 的定义） |
| audio | 结构化对象（带 properties 或 additionalProperties 的定义） |
| auto_review | 结构化对象（带 properties 或 additionalProperties 的定义） |
| browser_use | 结构化对象（带 properties 或 additionalProperties 的定义） |
| cloud | 结构化对象（带 properties 或 additionalProperties 的定义） |
| computer_use | 结构化对象（带 properties 或 additionalProperties 的定义） |
| experimental_thread_store | oneOf 含非字符串枚举分支 |
| feedback | 结构化对象（带 properties 或 additionalProperties 的定义） |
| forced_chatgpt_workspace_id | anyOf 无法映射为单一类型 |
| ghost_snapshot | 结构化对象（带 properties 或 additionalProperties 的定义） |
| goals | 结构化对象（带 properties 或 additionalProperties 的定义） |
| history | 结构化对象（带 properties 或 additionalProperties 的定义） |
| hooks | 结构化对象（带 properties 或 additionalProperties 的定义） |
| mcp_enterprise_managed_auth | 结构化对象（带 properties 或 additionalProperties 的定义） |
| memories | 结构化对象（带 properties 或 additionalProperties 的定义） |
| notice | 结构化对象（带 properties 或 additionalProperties 的定义） |
| orchestrator | 结构化对象（带 properties 或 additionalProperties 的定义） |
| otel | 结构化对象（带 properties 或 additionalProperties 的定义） |
| plugins | 结构化对象（带 properties 或 additionalProperties 的定义） |
| realtime | 结构化对象（带 properties 或 additionalProperties 的定义） |
| sandbox_workspace_write | 结构化对象（带 properties 或 additionalProperties 的定义） |
| shell_environment_policy | $ref 无法解析或组合形式不受支持 |
| skills | 结构化对象（带 properties 或 additionalProperties 的定义） |
| tool_suggest | 结构化对象（带 properties 或 additionalProperties 的定义） |
| tools | 结构化对象（带 properties 或 additionalProperties 的定义） |
| tui | 结构化对象（带 properties 或 additionalProperties 的定义） |
| windows | 结构化对象（带 properties 或 additionalProperties 的定义） |

## 风险与秘密标注

标注规则：风险与秘密由键名与 schema 描述的关键词匹配得出，宁可多标；协调者需复核。

| 键 | 风险 | 秘密 |
| --- | --- | --- |
| allow_login_shell | executesCommand | - |
| allow_symlinked_codex_home | executesCommand、relaxesPermissions | - |
| approval_policy | executesCommand、relaxesPermissions | - |
| approvals_reviewer | relaxesPermissions | - |
| apps_mcp_product_sku | externalServer | - |
| auto_review | relaxesPermissions | - |
| chatgpt_base_url | externalServer | - |
| cli_auth_credentials_store | - | 是 |
| default_permissions | relaxesPermissions | - |
| experimental_realtime_webrtc_call_base_url | externalServer | - |
| experimental_realtime_ws_backend_prompt | externalServer | - |
| experimental_realtime_ws_base_url | externalServer | - |
| experimental_realtime_ws_model | externalServer | - |
| experimental_realtime_ws_startup_context | externalServer | - |
| hooks | executesCommand | - |
| include_permissions_instructions | relaxesPermissions | - |
| marketplaces | externalServer | - |
| mcp_enterprise_managed_auth | externalServer | 是 |
| mcp_oauth_callback_port | externalServer | - |
| mcp_oauth_callback_url | externalServer | - |
| mcp_oauth_credentials_store | externalServer | 是 |
| mcp_optional_startup_grace_ms | externalServer | - |
| mcp_servers | externalServer | - |
| model_provider | externalServer | - |
| model_providers | externalServer | - |
| notify | executesCommand | - |
| openai_base_url | externalServer | - |
| oss_provider | externalServer | - |
| permissions | relaxesPermissions | - |
| plugins | externalServer | - |
| realtime | executesCommand、externalServer | - |
| sandbox_mode | relaxesPermissions | - |
| sandbox_workspace_write | relaxesPermissions | - |
| shell_environment_policy | executesCommand | - |
| thread_unload_delay_secs | externalServer | - |

## 资源与核实来源

| 资源 | 层级 | 格式 | 位置 | 能力状态 | 来源 |
| --- | --- | --- | --- | --- | --- |
| codex-user-config | userLevel | toml | {home}/.codex/config.toml | versionUnknown | https://developers.openai.com/codex/config-schema.json |
| codex-project-config | projectShared | toml | {project}/.codex/config.toml | unsupported | https://developers.openai.com/codex/config-basic |
| codex-managed-config | managed | toml | {managed}/config.toml | unsupported | https://developers.openai.com/codex/config-basic |
| codex-auth-credentials | userLevel | text | {home}/.codex/auth.json | versionUnknown | https://developers.openai.com/codex/config-schema.json |
| codex-mcp-oauth-credentials | userLevel | text | {home}/.codex/.credentials.json | versionUnknown | https://developers.openai.com/codex/config-schema.json |

资源的说明文字见 `codex-cli.json`。认证与凭据类资源为仅元数据：只标注存在性，不读取内容。

## 未核实项

- 用户级 `config.toml` 的默认位置与 `CODEX_HOME` 重定位语义：未核实。
- 项目级 `.codex/config.toml` 与项目信任规则：未核实。
- 系统/托管层路径与格式：未核实。
- 配置优先级（CLI `-c`、profile、项目、用户、系统、默认值）：未核实。
- 所有设置项的合并规则：文档未给出（未核实）。
- 可执行文件名 `codex`：来自任务简报，未经官方核实。
- 资源 `codex-user-config` 能力状态为 versionUnknown：用户级配置文件 config.toml。schema 的描述以 config.toml 作为配置文件；其默认位置 {home}/.codex/config.toml 与 CODEX_HOME 重定位语义未经官方文档核实，位置为待核验的默认值。本快照不读取该文件。
- 资源 `codex-project-config` 能力状态为 unsupported：待核验：项目级配置文件路径与“仅在项目被信任时加载”的规则未经官方文档核实（官方文档页重定向到允许来源之外）。本快照不读取该文件。
- 资源 `codex-managed-config` 能力状态为 unsupported：待核验：系统/托管层配置的路径、格式与覆盖顺序未经官方文档核实，位置为占位。本快照不读取该文件。
- 资源 `codex-auth-credentials` 能力状态为 versionUnknown：仅元数据（位置待核验）：schema 的 cli_auth_credentials_store 描述称 CLI 凭据存放于 CODEX_HOME/auth.json。本快照只标注文件是否存在，不读取内容；格式未核实，按 text 处理。
- 资源 `codex-mcp-oauth-credentials` 能力状态为 versionUnknown：仅元数据（位置待核验）：schema 的 mcp_oauth_credentials_store 描述称 MCP 凭据存放于 CODEX_HOME/.credentials.json。本快照只标注文件是否存在，不读取内容；格式未核实，按 text 处理。
