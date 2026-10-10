# Spec: visual-acceptance-v2

状态：2026-09-23 已获用户审批。依赖：`resource-workspaces-v2`、`utility-workspaces-v2`；仅汇总可核验的视觉与交互证据，不替代旧版发布关口。

## 目标与用户

将“整体设计不可接受”的问题转化为跨路由可检查的外观、可用性和一致性标准；为最终使用者留下可追溯的人工验收结论，不把自动化成功误认为审美通过。

## 可观察验收

1. 仪表盘、应用/配置、Homebrew、服务、设置五组工作台在 System、Light、Dark 下遵守同一标题、导航、工具栏、行、控件和语义状态约定；没有 hero、通用卡片网格、装饰渐变或重复的品牌横幅。
2. 在固定 1120×720 及 100%/200% 文本缩放下，`document.documentElement.scrollWidth <= clientWidth`、`scrollHeight <= clientHeight`；必要内容能在声明的 pane 内滚动到达，主操作及其错误文案无遮盖。
3. 普通文本及有意义图标对比度 ≥ 4.5:1，大文字、非文本边界和焦点 ≥ 3:1；以实际渲染色（包含叠加/透明态）核验，不只检查 CSS 原始变量。
4. Tab/Shift+Tab、箭头、`Escape`、`Command+,` 和 `Command+R` 可达、可见且不重复执行；原生交通灯不被遮挡，交互控件无误触拖拽。选中、焦点、加载、警告、错误及危险状态都有非颜色线索。
5. 应用每页 50 条及选择/滚动/草稿保留，配置预览→确认、Homebrew 操作、服务操作和设置保存/确认均保持现有行为；弱网/无网本地运行不受 UI 改动影响。
6. 逐路由记录 Light/Dark 与 100%/200% 的人工检查结果、缺陷和复测结果；未进行或无设备/权限/签名条件的检查保持“待验证”，不能标记完成。

## 技术、命令及目录

沿用现有 Tauri、React、TypeScript、Tailwind、Vitest、WDIO。证据更新于 `tasks/todo.md` 与 `docs/release-readiness.md`，不会改动后端权限或捏造 CI/签名结果。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm check
pnpm test:e2e
pnpm build:unsigned
```

人工用隔离/一次性 HOME 检查可交互页面，禁止读写真实用户配置。已有测试覆盖回归；默认不新增测试用例。示例证据记录：`应用页 / Dark / 200%：详情滚动到页尾，预览按钮可用，文档无溢出，普通文字对比度 5.2:1`，每条记录需可复测。

## 边界

- 始终：把未通过与未验证分开记录，保留 T01–T97 原有手动、签名、公证、GitHub CI 和硬件阻塞。
- 先问：改变既有测试门槛、引入自动化视觉依赖、新增测试用例或发布到 GitHub。
- 绝不：用本地无签名构建冒充发布验收、触及真实用户私有配置、用只跑静态检查证明视觉质量。
