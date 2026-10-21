import { describe, expect, it } from "vitest";
import type { ClaudeReadView, ClaudeSettingEntry } from "../../ipc/aiConfig";
import type { SelectGrantResult } from "../../ipc/grants";
import {
  entryBadges,
  isPartialView,
  layerStateText,
  overriddenText,
  resolveSelection,
  valueText,
  winnerText,
  type ProjectGrant,
} from "./claudeSettingsModel";

const current: ProjectGrant = { id: "11111111-1111-4111-8111-111111111111", displayPath: "~/work/a" };

const selected: SelectGrantResult = {
  status: "SELECTED",
  grant: {
    id: "22222222-2222-4222-8222-222222222222",
    purpose: "CONFIG_DIRECTORY",
    kind: "DIRECTORY",
    displayPath: "~/work/b",
    createdAtEpochMs: 1,
  },
};

function entry(overrides: Partial<ClaudeSettingEntry> = {}): ClaudeSettingEntry {
  return {
    key: "model",
    documented: true,
    valueType: "string",
    coverage: "displayOnly",
    value: "x",
    masked: false,
    merged: false,
    winner: "claude-user-settings",
    definedIn: [{ layerId: "claude-user-settings", overridden: false }],
    ...overrides,
  };
}

function view(overrides: Partial<ClaudeReadView> = {}): ClaudeReadView {
  return { toolId: "claude-code", layers: [], entries: [], warnings: [], ...overrides };
}

describe("resolveSelection", () => {
  it("keeps the current project when the picker is cancelled", () => {
    expect(resolveSelection({ status: "CANCELLED" }, current)).toBe(current);
    expect(resolveSelection({ status: "CANCELLED" }, null)).toBeNull();
  });

  it("replaces the project with the granted directory when one is selected", () => {
    expect(resolveSelection(selected, current)).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      displayPath: "~/work/b",
    });
  });
});

describe("entry badges", () => {
  it("marks every documented, typed entry as display-only", () => {
    expect(entryBadges(entry())).toEqual(["仅展示"]);
  });

  it("flags undocumented-type and undocumented keys without claiming support", () => {
    expect(entryBadges(entry({ valueType: "unknown" }))).toEqual(["类型未核实·仅展示"]);
    expect(
      entryBadges(entry({ documented: false, valueType: null, coverage: null })),
    ).toEqual(["未登记定义·仅展示"]);
  });

  it("adds masked and merged markers", () => {
    expect(entryBadges(entry({ masked: true, merged: true }))).toEqual([
      "仅展示",
      "已遮盖",
      "列表合并",
    ]);
  });
});

describe("winner and override text", () => {
  it("names the merged result for list keys and the winning layer otherwise", () => {
    expect(winnerText(entry({ merged: true, winner: null }))).toBe("多层合并");
    expect(winnerText(entry())).toBe("用户设置");
  });

  it("lists only the layers whose values were overridden", () => {
    const overridden = entry({
      definedIn: [
        { layerId: "claude-managed-settings", overridden: false },
        { layerId: "claude-user-settings", overridden: true },
      ],
    });
    expect(overriddenText(overridden)).toBe("被覆盖：用户设置");
    expect(overriddenText(entry())).toBe("无被覆盖的来源");
  });
});

describe("layer states and partial results", () => {
  it("renders malformed states with their structured message", () => {
    expect(layerStateText({ kind: "malformed", message: "重复键：model" })).toBe(
      "解析失败：重复键：model",
    );
    expect(layerStateText({ kind: "existsUnreadable", message: null })).toBe("存在但不可读");
  });

  it("treats unreadable or malformed layers as a partial result", () => {
    const layers = [
      { id: "claude-user-settings", layer: "userLevel", location: "{home}/.claude/settings.json", precedence: 4, state: { kind: "existsUnreadable" as const, message: null } },
    ];
    expect(isPartialView(view({ layers }))).toBe(true);
    expect(isPartialView(view({ layers: [{ ...layers[0], state: { kind: "loaded", message: null } }] }))).toBe(false);
    expect(isPartialView(view({ warnings: [{ layerId: "claude-user-settings", key: "model", message: "类型与定义不符" }] }))).toBe(true);
  });
});

describe("valueText", () => {
  it("serializes values and truncates long ones", () => {
    expect(valueText({ a: 1 })).toBe('{"a":1}');
    expect(valueText("x".repeat(300))).toHaveLength(201);
  });
});
