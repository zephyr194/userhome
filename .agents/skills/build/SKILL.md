---
name: build
description: 仅在用户调用 /build 时使用。按计划增量实现下一项任务；参数 auto 或 all 表示经一次明确批准后执行整个计划。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: build
---

# /build

加载并遵循 [incremental-implementation](../incremental-implementation/SKILL.md) 和 [test-driven-development](../test-driven-development/SKILL.md) 技能。仓库约束与用户授权优先；新增或更新测试确有必要时，先说明原因。

## 模式

- `/build`：执行下一项依赖已完成的待办任务，完成后停止。
- `/build auto` 或 `/build all`：展示完整计划并取得一次明确批准后，按依赖执行全部任务。

以用户紧随命令的参数选择模式。空参数或其他参数均使用单任务模式，不得擅自进入自动模式。

## 单任务流程

1. 读取任务的验收标准、相关代码、类型和已有实现模式。
2. 优先复用已有测试；需要新增或更新测试时，先说明原因并确认它能在修复前失败（RED）。
3. 实现让测试通过的最小完整改动（GREEN）。
4. 运行覆盖任务的现有检查和回归测试，按仓库验收门禁执行需要的完整检查。
5. 运行适用的构建，验证编译成功。
6. 将任务状态与对应改动一起精确暂存，创建描述明确的原子提交，遵守仓库提交约定。
7. 标记任务完成并停止，不顺带执行其他待办。

## 自动模式

1. **要求已有规格。** 仅接受 `SPEC.md`、`docs/SPEC.md`、`spec/` 下的规格，或仓库明确约定的规格路径。README 和任意文档不能替代规格；找不到时停止并提示先运行 `/spec`。
2. **检查工作区基线。** 运行 `git status --porcelain`。如果存在规划产物之外的未提交改动，先请用户提交、暂存或明确处理方式，禁止将无关改动混入任务提交。
3. **必要时规划。** 缺少 `tasks/plan.md` 时加载 planning-and-task-breakdown 生成计划。已有其他未完成计划时，先询问用户。
4. **取得一次明确批准。** 展示完整计划，等待肯定授权；含糊回应不算批准。新生成的计划作为独立准备提交保存。
5. **按依赖执行。** 使用任务声明的依赖；没有显式依赖时才按计划顺序。每项任务都执行单任务流程，并各自提交。只暂存该任务的文件和状态更新，禁止宽泛暂存。
6. **遇到阻塞即停止询问。** 测试或构建失败且没有明确修复、规格歧义、计划外决策，以及认证、权限、破坏性迁移、支付、删除、部署或秘密相关高风险操作，都必须停止。高风险操作先遵循 [doubt-driven-development](../doubt-driven-development/SKILL.md) 并取得明确授权。
7. **最后汇总。** 报告完成任务、测试变更、提交和仍待处理的事项，不隐瞒跳过或失败的步骤。

失败时遵循 [debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md)。用户解决阻塞后可再次运行 `/build auto`，从下一项待办继续，不重复完成项。

完成标准见 [definition-of-done](../../references/definition-of-done.md)。本命令不授予推送、强制推送或部署权限。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
