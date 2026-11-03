# 错题册第一批：总表与规则提案（batch-1）

- 数据来源：主分支 `git log` 中标题以 `fix`/`revert` 开头的全部提交（统计于 2026-11-03，分支 `zephyr19/incidents-coldstart` 基于 `dee401c`）。
- 统计结果：fix 100 个，revert 0 个（标题含“撤销/回滚”的提交都是 feat/test/refactor，或是针对授权撤销的 fix，不是 revert）。
- 状态：以下规则均为**提案**，需用户批准后才能落地；worker 不得自行实现或修改规则（见 README.md）。
- 推断标注：类型、签名为人工归类；引入点只在追溯成本低时才确认，其余为 `unknown`；Rust 侧修复的测试本机均未运行。

## 一、总表：全部 fix/revert 提交（共 100 个，其中 revert 为 0 个）

类型与签名为逐提交阅读提交信息、`git show --stat` 及部分 diff 后的**人工归类**，不是机器判定；归类依据不足的条目在对应 INC 中标 `confidence: low`。

### 1.1 类型统计

| 类型 | 数量 |
|---|---|
| missing-edge-case | 41 |
| ui-spec-drift | 34 |
| wrong-intent | 8 |
| platform-assumption | 7 |
| regression | 4 |
| scope-creep | 3 |
| other | 2 |
| false-done | 1 |
| test-cheat | 0 |
| **合计** | **100** |

### 1.2 签名字典

| 签名 | 说明 | 提交数 | 对应 INC |
|---|---|---|---|
| S01 | 按钮 variant 层级契约：未显式指定或指定错误 | 4 | INC-0001 |
| S02 | 按钮 size 契约：sm/md 误用导致与输入框不等高或超出规格 | 4 | INC-0002 |
| S03 | 全局样式令牌/视觉规格偏离（行高、圆角、边框、字体、对比度） | 10 | INC-0003 |
| S04 | CSS 层叠：未分层的全局规则压过 Tailwind 工具类 | 1 | INC-0004 |
| S05 | 布局边界：长文本溢出/换行/对齐/滚动容器细节 | 9 | INC-0005 |
| S06 | 同一信息重复显示或出现/消失时撑动布局 | 4 | INC-0006 |
| S07 | 选中指示器 useSlideIndicator 的边界状态逐个补漏 | 7 | INC-0007 |
| S08 | 界面文案声称的状态与后端实际行为或页面其他处不符 | 6 | INC-0008 |
| S09 | 文案/术语/标点打磨（内部词、冗余说明、命名不统一） | 6 | INC-0009 |
| S10 | 异步竞态、请求过期、交互状态丢失或顺序错误 | 8 | INC-0010 |
| S11 | 秘密值/路径遮盖不完整（fail-open，逐轮补漏） | 5 | INC-0011 |
| S12 | 授权（grant）范围过宽或用后未撤销 | 3 | INC-0012 |
| S13 | 外部命令输出/文件格式解析的边界情况 | 8 | INC-0013 |
| S14 | 重构后丢失既有能力（回归） | 4 | INC-0014 |
| S15 | 测试/审计自身有缺口（断言写错或依赖运行环境） | 2 | INC-0015 |
| S16 | 超出需求的顺带改动 / 一个提交混入多件事 | 3 | INC-0016 |
| S17 | 领域语义误判（子串匹配、作用域、优先级、空值） | 4 | INC-0017 |
| S18 | 焦点、读屏与强制色彩等可访问性语义 | 4 | INC-0018 |
| S19 | 失败路径缺少用户可见反馈或补救入口 | 5 | INC-0019 |
| S20 | 对平台/系统行为的假设未经实机验证 | 3 | INC-0020 |

### 1.3 逐提交明细

