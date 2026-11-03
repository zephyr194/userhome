---
name: webperf
description: 仅在用户调用 /webperf 时使用。通过 web-performance-auditor 审查浏览器可见应用的性能，区分实测证据和潜在影响。
license: MIT
metadata:
  source: addyosmani/agent-skills
  version: "0.6.13"
  revision: aeac41d4d005999432bb7312f7ff06383a91d59d
  upstream-command: webperf
---

# /webperf

仅适用于有浏览器界面的应用，不适用于工具库、纯 CLI 或没有浏览器输出的服务端代码。

## 选择模式

**深度模式**：有 Lighthouse JSON、PageSpeed Insights JSON、CrUX 响应、DevTools 性能追踪，或存在目标 URL 且当前已配置 Chrome DevTools MCP 或其本地 CLI，可直接采集数据。

**快速模式**：没有上述证据或可用采集能力时，扫描源代码中的结构性反模式，每项发现都标注“潜在影响”，不得声称已经测得性能问题。

如果用户明确要求深度模式，但缺少所需输入或工具，先报告缺口，不静默改成快速模式。不在报告中暴露 API 密钥或其他秘密。

## 执行审查

调用当前可用的 `web-performance-auditor` 代理，并明确提供：

- 审查的文件、组件或差异范围。
- Lighthouse、PageSpeed Insights、CrUX、追踪文件路径或用户提供的 JSON。
- 已知的目标 URL 或页面名称。
- 预期模式及其依据。

代理只读审查，返回仅使用有来源数值的评分表、排序后的发现、正向观察和改进建议。代理不可用时明确报告阻塞，不能冒充已完成专项审查。

直接向用户返回完整中文专项报告，不需要合并其他角色报告。检查清单见 [performance-checklist](../../references/performance-checklist.md)。

适配来源与版本见元数据，许可证见 [MIT License](../../references/LICENSE)。
