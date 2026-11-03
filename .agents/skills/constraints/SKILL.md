---
name: constraints
description: 仅在用户调用 /constraints 时使用。建立项目质量约束，或通过 check、guard、ratchet 检查和维护已有质量底线。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: constraints
---

# /constraints

加载并遵循 [constraint-driven-development](../constraint-driven-development/SKILL.md) 技能，按用户紧随命令的参数执行。无参数时为当前仓库建立质量约束。

1. **先探测。** 阅读依赖清单、测试运行器、静态检查配置、已有覆盖率、CI 工作流和当前代理环境。用两行说明发现，不询问可自行读取的信息。
2. **最多四个问题，逐个询问。** 每次给出推荐值和可用默认值，确认质量维度、失败时阻断或警告、目标阈值或当前基线，以及最长可接受检查耗时。
3. **编写 `CONSTRAINTS.md`。** 包含不可削弱的底线、强制阈值、仅测量的指标及当前值，以及具有负责人和到期时间的例外表。每个数值都说明理由。
4. **让规则有工具支撑。** 优先复用现有工具。所选维度确需工具时，按仓库依赖管理约定配置 Semgrep、gitleaks（必须 `--redact`）、osv-scanner、axe-core、Lighthouse、size-limit、dependency-cruiser 或 Stryker，并记录准确命令。性能和可访问性需要可运行 URL；没有时明确说明，不伪造检查。
5. **按成本分层。** 类型、静态检查和秘密检查进入快速循环；相关测试及改动行覆盖率在任务结束时执行；昂贵检查放到审查或 CI。适用时配置 `check:fast`、`check:task`、`check:full`，尽量限定改动范围。
6. **接入仓库规则。** 在当前实际使用的代理规则文件中要求读取 `CONSTRAINTS.md`，禁止为让改动通过而削弱约束。
7. **验证当前分支。** 执行约束，明确报告失败。用户不同意某项门禁时先讨论并记录决策，不能静默降低阈值。

## 子命令

- `/constraints check`：执行当前约束并报告结果。
- `/constraints guard`：检查差异中的阈值降低、测试跳过或删除、新增抑制、未实现占位和例外。
- `/constraints ratchet`：将当前实测值记录为不得退步的基线。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
