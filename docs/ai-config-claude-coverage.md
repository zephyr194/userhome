# Claude Code 官方 schema 覆盖报告

本文件由 `scripts/merge-claude-schema.mjs` 生成，勿手动编辑。

## 快照

- 原始 URL：https://www.schemastore.org/claude-code-settings.json
- 抓取日期：2026-10-22
- sha256：`f26f028ad94a1e2a28e9dad1f80832ab196a8e080bd3a7d7a32e6428a15e0611`
- 托管方：第三方（SchemaStore）。官方文档 `$schema` 指向该文件；schema 不声明适用的 Claude Code 版本。

## 合并结果

- 设置项总数：245（keyPath 与 id 未变）
- 补全类型的键：107
- 排除（schema 有类型但保持 unknown）：2
- 冲突（保留本地值）：1
- 复杂结构（保持 unknown）：12
- 合并不改变 coverage 与 versions；可编辑键由清单决定，见文末“可编辑键”一节

### 按类型的数量

| valueType | 合并前 | 合并后 |
| --- | ---: | ---: |
| string | 7 | 23 |
| boolean | 10 | 59 |
| number | 0 | 4 |
| stringArray | 2 | 11 |
| object | 7 | 22 |
| enum | 3 | 17 |
| unknown | 216 | 109 |

## 补全清单

