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
        .join("\n"),
    );
    const offending = source
      .split("\n")
      .filter((line) => CJK_PATTERN.test(line))
      .map((line) => line.trim());
    expect(offending).toEqual([]);
  });
});
