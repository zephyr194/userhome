# 服务页重设计：面向开发者的朴实视图（已确认 2026-10-23）

## Problem Statement
怎样让开发者看服务时知道：它是干什么的、什么时候启动、谁装的、文件在哪、日志在哪，而不是 launchd 的内部状态字段？

## 用户答复
- 默认只看开发者相关：隐藏 Apple 系统服务；按“注入方”分组（UserHome 管理的、Homebrew、应用安装的、用户自建的）；“显示系统服务”开关。
- “作用”只自动推断（内置常见开发服务词典 + Homebrew 公式名/应用名），推断不出显示“未知”并给程序路径；不做用户备注。

## Recommended Direction
每行：可读名称、一句话作用、启动时机（开机/登录启动、常驻保活、定时、按需）、运行状态。详情四块：它是什么（作用+注入方）、什么时候启动、文件位置、日志；launchd label/域/退出码等放进默认折叠的“详细信息”。保留已有启动/停止等操作。

## Key Assumptions
- [ ] 注入方由 plist 所在目录、label 前缀、程序是否在 /Applications/*.app 内判断。
- [ ] 启动时机需补解析 StartInterval/StartCalendarInterval/WatchPaths/Sockets/QueueDirectories（目前只解析 RunAtLoad、KeepAlive）。
- [ ] 作用词典覆盖不全，宁可显示“未知”不编造。

## MVP Scope
做：范围过滤、按注入方分组、四块详情、内置词典、补解析启动时机。

## Not Doing
- 用户手写备注。
- 服务依赖图、历史运行记录。