| keyPath | valueType | allowedValues |
| --- | --- | --- |
| `agent` | string | — |
| `agentPushNotifEnabled` | boolean | — |
| `allowAllClaudeAiMcps` | boolean | — |
| `allowedHttpHookUrls` | stringArray | — |
| `allowManagedHooksOnly` | boolean | — |
| `allowManagedMcpServersOnly` | boolean | — |
| `apiKeyHelper` | string | — |
| `askUserQuestionTimeout` | enum | 60s, 5m, 10m, never |
| `attribution` | object | — |
| `autoCompactEnabled` | boolean | — |
| `autoConnectIde` | boolean | — |
| `autoInstallIdeExtension` | boolean | — |
| `autoMemoryDirectory` | string | — |
| `autoMemoryEnabled` | boolean | — |
| `autoScrollEnabled` | boolean | — |
| `autoUpdatesChannel` | enum | stable, latest |
| `availableModels` | stringArray | — |
| `awaySummaryEnabled` | boolean | — |
| `awsAuthRefresh` | string | — |
| `awsCredentialExport` | string | — |
| `axScreenReader` | boolean | — |
| `browserExternalPageTools` | enum | disabled |
| `channelsEnabled` | boolean | — |
| `claudeMd` | string | — |
| `claudeMdExcludes` | stringArray | — |
| `cleanupPeriodDays` | number | — |
| `companyAnnouncements` | stringArray | — |
| `defaultShell` | enum | bash, powershell |
| `diffTool` | enum | auto, terminal |
| `disableAgentView` | boolean | — |
| `disableAllHooks` | boolean | — |
| `disableArtifact` | boolean | — |
| `disableBrowserExternalNavigation` | boolean | — |
| `disableBundledSkills` | boolean | — |
| `disableClaudeAiConnectors` | boolean | — |
| `disableDeepLinkRegistration` | enum | disable |
| `disabledMcpjsonServers` | stringArray | — |
| `disableMobileSimulatorTools` | boolean | — |
| `disableRemoteControl` | boolean | — |
| `disableSideloadFlags` | boolean | — |
| `disableSkillShellExecution` | boolean | — |
| `disableWorkflows` | boolean | — |
| `editorMode` | enum | normal, vim |
| `emojiCompletionEnabled` | boolean | — |
| `enableAllProjectMcpServers` | boolean | — |
| `enableArtifact` | boolean | — |
| `enabledMcpjsonServers` | stringArray | — |
| `enabledPlugins` | object | — |
| `env` | object | — |
| `externalEditorContext` | boolean | — |
| `extraKnownMarketplaces` | object | — |
| `feedbackSurveyRate` | number | — |
| `fileCheckpointingEnabled` | boolean | — |
| `fileSuggestion` | object | — |
| `forceLoginGatewayUrl` | string | — |
| `forceLoginMethod` | enum | claudeai, console, gateway |
| `forceRemoteSettingsRefresh` | boolean | — |
| `gcpAuthRefresh` | string | — |
| `httpHookAllowedEnvVars` | stringArray | — |
| `includeCoAuthoredBy` | boolean | — |
| `includeGitInstructions` | boolean | — |
| `inputNeededNotifEnabled` | boolean | — |
| `minimumVersion` | string | — |
| `otelHeadersHelper` | string | — |
| `parentSettingsBehavior` | enum | first-wins, merge |
| `permissionExplainerEnabled` | boolean | — |
| `plansDirectory` | string | — |
| `pluginConfigs` | object | — |
| `pluginSuggestionMarketplaces` | stringArray | — |
| `pluginTrustMessage` | string | — |
| `policyHelper` | object | — |
| `preferredNotifChannel` | enum | auto, terminal_bell, iterm2, iterm2_with_bell, kitty, ghostty, notifications_disabled |
| `prefersReducedMotion` | boolean | — |
| `processWrapper` | string | — |
| `prUrlTemplate` | string | — |
| `remoteControlAtStartup` | boolean | — |
| `requiredMaximumVersion` | string | — |
| `requiredMinimumVersion` | string | — |
| `respectGitignore` | boolean | — |
| `respondToBashCommands` | boolean | — |
| `showClearContextOnPlanAccept` | boolean | — |
| `showTurnDuration` | boolean | — |
| `skillListingBudgetFraction` | number | — |
| `skillListingMaxDescChars` | number | — |
| `skillOverrides` | object | — |
| `skipDangerousModePermissionPrompt` | boolean | — |
| `skipWebFetchPreflight` | boolean | — |
| `spinnerTipsEnabled` | boolean | — |
| `spinnerTipsOverride` | object | — |
| `spinnerVerbs` | object | — |
| `sshHostAllowlist` | stringArray | — |
| `statusLine` | object | — |
| `subagentStatusLine` | object | — |
| `syntaxHighlightingDisabled` | boolean | — |
| `teammateMode` | enum | auto, in-process, tmux, iterm2 |
| `terminalProgressBarEnabled` | boolean | — |
| `tui` | enum | fullscreen, default |
| `verbose` | boolean | — |
| `viewMode` | enum | default, verbose, focus |
| `vimInsertModeRemaps` | object | — |
| `voice` | object | — |
| `voiceEnabled` | boolean | — |
| `wheelScrollAccelerationEnabled` | boolean | — |
| `workflowKeywordTriggerEnabled` | boolean | — |
| `workflowSizeGuideline` | enum | unrestricted, small, medium, large |
| `worktree` | object | — |
| `wslInheritsWindowsSettings` | boolean | — |

## schema 默认值追加

