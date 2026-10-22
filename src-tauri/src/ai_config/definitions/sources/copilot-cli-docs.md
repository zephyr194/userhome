# GitHub Copilot CLI 官方文档来源

- 抓取日期：2026-10-22
- 官方 JSON Schema：本次核实的官方页面未提供 JSON Schema 的下载地址或 `$schema` 引用；定义只依据下列官方文档页面。SchemaStore 中名为 Copilot 的条目属于 AWS Copilot，与本工具无关，不使用。
- 适用版本：官方页面未声明文档适用的 Copilot CLI 版本，`documentedVersion` 记为 `unknown`。

## 页面清单

| 页面 | 用途 | 抓取方式 |
| --- | --- | --- |
| https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference | 配置目录、设置表（用户级、仓库级）、托管设置、权限文件、凭据存放 | WebFetch 摘要在设置表第 `showTipsOnStartup` 行截断，因此改用 curl 取完整 HTML，再按表格结构解析；关键句子另用纯文本核对 |
| https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference | 命令参考、`copilot config`、`copilot help config`、认证与令牌优先级、`reasoningEffort`（agent 定义字段） | WebFetch 摘要被截断；curl 取完整 HTML 后核对 |
| https://github.com/github/copilot-cli | 可执行名 `copilot` | WebFetch 读取 README |

README 与配置页链接到的 `https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli` 本次未抓取，因此不作为依据。

## 原文要点（英文原文）

### 配置文件与优先级（cli-config-dir-reference）

- "User-editable settings are now located in settings.json. Settings left in config.json are ignored. This file only holds internal state such as installed plugins and trusted folders." （`config.json` 小节，说明段）
- "Earlier versions of Copilot CLI stored both user settings and application state in config.json."
- "Automatically managed application state (authentication, installed plugins, and other internal data)" （目录总览表，`config.json` 行）
- "settings.json | File | Your personal configuration settings"（目录总览表）
- "COPILOT_HOME replaces the entire ~/.copilot path. The value you set should be the complete path to the directory you want to use for the configuration files and subdirectories."
- "Settings are applied in this order (later overrides earlier): Built-in defaults; Mobile Device Management (MDM) managed settings; User settings ( ~/.copilot/settings.json ); Repository settings ( .github/copilot/settings.json ); Local settings ( .github/copilot/settings.local.json ); Environment variables; Command-line flags"
- "Scope | Location | Purpose": User `~/.copilot/settings.json` "Global defaults for all repositories. Use the COPILOT_HOME environment variable to specify an alternative path."; Repository `.github/copilot/settings.json` "Shared repository configuration (committed to the repository)."; Local `.github/copilot/settings.local.json` "Personal overrides (add this to .gitignore)."
- "The CLI also reads .claude/settings.json and .claude/settings.local.json for the shared cross-tool subset of repository settings (such as companyAnnouncements , disableAllHooks , enabledPlugins , extraKnownMarketplaces , and hooks )."
- "Copilot CLI resolves the file from the configuration directory." 以及 permissions-config.json 位置优先级：`--config-dir=DIRECTORY` > `COPILOT_HOME` > 默认 `~/.copilot/permissions-config.json`。
- 托管设置：macOS `/Library/Application Support/GitHubCopilot/managed-settings.json`；Linux `/etc/github-copilot/managed-settings.json`；Windows `%ProgramFiles%\GitHubCopilot\managed-settings.json`；MDM：macOS plist `com.github.copilot`，Windows 注册表 `HKLM\SOFTWARE\Policies\GitHubCopilot`。

### 命令与设置（cli-command-reference）

- "Commands use your user settings file ( settings.json in ~/.copilot , or in $COPILOT_HOME when set) by default."
- "--repo and --local accept only the settings a repository can override"
- "Run copilot help config for the available settings."
- `--config-dir=DIRECTORY`: "Path to the configuration directory. This option is deprecated. Use COPILOT_HOME instead."

### 认证与令牌（cli-command-reference）

