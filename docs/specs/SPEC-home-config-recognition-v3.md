# Spec: home-config-recognition-v3

状态：2026-10-10 已获用户审批。依赖：现有 `home-baseline-inventory`、`configuration-platform`、`application-browsing` 与 `ui-layout-completion-v3`。

## 目标

恢复 UserHome 的首要设计目标：让当前 macOS 用户快速知道其用户目录及批准根中识别到了哪些应用配置、这些配置位于哪一类安全相对路径、当前支持程度如何，以及下一步能做什么。Homebrew、服务和机器脉冲是辅助信息，不能取代用户目录配置识别。

“识别用户目录配置”在本规格中指对现有批准根中的配置候选进行有界、metadata-only 发现和分类；不指显示绝对用户主目录，也不授予任意文件浏览或写入权限。

## 信息模型

前端复用现有 typed discovery contract，并至少呈现：

- 识别到的应用或配置名称；
- 安全相对位置：`~/…`、`XDG_CONFIG_HOME/…`、`APPLICATION_SUPPORT/…` 或 `HOMEBREW_PREFIX/…`，绝不显示绝对 home 或用户名；
- 识别证据，例如配置存在、可执行文件存在、catalog document 或 bounded root entry；
- 覆盖级别：可管理、受管只读、已识别但暂不支持、已排除；
- 分类理由、敏感性提示及可执行的下一步；
- 扫描完整性和 permission/timeout/entry-limit/symlink 等显式结果。

统计总数必须由同一 discovery snapshot 推导，且各覆盖分类计数之和与已分类候选总数一致。不得使用离线 catalog 总条目数冒充“本机已识别应用数”。

## Dashboard 首要摘要

Dashboard 在连接成功并取得本地 snapshot 后，第一主要分组为“用户目录配置”：

- 显示扫描状态以及“已识别配置候选”总数；
- 分别显示可管理、受管只读、暂不支持和已排除数量；
- 展示有限数量的最近/优先可行动识别项，至少包含名称、安全相对路径、覆盖级别和证据摘要；
- 提供进入 Applications 的明确操作，并携带“本机已识别”上下文；
- partial 状态保留已取得的数据，同时显式列出未完成原因；
- zero state 明确区分“扫描完成但未识别”“扫描范围被禁用”“扫描尚未完成”和“扫描失败”。

该分组不得被通用系统信息、装饰指标或 catalog 总量挤出最小窗口首屏。Dashboard 可隐藏敏感内容，但不得隐藏配置存在性、分类或失败证据。

## Applications/Configuration 深入查看

- 从 Dashboard 进入时，Applications 默认显示与当前 snapshot 对应的本机识别项，而不是让用户先在全部离线目录中重新搜索。
- 用户可切换到完整 catalog；“本机识别”和“全部目录”必须有清楚标签，计数含义不能混用。
- 选中识别项后固定显示安全路径、证据、覆盖级别、分类理由和配置文档状态。对于暂不支持或已排除项，显示不能管理的原因，不呈现写入动作。
- 可管理/受管只读能力继续完全由 Rust catalog 授权；发现本身永远不提升权限。

## 状态矩阵

| 状态 | 必须显示 | 禁止行为 |
|---|---|---|
| Loading | 正在扫描的范围与非阻塞进度文案 | 显示 0 作为最终结果 |
| Ready | 分类计数、识别项、证据和安全路径 | 用 catalog 总数替代识别总数 |
| Empty | 已完成范围、零结果说明、刷新/隐私设置入口 | 暗示用户没有任何配置 |
| Partial | 已取得结果、缺失模块和具体原因 | 清空已有识别结果 |
| Error | 失败模块、可恢复操作及不受影响的本地数据 | 只显示颜色或通用“离线” |
| Restricted | 权限/根禁用/安全排除说明 | 建议扩大任意文件权限 |

## 隐私、安全与性能边界

### 始终

- 复用现有批准根、上限、稳定 candidate ID、脱敏路径与分类。
- 配置内容只经 catalog-authorized document flow 打开。
- 自动化仅使用临时 HOME；人工检查不修改真实配置。

### 先问

- 新增扫描根、提高深度/条目/时间上限、读取未知候选内容或修改 IPC wire schema。除已批准的 discovery DTO、计数 selector 与 stale snapshot 定向测试外，新增测试用例仍需先确认。

### 绝不

- 递归扫描完整 HOME、显示绝对 home/用户名、读取凭证/数据库/缓存/日志/运行态，或把发现等同于写入授权。

## 验证

使用临时 HOME 覆盖 loading、ready、empty、partial、error、restricted，以及可管理、只读、暂不支持和排除四类 fixture。验证安全相对路径、计数守恒、稳定分类、Dashboard→Applications 上下文和无权限升级。保留“本地 metadata 在基线机器两秒内可用”的现有目标。