- `agentPushNotifEnabled`：schema 默认值：false
- `askUserQuestionTimeout`：schema 默认值："never"
- `autoCompactEnabled`：schema 默认值：true
- `autoConnectIde`：schema 默认值：false
- `autoInstallIdeExtension`：schema 默认值：true
- `autoMemoryEnabled`：schema 默认值：true
- `autoScrollEnabled`：schema 默认值：true
- `autoUpdatesChannel`：schema 默认值："latest"
- `awaySummaryEnabled`：schema 默认值：true
- `cleanupPeriodDays`：schema 默认值：30
- `diffTool`：schema 默认值："auto"
- `disableWorkflows`：schema 默认值：false
- `editorMode`：schema 默认值："normal"
- `emojiCompletionEnabled`：schema 默认值：true
- `env`：schema 默认值：{}
- `externalEditorContext`：schema 默认值：false
- `fastMode`：schema 默认值：false
- `fastModePerSessionOptIn`：schema 默认值：false
- `fileCheckpointingEnabled`：schema 默认值：true
- `includeCoAuthoredBy`：schema 默认值：true
- `includeGitInstructions`：schema 默认值：true
- `inputNeededNotifEnabled`：schema 默认值：false
- `parentSettingsBehavior`：schema 默认值："first-wins"
- `permissionExplainerEnabled`：schema 默认值：true
- `plansDirectory`：schema 默认值："~/.claude/plans"
- `preferredNotifChannel`：schema 默认值："auto"
- `prefersReducedMotion`：schema 默认值：false
- `respectGitignore`：schema 默认值：true
- `respondToBashCommands`：schema 默认值：true
- `showClearContextOnPlanAccept`：schema 默认值：false
- `showThinkingSummaries`：schema 默认值：false
- `showTurnDuration`：schema 默认值：true
- `skillListingBudgetFraction`：schema 默认值：0.01
- `skillListingMaxDescChars`：schema 默认值：1536
- `spinnerTipsEnabled`：schema 默认值：true
- `teammateMode`：schema 默认值："in-process"
- `terminalProgressBarEnabled`：schema 默认值：true
- `theme`：schema 默认值："dark"
- `verbose`：schema 默认值：false
- `workflowKeywordTriggerEnabled`：schema 默认值：true
- `workflowSizeGuideline`：schema 默认值："unrestricted"

## 冲突（本地非 unknown 且与 schema 不一致，保留本地值）

- `disableAutoMode`：本地 string；schema enum（disable）

## 排除（schema 有类型，但按协调者决定保持 unknown）

- `fallbackModel`：schema 类型 stringArray；协调者决定（VC-1a）：保持 unknown。既有 Rust 断言钉住该类型（claude_snapshot_tests.rs），待人工复核后再提升
- `hooks`：schema 类型 object；协调者决定（VC-1a）：保持 unknown。既有 Rust 断言钉住该类型（claude_snapshot_tests.rs），待人工复核后再提升

## 未补全（schema 为复杂结构，保持 unknown）

- `allowedChannelPlugins`
- `allowedMcpServers`
- `blockedMarketplaces`
- `deniedMcpServers`
- `footerLinksRegexes`
- `forceLoginOrgUUID`
- `managedMcpServers`
- `sshConfigs`
- `strictKnownMarketplaces`
- `strictPluginOnlyCustomization`
- `teammateDefaultModel`
- `theme`

## schema 独有键

- `$schema`
- `skippedMarketplaces`
- `skippedPlugins`
- `requireCoworkFullVmSandbox`

## 本地独有键（未在 schema 顶层出现）

嵌套键路径与 schema 未收录的键共 107 个，逐项如下：