- "After completion, an authentication token is stored securely in the system credential store. If a credential store is not found, the token is stored in a plain text configuration file under ~/.copilot/ (or the directory specified by COPILOT_HOME if set)."
- "Alternatively, Copilot CLI will use an authentication token found in environment variables. The following are checked in order of precedence: COPILOT_GITHUB_TOKEN , GH_TOKEN , GITHUB_TOKEN ."
- 设置表 `storeTokenPlaintext` 行原文："Allow authentication tokens to be stored in plain text in config.json when no system keychain is available."
- MCP 回退存储（目录总览表）："Contains MCP OAuth token, registration, and PKCE fallback files when keychain-backed storage is unavailable." / "Contains fallback file storage and an index for MCP secret placeholders when keychain-backed storage is unavailable."

### 可执行文件名（github/copilot-cli README）

- "Launch `copilot` in a folder that contains code you want to work with."

### 与旧契约相关的原文（cli-command-reference）

- `reasoningEffort` 只出现在自定义 agent 定义的字段表中："reasoningEffort string No Default reasoning effort for this agent (for example, \"low\" , \"medium\" , or \"high\"). When unset, inherits the outer agent's effort." 它不是 `settings.json` 的键，因此不收录为设置项。
- 设置表中的 `effortLevel`："Reasoning effort level for extended thinking: \"low\", \"medium\", \"high\", or \"xhigh\". Higher levels use more compute."
- 设置表中的 `banner`："Animated banner display frequency." 类型为 `"always" | "once" | "never"`，默认 `"once"`。

## 设置表（用户级，原文的键、类型、默认值）

来源：cli-config-dir-reference，"User settings (~/.copilot/settings.json)" 表。键名、类型、默认值逐字取自原表；说明文字见 `copilot-cli.json` 的 `description`（同样取自原表）。`subagents.agents["rubber-duck"].autoInvoke` 键名含引号与方括号，不符合定义的键路径格式，未收录。