| 提交 | 标题 | 类型 | 签名 |
|---|---|---|---|
| `a8f46c9` | fix(ai-config): 收紧工具列表行距，更新展示日志，查看配置切换工具时清除残留 | scope-creep | S16 |
| `9c16f75` | fix(caddy): 返回系统工具改为导航链接 | ui-spec-drift | S18 |
| `abc5407` | fix(services): 创建表单的命名空间前缀不再折行，与输入框等高 | missing-edge-case | S05 |
| `1f5e0db` | fix(services): 列表副标题不再把页面描述为只读 | wrong-intent | S08 |
| `6c798cb` | fix(services): 详情读取失败时指向左侧清单的重试入口 | missing-edge-case | S19 |
| `757244e` | fix(ui): 出错后的补救按钮（概览、Brew、Caddy 工作目录）保持小号 | ui-spec-drift | S02 |
| `1d37916` | fix(environment): 空状态补充下一步并统一读取顺序叫法 | wrong-intent | S09 |
| `fa3b7d7` | fix(ai-config): 刷新失败面板内补充重试按钮 | missing-edge-case | S19 |
| `97193fe` | fix(caddy): 运行实例的停止按钮文案改为停止 | wrong-intent | S09 |
| `2740c30` | fix(shell): 退出提示文案去掉中文引号前多余空格 | other | S09 |
| `1d13a17` | fix(ui): 按钮默认 md，sm 仅用于通知条与行内小工具 | ui-spec-drift | S02 |
| `30685a9` | fix(ui): 通知条关闭按钮改用小尺寸，与操作按钮等高 | ui-spec-drift | S02 |
| `010a00a` | fix(styles): 按钮与输入框的字号类改为对工具类生效 | ui-spec-drift | S04 |
| `f34583b` | fix(styles): 导航行高与状态标签圆角改用规格令牌 | ui-spec-drift | S03 |
| `3cc3e7f` | fix(styles): 小标题去掉等宽字体与宽字距，与清透基线一致 | ui-spec-drift | S03 |
| `876b5b8` | fix(tools): 工具页选项卡补充 aria-current，与其他指示条用法一致 | missing-edge-case | S07 |
| `dfd29a8` | fix(ui): 指示条测量优先采用 aria-current，修复向上移动选中时不滑动 | missing-edge-case | S07 |
| `7a76e2e` | fix(ui): 刷新失败提示可关闭，概览 AI 检测复用缓存，授权重置后失效概览数据 | missing-edge-case | S10 |
| `dadc871` | fix(ai-config): 当前配置遮盖改为逐键值对扫描，补全同行多键、数组参数与 env/headers 容器 | missing-edge-case | S11 |
| `d1ee404` | fix(ui): 恢复秘密值遮盖时也可复制的原有行为 | scope-creep | S16 |
| `2173cda` | fix(ai-config): AI 配置页按钮按层级契约显式指定 variant | ui-spec-drift | S01 |
| `56aced0` | fix(app-config): 应用配置页按钮按层级契约显式指定 variant | ui-spec-drift | S01 |
| `1c6d385` | fix(services): 服务页按钮按层级契约显式指定 variant | ui-spec-drift | S01 |
| `27322c5` | fix(environment): 环境页按钮按层级契约显式指定 variant | ui-spec-drift | S01 |
| `b32d3b0` | fix(env): 环境变量读取值可复制，秘密值显示后才可复制 | scope-creep | S16 |
| `f9e62ed` | fix(services): 编辑保存后“已保存配置”只显示一次 | ui-spec-drift | S06 |
| `c4a4cad` | fix(ui): 弹框标题与页脚固定，只滚动主体；支持的配置按钮移入列表标题行 | ui-spec-drift | S05 |
| `62548e5` | fix(shell): 顶部状态提示改为浮层，不再把内容往下推 | ui-spec-drift | S06 |
| `f523d26` | fix(ui): 选中框写入坐标后先回流再清除 instant，避免误触发过渡 | missing-edge-case | S07 |
| `7a41805` | fix(services): 摘要日志路径取主配置文件，PID 文案改走 i18n | wrong-intent | S17 |
| `f2b6990` | fix(services): 服务用途词典改为完整名精确匹配，避免 exporter 与 backup 误判 | missing-edge-case | S17 |
| `f7de30e` | fix(env): 搜索命中的读取链默认展开，用户收起后保持到搜索词变化 | missing-edge-case | S10 |
| `968123e` | fix(services): 忽略超过十年的 launchd StartInterval | platform-assumption | S13 |
| `afda9f4` | fix(ai-config): 读取 nvm 别名前先确认是常规文件 | platform-assumption | S13 |
| `a41d847` | fix(nav): 侧栏选中框在换语言等非选中变化后立即到位 | missing-edge-case | S07 |
| `f9d8aec` | fix(env): 登录会话的空值按空值显示 | missing-edge-case | S17 |
| `ef18bf6` | fix(i18n): 复数计数保持纯数字并显式传入系统语言 | other | S15 |
| `4913e6f` | fix(ipc): 严格解码拒绝多余字段与畸形的安装来源 | missing-edge-case | S13 |
| `5ad8638` | fix(environment): dotenv 重复键统一为同文件最后一处生效 | wrong-intent | S08 |
| `b43f987` | fix(styles): 收窄 r7 选中样式的作用范围并补强制色彩模式 | ui-spec-drift | S03 |
| `ca668bb` | fix(nav): 侧栏对比度测试改用真实的 hover 令牌并校验选中底色 | false-done | S15 |
| `7fbbcac` | fix(environment): 登录会话变量确认时使用预览时的名称和值 | missing-edge-case | S10 |
| `36befe0` | fix(environment): zsh 同名变量按适用范围判断最终值 | missing-edge-case | S17 |
| `93881df` | fix(environment): 移除登录变量时校验当前值，拒绝以 - 开头的值 | platform-assumption | S20 |
| `cb648b3` | fix(ai-config): 安装来源判定拒绝包名中的 . 与 .. 段 | missing-edge-case | S13 |
| `82e3db9` | fix(ai-config): 升级结果只在版本确实变化时声称已更新 | missing-edge-case | S08 |
| `91834f3` | fix(app-config): 修复续行值、同表 dotted 键与秘密原文覆盖的写入风险 | missing-edge-case | S13 |
| `c31bd65` | fix(app-config): 新建文件保存时不再声称已备份原文件 | missing-edge-case | S08 |
| `d85a43e` | fix(caddy): 配置示例弹层里不再嵌套第二个“在窗口中查看” | ui-spec-drift | S06 |
| `bda86ab` | fix(menu): 环境变量与设置去外框，二级菜单左右对齐 | ui-spec-drift | S03 |
| `7e484ad` | fix(environment): 域菜单固定，只有域内容滚动，各域保留自己的滚动位置 | ui-spec-drift | S05 |
| `92df1c7` | fix(ui): 纵向选中框加圆角，滑动拉长到 240ms，减弱动效时只做透明度过渡 | missing-edge-case | S07 |
| `94d2ece` | fix(ui): 选中框保留上一次位置，隐藏与尺寸变化时不回到原点 | missing-edge-case | S07 |
| `7490e3b` | fix(ui): 纵向列表行允许换行，长标识不再溢出到徽标下 | missing-edge-case | S05 |
| `2b413fd` | fix(ui): 系统工具卡片内容左对齐 | ui-spec-drift | S05 |
| `56c6084` | fix(ui): 校对设置提示文案、系统工具卡片内边距与概览服务说明 | ui-spec-drift | S09 |
| `8e128e3` | fix(shell): 恢复侧栏连接状态，避免一直显示正在连接 | regression | S14 |
| `47703d2` | fix(nav): 概览与环境变量页的说明文案对齐新结构 | wrong-intent | S09 |
| `929c6f1` | fix(ai-config): AI 工具页改用用户能懂的术语 | wrong-intent | S09 |
| `f49d2cf` | fix(ui): 侧栏由导航自身滚动，移除导航项多余的竖条伪元素 | missing-edge-case | S07 |
| `37ceb45` | fix(ui): 下拉选项允许换行并按内容撑开面板宽度 | missing-edge-case | S05 |
| `730e162` | fix(ui): 按钮文案完整显示，超长文案缩短为动词加宾语 | ui-spec-drift | S05 |
| `9e7facb` | fix(tools): 工具面板统一 1px 外框，格式化后定位到结果 | ui-spec-drift | S03 |
| `534d112` | fix(environment): zsh 读取顺序改为固定列宽的对齐表格 | ui-spec-drift | S03 |
| `5960fb8` | fix(environment): 统一环境页分区头并说明扫描按钮禁用原因 | ui-spec-drift | S03 |
| `00a493e` | fix(shell): 刷新完成提示 3 秒后淡出，主内容区不再画系统焦点线 | ui-spec-drift | S18 |
| `4625a49` | fix(caddy): 版本检测的安全提示常驻显示，不收进折叠区 | ui-spec-drift | S05 |
| `a233117` | fix(ai-config): 检测中显示固定高度骨架行，左栏改为名称与状态两行，统一配置状态符号 | ui-spec-drift | S05 |
| `b31a9d4` | fix(app-config): 页头刷新接入重载，去掉重复刷新与重复的位置、只读信息，代码块可换行 | ui-spec-drift | S06 |
| `d66fdd7` | fix(services): 忙碌读取改为中文说明并自动重试一次 | missing-edge-case | S19 |
| `8b005db` | fix(ipc): 并发的服务清单读取共享同一次请求 | missing-edge-case | S10 |
| `1e43dcf` | fix(ai-config): 修正 Copilot 核验说明与官方设置参考一致 | wrong-intent | S08 |
| `496647c` | fix(ai-config): 官方参考文本中的控制字符替换为空格 | missing-edge-case | S13 |
| `cfdeb0a` | fix(styles): 选中角标基础态预留透明边框，焦点环保留发丝线 | ui-spec-drift | S03 |
| `3ab42b8` | fix(ai-config): 含占位符的命令禁止在终端打开并固定工作目录 | missing-edge-case | S08 |
| `2be6246` | fix(styles): forced-colors 下为 Panel 与 Modal 的发丝线补系统色边框 | ui-spec-drift | S18 |
| `8e588fe` | fix(caddy): 校验诊断改用占位替换证书与私钥路径 | missing-edge-case | S11 |
| `cee157a` | fix(caddy): 运行日志与诊断离开会话前替换证书与私钥路径 | missing-edge-case | S11 |
| `76cd33b` | fix(styles): 侧栏悬停态沿用侧栏悬停令牌以保证与底色的区分度 | ui-spec-drift | S03 |
| `1d832a4` | fix(ui): 标题栏与工具栏收紧到 44px，标题与描述行高去掉撑高 | ui-spec-drift | S03 |
| `6a5e10b` | fix(caddy): 运行诊断离开会话前脱敏 | missing-edge-case | S11 |
| `0e07167` | fix(environment): 同排输入框旁的删除按钮改为 md 档 | ui-spec-drift | S02 |
| `ee07246` | fix(services): 修正 launchctl print 域块的状态标记与 PID 0 解析 | platform-assumption | S13 |
| `7e86aba` | fix(qr): 放弃或过期的导出调用撤销授权并提示撤销失败 | missing-edge-case | S12 |
| `c94fc16` | fix(qr): 导出授权用后即撤销并新增放弃预览命令 | missing-edge-case | S12 |
| `7842992` | fix(grants): shell 启动文件授权限定专用命令（新增 ShellStartupFile 用途，通用读写入口一律拒绝；写入前先跑默认文本校验；zsh 预览对敏感变量名给风险警告；ZDOTDIR 含 .. 段判为无法静态确定） | missing-edge-case | S12 |
| `6310e80` | fix: restore route focus and region semantics | regression | S14 |
| `456b64b` | fix: surface refresh failures and retained Brew data | missing-edge-case | S19 |
| `1cbd863` | fix: restore system light and dark appearance | regression | S14 |
| `cc3e20f` | fix: authorize dragging the native main window | platform-assumption | S20 |
| `cd7f027` | fix: preserve schema list drafts while typing | missing-edge-case | S10 |
| `66fa596` | fix: enforce the native desktop content size | platform-assumption | S20 |
| `3497275` | fix(settings): report retention cleanup setup failures | missing-edge-case | S19 |
| `eb8035c` | fix(config): classify binary plists as metadata only | platform-assumption | S13 |
| `f77424d` | fix(refresh): queue forced provider refreshes | missing-edge-case | S10 |
| `a83a828` | fix(settings): persist retention before cleanup | missing-edge-case | S10 |
| `ab9723b` | fix(sidebar): keep focus rings inside navigation rows | ui-spec-drift | S18 |
| `029c601` | fix(services): ignore stale action previews | missing-edge-case | S10 |
| `be02029` | fix(discovery): restore bounded candidate scan | regression | S14 |
| `1d1900a` | fix(config): fail closed for sensitive read-only files | missing-edge-case | S11 |

