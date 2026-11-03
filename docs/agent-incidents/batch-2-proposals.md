# 错题册第二批：规则提案（batch-2）

- 数据来源：batch-1 之后新记的错题（INC-0021 起）按 README §9 达到升级条件的签名；本批只含 Q1。
- 状态：Q1 已获用户批准（2026-11-03，原话“都按建议”），已实现并试运行。
- 编号：签名沿用 batch-1 签名字典的编号顺序，本批新增 S21；提案编号 Q1 起，与 batch-1 的 P1–P8 区分。

## 一、签名字典（增量）

| 签名 | 说明 | 出现次数 | 对应 INC |
|---|---|---|---|
| S21 | 测试依赖真实时钟（sleep 比快慢）或未等待异步读取完成，CI 高负载下偶发失败 | 3 | INC-0025 |

## 二、规则提案

### Q1：测试里新增 sleep / pause 比快慢，提交时告警（签名 S21）

- 针对签名：S21 测试依赖真实时钟或未等待异步读取完成，CI 高负载下偶发失败
- 对应错题：INC-0025（severity S3，`root_cause: env-defect`）
- 3 次出现的证据：
  1. `discovery::refresh::tests::module_timeout_preserves_completed_partial_results`：`thread::sleep(100ms)` 的模块对 20ms 超时，CI 上 `left Ready right Error`（run 41603426651）；引入于 `98e2c8b`，PR #4 的 `b30ed3f` 改为屏障控制。
  2. e2e `smoke.spec.ts:157`：概览页没等系统信息读取到终态就断言 macOS，收到“本机信息暂不可用”（run 41610571787）；PR #4 的 `7136674` 改为先等 ready。
  3. `discovery::refresh::tests::duplicate_refresh_requests_join_the_active_scan`：`sleep(60ms)`（慢 runner）与 `sleep(10ms)`（等第二个线程起来）比快慢；同样引入于 `98e2c8b`（536、551 行），修复由另一个任务进行。
  - 次数按 §9 S3 条件（最近 50 个任务内累计 3 次）达到升级。
- 选择 L4/L5 的理由（§4 “最低且足够”）：错误形态是“新增一行 sleep”，可以按 diff 机械判定，无需运行，所以放在提交门禁（L5）这一层，复用 P5 的 `scripts/check-commit-rules.mjs`；L3（ESLint）覆盖不到 Rust，L2/L1 靠“记得”，而这个签名已经在两个不同的任务里重复出现，说明提示不够。代价 low，所以沿用 `--warn` 试运行，不阻止合并。仓库里 CI 才复现、本机又不能跑 `cargo test`，出错后反馈周期长，提前在提交时拦下收益较大。
- 规则（`RULES` 里的 `sleep-timing`）：
  - **范围**：只看提交**新增**的行。
    - Rust 测试代码：`*_tests.rs`、`tests.rs`、`src-tauri/tests/**` 的整个文件，以及 `src-tauri/src/**/*.rs` 里被 `#[cfg(test)]` 标注的条目（`mod tests { … }`、单个函数、`mod x;`、`use …;`）；非测试代码里的 sleep 不管。条目范围按提交后的文件内容确定：到首个以 `;` 结尾的行，或到与属性同缩进的 `}` 为止。新增行号取自 `-U0` 补丁的 hunk 头。
    - 命中形式：`thread::sleep(`、`std::thread::sleep(`。注释行里的不算；`tokio::time::sleep` 不在本规则范围（暂停时钟下是确定性的）。
    - e2e：`e2e/**` 里新增 `browser.pause(` / `driver.pause(`，或裸 `setTimeout`（`new Promise(r => setTimeout(r, ms))`、`timers/promises` 的 `await setTimeout(ms)`）。`browser.setTimeout({...})` 是设置 WebDriver 超时，前面带 `.` 的不算。
    - 同一提交里原样删除又新增的同一行（搬动）互相抵消，不算新增。
  - **放行约定**：在同一行，或紧挨在上方的连续注释块里写 `// timing-ok: <理由>`，理由不能为空；中间隔空行或别的语句则不算。合理用法举例：验证“超过宽限期后被杀”必须真实经过宽限期；轮询某个状态标记且带 deadline 的间隔等待；等没有可观察终态的系统动画。
  - **命中提示**：`<sha> sleep-timing <路径>:<行号> …`，说明里建议“改用测试控制的屏障或 channel；e2e 改用 `waitUntil` 加明确的终态选择器”，并写明 `timing-ok` 约定。
  - 带 `Rule-Change-Approved` 的提交仍按既有机制整体放行（见 `evaluateCommit`）。
  - 同时在 AGENTS.md §7 追加一条硬性禁止（文字规则，注明由本规则检查）。
