# 只读应用定义

本契约仅授权新入口读取核心配置，不替换旧 Catalog、Schema/preset、adapter 或写入授权。当前只编译注册 `github-copilot`，根为 `HOME/.copilot`；不枚举整个 HOME，不支持环境覆盖、运行时导入、手动绑定或其他应用。

## 定义与校验

文件位于 `src-tauri/src/catalog/profiles/`：

- `app-profile.schema.json`：公开 JSON Schema，draft 2020-12。
- `mod.rs`：严格 Rust 类型、语义校验及内置注册。
- `github-copilot.json`：当前资源、字段和官方资料版本。
- `read.rs`：发现、清单、资源重检及有界读取。

`schemaVersion` 为 `1`。定义必须包含唯一 `appId`、显示名称、HOME 相对根、来源和文档规则；拒绝未知字段、重复 ID/key/path、绝对或越界路径、秘密字段、类型/default 不一致及不兼容读取形式。公开 Schema 提供结构校验，Rust 同时执行跨字段和权限语义校验。

最多 32 个应用，每应用 16 个文档规则及来源，每文档 64 字段；定义和正文各最多 256 KiB。规则只有 `FILE` 和 `COLLECTION`，集合只支持指定目录内明确后缀的递归文件，不支持任意 glob、正则、脚本或命令。

| 属性 | 契约 |
|---|---|
| `path` | `kind: FILE/COLLECTION`、`relativePath`；集合另有 `suffix` |
| `format` | `JSON`、`JSONC`、`TEXT`、`METADATA` |
| `viewKind` | `FIELDS`、`TEXT`、`METADATA`，必须与读取格式兼容 |
| `maxSizeBytes` | 有限正值，不能超过 262144 |
| `sourceId` | 引用本应用来源；来源为 HTTPS URL 和 40 位 Git blob SHA |
| 字段 | `fieldId`、`key`、中文标签/说明、类型、可选 enum 值及有资料依据的默认值 |

字段类型为 `STRING`、`BOOLEAN`、`INTEGER`、`ENUM`、`STRING_LIST`。默认值只是说明，不填充文件当前值。没有可靠默认值时省略 `defaultValue`。

## Copilot 资源

| 规则 | 相对 `.copilot` 的路径 | 读取 |
|---|---|---|
| `settings` | `settings.json` | JSONC 顶层对象，只投影九字段 |
| `global-instructions` | `copilot-instructions.md` | 有界 UTF-8 原文 |
| `modular-instructions` | `instructions/**/*.instructions.md` | 每个匹配文件独立读取 |
| `application-state` | `config.json` | 仅元数据，分支在打开正文之前返回 |

设置字段为 `model`、`theme`、`banner`、`effortLevel`、`editorMode`、`autoUpdate`、`renderMarkdown`、`screenReader`、`stream`，完整类型、枚举、说明和默认值以内置 JSON 为准。字段当前状态为 `UNSET`、`VALUE`、`INVALID`。无效值不返回，其他有效字段仍可用。

未知设置只返回数量，不返回值、注释或 JSONC 原文；`$schema` 不计入未知数量且不联网。指令保留 frontmatter，不展开引用、不执行或渲染 HTML。普通 `.md`、运行数据及其他功能文件不属于本轮资源。

## 只读 IPC

```text
get_configuration_apps()
list_configuration_resources({ input: { appId } })
read_configuration_resource({ input: { appId, resourceId } })
get_discovery_exclusions()
update_discovery_exclusions({ input: { userPaths } })
```

客户端不能提交 HOME 或文件路径。资源 ID 是 `appId`、规则 ID、HOME 相对逻辑路径的 SHA-256 引用，不是权限凭证；每次读取重新生成当前资源集合并检查排除和路径。

发现结果含已支持应用、内置定位路径、问题及空态原因。目录缺失与排除不同于权限或链接错误。清单只 stat，不读正文；缺少固定文件仍返回 `MISSING`。一个文件出错不隐藏其他资源。

应用根必须在规范化 HOME 内，实际文件必须在规范化应用根内。安全的应用根链接可用；资源逃出应用根即拒绝，即使目标仍在 HOME 内。指令集合不递归符号链接目录；结果按相对路径排序。

集合最多 8 层、1024 目录项、256 文件，预算 1500 ms；超限返回已有结果及 `partial`/问题。不声明发现完整。正文使用 `take(max + 1)`，复检大小和 UTF-8。

状态包括 `MISSING`、`EXCLUDED`、`PRESENT`、`READY`、`INVALID`、`TOO_LARGE`、`PERMISSION_DENIED`、`UNSAFE_SYMLINK`、`IO_ERROR`、`DEPTH_LIMIT`、`ENTRY_LIMIT`、`FILE_LIMIT`、`TIMEOUT`。`PRESENT` 只代表元数据存在，不证明设置有效。错误不回显配置片段、秘密或 HOME 绝对路径。

## 排除持久化

内置规则：`.Trash`、`.cache`、`.copilot/logs`、`.copilot/session-state`、`.copilot/command-history-state`、`.copilot/mcp-oauth-config`、`.copilot/mcp-secrets`。

用户规则为 HOME 相对路径及其后代，按组件前缀匹配；`.copilot` 不匹配 `.copilot-backup`。最多 32 条、每条最多 256 UTF-8 字节；拒绝空值、绝对路径、空组件、`.`、`..`、反斜杠、控制字符、通配符、重复项和重复内置项。

独立文件存于现有 UserHome `app_config_dir`：

```json
{ "schemaVersion": 1, "userPaths": [".copilot/instructions/nested"] }
```

目录 `0700`、文件 `0600`，拒绝链接/非普通存储文件，采用 32 KiB 有界读取、互斥锁和原子保存；预算包含 JSON 转义开销。缺少文件表示无用户规则；损坏、未来版本或读取失败阻止新配置读取，不能采用空名单。更新前验证旧文件，不覆盖损坏或未来版本。新命令的文件操作在 `spawn_blocking` 中执行。

成功更新后调用方应丢弃旧内容及在途响应，重新发现；失败不得把未保存规则当作生效结果。旧 `UserPreferences` 版本和命令不变，旧 reset 不清除此文件。排除不是系统权限撤销，也不改变旧读写 Catalog。

## 接入示例

以下仅示意现有应用的一条资源规则；生产完整定义以内置 JSON 为准。

```json
{
  "schemaVersion": 1,
  "appId": "github-copilot",
  "displayName": "GitHub Copilot",
  "root": ".copilot",
  "sources": [{
    "id": "instructions",
    "url": "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions",
    "gitBlobSha": "dc6f2c08e1c2f2b6ef4de29f9a8902ed903b6c73"
  }],
  "documents": [{
    "id": "global-instructions",
    "label": "全局指令",
    "description": "用户级指令原文。",
    "path": { "kind": "FILE", "relativePath": "copilot-instructions.md" },
    "format": "TEXT",
    "viewKind": "TEXT",
    "maxSizeBytes": 262144,
    "sourceId": "instructions"
  }]
}
```

新增应用需要先核验官方文件约定和秘密边界，再提交仓库定义、内置注册和必要临时 fixture 回归；不能仅增加来源就获得权限。来源保存的是 Git blob SHA，不是 SHA-256，也不证明本机已安装版本。没有脚本、网络获取或变更能力。

路径规范化和重检不构成对恶意本地文件系统竞态的完整隔离证明；该残余限制保留。