- `allowClaudeInChromeWithManagedMcp`
- `allowedProviders`
- `appendPlugins`
- `attribution.commit`
- `attribution.pr`
- `attribution.sessionUrl`
- `autoCompactWindow`
- `autoContinueAtUsageLimit`
- `autoMode.classifyAllShell`
- `availableModelsMatch`
- `bashEditDiffEnabled`
- `bashOutputMaxChars`
- `claudeInChromeDefaultEnabled`
- `copyFullResponse`
- `copyOnSelect`
- `crossSessionInbound`
- `defaultToAgentsView`
- `deniedModels`
- `desktopSessionCleanupPeriodDays`
- `dialogExpiry`
- `disableCommandPluginSources`
- `disableDesktopLocalSessions`
- `enableWorkflows`
- `feedbackDrafts`
- `gatewayInternalNetworks`
- `idleCompaction`
- `isolatePeerMachines`
- `keybindingFlavor`
- `leftArrowOpensAgents`
- `managedSourcesBehavior`
- `maxEffortLevel`
- `maxProseWidth`
- `modelPicker`
- `modelPricing`
- `modelSettings`
- `permissions.additionalDirectories`
- `permissions.allow`
- `permissions.ask`
- `permissions.blockReadsOutsideWorkingDirectories`
- `permissions.defaultMode`
- `permissions.deny`
- `permissions.disableBypassPermissionsMode`
- `policyHelper.path`
- `policyHelper.refreshIntervalMs`
- `policyHelper.timeoutMs`
- `prependPlugins`
- `promptCacheTtl`
- `promptSuggestionEnabled`
- `prStatusFooterEnabled`
- `remote.defaultEnvironmentId`
- `sandbox.allowAppleEvents`
- `sandbox.allowUnsandboxedCommands`
- `sandbox.autoAllowBashIfSandboxed`
- `sandbox.bwrapPath`
- `sandbox.credentials`
- `sandbox.credentials.allowPlaintextInject`
- `sandbox.credentials.awsPairs`
- `sandbox.credentials.envVars`
- `sandbox.credentials.files`
- `sandbox.credentials.sigv4`
- `sandbox.enabled`
- `sandbox.enableWeakerNestedSandbox`
- `sandbox.enableWeakerNetworkIsolation`
- `sandbox.excludedCommands`
- `sandbox.failIfUnavailable`
- `sandbox.filesystem`
- `sandbox.filesystem.allowManagedReadPathsOnly`
- `sandbox.filesystem.allowRead`
- `sandbox.filesystem.allowWrite`
- `sandbox.filesystem.denyRead`
- `sandbox.filesystem.denyWrite`
- `sandbox.filesystem.disabled`
- `sandbox.ignoreViolations`
- `sandbox.network`
- `sandbox.network.allowAllUnixSockets`
- `sandbox.network.allowedDomains`
- `sandbox.network.allowLocalBinding`
- `sandbox.network.allowMachLookup`
- `sandbox.network.allowManagedDomainsOnly`
- `sandbox.network.allowUnixSockets`
- `sandbox.network.deniedDomains`
- `sandbox.network.httpProxyPort`
- `sandbox.network.socksProxyPort`
- `sandbox.network.strictAllowlist`
- `sandbox.network.tlsTerminate`
- `sandbox.ripgrep`
- `sandbox.socatPath`
- `skipAutoPermissionPrompt`
- `spellcheck`
- `strictPluginOnlyCustomization.agents`
- `strictPluginOnlyCustomization.hooks`
- `strictPluginOnlyCustomization.mcp`
- `strictPluginOnlyCustomization.skills`
- `subagentPromptCacheTtl`
- `switchModelsOnFlag`
- `syncClaudeAiPlugins`
- `syncClaudeAiSkills`
- `taskOutputMaxChars`
- `terminalTitleFromRename`
- `timeFormat`
- `timeZone`
- `ultracode`
- `worktree.baseRef`
- `worktree.bgIsolation`
- `worktree.location`
- `worktree.sparsePaths`
- `worktree.symlinkDirectories`

## 风险与秘密标注（待协调者复核）

以下标注仅针对本次补全的键，依据为键名与 schema 描述的关键词匹配，宁可多标。

- `agentPushNotifEnabled`：风险 externalServer；secret 否
  - externalServer：匹配“Remote Control”
- `allowAllClaudeAiMcps`：风险 externalServer；secret 否
  - externalServer：匹配“mcp”
- `allowedHttpHookUrls`：风险 executesCommand；secret 否
  - executesCommand：匹配“hooks”
- `allowManagedHooksOnly`：风险 executesCommand, externalServer；secret 否
  - executesCommand：匹配“hooks”
  - externalServer：匹配“plugin”
- `allowManagedMcpServersOnly`：风险 externalServer；secret 否
  - externalServer：匹配“MCP”
- `apiKeyHelper`：风险 executesCommand；secret 是
  - executesCommand：匹配“script”
  - 秘密：键名含 key/token/secret/password/credential
- `awsAuthRefresh`：风险 executesCommand；secret 否
  - executesCommand：匹配“Command to run”
- `awsCredentialExport`：风险 executesCommand；secret 是
  - executesCommand：人工核对：描述为输出凭据的命令，会由 Claude Code 执行
  - 秘密：键名含 key/token/secret/password/credential
