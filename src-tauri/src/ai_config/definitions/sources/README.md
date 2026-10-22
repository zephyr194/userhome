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
