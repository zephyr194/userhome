import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UserPreferences } from "../../ipc/settings";
import { AppearanceSettings } from "./AppearanceSettings";

const preferences: UserPreferences = {
  schemaVersion: 1,
  appearance: "SYSTEM",
  openWindowOnLaunch: true,
  closeBehavior: "KEEP_RUNNING_IN_TRAY",
  restoreSelection: true,
  refreshOnLaunch: true,
  refreshOnReopen: true,
  providerTimeoutPreset: "STANDARD",
  preferredEditorMode: "STRUCTURED",
  backupRetention: 20,
  optionalDiscoveryRoots: ["HOME"],
  language: "system",
};

describe("外观主题卡片（r4-fe5）", () => {
  const html = renderToStaticMarkup(
    <AppearanceSettings
      onAppearanceChange={() => Promise.resolve()}
      onPreferencesChange={() => Promise.resolve()}
      preferences={preferences}
    />,
  );

  it("三个主题卡片排成三列，窄窗口退为一列", () => {
    expect(html).toContain("sm:grid-cols-3");
    expect(html).not.toContain("sm:grid-cols-2");
  });

  it("三个选项都在同一组中", () => {
    for (const label of ["系统", "浅色", "深色"]) {
      expect(html).toContain(`>${label}</span>`);
    }
  });
});
