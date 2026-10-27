import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { en } from "../../i18n/messages/en";
import { zhCN } from "../../i18n/messages/zh-CN";
import type { UserPreferences } from "../../ipc/settings";
import { ConfigurationSettings } from "./ConfigurationSettings";

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

describe("设置页文案的清晰度修复", () => {
  it("editor mode uses localized labels instead of a hard-coded Raw", () => {
    expect(zhCN["settings.configuration.editorMode.raw"]).toBe("文本编辑器");
    expect(en["settings.configuration.editorMode.raw"]).toBe("Text editor");

    const zhMarkup = renderToStaticMarkup(
      <ConfigurationSettings onChange={() => Promise.resolve()} preferences={preferences} />,
    );
    expect(zhMarkup).toContain("文本编辑器");
    expect(zhMarkup).not.toContain(">Raw<");

    const enMarkup = renderToStaticMarkup(
      <LocaleProvider preference="en">
        <ConfigurationSettings onChange={() => Promise.resolve()} preferences={preferences} />
      </LocaleProvider>,
    );
    expect(enMarkup).toContain("Text editor");
    expect(enMarkup).not.toContain(">Raw<");
  });

  it("structured editor copy points to the text editor rather than raw", () => {
    expect(zhCN["settings.configuration.editorMode.structuredDesc"]).not.toMatch(/raw/i);
    expect(en["settings.configuration.editorMode.structuredDesc"]).not.toMatch(/raw/i);
  });

  it("appearance mode tip avoids the term semantic colours", () => {
    expect(zhCN["settings.appearance.mode.tip"]).toBe(
      "选择跟随系统、浅色或深色外观；保存后立即应用。",
    );
    expect(zhCN["settings.appearance.mode.tip"]).not.toContain("语义颜色");
    expect(en["settings.appearance.mode.tip"]).not.toMatch(/semantic/i);
  });

  it("removes option descriptions that only restate their labels", () => {
    for (const key of [
      "settings.appearance.option.lightDescription",
      "settings.appearance.option.darkDescription",
      "settings.language.option.enDescription",
      "settings.language.option.zhCNDescription",
    ] as const) {
      expect(zhCN, key).not.toHaveProperty(key);
      expect(en, key).not.toHaveProperty(key);
    }
    expect(zhCN).toHaveProperty("settings.appearance.option.systemDescription");
    expect(zhCN).toHaveProperty("settings.language.option.systemDescription");
  });

  it("deep link availability note omits the developer command", () => {
    expect(zhCN["settings.deepLink.availabilityNote"]).toBe(
      "开发运行时系统不会注册这个链接。",
    );
    expect(en["settings.deepLink.availabilityNote"]).not.toContain("tauri dev");
  });

  it("language tip starts with the behaviour, not a restatement of the label", () => {
    expect(zhCN["settings.language.tip"]).not.toMatch(/^选择界面语言/);
    expect(en["settings.language.tip"]).not.toMatch(/^Choose the interface language/);
  });

  it("reopen refresh tip does not repeat the periodic-scan explanation", () => {
    expect(zhCN["settings.refresh.onReopen.tip"]).toBe("仅在隐藏窗口重新显示时运行。");
    expect(en["settings.refresh.onReopen.tip"]).not.toContain("never scans");
  });
});