- `disableAllHooks`：风险 executesCommand；secret 否
  - executesCommand：匹配“hooks”
- `disableBundledSkills`：风险 externalServer；secret 否
  - externalServer：匹配“plugins”
- `disableClaudeAiConnectors`：风险 externalServer；secret 否
  - externalServer：匹配“MCP”
- `disabledMcpjsonServers`：风险 externalServer；secret 否
  - externalServer：匹配“MCP”
- `disableRemoteControl`：风险 externalServer；secret 否
  - externalServer：匹配“Remote Control”
- `disableSideloadFlags`：风险 relaxesPermissions, externalServer；secret 否
  - relaxesPermissions：匹配“bypass”
  - externalServer：匹配“plugin”
- `disableSkillShellExecution`：风险 executesCommand, externalServer；secret 否
  - executesCommand：匹配“shell command”
  - externalServer：匹配“plugin”
- `enableAllProjectMcpServers`：风险 relaxesPermissions, externalServer；secret 否
  - externalServer：匹配“MCP”
- `enabledMcpjsonServers`：风险 relaxesPermissions, externalServer；secret 否
  - externalServer：匹配“MCP”
- `enabledPlugins`：风险 externalServer；secret 否
  - externalServer：匹配“plugins”
- `env`：风险 无；secret 是
- `extraKnownMarketplaces`：风险 externalServer；secret 否
  - externalServer：匹配“marketplaces”
- `fileSuggestion`：风险 executesCommand；secret 否
  - executesCommand：匹配“script”
- `forceLoginGatewayUrl`：风险 externalServer；secret 否
  - externalServer：匹配“gateway”
- `forceLoginMethod`：风险 externalServer；secret 否
  - externalServer：匹配“gateway”
- `gcpAuthRefresh`：风险 executesCommand；secret 否
  - executesCommand：匹配“Command to run”
- `httpHookAllowedEnvVars`：风险 executesCommand；secret 否
  - executesCommand：匹配“hooks”
- `inputNeededNotifEnabled`：风险 externalServer；secret 否
  - externalServer：匹配“Remote Control”
- `otelHeadersHelper`：风险 executesCommand；secret 否
  - executesCommand：匹配“executable”
- `pluginConfigs`：风险 externalServer；secret 否
  - externalServer：匹配“plugin”
- `pluginSuggestionMarketplaces`：风险 externalServer；secret 否
  - externalServer：匹配“marketplace”
- `pluginTrustMessage`：风险 externalServer；secret 否
  - externalServer：匹配“plugin”
- `policyHelper`：风险 executesCommand；secret 否
  - executesCommand：匹配“executable”
- `processWrapper`：风险 executesCommand；secret 否
  - executesCommand：人工核对：描述为包裹后台进程的启动器命令
- `remoteControlAtStartup`：风险 externalServer；secret 否
  - externalServer：匹配“Remote Control”
- `respondToBashCommands`：风险 executesCommand；secret 否
  - executesCommand：匹配“shell command”
- `skillOverrides`：风险 externalServer；secret 否
  - externalServer：匹配“Plugin”
- `skipDangerousModePermissionPrompt`：风险 relaxesPermissions；secret 否
  - relaxesPermissions：匹配“bypass”
- `skipWebFetchPreflight`：风险 relaxesPermissions；secret 否
- `sshHostAllowlist`：风险 externalServer；secret 否
  - externalServer：匹配“SSH”
- `statusLine`：风险 executesCommand；secret 否
  - executesCommand：匹配“statusLine”
- `subagentStatusLine`：风险 executesCommand；secret 否
  - executesCommand：匹配“statusline”

## 可编辑键（VC-1b）

由 `sources/claude-editable-keys.json` 决定，脚本每次运行都会按清单重写本节。

