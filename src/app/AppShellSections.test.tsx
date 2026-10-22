// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function sidebarOf(markup: string): string {
  return markup.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? "";
}

describe("AppShell tool sections", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the sidebar to groups and tools and shows the sections as tabs above the tool content", () => {
    const markup = renderPersistedRoute("caddy");
    expect(sidebarOf(markup)).not.toContain("站点规则");
    expect(sidebarOf(markup)).not.toContain("data-section-id");
    expect(markup.match(/data-section-id="/g)).toHaveLength(3);
    const current = markup.match(/<[a-z]+[^>]*data-section-id="rules"[^>]*>/)?.[0] ?? "";
    expect(current).toContain('aria-current="true"');
  });

  it("renders no tool sections for a tool that declares none", () => {
    const markup = renderPersistedRoute("tools");
    expect(markup).not.toContain("data-section-id");
    expect(sidebarOf(markup)).not.toContain("分区");
  });

  it("keeps the section chosen on a tool when the user leaves and comes back", () => {
    const store = new Map<string, string>([
      ["userhome.selection.v1", JSON.stringify({ routeId: "caddy", settingsGroup: "appearance" })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    const { container } = render(
      <AppShell
        onAppearanceChange={() => Promise.resolve()}
        onRefresh={() => undefined}
        state={readyState}
      />,
    );
    const sidebar = within(container.querySelector("nav") as HTMLElement);
    const tab = (name: string) => screen.getByRole("tab", { name });
    const selected = (name: string) => tab(name).getAttribute("aria-selected");
    const pageTitle = () => container.querySelector(".desktop-workspace__page-title")?.textContent;

    fireEvent.click(tab("原文 Caddyfile"));
    expect(selected("原文 Caddyfile")).toBe("true");

    fireEvent.click(sidebar.getByRole("link", { name: /^工具集：/ }));
    expect(pageTitle()).toBe("工具集");

    fireEvent.click(sidebar.getByRole("link", { name: /^Caddy：/ }));
    expect(pageTitle()).toBe("Caddy");
    expect(selected("原文 Caddyfile")).toBe("true");
    expect(selected("站点规则")).toBe("false");
  });
});
