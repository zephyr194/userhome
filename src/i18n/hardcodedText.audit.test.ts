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
  "app/CopyPageLinkButton.tsx",
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
  "features/settings/deepLinkExamples.ts",
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
];

// Exact source lines that legitimately keep Chinese: they match backend-produced Chinese text, not UI copy.
const BACKEND_TEXT_EXCEPTIONS: readonly string[] = [
  "未识别的实体已保留。",
];

// Lines tagged with this marker belong to pages outside phase one (e.g. environment and Caddy tabs).
const PHASE_TWO_MARKER = "i18n-phase-two";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("phase-one hardcoded text audit", () => {
  it.each(PHASE_ONE_FILES)("%s has no Chinese text outside comments", (file) => {
    const source = stripComments(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8")
        .split("\n")
        .filter((line) => !line.includes(PHASE_TWO_MARKER))
        .filter((line) => !BACKEND_TEXT_EXCEPTIONS.some((text) => line.includes(text)))
        .join("\n"),
    );
    const offending = source
      .split("\n")
      .filter((line) => CJK_PATTERN.test(line))
      .map((line) => line.trim());
    expect(offending).toEqual([]);
  });
});
