---
name: reviewing
description: 仅在用户调用 /reviewing 时使用。从正确性、可读性、架构、安全性和性能五个维度审查指定改动。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: review
---

# /reviewing

这是上游 `/review` 的中文适配，使用 `/reviewing` 避免与 Copilot 内置 `/review` 冲突。加载并遵循 [code-review-and-quality](../code-review-and-quality/SKILL.md) 技能。

只读审查用户指定的改动；未指定时审查暂存改动或相关近期提交。覆盖：

1. 正确性：是否符合规格，边界情况和测试是否充分。
2. 可读性：命名、逻辑和组织是否清晰直接。
3. 架构：是否遵循现有模式，边界与抽象是否合理。
4. 安全性：输入校验、秘密保护及认证授权，按需加载 [security-and-hardening](../security-and-hardening/SKILL.md)。
5. 性能：是否存在 N+1 查询或无界操作，按需加载 [performance-optimization](../performance-optimization/SKILL.md)。

将发现分类为 Critical、Required、Optional 或 Nit，输出结构化中文报告，提供具体 `文件:行号`、证据和修复建议。没有足够证据时说明不确定性，不把猜测写成已确认缺陷。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