---

## 二、规则提案（共 8 条，均为草案：未实现、未在本机验证）

排序说明：层级选择按“代价 × 频次 × 漏得多远”判断——代价取 INC 的 `cost`，频次取总表中该签名的提交数，漏得多远看错误停在哪一层才被发现（只到自己的测试，还是到了审查/用户/真机）。本批没有任何提交可确认 `escaped_to: user-machine`，逃逸距离多为 `unknown`，这一项只能做保守估计。

### P1：敏感输出对抗性样例集 + 触及脱敏文件必须同改样例（签名 S11）

- 针对签名：S11 秘密值/路径遮盖不完整（fail-open，逐轮补漏）
- 对应错题：INC-0011（提交 dadc871、8e588fe、cee157a、6a5e10b、1d1900a）
- 建议层级：**L4 + L5**。理由：代价 high（秘密泄漏）；频次 5 个提交，caddy 一条链就修了 3 轮；漏得多远——`dadc871` 是“审查发现”，说明实现者自己的测试没覆盖，泄漏路径只差一次审查就会进入发布。
- 规则草案：
  1. L4：新增共享样例集 `src-tauri/tests/fixtures/redaction_corpus.toml`（及 TS 侧 `src/components/ui/redactionCorpus.ts`），每条记录 `input / must_not_contain / must_contain`。首批场景直接取自 dadc871 的提交信息：同一行首个键为秘密、其后仍有秘密键；`--token` 一类参数的下一个值；内联表与 `env/headers`（JSON、TOML 表、YAML 块）；证书/私钥路径跨读取分片。所有脱敏函数（`config_view`、`caddy/redact`、`config/redaction`、`secretMask`）都对同一份样例跑。
  2. L5：提交前 hook，匹配条件 = 暂存区含 `src-tauri/src/(ai_config/config_view|caddy/redact|config/redaction)*.rs` 或 `src/components/ui/secretMask.ts`，且不含对 `redaction_corpus` 的改动 → 拒绝并提示“脱敏改动必须新增或确认样例”。
  ```
  # 伪代码（草案）
  changed = git diff --cached --name-only
  if any(re.match(REDACT_PATHS, f) for f in changed) and not any("redaction_corpus" in f for f in changed): exit 1
  ```
