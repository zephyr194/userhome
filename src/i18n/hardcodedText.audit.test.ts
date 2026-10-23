import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

const PHASE_ONE_FILES = [
  "app/AppShell.tsx",
  "app/routeDefinitions.ts",
  "app/routes.tsx",
  "components/NavigationRail.tsx",
  "components/DesktopWorkspace.tsx",
  "components/AsyncState.tsx",
  "components/ui/InfoTip.tsx",
  "components/ui/SecretValue.tsx",
  "components/ui/secretMask.ts",
  "components/ui/CodeViewer.tsx",
  "components/ui/PasteButton.tsx",
  "components/ui/LogViewer.tsx",
  "components/ui/logBuffer.ts",
  "components/ui/forms/index.tsx",
  "features/settings/PrivacySettings.tsx",
  "features/settings/SettingsPage.tsx",
  "features/settings/ResetSettings.tsx",
  "features/settings/ConfigurationSettings.tsx",
  "features/settings/DiagnosticsSettings.tsx",
  "features/settings/BackupSettings.tsx",
  "features/settings/settingsGroups.ts",
  "features/settings/usePreferenceForm.ts",
  "features/settings/settingsSummaries.ts",
  "features/settings/SettingsSidebar.tsx",
  "features/settings/GeneralSettings.tsx",
  "features/settings/RefreshSettings.tsx",
  "features/settings/AppearanceSettings.tsx",
  "features/settings/SettingsPrimitives.tsx",
  "features/dashboard/SystemSummary.tsx",
  "features/dashboard/overviewFacts.ts",
  "features/dashboard/DashboardPage.tsx",
  "features/system-tools/toolCards.ts",
  "features/system-tools/SystemToolsPage.tsx",
  "App.tsx",
  "app/appearance.ts",
  "app/brewDiscoverySelector.ts",
  "app/deepLink.ts",
  "app/discoverySelectors.ts",
  "app/refreshCoordinator.ts",
  "app/refreshEvents.ts",
  "app/routeNavigation.ts",
  "app/SectionContext.ts",
  "app/selectionMemory.ts",
  "app/shellState.ts",
  "components/ConfirmDialog.tsx",
  "components/RouteIcon.tsx",
  "components/ui/ActionRow.tsx",
  "components/ui/BrandMark.tsx",
  "components/ui/Button.tsx",
  "components/ui/classNames.ts",
  "components/ui/clipboard.ts",
  "components/ui/codeTokens.ts",
  "components/ui/index.ts",
  "components/ui/Modal.tsx",
  "components/ui/pageScrollMemory.ts",
  "components/ui/PageShell.tsx",
  "components/ui/Panel.tsx",
  "components/ui/SectionTabs.tsx",
  "components/ui/StatusBadge.tsx",
  "components/ui/useSlideIndicator.ts",
  "components/ui/VerticalMenu.tsx",
  "features/caddy/caddyConflictModel.ts",
  "features/caddy/caddyCopy.ts",
  "features/caddy/CaddyDetectPanel.tsx",
  "features/caddy/caddyDirectiveCatalog.ts",
  "features/caddy/caddyExamples.ts",
  "features/caddy/CaddyExamplesDialog.tsx",
  "features/caddy/CaddyPage.tsx",
  "features/caddy/caddyPreviewFlow.ts",
  "features/caddy/CaddyPreviewPanel.tsx",
  "features/caddy/CaddyRulesEditor.tsx",
  "features/caddy/caddyRulesModel.ts",
  "features/caddy/caddyRunModel.ts",
  "features/caddy/CaddyRunPanel.tsx",
  "features/caddy/CaddySaveBar.tsx",
  "features/caddy/caddyWorkdirModel.ts",
  "features/caddy/CaddyWorkdirPanel.tsx",
  "features/caddy/RawEditor.tsx",
  "features/caddy/rawEditorFlow.ts",
  "features/caddy/useCaddyWorkdir.ts",
  "features/grants/grantStoreController.ts",
  "features/grants/GrantStoreNotice.tsx",
  "features/grants/restoreFocus.ts",
  "features/grants/useGrantStoreNotice.ts",
  "features/operations/OperationHistory.tsx",
  "features/operations/OperationStatus.tsx",
  "features/settings/DeepLinkSettings.tsx",
  "features/tools/CodecTool.tsx",
  "features/tools/codecToolState.ts",
  "features/tools/JsonTool.tsx",
  "features/tools/jsonToolState.ts",
  "features/tools/QrTool.tsx",
  "features/tools/qrToolState.ts",
  "features/tools/toolRequestState.ts",
  "features/tools/ToolsPage.tsx",
  "features/tools/useRevealResult.ts",
  "features/tools/XmlTool.tsx",
  "features/tools/xmlToolState.ts",
  "ipc/environment.ts",
  "ipc/grants.ts",
  "ipc/textTools.ts",
  "main.tsx",
  "features/ai-config/aiConfigModel.ts",
  "features/ai-config/AiConfigPage.tsx",
  "features/ai-config/AiConfigView.tsx",
  "features/ai-config/BrewUpdate.tsx",
  "features/ai-config/claudeEditModel.ts",
  "features/ai-config/claudeSettingsModel.ts",
  "features/ai-config/CommandBuilder.tsx",
  "features/ai-config/commandBuilderModel.ts",
  "features/ai-config/configSearch.ts",
  "features/ai-config/ConfigSearchControls.tsx",
  "features/ai-config/configSearchStore.ts",
  "features/ai-config/definitionSchemaIssues.ts",
  "features/ai-config/SettingEditor.tsx",
  "features/ai-config/terminalOpenModel.ts",
  "features/ai-config/ToolReference.tsx",
  "features/ai-config/toolReferenceModel.ts",
  "features/ai-config/ToolSettings.tsx",
  "features/app-config/appConfigCatalog.ts",
  "features/app-config/appConfigEditModel.ts",
  "features/app-config/AppConfigEditor.tsx",
  "features/app-config/appConfigModel.ts",
  "features/app-config/AppConfigPage.tsx",
  "features/app-config/AppConfigView.tsx",
  "features/app-config/AppToolIcon.tsx",
  "features/app-config/SupportedConfigsAction.tsx",
  "features/app-config/SupportedConfigsDialog.tsx",
  "ipc/aiConfig.ts",
  "ipc/appConfig.ts",
  "features/services/AdoptServiceDialog.tsx",
  "features/services/CreateServiceDialog.tsx",
  "features/services/EditServiceDialog.tsx",
  "features/services/LaunchdActionPanel.tsx",
  "features/services/LaunchdServiceDetails.tsx",
  "features/services/ServiceGroups.tsx",
  "features/services/ServiceLogs.tsx",
  "features/services/ServiceManagement.tsx",
  "features/services/ServiceSummaryPanel.tsx",
  "features/services/ServicesPage.tsx",
  "features/services/ServicesView.tsx",
  "features/services/adoptServiceModel.ts",
  "features/services/createServiceModel.ts",
  "features/services/editServiceModel.ts",
  "features/services/launchdActionModel.ts",
  "features/services/launchdFixtures.ts",
  "features/services/launchdModel.ts",
  "features/services/logTailModel.ts",
  "features/services/sequenceGate.ts",
  "features/services/serviceDictionary.ts",
  "features/services/serviceProfile.ts",
  "features/services/testTranslators.ts",
  "features/environment/DotenvEditor.tsx",
  "features/environment/EnvironmentPage.tsx",
  "features/environment/EnvironmentView.tsx",
  "features/environment/LaunchctlDialogs.tsx",
  "features/environment/LaunchctlPage.tsx",
  "features/environment/LaunchctlView.tsx",
  "features/environment/LazySecretValue.tsx",
  "features/environment/SameNameHint.tsx",
  "features/environment/VariableChainTable.tsx",
  "features/environment/ZshEditor.tsx",
  "features/environment/ZshPage.tsx",
  "features/environment/ZshView.tsx",
  "features/environment/dotenvDirectoryModel.ts",
  "features/environment/dotenvEditorController.ts",
  "features/environment/dotenvEditorModel.ts",
  "features/environment/environmentModel.ts",
  "features/environment/useDotenvEditor.ts",
  "features/environment/useDotenvWorkspace.ts",
  "features/environment/useFocusRequest.ts",
  "features/environment/useZshEditor.ts",
  "features/environment/variableChainModel.ts",
  "features/environment/variableSearch.ts",
  "features/environment/zhTranslate.ts",
  "features/environment/zshEditorController.ts",
  "features/environment/zshEditorModel.ts",
  "features/environment/zshModel.ts",
];

