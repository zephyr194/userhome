# launchd 真实输出观察记录（SVC-8 / CP3 验收的一部分）

日期：2026-10-21。执行者：协调者（Claude Code），用户已批准 SVC-8 与 CP3 的真实 launchd 验收，范围限定为唯一测试 label、结束后清理、不操作真实第三方任务。

## 方法与边界

- 在本机当前用户域 `gui/<uid>` 用**命令行**直接运行系统自带的 `/bin/launchctl`，没有启动 UserHome 应用，没有任何桌面操作。
- 一次性 label：`com.zephyr194.userhome.agent.acceptance-<时间戳>-<pid>`；plist 放在 `mktemp -d` 的临时目录（不写 `~/Library/LaunchAgents`），程序为 `/bin/sleep 300`，`RunAtLoad=false`、`KeepAlive=false`。脚本带 `trap` 清理：结束时 `bootout` 并删除临时目录。
- 结束后核对：`launchctl list` 中没有任何 `acceptance` label，临时目录已删除。未使用 `disable`/`enable`，因此不会在 launchd 的覆盖库里留下该 label 的记录。
- 另外只读运行了 `launchctl print gui/<uid>`、`launchctl print system`、`launchctl print-disabled gui/<uid>`、`launchctl list`，只用来观察输出格式，未修改任何东西。
- **这不是对 UserHome 代码本身的验收**：因 macOS 会拦截含生命周期代码的 Rust 测试二进制（见 SVC-5 证据），应用代码没有对真实 launchd 运行；本记录只校验“我们的解析器与前置假设是否与真实输出一致”。
- 输出里的 `environment` 块含继承自调用方会话的环境变量（其中包含凭据类变量）。已在落盘文件中清除，本文不引用任何环境变量值。**这也说明 `launchctl print <域>/<label>` 不应被我们的代码解析或保存**：该命令目前只在 allowlist 里定义，没有调用点（已核对）。

## 观察到的真实输出（与解析器假设对照）

| 命令 | 真实输出 | 与现有假设 |
|---|---|---|
| `launchctl list` | 首行 `PID<TAB>Status<TAB>Label`；运行中为 `792<TAB>0<TAB>label`，未运行为 `-<TAB>0<TAB>label`；被信号终止为 `-<TAB>-15<TAB>label`；没有 PID 为 `0` 的行 | 一致 |
| `launchctl print-disabled gui/<uid>` | 首行 `disabled services = {`，其后每行 `"label" => enabled\|disabled` | 一致 |
| `launchctl bootstrap` 成功 | 无输出，退出码 0；已加载时再次 bootstrap：`Bootstrap failed: 5: Input/output error`，退出码 5 | 生命周期靠预检查（list）判断“已加载”，不依赖该文案，一致 |
| `launchctl kickstart` / `kill SIGTERM` / `bootout` | 均无输出，退出码 0；`kill` 后 `list` 显示 `-<TAB>-15<TAB>label`；`bootout` 后 `list` 不再含该 label | 一致 |
| `launchctl bootout` 对不存在的 label | `Boot-out failed: 3: No such process`，退出码 3 | 一致（非零即失败） |
| `launchctl print <域>/<label>`（不存在） | `Bad request.` + `Could not find service "<label>" in domain for user gui: <uid>`，退出码 113 | 一致（现有分类含 `Could not find service`） |
| `launchctl print <域>`（`system`、`gui/<uid>`） | `services = {` 块中每行为 `<TAB><TAB>   <pid>   <status> <TAB><label>`，且**状态列除 `-`、整数外还有 `(pe)`、`(jt)`**；**PID 列的 `0` 表示未运行** | **不一致，见下** |

## 发现的缺陷（已转为 FIX-10）

1. **括号状态标记被误丢**：`print system` 的 446 个服务行里有 133 行（`print gui/<uid>` 498 行里有 194 行）状态列为 `(pe)`/`(jt)`，当前 `parse_domain_services` 把它们当畸形行跳过（计入 `skipped_lines`），系统域发现会丢掉约 30% 的任务并长期显示“部分结果”。
2. **PID `0` 被当成运行中的 PID**：域块里 446 行中有 287 行 PID 为 `0`（语义为无进程），当前解析成 `Some(0)`，导致这些任务被判为 `RunState::Running` 且 `pid=0`。`launchctl list` 本身不受影响（真实输出没有 PID 0）。

修复范围、样例行与约束见 todo 的 FIX-10。修复后需用同样的只读观察再对一次。

## 仍然没有验证的部分

- UserHome 应用代码对真实 launchd 的加载/启动/停止/重启/卸载（Rust 测试无法在本机运行，应用启动属“不在真机桌面验收”范围，由用户另行安排）。
- `KeepAlive=true` 任务的 `stop`（bootout 路径）与 `launchctl kill` 后被拉起的行为——本次观察只用了 `KeepAlive=false`。
- `disable`/`enable` 的真实效果与覆盖库残留。
- 系统域/Apple 任务的只读强制在真实数据上的表现（依赖 FIX-10 后重新观察）。

## 补充观察：KeepAlive=true（2026-10-21，命令行，同样的唯一 label 与清理方式）

`/tmp/launchd-acceptance/run-keepalive.sh`：RunAtLoad+KeepAlive=true，`/bin/sleep 300`，ThrottleInterval=1。

| 步骤 | 观察 |
|---|---|
| bootstrap | 退出码 0，`launchctl list` 显示运行中 PID |
| `kill SIGTERM` | 退出码 0；约 3 秒后 `list` 显示**新 PID**且状态列为 `-15`（被拉起，状态是上一次的退出状态）——与 SVC-5“KeepAlive 任务不用 kill 停止，改用 bootout”的设计一致 |
| `bootout` | 退出码 0；`list` 不再含该 label（彻底停止且不被拉起） |
| 再次 `bootout` | `Boot-out failed: 3: No such process`，退出码 3 |

结束后无 acceptance 残留。`disable/enable` 仍未观察（会写 launchd 覆盖库，需单独批准）。
