# Claude Code 设置 schema 快照

- 文件：`claude-code-settings.schema.json`（与本目录同名，内容原样）
- 原始 URL：https://www.schemastore.org/claude-code-settings.json
- 抓取日期：2026-10-22
- sha256：`f26f028ad94a1e2a28e9dad1f80832ab196a8e080bd3a7d7a32e6428a15e0611`
- 托管方：第三方（SchemaStore）。官方文档的 `$schema` 指向该文件，但它不是 Anthropic 官方发布物。
- 适用版本：schema 文件本身不声明适用的 Claude Code 版本，因此不能据此判断某个设置在哪个版本生效。

本目录只用于 `scripts/merge-claude-schema.mjs` 把类型信息合并进 `../claude-code.json`，不参与运行时加载。快照不得手动修改；需要更新时整体替换文件、更新本 README 的日期与 sha256，并重新运行合并脚本。
