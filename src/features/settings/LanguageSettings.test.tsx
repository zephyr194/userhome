// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreferencesState } from "../../app/shellState";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { LanguagePreference, UserPreferences } from "../../ipc/settings";
import { AppearanceSettings } from "./AppearanceSettings";
import { SettingsPage } from "./SettingsPage";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function preferencesWith(language: LanguagePreference): UserPreferences {
  return {
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
    language,
  };
}

function radioFor(name: string): HTMLElement {
  const match = screen
    .getAllByRole("radio")
    .find((radio) => radio.textContent?.startsWith(name));
  if (!match) throw new Error(`No radio starting with ${name}`);
  return match;
}

function appearancePanel(
  preference: LanguagePreference,
  onPreferencesChange = vi.fn(() => Promise.resolve()),
) {
  return render(
    <LocaleProvider preference={preference}>
      <AppearanceSettings
        onAppearanceChange={() => Promise.resolve()}
        onPreferencesChange={onPreferencesChange}
        preferences={preferencesWith(preference)}
      />
    </LocaleProvider>,
  );
}

describe("语言偏好控件", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the language option names fixed in both interface languages", () => {
    appearancePanel("zh-CN");
    expect(radioFor("跟随系统")).toBeTruthy();
    expect(radioFor("简体中文")).toBeTruthy();
    expect(radioFor("English")).toBeTruthy();
    cleanup();

    appearancePanel("en");
    expect(radioFor("跟随系统")).toBeTruthy();
    expect(radioFor("简体中文")).toBeTruthy();
    expect(radioFor("English")).toBeTruthy();
    expect(screen.getByText("Language")).toBeTruthy();
  });

  it("saves the chosen language through onPreferencesChange", async () => {
    const onPreferencesChange = vi.fn(() => Promise.resolve());
    appearancePanel("zh-CN", onPreferencesChange);

    fireEvent.click(radioFor("English"));

    expect(onPreferencesChange).toHaveBeenCalledWith({ language: "en" });
    expect(await screen.findByText("语言已保存。")).toBeTruthy();
  });

  it("places the language row inside the 外观 group", () => {
    const state: PreferencesState = {
      status: "ready",
      preferences: preferencesWith("system"),
    };
    const markup = renderToStaticMarkup(
      <SettingsPage
        onAppearanceChange={() => Promise.resolve()}
        onDiscoveryRefresh={() => undefined}
        onPreferencesChange={() => Promise.resolve()}
        onPreferencesReset={() => Promise.resolve()}
        onSelectedGroupChange={() => undefined}
        preferences={state}
        selectedGroup="appearance"
      />,
    );
    const panel = markup.slice(markup.indexOf('id="settings-panel-appearance"'));
    const legendAt = (text: string) => panel.search(new RegExp(`<div[^>]*>${text}</div>`));
    expect(legendAt("语言")).toBeGreaterThan(-1);
    expect(legendAt("语言")).toBeGreaterThan(legendAt("外观模式"));
  });

  it("renders the English interface without truncation or clamping classes", () => {
    const state: PreferencesState = {
      status: "ready",
      preferences: preferencesWith("en"),
    };
    const markup = renderToStaticMarkup(
      <LocaleProvider preference="en">
        <SettingsPage
          onAppearanceChange={() => Promise.resolve()}
          onDiscoveryRefresh={() => undefined}
          onPreferencesChange={() => Promise.resolve()}
          onPreferencesReset={() => Promise.resolve()}
          onSelectedGroupChange={() => undefined}
          preferences={state}
          selectedGroup="appearance"
        />
      </LocaleProvider>,
    );
    const classes = new Set(
      Array.from(markup.matchAll(/class="([^"]*)"/g), (match) => match[1].split(/\s+/)).flat(),
    );

    expect(markup).toContain("Appearance mode");
    expect(classes.has("truncate")).toBe(false);
    expect(classes.has("line-clamp")).toBe(false);
    expect(classes.has("text-ellipsis")).toBe(false);
  });

  it("keeps English option copy free of Chinese characters", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider preference="en">
        <AppearanceSettings
          onAppearanceChange={() => Promise.resolve()}
          onPreferencesChange={() => Promise.resolve()}
          preferences={preferencesWith("en")}
        />
      </LocaleProvider>,
    );
    expect(CJK_PATTERN.test(markup.replace(/跟随系统|简体中文/g, ""))).toBe(false);
  });
});
