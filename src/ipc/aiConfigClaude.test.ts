import { describe, expect, it } from "vitest";
import { decodeClaudeReadView, decodeClaudeSnapshotSummary } from "./aiConfig";

function layer(id: string, state: Record<string, unknown>, precedence: number | null = 1) {
  return { id, layer: "userLevel", location: "{home}/.claude/settings.json", precedence, state };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: "model",
    documented: true,
    valueType: "string",
    coverage: "displayOnly",
    value: "claude-x",
    masked: false,
    merged: false,
    winner: "claude-user-settings",
    definedIn: [{ layerId: "claude-user-settings", overridden: false }],
    ...overrides,
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "claude-code",
    layers: [layer("claude-user-settings", { state: "loaded" })],
    entries: [entry()],
    warnings: [],
    ...overrides,
  };
}

const snapshot = {
  toolId: "claude-code",
  displayName: "Claude Code",
  sourceUrl: "https://code.claude.com/docs/en/settings-reference",
  retrievedOn: "2026-10-21",
  documentedVersion: "unknown",
  settingCount: 245,
  resourceCount: 5,
  editable: 0,
  displayOnly: 250,
  versionUnknown: 0,
  notApplicable: 0,
  unsupported: 0,
  unknownValueType: 216,
};

describe("decodeClaudeReadView", () => {
  it("decodes a loaded view with layers, entries and warnings", () => {
    const decoded = decodeClaudeReadView(view());

    expect(decoded.toolId).toBe("claude-code");
    expect(decoded.layers[0].state).toEqual({ kind: "loaded", message: null });
    expect(decoded.entries[0].definedIn).toEqual([
      { layerId: "claude-user-settings", overridden: false },
    ]);
  });

  it("decodes a malformed layer with its structured message", () => {
    const decoded = decodeClaudeReadView(
      view({ layers: [layer("claude-user-settings", { state: "malformed", message: "重复键：model" })] }),
    );

    expect(decoded.layers[0].state).toEqual({ kind: "malformed", message: "重复键：model" });
  });

  it("rejects an unknown extra key on any object", () => {
    expect(() => decodeClaudeReadView({ ...view(), path: "/Users/x" })).toThrow();
    expect(() => decodeClaudeReadView(view({ entries: [entry({ extra: 1 })] }))).toThrow();
  });

  it("rejects a layer state that the backend does not produce", () => {
    expect(() =>
      decodeClaudeReadView(view({ layers: [layer("claude-user-settings", { state: "absolutePath" })] })),
    ).toThrow();
  });

  it("rejects a malformed state that omits its message", () => {
    expect(() =>
      decodeClaudeReadView(view({ layers: [layer("claude-user-settings", { state: "malformed" })] })),
    ).toThrow();
  });

  it("rejects an entry whose documented flag contradicts its type and coverage", () => {
    expect(() =>
      decodeClaudeReadView(view({ entries: [entry({ documented: false })] })),
    ).toThrow();
    expect(() =>
      decodeClaudeReadView(view({ entries: [entry({ valueType: null, coverage: null })] })),
    ).toThrow();
  });

  it("rejects a view for another tool and an entry without a source layer", () => {
    expect(() => decodeClaudeReadView(view({ toolId: "codex-cli" }))).toThrow();
    expect(() => decodeClaudeReadView(view({ entries: [entry({ definedIn: [] })] }))).toThrow();
  });

  it("rejects a non-object response", () => {
    expect(() => decodeClaudeReadView(null)).toThrow();
    expect(() => decodeClaudeReadView([])).toThrow();
  });
});

describe("decodeClaudeSnapshotSummary", () => {
  it("decodes the definition summary", () => {
    expect(decodeClaudeSnapshotSummary(snapshot).settingCount).toBe(245);
  });

  it("rejects a non-https source and a negative count", () => {
    expect(() =>
      decodeClaudeSnapshotSummary({ ...snapshot, sourceUrl: "http://example.com" }),
    ).toThrow();
    expect(() => decodeClaudeSnapshotSummary({ ...snapshot, editable: -1 })).toThrow();
  });

  it("rejects a summary with a missing field", () => {
    const partial: Record<string, unknown> = { ...snapshot };
    delete partial.unknownValueType;
    expect(() => decodeClaudeSnapshotSummary(partial)).toThrow();
  });
});