// Exact source lines that legitimately keep Chinese: they match backend-produced Chinese text, not UI copy.
const BACKEND_TEXT_EXCEPTIONS: readonly string[] = [
  "未识别的实体已保留。",
];

// 允许保留中文的行：仅限下列原文，每个文件写明理由。
const ALLOWED_CJK_LINES: Readonly<Record<string, readonly string[]>> = {
  // 仅供漂移测试调用的 schema 校验消息，不进入界面。
  "features/ai-config/definitionSchemaIssues.ts": [
    "return matched ? [] : [`${path}: 不匹配 anyOf 任一分支`];",
    "return [`${path}: 类型应为 ${node.type}`];",
    "issues.push(`${path}: 值不在 enum 中`);",
    "issues.push(`${path}: 值应为 ${String(node.const)}`);",
    "issues.push(`${path}: 长度不足`);",
    "issues.push(`${path}: 超过最大长度`);",
    "issues.push(`${path}: 不符合 pattern`);",
    "issues.push(`${path}: 元素数量不足`);",
    "issues.push(`${path}: 缺少 ${key}`);",
    "issues.push(`${path}: 未声明的键 ${key}`);",
  ],
  // 映射源原文：errors.ts 按原文查表输出英文，未登记时显示原文。
  "features/app-config/AppConfigEditor.tsx": [
    'message: "没有需要保存的修改。",',
    'message: "请先修正标出的设置，再预览更改。",',
  ],
  // 映射源原文：解码器不接收 locale，展示层经 errors.ts 按原文映射。
  "ipc/appConfig.ts": [
    'message: "未知的应用配置条目。",',
    'message: "预览已失效，请重新预览。",',
  ],
};