- 正向回归用例（`src/test/checkCommitRules.test.ts`）：
  - 历史提交：`git log -S 'thread::sleep' -- src-tauri/src/discovery/refresh.rs` 找到 `98e2c8b`（引入，同时含上面第 1、3 次出现的两个测试）与 `b30ed3f`（删除其中一处）。`98e2c8b` 必须命中，并列出 `refresh.rs:536`、`:551`、`:567`；`b30ed3f` 不命中。
  - e2e：临时仓库构造新增 `browser.pause(500)` 的提交，必须命中并给出行号；纯函数用例覆盖 `driver.pause`、`setTimeout` 两种写法。
  - Rust：临时仓库里在 `#[cfg(test)] mod tests` 内新增 `std::thread::sleep`，必须命中并给出提交后的行号；`src-tauri/tests/**` 新增同样命中。
- 反向用例（不该拦的不误拦）：
  - 非测试代码（含 `#[cfg(test)]` 模块之后的普通函数）里的 sleep；
  - 带 `timing-ok` 标记（同一行、上一行、上方连续注释块）的 sleep；理由为空、中间隔了空行、标记在别的语句之上、写成别的字样则仍命中；
  - 删除 sleep 的提交、删除含 sleep 的整个文件、原样搬动的 sleep；
  - `browser.waitUntil(...)`、`browser.setTimeout({...})`、注释里的 `browser.pause(`、`e2e/` 之外的文件。
- 误报统计（最近 100 个非合并提交，2026-11-03）：命中 1 个，`caa7ce6`（`test(caddy): 等脚本装好 SIGTERM trap 再停止`）在 `caddy/session.rs:1964` 新增 `thread::sleep(20ms)`。它是轮询标记文件的间隔等待，外层有 5 秒 deadline，没有拿 sleep 比快慢，正是 `timing-ok` 约定要放行的合法用法，判为“规则按设计命中、需要带标记”；`session.rs` 在本任务的允许路径之外，没有补标记。其余 99 个提交 0 命中。
- 已知局限：
  - 只检查新增行，不扫存量；HEAD 上现有的测试 sleep（如 `caddy/session.rs:1991` 的 `sleep(500ms)` 后断言日志、`discovery/refresh.rs` 的 `duplicate_refresh_requests_join_the_active_scan`）不会被本规则列出，需另行清理；
  - 不检查 vitest 测试（`*.test.ts(x)`）里的 `setTimeout` 等待，那里用假时钟；`#[cfg(all(test, …))]` 等复合条件不识别；
  - “未等待异步读取完成就断言”这一半（上面第 2 次的根因）无法机械判定，只能靠 e2e 里禁止 `pause` / `setTimeout` 逼着写 `waitUntil`。
- 验证限制：规则本身与测试是 Node 代码，已在本地运行；被检查的 Rust 文件没有也不需要 `cargo` 参与。
- 状态：已实现，试运行（warn），自 2026-11-03 起。满 30 个任务后按命中数据提出是否转为强制的提案；届时关注两点：带 `timing-ok` 的命中占比，以及规则上线后同一签名是否再次出现（再出现说明规则无效，按 §9 修这条规则而不是加平行规则）。
