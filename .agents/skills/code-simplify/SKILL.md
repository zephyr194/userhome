---
name: code-simplify
description: 仅在用户调用 /code-simplify 时使用。在保持行为完全不变的前提下，简化近期改动或用户指定范围内的代码。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: code-simplify
---

# /code-simplify

加载并遵循 [code-simplification](../code-simplification/SKILL.md) 技能。

1. 阅读仓库实际使用的代理规则和代码约定。
2. 明确目标范围；没有指定更大范围时，仅处理近期改动。
3. 在修改前理解目的、调用方、边界情况和测试覆盖。
4. 寻找明确的简化机会：减少深层嵌套、拆分职责混杂的长函数、替换难读的嵌套三元表达式、改善泛化命名、复用重复逻辑，以及确认后删除死代码。
5. 逐项实施，每步运行覆盖该改动的已有测试，避免引入没有具体用途的新抽象。
6. 验证所需测试、构建和差异检查通过，并按 [code-review-and-quality](../code-review-and-quality/SKILL.md) 审查结果。

测试失败时，只撤销当前步骤由本次操作引入的改动并重新判断，绝不覆盖用户已有修改。不得改变行为或借机修复无关问题；新增或更新测试遵守仓库授权约束。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