- 正向回归用例：取 `dadc871^` 版本的 `config_view.rs`，放入样例集（含 dadc871 提交信息列出的泄漏场景），样例应失败；取 `dadc871` 版本应通过。caddy 侧取 `6a5e10b^` / `cee157a^` 同理。
- 反向误报验证：(a) 对 HEAD 全量跑样例集，应全部通过；(b) 增加“不含秘密”的样例（普通键值、名字里含 token 字样但不是秘密的字段、路径不在授权集合内），断言输出与输入逐字相同，防止过度遮盖；(c) hook 只匹配上述路径，用一个只改 README 的提交确认不触发。
- 验证限制：Rust 样例在本机无法运行（测试二进制被拦截，见 INC-0011 备注），需在 CI 或其他机器上确认；TS 侧样例可本地跑。

### P2：授权生命周期契约测试（签名 S12）

- 针对签名：S12 授权（grant）范围过宽或用后未撤销
- 对应错题：INC-0012（c94fc16、7e86aba、7842992）
- 建议层级：**L4**，其中“新增 `GrantPurpose` 须声明通用入口行为”可后续升到 L6。理由：代价 high（任意写入越权）；频次仅 3，但都在授权/写入这一高敏感面；漏得多远未知。
- 规则草案：Rust 测试辅助 `assert_grant_released(&store, id)`；每个创建授权的命令（`qr`、`caddy`、`shell_startup`）必须有三条出口测试——确认成功、确认失败、放弃/过期——之后授权库中该 id 不存在，或通用 `resolve/read/preview/execute` 一律返回 `PermissionDenied`。另加源码检查测试：`GrantPurpose` 每新增一个枚举值，必须在 `grants/*_tests.rs` 中出现对应的“通用入口拒绝”断言。
- 正向回归用例：以 `c94fc16^` 的 `qr.rs` 运行新测试——确认导出后通用文本写入口仍可预览该文件，测试应失败；`c94fc16` 版本应通过。`7842992^` 的 `GrantPurpose::ConfigFile` 可被 zsh 通用写入口使用，同样应失败。
- 反向误报验证：长期授权（Caddy 工作目录、用户设置的发现根）声明为 `persistent`，测试应放行；用现有 `grants` 测试套件全量运行，确认没有把合理的长期授权判为泄漏。
- 验证限制：同 P1，Rust 测试需在其他环境确认。

