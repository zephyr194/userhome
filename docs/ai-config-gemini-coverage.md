# Gemini CLI 覆盖报告

本报告由 `scripts/merge-gemini-schema.mjs` 生成，请勿手动编辑。

## 快照

- 原始 URL：https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json
- 抓取日期：2026-10-22
- sha256：`5517471627bf712c88e7d27ddbf419629df73edad7a676344ede9f2d2379d408`
- 托管方：Google 官方仓库 `google-gemini/gemini-cli` 托管；schema 不声明适用的 Gemini CLI 版本。

## 收录与可编辑性

- 顶层键：快照 27 个，排除元键 `$schema` 后 26 个。
- 设置项：按点号路径展开至最多 3 段，共收录 258 项（含容器对象）。
- 可编辑键：0 个。本任务没有任何键可编辑（所有设置项为 displayOnly，本工具没有已验证版本区间）。
- flags / env：本任务未收录，`flagsCoverage` 与 `envCoverage` 标注 `snapshotComplete: false`，待后续任务补充。

## 按类型数量

| valueType | 数量 |
| --- | --- |
| boolean | 119 |
| enum | 16 |
| number | 15 |
| object | 60 |
| string | 21 |
| stringArray | 23 |
| unknown | 4 |

## 深度截断与未展开清单

- `depth`：超过 3 段深度上限的容器，仅收录容器本身（valueType = object），其子键未收录。
- `map`：`additionalProperties` 为 schema 的映射类对象（含 `hooks`），子键由用户任意命名或由 schema 另行声明，只收录容器本身。

| 键 | 原因 |
| --- | --- |
| mcpServers | additionalProperties 映射类对象（子键未展开） |
| ui.customThemes | additionalProperties 映射类对象（子键未展开） |
| telemetry.otlpHeaders | additionalProperties 映射类对象（子键未展开） |
| model.summarizeToolOutput | additionalProperties 映射类对象（子键未展开） |
| modelConfigs.aliases | additionalProperties 映射类对象（子键未展开） |
| modelConfigs.customAliases | additionalProperties 映射类对象（子键未展开） |
| modelConfigs.modelDefinitions | additionalProperties 映射类对象（子键未展开） |
| modelConfigs.modelIdResolutions | additionalProperties 映射类对象（子键未展开） |
| modelConfigs.classifierIdResolutions | additionalProperties 映射类对象（子键未展开） |
| modelConfigs.modelChains | additionalProperties 映射类对象（子键未展开） |
| agents.overrides | additionalProperties 映射类对象（子键未展开） |
| experimental.gemmaModelRouter.classifier | 超过 3 段深度上限（子键未收录） |
| hooks | additionalProperties 映射类对象（子键未展开） |
| contextManagement.tools.distillation | 超过 3 段深度上限（子键未收录） |
| contextManagement.tools.outputMasking | 超过 3 段深度上限（子键未收录） |
| admin.mcp.config | additionalProperties 映射类对象（子键未展开） |
| admin.mcp.requiredConfig | additionalProperties 映射类对象（子键未展开） |

## 解析不了的键（valueType = unknown）

| 键 | 原因 |
| --- | --- |
| modelConfigs.customOverrides | 数组元素不是字符串 |
| modelConfigs.overrides | 数组元素不是字符串 |
| context.fileName | anyOf 无法映射为单一类型 |
| tools.sandbox | anyOf 无法映射为单一类型 |

## 风险与秘密标注

标注规则：风险与秘密由键路径与 schema 描述的关键词匹配得出，宁可多标；协调者需复核。

