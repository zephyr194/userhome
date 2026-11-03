---
name: spec
description: 仅在用户调用 /spec 时使用。先澄清目标、用户、验收标准和边界，再形成结构化规格。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: spec
---

# /spec

加载并遵循 [spec-driven-development](../spec-driven-development/SKILL.md) 技能。在编写实现代码之前，先理解用户要构建什么，并澄清：

1. 目标和目标用户。
2. 核心能力和验收标准。
3. 技术栈偏好及约束。
4. 必须执行、需要先询问和禁止执行的边界。

形成覆盖目标、命令、项目结构、代码风格、测试策略和边界六个核心领域的结构化规格。

如果需求包含多个可独立验证的能力，先按技能的 Phase 0 提出能力地图，明确模块标识、依赖方向和实现顺序；取得批准后，按依赖顺序编写模块规格。

将规格保存到仓库根目录 `SPEC.md`，或沿用仓库已有的明确规格路径。不得静默覆盖其他有效规格；向用户确认后才能继续实现。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