### P3：异步结果绑定请求的测试工具与统一 hook（签名 S10）

- 针对签名：S10 异步竞态、请求过期、交互状态丢失或顺序错误
- 对应错题：INC-0010（8b005db、029c601、7fbbcac、f77424d、a83a828、7a76e2e、cd7f027、f7de30e）
- 建议层级：**L4 → L6**。理由：代价 mid；频次 8，本批第三高；漏得多远——8b005db 的症状是 开发期 StrictMode 双挂载下就可能让服务清单丢失，却是在后续才修；统一封装可以让错误无法表达（L6）。
- 规则草案：
  1. L4：测试工具 `renderStrict(ui)`（包 `<React.StrictMode>`）和 `deferred()`（可手动 resolve/reject 的 Promise）。规则：凡在挂载时调用 `src/ipc/*` 的页面，必须有一条“StrictMode 双挂载只发出一次后端调用”与一条“旧响应晚于新响应到达时被丢弃”的测试。
  2. L6：抽出 `useLatestRequest()`/`singleFlight()`，ESLint 规则 `userhome/no-raw-ipc-in-effect`：`useEffect` 内直接 `await` ipc 调用并 `setState` 时报错，要求走上述封装。
- 正向回归用例：`8b005db^` 的 `src/ipc/services.ts` + 新增的 StrictMode 测试应失败（后端收到两次 invoke）；`029c601^` 的 `ServicesPage.tsx` + “快速切换选中后旧预览不应弹确认”测试应失败。
- 反向误报验证：对 HEAD 全量运行 ESLint 规则，列出命中项逐个人工判断；把已有、确实无需绑定请求的一次性读取标注豁免，豁免清单需随规则一并批准。预计误报集中在只读且不依赖选中项的页面。
- 状态：L4 工具与服务页 L6 已实现，ESLint 规则试运行（warn）
- 试运行命中数：全仓 13 处，服务页 0 处，其余页面本次未迁移；豁免只是提案，未落地

