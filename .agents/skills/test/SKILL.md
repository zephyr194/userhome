---
name: test
description: 仅在用户调用 /test 时使用。执行 TDD 或 Prove-It 缺陷复现流程，确认测试在修复前失败、修复后通过。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: test
---

# /test

加载并遵循 [test-driven-development](../test-driven-development/SKILL.md) 技能。先明确用户指定的范围，遵守仓库关于测试修改的授权限制；优先复用已有测试，需要新增或更新时先说明原因。

## 新能力

1. 用测试描述预期行为，并确认它在实现前失败。
2. 实现让测试通过的代码。
3. 在测试保持通过的前提下重构。

## 缺陷修复：Prove-It

1. 用测试稳定复现缺陷。
2. 确认失败原因就是目标缺陷，而不是环境或测试本身错误。
3. 实施修复。
4. 确认同一测试通过。
5. 运行相关回归测试和仓库要求的完整检查，确认没有回归。

浏览器相关问题还需加载 [browser-testing-with-devtools](../browser-testing-with-devtools/SKILL.md)，使用真实浏览器和 Chrome DevTools MCP 验证。工具不可用时明确报告验证缺口。

测试模式参考 [testing-patterns](../../references/testing-patterns.md)。不得通过跳过测试、移除断言或放宽阈值制造通过结果。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
