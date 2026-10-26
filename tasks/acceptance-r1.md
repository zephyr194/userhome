# 修订 R1 桌面验收记录（FIX-6）

日期：2026-10-16（首次尝试 2026-10-15 被阻塞，用户重设 Orca Computer Use 的辅助功能后完成）。

## 环境
- 构建：`pnpm build:e2e` 与 `pnpm tauri build --debug --bundles app --features e2e`（FIX-1…FIX-5 之后的代码，提交 273f2ac；FIX-7 为纯后端，未重新构建）。
- 运行：`open -n --env HOME=/tmp/userhome-r1-home …/UserHome.app`，偏好 `openWindowOnLaunch: true`，`grants.json` 预先写入损坏内容 `{"schemaVersion":1,"grants":[ BROKEN`。没有触碰真实 HOME、真实配置或其他应用。
- 工具：`orca computer`（get-app-state、click、press-key；accessibility 与 screenshots 均为 granted；capabilities 的 dialogs/menus 表面不支持）。

## 结果
| 项 | 结果 | 证据 |
|---|---|---|
| 损坏授权库下应用启动并显示窗口 | 通过 | 1120×720 窗口；可访问性树含“授权存储不可用 / 授权文件已损坏，授权相关操作暂时不可用。重置后所有授权需重新选择，原文件会改名保留，不会被删除。 / 隔离并重置 / 重新检测” |
| 启动时不自动重置 | 通过 | 运行后 `grants.json` 校验值与启动前一致，目录内无隔离文件 |
| 点“隔离并重置”出现确认对话框，默认焦点在“取消” | 通过 | 树中对话框“隔离并重置授权存储？”，`The focused UI element is 取消`；说明“所有授权需重新选择；原文件会改名保留，不会被删除。‘取消’不会改变任何内容。” |
| Esc 取消：不改变任何内容、焦点回到触发按钮 | 通过 | Esc 后对话框消失，焦点为“隔离并重置”按钮，`grants.json` 校验值不变，无隔离文件 |
| 确认后：隔离、建空库、完成提示 | 通过 | 目录出现 `grants.json.corrupt-20261016T032131Z`（权限 0600，内容与校验值同原文件 efd89e42…）；新 `grants.json` 为 `{"schemaVersion":1,"grants":[]}`；提示变为“授权存储已重置 / 原文件已改名保留为 grants.json.corrupt-…，不会被删除。所有授权需重新选择。 / 知道了”；点“知道了”后提示消失 |
| 导航分组与视觉（亮色主题） | 通过 | 截图：系统工具（即将提供）、工具集（即将提供）、支撑（概览、服务、设置），当前项高亮，无旧入口 |
| 键盘 Tab 在对话框内的焦点移动 | **未能验证** | `press-key Tab` 后可访问性树仍显示焦点在“取消”。WKWebView 的 Tab 是否会停在按钮上取决于 macOS 的“键盘导航/全键盘控制”设置，无法判断是应用问题还是环境设置；Esc 与点击均正常。需人工确认 |
| 成功后的焦点位置 | 记为 Optional | 重置成功后可访问性树显示“没有焦点元素”（触发按钮已消失，焦点落到主内容容器）；建议把焦点移到“知道了”按钮或完成提示，屏幕阅读器用户才能听到结果 |
| 暗色主题、窗口最小尺寸、长文本 | 未验证 | 本轮未切换系统外观或缩放窗口 |
| 退出确认对话框 | 无法验证 | 当前没有任何界面会启动由 UserHome 管理的进程，退出时无进程可确认；由 Rust `lifecycle` 测试与前端对话框测试覆盖 |
| LogViewer / SecretValue | 无法验证 | 组件尚未挂载到任何页面，仅有单元测试 |
| 新建文件授权的原生流程 | 无法用界面验证 | 没有界面调用保存位置选择；由 Rust 测试覆盖（`new_file_tests`、`commands::grants` 的 e2e 夹具用例） |
| 原生选择面板 | 不可驱动 | `orca computer capabilities`：surfaces.dialogs = false；面板内选择由夹具覆盖 |
| VoiceOver | 人工 | 本轮不做 |

## 附带观察
- e2e 构建在窗口右下方有 WDIO 探针浮层（E2E enabled、E2E token、Probe 按钮），遮挡内容区一角；仅 `e2e` 特性构建出现，正式构建不含。
- 第一次尝试时 `get-app-state` 返回 `permission_denied`（AX 读取被阻塞），重设辅助功能权限后恢复；根因未再追查。
- 验收用的应用实例仍在运行（临时 HOME `/tmp/userhome-r1-home`），结束它的命令被自动模式拦截，留给用户处理。