| 键 | 风险 | 秘密 |
| --- | --- | --- |
| mcpServers | externalServer | - |
| policyPaths | relaxesPermissions | - |
| adminPolicyPaths | relaxesPermissions | - |
| general.preferredEditor | executesCommand | - |
| general.openEditorInNewWindow | executesCommand | - |
| general.defaultApprovalMode | executesCommand、relaxesPermissions | - |
| general.plan.enabled | externalServer | - |
| general.plan.directory | relaxesPermissions | - |
| ui.showStatusInTitle | externalServer | - |
| ui.hideContextSummary | externalServer | - |
| ui.footer.showLabels | executesCommand | - |
| ui.footer.hideSandboxStatus | relaxesPermissions | - |
| ui.collapseDrawerDuringApproval | relaxesPermissions、externalServer | - |
| ui.useAlternateBuffer | executesCommand | - |
| ui.showSpinner | externalServer | - |
| ui.customWittyPhrases | externalServer | - |
| ui.accessibility.enableLoadingPhrases | externalServer | - |
| telemetry | externalServer | - |
| telemetry.enabled | externalServer | - |
| telemetry.target | externalServer | - |
| telemetry.otlpEndpoint | externalServer | - |
| telemetry.otlpProtocol | externalServer | - |
| telemetry.otlpHeaders | externalServer | 是 |
| telemetry.traces | externalServer | - |
| telemetry.logPrompts | externalServer | - |
| telemetry.outfile | externalServer | - |
| telemetry.useCollector | externalServer | - |
| telemetry.useCliAuth | externalServer | 是 |
| billing.overageStrategy | relaxesPermissions | - |
| model.summarizeToolOutput | executesCommand | - |
| model.skipNextSpeakerCheck | relaxesPermissions | - |
| modelConfigs.modelDefinitions | externalServer | - |
| modelConfigs.modelChains | relaxesPermissions | - |
| agents.browser.allowedDomains | relaxesPermissions | - |
| agents.browser.disableUserInput | externalServer | - |
| agents.browser.maxActionsPerTask | relaxesPermissions | - |
| agents.browser.confirmSensitiveActions | executesCommand、relaxesPermissions | - |
| context.includeDirectories | relaxesPermissions | - |
| tools.sandbox | executesCommand、relaxesPermissions | - |
| tools.sandboxAllowedPaths | relaxesPermissions | - |
| tools.sandboxNetworkAccess | relaxesPermissions、externalServer | - |
| tools.shell | executesCommand | - |
| tools.shell.enableInteractiveShell | executesCommand | - |
| tools.shell.backgroundCompletionBehavior | executesCommand | - |
| tools.shell.pager | executesCommand | - |
| tools.shell.showColor | executesCommand | - |
| tools.shell.inactivityTimeout | executesCommand、relaxesPermissions | - |
| tools.shell.enableShellOutputEfficiency | executesCommand | - |
| tools.core | relaxesPermissions | - |
| tools.allowed | executesCommand、relaxesPermissions | - |
| tools.confirmationRequired | relaxesPermissions | - |
| tools.discoveryCommand | executesCommand | - |
| tools.callCommand | executesCommand | - |
| mcp | externalServer | - |
| mcp.serverCommand | executesCommand、externalServer | - |
| mcp.allowed | relaxesPermissions、externalServer | - |
| mcp.excluded | externalServer | - |
| security | externalServer | - |
| security.toolSandboxing | relaxesPermissions、externalServer | - |
| security.disableYoloMode | relaxesPermissions、externalServer | - |
| security.disableAlwaysAllow | relaxesPermissions、externalServer | - |
| security.enablePermanentToolApproval | relaxesPermissions、externalServer | - |
| security.autoAddToPolicyByDefault | relaxesPermissions、externalServer | - |
| security.blockGitExtensions | externalServer | - |
| security.allowedExtensions | relaxesPermissions、externalServer | - |
| security.folderTrust | relaxesPermissions、externalServer | - |
| security.folderTrust.enabled | relaxesPermissions、externalServer | - |
| security.environmentVariableRedaction | externalServer | - |
| security.environmentVariableRedaction.allowed | relaxesPermissions、externalServer | - |
| security.environmentVariableRedaction.blocked | relaxesPermissions、externalServer | - |
| security.environmentVariableRedaction.enabled | externalServer | 是 |
| security.auth | externalServer | 是 |
| security.auth.selectedType | externalServer | 是 |
| security.auth.enforcedType | externalServer | 是 |
| security.auth.useExternal | externalServer | 是 |
| security.enableConseca | externalServer | - |
| advanced.autoConfigureMemory | externalServer | - |
| advanced.bugCommand | executesCommand | - |
| advanced.bugCommand.urlTemplate | executesCommand、externalServer | - |
| experimental.voiceMode | executesCommand | - |
| experimental.voice | executesCommand | - |
| experimental.voice.backend | executesCommand | - |
| experimental.voice.whisperModel | executesCommand | - |
| experimental.voice.stopGracePeriodMs | executesCommand | - |
| experimental.adk.agentSessionNoninteractiveEnabled | relaxesPermissions | - |
| experimental.adk.agentSessionSubagentEnabled | executesCommand | - |
| experimental.enableAgents | externalServer | - |
| experimental.extensionManagement | externalServer | - |
| experimental.extensionConfig | externalServer | - |
| experimental.extensionRegistry | externalServer | - |
| experimental.extensionRegistryURI | externalServer | - |
| experimental.extensionReloading | externalServer | - |
| experimental.useOSC52Paste | relaxesPermissions、externalServer | - |
| experimental.useOSC52Copy | relaxesPermissions、externalServer | - |
| experimental.modelSteering | executesCommand、externalServer | - |
| experimental.directWebFetch | relaxesPermissions | - |
| experimental.gemmaModelRouter.enabled | externalServer | - |
| experimental.gemmaModelRouter.autoStartServer | externalServer | - |
| experimental.gemmaModelRouter.binaryPath | executesCommand | - |
| experimental.autoMemory | relaxesPermissions | - |
| extensions | externalServer | - |
| extensions.disabled | externalServer | - |
| extensions.workspacesWithMigrationNudge | externalServer | - |
| hooksConfig | executesCommand | - |
| hooksConfig.enabled | executesCommand | - |
| hooksConfig.disabled | executesCommand | - |
| hooksConfig.notifications | executesCommand | - |
| hooks | executesCommand | - |
| contextManagement.historyWindow.maxTokens | relaxesPermissions | - |
| contextManagement.historyWindow.retainedTokens | relaxesPermissions | - |
| admin | externalServer | - |
| admin.secureModeEnabled | relaxesPermissions | - |
| admin.extensions | externalServer | - |
| admin.extensions.enabled | relaxesPermissions、externalServer | - |
| admin.mcp | externalServer | - |
| admin.mcp.enabled | relaxesPermissions、externalServer | - |
| admin.mcp.config | relaxesPermissions、externalServer | - |
| admin.mcp.requiredConfig | relaxesPermissions、externalServer | - |
| admin.skills.enabled | relaxesPermissions | - |

