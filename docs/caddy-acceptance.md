# Caddy 真实验收脚本与记录模板（CAD-7）

> 状态：**未执行**。本文件只提供验收脚本与记录模板。执行真实验收前必须取得用户明确批准。
> 下表所有“结果”默认为“未执行”，执行前不得预填任何结果。

## 1. 验收前提

- 真实运行 Caddy 需要用户批准。批准前不启动 Caddy、不启动或结束 UserHome 应用进程。
- 所有目录与端口由用户批准后填入下列占位符。不使用默认端口，不使用默认 admin 地址 `localhost:2019`。

| 占位符 | 含义 | 用户批准值 |
|---|---|---|
| `<APPROVED_TEMP_DIR>` | 临时目录（验收专用，验收后删除） | 未批准 |
| `<APPROVED_LISTEN_PORT>` | 代理监听端口（仅 127.0.0.1） | 未批准 |
| `<APPROVED_UPSTREAM_PORT>` | 本地上游夹具端口（仅 127.0.0.1） | 未批准 |
| `<CADDY_BIN>` | 用户已授权的 Caddy 可执行文件 | 未批准 |

约束：

- 监听地址只使用 `127.0.0.1`。
- 不修改默认 Caddy 实例，不占用 `localhost:2019`。
- 不修改 `/etc/hosts`、系统代理、证书信任或 LaunchAgent。
- 不使用 `caddy stop`（默认地址可能误停第三方实例）。

## 2. 本地上游夹具

首选 `python3 -m http.server`，绑定 127.0.0.1 的临时端口：

```sh
mkdir -p "<APPROVED_TEMP_DIR>/upstream"
echo "upstream-ok" > "<APPROVED_TEMP_DIR>/upstream/index.html"
python3 -m http.server "<APPROVED_UPSTREAM_PORT>" --bind 127.0.0.1 --directory "<APPROVED_TEMP_DIR>/upstream"
```

备选 `nc` 只能应答一次，每次请求前需重新启动。不同平台的 `nc` 参数差异较大，执行前需先确认其语义：

```sh
printf 'HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\nupstream-ok\n' | nc -l 127.0.0.1 "<APPROVED_UPSTREAM_PORT>"
```

## 3. 验收步骤与预期

每步在“结果”列记录通过、失败或未执行。

| # | 步骤（UI 或命令） | 预期 | 结果 |
|---|---|---|---|
| 1 | 检测 Caddy，选择 `<CADDY_BIN>` | 状态为可用，版本可见 | 未执行 |
| 2 | 规则页配置站点：监听 `127.0.0.1:<APPROVED_LISTEN_PORT>`，反向代理到 `127.0.0.1:<APPROVED_UPSTREAM_PORT>` | 预览的 Caddyfile 与表单一致；访问日志默认关闭 | 未执行 |
| 3 | 保存 | 保存成功；不触发重载；实例未开启 | 未执行 |
| 4 | 开启（核对摘要后确认） | 先校验（会加载模块）；就绪后才显示“运行中”，不出现假运行 | 未执行 |
| 5 | `curl -sS -i http://127.0.0.1:<APPROVED_LISTEN_PORT>/` | 返回 200，正文含 `upstream-ok` | 未执行 |
| 6 | 查看运行日志 | 日志有界，截断处可见提示；不含证书或私钥路径；访问日志未开启 | 未执行 |
| 7 | 修改规则（如改站点名或响应）并保存 | 显示“未应用”；实际服务的仍是旧配置 | 未执行 |
| 8 | 点击“应用”并确认 | 重载成功，显示“已应用”；再次 `curl` 核对新行为 | 未执行 |
| 9 | 点击窗口关闭按钮 | 窗口隐藏；`curl` 仍返回 200；实例继续运行 | 未执行 |
| 10 | 退出应用，对话框选择“取消退出” | 应用保持运行；实例仍运行且仍在列表中 | 未执行 |
| 11 | 退出应用，对话框选择“停止并退出” | 对话框列出 Caddy 自有实例及监听摘要；确认后应用退出 | 未执行 |
| 12 | 退出后执行第 4 节的核对命令 | 无残留进程；监听端口已释放 | 未执行 |
| 13 | 退出后检查私有运行目录与管理 socket 目录 | 均已删除，无残留 | 未执行 |
| 14 | 清理 `<APPROVED_TEMP_DIR>`（经用户确认后删除） | 临时目录已删除 | 未执行 |

## 4. 核对命令（只读）

```sh
lsof -nP -iTCP:"<APPROVED_LISTEN_PORT>" -sTCP:LISTEN     # 运行中应有输出；退出后应无输出
lsof -nP -iTCP:"<APPROVED_UPSTREAM_PORT>" -sTCP:LISTEN   # 夹具停止后应无输出
pgrep -fl "caddy run"                                    # 退出后不应出现指向本次运行目录的自有实例
```

`pgrep` 只读。不要使用 `pkill`、`killall` 或按进程名结束进程。

## 5. 未验证点（需在真实验收中核对）

- `caddy validate` 会 provision 模块，执行时的耗时与资源占用需要观察。
- admin socket 的语法（`admin unix//...`）与就绪探测响应（`GET /config/`）尚未对真实 Caddy 核对。
- `tls`、`log` 指令的语法尚未对真实 Caddy 核对；证书有效期与 SAN 未检查。
- 真实 WebView 中对话框的焦点与键盘交互未在真机核对。
- 托盘关闭行为（隐藏或退出偏好）需真机验证。

## 6. 记录表（执行后填写，默认未执行）

| 项目 | 记录 |
|---|---|
| Caddy 版本 | 未执行 |
| 执行命令（起止时间） | 未执行 |
| 使用端口（监听 / 上游） | 未执行（需用户批准） |
| 临时目录 | 未执行（需用户批准） |
| 日期 | 未执行 |
| 执行人 | 未执行 |
| 总体结果（通过 / 失败 / 部分） | 未执行 |
| 未执行项 | 全部（本文件尚未执行） |