### P4：UI 契约审计升级为 ESLint 规则（签名 S01–S04）

- 针对签名：S01 按钮 variant、S02 按钮 size、S03 样式令牌偏离、S04 CSS 层叠
- 对应错题：INC-0001、INC-0002、INC-0003、INC-0004（共 19 个提交）
- 建议层级：**L3**。理由：代价 low，但频次最高（19 个提交，占 19%）；仓库里已经有 `buttonVariantAudit.test.ts`、`buttonSizeAudit.test.ts`、`radiusAudit.test.ts`、`typographyAudit.test.ts` 这类“扫源码”的 vitest 审计，说明这类错误已经能机器检查，只是反馈晚（要等跑完整测试），并且只对修复之后的代码有保障。
- 规则草案：把现有审计中的两条升级为 ESLint 规则，放入 `eslint.config.js` 的本地插件：
  ```js
  "userhome/button-explicit-variant": "error",   // <Button> 必须显式 variant（字面量或字面量三元）
  "userhome/button-size-allowlist": ["error", { allow: ["src/app/AppShell.tsx", /* 与 buttonSizeAudit 白名单同源 */ ] }],
  "userhome/no-unlayered-font-reset": "error",    // global.css 中 font: inherit 只能在 @layer base 内（用 stylelint 同义规则）
  ```
  白名单与 `tokens.baseline.json` 继续只由用户批准修改（见 P5）。
- 正向回归用例：用 `27322c5^` 的 `DotenvEditor.tsx`/`ZshEditor.tsx`（未写 variant）跑规则应报错；`0e07167^` 的同排 `size="sm"` 应报错；`010a00a^` 的 `global.css` 应被 stylelint 报告。
- 反向误报验证：对 HEAD 全量运行，应零报错；`size="sm"` 白名单内的通知条、`IconButton`、`CloseButton` 不得报错（`757244e` 与 `30685a9` 是已知合法用法）；`variant={cond ? "primary" : "ghost"}` 的字面量三元不得报错，而 `variant={x}` 应报错（对应 7a76e2e 的审计增强）。