## 资源与核实来源

| 资源 | 层级 | 格式 | 位置 | 能力状态 | 来源 |
| --- | --- | --- | --- | --- | --- |
| gemini-user-settings | userLevel | json | {home}/.gemini/settings.json | versionUnknown | https://geminicli.com/docs/reference/configuration/ |
| gemini-project-settings | projectShared | json | {project}/.gemini/settings.json | versionUnknown | https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md |
| gemini-system-settings | managed | json | {managed}/settings.json | versionUnknown | https://geminicli.com/docs/reference/configuration/ |
| gemini-system-defaults | managed | json | {managed}/system-defaults.json | versionUnknown | https://geminicli.com/docs/reference/configuration/ |
| gemini-trusted-folders | userLevel | json | {home}/.gemini/trustedFolders.json | unsupported | https://geminicli.com/docs/reference/configuration/ |
| gemini-env-file | projectShared | text | {project}/.gemini/.env | unsupported | https://geminicli.com/docs/get-started/authentication/ |
| gemini-auth-credentials | userLevel | text | {home}/.gemini | unsupported | https://geminicli.com/docs/get-started/authentication/ |

资源的说明文字见 `gemini-cli.json`。认证与凭据类资源为仅元数据：只标注存在性，不读取内容。

## 产品迁移提示

- 官方配置页与 GitHub README 均写明：`Unpaid tier and Google One users: Gemini CLI was replaced by Antigravity CLI on June 18th, 2026.`（https://geminicli.com/docs/reference/configuration/；https://github.com/google-gemini/gemini-cli）。
- 配置页同时写明：`Gemini CLI has not been optimized for Gemini 4 Argon`，并建议使用 Antigravity。
- 影响：对上述用户，Gemini CLI 不再是官方推荐的使用途径，本定义的适用人群与本机版本无法据此确定。本任务未改变产品目标；所有设置保持 displayOnly，资源为 versionUnknown 或 unsupported（fail-closed），不做编辑。

## 未核实项

- 每个设置项的合并规则：文档未给出（未核实）。
- `GEMINI_CLI_HOME` 是否重定位 `~/.gemini/settings.json`：配置页只说明其为用户级配置与存储的根目录，未逐条核实。
- 凭据存放路径与覆盖变量：官方认证页未给出（未核实）。
- 本定义适用的 Gemini CLI 版本区间：未核实，故所有资源与设置的版本字段为 null 或 versionUnknown。
- 本机是否属于受迁移影响的用户：无法从官方文档判断。
- `hooks` 下各事件键（`BeforeTool` 等）：因 `hooks` 为映射类对象未展开，其命令执行风险由容器 `hooks` 的标注承担。
