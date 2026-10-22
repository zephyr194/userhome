# Claude Code 设置 schema 快照

- 文件：`claude-code-settings.schema.json`（与本目录同名，内容原样）
- 原始 URL：https://www.schemastore.org/claude-code-settings.json
- 抓取日期：2026-10-22
- sha256：`f26f028ad94a1e2a28e9dad1f80832ab196a8e080bd3a7d7a32e6428a15e0611`
- 托管方：第三方（SchemaStore）。官方文档的 `$schema` 指向该文件，但它不是 Anthropic 官方发布物。
- 适用版本：schema 文件本身不声明适用的 Claude Code 版本，因此不能据此判断某个设置在哪个版本生效。

本目录只用于 `scripts/merge-claude-schema.mjs` 把类型信息合并进 `../claude-code.json`，不参与运行时加载。快照不得手动修改；需要更新时整体替换文件、更新本 README 的日期与 sha256，并重新运行合并脚本。

# Codex CLI 配置 schema 快照

- 文件：`codex-config.schema.json`（与本目录同名，内容原样）
- 原始 URL：https://developers.openai.com/codex/config-schema.json
- 抓取日期：2026-10-22
- sha256：`e9dd16b9d1710e57b020e42da4af6d6606e8f44cb028a2e94196dee3890d9170`
- 托管方：OpenAI 官方托管。
- 适用版本：schema 文件本身不声明适用的 Codex 版本，因此不能据此判断某个设置在哪个版本生效。

本目录只用于 `scripts/merge-codex-schema.mjs` 生成 `../codex-cli.json` 的 settings 与覆盖报告，不参与运行时加载。快照不得手动修改；需要更新时整体替换文件、更新本节的日期与 sha256，并重新运行脚本。

官方文档核实结论（2026-10-22）：

- 允许域名内的官方文档正文未能读取：`developers.openai.com/codex/config-basic`、`config-advanced`、`config-reference` 均重定向到 `learn.chatgpt.com`，超出允许来源范围，未跟随。`github.com/openai/codex/blob/main/docs/config.md` 只含 hooks 章节。
- 用户级配置文件 `config.toml`、项目级 `.codex/config.toml`、托管/系统层路径、配置优先级与项目信任规则：**未核实**。
- schema 自身的描述文字可作为证据（非路径规格）：`config.toml` 被描述为加载配置的文件（`analytics`、`apps` 等顶层键说明）；`~/.codex/history.jsonl` 出现在 `history` 的描述中；`CODEX_HOME/auth.json` 与 `CODEX_HOME/.credentials.json` 出现在 `cli_auth_credentials_store` 与 `mcp_oauth_credentials_store` 的描述中。`CODEX_HOME` 的默认位置与是否可重定位**未核实**。
- 可执行文件名 `codex`：来自任务简报，**未经官方核实**。

# Gemini CLI 配置 schema 快照

- 文件：`gemini-settings.schema.json`（与本目录同名，内容原样）
- 原始 URL：https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json
- 抓取日期：2026-10-22
- sha256：`5517471627bf712c88e7d27ddbf419629df73edad7a676344ede9f2d2379d408`
- 托管方：Google 官方仓库 `google-gemini/gemini-cli` 托管（schema 的 `$id` 即该地址）。
- 适用版本：schema 文件本身不声明适用的 Gemini CLI 版本，因此不能据此判断某个设置在哪个版本生效。

本目录只用于 `scripts/merge-gemini-schema.mjs` 生成 `../gemini-cli.json` 的 settings 与覆盖报告，不参与运行时加载。快照不得手动修改；需要更新时整体替换文件、更新本节的日期与 sha256，并重新运行脚本。

官方文档核实结论（2026-10-22）：

- 配置格式：JSON，`"Gemini CLI uses JSON settings files for persistent configuration."`（https://geminicli.com/docs/reference/configuration/；https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md）。
- 用户级：`~/.gemini/settings.json`（两页均给出）。`GEMINI_CLI_HOME` 为用户级配置与存储的根目录（geminicli.com 配置页）；是否据此重定位 `settings.json` 未逐条核实。
- 项目级：项目根目录下的 `.gemini/settings.json`（GitHub 配置文档）。
- 系统级：macOS `/Library/Application Support/GeminiCli/settings.json`，Linux `/etc/gemini-cli/settings.json`，Windows `C:\ProgramData\gemini-cli\settings.json`；覆盖变量 `GEMINI_CLI_SYSTEM_SETTINGS_PATH`。系统默认值文件为同目录下的 `system-defaults.json`，覆盖变量 `GEMINI_CLI_SYSTEM_DEFAULTS_PATH`。
- 优先级（低到高）：默认值、系统默认值文件、用户设置文件、项目设置文件、系统设置文件、环境变量（含 `.env`）、命令行参数（geminicli.com 配置页）。
- 信任：未信任的文件夹不加载项目 `.gemini/settings.json` 与项目 `.env`（https://geminicli.com/docs/cli/trusted-folders/）。`security.folderTrust.enabled` 默认 `true`。信任列表默认位于 `~/.gemini/trustedFolders.json`，`GEMINI_CLI_TRUSTED_FOLDERS_PATH` 可覆盖其位置（geminicli.com 配置页）。
- 可执行文件名：`gemini`，npm 包 `@google/gemini-cli`（https://github.com/google-gemini/gemini-cli 的 README）。
- 凭据存放：官方认证页只写 `"Your credentials will be cached locally for future sessions."`，未给出路径、钥匙串或覆盖变量（https://geminicli.com/docs/get-started/authentication/）。凭据位置**未核实**。
- 产品迁移提示：geminicli.com 配置页与 GitHub README 均写明 `"Unpaid tier and Google One users: Gemini CLI was replaced by Antigravity CLI on June 18th, 2026."`。详见覆盖报告。

# GitHub Copilot CLI 官方文档来源

- 文件：`copilot-cli-docs.md`（官方文档摘录与设置表，不是 schema 快照）
- 原始 URL：https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference（设置表主来源）；cli-command-reference 与 github/copilot-cli README 为辅助来源，详见该文件的页面清单
- 抓取日期：2026-10-22
- 托管方：GitHub 官方文档（docs.github.com）与官方仓库 `github/copilot-cli`
- 适用版本：官方页面未声明适用的 Copilot CLI 版本，故 `documentedVersion` 为 `unknown`。
- 官方未找到 JSON Schema：本次核实的页面没有 schema 下载或 `$schema` 引用。SchemaStore 的 Copilot 条目属于 AWS Copilot，不使用。

本目录不含 Copilot 的 schema 快照；`../copilot-cli.json` 的设置项直接取自 `copilot-cli-docs.md` 的官方设置表，不参与运行时加载。
