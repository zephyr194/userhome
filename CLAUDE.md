@AGENTS.md

# CLAUDE.md

项目约定、命令、工作流、硬性禁止、模型路由都在上面导入的 AGENTS.md，本文件只做路由和 Claude 特有说明，不重复。

## 任务路由：先读哪份文档

| 任务类型 | 先读 |
|---|---|
| 写或改规格 | `docs/specs/`（本地文件，gitignore；放置规则见 AGENTS.md §4） |
| 写测试或验收 | `docs/testing.md` |
| UI / 主题 | `docs/specs/SPEC-theme*.md`、`docs/specs/SPEC-ui-*.md` |
| 发布 | `docs/release.md`、`docs/release-readiness.md` |
| 安全、授权、脱敏 | `docs/threat-model.md` |
| 记错题 | `docs/agent-incidents/README.md` |
| 分发 worker | orchestration skill；模型选择见 AGENTS.md §10 |

## Claude 特有

- Skill：分发 worker 用 `orchestration`；提交用 `functional-commit`（只提交、不 push）。
- 被派为 worker 时，不得修改 `.claude/` 下的配置文件及 AGENTS.md §7 列出的规则类文件。
