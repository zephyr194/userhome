/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PreferencesState } from "../../app/shellState";
import type { UserPreferences } from "../../ipc/settings";
import type { SettingsGroupId } from "./settingsGroups";
import { SettingsPage } from "./SettingsPage";

const SETTINGS_DIR = fileURLToPath(new URL(".", import.meta.url));

function productionTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionTsx(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });
}

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
const LEGACY_SPACING = /-ui-(?:xxs|xs|sm|md|lg|xl|2xl|3xl)\b/;

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

function tokensForClass(markup: string, token: string): string[] {
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.includes(token)) return tokens;
  }
  throw new Error(`No element carries the class "${token}".`);
}

describe("设置页布局（UIB-4f）", () => {
  it("使用 PageShell 的 master-detail 布局，且不再有第二个舱头", () => {
    const markup = render("appearance");

    expect(markup).toContain("page-shell__layout--master-detail");
    expect(markup).not.toContain("page-shell__layout--board");
    expect(markup).not.toContain("page-shell__header");
  });

  it("页面内没有 h1，舱头只由 AppShell 工具栏承担", () => {
    expect(render("appearance")).not.toMatch(/<h1[\s>]/);
  });

  it("设置目录的生产代码不再使用旧间距令牌名", () => {
    const offenders = productionTsx(SETTINGS_DIR).filter((file) =>
      LEGACY_SPACING.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("当前分组同时带 slide-item 与 aria-current，其余分组不带", () => {
    const markup = render("refresh");
    const tabs = Array.from(markup.matchAll(/<button[^>]*data-group-id="[^"]*"[^>]*>/g), (match) => match[0]);

    expect(tabs).toHaveLength(7);
    const current = tabs.filter((tab) => tab.includes('aria-current="true"'));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('data-group-id="refresh"');
    for (const tab of tabs) {
      expect(tab).toContain("slide-item");
    }
  });

  it("列表容器左右内边距对称，行不带额外外边距，选中框因此水平居中", () => {
    const markup = render("refresh");
    const list = tokensForClass(markup, "settings-pane__tabs");
    const paddingX = list.filter((token) => /^-?p[xlr]?-/.test(token));
    expect(paddingX).toEqual(["px-ui-8"]);

    const tabs = Array.from(markup.matchAll(/<button[^>]*data-group-id="[^"]*"[^>]*>/g), (match) => match[0]);
    for (const tab of tabs) {
      const classes = tab.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
      expect(classes.filter((token) => /^-?m[lrx]?-/.test(token))).toEqual([]);
    }
  });

  it("设置详情标题不再画底边分隔线，也没有外框", () => {
    const markup = render("refresh");
    expect(tokensForClass(markup, "settings-pane__detail-header")).not.toContain("border-b");
    expect(tokensForClass(markup, "settings-pane")).toContain("borderless-pane");
  });

  it("分组列表是无编号、无标题栏的 title - description 平铺行", () => {
    const markup = render("refresh");
    const tabs = Array.from(markup.matchAll(/<button[^>]*data-group-id="[^"]*"[^>]*>[\s\S]*?<\/button>/g), (match) => match[0]);

    expect(markup).not.toContain("settings-groups-heading");
    expect(markup).not.toMatch(/>分组</);
    expect(tabs).toHaveLength(7);
    for (const tab of tabs) {
      expect(tab).toContain("settings-pane__tab");
      expect(tab).not.toContain("size-control-sm");
      expect(tab).not.toContain("text-selection-foreground");
      expect(tab.match(/<span class="block /g)).toHaveLength(2);
    }
  });
});