- 决定日期：2026-10-22（用户确认 G-V1 稳妥集）
- 已验证版本：2.1.287（versions 的 min 与 max 相同，即单一精确版本）
- 可编辑键数：58；清单外的键保持 displayOnly，versions 为 null
- 版本依据：SchemaStore 快照（2026-10-22 抓取）为第三方托管，不声明适用的 Claude Code 版本。本机 claude --version 于 2026-10-22 实测为 2.1.287 (Claude Code)。因此已验证版本收窄为单一精确版本 2.1.287（min = max），其他版本一律由门禁拒绝。未做真实写入验证：未在 2.1.287 上对任何键执行写入并核对 Claude Code 的实际读取行为。
- 未做真实写入验证：本批未在 2.1.287 上对任何键执行写入并核对结果。

### 提升清单

- `advisorModel`
- `agent`
- `alwaysThinkingEnabled`
- `askUserQuestionTimeout`
- `autoCompactEnabled`
- `autoConnectIde`
- `autoInstallIdeExtension`
- `autoMemoryEnabled`
- `autoScrollEnabled`
- `autoUpdatesChannel`
- `awaySummaryEnabled`
- `axScreenReader`
- `browserExternalPageTools`
- `channelsEnabled`
- `disableAgentView`
- `disableArtifact`
- `disableBrowserExternalNavigation`
- `disableDeepLinkRegistration`
- `disableMobileSimulatorTools`
- `disableWorkflows`
- `editorMode`
- `effortLevel`
- `emojiCompletionEnabled`
- `enableArtifact`
- `externalEditorContext`
- `fastMode`
- `fastModePerSessionOptIn`
- `fileCheckpointingEnabled`
- `includeCoAuthoredBy`
- `includeGitInstructions`
- `language`
- `maxEffortLevel`
- `model`
- `outputStyle`
- `permissionExplainerEnabled`
- `preferredNotifChannel`
- `prefersReducedMotion`
- `promptCacheTtl`
- `prUrlTemplate`
- `respectGitignore`
- `showClearContextOnPlanAccept`
- `showThinkingSummaries`
- `showTurnDuration`
- `spinnerTipsEnabled`
- `subagentPromptCacheTtl`
- `switchModelsOnFlag`
- `syntaxHighlightingDisabled`
- `teammateMode`
- `terminalProgressBarEnabled`
- `tui`
- `ultracode`
- `verbose`
- `viewMode`
- `voiceEnabled`
- `wheelScrollAccelerationEnabled`
- `workflowKeywordTriggerEnabled`
- `workflowSizeGuideline`
- `wslInheritsWindowsSettings`

### 排除清单（保持 displayOnly）

- `allowManagedPermissionRulesOnly`：托管策略类，改错可能锁死自身，本批不开放
- `autoMemoryDirectory`：路径类设置，可指向任意目录，本批不开放
- `autoMode.classifyAllShell`：权限分类相关（对 shell 命令分类），本批不开放
- `availableModelsMatch`：托管策略类，改错可能锁死模型选择，本批不开放
- `claudeMd`：内容为指令文本，改动即改变模型行为，属内容类，本批不开放
- `defaultShell`：会执行外部程序（启动 shell），属于 executesCommand 风险，本批不开放
- `diffTool`：会执行外部程序（差异工具），属于 executesCommand 风险，本批不开放
- `disableAutoMode`：权限分类相关，改错会放宽或收紧自动模式，本批不开放
- `enforceAvailableModels`：托管策略类，改错可能锁死模型选择，本批不开放
- `forceRemoteSettingsRefresh`：托管策略类，改错会影响远程设置刷新，本批不开放
- `minimumVersion`：托管版本约束，改错可能锁死自身，本批不开放
- `parentSettingsBehavior`：托管策略类，改变设置合并行为，本批不开放
- `plansDirectory`：路径类设置，可指向任意目录，本批不开放
- `requiredMaximumVersion`：托管版本约束，改错可能锁死自身，本批不开放
- `requiredMinimumVersion`：托管版本约束，改错可能锁死自身，本批不开放
- `useAutoModeDuringPlan`：权限分类相关，改错会改变计划期间的权限行为，本批不开放