### P5：规则、审计白名单与令牌基线的变更门禁（跨签名，对应“worker 不得修改规则”）

- 针对签名：S02、S03、S12（修复时改了审计白名单/基线/既有断言）
- 对应错题：INC-0002（757244e）、INC-0003（f34583b）、INC-0012（7842992）
- 建议层级：**L5**。理由：本批**没有发现任何 `test-cheat`**，但有 3 个修复提交在改既有断言或白名单：f34583b（改 `radiusAudit.test.ts` 与 `tokens.baseline.json`）、7842992（改 `zsh_edit_tests.rs`、`zsh_tests.rs` 的既有断言）、757244e（给按钮尺寸白名单加 3 行），其中前两个提交信息写明“协调者已同意”。现在没有机器手段区分“有授权的规则变更”与“为了变绿而削弱规则”，一旦 P1–P4 落地，这条门禁就是它们的前提。
- 规则草案：提交前 hook，匹配条件 = 暂存区修改了 `**/*Audit.test.*`、`src/styles/tokens.baseline.json`、`eslint.config.*`、`docs/agent-incidents/**` 或 `.claude/**`，或删除/改弱已有 `expect(...)`/`assert!`（`git diff` 中以 `-` 开头且含 `expect(`/`assert`，且无对应 `+`）→ 要求提交信息含 `Rule-Change-Approved: <用户确认的引用>`，否则拒绝。
- 正向回归用例：对 `f34583b`、`7842992`、`757244e` 的暂存内容分别模拟，应被拦截；补上审批行后应放行。
- 反向误报验证：对近 100 个 fix 提交批量模拟，统计被拦截数——应只有上述 3 个加上少数合理的测试改动；普通新增测试（只有 `+` 行）不得被拦截。拦截率过高说明“删除断言”判定过宽，需调整。

### P6：界面文案声称的事实必须对应后端字段（签名 S08）

- 针对签名：S08 界面文案声称的状态与后端实际行为或页面其他处不符
- 对应错题：INC-0008（c31bd65、82e3db9、1f5e0db、1e43dcf、5ad8638、3ab42b8）
- 建议层级：**L2 + L4**。理由：代价 mid（用户可能因“已备份”“已更新”做出错误判断，82e3db9 就提到会让用户重复升级）；频次 6；难以用 lint 表达，靠任务模板与分支测试最现实。
- 规则草案：L2：派发含成功/状态文案的任务时，验收清单增加必填项“该文案依赖的后端字段与所有分支（未知版本、新建文件、不可写、失败）”。L4：每条“已…”类文案对应一个按分支参数化的测试（如 `it.each([{existed:true},{existed:false}])`）。可选 lint：`i18n/messages/*.ts` 中以“已备份/已更新/已保存/已应用”开头的静态字符串必须带 `// claim: <字段>` 注释，缺失报警告。
- 正向回归用例：`c31bd65^` 的 `AppConfigEditor.tsx` 在“新建文件”分支仍渲染“已备份”，参数化测试应失败；`82e3db9^` 的 `ai_config.rs` 在升级前版本未知时返回“已更新到”，应失败。
- 反向误报验证：对 HEAD 的 `i18n/messages` 运行注释规则，列出缺注释条数，人工抽查是否有无需字段支撑的纯描述文案；规则只作用于以“已…”开头的字符串，用 `已选择` 这类 UI 状态词确认不误报或进入豁免名单。

### P7：测量类 hook 的场景矩阵测试（签名 S07）