// Files whose Chinese text is intentional data rather than user-facing copy.
const CHINESE_EXCEPTIONS: Readonly<Record<string, string>> = {
  "features/environment/zshEditorFixtures.ts":
    "测试夹具：模拟 zsh 文件内容的原文数据，不会显示给用户",
};

// Lines tagged with this marker belong to pages outside phase one (e.g. environment and Caddy tabs).
const PHASE_TWO_MARKER = "i18n-phase-two";

/** Drops comments and keeps every string, template and newline, so a `//` inside a literal never hides its text. */
function stripComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index++;
    } else if (char === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      const stop = close === -1 ? source.length : close + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, "");
      index = stop;
    } else if (char === '"' || char === "'" || char === "`") {
      let end = index + 1;
      while (end < source.length && source[end] !== char && (char === "`" || source[end] !== "\n")) {
        end += source[end] === "\\" ? 2 : 1;
      }
      const stop = Math.min(end + 1, source.length);
      out += source.slice(index, stop);
      index = stop;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

describe("phase-one hardcoded text audit", () => {
  it.each(PHASE_ONE_FILES.filter((file) => !(file in CHINESE_EXCEPTIONS)))("%s has no Chinese text outside comments", (file) => {
    const source = stripComments(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split("\n")
        .filter((line) => !line.includes(PHASE_TWO_MARKER))
        .filter((line) => !BACKEND_TEXT_EXCEPTIONS.some((text) => line.includes(text)))
        .join("\n"),
    );
    const allowed = new Set(ALLOWED_CJK_LINES[file] ?? []);
    const offending = source
      .split("\n")
      .filter((line) => CJK_PATTERN.test(line))
      .map((line) => line.trim())
      .filter((line) => !allowed.has(line));
    expect(offending).toEqual([]);
  });
});

describe("comment stripping keeps string literals", () => {
  const cjkSurvives = (source: string) => CJK_PATTERN.test(stripComments(source));

  it.each([
    ['const url = "http://x 中文";'],
    ['const hint = "see //中文";'],
    ["const tip = 'see // 中文';"],
    ["const tpl = `a // 中文`;"],
    ['const s = "a\\" // 中文";'],
  ])("keeps Chinese inside a literal: %s", (source) => {
    expect(cjkSurvives(source)).toBe(true);
  });

  it.each([["// 中文注释"], ["const a = 1; // 中文"], ["const a = 1; /* 中文 */"]])(
    "removes Chinese inside a comment: %s",
    (source) => {
      expect(cjkSurvives(source)).toBe(false);
    },
  );

  it("keeps the code in front of a trailing comment", () => {
    expect(stripComments("const a = 1; // 注释").trim()).toBe("const a = 1;");
  });
});

describe("exception lists", () => {
  const sourceOf = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

  it.each(Object.keys(CHINESE_EXCEPTIONS))("%s exists and holds Chinese text", (file) => {
    expect(CJK_PATTERN.test(sourceOf(file))).toBe(true);
  });

  it.each(
    Object.entries(ALLOWED_CJK_LINES).flatMap(([file, lines]) =>
      lines.map((line): [string, string] => [file, line]),
    ),
  )("%s exists and still contains the allowed line %s", (file, line) => {
    const lines = sourceOf(file).split("\n").map((text) => text.trim());
    expect(lines).toContain(line);
  });
});
