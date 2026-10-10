# Spec: utility-workspaces-v2

状态：2026-09-23 已获用户审批。依赖：`desktop-shell-v2`；仪表盘与设置可与资源页并行实施，但共享 `src/styles/global.css` 时只能有一个编辑者。

## 目标与用户

让开发者一眼知道本机环境是否可管理，并在设置里快速找到明确的偏好，不再面对重复标题、模糊的卡片堆叠与常驻状态装饰。

## 能力与验收

- **仪表盘：**按“本机概况→需要注意→最近操作”安排分组行，不重排或伪造真实数据；连接、发现、Homebrew、服务及最近操作的加载、无结果和失败各自在本组表达。主操作是刷新或进入对应资源详情，不以多个同权彩色面板抢注意力。
- **设置：**保留现有七组设置、已选分组记忆、System/Light/Dark 即时切换、刷新/隐私/编辑偏好、备份清理、诊断导出与重置。左侧分组清晰显示选中态，右侧按“标题→简要说明→设置行/危险区”组织，标签、帮助文案、控件与保存反馈具有统一对齐与间距。
- 重置、清理、权限等危险设置保留独立说明和确认，无法把“偏好重置”误读成“删除用户配置”；失败和安全默认值均以文字明确说明。切换分组不丢失已保存偏好，`Command+,` 仍打开设置。
- 两页均在固定窗口和 200% 文本缩放下可通过本面板滚动到达所有主操作；不引入网页式 hero、装饰渐变或堆叠卡片网格。

## 技术、目录及风格

沿用 `src/features/dashboard/`、`src/features/settings/` 及其现有状态与 `src/ipc/settings.ts`；使用 `visual-system-v2` 的色彩、间距和按钮，不在布局层处理持久化。示例：

```tsx
<section aria-labelledby="settings-appearance">
  <h2 id="settings-appearance">外观</h2>
  <AppearanceSettings appearance={appearance} onChange={onChange} />
</section>
```

组件 `PascalCase`、回调 `camelCase`，以语义表单标签、清楚的焦点顺序和真实文案为准。

## 验证

命令：`pnpm lint && pnpm typecheck && pnpm test && pnpm build`；集成时隔离 HOME 运行 `pnpm test:e2e`。人工依次查看全部七组设置、正常/错误/安全默认值、仪表盘各状态和三种外观及 200% 缩放；不新增测试用例。

## 边界

- 始终：保留设置持久化、确认式清理与诊断脱敏。
- 先问：改变偏好 schema、重置语义、启动生命周期或新增测试用例。
- 绝不：把隐私控制降级为装饰、视觉成功代替真实保存结果。
