# 发现的应用：键值对可视化配置

日期：2026-10-30
状态：方案草案（由 idea-refine 整理，待实现与人工验收）。
关联：`visual-config.md`（控件层与类型来源）、`application-profiles.md`（只读定义契约，已移除旧受管入口）。

## Problem Statement

我们怎样让用户在“发现的应用”里，直接看到并修改 Ghostty 这类 `键 = 值` 配置文件中的每一项，而不是只看到文件元数据或手改文本，并且写回时不丢失未知行与注释？

现状（代码核对）：

- Ghostty 在注册表中是 `Format::Text`、`ReadOnly`、`metadata_only: true`，详情只显示大小与修改时间（`src-tauri/src/app_config/registry.rs`）。
- 写入引擎只支持 INI、TOML、JSONC（`patch.rs` 的 `apply_change` / `lookup` / `check_raw`），`Text` 没有写路径。
- 可视化编辑的字段表是代码里写死的（`schema.rs` 的 `GIT_FIELDS`、`ALACRITTY_FIELDS`，类型为 `&'static`），Ghostty 没有字段表，`schema_for` 返回 `None`，因此不可编辑。

## 用户期望

打开 Ghostty 的详情，看到当前文件里每个键的名称与值；修改其中一项，预览 diff，确认后写回。文件里未识别的键、注释、空行、换行符保持原样。其他发现的应用（例如以后接入的 `key = value` 类文件）复用同一套机制，只需声明格式。

## Recommended Direction

把“键值对”做成一种通用格式 `keyValue`，而不是给 Ghostty 单独写一套：

1. **读取**：按行解析 `键 = 值`。`#` 开头的行与空行不展示（沿用现有“注释不显示”的策略），只读取值，不解析行内注释，因为 Ghostty 的 `#` 属于值的一部分。
2. **字段来自文件**：编辑时，每个单次出现的键生成一个字符串字段，标签为键名，值为当前值。字段列表不是写死的表，而是由当前文件生成。重复出现的键（如 `keybind`）只列出名称并提示“只能在高级模式修改”，不做可视化编辑。
3. **写回**：只替换命中那一行的值部分，保留键名、等号两侧的原始空白与其他行。删除一项只删除那一行。新增键不做（见 Not Doing）。
4. **敏感键**：沿用 `is_secret_key` 与 `value_looks_secret`，敏感键的值不返回，编辑时用“替换”控件。
5. **复用**：`keyValue` 只声明“按行 `键 = 值`”，不绑定 Ghostty。其他应用只需在注册表中选择该格式并设为可写，并为其补一条 schema 与测试。

前端保持现有的“字段表 + 预览 + 确认”流程：字段表由后端 `keyValues` 与静态字段合并而成，diff、备份、写后校验、版本门禁全部复用。

## 取舍

| 方案 | 结论 | 理由 |
|---|---|---|
| A. 只在前端做 | 否 | 前端不能读取文件，无法满足“读取实际配置文件”。 |
| B. 给 Ghostty 写一份静态字段表 | 否 | 键名很多且会随版本变化，静态表会过期，也无法让其他应用复用。 |
| C. 通用 `keyValue` 格式 + 文件派生字段（采用） | 是 | 一套读写与校验，应用只声明格式；字段随文件变化。代价是 Rust 改动范围更大。 |
| D. 允许新增键 | 暂缓 | 需要选择插入位置，与“只改动被修改的键”的目标冲突，且要处理重复键语义。 |
| E. 行内注释与引号解析 | 否 | Ghostty 不支持行内注释；引号语义按键不同，先保持原文写回。 |

## Key Assumptions to Validate

- [ ] Ghostty 配置行的写法为 `键 = 值`，`#` 开头为注释，值中的 `#` 是字面量 —— 对照 https://ghostty.org/docs/config 与本机真实文件核验（人工）。
- [ ] 注册路径 `~/.config/ghostty/config.ghostty` 是否与真实文件一致；Ghostty 同时支持 `config` 与 `config.ghostty` —— 待人工核验，本轮不改路径。
- [ ] 单次出现的键，在可视化表中改成字符串即可安全写回，不会因类型不匹配损坏 —— 由 Rust 单元测试覆盖（未验证，需 `cargo test` 环境）。
- [ ] 去掉 `metadata_only` 后，详情仍不泄露敏感值 —— 由读取测试覆盖（未验证）。

## MVP Scope

- 注册表：Ghostty 改为 `keyValue` 格式、`Writable`、非元数据。
- 后端：`read.rs` 展示 `键 = 值`（敏感值遮罩）；`patch_kv.rs` 实现设置与删除单行值；`edit.rs` 返回 `keyValues` 并按键写回；`schema.rs` 的 `schema_for` 支持 `keyValue`。
- IPC：`AppConfigEditRead` 增加 `keyValues`；`APP_CONFIG_FORMATS` 增加 `keyValue`；字段路径规则放宽为允许连字符。
- 前端：编辑表合并文件派生字段；重复键给出提示；`codeLanguageFor` 支持 `keyValue`。
- 测试：vitest 覆盖解析、展示、编辑、回写与敏感键；Rust 单元测试随改动一并提交但标记为未验证。

## Not Doing (and Why)

- 新增键 —— 需要定义插入位置与重复键语义，留到第二个切片；当前可用高级模式添加。
- 重复键的可视化编辑 —— `keybind` 等多值键的语义是“有序列表”，用单值表单会丢失顺序信息。
- 行内注释、引号与转义的可视化解析 —— 各应用语义不同，先保证原文不变。
- 修改 Ghostty 文件路径或增加 `config` 与 `config.ghostty` 的双路径 —— 与本轮“key/value 可视化”无关，单独核验。
- 运行 `cargo test` 或真机验收 —— 测试二进制被系统拦截；真机与视觉验收记为“待人工”。
- 把旧受管 Catalog 或 AI 配置的写入规则改为新格式 —— 两套授权不能混用（见 `application-profiles.md`）。

## Open Questions

- 发现的应用中，除 Ghostty 外，下一个 `key = value` 样例选哪个（候选：npm `.npmrc` 的 `键=值`，需确认是否已有 INI 路径）。
- 新增键是否在第二切片做，以及插入位置规则（文件末尾或同段落）。
- Ghostty 的带引号值是否需要在界面中去引号显示（当前原样显示）。

## 实现状态与已知限制（2026-10-30）

- 已实现 MVP 切片：`keyValue` 格式、Ghostty 可写、文件派生的键值字段、按行回写与保留未知行/注释。
- Rust 改动已通过 `cargo check --all-targets`、`cargo clippy`、`cargo fmt`（仅新文件与本次改动的文件）；`cargo test` 未运行，相关 Rust 测试记为“未验证”。
- 范围说明：经协调方批准，改动扩展到 `src-tauri/src/app_config`、`src-tauri/src/ai_config/config_view.rs`（穷尽匹配所需的一行）与 `src/ipc/appConfig.ts`。
- 已知限制：
  - 一行非“键 = 值”的文件内容（如裸文本）会阻止可视化保存，报错行号与高级模式一致，与 INI/TOML 行为相同。
  - 敏感键的判断较宽：`keybind` 因含 `key` 片段被视为敏感并隐藏取值；它本就是重复键，不影响可视化编辑，但其他含 `key` 的键也会被隐藏。
  - 文件不存在时没有可视化字段，只能用高级模式创建。
  - 真机与视觉验收未做，记为“待人工”。
