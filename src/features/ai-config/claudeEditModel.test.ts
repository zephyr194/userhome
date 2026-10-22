import { describe, expect, it } from "vitest";
import type {
  ClaudeEditItem,
  ClaudeEditPreview,
  ClaudeEditResult,
} from "../../ipc/aiConfig";
import {
  buildEditRequest,
  diffSymbol,
  editBlockedReason,
  editControl,
  editReducer,
  groupSettings,
  initialDraft,
  recoveryNote,
  resultMessage,
  settingBadges,
  userLevelText,
  versionNoteText,
  type EditPhase,
} from "./claudeEditModel";
import type { ClaudeReadView } from "../../ipc/aiConfig";

const GRANT = "11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<ClaudeEditItem> = {}): ClaudeEditItem {
  return {
    keyPath: "effortLevel",
    valueType: "enum",
    allowedValues: ["low", "medium", "high", "xhigh"],
    editable: true,
    reason: null,
    verifiedVersion: "2.1.287",
    description: "Effort level for the session.",
    descriptionTruncated: false,
    defaultNote: "未设置时由 CLI 决定",
    sourceUrl: "https://code.claude.com/docs/en/settings-reference",
    sourceRetrievedOn: "2026-10-21",
    ...overrides,
  };
}

const PREVIEW: ClaudeEditPreview = {
  operationId: "op-1",
  summary: "Replace ~/.claude/settings.json.",
  effects: [],
  expiresAt: "2026-10-21T10:00:00Z",
  keyPath: "effortLevel",
  action: "set",
  kind: "REPLACE",
  recoveryPoint: "BACKUP",
  diff: { lines: [], redacted: false, truncated: false },
  reloadNote: "已写入设置文件。",
};

function result(
  status: "SUCCEEDED" | "FAILED",
  overrides: Partial<ClaudeEditResult["outcome"]> = {},
): ClaudeEditResult {
  return {
    operationId: "op-1",
    reloadNote: "已写入设置文件。",
    outcome: {
      kind: "REPLACE",
      status,
      fileState: status === "SUCCEEDED" ? "WRITTEN" : "RESTORED",
      recoveryPoint: "BACKUP",
      backupId: null,
      summary: "Replace ~/.claude/settings.json.",
      error: null,
      ...overrides,
    },
  };
}

describe("editControl and initialDraft", () => {
  it("chooses a control only for editable items of a supported type", () => {
    expect(editControl(item({ valueType: "boolean", allowedValues: [] }))).toBe(
      "boolean",
    );
    expect(editControl(item())).toBe("enum");
    expect(editControl(item({ valueType: "string", allowedValues: [] }))).toBe(
      "string",
    );
    expect(editControl(item({ editable: false, reason: "仅展示" }))).toBe(
      "none",
    );
    expect(editControl(item({ valueType: "object", allowedValues: [] }))).toBe(
      "none",
    );
  });

  it("starts each control from a neutral draft", () => {
    expect(
      initialDraft(item({ valueType: "boolean", allowedValues: [] })),
    ).toBe(false);
    expect(initialDraft(item())).toBe("low");
    expect(initialDraft(item({ valueType: "string", allowedValues: [] }))).toBe(
      "",
    );
  });
});

describe("editBlockedReason", () => {
  it("explains a display-only key with its own reason", () => {
    expect(
      editBlockedReason(
        item({ editable: false, reason: "版本未确认，写入已禁用" }),
        GRANT,
      ),
    ).toBe("版本未确认，写入已禁用");
  });

  it("asks for a settings file before any editable key can be changed", () => {
    expect(editBlockedReason(item(), null)).toBe(
      "请先选择要修改的用户设置文件。",
    );
    expect(editBlockedReason(item(), GRANT)).toBeNull();
  });
});

describe("buildEditRequest", () => {
  it("builds a set request with the typed value", () => {
    expect(buildEditRequest(item(), GRANT, "set", "high")).toEqual({
      ok: true,
      request: {
        grantId: GRANT,
        keyPath: "effortLevel",
        action: "set",
        value: "high",
      },
    });
  });

  it("rejects a draft that does not match the control", () => {
    expect(buildEditRequest(item(), GRANT, "set", "max").ok).toBe(false);
    expect(
      buildEditRequest(
        item({ valueType: "boolean", allowedValues: [] }),
        GRANT,
        "set",
        "true",
      ).ok,
    ).toBe(false);
  });

  it("rejects blank or over-long text", () => {
    const text = item({ valueType: "string", allowedValues: [] });

    expect(buildEditRequest(text, GRANT, "set", "   ").ok).toBe(false);
    expect(buildEditRequest(text, GRANT, "set", "a".repeat(257)).ok).toBe(
      false,
    );
    expect(buildEditRequest(text, GRANT, "set", "fr").ok).toBe(true);
  });

  it("keeps restore-default and set-null distinct and free of a value", () => {
    const restore = buildEditRequest(item(), GRANT, "restoreDefault", "high");
    const nulled = buildEditRequest(item(), GRANT, "setNull", "high");

    expect(restore).toEqual({
      ok: true,
      request: {
        grantId: GRANT,
        keyPath: "effortLevel",
        action: "restoreDefault",
      },
    });
    expect(nulled).toEqual({
      ok: true,
      request: { grantId: GRANT, keyPath: "effortLevel", action: "setNull" },
    });
  });
});

