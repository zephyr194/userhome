import { describe, expect, it, vi } from "vitest";
import type { SelectionMemory } from "./selectionMemory";
import {
  DEFAULT_SELECTION_MEMORY,
  decodeSelectionMemory,
  encodeSelectionMemory,
  loadSelectionMemory,
} from "./selectionMemory";

describe("selection memory retired fields", () => {
  it("ignores application and Homebrew selections stored by older builds", () => {
    const legacy = {
      routeId: "services",
      settingsGroup: "appearance",
      serviceId: "com.example.worker",
      applicationsScope: "CATALOG",
      applicationKey: "catalog:git",
      applicationConfigIds: { git: "config-1" },
      applicationQuery: "git",
      applicationCategory: "dev",
      applicationCoverage: "MANAGED_WRITABLE",
      applicationCapability: "WRITE_CONFIG",
      applicationDetected: true,
      applicationPage: 3,
      applicationScrollTop: 120,
      brewSelection: { kind: "FORMULA", identifier: "git" },
    };

    expect(decodeSelectionMemory(legacy)).toEqual({
      routeId: "services",
      settingsGroup: "appearance",
      serviceId: "com.example.worker",
    });
  });

  it("falls back to defaults for malformed retired fields without throwing", () => {
    const malformed = {
      applicationsScope: 7,
      applicationConfigIds: [1],
      brewSelection: "git",
    };

    expect(() => decodeSelectionMemory(malformed)).not.toThrow();
    expect(decodeSelectionMemory(malformed)).toEqual(DEFAULT_SELECTION_MEMORY);
  });

  it("never serializes the retired fields", () => {
    const encoded = encodeSelectionMemory({
      ...DEFAULT_SELECTION_MEMORY,
      applicationsScope: "CATALOG",
      brewSelection: { kind: "CASK", identifier: "iterm2" },
    } as SelectionMemory);

    expect(Object.keys(JSON.parse(encoded)).sort()).toEqual([
      "routeId",
      "settingsGroup",
    ]);
  });
});

describe("selection memory route restore", () => {
  it("restores a saved Caddy selection, which is a child page of system tools", () => {
    expect(decodeSelectionMemory({ routeId: "caddy", settingsGroup: "appearance" })).toEqual({
      routeId: "caddy",
      settingsGroup: "appearance",
    });
  });

  it("restores the system tools card page", () => {
    expect(decodeSelectionMemory({ routeId: "systemTools" }).routeId).toBe("systemTools");
  });

  it("restores a route that still has a navigation entry", () => {
    expect(decodeSelectionMemory({ routeId: "services" }).routeId).toBe(
      "services",
    );
    expect(decodeSelectionMemory({ routeId: "settings" }).routeId).toBe(
      "settings",
    );
  });

  it.each(["applications", "homebrew"])(
    "falls back to the dashboard for the retired route %s",
    (routeId) => {
      expect(() => decodeSelectionMemory({ routeId })).not.toThrow();
      expect(decodeSelectionMemory({ routeId }).routeId).toBe("dashboard");
    },
  );

  it("falls back to the dashboard for an unknown route", () => {
    expect(decodeSelectionMemory({ routeId: "gone" }).routeId).toBe(
      "dashboard",
    );
  });

  it("lands on the dashboard when a retired route was persisted", () => {
    const storage = new Map<string, string>();
    const original = globalThis.window;
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    try {
      storage.set(
        "userhome.selection.v1",
        JSON.stringify({ routeId: "homebrew", settingsGroup: "appearance" }),
      );
      expect(loadSelectionMemory(true).routeId).toBe("dashboard");
      expect(storage.size).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      if (original) vi.stubGlobal("window", original);
    }
  });

  it("never persists a retired route", () => {
    const encoded = encodeSelectionMemory({
      ...DEFAULT_SELECTION_MEMORY,
      routeId: "applications",
    });
    expect(JSON.parse(encoded).routeId).toBe("dashboard");
  });
});