- 针对签名：S07 选中指示器 useSlideIndicator 的边界状态逐个补漏
- 对应错题：INC-0007（dfd29a8、94d2ece、92df1c7、f523d26、a41d847、876b5b8、f49d2cf）
- 建议层级：**L4**，并建议该类任务路由给更强模型（见第三节）。理由：代价 mid；频次 7，单一机制；漏得多远——7 个补丁集中在 10-22 至 10-26 之间落地，最后的 dfd29a8 仍在向上移动的场景暴露新缺口。
- 规则草案：为 `useSlideIndicator` 增加固定的场景矩阵测试（`useSlideIndicator.matrix.test.tsx`，复用 dfd29a8 新增的 `slideLayoutStub.ts`）：向下/向上移动、换语言、隐藏后重现、选中项换行改变尺寸、`prefers-reduced-motion`、`aria-selected` 滞后于 `aria-current`。ESLint 规则 `userhome/measure-hook-needs-matrix`：新增使用 `getBoundingClientRect|offsetTop|ResizeObserver` 的 `use*` hook 时，要求同目录存在 `*.matrix.test.tsx`。
- 正向回归用例：`dfd29a8^` 的 `useSlideIndicator.ts` 跑“向上移动应滑动而非跳变”场景应失败；`94d2ece^` 跑“隐藏后保留上次位置”应失败。
- 反向误报验证：对 HEAD 运行矩阵应全通过；ESLint 规则在仓库内其余使用 `ResizeObserver` 的文件上先跑一遍，确认命中项都是真正的测量 hook，而不是一次性读取尺寸的普通组件。

### P8：外部输出解析器必须有真机样本，未验证项显式登记（签名 S13、S20）

- 针对签名：S13 外部命令输出/文件格式解析边界、S20 平台行为假设未经实机验证
- 对应错题：INC-0013、INC-0020（共 11 个提交）
- 建议层级：**L2 + L4**。理由：代价 mid；频次 11；解析错误会在用户机器上显示为“正在运行”之类错误状态；不少修复提交自己写明“本机未验证”，说明缺口是缺少真机样本而不是不知道有风险。
- 规则草案：L2：派发解析类任务时，任务模板必填“真机样本来源（命令与脱敏后的输出）”。L4：解析器测试目录下放 `fixtures/real/*.txt`，测试从中读取，并要求每个解析器至少有一份真机样本加一份畸形输入。约定：提交信息中出现“未验证/未在本机验证”的条目，必须同时在 `docs/agent-incidents/unverified.md` 登记，后续在真机或 CI 验证后移除。
- 正向回归用例：把含 `(pe)`、`(jt)` 标记和 PID 为 `0` 的真实 `launchctl print` 服务行加入样本，`ee07246^` 的 `output.rs` 应判为“跳过/运行中”错误而测试失败；把 FIFO 别名文件加入 `afda9f4^` 的 `detect` 测试应阻塞或失败。
- 反向误报验证：用现有 `launchctl list` 样本回归，确认只作用于域块解析的两条规则没有改变 `launchctl list` 的行为（ee07246 的提交信息明确了这一点）；确认 `unverified` 登记检查只匹配提交信息中的固定短语，避免正文偶然出现“未验证”字样而误拦。
- 验证限制：这批样本依赖真机输出，本任务没有采集，需另行安排。

---

## 三、建议路由给更强模型的任务类型

仅有 INC-0007 被标为 `root_cause: model-capability`，其余均为推断，列出的依据是“同一位置反复补丁”或“需要穷举对抗性输入”，不是已被证实的能力差距。

| 任务类型 | 依据 | 备注 |
|---|---|---|
| DOM 测量 + 动画状态机（如 `useSlideIndicator`） | S07 共 7 个提交，4 天内逐个补边界；INC-0007 | 唯一标为 model-capability 的错题 |
| 脱敏/遮盖等需要穷举泄漏形态的实现 | S11 共 5 个提交，caddy 链连续 3 轮；dadc871 经审查才发现遗漏 | 推断：一次性想全泄漏形态的能力不足，与缺少样例集（P1）叠加 |
| 授权/权限生命周期设计（grants、capabilities） | S12 共 3 个提交，涉及用途限定、撤销、通用入口拒绝 | 推断；代价 high，建议作为“最难任务”交给更强模型并配 P2 |
| 异步并发与 StrictMode 行为 | S10 共 8 个提交，跨前后端 | 推断；若 P3 的封装落地，可降级回普通模型 |

不建议路由给更强模型的：S01–S06、S09 等低代价 UI/文案问题，适合 L1–L3 规则解决；S13/S20 的缺口是缺少真机样本（env-defect），换模型并不能补。