describe("editReducer", () => {
  it("walks preview, confirmation and a successful save", () => {
    let phase: EditPhase = { status: "idle" };
    phase = editReducer(phase, { type: "previewStart", action: "set" });
    phase = editReducer(phase, { type: "previewReady", preview: PREVIEW });
    phase = editReducer(phase, { type: "confirmStart" });
    phase = editReducer(phase, {
      type: "confirmDone",
      result: result("SUCCEEDED"),
    });

    expect(phase.status).toBe("saved");
  });

  it("reports a write that did not succeed as a write failure, not a save", () => {
    const phase = editReducer(
      { status: "confirming", preview: PREVIEW },
      { type: "confirmDone", result: result("FAILED") },
    );

    expect(phase.status).toBe("writeFailed");
  });

  it("drops the preview and shows the error when a confirmation is rejected as expired", () => {
    const expired = {
      code: "CONFLICT" as const,
      message: "预览已过期，请重新预览。",
      retryable: false,
    };
    const phase = editReducer(
      { status: "confirming", preview: PREVIEW },
      { type: "failed", error: expired },
    );

    expect(phase).toEqual({ status: "failed", error: expired });
  });

  it("ignores confirmation without a preview and a second preview while one is running", () => {
    expect(editReducer({ status: "idle" }, { type: "confirmStart" })).toEqual({
      status: "idle",
    });
    const running: EditPhase = { status: "previewing", action: "set" };
    expect(
      editReducer(running, { type: "previewStart", action: "setNull" }),
    ).toBe(running);
  });

  it("returns to idle when the user cancels a preview", () => {
    expect(
      editReducer(
        { status: "previewed", preview: PREVIEW },
        { type: "cancel" },
      ),
    ).toEqual({ status: "idle" });
  });

  it("does not accept a preview result after the request was cancelled", () => {
    const idle: EditPhase = { status: "idle" };
    expect(editReducer(idle, { type: "previewReady", preview: PREVIEW })).toBe(
      idle,
    );
  });
});

describe("display helpers", () => {
  it("marks added and removed lines", () => {
    expect(diffSymbol({ kind: "ADDED", text: "x" })).toBe("+");
    expect(diffSymbol({ kind: "REMOVED", text: "x" })).toBe("-");
  });

  it("says when there is no restore point and when a backup protects the write", () => {
    expect(
      recoveryNote({
        ...PREVIEW,
        kind: "CREATE",
        recoveryPoint: "NONE_CREATED",
      }),
    ).toContain("没有恢复点");
    expect(recoveryNote(PREVIEW)).toContain("备份");
  });

  it("reports success with the reload note and failure with the backend message", () => {
    expect(resultMessage(result("SUCCEEDED"))).toBe("已保存。已写入设置文件。");
    expect(
      resultMessage(
        result("FAILED", {
          error: {
            code: "CONFLICT",
            message: "文件已被修改，请重新预览。",
            retryable: false,
          },
        }),
      ),
    ).toBe("文件已被修改，请重新预览。");
  });
});

function catalogItem(
  overrides: Partial<ClaudeEditItem> = {},
): ClaudeEditItem {
  return {
    ...item(),
    description: "Effort level for the session.",
    descriptionTruncated: false,
    defaultNote: "未设置时由 CLI 决定",
    sourceUrl: "https://code.claude.com/docs/en/settings-reference",
    sourceRetrievedOn: "2026-10-21",
    ...overrides,
  };
}

describe("groupSettings", () => {
  const items = [
    catalogItem({ keyPath: "effortLevel" }),
    catalogItem({
      keyPath: "verbose",
      valueType: "boolean",
      allowedValues: [],
      editable: false,
      reason: "仅展示，版本未核实",
      description: "Show verbose output.",
    }),
    catalogItem({
      keyPath: "language",
      valueType: "string",
      allowedValues: [],
      description: "Interface language.",
    }),
  ];

  it("splits editable items from display-only ones, keeping catalog order", () => {
    const groups = groupSettings(items, { query: "", editableOnly: false });

    expect(groups.editable.map((entry) => entry.keyPath)).toEqual([
      "effortLevel",
      "language",
    ]);
    expect(groups.displayOnly.map((entry) => entry.keyPath)).toEqual(["verbose"]);
  });

  it("hides the display-only group when only editable settings are wanted", () => {
    const groups = groupSettings(items, { query: "", editableOnly: true });

    expect(groups.displayOnly).toEqual([]);
    expect(groups.editable).toHaveLength(2);
  });

  it("matches the query against the key name or the official description, ignoring case", () => {
    const byKey = groupSettings(items, { query: "  EFFORT ", editableOnly: false });
    const byDescription = groupSettings(items, { query: "verbose", editableOnly: false });

    expect(byKey.editable.map((entry) => entry.keyPath)).toEqual(["effortLevel"]);
    expect(byKey.displayOnly).toEqual([]);
    expect(byDescription.displayOnly.map((entry) => entry.keyPath)).toEqual(["verbose"]);
    expect(byDescription.editable).toEqual([]);
  });
});

