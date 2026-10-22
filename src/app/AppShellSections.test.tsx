import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const readyState: ShellState = {
  connection: { status: "loading" },
  discovery: { status: "loading" },
  preferences: {
    status: "ready",
    preferences: {
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
      optionalDiscoveryRoots: [],
    },
  },
  recentOperation: { status: "empty" },
  refresh: { status: "refreshing" },
};

function renderPersistedRoute(routeId: string): string {
  vi.stubGlobal("localStorage", {
    getItem: () => JSON.stringify({ routeId, settingsGroup: "appearance" }),
    removeItem: () => undefined,
  });
  return renderToStaticMarkup(
    <AppShell
      onAppearanceChange={() => Promise.resolve()}
      onRefresh={() => undefined}
      state={readyState}
    />,
  );
}

describe("AppShell tool sections", () => {
  it("shows the Caddy sections under the selected tool with the first one current", () => {
    const markup = renderPersistedRoute("caddy");
    expect(markup.match(/navigation-rail__section"/g)).toHaveLength(3);
    expect(markup).toMatch(/<button[^>]*aria-current="true"[^>]*>站点规则<\/button>/);
  });

  it("renders no tool sections for a tool that declares none", () => {
    expect(renderPersistedRoute("tools")).not.toContain('navigation-rail__section"');
  });
});
