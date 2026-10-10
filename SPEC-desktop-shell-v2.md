# Spec: desktop-shell-v2

状态：2026-09-23 已获用户审批。依赖：`visual-system-v2`；为 `resource-workspaces-v2` 与 `utility-workspaces-v2` 提供固定窗口工作台。

2026-10-10 窗口行为修订：用户批准原生边框调整大小，默认及最小尺寸为
1120×720，取消最大尺寸限制；最大化、全屏及标题栏双击仍不启用。
本修订替代下文的固定尺寸/禁止 resize 约束，其他布局与交互要求保持不变；
不新增窗口尺寸设置或尺寸持久化。

## 目标与用户

让习惯 macOS 实用工具的用户在固定窗口内立即辨认导航、当前任务、列表和详情；彻底移除“网页包进桌面窗口”的重复标题、装饰品牌区和全页卡片感。

## 能力与验收

- 保留 1120×720、不允许窗口缩放/最大化、macOS 原生交通灯及现有拖拽/双击约束。单一一级侧栏宽度仍约 204px；标题栏约 52px；内容工具栏约 44–52px。取消标题栏内重复的大品牌标志和当前页面重复标题，只保留必要上下文；交通灯点击区域无覆盖。
- 一级导航以图标加文字/当前背景表示选择。工具栏按页面放置搜索、刷新与主要上下文操作，搜索仅在相关页面显示；不会把多组筛选和冗余状态永久塞入工具栏。
- 主体只使用侧栏→列表→详情（必要时检查器）的层级；详情优先保证可读宽度，不在窄空间强挤三个等权栏。侧栏、列表、详情、设置选项和长操作日志各自滚动；`html`、`body`、`#root` 及工作台不滚动且无水平溢出。
- 路由切换、刷新及加载/错误反馈保留已有选择、键盘焦点与上下文；`Command+,`、`Command+R`、`Escape` 清空当前搜索及箭头浏览沿用现有行为。Tab 可达全部主操作，焦点环完整；标题栏交互控件不触发窗口拖拽。
- 系统通知在其对应面板就地显示；全局严重错误使用一条简洁 banner，不用常驻状态栏或到处重复的胶囊。

## 技术、目录及风格

沿用 React 命名槽位、Tauri 窗口配置、Tailwind CSS 4；修改范围限定 `src/app/AppShell.tsx`、`src/app/routes.tsx`、`src/components/DesktopWorkspace.tsx`、`src/components/NavigationRail.tsx` 与 `src/styles/global.css` 中的布局部分，不迁移 provider 逻辑。示例：

```tsx
<DesktopWorkspace
  sidebar={<NavigationRail routes={routes} />}
  toolbar={<ContextActions />}
  list={<ResourceList />}
  detail={<ResourceDetail />}
  detailLabel="资源详情"
/>
```

继续使用现有具名组件、双空格及语义标签；样式从 `visual-system-v2` 的令牌取值。

## 验证

命令：`pnpm lint && pnpm typecheck && pnpm build`；集成时 `pnpm test:e2e`（隔离 HOME）。人工在 1120×720 检查每个页面的滚动归属、交通灯、拖拽、命令键、Tab/箭头与 200% 缩放。不能自动化的检查如实标记待验证；不新增测试用例。

## 边界

- 始终：保留现有安全 IPC、原生菜单事件单通路、跳转主内容及面板标签。
- 先问：修改窗口尺寸、启用 resize、改业务导航语义或增加第三方控件。
- 绝不：多套页面 shell、文档级滚动、挡住交通灯、把 provider 请求搬入共用工作台。
