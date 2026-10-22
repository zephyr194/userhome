# Threat model

**用途：**记录只读配置、受控提权和发布分发的信任边界、失败策略与残余风险，供实现和安全审查使用。
权限、数据流或分发边界变化时更新；本文不是已完成安全验收的证明，实际结果与外部阻塞
见 [release-readiness.md](release-readiness.md)。

## 新只读配置入口

新 `ApplicationProfile` 与旧 Catalog 写入授权分离，只有内置 HOME 相对根及明确核心资源。
客户端仅提交应用/资源 ID；清单不读取正文，每次读取重检资源集合、排除与规范化根。
`settings.json` 只投影声明字段，未知值和注释不返回；`config.json` 分支不打开正文。
指令有大小、深度、数量和时间上限，不执行或渲染原始 HTML。

内置及用户排除按路径组件匹配；排除存储损坏、未知版本、权限或链接异常时失败关闭，
不退回空名单。新排除设置不撤销旧后端权限，当前只读入口不提供旧变更操作。
原权限边界仍成立。路径规范化、逐次复检与有界读取不是对恶意本地
文件系统竞态的完整隔离证明。

## 授权根（授权库）

用户选择的路径只以授权记录的形式进入后端。授权库位于应用自有配置目录（Tauri
`app_config_dir`，即 `~/Library/Application Support/com.zephyr194.userhome`），
文件 `grants.json` 权限 0600、目录 0700，最多 256 条记录。前端只提交授权 ID，不提交路径。

| 用途 | 类型 | 使用限制 |
|---|---|---|
| `CONFIG_DIRECTORY` / `CONFIG_FILE` | 目录 / 文件 | 通用的只读与受控写入入口。 |
| `EXECUTABLE` | 文件 | 应用需要运行的可执行文件（如 Caddy）。 |
| `SHELL_STARTUP_FILE` | 文件 | 保留用途：只有 Shell 启动文件编辑器可用；通用解析、读取、写入路径全部拒绝，因为其中内容会在下一次终端启动时执行。 |
| `LAUNCH_AGENT_FILE` | 尚不存在的 `<label>.plist` | 保留用途：只能位于固定的 `~/Library/LaunchAgents`，只供新建 UserHome 服务的入口使用；不覆盖已有文件，且从不由对话框产生。 |
| `TLS_MATERIAL_FILE` | 证书或私钥文件 | 保留用途：只供 Caddy 站点的 TLS 解析使用；通用解析、读取、写入与校验路径均拒绝。 |
| `CADDY_WORK_DIR` | 目录 | 保留用途：保存 Caddy 规则、Caddyfile、检查副本与运行记录；只有 Caddy 工作目录入口可创建或使用。每次只保留一个。 |

撤销只删除授权记录，不删除被授权的文件或目录。撤销 Caddy 工作目录（`revoke_caddy_workdir`）后，
目录及其内容保留。授权库损坏或版本过新时，可由“重置授权库”隔离旧文件并建立空库；
该操作不会修改被授权的文件。

## 会话运行器（`process_session`）

应用启动的每个子进程都由 `ProcessSession` 持有，它只接受绝对路径可执行文件、参数数组、
显式工作目录和显式环境变量：先清空环境，再只传入调用方列出的变量。子进程独立成组，
标准输出与错误写入有界环形缓冲并带截断标记。停止时向整个进程组发送 SIGTERM，宽限期后发送
SIGKILL，并确认退出后才报告结束。

句柄丢弃时会强制结束仍在运行的进程。进程标识规则：进程组 ID 等于组长 PID，组长未回收前该
PID 不会被复用；监控只观察组长退出而不回收（`waitid` + `WNOWAIT`），在 PID 仍被占用时结束
组内其余进程，然后才回收。所有信号都在会话锁内、且确认组长尚未回收后发送，因此过期句柄不会误伤
复用了 PID 的其他进程。该模块只提供机制，不暴露 IPC 命令，也从不运行 shell。

## 对话框

