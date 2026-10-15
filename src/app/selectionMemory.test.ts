import { describe, expect, it, vi } from "vitest";
import type { SelectionMemory } from "./selectionMemory";
import {
  DEFAULT_SELECTION_MEMORY,
  decodeSelectionMemory,
  encodeSelectionMemory,
  loadSelectionMemory,
} from "./selectionMemory";

describe("selection memory applications scope", () => {
  it("defaults to the local recognized scope", () => {
    expect(DEFAULT_SELECTION_MEMORY.applicationsScope).toBe(
      "LOCAL_RECOGNIZED",
    );
    expect(decodeSelectionMemory({}).applicationsScope).toBe(
      "LOCAL_RECOGNIZED",
    );
  });

  it("round-trips a persisted catalog scope", () => {
    const encoded = encodeSelectionMemory({
      ...DEFAULT_SELECTION_MEMORY,
      applicationsScope: "CATALOG",
    });

    expect(JSON.parse(encoded).applicationsScope).toBe("CATALOG");
    expect(
      decodeSelectionMemory(JSON.parse(encoded)).applicationsScope,
    ).toBe("CATALOG");
  });

  it("falls back to the local scope for an invalid stored scope", () => {
    expect(
      decodeSelectionMemory({ applicationsScope: "WAREHOUSE" })
        .applicationsScope,
    ).toBe("LOCAL_RECOGNIZED");
    expect(
      decodeSelectionMemory({ applicationsScope: 7 }).applicationsScope,
    ).toBe("LOCAL_RECOGNIZED");
  });

  it("never serializes transient candidate navigation fields", () => {
    const encoded = encodeSelectionMemory({
      ...DEFAULT_SELECTION_MEMORY,
      applicationsScope: "LOCAL_RECOGNIZED",
      candidateId: "candidate-42",
      sourceRefreshId: "refresh-42",
    } as SelectionMemory);

    expect(encoded).toContain("applicationsScope");
    expect(encoded).not.toContain("candidateId");
    expect(encoded).not.toContain("sourceRefreshId");
    expect(encoded).not.toContain("candidate-42");
    expect(encoded).not.toContain("refresh-42");
  });
});

describe("selection memory route restore", () => {
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
