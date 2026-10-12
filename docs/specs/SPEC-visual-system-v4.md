# Spec: visual-system-v4

状态：2026-10-12 已获用户审批。依赖：现有 UI correction v3 实现。

本规格在色彩、表面、边界、阴影、焦点和共享交互组件方面替代
`SPEC-visual-system-v2.md`、`SPEC-ui-visual-system-v3.md` 及其他规格中的冲突条款；
不改变路由、发现、catalog、配置写入、Homebrew、服务或提权权限。

## 设计原则

- 采用暖灰琥珀视觉方向。信息层级首先来自排版、留白和三层表面，而不是密集边框。
- 被动容器、Panel、Badge、普通列表行和元数据项默认无完整外框。
- 阴影只表达真实 elevation：Modal/Popover 使用 raised shadow，sticky 操作区使用 sticky shadow。
- 色彩只辅助状态；状态、选中与焦点必须同时有文字、图形或形状线索。
- System、Light、Dark 的结构、尺寸和状态完全一致，切换不丢失任何 UI 状态。

## 暖灰琥珀语义色

| Role | Light | Dark |
|---|---|---|
| canvas | `#F5F1EA` | `#171512` |
| surface | `#FCFAF6` | `#211E1A` |
| raised | `#FFFFFF` | `#2A2621` |
| foreground | `#29241E` | `#F3ECE2` |
| muted | `#746A5E` | `#B8ADA0` |
| accent | `#B65C24` | `#F0A060` |
| accent-text | `#A94F1F` | `#F0A060` |
| success-text | `#2B744F` | `#65C894` |
| warning-text | `#8C5F12` | `#E3B85B` |
| danger-text | `#B33A3A` | `#EE7D78` |
| line-subtle | `#D8CEC1` | `#4F473E` |
| control-border | `#948678` | `#7C7062` |
| selection-bg | `#F3E3D7` | `#3B2A20` |
| selection-marker/focus | `#B65C24` | `#F0A060` |
| on-accent/on-danger | `#FFFFFF` | `#29241E` |

Accent/success/warning 的 base 色不直接用于 Light 小文本；必须使用加深的 `*-text` token。
Muted 或状态正文不得再叠 opacity。Soft 状态背景必须是显式不透明 token，并对最终组合运行
普通文本 ≥4.5:1、非文本/焦点/控件边界 ≥3:1 的验证。

## 三层表面与边框预算

- **Canvas：**窗口底色与 pane gutter；无边框、无阴影。
- **Surface：**主要 list/detail/settings/dashboard 区域；默认无外框、无阴影。
- **Raised：**Modal、Popover、浮层；使用单一 raised shadow，必要时弱外沿。
- **允许边界：**字段和 secondary button 的 control border；相邻独立滚动 pane 间一条 divider；
  selected marker/radio-card；Danger Zone/invalid；spinner/status glyph 等功能性图形。
- **禁止默认边界：**普通 Panel、Badge、list row、metadata tile、每段 header/content/footer、
  嵌套 section 和仅为“像区块”而增加的四边框。

## 字体、尺寸、圆角与间距

- 字号：metadata `11px`、aux `12px`、body `13px`、group `14px`、page title `20px`。
- 控件：compact `32px`、standard `36px`；resource row `40px`、two-line `52px`，200% 允许增高；
  Badge `20–22px`。
- 间距物理刻度：`2 / 4 / 8 / 12 / 16 / 20 / 24px`，组件只通过语义 token 使用。
- 圆角：control `8px`、raised/panel `12px`、pill/circle `999px`。
- 阴影：只允许 `shadow-raised` 与 `shadow-sticky`。

## Headless UI 交互合同

- `src/features/**/*.tsx` 不得直接渲染 `<input>`、`<select>`、`<textarea>` 或 `<button>`；
  全部经共享 Headless UI 2.2.10 adapter。
- 允许保留真正的 `<form>` 提交容器，以维持 Enter、constraint validation、`FormData` 和
  `reset()`。`<option>` 只由共享 Select 根据 options 数据渲染。
- 共享组件至少包括 Button、FieldFrame、TextField、TextAreaField、SelectField、CheckboxField、
  SwitchField、RadioCardGroup、SecretReplacementField、Tabs 和永久可见 SelectionList。
- Field/Label/Description/error 必须建立可访问关联；invalid、disabled、readonly、required
  在语义与视觉上同时成立。
- Secret 始终 replacement-only：`password`、`new-password`、空初值、spellcheck off，绝不接收或
  显示当前 secret。

## 焦点合同

- 组件和页面不得使用 CSS/Tailwind outline utility。全局仅允许 `outline: none` 用于关闭 UA 默认。
- 键盘 `:focus-visible` 使用 surface gap + focus 色的双层 `box-shadow`；overflow row 使用 inset shadow。
- forced-colors 使用 `Highlight`/`Canvas` 系统色的 border 或伪元素，不恢复作者 outline。
- 选中和焦点必须同时可辨，不得因 overflow 裁切。

## 验收

- 业务层零直接原生字段/按钮；FormData/reset/required/secret 语义有真实交互证据。
- 除全局 reset 外零 outline 声明/utility；每个键盘焦点有非 outline 可见指示。
- 无旧蓝灰色、页面 literal color、旧短 alias、compat layer 或迁移型 `!important`。
- 普通容器、Badge、metadata 和 list row 默认无 perimeter border；所有剩余边界均可归类。
- 五路由通过 Light/Dark/System、键盘、长文本、1120×720、真实 200% 与辅助技术矩阵；
  无法执行的真人检查保持 Blocked。