- 原生文件与目录选择对话框只由后端发起（`commands/grants.rs`，`tauri-plugin-dialog`）。
  前端没有对话框插件依赖，`capabilities/default.json` 也未授予对话框权限。
- 退出时若仍有应用自有进程运行，后端发出确认请求事件，前端渲染应用内确认对话框；
  “取消退出”不改变任何状态，“停止并退出”由后端停止这些进程并确认退出后才退出。

## 自有进程

### Caddy 自有实例

- 实例以 `caddy run` 在前台运行，不使用 `caddy start`，也从不调用 `caddy stop`；
  停止只通过应用持有的会话句柄完成。
- 运行时副本只额外注入一个全局 `admin` 选项，指向仅本次运行使用的私有 Unix socket
  （`admin.sock`，位于每次运行的 0700 目录下；路径过长时退回到 0700 的 `/tmp` 私有目录）。
  不占用默认 `localhost:2019`，磁盘上保存的 Caddyfile 不被修改。
- 原文已声明 `admin` 全局选项时，应用不覆盖也不替换它，要求用户先移除。
- 进程由 `ProcessSession` 启动，环境被清空。只有进程存活且 admin socket 返回配置时才显示“运行中”。
- 停止后，socket 与运行目录只在退出被确认后删除。

### AI 命令“在终端打开”的临时脚本

- Claude Code 的生成命令写入临时 `.command` 脚本，脚本名前缀为 `ai-command-`，
  位于应用数据目录下的 `ai-terminal/`（目录与脚本权限均为 0700）。
- 应用只以固定参数运行 `/usr/bin/open -a Terminal <脚本>`，超时 5 秒，输出有界且不解析。
  应用本身不执行生成的命令，不读取 Terminal 输出，也不发送按键。
- 脚本先打印将要运行的命令并等待用户在 Terminal 中按回车，随后删除自身并由该终端的 shell
  运行这条命令；用户可按 Ctrl-C 取消。应用启动时清理超过 24 小时的未使用脚本。

## Controlled-elevation trust boundary（已移除）

提权 helper、LaunchDaemon 与 Swift bridge 已于 2026-10-22 从应用中移除（G3-9）。
当前应用没有 root 提权通道，Homebrew、配置与服务操作均以当前用户权限执行，因此不存在
该边界的运行时控制。若将来重新引入提权，必须先建立新的资产清单、信任边界与 STRIDE 分析，
不得沿用被移除设计的假设。

## Distribution trust boundary

### Controls

- Pull request workflows have `contents: read`, receive no release secrets, and
  upload only short-lived GitHub Actions artifacts. They cannot create a
  GitHub Release.
- The release workflow is tag-only, uses a protected `release` environment, and
  grants only `contents: write`. It exits before certificate import when any
  required signing or notarization secret is absent.
- The workflow verifies the containing app's deep code signature and the stapled
  notarization ticket before creating a draft release.
- The workflow creates a draft only. Publishing remains an explicit human
  decision after reviewing artifacts and the release-readiness evidence.

### Residual risks and required controls

- GitHub environment protection, repository branch protection, allowed Actions,
  and encrypted secrets are external repository settings and cannot be proven
  from this worktree.
- A malicious or compromised third-party Action tag could change over time.
  The current workflows use established major-version tags; repository policy
  should pin actions to reviewed commit SHAs before the first production
  release if immutable action provenance is required.
- Notarization and Gatekeeper acceptance require Apple services and a real
  Developer ID identity. Local unsigned builds cannot substitute for that
  evidence.

### Authoritative platform references

- Tauri bundled resources: https://v2.tauri.app/develop/resources/
- Tauri macOS application bundles: https://v2.tauri.app/distribute/macos-application-bundle/
- Tauri GitHub pipelines: https://v2.tauri.app/distribute/pipelines/github/
- Tauri macOS signing: https://v2.tauri.app/distribute/sign/macos/
- GitHub `GITHUB_TOKEN` permissions: https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
