---
name: planning
description: 仅在用户调用 /planning 时使用。将已有规格拆成有依赖、验收标准和验证步骤的可执行任务。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: plan
---

# /planning

这是上游 `/plan` 的中文适配，使用 `/planning` 避免与 Copilot 内置 `/plan` 冲突。加载并遵循 [planning-and-task-breakdown](../planning-and-task-breakdown/SKILL.md) 技能。

读取已有规格（`SPEC.md` 或仓库约定的等价路径）及相关代码，然后：

1. 在计划阶段不修改业务代码。
2. 明确组件之间的依赖关系。
3. 按完整可验证的业务路径纵向切片，而不是按技术层横向拆分。
4. 为每个任务写明验收标准和验证步骤。
5. 在阶段之间设置检查点。
6. 向用户展示计划并等待审阅。

将计划保存到 `tasks/plan.md`，任务列表保存到 `tasks/todo.md`。如果这些文件已有其他工作的未完成任务，必须先询问用户，禁止静默覆盖。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
