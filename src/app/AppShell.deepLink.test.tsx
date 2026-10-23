// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import type { ShellState } from "./shellState";

const deepLinkHandlers = vi.hoisted(() => ({
  listeners: [] as Array<(payload: unknown) => void>,
  pending: null as unknown,
}));

vi.mock("../ipc/deepLink", () => ({
  registerDeepLinkListener: (handler: (payload: unknown) => void) => {
    deepLinkHandlers.listeners.push(handler);
    return Promise.resolve(() => undefined);
  },
  takePendingDeepLink: () => {
    const pending = deepLinkHandlers.pending;
    deepLinkHandlers.pending = null;
    return Promise.resolve(pending);
  },
}));

const grantNotice = {
  check: { phase: "available" },
  rechecking: false,
  dialog: { phase: "closed" },
} as const;

vi.mock("../features/grants/useGrantStoreNotice", () => ({
  useGrantStoreNotice: () => ({
    controller: {
      refresh: () => Promise.resolve(),
      subscribe: () => () => undefined,
      getState: () => grantNotice,
    },
    state: grantNotice,
  }),
}));

vi.mock("./routes", async () => {
  const { useContext } = await import("react");
  const { SectionContext } = await import("./SectionContext");
  return {
    RoutePanel: ({ route }: { route: { id: string } }) => {
      const section = useContext(SectionContext)?.section ?? "";
      return <p data-testid="route-panel" data-route={route.id} data-section={section} />;
    },
  };
});

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
      language: "system",
    },
  },
  recentOperation: { status: "empty" },
  refresh: { status: "refreshing" },
};

function renderShell() {
  return render(
    <AppShell
      onAppearanceChange={() => Promise.resolve()}
      onRefresh={() => undefined}
      state={readyState}
    />,
  );
}

function routePanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('[data-testid="route-panel"]');
  if (!panel) throw new Error("route panel is not rendered");
  return panel;
}

function deliver(payload: unknown) {
  act(() => {
    for (const handler of deepLinkHandlers.listeners) handler(payload);
  });
}

describe("AppShell deep links", () => {
  beforeEach(() => {
    deepLinkHandlers.listeners = [];
    deepLinkHandlers.pending = null;
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ routeId: "dashboard", settingsGroup: "appearance" }),
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("opens the page and section of a link taken from startup", async () => {
    deepLinkHandlers.pending = { routeId: "environment", section: "zsh", source: "deep-link" };
    renderShell();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("环境变量");
    expect(routePanel().dataset.route).toBe("environment");
    expect(routePanel().dataset.section).toBe("zsh");
  });

  it("navigates when a link is opened while the app runs", async () => {
    renderShell();
    await act(async () => {
      await Promise.resolve();
    });

    deliver({ routeId: "caddy", section: "rules", source: "deep-link" });
    expect(routePanel().dataset.route).toBe("caddy");
    expect(routePanel().dataset.section).toBe("rules");

    deliver({ routeId: "settings", group: "general", source: "deep-link" });
    expect(routePanel().dataset.route).toBe("settings");
  });

  it("stays on the current page for a payload the frontend does not accept", async () => {
    renderShell();
    await act(async () => {
      await Promise.resolve();
    });

    deliver({ routeId: "applications" });
    deliver({ routeId: "environment", section: "secrets" });
    deliver({ routeId: "dashboard", source: "menu" });
    deliver("userhome://open/environment");

    expect(routePanel().dataset.route).toBe("dashboard");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("概览");
  });
});