| 键 | 类型 | 默认值 |
| --- | --- | --- |
| `allowedUrls` | string[] | [] |
| `askUser` | boolean | true |
| `autoTier` | "efficiency" \| "balance" \| "intelligence" | unset |
| `autoUpdate` | boolean | true |
| `autoUpdatesChannel` | "stable" \| "prerelease" | "stable" |
| `banner` | "always" \| "once" \| "never" | "once" |
| `bashEnv` | boolean | false |
| `beep` | boolean | true |
| `beepOnSchedule` | boolean | true |
| `colorMode` | "default" \| "github" \| "dim" \| "high-contrast" \| "colorblind" | "github" |
| `commandHistoryMaxSize` | number | 50 |
| `compactPaste` | boolean | true |
| `companyAnnouncements` | string[] | [] |
| `connectors` | boolean | true |
| `continueOnAutoMode` | boolean | false |
| `copyOnSelect` | boolean | true (macOS), false (other) |
| `customAgents.defaultLocalOnly` | boolean | false |
| `deniedUrls` | string[] | [] |
| `disableAllHooks` | boolean | false |
| `disabledMcpServers` | string[] | [] |
| `disabledSkills` | string[] | [] |
| `dynamicRetrieval` | { skills?: boolean } | unset |
| `editorMode` | "normal" \| "vim" | "normal" |
| `effortLevel` | string | "medium" |
| `enabledMcpServers` | string[] | [] |
| `enabledPlugins` | Record<string, boolean> | {} |
| `experimental` | boolean | false |
| `extraKnownMarketplaces` | Record<string, {...}> | {} |
| `footer` | object | — |
| `hooks` | object | — |
| `ide.autoConnect` | boolean | true |
| `ide.openDiffOnEdit` | boolean | true |
| `ignoredSkillsLocations` | string[] | [] |
| `includeCoAuthoredBy` | boolean | true |
| `inlineImages` | boolean | true |
| `keepAlive` | "on" \| "off" \| "busy" | "off" |
| `logLevel` | "none" \| "error" \| "warning" \| "info" \| "debug" \| "all" \| "default" | "default" |
| `mergeStrategy` | "rebase" \| "merge" | — |
| `model` | string | varies |
| `mouse` | boolean | true |
| `permissions.disableBypassPermissionsMode` | string | — |
| `pinnedPrompts` | boolean | true |
| `powershellFlags` | string[] | ["-NoProfile", "-NoLogo"] |
| `proxyKerberosServicePrincipal` | string | unset |
| `proxyUrl` | string | unset |
| `remote` | "on" \| "off" | "on" |
| `renderHexColors` | boolean | true |
| `renderMarkdown` | boolean | true |
| `remoteExport` | boolean | true |
| `respectGitignore` | boolean | true |
| `sandbox.allowBypass` | boolean | true |
| `sandbox.enabled` | boolean | false |
| `sandbox.auth.git` | boolean | true |
| `sandbox.auth.gh` | boolean | true |
| `sandbox.credentials` | object | unset |
| `sandbox.userPolicy.network.allowLocalNetwork` | boolean | false |
| `sandbox.userPolicy.network.proxy` | object | unset |
| `sandbox.userPolicy.network.allowedHosts` | string[] | [] |
| `sandbox.userPolicy.network.blockedHosts` | string[] | [] |
| `sandbox.userPolicy.filesystem.deniedPaths` | string[] | [] |
| `sandbox.userPolicy.seatbelt.keychainAccess` | boolean | false |
| `screenReader` | boolean | false |
| `scrollbar` | boolean | true |
| `shellShortcut` | boolean | true |
| `showReasoning` | boolean | None |
| `showTimestamps` | boolean | true |
| `showTipsOnStartup` | boolean | true |
| `sidebar` | boolean | true |
| `skillDirectories` | string[] | [] |
| `statusLine` | object | — |
| `stayInAutopilot` | boolean | true |
| `storeTokenPlaintext` | boolean | false |
| `stream` | boolean | true |
| `streamerMode` | boolean | false |
| `subagents.agents` | object | {} |
| `subagents.disabledSubagents` | string[] | [] |
| `subagents.maxConcurrency` | number | plan-based |
| `subagents.maxDepth` | number | 6 |
| `tabs.enabled` | boolean | true |
| `tabs.hide` | string[] | [] |
| `tabs.sort` | string[] | [] |
| `taskbarPresence` | boolean | true |
| `terminalNotifications` | boolean | false |
| `terminalProgress` | boolean | true |
| `theme` | "default" \| "github" \| "dim" \| "high-contrast" \| "colorblind" | "github" |
| `toolSearch` | boolean | model- and feature-dependent |
| `transcriptView` | "default" \| "concise" | "default" |
| `updateTerminalTitle` | boolean | true |
| `worktreeBaseRef` | "head" \| "defaultBranch" | "head" |
| `worktreePathTemplate` | string | unset |

## 仓库级设置表（.github/copilot/settings.json，原文的键、类型、合并规则）

来源：cli-config-dir-reference，"Repository settings (.github/copilot/settings.json)" 表。仓库表中的键与用户设置表同名，合并规则只记录在对应用户级设置项的 `mergeRule` 中；`contextTier` 不在用户设置表中，未收录。

| 键 | 类型 | 合并规则 |
| --- | --- | --- |
| `companyAnnouncements` | string[] | Replaced—repository takes precedence |
| `contextTier` | "default" \| "long_context" | Replaced—repository takes precedence |
| `deniedUrls` | string[] | Union—repository can add entries, never remove |
| `disableAllHooks` | boolean | Repository takes precedence |
| `disabledMcpServers` | string[] | Union—repository can add entries, never remove |
| `disabledSkills` | string[] | Union—repository can add entries, never remove |
| `effortLevel` | string | Replaced—repository takes precedence |
| `enabledPlugins` | Record<string, boolean> | Merged—repository overrides user for same key |
| `extraKnownMarketplaces` | Record<string, {...}> | Merged—repository overrides user for same key |
| `hooks` | object | Merged—repository overrides user for same key |
| `includeCoAuthoredBy` | boolean | Replaced—repository takes precedence |
| `mergeStrategy` | "rebase" \| "merge" | Replaced—repository takes precedence |
| `model` | string | Replaced—repository takes precedence |
| `respectGitignore` | boolean | Tighten-only—repository can enable, never disable |