describe("userLevelText", () => {
  const view: ClaudeReadView = {
    toolId: "claude-code",
    layers: [],
    warnings: [],
    entries: [
      {
        key: "effortLevel",
        documented: true,
        valueType: "enum",
        coverage: "editable",
        value: "high",
        masked: false,
        merged: false,
        winner: "claude-user-settings",
        definedIn: [{ layerId: "claude-user-settings", overridden: false }],
      },
      {
        key: "verbose",
        documented: true,
        valueType: "boolean",
        coverage: "displayOnly",
        value: true,
        masked: false,
        merged: false,
        winner: "claude-managed-settings",
        definedIn: [
          { layerId: "claude-managed-settings", overridden: false },
          { layerId: "claude-user-settings", overridden: true },
        ],
      },
      {
        key: "secretish",
        documented: true,
        valueType: "string",
        coverage: "displayOnly",
        value: "[REDACTED]",
        masked: true,
        merged: false,
        winner: "claude-user-settings",
        definedIn: [{ layerId: "claude-user-settings", overridden: false }],
      },
    ],
  };

  it("shows the user-level value when the user file is the winning source", () => {
    expect(userLevelText("effortLevel", view)).toBe('"high"');
  });

  it("says a key is unset when no layer defines it, or the user layer does not", () => {
    expect(userLevelText("language", view)).toBe("未设置");
    expect(userLevelText("language", { ...view, entries: [] })).toBe("未设置");
  });

  it("does not show a user value that a higher layer overrides or that is masked", () => {
    expect(userLevelText("verbose", view)).toBe(
      "已设置，但被其他来源覆盖或合并，此处不显示",
    );
    expect(userLevelText("secretish", view)).toBe("已设置（内容已遮盖）");
  });

  it("reports that the view has not loaded yet", () => {
    expect(userLevelText("effortLevel", null)).toBe("未读取");
  });
});

describe("settingBadges", () => {
  it("marks an editable key as editable and a blocked key as display-only, both with text", () => {
    expect(settingBadges(item(), "2.1.287").map((badge) => badge.label)).toEqual([
      "可编辑",
    ]);
    expect(
      settingBadges(
        item({ editable: false, reason: "仅展示，版本未核实", verifiedVersion: null }),
        "2.1.287",
      ).map((badge) => badge.label),
    ).toEqual(["仅展示"]);
  });

  it("asks for the verified version on a version-gated key and flags an undetected version", () => {
    const gated = item({
      editable: false,
      reason: "版本未确认，写入已禁用：本机版本不在已验证区间内",
      verifiedVersion: "2.1.287",
    });

    expect(settingBadges(gated, "2.2.0").map((badge) => badge.label)).toEqual([
      "仅展示",
      "需要版本 2.1.287",
    ]);
    expect(settingBadges(gated, null).map((badge) => badge.label)).toEqual([
      "仅展示",
      "需要版本 2.1.287",
      "版本未检测",
    ]);
  });

  it("gives the display-only state a neutral tone and each warning a warning tone", () => {
    const tones = settingBadges(item({ editable: false, reason: "x", verifiedVersion: "1" }), null).map(
      (badge) => badge.tone,
    );
    expect(tones).toEqual(["neutral", "warning", "warning"]);
  });
});

describe("versionNoteText", () => {
  it("names the detected version and the single verified version", () => {
    expect(versionNoteText("2.1.287", [item()])).toBe(
      "本机版本：2.1.287。已验证版本：2.1.287。",
    );
  });

  it("says the local version is undetected and lists each distinct verified version once", () => {
    const items = [
      item(),
      item({ keyPath: "other", verifiedVersion: "2.1.287" }),
      item({ keyPath: "range", verifiedVersion: "1.0.0 至 1.5.0" }),
      item({ keyPath: "none", verifiedVersion: null }),
    ];

    expect(versionNoteText(null, items)).toBe(
      "未检测到本机版本。已验证版本：2.1.287、1.0.0 至 1.5.0。",
    );
  });

  it("reports that no version is verified when no item carries one", () => {
    expect(versionNoteText("2.1.287", [item({ verifiedVersion: null })])).toBe(
      "本机版本：2.1.287。尚无已验证版本。",
    );
  });
});

