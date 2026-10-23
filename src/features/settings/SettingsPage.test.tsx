import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PreferencesState } from "../../app/shellState";
import type { UserPreferences } from "../../ipc/settings";
import { SETTINGS_GROUPS, type SettingsGroupId } from "./settingsGroups";
import { SettingsPage } from "./SettingsPage";

const preferences: UserPreferences = {
  schemaVersion: 1,
  appearance: "SYSTEM",
  openWindowOnLaunch: true,
  closeBehavior: "KEEP_RUNNING_IN_TRAY",
  restoreSelection: true,
  refreshOnLaunch: false,
  refreshOnReopen: false,
  providerTimeoutPreset: "STANDARD",
  preferredEditorMode: "STRUCTURED",
  backupRetention: 10,
  optionalDiscoveryRoots: ["HOME"],
  language: "system",
};

const readyState: PreferencesState = { status: "ready", preferences };

function render(group: SettingsGroupId): string {
  return renderToStaticMarkup(
    <SettingsPage
      onAppearanceChange={() => Promise.resolve()}
      onDiscoveryRefresh={() => undefined}
      onPreferencesChange={() => Promise.resolve()}
      onPreferencesReset={() => Promise.resolve()}
      onSelectedGroupChange={() => undefined}
      preferences={readyState}
      selectedGroup={group}
    />,
  );
}

function classTokens(markup: string): string[] {
  const tokens: string[] = [];
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    for (const token of value.split(/\s+/)) {
      if (token) tokens.push(token);
    }
  }
  return tokens;
}

/** First element that carries `token` as an exact class. */
function tokensForClass(markup: string, token: string): string[] {
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.includes(token)) return tokens;
  }
  throw new Error(`No element carries the class "${token}".`);
}

describe("settings page list/detail reference layout", () => {
  it("renders all seven groups in the owned list pane", () => {
    const markup = render("appearance");

    expect(SETTINGS_GROUPS).toHaveLength(7);
    expect(markup.match(/role="tab"/g) ?? []).toHaveLength(7);
    for (const group of SETTINGS_GROUPS) {
      expect(markup).toContain(group.label);
    }

    // Selection is restored purely from the selectedGroup prop.
    expect(markup.match(/aria-selected="true"/g) ?? []).toHaveLength(1);
    expect(markup).toMatch(
      /id="settings-group-appearance"[^>]*role="tab"[^>]*aria-selected="true"/,
    );
    expect(markup).toContain('role="tabpanel"');

    const list = tokensForClass(markup, "settings-pane__groups");
    expect(list).toContain("min-h-0");
    expect(list).toContain("min-w-0");
    expect(tokensForClass(markup, "settings-pane__tabs")).toContain(
      "settings-pane__tabs",
    );
  });

  it("keeps a single detail group heading and drops the duplicate page header", () => {
    for (const group of SETTINGS_GROUPS) {
      const markup = render(group.id);

      // One heading only: the selected detail group heading.
      expect(markup.match(/<h2/g) ?? []).toHaveLength(1);
      expect(markup).toContain(`id="settings-${group.id}-heading"`);
      expect(markup).toContain(`>${group.label}</h2>`);
      // The old in-page "设置" page title and brand kicker are gone.
      expect(markup).not.toMatch(/<h2[^>]*>设置<\/h2>/);
      expect(markup).not.toContain("UserHome 偏好");
      expect(markup).not.toContain("本机偏好与应用行为");
    }
  });

  it("offers the appearance group as a three-way choice", () => {
    const markup = render("appearance");

    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g) ?? []).toHaveLength(3);
    expect(markup).toContain("系统");
    expect(markup).toContain("浅色");
    expect(markup).toContain("深色");
    expect(markup.match(/aria-checked="true"/g) ?? []).toHaveLength(1);
  });

  it("keeps the dangerous reset action reachable", () => {
    const markup = render("reset");

    expect(markup).toContain("重置偏好");
    expect(markup).toContain("border-danger-border");
    expect(markup).toContain("重置偏好…");
  });

  it("never hides, truncates, or clamps help and description text", () => {
    const tokens = new Set(classTokens(render("appearance")));

    expect(tokens.has("hidden")).toBe(false);
    expect(tokens.has("truncate")).toBe(false);
    expect(tokens.has("line-clamp")).toBe(false);

    const markup = render("appearance");
    // Field and option help render verbatim, not clipped away.
    expect(markup).toContain("自动跟随 macOS 外观。");
    expect(markup).toContain("固定窗口内保持桌面工具的信息密度。");
  });

  it("bounds the list and detail panes with their own scroll owners", () => {
    const markup = render("configuration");

    const root = tokensForClass(markup, "settings-pane");
    expect(root).toContain("min-h-0");
    expect(root).toContain("min-w-0");
    // No whole-page card wrapper around the reference panes.
    expect(root).not.toContain("rounded-panel");
    expect(root).not.toContain("border-border");

    const list = tokensForClass(markup, "settings-pane__groups");
    expect(list).toContain("min-h-0");
    expect(list).toContain("min-w-0");
    const listScroll = tokensForClass(markup, "settings-pane__tabs");
    expect(listScroll).toContain("min-h-0");
    expect(listScroll).toContain("overflow-y-auto");

    const detail = tokensForClass(markup, "settings-pane__detail");
    expect(detail).toContain("min-h-0");
    expect(detail).toContain("min-w-0");
    const detailScroll = tokensForClass(markup, "settings-pane__detail-content");
    expect(detailScroll).toContain("min-h-0");
    expect(detailScroll).toContain("overflow-y-auto");
  });
});
